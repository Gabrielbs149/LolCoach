/**
 * Quem são as pessoas do time deles — só dá pra saber na tela de carregamento
 * (a API do jogo entrega os riotIds), e aí vale muito: elo, forma recente,
 * quantos jogos com esse campeão, se é a rota principal, sequência.
 * Um perfil por vez (limite da chave da Riot), com as últimas 8 partidas
 * ranqueadas de cada um; o cache de 30 min do perfil de amigo é reaproveitado.
 */
import { perfilDeAmigo } from '../dados/amigos.js';

const ROLE_PT = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'adc', sup: 'sup' };
const k = (n) => String(n ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Fatos de um jogador deles a partir do perfil da Riot. */
export function fatosDe(perfil, { campeao, role }) {
  if (!perfil) return null;
  const solo = perfil.elos?.find((e) => e.chave === 'RANKED_SOLO_5x5') ?? perfil.elos?.[0] ?? null;
  const rec = perfil.recente ?? null;
  const noCampeao = rec?.campeoes?.find((c) => k(c.campeao) === k(campeao)) ?? null;
  const rotaPrincipal = rec?.roles?.[0]?.role ?? null;
  const ultimas = rec?.ultimas ?? [];
  let seq = 0; for (const u of ultimas) { if (seq === 0) seq = u.venci ? 1 : -1; else if ((seq > 0) === !!u.venci) seq += seq > 0 ? 1 : -1; else break; }
  const foraDaRota = rotaPrincipal && role && ROLE_PT[role] && rotaPrincipal !== ROLE_PT[role] && (rec?.roles?.find((r) => r.role === ROLE_PT[role])?.fatia ?? 0) < 0.25;
  const nivel = perfil.nivel ?? null;
  const marcas = [];
  if (solo) marcas.push(solo.nome + (solo.jogos ? ` (${Math.round(solo.taxa * 100)}% em ${solo.jogos})` : ''));
  else marcas.push('sem ranqueada');
  if (rec?.jogos) marcas.push(`${Math.round(rec.taxa * 100)}% nas últimas ${rec.jogos}`);
  if (noCampeao) marcas.push(`${noCampeao.jogos} de ${campeao} recente${noCampeao.jogos > 1 ? 's' : ''} (${noCampeao.vitorias}v)`);
  else if (rec?.jogos) marcas.push(`nenhum jogo recente de ${campeao}`);
  if (foraDaRota) marcas.push(`fora da rota dele (joga ${rotaPrincipal})`);
  if (Math.abs(seq) >= 3) marcas.push(seq > 0 ? `${seq} vitórias seguidas` : `${-seq} derrotas seguidas`);
  if (nivel != null && nivel < 60) marcas.push(`nível ${nivel} (conta nova)`);
  const mains = (rec?.campeoes ?? []).slice(0, 3).map((c) => c.campeao);
  // ameaça: bom elo, ou muito jogo no campeão, ou sequência de vitórias
  const forte = (solo && ['DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER', 'EMERALD'].includes(solo.tier)) || (noCampeao?.jogos >= 4 && noCampeao.vitorias / noCampeao.jogos >= 0.6) || seq >= 4;
  const fraco = foraDaRota || (rec?.jogos >= 5 && rec.taxa <= 0.35) || seq <= -3 || (rec?.jogos >= 5 && !noCampeao);
  const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
  const eloPontos = solo?.tier ? TIERS.indexOf(solo.tier) * 4 + (TIERS.indexOf(solo.tier) >= 7 ? Math.min(3.9, (solo.pdl ?? 0) / 100) : ({ IV: 0, III: 1, II: 2, I: 3 }[solo.rank] ?? 0)) : null;
  return { eloPontos, seq, gameIds: ultimas.map((u) => u.gameId).filter(Boolean), primeiraVez: !!(rec?.jogos >= 5 && !noCampeao), elo: solo?.nome ?? null, taxaRecente: rec?.taxa ?? null, jogosRecentes: rec?.jogos ?? 0, noCampeao: noCampeao ? { jogos: noCampeao.jogos, vitorias: noCampeao.vitorias } : null, mains, rotaPrincipal, foraDaRota: !!foraDaRota, sequencia: seq, nivel, marcas, forte: !!forte, fraco: !!fraco };
}

/**
 * Previsão de vitória pré-jogo (como Porofessor/Blitz): força de cada time = média dos 5 em
 * elo (peso maior), forma recente, taxa no campeão e sequência. Devolve { pct, motivos } ou null.
 * `nossos`/`deles` = listas de fatos (fatosDe) já prontos; quem não tem ficha entra neutro.
 */
export function previsaoDeVitoria(nossos, deles) {
  const forca = (lista) => {
    const fichas = lista.filter((f) => f && !f.erro);
    if (fichas.length < 2) return null;
    const elos = fichas.map((f) => f.eloPontos).filter((x) => x != null);
    const elo = elos.length ? elos.reduce((s, x) => s + x, 0) / elos.length : null;
    const forma = fichas.map((f) => (f.jogosRecentes >= 4 ? (f.taxaRecente ?? 0.5) - 0.5 : 0)).reduce((s, x) => s + x, 0) / fichas.length;
    const camp = fichas.map((f) => (f.noCampeao?.jogos >= 3 ? f.noCampeao.vitorias / f.noCampeao.jogos - 0.5 : f.primeiraVez ? -0.08 : 0)).reduce((s, x) => s + x, 0) / fichas.length;
    const seq = fichas.map((f) => Math.max(-4, Math.min(4, f.seq ?? 0)) / 4).reduce((s, x) => s + x, 0) / fichas.length;
    return { elo, forma, camp, seq, n: fichas.length };
  };
  const a = forca(nossos), b = forca(deles);
  if (!a || !b) return null;
  // elo: cada divisão de diferença na média vale ~4 pontos percentuais; forma/campeão/sequência menos
  const dElo = a.elo != null && b.elo != null ? (a.elo - b.elo) : 0;
  const x = 0.16 * dElo + 1.6 * (a.forma - b.forma) + 1.2 * (a.camp - b.camp) + 0.25 * (a.seq - b.seq);
  const pct = Math.round(100 / (1 + Math.exp(-x)));
  const motivos = [];
  if (Math.abs(dElo) >= 1.5) motivos.push(dElo > 0 ? 'elo médio de vocês mais alto' : 'elo médio deles mais alto');
  if (Math.abs(a.forma - b.forma) >= 0.08) motivos.push(a.forma > b.forma ? 'vocês vêm ganhando mais' : 'eles vêm ganhando mais');
  if (Math.abs(a.camp - b.camp) >= 0.08) motivos.push(a.camp > b.camp ? 'vocês nos seus campeões' : 'eles nos campeões deles');
  return { pct: Math.max(15, Math.min(85, pct)), motivos, nossos: a.n, deles: b.n };
}

/**
 * Monta a intel de todos deles, um por vez. `aoAtualizar(nome, fatos)` é chamado
 * a cada um pronto, pra tela ir preenchendo.
 */
export async function intelDosJogadores(riotConfig, inimigos, { aoAtualizar, quantas = 8 } = {}) {
  const saida = new Map();
  for (const j of inimigos) {
    const [nome, tag] = String(j.nome ?? '').split('#');
    if (!nome || !tag) continue;
    try {
      const p = await perfilDeAmigo(riotConfig, { nome, tag }, { quantas });
      const f = fatosDe(p, { campeao: j.campeao, role: j.role });
      saida.set(j.nome, f);
      aoAtualizar?.(j.nome, f);
    } catch (erro) {
      saida.set(j.nome, { erro: erro.message });
    }
  }
  return saida;
}
