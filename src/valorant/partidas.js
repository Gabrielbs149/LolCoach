/**
 * O diário das partidas de Valorant: que mapa, que agente, de que hora a que hora.
 *
 * Por que isto existe: o Outplayed grava os clipes dele numa pasta por SESSÃO, e cada
 * clipe traz a hora no nome ("VALORANT 11-01-2026 21-29-19-146_7.mp4") — mas nada diz de
 * que MAPA era aquela partida. São mais de mil clipes sem essa informação.
 *
 * E quem sabe é o próprio app: ele já lê o estado do Valorant de 6 em 6 segundos e sabe o
 * mapa e o agente. Só nunca tinha escrito isso em lugar nenhum — o registro diz "Valorant
 * jogando: abrindo as lineups", sem o mapa.
 *
 * Então passa a escrever. A partir daqui, "o clipe das 21:29 de 01/11" vira "Lotus, de
 * Fade" sem ele precisar lembrar de nada. E é barato: uma linha por partida, só quando o
 * estado muda.
 *
 * O que NÃO está aqui de propósito: nada é lido dos vídeos. Isto é só a ponte entre a hora
 * do arquivo e o que ele estava jogando.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pastaBase } from '../caminhos.js';

const arquivo = () => resolve(pastaBase(), 'dados', 'valorant', 'partidas.json');
const FORMATO = 1;
/* Um ano de partidas cabe folgado aqui. O que importa é não crescer pra sempre: o arquivo
 * é lido inteiro, e ninguém quer um JSON de 10 MB pra responder "que mapa era às 21:29". */
const QUANTAS_GUARDAR = 500;

let diario = null;       // { formato, partidas: [...] }
let gravando = null;     // promessa da gravação em curso, pra não gravar duas vezes juntas

async function ler() {
  if (diario) return diario;
  try {
    const g = JSON.parse(await readFile(arquivo(), 'utf8'));
    diario = g?.formato === FORMATO && Array.isArray(g.partidas) ? g : { formato: FORMATO, partidas: [] };
  } catch { diario = { formato: FORMATO, partidas: [] }; }
  return diario;
}

async function gravar() {
  const d = diario;
  if (!d) return;
  // uma gravação de cada vez: duas ao mesmo tempo podem deixar o arquivo pela metade
  if (gravando) { await gravando.catch(() => {}); }
  gravando = (async () => {
    await mkdir(dirname(arquivo()), { recursive: true });
    await writeFile(arquivo(), JSON.stringify(d), 'utf8');
  })();
  await gravando.catch(() => {});
  gravando = null;
}

/**
 * Chamado a cada volta do laço do Valorant. Decide sozinho se abre, fecha ou ignora.
 *
 * Abre quando ele entra numa partida COM mapa conhecido. Fecha quando sai. Partida que
 * continua só tem o `fim` esticado — nada de uma linha por volta do laço.
 */
export async function anotarPartida({ estado = null, mapa = null, agenteId = null, fila = null, agora = Date.now() } = {}) {
  const d = await ler();
  const ultima = d.partidas[d.partidas.length - 1] ?? null;
  const emPartida = estado === 'jogando' && !!mapa;

  if (!emPartida) {
    // saiu: fecha a que estava aberta, se houver
    if (ultima && !ultima.fechada) { ultima.fechada = true; await gravar(); }
    return null;
  }

  // mesma partida? (mesmo mapa, ainda aberta, e sem um buraco grande no meio)
  const continua = ultima && !ultima.fechada && ultima.mapa === mapa
    && agora - ultima.fim < 5 * 60 * 1000;
  if (continua) {
    ultima.fim = agora;
    if (agenteId && !ultima.agenteId) ultima.agenteId = agenteId;
    await gravar();
    return ultima;
  }

  if (ultima && !ultima.fechada) ultima.fechada = true;
  const nova = { em: agora, fim: agora, mapa, agenteId: agenteId ?? null, fila: fila ?? null, fechada: false };
  d.partidas.push(nova);
  if (d.partidas.length > QUANTAS_GUARDAR) d.partidas.splice(0, d.partidas.length - QUANTAS_GUARDAR);
  await gravar();
  return nova;
}

/**
 * O que ele estava jogando numa certa hora — a pergunta que o clipe do Outplayed faz.
 *
 * A folga existe porque a gravação começa um pouco antes e termina um pouco depois do
 * que o app viu: o laço olha de 6 em 6 segundos, e o clipe guarda os segundos anteriores
 * ao lance. Dois minutos cobrem isso sem invadir a partida seguinte.
 */
export async function partidaEm(quando, { folga = 2 * 60 * 1000 } = {}) {
  const d = await ler();
  const t = Number(quando);
  if (!Number.isFinite(t)) return null;
  return d.partidas.find((p) => t >= p.em - folga && t <= p.fim + folga) ?? null;
}

/** Todas as partidas guardadas, da mais nova pra mais velha. */
export async function partidasGuardadas() {
  const d = await ler();
  return d.partidas.slice().reverse();
}

/** só pros testes: esquece o que está em memória */
export function esquecerDiario() { diario = null; }
