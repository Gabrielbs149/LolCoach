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
import { nomeItem } from './itens-nomes.js';
import { torreInfo } from './torres.js';
import { daRota } from './rotas.js';

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ROLE_FALA = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'ADC', sup: 'suporte' };
const LANE_DE_ROLE = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'bot', sup: 'bot' };

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
export function falasNovas({ estado, rastreio, objetivos, conselhos, extras, olho = false, ultimoPerigoT = null }, mem) {
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
      if (olho && ['Dragão', 'Barão', 'Ancião', 'Arauto'].includes(o.nome)) { /* o quadro do olho fala esse */ }
      else if (o.nome === 'Dragão') dizer(`t60-${chave}`, 'timers', F('Dragão em um minuto.'), F('Dragão em um minuto. Vai pro rio.'), 2);
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
        // o porquê, quando dá pra saber: gank (jungler deles na kill), aviso de perigo nos 12 s antes, ou só "respeita" a partir da 3ª
        const comJg = !!jgDeles && (e.autor === jgDeles.nome || e.assistentes?.includes(jgDeles.nome));
        const avisada = ultimoPerigoT != null && tempo - ultimoPerigoT <= 12 && tempo - ultimoPerigoT >= 0;
        const porque = comJg && autorJ !== jgDeles ? ' Gank.' : avisada ? ' Tinha aviso.' : n >= 3 ? ' Respeita.' : '';
        if (n >= 2) dizer(`morte-${e.id}`, 'kills', F`${quem} te matou ${n} vezes.${porque}`, F`${quem} de novo. ${n} vezes.${porque}`, 3);
      } else if (souAutor) {
        mem.meusKills++;
        const k = mem.meusKills;
        if (k >= 5 && k % 5 === 0) dizer(`kill-${e.id}`, 'kills', F`${k} kills. Não morre de graça.`, F`${k} kills. Segura o ego.`, 1);
      } else if (autorJ && autorJ.time !== eu.time && autorJ.role === 'jungle' && vitimaJ?.role === 'jungle') {
        dizer(`jg-${e.id}`, 'jungler', F`${autorJ.campeao} matou nosso jungler.`, F`${autorJ.campeao} matou nosso jungler.`, 2);
      } else if (autorJ && autorJ.time !== eu.time && autorJ.role === 'jungle' && vitimaJ?.role) {
        dizer(`jg-${e.id}`, 'jungler', F`${autorJ.campeao} matou no ${LANE_DE_ROLE[vitimaJ.role] ?? vitimaJ.role}. Lado oposto livre.`, F`${autorJ.campeao} no ${LANE_DE_ROLE[vitimaJ.role] ?? vitimaJ.role}. Outro lado livre.`, 2);
      } else if (jgDeles && e.assistentes?.includes(jgDeles.nome) && vitimaJ && vitimaJ.time === eu.time && vitimaJ.role !== 'jungle') {
        dizer(`jg-${e.id}`, 'jungler', F`${jgDeles.campeao} gankou o ${LANE_DE_ROLE[vitimaJ.role] ?? vitimaJ.role}.`, F`${jgDeles.campeao} gankou o ${LANE_DE_ROLE[vitimaJ.role] ?? vitimaJ.role}.`, 1);
      } else if (vitimaJ && vitimaJ.time !== eu.time && vitimaJ.role === 'jungle') {
        // menos de 15 s de morte não abre janela nenhuma; e o 'jgbase' (por minuto) cala 40 s pra não repetir a mesma coisa
        mem.jgMorreuT = tempo;
        if ((vitimaJ.renasceEm || 30) >= 15) dizer(`jgmorreu-${e.id}`, 'jungler', F`Jungler deles morreu. ${Math.round(vitimaJ.renasceEm || 30)} segundos livres.`, F`Jungler deles morreu. ${Math.round(vitimaJ.renasceEm || 30)} segundos livres.`, 2);
      }
    }
    if (e.tipo === 'Ace') {
      // No Ace a API manda o TIME (ORDER/CHAOS), não um jogador.
      const aceNosso = e.autor === 'ORDER' ? eu.time === 100 : e.autor === 'CHAOS' ? eu.time === 200 : ehAliado(e.autor);
      dizer(`ace-${e.id}`, 'kills', aceNosso ? F('Ace. Barão ou torre agora.') : F('Levamos ace. Defende a base.'), aceNosso ? F('Ace. Vai pro Barão.') : F('Levamos ace. Segura a base.'), 3);
    }

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
      const ti = torreInfo(e.torre);
      const nossa = ti ? ti.time === eu.time : !ehAliado(e.autor);
      const lane = ti?.lane ?? '';
      const inib = ti?.camada === 'inib';
      if (ti?.camada === 'nexus') continue;
      // primeira torre da SUA lane: o que muda no jogo (lane aberta) e o que fazer
      const minhaLaneTorre = lane && ti?.camada === 'externa' && LANE_DE_ROLE[minhaRole] === lane && !mem.torreMinhaLaneDita;
      if (minhaLaneTorre) mem.torreMinhaLaneDita = true;   // só a primeira (o nome antigo da torre não separa externa de interna)
      if (!lane) dizer(`tk-${e.id}`, 'timers', nossa ? F('Torre nossa caiu.') : F('Torre deles caiu.'), nossa ? F('Torre nossa caiu.') : F('Torre deles caiu.'), nossa ? 1 : 2);
      else if (minhaLaneTorre && !nossa) dizer(`tk-${e.id}`, 'timers', F`Torre deles no ${lane} caiu. Lane aberta: roam ou ward, não fica sozinho nela.`, F`Torre deles no ${lane} caiu. Agora é roam ou ward, sozinho ali você morre.`, 2);
      else if (minhaLaneTorre && nossa) dizer(`tk-${e.id}`, 'timers', F`Torre nossa do ${lane} caiu. Sem torre, joga atrás da wave e warda o rio.`, F`Torre nossa do ${lane} caiu. Sem torre, sem herói: atrás da wave e ward.`, 2);
      else if (nossa) dizer(`tk-${e.id}`, 'timers', inib ? F`Torre do inibidor do ${lane} caiu.` : F`Torre nossa do ${lane} caiu.`, inib ? F`Torre do inibidor do ${lane} caiu.` : F`Torre nossa do ${lane} caiu.`, inib ? 3 : 1);
      else dizer(`tk-${e.id}`, 'timers', inib ? F`Torre do inibidor deles no ${lane} caiu.` : F`Torre deles no ${lane} caiu.`, inib ? F`Torre do inibidor deles no ${lane} caiu.` : F`Torre deles no ${lane} caiu.`, 2);
    }
    if (e.tipo === 'InhibKilled') dizer(`ik-${e.id}`, 'timers', ehAliado(e.autor) ? F('Inibidor deles caiu.') : F('Inibidor nosso caiu.'), ehAliado(e.autor) ? F('Inibidor deles caiu.') : F('Inibidor nosso caiu.'), 2);
    if (e.tipo === 'InhibKilled') (mem.inibs ??= []).push({ deles: ehAliado(e.autor), t: e.t, avisado: false, voltou: false });   // volta em 5 min
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
          dizer(`item-${it.id}`, 'economia', F`${nomeItem(it.id, it.nome)} fechado.${prox ? ` Próximo: ${nomeItem(prox.id, prox.nome)}.` : ''}`, F`${nomeItem(it.id, it.nome)} fechado.${prox ? ` Próximo: ${nomeItem(prox.id, prox.nome)}.` : ''}`, 1);
        }
      }
      const prox = b.ordem.find((x) => !tenho.has(x.id));
      if (prox?.preco && eu.ouro >= prox.preco && !eu.morto) {
        jaFalouDoGold = true;
        // olho ligado e ninguém deles perto = a hora de resetar é agora; com alguém perto, só o gold
        const livre = extras.livrePerto === true, waveOk = extras.minhaWave === 'deles';
        if (livre) dizer(`gold-item-${prox.id}`, 'economia', F`Tem gold pro ${nomeItem(prox.id, prox.nome)} e ninguém deles perto${waveOk ? ', wave empurrada' : ''}. Reseta.`, F`Gold pro ${nomeItem(prox.id, prox.nome)} e ninguém perto: reseta.`, 2);
        else dizer(`gold-item-${prox.id}`, 'economia', F`Tem gold pro ${nomeItem(prox.id, prox.nome)}.`, F`Tem gold pro ${nomeItem(prox.id, prox.nome)}.`, 2);
      }
    }
  }

  /* ---- você × seu oponente direto, a cada 3 minutos depois dos 6 ---- */
  const rival = inimigos.find((j) => j.role && j.role === minhaRole && minhaRole !== 'sup');
  if (rival && tempo >= 360 && tempo % 180 < 8) {
    const k = Math.floor(tempo / 180);
    const vant = (eu.nivel - rival.nivel) + (eu.cs - rival.cs) / 25 + (eu.kills - rival.kills) * 0.7 - (eu.mortes - rival.mortes) * 0.5;
    const patamar = vant >= 4 ? 2 : vant >= 2 ? 1 : vant <= -4 ? -2 : vant <= -2 ? -1 : 0;
    if (patamar !== (mem.rivalPatamar ?? 0)) {
      mem.rivalPatamar = patamar;
      if (patamar > 0) dizer(`rival-${k}`, 'lane', F`Você está na frente do ${rival.campeao}.`, F`Você está na frente do ${rival.campeao}.`, 1);
      else if (patamar < 0) dizer(`rival-${k}`, 'lane', F`${rival.campeao} está na frente. Não força trade.`, F`${rival.campeao} está na frente. Não força trade.`, 1);
    }
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
  const minhasT = torres.filter((e) => { const ti = torreInfo(e.torre); return ti ? ti.time !== eu.time : ehAliado(e.autor); }).length;
  const delasT = torres.length - minhasT;
  if (minhasT - delasT >= 3 && (minhasT - delasT) % 2 === 1) dizer(`torres-${minhasT - delasT}`, 'timers', F`${minhasT - delasT} torres na frente.`, F`${minhasT - delasT} torres na frente.`, 1);
  else if (delasT - minhasT >= 3 && (delasT - minhasT) % 2 === 1) dizer(`torres--${delasT - minhasT}`, 'timers', F`${delasT - minhasT} torres atrás.`, F`${delasT - minhasT} torres atrás.`, 1);

  /* ---- jungler deles morto: janela ---- */
  if (jgDeles?.morto && jgDeles.renasceEm > 20 && tempo - (mem.jgMorreuT ?? -999) > 40) dizer(`jgbase-${Math.floor(tempo / 60)}`, 'jungler', F`${jgDeles.campeao} morto por ${Math.round(jgDeles.renasceEm)} segundos.`, F`${jgDeles.campeao} morto por ${Math.round(jgDeles.renasceEm)} segundos.`, 1);

  /* ---- spikes deles que mudam a jogada ---- */
  mem.spikes ??= new Set();
  // (jgDeles já vem de cima)
  if (jgDeles && jgDeles.nivel >= 6 && !mem.spikes.has('jg6')) { mem.spikes.add('jg6'); if (tempo < 900) dizer('jg-deles-6', 'spikes', F`Jungler deles level 6${jgDeles.nivel > (eu.nivel ?? 0) ? ', na sua frente' : ''}. Gank com ult.`, F`Jungler deles de ult. Cuidado no gank.`, 2); }
  if (rival && rival.nivel >= 6 && (eu.nivel ?? 0) < 6 && !mem.spikes.has('rival6')) { mem.spikes.add('rival6'); dizer('rival-6-antes', 'spikes', F`${rival.campeao} de ult e você não. Não troca.`, F`${rival.campeao} tem ult e você não. Segura.`, 2); }
  // itens que viram a lane: quem fechou primeiro
  const ITENS_CHAVE = { 3153: 'BORK', 6692: 'Eclipse', 3071: 'Cleaver', 6333: 'Death Dance', 3078: 'Trindade', 6631: 'Sundered Sky', 3074: 'Hidra', 6698: 'Profane', 3161: 'Shojin', 3031: 'IE', 6672: 'Kraken', 6675: 'Navori', 3072: 'Sede de Sangue', 6676: 'Coletor', 3124: 'Rageblade', 3115: 'Nashor', 3089: 'Deathcap', 4645: 'Shadowflame', 6655: 'Luden', 3157: 'Ampulheta', 6653: 'Liandry', 3142: 'Youmuu', 3068: 'Sunfire', 3065: 'Espírito', 3110: 'Coração Gelado', 3143: 'Randuin' };
  for (const j of inimigos) for (const it of j.itens ?? []) {
    const nome = ITENS_CHAVE[it.id]; if (!nome) continue;
    const k = `${j.nome}-${it.id}`; if (mem.spikes.has(k)) continue; mem.spikes.add(k);
    const euTenhoGrande = (eu.itens ?? []).some((x) => ITENS_CHAVE[x.id]);
    if (tempo > 60 && (j.role === minhaRole || j.role === 'jungle') && !euTenhoGrande) dizer(`spike-${k}`, 'spikes', F`${j.campeao} fechou ${nome} antes de você. Respeita.`, F`${j.campeao} com ${nome} e você sem item. Respeita.`, 2);
  }
  /* ---- spikes vindos do rastreio ---- */
  for (const a of rastreio?.avisos ?? []) {
    if (a.t < mem.ultimoTempo - 1) continue;
    if (String(a.chave).startsWith('item-')) dizer(`fala-${a.chave}`, 'spikes', F`${a.titulo}.`, F`${a.titulo}.`, a.urgencia);
    else if (String(a.chave).startsWith('nv-') && /nível 6/.test(a.titulo)) dizer(`fala-${a.chave}`, 'spikes', F`${a.titulo}.`, F`${a.titulo}.`, 2);
    else if (String(a.chave).startsWith('nv-') && /níveis na frente/.test(a.titulo)) dizer(`fala-${a.chave}`, 'spikes', F`${a.titulo}.`, F`${a.titulo}.`, 2);
    else if (String(a.chave).startsWith('jg-')) dizer(`fala-${a.chave}`, 'jungler', a.titulo, a.titulo, 2);
  }

  /* ---- inimigo fedado ---- */
  const forte = inimigos.find((j) => j.kills >= 5 && j.kills >= j.mortes * 2 && (j.kills - 5) % 3 === 0);
  if (forte) dizer(`forte-${forte.nome}-${forte.kills}`, 'kills', F`${forte.campeao} está ${forte.kills} a ${forte.mortes}. Não vai sozinho nele.`, F`${forte.campeao} fedado: ${forte.kills} a ${forte.mortes}. Não vai sozinho.`, 2);

  /* ---- economia ---- */
  const vidaPct = eu.vidaMax ? eu.vida / eu.vidaMax : 1;
  if (!eu.morto && eu.ouro >= 1000 && vidaPct < 0.4 && !(mem.vidaBaixaAntes) && tempo - (mem.baseDito ?? -999) > 120) { mem.baseDito = tempo; dizer(`base-${Math.floor(tempo)}`, 'economia', F('Vida baixa e gold sobrando. Base.'), F('Vida baixa e gold sobrando. Base.'), 2); }
  const vidaBaixaAgora = !eu.morto && vidaPct < 0.4;
  if (!vidaBaixaAgora && !eu.morto && eu.ouro >= 2000 && !jaFalouDoGold) dizer(`gold-${Math.floor(tempo / 240)}`, 'economia', F`${eu.ouro} de gold parado.`, F`${eu.ouro} de gold parado.`, 1);
  mem.vidaBaixaAntes = vidaBaixaAgora;

  /* ---- ordem de magias (Blitz): ponto sobrando → "sobe W" (uma vez por nível, e só se está seguindo a ordem) ---- */
  const ordemMagias = extras?.build?.magias ?? null;
  if (ordemMagias?.length && eu.magias && eu.nivel >= 2) {
    const gastos = eu.magias.Q + eu.magias.W + eu.magias.E + eu.magias.R;
    if (gastos < eu.nivel && gastos < ordemMagias.length && mem.nivelMagiaDito !== eu.nivel) {
      // confere se o que ele já subiu bate com a ordem até aqui (senão ele tem a própria ordem: não atrapalha)
      const cont = { Q: 0, W: 0, E: 0, R: 0 }; for (let i = 0; i < gastos; i++) cont[ordemMagias[i]]++;
      const segue = ['Q', 'W', 'E', 'R'].every((k) => cont[k] === eu.magias[k]);
      mem.nivelMagiaDito = eu.nivel;
      if (segue && tempo - (mem.ultimoNivelEm ?? -99) > 2) dizer(`magia-${eu.nivel}`, 'economia', F`Sobe ${ordemMagias[gastos]}.`, F`${ordemMagias[gastos]}.`, 1);
    }
  }
  /* ---- valor dos itens (Blitz "item value"): aos 12 e 20, contra o seu oponente de rota ---- */
  const valorDe = (j) => (j.itens ?? []).reduce((s, i) => s + (i.preco ?? 0), 0);
  for (const marco of [720, 1200]) {
    if (tempo >= marco && tempo < marco + 8) {
      const rival = inimigos.find((j) => j.role === minhaRole && minhaRole !== 'jungle') ?? jgDeles;
      if (rival) {
        const dif = valorDe(rival) - valorDe(eu);
        if (Math.abs(dif) >= 1500) dizer(`itens-${marco}`, 'economia', dif > 0 ? F`${rival.campeao} tem ${Math.round(dif / 100) * 100} de gold em item a mais que você. Não troca de igual pra igual.` : F`Você tem ${Math.round(-dif / 100) * 100} de gold em item a mais que ${rival.campeao}. A troca é sua.`, dif > 0 ? F`${rival.campeao} ${Math.round(dif / 100) * 100} na frente em item.` : F`${Math.round(-dif / 100) * 100} na frente do ${rival.campeao} em item.`, 1);
      }
      if (marco === 1200) {
        const nossos = aliados.reduce((s, j) => s + valorDe(j), 0), deles = inimigos.reduce((s, j) => s + valorDe(j), 0);
        if (Math.abs(nossos - deles) >= 4000) dizer('itens-time', 'economia', nossos > deles ? F`Time ${Math.round((nossos - deles) / 1000)} mil de gold na frente em itens. Força objetivo, não fica esperando.` : F`Time ${Math.round((deles - nossos) / 1000)} mil de gold atrás em itens. Sem briga de 5: ${daRota(minhaRole).semBriga}.`, nossos > deles ? F`${Math.round((nossos - deles) / 1000)} mil na frente. Força.` : F`${Math.round((deles - nossos) / 1000)} mil atrás. Não briga.`, 2);
      }
    }
  }
  /* ---- leitura do jogo: a partida está ganha, parelha ou perdida — e o que fazer NESTA rota e NESTA fase ----
     O placar sozinho engana (3 kills atrás com 2 torres na frente é vantagem). A conta junta
     gold em item, torres e abates, e o conselho muda com o minuto: o que serve aos 10 não serve aos 30. */
  for (const marco of [600, 1080, 1560, 2040]) {
    if (tempo >= marco && tempo < marco + 8) {
      const nossosI = aliados.reduce((s, j) => s + valorDe(j), 0);
      const delesI = inimigos.reduce((s, j) => s + valorDe(j), 0);
      const nossosK = aliados.reduce((s, j) => s + (j.kills ?? 0), 0);
      const delesK = inimigos.reduce((s, j) => s + (j.kills ?? 0), 0);
      const peso = (nossosI - delesI) / 1000 + (minhasT - delasT) * 0.9 + (nossosK - delesK) * 0.25;
      const rt = daRota(minhaRole);
      const fase = tempo < 840 ? 0 : tempo < 1500 ? 1 : 2;
      let serio, curto;
      if (peso >= 2.5) {
        serio = [F`Você está na frente. Mantém ${rt.recurso} e não arrisca à toa: quem está na frente não precisa de briga.`,
          F`Na frente. Troca a vantagem por objetivo: dragão e torre, não caçada.`,
          F`Na frente. Não dá abertura: briga só com visão e com o time junto.`][fase];
        curto = F`Na frente. Não arrisca.`;
      } else if (peso <= -2.5) {
        serio = [F`Está atrás. Segura o jogo: ${rt.atrasado}`,
          F`Está atrás. Não contesta objetivo de graça: pega o lado oposto e devolve em torre.`,
          F`Está atrás. Espera o erro deles: com inimigo morto, aí sim vai pro objetivo.`][fase];
        curto = F`Atrás. Espera a brecha.`;
      } else {
        serio = [F`Tá parelho. Não força luta sem visão: ${rt.semBriga}.`,
          F`Tá parelho. Quem pegar o próximo objetivo abre o jogo: prepara visão antes.`,
          F`Tá parelho. Um erro decide: não anda sozinho e não pega wave sem visão.`][fase];
        curto = F`Parelho. Sem vacilo.`;
      }
      dizer(`leitura-${marco}`, 'economia', serio, curto, 1);
    }
  }

  /* ---- inibidor: volta em 5 min (aviso a 1 min e na volta) ---- */
  for (const ib of mem.inibs ?? []) {
    if (!ib.avisado && tempo >= ib.t + 240) { ib.avisado = true; dizer(`ib60-${ib.t}`, 'timers', ib.deles ? F('Inibidor deles volta em um minuto. Última onda de super minions.') : F('Inibidor nosso volta em um minuto. Segura mais um pouco.'), ib.deles ? F('Inibidor deles volta em um minuto.') : F('Inibidor nosso volta em um minuto.'), 1); }
    if (!ib.voltou && tempo >= ib.t + 300) { ib.voltou = true; dizer(`ibv-${ib.t}`, 'timers', ib.deles ? F('Inibidor deles voltou.') : F('Inibidor nosso voltou.'), ib.deles ? F('Inibidor deles voltou.') : F('Inibidor nosso voltou.'), 1); }
  }
  /* ---- estado do jogo ---- */
  const nossosKills = aliados.reduce((s, j) => s + j.kills, 0), delesKills = inimigos.reduce((s, j) => s + j.kills, 0);
  if (tempo >= 900 && tempo < 908 && nossosKills !== delesKills) dizer('jogo-15', 'lane', F`Quinze minutos: ${nossosKills} a ${delesKills} em kills.`, F`Quinze minutos: ${nossosKills} a ${delesKills}.`, 1);
  const mortosDeles = inimigos.filter((j) => j.morto).length;
  // 3+ deles mortos: fala o alvo (objetivo vivo > torre), só se a troca foi boa (nós com 2+ vivos a mais)
  // e se você pode ir (vivo ou voltando em até 12 s). Morto de vez, não tem o que fazer com a informação.
  const nossosMortos = aliados.filter((j) => j.morto).length;
  if (mortosDeles >= 3 && !(mem.nMortosAntes >= 3) && mortosDeles - nossosMortos >= 2 && (!eu.morto || (eu.renasceEm ?? 99) <= 12)) {
    const alvo = (objetivos ?? []).find((o) => o.vivo && ['Barão', 'Ancião', 'Dragão', 'Arauto', 'Vastilarvas'].includes(o.nome))?.nome ?? 'Torre';
    const ida = eu.morto ? 'Volta e vai. ' : '';
    dizer(`3mortos-${Math.floor(tempo)}`, 'timers', F`${mortosDeles} deles mortos. ${ida}${alvo} agora.`, F`${mortosDeles} deles mortos. ${ida}${alvo} agora.`, 3);
  }
  mem.nMortosAntes = mortosDeles;
  if (tempo >= 1800 && tempo < 1808 && nossosKills > delesKills + 5) dizer('fecha', 'lane', F`Trinta minutos, ${nossosKills - delesKills} kills na frente. Fecha o jogo.`, F`Trinta minutos, ${nossosKills - delesKills} kills na frente. Fecha.`, 2);

  void conselhos;   // os conselhos ficam na tela; a voz só fala fato.

  mem.ultimoTempo = tempo;
  return novas.sort((a, b) => b.prioridade - a.prioridade);
}

/**
 * Na seleção de campeão: com quem dos seus picks você ganha dos inimigos já
 * travados, pelos confrontos do op.gg. Devolve a lista ordenada e uma fala.
 */
export async function sugerirPick({ candidatos, rota, inimigosIds, confrontoContra, tabela, opcoes, parceiro = null, sinergia = null, historico = null }) {
  const resultado = [];
  for (const nome of candidatos) {
    const linhas = [];
    for (const id of inimigosIds) {
      const c = await confrontoContra(nome, rota, id, opcoes).catch(() => null);
      if (c) linhas.push({ id, campeao: tabela.porId.get(id) ?? String(id), taxa: c.taxa, jogos: c.jogos });
    }
    const media = linhas.length ? linhas.reduce((s, l) => s + l.taxa, 0) / linhas.length : null;
    const sin = sinergia?.find((x) => x.nome === nome) ?? null;
    const hist = historico?.[nome] ?? null;
    // nota final: confrontos (metade), duo (um terço), seu histórico com esse parceiro (o resto, encolhido)
    const histTaxa = hist && hist.jogos >= 2 ? (hist.vitorias + 1) / (hist.jogos + 2) : null;
    const partes = [[media, 0.5], [sin?.nota ?? null, 0.35], [histTaxa, 0.15]].filter(([v]) => v != null);
    const peso = partes.reduce((s, [, w]) => s + w, 0);
    const total = peso ? partes.reduce((s, [v, w]) => s + v * w, 0) / peso : null;
    resultado.push({ nome, media, contra: linhas, sinergia: sin?.nota ?? null, motivo: sin?.motivo ?? null, historico: hist, total });
  }
  resultado.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  const melhor = resultado.find((r) => r.total != null);
  const pior = melhor?.contra.slice().sort((a, b) => a.taxa - b.taxa)[0];
  let fala = null;
  if (melhor && parceiro && melhor.sinergia != null) {
    const parceiroRole = rota === 'utility' ? 'adc' : 'sup';
    fala = { serio: F`Com ${parceiro} no ${parceiroRole}, ${melhor.nome}${melhor.motivo ? ': ' + melhor.motivo : ''}${pior && pior.taxa < 0.47 ? '. Cuidado com ' + pior.campeao : ''}.`,
            divertido: F`${parceiro} no ${parceiroRole} pede ${melhor.nome}${melhor.motivo ? ': ' + melhor.motivo : ''}.` };
  } else if (melhor && melhor.media != null) {
    fala = { serio: F`Pelos confrontos, ${melhor.nome} é o melhor pick contra o que eles travaram${pior && pior.taxa < 0.47 ? `; cuidado com ${pior.campeao}` : ''}.`,
            divertido: F`${melhor.nome} come esse time deles${pior && pior.taxa < 0.47 ? `, menos o ${pior.campeao}, que é chato` : ''}.` };
  }
  return { lista: resultado, fala, mmss, parceiro };
}

/* Campeões com muito controle de grupo: com três ou mais no time deles, vale Purificar/Mercúrio. */
const MUITO_CC = new Set(['Morgana', 'Malzahar', 'Leona', 'Nautilus', 'Ashe', 'Lissandra', 'Sejuani', 'Amumu', 'Skarner', 'Warwick', 'Rammus', 'Thresh', 'Blitzcrank', 'Zoe', 'Neeko', 'Twisted Fate', 'Veigar', 'Annie', 'Fiddlesticks', 'Maokai', 'Zyra', 'Lux', 'Pyke', 'Rell', 'Alistar', 'Braum', 'Galio', 'Gragas', 'Jarvan IV', 'Kennen', 'Malphite', 'Nami', 'Ornn', 'Poppy', 'Sion', 'Swain', 'Taric', 'Vi', 'Zac', 'Xin Zhao', 'Bard', "Cho'Gath", 'Elise', 'Renata Glasc', 'Nunu & Willump', 'Zilean', 'Ahri', 'Yone', 'Sett', 'Volibear', 'Trundle', 'Urgot', 'Aatrox', 'Lulu', 'Milio']);

const ESTILO = { 8000: 'Precisão', 8100: 'Dominação', 8200: 'Feitiçaria', 8300: 'Inspiração', 8400: 'Determinação' };

/**
 * Falas da seleção de campeão: uma por acontecimento (enemy travou, seu ban
 * sugerido, muito CC no time deles, runas aplicadas). `mem.ditas` zera a
 * cada seleção nova.
 */
export function falasDaSelecao({ rota, inimigos, aliados, meuCampeao, sugestaoBan, runas, confrontos = [], junglerDeles = null, dano = null }, mem) {
  const novas = [];
  const dizer = (id, serio, divertido, prioridade = 1) => {
    if (mem.ditas.has(id)) return;
    mem.ditas.add(id);
    novas.push({ id, modulo: 'selecao', serio, divertido: divertido ?? serio, prioridade });
  };
  const rotaFala = ROLE_FALA[{ top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'sup' }[rota] ?? rota] ?? rota;
  if (sugestaoBan?.length) {
    const [a, b] = sugestaoBan;
    const pq = (x) => x.motivo?.startsWith('counter') ? ` (${Math.round(x.taxa * 100)}% contra ${x.motivo.replace('counter do ', '').replace(' no op.gg', '')})` : '';
    dizer('ban', F`Ban sugerido: ${a.campeao}${pq(a)}.${b ? ` Ou ${b.campeao}${pq(b)}.` : ''}`, F`Ban sugerido: ${a.campeao}.${b ? ` Ou ${b.campeao}.` : ''}`, 2);
  }
  // Jungler deles: quem é e o que fazer contra (só se for campeão de jungle).
  if (junglerDeles) dizer(`jg-${junglerDeles.nome}`, F`Jungler deles: ${junglerDeles.nome}, ${junglerDeles.dica}.`, F`Jungler deles é ${junglerDeles.nome}: ${junglerDeles.dica}.`, 2);
  // Confronto do SEU campeão com cada um deles (op.gg): só o que sai do 50/50.
  for (const c of confrontos) {
    if (c.jogos < 30) continue;
    const pct = Math.round(c.taxa * 100);
    if (pct <= 46) dizer(`vs-${meuCampeao}-${c.id}`, F`${c.campeao}: você ganha só ${pct}% com ${meuCampeao}.`, F`${c.campeao} te come: ${pct}% de ${meuCampeao}.`, 2);
    else if (pct >= 54) dizer(`vs-${meuCampeao}-${c.id}`, F`${c.campeao}: ${pct}% pra você com ${meuCampeao}.`, F`${c.campeao} é comida: ${pct}% pra você.`, 1);
  }
  // Time deles: AD ou AP (com 4+ travados).
  if (dano && dano.ad + dano.ap >= 4) {
    if (dano.ad >= 4) dizer('dano', F`Time deles: ${dano.ad} AD. Armadura.`, F`Time deles: ${dano.ad} AD. Armadura.`, 1);
    else if (dano.ap >= 3) dizer('dano', F`Time deles: ${dano.ap} AP. Resistência mágica.`, F`Time deles: ${dano.ap} AP. Resistência mágica.`, 1);
  }
  const cc = inimigos.filter((i) => MUITO_CC.has(i.nome)).length;
  if (cc >= 3 && ['bottom', 'middle'].includes(rota)) dizer('cc', F`${cc} campeões de CC no time deles. Purificar ou Mercúrio.`, F`${cc} de CC no time deles. Purificar ou Mercúrio.`, 2);
  if (meuCampeao && runas) dizer(`runas-${meuCampeao}`, F`Runas: ${runas.chave ?? ''}${runas.primaria ? ', ' + runas.primaria : ''}${runas.secundaria ? ' com ' + runas.secundaria : ''}.`, F`Runas: ${runas.chave ?? ''}.`, 1);
  return novas.sort((a, b) => b.prioridade - a.prioridade);
}
export { ESTILO };
