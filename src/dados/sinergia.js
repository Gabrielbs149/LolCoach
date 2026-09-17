/**
 * Sinergia de duo (adc × sup): o que combina com o que.
 *
 * Duas fontes, somadas:
 *   1. arquétipos — todo sup e todo adc têm um estilo, e cada par de estilos
 *      tem uma nota (engage com adc de all-in, enchanter com hypercarry,
 *      poke com adc de alcance…);
 *   2. duplas clássicas — pares que a comunidade joga junto há anos ganham
 *      um bônus por cima, com o motivo em uma linha.
 * Nota final 0..1 (0,5 = neutro). Vale nos dois sentidos: quem é adc olha o
 * sup do time, quem é sup olha o adc.
 */
const SUP = {
  engage: ['Leona', 'Nautilus', 'Rell', 'Alistar', 'Thresh', 'Blitzcrank', 'Pyke', 'Rakan', 'Braum', 'Maokai', 'Pantheon', 'Poppy', 'Galio', 'Shen', 'Nunu & Willump'],
  enchanter: ['Lulu', 'Yuumi', 'Nami', 'Janna', 'Soraka', 'Milio', 'Karma', 'Sona', 'Renata Glasc', 'Seraphine', 'Taric', 'Ivern'],
  poke: ['Lux', 'Morgana', 'Xerath', 'Zyra', 'Brand', "Vel'Koz", 'Swain', 'Neeko', 'Zilean', 'Ashe', 'Senna', 'Hwei', 'Mel', 'Heimerdinger', 'Zoe'],
  tank: ['Braum', 'Tahm Kench', 'Taric', 'Alistar', 'Maokai', 'Shen', 'Nautilus'],
};
const ADC = {
  allin: ['Samira', 'Lucian', "Kai'Sa", 'Draven', 'Xayah', 'Nilah', 'Tristana', 'Vayne', 'Yasuo', 'Kalista'],
  hyper: ['Jinx', "Kog'Maw", 'Twitch', 'Aphelios', 'Zeri', 'Vayne', 'Smolder', 'Kindred', 'Yunara'],
  poke: ['Caitlyn', 'Jhin', 'Ezreal', 'Ashe', 'Varus', 'Miss Fortune', 'Senna', 'Ziggs', 'Seraphine', 'Karthus', 'Swain', 'Corki'],
  frontline: ['Jinx', 'Ashe', 'Sivir', 'Jhin', 'Caitlyn', 'Aphelios', 'Kalista'],
};
// nota do par de estilos (sup × adc)
const PAR = {
  engage: { allin: 0.8, hyper: 0.5, poke: 0.45, frontline: 0.55 },
  enchanter: { allin: 0.55, hyper: 0.85, poke: 0.6, frontline: 0.7 },
  poke: { allin: 0.4, hyper: 0.45, poke: 0.8, frontline: 0.6 },
  tank: { allin: 0.55, hyper: 0.75, poke: 0.55, frontline: 0.7 },
};
const MOTIVO = {
  'engage-allin': 'dupla de all-in: ele entra, você fecha',
  'enchanter-hyper': 'ele te protege e escala junto',
  'poke-poke': 'dupla de poke: lane longa, sem trade curto',
  'tank-hyper': 'ele segura a linha, você carrega',
  'enchanter-frontline': 'lane segura, escala',
  'engage-hyper': 'ele entra e você ainda não bate: cuidado no early',
  'poke-allin': 'estilos diferentes: ele quer poke, você quer all-in',
  'engage-poke': 'ele entra e você não acompanha: trade na hora errada',
};
// duplas clássicas (bônus por cima do arquétipo)
const DUPLAS = [
  ['Lucian', 'Nami', 0.2, 'Lucian + Nami: bolha e E dão trade'], ['Lucian', 'Braum', 0.12, 'Lucian + Braum: a passiva dele fecha com o Q'],
  ['Xayah', 'Rakan', 0.2, 'Xayah + Rakan: passiva compartilhada'], ['Samira', 'Leona', 0.15, 'Samira + Leona: engage e ult'],
  ['Samira', 'Rell', 0.15, 'Samira + Rell'], ['Samira', 'Nautilus', 0.12, 'Samira + Naut'], ["Kai'Sa", 'Leona', 0.15, "Kai'Sa + Leona: ult dela em cima do engage"],
  ["Kai'Sa", 'Nautilus', 0.12, "Kai'Sa + Naut"], ["Kai'Sa", 'Rell', 0.12, "Kai'Sa + Rell"], ['Jinx', 'Thresh', 0.12, 'Jinx + Thresh: lanterna e peel'],
  ['Jinx', 'Lulu', 0.15, 'Jinx + Lulu: hypercarry protegido'], ['Jinx', 'Milio', 0.12, 'Jinx + Milio'], ["Kog'Maw", 'Lulu', 0.2, "Kog'Maw + Lulu: clássico"],
  ['Twitch', 'Lulu', 0.15, 'Twitch + Lulu'], ['Twitch', 'Yuumi', 0.12, 'Twitch + Yuumi'], ['Caitlyn', 'Lux', 0.15, 'Caitlyn + Lux: armadilha na raiz'],
  ['Caitlyn', 'Morgana', 0.12, 'Caitlyn + Morgana: prende e acerta armadilha'], ['Caitlyn', 'Karma', 0.1, 'Caitlyn + Karma: poke'], ['Jhin', 'Morgana', 0.12, 'Jhin + Morgana: prende e acerta o W'],
  ['Jhin', 'Lux', 0.12, 'Jhin + Lux'], ['Jhin', 'Zyra', 0.1, 'Jhin + Zyra'], ['Ezreal', 'Karma', 0.12, 'Ezreal + Karma: poke e escudo'], ['Ezreal', 'Yuumi', 0.12, 'Ezreal + Yuumi'],
  ['Ezreal', 'Lux', 0.1, 'Ezreal + Lux'], ['Draven', 'Blitzcrank', 0.15, 'Draven + Blitz: puxou, morreu'], ['Draven', 'Thresh', 0.12, 'Draven + Thresh'], ['Draven', 'Nautilus', 0.12, 'Draven + Naut'],
  ['Ashe', 'Zyra', 0.1, 'Ashe + Zyra: poke'], ['Ashe', 'Braum', 0.1, 'Ashe + Braum: lane segura'], ['Varus', 'Ashe', 0.1, 'Varus + Ashe'], ['Miss Fortune', 'Leona', 0.12, 'MF + Leona: ult em cima do engage'],
  ['Miss Fortune', 'Nautilus', 0.1, 'MF + Naut'], ['Miss Fortune', 'Amumu', 0.12, 'MF + Amumu'], ['Aphelios', 'Thresh', 0.1, 'Aphelios + Thresh'], ['Aphelios', 'Lulu', 0.12, 'Aphelios + Lulu'],
  ['Zeri', 'Lulu', 0.15, 'Zeri + Lulu'], ['Zeri', 'Yuumi', 0.15, 'Zeri + Yuumi'], ['Vayne', 'Lulu', 0.12, 'Vayne + Lulu'], ['Nilah', 'Leona', 0.12, 'Nilah + Leona'], ['Nilah', 'Rell', 0.1, 'Nilah + Rell'],
  ['Smolder', 'Milio', 0.12, 'Smolder + Milio: escala'], ['Smolder', 'Lulu', 0.1, 'Smolder + Lulu'], ['Sivir', 'Lulu', 0.1, 'Sivir + Lulu'], ['Kalista', 'Thresh', 0.12, 'Kalista + Thresh: ult na lanterna'],
  ['Kalista', 'Alistar', 0.1, 'Kalista + Alistar'], ['Yunara', 'Lulu', 0.1, 'Yunara + Lulu'], ['Yunara', 'Milio', 0.1, 'Yunara + Milio'],
];

const estilosDe = (tabela, nome) => Object.entries(tabela).filter(([, lista]) => lista.includes(nome)).map(([k]) => k);

/** { nota: 0..1, motivo } pra um adc com um sup (ou null se não conhece algum dos dois). */
export function sinergia(adc, sup) {
  if (!adc || !sup) return null;
  const ea = estilosDe(ADC, adc), es = estilosDe(SUP, sup);
  if (!ea.length || !es.length) return null;
  let melhor = { nota: 0, motivo: null };
  for (const s of es) for (const a of ea) {
    const n = PAR[s]?.[a] ?? 0.5;
    if (n > melhor.nota) melhor = { nota: n, motivo: MOTIVO[`${s}-${a}`] ?? null };
  }
  const dupla = DUPLAS.find(([a, s]) => a === adc && s === sup);
  if (dupla) melhor = { nota: Math.min(1, melhor.nota + dupla[2]), motivo: dupla[3] };
  return melhor;
}

/** Quem combina melhor com esse sup, entre os seus picks (ou com esse adc, se você é sup). */
export function melhoresCom({ candidatos, parceiro, souSup = false }) {
  return candidatos.map((nome) => ({ nome, ...(souSup ? sinergia(parceiro, nome) : sinergia(nome, parceiro)) ?? { nota: null, motivo: null } }))
    .sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1));
}

/** Sem posição atribuída (normal sem fila por rota): chuta o parceiro pelo campeão que o time declarou. */
export const ehSup = (nome) => Object.values(SUP).some((l) => l.includes(nome));
export const ehAdc = (nome) => Object.values(ADC).some((l) => l.includes(nome));
