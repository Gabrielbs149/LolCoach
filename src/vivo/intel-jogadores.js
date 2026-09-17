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
  return { elo: solo?.nome ?? null, taxaRecente: rec?.taxa ?? null, jogosRecentes: rec?.jogos ?? 0, noCampeao: noCampeao ? { jogos: noCampeao.jogos, vitorias: noCampeao.vitorias } : null, mains, rotaPrincipal, foraDaRota: !!foraDaRota, sequencia: seq, nivel, marcas, forte: !!forte, fraco: !!fraco };
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
