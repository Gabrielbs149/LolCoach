import { dist, zona, zonaRelativa, emCampoInimigo, territorio, tipoDeZona } from './mapa.js';
import { distancia } from './linguagem.js';

const RAIO_BRIGA = 3200;   // ~uma tela de distância
const RAIO_AJUDA = 4200;   // alcance em que um aliado ainda poderia ter ajudado

const achado = (tipo, t, gravidade, titulo, detalhe) => ({
  tipo, t, gravidade, titulo,
  motivos: Array.isArray(detalhe) ? detalhe : [detalhe],
});

const NOME_MONSTRO = {
  DRAGON: 'dragão', RIFTHERALD: 'arauto', BARON_NASHOR: 'barão',
  HORDE: 'larvas do vazio', ATAKHAN: 'Atakhan',
};

// Objetivos que decidem partida. Larvas e arauto valem menos: perder um deles
// enquanto você faz outra coisa do outro lado costuma ser troca, não erro.
const PESO_OBJETIVO = { BARON_NASHOR: 3, DRAGON: 3, ATAKHAN: 3, RIFTHERALD: 2, HORDE: 1 };

const inimigoDe = (eu) => (eu.time === 100 ? 200 : 100);
const junglerInimigo = (p, eu) => p.jogadores.find((j) => j.time !== eu.time && j.role === 'JUNGLE');

/** Kills do jogo agrupadas em brigas: sequências com menos de 25s entre mortes. */
function agruparBrigas(p, minimo = 3) {
  const kills = p.eventos.filter((e) => e.tipo === 'CHAMPION_KILL');
  const brigas = [];
  let atual = null;
  for (const k of kills) {
    if (atual && k.t - atual.fim <= 25_000 && dist(k.pos, atual.pos) < 5500) {
      atual.kills.push(k);
      atual.fim = k.t;
    } else {
      atual = { inicio: k.t, fim: k.t, pos: k.pos, kills: [k] };
      brigas.push(atual);
    }
  }
  return brigas.filter((b) => b.kills.length >= minimo);
}

/* ------------------------------------------------------------------ mortes */

/**
 * Campeões inimigos que realmente causaram dano nesta morte, do maior pro menor.
 * Só existe quando o dado vem da API oficial; devolve null se não houver.
 */
function atacantesReais(p, eu, morte) {
  if (!morte.danoRecebido?.length) return null;

  const porJogador = new Map();
  for (const d of morte.danoRecebido) {
    const j = p.jogador(d.participantId);
    if (!j || j.time === eu.time) continue; // torre e minion não contam
    const total = (d.physicalDamage ?? 0) + (d.magicDamage ?? 0) + (d.trueDamage ?? 0);
    porJogador.set(j, (porJogador.get(j) ?? 0) + total);
  }
  if (!porJogador.size) return null;

  const ordenado = [...porJogador.entries()].sort((a, b) => b[1] - a[1]);

  // Quem só encostou não conta como participante da morte. Sem isso, um 1v1
  // perdido em que outro deu o último tiro vira "morreu contra 2", o que aponta
  // pro erro errado: o problema foi a troca, não o número.
  const total = ordenado.reduce((s, [, d]) => s + d, 0);
  const relevantes = ordenado.filter(([, d], i) => i === 0 || d / total >= 0.15);

  const lista = relevantes.map(([j]) => j);
  lista.dano = new Map(relevantes);
  return lista;
}

/**
 * Cada morte vira UM apontamento só, com todos os motivos que se aplicam.
 * Detectores separados faziam a mesma morte aparecer três vezes e inflavam
 * a contagem de erros.
 */
function analisarMortes(p, eu) {
  const minhas = p.eventos.filter((e) => e.tipo === 'CHAMPION_KILL' && e.vitimaId === eu.id);
  const saida = [];

  minhas.forEach((e, i) => {
    const antes = e.t - 1;
    const aliados = p.perto(e.pos, antes, RAIO_AJUDA, { time: eu.time, exceto: [eu.id] });
    const noCampoDeles = emCampoInimigo(e.pos, eu.time);
    const onde = zonaRelativa(e.pos, eu.time);

    // Quem te matou de fato. Quando a API da Riot está disponível, `danoRecebido`
    // diz exatamente quais campeões te acertaram — bem mais confiável que
    // estimar por proximidade num frame que pode estar até 60s desatualizado.
    const perto = atacantesReais(p, eu, e)
      ?? p.perto(e.pos, antes, RAIO_BRIGA, { time: inimigoDe(eu) });

    const trocou = p.eventos.some((o) => o.tipo === 'CHAMPION_KILL'
      && p.jogador(o.vitimaId)?.time !== eu.time
      && Math.abs(o.t - e.t) <= 20_000
      && dist(o.pos, e.pos) < 5000);

    const motivos = [];
    let gravidade = 1;
    let titulo = `Morreu em ${onde}`;

    // Com o dano real em mãos, dá pra dizer quem te matou e com quanto.
    const quem = perto.dano
      ? [...perto.dano].map(([j, d]) => `${j.campeao} ${Math.round(d)}`).join(', ')
      : perto.map((j) => j.campeao).join(', ');

    if (perto.length >= 2 && aliados.length === 0) {
      gravidade = 3;
      titulo = `Morreu sozinho contra ${perto.length} em ${onde}`;
      motivos.push(`Nenhum aliado por perto. ${perto.dano ? `Dano que te matou: ${quem}.` : `Em cima de você: ${quem}.`}`);
    } else if (perto.length > aliados.length + 1) {
      gravidade = Math.max(gravidade, 2);
      titulo = `Morreu em ${perto.length}v${aliados.length + 1} em ${onde}`;
      motivos.push('Entrou num número que não dava pra ganhar nem jogando bem.');
    }

    if (!trocou) {
      gravidade = Math.max(gravidade, noCampoDeles ? 3 : 2);
      motivos.push(noCampoDeles
        ? 'Ninguém caiu em troca, e foi no lado do mapa deles.'
        : 'Ninguém do time deles caiu perto no mesmo intervalo.');
    }

    const gap = i > 0 ? (e.t - minhas[i - 1].t) / 1000 : Infinity;
    if (gap <= 100) {
      gravidade = 3;
      motivos.push(`Só ${Math.round(gap)}s depois da morte anterior: voltou pro mesmo lugar sem nada ter mudado, e agora ele está mais forte com o gold da primeira.`);
    }

    if (motivos.length) saida.push(achado('morte', e.t, gravidade, titulo, motivos));
  });

  return saida;
}

/** Foi o primeiro a cair numa briga que o time perdeu. */
function primeiroACair(p, eu) {
  const saida = [];
  for (const b of agruparBrigas(p)) {
    const primeira = b.kills[0];
    if (primeira.vitimaId !== eu.id) continue;
    const perdas = b.kills.filter((k) => p.jogador(k.vitimaId)?.time === eu.time).length;
    if (perdas <= b.kills.length - perdas) continue;

    saida.push(achado('primeiro-a-cair', primeira.t, 3,
      `Foi o primeiro a cair numa briga que o time perdeu ${perdas}x${b.kills.length - perdas}`,
      `Em ${zonaRelativa(primeira.pos, eu.time)}. Quem cai primeiro define quem perde a briga: o resto do time luta sem dano. A derrota já estava decidida no seu posicionamento antes de começar.`));
  }
  return saida;
}

/* -------------------------------------------------------------- objetivos */

/**
 * Objetivo inimigo perdido com você longe. Só conta como erro se o seu time
 * não estava pegando outra coisa ao mesmo tempo: troca de mapa é jogada certa,
 * não falha de rotação.
 */
function objetivosSemVoce(p, eu) {
  const saida = [];
  for (const e of p.eventos) {
    if (e.tipo !== 'ELITE_MONSTER_KILL') continue;
    const autor = p.jogador(e.autorId);
    if (!autor || autor.time === eu.time) continue;
    if (!p.vivo(eu.id, e.t)) continue; // estar morto não é escolha de posicionamento

    const peso = PESO_OBJETIVO[e.monstro] ?? 1;
    if (peso < 2) continue; // larvas sozinhas não sustentam um apontamento

    const trocaDeMapa = p.eventos.some((o) => o.tipo === 'ELITE_MONSTER_KILL'
      && p.jogador(o.autorId)?.time === eu.time
      && Math.abs(o.t - e.t) <= 45_000);
    if (trocaDeMapa) continue;

    const minhaPos = p.frameEm(e.t).pos[eu.id];
    const d = dist(minhaPos, e.pos);
    const limite = eu.role === 'JUNGLE' ? 7500 : 9000;
    if (d <= limite) continue;

    const nome = NOME_MONSTRO[e.monstro] ?? String(e.monstro).toLowerCase();
    saida.push(achado('objetivo-sem-voce', e.t, peso >= 3 ? 2 : 1,
      `${nome[0].toUpperCase()}${nome.slice(1)} caiu com você do outro lado do mapa`,
      `Você estava em ${zonaRelativa(minhaPos, eu.time)}, ${distancia(d)} do pit, vivo, e seu time não pegou nada em troca nos 45s ao redor.`));
  }
  return saida;
}

/** Briga grande que o time perdeu enquanto você estava em outro lugar. */
function brigasSemVoce(p, eu) {
  const saida = [];
  for (const b of agruparBrigas(p)) {
    const perdas = b.kills.filter((k) => p.jogador(k.vitimaId)?.time === eu.time).length;
    const ganhos = b.kills.length - perdas;
    if (perdas <= ganhos) continue;
    if (b.kills.some((k) => k.vitimaId === eu.id)) continue; // morreu nela, então estava lá
    if (!p.vivo(eu.id, b.inicio)) continue;

    const minhaPos = p.frameEm(b.inicio).pos[eu.id];
    const d = dist(minhaPos, b.pos);
    if (d <= 5500) continue;

    saida.push(achado('briga-sem-voce', b.inicio, 2,
      `Time perdeu ${perdas}x${ganhos} e você estava ${distancia(d)} dali`,
      `A briga foi em ${zonaRelativa(b.pos, eu.time)} e você estava vivo em ${zonaRelativa(minhaPos, eu.time)}. Sobrar de uma briga que o time toma não é neutro: vira 4v5.`));
  }
  return saida;
}

/* ----------------------------------------------------------------- economia */

/** Ouro parado no bolso por vários minutos seguidos. */
function ouroParado(p, eu) {
  const saida = [];
  let inicio = null;

  const fechar = (fimT) => {
    if (!inicio) return;
    const dur = (fimT - inicio.t) / 60000;
    if (dur >= 3) {
      saida.push(achado('ouro-parado', inicio.t, 1,
        `${inicio.dados[eu.id].ouro} de gold parado por ${dur.toFixed(0)} min`,
        'Gold parado não faz dano. Item comprado três minutos antes muda troca de lane e muda briga.'));
    }
    inicio = null;
  };

  for (const f of p.frames) {
    if ((f.dados[eu.id]?.ouro ?? 0) >= 1800) inicio ??= f;
    else fechar(f.t);
  }
  fechar(p.frames.at(-1).t);
  return saida;
}

/* ------------------------------------------------------------------ selva */

/**
 * Farm comparado direto com o jungler inimigo. É a métrica mais honesta de
 * ritmo de jungle que a timeline permite: mesma partida, mesmo tempo de jogo.
 * Reporta só o pior momento, pra não repetir o mesmo problema quatro vezes.
 */
function ritmoDeSelva(p, eu) {
  if (eu.role !== 'JUNGLE') return [];
  const rival = junglerInimigo(p, eu);
  if (!rival) return [];

  let pior = null;
  for (const m of [5, 10, 15, 20, 25]) {
    const f = p.frames.find((x) => x.minuto >= m);
    if (!f) continue;
    const meu = f.dados[eu.id], dele = f.dados[rival.id];
    const diff = (meu.cs + meu.csSelva) - (dele.cs + dele.csSelva);
    if (diff <= -18 && (!pior || diff < pior.diff)) pior = { m, f, diff, meu, dele };
  }
  if (!pior) return [];

  const nivel = pior.meu.nivel - pior.dele.nivel;
  return [achado('ritmo-de-selva', pior.f.t, pior.diff <= -35 ? 3 : 2,
    `${Math.abs(pior.diff)} de farm atrás do ${rival.campeao} aos ${pior.m}min`,
    [`Você: ${pior.meu.cs + pior.meu.csSelva} de farm, nível ${pior.meu.nivel}. Ele: ${pior.dele.cs + pior.dele.csSelva}, nível ${pior.dele.nivel}${nivel < 0 ? ` (${nivel} de nível)` : ''}.`,
      'Jungler atrás de farm chega atrasado em tudo: perde a briga do objetivo porque chega com menos nível, e não tem gold pro item que faria o gank funcionar.'])];
}

/**
 * Minutos em que você não ganhou farm nenhum, não estava em rota e não estava
 * num objetivo. É o tempo que sumiu do mapa sem virar nada.
 */
function tempoParado(p, eu) {
  if (eu.role !== 'JUNGLE') return [];
  const perdidos = [];

  for (let i = 0; i < p.frames.length - 1; i++) {
    const a = p.frames[i], b = p.frames[i + 1];
    if (b.minuto > 20) break;
    if (!p.vivo(eu.id, a.t) || !p.vivo(eu.id, b.t)) continue;

    const da = a.dados[eu.id], dbb = b.dados[eu.id];
    if (!da || !dbb) continue;
    if ((dbb.cs + dbb.csSelva) - (da.cs + da.csSelva) > 2) continue;

    const onde = zona(a.pos[eu.id]);
    if (tipoDeZona(a.pos[eu.id]) !== 'JUNGLE' && tipoDeZona(a.pos[eu.id]) !== 'RIVER') continue;

    const perto = p.eventos.some((e) => Math.abs(e.t - a.t) < 60_000
      && e.pos && dist(e.pos, a.pos[eu.id]) < 3000);
    if (perto) continue;

    perdidos.push({ minuto: Math.round(a.minuto), onde: zonaRelativa(a.pos[eu.id], eu.time) });
  }

  if (perdidos.length < 3) return [];
  return [achado('tempo-parado', perdidos[0].minuto * 60_000, perdidos.length >= 5 ? 3 : 2,
    `${perdidos.length} minutos sem farm, sem lane e sem objetivo`,
    [`Minutos ${perdidos.map((x) => x.minuto).join(', ')}. Você estava em ${[...new Set(perdidos.map((x) => x.onde))].join(', ')}.`,
      'Jungle é a única role que controla o próprio ritmo. Minuto andando sem clear e sem chegar em lugar nenhum é gold e xp que o jungler inimigo ganhou e você não.'])];
}

/** O jungler inimigo passeando dentro da sua jungle sem você por perto. */
function invasaoSofrida(p, eu) {
  if (eu.role !== 'JUNGLE') return [];
  const rival = junglerInimigo(p, eu);
  if (!rival) return [];

  const vezes = [];
  for (const f of p.frames) {
    if (f.minuto > 20) break;
    const dele = f.pos[rival.id], meu = f.pos[eu.id];
    if (!dele || !meu) continue;
    if (!p.vivo(rival.id, f.t)) continue;
    if (territorio(dele) !== eu.time) continue;
    if (tipoDeZona(dele) !== 'JUNGLE') continue;
    if (dist(meu, dele) < 5500) continue; // você estava perto, então foi disputa

    vezes.push(Math.round(f.minuto));
  }

  if (vezes.length < 3) return [];
  return [achado('invasao-sofrida', vezes[0] * 60_000, vezes.length >= 5 ? 3 : 2,
    `${rival.campeao} circulou livre na sua jungle em ${vezes.length} momentos`,
    [`Minutos ${vezes.join(', ')}, com você a mais de 5.5k de distância todas as vezes.`,
      'Jungle invadida sem resposta é perda dupla: ele leva teus camps e ainda sabe onde você não está. Se não dá pra contestar, o mínimo é estar pegando os camps dele do outro lado no mesmo minuto.'])];
}

/** Rota da jungle nos primeiros minutos, com leitura do clear inicial. */
function pathingInicial(p, eu) {
  if (eu.role !== 'JUNGLE') return [];
  const cedo = p.frames.filter((f) => f.minuto >= 1 && f.minuto <= 4);
  if (cedo.length < 3) return [];

  const rota = cedo.map((f) => `${f.minuto.toFixed(0)}min ${zonaRelativa(f.pos[eu.id], eu.time)}`);
  const aos4 = cedo.at(-1);
  const camps = aos4.dados[eu.id].csSelva;
  const rival = junglerInimigo(p, eu);
  const campsDele = rival ? aos4.dados[rival.id]?.csSelva ?? 0 : null;

  const motivos = [rota.join('  ->  ')];
  let gravidade = 1;

  if (campsDele !== null && camps < campsDele - 8) {
    gravidade = 2;
    motivos.push(`Clear inicial atrasado: ${camps} de jungle contra ${campsDele} do ${rival.campeao} no mesmo minuto. O jogo já começou desnivelado sem ninguém ter errado uma briga.`);
  }
  return [achado('pathing-inicial', cedo[0].t, gravidade, 'Rota dos primeiros minutos', motivos)];
}

/**
 * Presença nas rotas que não virou nada. Conta qualquer rota (não só as do
 * lado inimigo): estar numa rota sem converter é camp perdido do mesmo jeito.
 */
function ganksSemRetorno(p, eu) {
  if (eu.role !== 'JUNGLE') return [];
  const tentativas = [];

  for (const f of p.frames) {
    if (f.minuto < 3 || f.minuto > 20) continue;
    const pos = f.pos[eu.id];
    if (!pos || !p.vivo(eu.id, f.t)) continue;

    const onde = zona(pos);
    if (tipoDeZona(pos) !== 'LANE') continue;

    const rendeu = p.eventos.some((e) => e.t >= f.t - 30_000 && e.t <= f.t + 75_000
      && dist(e.pos ?? { x: 0, y: 0 }, pos) < 4500
      && ((e.tipo === 'CHAMPION_KILL' && p.jogador(e.vitimaId)?.time !== eu.time)
        || (e.tipo === 'BUILDING_KILL' && e.timeVitima !== eu.time)));

    tentativas.push({ minuto: Math.round(f.minuto), onde, rendeu, t: f.t });
  }

  const secas = tentativas.filter((x) => !x.rendeu);
  if (secas.length < 3) return [];

  const taxa = ((tentativas.length - secas.length) / tentativas.length) * 100;
  return [achado('gank-sem-retorno', secas[0].t, secas.length >= 6 ? 3 : 2,
    `${secas.length} de ${tentativas.length} passagens por lane não renderam nada`,
    [`Minutos ${secas.map((x) => x.minuto).join(', ')}. Taxa de conversão: ${taxa.toFixed(0)}%.`,
      'Sem preparo — visão, wave controlada, flash do inimigo gasto — o custo do gank é certo e o retorno é sorte. Cada passagem seca é um camp que você não fez.'])];
}

/* ------------------------------------------------------------------ visão */

const SENTINELA_DE_CONTROLE = 2055;

/**
 * Morreu no lado do mapa deles sem ter posto ward nenhuma antes de entrar.
 *
 * Limitação honesta: o evento WARD_PLACED da Riot NÃO traz posição, só quem
 * colocou, quando e de que tipo. Então não dá pra saber se a ward cobria o
 * lugar certo — só se você teve o hábito de colocar alguma antes de entrar.
 */
function entrouSemVisao(p, eu) {
  const temWards = p.eventos.some((e) => e.tipo === 'WARD_PLACED');
  if (!temWards) return []; // dado da LCU não tem esses eventos

  const saida = [];
  for (const e of p.eventos) {
    if (e.tipo !== 'CHAMPION_KILL' || e.vitimaId !== eu.id) continue;
    if (!emCampoInimigo(e.pos, eu.time)) continue;
    if (e.minuto < 4) continue;

    const wardRecente = p.eventos.some((w) => w.tipo === 'WARD_PLACED'
      && w.autorId === eu.id && w.t <= e.t && e.t - w.t <= 75_000);
    if (wardRecente) continue;

    saida.push(achado('sem-visao-antes-de-entrar', e.t, 3,
      `Morreu em ${zonaRelativa(e.pos, eu.time)} sem ter colocado ward nos 75s anteriores`,
      'Entrar no lado deles sem gastar a ward primeiro é apostar que ninguém está lá. Sai barato quando dá certo e custa a morte inteira quando não dá.'));
  }
  return saida;
}

/**
 * Disciplina de visão comparada com quem faz a mesma função no time inimigo.
 * Comparar com o oponente direto evita inventar um número de referência.
 */
function disciplinaDeVisao(p, eu) {
  const wards = p.eventos.filter((e) => e.tipo === 'WARD_PLACED');
  if (!wards.length) return [];

  const rival = p.jogadores.find((j) => j.time !== eu.time && j.role === eu.role);
  if (!rival) return [];

  const minutos = p.duracaoS / 60;
  const minhas = wards.filter((w) => w.autorId === eu.id).length;
  const dele = wards.filter((w) => w.autorId === rival.id).length;

  const compras = p.eventos.filter((e) => e.tipo === 'ITEM_PURCHASED' && e.itemId === SENTINELA_DE_CONTROLE);
  const minhasCtrl = compras.filter((c) => c.autorId === eu.id).length;
  const deleCtrl = compras.filter((c) => c.autorId === rival.id).length;

  const motivos = [];
  if (dele - minhas >= 5) {
    motivos.push(`${minhas} wards em ${minutos.toFixed(0)} minutos (${(minhas / minutos).toFixed(2)}/min). O ${rival.campeao} colocou ${dele}.`);
  }
  if (deleCtrl - minhasCtrl >= 2) {
    motivos.push(`Wards rosas compradas: você ${minhasCtrl}, ele ${deleCtrl}. É o item mais barato que ganha partida — 75 de gold apagam a visão inteira de um objetivo.`);
  }
  if (!motivos.length) return [];

  return [achado('visao-atras', p.duracaoS * 500, 2,
    `Visão atrás do ${rival.campeao}`, motivos)];
}

/* ------------------------------------------------------------- comparação */

/** Comparação direta com o oponente da mesma role. */
export function compararComOponente(p, eu) {
  const rival = p.jogadores.find((j) => j.time !== eu.time && j.role === eu.role);
  if (!rival) return null;

  const linhas = [10, 15, 20, 25, 30]
    .filter((m) => p.frames.some((f) => f.minuto >= m))
    .map((m) => {
      const f = p.frames.find((x) => x.minuto >= m);
      const a = f.dados[eu.id], b = f.dados[rival.id];
      return {
        minuto: m,
        cs: (a.cs + a.csSelva) - (b.cs + b.csSelva),
        ouro: a.ouroTotal - b.ouroTotal,
        xp: a.xp - b.xp,
        nivel: a.nivel - b.nivel,
      };
    });
  return { rival, linhas };
}

const DETECTORES = [
  analisarMortes, primeiroACair, objetivosSemVoce, brigasSemVoce, ouroParado,
  entrouSemVisao, disciplinaDeVisao,
  ritmoDeSelva, tempoParado, invasaoSofrida, pathingInicial, ganksSemRetorno,
];

/** Roda todos os detectores e devolve os achados em ordem de tempo. */
export function analisar(p, eu) {
  return DETECTORES.flatMap((d) => d(p, eu)).sort((a, b) => a.t - b.t);
}
