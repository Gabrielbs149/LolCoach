/**
 * Splits ranqueados da Riot (três por ano desde 2024). As datas são o dia do
 * patch que abre cada split; quem está no limite de um dia cai no split
 * seguinte, o que pra ver evolução não muda nada.
 */
export const TEMPORADAS = [
  { chave: '2024-1', nome: 'Split 1 · 2024', de: '2024-01-10' },
  { chave: '2024-2', nome: 'Split 2 · 2024', de: '2024-05-15' },
  { chave: '2024-3', nome: 'Split 3 · 2024', de: '2024-09-25' },
  { chave: '2025-1', nome: 'Split 1 · 2025', de: '2025-01-09' },
  { chave: '2025-2', nome: 'Split 2 · 2025', de: '2025-05-14' },
  { chave: '2025-3', nome: 'Split 3 · 2025', de: '2025-09-24' },
  { chave: '2026-1', nome: 'Split 1 · 2026', de: '2026-01-08' },
  { chave: '2026-2', nome: 'Split 2 · 2026', de: '2026-05-13' },
  { chave: '2026-3', nome: 'Split 3 · 2026', de: '2026-09-23' },
];

/** Split de uma data ISO; antes do primeiro split conhecido vira "antes". */
export function temporadaDe(quandoIso) {
  const dia = String(quandoIso ?? '').slice(0, 10);
  let achada = null;
  for (const t of TEMPORADAS) if (dia >= t.de) achada = t; else break;
  return achada?.chave ?? 'antes';
}

export const nomeDaTemporada = (chave) => TEMPORADAS.find((t) => t.chave === chave)?.nome ?? (chave === 'antes' ? 'Antes de 2024' : chave);

/**
 * Números por split, do mais novo pro mais velho — só os que têm partida.
 * `partidas` = linhas de /api/partidas (com kda "k/d/a", cs, duracaoS, graves,
 * participacao, meuCampeao, minhaRole, championId, venci).
 */
export function resumoPorTemporada(partidas) {
  const grupos = new Map();
  for (const p of partidas) {
    const chave = p.temporada ?? temporadaDe(p.quando);
    const g = grupos.get(chave) ?? grupos.set(chave, { chave, nome: nomeDaTemporada(chave), jogos: 0, vitorias: 0, k: 0, d: 0, a: 0, cs: 0, min: 0, part: 0, comPart: 0, graves: 0, roles: new Map(), campeoes: new Map() }).get(chave);
    g.jogos++; g.vitorias += p.venci ? 1 : 0;
    const [k, d, a] = String(p.kda ?? '0/0/0').split('/').map(Number);
    g.k += k || 0; g.d += d || 0; g.a += a || 0;
    g.cs += p.cs ?? 0; g.min += (p.duracaoS ?? 0) / 60;
    if (p.participacao != null) { g.part += Number(p.participacao); g.comPart++; }
    g.graves += p.graves ?? 0;
    g.roles.set(p.minhaRole, (g.roles.get(p.minhaRole) ?? 0) + 1);
    const c = g.campeoes.get(p.meuCampeao) ?? g.campeoes.set(p.meuCampeao, { nome: p.meuCampeao, championId: p.championId, n: 0, v: 0 }).get(p.meuCampeao);
    c.n++; c.v += p.venci ? 1 : 0;
  }
  const ordem = [...grupos.values()].sort((x, y) => (y.chave > x.chave ? 1 : -1));
  return ordem.map((g, i) => {
    const anterior = ordem[i + 1];
    const wr = (x) => x ? Math.round(100 * x.vitorias / x.jogos) : null;
    return {
      chave: g.chave, nome: g.nome, jogos: g.jogos, vitorias: g.vitorias, winrate: wr(g),
      deltaWinrate: anterior ? wr(g) - wr(anterior) : null,
      kda: g.d ? Math.round(10 * (g.k + g.a) / g.d) / 10 : g.k + g.a,
      kills: Math.round(10 * g.k / g.jogos) / 10, mortes: Math.round(10 * g.d / g.jogos) / 10, assists: Math.round(10 * g.a / g.jogos) / 10,
      csMin: g.min ? Math.round(10 * g.cs / g.min) / 10 : null,
      participacao: g.comPart ? Math.round(g.part / g.comPart) : null,
      gravesPorJogo: Math.round(10 * g.graves / g.jogos) / 10,
      role: [...g.roles.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      campeoes: [...g.campeoes.values()].sort((x, y) => y.n - x.n).slice(0, 3),
    };
  });
}
