import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pastaBase } from '../caminhos.js';

/**
 * Temporadas passadas (pico e fim de cada split) lidas da página de perfil do
 * op.gg — a Riot não expõe elo de temporada antiga na API. Guardado 1 dia.
 * E o "top X%" do ladder, estimado pela distribuição de tiers (aprox.).
 */
const NOME = { iron: 'Ferro', bronze: 'Bronze', silver: 'Prata', gold: 'Ouro', platinum: 'Platina', emerald: 'Esmeralda', diamond: 'Diamante', master: 'Mestre', grandmaster: 'Grão-Mestre', challenger: 'Desafiante' };
const pt = (t) => { const m = String(t ?? '').trim().toLowerCase().match(/^([a-z]+)\s*(\d)?$/); if (!m || !NOME[m[1]]) return null; return `${NOME[m[1]]}${m[2] ? ' ' + m[2] : ''}`; };

export async function temporadasDoOpgg(nome, tag, regiao = 'br') {
  const arq = resolve(pastaBase(), 'dados', 'opgg', `perfil-${String(nome).replace(/[^\w]/g, '_')}-${String(tag).replace(/[^\w]/g, '_')}.json`);
  try { const c = JSON.parse(await readFile(arq, 'utf8')); if (Date.now() - Date.parse(c.em) < 86400_000) return c.temporadas; } catch { /* sem cache */ }
  const url = `https://op.gg/lol/summoners/${regiao}/${encodeURIComponent(nome)}-${encodeURIComponent(tag)}`;
  const html = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR' }, signal: AbortSignal.timeout(15000) })).text();
  const bloco = html.match(/\{\\"data\\":\[\{\\"season\\":[\s\S]{0,6000}/)?.[0]?.replace(/\\"/g, '"') ?? '';
  const temporadas = [];
  const re = /"season":"([^"]*)","rank_entries":\{"high_rank_info":\{"tier":"([^"]*)"[^}]*\},"rank_info":\{"tier":"([^"]*)"/g;
  let m; while ((m = re.exec(bloco))) temporadas.push({ temporada: m[1].trim(), pico: pt(m[2]), fim: pt(m[3]) });
  await mkdir(resolve(pastaBase(), 'dados', 'opgg'), { recursive: true }).catch(() => {});
  await writeFile(arq, JSON.stringify({ em: new Date().toISOString(), temporadas })).catch(() => {});
  return temporadas;
}

// Distribuição aproximada de tiers na solo (op.gg, 2025) — pra estimar o "top X%" sem leaderboard.
const FATIA = { IRON: 8, BRONZE: 20, SILVER: 21, GOLD: 19, PLATINUM: 14, EMERALD: 11, DIAMOND: 5, MASTER: 1.5, GRANDMASTER: 0.25, CHALLENGER: 0.05 };
const ORDEM = Object.keys(FATIA);
export function topPorcento(tier, rank) {
  const i = ORDEM.indexOf(String(tier ?? '').toUpperCase()); if (i < 0) return null;
  const acima = ORDEM.slice(i + 1).reduce((s, t) => s + FATIA[t], 0);
  const dentro = i >= 7 ? 0.5 : ({ I: 0.125, II: 0.375, III: 0.625, IV: 0.875 }[rank] ?? 0.5);
  return Math.round((acima + FATIA[ORDEM[i]] * dentro) * 10) / 10;
}
