/**
 * Quando cada objetivo nasce, a partir do relógio da partida e do feed de
 * eventos — os dois vêm da API que o próprio jogo abre (127.0.0.1:2999).
 * Nada de posição, nada de tela: só conta de relógio, como qualquer jogador
 * faz de cabeça.
 *
 * Horários da temporada atual (mudam com patch — ajuste aqui se a Riot
 * mexer): dragão 5:00 e renasce 5:00 depois de morrer; arauto 15:00 (um
 * só); barão 25:00 e renasce 6:00.
 */
const DRAGAO_PRIMEIRO = 5 * 60, DRAGAO_RENASCE = 5 * 60;
const ARAUTO = 15 * 60;
const BARAO_PRIMEIRO = 25 * 60, BARAO_RENASCE = 6 * 60;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function objetivos(estado) {
  const t = estado.tempo ?? 0;
  const ev = estado.eventos ?? [];
  const ultimo = (tipo) => ev.filter((e) => e.tipo === tipo).at(-1) ?? null;

  const saida = [];
  const dragao = ultimo('DragonKill');
  const proxDragao = dragao ? dragao.t + DRAGAO_RENASCE : DRAGAO_PRIMEIRO;
  saida.push({ nome: 'Dragão', em: proxDragao - t, detalhe: dragao ? `último: ${dragao.dragao ?? ''} ${dragao.roubado ? '(roubado)' : ''}`.trim() : 'primeiro' });

  if (!ultimo('HeraldKill') && t < ARAUTO + 8 * 60) saida.push({ nome: 'Arauto', em: ARAUTO - t, detalhe: 'um só' });

  const barao = ultimo('BaronKill');
  saida.push({ nome: 'Barão', em: (barao ? barao.t + BARAO_RENASCE : BARAO_PRIMEIRO) - t, detalhe: barao ? 'renasce' : 'primeiro' });

  return saida.map((o) => ({ ...o, quando: o.em <= 0 ? 'no mapa' : `em ${mmss(o.em)}`, vivo: o.em <= 0 }));
}
