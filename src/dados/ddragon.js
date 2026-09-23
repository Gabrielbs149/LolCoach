import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pastaBase } from '../caminhos.js';

/**
 * Dados oficiais de campeão (Data Dragon, da própria Riot, em português).
 *
 * É daqui que sai o que faltava pra conselho específico: o que cada magia faz,
 * quanto tempo de recarga tem em cada nível, o alcance, e principalmente o
 * `enemytips` — as dicas oficiais de como jogar CONTRA aquele campeão.
 *
 * Tudo fica em disco por patch: baixa uma vez e depois funciona offline.
 */

const CDN = 'https://ddragon.leagueoflegends.com';
const pasta = () => resolve(pastaBase(), 'dados', 'ddragon');

let patchEmMemoria = null;
const cache = new Map();

async function lerCache(arquivo) {
  try { return JSON.parse(await readFile(arquivo, 'utf8')); } catch { return null; }
}

async function gravarCache(arquivo, dados) {
  try {
    await mkdir(dirname(arquivo), { recursive: true });
    await writeFile(arquivo, JSON.stringify(dados), 'utf8');
  } catch { /* sem disco, segue só com memória */ }
}

/** Patch mais recente. Se não houver internet, usa o último que ficou salvo. */
export async function patchAtual() {
  if (patchEmMemoria) return patchEmMemoria;
  const arquivo = resolve(pasta(), 'patch.json');

  try {
    const lista = await (await fetch(`${CDN}/api/versions.json`, { signal: AbortSignal.timeout(8000) })).json();
    patchEmMemoria = lista[0];
    await gravarCache(arquivo, { patch: patchEmMemoria });
  } catch {
    patchEmMemoria = (await lerCache(arquivo))?.patch ?? null;
  }
  return patchEmMemoria;
}

/** championId (número) -> identificador do Data Dragon ("Darius", "MonkeyKing"). */
export async function tabelaDeIds() {
  if (cache.has('ids')) return cache.get('ids');
  const patch = await patchAtual();
  if (!patch) return new Map();

  const arquivo = resolve(pasta(), patch, 'lista.json');
  let bruto = await lerCache(arquivo);
  if (!bruto) {
    try {
      bruto = await (await fetch(`${CDN}/cdn/${patch}/data/pt_BR/champion.json`, { signal: AbortSignal.timeout(15000) })).json();
      await gravarCache(arquivo, bruto);
    } catch { return new Map(); }
  }

  const mapa = new Map();
  for (const c of Object.values(bruto.data ?? {})) mapa.set(Number(c.key), c.id);
  cache.set('ids', mapa);
  return mapa;
}

/**
 * Atributos base de cada campeão (vida, armadura, resistência mágica, dano de
 * ataque e velocidade, com o ganho por nível). É o que permite calcular vida
 * efetiva e dano sem adivinhar nada — o Data Dragon publica tudo isto.
 * Map(nome | chave | id -> stats).
 */
export async function atributosDosCampeoes() {
  if (cache.has('atributos')) return cache.get('atributos');
  const patch = await patchAtual();
  if (!patch) return new Map();
  let bruto = await lerCache(resolve(pasta(), patch, 'lista.json'));
  if (!bruto?.data) { await tabelaDeIds(); bruto = await lerCache(resolve(pasta(), patch, 'lista.json')); }
  const mapa = new Map();
  for (const c of Object.values(bruto?.data ?? {})) {
    const s = c.stats ?? {};
    const v = { hp: s.hp ?? 600, hpNv: s.hpperlevel ?? 90, armadura: s.armor ?? 30, armaduraNv: s.armorperlevel ?? 4,
      mr: s.spellblock ?? 30, mrNv: s.spellblockperlevel ?? 1.3, ad: s.attackdamage ?? 60, adNv: s.attackdamageperlevel ?? 3,
      as: s.attackspeed ?? 0.65, asNv: (s.attackspeedperlevel ?? 2) / 100 };
    mapa.set(c.name, v); mapa.set(c.id, v); mapa.set(Number(c.key), v);
  }
  cache.set('atributos', mapa);
  return mapa;
}

/**
 * Lista completa de campeões (id + nome em português), pra grade da tela de
 * configuração funcionar com o League fechado. O client continua sendo a fonte
 * preferida — ele conhece o campeão lançado hoje antes do Data Dragon.
 */
export async function listaDeCampeoes() {
  if (cache.has('lista')) return cache.get('lista');
  const patch = await patchAtual();
  if (!patch) return [];

  const bruto = await lerCache(resolve(pasta(), patch, 'lista.json'));
  if (!bruto?.data) { await tabelaDeIds(); }
  const dados = bruto?.data ?? (await lerCache(resolve(pasta(), patch, 'lista.json')))?.data;
  if (!dados) return [];

  const lista = Object.values(dados)
    .map((c) => ({ id: Number(c.key), nome: c.name }))
    .filter((c) => c.id > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  cache.set('lista', lista);
  return lista;
}

/**
 * O elenco com as duas grafias de cada campeão.
 *
 * `chave` é o identificador do Data Dragon ("Bard", "MonkeyKing") — o mesmo que
 * o resto do app e o banco usam. `nome` é o nome traduzido ("Bardo", "Wukong"),
 * que é como as notas de atualização escrevem. Precisa dos dois pra casar as
 * duas fontes.
 */
export async function elencoCompleto() {
  if (cache.has('elenco')) return cache.get('elenco');
  const patch = await patchAtual();
  if (!patch) return [];

  await tabelaDeIds();  // garante lista.json em disco
  const bruto = await lerCache(resolve(pasta(), patch, 'lista.json'));
  const lista = Object.values(bruto?.data ?? {}).map((c) => ({
    id: Number(c.key),
    chave: c.id,
    nome: c.name,
  }));
  cache.set('elenco', lista);
  return lista;
}

/**
 * Classe de cada campeão (Mage, Marksman, Fighter…), pra dividir os jogos dele
 * por tipo de personagem. Devolve Map(nome -> ['Mage','Assassin']) com o nome
 * em português E o identificador em inglês apontando pro mesmo valor: o banco
 * guarda o nome que a fonte da partida usou, e as duas grafias aparecem.
 */
export async function classesDosCampeoes() {
  if (cache.has('classes')) return cache.get('classes');
  const patch = await patchAtual();
  if (!patch) return new Map();

  await tabelaDeIds();  // garante que lista.json existe em disco
  const bruto = await lerCache(resolve(pasta(), patch, 'lista.json'));
  const mapa = new Map();
  for (const c of Object.values(bruto?.data ?? {})) {
    if (!c.tags?.length) continue;
    mapa.set(c.name, c.tags);
    mapa.set(c.id, c.tags);
    mapa.set(String(c.name).replace(/\s+/g, ''), c.tags);
  }
  cache.set('classes', mapa);
  return mapa;
}

/** Perfil de cada campeão pra análise de pick: tags e tipo de dano (attack × magic do ddragon). Map(nome -> { tags, dano }). */
export async function perfisDosCampeoes() {
  if (cache.has('perfis')) return cache.get('perfis');
  const patch = await patchAtual();
  if (!patch) return new Map();
  await tabelaDeIds();
  const bruto = await lerCache(resolve(pasta(), patch, 'lista.json'));
  const mapa = new Map();
  for (const c of Object.values(bruto?.data ?? {})) {
    const a = c.info?.attack ?? 5, m = c.info?.magic ?? 5;
    const dano = m >= a + 2 ? 'ap' : a >= m + 2 ? 'ad' : 'misto';
    const p = { tags: c.tags ?? [], dano, id: Number(c.key) };
    mapa.set(c.name, p); mapa.set(c.id, p);
  }
  cache.set('perfis', mapa);
  return mapa;
}

const limpar = (t) => String(t ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/**
 * Ficha de um campeão: passiva, as quatro magias e as dicas oficiais de como
 * jogar contra ele.
 */
export async function fichaDoCampeao(championId) {
  const chave = `c${championId}`;
  if (cache.has(chave)) return cache.get(chave);

  const [patch, ids] = await Promise.all([patchAtual(), tabelaDeIds()]);
  const nome = ids.get(Number(championId));
  if (!patch || !nome) return null;

  const arquivo = resolve(pasta(), patch, `${nome}.json`);
  let bruto = await lerCache(arquivo);
  if (!bruto) {
    try {
      bruto = await (await fetch(`${CDN}/cdn/${patch}/data/pt_BR/champion/${nome}.json`, { signal: AbortSignal.timeout(15000) })).json();
      await gravarCache(arquivo, bruto);
    } catch { return null; }
  }

  const c = bruto.data?.[nome];
  if (!c) return null;

  const ficha = {
    id: nome,
    nome: c.name,
    titulo: c.title,
    tags: c.tags ?? [],
    passiva: { nome: c.passive?.name, texto: limpar(c.passive?.description) },
    magias: (c.spells ?? []).map((s, i) => ({
      tecla: ['Q', 'W', 'E', 'R'][i],
      nome: s.name,
      texto: limpar(s.description),
      // "9/8/7/6/5" -> [9,8,7,6,5]: dá pra citar a recarga do nível exato.
      recargas: String(s.cooldownBurn ?? '').split('/').map(Number).filter((n) => !Number.isNaN(n)),
      alcance: Number(String(s.rangeBurn ?? '').split('/')[0]) || null,
    })),
    contraEle: (c.enemytips ?? []).map(limpar),
    comEle: (c.allytips ?? []).map(limpar),
  };

  cache.set(chave, ficha);
  return ficha;
}

/**
 * Arte do campeão (a splash grande), pra dar cara às telas.
 * Guardada em disco na primeira vez: depois carrega instantâneo e offline.
 */
export async function arteDoCampeao(championId) {
  const ids = await tabelaDeIds();
  const nome = ids.get(Number(championId));
  if (!nome) return null;

  const arquivo = resolve(pasta(), 'arte', `${nome}.jpg`);
  try { return await readFile(arquivo); } catch { /* ainda não baixada */ }

  try {
    const r = await fetch(`${CDN}/cdn/img/champion/splash/${nome}_0.jpg`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(dirname(arquivo), { recursive: true }).catch(() => {});
    await writeFile(arquivo, buf).catch(() => {});
    return buf;
  } catch { return null; }
}

/**
 * Retrato quadrado do campeão.
 *
 * O client também serve esses ícones, e de lá vêm em melhor qualidade — mas só
 * enquanto o League está aberto. Com o jogo fechado as telas ficavam cheias de
 * quadrado vazio, então isto aqui é o plano B, guardado em disco igual à arte.
 */
export async function iconeDoCampeao(championId) {
  const ids = await tabelaDeIds();
  const nome = ids.get(Number(championId));
  if (!nome) return null;

  const patch = await patchAtual();
  const arquivo = resolve(pasta(), 'icone', `${nome}.png`);
  try { return await readFile(arquivo); } catch { /* ainda não baixado */ }
  if (!patch) return null;

  try {
    const r = await fetch(`${CDN}/cdn/${patch}/img/champion/${nome}.png`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(dirname(arquivo), { recursive: true }).catch(() => {});
    await writeFile(arquivo, buf).catch(() => {});
    return buf;
  } catch { return null; }
}

/**
 * Ícone REDONDO do minimapa, que é o da skin (cada skin tem o seu: udyr_circle_4.png, kayn_ass_circle_8.png…).
 * O Data Dragon só tem o quadrado do campeão base; isso vem do CommunityDragon (os arquivos do próprio jogo).
 * `forma`: só Kayn ('ass' = Assassino Sombrio, 'slay' = Rhaast). Cai pro círculo base, e por fim pro quadrado.
 */
const semCirculo = new Set();   // URLs que deram 404 nesta sessão
export async function circuloDoCampeao(championId, skin = 0, forma = '') {
  const ids = await tabelaDeIds();
  const nome = ids.get(Number(championId));
  if (!nome) return null;
  const n = nome.toLowerCase();
  const sufixo = (k) => (k ? `_${k}` : '');
  const tentativas = [];
  if (forma) { tentativas.push(`${n}_${forma}_circle${sufixo(skin)}.png`); if (skin) tentativas.push(`${n}_${forma}_circle.png`); }
  if (skin) tentativas.push(`${n}_circle_${skin}.png`);
  tentativas.push(`${n}_circle.png`, `${n}_circle_0.png`);
  if (n === 'shaco') tentativas.push('jester_circle.png');   // o Shaco base tem nome interno antigo
  for (const arq of tentativas) {
    const local = resolve(pasta(), 'circulo', arq);
    try { return await readFile(local); } catch { /* ainda não baixado */ }
    const url = `https://raw.communitydragon.org/latest/game/assets/characters/${n}/hud/${arq}`;
    if (semCirculo.has(url)) continue;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) { semCirculo.add(url); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      await mkdir(dirname(local), { recursive: true }).catch(() => {});
      await writeFile(local, buf).catch(() => {});
      return buf;
    } catch { semCirculo.add(url); }
  }
  return iconeDoCampeao(championId);
}

/** Ícone de invocador (o retrato do perfil), guardado em disco como os demais. */
export async function iconeDePerfil(iconeId) {
  const patch = await patchAtual();
  const id = Number(iconeId);
  if (!patch || !Number.isFinite(id)) return null;

  const arquivo = resolve(pasta(), 'perfil', `${id}.png`);
  try { return await readFile(arquivo); } catch { /* ainda não baixado */ }

  try {
    const r = await fetch(`${CDN}/cdn/${patch}/img/profileicon/${id}.png`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(dirname(arquivo), { recursive: true }).catch(() => {});
    await writeFile(arquivo, buf).catch(() => {});
    return buf;
  } catch { return null; }
}

/* ------------------------------------------------ itens, runas e feitiços */

/** Baixa um JSON de dados do patch atual e guarda em disco. */
async function dadosDoPatch(nomeArquivo) {
  const chave = `dados:${nomeArquivo}`;
  if (cache.has(chave)) return cache.get(chave);
  const patch = await patchAtual();
  if (!patch) return null;

  const arquivo = resolve(pasta(), patch, nomeArquivo);
  let bruto = await lerCache(arquivo);
  if (!bruto) {
    try {
      bruto = await (await fetch(`${CDN}/cdn/${patch}/data/pt_BR/${nomeArquivo}`, { signal: AbortSignal.timeout(20000) })).json();
      await gravarCache(arquivo, bruto);
    } catch { return null; }
  }
  cache.set(chave, bruto);
  return bruto;
}

/** Map(itemId -> { nome, preco, img, descricao }) */
export async function tabelaDeItens() {
  if (cache.has('itens')) return cache.get('itens');
  const bruto = await dadosDoPatch('item.json');
  const mapa = new Map();
  for (const [id, it] of Object.entries(bruto?.data ?? {})) {
    mapa.set(Number(id), { nome: it.name, preco: it.gold?.total ?? 0, img: it.image?.full ?? `${id}.png`,
      descricao: limpar(it.plaintext ?? ''), atributos: it.stats ?? {} });
  }
  cache.set('itens', mapa);
  return mapa;
}

// Fragmentos de atributo não vêm no runesReforged.json — são fixos.
const FRAGMENTOS = {
  5001: ['Vida (escala)', 'perk-images/StatMods/StatModsHealthScalingIcon.png'],
  5002: ['Armadura', 'perk-images/StatMods/StatModsArmorIcon.png'],
  5003: ['Resistência mágica', 'perk-images/StatMods/StatModsMagicResIcon.MagicResist_Fix.png'],
  5005: ['Velocidade de ataque', 'perk-images/StatMods/StatModsAttackSpeedIcon.png'],
  5007: ['Aceleração de habilidade', 'perk-images/StatMods/StatModsCDRScalingIcon.png'],
  5008: ['Força adaptativa', 'perk-images/StatMods/StatModsAdaptiveForceIcon.png'],
  5010: ['Velocidade de movimento', 'perk-images/StatMods/StatModsMovementSpeedIcon.png'],
  5011: ['Vida', 'perk-images/StatMods/StatModsHealthPlusIcon.png'],
  5013: ['Tenacidade', 'perk-images/StatMods/StatModsTenacityIcon.png'],
};

/** Map(runaId -> { nome, icon, arvore, arvoreNome }) — árvores e fragmentos incluídos. */
export async function tabelaDeRunas() {
  if (cache.has('runas')) return cache.get('runas');
  const bruto = await dadosDoPatch('runesReforged.json');
  const mapa = new Map();
  for (const arvore of bruto ?? []) {
    mapa.set(arvore.id, { nome: arvore.name, icon: arvore.icon, arvore: arvore.id, arvoreNome: arvore.name, ehArvore: true });
    for (const slot of arvore.slots ?? []) {
      for (const r of slot.runes ?? []) {
        mapa.set(r.id, { nome: r.name, icon: r.icon, arvore: arvore.id, arvoreNome: arvore.name, curta: limpar(r.shortDesc ?? '') });
      }
    }
  }
  for (const [id, [nome, icon]] of Object.entries(FRAGMENTOS)) mapa.set(Number(id), { nome, icon, fragmento: true });
  cache.set('runas', mapa);
  return mapa;
}

/** Map(feiticoId -> { nome, img }) */
export async function tabelaDeFeiticos() {
  if (cache.has('feiticos')) return cache.get('feiticos');
  const bruto = await dadosDoPatch('summoner.json');
  const mapa = new Map();
  for (const s of Object.values(bruto?.data ?? {})) mapa.set(Number(s.key), { nome: s.name, img: s.image?.full });
  cache.set('feiticos', mapa);
  return mapa;
}

/** Baixa e guarda uma imagem qualquer do CDN do Data Dragon. */
async function imagemDoCdn(subpasta, url, nomeArquivo) {
  const arquivo = resolve(pasta(), subpasta, nomeArquivo);
  try { return await readFile(arquivo); } catch { /* ainda não baixada */ }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(dirname(arquivo), { recursive: true }).catch(() => {});
    await writeFile(arquivo, buf).catch(() => {});
    return buf;
  } catch { return null; }
}

export async function imagemDeItem(itemId) {
  const patch = await patchAtual();
  const it = (await tabelaDeItens()).get(Number(itemId));
  if (!patch || !it) return null;
  return imagemDoCdn('item', `${CDN}/cdn/${patch}/img/item/${it.img}`, it.img);
}

export async function imagemDeRuna(runaId) {
  const r = (await tabelaDeRunas()).get(Number(runaId));
  if (!r?.icon) return null;
  // Ícones de runa não têm versão no caminho.
  return imagemDoCdn('runa', `${CDN}/cdn/img/${r.icon}`, `${runaId}.png`);
}

export async function imagemDeFeitico(feiticoId) {
  const patch = await patchAtual();
  const s = (await tabelaDeFeiticos()).get(Number(feiticoId));
  if (!patch || !s?.img) return null;
  return imagemDoCdn('feitico', `${CDN}/cdn/${patch}/img/spell/${s.img}`, s.img);
}

/** Recarga daquela magia no nível em que ela estava. */
export function recargaNoNivel(magia, nivel) {
  if (!magia?.recargas?.length) return null;
  const i = Math.min(Math.max(nivel || 1, 1), magia.recargas.length) - 1;
  return magia.recargas[i];
}
