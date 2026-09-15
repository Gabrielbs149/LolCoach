/**
 * O que a voz fala durante a partida. Cada fala tem um módulo (pra ligar e
 * desligar na tela), um id (fala uma vez só) e dois textos: sério e
 * divertido. Tudo sai do relógio, do placar e do feed de eventos da API que o
 * próprio jogo abre — nada de posição, nada de tela.
 *
 * O estilo segue o que um coach de voz de verdade faz na partida: curto,
 * no momento, e com a ação que você deve tomar agora.
 */

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
  if (tempo > 5 && tempo < 40) dizer('inicio', 'lane', `Bem-vindo ao Summoner's Rift. Você está de ${ROLE_FALA[minhaRole] ?? minhaRole}. Farma pra fechar item rápido.`, `Bem-vindo ao Rift. Farma, não morre de graça, e a gente conversa.`, 1);
  if (minhaRole !== 'jungle' && tempo >= 190 && tempo < 200 && jgDeles) dizer('jg-primeiro', 'jungler', `${jgDeles.campeao} pode aparecer a qualquer momento. Ward no rio.`, `Três minutos: ${jgDeles.campeao} tá terminando o clear. Ward no rio antes que ele te ache.`, 2);
  if (minhaRole === 'jungle' && tempo >= 190 && tempo < 200) dizer('jg-meu', 'jungler', 'Primeiro clear feito? Olha qual lane tem o inimigo empurrado e vai gankar.', 'Terminou o clear? Vai ser útil, gankar lane empurrada é kill de graça.', 1);

  /* ---- timers ---- */
  for (const o of objetivos ?? []) {
    const chave = `${o.nome}-${Math.round((tempo + o.em) / 60)}`;
    if (o.em > 55 && o.em <= 62) {
      if (o.nome === 'Dragão') dizer(`t60-${chave}`, 'timers', `Dragão em um minuto. ${minhaRole === 'top' ? 'Puxa a wave e prepara o TP.' : 'Empurra a wave, limpa e vem controlar o rio.'}`, `Dragão em um minuto. Larga esse minion e vai pro rio, campeão.`, 2);
      else if (o.nome === 'Barão') dizer(`t60-${chave}`, 'timers', 'Barão em um minuto. Visão no pit e agrupa.', 'Barão em um minuto. Junta o time, quem chegar depois nem vai.', 2);
      else if (o.nome === 'Ancião') dizer(`t60-${chave}`, 'timers', 'Um minuto pro Ancião. Esse dragão é game over: time inteiro no pit.', 'Ancião em um minuto. Quem pegar ganha, simples assim.', 3);
      else if (o.nome === 'Vastilarvas') dizer(`t60-${chave}`, 'timers', minhaRole === 'jungle' ? 'Vastilarvas em um minuto. Vai pro pit e disputa esse campo.' : 'Vastilarvas em um minuto. Top e jungle: prio nesse campo.', 'Vastilarvas daqui a um minuto. Campo limpo é torre caindo.', 1);
      else dizer(`t60-${chave}`, 'timers', `${o.nome} em um minuto. Prepara visão.`, `${o.nome} daqui a um minuto.`, 2);
    } else if (o.em > 25 && o.em <= 32) {
      dizer(`t30-${chave}`, 'timers', `Trinta segundos pro ${o.nome}. Time no pit agora.`, `Trinta segundos pro ${o.nome}. Se chegar depois, nem vai.`, 3);
    } else if (o.vivo && o.em > -6) {
      dizer(`nasceu-${chave}`, 'timers', `${o.nome} está no mapa.`, `${o.nome} nasceu. Quem tem prio pega, quem não tem chora.`, 2);
    }
  }
  if (tempo >= 13 * 60 && tempo < 13 * 60 + 8) dizer('placas', 'timers', 'Placas de torre caem em um minuto. Bate na torre e pega o que der de gold.', 'Um minuto pras placas sumirem. Bate na torre que é dinheiro grátis.', 2);
  if (tempo >= 14 * 60 && tempo < 14 * 60 + 8) dizer('placas-fim', 'timers', 'Bônus de placas acabou. Torre agora só cai com pressão de time.', 'Acabou o dinheiro fácil das placas.', 1);

  /* ---- farm a cada 5 minutos (não pro jungle/suporte) ---- */
  const marco = Math.floor(tempo / 300);
  if (marco >= 1 && marco <= 5 && !mem.farmDito.has(marco) && tempo % 300 < 8 && minhaRole === 'jungle') {
    mem.farmDito.add(marco);
    const csm = eu.cs / (tempo / 60);
    dizer(`farmjg-${marco}`, 'lane', `${marco * 5} minutos, ${csm.toFixed(1)} de farm por minuto. Farma os camps entre os ganks e não deixa ouro no mato.`, `${marco * 5} minutos. Camps parados são gold jogado fora, vai limpar.`, 1);
  }
  if (marco >= 1 && marco <= 5 && !mem.farmDito.has(marco) && tempo % 300 < 8 && ['top', 'mid', 'adc'].includes(minhaRole)) {
    mem.farmDito.add(marco);
    const csm = eu.cs / (tempo / 60);
    const min = marco * 5;
    if (csm >= 7.5) dizer(`farm-${marco}`, 'lane', `${min} minutos. Farm de pro, ${csm.toFixed(1)} por minuto. Continua assim.`, `${min} minutos e ${csm.toFixed(1)} de farm por minuto. Tá jogando que nem smurf.`, 1);
    else if (csm >= 6) dizer(`farm-${marco}`, 'lane', `${min} minutos. Bom farm. Segura esse ritmo.`, `${min} minutos, farm bom. Não vacila agora.`, 1);
    else if (csm >= 4.5) dizer(`farm-${marco}`, 'lane', `${min} minutos. Farm tá ok, mas tenta não perder CS na torre.`, `${min} minutos. Farm mais ou menos. Os minions da torre também contam, hein.`, 1);
    else dizer(`farm-${marco}`, 'lane', `${min} minutos e ${Math.round(eu.cs)} de farm. Foca em pegar os minions antes de procurar briga.`, `${min} minutos e só ${Math.round(eu.cs)} de farm. Os minions estão te esperando, vai lá.`, 2);
  }

  /* ---- eventos ---- */
  for (const e of eventos) {
    if (!novo(e)) continue;
    const autorJ = porNome(e.autor), vitimaJ = porNome(e.vitima);

    if (e.tipo === 'ChampionKill') {
      const souAutor = e.autor === eu.nome, souVitima = e.vitima === eu.nome;
      if (souVitima) {
        const quem = autorJ?.campeao ?? 'eles';
        const n = (mem.mortesPor.get(e.autor) ?? 0) + 1; mem.mortesPor.set(e.autor, n);
        if (n >= 2) dizer(`morte-${e.id}`, 'kills', `${quem} te matou ${n} vezes. Evita ele e muda a abordagem.`, `${quem} de novo? Já é a ${n}ª. Para de dar presente pra ele.`, 3);
        else if (minhaRole === 'adc' && (e.assistentes?.length ?? 0) >= 2) dizer(`morte-${e.id}`, 'kills', 'Morreu no meio de todo mundo. Como ADC você não entra primeiro: espera o time iniciar e dá dano de longe.', 'ADC entrando primeiro é doação. Espera o tank ir e bate de longe.', 2);
        else dizer(`morte-${e.id}`, 'kills', `Você morreu pro ${quem}. Antes de voltar, pensa no que deu a abertura.`, `Morreu pro ${quem}. Respira. O time ainda te ama, eu acho.`, 2);
      } else if (souAutor) {
        mem.meusKills++;
        const k = mem.meusKills;
        if (k === 1) dizer(`kill-${e.id}`, 'kills', 'Kill confirmada. Começou bem. Empurra a wave ou pega placa antes de voltar.', 'Primeira kill! Bora. Agora não vai morrer comemorando.', 2);
        else if (k === 3) dizer(`kill-${e.id}`, 'kills', 'Três kills. Tá jogando demais. Usa a vantagem: item e objetivo.', 'Três kills, craque. Isso aqui não é ferro não.', 2);
        else if (k >= 5) dizer(`kill-${e.id}`, 'kills', `${k} kills. Você é a condição de vitória — não morre de graça agora.`, `${k} kills. Tá jogando que nem smurf. Só não vai se achar e morrer sozinho.`, 2);
        else dizer(`kill-${e.id}`, 'kills', `Kill confirmada no ${vitimaJ?.campeao ?? 'inimigo'}. Mais uma pro bolso.`, `Abateu o ${vitimaJ?.campeao ?? 'cara'}. Mais uma pro bolso.`, 1);
      } else if (autorJ && autorJ.time !== eu.time && autorJ.role === 'jungle' && vitimaJ?.role) {
        dizer(`jg-${e.id}`, 'jungler', `${autorJ.campeao} apareceu no ${vitimaJ.role}. O lado oposto está livre por uns quarenta segundos.`, `${autorJ.campeao} tá no ${vitimaJ.role}. Quem está do outro lado: hora de abusar.`, 2);
      } else if (jgDeles && e.assistentes?.includes(jgDeles.nome) && vitimaJ && vitimaJ.time === eu.time) {
        dizer(`jg-${e.id}`, 'jungler', `${jgDeles.campeao} gankou o ${vitimaJ.role}. Marca o horário: ele demora pra voltar nesse lado.`, `${jgDeles.campeao} passou no ${vitimaJ.role}. Anota aí.`, 1);
      } else if (vitimaJ && vitimaJ.time !== eu.time && vitimaJ.role === 'jungle') {
        dizer(`jgmorreu-${e.id}`, 'jungler', `Jungler deles morreu. Invade ou pega objetivo, o mapa é seu por ${Math.round(vitimaJ.renasceEm || 30)} segundos.`, `${vitimaJ.campeao} morreu. Vai pra cima que ele não vai aparecer.`, 2);
      } else if (vitimaJ && vitimaJ.time !== eu.time) {
        dizer(`ini-${e.id}`, 'kills', 'Um inimigo foi eliminado.', `Menos um. ${vitimaJ.campeao} foi visitar a base.`, 0);
      }
    }
    if (e.tipo === 'FirstBlood') dizer(`fb-${e.id}`, 'kills', ehAliado(e.autor) ? 'Primeiro sangue é nosso. Começou bem.' : 'Primeiro sangue deles. Joga seguro até equilibrar.', ehAliado(e.autor) ? 'First blood pra gente. Começou bem!' : 'First blood pra eles. Calma, ainda é cedo.', 1);
    if (e.tipo === 'Multikill' && e.autor === eu.nome) dizer(`multi-${e.id}`, 'kills', 'Multikill. Aproveita: objetivo ou torre agora.', 'MULTIKILL! Pega um objetivo antes que o ego suba.', 2);
    if (e.tipo === 'Ace') dizer(`ace-${e.id}`, 'kills', ehAliado(e.autor) ? 'Ace. Todo mundo deles morto: Barão ou torres, agora.' : 'Levamos ace. Defende a base e ninguém sai sozinho.', ehAliado(e.autor) ? 'ACE! Vai pro Barão, vai pro Barão!' : 'Levamos ace. Segura a base e reza.', 3);

    if (e.tipo === 'DragonKill') {
      const nosso = ehAliado(e.autor);
      const [nome, buff] = DRAGAO[e.dragao] ?? ['Dragão', ''];
      const meus = eventos.filter((x) => x.tipo === 'DragonKill' && x.t <= e.t && ehAliado(x.autor)).length;
      const deles = eventos.filter((x) => x.tipo === 'DragonKill' && x.t <= e.t && !ehAliado(x.autor)).length;
      if (nosso) dizer(`dg-${e.id}`, 'timers', `${nome} nosso${e.roubado ? ', roubado' : ''}. ${buff}${meus === 3 ? ' Próximo dragão é a alma: foca acima de tudo.' : ''}`, `${nome} no bolso${e.roubado ? ' — roubado, que lindo' : ''}. ${buff}${meus === 3 ? ' O próximo é a alma. Só vai.' : ''}`, 2);
      else dizer(`dg-${e.id}`, 'timers', `Eles pegaram o ${nome}.${deles === 3 ? ' O próximo fecha a alma pra eles: não deixa de jeito nenhum.' : ' Da próxima, visão no pit um minuto antes.'}`, `Perdemos o ${nome}.${deles === 3 ? ' Se eles pegarem mais um é alma. Acorda.' : ' Da próxima a gente chega antes.'}`, deles === 3 ? 3 : 1);
    }
    if (e.tipo === 'BaronKill') dizer(`bk-${e.id}`, 'timers', ehAliado(e.autor) ? 'Barão nosso. Agrupa, empurra as três lanes e não desperdiça o buff.' : 'Eles pegaram Barão. Não briga na frente da torre: só defende e limpa wave.', ehAliado(e.autor) ? 'BARÃO! Bora empurrar tudo. Quem voltar pra base agora é traidor.' : 'Barão deles. Hora de jogar defensivo e rezar.', 3);
    if (e.tipo === 'HeraldKill') dizer(`hk-${e.id}`, 'timers', ehAliado(e.autor) ? 'Arauto nosso. Solta numa torre com placas ainda.' : 'Eles pegaram o Arauto. Cuidado com a torre que ele vai bater.', ehAliado(e.autor) ? 'Arauto no bolso. Joga na torre e vê o dinheiro cair.' : 'Arauto deles. Vai chover Arauto em alguma torre nossa.', 2);
    if (e.tipo === 'HordeKill') {
      const n = eventos.filter((x) => x.tipo === 'HordeKill' && x.t <= e.t && ehAliado(x.autor)).length;
      if (n === 6) dizer(`horde-${e.id}`, 'timers', 'Campo de vastilarvas limpo. Bônus de torre máximo.', 'Seis vastilarvas. As torres vão derreter.', 1);
      else if (n === 3) dizer(`horde-${e.id}`, 'timers', 'Três vastilarvas. Bônus de torre aumentando.', 'Metade das vastilarvas. Continua.', 0);
    }
    if (e.tipo === 'TurretKilled' && e.torre) {
      const m = String(e.torre).match(/Turret_T(\d)_([LRC])_(\d\d)/);
      const nossa = m && Number(m[1]) === (eu.time === 100 ? 1 : 2);
      const lane = m ? ({ L: 'top', C: 'mid', R: 'bot' })[m[2]] : '';
      const inib = m && m[3] === '01';
      if (nossa) dizer(`tk-${e.id}`, 'timers', inib ? `Perdemos a torre do inibidor do ${lane}. Defende o inibidor com o time.` : `Perdemos torre no ${lane}. Cuidado com a rotação deles.`, inib ? `Torre do inibidor caiu no ${lane}. Agora é sério.` : `Torre nossa caiu no ${lane}. Vamo acordar.`, inib ? 3 : 1);
      else dizer(`tk-${e.id}`, 'timers', inib ? `Torre do inibidor deles no ${lane} caiu. Hora de finalizar o inibidor.` : `Torre deles no ${lane} caiu. Rotaciona e pega outro objetivo.`, inib ? `Torre do inibidor deles caiu. Vai lá terminar o serviço.` : `Torre deles caiu no ${lane}. O mapa tá abrindo.`, 2);
    }
    if (e.tipo === 'InhibKilled') dizer(`ik-${e.id}`, 'timers', ehAliado(e.autor) ? 'Inibidor deles caiu. Super minions empurram sozinhos: usa isso pra pegar Barão ou outra lane.' : 'Perdemos um inibidor. Alguém precisa segurar a super wave.', ehAliado(e.autor) ? 'Inibidor deles no chão. Agora o mapa é nosso.' : 'Inibidor nosso caiu. Vai ter super minion na base, cuidado.', 2);
  }

  /* ---- extras: build, dano deles, mains ---- */
  let jaFalouDoGold = false;
  if (extras) {
    if (extras.dano && tempo > 20) {
      const { ap, ad } = extras.dano;
      if (ad >= 4) dizer('dano', 'lane', 'Time inimigo é quase todo AD. Prioriza armadura.', 'Eles são tudo AD. Armadura neles.', 1);
      else if (ap >= 3) dizer('dano', 'lane', 'Time inimigo tem muito AP. Resistência mágica vale mais que armadura.', 'Time deles é de mago. Resistência mágica, hein.', 1);
    }
    for (const m of extras.mains ?? []) {
      if (m.pontos >= 150000) dizer(`main-${m.nome}`, 'lane', `${m.campeao} é main ${m.role === 'jungle' ? 'do jungler' : 'do seu oponente'}: ${Math.round(m.pontos / 1000)} mil pontos. Fica esperto.`, `${m.campeao} é main, ${Math.round(m.pontos / 1000)} mil pontos. O cara sabe o que faz.`, 1);
      else if (m.pontos > 0 && m.pontos < 25000) dizer(`main-${m.nome}`, 'lane', `${m.campeao} não é main ${m.role === 'jungle' ? 'do jungler' : 'do seu oponente'}: ${Math.round(m.pontos / 1000)} mil pontos. Dá pra explorar.`, `${m.campeao} não é o main dele. Abusa cedo.`, 1);
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
          dizer(`item-${it.id}`, 'economia', `${it.nome} fechado${cedo ? ' antes da hora. Aproveita a vantagem agora' : ''}.${prox ? ` Próximo: ${prox.nome}.` : ''}`, `${it.nome} na mão${cedo ? ', cedo demais, o cara não vai aguentar' : ''}.${prox ? ` Agora junta pro ${prox.nome}.` : ''}`, 1);
        }
      }
      const prox = b.ordem.find((x) => !tenho.has(x.id));
      if (prox?.preco && eu.ouro >= prox.preco && !eu.morto) { jaFalouDoGold = true; dizer(`gold-item-${prox.id}`, 'economia', `Tem gold pro ${prox.nome}. Empurra a wave e volta.`, `Dá pra comprar ${prox.nome}. Volta e fecha, não fica de enfeite com o gold.`, 2); }
    }
  }

  /* ---- você × seu oponente direto, a cada 3 minutos depois dos 6 ---- */
  const rival = inimigos.find((j) => j.role && j.role === minhaRole && minhaRole !== 'sup');
  if (rival && tempo >= 360 && tempo % 180 < 8) {
    const k = Math.floor(tempo / 180);
    const vant = (eu.nivel - rival.nivel) + (eu.cs - rival.cs) / 25 + (eu.kills - rival.kills) * 0.7 - (eu.mortes - rival.mortes) * 0.5;
    if (vant >= 2) dizer(`rival-${k}`, 'lane', `Você está mais forte que o ${rival.campeao}. Pressiona a vantagem.`, `Tá ganhando do ${rival.campeao}. Bora ser agressivo, você é mais forte.`, 1);
    else if (vant <= -2) dizer(`rival-${k}`, 'lane', `${rival.campeao} está na frente. Não force trade: farma seguro e espera o jungler.`, `${rival.campeao} tá na sua frente. Sem heroísmo, farma de longe.`, 2);
  }
  const itensRival = rival ? (rival.itens ?? []).filter((i) => i.preco >= 2000).length : 0;
  if (rival && itensRival >= 2) dizer(`rival-itens-${itensRival}`, 'spikes', `${rival.campeao} fechou o ${itensRival}º item. Tá ficando perigoso, não force trade.`, `${rival.campeao} com ${itensRival} itens. Respeita.`, 2);

  /* ---- seu nível 6 ---- */
  if (eu.nivel >= 6 && mem.nivelAntes < 6 && mem.nivelAntes > 0) dizer('meu-6', 'lane', 'Nível 6. Ult disponível, procura a jogada.', 'Level 6, ult na mão. Alguém vai chorar.', 1);
  mem.nivelAntes = eu.nivel;

  /* ---- inimigo nasceu ---- */
  for (const j of inimigos) {
    if (j.morto) mem.mortosAntes.add(j.nome);
    else if (mem.mortosAntes.has(j.nome)) { mem.mortosAntes.delete(j.nome); if (tempo > 60) dizer(`nasceu-${j.nome}-${Math.floor(tempo)}`, 'mapa', `${j.campeao} nasceu. Olho no mapa.`, `${j.campeao} voltou. Olha o mapa.`, 0); }
  }

  /* ---- lembrete de mapa (laner), a cada 2 min ---- */
  if (minhaRole !== 'jungle' && tempo >= 240 && tempo % 120 < 8) {
    const k = Math.floor(tempo / 120);
    const frases = [['Olha o minimapa.', 'Você já olhou o mapa hoje?'], ['Check minimapa.', 'Mapa. Mapa. Mapa.'], ['Confere o mapa antes de avançar.', 'Olha o mapa antes de andar pra frente, por favor.']];
    const [s, d] = frases[k % frases.length];
    dizer(`mapa-${k}`, 'mapa', s, d, 0);
  }

  /* ---- torres: vantagem ---- */
  const torres = eventos.filter((e) => e.tipo === 'TurretKilled' && e.torre);
  const minhasT = torres.filter((e) => Number(String(e.torre).match(/Turret_T(\d)/)?.[1]) !== (eu.time === 100 ? 1 : 2)).length;
  const delasT = torres.length - minhasT;
  if (minhasT - delasT >= 3) dizer(`torres-${minhasT - delasT}`, 'timers', `Vantagem de ${minhasT - delasT} torres. O mapa é nosso: foca nos objetivos e fecha.`, `${minhasT - delasT} torres na frente. O mapa é nosso, vai lá acabar.`, 1);
  else if (delasT - minhasT >= 3) dizer(`torres--${delasT - minhasT}`, 'timers', 'Eles têm três torres a mais. Farma, defende torre e espera a oportunidade. Paciência.', 'Estamos atrás em torre. Segura, farma e espera eles errarem.', 1);

  /* ---- jungler deles morto: janela ---- */
  if (jgDeles?.morto && jgDeles.renasceEm > 20) dizer(`jgbase-${Math.floor(tempo / 60)}`, 'jungler', `${jgDeles.campeao} está na base esperando o respawn. Aproveita pra punir.`, `${jgDeles.campeao} tá morto. Rouba o jungle dele, vai.`, 1);

  /* ---- spikes vindos do rastreio ---- */
  for (const a of rastreio?.avisos ?? []) {
    if (a.t < mem.ultimoTempo - 1) continue;
    if (String(a.chave).startsWith('item-')) dizer(`fala-${a.chave}`, 'spikes', `${a.titulo}. Cuidado, power spike. ${a.acao ?? ''}`.trim(), `${a.titulo}. Cuidado que agora ele bate.`, a.urgencia);
    else if (String(a.chave).startsWith('nv-') && /nível 6/.test(a.titulo)) dizer(`fala-${a.chave}`, 'spikes', `${a.titulo}. Ele tem ult, respeita.`, `${a.titulo}. Ult liberada, não dá presente.`, 2);
    else if (String(a.chave).startsWith('nv-') && /níveis na frente/.test(a.titulo)) dizer(`fala-${a.chave}`, 'spikes', `${a.titulo}. Não troca com ele agora.`, `${a.titulo}. Ele te come. Farma de longe.`, 2);
    else if (String(a.chave).startsWith('jg-')) dizer(`fala-${a.chave}`, 'jungler', a.titulo, a.titulo, 2);
  }

  /* ---- inimigo fedado ---- */
  const forte = inimigos.find((j) => j.kills >= 5 && j.kills >= j.mortes * 2);
  if (forte) dizer(`forte-${forte.nome}-${forte.kills}`, 'kills', `Cuidado, ${forte.campeao} está muito forte, ${forte.kills} a ${forte.mortes}. Evita ele e chama o time.`, `${forte.campeao} tá fedado, ${forte.kills} kills. Não vai sozinho nele que é suicídio.`, 2);

  /* ---- economia ---- */
  const vidaPct = eu.vidaMax ? eu.vida / eu.vidaMax : 1;
  if (!eu.morto && eu.ouro >= 1000 && vidaPct < 0.4) dizer(`base-${Math.floor(tempo / 45)}`, 'economia', 'Vida baixa e gold sobrando. Volta pra base agora.', 'Vida baixa e gold no bolso. Volta antes de morrer de graça.', 2);
  else if (!eu.morto && eu.ouro >= 1600 && !jaFalouDoGold) dizer(`gold-${Math.floor(tempo / 180)}`, 'economia', `${eu.ouro} de gold parado. Volta rápido e compra, não perde tempo na lane sem item.`, `${eu.ouro} de gold no bolso e nada na mão. Volta e compra, mano.`, 1);

  /* ---- estado do jogo ---- */
  const nossosKills = aliados.reduce((s, j) => s + j.kills, 0), delesKills = inimigos.reduce((s, j) => s + j.kills, 0);
  if (tempo >= 900 && tempo < 908) {
    if (Math.abs(nossosKills - delesKills) <= 2) dizer('jogo-15', 'lane', 'Quinze minutos e jogo disputado. Quem errar menos ganha: foca no posicionamento.', 'Quinze minutos, jogo parelho. Quem morrer de bobeira entrega.', 1);
    else if (nossosKills > delesKills) dizer('jogo-15', 'lane', 'Quinze minutos e estamos na frente. Fecha objetivo, não fica caçando kill.', 'Estamos na frente. Agora é objetivo, não é caçar kill pra estatística.', 1);
    else dizer('jogo-15', 'lane', 'Quinze minutos e estamos atrás. Farma seguro, espera erro deles e briga só com o time junto.', 'Estamos atrás. Sem heroísmo: farma, agrupa e espera eles errarem.', 1);
  }
  const mortosDeles = inimigos.filter((j) => j.morto).length;
  if (mortosDeles >= 3) dizer(`3mortos-${Math.floor(tempo / 30)}`, 'timers', `Eles estão com ${mortosDeles} mortos. Pressão: torre ou objetivo agora.`, `${mortosDeles} deles no chão. Pega alguma coisa antes que voltem.`, 3);
  if (minhaRole === 'sup' && tempo >= 480 && tempo < 488) dizer('sup-visao', 'lane', 'Visão de longe salva a sua vida. Ward profunda antes do próximo objetivo.', 'Suporte sem ward é só um cara com menos gold. Vai wardar.', 1);
  if (tempo >= 1800 && tempo < 1808 && nossosKills > delesKills + 5) dizer('fecha', 'lane', 'Trinta minutos e vantagem grande. Empurra tudo e acaba com o jogo; não deixa virar.', 'Trinta minutos na frente. Acaba com eles antes que a sorte deles mude.', 2);

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
    ? { serio: `Pelos confrontos, ${melhor.nome} é o melhor pick contra o que eles travaram${pior && pior.taxa < 0.47 ? `; cuidado com ${pior.campeao}` : ''}.`,
        divertido: `${melhor.nome} come esse time deles${pior && pior.taxa < 0.47 ? `, menos o ${pior.campeao}, que é chato` : ''}.` }
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
    dizer('ban', `Partida encontrada. Você está de ${rotaFala}. ${a.campeao} já te deu muito trabalho nessa rota, melhor banir.${b ? ` Outra opção de ban: ${b.campeao}, que também acaba com você.` : ''}`,
      `Partida encontrada, ${rotaFala}. ${a.campeao} te ganha direto: bane.${b ? ` Se não, ${b.campeao}, que também te come.` : ''}`, 2);
  } else {
    dizer('inicio', `Partida encontrada. Você está de ${rotaFala}.`, `Achou partida. ${rotaFala}, bora.`, 1);
  }
  for (const i of inimigos) if (i.nome) dizer(`ini-${i.id}`, `Inimigo pegou ${i.nome}${i.rota ? ' ' + i.rota : ''}.`, `Eles pegaram ${i.nome}. Anota.`, 1);
  const cc = inimigos.filter((i) => MUITO_CC.has(i.nome)).length;
  if (cc >= 3 && ['bottom', 'middle'].includes(rota)) dizer('cc', `O time deles tem muito controle de grupo: ${cc} campeões. Considera Purificar ou botas de Mercúrio.`, `Eles têm ${cc} campeões de stun. Purificar ou Mercúrio, senão você vai ficar parado a partida toda.`, 2);
  if (meuCampeao && runas) dizer(`runas-${meuCampeao}`, `${meuCampeao} travado. Runas aplicadas: ${runas.chave ?? ''}${runas.primaria ? ', ' + runas.primaria : ''}${runas.secundaria ? ', secundária ' + runas.secundaria : ''}.`, `${meuCampeao} travado e runas prontas: ${runas.chave ?? runas.primaria ?? ''}. Só entrar e jogar.`, 1);
  return novas.sort((a, b) => b.prioridade - a.prioridade);
}
export { ESTILO };
