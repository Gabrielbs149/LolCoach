/**
 * Nota da partida (0–10) pra cada um dos 10, como o OP Score: compara cada jogador
 * com os outros nove NA MESMA partida — KDA, fatia do dano, fatia do gold, CS por
 * minuto (sup pesa visão no lugar), participação em kills, torres/objetivos.
 * MVP = melhor do time que ganhou; ACE = melhor do time que perdeu.
 *
 * Também sai daqui o que a lista de partidas mostra em cima do mesmo cálculo:
 * a fase de lane em % (gold aos 15 contra quem estava na sua lane), o elo médio
 * da partida (quando o elo dos 10 está guardado) e os selos (penta, quadra,
 * tripla, carregou, surrender/remake).
 */

const PESO = { kda: 0.28, dano: 0.22, ouro: 0.14, cs: 0.14, visao: 0.08, part: 0.09, obj: 0.05 };
const PESO_SUP = { kda: 0.26, dano: 0.14, ouro: 0.08, cs: 0.02, visao: 0.28, part: 0.14, obj: 0.08 };
const ehSup = (r) => /sup|utility|suporte/i.test(String(r ?? ''));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 0..1 relativo ao melhor da partida (1 = o melhor). */
const rel = (v, max) => (max > 0 ? clamp(v / max, 0, 1) : 0);

export function notasDaPartida(jogadores, { duracaoS = 1800, vencedor = null, eventos = [] } = {}) {
  const min = Math.max(1, duracaoS / 60);
  const kdaDe = (j) => (j.kills + j.assists) / Math.max(1, j.deaths) + (j.deaths === 0 ? 1 : 0);
  const porTime = new Map();
  for (const j of jogadores) { const t = porTime.get(j.time) ?? { kills: 0 }; t.kills += j.kills; porTime.set(j.time, t); }
  // objetivos: torres e monstros grandes em que o jogador foi autor (os eventos têm só o autor)
  const obj = new Map();
  for (const e of eventos) {
    if (e.tipo === 'BUILDING_KILL' && e.autorId) obj.set(e.autorId, (obj.get(e.autorId) ?? 0) + 1);
    if (e.tipo === 'ELITE_MONSTER_KILL' && e.autorId) obj.set(e.autorId, (obj.get(e.autorId) ?? 0) + 2);
  }
  const bruto = jogadores.map((j) => ({
    j,
    kda: kdaDe(j), dano: j.dano ?? 0, ouro: j.ouro ?? 0, csMin: (j.cs ?? 0) / min, visao: j.visao ?? 0,
    part: porTime.get(j.time)?.kills ? (j.kills + j.assists) / porTime.get(j.time).kills : 0,
    obj: obj.get(j.participantId ?? j.id) ?? 0,
  }));
  const max = (k) => Math.max(...bruto.map((b) => b[k]), 0);
  const M = { kda: max('kda'), dano: max('dano'), ouro: max('ouro'), csMin: max('csMin'), visao: max('visao'), part: max('part'), obj: max('obj') };
  const saida = new Map();
  const notasCruas = bruto.map((b) => {
    const p = ehSup(b.j.role) ? PESO_SUP : PESO;
    const n = p.kda * rel(b.kda, M.kda) + p.dano * rel(b.dano, M.dano) + p.ouro * rel(b.ouro, M.ouro) + p.cs * rel(b.csMin, M.csMin)
      + p.visao * rel(b.visao, M.visao) + p.part * rel(b.part, M.part) + p.obj * rel(b.obj, M.obj);
    return { id: b.j.participantId ?? b.j.id, time: b.j.time, n };
  });
  // escala: o melhor da partida fica perto de 10, o pior perto de 3; metade pela posição, metade pelo valor
  const ord = [...notasCruas].sort((a, b) => b.n - a.n);
  const maxN = ord[0]?.n || 1;
  for (const [i, x] of ord.entries()) {
    const porPosicao = 10 - (i / Math.max(1, ord.length - 1)) * 6.5;
    const porValor = 3 + 7 * (x.n / maxN);
    saida.set(x.id, { nota: Math.round((0.5 * porPosicao + 0.5 * porValor) * 10) / 10, mvp: false, ace: false });
  }
  if (vencedor != null) {
    const melhorDe = (time) => ord.find((x) => x.time === time);
    const v = melhorDe(vencedor), p = melhorDe(vencedor === 100 ? 200 : 100);
    if (v) saida.get(v.id).mvp = true;
    if (p) saida.get(p.id).ace = true;
  }
  return saida;
}

/** Fase de lane em % (0–100 = quanto do gold da lane aos 15 era seu/da sua dupla). null sem frame aos 15. */
export function laningPct(framesAos15, meuId, jogadores, minhaRole) {
  if (!framesAos15?.length) return null;
  const eu = jogadores.find((j) => (j.participantId ?? j.id) === meuId); if (!eu) return null;
  const bot = /adc|sup|utility|suporte|bottom/i.test(String(minhaRole ?? eu.role));
  const daLane = (j) => bot ? /adc|sup|utility|suporte|bottom/i.test(String(j.role)) : String(j.role).toLowerCase() === String(eu.role).toLowerCase();
  const ouro = (time) => framesAos15.filter((f) => { const j = jogadores.find((x) => (x.participantId ?? x.id) === f.participantId); return j && j.time === time && daLane(j); }).reduce((s, f) => s + (f.ouroTotal ?? 0), 0);
  const meu = ouro(eu.time), deles = ouro(eu.time === 100 ? 200 : 100);
  if (!meu && !deles) return null;
  return Math.round(100 * meu / (meu + deles));
}

/** Selos da partida pra lista: penta/quadra/tripla, carregou, surrender, remake. */
export function selosDaPartida({ eu, eventos = [], duracaoS = 0, venci = false, nota = null, notas = null, dano = 0, danoTime = 0 }) {
  const selos = [];
  const multi = eventos.filter((e) => e.tipo === 'CHAMPION_KILL' && e.autorId === eu.id).map((e) => e.t).sort((a, b) => a - b);
  // multi-kill: kills a menos de 10 s uma da outra
  let seq = 1, melhor = 1;
  for (let i = 1; i < multi.length; i++) { seq = multi[i] - multi[i - 1] <= 10000 ? seq + 1 : 1; melhor = Math.max(melhor, seq); }
  if (melhor >= 5) selos.push('PENTA'); else if (melhor === 4) selos.push('QUADRA'); else if (melhor === 3) selos.push('TRIPLA');
  if (duracaoS > 0 && duracaoS < 300) selos.push('REMAKE');
  else if (duracaoS > 0 && duracaoS < 1080 && !venci) selos.push('SURRENDER');
  if (venci && danoTime > 0 && dano / danoTime >= 0.34 && (nota ?? 0) >= 8) selos.push('CARREGOU');
  return selos;
}
