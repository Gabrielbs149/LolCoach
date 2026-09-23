/**
 * Quando parar de jogar — com o SEU número, não com conselho de internet.
 *
 * Todo mundo fala "não joga tiltado". Isto mede: no seu próprio histórico, qual é
 * a sua taxa de vitória no jogo seguinte a uma derrota, a duas, a três. Se a queda
 * for real (e com amostra), o app tem o direito de mandar parar; se não for, cala
 * a boca. Uma sessão quebra depois de 2 h sem jogar — jogo de hoje à noite não é
 * continuação do de ontem.
 */

const FORA_SR = [450, 900, 1300, 1700, 1710, 1810, 1820, 1830, 1840, 1900, 2300];
const PAUSA_SESSAO = 2 * 3600_000;

const cache = new Map();

/** Todas as partidas da conta em ordem, com o que basta pra contar sequência. */
function partidasEmOrdem(db, conta) {
  const fc = conta
    ? ` AND EXISTS (SELECT 1 FROM jogadores mc WHERE mc.gameId = p.gameId AND mc.participantId = p.meuId AND mc.nome = '${String(conta).replace(/'/g, "''")}')`
    : '';
  return db.prepare(`SELECT p.quando, p.duracaoS, p.venci FROM partidas p
    WHERE p.duracaoS >= 300 AND p.fila NOT IN (${FORA_SR.join(',')})${fc} ORDER BY p.quando ASC`).all();
}

/**
 * O padrão da conta: taxa geral e taxa no jogo seguinte a 1, 2 e 3 derrotas
 * seguidas dentro da mesma sessão. Cada faixa só vale com 25+ partidas.
 */
export function padraoDeSequencia(db, { conta = null, cacheMs = 10 * 60_000 } = {}) {
  const chave = conta ?? '*';
  const c = cache.get(chave);
  if (c && Date.now() - c.em < cacheMs) return c.dados;

  const ps = partidasEmOrdem(db, conta);
  const faixas = { 1: { n: 0, v: 0 }, 2: { n: 0, v: 0 }, 3: { n: 0, v: 0 } };
  let seguidas = 0, fimAnterior = 0;
  for (const p of ps) {
    const ini = Date.parse(p.quando);
    const mesmaSessao = ini - fimAnterior <= PAUSA_SESSAO;
    if (mesmaSessao && seguidas >= 1) {
      const f = faixas[Math.min(seguidas, 3)];
      f.n++; f.v += p.venci;
    }
    seguidas = mesmaSessao ? (p.venci ? 0 : seguidas + 1) : (p.venci ? 0 : 1);
    fimAnterior = ini + (p.duracaoS ?? 0) * 1000;
  }
  const base = ps.length ? { n: ps.length, taxa: Math.round((1000 * ps.reduce((s, p) => s + p.venci, 0)) / ps.length) / 10 } : null;
  const dados = {
    base,
    depois: Object.fromEntries(Object.entries(faixas).map(([k, f]) => [k, f.n >= 25 ? { n: f.n, taxa: Math.round((1000 * f.v) / f.n) / 10 } : null])),
  };
  cache.set(chave, { em: Date.now(), dados });
  return dados;
}

/**
 * O recado pra uma sequência que está acontecendo agora. Devolve null quando não
 * há motivo pra falar: sem amostra, ou a queda não é de verdade (menos de 4 pontos).
 * `nivel` = 'aviso' na primeira queda medida, 'parar' quando a queda é grande.
 */
export function recadoDeSequencia(db, { conta = null, seguidas = 0 } = {}) {
  if (seguidas < 1) return null;
  const p = padraoDeSequencia(db, { conta });
  const faixa = p.depois[Math.min(seguidas, 3)];
  if (!faixa || !p.base) return null;
  const queda = Math.round((p.base.taxa - faixa.taxa) * 10) / 10;
  if (queda < 4) return null;
  const nivel = seguidas >= 2 || queda >= 8 ? 'parar' : 'aviso';
  const quantas = seguidas >= 3 ? '3 derrotas' : seguidas === 2 ? '2 derrotas' : '1 derrota';
  const texto = nivel === 'parar'
    ? `Depois de ${quantas} seguidas você ganha ${faixa.taxa}% em ${faixa.n} partidas — o seu normal é ${p.base.taxa}%. Fecha o jogo hoje.`
    : `Depois de ${quantas} você ganha ${faixa.taxa}% em ${faixa.n} partidas, contra ${p.base.taxa}% de sempre. Levanta, bebe água, volta daqui a pouco.`;
  const curto = nivel === 'parar' ? `${faixa.taxa}% depois de ${quantas}. Para por hoje.` : `${faixa.taxa}% depois de ${quantas}. Dá um tempo.`;
  return { nivel, seguidas, taxa: faixa.taxa, base: p.base.taxa, n: faixa.n, queda, texto, curto };
}
