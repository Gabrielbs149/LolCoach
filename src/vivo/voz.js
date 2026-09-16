import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Voz do coach pelo ElevenLabs — a única que clona a voz dele. O app só
 * manda o texto e toca o mp3 que volta; a chave fica no config.json do PC.
 * Cada frase vira um arquivo em dados/voz (frase repetida não gasta cota).
 */
const API = 'https://api.elevenlabs.io/v1';
const MODELO_PADRAO = 'eleven_flash_v2_5';   // o mais rápido; entende pt-BR

function erroDaApi(resp, corpo) {
  if (resp.status === 401) return new Error('chave do ElevenLabs inválida');
  if (resp.status === 402 || /quota/i.test(corpo)) return new Error('cota do ElevenLabs acabou');
  if (resp.status === 404) return new Error('voz não encontrada na sua conta');
  let detalhe = '';
  try { detalhe = JSON.parse(corpo)?.detail?.message ?? JSON.parse(corpo)?.detail?.status ?? ''; } catch { /* texto cru */ }
  return new Error(`ElevenLabs ${resp.status}${detalhe ? `: ${detalhe}` : ''}`);
}

export async function vozesEleven(chave) {
  const resp = await fetch(`${API}/voices`, { headers: { 'xi-api-key': chave } });
  if (!resp.ok) throw erroDaApi(resp, await resp.text().catch(() => ''));
  const { voices = [] } = await resp.json();
  return voices.map((v) => ({ id: v.voice_id, nome: v.name, categoria: v.category, idioma: v.labels?.language ?? null, minha: v.category === 'cloned' || v.category === 'generated' }))
    .sort((a, b) => (b.minha - a.minha) || a.nome.localeCompare(b.nome));
}

export async function cotaEleven(chave) {
  const resp = await fetch(`${API}/user/subscription`, { headers: { 'xi-api-key': chave } });
  if (!resp.ok) throw erroDaApi(resp, await resp.text().catch(() => ''));
  const s = await resp.json();
  return { usado: s.character_count ?? 0, limite: s.character_limit ?? 0, plano: s.tier ?? null };
}

export async function falarEleven({ chave, vozId, modelo = MODELO_PADRAO, texto, pasta }) {
  texto = String(texto ?? '').trim().slice(0, 400);
  if (!chave) throw new Error('sem chave do ElevenLabs');
  if (!vozId) throw new Error('escolha a voz na Configuração');
  if (!texto) throw new Error('nada pra falar');
  const dir = join(pasta, 'voz');
  const nome = `${vozId}-${createHash('sha1').update(`${modelo}|${texto}`).digest('hex').slice(0, 20)}.mp3`;
  const caminho = join(dir, nome);
  try { return await readFile(caminho); } catch { /* ainda não falou essa */ }

  const corpo = {
    text: texto, model_id: modelo,
    voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
  };
  if (/v2_5|v3/.test(modelo)) corpo.language_code = 'pt';
  const resp = await fetch(`${API}/text-to-speech/${vozId}?output_format=mp3_22050_32`, {
    method: 'POST', headers: { 'xi-api-key': chave, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) throw erroDaApi(resp, await resp.text().catch(() => ''));
  const mp3 = Buffer.from(await resp.arrayBuffer());
  await mkdir(dir, { recursive: true }).then(() => writeFile(caminho, mp3)).catch(() => {});
  return mp3;
}
