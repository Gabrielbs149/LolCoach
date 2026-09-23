import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pastaBase } from '../caminhos.js';
import { tabelaDeIds, listaDeCampeoes } from './ddragon.js';

/**
 * Estatísticas de campeão por posição (a página "Champions" do op.gg): taxa de vitória,
 * pick, ban, KDA, tier e posição no ranking com a variação contra o patch anterior —
 * por região (BR, KR, global) e faixa de elo. E o "detector de abuso": o que está
 * subindo agora, e o que os coreanos de Mestre+ estão jogando com winrate alto e
 * aqui ninguém joga ainda.
 */
const BASE = 'https://lol-api-champion.op.gg/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const POSICOES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const CACHE_MS = 3 * 60 * 60 * 1000;
const memo = new Map();

async function baixar(regiao, tier) {
  const chave = `${regiao}-${tier}`;
  const m = memo.get(chave); if (m && Date.now() - m.em < CACHE_MS) return m.dados;
  const arq = resolve(pastaBase(), 'dados', 'meta', `${chave}.json`);
  try { const c = JSON.parse(await readFile(arq, 'utf8')); if (Date.now() - Date.parse(c.em) < CACHE_MS) { memo.set(chave, { em: Date.parse(c.em), dados: c.dados }); return c.dados; } } catch { /* sem cache */ }
  const r = await fetch(`${BASE}/${regiao}/champions/ranked?tier=${tier}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`op.gg respondeu HTTP ${r.status}`);
  const j = await r.json();
  const ids = await tabelaDeIds().catch(() => new Map());
  const nomes = new Map((await listaDeCampeoes().catch(() => [])).map((c) => [c.id, c.nome]));   // nome em português, como aparece no jogo
  const dados = { patch: j.meta?.version ?? null, partidas: j.meta?.match_count ?? null, em: j.meta?.analyzed_at ?? null, posicoes: {} };
  for (const pos of POSICOES) dados.posicoes[pos] = [];
  for (const c of j.data ?? []) {
    for (const p of c.positions ?? []) {
      const s = p.stats ?? {}; const td = s.tier_data ?? {};
      if (!POSICOES.includes(p.name) || (s.play ?? 0) < 30) continue;
      dados.posicoes[p.name].push({ id: c.id, nome: nomes.get(c.id) ?? ids.get(c.id) ?? String(c.id), chave: ids.get(c.id) ?? null, jogos: s.play, taxa: Math.round(1000 * s.win_rate) / 10, pick: Math.round(1000 * s.pick_rate) / 10, ban: Math.round(1000 * (s.ban_rate ?? 0)) / 10, kda: Math.round(100 * (s.kda ?? 0)) / 100, tier: td.tier ?? null, rank: td.rank ?? null, rankAntes: td.rank_prev_patch ?? null, fatiaRota: Math.round(100 * (s.role_rate ?? 0)) });
    }
  }
  for (const pos of POSICOES) dados.posicoes[pos].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  memo.set(chave, { em: Date.now(), dados });
  await mkdir(resolve(pastaBase(), 'dados', 'meta'), { recursive: true }).catch(() => {});
  await writeFile(arq, JSON.stringify({ em: new Date().toISOString(), dados })).catch(() => {});
  return dados;
}

export async function metaPorPosicao({ regiao = 'br', tier = 'emerald_plus' } = {}) {
  return baixar(regiao, tier);
}

/**
 * O que está subindo e o que é "abuso escondido":
 *  - subindo: subiu 5+ posições no ranking da rota contra o patch anterior (BR Esmeralda+), com amostra
 *  - abuso escondido: KR Mestre+ com 53%+ e 1%+ de pick, mas no BR Esmeralda+ com menos de 1% de pick
 *  - coreanos: os 3 de maior winrate por rota em KR Mestre+ com pick decente
 */
export async function radarDeAbuso() {
  const [br, kr] = await Promise.all([baixar('br', 'emerald_plus'), baixar('kr', 'master_plus')]);
  const saida = { patch: br.patch, subindo: [], escondidos: [], coreanos: [] };
  for (const pos of POSICOES) {
    const lb = br.posicoes[pos] ?? [], lk = kr.posicoes[pos] ?? [];
    const brDe = new Map(lb.map((c) => [c.id, c]));
    for (const c of lb) if (c.rankAntes && c.rank && c.rankAntes - c.rank >= 5 && c.jogos >= 300 && c.taxa >= 50) saida.subindo.push({ ...c, posicao: pos, subiu: c.rankAntes - c.rank });
    for (const c of lk) {
      const b = brDe.get(c.id);
      if (c.taxa >= 52 && c.pick >= 0.7 && c.jogos >= 50 && (!b || b.pick < 1.5 || c.pick >= b.pick * 2.5)) saida.escondidos.push({ ...c, posicao: pos, pickBr: b?.pick ?? 0, taxaBr: b?.taxa ?? null });
    }
    for (const c of [...lk].filter((c) => c.pick >= 2 && c.jogos >= 100).sort((a, b) => b.taxa - a.taxa).slice(0, 3)) saida.coreanos.push({ ...c, posicao: pos, pickBr: brDe.get(c.id)?.pick ?? 0, taxaBr: brDe.get(c.id)?.taxa ?? null });
  }
  saida.subindo.sort((a, b) => b.subiu - a.subiu);
  saida.escondidos.sort((a, b) => b.taxa - a.taxa);
  return saida;
}
