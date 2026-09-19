/**
 * Elo médio de uma partida: o elo solo dos 10 jogadores (API da Riot, por
 * puuid), guardado por jogador por 24 h e por partida pra sempre. Responde
 * "joguei acima ou abaixo do meu elo?" na lista de partidas, como o op.gg.
 */
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const NOME = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const RANK = { IV: 0, III: 1, II: 2, I: 3 };

export function garantirTabelas(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS elo_jogador (puuid TEXT PRIMARY KEY, tier TEXT, rank TEXT, pdl INTEGER, em TEXT);
           CREATE TABLE IF NOT EXISTS elo_partida (gameId INTEGER PRIMARY KEY, tier TEXT, rank TEXT, pontos REAL, n INTEGER, em TEXT);`);
}

/** Pontos numa escala contínua: Ferro IV = 0 … cada divisão = 1; Mestre+ soma PDL/100. */
const pontosDe = (tier, rank, pdl) => { const t = TIERS.indexOf(tier); if (t < 0) return null; return t * 4 + (t >= 7 ? Math.min(3.9, (pdl ?? 0) / 100) : (RANK[rank] ?? 0)); };
const dePontos = (p) => { const t = Math.min(9, Math.floor(p / 4)); const tier = TIERS[t]; const rank = t >= 7 ? '' : ['IV', 'III', 'II', 'I'][Math.round(p - t * 4)] ?? 'IV'; return { tier, rank, nome: `${NOME[tier]}${rank ? ' ' + rank : ''}` }; };

export async function eloDoJogador(db, riot, puuid) {
  if (!puuid) return null;
  const c = db.prepare('SELECT * FROM elo_jogador WHERE puuid = ?').get(puuid);
  if (c && Date.now() - Date.parse(c.em) < 24 * 3600_000) return c.tier ? c : null;
  let solo = null;
  try { const lista = await riot.elo(puuid); solo = (lista ?? []).find((e) => e.queueType === 'RANKED_SOLO_5x5') ?? null; } catch { return c?.tier ? c : null; }
  db.prepare('INSERT OR REPLACE INTO elo_jogador (puuid, tier, rank, pdl, em) VALUES (?,?,?,?,?)').run(puuid, solo?.tier ?? null, solo?.rank ?? null, solo?.leaguePoints ?? null, new Date().toISOString());
  return solo ? { puuid, tier: solo.tier, rank: solo.rank, pdl: solo.leaguePoints } : null;
}

/** Elo médio da partida (calcula e guarda). Devolve { nome, tier, rank, pontos, n } ou null. */
export async function eloMedioDaPartida(db, riot, gameId) {
  const pronto = db.prepare('SELECT * FROM elo_partida WHERE gameId = ?').get(gameId);
  if (pronto && (pronto.tier || Date.now() - Date.parse(pronto.em) < 7 * 86400_000)) return pronto.tier ? { ...pronto, ...dePontos(pronto.pontos) } : null;
  let jogadores = db.prepare('SELECT participantId, puuid FROM jogadores WHERE gameId = ? AND puuid IS NOT NULL').all(gameId);
  // partida vinda do client tem um uuid curto, não o puuid da Riot: pega os 10 puuids na API (1 chamada) e guarda
  if (!jogadores.length || jogadores.some((j) => String(j.puuid).length < 60)) {
    const linha = db.prepare('SELECT matchId FROM partidas WHERE gameId = ?').get(gameId);
    const matchId = linha?.matchId ?? `${String(riot.regiao ?? 'br1').toUpperCase()}_${gameId}`;
    try {
      const jogo = await riot.partida(matchId);
      const upd = db.prepare('UPDATE jogadores SET puuid = ? WHERE gameId = ? AND participantId = ?');
      for (const pp of jogo?.info?.participants ?? []) upd.run(pp.puuid, gameId, pp.participantId);
      jogadores = db.prepare('SELECT participantId, puuid FROM jogadores WHERE gameId = ? AND puuid IS NOT NULL').all(gameId);
    } catch { /* sem a partida na API */ }
  }
  const pontos = [];
  for (const j of jogadores) { const e = await eloDoJogador(db, riot, j.puuid); const p = e ? pontosDe(e.tier, e.rank, e.pdl) : null; if (p != null) pontos.push(p); }
  if (pontos.length < 4) { db.prepare('INSERT OR REPLACE INTO elo_partida (gameId, tier, rank, pontos, n, em) VALUES (?,?,?,?,?,?)').run(gameId, null, null, null, pontos.length, new Date().toISOString()); return null; }
  const media = pontos.reduce((s, p) => s + p, 0) / pontos.length;
  const d = dePontos(media);
  db.prepare('INSERT OR REPLACE INTO elo_partida (gameId, tier, rank, pontos, n, em) VALUES (?,?,?,?,?,?)').run(gameId, d.tier, d.rank, media, pontos.length, new Date().toISOString());
  return { gameId, tier: d.tier, rank: d.rank, nome: d.nome, pontos: media, n: pontos.length };
}

/** Lê o que já está guardado (sem rede) pra lista. Map(gameId -> nome). */
export function elosGuardados(db) {
  garantirTabelas(db);
  const m = new Map();
  for (const r of db.prepare('SELECT gameId, tier, rank, pontos FROM elo_partida WHERE tier IS NOT NULL').all()) m.set(r.gameId, dePontos(r.pontos).nome);
  return m;
}
