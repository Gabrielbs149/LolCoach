/**
 * Item 2: o limiar da fala de rota (hoje 0,82) foi chute meu. Agora as leituras
 * guardam nota e anel, então dá pra ver, contra a verdade da Riot, qual corte
 * separa de verdade o acerto do erro.
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BASE = 'C:/Users/Gabriel/AppData/Roaming/lolcoach/dados/situacoes';
const db = new DatabaseSync('C:/Users/Gabriel/AppData/Roaming/lolcoach/dados/partidas.db', { readOnly: true });
const MAPA = 14820;
const amostras = [];

for (const pasta of (await readdir(BASE).catch(() => [])).sort()) {
  const pTxt = await readFile(resolve(BASE, pasta, 'partida.json'), 'utf8').catch(() => '');
  if (!pTxt.trim()) continue;
  const info = JSON.parse(pTxt.split('\n')[0]);
  if (!info?.gameId) continue;
  const frames = db.prepare('SELECT minuto, participantId, x, y FROM frames WHERE gameId = ?').all(info.gameId);
  if (!frames.length) continue;
  const porId = new Map(db.prepare('SELECT participantId, campeao FROM jogadores WHERE gameId = ?').all(info.gameId).map((j) => [j.participantId, j.campeao]));
  const verdade = new Map();
  for (const f of frames) { const c = porId.get(f.participantId); if (!c) continue; verdade.set(`${f.minuto}|${c}`, { x: f.x / MAPA, y: 1 - f.y / MAPA }); }

  const leituras = [];
  for (const l of (await readFile(resolve(BASE, pasta, 'leituras.jsonl'), 'utf8').catch(() => '')).split('\n')) { if (!l.trim()) continue; try { leituras.push(JSON.parse(l)); } catch {} }

  for (const [chave, real] of verdade) {
    const [minuto, campeao] = chave.split('|');
    const tAlvo = Number(minuto) * 60;
    let L = null, dt = 1e9;
    for (const x of leituras) { const d = Math.abs((x.t ?? 0) - tAlvo); if (d < dt) { dt = d; L = x; } }
    if (!L || dt > 3) continue;
    const c = (L.campeoes ?? []).find((z) => z.c === campeao);
    if (!c || c.x == null || c.score == null) continue;      // só leitura com evidência
    if (!(c.ha != null && c.ha <= 1.5)) continue;
    amostras.push({ score: c.score, anel: c.anel, seguido: c.seguido, erro: Math.hypot(c.x - real.x, c.y - real.y) > 0.12 });
  }
}

console.log(`${amostras.length} leituras com evidência E verdade da Riot\n`);
if (!amostras.length) process.exit(0);

const taxa = (l) => (l.length ? `${Math.round((100 * l.filter((a) => a.erro).length) / l.length)}% erradas de ${l.length}` : '—');
console.log('POR ANEL');
console.log('  com anel :', taxa(amostras.filter((a) => a.anel === true)));
console.log('  sem anel :', taxa(amostras.filter((a) => a.anel === false)));
console.log('  sem dado :', taxa(amostras.filter((a) => a.anel == null)));

console.log('\nPOR NOTA DO CASAMENTO');
for (const [de, ate] of [[0, 0.7], [0.7, 0.8], [0.8, 0.85], [0.85, 0.9], [0.9, 2]]) {
  console.log(`  ${de}–${ate}: ${taxa(amostras.filter((a) => a.score >= de && a.score < ate))}`);
}

console.log('\nO QUE CADA CORTE CUSTA (quanto sobra pra falar x quanto erra)');
for (const corte of [0, 0.7, 0.75, 0.8, 0.82, 0.85, 0.9]) {
  const passa = amostras.filter((a) => a.anel === true || a.score >= corte);
  console.log(`  anel OU nota ≥ ${corte}: passa ${Math.round((100 * passa.length) / amostras.length)}% das leituras, e dessas ${taxa(passa)}`);
}
const soAnel = amostras.filter((a) => a.anel === true);
console.log(`  só com anel:            passa ${Math.round((100 * soAnel.length) / amostras.length)}% das leituras, e dessas ${taxa(soAnel)}`);
