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

const garantirPasta = () => mkdir(pasta(), { recursive: true }).catch(() => {});
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
 * Mapas e agentes oficiais, do valorant-api.com (público, sem chave, atualizado por patch).
 * Fica em disco: assim a aba abre sem internet e não bate na API a cada clique.
 */
export async function catalogo({ forcar = false } = {}) {
  const guardado = await lerJson(arqCatalogo(), null);
  if (!forcar && guardado?.em && Date.now() - guardado.em < VALIDADE_CATALOGO && guardado.mapas?.length) return guardado;

  try {
    // em pt-BR pra mostrar, em en-US pra buscar: vídeo de lineup é quase todo em inglês,
    // e procurar por "Nuvem Venenosa" acha muito menos que por "Poison Cloud".
    const [m, a, aEn] = await Promise.all([
      buscarJson('https://valorant-api.com/v1/maps?language=pt-BR'),
      buscarJson('https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=pt-BR'),
      buscarJson('https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=en-US').catch(() => ({ data: [] })),
    ]);
    const emIngles = new Map((aEn.data ?? []).map((x) => [x.uuid, x]));
    const mapas = (m.data ?? [])
      .filter((x) => x.displayName && x.tacticalDescription)    // só mapa de partida: tira Campo de Treino e afins
      .map((x) => ({ nome: x.displayName, icone: x.listViewIcon ?? x.splash ?? null, planta: x.displayIcon ?? null }))
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
    const novo = { em: Date.now(), mapas, agentes };
    await gravarJson(arqCatalogo(), novo);
    return novo;
  } catch (e) {
    // sem internet: vale mais o catálogo velho do que uma aba quebrada
    if (guardado?.mapas?.length) return { ...guardado, aviso: 'catálogo antigo: não consegui atualizar agora' };
    return { em: 0, mapas: [], agentes: [], aviso: `não consegui buscar mapas e agentes: ${e.message}` };
  }
}

/* ------------------------------------------------------------------ busca */

/**
 * Instâncias de Invidious: API aberta de busca no YouTube, sem chave. São comunitárias e
 * caem direto, por isso a lista — tenta uma, deu ruim vai pra próxima. Se ele puser uma
 * chave do YouTube na config, usa a oficial e nem passa por aqui.
 */
const INVIDIOUS = [
  'https://invidious.f5.si',
  'https://inv.in.projectsegfau.lt',
  'https://invidious.privacyredirect.com',
  'https://yewtu.be',
];
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
      const d = await buscarJson(`${base}/api/v1/search?q=${encodeURIComponent(termo)}&type=video`, 12000);
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
    if (segundo == null || !nome || SO_INTRO.test(nome)) continue;
    if (segundo === 0) continue;   // o capítulo do 0:00 é a abertura ("New Viper Lineups Ascent 2023")
    // `pula` é true, false ou null: null = o vídeo não disse. Não dá pra afirmar "sem pulo"
    // só porque o nome do capítulo não falou — ele mesmo marca quando salva.
    fora.push({ segundo, nome, site: sitePeloNome(nome), pula: PULA.test(nome) ? true : null });
  }
  // marcação de capítulo sobe no tempo; se não subir, é outra coisa (lista de links, créditos)
  const subindo = fora.filter((x, i) => i === 0 || x.segundo > fora[i - 1].segundo);
  return subindo.length >= 3 ? subindo : [];
}

const detalhesDoVideo = async (base, id) => {
  const d = await buscarJson(`${base}/api/v1/videos/${encodeURIComponent(id)}`, 12000);
  return capitulosDaDescricao(d?.description);
};

/**
 * Busca e já abre em lineups individuais. `videos` continua vindo, pros que não têm
 * capítulo — mas o que a aba mostra é `lineups`.
 */
export async function buscarLineups(p = {}) {
  const r = await buscar(p);
  if (!r.videos?.length || !r.fonte || r.fonte === 'youtube') return { ...r, lineups: [] };
  const base = INVIDIOUS.find((b) => new URL(b).host === r.fonte) ?? INVIDIOUS[0];

  // só os primeiros: cada um é uma chamada, e os de cima são os que têm capítulo
  const candidatos = r.videos.slice(0, 6);
  const porVideo = await Promise.all(candidatos.map(async (v) => {
    try { return { v, caps: await detalhesDoVideo(base, v.id) }; } catch { return { v, caps: [] }; }
  }));

  const lineups = [];
  for (const { v, caps } of porVideo) {
    for (const c of caps) {
      lineups.push({
        video: v.id, titulo: v.titulo, canal: v.canal,
        capa: v.capa, segundo: c.segundo, nome: c.nome, site: c.site, pula: c.pula,
      });
    }
  }
  const comCapitulo = porVideo.filter((x) => x.caps.length).length;
  return {
    ...r, lineups,
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
    mapa: limpar(entrada.mapa, 40),
    agente: limpar(entrada.agente, 40),
    habilidade: limpar(entrada.habilidade, 60),
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
