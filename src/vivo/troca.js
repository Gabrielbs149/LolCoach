/**
 * A conta da troca: quanto dano o outro aguenta, e em quanto tempo você tira.
 *
 * O que dá pra saber COM CERTEZA:
 *  - os seus atributos exatos (a API ao vivo publica os do jogador: dano, velocidade,
 *    crítico, penetração);
 *  - a vida, a armadura e a resistência do inimigo (atributos base do campeão por
 *    nível + o que os itens dele dão — tudo publicado pelo Data Dragon).
 * O que NÃO dá: a vida atual dele (a Riot não publica) nem as proporções das magias.
 * Por isso a conta aqui é sempre "do cheio", só com ataque básico, e a fala diz isso.
 * Estimativa que se apresenta como certeza é pior que não ter conta nenhuma.
 */

const NIVEL_BASE = (v, porNivel, nivel) => v + porNivel * (nivel - 1);

/** Soma o que os itens dão de vida, armadura, resistência, dano e poder. */
export function somaDosItens(itens = [], tabela = new Map()) {
  const s = { hp: 0, armadura: 0, mr: 0, ad: 0, ap: 0, as: 0, crit: 0 };
  for (const i of itens) {
    const a = (tabela.get(i.id ?? i) ?? {}).atributos ?? {};
    s.hp += a.FlatHPPoolMod ?? 0;
    s.armadura += a.FlatArmorMod ?? 0;
    s.mr += a.FlatSpellBlockMod ?? 0;
    s.ad += a.FlatPhysicalDamageMod ?? 0;
    s.ap += a.FlatMagicDamageMod ?? 0;
    s.as += a.PercentAttackSpeedMod ?? 0;
    s.crit += a.FlatCritChanceMod ?? 0;
  }
  return s;
}

/** Ficha de combate de um inimigo: o que ele tem de vida e resistência agora. */
export function fichaDoInimigo(j, bases = new Map(), itensTab = new Map()) {
  const b = bases.get(j.campeao) ?? bases.get(j.championId) ?? null;
  if (!b) return null;
  const nivel = j.nivel ?? 1;
  const it = somaDosItens(j.itens ?? [], itensTab);
  return {
    campeao: j.campeao,
    nivel,
    hp: Math.round(NIVEL_BASE(b.hp, b.hpNv, nivel) + it.hp),
    armadura: Math.round(NIVEL_BASE(b.armadura, b.armaduraNv, nivel) + it.armadura),
    mr: Math.round(NIVEL_BASE(b.mr, b.mrNv, nivel) + it.mr),
  };
}

/** Vida efetiva contra dano físico ou mágico, já descontando a sua penetração. */
export function vidaEfetiva(ficha, { tipo = 'fisico', penFlat = 0, penPct = 1 } = {}) {
  if (!ficha) return null;
  const bruta = tipo === 'magico' ? ficha.mr : ficha.armadura;
  const resistencia = Math.max(0, bruta * (penPct ?? 1) - (penFlat ?? 0));
  return Math.round(ficha.hp * (1 + resistencia / 100));
}

/** Dano por segundo só de ataque básico, com os SEUS números exatos. */
export function danoPorSegundo(atributos = {}) {
  const ad = atributos.ad ?? 0;
  const as = Math.min(2.5, atributos.as ?? 0.65);
  const crit = Math.min(1, atributos.crit ?? 0);
  return Math.round(ad * as * (1 + crit * 0.75));
}

/**
 * Em quem bater: os cinco inimigos em ordem de quanto tempo do SEU dano cada um
 * aguenta. O número absoluto não vale muito (ninguém fica 9 s batendo em alguém),
 * mas a ordem vale tudo — é ela que diz em quem gastar o combo numa briga e em
 * quem não perder tempo. Vida efetiva do alvo é exata; o dano é o seu, exato.
 */
export function ordemDeAlvos({ eu, inimigos = [], bases = new Map(), itensTab = new Map() } = {}) {
  const at = eu?.atributos;
  const dps = danoPorSegundo(at ?? {});
  if (!dps) return [];
  const lista = [];
  for (const j of inimigos) {
    const f = fichaDoInimigo(j, bases, itensTab);
    if (!f) continue;
    const ve = vidaEfetiva(f, { tipo: 'fisico', penFlat: at.penArm, penPct: at.penArmPct });
    lista.push({ campeao: f.campeao, role: j.role ?? null, nivel: f.nivel, vidaEfetiva: ve, segundos: Math.round((10 * ve) / dps) / 10 });
  }
  return lista.sort((a, b) => a.segundos - b.segundos);
}

/**
 * A janela de troca contra um inimigo: quanto tempo de ataque básico você precisa
 * pra tirar a vida cheia dele. `vale` fica falso quando o seu dano não é de ataque
 * básico (aí a conta não diz nada útil) ou quando faltam dados.
 */
export function janelaDeTroca({ eu, inimigo, bases = new Map(), itensTab = new Map() } = {}) {
  const at = eu?.atributos;
  if (!at || !inimigo) return { vale: false };
  // conta de ataque básico só vale pra quem ganha o jogo batendo
  const baseadoEmAtaque = (at.ad ?? 0) >= 2 * (at.ap ?? 0) && (at.ad ?? 0) >= 80;
  const ficha = fichaDoInimigo(inimigo, bases, itensTab);
  if (!ficha) return { vale: false };
  const ve = vidaEfetiva(ficha, { tipo: 'fisico', penFlat: at.penArm, penPct: at.penArmPct });
  const dps = danoPorSegundo(at);
  if (!dps || !ve) return { vale: false };
  const segundos = Math.round((10 * ve) / dps) / 10;
  return { vale: baseadoEmAtaque, campeao: ficha.campeao, vidaEfetiva: ve, dps, segundos, nivel: ficha.nivel };
}
