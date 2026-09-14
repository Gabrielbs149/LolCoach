import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pastaBase } from '../caminhos.js';
import { RiotApi } from './riot.js';

/**
 * Perfil de outra pessoa pela API da Riot — o "op.gg entre amigos".
 *
 * Cada amigo tem os dados no próprio PC; o que dá pra ver daqui é o que a
 * Riot conta de qualquer conta: elo, nível, maestria e as últimas partidas
 * ranqueadas. Com as 20 últimas dá pra montar um resumo comparável ao seu:
 * taxa, AMA, farm/min, participação em abates, campeões mais jogados.
 *
 * Custo: 1 chamada de conta + 1 de elo + 1 de maestria + 1 lista + 20 partidas
 * ≈ 24 chamadas por amigo. O limite da chave é 100 a cada 2 minutos, então
 * fica em disco por 30 minutos e é sequencial. Precisa de chave da Riot.
 */

const VALIDADE = 30 * 60 * 1000;
const QUANTAS = 20;
const FILA_SOLO = 420;

// Um cliente só pra todos os amigos: o contador do limite vive dentro dele, e
// um por amigo esqueceria as chamadas do anterior e tomaria 429.
let riotCompartilhado = null, chaveDele = null;
function riotDe(cfg) {
  if (!riotCompartilhado || chaveDele !== cfg.apiKey) { riotCompartilhado = new RiotApi(cfg); chaveDele = cfg.apiKey; }
  return riotCompartilhado;
}

const pasta = () => resolve(pastaBase(), 'dados', 'amigos');
const seguro = (s) => String(s ?? '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
const arquivo = (nome, tag) => resolve(pasta(), `${seguro(nome)}-${seguro(tag)}.json`);

async function lerCache(nome, tag) {
  try { return JSON.parse(await readFile(arquivo(nome, tag), 'utf8')); } catch { return null; }
}
async function gravarCache(nome, tag, dados) {
  try { await mkdir(pasta(), { recursive: true }); await writeFile(arquivo(nome, tag), JSON.stringify(dados), 'utf8'); }
  catch { /* segue só com a rede */ }
}

const TIER_PT = {
  IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina',
  EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante',
};
const ORDEM_TIER = Object.keys(TIER_PT);
const FILA_PT = { RANKED_SOLO_5x5: 'Solo/Duo', RANKED_FLEX_SR: 'Flex' };
const ROLE_PT = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'sup' };

/** Um número só pra ordenar elos: tier × 400 + divisão × 100 + PDL. */
export function pontosDeElo(e) {
  if (!e) return 0;
  const t = ORDEM_TIER.indexOf(e.tier);
  const div = { IV: 0, III: 1, II: 2, I: 3 }[e.rank] ?? 0;
  return (t < 0 ? 0 : t) * 400 + div * 100 + (e.pdl ?? 0);
}

function arrumarElo(e) {
  const jogos = (e.wins ?? 0) + (e.losses ?? 0);
  const semDivisao = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(e.tier);
  return {
    fila: FILA_PT[e.queueType] ?? e.queueType, chave: e.queueType, tier: e.tier, rank: e.rank,
    nome: semDivisao ? TIER_PT[e.tier] : `${TIER_PT[e.tier] ?? e.tier} ${{ I: '1', II: '2', III: '3', IV: '4' }[e.rank] ?? ''}`.trim(),
    pdl: e.leaguePoints ?? 0, vitorias: e.wins ?? 0, derrotas: e.losses ?? 0, jogos,
    taxa: jogos ? e.wins / jogos : 0,
  };
}

/**
 * Resumo das últimas partidas ranqueadas de um puuid, no mesmo formato que a
 * tela de Estatísticas usa pra você — pra comparação ser maçã com maçã.
 */
async function resumoRecente(riot, puuid, { quantas = QUANTAS, aoProgresso } = {}) {
  const ids = await riot.idsDePartidas(puuid, { quantas, fila: FILA_SOLO }).catch(() => []);
  const linhas = [];
  let i = 0;
  for (const id of ids) {
    try {
      const m = await riot.partida(id);
      const eu = m.info?.participants?.find((p) => p.puuid === puuid);
      if (!eu || (m.info?.gameDuration ?? 0) < 300) continue;
      const time = m.info.participants.filter((p) => p.teamId === eu.teamId);
      const killsTime = time.reduce((s, p) => s + (p.kills ?? 0), 0);
      const danoTime = time.reduce((s, p) => s + (p.totalDamageDealtToChampions ?? 0), 0);
      linhas.push({
        gameId: m.info.gameId, quando: m.info.gameCreation, duracaoS: m.info.gameDuration,
        campeao: eu.championName, championId: eu.championId, role: ROLE_PT[eu.teamPosition] ?? '',
        venci: eu.win ? 1 : 0, kills: eu.kills, deaths: eu.deaths, assists: eu.assists,
        cs: (eu.totalMinionsKilled ?? 0) + (eu.neutralMinionsKilled ?? 0),
        dano: eu.totalDamageDealtToChampions ?? 0, visao: eu.visionScore ?? 0, ouro: eu.goldEarned ?? 0,
        participacao: killsTime ? (eu.kills + eu.assists) / killsTime : 0,
        fatiaDano: danoTime ? eu.totalDamageDealtToChampions / danoTime : 0,
      });
    } catch { /* uma partida a menos não invalida o resumo */ }
    aoProgresso?.(++i, ids.length);
  }

  if (!linhas.length) return null;
  const n = linhas.length;
  const soma = (f) => linhas.reduce((s, l) => s + f(l), 0);
  const segundos = soma((l) => l.duracaoS);
  const k = soma((l) => l.kills), d = soma((l) => l.deaths), a = soma((l) => l.assists);

  const porCamp = new Map();
  for (const l of linhas) {
    const c = porCamp.get(l.campeao) ?? { campeao: l.campeao, championId: l.championId, jogos: 0, vitorias: 0, k: 0, d: 0, a: 0 };
    c.jogos++; c.vitorias += l.venci; c.k += l.kills; c.d += l.deaths; c.a += l.assists;
    porCamp.set(l.campeao, c);
  }
  const porRole = new Map();
  for (const l of linhas) if (l.role) porRole.set(l.role, (porRole.get(l.role) ?? 0) + 1);

  return {
    jogos: n,
    vitorias: soma((l) => l.venci),
    taxa: soma((l) => l.venci) / n,
    kda: d ? (k + a) / d : k + a,
    media: { k: k / n, d: d / n, a: a / n },
    csm: soma((l) => l.cs) / (segundos / 60),
    dpm: soma((l) => l.dano) / (segundos / 60),
    gpm: soma((l) => l.ouro) / (segundos / 60),
    vspm: soma((l) => l.visao) / (segundos / 60),
    participacao: soma((l) => l.participacao) / n,
    fatiaDano: soma((l) => l.fatiaDano) / n,
    duracaoMedia: segundos / n,
    campeoes: [...porCamp.values()].sort((x, y) => y.jogos - x.jogos).slice(0, 5)
      .map((c) => ({ ...c, taxa: c.vitorias / c.jogos, kda: c.d ? (c.k + c.a) / c.d : c.k + c.a })),
    roles: [...porRole.entries()].sort((x, y) => y[1] - x[1]).map(([role, jogos]) => ({ role, jogos, fatia: jogos / n })),
    ultimas: linhas.slice(0, 10).map((l) => ({
      campeao: l.campeao, championId: l.championId, role: l.role, venci: l.venci,
      kda: `${l.kills}/${l.deaths}/${l.assists}`, quando: l.quando, duracaoS: l.duracaoS,
    })),
  };
}

/**
 * Perfil completo de uma conta pela Riot. Cache de 30 min em disco; `forcar`
 * ignora. Nunca lança por dado faltando — só por conta inexistente ou chave.
 */
export async function perfilDeAmigo(riotConfig, { nome, tag }, { forcar = false, aoProgresso } = {}) {
  const cache = await lerCache(nome, tag);
  if (cache && !forcar && Date.now() - cache.em < VALIDADE) return { ...cache, doCache: true };

  if (!riotConfig?.apiKey) {
    if (cache) return { ...cache, doCache: true, desatualizado: true };
    throw new Error('ver amigos precisa de uma chave da Riot no config');
  }

  const riot = riotDe(riotConfig);
  let conta;
  try { conta = await riot.contaPorRiotId(nome, tag); }
  catch (erro) {
    if (cache) return { ...cache, doCache: true, desatualizado: true };
    throw new Error(/404/.test(erro.message) ? `não achei ${nome}#${tag} — confere o nome e a tag` : erro.message);
  }

  const [invocador, elos, maestria] = await Promise.all([
    riot.summonerPorPuuid(conta.puuid).catch(() => null),
    riot.elo(conta.puuid).catch(() => []),
    riot.maestriaTop(conta.puuid).catch(() => []),
  ]);

  const recente = await resumoRecente(riot, conta.puuid, { aoProgresso });

  const dados = {
    em: Date.now(),
    conta: { nome: conta.gameName, tag: conta.tagLine, puuid: conta.puuid },
    nivel: invocador?.summonerLevel ?? null,
    icone: invocador?.profileIconId ?? null,
    elos: (elos ?? []).map(arrumarElo).sort((a, b) => (a.chave === 'RANKED_SOLO_5x5' ? -1 : 1)),
    maestria: (maestria ?? []).slice(0, 5).map((m) => ({ championId: m.championId, nivel: m.championLevel, pontos: m.championPoints })),
    recente,
  };
  await gravarCache(nome, tag, dados);
  return { ...dados, doCache: false };
}
