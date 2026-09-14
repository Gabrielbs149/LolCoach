import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pastaBase } from '../caminhos.js';
import { slugDoCampeao, ROLE_OPGG } from './opgg.js';

/**
 * Confrontos de lane, com número real.
 *
 * O op.gg devolve, junto com a build, uma lista de `counters`: para cada
 * adversário, quantas partidas e quantas vitórias aquele campeão teve naquela
 * role. É o que permite dizer "Jax contra Darius dá 42% em 497 jogos" em vez de
 * "cuidado com o Darius".
 */

const BASE = 'https://lol-api-champion.op.gg/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const arquivoCache = () => resolve(pastaBase(), 'dados', 'confrontos.json');

const memoria = new Map();
let disco = null;
const VALIDADE = 7 * 24 * 60 * 60 * 1000; // build e meta mudam por patch, não por hora

async function lerDisco() {
  if (disco) return disco;
  try { disco = JSON.parse(await readFile(arquivoCache(), 'utf8')); } catch { disco = {}; }
  return disco;
}

async function gravarDisco() {
  try {
    await mkdir(dirname(arquivoCache()), { recursive: true });
    await writeFile(arquivoCache(), JSON.stringify(disco ?? {}), 'utf8');
  } catch { /* segue com memória */ }
}

/**
 * Tabela de confrontos do campeão naquela role.
 * Devolve Map(championIdInimigo -> { jogos, vitorias, taxa }).
 */
export async function confrontosDe(campeao, role, { regiao = 'br' } = {}) {
  const chave = `${slugDoCampeao(campeao)}|${ROLE_OPGG[role] ?? String(role).toLowerCase()}|${regiao}`;
  if (memoria.has(chave)) return memoria.get(chave);

  const guardado = (await lerDisco())[chave];
  if (guardado && Date.now() - guardado.em < VALIDADE) {
    const m = new Map(guardado.lista.map((c) => [c.id, c]));
    memoria.set(chave, m);
    return m;
  }

  let lista = [];
  try {
    const url = `${BASE}/${regiao}/champions/ranked/${slugDoCampeao(campeao)}/${ROLE_OPGG[role] ?? String(role).toLowerCase()}`;
    const j = await (await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })).json();
    lista = (j.data?.counters ?? [])
      .filter((c) => c.play >= 30) // amostra pequena vira ruído
      .map((c) => ({ id: c.champion_id, jogos: c.play, vitorias: c.win, taxa: c.win / c.play }));
  } catch {
    // Sem internet: se havia cache vencido, ele ainda serve.
    if (guardado) lista = guardado.lista;
  }

  disco[chave] = { em: Date.now(), lista };
  await gravarDisco();

  const m = new Map(lista.map((c) => [c.id, c]));
  memoria.set(chave, m);
  return m;
}

/** O confronto específico contra um campeão, ou null se não houver amostra. */
export async function confrontoContra(meuCampeao, minhaRole, championIdInimigo, opcoes) {
  const tabela = await confrontosDe(meuCampeao, minhaRole, opcoes);
  return tabela.get(Number(championIdInimigo)) ?? null;
}
