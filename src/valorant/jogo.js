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
/* A FALHA também espera. Antes só o SUCESSO era guardado: com a valorant-api fora do ar,
 * cada volta do laço refazia a busca — uma ida à internet de 6 em 6 segundos, com 6 s de
 * paciência, no meio da partida dele. É o mesmo erro que encheu 43% do registro na
 * atualização: insistir no mesmo ritmo numa coisa que não está respondendo. */
let versaoEspera = 0;
const ESPERA_VERSAO = 5 * 60 * 1000;
async function versaoDoCliente() {
  if (versaoCache.valor && Date.now() - versaoCache.quando < 6 * 60 * 60 * 1000) return versaoCache.valor;
  if (Date.now() < versaoEspera) return versaoCache.valor;
  try {
    const r = await fetch('https://valorant-api.com/v1/version', { signal: AbortSignal.timeout(6000) });
    const j = r.ok ? await r.json() : null;
    const v = j?.data?.riotClientVersion ?? null;
    if (v) { versaoCache = { valor: v, quando: Date.now() }; versaoEspera = 0; }
    else versaoEspera = Date.now() + ESPERA_VERSAO;
    return v;
  } catch {
    versaoEspera = Date.now() + ESPERA_VERSAO;
    return versaoCache.valor;
  }
}

/* Região e shard não mudam enquanto o cliente está aberto — são duas perguntas ao cliente
 * local a cada volta do laço, de 6 em 6 segundos, pra sempre a mesma resposta. Fica
 * guardado por lockfile: trocou de conta ou reabriu o cliente, o lockfile muda e a conta
 * é refeita. */
let shardCache = { chave: null, valor: null };
async function regiaoEShard(lock) {
  const chave = `${lock?.porta ?? ''}:${lock?.senha ?? ''}`;
  if (shardCache.chave === chave && shardCache.valor) return shardCache.valor;
  // /riotclient/region-locale devolve "BR" limpo; o chat devolve "br1"
  const local = await pedir(lock, '/riotclient/region-locale');
  const sessao = await pedir(lock, '/chat/v1/session');
  const regiao = String(local?.region ?? sessao?.region ?? 'na').toLowerCase().replace(/\d+$/, '') || 'na';
  const valor = { regiao, shard: String(SHARD[regiao] ?? sessao?.shard ?? regiao).toLowerCase(), puuid: sessao?.puuid ?? null };
  // só guarda quando veio completo: resposta pela metade não vira verdade permanente
  if (valor.puuid) shardCache = { chave, valor };
  return valor;
}

/* ------------------------------------------------------------------ mapa */

/**
 * O caminho interno do mapa vira o nome que a gente usa ("/Game/Maps/Triad/Triad" → Bind).
 *
 * A TABELA À MÃO ESTAVA ERRADA, e errada do pior jeito: em vez de não achar o mapa, ela
 * achava o mapa de OUTRO. Conferido contra a lista oficial (valorant-api, a mesma que serve
 * mapa e agente pra aba de lineups):
 *  - `rook` era "Summit". /Game/Maps/Rook/Rook é CORRODE. Jogando Corrode, o app mostrava
 *    lineup de Summit — mapa inteiro errado, não um canto errado.
 *  - "Summit" é `plummet`, e não estava na tabela: jogando Summit, o app não achava mapa
 *    nenhum e a aba ficava parada no último que ele tinha escolhido.
 *  - `hurm` era "Corrode". HURM é o prefixo dos mapas de Deathmatch (District, Kasbah,
 *    Drift, Glitch, Piazza). Deathmatch virava Corrode.
 * E a busca era por `includes('/' + chave)`, que casa pedaço de caminho: "/HURM/HURM_Alley"
 * casava `hurm` em qualquer posição. Agora o codinome sai do lugar certo do caminho.
 *
 * Mas tabela à mão envelhece — esta envelheceu em dois mapas. Então quem manda, quando dá, é
 * o CATÁLOGO: o valorant-api entrega o `mapUrl` de cada mapa junto com o nome, por patch, e
 * é isso que `mapas` traz. A tabela fica só pra quando o catálogo não chegou (primeira
 * execução sem internet), e com o catálogo em mãos um caminho que não casa com nenhum mapa
 * de partida é mapa de Deathmatch, Range ou modo novo: aí é null, de propósito.
 */
const MAPAS = {
  ascent: 'Ascent', bonsai: 'Split', canyon: 'Fracture', duality: 'Bind', foxtrot: 'Breeze',
  infinity: 'Abyss', jam: 'Lotus', juliett: 'Sunset', pitt: 'Pearl', plummet: 'Summit',
  port: 'Icebox', rook: 'Corrode', triad: 'Haven',
};
const CODINOME = /\/game\/maps\/([^/]+)/;
export function mapaPeloCaminho(caminho, mapas = null) {
  const p = String(caminho ?? '').trim().toLowerCase();
  if (!p) return null;
  const doCatalogo = (mapas ?? []).filter((m) => m?.nome && m?.caminho);
  for (const m of doCatalogo) {
    const c = String(m.caminho).toLowerCase();
    if (p === c || p.startsWith(`${c}/`)) return m.nome;
  }
  // catálogo em mãos e nenhum casou: não é mapa de partida (Deathmatch, Range, modo novo)
  if (doCatalogo.length) return null;
  return MAPAS[p.match(CODINOME)?.[1] ?? ''] ?? null;
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
 *
 * Duas regras sobre o mapa, as duas pra ele não ver o mapa de outra partida:
 *  - o mapa do DONO DO GRUPO só vale quando o estado também é dele. Amigo que convida pro
 *    grupo no meio de uma partida publica `partyOwnerMatchMap` daquela partida; ele está no
 *    menu, e o app trocava a aba de lineups pro mapa do amigo.
 *  - no MENU não existe mapa. O campo costuma vir vazio, mas quando vem sobrando é mapa de
 *    partida que acabou, e dizer "você está na Bind" no menu é mentira.
 * Vazio conta como ausente (`||`, não `??`): `matchMap` vem como "" fora de partida, e com
 * `??` o "" era um valor válido que bloqueava o resto da procura.
 */
/* EM FILA é um estado que o `sessionLoopState` não conta: procurando partida, ele continua
 * em MENUS. Quem conta é o `partyState`, que vira MATCHMAKING.
 *
 * Isso importa de verdade: a instalação de uma atualização REINICIA o app, e o registro já
 * prometia esperar "fila, seleção ou partida" — mas o código só sabia ver seleção e
 * partida. Reiniciar no meio de uma fila de três minutos custa a fila inteira.
 *
 * Vem como campo SEPARADO, e não como um `estado: 'fila'` novo, de propósito: assim tudo
 * que já compara com 'menu'/'selecao'/'jogando' continua funcionando igual. */
function emFilaAgora(blob) {
  const pd = blob?.partyPresenceData ?? {};
  const estado = String(pd.partyState ?? blob?.partyState ?? '').toUpperCase();
  return estado === 'MATCHMAKING' || estado === 'MATCHMADE_GAME_STARTING';
}

export function lerPresenca(blob, mapas = null) {
  const md = blob?.matchPresenceData ?? {};
  const pd = blob?.partyPresenceData ?? {};
  const meuLaco = md.sessionLoopState || blob?.sessionLoopState || null;
  const laco = meuLaco || pd.partyOwnerSessionLoopState || null;
  const ondeEstaOMapa = md.matchMap || blob?.matchMap || (meuLaco ? null : pd.partyOwnerMatchMap) || null;
  const estado = ESTADOS[laco] ?? null;
  return {
    estado,
    emFila: emFilaAgora(blob),
    mapa: estado === 'menu' ? null : mapaPeloCaminho(ondeEstaOMapa, mapas),
    fila: md.queueId ?? blob?.queueId ?? null,
  };
}

/* ---------------------------------------------------- qual presença é a dele
 *
 * `/chat/v4/presences` NÃO devolve só a dele: devolve a lista inteira — a dele e a de cada
 * amigo online, cada uma com o seu próprio blob de partida. O código daqui pegava a
 * primeira de Valorant que aparecesse, sem conferir de quem era, e a ordem da lista muda
 * sozinha conforme os amigos entram, saem e trocam de estado.
 *
 * Foi isso que trocou o mapa no meio da partida dele: estava jogando uma Haven e virou
 * Sunset, que era a partida de um amigo. Conferido na máquina dele, com o Valorant
 * fechado: das 3 presenças, a PRIMEIRA com blob é de um amigo, e a dele é a última.
 *
 * E não era só o mapa. Essa mesma leitura alimenta três coisas: o mapa/agente que a aba de
 * lineups segue, o gatilho da segunda tela, e a trava que impede o app de se atualizar no
 * meio de uma partida. Com a presença errada, a partida de um amigo abria a segunda tela
 * dele e segurava a atualização dele.
 *
 * Sem saber o próprio puuid só dá pra afirmar quando existe UMA candidata: chutar entre
 * várias é exatamente o que causava o bug.
 */
export function presencaDele(presencas, puuid) {
  const todas = (presencas?.presences ?? []).filter((p) => p.product === 'valorant' && p.private);
  if (puuid) return todas.find((p) => p.puuid === puuid) ?? null;
  return todas.length === 1 ? todas[0] : null;
}

/* ------------------------------------------------------------------ agente */

/**
 * O agente escolhido. S\u00f3 existe durante a sele\u00e7\u00e3o e a partida, e vem do servi\u00e7o de
 * pr\u00e9-partida da Riot — por isso precisa dos tokens que o cliente local entrega.
 */
async function agenteEscolhido(lock, estado, meuPuuid = null) {
  if (estado !== 'selecao' && estado !== 'jogando') return null;
  const ent = await pedir(lock, '/entitlements/v1/token');
  const { regiao, shard, puuid: doChat } = await regiaoEShard(lock);
  const puuid = meuPuuid ?? doChat;
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

  /* A ORDEM SAI DO ESTADO, não é mais fixa.
   *
   * `pregame` é a seleção de agentes e `core-game` é a partida rodando; um responde 404
   * enquanto o outro responde. Perguntando sempre pro pregame primeiro, a partida inteira
   * era DUAS perguntas jogadas fora a cada volta do laço — e o laço roda de 6 em 6
   * segundos. Numa competitiva de 40 min isso dá ~800 pedidos à Riot pra nada, cada um
   * com 5 s de paciência pendurados.
   *
   * O estado já estava aqui, de parâmetro, só não era usado. A ordem inversa fica de
   * reserva porque o estado pode estar meio passo atrasado na virada. */
  const ordem = estado === 'jogando' ? ['core-game', 'pregame'] : ['pregame', 'core-game'];
  const jogador = await buscar(`${glz}/${ordem[0]}/v1/players/${sessao.puuid}`)
    ?? await buscar(`${glz}/${ordem[1]}/v1/players/${sessao.puuid}`);
  const idPartida = jogador?.MatchID;
  if (!idPartida) return null;

  const partida = await buscar(`${glz}/${ordem[0]}/v1/matches/${idPartida}`)
    ?? await buscar(`${glz}/${ordem[1]}/v1/matches/${idPartida}`);
  const meu = (partida?.AllyTeam?.Players ?? partida?.Players ?? []).find((j) => j.Subject === sessao.puuid);
  return meu?.CharacterID || null;
}

/* ------------------------------------------------------------------ tudo junto */

/**
 * O que está acontecendo no Valorant agora. Devolve sempre um objeto; quando o jogo está
 * fechado, vem tudo nulo e `ligado: false` — nunca estoura, porque isso roda em laço.
 */
export async function situacaoDoValorant({ mapas = null } = {}) {
  const lock = await lerLockfile();
  if (!lock) return { ligado: false, estado: null, emFila: false, mapa: null, agenteId: null };

  // a sessão vem junto só pra saber qual das presenças é a dele (ver presencaDele)
  const [sessao, presencas] = await Promise.all([
    pedir(lock, '/chat/v1/session'),
    pedir(lock, '/chat/v4/presences'),
  ]);
  const minha = presencaDele(presencas, sessao?.puuid ?? null);
  if (!minha) return { ligado: false, estado: null, emFila: false, mapa: null, agenteId: null };

  let blob = null;
  try { blob = JSON.parse(Buffer.from(minha.private, 'base64').toString('utf8')); } catch { /* formato novo */ }
  if (!blob) return { ligado: true, estado: null, emFila: false, mapa: null, agenteId: null };

  const { estado, emFila, mapa, fila } = lerPresenca(blob, mapas);
  const agenteId = await agenteEscolhido(lock, estado, sessao?.puuid ?? null).catch(() => null);
  return { ligado: true, estado, emFila, mapa, agenteId, fila };
}
