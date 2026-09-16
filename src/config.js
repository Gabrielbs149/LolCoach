import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhoConfig, garantirConfig } from './caminhos.js';

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * As chaves do Gabriel vão dentro do pacote (chave.json em resources, gerado
 * por scripts/publicar.js a partir do config dele — nunca entra no git):
 * a da Riot, pra ninguém precisar de chave própria, e o token do GitHub do
 * repositório privado de controle (quem usa, bloqueios, avisos).
 */
function chavesEmbutidas() {
  for (const arq of [join(process.resourcesPath ?? '', 'chave.json'), join(AQUI, '..', 'chave-embutida.json')]) {
    try {
      if (!existsSync(arq)) continue;
      return JSON.parse(readFileSync(arq, 'utf8'));
    } catch { /* arquivo estragado: segue sem */ }
  }
  return {};
}

const PADRAO = {
  autoAceitar: { ativo: true, atrasoMs: 0 },
  olho: { ligado: true },
  atalhos: { flashes: ['Control+Alt+1', 'Control+Alt+2', 'Control+Alt+3', 'Control+Alt+4', 'Control+Alt+5'], overlay: 'Control+Shift+O', painel: 'Control+Shift+L' },
  champSelect: { ativo: true, escolher: true, banir: true, travarPick: true, travarBan: true, picks: {}, bans: {} },
  runas: { ativo: true, criterio: 'popular', regiao: 'br', aplicarSpells: false },
  coleta: { ativo: true },
};

/** Junta o config do usuário por cima dos padrões, um nível de profundidade. */
export async function carregarConfig(caminho = null) {
  garantirConfig();
  caminho ??= caminhoConfig();
  let doUsuario = {};
  try {
    doUsuario = JSON.parse(await readFile(caminho, 'utf8'));
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw new Error(`config.json inválido: ${erro.message}`);
  }

  const final = {};
  for (const chave of new Set([...Object.keys(PADRAO), ...Object.keys(doUsuario)])) {
    if (chave.startsWith('_')) continue;
    const a = PADRAO[chave], b = doUsuario[chave];
    final[chave] = (a && typeof a === 'object' && !Array.isArray(a)) ? { ...a, ...(b ?? {}) } : (b ?? a);
  }
  // Só em memória: o config.json de quem instalou continua sem as chaves.
  const embutidas = chavesEmbutidas();
  if (!final.riot?.apiKey && embutidas.apiKey) {
    final.riot = { ...(final.riot ?? {}), apiKey: embutidas.apiKey, chaveEmbutida: true };
  }
  final.controle = { ...(final.controle ?? {}) };
  if (!final.controle.githubToken && embutidas.githubToken) final.controle.githubToken = embutidas.githubToken;
  if (!final.controle.githubToken && process.env.LOLCOACH_GH_TOKEN) final.controle.githubToken = process.env.LOLCOACH_GH_TOKEN;   // desenvolvimento
  return final;
}
