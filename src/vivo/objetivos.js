/**
 * Quando cada objetivo nasce, a partir do relógio da partida e do feed de
 * eventos — os dois vêm da API que o próprio jogo abre (127.0.0.1:2999).
 * Nada de posição, nada de tela: só conta de relógio, como qualquer jogador
 * faz de cabeça.
 *
 * Horários medidos nas partidas dele de 2026 (primeiro abate mais cedo em
 * centenas de jogos): dragão 5:00 e renasce 5:00; vastilarvas 8:00 (um campo
 * de três, some antes do arauto); arauto 15:00 (some no barão); barão 20:00
 * e renasce 6:00; ancião 5:00 depois do quarto dragão.
 */
const DRAGAO_PRIMEIRO = 5 * 60, DRAGAO_RENASCE = 5 * 60;
const ARAUTO = 15 * 60;
const BARAO_PRIMEIRO = 20 * 60, BARAO_RENASCE = 6 * 60;
const LARVAS = 8 * 60, LARVAS_SOMEM = 13 * 60 + 45;
const ELDER_DEPOIS_DA_ALMA = 5 * 60;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function objetivos(estado) {
  const t = estado.tempo ?? 0;
  const ev = estado.eventos ?? [];
  const ultimo = (tipo) => ev.filter((e) => e.tipo === tipo).at(-1) ?? null;

  const saida = [];
  const dragoes = ev.filter((e) => e.tipo === 'DragonKill');
  const dragao = dragoes.at(-1) ?? null;
  // Alma fechada (um time com 4): o próximo é o Ancião, 6 min depois.
  const porTime = {}; for (const d of dragoes) porTime[d.autor] = (porTime[d.autor] ?? 0) + 1;
  const alma = dragoes.length >= 4;
  const proxDragao = dragao ? dragao.t + (alma || dragao.dragao === 'Elder' ? ELDER_DEPOIS_DA_ALMA : DRAGAO_RENASCE) : DRAGAO_PRIMEIRO;
  saida.push({ nome: alma ? 'Ancião' : 'Dragão', em: proxDragao - t, detalhe: dragao ? `último: ${dragao.dragao ?? ''} ${dragao.roubado ? '(roubado)' : ''}`.trim() : 'primeiro' });
  if (ev.filter((e) => e.tipo === 'HordeKill').length < 3 && t < LARVAS_SOMEM) saida.push({ nome: 'Vastilarvas', em: LARVAS - t, detalhe: 'um campo' });

  if (!ultimo('HeraldKill') && t < BARAO_PRIMEIRO) saida.push({ nome: 'Arauto', em: ARAUTO - t, detalhe: 'um só' });

  const barao = ultimo('BaronKill');
  saida.push({ nome: 'Barão', em: (barao ? barao.t + BARAO_RENASCE : BARAO_PRIMEIRO) - t, detalhe: barao ? 'renasce' : 'primeiro' });

  return saida.map((o) => ({ ...o, quando: o.em <= 0 ? 'no mapa' : `em ${mmss(o.em)}`, vivo: o.em <= 0 }));
}
