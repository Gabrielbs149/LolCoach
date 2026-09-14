/**
 * Seu retrato, tirado das partidas já coletadas.
 *
 * É o que permite o conselho ao vivo ser SEU e não genérico: em vez de "cuidado
 * com o dragão", ele consegue dizer "sua faixa de morte mais comum começa agora"
 * porque sabe o que aconteceu nas suas 788 partidas.
 */

const FAIXAS = [
  { chave: '0-10', de: 0, ate: 600 },
  { chave: '10-20', de: 600, ate: 1200 },
  { chave: '20-30', de: 1200, ate: 1800 },
  { chave: '30+', de: 1800, ate: Infinity },
];

export function montarPerfil(db, { role = null, campeao = null } = {}) {
  const onde = ['duracaoS >= 300'];
  if (role) onde.push(`minhaRole = '${String(role).replace(/'/g, '')}'`);
  const base = onde.join(' AND ');

  const geral = db.prepare(`
    SELECT COUNT(*) n, SUM(venci) v FROM partidas WHERE ${base}`).get();

  if (!geral?.n) return null;

  const mortes = (venci) => db.prepare(`
    SELECT COUNT(*) m, COUNT(DISTINCT a.gameId) jogos FROM achados a
    WHERE a.tipo = 'morte' AND a.gameId IN (
      SELECT gameId FROM partidas WHERE ${base}${venci === null ? '' : ` AND venci = ${venci}`})`).get();

  const todas = mortes(null), emV = mortes(1), emD = mortes(0);

  // Faixa de tempo em que ele mais morre — vira aviso quando o relógio chega lá.
  const porFaixa = FAIXAS.map((f) => {
    const r = db.prepare(`
      SELECT COUNT(*) n FROM achados
      WHERE tipo = 'morte' AND t >= ? AND t < ?
      AND gameId IN (SELECT gameId FROM partidas WHERE ${base})`)
      .get(f.de * 1000, f.ate === Infinity ? 9e9 : f.ate * 1000);
    return { ...f, porJogo: r.n / geral.n };
  });
  const pior = [...porFaixa].sort((a, b) => b.porJogo - a.porJogo)[0];

  // Erros que mais se repetem, com o conselho curto de cada um.
  const tipos = db.prepare(`
    SELECT tipo, COUNT(*) n, COUNT(DISTINCT gameId) jogos FROM achados
    WHERE gameId IN (SELECT gameId FROM partidas WHERE ${base})
    GROUP BY tipo ORDER BY jogos DESC LIMIT 6`).all()
    .map((t) => ({ ...t, fatia: t.jogos / geral.n }));

  const isoladas = db.prepare(`
    SELECT COUNT(*) n, COUNT(DISTINCT gameId) jogos FROM achados
    WHERE tipo = 'morte' AND titulo LIKE '%sozinho%'
    AND gameId IN (SELECT gameId FROM partidas WHERE ${base})`).get();

  const comCampeao = campeao ? db.prepare(`
    SELECT COUNT(*) n, SUM(venci) v FROM partidas
    WHERE duracaoS >= 300 AND meuCampeao = ?`).get(campeao) : null;

  return {
    partidas: geral.n,
    vitorias: geral.v,
    mortesPorJogo: todas.m / geral.n,
    mortesEmVitoria: emV.jogos ? emV.m / emV.jogos : null,
    mortesEmDerrota: emD.jogos ? emD.m / emD.jogos : null,
    piorFaixa: pior,
    porFaixa,
    tipos,
    isoladasPorJogo: isoladas.n / geral.n,
    campeao: comCampeao?.n ? { nome: campeao, jogos: comCampeao.n, vitorias: comCampeao.v } : null,
  };
}
