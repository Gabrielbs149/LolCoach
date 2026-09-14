import { LOCAIS } from './mapa.js';

/**
 * Desenha o momento de um erro no mapa do Summoner's Rift.
 *
 * A primeira versão mostrava só um instante congelado, e um instante não conta
 * jogada nenhuma — não dava pra ver de onde o inimigo veio nem pra onde você
 * estava indo. Agora cada jogador aparece com o RASTRO do minuto anterior, que
 * é o que mostra a aproximação.
 *
 * A granularidade continua sendo de um ponto por minuto: o rastro mostra a
 * direção do deslocamento, não o caminho exato percorrido.
 */

const LADO = 14820;
const T = 640;
const M = 18;

const px = (x) => M + (x / LADO) * (T - M * 2);
const py = (y) => M + ((LADO - y) / LADO) * (T - M * 2); // o eixo Y do jogo cresce pra cima

// As três lanes ligam base a base. Antes elas começavam longe dos nexus e as
// bases ficavam boiando soltas nos cantos, o que não lia como Summoner's Rift.
const BASE_AZUL = [1500, 1500];
const BASE_VERMELHA = [13300, 13300];

const ROTAS = {
  TOP: [BASE_AZUL, [1150, 4200], [1200, 10600], [2500, 12800], [5200, 13350], BASE_VERMELHA],
  MID: [BASE_AZUL, [7400, 7400], BASE_VERMELHA],
  BOT: [BASE_AZUL, [4200, 1150], [10600, 1200], [12800, 2500], [13350, 5200], BASE_VERMELHA],
};

// O rio não vai de canto a canto: ele começa e termina nas entradas, perto do
// dragão embaixo e do barão em cima.
const RIO = [[13100, 1700], [1700, 13100]];

// Torres, só pra dar referência de profundidade.
const TORRES = [
  [1300, 5200], [1250, 8000], [1200, 10600],    // top azul
  [4200, 13200], [7300, 13350], [10500, 13400], // top vermelho
  [3600, 3600], [5200, 5200], [6600, 6600],     // mid azul
  [8300, 8300], [9700, 9700], [11200, 11200],   // mid vermelho
  [5200, 1300], [8000, 1250], [10600, 1200],    // bot azul
  [13200, 4200], [13350, 7300], [13400, 10500], // bot vermelho
];

// Vários mapas convivem na mesma página. Se todos usarem os mesmos ids de
// clipPath e marker, o navegador resolve url(#id) sempre pelo PRIMEIRO do
// documento — e do segundo mapa em diante os retratos são recortados por um
// círculo que está em outro lugar, sumindo da tela. Daí o sufixo único.
let instancia = 0;

const linha = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ');
const sigla = (n) => String(n).replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 2) || '?';

/** Cenário do mapa: rio, selva, rotas, bases e torres. */
function cenario(uid) {
  const s = [];
  const canto = (x, y) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`;

  s.push(`<clipPath id="recorte-${uid}"><rect x="0" y="0" width="${T}" height="${T}" rx="12"/></clipPath>`);
  s.push(`<rect x="0" y="0" width="${T}" height="${T}" rx="12" fill="#080f16"/>`);
  s.push(`<g clip-path="url(#recorte-${uid})">`);

  // Metades do mapa, separadas pela diagonal do meio. Dá leitura imediata de
  // "lado de cima" e "lado de baixo" sem precisar de legenda.
  s.push(`<path d="M${canto(0, 0)} L${canto(14820, 14820)} L${canto(0, 14820)} Z" fill="#0d1722"/>`);
  s.push(`<path d="M${canto(0, 0)} L${canto(14820, 14820)} L${canto(14820, 0)} Z" fill="#0c151d"/>`);

  // Rio: uma faixa só, mais estreita, sem invadir os cantos.
  s.push(`<path d="${linha(RIO)}" stroke="#153446" stroke-width="26" stroke-linecap="round" fill="none"/>`);
  s.push(`<path d="${linha(RIO)}" stroke="#1d4d63" stroke-width="10" stroke-linecap="round" fill="none" opacity="0.5"/>`);

  // Bases ANTES das lanes: assim as lanes passam por cima e ficam visivelmente
  // ligadas ao nexus, em vez de sumirem atrás do círculo.
  // Círculo centrado no canto + recorte do mapa = quarto de círculo, que é a
  // forma da base no minimapa. (A tentativa anterior era um arco com raio
  // inválido, e o navegador esticava aquilo num semicírculo gigante.)
  const raioBase = (2900 / LADO) * (T - M * 2);
  s.push(`<circle cx="${px(0)}" cy="${py(0)}" r="${raioBase.toFixed(1)}" fill="#12314c" stroke="#2f6a99" stroke-width="2"/>`);
  s.push(`<circle cx="${px(14820)}" cy="${py(14820)}" r="${raioBase.toFixed(1)}" fill="#3d1f27" stroke="#94414a" stroke-width="2"/>`);

  // Lanes: contorno escuro por baixo pra separar do fundo, faixa clara por cima.
  for (const pts of Object.values(ROTAS)) {
    s.push(`<path d="${linha(pts)}" stroke="#0a1118" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
    s.push(`<path d="${linha(pts)}" stroke="#33445a" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
  }

  for (const [x, y] of TORRES) {
    s.push(`<circle cx="${px(x)}" cy="${py(y)}" r="4" fill="#0a1118"/>`);
    s.push(`<circle cx="${px(x)}" cy="${py(y)}" r="2.6" fill="#6b809a"/>`);
  }

  // Pits, com nome por extenso — a inicial sozinha não dizia nada.
  for (const [nome, p, cor] of [['dragão', LOCAIS.DRAGAO, '#a07b3f'], ['barão', LOCAIS.BARAO, '#7a68a8']]) {
    s.push(`<circle cx="${px(p.x)}" cy="${py(p.y)}" r="19" fill="#0a1219" stroke="${cor}" stroke-width="2"/>`);
    s.push(`<text x="${px(p.x)}" y="${py(p.y) + 32}" font-size="10" fill="${cor}" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="600">${nome}</text>`);
  }

  // Nomes das lanes, encostados na borda pra não competir com os campeões.
  const rotulo = (x, y, txt) => `<text x="${px(x)}" y="${py(y)}" font-size="11" fill="#4a5c73" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" letter-spacing="2">${txt}</text>`;
  s.push(rotulo(7800, 14400, 'TOP'));
  s.push(rotulo(14350, 7400, 'BOT'));
  s.push(rotulo(9400, 8100, 'MID'));

  s.push('</g>');
  return s.join('');
}

/**
 * @param {object} o
 * @param {object} o.pos            posições no instante ({id: {x,y}})
 * @param {object} [o.posAntes]     posições do minuto anterior — vira rastro
 * @param {Array}  o.jogadores
 * @param {object} o.eu
 * @param {object} [o.evento]       ponto exato do acontecimento
 * @param {Array}  [o.culpados]     ids que causaram o dano
 * @param {string} [o.legenda]
 * @param {Function} [o.iconeSrc]   (championId) => url da imagem; sem isso usa iniciais
 */
export function desenharMinimapa({
  pos, posAntes = null, jogadores, eu, evento = null,
  culpados = [], mortos = [], legenda = '', iconeSrc = null,
}) {
  const marcados = new Set(culpados);
  const semVida = new Set(mortos);
  const uid = ++instancia;
  const s = [];

  // Quem morreu tem a posição registrada na fonte. Desenhar rastro daí sugere
  // que a pessoa escolheu voltar pra base, quando na verdade ela renasceu.
  const posicaoDe = (id) => (evento && id === eu.id ? evento : pos[id]);

  s.push(`<svg viewBox="0 0 ${T} ${T}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mapa do momento: ${legenda}">`);
  s.push(`<defs>
    <marker id="seta-${uid}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0,1 L9,5 L0,9 z" fill="currentColor"/>
    </marker>
  </defs>`);
  s.push(cenario(uid));

  // Área do acontecimento, por baixo de tudo que é jogador.
  if (evento) {
    const ex = px(evento.x), ey = py(evento.y);
    s.push(`<circle cx="${ex}" cy="${ey}" r="46" fill="#e0525214" stroke="#e05252" stroke-width="1.2" stroke-dasharray="5 5"/>`);
    s.push(`<path d="M${ex - 11},${ey - 11} L${ex + 11},${ey + 11} M${ex + 11},${ey - 11} L${ex - 11},${ey + 11}" stroke="#ff6b6b" stroke-width="3" stroke-linecap="round"/>`);
  }

  /* ---- rastros: de onde cada um veio no minuto anterior ---- */
  if (posAntes) {
    for (const j of jogadores) {
      // Morto no começo ou no fim do intervalo: a posição é a fonte, não uma
      // escolha de movimento. Rastro daí seria uma linha inventada.
      if (semVida.has(j.id)) continue;

      const a = posAntes[j.id], b = posicaoDe(j.id);
      if (!a || !b) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 700) continue; // praticamente parado

      const relevante = j.id === eu.id || marcados.has(j.id);
      const cor = j.id === eu.id ? '#c8aa6e' : j.time === eu.time ? '#3f7fa6' : '#b8443f';
      s.push(`<path d="${linha([[a.x, a.y], [b.x, b.y]])}" stroke="${cor}" stroke-width="${relevante ? 3 : 1.8}"
        opacity="${relevante ? 0.85 : 0.4}" fill="none" stroke-linecap="round"
        stroke-dasharray="${relevante ? 'none' : '5 4'}" marker-end="url(#seta-${uid})" color="${cor}"/>`);
    }
  }

  /* ---- jogadores ---- */
  const ordem = [...jogadores].sort((a, b) => {
    const peso = (j) => (j.id === eu.id ? 3 : marcados.has(j.id) ? 2 : j.time === eu.time ? 1 : 0);
    return peso(a) - peso(b);
  });

  for (const j of ordem) {
    const p = posicaoDe(j.id);
    if (!p) continue;

    const souEu = j.id === eu.id;
    const meuTime = j.time === eu.time;
    const morto = semVida.has(j.id);
    const cor = souEu ? '#c8aa6e' : meuTime ? '#4b90b8' : '#c94f49';
    const r = souEu ? 20 : marcados.has(j.id) ? 18 : 15;
    const x = px(p.x), y = py(p.y);

    // Quem está morto entra apagado e marcado, pra não parecer que estava lá.
    if (morto) s.push(`<g opacity="0.32">`);
    if (souEu) s.push(`<circle cx="${x}" cy="${y}" r="${r + 7}" fill="none" stroke="#c8aa6e" stroke-width="1.6" opacity="0.5"/>`);

    const url = iconeSrc?.(j.championId);
    if (url) {
      s.push(`<clipPath id="c${uid}-${j.id}"><circle cx="${x}" cy="${y}" r="${r}"/></clipPath>`);
      s.push(`<image href="${url}" x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#c${uid}-${j.id})" preserveAspectRatio="xMidYMid slice"/>`);
    } else {
      s.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${cor}"/>`);
      s.push(`<text x="${x}" y="${y + 4}" font-size="11" font-weight="700" fill="#0b1119" text-anchor="middle" font-family="system-ui,sans-serif">${sigla(j.campeao)}</text>`);
    }

    s.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${cor}" stroke-width="${souEu ? 3.5 : marcados.has(j.id) ? 3 : 2.2}"/>`);
    if (marcados.has(j.id) && !morto) {
      s.push(`<circle cx="${x}" cy="${y}" r="${r + 5}" fill="none" stroke="#e05252" stroke-width="1.8" opacity="0.9"/>`);
    }
    if (morto) {
      s.push(`<path d="M${x - r * 0.55},${y - r * 0.55} L${x + r * 0.55},${y + r * 0.55} M${x + r * 0.55},${y - r * 0.55} L${x - r * 0.55},${y + r * 0.55}" stroke="#0b1119" stroke-width="3" stroke-linecap="round"/>`);
      s.push('</g>');
    }
  }

  if (legenda) {
    s.push(`<rect x="${T / 2 - 108}" y="${T - 30}" width="216" height="21" rx="10" fill="#0b1119" opacity="0.85"/>`);
    s.push(`<text x="${T / 2}" y="${T - 15}" font-size="11.5" fill="#8b9aad" text-anchor="middle" font-family="system-ui,sans-serif">${legenda}</text>`);
  }

  s.push('</svg>');
  return s.join('');
}
