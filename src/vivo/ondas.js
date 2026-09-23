/**
 * As ondas de minions — e principalmente onde está o canhão.
 *
 * O canhão vale quase três minions juntos: é ele que decide se a wave empurra, se
 * dá pra voltar pra base sem perder farm e se o congelamento aguenta. Nenhum app
 * avisa isso e é informação de relógio pura, não precisa ler nada do jogo.
 *
 * Regras da fila normal (Summoner's Rift):
 *  - a primeira onda nasce em 1:05 e nasce outra a cada 30 s;
 *  - até 15:00, canhão a cada 3 ondas (a 3ª, a 6ª, a 9ª…);
 *  - de 15:00 a 25:00, a cada 2 ondas;
 *  - depois de 25:00, toda onda tem canhão.
 */

const PRIMEIRA = 65;      // segundos
const INTERVALO = 30;

/** Em que segundo a onda `n` (1 = a primeira) nasce. */
export const nasceEm = (n) => PRIMEIRA + INTERVALO * (n - 1);

/** A onda `n` tem canhão? */
export function temCanhao(n) {
  const t = nasceEm(n);
  if (t >= 1500) return true;          // depois de 25:00, todas
  if (t >= 900) return n % 2 === 0;    // de 15:00 a 25:00, uma sim uma não
  return n % 3 === 0;                  // até 15:00, a cada três
}

/** O número da onda que está nascendo em `tempo` (0 antes da primeira). */
export const ondaEm = (tempo) => (tempo < PRIMEIRA ? 0 : Math.floor((tempo - PRIMEIRA) / INTERVALO) + 1);

/** A próxima onda com canhão a partir de `tempo`: { n, nasce, faltam }. */
export function proximoCanhao(tempo) {
  for (let n = Math.max(1, ondaEm(tempo) + 1); n <= 200; n++) {
    if (!temCanhao(n)) continue;
    const nasce = nasceEm(n);
    if (nasce <= tempo) continue;
    return { n, nasce, faltam: Math.round(nasce - tempo) };
  }
  return null;
}

/** Lista das ondas até `ate` segundos — pra conferir a regra de uma vez só. */
export function ondasAte(ate = 30 * 60) {
  const saida = [];
  for (let n = 1; nasceEm(n) <= ate; n++) saida.push({ n, nasce: nasceEm(n), canhao: temCanhao(n) });
  return saida;
}
