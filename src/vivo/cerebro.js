/**
 * O cérebro: decide, entre as situações que aconteceram agora, o que vale
 * falar. Cada uma ganha uma nota = prioridade + contexto (é a minha lane?
 * é cedo ou tarde? já falei disso há pouco?) + o que você avaliou (👍/👎
 * por tipo). Só fala o que passa da régua, dentro do orçamento de falas por
 * minuto. Tudo fica gravado com a nota, pra treinar isso de verdade depois.
 */
export const baseChave = (chave) => String(chave).split('-').filter((p) => !/#|^\d+$/.test(p)).join('-');

export function novaMemoriaCerebro() { return { faladasEm: [], ultimaFalaEm: -Infinity, ultimaPorTipo: new Map() }; }

/**
 * `situacoes`: as novas deste instante (com prioridade 0..3).
 * `ctx`: { t, minhaLane, minhaRole, notas: Map(baseChave → {bom, ruim}), silenciadas: Set }
 * Marca `falar` e `nota` em cada uma e devolve a lista.
 */
export function decidir(situacoes, ctx, mem) {
  const { t, minhaLane } = ctx;
  mem.faladasEm = mem.faladasEm.filter((x) => t - x < 60);
  const orcamento = 5;                       // falas por minuto (fora as urgentes)
  const gapMin = 6;                          // segundos entre falas

  for (const s of situacoes) {
    const base = baseChave(s.chave);
    let nota = s.prioridade;
    // é sobre a minha lane / sobre mim
    if (s.dados?.lane && s.dados.lane === minhaLane) nota += 1;
    if (['perigo'].includes(s.tipo)) nota += 0.5;
    // cedo: jungler e início valem mais; tarde: grupo e objetivo valem mais
    if (t < 600 && ['jungler'].includes(s.tipo)) nota += 0.5;
    if (t >= 900 && ['objetivo', 'grupo'].includes(s.tipo)) nota += 0.5;
    // repetição do mesmo tipo há pouco
    const antes = mem.ultimaPorTipo.get(base);
    if (antes != null && t - antes < 90) nota -= 1;
    // o que você avaliou
    const n = ctx.notas?.get(base);
    if (n) nota += Math.max(-1, Math.min(1, (n.bom - n.ruim) * 0.3));
    if (n?.precisao != null) nota += (n.precisao - 0.5) * 2;
    if (ctx.silenciadas?.has(base)) nota = -9;
    s.nota = Math.round(nota * 10) / 10;
  }

  const saida = [];
  for (const s of situacoes.sort((a, b) => b.nota - a.nota)) {
    const urgente = s.prioridade >= 3 && s.nota >= 3;
    let falar = s.nota >= 2;
    if (!urgente && falar && (t - mem.ultimaFalaEm < gapMin || mem.faladasEm.length >= orcamento)) falar = false;
    s.falar = falar;
    if (falar) { mem.ultimaFalaEm = t; mem.faladasEm.push(t); mem.ultimaPorTipo.set(baseChave(s.chave), t); }
    saida.push(s);
  }
  return saida;
}
