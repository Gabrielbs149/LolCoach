import { tabelaDeItens, fichaDoCampeao } from '../dados/ddragon.js';
import { confrontoContra } from '../dados/confrontos.js';
import { zonaRelativa, dist } from './mapa.js';

/**
 * Análise situação por situação: cada morte lida com o que ela era DE VERDADE —
 * minuto, quem contra quem, nível de cada um (ult ou não), itens fechados dos dois
 * lados, vida com que entrou, qual magia tirou quanto, ouro da lane naquele
 * momento — e a lane como confronto (adc×adc, sup×sup, estilo do duo) com plano
 * por fase. Nada de dica genérica da Riot: só o que os números da partida dizem.
 */

const TECLAS = ['Q', 'W', 'E', 'R'];
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// estilos do bot lane (mesma tabela do sinergia.js, resumida pro plano)
const SUP = {
  engage: ['Leona', 'Nautilus', 'Rell', 'Alistar', 'Thresh', 'Blitzcrank', 'Pyke', 'Rakan', 'Braum', 'Maokai', 'Pantheon', 'Poppy', 'Galio', 'Shen', 'Nunu & Willump'],
  enchanter: ['Lulu', 'Yuumi', 'Nami', 'Janna', 'Soraka', 'Milio', 'Karma', 'Sona', 'Renata Glasc', 'Seraphine', 'Taric', 'Ivern'],
  poke: ['Lux', 'Morgana', 'Xerath', 'Zyra', 'Brand', "Vel'Koz", 'Swain', 'Neeko', 'Zilean', 'Senna', 'Hwei', 'Mel', 'Heimerdinger', 'Zoe', 'Ashe'],
};
const ADC = {
  allin: ['Samira', 'Lucian', "Kai'Sa", 'Draven', 'Xayah', 'Nilah', 'Tristana', 'Vayne', 'Yasuo', 'Kalista'],
  hyper: ['Jinx', "Kog'Maw", 'Twitch', 'Aphelios', 'Zeri', 'Smolder', 'Kindred', 'Yunara'],
  poke: ['Caitlyn', 'Jhin', 'Ezreal', 'Ashe', 'Varus', 'Miss Fortune', 'Senna', 'Ziggs', 'Seraphine', 'Karthus', 'Swain', 'Corki'],
};
const R = (r) => ({ ADC: 'adc', SUPORTE: 'sup', SUP: 'sup', MID: 'mid', TOP: 'top', JUNGLE: 'jungle', BOT: 'bot' })[String(r ?? '').toUpperCase()] ?? String(r ?? '').toLowerCase();
const estiloDe = (tabela, nome) => Object.entries(tabela).find(([, l]) => l.includes(nome))?.[0] ?? null;

/* ------------------------------------------------------------- estado no tempo */

/** Itens de cada jogador ao longo do tempo (compra, venda, destruição, desfazer). */
function itensPorTempo(p) {
  const posse = new Map();   // id -> [itemId...]
  const linha = new Map();   // id -> [{t, itens:[...]}]
  for (const j of p.jogadores) { posse.set(j.id, []); linha.set(j.id, []); }
  for (const e of p.eventos) {
    if (!/^ITEM_/.test(e.tipo) || !e.autorId) continue;
    const lista = posse.get(e.autorId); if (!lista) continue;
    if (e.tipo === 'ITEM_PURCHASED' && e.itemId) lista.push(e.itemId);
    else if ((e.tipo === 'ITEM_SOLD' || e.tipo === 'ITEM_DESTROYED') && e.itemId) { const i = lista.indexOf(e.itemId); if (i >= 0) lista.splice(i, 1); }
    else if (e.tipo === 'ITEM_UNDO') { if (e.antes) { const i = lista.indexOf(e.antes); if (i >= 0) lista.splice(i, 1); } if (e.depois) lista.push(e.depois); }
    else continue;
    linha.get(e.autorId).push({ t: e.t, itens: [...lista] });
  }
  return (id, t) => { const l = linha.get(id) ?? []; let ult = []; for (const x of l) { if (x.t > t) break; ult = x.itens; } return ult; };
}

/** Nível de cada jogador em t (pelos LEVEL_UP; frame como reserva). */
function nivelEm(p, id, t) {
  let n = 1;
  for (const e of p.eventos) { if (e.tipo === 'LEVEL_UP' && e.autorId === id && e.t <= t && e.nivel) n = Math.max(n, e.nivel); }
  const f = p.frameEm(t)?.dados?.[id]?.nivel;
  return Math.max(n, f ?? 1);
}
/** Já tem ult (aprendeu o R) em t. */
function temUlt(p, id, t) {
  return p.eventos.some((e) => e.tipo === 'SKILL_LEVEL_UP' && e.autorId === id && e.t <= t && e.skillSlot === 4);
}

/* ------------------------------------------------------------- a lane */

export async function analiseDaLane(p, eu, opcoes = {}) {
  const meuTime = eu.time, deles = (j) => j.time !== meuTime;
  const roleDe = (r) => p.jogadores.filter((j) => R(j.role) === r);
  const bot = R(eu.role) === 'adc' || R(eu.role) === 'sup';
  const ehBot = (j) => R(j.role) === 'adc' || R(j.role) === 'sup';
  const meus = bot ? [eu, ...p.jogadores.filter((j) => j.time === meuTime && j.id !== eu.id && ehBot(j))] : [eu];
  const rivais = bot ? p.jogadores.filter((j) => deles(j) && ehBot(j)) : roleDe(R(eu.role)).filter(deles);
  if (!rivais.length) return null;

  // taxas do op.gg por função (adc×adc, sup×sup, solo×solo)
  const taxas = [];
  for (const m of meus) {
    const r = rivais.find((x) => R(x.role) === R(m.role)); if (!r) continue;
    const c = await confrontoContra(m.campeao, R(m.role), r.championId, opcoes).catch(() => null);
    if (c?.jogos >= 50) taxas.push({ meu: m.campeao, contra: r.campeao, taxa: Math.round(c.taxa * 100), jogos: c.jogos });
  }
  const media = taxas.length ? taxas.reduce((s, t) => s + t.taxa, 0) / taxas.length : null;
  const veredito = media == null ? null : media < 47 ? 'difícil' : media > 53 ? 'favorável' : 'jogável';

  // ouro da lane (soma do par) aos 5/10/15 e primeira torre da lane
  const laneDele = { adc: 'BOT_LANE', sup: 'BOT_LANE', mid: 'MID_LANE', top: 'TOP_LANE' }[R(eu.role)] ?? null;
  const ouro = [5, 10, 15].filter((m) => p.frames.some((f) => f.minuto >= m)).map((m) => {
    const f = p.frames.find((x) => x.minuto >= m);
    const soma = (lista) => lista.reduce((s, j) => s + (f.dados[j.id]?.ouroTotal ?? 0), 0);
    return { minuto: m, diff: soma(meus) - soma(rivais) };
  });
  const torre = p.eventos.find((e) => e.tipo === 'BUILDING_KILL' && e.predio === 'TOWER_BUILDING' && e.rota === laneDele);
  const primeiraTorre = torre ? { minuto: mmss(torre.t), nossa: torre.timeVitima === meuTime } : null;

  // plano por fase, pelo estilo do duo (bot) ou pelas classes (solo)
  const plano = [];
  if (bot) {
    const meuAdc = meus.find((j) => R(j.role) === 'adc'), meuSup = meus.find((j) => R(j.role) === 'sup');
    const adcDeles = rivais.find((j) => R(j.role) === 'adc'), supDeles = rivais.find((j) => R(j.role) === 'sup');
    const eA = meuAdc ? estiloDe(ADC, meuAdc.campeao) : null, eS = meuSup ? estiloDe(SUP, meuSup.campeao) : null;
    const dA = adcDeles ? estiloDe(ADC, adcDeles.campeao) : null, dS = supDeles ? estiloDe(SUP, supDeles.campeao) : null;
    const nomeDuo = (a, s) => [a?.campeao, s?.campeao].filter(Boolean).join(' + ');
    const nosso = nomeDuo(meuAdc, meuSup), deles2 = nomeDuo(adcDeles, supDeles);
    plano.push(`${nosso} contra ${deles2}.`);
    if (dS === 'engage' && (eS === 'poke' || eA === 'poke')) plano.push(`Cedo (1–5): vocês têm alcance, eles têm engage — o 2v2 é de vocês enquanto a entrada do ${supDeles.campeao} estiver no chão; trade curta e volta. Ele acerta a entrada = a troca vira deles: fica atrás da wave.`);
    else if (eS === 'engage' && (dS === 'poke' || dA === 'poke')) plano.push(`Cedo (1–5): eles pokam, vocês entram — ou o ${meuSup.campeao} acha a entrada ou vocês perdem vida de graça. Não fica trocando de longe: ou entra, ou farma atrás.`);
    else if (dS === 'enchanter' && eS === 'engage') plano.push(`Cedo (1–5): enchanter sem engage do lado deles — o all-in é de vocês, principalmente antes dos itens de cura.`);
    else if (eS === 'enchanter' && dS === 'engage') plano.push(`Cedo (1–5): ${supDeles.campeao} decide a lane com a entrada — o jogo é não dar a entrada de graça (ward no arbusto, posição atrás dos minions).`);
    else if (dA === 'hyper' && eA !== 'hyper') plano.push(`Cedo (1–5): ${adcDeles.campeao} escala — o que vocês tiram cedo vale o dobro; depois dos 2 itens dele a lane inverte.`);
    else if (eA === 'hyper') plano.push(`Cedo (1–5): você escala, eles não — a lane é sobreviver e farmar; cada morte cedo atrasa o seu jogo inteiro.`);
    else plano.push('Cedo (1–5): lane parelha — decide quem trade melhor com a wave a favor.');
    if (supDeles && SUP.poke.includes(supDeles.campeao)) plano.push(`Dos 6 em diante: ${supDeles.campeao} com ult mata de longe quem está abaixo de metade da vida — não fica no alcance dela com pouca vida.`);
    if (adcDeles && ADC.hyper.includes(adcDeles.campeao)) plano.push(`Tarde (2+ itens): ${adcDeles.campeao} vira o carry deles — briga só com o time junto.`);
    if (dS === 'engage') plano.push(`Meio (6–14): o 6 do ${supDeles.campeao} é engage de qualquer lugar — respeita o flash dele e não fica em ponto cego.`);
  } else {
    const r = rivais[0];
    const [fEu, fEle] = await Promise.all([fichaDoCampeao(eu.championId).catch(() => null), fichaDoCampeao(r.championId).catch(() => null)]);
    const tags = (f) => f?.tags ?? [];
    plano.push(`${eu.campeao} contra ${r.campeao}.`);
    if (tags(fEle).includes('Assassin')) plano.push('Assassino do outro lado: a janela dele é o 6 — antes disso é a sua lane; depois, ward no rio e não fica avançado sem saber do jungler.');
    if (tags(fEle).includes('Tank') || tags(fEle).includes('Fighter')) plano.push('Ele quer a troca longa: não fica no alcance dele de graça; sua vantagem é o alcance e a wave.');
    if (tags(fEle).includes('Mage') && tags(fEu).includes('Marksman')) plano.push('Mago de poke contra você: os minions bloqueiam a maior parte — trade só quando ele gasta a magia.');
  }

  return { meus: meus.map((j) => ({ campeao: j.campeao, championId: j.championId, role: R(j.role) })), rivais: rivais.map((j) => ({ campeao: j.campeao, championId: j.championId, role: R(j.role) })), taxas, media: media == null ? null : Math.round(media), veredito, ouro, primeiraTorre, plano, bot };
}

/** Uma frase pra voz na tela de carregamento: como se joga o 2v2 do bot (só pelo estilo dos 4). */
export function planoRapidoDoBot({ meuCampeao, minhaRole, jogadores, meuTime }) {
  if (!['adc', 'sup'].includes(R(minhaRole))) return null;
  const meus = jogadores.filter((j) => j.time === meuTime), deles = jogadores.filter((j) => j.time !== meuTime);
  const meuAdc = meus.find((j) => R(j.role) === 'adc'), meuSup = meus.find((j) => R(j.role) === 'sup');
  const adcDeles = deles.find((j) => R(j.role) === 'adc'), supDeles = deles.find((j) => R(j.role) === 'sup');
  if (!meuAdc || !meuSup || !adcDeles || !supDeles) return null;
  const eA = estiloDe(ADC, meuAdc.campeao), eS = estiloDe(SUP, meuSup.campeao), dA = estiloDe(ADC, adcDeles.campeao), dS = estiloDe(SUP, supDeles.campeao);
  const duo = `${adcDeles.campeao} e ${supDeles.campeao}`;
  if (dS === 'engage' && (eS === 'poke' || eA === 'poke')) return `Bot contra ${duo}: vocês têm alcance, eles têm entrada. Trade curta enquanto o ${supDeles.campeao} está sem engage; ele entra, vocês recuam.`;
  if (eS === 'engage' && (dS === 'poke' || dA === 'poke')) return `Bot contra ${duo}: eles pokam. Ou o ${meuSup.campeao} acha a entrada, ou farma atrás — não troca de longe.`;
  if (dS === 'enchanter' && eS === 'engage') return `Bot contra ${duo}: sem engage do lado deles — o all-in é de vocês antes dos itens de cura.`;
  if (eS === 'enchanter' && dS === 'engage') return `Bot contra ${duo}: o ${supDeles.campeao} decide com a entrada. Ward no arbusto e posição atrás dos minions.`;
  if (dA === 'hyper' && eA !== 'hyper') return `Bot contra ${duo}: ${adcDeles.campeao} escala — o que vocês tiram cedo vale o dobro.`;
  if (eA === 'hyper') return `Bot contra ${duo}: você escala — a lane é sobreviver e farmar.`;
  if (dS === 'poke' || dA === 'poke') return `Bot contra ${duo}: eles pokam de longe — minions na frente e trade só quando gastam a magia.`;
  return `Bot contra ${duo}: lane parelha — decide quem troca com a wave a favor.`;
}

/* ------------------------------------------------------------- as mortes */

export async function situacoesDasMortes(p, eu) {
  const itens = await tabelaDeItens().catch(() => new Map());
  const itensEm = itensPorTempo(p);
  const grandes = (lista) => [...new Set(lista)].map((id) => itens.get(id)).filter((it) => it && it.preco >= 900).map((it) => it.nome);
  const mortes = p.eventos.filter((e) => e.tipo === 'CHAMPION_KILL' && e.vitimaId === eu.id);
  const saida = [];
  const souBot = R(eu.role) === 'adc' || R(eu.role) === 'sup';
  const laneIds = new Set(p.jogadores.filter((j) => j.time === eu.time && j.id !== eu.id && souBot && (R(j.role) === 'adc' || R(j.role) === 'sup')).map((j) => j.id));

  for (const [i, m] of mortes.entries()) {
    const t = m.t, minuto = t / 60000;
    const fase = minuto < 14 ? 'lane' : minuto < 25 ? 'meio' : 'fim';
    const onde = m.pos ? zonaRelativa(m.pos, eu.time) : null;
    // quem bateu de verdade (API) e quem estava perto
    const dano = new Map();
    for (const d of m.danoRecebido ?? []) { const j = p.jogador(d.participantId); if (!j || j.time === eu.time) continue; const v = (d.physicalDamage ?? 0) + (d.magicDamage ?? 0) + (d.trueDamage ?? 0); const reg = dano.get(j.id) ?? { j, total: 0, teclas: new Map() }; reg.total += v; if (!d.basic && TECLAS[d.spellSlot]) reg.teclas.set(TECLAS[d.spellSlot], (reg.teclas.get(TECLAS[d.spellSlot]) ?? 0) + v); dano.set(j.id, reg); }
    const algozes = [...dano.values()].sort((a, b) => b.total - a.total);
    const delesPerto = m.pos ? p.perto(m.pos, t - 1, 2500, { time: eu.time === 100 ? 200 : 100 }) : [];
    const nossosPerto = m.pos ? p.perto(m.pos, t - 1, 2500, { time: eu.time, exceto: [eu.id] }) : [];
    const deles = [...new Set([...algozes.map((a) => a.j), ...delesPerto])];
    const nossos = nossosPerto;
    const meuNivel = nivelEm(p, eu.id, t), minhaUlt = temUlt(p, eu.id, t);
    const meusItens = grandes(itensEm(eu.id, t));
    const totalDano = algozes.reduce((s, a) => s + a.total, 0);
    const linhas = [], fazer = [];

    // cabeçalho: números e lugar
    const nv = `${nossos.length + 1}v${deles.length}`;
    linhas.push(`${mmss(t)} — ${nv}${onde ? ` ${onde}` : ''}: você (${eu.campeao} nv ${meuNivel}${minhaUlt ? '' : ', sem ult'}${meusItens.length ? `, ${meusItens.join(' + ')}` : ', sem item fechado'})${nossos.length ? ` com ${nossos.map((j) => j.campeao).join(', ')}` : ' sozinho'} contra ${deles.map((j) => { const n = nivelEm(p, j.id, t); const it = grandes(itensEm(j.id, t)); return `${j.campeao} nv ${n}${temUlt(p, j.id, t) && n >= 6 ? '' : ' (sem ult)'}${it.length ? ` com ${it.join(' + ')}` : ''}`; }).join(', ')}.`);

    // quem tirou o quê
    if (algozes.length) {
      const a = algozes[0];
      const maior = [...a.teclas.entries()].sort((x, y) => y[1] - x[1])[0];
      linhas.push(`Dano: ${algozes.map((x) => `${x.j.campeao} ${Math.round(x.total)}${[...x.teclas.entries()].length ? ` (${[...x.teclas.entries()].sort((q, w) => w[1] - q[1]).slice(0, 2).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')})` : ''}`).join(' · ')}.`);
      // spike recente do algoz (item grande fechado nos últimos 2 min)
      const compras = p.eventos.filter((e) => e.tipo === 'ITEM_PURCHASED' && e.autorId === a.j.id && e.t <= t && t - e.t <= 120000).map((e) => itens.get(e.itemId)).filter((it) => it && it.preco >= 2000);
      if (compras.length) { linhas.push(`${a.j.campeao} tinha acabado de fechar ${compras.at(-1).nome} (há ${Math.round((t - p.eventos.find((e) => e.tipo === 'ITEM_PURCHASED' && e.autorId === a.j.id && itens.get(e.itemId)?.nome === compras.at(-1).nome && e.t <= t).t) / 1000)} s): a troca que era parelha antes virou perda.`); fazer.push(`Quando ele fecha item e você não, a lane muda: até fechar o seu, é ward e farm — não é hora de trade.`); }
      // janela de ult
      const nA = nivelEm(p, a.j.id, t);
      if (nA >= 6 && temUlt(p, a.j.id, t) && (meuNivel < 6 || !minhaUlt)) { linhas.push(`${a.j.campeao} tinha ult e você não: dos 6 dele até o seu 6 é a pior janela do confronto.`); fazer.push(`Até o seu 6, fica atrás da wave e só troca quando ele gasta a magia principal.`); }
      // limiar de vida pelo dano real de uma magia
      if (maior && R(a.j.role) !== 'jungle') {
        const f = p.frameEm(t); const vidaTotal = f?.dados?.[eu.id]?.vidaMax ?? null;
        if (!vidaTotal && totalDano) { const [tecla, v] = maior; const fatia = pct(v, totalDano); if (fatia >= 40) { linhas.push(`Só o ${tecla} do ${a.j.campeao} foi ${fatia}% do dano que te matou.`); fazer.push(`Regra pra esse confronto: com menos de metade da vida você está no alcance de morrer pro ${tecla} — sai do alcance antes, não depois.`); } }
      }
    }
    // vida e lado mais forte numa luta parelha ou em vantagem numérica
    const fr = p.frameEm(t); const vidaMax = fr?.dados?.[eu.id]?.stats?.healthMax ?? null;
    if (vidaMax && totalDano) { const entrou = Math.min(100, pct(totalDano, vidaMax)); if (entrou <= 60) { linhas.push(`Entrou na luta com uns ${entrou}% de vida (${Math.round(totalDano)} de dano numa vida de ${Math.round(vidaMax)}).`); fazer.push('Com menos de 60% de vida você não tem troca: recua ou volta antes de encostar.'); } }
    if (deles.length <= nossos.length + 1 && algozes.length) {
      const a = algozes[0]; const nA = nivelEm(p, a.j.id, t), itA = grandes(itensEm(a.j.id, t)).length, itEu = meusItens.length;
      if (nA - meuNivel >= 2 || itA - itEu >= 1) { linhas.push(`${a.j.campeao} estava na frente: ${nA - meuNivel >= 2 ? `${nA - meuNivel} níveis a mais` : ''}${nA - meuNivel >= 2 && itA - itEu >= 1 ? ' e ' : ''}${itA - itEu >= 1 ? `${itA - itEu} item grande a mais` : ''} — não era luta pra aceitar.`); fazer.push('Olha nível e itens no Tab antes de trocar: atrás em nível ou item, você farma e espera o jungler.'); }
      else if (deles.length < nossos.length + 1) { linhas.push(`Em vantagem numérica (${nv}) e morreu: ou o dano dele é maior que o seu nesse ponto do jogo, ou o time não acompanhou.`); fazer.push('Em vantagem, quem começa a luta é quem tem mais vida e o parceiro do lado — confere os dois antes.'); }
    }
    // números
    if (deles.length >= nossos.length + 2) { const jg = deles.find((j) => R(j.role) === 'jungle'); const extra = deles.length - (nossos.length + 1); linhas.push(jg ? `Gank: ${jg.campeao} chegou e virou ${nv}.` : `${nv}: ${extra} a mais deles.`); const partJg = jg ? p.eventos.filter((e) => e.tipo === 'CHAMPION_KILL' && e.t < t && (e.autorId === jg.id || e.assists.includes(jg.id))).length : 0; fazer.push(jg ? (partJg ? `Ward no rio antes de empurrar: o ${jg.campeao} já tinha ${partJg} participação(ões) em kill até aí.` : `Primeiro gank dele na partida: sem ward, a lane empurrada é convite — warda o rio antes de passar do meio.`) : `${extra >= 2 ? 'Dois' : 'Um'} a mais não é trade, é fuga: recua no segundo que o outro aparece.`); }
    // parceiro de lane longe (bot)
    if (laneIds.size && m.pos) { const parc = p.jogadores.find((j) => laneIds.has(j.id) && j.id !== eu.id); if (parc && p.vivo(parc.id, t)) { const pp = p.frameEm(t - 1)?.pos?.[parc.id]; if (pp && dist(pp, m.pos) > 2500) { linhas.push(`Seu ${parc.campeao} estava a uns ${Math.round(dist(pp, m.pos) / 370)} s de você: era 1v${deles.length} disfarçado.`); fazer.push('Sem o sup do lado, você não tem troca no bot: espera ele voltar antes de encostar.'); } } }
    // ouro da lane naquele minuto
    const f = p.frameEm(t);
    if (f && laneIds.size) { const soma = (ids) => [...ids].reduce((s, id) => s + (f.dados[id]?.ouroTotal ?? 0), 0); const delesLane = p.jogadores.filter((j) => j.time !== eu.time && (R(j.role) === 'adc' || R(j.role) === 'sup')).map((j) => j.id); const diff = soma([eu.id, ...laneIds]) - soma(delesLane); if (Math.abs(diff) >= 500) linhas.push(`Ouro do bot naquele minuto: ${diff > 0 ? '+' : ''}${diff} pra ${diff > 0 ? 'vocês' : 'eles'}${diff < -500 ? ' — atrás em gold a troca já começa perdida.' : ' — vantagem que não precisava virar briga.'}`); }
    // repetição
    if (i > 0 && t - mortes[i - 1].t <= 100000) { linhas.push(`${Math.round((t - mortes[i - 1].t) / 1000)} s depois da morte anterior, no mesmo cenário.`); fazer.push('Depois de morrer, volta diferente: outro lado da wave, ward antes, ou espera o jungler.'); }

    if (!fazer.length && algozes.length) {
      const a = algozes[0]; const maior = [...a.teclas.entries()].sort((x, y) => y[1] - x[1])[0];
      if (maior) { linhas.push(`Troca parelha (${nv}) perdida: o ${a.j.campeao} abriu com o ${maior[0]} (${Math.round(maior[1])}) e você não tinha o dano pra devolver nesse ponto do jogo.`); fazer.push(`Contra ${a.j.campeao}, o ${maior[0]} é a magia que decide: só encosta depois que ele gasta, e sai do alcance quando volta.`); }
      else { linhas.push(`Troca parelha (${nv}) perdida no ataque básico: ele bate mais que você nesse ponto do jogo.`); fazer.push('Sem vantagem de dano, a troca é com a wave a favor e o sup do lado — senão é farm.'); }
    }
    const pos = m.pos ? { x: Math.max(0, Math.min(1, m.pos.x / 14820)), y: Math.max(0, Math.min(1, 1 - m.pos.y / 14820)) } : null;
    saida.push({ t, minuto: mmss(t), fase, onde, pos, linhas, fazer: [...new Set(fazer)].slice(0, 3) });
  }
  // padrão da partida
  const padrao = [];
  const porAlgoz = new Map();
  for (const s of saida) { const m = s.linhas[0].match(/contra ([^ ]+(?: [^ ]+)?) nv/); if (m) porAlgoz.set(m[1], (porAlgoz.get(m[1]) ?? 0) + 1); }
  const top = [...porAlgoz.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2 && saida.length >= 3) padrao.push(`${top[1]} das ${saida.length} mortes tiveram ${top[0]} como primeiro nome: o confronto que decidiu a sua partida foi esse.`);
  const semUlt = saida.filter((s) => s.linhas.some((l) => /tinha ult e você não/.test(l))).length;
  if (semUlt >= 2) padrao.push(`${semUlt} mortes na janela em que ele tinha ult e você não.`);
  const spikes = saida.filter((s) => s.linhas.some((l) => /acabado de fechar/.test(l))).length;
  if (spikes >= 2) padrao.push(`${spikes} mortes logo depois de um item deles fechar: olha a loja dele no Tab antes de trocar.`);
  return { mortes: saida, padrao };
}
