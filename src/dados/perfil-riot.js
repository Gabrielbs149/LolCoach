import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pastaBase } from '../caminhos.js';

/**
 * Perfil da conta direto da Riot: elo, PDL, nível, ícone e maestria.
 *
 * É o que o banco local não tem — o histórico de partidas não sabe em que elo
 * você está. Tudo fica guardado em disco: com a chave vencida ou sem internet a
 * tela continua mostrando o último estado conhecido, com a data, em vez de
 * ficar vazia.
 */

// Um arquivo por conta: ele joga em mais de uma, e o perfil segue a que
// está logada no client.
const seguro = (s) => String(s ?? '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
const arquivo = (nome) => resolve(pastaBase(), 'dados', `perfil-riot-${seguro(nome)}.json`);
const VALIDADE_MS = 10 * 60 * 1000;   // elo não muda entre um F5 e outro

const memoria = new Map();   // nome da conta -> perfil

async function lerDisco(nome) {
  try { return JSON.parse(await readFile(arquivo(nome), 'utf8')); } catch { return null; }
}

async function gravarDisco(nome, dados) {
  try {
    await mkdir(dirname(arquivo(nome)), { recursive: true });
    await writeFile(arquivo(nome), JSON.stringify(dados), 'utf8');
  } catch { /* sem disco, segue só com memória */ }
}

const FILA_PT = {
  RANKED_SOLO_5x5: 'Ranqueada Solo/Duo',
  RANKED_FLEX_SR: 'Ranqueada Flex',
};

const TIER_PT = {
  IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro',
  PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante',
  MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante',
};

const ROMANO = { I: '1', II: '2', III: '3', IV: '4' };

// Acima de Mestre não existe divisão — escrever "Mestre 1" é errado.
const SEM_DIVISAO = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

function arrumarElo(e) {
  const tier = TIER_PT[e.tier] ?? e.tier;
  return {
    fila: FILA_PT[e.queueType] ?? e.queueType,
    chave: e.queueType,
    tier: e.tier,
    nome: SEM_DIVISAO.has(e.tier) ? tier : `${tier} ${ROMANO[e.rank] ?? e.rank}`,
    pdl: e.leaguePoints,
    vitorias: e.wins,
    derrotas: e.losses,
    jogos: e.wins + e.losses,
    taxa: e.wins + e.losses ? e.wins / (e.wins + e.losses) : 0,
    sequencia: e.hotStreak === true,
  };
}

/**
 * Busca tudo de uma vez. `forcar` ignora o cache de 10 minutos.
 * Nunca lança: se a Riot não responder, devolve o que estava em disco com
 * `desatualizado: true` — a tela precisa mostrar alguma coisa.
 */
export async function perfilDaRiot(riotConfig, { forcar = false } = {}) {
  const chave = riotConfig?.apiKey;
  const regiao = riotConfig?.regiao ?? 'br1';
  const rota = riotConfig?.rota ?? 'americas';
  const nome = riotConfig?.gameName;
  const tag = riotConfig?.tagLine;

  if (!memoria.has(nome)) memoria.set(nome, await lerDisco(nome));
  const guardado = memoria.get(nome);
  const fresco = guardado && Date.now() - (guardado.em ?? 0) < VALIDADE_MS;
  if (fresco && !forcar) return { ...guardado, desatualizado: false };

  if (!chave || !nome) {
    return guardado ? { ...guardado, desatualizado: true } : null;
  }

  const pedir = async (host, caminho) => {
    const r = await fetch(`https://${host}.api.riotgames.com${caminho}`, {
      headers: { 'X-Riot-Token': chave },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${caminho.split('?')[0]}`);
    return r.json();
  };

  try {
    const conta = await pedir(rota, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(nome)}/${encodeURIComponent(tag)}`);

    // As três seguintes são independentes: se a maestria falhar, o elo ainda vem.
    const [invocador, elos, maestria] = await Promise.all([
      pedir(regiao, `/lol/summoner/v4/summoners/by-puuid/${conta.puuid}`).catch(() => null),
      pedir(regiao, `/lol/league/v4/entries/by-puuid/${conta.puuid}`).catch(() => []),
      pedir(regiao, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${conta.puuid}/top?count=8`).catch(() => []),
    ]);

    const dados = {
      em: Date.now(),
      conta: { nome: conta.gameName, tag: conta.tagLine, puuid: conta.puuid },
      nivel: invocador?.summonerLevel ?? null,
      icone: invocador?.profileIconId ?? null,
      elos: (elos ?? []).map(arrumarElo)
        // Solo primeiro: é a fila que ele leva a sério.
        .sort((a, b) => (a.chave === 'RANKED_SOLO_5x5' ? -1 : b.chave === 'RANKED_SOLO_5x5' ? 1 : 0)),
      maestria: (maestria ?? []).map((m) => ({
        championId: m.championId,
        nivel: m.championLevel,
        pontos: m.championPoints,
        ultimaVez: m.lastPlayTime,
      })),
    };

    memoria.set(nome, dados);
    await gravarDisco(nome, dados);
    return { ...dados, desatualizado: false };
  } catch (erro) {
    // Chave vencida é o caso mais comum aqui, e não pode apagar a tela.
    if (guardado) return { ...guardado, desatualizado: true, erro: erro.message };
    return { erro: erro.message, elos: [], maestria: [] };
  }
}
