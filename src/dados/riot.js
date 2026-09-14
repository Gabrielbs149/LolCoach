import { criarPartida } from '../analise/partida.js';

/**
 * Cliente da API oficial da Riot.
 *
 * Traz o que a LCU não dá: wards, compras de item, level ups, placas de torre,
 * e o detalhe de dano de cada morte. E, principalmente, histórico profundo —
 * a LCU guarda ~20 partidas, aqui dá pra puxar centenas.
 */

// Limites da chave de desenvolvimento. Os limites por método que o portal
// mostra são bem maiores, mas o limite de APLICAÇÃO é o que se bate primeiro.
const LIMITES = [
  { max: 20, janelaMs: 1000 },
  { max: 100, janelaMs: 120_000 },
];

export class RiotApi {
  #chave;
  #rota;
  #regiao;
  #historico = [];
  #fila = Promise.resolve();

  constructor({ apiKey, rota = 'americas', regiao = 'br1' }) {
    if (!apiKey) throw new Error('sem chave da Riot — preencha riot.apiKey no config.json');
    this.#chave = apiKey;
    this.#rota = rota;
    this.#regiao = regiao;
  }

  /** Espera o suficiente pra não estourar nenhuma das janelas de limite. */
  async #aguardarVaga() {
    for (;;) {
      const agora = Date.now();
      this.#historico = this.#historico.filter((t) => agora - t < 120_000);

      let esperar = 0;
      for (const { max, janelaMs } of LIMITES) {
        const naJanela = this.#historico.filter((t) => agora - t < janelaMs);
        if (naJanela.length >= max) {
          esperar = Math.max(esperar, janelaMs - (agora - naJanela[naJanela.length - max]) + 50);
        }
      }
      if (!esperar) { this.#historico.push(agora); return; }
      await new Promise((r) => setTimeout(r, esperar));
    }
  }

  /** Uma requisição por vez, respeitando o limite e obedecendo o 429. */
  async #pedir(host, caminho) {
    const executar = async () => {
      for (let tentativa = 0; tentativa < 4; tentativa++) {
        await this.#aguardarVaga();
        let r;
        try {
          r = await fetch(`https://${host}.api.riotgames.com${caminho}`, {
            headers: { 'X-Riot-Token': this.#chave },
            signal: AbortSignal.timeout(10_000),
          });
        } catch (erro) {
          // Conexão que trava (a Riot derruba keep-alive de vez em quando) ou
          // rede piscando: tenta de novo em vez de perder a partida.
          if (tentativa === 3) throw new Error(`Riot API sem resposta em ${caminho} (${erro.name})`);
          await new Promise((res) => setTimeout(res, 500 * (tentativa + 1)));
          continue;
        }

        if (r.status === 429) {
          const espera = Number(r.headers.get('Retry-After') ?? 10);
          await new Promise((res) => setTimeout(res, (espera + 1) * 1000));
          continue;
        }
        if (r.status === 404) return null;
        if (r.status === 401 || r.status === 403) {
          throw new Error('chave da Riot inválida ou expirada (chave de desenvolvimento dura 24h)');
        }
        if (!r.ok) throw new Error(`Riot API HTTP ${r.status} em ${caminho}`);
        return r.json();
      }
      throw new Error(`desisti depois de vários 429 em ${caminho}`);
    };

    // Serializa: sem isso várias chamadas em paralelo furam o contador.
    const resultado = this.#fila.then(executar, executar);
    this.#fila = resultado.then(() => {}, () => {});
    return resultado;
  }

  contaPorRiotId(gameName, tagLine) {
    return this.#pedir(this.#rota, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
  }

  /** Lista de matchIds. `fila` opcional (420 = ranqueada solo). */
  idsDePartidas(puuid, { inicio = 0, quantas = 100, fila = null } = {}) {
    const q = new URLSearchParams({ start: String(inicio), count: String(Math.min(quantas, 100)) });
    if (fila) q.set('queue', String(fila));
    return this.#pedir(this.#rota, `/lol/match/v5/matches/by-puuid/${puuid}/ids?${q}`);
  }

  partida(matchId) { return this.#pedir(this.#rota, `/lol/match/v5/matches/${matchId}`); }
  timeline(matchId) { return this.#pedir(this.#rota, `/lol/match/v5/matches/${matchId}/timeline`); }
  elo(puuid) { return this.#pedir(this.#regiao, `/lol/league/v4/entries/by-puuid/${puuid}`); }
  summonerPorPuuid(puuid) { return this.#pedir(this.#regiao, `/lol/summoner/v4/summoners/by-puuid/${puuid}`); }
  maestriaTop(puuid, quantos = 5) {
    return this.#pedir(this.#regiao, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${quantos}`);
  }
}

/** Converte um evento da Riot pro formato interno. */
function normalizarEvento(e) {
  return {
    tipo: e.type,
    t: e.timestamp,
    minuto: e.timestamp / 60000,
    pos: e.position ?? null,
    autorId: e.killerId ?? e.creatorId ?? e.participantId ?? null,
    vitimaId: e.victimId ?? null,
    assists: e.assistingParticipantIds ?? [],
    monstro: e.monsterType ?? null,
    subTipo: e.monsterSubType ?? null,
    predio: e.buildingType ?? null,
    torre: e.towerType ?? null,
    rota: e.laneType ?? null,
    timeVitima: e.teamId ?? null,
    // Campos que só existem na API oficial:
    wardType: e.wardType ?? null,
    itemId: e.itemId ?? null,
    skillSlot: e.skillSlot ?? null,
    danoRecebido: e.victimDamageReceived ?? null,
    danoCausado: e.victimDamageDealt ?? null,
    bounty: e.bounty ?? 0,
    shutdownBounty: e.shutdownBounty ?? 0,
    sequencia: e.killStreakLength ?? 0,
    nivel: e.level ?? null,
  };
}

/**
 * Carrega uma partida pela API oficial, no MESMO formato que a LCU produz.
 * Os detectores não sabem de onde veio — só que agora tem mais evento.
 */
export async function carregarPartidaDaRiot(riot, matchId) {
  const [jogo, tl] = await Promise.all([riot.partida(matchId), riot.timeline(matchId)]);
  if (!jogo || !tl) throw new Error(`partida ${matchId} não encontrada na API`);

  const info = jogo.info;
  const jogadores = info.participants.map((p) => ({
    id: p.participantId,
    time: p.teamId,
    championId: p.championId,
    campeao: p.championName,
    nome: p.riotIdGameName || p.summonerName || '?',
    spells: [p.summoner1Id, p.summoner2Id],
    role: null,
    stats: p, // a Riot já entrega tudo achatado no participante
  }));

  const frames = tl.info.frames.map((f) => {
    const pos = {}, dados = {};
    for (const [id, pf] of Object.entries(f.participantFrames)) {
      const n = Number(id);
      pos[n] = pf.position;
      dados[n] = {
        nivel: pf.level, ouro: pf.currentGold, ouroTotal: pf.totalGold,
        cs: pf.minionsKilled, csSelva: pf.jungleMinionsKilled, xp: pf.xp,
        // Só existem aqui: úteis pra saber se você tinha vida/dano pra estar onde estava.
        stats: pf.championStats ?? null,
        dano: pf.damageStats ?? null,
        tempoSobControle: pf.timeEnemySpentControlled ?? null,
      };
    }
    return { t: f.timestamp, minuto: f.timestamp / 60000, pos, dados };
  });

  const eventos = tl.info.frames
    .flatMap((f) => f.events)
    .map(normalizarEvento)
    .sort((a, b) => a.t - b.t);

  const vencedor = info.teams.find((t) => t.win)?.teamId ?? null;
  const gameId = Number(String(matchId).split('_')[1] ?? info.gameId);

  const p = criarPartida({
    gameId, fila: info.queueId, duracaoS: info.gameDuration, vencedor, jogadores, frames, eventos,
  });
  p.matchId = matchId;
  p.quando = new Date(info.gameCreation).toISOString();
  p.fonte = 'riot';
  return p;
}
