/**
 * O "mundo" da partida visto pelo olho: onde cada campeão (inimigo, aliado,
 * você) esteve, pra onde vai, há quanto tempo sumiu — e, em cima disso, as
 * SITUAÇÕES: fatos com nome, prioridade e texto ("jungler indo pro top",
 * "eles armando o dragão", "invade"). Toda situação é gravada (falada ou
 * não) pra depois a gente aprender qual vale falar em cada momento.
 *
 * Coordenadas: 0..1 no minimapa, y pra baixo, base azul embaixo à esquerda.
 * Mapa tem ~14800 unidades; campeão anda ~370/s → atravessar o mapa inteiro
 * (1.0) leva ~40 s. Distância vira segundos com isso.
 */
import { F } from './texto.js';
import { lugar } from './olho.js';

const SEG_POR_MAPA = 40;                 // 1.0 de distância ≈ 40 s andando
const seg = (d) => Math.round(d * SEG_POR_MAPA);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Pontos do mapa (normalizados, y pra baixo).
const PONTOS = {
  barao: { x: 0.334, y: 0.302 }, dragao: { x: 0.666, y: 0.703 }, larvas: { x: 0.334, y: 0.302 }, arauto: { x: 0.334, y: 0.302 },
  baseAzul: { x: 0.105, y: 0.90 }, baseVermelha: { x: 0.897, y: 0.106 },
  // buffs: [azul do time azul, red do time azul, azul do time vermelho, red do time vermelho]
  buffAzulA: { x: 0.256, y: 0.469 }, buffRedA: { x: 0.526, y: 0.731 }, buffAzulV: { x: 0.742, y: 0.530 }, buffRedV: { x: 0.479, y: 0.267 },
};
// Camps pequenos do lado azul (aproximados); do vermelho é o espelho (1-x, 1-y). Renascem em 2:15.
const CAMPS_AZUL = { gromp: { x: 0.14, y: 0.43 }, lobos: { x: 0.25, y: 0.58 }, raptors: { x: 0.47, y: 0.62 }, krugs: { x: 0.58, y: 0.80 } };
const campsDe = (time) => Object.fromEntries(Object.entries(CAMPS_AZUL).map(([n, p]) => [n, time === 100 ? p : { x: 1 - p.x, y: 1 - p.y }]));
const LANE_DE = { top: 'top', mid: 'mid', adc: 'bot', sup: 'bot', jungle: 'jungle' };
const OBJETIVOS = ['Dragão', 'Barão', 'Arauto', 'Vastilarvas', 'Ancião'];
const pitDe = (nome) => (nome === 'Dragão' || nome === 'Ancião' ? PONTOS.dragao : PONTOS.barao);

export function novoMundo() {
  return {
    inicio: Date.now(), campeoes: new Map(), leituras: 0, ultimaLeituraT: 0,
    ditas: new Map(), ultimaFalaEm: 0, faladasEm: [], buffs: [], ganksPorLane: new Map(), invadeDito: false,
    duo: { primeiraVezNaLane: null, dito: false }, lanesLivres: new Map(), snapshotEm: 0, waves: {}, camps: [],
  };
}

function ficha(mundo, j) {
  let f = mundo.campeoes.get(j.nome);
  if (!f) { f = { nome: j.nome, campeao: j.campeao, time: j.time, role: j.role, hist: [], ultimo: null, primeiro: null, regiao: null, lane: null, sumidoDito: 0, tp: 0 }; mundo.campeoes.set(j.nome, f); }
  f.role = j.role; f.morto = !!j.morto; f.nivel = j.nivel; f.kills = j.kills; f.mortes = j.mortes;
  return f;
}
function verVisto(f, v, t) {
  const p = { t, x: v.x, y: v.y };
  const antes = f.ultimo;
  // Pulo grande em pouco tempo: pode ser TP ou um ícone parecido no lugar errado.
  // Só aceita se a leitura seguinte confirmar o novo lugar.
  if (antes && t - antes.t < 6 && dist(antes, p) > 0.25) {
    if (f.pendente && t - f.pendente.t < 2.5 && dist(f.pendente, p) < 0.08) { f.tp = t; f.pendente = null; }
    else { f.pendente = p; return; }
  } else f.pendente = null;
  f.hist.push(p); if (f.hist.length > 400) f.hist.splice(0, 100);
  f.ultimo = p; if (!f.primeiro) f.primeiro = p;
}
/** Velocidade (mapa/s) pelas leituras dos últimos 3 s. */
function velocidade(f, t) {
  const h = f.hist.filter((p) => t - p.t <= 4);
  if (h.length < 4) return null;
  const a = h[0], b = h[h.length - 1], dt = b.t - a.t;
  if (dt < 2.5) return null;
  // trajetória tem que ser coerente: os pontos do meio perto da reta a→b
  for (const q of h) { const u = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (dist(a, b) ** 2 || 1); const px = a.x + (b.x - a.x) * u, py = a.y + (b.y - a.y) * u; if (dist(q, { x: px, y: py }) > 0.05) return null; }
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt, mod: dist(a, b) / dt };
}
/** Onde estará daqui a `s` segundos, se continuar. */
function projecao(f, t, s) {
  const v = velocidade(f, t); if (!v || v.mod < 0.006) return null;
  const p = f.ultimo;
  return { x: Math.min(1, Math.max(0, p.x + v.vx * s)), y: Math.min(1, Math.max(0, p.y + v.vy * s)) };
}
const LUGAR_NOME = { top: 'top', mid: 'mid', bot: 'bot', barao: 'barão', dragao: 'dragão' };
const vivo = (f) => f.ultimo && !f.morto;
const vistoHa = (f, t) => (f.ultimo ? t - f.ultimo.t : Infinity);
const visivel = (f, t) => vistoHa(f, t) <= 1.5;

/**
 * Uma leitura do olho → atualiza o mundo e devolve as situações novas.
 * `leitura` = { vistos:[{campeao,x,y}], aliados:[{campeao,x,y}], eu:{x,y} }
 * `estado`  = leitura da API do jogo · `objetivos` = objetivos.js
 */
export function processar(mundo, leitura, estado, objetivos = []) {
  const t = estado.tempo ?? 0;
  const eu = estado.eu;
  if (!eu) return [];
  const meuTime = eu.time;
  const minhaLane = LANE_DE[eu.role] ?? null;
  const inimigos = estado.jogadores.filter((j) => j.time !== meuTime);
  const aliados = estado.jogadores.filter((j) => j.time === meuTime && j.nome !== eu.nome);
  const porCampeao = (lista) => new Map(lista.map((v) => [String(v.campeao).toLowerCase(), v]));
  const vIni = porCampeao(leitura.vistos ?? []), vAli = porCampeao(leitura.aliados ?? []);
  mundo.leituras++; mundo.ultimaLeituraT = t;

  // fichas + posições
  const fEu = ficha(mundo, eu); if (leitura.eu) verVisto(fEu, leitura.eu, t);
  const fIni = inimigos.map((j) => { const f = ficha(mundo, j); const v = vIni.get(String(j.campeao).toLowerCase()); if (v && !j.morto) verVisto(f, v, t); return f; });
  const fAli = aliados.map((j) => { const f = ficha(mundo, j); const v = vAli.get(String(j.campeao).toLowerCase()); if (v && !j.morto) verVisto(f, v, t); return f; });
  for (const f of [...fIni, ...fAli]) if (f.ultimo) { const l = lugar(f.ultimo.x, f.ultimo.y, meuTime); f.regiaoAntes = f.regiao; f.regiao = l; }

  const jg = fIni.find((f) => f.role === 'jungle') ?? null;
  const meuJg = fAli.find((f) => f.role === 'jungle') ?? null;
  const minhaPos = fEu.ultimo && t - fEu.ultimo.t < 4 ? fEu.ultimo : null;
  const ladoNosso = (p) => lugar(p.x, p.y, meuTime).lado === 'nosso';
  const minhaBase = meuTime === 100 ? PONTOS.baseAzul : PONTOS.baseVermelha;
  const baseDeles = meuTime === 100 ? PONTOS.baseVermelha : PONTOS.baseAzul;
  const buffsDeles = meuTime === 100 ? { azul: PONTOS.buffAzulV, red: PONTOS.buffRedV } : { azul: PONTOS.buffAzulA, red: PONTOS.buffRedA };

  const novas = [];
  /** Registra a situação; `cooldown` em segundos por chave; prioridade 3 fura a fila. */
  const situ = (chave, { tipo, prioridade = 1, modulo = 'mapa', serio, divertido, cooldown = 30, dados = {} }) => {
    const ultima = mundo.ditas.get(chave) ?? -Infinity;
    if (t - ultima < cooldown) return null;
    mundo.ditas.set(chave, t);
    const s = { chave, tipo, prioridade, modulo, serio, divertido: divertido ?? serio, t, dados, falar: true };
    novas.push(s);
    return s;
  };
  const lugarTxt = (p) => lugar(p.x, p.y, meuTime).texto;
  const laneAlvo = (f) => {                         // pra onde ele vai, se for pra uma lane (duas leituras seguidas concordando)
    const p = projecao(f, t, 12);
    const l = p ? lugar(p.x, p.y, meuTime) : null;
    const lane = l && ['top', 'mid', 'bot'].includes(l.lane) && l.lane !== f.regiao?.lane ? l.lane : null;
    const ok = lane && f.alvoAntes === lane;
    f.alvoAntes = lane;
    return ok ? l : null;
  };

  /* ================================================== 1. jungler deles */
  if (jg) {
    const agora = visivel(jg, t);
    if (agora) {
      const l = jg.regiao, mudou = l.chave !== jg.regiaoAntes?.chave;
      const primeira = jg.hist.length === 1;
      // onde começou
      if (primeira && t < 150 && l.lane !== 'base') {
        // Começou de um lado → clear completo termina do lado oposto por volta de 3:15; o gank vem de lá.
        const comecouEmCima = jg.ultimo.x + jg.ultimo.y < 1;
        const laneGank = comecouEmCima ? 'bot' : 'top';
        situ('jg-inicio', { tipo: 'jungler', prioridade: 3, modulo: 'jungler', serio: F`Jungler deles começou ${l.texto}. Deve aparecer no ${laneGank} entre 3:10 e 3:40.`, divertido: F`Jungler deles começou ${l.texto}. ${laneGank}, prepara: ele chega por volta de 3:20.`, dados: { x: jg.ultimo.x, y: jg.ultimo.y, laneGank } });
        mundo.previsaoGank = { lane: laneGank, de: 190, ate: 220, dito: false };
      }
      else if (primeira && t < 270 && ['jungle', 'top', 'bot', 'rio'].includes(l.lane)) situ('jg-inicio', { tipo: 'jungler', prioridade: 3, modulo: 'jungler', serio: F`Jungler deles ${l.texto} aos ${mmss(t)}. Começou ${jg.ultimo.x + jg.ultimo.y < 1 ? 'embaixo' : 'em cima'}.`, dados: { x: jg.ultimo.x, y: jg.ultimo.y } });
      // pra onde ele ia (usado no "sumido": "última vez no rio, indo pro top")
      { const pr = projecao(jg, t, 12); const lr = pr ? lugar(pr.x, pr.y, meuTime) : null; jg.rumo = lr && lr.lane !== jg.regiao?.lane && ['top', 'mid', 'bot', 'barao', 'dragao'].includes(lr.lane) ? lr.lane : (jg.rumo && t - jg.ultimo.t < 1 ? jg.rumo : null); if (lr && lr.lane === jg.regiao?.lane) jg.rumo = null; }
      // buff deles: viu no buff → renasce 5 min depois
      for (const [nome, p] of Object.entries(buffsDeles)) if (dist(jg.ultimo, p) < 0.05 && !mundo.buffs.some((b) => b.nome === nome && t - b.em < 240)) { mundo.buffs.push({ nome, em: t, avisado: false }); situ(`jg-buff-${nome}-${Math.floor(t / 240)}`, { tipo: 'jungler', prioridade: 0, modulo: 'jungler', serio: F`Jungler deles no ${nome} deles. Renasce às ${mmss(t + 300)}.`, cooldown: 200 }); }
      // camps deles: viu o jungler num camp → renasce 2:15 depois (só registro; fala se você é jungle)
      for (const [nome, p] of Object.entries(campsDe(meuTime === 100 ? 200 : 100))) if (dist(jg.ultimo, p) < 0.045 && !mundo.camps.some((c) => c.nome === nome && t - c.em < 100)) { mundo.camps.push({ nome, em: t, avisado: false }); situ(`jg-camp-${nome}-${Math.floor(t / 100)}`, { tipo: 'jungler', prioridade: 0, modulo: 'jungler', serio: F`Jungler deles nos ${nome} dele. Renascem às ${mmss(t + 135)}.`, cooldown: 90 }); }
      // perto de você (em segundos)
      if (minhaPos) {
        const s = seg(dist(jg.ultimo, minhaPos));
        const v = velocidade(jg, t), aproximando = v ? (dist({ x: jg.ultimo.x + v.vx * 3, y: jg.ultimo.y + v.vy * 3 }, minhaPos) < dist(jg.ultimo, minhaPos)) : false;
        if (s <= 6) situ('jg-em-cima', { tipo: 'jungler', prioridade: 3, modulo: 'jungler', serio: F`Jungler deles em cima de você, ${l.texto}. Recua!`, divertido: F`Jungler deles em cima de você! Corre, ${l.texto}.`, cooldown: 12, dados: { s } });
        else if (s <= 12 && aproximando) situ('jg-vindo', { tipo: 'jungler', prioridade: 3, modulo: 'jungler', serio: F`Jungler deles a ${s} segundos de você, vindo ${l.texto}.`, divertido: F`Jungler deles chega em ${s} segundos. Não fica de enfeite.`, cooldown: 15, dados: { s } });
      }
      // indo pra uma lane
      const alvo = laneAlvo(jg);
      if (alvo && !(minhaPos && seg(dist(jg.ultimo, minhaPos)) <= 12)) situ(`jg-indo-${alvo.lane}`, { tipo: 'jungler', prioridade: alvo.lane === minhaLane ? 3 : 2, modulo: 'jungler', serio: F`Jungler deles indo pro ${alvo.lane}${alvo.lane === minhaLane ? '. Recua' : ''}.`, divertido: F`Jungler deles rumo ao ${alvo.lane}${alvo.lane === minhaLane ? '. É com você, sai' : ''}.`, cooldown: 40, dados: { lane: alvo.lane } });
      // objetivo / nossa jungle / base / lado livre
      for (const o of objetivos) if ((o.vivo || o.em <= 45) && dist(jg.ultimo, pitDe(o.nome)) < 0.09) situ(`jg-obj-${o.nome}`, { tipo: 'objetivo', prioridade: 3, modulo: 'timers', serio: F`Jungler deles no ${o.nome}.`, cooldown: 40 });
      if (l.lane === 'jungle' && l.lado === 'nosso') situ('jg-nossa-jungle', { tipo: 'jungler', prioridade: 2, modulo: 'jungler', serio: F`Jungler deles ${l.texto}. Camps em risco.`, cooldown: 45 });
      else if (l.lane === 'base') situ('jg-base', { tipo: 'jungler', prioridade: 1, modulo: 'jungler', serio: F('Jungler deles na base. Uns 40 segundos livres.'), cooldown: 60 });
      else if (mudou && !alvo && !primeira && t - (mundo.ditas.get('jg-em') ?? -99) >= 12 && mundo.ditas.set('jg-em', t)) situ(`jg-em-${l.chave}`, { tipo: 'jungler', prioridade: l.lane === 'jungle' && l.lado === 'deles' ? 0 : 2, modulo: 'jungler', serio: F`Jungler deles ${l.texto}.`, cooldown: 20 });
      if (t > 180 && minhaPos && seg(dist(jg.ultimo, minhaPos)) >= 25 && minhaLane && minhaLane !== 'jungle') situ('jg-lado-livre', { tipo: 'jungler', prioridade: 1, modulo: 'jungler', serio: F`Jungler deles ${l.texto}, longe. Seu lado livre por uns ${seg(dist(jg.ultimo, minhaPos))} segundos.`, cooldown: 75 });
      // pra quem é jungle: o lado da jungle dele que está livre pra invadir
      if (minhaLane === 'jungle' && t > 150) {
        const emCima = jg.ultimo.x + jg.ultimo.y < 1;
        const alvo = emCima ? buffsDeles.azul : buffsDeles.red;   // quadrante oposto ao que ele está
        const sAlvo = seg(dist(jg.ultimo, alvo));
        if (sAlvo >= 22 && (!minhaPos || seg(dist(minhaPos, alvo)) <= sAlvo - 8)) situ(`invade-${emCima ? 'baixo' : 'cima'}`, { tipo: 'oportunidade', prioridade: 1, modulo: 'jungler', serio: F`Jungle de ${emCima ? 'baixo' : 'cima'} dele livre: ele está a ${sAlvo} segundos de lá.`, cooldown: 90, dados: { lado: emCima ? 'baixo' : 'cima', s: sAlvo } });
      }
      // nível 6 perto de você
      if (jg.nivel >= 6 && minhaPos && seg(dist(jg.ultimo, minhaPos)) <= 15) situ('jg-6-perto', { tipo: 'jungler', prioridade: 1, modulo: 'jungler', serio: F`Jungler deles com ult, a ${seg(dist(jg.ultimo, minhaPos))} segundos.`, cooldown: 120 });
      // dive: jungler + laner deles perto de você no nosso lado
      if (minhaPos && ladoNosso(minhaPos)) {
        const juntos = fIni.filter((f) => f !== jg && visivel(f, t) && dist(f.ultimo, minhaPos) < 0.1);
        if (juntos.length && dist(jg.ultimo, minhaPos) < 0.12) situ('dive', { tipo: 'perigo', prioridade: 3, modulo: 'jungler', serio: F`Dive vindo: jungler e ${juntos[0].campeao} em cima de você.`, divertido: F`Dive! Jungler e ${juntos[0].campeao} querem te visitar. Sai da torre.`, cooldown: 30 });
      }
      jg.sumidoDito = 0;
    } else if (jg.ultimo && !jg.morto) {
      const ha = Math.round(vistoHa(jg, t));
      const pg = mundo.previsaoGank;
      if (pg && !pg.dito && t >= pg.de && t <= pg.ate + 30) { pg.dito = true; situ('jg-gank-previsto', { tipo: 'jungler', prioridade: pg.lane === minhaLane ? 3 : 1, modulo: 'jungler', serio: F`Hora do primeiro gank: jungler deles deve estar chegando no ${pg.lane}.`, cooldown: 1 }); }
      if (ha >= 20 && ha <= 180 && ha - jg.sumidoDito >= 30) { jg.sumidoDito = ha; situ('jg-sumido', { tipo: 'jungler', prioridade: ha < 40 ? 1 : 2, modulo: 'jungler', serio: jg.rumo && ha <= 60 ? F`Jungler sumido há ${ha} segundos. Última vez ${lugarTxt(jg.ultimo)}, indo pro ${LUGAR_NOME[jg.rumo] ?? jg.rumo}.` : F`Jungler sumido há ${ha} segundos. Última vez ${lugarTxt(jg.ultimo)}.`, divertido: F`Cadê o jungler? ${ha} segundos sumido, última vez ${lugarTxt(jg.ultimo)}.`, cooldown: 25, dados: { ha, rumo: jg.rumo ?? null } }); }
    }
    for (const c of mundo.camps) if (!c.avisado && t >= c.em + 115) { c.avisado = true; if (minhaLane === 'jungle') situ(`camp-nasce-${c.nome}-${c.em}`, { tipo: 'jungler', prioridade: 1, modulo: 'jungler', serio: F`${c.nome} deles nascem em 20 segundos.`, cooldown: 1 }); }
    // buffs deles renascendo
    for (const b of mundo.buffs) if (!b.avisado && t >= b.em + 270) { b.avisado = true; situ(`buff-nasce-${b.nome}-${b.em}`, { tipo: 'jungler', prioridade: 1, modulo: 'jungler', serio: F`${b.nome === 'red' ? 'Red' : 'Azul'} deles nasce em 30 segundos.`, cooldown: 1 }); }
  }
  // jungler deles prestes a nascer (a API dá o tempo de respawn)
  if (jg) {
    const jj = estado.jogadores.find((x) => x.nome === jg.nome);
    if (jj?.morto && jj.renasceEm > 0 && jj.renasceEm <= 10) situ(`jg-nasce-${Math.floor(t / 30)}`, { tipo: 'jungler', prioridade: 1, modulo: 'jungler', serio: F`Jungler deles nasce em ${Math.round(jj.renasceEm)} segundos.`, cooldown: 25 });
  }
  // lado do jungler pela chegada do duo deles (leash)
  if (!mundo.duo.dito && t >= 95 && t < 200) {
    const duo = fIni.filter((f) => f.role === 'adc' || f.role === 'sup');
    const naLane = duo.filter((f) => f.primeiro && ['bot', 'top'].includes(f.regiao?.lane));
    if (naLane.length && !mundo.duo.primeiraVezNaLane) mundo.duo.primeiraVezNaLane = t;
    if (mundo.duo.primeiraVezNaLane && (mundo.duo.primeiraVezNaLane > 100 || t >= 150)) {
      mundo.duo.dito = true;
      const tarde = mundo.duo.primeiraVezNaLane > 100;
      if (!mundo.ditas.has('jg-inicio')) situ('jg-lado-duo', { tipo: 'jungler', prioridade: 2, modulo: 'jungler', serio: tarde ? F`Duo deles chegou tarde na lane (${mmss(mundo.duo.primeiraVezNaLane)}). Jungler começou embaixo.` : F`Duo deles chegou cedo. Jungler começou em cima.`, dados: { chegada: mundo.duo.primeiraVezNaLane } });
    }
  }
  // ganks contados por lane (kill com o jungler deles participando)
  for (const e of estado.eventos ?? []) {
    if (e.tipo !== 'ChampionKill' || !jg) continue;
    const k = `ev-${e.id}`; if (mundo.ditas.has(k)) continue; mundo.ditas.set(k, t);
    const vitima = estado.jogadores.find((j) => j.nome === e.vitima);
    if (vitima && vitima.time === meuTime && (e.autor === jg.nome || e.assistentes?.includes(jg.nome))) {
      const lane = LANE_DE[vitima.role] ?? 'mapa';
      const n = (mundo.ganksPorLane.get(lane) ?? 0) + 1; mundo.ganksPorLane.set(lane, n);
      if (n >= 2) situ(`jg-ganks-${lane}-${n}`, { tipo: 'jungler', prioridade: 1, modulo: 'jungler', serio: F`Jungler deles já gankou o ${lane} ${n} vezes.`, cooldown: 1 });
    }
  }

  /* ============================================ 2. laners deles */
  for (const f of fIni) {
    if (f === jg || !f.ultimo) continue;
    const laneDele = LANE_DE[f.role] ?? null;
    if (visivel(f, t)) {
      const l = f.regiao;
      // TP
      const temTp = (estado.jogadores.find((x) => x.nome === f.nome)?.spells ?? []).some((sp) => /teleport/i.test(sp));
      if (f.tp === t) situ(`tp-${f.nome}`, { tipo: 'roam', prioridade: temTp ? 2 : 0, modulo: 'mapa', serio: F`${f.campeao} deu TP pro ${l.lane === 'jungle' ? 'mapa' : l.lane}.`, cooldown: 60 });
      // roam em andamento: laner fora da lane dele indo pra outra
      const alvo = laneAlvo(f);
      const foraDaLane = f.hist.filter((q) => t - q.t <= 3).every((q) => lugar(q.x, q.y, meuTime).lane !== laneDele);
      if (laneDele && laneDele !== 'jungle' && alvo && alvo.lane !== laneDele && foraDaLane) situ(`roam-${f.nome}-${alvo.lane}`, { tipo: 'roam', prioridade: alvo.lane === minhaLane ? 3 : 0, modulo: 'mapa', serio: F`${f.campeao} (${laneDele}) indo pro ${alvo.lane}${alvo.lane === minhaLane ? '. Cuidado' : ''}.`, divertido: F`${f.campeao} largou o ${laneDele} e vai pro ${alvo.lane}${alvo.lane === minhaLane ? '. Presente pra você' : ''}.`, cooldown: 30, dados: { de: laneDele, para: alvo.lane } });
      // chegou no seu lado / perto de você
      if (minhaPos && laneDele !== minhaLane) {
        const s = seg(dist(f.ultimo, minhaPos));
        const vf = velocidade(f, t), chegando = vf ? dist({ x: f.ultimo.x + vf.vx * 3, y: f.ultimo.y + vf.vy * 3 }, minhaPos) < dist(f.ultimo, minhaPos) - 0.01 : false;
        if (s <= 8 && chegando) situ(`perto-${f.nome}`, { tipo: 'perigo', prioridade: 3, modulo: 'mapa', serio: F`${f.campeao} a ${s} segundos de você, ${l.texto}.`, cooldown: 30, dados: { s } });
      }
      // na base → lane dele livre
      if (l.lane === 'base' && l.lado === 'deles' && laneDele && laneDele !== 'jungle') situ(`base-${f.nome}`, { tipo: 'lane', prioridade: laneDele === minhaLane ? 2 : 0, modulo: 'lane', serio: F`${f.campeao} na base. ${laneDele === minhaLane ? 'Sua lane livre por uns 30 segundos.' : `${laneDele} deles vazio.`}`, cooldown: 60 });
      // avançado demais no nosso lado
      if (l.lado === 'nosso' && ['top', 'mid', 'bot'].includes(l.lane) && dist(f.ultimo, minhaBase) < 0.42 && (!jg || !visivel(jg, t) || dist(jg.ultimo, f.ultimo) > 0.25)) situ(`avancado-${f.nome}`, { tipo: 'oportunidade', prioridade: 0, modulo: 'mapa', serio: F`${f.campeao} avançado demais no ${l.lane}. Chama o jungler.`, cooldown: 60 });
      // lane swap (duo deles no top, ou top deles no bot) nos primeiros 8 min
      const trocado = (role, lane) => fIni.some((g) => g.role === role && visivel(g, t) && g.regiao?.lane === lane);
      if (t >= 90 && t < 480 && ((f.role === 'adc' && l.lane === 'top' && trocado('top', 'bot')) || (f.role === 'top' && l.lane === 'bot' && trocado('adc', 'top')))) situ('lane-swap', { tipo: 'lane', prioridade: 2, modulo: 'lane', serio: F`Lane swap: ${f.campeao} no ${l.lane}.`, cooldown: 300 });
    } else if (!f.morto) {
      const ha = vistoHa(f, t);
      if (ha >= 30 && ha < 32 && laneDele && laneDele !== 'jungle' && f.regiao?.lane === laneDele && laneDele !== minhaLane) situ(`sumiu-${f.nome}`, { tipo: 'roam', prioridade: laneDele === 'mid' || f.role === 'sup' ? 2 : 1, modulo: 'mapa', serio: F`${f.campeao} sumiu do ${laneDele}. Cuidado com roam.`, cooldown: 90 });
    }
  }
  // seus oponentes de lane sumiram (estavam na lane, some há 12 s+) e o jungler deles também: armadilha
  if (minhaLane && minhaLane !== 'jungle' && minhaPos && t > 180) {
    const oponentes = fIni.filter((f) => LANE_DE[f.role] === minhaLane && !f.morto && f.ultimo && f.regiao?.lane === minhaLane);
    const somidos = oponentes.filter((f) => vistoHa(f, t) >= 12 && vistoHa(f, t) < 60);
    if (oponentes.length && somidos.length === oponentes.length && jg && vistoHa(jg, t) > 15 && !ladoNosso(minhaPos)) situ('lane-sumiu-jg', { tipo: 'perigo', prioridade: 2, modulo: 'mapa', serio: F`${somidos.map((f) => f.campeao).join(' e ')} sumiu da lane e o jungler deles também. Recua.`, cooldown: 60 });
  }
  // contagem de sumidos, quando você está avançado
  const sumidos = fIni.filter((f) => !f.morto && vistoHa(f, t) > 15);
  if (sumidos.length >= 3 && minhaPos && !ladoNosso(minhaPos)) situ('sumidos', { tipo: 'perigo', prioridade: 2, modulo: 'mapa', serio: F`${sumidos.length} deles sumidos e você no lado deles.`, cooldown: 45, dados: { sumidos: sumidos.map((f) => f.campeao) } });
  // split push: um deles sozinho numa lane lateral, 3+ juntos em outro lugar
  {
    const vis = fIni.filter((f) => visivel(f, t));
    for (const f of vis) {
      if (!['top', 'bot'].includes(f.regiao?.lane)) continue;
      const outros = vis.filter((g) => g !== f);
      const longe = outros.filter((g) => dist(g.ultimo, f.ultimo) > 0.35);
      if (outros.length >= 3 && longe.length === outros.length) situ(`split-${f.nome}`, { tipo: 'grupo', prioridade: 0, modulo: 'mapa', serio: F`${f.campeao} sozinho no ${f.regiao.lane}. Os outros ${outros.length} ${lugarTxt(outros[0].ultimo)}.`, cooldown: 60 });
    }
  }

  /* ============================================ 3. grupo e objetivos */
  {
    const vis = fIni.filter((f) => visivel(f, t));
    const alVis = fAli.filter((f) => visivel(f, t));
    for (const o of objetivos) {
      const pit = pitDe(o.nome);
      // Um minuto antes: o quadro do objetivo numa frase (jungler deles, quantos deles perto, seu jungler).
      if (!o.vivo && o.em > 50 && o.em <= 62 && ['Dragão', 'Barão', 'Ancião', 'Arauto'].includes(o.nome)) {
        const partes = [];
        if (jg) partes.push(visivel(jg, t) ? `jungler deles ${lugarTxt(jg.ultimo)}` : jg.morto ? 'jungler deles morto' : jg.ultimo ? `jungler deles sumido há ${Math.round(vistoHa(jg, t))} segundos` : 'jungler deles não visto');
        const pertoPit = vis.filter((f) => dist(f.ultimo, pit) < 0.2).length;
        if (pertoPit) partes.push(`${pertoPit} deles perto do pit`);
        if (meuJg && visivel(meuJg, t)) partes.push(`seu jungler a ${seg(dist(meuJg.ultimo, pit))} segundos`);
        const semWard = !!mundo.wards && !mundo.wards.nossas.some((w) => dist(w, pit) < 0.14);
        if (semWard) partes.push('sem ward no pit');
        situ(`pre-${o.nome}-${Math.floor((t + o.em) / 60)}`, { tipo: 'objetivo', prioridade: 2, modulo: 'timers', serio: partes.length ? F`${o.nome} em um minuto: ${partes.join(', ')}.` : F`${o.nome} em um minuto.`, cooldown: 100, dados: { semWard } });
      }
      const deles = vis.filter((f) => dist(f.ultimo, pit) < 0.12), nossos = [...alVis, ...(minhaPos ? [fEu] : [])].filter((f) => f.ultimo && dist(f.ultimo, pit) < 0.12);
      if (!o.vivo && o.em > 0 && o.em <= 60 && deles.length >= 2) situ(`armando-${o.nome}`, { tipo: 'objetivo', prioridade: 2, modulo: 'timers', serio: F`${deles.length} deles no ${o.nome}, que nasce em ${Math.round(o.em)} segundos.`, cooldown: 60 });
      if (o.vivo && jg && deles.length === 0) {
        if (jg.morto && (estado.jogadores.find((j) => j.nome === jg.nome)?.renasceEm ?? 0) >= 25) situ(`livre-${o.nome}`, { tipo: 'objetivo', prioridade: 2, modulo: 'timers', serio: F`${o.nome} livre: jungler deles morto por ${Math.round(estado.jogadores.find((j) => j.nome === jg.nome)?.renasceEm ?? 0)} segundos.`, cooldown: 90 });
        else if (visivel(jg, t) && seg(dist(jg.ultimo, pit)) >= 25) situ(`livre-${o.nome}`, { tipo: 'objetivo', prioridade: 2, modulo: 'timers', serio: F`${o.nome} livre: jungler deles a ${seg(dist(jg.ultimo, pit))} segundos do pit.`, cooldown: 90 });
      }
      // A gente fazendo o objetivo e o jungler deles chegando: risco de roubo
      if (o.vivo && nossos.length >= 2 && jg && visivel(jg, t) && seg(dist(jg.ultimo, pit)) <= 12 && deles.length <= 1) situ(`roubo-${o.nome}`, { tipo: 'objetivo', prioridade: 3, modulo: 'timers', serio: F`Jungler deles a ${seg(dist(jg.ultimo, pit))} segundos do ${o.nome}. Cuidado com o roubo.`, divertido: F`Jungler deles chegando no ${o.nome} em ${seg(dist(jg.ultimo, pit))} segundos. Smite na hora ou perde.`, cooldown: 30 });
      if (o.vivo && deles.length >= 2 && nossos.length === 0) situ(`furtivo-${o.nome}`, { tipo: 'objetivo', prioridade: 3, modulo: 'timers', serio: F`${deles.length} deles no ${o.nome} e ninguém nosso lá!`, divertido: F`${deles.length} deles roubando o ${o.nome} na cara dura!`, cooldown: 30 });
      if (o.vivo && deles.length >= 2 && nossos.length >= 2) situ(`contest-${o.nome}`, { tipo: 'objetivo', prioridade: 2, modulo: 'timers', serio: F`Luta no ${o.nome}: ${deles.length} deles, ${nossos.length} nossos.`, cooldown: 30 });
      if (o.vivo && nossos.length >= 3 && jg && !visivel(jg, t) && vistoHa(jg, t) > 20) situ(`obj-sem-jg-${o.nome}`, { tipo: 'objetivo', prioridade: 2, modulo: 'timers', serio: F`${o.nome} sem saber do jungler deles. Ward no pit.`, cooldown: 60 });
    }
    // agrupados
    const grupo = vis.filter((f) => vis.filter((g) => dist(f.ultimo, g.ultimo) < 0.14).length >= 4);
    if (grupo.length >= 4 && minhaPos && grupo.every((f) => dist(f.ultimo, minhaPos) > 0.3)) situ('agrupados', { tipo: 'grupo', prioridade: 1, modulo: 'mapa', serio: F`${grupo.length} deles agrupados ${lugarTxt(grupo[0].ultimo)}.`, cooldown: 60 });
    // flanco: um deles perto do nosso grupo, no lado oposto ao resto deles
    if (alVis.length >= 3) {
      const cx = alVis.reduce((s, f) => s + f.ultimo.x, 0) / alVis.length, cy = alVis.reduce((s, f) => s + f.ultimo.y, 0) / alVis.length;
      const centro = { x: cx, y: cy };
      const grupoApertado = alVis.every((f) => dist(f.ultimo, centro) < 0.14);
      const pertoNosso = grupoApertado ? vis.filter((f) => dist(f.ultimo, centro) < 0.18) : [];
      const restoDeles = vis.filter((f) => !pertoNosso.includes(f));
      for (const f of pertoNosso) {
        if (restoDeles.length < 2) continue;
        const rc = { x: restoDeles.reduce((s, g) => s + g.ultimo.x, 0) / restoDeles.length, y: restoDeles.reduce((s, g) => s + g.ultimo.y, 0) / restoDeles.length };
        const lado = (f.ultimo.x - centro.x) * (rc.x - centro.x) + (f.ultimo.y - centro.y) * (rc.y - centro.y);
        if (lado < 0 && pertoNosso.length >= 2) situ(`flanco-${f.nome}`, { tipo: 'perigo', prioridade: 3, modulo: 'mapa', serio: F`Flanco: ${f.campeao} atrás do time.`, divertido: F`${f.campeao} por trás! Flanco.`, cooldown: 40 });
      }
    }
    // base sendo empurrada
    const naBase = vis.filter((f) => dist(f.ultimo, minhaBase) < 0.16);
    if (naBase.length && t > 900) situ('base-empurrada', { tipo: 'perigo', prioridade: 3, modulo: 'timers', serio: F`${naBase.length} deles na nossa base.`, cooldown: 45 });
    // base deles vazia (backdoor) / reset
    if (t > 1200 && vis.length >= 4 && vis.every((f) => dist(f.ultimo, baseDeles) > 0.35)) situ('base-vazia', { tipo: 'oportunidade', prioridade: 1, modulo: 'timers', serio: F`Base deles vazia: ${vis.length} vistos longe.`, cooldown: 90 });
    const recuando = vis.filter((f) => dist(f.ultimo, baseDeles) < 0.16);
    if (t > 900 && recuando.length >= 4) situ('reset-deles', { tipo: 'oportunidade', prioridade: 2, modulo: 'timers', serio: F`${recuando.length} deles na base. Objetivo de graça.`, cooldown: 90 });
  }

  /* ============================================ 3a. wards */
  if (leitura.wards) {
    mundo.wards ??= { nossas: [], deles: [] };
    for (const lado of ['nossas', 'deles']) {
      const lista = mundo.wards[lado];
      for (const w of leitura.wards[lado] ?? []) {
        const j = lista.find((q) => dist(q, w) < 0.02);
        if (j) { j.t = t; j.tipo = w.tipo; } else lista.push({ x: w.x, y: w.y, tipo: w.tipo, t, desde: t });
      }
      mundo.wards[lado] = lista.filter((q) => t - q.t < 90);
    }
    // ward deles revelada: registro (e pro jungler/sup, que limpam)
    for (const w of mundo.wards.deles) if (w.desde === t) { const l = lugar(w.x, w.y, meuTime); situ(`ward-deles-${l.chave}`, { tipo: 'visao', prioridade: ['jungle', 'bot'].includes(minhaLane) && l.lado === 'nosso' ? 1 : 0, modulo: 'mapa', serio: F`Ward deles ${l.texto}.`, cooldown: 120, dados: { x: w.x, y: w.y } }); }
  }
  /* ============================================ 3b. waves (minions) */
  if (leitura.waves) {
    mundo.wavesBruto = leitura.waves;
    for (const [lane, w] of Object.entries(leitura.waves)) {
      if (w.frente == null || w.red + w.azul < 6) continue;
      // frente: 0 = base azul, 1 = base vermelha → lado de quem está
      const noNossoLado = meuTime === 100 ? w.frente < 0.45 : w.frente > 0.55;
      const noLadoDeles = meuTime === 100 ? w.frente > 0.55 : w.frente < 0.45;
      const estadoWave = noNossoLado ? 'nosso' : noLadoDeles ? 'deles' : 'meio';
      const antes = mundo.waves[lane];
      mundo.waves[lane] = { estado: estadoWave, frente: w.frente, t };
      if (antes?.estado === estadoWave) continue;
      const minha = lane === minhaLane;
      if (estadoWave === 'nosso') situ(`wave-${lane}-nosso`, { tipo: 'wave', prioridade: 0, modulo: 'lane', serio: F`Wave do ${lane} empurrada pro nosso lado.`, cooldown: 90, dados: { lane, frente: w.frente } });
      else if (estadoWave === 'deles') situ(`wave-${lane}-deles`, { tipo: 'wave', prioridade: 0, modulo: 'lane', serio: minha ? F`Sua wave está na torre deles${jg && vistoHa(jg, t) > 15 ? ' e o jungler sumido' : ''}.` : F`Wave do ${lane} na torre deles.`, cooldown: 90, dados: { lane, frente: w.frente } });
    }
  }

  /* ============================================ 4. você */
  if (minhaPos) {
    const pertoTodos = fIni.filter((f) => visivel(f, t) && seg(dist(f.ultimo, minhaPos)) <= 8);
    const minhaRegiao = lugar(minhaPos.x, minhaPos.y, meuTime);
    const esperado = (f) => minhaLane && minhaLane !== 'jungle' && LANE_DE[f.role] === minhaLane && minhaRegiao.lane === minhaLane;   // oponente de lane, na lane
    const perto = pertoTodos.length >= 3 ? pertoTodos : pertoTodos.filter((f) => !esperado(f));
    if (perto.length >= 2 || (perto.length === 1 && pertoTodos.length >= 2)) situ('perigo-perto', { tipo: 'perigo', prioridade: 3, modulo: 'mapa', serio: perto.length >= 2 ? F`${perto.length} deles a menos de 8 segundos de você.` : F`${perto[0].campeao} a menos de 8 segundos de você, com o ${pertoTodos.find((f) => f !== perto[0]).campeao}.`, divertido: F`${pertoTodos.length} deles vindo te buscar. Sai.`, cooldown: 30, dados: { quem: pertoTodos.map((f) => f.campeao) } });
    const vidaPct = eu.vidaMax ? eu.vida / eu.vidaMax : 1;
    if (vidaPct < 0.35 && perto.length) situ('vida-baixa-vindo', { tipo: 'perigo', prioridade: 3, modulo: 'kills', serio: F`Vida baixa e ${perto[0].campeao} vindo. Sai.`, cooldown: 20 });
    if (!ladoNosso(minhaPos) && jg && vistoHa(jg, t) > 15 && t > 120) situ('na-frente-sem-jg', { tipo: 'perigo', prioridade: 2, modulo: 'mapa', serio: F('Você no lado deles sem saber do jungler.'), cooldown: 60 });
    const pertoLane = fIni.filter((f) => visivel(f, t) && seg(dist(f.ultimo, minhaPos)) <= 20);
    if (!pertoLane.length && minhaLane && minhaLane !== 'jungle' && ['top', 'mid', 'bot'].includes(lugar(minhaPos.x, minhaPos.y, meuTime).lane)) {
      const desde = mundo.lanesLivres.get('eu') ?? t; mundo.lanesLivres.set('eu', desde);
      if (t - desde >= 10) situ('lane-livre', { tipo: 'oportunidade', prioridade: 0, modulo: 'lane', serio: F('Ninguém perto. Lane livre, empurra.'), cooldown: 120 });
      if (t - desde >= 10 && eu.ouro >= 1300) situ('hora-de-voltar', { tipo: 'oportunidade', prioridade: 1, modulo: 'economia', serio: F`Ninguém perto e ${eu.ouro} de gold. Hora de voltar.`, cooldown: 120 });
    } else mundo.lanesLivres.delete('eu');
    const aliadoMaisPerto = fAli.filter((f) => visivel(f, t)).map((f) => dist(f.ultimo, minhaPos)).sort((a, b) => a - b)[0];
    if (t > 1200 && aliadoMaisPerto != null && aliadoMaisPerto > 0.3 && sumidos.length >= 2) situ('isolado', { tipo: 'perigo', prioridade: 2, modulo: 'mapa', serio: F`Você isolado: aliado mais perto a ${seg(aliadoMaisPerto)} segundos, ${sumidos.length} deles sumidos.`, cooldown: 60 });
  }

  /* ============================================ 4b. zona onde você morre muito (banco) */
  if (minhaPos && leitura.mortesZona && t > 120) {
    const ZONA_DE = { 'rio-barao': 'river de cima', 'rio-dragao': 'river de baixo', barao: 'pit do barão', dragao: 'pit do dragão', 'jg-cima-nosso': 'sua jungle de cima', 'jg-baixo-nosso': 'sua jungle de baixo', 'jg-cima-deles': 'jungle deles de cima', 'jg-baixo-deles': 'jungle deles de baixo' };
    const l = lugar(minhaPos.x, minhaPos.y, meuTime);
    const zona = ZONA_DE[l.chave] ?? (['top', 'mid', 'bot'].includes(l.lane) ? l.lane : null);
    const n = zona ? leitura.mortesZona.porZona[zona] ?? 0 : 0;
    const porJogo = n / leitura.mortesZona.jogos;
    // só zonas fora da sua lane, com histórico ruim, e com o jungler deles sumido
    if (zona && zona !== minhaLane && porJogo >= 0.5 && jg && vistoHa(jg, t) > 15) situ(`zona-ruim-${zona}`, { tipo: 'perigo', prioridade: 1, modulo: 'mapa', serio: F`Você morre ${porJogo.toFixed(1)} vezes por jogo aqui (${zona}) e o jungler deles está sumido.`, cooldown: 240, dados: { zona, porJogo } });
  }

  /* ============================================ 5. aliados */
  if (meuJg && minhaPos && visivel(meuJg, t)) {
    const s = seg(dist(meuJg.ultimo, minhaPos));
    const v = velocidade(meuJg, t), vindo = v ? dist({ x: meuJg.ultimo.x + v.vx * 3, y: meuJg.ultimo.y + v.vy * 3 }, minhaPos) < dist(meuJg.ultimo, minhaPos) : false;
    if (s <= 12 && vindo && minhaLane !== 'jungle') situ('meu-jg-vindo', { tipo: 'aliado', prioridade: 2, modulo: 'jungler', serio: F`Seu jungler a ${s} segundos, vindo. Prepara.`, divertido: F`Seu jungler chegando em ${s} segundos. Prepara o CC.`, cooldown: 45 });
    else if (s >= 28 && minhaLane !== 'jungle') situ('meu-jg-longe', { tipo: 'aliado', prioridade: 0, modulo: 'jungler', serio: F`Seu jungler longe (${s} segundos). Não troca de graça.`, cooldown: 120 });
  }
  {
    const alVis = fAli.filter((f) => visivel(f, t));
    const grupo = alVis.filter((f) => alVis.filter((g) => dist(f.ultimo, g.ultimo) < 0.14).length >= 3);
    if (grupo.length >= 3 && minhaPos && grupo.every((f) => dist(f.ultimo, minhaPos) > 0.3) && t > 900) situ('time-agrupou', { tipo: 'aliado', prioridade: 1, modulo: 'mapa', serio: F`Time agrupou ${lugarTxt(grupo[0].ultimo)} e você longe.`, cooldown: 90 });
    // aliado avançado no lado deles com o jungler deles perto dele (ou sumido) — vale pra quem faz call / pro jungler
    for (const f of alVis) {
      if (f.nome === eu.nome || !LANE_DE[f.role] || LANE_DE[f.role] === 'jungle') continue;
      const l = lugar(f.ultimo.x, f.ultimo.y, meuTime);
      if (l.lado !== 'deles' || !['top', 'mid', 'bot'].includes(l.lane) || dist(f.ultimo, baseDeles) > 0.42) continue;
      const jgPerto = !!(jg && visivel(jg, t) && seg(dist(jg.ultimo, f.ultimo)) <= 12);
      const jgSumido = !!(jg && vistoHa(jg, t) > 25);
      if (jgPerto || jgSumido) situ(`aliado-avancado-${f.nome}`, { tipo: 'aliado', prioridade: minhaLane === 'jungle' && jgPerto ? 2 : 0, modulo: 'mapa', serio: jgPerto ? F`${f.campeao} avançado no ${l.lane} com o jungler deles perto.` : F`${f.campeao} avançado no ${l.lane} e o jungler deles sumido.`, cooldown: 60, dados: { lane: l.lane, jgPerto } });
    }
    for (const f of alVis) {
      const outros = alVis.filter((g) => g !== f);
      if (t > 900 && outros.length >= 3 && outros.every((g) => dist(g.ultimo, f.ultimo) > 0.35) && fIni.filter((g) => visivel(g, t) && dist(g.ultimo, f.ultimo) < 0.15).length >= 2) situ(`aliado-sozinho-${f.nome}`, { tipo: 'aliado', prioridade: 1, modulo: 'mapa', serio: F`${f.campeao} sozinho com ${fIni.filter((g) => visivel(g, t) && dist(g.ultimo, f.ultimo) < 0.15).length} deles em cima.`, cooldown: 60 });
    }
  }

  /* ============================================ 7. início */
  if (t < 95 && !mundo.invadeDito) {
    const naNossa = fIni.filter((f) => visivel(f, t) && f.regiao?.lado === 'nosso' && f.regiao.lane === 'jungle');
    if (naNossa.length >= 2) { mundo.invadeDito = true; situ('invade', { tipo: 'perigo', prioridade: 3, modulo: 'jungler', serio: F`Invade! ${naNossa.length} deles na nossa jungle.`, divertido: F`INVADE! ${naNossa.length} deles na nossa jungle, acorda!`, cooldown: 1 }); }
    const cheese = fIni.filter((f) => visivel(f, t) && f.regiao?.lado === 'nosso' && ['top', 'mid', 'bot'].includes(f.regiao.lane));
    if (cheese.length && t >= 40 && t < 80) situ('cheese', { tipo: 'perigo', prioridade: 2, modulo: 'mapa', serio: F`${cheese[0].campeao} já no nosso ${cheese[0].regiao.lane} aos ${mmss(t)}.`, cooldown: 120 });
  }

  /* ============================================ 8. fechar */
  if (t > 1200) {
    const barao = objetivos.find((o) => o.nome === 'Barão' && o.vivo);
    const vis = fIni.filter((f) => visivel(f, t));
    if (barao && vis.filter((f) => dist(f.ultimo, PONTOS.barao) < 0.1).length >= 3 && minhaPos && dist(minhaPos, PONTOS.barao) > 0.35) situ('solta-barao', { tipo: 'objetivo', prioridade: 3, modulo: 'timers', serio: F('Eles no Barão. Solta o que está fazendo.'), cooldown: 40 });
  }

  // Controle de spam: no máximo uma fala a cada 4 s, a não ser prioridade 3.
  // Quem decide o que é falado é o cérebro (cerebro.js); aqui só marca o que é registro puro.
  for (const s of novas) if (s.prioridade === 0) s.falar = false;
  return novas;
}

/** Foto do mundo pra gravar (1x por segundo): posições e idades. */
export function instantaneo(mundo, estado) {
  const t = estado.tempo ?? 0;
  return {
    t,
    waves: mundo.wavesBruto ?? null,
    wards: mundo.wards ? { nossas: mundo.wards.nossas.map((w) => [w.x, w.y, w.tipo]), deles: mundo.wards.deles.map((w) => [w.x, w.y]) } : null,
    campeoes: [...mundo.campeoes.values()].map((f) => ({ c: f.campeao, time: f.time, role: f.role, morto: !!f.morto, x: f.ultimo?.x ?? null, y: f.ultimo?.y ?? null, ha: f.ultimo ? Math.round((t - f.ultimo.t) * 10) / 10 : null, regiao: f.regiao?.chave ?? null })),
  };
}
