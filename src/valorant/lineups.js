/**
 * Lineups de Valorant.
 *
 * Por que vídeo e não uma base de dados: não existe fonte aberta de lineup. Procurei —
 * valorant-api.com tem agente, mapa e habilidade (assets oficiais, API pública sem chave),
 * mas lineup em si só existe em vídeo de criador. Sites como o strats.gg estão atrás de
 * desafio de bot do Cloudflare e, de todo jeito, copiar a biblioteca deles pra cá seria
 * redistribuir conteúdo dos outros num repositório público.
 *
 * Então: o app ACHA o vídeo (busca por mapa + agente + habilidade), ele salva os que
 * gostou com o minuto certo e a marcação de pulo, e na hora de jogar vê isso na segunda
 * tela. O vídeo toca pelo player oficial do YouTube — o criador leva a view.
 *
 * Nada aqui toca no processo do Valorant. Não há leitura de memória nem sobreposição em
 * cima do jogo: o Vanguard é anticheat de kernel e trata overlay como trapaça.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pastaBase } from '../caminhos.js';

const pasta = () => resolve(pastaBase(), 'dados', 'valorant');
const arqCatalogo = () => resolve(pasta(), 'catalogo.json');
const arqSalvas = () => resolve(pasta(), 'lineups.json');
const arqBusca = (chave) => resolve(pasta(), 'buscas', `${chave}.json`);

const garantirPasta = () => mkdir(pasta(), { recursive: true }).catch(() => {});
const garantirBuscas = () => mkdir(resolve(pasta(), 'buscas'), { recursive: true }).catch(() => {});
const lerJson = async (caminho, reserva) => { try { return JSON.parse(await readFile(caminho, 'utf8')); } catch { return reserva; } };
const gravarJson = async (caminho, v) => { await garantirPasta(); await writeFile(caminho, JSON.stringify(v, null, 2), 'utf8'); };

const buscarJson = async (url, ms = 12000) => {
  const corta = AbortSignal.timeout(ms);
  const r = await fetch(url, { signal: corta, headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/* ------------------------------------------------------------------ catálogo */

/** Habilidade que faz sentido ter lineup: as que você joga longe. O resto é corpo a corpo. */
const SLOT_UTIL = new Set(['Ability1', 'Ability2', 'Grenade', 'Ultimate']);
const VALIDADE_CATALOGO = 7 * 24 * 60 * 60 * 1000;   // o jogo muda de patch, mas não toda hora
/**
 * Versão do FORMATO do catálogo guardado. Sobe sempre que o que a gente guarda muda de
 * forma. Sem isso, quem já tinha cache antigo ficava com ele por 7 dias: foi o que
 * aconteceu quando os callouts entraram — o mapa abria sem nenhum pino porque o catálogo
 * em disco tinha só nome/ícone/planta e a validade por idade não notava a diferença.
 */
const FORMATO_CATALOGO = 3;

/**
 * Mapas e agentes oficiais, do valorant-api.com (público, sem chave, atualizado por patch).
 * Fica em disco: assim a aba abre sem internet e não bate na API a cada clique.
 */
export async function catalogo({ forcar = false } = {}) {
  const guardado = await lerJson(arqCatalogo(), null);
  const serve = guardado?.formato === FORMATO_CATALOGO && guardado.mapas?.length;
  if (!forcar && serve && guardado.em && Date.now() - guardado.em < VALIDADE_CATALOGO) return guardado;

  try {
    // em pt-BR pra mostrar, em en-US pra buscar: vídeo de lineup é quase todo em inglês,
    // e procurar por "Nuvem Venenosa" acha muito menos que por "Poison Cloud".
    const [m, a, aEn, mEn] = await Promise.all([
      buscarJson('https://valorant-api.com/v1/maps?language=pt-BR'),
      buscarJson('https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=pt-BR'),
      buscarJson('https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=en-US').catch(() => ({ data: [] })),
      buscarJson('https://valorant-api.com/v1/maps?language=en-US').catch(() => ({ data: [] })),
    ]);
    const emIngles = new Map((aEn.data ?? []).map((x) => [x.uuid, x]));
    // callout em INGLÊS: ele é casado contra nome de capítulo de vídeo, que é em inglês.
    // Com os de pt-BR, "A Lobby" nunca casava com "A Saguão" e 93 de 96 lineups caíam no
    // palpite pelo site. O nome do mapa na tela segue em pt-BR.
    const mapaEn = new Map((mEn.data ?? []).map((x) => [x.uuid, x]));
    const mapas = (m.data ?? [])
      .filter((x) => x.displayName && x.tacticalDescription)    // só mapa de partida: tira Campo de Treino e afins
      .map((x) => ({
        nome: x.displayName,
        icone: x.listViewIcon ?? x.splash ?? null,
        arte: x.splash ?? x.listViewIcon ?? null,      // a arte grande, pro seletor em grade
        planta: x.displayIcon ?? null,
        callouts: pontosDoMapa(mapaEn.get(x.uuid) ?? x),
      }))
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
    const agentes = (a.data ?? [])
      .map((x) => {
        const en = emIngles.get(x.uuid);
        const porSlot = new Map((en?.abilities ?? []).map((h) => [h.slot, h.displayName]));
        return {
          nome: x.displayName,
          icone: x.displayIcon ?? null,
          funcao: x.role?.displayName ?? null,
          habilidades: (x.abilities ?? []).filter((h) => SLOT_UTIL.has(h.slot) && h.displayName)
            .map((h) => ({ nome: h.displayName, busca: porSlot.get(h.slot) ?? h.displayName, icone: h.displayIcon ?? null, slot: h.slot })),
        };
      })
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
    if (!mapas.length || !agentes.length) throw new Error('catálogo veio vazio');
    const novo = { em: Date.now(), formato: FORMATO_CATALOGO, mapas, agentes };
    await gravarJson(arqCatalogo(), novo);
    return novo;
  } catch (e) {
    // sem internet: vale mais o catálogo velho do que uma aba quebrada
    if (serve) return { ...guardado, aviso: 'catálogo antigo: não consegui atualizar agora' };
    return { em: 0, mapas: [], agentes: [], aviso: `não consegui buscar mapas e agentes: ${e.message}` };
  }
}

/* ------------------------------------------------------- pontos do mapa */

/**
 * Os callouts do mapa ("A Lobby", "B Teleporter", "Top Mid") com a posição deles na
 * planta oficial, em 0..1. A Riot entrega a posição em coordenada de mundo e os fatores
 * de conversão junto; o x e o y entram TROCADOS na planta, que é como o jogo guarda.
 * É isso que deixa a lineup virar um pino no mapa em vez de uma linha numa lista.
 */
export function pontosDoMapa(mapa) {
  const { xMultiplier: xm, yMultiplier: ym, xScalarToAdd: xa, yScalarToAdd: ya } = mapa ?? {};
  if (![xm, ym, xa, ya].every((n) => typeof n === 'number')) return [];
  const fora = [];
  for (const c of mapa.callouts ?? []) {
    const l = c.location; if (!l) continue;
    const x = l.y * xm + xa, y = l.x * ym + ya;
    if (!(x >= -0.1 && x <= 1.1 && y >= -0.1 && y <= 1.1)) continue;
    const grande = String(c.superRegionName ?? '').trim();
    const regiao = String(c.regionName ?? '').trim();
    if (!regiao) continue;
    fora.push({
      nome: grande && grande !== regiao ? `${grande} ${regiao}` : regiao,
      regiao, grande,
      site: ['A', 'B', 'C'].includes(grande) ? grande : /mid/i.test(grande) || /mid/i.test(regiao) ? 'Mid' : null,
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
    });
  }
  return fora;
}

const semAcento = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * De que ponto do mapa fala o nome da lineup. Casa o nome do capítulo contra os callouts
 * do mapa, do mais específico pro menos: "B default from B Teleporter" acha "B Teleporter"
 * antes de "Teleporter", senão uma lineup do B cairia no teleporter do A.
 */
export function pontoDaLineup(nome, callouts = [], site = null) {
  const t = ` ${semAcento(nome).replace(/[^a-z0-9]+/g, ' ')} `;
  const contem = (alvo) => t.includes(` ${semAcento(alvo).replace(/[^a-z0-9]+/g, ' ').trim()} `);
  // 1. nome completo do callout ("A Lobby") — o mais específico
  const completos = callouts.filter((c) => c.nome !== c.regiao && contem(c.nome))
    .sort((a, b) => b.nome.length - a.nome.length);
  if (completos.length) return completos[0];
  // 2. só a região ("Lobby"), mas dentro do site que a lineup já disse ser
  const soRegiao = callouts.filter((c) => contem(c.regiao)).sort((a, b) => b.regiao.length - a.regiao.length);
  const noSite = site ? soRegiao.find((c) => c.site === site) : null;
  if (noSite) return noSite;
  if (soRegiao.length === 1) return soRegiao[0];
  // 3. nada de específico: o centro do site, se a gente souber qual é
  if (site) {
    const doSite = callouts.filter((c) => c.site === site);
    const alvo = doSite.find((c) => /site/i.test(c.regiao)) ?? doSite[0];
    if (alvo) return { ...alvo, aproximado: true };
  }
  return null;
}

/* --------------------------------------------------- qual habilidade é */

/**
 * Apelido que o pessoal usa no título do capítulo → pedaço do nome oficial da habilidade.
 * Ninguém escreve "Incendiary" no vídeo, escreve "molly". Só os apelidos que aparecem de
 * verdade; o que não casar fica sem ícone, que é melhor que mostrar o ícone errado.
 */
const APELIDOS = [
  [/\bmolly\b|\bmolli?es\b|\bmolotov\b|\bincend/i, ['incendiary', 'snake bite', 'frag', 'hot hands', 'blaze', 'molly']],
  [/\bsmoke?s?\b|\bfuma\b/i, ['sky smoke', 'poison cloud', 'dark cover', 'cove', 'nebula', 'smoke', 'orb']],
  [/\bwall\b|\bparede\b/i, ['toxic screen', 'barrier', 'cascade', 'wall']],
  [/\bflash\b|\bflashes\b/i, ['flashpoint', 'blaze', 'curveball', 'paranoia', 'flash', 'blindside', 'dizzy']],
  [/\bstun\b|\bconcuss/i, ['fault line', 'aftershock', 'concussion', 'stun', 'seize']],
  [/\bdart\b|\brecon\b|\bscan\b/i, ['recon bolt', 'owl drone', 'trailblazer', 'prowler', 'recon']],
  [/\bshock\b/i, ['shock bolt']],
  [/\bult\b|\bultimate\b/i, []],   // o ult é tratado pelo slot, não pelo nome
];

const semAcentoMin = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Qual habilidade a lineup usa, pelo nome do capítulo. Devolve a habilidade do agente ou
 * null — ícone errado no pino confunde mais do que pino sem ícone.
 */
export function habilidadeDaLineup(nome, habilidades = []) {
  if (!habilidades.length) return null;
  const t = ` ${semAcentoMin(nome).replace(/[^a-z0-9]+/g, ' ')} `;
  // 1. o nome oficial (pt-BR ou en-US) aparece no título
  for (const h of habilidades) {
    for (const alvo of [h.busca, h.nome]) {
      const limpo = semAcentoMin(alvo).replace(/[^a-z0-9]+/g, ' ').trim();
      if (limpo.length >= 4 && t.includes(` ${limpo} `)) return h;
    }
  }
  // 2. "ult" / "ultimate" → a habilidade do slot de ultimate
  if (/\bult\b|\bultimate\b/i.test(nome)) {
    const u = habilidades.find((h) => h.slot === 'Ultimate');
    if (u) return u;
  }
  // 3. apelido ("molly", "smoke", "wall"…)
  for (const [apelido, pistas] of APELIDOS) {
    if (!apelido.test(nome)) continue;
    for (const pista of pistas) {
      const h = habilidades.find((x) => semAcentoMin(x.busca).includes(pista) || semAcentoMin(x.nome).includes(pista));
      if (h) return h;
    }
  }
  return null;
}

/**
 * O título do capítulo costuma trazer as DUAS pontas: "A default from A Short" é alvo A
 * default, jogada de A Short. Medido em 154 lineups: 33% dizem de onde se joga. Nessas dá
 * pra desenhar a linha no mapa; nas outras sobra só o alvo, e é o que a gente mostra.
 */
const DE_ONDE = /^(.*?)\s+(?:from|at|@|desde)\s+(.+)$/i;

export function pontasDaLineup(nome, callouts = [], site = null) {
  const m = String(nome).match(DE_ONDE);
  if (!m) return { alvo: pontoDaLineup(nome, callouts, site), posicao: null };
  const [, alvoTxt, posTxt] = m;
  // "(Crosshair)" e afins no fim não são lugar
  const limpo = posTxt.replace(/\s*\((?:crosshair|hud|mira|game\s*hud)\)\s*$/i, '').trim();
  const posicao = pontoDaLineup(limpo, callouts, null);
  const alvo = pontoDaLineup(alvoTxt, callouts, site) ?? pontoDaLineup(nome, callouts, site);
  // posição igual ao alvo não acrescenta nada — e linha de um ponto pra ele mesmo confunde
  if (posicao && alvo && posicao.nome === alvo.nome) return { alvo, posicao: null };
  return { alvo, posicao: posicao && !posicao.aproximado ? posicao : null };
}

/* ------------------------------------------------------------------ busca */

/**
 * Instâncias de Invidious: API aberta de busca no YouTube, sem chave. São comunitárias e
 * caem direto, por isso a lista — tenta uma, deu ruim vai pra próxima. Se ele puser uma
 * chave do YouTube na config, usa a oficial e nem passa por aqui.
 */
const INVIDIOUS = [
  'https://invidious.f5.si',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.jing.rocks',
];
const ESPERAR = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * As instâncias são comunitárias e balançam: a mesma que acabou de responder a busca
 * devolve 500 no pedido seguinte e 200 no outro. Então cada uma leva duas tentativas antes
 * da gente desistir dela — desistir na primeira deixava a aba vazia com a rede inteira de pé.
 */
async function tentarJson(url, ms = 12000, vezes = 2) {
  let ultimo = null;
  for (let i = 0; i < vezes; i++) {
    try { return await buscarJson(url, ms); }
    catch (e) { ultimo = e; if (i + 1 < vezes) await ESPERAR(500 + i * 500); }
  }
  throw ultimo ?? new Error('sem resposta');
}
const MIN_SEG = 25;        // menos que isso não é lineup, é corte
const MAX_SEG = 3600;

const LADO = { atacando: 'attack', defendendo: 'defense' };

/** O texto da busca. "lineup" em inglês acha muito mais que em português. */
export function termoDaBusca({ mapa, agente, habilidade, lado }) {
  return [agente, habilidade, 'lineup', mapa, LADO[lado] ?? '']
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Sem agente ou sem mapa não dá pra procurar nada útil. */
export const buscavel = ({ mapa, agente } = {}) => Boolean(mapa && agente);

const normalizarInvidious = (v) => ({
  id: v.videoId,
  titulo: v.title ?? '',
  canal: v.author ?? '',
  segundos: Number(v.lengthSeconds) || 0,
  // sempre o CDN do YouTube, nunca a capa proxiada pela instância: as 20 vinham quebradas
  // porque o proxy da instância comunitária não serve imagem de forma confiável
  capa: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
  visitas: Number(v.viewCount) || 0,
});

const normalizarYoutube = (v) => ({
  id: v.id?.videoId,
  titulo: v.snippet?.title ?? '',
  canal: v.snippet?.channelTitle ?? '',
  segundos: 0,                                   // a busca oficial não devolve duração
  capa: v.snippet?.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${v.id?.videoId}/mqdefault.jpg`,
  visitas: 0,
});

/**
 * Procura vídeo de lineup. Devolve `{ termo, videos, fonte, aviso }` — nunca estoura:
 * aba sem resultado com um aviso é melhor que aba quebrada.
 */
export async function buscar({ mapa, agente, habilidade, lado, chaveYoutube = null } = {}) {
  const termo = termoDaBusca({ mapa, agente, habilidade, lado });
  if (!termo || termo === 'lineup') return { termo, videos: [], fonte: null, aviso: 'escolha pelo menos o agente e o mapa' };

  // 1. chave oficial do YouTube, se ele tiver posto uma na config
  if (chaveYoutube) {
    try {
      const u = new URL('https://www.googleapis.com/youtube/v3/search');
      u.search = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '20', q: termo, key: chaveYoutube });
      const d = await buscarJson(u.toString());
      const videos = (d.items ?? []).map(normalizarYoutube).filter((v) => v.id);
      if (videos.length) return { termo, videos, fonte: 'youtube' };
    } catch { /* chave velha ou cota estourada: cai pro sem-chave */ }
  }

  // 2. sem chave, pelas instâncias abertas
  const erros = [];
  for (const base of INVIDIOUS) {
    try {
      const d = await tentarJson(`${base}/api/v1/search?q=${encodeURIComponent(termo)}&type=video`, 12000);
      if (!Array.isArray(d)) throw new Error('resposta fora do formato');
      const videos = d.map(normalizarInvidious)
        .filter((v) => v.id && v.segundos >= MIN_SEG && v.segundos <= MAX_SEG);
      if (videos.length) return { termo, videos, fonte: new URL(base).host };
      erros.push(`${new URL(base).host}: sem resultado`);
    } catch (e) { erros.push(`${new URL(base).host}: ${e.message}`); }
  }
  return {
    termo, videos: [], fonte: null,
    aviso: 'não consegui buscar agora. Dá pra abrir a mesma busca no YouTube pelo botão.',
    detalhe: erros.join(' · '),
  };
}

/* ------------------------------------------------------------- lineup a lineup */

/**
 * O pulo do gato: vídeo de lineup quase sempre vem com capítulo por lineup na descrição
 * ("00:07 A Default FAST Molly 1 (A Lobby)"). Um vídeo de 10 min vira 34 lineups
 * clicáveis, cada uma abrindo no segundo exato. Sem isso a aba seria uma lista de vídeos
 * de 10 minutos pra assistir inteiros, que não serve pra nada na hora de jogar.
 */
const MARCADOR = /^[\s\-–—•*]*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:)|.]*\s*(.{3,80}?)\s*$/;
const PULA = /\bjump(?:\s*|-)?throw\b|\bjump\b|\brun\s*(?:and\s*)?throw\b|\bpulo\b|\bpulando\b/i;
const SO_INTRO = /^(intro|introduction|in[ií]cio|outro|like|subscribe|inscreva|timestamps?|cap[ií]tulos?)\b/i;
// capítulo que não é lineup: agradecimento, pedido de inscrição, encerramento
const NAO_E_LINEUP = /\bthanks?\s+(?:for|you)\b|\bsubscribe\b|\bsub\s+to\b|\bdiscord\b|\boutro\b|\bconclus|\bobrigad/i;

const emSegundos = (t) => {
  const p = String(t).split(':').map(Number);
  if (p.some((n) => !Number.isFinite(n))) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

/** De que ponto do mapa é a lineup, pelo nome do capítulo. É o filtro que ele usa de verdade. */
export function sitePeloNome(nome) {
  const t = ` ${String(nome).toLowerCase()} `;
  const ondes = [
    ['A', /\ba[\s)\].,]|\ba site\b|\ba lobby\b|\ba main\b/],
    ['B', /\bb[\s)\].,]|\bb site\b|\bb lobby\b|\bb main\b/],
    ['C', /\bc[\s)\].,]|\bc site\b/],
    ['Mid', /\bmid\b|\bmeio\b/],
  ].map(([site, re]) => [site, t.search(re)]).filter(([, i]) => i >= 0);
  if (!ondes.length) return null;
  // o primeiro que aparece: "A Default Molly (Top Mid)" é do A, jogada do mid
  return ondes.sort((x, y) => x[1] - y[1])[0][0];
}

/** Capítulos de um vídeo viram lineups. Devolve [] se o vídeo não tiver marcação. */
export function capitulosDaDescricao(descricao) {
  const fora = [];
  for (const linha of String(descricao ?? '').split(/\r?\n/)) {
    const m = linha.match(MARCADOR);
    if (!m) continue;
    const segundo = emSegundos(m[1]);
    const nome = m[2].replace(/\s{2,}/g, ' ').trim();
    if (segundo == null || !nome || SO_INTRO.test(nome) || NAO_E_LINEUP.test(nome)) continue;
    if (segundo === 0) continue;   // o capítulo do 0:00 é a abertura ("New Viper Lineups Ascent 2023")
    // `pula` é true, false ou null: null = o vídeo não disse. Não dá pra afirmar "sem pulo"
    // só porque o nome do capítulo não falou — ele mesmo marca quando salva.
    fora.push({ segundo, nome, site: sitePeloNome(nome), pula: PULA.test(nome) ? true : null });
  }
  // marcação de capítulo sobe no tempo; se não subir, é outra coisa (lista de links, créditos)
  const subindo = fora.filter((x, i) => i === 0 || x.segundo > fora[i - 1].segundo);
  return subindo.length >= 3 ? subindo : [];
}

/**
 * Os quadros do vídeo, de graça e sem baixar nada: o YouTube publica um "storyboard" —
 * folhas de sprite com um quadro a cada ~5 s, que é o que aparece quando você arrasta a
 * barra do player. Cada lineup pega os quadros do pedaço dela, e assim dá pra ver a tela
 * do jogo sem abrir vídeo nenhum — que era a reclamação: "não dá pra ver 1 por 1".
 *
 * O sprite vem apontando pra instância do Invidious, que serve HTML no lugar da imagem;
 * trocando o host pelo CDN do YouTube a imagem vem certa (testado: 66 KB de webp).
 */
const VTT_TEMPO = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

/**
 * O recorte vira linha/coluna na folha. Assim a tela pode mostrar o quadro em QUALQUER
 * tamanho usando porcentagem (background-size/position), sem depender da largura em pixel
 * do cartão — a fonte só tem 318x180 e encolher no CSS jogaria resolução fora.
 */
function grelhar(tiras) {
  const porFolha = new Map();
  for (const t of tiras) {
    t.col = Math.round(t.x / (t.w + 2));          // o passo é a largura do quadro + 2 px de borda
    t.lin = Math.round(t.y / t.h);
    const f = porFolha.get(t.url) ?? { cols: 0, lins: 0 };
    f.cols = Math.max(f.cols, t.col + 1); f.lins = Math.max(f.lins, t.lin + 1);
    porFolha.set(t.url, f);
  }
  for (const t of tiras) { const f = porFolha.get(t.url); t.cols = f.cols; t.lins = f.lins; }
  return tiras;
}

export function lerStoryboard(vtt) {
  const linhas = String(vtt ?? '').split(/\r?\n/);
  const fora = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(VTT_TEMPO);
    if (!m) continue;
    const de = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    const ate = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    const alvo = (linhas[i + 1] ?? '').trim();
    if (!alvo.startsWith('http')) continue;
    const [endereco, corte] = alvo.split('#xywh=');
    if (!corte) continue;
    const [x, y, w, h] = corte.split(',').map(Number);
    if ([x, y, w, h].some((n) => !Number.isFinite(n))) continue;
    fora.push({ de, ate, url: endereco.replace(/^https?:\/\/[^/]+\/sb\/i\//, 'https://i.ytimg.com/sb/'), x, y, w, h });
  }
  return grelhar(fora);
}

const storyboardDoVideo = async (base, id) => {
  for (const b of ordemAPartirDe(base)) {
    try {
      const corta = AbortSignal.timeout(12000);
      const r = await fetch(`${b}/api/v1/storyboards/${encodeURIComponent(id)}?width=320&height=180`, { signal: corta });
      if (!r.ok) continue;
      const txt = await r.text();
      if (!txt.startsWith('WEBVTT')) continue;          // instância desligada devolve 200 com aviso em texto
      const t = lerStoryboard(txt);
      if (t.length) return t;
    } catch { /* tenta a próxima */ }
  }
  return [];
};

/** Os quadros que mostram ESTA lineup: começo, meio e fim do pedaço dela. */
export function quadrosDaLineup(tiras, de, ate) {
  if (!tiras.length) return [];
  const fim = Number.isFinite(ate) && ate > de ? Math.min(ate, de + 40) : de + 12;
  const momentos = [0.12, 0.5, 0.85].map((f) => de + (fim - de) * f);
  const vistos = new Set(), fora = [];
  for (const t of momentos) {
    const q = tiras.find((x) => t >= x.de && t < x.ate) ?? tiras[tiras.length - 1];
    const chave = `${q.url}|${q.x}|${q.y}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave); fora.push(q);
  }
  return fora;
}

/**
 * Os capítulos de um vídeo. Tenta a instância que respondeu a busca e, se ela recusar,
 * as outras: são servidores comunitários que limitam por uso, e quando a de plantão começa
 * a negar os detalhes a aba vinha vazia mesmo tendo achado os vídeos.
 */
const ordemAPartirDe = (base) => [base, ...INVIDIOUS.filter((x) => x !== base)];

const detalhesDoVideo = async (base, id) => {
  for (const b of ordemAPartirDe(base)) {
    try {
      const d = await tentarJson(`${b}/api/v1/videos/${encodeURIComponent(id)}`, 12000);
      const caps = capitulosDaDescricao(d?.description);
      if (caps.length) return caps;
      if (d?.description != null) return caps;   // respondeu e o vídeo não tem capítulo mesmo
    } catch { /* essa recusou: tenta a próxima */ }
  }
  return [];
};

/**
 * Busca e já abre em lineups individuais. `videos` continua vindo, pros que não têm
 * capítulo — mas o que a aba mostra é `lineups`.
 */
/**
 * Busca inteira guardada em disco. Procurar leva uns 25 s (busca + descrição e storyboard de
 * 6 vídeos) e lineup de um mapa não muda de semana pra semana — então da segunda vez em
 * diante sai na hora, do disco, e só revalida quando fica velho.
 */
const VALIDADE_BUSCA = 14 * 24 * 60 * 60 * 1000;
const FORMATO_BUSCA = 2;
const chaveDaBusca = (p = {}) => [p.mapa, p.agente, p.habilidade || '-', p.lado || '-']
  .map((x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_')).join('__');

/** O que já está em disco pra essa combinação, ou null. */
export async function buscaGuardada(p = {}) {
  if (!buscavel(p)) return null;
  const g = await lerJson(arqBusca(chaveDaBusca(p)), null);
  if (g?.formato !== FORMATO_BUSCA || !g.lineups?.length) return null;
  return { ...g, doDisco: true, velho: Date.now() - (g.em ?? 0) > VALIDADE_BUSCA };
}

async function guardarBusca(p, r) {
  if (!r?.lineups?.length) return;
  try {
    await garantirBuscas();
    await writeFile(arqBusca(chaveDaBusca(p)), JSON.stringify({ ...r, em: Date.now(), formato: FORMATO_BUSCA }), 'utf8');
  } catch { /* disco cheio: a busca continua valendo em memória */ }
}

/** Com cache: instantâneo quando já foi buscado. `forcar` ignora o disco. */
export async function lineupsDe(p = {}) {
  if (!p.forcar) {
    const g = await buscaGuardada(p);
    if (g && !g.velho) return g;
  }
  const r = await buscarLineups(p);
  await guardarBusca(p, r);
  // deu ruim agora mas tem coisa velha guardada? melhor velho que vazio
  if (!r.lineups?.length) {
    const g = await buscaGuardada(p);
    if (g) return { ...g, aviso: 'não consegui atualizar agora; mostrando o que já estava salvo' };
  }
  return r;
}

export async function buscarLineups(p = {}) {
  const r = await buscar(p);
  if (!r.videos?.length || !r.fonte || r.fonte === 'youtube') return { ...r, lineups: [] };
  const base = INVIDIOUS.find((b) => new URL(b).host === r.fonte) ?? INVIDIOUS[0];

  // Só os primeiros: cada um é uma chamada, e os de cima são os que têm capítulo.
  // De 3 em 3: a instância é comunitária e passa a recusar quando a gente dispara 12 pedidos
  // de uma vez (foi o que aconteceu ao buscar capítulo e quadro em paralelo pros 6 vídeos).
  const candidatos = r.videos.slice(0, 6);
  const porVideo = [];
  for (let i = 0; i < candidatos.length; i += 3) {
    const lote = await Promise.all(candidatos.slice(i, i + 3).map(async (v) => {
      try {
        const [caps, tiras] = await Promise.all([detalhesDoVideo(base, v.id), storyboardDoVideo(base, v.id)]);
        return { v, caps, tiras: caps.length ? tiras : [] };
      } catch { return { v, caps: [], tiras: [] }; }
    }));
    porVideo.push(...lote);
    // já deu capítulo que chegue: não precisa incomodar a instância com o resto
    if (porVideo.reduce((n, x) => n + x.caps.length, 0) >= 40) break;
  }

  // o ponto no mapa sai daqui, não do navegador: a tela só desenha o pino
  const cat = await catalogo().catch(() => null);
  const callouts = cat?.mapas?.find((x) => x.nome === p.mapa)?.callouts ?? [];
  const habs = cat?.agentes?.find((x) => x.nome === p.agente)?.habilidades ?? [];

  const lineups = [];
  for (const { v, caps, tiras } of porVideo) {
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      const { alvo: ponto, posicao } = pontasDaLineup(c.nome, callouts, c.site);
      // de onde sai a habilidade, na ordem: o nome do capítulo; o título do vídeo (quase sempre
      // é lá que está, porque o vídeo inteiro é sobre uma só — "Brimstone Molly Lineups"); e por
      // fim a que ele filtrou, que é o que ele pediu. Só 2 de 111 casavam só pelo capítulo.
      const hab = habilidadeDaLineup(c.nome, habs)
        ?? habilidadeDaLineup(v.titulo, habs)
        ?? (p.habilidade ? habs.find((x) => x.busca === p.habilidade) : null)
        ?? null;
      // o fim da lineup é o começo da próxima: assim o player toca SÓ o clipe dela
      const fim = caps[i + 1]?.segundo ?? (v.segundos || c.segundo + 25);
      lineups.push({
        video: v.id, titulo: v.titulo, canal: v.canal,
        capa: v.capa, segundo: c.segundo, fim, nome: c.nome, site: c.site, pula: c.pula,
        quadros: quadrosDaLineup(tiras ?? [], c.segundo, fim),
        habilidade: hab ? { nome: hab.nome, icone: hab.icone } : null,
        ponto: ponto ? { nome: ponto.nome, x: ponto.x, y: ponto.y, aproximado: ponto.aproximado === true } : null,
        posicao: posicao ? { nome: posicao.nome, x: posicao.x, y: posicao.y } : null,   // de onde se joga, quando o título diz
      });
    }
  }
  const comCapitulo = porVideo.filter((x) => x.caps.length).length;
  const mapa = cat?.mapas?.find((x) => x.nome === p.mapa) ?? null;
  return {
    ...r, lineups,
    planta: mapa?.planta ?? null,
    callouts: mapa?.callouts ?? [],
    semCapitulo: !lineups.length,
    resumo: lineups.length ? `${lineups.length} lineups de ${comCapitulo} vídeo${comCapitulo > 1 ? 's' : ''}` : null,
  };
}

/** A mesma busca, pra abrir no navegador quando nada funcionar. */
export const linkYoutube = (termo) => `https://www.youtube.com/results?search_query=${encodeURIComponent(termo)}`;

/** A biblioteca do strats.gg, filtrada — sem copiar nada deles. */
export function linkStrats({ mapa, agente } = {}) {
  const parte = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const q = new URLSearchParams();
  if (mapa) q.set('map', parte(mapa));
  if (agente) q.set('agent', parte(agente));
  return `https://strats.gg/valorant/lineups${q.toString() ? `?${q}` : ''}`;
}

/* ------------------------------------------------------------------ as dele */

const limpar = (s, max) => String(s ?? '').trim().slice(0, max);

/** Lineups que ele salvou, mais novas primeiro. */
export async function salvas() {
  const l = await lerJson(arqSalvas(), []);
  return Array.isArray(l) ? l : [];
}

/**
 * Salva (ou atualiza, se o id já existir). `pula` é o único campo de instrução que ele
 * pediu: "tem q avisar se tem q pular ou n, só isso".
 */
export async function salvar(entrada = {}) {
  const lista = await salvas();
  const id = limpar(entrada.id, 40) || `ln${Date.now().toString(36)}`;
  const nova = {
    id,
    video: limpar(entrada.video, 20),               // id do vídeo no YouTube
    titulo: limpar(entrada.titulo, 200),
    canal: limpar(entrada.canal, 100),
    capa: limpar(entrada.capa, 400),
    segundo: Math.max(0, Math.round(Number(entrada.segundo) || 0)),   // onde a lineup começa
    fim: Math.max(0, Math.round(Number(entrada.fim) || 0)) || null,   // e onde acaba, pra tocar só o clipe
    mapa: limpar(entrada.mapa, 40),
    agente: limpar(entrada.agente, 40),
    habilidade: limpar(entrada.habilidade, 60),
    ponto: limpar(entrada.ponto, 60),          // onde a lineup CAI ("A Lobby")
    posicao: limpar(entrada.posicao, 60),      // de onde se joga, quando dá pra saber
    lado: ['atacando', 'defendendo'].includes(entrada.lado) ? entrada.lado : null,
    pula: entrada.pula === true ? true : entrada.pula === false ? false : null,   // null = ninguém disse ainda
    nota: limpar(entrada.nota, 300),
    em: Date.now(),
  };
  if (!nova.video) throw new Error('lineup sem vídeo');
  if (!nova.mapa || !nova.agente) throw new Error('lineup precisa de mapa e agente');
  // Duas lineups são a mesma quando são o mesmo vídeo no mesmo segundo — salvar de novo
  // atualiza (ex.: ele descobriu que pula), não duplica. Sem isso, clicar salvar duas
  // vezes enchia a lista de linhas idênticas.
  const i = lista.findIndex((x) => x.id === id || (x.video === nova.video && x.segundo === nova.segundo));
  if (i >= 0) lista[i] = { ...lista[i], ...nova, id: lista[i].id }; else lista.unshift(nova);
  await gravarJson(arqSalvas(), lista);
  return nova;
}

export async function apagar(id) {
  const lista = await salvas();
  const fora = lista.filter((x) => x.id !== id);
  await gravarJson(arqSalvas(), fora);
  return { apagadas: lista.length - fora.length };
}
