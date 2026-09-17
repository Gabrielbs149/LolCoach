/**
 * Estatísticas de perfil, no espírito da página de "estilo de jogo" do op.gg.
 *
 * Tudo sai do banco local — nenhuma destas contas depende de estar online.
 * As fórmulas foram conferidas contra o op.gg na conta do Gabriel e batem:
 * AMA 2.02, participação em abates 49%, GPM 440, CSM 6.1, fatia de dano 23%.
 *
 * Regra da casa: partida com menos de 5 minutos é remake e não conta em lugar
 * nenhum. É o mesmo corte usado no resto do app.
 */

const CORTE = 'p.duracaoS >= 300';

/** Junta partidas com a linha do próprio Gabriel naquela partida. */
const BASE = `
  FROM partidas p
  JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
  WHERE ${CORTE}`;

const taxa = (v, n) => (n ? v / n : 0);
const porMin = (total, segundos) => (segundos ? total / (segundos / 60) : 0);

/** Filtro de período, fila e conta. `desde` é ISO; null = tudo que existe. */
function recorte(desde, fila, conta) {
  const cond = [];
  if (desde) cond.push(`p.quando >= '${desde}'`);
  if (fila) cond.push(`p.fila = ${Number(fila)}`);
  // Ele joga em mais de uma conta e quer todas no banco. A conta de uma
  // partida é o nome do jogador que é o "eu" dela (jogadores.nome do meuId),
  // então o filtro exige o alias `meu` — todas as consultas deste arquivo têm.
  if (conta) cond.push(`meu.nome = '${String(conta).replace(/'/g, "''")}'`);
  return cond.length ? ` AND ${cond.join(' AND ')}` : '';
}

/** As contas que existem no banco, com quantas partidas cada. */
export function contas(db) {
  return db.prepare(`
    SELECT meu.nome nome, COUNT(*) jogos, MAX(p.quando) ultima
    ${BASE} GROUP BY meu.nome ORDER BY jogos DESC`).all();
}

/* ------------------------------------------------------------------ geral */

export function resumoGeral(db, { desde = null, fila = null, conta = null } = {}) {
  const r = db.prepare(`
    SELECT COUNT(*) jogos, SUM(p.venci) vitorias, SUM(p.duracaoS) segundos,
           SUM(meu.kills) k, SUM(meu.deaths) d, SUM(meu.assists) a,
           SUM(meu.cs) cs, SUM(meu.dano) dano, SUM(meu.ouro) ouro, SUM(meu.visao) visao,
           COUNT(DISTINCT p.meuCampeao) campeoes,
           MIN(p.quando) de, MAX(p.quando) ate
    ${BASE}${recorte(desde, fila, conta)}`).get();

  if (!r?.jogos) return null;
  return {
    jogos: r.jogos,
    vitorias: r.vitorias,
    derrotas: r.jogos - r.vitorias,
    taxa: taxa(r.vitorias, r.jogos),
    segundos: r.segundos,
    duracaoMedia: r.segundos / r.jogos,
    kda: r.d ? (r.k + r.a) / r.d : r.k + r.a,
    media: { k: r.k / r.jogos, d: r.d / r.jogos, a: r.a / r.jogos },
    campeoes: r.campeoes,
    csm: porMin(r.cs, r.segundos),
    dpm: porMin(r.dano, r.segundos),
    gpm: porMin(r.ouro, r.segundos),
    vspm: porMin(r.visao, r.segundos),
    de: r.de, ate: r.ate,
  };
}

/**
 * Participação em abates e fatia de dano.
 *
 * Ambas são médias das razões por partida, não a razão dos totais — uma
 * partida de 50 minutos não pode pesar mais que uma de 20 na sua média.
 */
export function participacao(db, { desde = null, fila = null, conta = null } = {}) {
  const r = db.prepare(`
    SELECT AVG((meu.kills + meu.assists) * 1.0 / NULLIF(tk.total, 0)) abates,
           AVG(meu.dano * 1.0 / NULLIF(td.total, 0)) dano,
           AVG(meu.ouro * 1.0 / NULLIF(tg.total, 0)) ouro
    FROM partidas p
    JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
    JOIN (SELECT gameId, time, SUM(kills) total FROM jogadores GROUP BY gameId, time) tk
      ON tk.gameId = p.gameId AND tk.time = meu.time
    JOIN (SELECT gameId, time, SUM(dano) total FROM jogadores GROUP BY gameId, time) td
      ON td.gameId = p.gameId AND td.time = meu.time
    JOIN (SELECT gameId, time, SUM(ouro) total FROM jogadores GROUP BY gameId, time) tg
      ON tg.gameId = p.gameId AND tg.time = meu.time
    WHERE ${CORTE}${recorte(desde, fila, conta)}`).get();

  return { abates: r?.abates ?? 0, dano: r?.dano ?? 0, ouro: r?.ouro ?? 0 };
}

/* ------------------------------------------------- recorte vs. o histórico */

/**
 * As últimas N partidas contra todo o resto.
 *
 * É o quadro mais útil da tela: diz se você está melhor ou pior do que
 * costuma ser, que é diferente de dizer se você é bom.
 */
export function formaRecente(db, { n = 20, conta = null } = {}) {
  const ids = db.prepare(`
    SELECT p.gameId ${BASE}${recorte(null, null, conta)} ORDER BY p.quando DESC LIMIT ?`).all(n).map((x) => x.gameId);
  if (!ids.length) return null;

  const lista = ids.join(',');
  const recente = db.prepare(`
    SELECT COUNT(*) jogos, SUM(p.venci) vitorias, SUM(p.duracaoS) segundos,
           SUM(meu.kills) k, SUM(meu.deaths) d, SUM(meu.assists) a
    ${BASE} AND p.gameId IN (${lista})`).get();

  const resto = db.prepare(`
    SELECT COUNT(*) jogos, SUM(p.venci) vitorias, SUM(p.duracaoS) segundos,
           SUM(meu.kills) k, SUM(meu.deaths) d, SUM(meu.assists) a
    ${BASE}${recorte(null, null, conta)} AND p.gameId NOT IN (${lista})`).get();

  const monta = (r) => (r?.jogos ? {
    jogos: r.jogos,
    taxa: taxa(r.vitorias, r.jogos),
    kda: r.d ? (r.k + r.a) / r.d : r.k + r.a,
    duracaoMedia: r.segundos / r.jogos,
  } : null);

  const pRec = participacaoDe(db, lista, false, conta);
  const pResto = participacaoDe(db, lista, true, conta);
  const A = monta(recente), B = monta(resto);
  if (A) A.participacao = pRec;
  if (B) B.participacao = pResto;
  return { recente: A, resto: B };
}

function participacaoDe(db, lista, inverter = false, conta = null) {
  const r = db.prepare(`
    SELECT AVG((meu.kills + meu.assists) * 1.0 / NULLIF(tk.total, 0)) abates
    FROM partidas p
    JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
    JOIN (SELECT gameId, time, SUM(kills) total FROM jogadores GROUP BY gameId, time) tk
      ON tk.gameId = p.gameId AND tk.time = meu.time
    WHERE ${CORTE}${recorte(null, null, conta)} AND p.gameId ${inverter ? 'NOT IN' : 'IN'} (${lista})`).get();
  return r?.abates ?? 0;
}

/* ------------------------------------------------------------------ roles */

export function porRole(db, { desde = null, conta = null } = {}) {
  return db.prepare(`
    SELECT p.minhaRole role, COUNT(*) jogos, SUM(p.venci) vitorias,
           SUM(meu.kills) k, SUM(meu.deaths) d, SUM(meu.assists) a,
           SUM(p.duracaoS) segundos,
           COUNT(DISTINCT p.meuCampeao) campeoes
    ${BASE}${recorte(desde, null, conta)}
    GROUP BY p.minhaRole ORDER BY jogos DESC`).all().map((r) => ({
    role: r.role,
    jogos: r.jogos,
    vitorias: r.vitorias,
    taxa: taxa(r.vitorias, r.jogos),
    kda: r.d ? (r.k + r.a) / r.d : r.k + r.a,
    campeoes: r.campeoes,
    csm: porMin(0, r.segundos),
  }));
}

/** Campeões mais jogados, com o que interessa pra decidir se vale insistir. */
export function porCampeao(db, { desde = null, limite = 20, minimo = 1, conta = null } = {}) {
  return db.prepare(`
    SELECT p.meuCampeao campeao, meu.championId,
           COUNT(*) jogos, SUM(p.venci) vitorias,
           SUM(meu.kills) k, SUM(meu.deaths) d, SUM(meu.assists) a,
           SUM(meu.cs) cs, SUM(meu.dano) dano, SUM(p.duracaoS) segundos,
           MAX(p.quando) ultimo
    ${BASE}${recorte(desde, null, conta)}
    GROUP BY p.meuCampeao HAVING jogos >= ?
    ORDER BY jogos DESC LIMIT ?`).all(minimo, limite).map((r) => ({
    campeao: r.campeao,
    championId: r.championId,
    jogos: r.jogos,
    vitorias: r.vitorias,
    taxa: taxa(r.vitorias, r.jogos),
    kda: r.d ? (r.k + r.a) / r.d : r.k + r.a,
    media: { k: r.k / r.jogos, d: r.d / r.jogos, a: r.a / r.jogos },
    csm: porMin(r.cs, r.segundos),
    dpm: porMin(r.dano, r.segundos),
    ultimo: r.ultimo,
  }));
}

/* -------------------------------------------------------------- atividade */

/**
 * Quando ele joga e quando ele ganha.
 *
 * `quando` está em UTC no banco; o dia da semana e a hora só fazem sentido no
 * relógio dele, então a conversão é feita aqui em JavaScript em vez de no SQL.
 */
export function atividade(db, { desde = null, conta = null } = {}) {
  const linhas = db.prepare(`SELECT p.quando, p.venci ${BASE}${recorte(desde, null, conta)}`).all();

  const dias = Array.from({ length: 7 }, () => ({ jogos: 0, vitorias: 0 }));
  const horas = Array.from({ length: 24 }, () => ({ jogos: 0, vitorias: 0 }));

  for (const l of linhas) {
    const d = new Date(l.quando);
    if (Number.isNaN(d.getTime())) continue;
    dias[d.getDay()].jogos++; dias[d.getDay()].vitorias += l.venci;
    horas[d.getHours()].jogos++; horas[d.getHours()].vitorias += l.venci;
  }

  const NOMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  return {
    dias: dias.map((x, i) => ({ rotulo: NOMES[i], ...x, taxa: taxa(x.vitorias, x.jogos) })),
    horas: horas.map((x, i) => ({ rotulo: String(i).padStart(2, '0') + 'h', ...x, taxa: taxa(x.vitorias, x.jogos) })),
  };
}

/* ---------------------------------------------------------- tendências */

/**
 * O que mudou nos últimos 7 dias contra as 4 semanas anteriores: winrate, mortes por jogo,
 * CS aos 10, e EM QUE MINUTO você morre (0–10, 10–20, 20–30, 30+) — a curva de mortes vem
 * dos eventos gravados (ChampionKill com você de vítima). Só fala do que tem amostra (≥ 5 jogos agora).
 */
export function tendencias(db, { conta = null } = {}) {
  const agora = Date.now(), semana = new Date(agora - 7 * 86400_000).toISOString(), mes = new Date(agora - 35 * 86400_000).toISOString();
  const jogos = (desde, ate) => db.prepare(`SELECT p.gameId, p.venci, p.duracaoS, meu.deaths, meu.kills, meu.assists, meu.visao, meu.time, meu.participantId, meu.cs ${BASE}${recorte(desde, null, conta)} AND p.quando < '${ate}'`).all();
  const atual = jogos(semana, new Date(agora + 86400_000).toISOString()), antes = jogos(mes, semana);
  if (atual.length < 5) return { jogosAgora: atual.length, jogosAntes: antes.length, itens: [] };
  const cs10 = (lista) => { const v = []; for (const j of lista) { const f = db.prepare('SELECT cs FROM frames WHERE gameId = ? AND participantId = ? AND minuto = 10').get(j.gameId, j.participantId); if (f) v.push(f.cs); } return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const mortesPorFaixa = (lista) => {
    const faixas = [0, 0, 0, 0]; let n = 0;
    for (const j of lista) { for (const e of db.prepare("SELECT t FROM eventos WHERE gameId = ? AND tipo = 'CHAMPION_KILL' AND vitimaId = ?").all(j.gameId, j.participantId)) { { const seg = e.t > 7200 ? e.t / 1000 : e.t; faixas[Math.min(3, Math.floor(seg / 600))]++; n++; } } }
    return { faixas, n };
  };
  const media = (l, f) => (l.length ? l.reduce((a, j) => a + f(j), 0) / l.length : null);
  const itens = [];
  const wrA = media(atual, (j) => j.venci), wrB = media(antes, (j) => j.venci);
  if (wrB != null && antes.length >= 5) itens.push({ chave: 'winrate', rotulo: 'Taxa de vitória', agora: Math.round(wrA * 100) + '%', antes: Math.round(wrB * 100) + '%', delta: Math.round((wrA - wrB) * 100), bom: wrA >= wrB, unidade: 'pp' });
  const mA = media(atual, (j) => j.deaths), mB = media(antes, (j) => j.deaths);
  if (mB != null && antes.length >= 5) itens.push({ chave: 'mortes', rotulo: 'Mortes por jogo', agora: mA.toFixed(1), antes: mB.toFixed(1), delta: Math.round((mA - mB) * 10) / 10, bom: mA <= mB });
  const cA = cs10(atual), cB = cs10(antes);
  if (cA != null && cB != null) itens.push({ chave: 'cs10', rotulo: 'CS aos 10 min', agora: Math.round(cA), antes: Math.round(cB), delta: Math.round(cA - cB), bom: cA >= cB });
  // visão por minuto e participação em abates (kills+assists / abates do time)
  const vpm = (l) => media(l.filter((j) => j.duracaoS > 0), (j) => (j.visao ?? 0) / (j.duracaoS / 60));
  const vA = vpm(atual), vB = vpm(antes);
  if (vA != null && vB != null && antes.length >= 5) itens.push({ chave: 'visao', rotulo: 'Visão por minuto', agora: vA.toFixed(2), antes: vB.toFixed(2), delta: Math.round((vA - vB) * 100) / 100, bom: vA >= vB, dica: vA < 0.8 ? 'menos de 0,8/min: uma ward a cada volta na base' : null });
  const part = (l) => { const v = []; for (const j of l) { const t = db.prepare('SELECT SUM(kills) k FROM jogadores WHERE gameId = ? AND time = ?').get(j.gameId, j.time); if (t?.k > 0) v.push(((j.kills ?? 0) + (j.assists ?? 0)) / t.k); } return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const pA = part(atual), pB = part(antes);
  if (pA != null && pB != null && antes.length >= 5) itens.push({ chave: 'participacao', rotulo: 'Participação em abates', agora: Math.round(pA * 100) + '%', antes: Math.round(pB * 100) + '%', delta: Math.round((pA - pB) * 100), bom: pA >= pB, unidade: 'pp', dica: pA < 0.45 ? 'abaixo de 45%: você está longe das lutas que decidem' : null });
  const fA = mortesPorFaixa(atual), fB = mortesPorFaixa(antes);
  const NOMES = ['0–10', '10–20', '20–30', '30+'];
  if (fA.n >= 10 && fB.n >= 10) {
    const pa = fA.faixas.map((x) => x / fA.n), pb = fB.faixas.map((x) => x / fB.n);
    let pior = 0; for (let i = 1; i < 4; i++) if (pa[i] - pb[i] > pa[pior] - pb[pior]) pior = i;
    if (pa[pior] - pb[pior] >= 0.08) itens.push({ chave: 'faixa', rotulo: `Mortes entre ${NOMES[pior]} min`, agora: Math.round(pa[pior] * 100) + '%', antes: Math.round(pb[pior] * 100) + '%', delta: Math.round((pa[pior] - pb[pior]) * 100), bom: false, unidade: 'pp', dica: pior === 0 ? 'morrendo cedo: respeita o level 2–3 e o primeiro gank' : pior === 1 ? 'morrendo no meio do jogo: rotação depois do primeiro item, não força' : 'morrendo tarde: uma morte aos 30 min decide o jogo; anda com o time' });
  }
  return { jogosAgora: atual.length, jogosAntes: antes.length, itens, curvaMortes: fA.n ? fA.faixas.map((x, i) => ({ rotulo: NOMES[i], fatia: x / fA.n })) : null };
}

/* ----------------------------------------------------------- classes */

/**
 * Distribuição por classe de campeão (mago, atirador, lutador…).
 * `tags` vem do Data Dragon: Map(nomeDoCampeao -> ['Mage','Assassin']).
 */
const CLASSE_PT = {
  Mage: 'Mago', Marksman: 'Atirador', Fighter: 'Lutador',
  Tank: 'Tanque', Assassin: 'Assassino', Support: 'Suporte',
};

export function porClasse(db, tags, { desde = null, conta = null } = {}) {
  const linhas = db.prepare(`
    SELECT p.meuCampeao campeao, COUNT(*) jogos, SUM(p.venci) vitorias
    ${BASE}${recorte(desde, null, conta)} GROUP BY p.meuCampeao`).all();

  const contas = new Map();
  let total = 0;
  for (const l of linhas) {
    // Só a classe principal: contar as duas de um campeão híbrido faria a soma
    // passar de 100% e a barra deixaria de significar "fatia dos seus jogos".
    const tag = tags?.get(l.campeao)?.[0];
    if (!tag) continue;
    const nome = CLASSE_PT[tag] ?? tag;
    const c = contas.get(nome) ?? { classe: nome, jogos: 0, vitorias: 0 };
    c.jogos += l.jogos; c.vitorias += l.vitorias;
    contas.set(nome, c);
    total += l.jogos;
  }

  return [...contas.values()]
    .map((c) => ({ ...c, fatia: taxa(c.jogos, total), taxa: taxa(c.vitorias, c.jogos) }))
    .sort((a, b) => b.jogos - a.jogos);
}

/* -------------------------------------------------------------- confrontos */

/**
 * Quem realmente ganha dele, por role — a base das sugestões de ban.
 *
 * `custo` é o número de vitórias que aquele confronto custou: quantas partidas
 * ele jogou contra o campeão, vezes o quanto a taxa ficou abaixo de 50%.
 * Ordenar por isso evita o erro de banir um campeão com 0% em 3 jogos e ignorar
 * um com 33% em 18 — o segundo doeu mais.
 */
export function piores(db, { minimo = 5, desde = null, conta = null } = {}) {
  const linhas = db.prepare(`
    SELECT p.minhaRole role, r.campeao rival, r.championId,
           COUNT(*) jogos, SUM(p.venci) vitorias
    FROM partidas p
    JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
    JOIN jogadores r ON r.gameId = p.gameId AND r.time <> meu.time AND r.role = p.minhaRole
    WHERE ${CORTE}${recorte(desde, null, conta)}
    GROUP BY p.minhaRole, r.campeao HAVING jogos >= ?`).all(minimo);

  const porRoleMapa = {};
  for (const l of linhas) {
    const t = taxa(l.vitorias, l.jogos);
    (porRoleMapa[l.role] ??= []).push({
      campeao: l.rival, championId: l.championId,
      jogos: l.jogos, vitorias: l.vitorias, taxa: t,
      custo: l.jogos * (0.5 - t),
    });
  }
  for (const lista of Object.values(porRoleMapa)) lista.sort((a, b) => b.custo - a.custo);
  return porRoleMapa;
}

/** O contrário: com quem ele ganha, pra sugerir pick. */
export function melhoresCampeoes(db, { minimo = 6, desde = null, conta = null } = {}) {
  const linhas = db.prepare(`
    SELECT p.minhaRole role, p.meuCampeao campeao, meu.championId,
           COUNT(*) jogos, SUM(p.venci) vitorias,
           SUM(meu.kills) k, SUM(meu.deaths) d, SUM(meu.assists) a
    ${BASE}${recorte(desde, null, conta)}
    GROUP BY p.minhaRole, p.meuCampeao HAVING jogos >= ?`).all(minimo);

  const porRoleMapa = {};
  for (const l of linhas) {
    (porRoleMapa[l.role] ??= []).push({
      campeao: l.campeao, championId: l.championId,
      jogos: l.jogos, vitorias: l.vitorias, taxa: taxa(l.vitorias, l.jogos),
      kda: l.d ? (l.k + l.a) / l.d : l.k + l.a,
      // Mesma ideia do custo, ao contrário: vitórias acima da média que este
      // campeão te deu. Premia quem você joga muito E ganha.
      ganho: l.jogos * (taxa(l.vitorias, l.jogos) - 0.5),
    });
  }
  for (const lista of Object.values(porRoleMapa)) lista.sort((a, b) => b.ganho - a.ganho);
  return porRoleMapa;
}

/* ------------------------------------------------------------------ radar */

/**
 * As sete medidas do radar, cada uma normalizada de 0 a 1 contra uma
 * referência de Esmeralda/Diamante. Os limites são grosseiros de propósito:
 * servem pra dar forma ao polígono, e o número cru vai junto sempre.
 */
const TETOS = { kda: 4, participacao: 0.7, dano: 0.35, dpm: 1200, csm: 9, gpm: 550, vspm: 1.6 };

export function radar(db, opcoes = {}) {
  const g = resumoGeral(db, opcoes);
  if (!g) return null;
  const p = participacao(db, opcoes);

  // `curto` é o que vai desenhado em volta do polígono — nome comprido estoura
  // a caixa do SVG. O nome inteiro fica na legenda logo abaixo.
  const eixos = [
    { chave: 'kda', curto: 'AMA', rotulo: 'AMA (KDA)', valor: g.kda, texto: g.kda.toFixed(2) },
    { chave: 'participacao', curto: 'PART', rotulo: 'Participação em abates', valor: p.abates, texto: Math.round(p.abates * 100) + '%' },
    { chave: 'dano', curto: 'DANO', rotulo: 'Fatia do dano do time', valor: p.dano, texto: Math.round(p.dano * 100) + '%' },
    { chave: 'dpm', curto: 'DPM', rotulo: 'Dano por minuto', valor: g.dpm, texto: Math.round(g.dpm) },
    { chave: 'csm', curto: 'CSM', rotulo: 'Farm por minuto', valor: g.csm, texto: g.csm.toFixed(1) },
    { chave: 'gpm', curto: 'GPM', rotulo: 'Gold por minuto', valor: g.gpm, texto: Math.round(g.gpm) },
    { chave: 'vspm', curto: 'VSPM', rotulo: 'Visão por minuto', valor: g.vspm, texto: g.vspm.toFixed(2) },
  ];

  return eixos.map((e) => ({ ...e, fracao: Math.max(0.04, Math.min(1, e.valor / TETOS[e.chave])) }));
}
