/**
 * Provider de builds do op.gg.
 *
 * O op.gg não publica API oficial, mas a página consome um endpoint JSON aberto
 * que devolve os IDs de runa já no mesmo formato que a LCU aceita. Se um dia ele
 * mudar, é este arquivo que quebra — o resto do app fala só com `buscarBuild`.
 */

const BASE = 'https://lol-api-champion.op.gg/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

// A LCU chama as posições de um jeito, o op.gg de outro.
export const ROLE_OPGG = {
  top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'support',
  TOP: 'top', JUNGLE: 'jungle', MID: 'mid', ADC: 'adc', SUPORTE: 'support',
};

// Campeões cujo slug no op.gg não sai direto do nome.
const SLUG_ESPECIAL = {
  'Nunu & Willump': 'nunu',
  'Renata Glasc': 'renata',
  "Bel'Veth": 'belveth',
  'Dr. Mundo': 'drmundo',
};

export function slugDoCampeao(nome) {
  return SLUG_ESPECIAL[nome] ?? nome.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const cache = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000; // build não muda de hora em hora

async function buscarJson(url) {
  const agora = Date.now();
  const guardado = cache.get(url);
  if (guardado && agora - guardado.em < CACHE_MS) return guardado.dados;

  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`op.gg respondeu HTTP ${r.status}`);
  const dados = await r.json();
  cache.set(url, { em: agora, dados });
  return dados;
}

/**
 * Escolhe uma build entre as que o op.gg devolve.
 *  - 'popular': a mais jogada (é o padrão que o site mostra)
 *  - 'vitoria': a de maior taxa de vitória entre as que têm amostra decente,
 *    pra não pegar uma build de 12 partidas com 70% de winrate
 */
function escolherBuild(builds, criterio, preferir = null) {
  if (!builds?.length) return null;
  // Confronto: entre as páginas que os jogadores usam de verdade (≥ 10% da mais jogada), a que tem a runa
  // pedida (Segunda Vento contra AP de poke, Placa de Ossos contra all-in). Nunca inventa página.
  if (preferir?.runaId) {
    const maior = builds.reduce((a, b) => (b.play > a.play ? b : a));
    const comRuna = builds.filter((b) => b.play >= maior.play * 0.1 && [...(b.primary_rune_ids ?? []), ...(b.secondary_rune_ids ?? [])].includes(preferir.runaId));
    if (comRuna.length) return { ...comRuna.reduce((a, b) => (b.play > a.play ? b : a)), porConfronto: preferir.motivo };
  }
  if (criterio === 'vitoria') {
    const totalJogos = builds.reduce((s, b) => s + b.play, 0);
    const minimo = Math.max(50, totalJogos * 0.03);
    const elegiveis = builds.filter((b) => b.play >= minimo);
    const pool = elegiveis.length ? elegiveis : builds;
    return pool.reduce((a, b) => (b.win / b.play > a.win / a.play ? b : a));
  }
  return builds.reduce((a, b) => (b.play > a.play ? b : a));
}

/**
 * Busca a build de um campeão numa role.
 * `criterio` aceita 'popular' (padrão) ou 'vitoria'.
 */
export async function buscarBuild(nomeCampeao, role, opcoes = {}) {
  const { regiao = 'br', criterio = 'popular' } = opcoes;
  const slug = slugDoCampeao(nomeCampeao);
  const pos = ROLE_OPGG[role] ?? String(role).toLowerCase();
  const url = `${BASE}/${regiao}/champions/ranked/${slug}/${pos}`;

  const j = await buscarJson(url);
  const d = j.data ?? j;

  const runa = escolherBuild(d.runes, criterio, opcoes.preferirRuna ?? null);
  if (!runa) throw new Error(`op.gg não tem build de ${nomeCampeao} em ${pos}`);

  const spells = escolherBuild(d.summoner_spells, criterio);
  const taxa = (b) => (b?.play ? `${Math.round((b.win / b.play) * 100)}% em ${b.play.toLocaleString('pt-BR')} jogos` : '');

  return {
    campeao: nomeCampeao,
    role: pos,
    fonte: `op.gg/${regiao}`,
    criterio,
    runas: {
      primaryStyleId: runa.primary_page_id,
      subStyleId: runa.secondary_page_id,
      // A LCU espera exatamente nesta ordem: 4 da primária, 2 da secundária, 3 fragmentos.
      selectedPerkIds: [...runa.primary_rune_ids, ...runa.secondary_rune_ids, ...runa.stat_mod_ids],
      estatistica: taxa(runa),
      porConfronto: runa.porConfronto ?? null,
    },
    spells: spells ? { ids: spells.ids, estatistica: taxa(spells) } : null,
    itens: {
      iniciais: d.starter_items?.[0]?.ids ?? null,
      principais: d.core_items?.[0]?.ids ?? null,
      botas: d.boots?.[0]?.ids?.[0] ?? null,
    },
    skills: d.skill_masteries?.[0]?.ids ?? d.skills?.[0]?.order ?? null,
  };
}
