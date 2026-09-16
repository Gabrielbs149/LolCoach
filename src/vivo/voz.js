import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

/**
 * Voz do coach pelas vozes neurais do Edge ("ler em voz alta"): grátis, sem
 * conta, pt-BR de verdade. Texto entra, mp3 sai; cada frase vira um arquivo
 * em dados/voz, então frase repetida não vai de novo pra Microsoft. Se a
 * internet cair, a janela ao vivo cai pra voz do Windows sozinha.
 */

// As que falam português. As "multilingual" de outros países falam pt-BR com
// sotaque leve — ficam como opção, marcadas.
export const VOZES = [
  { id: 'pt-BR-AntonioNeural', nome: 'Antonio', genero: 'homem' },
  { id: 'pt-BR-FranciscaNeural', nome: 'Francisca', genero: 'mulher' },
  { id: 'pt-BR-ThalitaMultilingualNeural', nome: 'Thalita', genero: 'mulher' },
  { id: 'pt-PT-DuarteNeural', nome: 'Duarte', genero: 'homem', sotaque: 'Portugal' },
  { id: 'pt-PT-RaquelNeural', nome: 'Raquel', genero: 'mulher', sotaque: 'Portugal' },
  { id: 'en-US-AndrewMultilingualNeural', nome: 'Andrew', genero: 'homem', sotaque: 'gringo' },
  { id: 'en-US-BrianMultilingualNeural', nome: 'Brian', genero: 'homem', sotaque: 'gringo' },
  { id: 'en-US-AvaMultilingualNeural', nome: 'Ava', genero: 'mulher', sotaque: 'gringo' },
  { id: 'en-US-EmmaMultilingualNeural', nome: 'Emma', genero: 'mulher', sotaque: 'gringo' },
  { id: 'fr-FR-RemyMultilingualNeural', nome: 'Remy', genero: 'homem', sotaque: 'francês' },
  { id: 'fr-FR-VivienneMultilingualNeural', nome: 'Vivienne', genero: 'mulher', sotaque: 'francês' },
  { id: 'de-DE-FlorianMultilingualNeural', nome: 'Florian', genero: 'homem', sotaque: 'alemão' },
  { id: 'de-DE-SeraphinaMultilingualNeural', nome: 'Seraphina', genero: 'mulher', sotaque: 'alemão' },
  { id: 'it-IT-GiuseppeMultilingualNeural', nome: 'Giuseppe', genero: 'homem', sotaque: 'italiano' },
];
export const VOZ_PADRAO = 'pt-BR-AntonioNeural';
const RITMOS = new Set(['-10%', '0%', '+5%', '+10%', '+15%', '+20%']);

let cliente = null, clienteCfg = '';
// Um pedido por vez: o websocket do Edge embaralha os pedaços de áudio de dois pedidos ao mesmo tempo.
let fila = Promise.resolve();
const umPorVez = (fn) => { const p = fila.then(fn, fn); fila = p.catch(() => {}); return p; };
const comTempo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('a voz demorou demais')), ms))]);
async function clienteParaVoz(vozId, ritmo) {
  const chave = `${vozId}|${ritmo}`;
  if (cliente && clienteCfg === chave) return cliente;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(vozId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { rate: ritmo });
  try { cliente?.close?.(); } catch { /* já fechado */ }
  cliente = tts; clienteCfg = chave;
  return tts;
}

export async function falarEdge({ vozId = VOZ_PADRAO, ritmo = '+5%', texto, pasta }) {
  texto = String(texto ?? '').trim().slice(0, 400);
  if (!texto) throw new Error('nada pra falar');
  if (!VOZES.some((v) => v.id === vozId)) vozId = VOZ_PADRAO;
  if (!RITMOS.has(ritmo)) ritmo = '+5%';
  const dir = join(pasta, 'voz');
  const caminho = join(dir, `${vozId}-${createHash('sha1').update(`${ritmo}|${texto}`).digest('hex').slice(0, 20)}.mp3`);
  try { return await readFile(caminho); } catch { /* ainda não falou essa */ }

  const gerar = async () => {
    const tts = await clienteParaVoz(vozId, ritmo);
    const { audioStream } = tts.toStream(texto);
    const partes = [];
    for await (const p of audioStream) partes.push(p);
    return Buffer.concat(partes);
  };
  let mp3;
  await umPorVez(async () => {
    try { mp3 = await comTempo(gerar(), 6000); }
    catch { cliente = null; clienteCfg = ''; mp3 = await comTempo(gerar(), 6000); }   // conexão caiu: reabre uma vez
  });
  if (!mp3.length) throw new Error('a Microsoft não devolveu áudio');
  await mkdir(dir, { recursive: true }).then(() => writeFile(caminho, mp3)).catch(() => {});
  return mp3;
}
