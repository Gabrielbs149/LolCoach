import https from 'node:https';

/**
 * Controle de replay.
 *
 * São duas APIs diferentes:
 *  - a LCU (client) cuida de baixar e abrir o .rofl
 *  - o JOGO, enquanto o replay roda, sobe uma API própria em 127.0.0.1:2999
 *    que aceita comandos de tempo, velocidade e câmera
 *
 * Limite que não dá pra contornar: replay só toca no patch em que foi gravado.
 * Depois de um patch novo, o arquivo vira inútil.
 */

const agente = new https.Agent({ rejectUnauthorized: false });
const BASE_JOGO = 'https://127.0.0.1:2999';

function pedir(metodo, url, corpo) {
  const payload = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: metodo,
      agent: agente,
      headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) },
    }, (res) => {
      const p = [];
      res.on('data', (d) => p.push(d));
      res.on('end', () => {
        const txt = Buffer.concat(p).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error(`${metodo} ${url} -> HTTP ${res.statusCode}`));
        try { resolve(txt ? JSON.parse(txt) : null); } catch { resolve(txt); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------- lado do client */

export async function configuracaoDeReplay(lcu) {
  return lcu.get('/lol-replays/v1/configuration');
}

/** Estado do arquivo: 'download' (baixando), 'watch' (pronto), ou ausente. */
export async function estadoDoArquivo(lcu, gameId) {
  return lcu.get(`/lol-replays/v1/metadata/${gameId}`).catch(() => null);
}

/**
 * Pede o download do .rofl e espera ficar pronto.
 * Escreve um arquivo grande (~700 MB no caso das partidas longas) na pasta de
 * replays, então isso fica desligado por padrão no config.
 */
export async function baixarReplay(lcu, gameId, { tentativas = 60, esperaMs = 5000 } = {}) {
  await lcu.post(`/lol-replays/v1/rofls/${gameId}/download`, { componentType: 'lolcoach' });

  for (let i = 0; i < tentativas; i++) {
    const m = await estadoDoArquivo(lcu, gameId);
    if (m?.state === 'watch') return m;
    if (m?.state === 'lost' || m?.state === 'incompatible') throw new Error(`replay indisponível (${m.state})`);
    await new Promise((r) => setTimeout(r, esperaMs));
  }
  throw new Error('download do replay não terminou a tempo');
}

/** Abre o replay no client. O jogo leva uns 20-40s pra carregar. */
export async function assistirReplay(lcu, gameId) {
  return lcu.post(`/lol-replays/v1/rofls/${gameId}/watch`, { componentType: 'lolcoach' });
}

export async function pastaDeReplays(lcu) {
  return lcu.get('/lol-replays/v1/rofls/path');
}

/* ------------------------------------------- lado do jogo (porta 2999) */

/** true quando a API do jogo já está no ar (replay carregado). */
export async function jogoNoAr() {
  try {
    await pedir('GET', `${BASE_JOGO}/replay/playback`);
    return true;
  } catch { return false; }
}

/** Espera o replay terminar de carregar. */
export async function esperarReplayCarregar({ tentativas = 40, esperaMs = 3000 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    if (await jogoNoAr()) return true;
    await new Promise((r) => setTimeout(r, esperaMs));
  }
  return false;
}

/** { length, paused, seeking, speed, time } — tempo em segundos. */
export const lerPlayback = () => pedir('GET', `${BASE_JOGO}/replay/playback`);

/** Pula pro segundo pedido do replay. */
export async function irPara(segundos, { pausar = false, velocidade = 1 } = {}) {
  return pedir('POST', `${BASE_JOGO}/replay/playback`, {
    time: Math.max(0, segundos), paused: pausar, speed: velocidade, seeking: true,
  });
}

/** Estado da câmera, névoa de guerra e efeitos. */
export const lerRender = () => pedir('GET', `${BASE_JOGO}/replay/render`);
export const ajustarRender = (opcoes) => pedir('POST', `${BASE_JOGO}/replay/render`, opcoes);

/** Dados vivos no instante atual do replay (placar, itens, eventos — sem posições). */
export const dadosDaPartida = () => pedir('GET', `${BASE_JOGO}/liveclientdata/allgamedata`);

/**
 * Abre um replay e para no segundo pedido. É o que transforma um apontamento
 * do relatório em "assistir o erro acontecer".
 */
export async function abrirEm(lcu, gameId, segundos, { pausar = true, recuoS = 12 } = {}) {
  const meta = await estadoDoArquivo(lcu, gameId);
  if (meta?.state !== 'watch') await baixarReplay(lcu, gameId);

  await assistirReplay(lcu, gameId);
  const carregou = await esperarReplayCarregar();
  if (!carregou) throw new Error('o replay não abriu a tempo');

  // Recua um pouco: o erro quase sempre começa antes do evento em si.
  await irPara(Math.max(0, segundos - recuoS), { pausar });
  return true;
}
