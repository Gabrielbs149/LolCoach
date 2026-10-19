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

const LOCKFILE = () => resolve(
  process.env.LOCALAPPDATA ?? 'C:/Users/Default/AppData/Local',
  'Riot Games', 'Riot Client', 'Config', 'lockfile',
);

/**
 * O cliente da Riot usa certificado próprio, então a verificação precisa ser afrouxada —
 * mas SÓ nesta conexão. A primeira versão disto mexia em NODE_TLS_REJECT_UNAUTHORIZED, que
 * vale pro processo inteiro: enquanto estivesse ligado, qualquer outra chamada HTTPS do app
 * (Riot, YouTube) deixaria de conferir certificado. Com um dispatcher próprio o buraco fica
 * restrito ao 127.0.0.1.
 */
let dispatcherLocal = null;
async function doCliente() {
  if (dispatcherLocal !== null) return dispatcherLocal;
  try {
    const { Agent } = await import('undici');
    dispatcherLocal = new Agent({ connect: { rejectUnauthorized: false } });
  } catch { dispatcherLocal = false; }     // sem undici: não dá pra isolar, então não tenta
  return dispatcherLocal;
}

async function lerLockfile() {
  try {
    const txt = await readFile(LOCKFILE(), 'utf8');
    const [, , porta, senha, protocolo] = txt.trim().split(':');
    if (!porta || !senha) return null;
    return { porta, senha, protocolo: protocolo || 'https' };
  } catch { return null; }
}

const pedir = async (lock, caminho, extra = {}) => {
  const dispatcher = await doCliente();
  if (dispatcher === false) return null;
  try {
    const r = await fetch(`${lock.protocolo}://127.0.0.1:${lock.porta}${caminho}`, {
      signal: AbortSignal.timeout(4000),
      dispatcher,
      headers: { Authorization: 'Basic ' + Buffer.from(`riot:${lock.senha}`).toString('base64'), ...extra },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};

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

/* ------------------------------------------------------------------ agente */

/**
 * O agente escolhido. S\u00f3 existe durante a sele\u00e7\u00e3o e a partida, e vem do servi\u00e7o de
 * pr\u00e9-partida da Riot — por isso precisa dos tokens que o cliente local entrega.
 */
async function agenteEscolhido(lock, estado) {
  if (estado !== 'selecao' && estado !== 'jogando') return null;
  const ent = await pedir(lock, '/entitlements/v1/token');
  const sessao = await pedir(lock, '/chat/v1/session');
  if (!ent?.accessToken || !ent?.token || !sessao?.puuid) return null;

  const regiao = (sessao.region || '').toLowerCase() || 'na';
  const shard = (sessao.shard || regiao).toLowerCase();
  const cab = {
    Authorization: `Bearer ${ent.accessToken}`,
    'X-Riot-Entitlements-JWT': ent.token,
    'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
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

  const estado = ESTADOS[blob.sessionLoopState] ?? null;
  const mapa = mapaPeloCaminho(blob.matchMap);
  const agenteId = await agenteEscolhido(lock, estado).catch(() => null);
  return { ligado: true, estado, mapa, agenteId, fila: blob.queueId ?? null };
}
