/**
 * Qual mapa e qual agente ele pegou — lido do cliente da Riot que roda na própria máquina.
 *
 * Como funciona: o Riot Client escreve um `lockfile` com porta e senha de uma API local em
 * 127.0.0.1. É a mesma ideia da API do League que o app já usa. Dali sai a PRESENÇA do
 * jogador, que traz o mapa da partida e em que ponto do fluxo ele está (menu, seleção de
 * agente, em jogo). O agente escolhido não vem na presença: pra isso é preciso perguntar ao
 * serviço de pré-partida da Riot, com os tokens que o próprio cliente local entrega.
 *
 * LIMITES QUE EU ME IMPUS AQUI:
 *  - nada é gravado em disco e nada sai da máquina: os tokens só vão pra 127.0.0.1 e pros
 *    próprios servidores da Riot, e nunca aparecem em registro;
 *  - só LEITURA. Nada é escrito no cliente, nada é injetado no jogo, nada é desenhado por
 *    cima dele — o Vanguard é anticheat de kernel e sobreposição é o que ele trata como
 *    trapaça. Isso aqui lê o que já está na tela dele: o mapa e o agente que ele escolheu.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request as pedirHttps, Agent as AgenteHttps } from 'node:https';

const LOCKFILE = () => resolve(
  process.env.LOCALAPPDATA ?? 'C:/Users/Default/AppData/Local',
  'Riot Games', 'Riot Client', 'Config', 'lockfile',
);

/**
 * O cliente da Riot usa certificado próprio, então a verificação precisa ser afrouxada —
 * mas SÓ nesta conexão. A primeira versão disto mexia em NODE_TLS_REJECT_UNAUTHORIZED, que
 * vale pro processo inteiro: enquanto estivesse ligado, qualquer outra chamada HTTPS do app
 * (Riot, YouTube) deixaria de conferir certificado.
 *
 * A segunda versão trocou aquilo por um dispatcher do pacote `undici`, e era aí que estava a
 * armadilha: `undici` existe em node_modules como dependência TRANSITIVA, então em
 * desenvolvimento o `import` funciona e tudo parece certo. Só que ele não está declarado no
 * package.json, e o electron-builder só empacota dependência declarada — no app INSTALADO
 * o pacote simplesmente não existe (conferido: `asar list` devolve zero linha com undici).
 * Lá o import falhava, `pedir` devolvia null antes de qualquer requisição e o Valorant
 * aparecia como fechado mesmo estando aberto.
 *
 * Medido com o jogo rodando, o mesmo código:
 *   - rodando do projeto (undici resolve):  { ligado: true,  estado: null }
 *   - no app empacotado (undici ausente):   { ligado: false }
 * Ou seja: o bug só aparecia onde importa, e qualquer teste em desenvolvimento dizia que
 * estava tudo bem. Por isso aqui não se usa pacote que não esteja no package.json.
 *
 * `node:https` vem junto com o Node e com o Electron, não precisa declarar nada, e o
 * afrouxamento fica preso a este agente — nenhuma outra chamada do app o usa.
 */
const agenteLocal = new AgenteHttps({ rejectUnauthorized: false, keepAlive: false });

async function lerLockfile() {
  try {
    const txt = await readFile(LOCKFILE(), 'utf8');
    const [, , porta, senha, protocolo] = txt.trim().split(':');
    if (!porta || !senha) return null;
    return { porta, senha, protocolo: protocolo || 'https' };
  } catch { return null; }
}

const pedir = (lock, caminho, extra = {}) => new Promise((pronto) => {
  if (lock.protocolo !== 'https') return pronto(null);   // o cliente só serve https aqui
  const req = pedirHttps(`https://127.0.0.1:${lock.porta}${caminho}`, {
    agent: agenteLocal,
    timeout: 4000,
    headers: { Authorization: 'Basic ' + Buffer.from(`riot:${lock.senha}`).toString('base64'), ...extra },
  }, (res) => {
    let txt = '';
    res.setEncoding('utf8');
    res.on('data', (p) => { txt += p; });
    res.on('end', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return pronto(null);
      try { pronto(JSON.parse(txt)); } catch { pronto(null); }
    });
  });
  req.on('timeout', () => { req.destroy(); pronto(null); });
  req.on('error', () => pronto(null));
  req.end();
});

/**
 * Onde perguntar pelo agente. Duas pegadinhas, as duas conferidas com o jogo aberto:
 *  - a região que o chat devolve vem com número ("br1") e o pvp.net não aceita assim;
 *  - o shard NÃO é igual à região: Brasil e LATAM jogam no shard "na". Conferi por DNS —
 *    glz-br-1.br.a.pvp.net não resolve, glz-br-1.na.a.pvp.net resolve.
 */
const SHARD = { na: 'na', latam: 'na', br: 'na', eu: 'eu', ap: 'ap', kr: 'kr' };

/**
 * O glz EXIGE `X-Riot-ClientVersion`. Sem ele a resposta é 400 INVALID_HEADERS ("Bad headers
 * used for request") e a busca do agente nunca chega a lugar nenhum — era o que estava
 * acontecendo. Comprovado com o jogo aberto, a mesma chamada:
 *   sem o cabeçalho -> 400 INVALID_HEADERS
 *   com o cabeçalho -> 404 (resposta certa pra quem está no menu, sem pré-partida)
 *
 * A string muda a cada patch do Valorant, então vem da valorant-api (a mesma que já serve
 * mapas e agentes) e fica guardada por 6 h. Se a busca falhar, segue sem — vai dar 400, mas
 * não é pior do que não tentar, e na próxima volta tenta de novo.
 */
let versaoCache = { valor: null, quando: 0 };
async function versaoDoCliente() {
  if (versaoCache.valor && Date.now() - versaoCache.quando < 6 * 60 * 60 * 1000) return versaoCache.valor;
  try {
    const r = await fetch('https://valorant-api.com/v1/version', { signal: AbortSignal.timeout(6000) });
    const j = r.ok ? await r.json() : null;
    const v = j?.data?.riotClientVersion ?? null;
    if (v) versaoCache = { valor: v, quando: Date.now() };
    return v;
  } catch { return versaoCache.valor; }
}

async function regiaoEShard(lock) {
  // /riotclient/region-locale devolve "BR" limpo; o chat devolve "br1"
  const local = await pedir(lock, '/riotclient/region-locale');
  const sessao = await pedir(lock, '/chat/v1/session');
  const regiao = String(local?.region ?? sessao?.region ?? 'na').toLowerCase().replace(/\d+$/, '') || 'na';
  return { regiao, shard: String(SHARD[regiao] ?? sessao?.shard ?? regiao).toLowerCase(), puuid: sessao?.puuid ?? null };
}

/* ------------------------------------------------------------------ mapa */

/** O caminho interno do mapa vira o nome que a gente usa ("/Game/Maps/Triad/Triad" → Bind). */
const MAPAS = {
  ascent: 'Ascent', triad: 'Haven', duality: 'Bind', bonsai: 'Split', port: 'Icebox',
  foxtrot: 'Breeze', canyon: 'Fracture', pitt: 'Pearl', jam: 'Lotus', juliett: 'Sunset',
  infinity: 'Abyss', rook: 'Summit', hurm: 'Corrode',
};
export function mapaPeloCaminho(caminho) {
  const p = String(caminho ?? '').toLowerCase();
  for (const [chave, nome] of Object.entries(MAPAS)) if (p.includes(`/${chave}`)) return nome;
  return null;
}

/** Em que ponto do jogo ele está, em palavra nossa. */
const ESTADOS = { MENUS: 'menu', PREGAME: 'selecao', INGAME: 'jogando' };

/**
 * Onde estão o estado e o mapa dentro do blob de presença.
 *
 * Isto é função separada e exportada DE PROPÓSITO: o formato já mudou uma vez sem aviso e
 * quebrou a detecção inteira em silêncio — `sessionLoopState` e `matchMap` saíram da raiz do
 * blob e foram pra dentro de `matchPresenceData`. Como o resto do caminho só dá pra exercitar
 * com o jogo aberto, nenhum teste pegava isso. Aqui dá, e os testes cobrem os dois formatos.
 *
 * Ordem de procura: o lugar novo, depois a raiz (formato antigo), e por último o que o dono
 * do grupo reporta — que é o que aparece quando a partida é do grupo e não sua.
 */
export function lerPresenca(blob) {
  const md = blob?.matchPresenceData ?? {};
  const pd = blob?.partyPresenceData ?? {};
  const laco = md.sessionLoopState ?? blob?.sessionLoopState ?? pd.partyOwnerSessionLoopState ?? null;
  const ondeEstaOMapa = md.matchMap ?? blob?.matchMap ?? pd.partyOwnerMatchMap ?? null;
  return {
    estado: ESTADOS[laco] ?? null,
    mapa: mapaPeloCaminho(ondeEstaOMapa),
    fila: md.queueId ?? blob?.queueId ?? null,
  };
}

/* ------------------------------------------------------------------ agente */

/**
 * O agente escolhido. S\u00f3 existe durante a sele\u00e7\u00e3o e a partida, e vem do servi\u00e7o de
 * pr\u00e9-partida da Riot — por isso precisa dos tokens que o cliente local entrega.
 */
async function agenteEscolhido(lock, estado) {
  if (estado !== 'selecao' && estado !== 'jogando') return null;
  const ent = await pedir(lock, '/entitlements/v1/token');
  const { regiao, shard, puuid } = await regiaoEShard(lock);
  if (!ent?.accessToken || !ent?.token || !puuid) return null;

  const sessao = { puuid };
  const versao = await versaoDoCliente();
  const cab = {
    Authorization: `Bearer ${ent.accessToken}`,
    'X-Riot-Entitlements-JWT': ent.token,
    'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
    ...(versao ? { 'X-Riot-ClientVersion': versao } : {}),
  };
  const glz = `https://glz-${regiao}-1.${shard}.a.pvp.net`;
  const buscar = async (u) => {
    try {
      const r = await fetch(u, { headers: cab, signal: AbortSignal.timeout(5000) });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };

  const jogador = await buscar(`${glz}/pregame/v1/players/${sessao.puuid}`)
    ?? await buscar(`${glz}/core-game/v1/players/${sessao.puuid}`);
  const idPartida = jogador?.MatchID;
  if (!idPartida) return null;

  const partida = await buscar(`${glz}/pregame/v1/matches/${idPartida}`)
    ?? await buscar(`${glz}/core-game/v1/matches/${idPartida}`);
  const meu = (partida?.AllyTeam?.Players ?? partida?.Players ?? []).find((j) => j.Subject === sessao.puuid);
  return meu?.CharacterID || null;
}

/* ------------------------------------------------------------------ tudo junto */

/**
 * O que está acontecendo no Valorant agora. Devolve sempre um objeto; quando o jogo está
 * fechado, vem tudo nulo e `ligado: false` — nunca estoura, porque isso roda em laço.
 */
export async function situacaoDoValorant() {
  const lock = await lerLockfile();
  if (!lock) return { ligado: false, estado: null, mapa: null, agenteId: null };

  const presencas = await pedir(lock, '/chat/v4/presences');
  const minha = (presencas?.presences ?? []).find((p) => p.product === 'valorant' && p.private);
  if (!minha) return { ligado: false, estado: null, mapa: null, agenteId: null };

  let blob = null;
  try { blob = JSON.parse(Buffer.from(minha.private, 'base64').toString('utf8')); } catch { /* formato novo */ }
  if (!blob) return { ligado: true, estado: null, mapa: null, agenteId: null };

  const { estado, mapa, fila } = lerPresenca(blob);
  const agenteId = await agenteEscolhido(lock, estado).catch(() => null);
  return { ligado: true, estado, mapa, agenteId, fila };
}
