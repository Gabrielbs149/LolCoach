import { fichaDoCampeao, recargaNoNivel } from '../dados/ddragon.js';
import { confrontoContra } from '../dados/confrontos.js';
import { zonaRelativa } from './mapa.js';
import { distancia } from './linguagem.js';

/**
 * Escreve o "o que fazer" de cada apontamento usando o que realmente aconteceu.
 *
 * A primeira versão era um texto fixo por tipo de erro — a mesma frase em toda
 * morte, sem olhar quem matou, com que magia ou qual o confronto. Aqui cada
 * resolução é montada com: as magias que causaram o dano, o nível delas naquele
 * minuto (e portanto a recarga real), a ficha oficial do campeão inimigo, as
 * dicas da Riot de como jogar contra ele, e a taxa de vitória do confronto no
 * seu elo segundo o op.gg.
 */

const TECLAS = ['Q', 'W', 'E', 'R'];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Primeira frase da descrição — o tooltip inteiro é longo demais pra conselho. */
function resumoDaMagia(texto) {
  const frase = String(texto ?? '').split(/(?<=\.)\s/)[0] ?? '';
  return frase.length > 160 ? `${frase.slice(0, 157)}…` : frase;
}

/** Nível de cada magia do jogador naquele instante, pelos eventos de evolução. */
function niveisDeMagia(p, jogadorId, t) {
  const n = { Q: 0, W: 0, E: 0, R: 0 };
  for (const e of p.eventos) {
    if (e.tipo !== 'SKILL_LEVEL_UP' || e.autorId !== jogadorId || e.t > t) continue;
    const tecla = TECLAS[(e.skillSlot ?? 0) - 1];
    if (tecla) n[tecla]++;
  }
  return n;
}

/** Quem causou dano nesta morte, com as teclas usadas e o total de cada um. */
function autoresDaMorte(p, eu, morte) {
  const porJogador = new Map();
  for (const d of morte.danoRecebido ?? []) {
    const j = p.jogador(d.participantId);
    if (!j || j.time === eu.time) continue;
    if (!porJogador.has(j)) porJogador.set(j, { total: 0, teclas: new Map(), autos: 0 });
    const reg = porJogador.get(j);
    const dano = (d.physicalDamage ?? 0) + (d.magicDamage ?? 0) + (d.trueDamage ?? 0);
    reg.total += dano;
    if (d.basic || /basicattack/i.test(d.spellName ?? '')) reg.autos += dano;
    else {
      const tecla = TECLAS[d.spellSlot] ?? null;
      if (tecla) reg.teclas.set(tecla, (reg.teclas.get(tecla) ?? 0) + dano);
    }
  }
  return [...porJogador.entries()].sort((a, b) => b[1].total - a[1].total);
}

/* ------------------------------------------------------------------ morte */

async function resolucaoDeMorte(p, eu, achado, opcoes) {
  const morte = p.eventos.find((e) => e.tipo === 'CHAMPION_KILL' && e.vitimaId === eu.id && e.t === achado.t);
  if (!morte) return null;

  const autores = autoresDaMorte(p, eu, morte);
  if (!autores.length) return null;

  const [algoz, reg] = autores[0];
  const ficha = await fichaDoCampeao(algoz.championId);
  const linhas = [];

  /* --- o confronto, com número --- */
  const confronto = await confrontoContra(eu.campeao, eu.role, algoz.championId, opcoes).catch(() => null);
  if (confronto) {
    const taxa = Math.round(confronto.taxa * 100);
    linhas.push(taxa < 47
      ? `${eu.campeao} contra ${algoz.campeao} é confronto ruim: **${taxa}% de vitória** em ${confronto.jogos.toLocaleString('pt-BR')} partidas no op.gg. Jogue pra empatar, não pra ganhar a lane.`
      : `${eu.campeao} contra ${algoz.campeao}: ${taxa}% de vitória em ${confronto.jogos.toLocaleString('pt-BR')} partidas no op.gg.`);
  }

  /**
   * A magia que mais doeu — mas SEM despejar a descrição dela.
   *
   * As ferramentas do ramo (u.gg, op.gg, mobalytics) não mostram tooltip de
   * habilidade em lugar nenhum: mostram a recarga, que é o número em cima do
   * qual dá pra tomar decisão. "O R tem 120s" diz o que fazer; "Darius salta
   * na direção de um campeão inimigo" não diz nada que você já não saiba.
   */
  const maior = [...reg.teclas.entries()].sort((a, b) => b[1] - a[1])[0];
  if (maior && ficha) {
    const [tecla, dano] = maior;
    const magia = ficha.magias.find((m) => m.tecla === tecla);
    if (magia) {
      const nivel = niveisDeMagia(p, algoz.id, achado.t)[tecla] || 1;
      const cd = recargaNoNivel(magia, nivel);
      linhas.push(cd >= 40
        ? `${Math.round(dano)} do dano veio do ${tecla} (${magia.nome}), que tem ${cd}s de recarga no nível ${nivel} — depois que ele usa, você tem quase ${Math.round(cd / 60)} min de janela.`
        : `${Math.round(dano)} do dano veio do ${tecla} (${magia.nome}): ${cd}s de recarga no nível ${nivel}.`);
    }
  } else if (reg.autos > reg.total * 0.5) {
    linhas.push(`${Math.round(reg.autos)} do dano foi ataque básico — ele te venceu trocando auto, não com magia.`);
  }

  /* --- a dica tática oficial da Riot, que é conselho de verdade --- */
  const dicas = ficha?.contraEle ?? [];
  if (dicas.length) {
    const dica = dicas[Math.floor(achado.t / 60000) % dicas.length];
    linhas.push(`Contra ${algoz.campeao}: ${dica}`);
  }

  return linhas.length ? linhas : null;
}

/* ------------------------------------------------------- outros apontamentos */

async function resolucaoGenerica(p, eu, achado) {
  const linhas = [];

  switch (achado.tipo) {
    case 'primeiro-a-cair': {
      const briga = p.eventos.filter((e) => e.tipo === 'CHAMPION_KILL'
        && Math.abs(e.t - achado.t) <= 25_000);
      const primeiro = briga.find((e) => e.vitimaId === eu.id);
      const algoz = primeiro && p.jogador(primeiro.autorId);
      if (algoz) {
        const ficha = await fichaDoCampeao(algoz.championId);
        linhas.push(`Quem te pegou primeiro foi ${algoz.campeao}${ficha?.tags?.length ? ` (${ficha.tags.join('/')})` : ''}.`);
        if (ficha?.contraEle?.[0]) linhas.push(`Dica da Riot: "${ficha.contraEle[0]}"`);
      }
      linhas.push('Numa briga, quem cai primeiro decide o resultado. Espere alguém do seu time levar o primeiro golpe antes de você entrar.');
      break;
    }

    case 'objetivo-sem-voce': {
      const ev = p.eventos.find((e) => e.tipo === 'ELITE_MONSTER_KILL' && e.t === achado.t);
      if (ev) {
        const minhaPos = p.frameEm(achado.t).pos[eu.id];
        linhas.push(`Você estava em ${zonaRelativa(minhaPos, eu.time)} quando caiu, ${distancia(Math.hypot(minhaPos.x - ev.pos.x, minhaPos.y - ev.pos.y))} do pit.`);
      }
      linhas.push('Objetivo tem horário. Trinta segundos antes, largue a wave e comece a andar — chegar depois da briga é o mesmo que não ir.');
      break;
    }

    case 'sem-visao-antes-de-entrar': {
      const ultima = [...p.eventos].filter((e) => e.tipo === 'WARD_PLACED' && e.autorId === eu.id && e.t < achado.t).at(-1);
      linhas.push(ultima
        ? `Sua última ward tinha sido ${Math.round((achado.t - ultima.t) / 1000)}s antes.`
        : 'Você não tinha colocado nenhuma ward até esse momento da partida.');
      linhas.push('Ward antes de cruzar o river, sempre. É o gasto mais barato do jogo.');
      break;
    }

    case 'ritmo-de-selva': {
      const rival = p.jogadores.find((j) => j.time !== eu.time && j.role === 'JUNGLE');
      if (rival) {
        const ficha = await fichaDoCampeao(rival.championId);
        if (ficha?.comEle?.[0]) linhas.push(`Como o ${rival.campeao} joga, pela própria Riot: "${ficha.comEle[0]}"`);
      }
      linhas.push('Termine o clear antes de sair pra gank duvidoso: camp é gold garantido, gank não é.');
      break;
    }

    case 'briga-sem-voce':
      linhas.push('Quando três aliados se juntam no mapa: ou você vai junto, ou pega algo que valha mais que a briga. Ficar no meio-termo é o pior dos dois.');
      break;

    case 'ouro-parado':
      linhas.push('Recall assim que tiver o valor de um item, mesmo com a wave boa. Gold parado não faz dano.');
      break;

    case 'visao-atras':
      linhas.push('Ward rosa custa 75 de gold e apaga a visão inteira de um objetivo. Compre uma todo recall.');
      break;

    case 'gank-sem-retorno':
      linhas.push('Só vá pra lane se ela tiver prio ou o inimigo estiver sem flash. Sem isso o gank é aposta.');
      break;

    default:
      return null;
  }

  return linhas.length ? linhas : null;
}

/**
 * Preenche a resolução de cada apontamento. É assíncrono porque busca a ficha
 * oficial do campeão e a tabela de confrontos — as duas ficam em cache no disco,
 * então só a primeira partida analisada paga o custo.
 */
export async function preencherResolucoes(p, eu, achados, opcoes = {}) {
  // Confronto e passiva do inimigo são os mesmos a partida inteira. Repetir em
  // toda morte era exatamente a sensação de "ele só fala isso": a linha aparece
  // uma vez, na primeira morte em que vale, e some depois.
  const jaDito = new Set();

  for (const a of achados) {
    try {
      const linhas = a.tipo === 'morte'
        ? await resolucaoDeMorte(p, eu, a, opcoes)
        : await resolucaoGenerica(p, eu, a);

      const novas = (linhas ?? []).filter((l) => {
        if (jaDito.has(l)) return false;
        jaDito.add(l);
        return true;
      });
      a.resolucao = novas.length ? novas : null;
    } catch {
      a.resolucao = null; // sem internet e sem cache: o resto do relatório continua
    }
  }
  return achados;
}

/**
 * Ficha do confronto de lane, pra abrir o relatório: quem é o oponente, como o
 * confronto costuma terminar, e as magias dele que decidem a troca.
 */
export async function fichaDoConfronto(p, eu, opcoes = {}) {
  const rival = p.jogadores.find((j) => j.time !== eu.time && j.role === eu.role);
  if (!rival) return null;

  const [ficha, confronto] = await Promise.all([
    fichaDoCampeao(rival.championId).catch(() => null),
    confrontoContra(eu.campeao, eu.role, rival.championId, opcoes).catch(() => null),
  ]);
  if (!ficha && !confronto) return null;

  // O nível máximo que cada magia chegou na partida diz qual recarga citar.
  const niveisFinais = niveisDeMagia(p, rival.id, Infinity);

  // Só as magias que realmente te machucaram na partida, e só o número que
  // serve pra decidir (recarga e alcance). Listar as quatro com descrição era
  // enfeite: nenhuma ferramenta do ramo faz isso.
  const danoPorTecla = new Map();
  for (const e of p.eventos) {
    if (e.tipo !== 'CHAMPION_KILL' || e.vitimaId !== eu.id) continue;
    for (const d of e.danoRecebido ?? []) {
      if (d.participantId !== rival.id) continue;
      const tecla = TECLAS[d.spellSlot];
      if (!tecla || d.basic) continue;
      const dano = (d.physicalDamage ?? 0) + (d.magicDamage ?? 0) + (d.trueDamage ?? 0);
      danoPorTecla.set(tecla, (danoPorTecla.get(tecla) ?? 0) + dano);
    }
  }

  const magias = (ficha?.magias ?? [])
    .filter((m) => danoPorTecla.has(m.tecla))
    .map((m) => ({
      tecla: m.tecla,
      nome: m.nome,
      dano: Math.round(danoPorTecla.get(m.tecla)),
      nivel: niveisFinais[m.tecla] || 0,
      recarga: recargaNoNivel(m, niveisFinais[m.tecla] || 1),
      alcance: m.alcance,
    }))
    .sort((a, b) => b.dano - a.dano);

  return {
    rival: { campeao: rival.campeao, championId: rival.championId, nome: rival.nome },
    taxa: confronto ? Math.round(confronto.taxa * 100) : null,
    jogos: confronto?.jogos ?? null,
    tags: ficha?.tags ?? [],
    magias,
    // As dicas oficiais da Riot variam de uma linha a um parágrafo inteiro.
    // Parágrafo ninguém lê no meio de uma análise — ficam as curtas, no máximo
    // duas, e o resto do espaço fica pro que aconteceu na sua partida.
    dicas: (ficha?.contraEle ?? []).filter((t) => t.length <= 180).slice(0, 2),
  };
}
