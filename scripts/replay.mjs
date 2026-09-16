/**
 * Replay de uma partida gravada: roda situacoes.js + cerebro.js de novo em
 * cima de leituras.jsonl/estado.jsonl e diz quantas falas sairiam com as
 * regras ATUAIS — pra medir uma mudança sem esperar a próxima partida.
 *
 *   node scripts/replay.mjs <pasta-da-partida> [outra pasta…]
 *   (pasta = %APPDATA%/LolCoach/dados/situacoes/<data-campeao>, ou uma cópia)
 *
 * As leituras guardam o mundo já digerido (x, y, "há quanto tempo"); aqui a
 * leitura crua é reconstruída como "quem foi visto neste segundo" (ha ≤ 1).
 * Eventos (dragão, torre…) não estão gravados: objetivos ficam no padrão.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as S from '../src/vivo/situacoes.js';
import * as Cb from '../src/vivo/cerebro.js';
import { objetivos } from '../src/vivo/objetivos.js';
import { render } from '../src/vivo/texto.js';

const lerJsonl = async (p) => (await readFile(p, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function replay(pasta) {
  const [partida, leituras, estados] = await Promise.all([lerJsonl(resolve(pasta, 'partida.json')), lerJsonl(resolve(pasta, 'leituras.jsonl')), lerJsonl(resolve(pasta, 'estado.jsonl'))]);
  const p = partida[0];
  if (!p?.eu || !leituras.length) { console.log(`${pasta}: sem gravação completa`); return null; }
  const LANE_DE = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'bot', sup: 'bot' };
  const mundo = S.novoMundo();
  const mem = Cb.novaMemoriaCerebro();
  const porTipo = new Map(), faladas = [];
  let total = 0, ie = 0;
  for (const l of leituras) {
    while (ie + 1 < estados.length && estados[ie + 1].t <= l.t) ie++;
    const e = estados[ie] ?? estados[0];
    const jogadores = p.jogadores.map((j) => {
      const s = e?.jogadores?.find((x) => x.c === j.campeao && x.time === j.time) ?? {};
      return { ...j, nivel: s.nivel ?? 1, kills: s.k ?? 0, mortes: s.m ?? 0, assists: s.a ?? 0, cs: s.cs ?? 0, morto: !!s.morto, renasceEm: s.renasce ?? 0, itens: (s.itens ?? []).map((id) => ({ id })), spells: j.nome === p.eu.nome ? p.eu.spells : [] };
    });
    const eu = { ...jogadores.find((j) => j.nome === p.eu.nome), ouro: e?.eu?.ouro ?? 0, vida: e?.eu?.vida ?? 1, vidaMax: e?.eu?.vidaMax ?? 1 };
    const estado = { tempo: l.t, eu, jogadores, eventos: [], vidaMax: eu.vidaMax };
    const vistoAgora = (c) => c.x != null && c.ha != null && c.ha <= 1;
    const leitura = {
      vistos: l.campeoes.filter((c) => c.time !== p.eu.time && vistoAgora(c)).map((c) => ({ campeao: c.c, x: c.x, y: c.y })),
      aliados: l.campeoes.filter((c) => c.time === p.eu.time && c.c !== p.eu.campeao && vistoAgora(c)).map((c) => ({ campeao: c.c, x: c.x, y: c.y })),
      eu: (() => { const me = l.campeoes.find((c) => c.c === p.eu.campeao && c.time === p.eu.time); return me && vistoAgora(me) ? { x: me.x, y: me.y } : null; })(),
      waves: l.waves ?? null, wards: l.wards ? { nossas: l.wards.nossas.map(([x, y, tipo]) => ({ x, y, tipo })), deles: [] } : null,
    };
    const situacoes = S.processar(mundo, leitura, estado, objetivos(estado));
    Cb.decidir(situacoes, { t: l.t, minhaLane: LANE_DE[eu.role] ?? null, minhaRole: eu.role, notas: null, silenciadas: null }, mem);
    for (const s of situacoes) {
      total++;
      const k = Cb.baseChave(s.chave);
      const r = porTipo.get(k) ?? porTipo.set(k, { n: 0, faladas: 0 }).get(k);
      r.n++; if (s.falar) { r.faladas++; faladas.push({ t: l.t, texto: render(s.serio) }); }
    }
  }
  const min = (leituras.at(-1).t - leituras[0].t) / 60;
  console.log(`${pasta.split(/[\\/]/).at(-1)}: ${total} situações, ${faladas.length} faladas em ${min.toFixed(0)} min (${(faladas.length / min).toFixed(1)}/min)`);
  console.log('  ' + [...porTipo].sort((a, b) => b[1].faladas - a[1].faladas).slice(0, 12).map(([k, r]) => `${k} ${r.faladas}/${r.n}`).join(', '));
  if (process.argv.includes('--falas')) for (const f of faladas) console.log(`  ${Math.floor(f.t / 60)}:${String(Math.floor(f.t % 60)).padStart(2, '0')} ${f.texto}`);
  return { total, faladas: faladas.length, min };
}

const pastas = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!pastas.length) { console.log('uso: node scripts/replay.mjs <pasta> [--falas]'); process.exit(1); }
for (const p of pastas) await replay(p);
