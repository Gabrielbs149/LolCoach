/**
 * O "olho": o que a janela escondida (olho.html) enxerga no minimapa vira
 * posição no mapa (0..1, y pra baixo, base azul embaixo à esquerda). Aqui
 * isso vira lugar com nome ("no top, lado deles", "no rio do dragão") e as
 * falas do jungler — o que o ABSOL chama de jungle tracking.
 */

import { F } from './texto.js';

const BARAO = { x: 0.334, y: 0.302 };
const DRAGAO = { x: 0.666, y: 0.703 };
const BASE_AZUL = { x: 0.105, y: 0.90 };
const BASE_VERMELHA = { x: 0.897, y: 0.106 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Lugar do mapa com nome, relativo ao meu time (100 = azul, embaixo à esquerda). */
export function lugar(x, y, meuTime = 100) {
  // O rio (x = y) separa o lado azul (embaixo à esquerda) do vermelho; o mid
  // (x + y = 1) separa a metade de cima (top) da de baixo (bot).
  const azul = meuTime === 100;
  const ladoAzul = x < y;
  const lado = ladoAzul === azul ? 'nosso' : 'deles';
  const cima = x + y < 1;
  const ladoTxt = lado === 'nosso' ? 'nosso lado' : 'lado deles';
  const p = { x, y };
  if (dist(p, BASE_AZUL) < 0.13) return { chave: `base-${azul ? 'nosso' : 'deles'}`, texto: `na base ${azul ? 'nossa' : 'deles'}`, lane: 'base', lado: azul ? 'nosso' : 'deles' };
  if (dist(p, BASE_VERMELHA) < 0.13) return { chave: `base-${azul ? 'deles' : 'nosso'}`, texto: `na base ${azul ? 'deles' : 'nossa'}`, lane: 'base', lado: azul ? 'deles' : 'nosso' };
  if (dist(p, BARAO) < 0.06) return { chave: 'barao', texto: 'no barão', lane: 'barao', lado };
  if (dist(p, DRAGAO) < 0.06) return { chave: 'dragao', texto: 'no dragão', lane: 'dragao', lado };
  if (Math.abs(x + y - 1) < 0.07 && x > 0.2 && x < 0.8) return { chave: `mid-${lado}`, texto: `no mid, ${ladoTxt}`, lane: 'mid', lado };
  if (Math.abs(x - y) < 0.055 && x > 0.25 && x < 0.75) {
    return { chave: cima ? 'rio-barao' : 'rio-dragao', texto: cima ? 'no rio do barão' : 'no rio do dragão', lane: 'rio', lado };
  }
  if (x < 0.17 || y < 0.17) return { chave: `top-${lado}`, texto: `no top, ${ladoTxt}`, lane: 'top', lado };
  if (x > 0.83 || y > 0.83) return { chave: `bot-${lado}`, texto: `no bot, ${ladoTxt}`, lane: 'bot', lado };
  return { chave: `jg-${cima ? 'cima' : 'baixo'}-${lado}`, texto: `na jungle de ${cima ? 'cima' : 'baixo'}, ${ladoTxt}`, lane: 'jungle', lado };
}

export const novaMemoriaOlho = () => ({ porCampeao: new Map(), grupoEm: 0, seq: 0 });

const LANE_DE = { top: 'top', mid: 'mid', adc: 'bot', sup: 'bot', jungle: 'jungle' };

/**
 * Falas a partir do que foi visto agora. `vistos` = [{campeao, x, y}] só os
 * confirmados neste quadro; `eu` = {x, y} se me achou. Chamado a cada
 * leitura (5x por segundo), então tudo aqui tem cooldown.
 */
export function falasDoOlho({ vistos, eu, estado, agora = Date.now() }, mem) {
  const saida = [];
  if (!estado?.eu) return saida;
  const meuTime = estado.eu.time;
  const minhaLane = LANE_DE[estado.eu.role] ?? null;
  const inimigos = estado.jogadores.filter((j) => j.time !== meuTime);
  const jungler = inimigos.find((j) => j.role === 'jungle');
  const vistoPor = new Map(vistos.map((v) => [String(v.campeao).toLowerCase(), v]));
  const dizer = (modulo, serio, divertido, prioridade = 1) => saida.push({ modulo, serio, divertido, prioridade });

  for (const j of inimigos) {
    const r = mem.porCampeao.get(j.nome) ?? mem.porCampeao.set(j.nome, { vistoEm: 0, faladoEm: 0, sumiuEm: 0 }).get(j.nome);
    const v = vistoPor.get(String(j.campeao).toLowerCase());
    const ehJungler = j === jungler;
    if (v) {
      const l = lugar(v.x, v.y, meuTime);
      const novo = !r.vistoEm || agora - r.vistoEm > 10000 || l.chave !== r.chave;
      const perto = eu ? Math.hypot(v.x - eu.x, v.y - eu.y) < 0.16 : false;
      const noMeuLado = minhaLane && l.lane === minhaLane && l.lane !== 'jungle';
      r.x = v.x; r.y = v.y; r.chave = l.chave; r.lane = l.lane; r.texto = l.texto; r.vistoEm = agora; r.sumiuDito = false;
      if (!novo || agora - r.faladoEm < 6000 || j.morto) continue;
      if (ehJungler) {
        r.faladoEm = agora;
        if (perto) dizer('jungler', F`Jungler deles perto de você, ${l.texto}. Recua!`, F`Jungler ${l.texto}, do seu lado. Sai daí!`, 3);
        else if (l.lane === 'base') dizer('jungler', F('Jungler deles na base.'), F('Jungler deles foi pra base. Janela livre.'), 1);
        else dizer('jungler', F`Jungler deles ${l.texto}.`, F`Jungler ${l.texto}. Olho nele.`, 2);
      } else if ((perto || noMeuLado) && LANE_DE[j.role] !== minhaLane && l.lane !== 'base') {
        // Laner de outra rota chegando no meu lado: roam.
        r.faladoEm = agora;
        if (perto) dizer('mapa', F`${j.campeao} perto de você, ${l.texto}.`, F`${j.campeao} veio te visitar, ${l.texto}. Cuidado.`, 3);
        else dizer('mapa', F`${j.campeao} chegando ${l.texto}.`, F`${j.campeao} veio passear ${l.texto}. Cuidado.`, 3);
      }
    } else if (r.vistoEm && !r.sumiuDito && agora - r.vistoEm > (ehJungler ? 20000 : 30000) && !j.morto) {
      r.sumiuDito = true;
      if (ehJungler) dizer('jungler', F`Jungler sumiu. Última vez ${r.texto ?? 'no mapa'}.`, F`Perdi o jungler. Tava ${r.texto ?? 'por aí'}.`, 1);
      else if (j.role === 'mid' && r.lane === 'mid' && agora - r.sumiuEm > 60000 && minhaLane !== 'mid') { r.sumiuEm = agora; dizer('mapa', F`${j.campeao} sumiu do mid. Cuidado com roam.`, F`Mid deles sumiu. Se ele aparecer aí, não foi passear.`, 2); }
    }
  }

  // Três ou mais deles juntos no dragão ou no barão.
  for (const [nome, pit] of [['dragão', DRAGAO], ['barão', BARAO]]) {
    const n = vistos.filter((v) => dist(v, pit) < 0.1).length;
    if (n >= 3 && agora - mem.grupoEm > 30000) {
      mem.grupoEm = agora;
      dizer('mapa', F`${n === 5 ? 'Os cinco' : n === 4 ? 'Quatro deles' : 'Três deles'} no ${nome}.`, F`${n} deles no ${nome}. Ou junta o time ou pega o outro lado.`, 3);
    }
  }
  return saida;
}
