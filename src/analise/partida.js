import { rotaMaisProxima, dist } from './mapa.js';

const SMITE = 11;

// Tempo base de renascimento por nivel, em segundos. Depois dos 15min o jogo
// aplica um acrescimo progressivo; aproximamos porque so precisamos saber
// quem estava vivo perto de um evento, nao o timer exato.
const RENASCER = [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5];

let cacheCampeoes = null;
async function nomesDeCampeao(lcu) {
  if (cacheCampeoes) return cacheCampeoes;
  const lista = await lcu.get('/lol-game-data/assets/v1/champion-summary.json');
  cacheCampeoes = new Map(lista.map((c) => [c.id, c.name]));
  return cacheCampeoes;
}

/** Lista as partidas recentes que o client ainda guarda em cache. */
export async function partidasRecentes(lcu, quantas = 10) {
  const r = await lcu.get(`/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${quantas}`);
  return (r?.games?.games ?? []).map((g) => ({
    gameId: g.gameId,
    fila: g.queueId,
    quando: g.gameCreationDate,
    duracaoS: g.gameDuration,
    campeao: g.participants?.[0]?.championId,
  }));
}

/** Deduz a role de cada jogador: Smite marca o caçador, o resto sai da posicao. */
function deduzirRoles(jogadores, frames) {
  const cedo = frames.filter((f) => f.minuto >= 2 && f.minuto <= 10);

  for (const j of jogadores) {
    if (j.spells.includes(SMITE)) { j.role = 'JUNGLE'; continue; }
    const votos = { TOP: 0, MID: 0, BOT: 0 };
    for (const f of cedo) {
      const p = f.pos[j.id];
      const rota = p && rotaMaisProxima(p);
      if (rota) votos[rota]++;
    }
    j.role = Object.entries(votos).sort((a, b) => b[1] - a[1])[0][0];
  }

  // Dois na rota inferior: quem tem menos farm aos 10min e o suporte.
  for (const time of [100, 200]) {
    const bots = jogadores.filter((j) => j.time === time && j.role === 'BOT');
    if (bots.length !== 2) continue;
    const aos10 = frames.find((f) => f.minuto >= 10) ?? frames.at(-1);
    const farm = (j) => aos10?.dados[j.id]?.cs ?? 0;
    const [sup, adc] = farm(bots[0]) <= farm(bots[1]) ? bots : [bots[1], bots[0]];
    sup.role = 'SUPORTE';
    adc.role = 'ADC';
  }
  return jogadores;
}

/** Monta a tabela de quem estava morto em cada momento, a partir das kills. */
function montarMortes(eventos, frames) {
  const mortes = [];
  for (const e of eventos) {
    if (e.tipo !== 'CHAMPION_KILL') continue;
    const frame = frames.filter((f) => f.t <= e.t).at(-1);
    const nivel = frame?.dados[e.vitimaId]?.nivel ?? 1;
    const espera = RENASCER[Math.min(nivel, 18) - 1] * (e.t > 900_000 ? 1.3 : 1);
    mortes.push({ id: e.vitimaId, de: e.t, ate: e.t + espera * 1000 });
  }
  return mortes;
}

/**
 * Monta o objeto de partida a partir das partes ja normalizadas.
 * Tanto a LCU quanto a API da Riot desembocam aqui, pra que os detectores
 * nao precisem saber de onde o dado veio.
 */
export function criarPartida({ gameId, fila, duracaoS, vencedor, jogadores, frames, eventos }) {
  deduzirRoles(jogadores, frames);
  const mortes = montarMortes(eventos, frames);

  return {
    gameId, fila, duracaoS, vencedor, jogadores, frames, eventos, mortes,

    jogador(id) { return this.jogadores.find((j) => j.id === id); },
    frameEm(t) { return this.frames.filter((f) => f.t <= t).at(-1) ?? this.frames[0]; },
    vivo(id, t) { return !this.mortes.some((m) => m.id === id && t > m.de && t < m.ate); },

    /** Quem estava vivo e dentro de um raio de um ponto, num dado momento. */
    perto(ponto, t, raio, { time = null, exceto = [] } = {}) {
      const f = this.frameEm(t);
      return this.jogadores.filter((j) => {
        if (exceto.includes(j.id)) return false;
        if (time !== null && j.time !== time) return false;
        if (!this.vivo(j.id, t)) return false;
        const p = f.pos[j.id];
        return p && dist(p, ponto) <= raio;
      });
    },
  };
}

export { nomesDeCampeao };

/** Carrega uma partida do client e normaliza tudo num formato unico. */
export async function carregarPartida(lcu, gameId) {
  const [jogo, tl, campeoes] = await Promise.all([
    lcu.get(`/lol-match-history/v1/games/${gameId}`),
    lcu.get(`/lol-match-history/v1/game-timelines/${gameId}`),
    nomesDeCampeao(lcu),
  ]);

  const jogadores = jogo.participants.map((p) => {
    const ident = jogo.participantIdentities.find((x) => x.participantId === p.participantId);
    return {
      id: p.participantId,
      time: p.teamId,
      championId: p.championId,
      campeao: campeoes.get(p.championId) ?? `#${p.championId}`,
      nome: ident?.player?.gameName ?? ident?.player?.summonerName ?? '?',
      tag: ident?.player?.tagLine ?? null,
      puuid: ident?.player?.puuid ?? null,
      spells: [p.spell1Id, p.spell2Id],
      role: null,
      stats: p.stats,
    };
  });

  const frames = tl.frames.map((f) => {
    const pos = {}, dados = {};
    for (const [id, pf] of Object.entries(f.participantFrames)) {
      pos[Number(id)] = pf.position;
      dados[Number(id)] = {
        nivel: pf.level, ouro: pf.currentGold, ouroTotal: pf.totalGold,
        cs: pf.minionsKilled, csSelva: pf.jungleMinionsKilled, xp: pf.xp,
      };
    }
    return { t: f.timestamp, minuto: f.timestamp / 60000, pos, dados };
  });

  const eventos = tl.frames.flatMap((f) => f.events).map((e) => ({
    tipo: e.type, t: e.timestamp, minuto: e.timestamp / 60000, pos: e.position,
    autorId: e.killerId || null, vitimaId: e.victimId || null,
    assists: e.assistingParticipantIds ?? [],
    monstro: e.monsterType || null, subTipo: e.monsterSubType || null,
    predio: e.buildingType || null, torre: e.towerType || null, rota: e.laneType || null,
    timeVitima: e.teamId || null,
  })).sort((a, b) => a.t - b.t);

  const vencedor = jogo.teams.find((t) => t.win === 'Win')?.teamId ?? null;
  return criarPartida({ gameId, fila: jogo.queueId, duracaoS: jogo.gameDuration, vencedor, jogadores, frames, eventos });
}

export function mmss(ms) {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
