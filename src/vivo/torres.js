/**
 * Nome interno da torre → de quem é, lane e camada.
 *
 * Formato atual (medido nas partidas de 16/09/2026 pelas posições de quem
 * derrubou): Turret_TOrder_L0_P3_<id>_0 — Order = lado azul (time 100),
 * Chaos = vermelho (200); L0 = bot, L1 = mid, L2 = top (igual pros dois
 * lados); P3 = externa, P2 = interna, P1 = do inibidor, P4/P5 = do nexus
 * (ficam sob L1).
 * Formato antigo: Turret_T1_C_05_A — T1 azul/T2 vermelho; C = mid; L/R são
 * do ponto de vista de cada base (T1: L = top, R = bot; T2: L = bot, R = top);
 * C_03 e L/R_01 = inibidor; C_01/C_02 = nexus.
 */
export function torreInfo(nome) {
  const s = String(nome ?? '');
  let m = s.match(/Turret_T(Order|Chaos)_L(\d)_P(\d)/);
  if (m) {
    const lane = { 0: 'bot', 1: 'mid', 2: 'top' }[m[2]] ?? null;
    const p = Number(m[3]);
    return { time: m[1] === 'Order' ? 100 : 200, lane: p >= 4 ? null : lane, camada: p >= 4 ? 'nexus' : p === 1 ? 'inib' : p === 2 ? 'interna' : 'externa' };
  }
  m = s.match(/Turret_T(\d)_([LRC])_(\d\d)/);
  if (m) {
    const time = m[1] === '1' ? 100 : 200;
    const lane = m[2] === 'C' ? 'mid' : (time === 200 ? { L: 'bot', R: 'top' } : { L: 'top', R: 'bot' })[m[2]];
    const nexus = m[2] === 'C' && (m[3] === '01' || m[3] === '02');
    const inib = (m[2] === 'C' && m[3] === '03') || (m[2] !== 'C' && m[3] === '01');
    return { time, lane: nexus ? null : lane, camada: nexus ? 'nexus' : inib ? 'inib' : 'externa' };
  }
  return null;
}
