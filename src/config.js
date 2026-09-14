import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhoConfig, garantirConfig } from './caminhos.js';

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * A chave da Riot do Gabriel vai dentro do pacote (chave.json em resources,
 * gerado por scripts/publicar.js a partir do config dele — nunca entra no
 * git). Quem não tem chave própria usa essa: ninguém dos amigos precisa
 * criar conta de desenvolvedor pra ver a aba Amigos e puxar histórico.
 */
function chaveEmbutida() {
  for (const arq of [join(process.resourcesPath ?? '', 'chave.json'), join(AQUI, '..', 'chave-embutida.json')]) {
    try {
      if (!existsSync(arq)) continue;
      const { apiKey } = JSON.parse(readFileSync(arq, 'utf8'));
      if (apiKey) return apiKey;
    } catch { /* arquivo estragado: segue sem */ }
  }
  return null;
}

const PADRAO = {
  autoAceitar: { ativo: true, atrasoMs: 0 },
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
  // Só em memória: o config.json de quem instalou continua sem a chave.
  if (!final.riot?.apiKey) {
    const chave = chaveEmbutida();
    if (chave) final.riot = { ...(final.riot ?? {}), apiKey: chave, chaveEmbutida: true };
  }
  return final;
}
