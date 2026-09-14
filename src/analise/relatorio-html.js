import { desenharMinimapa } from './minimapa.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const num = (n) => Number(n ?? 0).toLocaleString('pt-BR');

// As roles como se fala aqui, não como o client escreve.
const ROLES = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', ADC: 'adc', SUPORTE: 'sup', BOT: 'bot' };
const role = (r) => ROLES[r] ?? String(r ?? '').toLowerCase();

/**
 * Mesma paleta e escala do painel. Este arquivo abre sozinho no navegador,
 * fora do servidor local — então não há rota de arte nem de ícone aqui, e todo
 * o peso visual vem de tipo, espaço e cor.
 */
const ESTILO = `
:root{
  --f0:#070a0f; --f1:#0d131c; --f2:#131c27; --f3:#1a2534;
  --borda:#22303f; --texto:#e9f0f8; --fraco:#8ea0b5; --apagado:#5d6e84;
  --ouro:#c8aa6e; --ouro-claro:#f0d9a8; --ouro-escuro:#8a713f;
  --vit:#31b073; --der:#e05555;
  --g3:#e05555; --g2:#e0a03f; --g1:#4d8fc4;
  --r-s:4px; --r-m:6px;
  --e1:4px; --e2:8px; --e3:14px; --e4:22px;
}
*{box-sizing:border-box}
body{margin:0;background:var(--f0);color:var(--texto);
  font:13px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
/* Mesma largura travada do painel — texto corrido em 1400px não se lê. */
.folha{max-width:1120px;margin:0 auto;padding:24px 20px 50px}

.capa{position:relative;border:1px solid var(--borda);border-radius:var(--r-m);overflow:hidden;
  padding:16px 18px;margin-bottom:var(--e2);background:var(--f1);border-left-width:4px}
.capa.venceu{border-left-color:var(--vit)}
.capa.perdeu{border-left-color:var(--der)}
h1{font-size:21px;font-weight:700;letter-spacing:-.3px;margin:0}
.marcaRes{font-size:10px;font-weight:800;letter-spacing:.7px;padding:3px 9px;
  border-radius:var(--r-s);margin-left:9px;vertical-align:3px}
.marcaRes.venceu{background:#123a28;color:#4ed093}
.marcaRes.perdeu{background:#3a1618;color:#f07a7a}
.sub{color:var(--fraco);margin:3px 0 0;font-size:12px}

h2{display:flex;align-items:center;gap:9px;font-size:11px;text-transform:uppercase;
  letter-spacing:.9px;color:var(--apagado);font-weight:700;margin:var(--e4) 0 var(--e2)}
h2::after{content:"";flex:1;height:1px;background:var(--borda)}

.cartoes{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--e2)}
.cartao{background:var(--f1);border:1px solid var(--borda);border-radius:var(--r-m);padding:11px 13px}
.cartao .rot{font-size:10px;text-transform:uppercase;letter-spacing:.9px;color:var(--apagado)}
.cartao .val{font-size:22px;font-weight:700;margin-top:4px;line-height:1.1;letter-spacing:-.5px}
.cartao .pe{font-size:11.5px;color:var(--apagado);margin-top:3px}
.v{color:var(--vit)} .d{color:var(--der)} .o{color:var(--ouro)}
.nota{color:var(--fraco);font-size:12px;margin-top:var(--e2)}

.confronto{background:var(--f1);border:1px solid var(--borda);border-radius:var(--r-m);padding:13px 15px}
.confronto .cabc{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.confronto .cabc b{font-size:14px;font-weight:700}
.taxa{font-size:11px;font-weight:600;color:var(--fraco);border:1px solid var(--borda);
  border-radius:var(--r-s);padding:2px 8px}
.taxa.ruim{color:var(--der);border-color:#5c2226;background:#2a1517}
.taxa.bom{color:var(--vit);border-color:#1e5c40;background:#12291f}
.confronto ul.dicas{margin:0;padding-left:17px;color:#b8c7d8;font-size:12.5px;line-height:1.55}
.confronto ul.dicas li{margin-bottom:4px}
.rot2{font-size:10px;text-transform:uppercase;letter-spacing:.9px;color:var(--apagado);margin:12px 0 7px}
.magias{display:flex;flex-direction:column;gap:var(--e1)}
.magia{display:flex;align-items:center;gap:11px;flex-wrap:wrap;background:var(--f0);
  border:1px solid var(--borda);border-radius:var(--r-s);padding:7px 11px}
.magia .tecla{flex:0 0 24px;width:24px;height:24px;line-height:22px;text-align:center;
  border:1px solid var(--ouro);border-radius:var(--r-s);color:var(--ouro);font-weight:800;font-size:11.5px}
.magia .txt{flex:1 1 140px;min-width:0}
.magia .txt b{display:block;font-size:12.5px}
.magia .txt span{color:var(--apagado);font-size:11px}
.magia .nums{margin-left:auto;text-align:right;color:var(--fraco);font-size:11px;line-height:1.5}

.prio{background:var(--f1);border:1px solid var(--borda);border-left:3px solid var(--ouro);
  border-radius:var(--r-m);padding:12px 15px;margin-bottom:var(--e1)}
.prio .cab{display:flex;align-items:center;gap:10px}
.prio .n{width:20px;height:20px;line-height:20px;text-align:center;border-radius:50%;
  background:var(--ouro);color:#0b1119;font-weight:800;font-size:11px;flex:0 0 20px}
.prio h3{margin:0;font-size:14px;font-weight:650}
.prio p{margin:7px 0 0;color:#b8c7d8;font-size:12.5px;line-height:1.55}
.prio .quando{margin-top:7px;font-size:11px;color:var(--apagado)}
.prio .quando b{color:var(--ouro);font-weight:700}

.achado{background:var(--f1);border:1px solid var(--borda);border-left-width:3px;
  border-radius:var(--r-m);padding:11px 14px;margin-bottom:var(--e1);
  display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:14px;align-items:start}
.achado.g3{border-left-color:var(--g3)}
.achado.g2{border-left-color:var(--g2)}
.achado.g1{border-left-color:var(--g1)}
.achado .tempo{color:var(--ouro);font-variant-numeric:tabular-nums;font-weight:700;font-size:12.5px}
.achado .tit{font-weight:650;margin-left:9px;font-size:13px}
.achado ul{margin:8px 0 0;padding-left:16px;color:var(--fraco);font-size:12px;line-height:1.55}
.achado li{margin-bottom:3px}
.achado li.ctx{color:#b8c7d8;list-style:none;margin-left:-16px;padding-left:12px;
  border-left:2px solid var(--borda)}
.achado li.nar{color:#94a8bd;list-style:none;margin-left:-16px;padding-left:12px;
  border-left:2px solid #2a3a4d;font-style:italic}
.achado svg{width:100%;height:auto;border-radius:var(--r-m);display:block}
.resolucao{margin-top:9px;font-size:12px;color:#e0cda4;background:#1d1a13;
  border:1px solid #3d3423;border-radius:var(--r-s);padding:8px 11px;line-height:1.55}
.resolucao b{color:var(--ouro);display:block;margin-bottom:4px;font-size:10px;
  text-transform:uppercase;letter-spacing:.8px}
.resolucao div{margin-bottom:4px}
.resolucao div:last-child{margin-bottom:0}
.replay{margin-top:9px;font-size:10.5px;color:var(--apagado);font-family:ui-monospace,Consolas,monospace;
  background:var(--f0);border:1px solid var(--borda);border-radius:var(--r-s);padding:5px 8px;overflow-x:auto}
@media (max-width:760px){.achado{grid-template-columns:1fr}}

.placar{background:var(--f1);border:1px solid var(--borda);border-radius:var(--r-m);overflow:hidden}
.lj{display:grid;grid-template-columns:minmax(0,1fr) 64px 78px 62px 66px 56px;align-items:center;gap:10px;
  padding:5px 13px;border-bottom:1px solid var(--borda);font-size:12px}
.lj:last-child{border-bottom:0}
.lj.cab{font-size:9.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--apagado);background:var(--f0)}
.lj .nomej{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lj.eu{background:#1b2534}
.lj.eu .nomej{color:var(--ouro);font-weight:700}
.lj .n{text-align:right;font-variant-numeric:tabular-nums}
.divisor{padding:4px 13px;background:var(--f0);color:var(--apagado);
  font-size:9.5px;text-transform:uppercase;letter-spacing:.8px}

.legenda{display:flex;gap:13px;flex-wrap:wrap;color:var(--apagado);font-size:11px;margin:-2px 0 var(--e1)}
.legenda i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px}
`;

function cartao(rot, val, pe = '') {
  return `<div class="cartao"><div class="rot">${esc(rot)}</div><div class="val">${val}</div>${pe ? `<div class="pe">${esc(pe)}</div>` : ''}</div>`;
}

/** Monta o HTML completo do relatório de uma partida. */
export function relatorioHtml(p, eu, detalhe) {
  const r = detalhe.resumo;
  const venceu = r.venci ? 'venceu' : 'perdeu';
  const h = [];

  h.push(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.campeao)} ${role(r.role)} — ${r.venci ? 'vitória' : 'derrota'}</title>
<style>${ESTILO}</style></head><body><div class="folha">`);

  h.push(`<div class="capa ${venceu}">
    <h1>${esc(r.campeao)}<span class="marcaRes ${venceu}">${r.venci ? 'VITÓRIA' : 'DERROTA'}</span></h1>
    <p class="sub">${role(r.role)} · ${r.duracao.toFixed(0)} minutos · partida ${p.gameId}${r.rival ? ` · contra ${esc(r.rival.campeao)}` : ''}</p>
  </div>`);

  /* ---- números ---- */
  h.push('<div class="cartoes">');
  // GD15 primeiro: é o termômetro de lane que as ferramentas do ramo usam, e
  // não depende de kill vinda de gank como o KDA depende.
  if (r.gd15 !== null && r.gd15 !== undefined) {
    h.push(cartao('Gold aos 15',
      `<span class="${r.gd15 < -500 ? 'd' : r.gd15 > 500 ? 'v' : ''}">${r.gd15 > 0 ? '+' : ''}${num(r.gd15)}</span>`,
      r.rival ? `contra ${r.rival.campeao}` : ''));
  }
  h.push(cartao('KDA', esc(r.kda), `participou de ${r.participacao}% das kills`));
  h.push(cartao('Farm', `${r.csMin}<span style="font-size:12px;color:var(--apagado)">/min</span>`, `${num(r.cs)} no total`));
  h.push(cartao('Dano', `${r.fatiaDeDano}%`, 'do dano do time'));
  h.push(cartao('Gold entregue', num(r.custoTotal), 'morrendo'));
  h.push('</div>');

  if (r.virada) {
    h.push(`<p class="nota">O jogo virou no minuto <b class="o">${r.virada.minuto}</b> — o placar de gold mexeu ${r.virada.delta > 0 ? '+' : ''}${num(Math.round(r.virada.delta))} num único minuto.</p>`);
  }

  /* ---- confronto de lane ---- */
  const c = detalhe.confronto;
  if (c) {
    h.push('<h2>O confronto</h2><div class="confronto">');
    h.push(`<div class="cabc"><b>${esc(r.campeao)} contra ${esc(c.rival.campeao)}</b>${
      c.taxa !== null
        ? `<span class="taxa ${c.taxa < 47 ? 'ruim' : c.taxa > 53 ? 'bom' : ''}">${c.taxa}% de vitória em ${num(c.jogos)} jogos</span>`
        : ''}</div>`);

    // Dica tática primeiro; depois só as magias que de fato te machucaram, com
    // recarga e alcance. Descrição de habilidade não entra: nenhuma ferramenta
    // do ramo mostra isso, e não ajuda a decidir nada.
    if (c.dicas.length) {
      h.push(`<ul class="dicas">${c.dicas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
    }

    if (c.magias.length) {
      h.push('<div class="rot2">O que te matou nesta partida</div><div class="magias">');
      for (const m of c.magias) {
        h.push(`<div class="magia"><span class="tecla">${m.tecla}</span>
          <div class="txt"><b>${esc(m.nome)}</b><span>${num(m.dano)} de dano em você</span></div>
          <div class="nums">${m.recarga ? `${m.recarga}s de recarga` : ''}${m.alcance > 1 ? `<br>alcance ${m.alcance}` : ''}</div></div>`);
      }
      h.push('</div>');
    }
    h.push('</div>');
  }

  /* ---- prioridades ---- */
  if (detalhe.prioridades.length) {
    h.push('<h2>O que melhorar</h2>');
    detalhe.prioridades.forEach((pr, i) => {
      h.push(`<div class="prio">
        <div class="cab"><span class="n">${i + 1}</span><h3>${esc(pr.titulo)}</h3></div>
        <p>${esc(pr.texto)}</p>
        <div class="quando">Aconteceu em ${pr.momentos.map((t) => `<b>${mmss(t)}</b>`).join(', ')}</div>
      </div>`);
    });
  }

  /* ---- linha do tempo com mapas ---- */
  h.push(`<h2>Momento a momento — ${detalhe.achados.length} apontamentos</h2>`);
  h.push(`<div class="legenda">
    <span><i style="background:#c8aa6e"></i>você</span>
    <span><i style="background:#4b90b8"></i>seu time</span>
    <span><i style="background:#c94f49"></i>inimigos</span>
    <span><i style="background:#e05252"></i>quem causou o dano</span>
    <span>✕ onde aconteceu</span>
  </div>`);

  for (const a of detalhe.achados) {
    const frame = p.frameEm(a.t);
    const i = p.frames.indexOf(frame);
    const anterior = i - 1 > 0 ? p.frames[i - 1] : null;
    const mortos = p.jogadores.filter((j) => !p.vivo(j.id, a.t)).map((j) => j.id);
    const mapa = desenharMinimapa({
      pos: frame.pos,
      posAntes: anterior?.pos ?? null,
      jogadores: p.jogadores,
      eu,
      evento: a.pos,
      culpados: a.culpados,
      mortos,
      legenda: 'setas = deslocamento no minuto anterior',
    });

    h.push(`<div class="achado g${a.gravidade}"><div>`);
    h.push(`<div><span class="tempo">${mmss(a.t)}</span><span class="tit">${esc(a.titulo)}</span></div>`);
    h.push('<ul>');
    for (const m of a.motivos) h.push(`<li>${esc(m)}</li>`);
    for (const ctx of a.contexto) h.push(`<li class="ctx">${esc(ctx)}</li>`);
    for (const n of a.narrativa ?? []) h.push(`<li class="nar">${esc(n)}</li>`);
    h.push('</ul>');
    if (a.resolucao?.length) {
      h.push(`<div class="resolucao"><b>O que fazer</b>${a.resolucao.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`);
    }
    h.push(`<div class="replay">npm run ver -- ${p.gameId} ${mmss(a.t)}</div>`);
    h.push(`</div><div>${mapa}</div></div>`);
  }

  /* ---- placar ---- */
  h.push('<h2>Placar</h2><div class="placar">');
  h.push(`<div class="lj cab"><span>Campeão</span><span>Role</span><span class="n">KDA</span>
    <span class="n">Farm</span><span class="n">Dano</span><span class="n">Visão</span></div>`);
  let timeAtual = null;
  // Seu time primeiro, sempre: qual metade é a sua não deve depender de qual
  // lado do mapa a Riot te colocou.
  const ordem = [...p.jogadores].sort((a, b) =>
    (a.time === eu.time ? 0 : 1) - (b.time === eu.time ? 0 : 1) || a.id - b.id);
  for (const j of ordem) {
    if (j.time !== timeAtual) {
      timeAtual = j.time;
      h.push(`<div class="divisor">${j.time === eu.time ? 'Seu time' : 'Inimigos'}</div>`);
    }
    const s = j.stats;
    h.push(`<div class="lj ${j.id === eu.id ? 'eu' : ''}">
      <span class="nomej">${esc(j.campeao)}</span>
      <span style="color:var(--apagado)">${role(j.role)}</span>
      <span class="n">${s.kills}/${s.deaths}/${s.assists}</span>
      <span class="n">${num(s.totalMinionsKilled + s.neutralMinionsKilled)}</span>
      <span class="n">${num(s.totalDamageDealtToChampions)}</span>
      <span class="n">${num(s.visionScore)}</span></div>`);
  }
  h.push('</div>');

  h.push('</div></body></html>');
  return h.join('\n');
}
