/**
 * Estilo de jogo com nome (como o League of Graphs / GPI do Mobalytics) e a
 * comparação com o seu elo e com o de cima. As referências por elo são
 * aproximadas (médias públicas por tier na solo, 2025) — servem de régua, não
 * de verdade absoluta; por isso ficam marcadas como "aprox.".
 */
export const REFERENCIA = {
  // csMin · participação · dano/min · visão/min · mortes por jogo
  IRON: { csm: 4.8, part: 0.48, dpm: 520, vspm: 0.7, mortes: 7.2 },
  BRONZE: { csm: 5.2, part: 0.49, dpm: 560, vspm: 0.8, mortes: 6.9 },
  SILVER: { csm: 5.6, part: 0.50, dpm: 600, vspm: 0.9, mortes: 6.6 },
  GOLD: { csm: 6.0, part: 0.51, dpm: 640, vspm: 1.0, mortes: 6.3 },
  PLATINUM: { csm: 6.4, part: 0.52, dpm: 680, vspm: 1.1, mortes: 6.0 },
  EMERALD: { csm: 6.8, part: 0.53, dpm: 720, vspm: 1.2, mortes: 5.7 },
  DIAMOND: { csm: 7.3, part: 0.55, dpm: 780, vspm: 1.35, mortes: 5.3 },
  MASTER: { csm: 7.8, part: 0.57, dpm: 840, vspm: 1.5, mortes: 5.0 },
  GRANDMASTER: { csm: 8.1, part: 0.58, dpm: 880, vspm: 1.6, mortes: 4.8 },
  CHALLENGER: { csm: 8.4, part: 0.6, dpm: 920, vspm: 1.7, mortes: 4.6 },
};
const ORDEM = Object.keys(REFERENCIA);

/** `g` = resumoGeral, `p` = participacao (fatia de abates/dano), tier = seu tier solo. */
export function estiloDeJogo(g, p, tier) {
  if (!g) return null;
  const t = ORDEM.includes(tier) ? tier : 'EMERALD';
  const ref = REFERENCIA[t], cima = REFERENCIA[ORDEM[Math.min(ORDEM.length - 1, ORDEM.indexOf(t) + 1)]];
  const meu = { csm: g.csm, part: p?.abates ?? 0, dpm: g.dpm, vspm: g.vspm, mortes: g.mortesPorJogo ?? null };
  const eixos = [
    { chave: 'csm', rotulo: 'CS por minuto', meu: meu.csm, ref: ref.csm, cima: cima.csm, fmt: (v) => v.toFixed(1) },
    { chave: 'part', rotulo: 'Participação em kills', meu: meu.part, ref: ref.part, cima: cima.part, fmt: (v) => Math.round(v * 100) + '%' },
    { chave: 'dpm', rotulo: 'Dano por minuto', meu: meu.dpm, ref: ref.dpm, cima: cima.dpm, fmt: (v) => Math.round(v) },
    { chave: 'vspm', rotulo: 'Visão por minuto', meu: meu.vspm, ref: ref.vspm, cima: cima.vspm, fmt: (v) => v.toFixed(2) },
  ];
  if (meu.mortes != null) eixos.push({ chave: 'mortes', rotulo: 'Mortes por jogo', meu: meu.mortes, ref: ref.mortes, cima: cima.mortes, fmt: (v) => v.toFixed(1), menorMelhor: true });
  // percentil aproximado no seu elo: distribuição normal em volta da referência (desvios típicos por métrica)
  const SD = { csm: 1.1, part: 0.1, dpm: 170, vspm: 0.35, mortes: 1.7 };
  const Phi = (z) => 0.5 * (1 + Math.tanh(z * 0.7978845608 * (1 + 0.044715 * z * z)));
  for (const e of eixos) { const r = e.menorMelhor ? e.ref / Math.max(0.1, e.meu) : e.meu / Math.max(0.01, e.ref); e.razao = Math.round(r * 100) / 100; e.acimaDoDeCima = e.menorMelhor ? e.meu <= e.cima : e.meu >= e.cima; const z = (e.meu - e.ref) / (SD[e.chave] ?? 1); e.percentil = Math.round(100 * (e.menorMelhor ? 1 - Phi(z) : Phi(z))); }
  // nome do estilo: os dois traços mais fortes
  const traco = [];
  if (meu.dpm >= ref.dpm * 1.1) traco.push('Carry de dano');
  if (meu.part >= ref.part * 1.08 && meu.dpm >= ref.dpm * 1.05) traco.push('Agressivo');
  if (meu.csm >= ref.csm * 1.08) traco.push('Farmer');
  if (meu.vspm >= ref.vspm * 1.15) traco.push('Olho no mapa');
  if (meu.mortes != null && meu.mortes <= ref.mortes * 0.85) traco.push('Seguro');
  else if (meu.mortes != null && meu.mortes >= ref.mortes * 1.15) traco.push('Morre demais');
  if (!traco.length && meu.part <= ref.part * 0.92) traco.push('Passivo');
  const nome = traco.slice(0, 2).join(' · ') || 'Equilibrado';
  const forte = [...eixos].sort((a, b) => b.razao - a.razao)[0], fraco = [...eixos].sort((a, b) => a.razao - b.razao)[0];
  return { tier: t, tierCima: ORDEM[Math.min(ORDEM.length - 1, ORDEM.indexOf(t) + 1)], nome, eixos, forte: forte?.rotulo ?? null, fraco: fraco?.rotulo ?? null };
}
