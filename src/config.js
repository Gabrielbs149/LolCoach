import { readFile } from 'node:fs/promises';
import { caminhoConfig, garantirConfig } from './caminhos.js';

const PADRAO = {
  autoAceitar: { ativo: true, atrasoMs: 1500 },
  champSelect: { ativo: true, travarPick: false, travarBan: true, picks: {}, bans: {} },
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
  return final;
}
