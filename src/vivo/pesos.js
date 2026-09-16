/**
 * Cérebro v2: pesos aprendidos do que ficou gravado.
 *
 * Cada tipo de situação (chave base) acumula evidência de quatro fontes:
 *   👍 / 👎 de quem ouviu (Num 6 / Num 9, janela ao vivo, Admin)
 *   ✓ / ✗ da auto-avaliação (a previsão aconteceu ou não)
 * separada por fase do jogo (cedo < 10 min, meio < 20, tarde) e pela sua
 * função. O peso é um ajuste na nota do cérebro, com encolhimento: pouca
 * evidência → perto de zero; muita evidência ruim → cala; muita boa → sobe.
 * A chave fina (tipo|fase|função) só vale com 5+ evidências; senão cai pra
 * tipo|fase, e por fim pro tipo sozinho.
 */
export const fase = (t) => (t < 600 ? 'cedo' : t < 1200 ? 'meio' : 'tarde');

export function novaEvidencia() { return { bom: 0, ruim: 0, certas: 0, erradas: 0 }; }

/** Ajuste na nota a partir da evidência: entre −2 (cala) e +1,5. */
export function ajuste(e) {
  if (!e) return 0;
  const n = e.bom + e.ruim + e.certas + e.erradas;
  if (!n) return 0;
  const sinal = e.bom - 1.5 * e.ruim + 0.5 * (e.certas - e.erradas);
  return Math.max(-2, Math.min(1.5, (sinal / (n + 4)) * 2.5));
}

/**
 * `evidencias`: Map de "tipo", "tipo|fase" e "tipo|fase|funcao" → evidência.
 * Devolve o ajuste mais específico que tem 5+ evidências.
 */
export function ajusteDe(evidencias, tipo, t, funcao) {
  if (!evidencias) return 0;
  const f = fase(t);
  for (const k of [`${tipo}|${f}|${funcao}`, `${tipo}|${f}`, tipo]) {
    const e = evidencias.get(k);
    if (e && e.bom + e.ruim + e.certas + e.erradas >= (k === tipo ? 1 : 5)) return ajuste(e);
  }
  return 0;
}

/** Junta um registro (situação ou fala) nas três chaves. */
export function somar(evidencias, tipo, t, funcao, campo) {
  const f = fase(t);
  for (const k of [tipo, `${tipo}|${f}`, `${tipo}|${f}|${funcao}`]) {
    const e = evidencias.get(k) ?? evidencias.set(k, novaEvidencia()).get(k);
    e[campo]++;
  }
}
