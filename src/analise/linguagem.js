/**
 * Como o texto sai pro Gabriel.
 *
 * A tradução oficial da Riot ("rota superior", "sentinela", "caçador") não é o
 * que ninguém fala. E distância em unidade do jogo ("7.1k") não quer dizer nada
 * pra quem joga — o que ele entende é quanto tempo de caminhada.
 */

// Velocidade de movimento típica com botas. Serve pra converter distância em
// algo que dá pra sentir: segundos até chegar lá.
const VELOCIDADE = 350;

/**
 * Distância no linguajar de quem joga, e não em unidade interna.
 * Perto demais vira descrição; longe vira tempo de caminhada.
 */
export function distancia(unidades) {
  if (unidades == null) return '';
  if (unidades < 900) return 'em cima de você';
  if (unidades < 1800) return 'do seu lado';
  if (unidades < 3000) return 'a meia tela';

  const s = Math.round(unidades / VELOCIDADE);
  if (unidades > 10000) return `a ${s}s de caminhada, do outro lado do mapa`;
  return `a ${s}s de caminhada`;
}

/** Só o número em segundos, pra quando a frase já tem o contexto. */
export function segundosDeCaminhada(unidades) {
  return Math.round(unidades / VELOCIDADE);
}

// A role como ele chama, não como o client escreve.
const ROLES = {
  TOP: 'top', JUNGLE: 'jungle', MID: 'mid',
  ADC: 'adc', SUPORTE: 'sup', BOT: 'bot',
};

export const role = (r) => ROLES[r] ?? String(r ?? '').toLowerCase();

/** "o jungler", "o mid" — pra usar no meio da frase. */
export const oRole = (r) => `o ${role(r)}`;
