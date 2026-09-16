import https from 'node:https';

/**
 * Lê a partida em andamento pela API que o próprio jogo expõe em 127.0.0.1:2999.
 *
 * É leitura pura por HTTP numa porta que a Riot abre de propósito — o mesmo que
 * Blitz e Porofessor usam. Nada é injetado no jogo e nada é enviado como
 * comando: se um dia isso mudar, a ferramenta vira risco de banimento.
 *
 * Limite importante: esta API **não dá posição de ninguém**. Dá placar, itens,
 * ouro, nível, vida e a lista de acontecimentos. Então dá pra falar de timing,
 * economia e ameaça — não de posicionamento no mapa.
 */

const agente = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const BASE = 'https://127.0.0.1:2999/liveclientdata';

function pegar(caminho, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = https.get(`${BASE}${caminho}`, { agent: agente, timeout: timeoutMs }, (res) => {
      const p = [];
      res.on('data', (d) => p.push(d));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(p).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

const TIME = { ORDER: 100, CHAOS: 200 };
const ROLE = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'sup' };

/** true se existe partida rodando agora. */
export async function emJogo() {
  try { await pegar('/gamestats', 1500); return true; } catch { return false; }
}

/**
 * Estado da partida em andamento, já normalizado.
 * Devolve null quando não há jogo — o chamador não precisa tratar exceção.
 */
export async function lerEstado() {
  let bruto;
  try { bruto = await pegar('/allgamedata'); } catch { return null; }
  if (!bruto?.allPlayers?.length) return null;

  const eu0 = bruto.activePlayer ?? {};
  const meuNome = eu0.riotId ?? eu0.summonerName ?? '';
  const achaEu = (p) => (p.riotId && p.riotId === meuNome) || p.summonerName === meuNome;

  const jogadores = bruto.allPlayers.map((p) => ({
    nome: p.riotId ?? p.summonerName,
    campeao: p.championName,
    time: TIME[p.team] ?? 100,
    role: ROLE[p.position] ?? (p.position || '').toLowerCase(),
    nivel: p.level,
    morto: !!p.isDead,
    renasceEm: Math.round(p.respawnTimer ?? 0),
    kills: p.scores?.kills ?? 0,
    mortes: p.scores?.deaths ?? 0,
    assists: p.scores?.assists ?? 0,
    cs: p.scores?.creepScore ?? 0,
    visao: p.scores?.wardScore ?? 0,
    itens: (p.items ?? []).map((i) => ({ id: i.itemID, nome: i.displayName, preco: i.price })),
    spells: [p.summonerSpells?.summonerSpellOne?.displayName, p.summonerSpells?.summonerSpellTwo?.displayName]
      .filter(Boolean),
    souEu: achaEu(p),
  }));

  const eu = jogadores.find((j) => j.souEu) ?? null;
  // Nos eventos a Riot escreve o nome de um jeito (só o gameName, ou o
  // summonerName antigo) e em allPlayers de outro (riotId "nome#tag"). Sem
  // igualar os dois, "quem pegou o dragão" nunca bate com ninguém do time.
  const apelidos = new Map();
  for (const p of bruto.allPlayers) {
    const canon = p.riotId ?? p.summonerName;
    for (const a of [p.riotId, p.summonerName, p.riotIdGameName, String(p.riotId ?? '').split('#')[0], String(p.summonerName ?? '').split('#')[0]]) {
      if (a) apelidos.set(String(a).trim().toLowerCase(), canon);
    }
  }
  const canonico = (n) => (n == null ? null : (apelidos.get(String(n).trim().toLowerCase()) ?? n));
  const eventos = (bruto.events?.Events ?? []).map((e) => ({
    id: e.EventID,
    tipo: e.EventName,
    t: e.EventTime ?? 0,
    autor: canonico(e.KillerName ?? e.Recipient ?? e.Acer ?? null),
    vitima: canonico(e.VictimName ?? null),
    // Quem ajudou na kill também estava lá — é o que permite dizer onde o
    // jungler inimigo apareceu por último sem ler posição de ninguém.
    assistentes: Array.isArray(e.Assisters) ? e.Assisters.map(canonico) : [],
    dragao: e.DragonType ?? null,
    torre: e.TurretKilled ?? null,
    roubado: e.Stolen === 'True',
  }));

  const stats = eu0.championStats ?? {};

  return {
    tempo: bruto.gameData?.gameTime ?? 0,
    modo: bruto.gameData?.gameMode ?? '',
    eu: eu && {
      ...eu,
      ouro: Math.round(eu0.currentGold ?? 0),
      vida: Math.round(stats.currentHealth ?? 0),
      vidaMax: Math.round(stats.maxHealth ?? 0),
    },
    jogadores,
    eventos,
  };
}
