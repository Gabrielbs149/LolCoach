import { dist, zonaRelativa } from './mapa.js';
import { distancia, segundosDeCaminhada } from './linguagem.js';

/**
 * Segunda camada da análise: pega os achados dos detectores e acrescenta o
 * contexto que transforma "morreu na rota superior" em algo acionável — quanta
 * vida você tinha, qual magia te matou, se você revidou, quanto a morte custou.
 *
 * Só funciona com dado da API oficial, que é quem traz `championStats`,
 * `bounty` e o detalhe de dano por magia.
 */

const SLOT = { 0: 'Q', 1: 'W', 2: 'E', 3: 'R' };
const pctInt = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** "Darius com W, Q, passiva e 3 autos" a partir do dano recebido. */
function descreverDano(danoRecebido, p, meuTime) {
  if (!danoRecebido?.length) return null;

  const porJogador = new Map();
  for (const d of danoRecebido) {
    const j = p.jogador(d.participantId);
    if (!j || j.time === meuTime) continue;
    if (!porJogador.has(j)) porJogador.set(j, { total: 0, magias: new Map(), autos: 0 });
    const reg = porJogador.get(j);
    const dano = (d.physicalDamage ?? 0) + (d.magicDamage ?? 0) + (d.trueDamage ?? 0);
    reg.total += dano;

    if (d.basic || /basicattack/i.test(d.spellName ?? '')) reg.autos++;
    else {
      const nome = SLOT[d.spellSlot] ?? 'passiva';
      reg.magias.set(nome, (reg.magias.get(nome) ?? 0) + dano);
    }
  }
  if (!porJogador.size) return null;

  const lista = [...porJogador.entries()].sort((a, b) => b[1].total - a[1].total);
  const totalGeral = lista.reduce((s, [, r]) => s + r.total, 0);

  return {
    total: Math.round(totalGeral),
    principal: lista[0][0],
    fatiaPrincipal: pctInt(lista[0][1].total, totalGeral),
    texto: lista.map(([j, r]) => {
      const pedacos = [...r.magias.keys()];
      if (r.autos) pedacos.push(`${r.autos} auto${r.autos > 1 ? 's' : ''}`);
      return `${j.campeao} (${Math.round(r.total)}${pedacos.length ? ` — ${pedacos.join(', ')}` : ''})`;
    }).join(', '),
  };
}

/** Vida que você tinha no último frame antes do evento. */
function vidaAntes(p, eu, t) {
  const f = p.frameEm(t);
  const s = f?.dados[eu.id]?.stats;
  if (!s?.healthMax) return null;
  return { atual: Math.round(s.health), max: Math.round(s.healthMax), pct: pctInt(s.health, s.healthMax), quando: f.t };
}

/** Diferença de ouro entre os times naquele instante. */
function ouroDoTime(p, eu, t) {
  const f = p.frameEm(t);
  if (!f) return null;
  let meu = 0, deles = 0;
  for (const j of p.jogadores) {
    const g = f.dados[j.id]?.ouroTotal ?? 0;
    if (j.time === eu.time) meu += g; else deles += g;
  }
  return meu - deles;
}

/**
 * Reconstrói a jogada em texto: de onde você veio, de onde eles vieram e onde
 * estava o time. É o que o mapa sozinho não conta — sem isso o quadro congelado
 * mostra posições sem mostrar a aproximação.
 *
 * Só compara dois instantes com um minuto de diferença, que é a resolução que a
 * timeline oferece. Serve pra direção, não pro caminho exato.
 */
function montarNarrativa(p, eu, t, ponto, culpados) {
  const atual = p.frameEm(t);
  const indice = p.frames.indexOf(atual);
  const antes = p.frames[indice - 1];
  if (!ponto) return [];

  const frases = [];

  // O frame 0 é o instante em que a partida começa, com os dez parados na base.
  // Usar isso como "de onde a pessoa veio" inventava um deslocamento gigante da
  // base até a rota para TODO mundo, em qualquer evento dos primeiros minutos.
  const temAntes = antes && indice - 1 > 0;

  if (temAntes && p.vivo(eu.id, antes.t)) {
    const meuAntes = antes.pos[eu.id];
    if (meuAntes) {
      const de = zonaRelativa(meuAntes, eu.time);
      const para = zonaRelativa(ponto, eu.time);
      const andou = dist(meuAntes, ponto);
      frases.push(de === para
        ? `Um minuto antes você já estava em ${de} — ficou parado ali.`
        : `Um minuto antes você estava em ${de} e foi até ${para} — ${segundosDeCaminhada(andou)}s de caminhada.`);
    }
  } else if (temAntes) {
    frases.push('Um minuto antes você estava morto — chegou aqui logo depois de renascer.');
  }

  // De onde vieram os que te mataram. Quem estava morto não "veio" de lugar
  // nenhum: a posição registrada era a fonte.
  if (temAntes) {
    const vindos = [];
    for (const id of new Set(culpados)) {
      const j = p.jogador(id);
      const antesDele = antes.pos[id];
      if (!j || !antesDele) continue;
      if (!p.vivo(id, antes.t)) { vindos.push(`${j.campeao} tinha acabado de renascer`); continue; }
      const d = dist(antesDele, ponto);
      vindos.push(`${j.campeao} estava em ${zonaRelativa(antesDele, eu.time)}, ${distancia(d)}`);
    }
    if (vindos.length) frases.push(`No minuto anterior: ${vindos.join('; ')}.`);
  }

  // O aliado mais próximo, que é o que decide se dava pra brigar.
  let maisPerto = null;
  for (const j of p.jogadores) {
    if (j.time !== eu.time || j.id === eu.id) continue;
    if (!p.vivo(j.id, t)) continue;
    const q = atual.pos[j.id];
    if (!q) continue;
    const d = dist(q, ponto);
    if (!maisPerto || d < maisPerto.d) maisPerto = { j, d };
  }
  if (maisPerto) {
    frases.push(maisPerto.d > 5000
      ? `O aliado vivo mais perto era ${maisPerto.j.campeao}, ${distancia(maisPerto.d)} — longe demais pra ajudar.`
      : `Aliado mais perto: ${maisPerto.j.campeao}, ${distancia(maisPerto.d)}.`);
  } else {
    frases.push('Todo o resto do seu time estava morto nesse momento.');
  }

  return frases;
}

/** Acrescenta contexto a um achado. */
function enriquecer(a, p, eu) {
  const extra = { ...a, contexto: [], culpados: [], pos: null, custoOuro: 0 };
  const morte = a.tipo === 'morte'
    ? p.eventos.find((e) => e.tipo === 'CHAMPION_KILL' && e.vitimaId === eu.id && e.t === a.t)
    : null;

  extra.pos = morte?.pos ?? p.frameEm(a.t).pos[eu.id] ?? null;

  const vida = vidaAntes(p, eu, a.t);
  if (vida && vida.pct < 55) {
    extra.contexto.push(`Você já estava com ${vida.pct}% de vida (${vida.atual} de ${vida.max}) no minuto anterior.`);
  }

  if (morte) {
    const dano = descreverDano(morte.danoRecebido, p, eu.time);
    if (dano) {
      extra.culpados = morte.danoRecebido
        .map((d) => p.jogador(d.participantId))
        .filter((j) => j && j.time !== eu.time)
        .map((j) => j.id);
      extra.contexto.push(`Te matou: ${dano.texto}. ${dano.principal.campeao} sozinho fez ${dano.fatiaPrincipal}% do dano.`);
    }

    const revidou = (morte.danoCausado ?? morte.victimDamageDealt ?? [])
      .reduce((s, d) => s + (d.physicalDamage ?? 0) + (d.magicDamage ?? 0) + (d.trueDamage ?? 0), 0);
    if (dano) {
      extra.contexto.push(revidou < dano.total * 0.25
        ? `Você devolveu só ${Math.round(revidou)} de dano — não foi uma troca, foi uma execução.`
        : `Você devolveu ${Math.round(revidou)} de dano antes de cair.`);
    }

    const bounty = (morte.bounty ?? 0) + (morte.shutdownBounty ?? 0);
    if (bounty) {
      extra.custoOuro = bounty;
      extra.contexto.push(`Essa morte entregou ${bounty} de gold${morte.shutdownBounty ? ` (${morte.shutdownBounty} de shutdown)` : ''}.`);
    }
  }

  const ouro = ouroDoTime(p, eu, a.t);
  if (ouro !== null && Math.abs(ouro) >= 2000) {
    extra.contexto.push(`Naquele momento seu time estava ${ouro > 0 ? 'na frente' : 'atrás'} por ${Math.abs(Math.round(ouro / 100) * 100)} de gold.`);
  }

  extra.narrativa = montarNarrativa(p, eu, a.t, extra.pos, extra.culpados);
  // A resolução é preenchida depois, por resolucao.js, que precisa buscar
  // a ficha do campeão e a tabela de confrontos.
  extra.resolucao = null;
  return extra;
}

/* ------------------------------------------------------------- resumo */

function montarResumo(p, eu, achados) {
  const s = eu.stats;
  const min = p.duracaoS / 60;
  const meuTime = p.jogadores.filter((j) => j.time === eu.time);

  const danoTime = meuTime.reduce((t, j) => t + (j.stats.totalDamageDealtToChampions ?? 0), 0);
  const mortesTime = meuTime.reduce((t, j) => t + (j.stats.deaths ?? 0), 0);
  const rival = p.jogadores.find((j) => j.time !== eu.time && j.role === eu.role);

  const custoTotal = achados.reduce((t, a) => t + (a.custoOuro ?? 0), 0);
  const graves = achados.filter((a) => a.gravidade === 3);

  // Onde o jogo virou: maior variação de ouro entre dois minutos seguidos.
  let virada = null;
  for (let i = 1; i < p.frames.length; i++) {
    const dif = (t) => {
      let m = 0, d = 0;
      for (const j of p.jogadores) {
        const g = p.frames[t].dados[j.id]?.ouroTotal ?? 0;
        if (j.time === eu.time) m += g; else d += g;
      }
      return m - d;
    };
    const delta = dif(i) - dif(i - 1);
    if (!virada || Math.abs(delta) > Math.abs(virada.delta)) virada = { minuto: Math.round(p.frames[i].minuto), delta };
  }

  // Diferença de gold aos 15 contra o oponente direto. É o número que u.gg e
  // op.gg usam como termômetro de lane (GD15) — vale mais que KDA pra saber se
  // a lane foi bem, porque não depende de kill que veio de gank.
  let gd15 = null;
  if (rival) {
    const f = p.frames.find((x) => x.minuto >= 15);
    if (f) gd15 = Math.round((f.dados[eu.id]?.ouroTotal ?? 0) - (f.dados[rival.id]?.ouroTotal ?? 0));
  }

  return {
    venci: p.vencedor === eu.time,
    campeao: eu.campeao,
    role: eu.role,
    gd15,
    duracao: min,
    kda: `${s.kills}/${s.deaths}/${s.assists}`,
    participacao: pctInt(s.kills + s.assists, meuTime.reduce((t, j) => t + j.stats.kills, 0)),
    cs: s.totalMinionsKilled + s.neutralMinionsKilled,
    csMin: ((s.totalMinionsKilled + s.neutralMinionsKilled) / min).toFixed(1),
    dano: s.totalDamageDealtToChampions,
    fatiaDeDano: pctInt(s.totalDamageDealtToChampions, danoTime),
    fatiaDeMortes: pctInt(s.deaths, mortesTime),
    visao: s.visionScore,
    wards: s.wardsPlaced,
    rival,
    custoTotal,
    graves: graves.length,
    virada,
  };
}

/* --------------------------------------------------------- prioridades */

// Cada tipo vira uma orientação concreta. O texto recebe os números da
// partida, senão vira conselho de biscoito da sorte.
const CONSELHOS = {
  morte: (n, ach) => {
    // Só as mortes isoladas interessam aqui; as outras têm causas diferentes.
    const isoladas = ach.filter((a) => /sozinho/.test(a.titulo));
    if (!isoladas.length) return null;
    return {
      itens: isoladas,
      titulo: `${isoladas.length} das suas ${n} mortes foram sozinho, sem aliado por perto`,
      texto: 'Antes de andar pro lado deles, procure um aliado a menos de uma tela de você. Se não tem nenhum, aquele lado do mapa não é seu — não importa quão forte você esteja.',
    };
  },
  'primeiro-a-cair': (n) => ({
    titulo: `Você abriu ${n} briga${n > 1 ? 's' : ''} morrendo primeiro`,
    texto: 'Quem morre primeiro define quem perde a briga. Espere eles gastarem o primeiro flash ou a primeira ult antes de entrar — se você entra antes disso, o time briga 4v5 desde o começo.',
  }),
  'sem-visao-antes-de-entrar': (n) => ({
    titulo: `${n} morte${n > 1 ? 's' : ''} no lado deles sem nenhuma ward colocada antes`,
    texto: 'Regra simples: ward antes de cruzar o river, sempre. É o gasto mais barato do jogo e é exatamente a informação que faltou em cada uma dessas mortes.',
  }),
  'briga-sem-voce': (n) => ({
    titulo: `Time perdeu ${n} briga${n > 1 ? 's' : ''} com você vivo e longe`,
    texto: 'Quando três ou mais aliados se juntam no mapa, ou você vai junto ou pega algo que valha mais que a briga (torre, objetivo, camps). Ficar farmando side enquanto o time briga é o pior dos dois mundos.',
  }),
  'objetivo-sem-voce': (n) => ({
    titulo: `${n} objetivo${n > 1 ? 's caíram' : ' caiu'} com você do outro lado`,
    texto: 'Dragão e barão têm timer. Trinta segundos antes do spawn, comece a rotacionar — chegar depois que a briga começou é o mesmo que não ter ido.',
  }),
  'ritmo-de-selva': () => ({
    titulo: 'Ficou atrás do jungler inimigo em farm',
    texto: 'Jungler atrás de farm chega em tudo com menos nível e menos item. Termine o clear antes de sair pra um gank duvidoso: camp é gold garantido, gank não é.',
  }),
  'ouro-parado': (n) => ({
    titulo: `Gold parado no bolso em ${n} momento${n > 1 ? 's' : ''}`,
    texto: 'Recall assim que tiver o valor de um item, mesmo com a wave boa. Item na mão ganha troca; gold no bolso não faz nada.',
  }),
  'visao-atras': () => ({
    titulo: 'Visão abaixo do seu oponente direto',
    texto: 'Ward rosa custa 75 de gold e apaga a visão inteira de um objetivo. Compre uma todo recall — é o item com melhor retorno do jogo.',
  }),
};

/** As três coisas que mais valem a pena corrigir nesta partida. */
function montarPrioridades(achados) {
  const porTipo = new Map();
  for (const a of achados) {
    if (!porTipo.has(a.tipo)) porTipo.set(a.tipo, []);
    porTipo.get(a.tipo).push(a);
  }

  const lista = [];
  for (const [tipo, itens] of porTipo) {
    const conselho = CONSELHOS[tipo]?.(itens.length, itens);
    if (!conselho) continue;

    // O conselho pode se aplicar só a um subconjunto (ex.: as mortes isoladas).
    // Os minutos listados têm que ser os desse subconjunto, senão o texto diz
    // "3 mortes" e mostra 8 horários.
    const relevantes = conselho.itens ?? itens;
    const { itens: _, ...resto } = conselho;

    lista.push({
      tipo,
      peso: relevantes.reduce((t, a) => t + a.gravidade, 0),
      ocorrencias: relevantes.length,
      momentos: relevantes.map((a) => a.t),
      ...resto,
    });
  }

  return lista.sort((a, b) => b.peso - a.peso).slice(0, 3);
}

/** Junta tudo num modelo pronto pro relatório. */
export function detalharPartida(p, eu, achados) {
  const enriquecidos = achados.map((a) => enriquecer(a, p, eu));
  return {
    resumo: montarResumo(p, eu, enriquecidos),
    achados: enriquecidos,
    prioridades: montarPrioridades(enriquecidos),
  };
}

export { descreverDano, zonaRelativa, dist };
