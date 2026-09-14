import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * Onde ficam os arquivos que o usuário mexe (config.json) e os que crescem
 * (dados/partidas.db, relatórios).
 *
 * Rodando pelo `npm run`, é a pasta do projeto. Rodando pelo .exe portátil,
 * `process.cwd()` não serve — o executável se descompacta num diretório
 * temporário e tudo se perderia no próximo boot. O electron-builder expõe
 * PORTABLE_EXECUTABLE_DIR com a pasta onde o .exe realmente está, que é onde
 * o usuário espera encontrar o config e o banco.
 */
export function pastaBase() {
  // Ordem: instalado (LOLCOACH_DIR = %APPDATA%\LolCoach, definido pelo
  // electron/main.js) > portátil (pasta do .exe) > rodando pelo npm (projeto).
  return process.env.LOLCOACH_DIR
    ?? process.env.PORTABLE_EXECUTABLE_DIR
    ?? process.cwd();
}

export const caminhoConfig = () => resolve(pastaBase(), 'config.json');
export const caminhoBanco = () => resolve(pastaBase(), 'dados', 'partidas.db');

/** Lista de campeões guardada em disco, pra tela de configuração funcionar
 *  com o League fechado. */
export const caminhoCampeoes = () => resolve(pastaBase(), 'dados', 'campeoes.json');

/**
 * Garante que existe um config.json editável ao lado do executável.
 * O modelo vai junto no pacote, mas nunca é lido direto: se ficasse só dentro
 * do .exe o usuário não conseguiria editar nada, e a chave da API estaria
 * embutida no binário.
 */
export function garantirConfig() {
  const destino = caminhoConfig();
  if (existsSync(destino)) return { caminho: destino, criado: false };

  mkdirSync(dirname(destino), { recursive: true });
  for (const modelo of [
    join(AQUI, '..', 'config.exemplo.json'),
    join(process.resourcesPath ?? '', 'config.exemplo.json'),
  ]) {
    if (existsSync(modelo)) {
      copyFileSync(modelo, destino);
      return { caminho: destino, criado: true };
    }
  }
  return { caminho: destino, criado: false, semModelo: true };
}
