/**
 * Os mapas do CS2: radar e geometria, tirados do jogo dele.
 *
 * O que isto entrega é o catálogo NO MESMO FORMATO que a tela de lineups já consome do
 * Valorant — `{ mapas, agentes }`. Foi de propósito: assim a tela, os pinos, a marcação à
 * mão, os filtros e a segunda tela funcionam sem nenhuma mudança.
 *
 * A sacada que faz isso caber: **no CS não existe agente, e utilitário é universal.** Então
 * o eixo "agente" vira um agente só, `CS2`, e as "habilidades" dele são smoke, flash,
 * molotov e HE. Com isso:
 *  - a chave de busca (`mapa__agente__habilidade__lado`) continua valendo;
 *  - o termo que vai pro YouTube sai "CS2 smoke lineup Mirage", que é como o pessoal
 *    nomeia vídeo de CS de verdade;
 *  - as buscas caem de 80 (mapa x agente x lado, no Valorant) pra ~20 (mapa x lado).
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pastaBase } from '../caminhos.js';
import { abrirVpk, lerDoVpk, texturaParaPng, lerOverview } from './vpk.js';

const pasta = () => resolve(pastaBase(), 'dados', 'cs');
const arqCatalogo = () => resolve(pasta(), 'catalogo.json');
const FORMATO = 2;   // 2: mapas marcados como `inteiro` (a arte ja e a area jogavel)

/**
 * Onde o CS2 está. A pasta padrão do Steam primeiro; se não, as bibliotecas que o
 * `libraryfolders.vdf` lista — o PC dele tem duas (C: e D:), e o jogo pode estar em
 * qualquer uma.
 */
const PADRAO = [
  'C:/Program Files (x86)/Steam',
  'C:/Program Files/Steam',
];

export async function acharCs() {
  const existe = async (p) => { try { await stat(p); return true; } catch { return false; } };
  const candidatas = [...PADRAO];

  for (const steam of PADRAO) {
    try {
      const vdf = await readFile(resolve(steam, 'steamapps/libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) candidatas.push(m[1].replace(/\\\\/g, '/'));
    } catch { /* sem Steam aqui */ }
  }

  for (const base of candidatas) {
    const p = resolve(base, 'steamapps/common/Counter-Strike Global Offensive/game/csgo');
    if (await existe(resolve(p, 'pak01_dir.vpk'))) return p;
  }
  return null;
}

/* Os mapas que valem a pena. Só os de bomba do pool competitivo: Deathmatch e Arms Race não
 * têm lineup, e mapa de refém também não. `nome` é como aparece na tela. */
export const MAPAS = [
  { id: 'de_ancient', nome: 'Ancient' },
  { id: 'de_anubis', nome: 'Anubis' },
  { id: 'de_dust2', nome: 'Dust II' },
  { id: 'de_inferno', nome: 'Inferno' },
  { id: 'de_mirage', nome: 'Mirage' },
  { id: 'de_nuke', nome: 'Nuke' },
  { id: 'de_overpass', nome: 'Overpass' },
  { id: 'de_train', nome: 'Train' },
  { id: 'de_vertigo', nome: 'Vertigo' },
  { id: 'de_cache', nome: 'Cache' },
];

/* O utilitário no lugar do agente. `busca` é o que vai pro YouTube, e por isso é em inglês:
 * vídeo de lineup de CS é quase todo em inglês, igual ao que já se aprendeu no Valorant —
 * procurar por "Fumaça" acha muito menos que por "smoke". */
export const UTILITARIOS = [
  { nome: 'Smoke', busca: 'smoke', slot: 'Smoke' },
  { nome: 'Flash', busca: 'flash', slot: 'Flash' },
  { nome: 'Molotov', busca: 'molotov', slot: 'Molotov' },
  { nome: 'HE', busca: 'he grenade', slot: 'HE' },
];

/**
 * Extrai o radar e a geometria de cada mapa pro disco, uma vez. O PNG tem ~140 KB e o
 * trabalho é de segundos por mapa, mas ele pode estar jogando — por isso `podeAgora()`,
 * igual ao migrador do acervo.
 */
export async function extrairMapas({ podeAgora = () => true, log = () => {}, forcar = false } = {}) {
  const csgo = await acharCs();
  if (!csgo) return { erro: 'não achei o CS2 instalado' };

  await mkdir(pasta(), { recursive: true });
  const vpk = await abrirVpk(csgo);
  const feitos = [];
  let pulados = 0;

  for (const m of MAPAS) {
    if (!podeAgora()) return { feitos, pulados, parou: true };
    const destinoPng = resolve(pasta(), `${m.id}.png`);
    if (!forcar) {
      try { await stat(destinoPng); pulados++; continue; } catch { /* ainda não tem */ }
    }

    const txt = await lerDoVpk(vpk, `resource/overviews/${m.id}.txt`);
    const tex = await lerDoVpk(vpk, `panorama/images/overheadmaps/${m.id}_radar_psd.vtex_c`);
    if (!txt || !tex) { log(`cs: ${m.id} não está neste install`); continue; }

    try {
      const { largura, altura, png } = texturaParaPng(tex);
      await writeFile(destinoPng, png);
      const geo = lerOverview(txt);
      await writeFile(resolve(pasta(), `${m.id}.json`), JSON.stringify({ ...m, largura, altura, ...geo }, null, 2), 'utf8');
      feitos.push(m.id);
      log(`cs: ${m.nome} pronto (${largura}x${altura}, ${(png.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      log(`cs: ${m.nome} falhou — ${e.message}`);
    }
  }
  return { feitos, pulados };
}

/** O catálogo, no formato que a tela de lineups já sabe ler. */
export async function catalogo({ forcar = false } = {}) {
  if (!forcar) {
    try {
      const g = JSON.parse(await readFile(arqCatalogo(), 'utf8'));
      if (g?.formato === FORMATO && g.mapas?.length) return g;
    } catch { /* monta agora */ }
  }

  const prontos = [];
  for (const m of MAPAS) {
    try {
      const geo = JSON.parse(await readFile(resolve(pasta(), `${m.id}.json`), 'utf8'));
      prontos.push({
        nome: m.nome,
        id: m.id,
        caminho: `/maps/${m.id}`,
        // a planta e a arte são a mesma imagem: o radar. Servida pelo próprio app.
        planta: `/cs/mapa/${m.id}.png`,
        arte: `/cs/mapa/${m.id}.png`,
        icone: `/cs/mapa/${m.id}.png`,
        /* O radar da Valve JÁ vem recortado na área jogável — é a imagem que o jogo usa no
           canto da tela. Recortar de novo pela caixa dos callouts cortaria o mapa, e aqui
           são só quatro pontos (os dois bombsites e os dois spawns): isso não descreve
           extensão nenhuma. No Valorant a caixa faz sentido porque são ~17 callouts e a
           arte tem margem preta em volta; aqui não há margem pra tirar. */
        inteiro: true,
        callouts: (geo.pontos ?? []).map((p) => ({ nome: p.nome, x: p.x, y: p.y, regiao: p.nome, grande: p.nome, site: null })),
        geometria: { posX: geo.posX, posY: geo.posY, escala: geo.escala, largura: geo.largura, altura: geo.altura },
      });
    } catch { /* esse mapa ainda não foi extraído */ }
  }

  const cat = {
    formato: FORMATO,
    em: Date.now(),
    jogo: 'cs',
    mapas: prontos,
    // um "agente" só: o utilitário é que varia, e ele entra como habilidade
    agentes: [{
      id: 'cs2',
      nome: 'CS2',
      icone: null,
      funcao: 'Utilitário',
      habilidades: UTILITARIOS.map((u) => ({ nome: u.nome, busca: u.busca, icone: null, slot: u.slot })),
    }],
  };
  if (prontos.length) await writeFile(arqCatalogo(), JSON.stringify(cat), 'utf8').catch(() => {});
  return cat;
}

/** O PNG de um mapa, pra rota que serve a imagem. */
export async function arteDoMapa(id) {
  if (!/^[a-z0-9_]+$/.test(String(id))) return null;
  try { return await readFile(resolve(pasta(), `${id}.png`)); } catch { return null; }
}
