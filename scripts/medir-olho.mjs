/**
 * Antes x depois da correção do ícone (26/09): quanto o olho enxerga e quanto erra,
 * medido contra os frames da Riot. Aliado vivo está SEMPRE no minimapa.
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BASE = 'C:/Users/Gabriel/AppData/Roaming/lolcoach/dados/situacoes';
const db = new DatabaseSync('C:/Users/Gabriel/AppData/Roaming/lolcoach/dados/partidas.db', { readOnly: true });
const MAPA = 14820;
const CORTE = '2026-09-26T12';   // a correção entrou na manhã do dia 26

const grupos = { antes: novo(), depois: novo() };
function novo() { return { partidas: 0, aliEsperados: 0, aliVistos: 0, euEsp: 0, euViu: 0, conf: 0, longe: 0, porCampeao: new Map() }; }

for (const pasta of (await readdir(BASE).catch(() => [])).sort()) {
  const pTxt = await readFile(resolve(BASE, pasta, 'partida.json'), 'utf8').catch(() => '');
  if (!pTxt.trim()) continue;
  const info = JSON.parse(pTxt.split('\n')[0]);
  const gameId = info?.gameId; if (!gameId) continue;
  const frames = db.prepare('SELECT minuto, participantId, x, y FROM frames WHERE gameId = ?').all(gameId);
  if (!frames.length) continue;
  const jogs = db.prepare('SELECT participantId, campeao, time FROM jogadores WHERE gameId = ?').all(gameId);
  const porId = new Map(jogs.map((j) => [j.participantId, j]));
  const meuCampeao = info?.eu?.campeao;
  const meu = jogs.find((j) => j.campeao === meuCampeao); if (!meu) continue;

  const leituras = [];
  for (const l of (await readFile(resolve(BASE, pasta, 'leituras.jsonl'), 'utf8').catch(() => '')).split('\n')) { if (!l.trim()) continue; try { leituras.push(JSON.parse(l)); } catch {} }
  if (!leituras.length) continue;

  const g = grupos[pasta < CORTE ? 'antes' : 'depois'];
  g.partidas++;

  for (const minuto of [...new Set(frames.map((f) => f.minuto))]) {
    const tAlvo = minuto * 60;
    let L = null, dt = 1e9;
    for (const x of leituras) { const d = Math.abs((x.t ?? 0) - tAlvo); if (d < dt) { dt = d; L = x; } }
    if (!L || dt > 3) continue;
    const frescos = new Map((L.campeoes ?? []).filter((c) => c.ha != null && c.ha <= 1.5 && c.x != null).map((c) => [c.c, c]));
    const mortos = new Set((L.campeoes ?? []).filter((c) => c.morto).map((c) => c.c));
    for (const f of frames.filter((x) => x.minuto === minuto)) {
      const j = porId.get(f.participantId); if (!j || mortos.has(j.campeao)) continue;
      const real = { x: f.x / MAPA, y: 1 - f.y / MAPA };
      const visto = frescos.get(j.campeao);
      if (j.campeao === meuCampeao) { g.euEsp++; if (visto) g.euViu++; continue; }
      if (j.time === meu.time) {
        g.aliEsperados++;
        const r = g.porCampeao.get(j.campeao) ?? { n: 0, viu: 0 };
        r.n++;
        if (visto) { g.aliVistos++; r.viu++; }
        g.porCampeao.set(j.campeao, r);
      }
      if (visto) { g.conf++; if (Math.hypot(visto.x - real.x, visto.y - real.y) > 0.12) g.longe++; }
    }
  }
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
for (const [nome, g] of Object.entries(grupos)) {
  console.log(`\n=== ${nome.toUpperCase()} da correção — ${g.partidas} partidas`);
  console.log(`  aliados achados (sempre visíveis): ${pct(g.aliVistos, g.aliEsperados)}  (${g.aliVistos}/${g.aliEsperados})`);
  console.log(`  você mesmo:                        ${pct(g.euViu, g.euEsp)}  (${g.euViu}/${g.euEsp})`);
  console.log(`  das que viu, longe da verdade:     ${pct(g.longe, g.conf)}  (${g.longe}/${g.conf})`);
}

const d = grupos.depois;
if (d.partidas) {
  const piores = [...d.porCampeao].filter(([, r]) => r.n >= 10).map(([c, r]) => ({ c, n: r.n, pct: Math.round(100 * r.viu / r.n) })).sort((a, b) => a.pct - b.pct).slice(0, 10);
  console.log('\nainda piores (depois da correção):');
  for (const p of piores) console.log(`  ${p.c.padEnd(16)} ${String(p.pct).padStart(3)}%  (${p.n})`);
}
