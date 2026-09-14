/** Geometria do Summoner's Rift. Coordenadas vao de 0 a ~14820 nos dois eixos. */

export const LADO_AZUL = 100;   // base embaixo/esquerda
export const LADO_VERMELHO = 200; // base em cima/direita

export const LOCAIS = {
  DRAGAO: { x: 9866, y: 4414 },
  BARAO: { x: 4950, y: 10400 },
  BASE_AZUL: { x: 1100, y: 1100 },
  BASE_VERMELHA: { x: 13700, y: 13700 },
};

// Linhas das rotas como polilinhas. Top corre pela borda esquerda e depois pela
// de cima; bot pela de baixo e depois pela direita; mid e a diagonal.
const ROTAS = {
  TOP: [{ x: 900, y: 2500 }, { x: 1300, y: 11000 }, { x: 2600, y: 12900 }, { x: 11500, y: 13400 }],
  MID: [{ x: 2200, y: 2200 }, { x: 12700, y: 12700 }],
  BOT: [{ x: 2500, y: 900 }, { x: 11000, y: 1300 }, { x: 12900, y: 2600 }, { x: 13400, y: 11500 }],
};

const RAIO_ROTA = 1400;   // largura considerada "dentro da rota"
const RAIO_RIO = 1500;    // largura da faixa do rio
const RAIO_BASE = 2400;

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Menor distancia de um ponto ao segmento a-b. */
function distSegmento(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const comp = dx * dx + dy * dy;
  if (comp === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / comp;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function distRota(p, nome) {
  const pontos = ROTAS[nome];
  let menor = Infinity;
  for (let i = 0; i < pontos.length - 1; i++) menor = Math.min(menor, distSegmento(p, pontos[i], pontos[i + 1]));
  return menor;
}

/** Rota mais proxima do ponto, ou null se estiver longe de todas. */
export function rotaMaisProxima(p) {
  let melhor = null, menor = Infinity;
  for (const nome of ['TOP', 'MID', 'BOT']) {
    const d = distRota(p, nome);
    if (d < menor) { menor = d; melhor = nome; }
  }
  return menor <= RAIO_ROTA ? melhor : null;
}

/** Metade do mapa: TOPSIDE (acima da diagonal do mid) ou BOTSIDE. */
export function metade(p) {
  return p.y > p.x ? 'TOPSIDE' : 'BOTSIDE';
}

/** De qual time e o territorio onde o ponto esta. */
export function territorio(p) {
  return p.x + p.y < 14820 ? LADO_AZUL : LADO_VERMELHO;
}

/** true se o ponto esta no lado do mapa do time inimigo. */
export function emCampoInimigo(p, meuTime) {
  return territorio(p) !== meuTime;
}

/**
 * Tipo da região, como código estável.
 *
 * Existe porque os detectores precisam perguntar "isto é lane?" sem depender do
 * TEXTO exibido — quando os nomes mudaram de "rota superior" para "top", três
 * detectores que filtravam por regex no nome pararam de funcionar em silêncio.
 */
export function tipoDeZona(p) {
  if (dist(p, LOCAIS.BASE_AZUL) < RAIO_BASE || dist(p, LOCAIS.BASE_VERMELHA) < RAIO_BASE) return 'BASE';
  if (dist(p, LOCAIS.DRAGAO) < 1250 || dist(p, LOCAIS.BARAO) < 1250) return 'PIT';
  if (rotaMaisProxima(p)) return 'LANE';
  if (Math.abs(p.x + p.y - 14820) < RAIO_RIO) return 'RIVER';
  return 'JUNGLE';
}

/** Nome legivel da regiao onde o ponto esta. */
export function zona(p) {
  if (dist(p, LOCAIS.BASE_AZUL) < RAIO_BASE) return 'base azul';
  if (dist(p, LOCAIS.BASE_VERMELHA) < RAIO_BASE) return 'base vermelha';
  if (dist(p, LOCAIS.DRAGAO) < 1250) return 'pit do dragão';
  if (dist(p, LOCAIS.BARAO) < 1250) return 'pit do barão';

  const rota = rotaMaisProxima(p);
  if (rota) return { TOP: 'top', MID: 'mid', BOT: 'bot' }[rota];

  const noRio = Math.abs(p.x + p.y - 14820) < RAIO_RIO;
  const lado = metade(p) === 'TOPSIDE' ? 'de cima' : 'de baixo';
  if (noRio) return `river ${lado}`;

  const dono = territorio(p) === LADO_AZUL ? 'azul' : 'vermelha';
  return `jungle ${dono} ${lado}`;
}

/** Descreve a zona sob a otica de um time: "sua selva" vs "selva inimiga". */
export function zonaRelativa(p, meuTime) {
  const nome = zona(p);

  if (nome.startsWith('base')) {
    const dono = nome.endsWith('azul') ? LADO_AZUL : LADO_VERMELHO;
    return dono === meuTime ? 'sua base' : 'base deles';
  }
  if (nome.startsWith('jungle')) {
    const lado = metade(p) === 'TOPSIDE' ? 'de cima' : 'de baixo';
    return territorio(p) === meuTime ? `sua jungle ${lado}` : `jungle deles ${lado}`;
  }
  return nome;
}
