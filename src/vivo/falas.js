/**
 * O que a voz fala durante a partida. Cada fala tem um módulo (pra ligar e
 * desligar na tela), um id (fala uma vez só) e dois textos: sério e
 * divertido. Tudo sai do relógio, do placar e do feed de eventos da API que o
 * próprio jogo abre — nada de posição, nada de tela.
 *
 * O estilo segue o que um coach de voz de verdade faz na partida: curto,
 * no momento, e com a ação que você deve tomar agora.
 */

import { F } from './texto.js';

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ROLE_FALA = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'ADC', sup: 'suporte' };

const DRAGAO = {
  Fire: ['Dragão Infernal', 'Mais dano de ataque e habilidade pra gente.'],
  Water: ['Dragão do Oceano', 'Mais sustentação nas lutas.'],
  Earth: ['Dragão da Montanha', 'Mais resistência pra gente.'],
  Air: ['Dragão das Nuvens', 'Mais velocidade. Facilita gank e rotação.'],
  Hextech: ['Dragão Hextec', 'Mais aceleração e velocidade.'],
  Chemtech: ['Dragão Quimtec', 'A gente fica mais forte com menos vida.'],
  Elder: ['Dragão Ancião', 'Execução ativa. Toda luta agora é pra ganhar.'],
};

export function novaMemoriaFalas() {
  return { ditas: new Set(), vistos: new Set(), ultimoTempo: 0, farmDito: new Set(), mortesPor: new Map(), meusKills: 0, meusItens: new Set(), mortosAntes: new Set(), nivelAntes: 0 };
}

/**
 * `estado`: leitura da API do jogo; `rastreio`: o que rastreio.js viu de novo;
 * `objetivos`: de objetivos.js; `conselhos`: de conselhos.js.
 * Devolve só as falas NOVAS desde a última chamada.
 */
export function falasNovas({ estado, rastreio, objetivos, conselhos, extras }, mem) {
  const { tempo, eu, jogadores, eventos } = estado;
  const novas = [];
  const dizer = (id, modulo, serio, divertido, prioridade = 1) => {
    if (mem.ditas.has(id)) return;
    mem.ditas.add(id);
    novas.push({ id, modulo, serio, divertido: divertido ?? serio, prioridade });
  };
  const inimigos = jogadores.filter((j) => j.time !== eu.time);
  const aliados = jogadores.filter((j) => j.time === eu.time);
  const ehAliado = (n) => aliados.some((j) => j.nome === n);
  const porNome = (n) => jogadores.find((j) => j.nome === n);
  const jgDeles = inimigos.find((j) => j.role === 'jungle');
  const minhaRole = eu.role;
  // Cada evento é lido UMA vez (por id): reler mudaria contadores como 'te matou N vezes'.
  const novo = (e) => { const k = e.id ?? `${e.tipo}-${e.t}`; if (mem.vistos.has(k)) return false; mem.vistos.add(k); return true; };

  /* ---- começo ---- */
  if (minhaRole !== 'jungle' && tempo >= 190 && tempo < 200 && jgDeles) dizer('jg-primeiro', 'jungler', F`Três minutos. ${jgDeles.campeao} termina o clear agora. Ward no rio.`, F`Três minutos: ${jgDeles.campeao} acabou o clear. Ward no rio.`, 2);

  /* ---- timers ---- */
  for (const o of objetivos ?? []) {
    const chave = `${o.nome}-${Math.round((tempo + o.em) / 60)}`;
    if (o.em > 55 && o.em <= 62) {
      if (o.nome === 'Dragão') dizer(`t60-${chave}`, 'timers', F('Dragão em um minuto.'), F('Dragão em um minuto. Vai pro rio.'), 2);
      else if (o.nome === 'Barão') dizer(`t60-${chave}`, 'timers', F('Barão em um minuto. Visão no pit.'), F('Barão em um minuto. Junta o time.'), 2);
      else if (o.nome === 'Ancião') dizer(`t60-${chave}`, 'timers', F('Ancião em um minuto. Time inteiro no pit.'), F('Ancião em um minuto. Quem pegar ganha.'), 3);
      else if (o.nome === 'Vastilarvas') dizer(`t60-${chave}`, 'timers', F('Vastilarvas em um minuto.'), F('Vastilarvas em um minuto.'), 1);
      else dizer(`t60-${chave}`, 'timers', F`${o.nome} em um minuto.`, F`${o.nome} em um minuto.`, 2);
    } else if (o.em > 25 && o.em <= 32) {
      dizer(`t30-${chave}`, 'timers', F`Trinta segundos pro ${o.nome}.`, F`Trinta segundos pro ${o.nome}.`, 3);
    } else if (o.vivo && o.em > -6) {
      dizer(`nasceu-${chave}`, 'timers', F`${o.nome} nasceu.`, F`${o.nome} nasceu.`, 2);
    }
  }
  if (tempo >= 13 * 60 && tempo < 13 * 60 + 8) dizer('placas', 'timers', F('Placas caem em um minuto.'), F('Um minuto pras placas.'), 2);

  /* ---- eventos ---- */
  for (const e of eventos) {
    if (!novo(e)) continue;
    const autorJ = porNome(e.autor), vitimaJ = porNome(e.vitima);

    if (e.tipo === 'ChampionKill') {
      const souAutor = e.autor === eu.nome, souVitima = e.vitima === eu.nome;
      if (souVitima) {
        const quem = autorJ?.campeao ?? 'eles';
        const n = (mem.mortesPor.get(e.autor) ?? 0) + 1; mem.mortesPor.set(e.autor, n);
        if (n >= 2) dizer(`morte-${e.id}`, 'kills', F`${quem} te matou ${n} vezes.`, F`${quem} de novo. ${n} vezes.`, 3);
      } else if (souAutor) {
        mem.meusKills++;
        const k = mem.meusKills;
        if (k >= 5 && k % 5 === 0) dizer(`kill-${e.id}`, 'kills', F`${k} kills. Não morre de graça.`, F`${k} kills. Segura o ego.`, 1);
      } else if (autorJ && autorJ.time !== eu.time && autorJ.role === 'jungle' && vitimaJ?.role) {
        dizer(`jg-${e.id}`, 'jungler', F`${autorJ.campeao} matou no ${vitimaJ.role}. Lado oposto livre.`, F`${autorJ.campeao} no ${vitimaJ.role}. Outro lado livre.`, 2);
      } else if (jgDeles && e.assistentes?.includes(jgDeles.nome) && vitimaJ && vitimaJ.time === eu.time) {
        dizer(`jg-${e.id}`, 'jungler', F`${jgDeles.campeao} gankou o ${vitimaJ.role}.`, F`${jgDeles.campeao} gankou o ${vitimaJ.role}.`, 1);
      } else if (vitimaJ && vitimaJ.time !== eu.time && vitimaJ.role === 'jungle') {
        dizer(`jgmorreu-${e.id}`, 'jungler', F`Jungler deles morreu. ${Math.round(vitimaJ.renasceEm || 30)} segundos livres.`, F`Jungler deles morreu. ${Math.round(vitimaJ.renasceEm || 30)} segundos livres.`, 2);
      }
    }
    if (e.tipo === 'Ace') dizer(`ace-${e.id}`, 'kills', ehAliado(e.autor) ? F('Ace. Barão ou torre agora.') : F('Levamos ace. Defende a base.'), ehAliado(e.autor) ? F('Ace. Vai pro Barão.') : F('Levamos ace. Segura a base.'), 3);

    if (e.tipo === 'DragonKill') {
      const nosso = ehAliado(e.autor);
      const [nome, buff] = DRAGAO[e.dragao] ?? ['Dragão', ''];
      const meus = eventos.filter((x) => x.tipo === 'DragonKill' && x.t <= e.t && ehAliado(x.autor)).length;
      const deles = eventos.filter((x) => x.tipo === 'DragonKill' && x.t <= e.t && !ehAliado(x.autor)).length;
      if (nosso) dizer(`dg-${e.id}`, 'timers', F`${nome} nosso${e.roubado ? ', roubado' : ''}.${meus === 3 ? ' Próximo é a alma.' : ''}`, F`${nome} nosso${e.roubado ? ', roubado' : ''}.${meus === 3 ? ' Próximo é a alma.' : ''}`, 2);
      else dizer(`dg-${e.id}`, 'timers', F`${nome} deles.${deles === 3 ? ' Próximo fecha a alma pra eles.' : ''}`, F`${nome} deles.${deles === 3 ? ' Próximo fecha a alma pra eles.' : ''}`, deles === 3 ? 3 : 1);
    }
    if (e.tipo === 'BaronKill') dizer(`bk-${e.id}`, 'timers', ehAliado(e.autor) ? F('Barão nosso. Empurra as três lanes.') : F('Barão deles. Defende e limpa wave, sem briga.'), ehAliado(e.autor) ? F('Barão nosso. Empurra tudo.') : F('Barão deles. Só defende.'), 3);
    if (e.tipo === 'HeraldKill') dizer(`hk-${e.id}`, 'timers', ehAliado(e.autor) ? F('Arauto nosso.') : F('Arauto deles.'), ehAliado(e.autor) ? F('Arauto nosso.') : F('Arauto deles.'), 2);
    if (e.tipo === 'HordeKill') {
      const n = eventos.filter((x) => x.tipo === 'HordeKill' && x.t <= e.t && ehAliado(x.autor)).length;
      if (n === 3) dizer(`horde-${e.id}`, 'timers', F('Vastilarvas nossas.'), F('Vastilarvas nossas.'), 1);
    }
    if (e.tipo === 'TurretKilled' && e.torre) {
      const m = String(e.torre).match(/Turret_T(\d)_([LRC])_(\d\d)/);
      const nossa = m && Number(m[1]) === (eu.time === 100 ? 1 : 2);
      const lane = m ? ({ L: 'top', C: 'mid', R: 'bot' })[m[2]] : '';
      const inib = m && m[3] === '01';
      if (nossa) dizer(`tk-${e.id}`, 'timers', inib ? F`Torre do inibidor do ${lane} caiu.` : F`Torre nossa do ${lane} caiu.`, inib ? F`Torre do inibidor do ${lane} caiu.` : F`Torre nossa do ${lane} caiu.`, inib ? 3 : 1);
      else dizer(`tk-${e.id}`, 'timers', inib ? F`Torre do inibidor deles no ${lane} caiu.` : F`Torre deles no ${lane} caiu.`, inib ? F`Torre do inibidor deles no ${lane} caiu.` : F`Torre deles no ${lane} caiu.`, 2);
    }
    if (e.tipo === 'InhibKilled') dizer(`ik-${e.id}`, 'timers', ehAliado(e.autor) ? F('Inibidor deles caiu.') : F('Inibidor nosso caiu.'), ehAliado(e.autor) ? F('Inibidor deles caiu.') : F('Inibidor nosso caiu.'), 2);
  }

  /* ---- extras: build, dano deles, mains ---- */
  let jaFalouDoGold = false;
  if (extras) {
    if (extras.dano && tempo > 20) {
      const { ap, ad } = extras.dano;
      if (ad >= 4) dizer('dano', 'lane', F`Time deles: ${ad} AD. Armadura.`, F`Time deles: ${ad} AD. Armadura.`, 1);
      else if (ap >= 3) dizer('dano', 'lane', F`Time deles: ${ap} AP. Resistência mágica.`, F`Time deles: ${ap} AP. Resistência mágica.`, 1);
    }
    for (const m of extras.mains ?? []) {
      if (m.pontos >= 150000) dizer(`main-${m.nome}`, 'lane', F`${m.campeao} ${m.role === 'jungle' ? 'deles' : 'do seu lado'} é main: ${Math.round(m.pontos / 1000)} mil pontos.`, F`${m.campeao} é main: ${Math.round(m.pontos / 1000)} mil pontos.`, 1);
      else if (m.pontos > 0 && m.pontos < 25000) dizer(`main-${m.nome}`, 'lane', F`${m.campeao} ${m.role === 'jungle' ? 'deles' : 'do seu lado'} não é main: ${Math.round(m.pontos / 1000)} mil pontos.`, F`${m.campeao} não é main: ${Math.round(m.pontos / 1000)} mil pontos.`, 1);
    }
    // Build: fechou item da build → próximo; gold pra fechar → volta.
    const b = extras.build;
    if (b?.ordem?.length) {
      const tenho = new Set((eu.itens ?? []).map((i) => i.id));
      for (const it of b.ordem) {
        if (tenho.has(it.id) && !mem.meusItens.has(it.id)) {
          mem.meusItens.add(it.id);
          const prox = b.ordem.find((x) => !tenho.has(x.id));
          const cedo = tempo < 8 * 60 && b.principais?.[0]?.id === it.id;
          dizer(`item-${it.id}`, 'economia', F`${it.nome} fechado.${prox ? ` Próximo: ${prox.nome}.` : ''}`, F`${it.nome} fechado.${prox ? ` Próximo: ${prox.nome}.` : ''}`, 1);
        }
      }
      const prox = b.ordem.find((x) => !tenho.has(x.id));
      if (prox?.preco && eu.ouro >= prox.preco && !eu.morto) { jaFalouDoGold = true; dizer(`gold-item-${prox.id}`, 'economia', F`Tem gold pro ${prox.nome}.`, F`Tem gold pro ${prox.nome}.`, 2); }
    }
  }

  /* ---- você × seu oponente direto, a cada 3 minutos depois dos 6 ---- */
  const rival = inimigos.find((j) => j.role && j.role === minhaRole && minhaRole !== 'sup');
  if (rival && tempo >= 360 && tempo % 180 < 8) {
    const k = Math.floor(tempo / 180);
    const vant = (eu.nivel - rival.nivel) + (eu.cs - rival.cs) / 25 + (eu.kills - rival.kills) * 0.7 - (eu.mortes - rival.mortes) * 0.5;
    if (vant >= 2) dizer(`rival-${k}`, 'lane', F`Você está na frente do ${rival.campeao}.`, F`Você está na frente do ${rival.campeao}.`, 1);
    else if (vant <= -2) dizer(`rival-${k}`, 'lane', F`${rival.campeao} está na frente. Não força trade.`, F`${rival.campeao} está na frente. Não força trade.`, 1);
  }
  const itensRival = rival ? (rival.itens ?? []).filter((i) => i.preco >= 2000).length : 0;
  if (rival && itensRival >= 2) dizer(`rival-itens-${itensRival}`, 'spikes', F`${rival.campeao} fechou o ${itensRival}º item.`, F`${rival.campeao} fechou o ${itensRival}º item.`, 2);

  /* ---- seu nível 6 ---- */
  mem.nivelAntes = eu.nivel;

  /* ---- inimigo nasceu ---- */
  for (const j of inimigos) {
    if (j.morto) mem.mortosAntes.add(j.nome);
    else if (mem.mortosAntes.has(j.nome)) { mem.mortosAntes.delete(j.nome); if (tempo > 60) dizer(`nasceu-${j.nome}-${Math.floor(tempo)}`, 'mapa', F`${j.campeao} nasceu.`, F`${j.campeao} nasceu.`, 0); }
  }

  /* ---- torres: vantagem ---- */
  const torres = eventos.filter((e) => e.tipo === 'TurretKilled' && e.torre);
  const minhasT = torres.filter((e) => Number(String(e.torre).match(/Turret_T(\d)/)?.[1]) !== (eu.time === 100 ? 1 : 2)).length;
  const delasT = torres.length - minhasT;
  if (minhasT - delasT >= 3) dizer(`torres-${minhasT - delasT}`, 'timers', F`${minhasT - delasT} torres na frente.`, F`${minhasT - delasT} torres na frente.`, 1);
  else if (delasT - minhasT >= 3) dizer(`torres--${delasT - minhasT}`, 'timers', F`${delasT - minhasT} torres atrás.`, F`${delasT - minhasT} torres atrás.`, 1);

  /* ---- jungler deles morto: janela ---- */
  if (jgDeles?.morto && jgDeles.renasceEm > 20) dizer(`jgbase-${Math.floor(tempo / 60)}`, 'jungler', F`${jgDeles.campeao} morto por ${Math.round(jgDeles.renasceEm)} segundos.`, F`${jgDeles.campeao} morto por ${Math.round(jgDeles.renasceEm)} segundos.`, 1);

  /* ---- spikes vindos do rastreio ---- */
  for (const a of rastreio?.avisos ?? []) {
    if (a.t < mem.ultimoTempo - 1) continue;
    if (String(a.chave).startsWith('item-')) dizer(`fala-${a.chave}`, 'spikes', F`${a.titulo}.`, F`${a.titulo}.`, a.urgencia);
    else if (String(a.chave).startsWith('nv-') && /nível 6/.test(a.titulo)) dizer(`fala-${a.chave}`, 'spikes', F`${a.titulo}.`, F`${a.titulo}.`, 2);
    else if (String(a.chave).startsWith('nv-') && /níveis na frente/.test(a.titulo)) dizer(`fala-${a.chave}`, 'spikes', F`${a.titulo}.`, F`${a.titulo}.`, 2);
    else if (String(a.chave).startsWith('jg-')) dizer(`fala-${a.chave}`, 'jungler', a.titulo, a.titulo, 2);
  }

  /* ---- inimigo fedado ---- */
  const forte = inimigos.find((j) => j.kills >= 5 && j.kills >= j.mortes * 2);
  if (forte) dizer(`forte-${forte.nome}-${forte.kills}`, 'kills', F`${forte.campeao} está ${forte.kills} a ${forte.mortes}. Não vai sozinho nele.`, F`${forte.campeao} fedado: ${forte.kills} a ${forte.mortes}. Não vai sozinho.`, 2);

  /* ---- economia ---- */
  const vidaPct = eu.vidaMax ? eu.vida / eu.vidaMax : 1;
  if (!eu.morto && eu.ouro >= 1000 && vidaPct < 0.4) dizer(`base-${Math.floor(tempo / 45)}`, 'economia', F('Vida baixa e gold sobrando. Base.'), F('Vida baixa e gold sobrando. Base.'), 2);
  else if (!eu.morto && eu.ouro >= 2000 && !jaFalouDoGold) dizer(`gold-${Math.floor(tempo / 240)}`, 'economia', F`${eu.ouro} de gold parado.`, F`${eu.ouro} de gold parado.`, 1);

  /* ---- estado do jogo ---- */
  const nossosKills = aliados.reduce((s, j) => s + j.kills, 0), delesKills = inimigos.reduce((s, j) => s + j.kills, 0);
  if (tempo >= 900 && tempo < 908 && nossosKills !== delesKills) dizer('jogo-15', 'lane', F`Quinze minutos: ${nossosKills} a ${delesKills} em kills.`, F`Quinze minutos: ${nossosKills} a ${delesKills}.`, 1);
  const mortosDeles = inimigos.filter((j) => j.morto).length;
  if (mortosDeles >= 3) dizer(`3mortos-${Math.floor(tempo / 30)}`, 'timers', F`${mortosDeles} deles mortos. Torre ou objetivo agora.`, F`${mortosDeles} deles mortos. Pega alguma coisa.`, 3);
  if (tempo >= 1800 && tempo < 1808 && nossosKills > delesKills + 5) dizer('fecha', 'lane', F`Trinta minutos, ${nossosKills - delesKills} kills na frente. Fecha o jogo.`, F`Trinta minutos, ${nossosKills - delesKills} kills na frente. Fecha.`, 2);

  /* ---- conselhos urgentes que ainda não foram ditos ---- */
  for (const c of conselhos ?? []) {
    if (c.urgencia < 3) continue;
    const modulo = /gold/i.test(c.titulo) ? 'economia' : /vida/i.test(c.titulo) ? 'kills' : /dragão|barão|dragões/i.test(c.titulo) ? 'timers' : 'lane';
    dizer(`c-${c.chave ?? c.titulo}`, modulo, `${c.titulo}. ${c.acao}`, `${c.titulo}. ${c.acao}`, c.urgencia);
  }

  mem.ultimoTempo = tempo;
  return novas.sort((a, b) => b.prioridade - a.prioridade);
}

/**
 * Na seleção de campeão: com quem dos seus picks você ganha dos inimigos já
 * travados, pelos confrontos do op.gg. Devolve a lista ordenada e uma fala.
 */
export async function sugerirPick({ candidatos, rota, inimigosIds, confrontoContra, tabela, opcoes }) {
  const resultado = [];
  for (const nome of candidatos) {
    const linhas = [];
    for (const id of inimigosIds) {
      const c = await confrontoContra(nome, rota, id, opcoes).catch(() => null);
      if (c) linhas.push({ id, campeao: tabela.porId.get(id) ?? String(id), taxa: c.taxa, jogos: c.jogos });
    }
    const media = linhas.length ? linhas.reduce((s, l) => s + l.taxa, 0) / linhas.length : null;
    resultado.push({ nome, media, contra: linhas });
  }
  resultado.sort((a, b) => (b.media ?? -1) - (a.media ?? -1));
  const melhor = resultado.find((r) => r.media != null);
  const pior = melhor?.contra.sort((a, b) => a.taxa - b.taxa)[0];
  const fala = melhor
    ? { serio: F`Pelos confrontos, ${melhor.nome} é o melhor pick contra o que eles travaram${pior && pior.taxa < 0.47 ? `; cuidado com ${pior.campeao}` : ''}.`,
        divertido: F`${melhor.nome} come esse time deles${pior && pior.taxa < 0.47 ? `, menos o ${pior.campeao}, que é chato` : ''}.` }
    : null;
  return { lista: resultado, fala, mmss };
}

/* Campeões com muito controle de grupo: com três ou mais no time deles, vale Purificar/Mercúrio. */
const MUITO_CC = new Set(['Morgana', 'Malzahar', 'Leona', 'Nautilus', 'Ashe', 'Lissandra', 'Sejuani', 'Amumu', 'Skarner', 'Warwick', 'Rammus', 'Thresh', 'Blitzcrank', 'Zoe', 'Neeko', 'Twisted Fate', 'Veigar', 'Annie', 'Fiddlesticks', 'Maokai', 'Zyra', 'Lux', 'Pyke', 'Rell', 'Alistar', 'Braum', 'Galio', 'Gragas', 'Jarvan IV', 'Kennen', 'Malphite', 'Nami', 'Ornn', 'Poppy', 'Sion', 'Swain', 'Taric', 'Vi', 'Zac', 'Xin Zhao', 'Bard', "Cho'Gath", 'Elise', 'Renata Glasc', 'Nunu & Willump', 'Zilean', 'Ahri', 'Yone', 'Sett', 'Volibear', 'Trundle', 'Urgot', 'Aatrox', 'Lulu', 'Milio']);

const ESTILO = { 8000: 'Precisão', 8100: 'Dominação', 8200: 'Feitiçaria', 8300: 'Inspiração', 8400: 'Determinação' };

/**
 * Falas da seleção de campeão: uma por acontecimento (enemy travou, seu ban
 * sugerido, muito CC no time deles, runas aplicadas). `mem.ditas` zera a
 * cada seleção nova.
 */
export function falasDaSelecao({ rota, inimigos, aliados, meuCampeao, sugestaoBan, runas }, mem) {
  const novas = [];
  const dizer = (id, serio, divertido, prioridade = 1) => {
    if (mem.ditas.has(id)) return;
    mem.ditas.add(id);
    novas.push({ id, modulo: 'selecao', serio, divertido: divertido ?? serio, prioridade });
  };
  const rotaFala = ROLE_FALA[{ top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'sup' }[rota] ?? rota] ?? rota;
  if (sugestaoBan?.length) {
    const [a, b] = sugestaoBan;
    dizer('ban', F`Ban sugerido: ${a.campeao}.${b ? ` Ou ${b.campeao}.` : ''}`, F`Ban sugerido: ${a.campeao}.${b ? ` Ou ${b.campeao}.` : ''}`, 2);
  }
  for (const i of inimigos) if (i.nome) dizer(`ini-${i.id}`, F`Inimigo pegou ${i.nome}${i.rota ? ' ' + i.rota : ''}.`, F`Eles pegaram ${i.nome}. Anota.`, 1);
  const cc = inimigos.filter((i) => MUITO_CC.has(i.nome)).length;
  if (cc >= 3 && ['bottom', 'middle'].includes(rota)) dizer('cc', F`${cc} campeões de CC no time deles. Purificar ou Mercúrio.`, F`${cc} de CC no time deles. Purificar ou Mercúrio.`, 2);
  if (meuCampeao && runas) dizer(`runas-${meuCampeao}`, F`Runas: ${runas.chave ?? ''}${runas.primaria ? ', ' + runas.primaria : ''}${runas.secundaria ? ' com ' + runas.secundaria : ''}.`, F`Runas: ${runas.chave ?? ''}.`, 1);
  return novas.sort((a, b) => b.prioridade - a.prioridade);
}
export { ESTILO };
