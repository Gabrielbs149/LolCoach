/**
 * Tira uma função de dentro de uma tela (.html) pra poder testá-la fora do navegador.
 *
 * Por que isto existe: o painel é uma tela só, com o JavaScript inline — e lá dentro mora
 * a conta que decide ONDE cada marcador de lineup é desenhado. Essa conta já errou duas
 * vezes do mesmo jeito (empurrou pra longe o ponto que ele tinha marcado a mão), e das
 * duas vezes só dava pra descobrir abrindo a tela e medindo. Um erro desses não pode
 * depender de alguém lembrar de olhar.
 *
 * Não é um interpretador: acha `function nome(` e conta chaves até fechar. Se a função for
 * renomeada ou sair da tela, isto falha alto — que é o certo, porque aí o teste que a
 * protege também precisa ser revisto.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** O texto da função `nome` dentro do arquivo, da palavra `function` até a chave que fecha. */
export function corpoDaFuncao(fonte, nome) {
  const i = fonte.indexOf(`function ${nome}(`);
  if (i < 0) throw new Error(`não achei "function ${nome}(" — foi renomeada ou saiu da tela?`);
  const abre = fonte.indexOf('{', i);
  if (abre < 0) throw new Error(`"${nome}" sem corpo`);
  let nivel = 0;
  for (let k = abre; k < fonte.length; k++) {
    const c = fonte[k];
    if (c === '{') nivel++;
    else if (c === '}') {
      nivel--;
      if (nivel === 0) return fonte.slice(i, k + 1);
    }
  }
  throw new Error(`"${nome}" não fecha as chaves`);
}

/**
 * Monta um módulo com as funções pedidas da tela, mais o `cercado` que você escrever
 * (as variáveis e funções de que elas dependem). Devolve o objeto com todas elas.
 */
export async function funcoesDaTela(tela, nomes, cercado = '') {
  const fonte = await readFile(resolve(AQUI, '..', 'src', 'ui', tela), 'utf8');
  const corpos = nomes.map((n) => corpoDaFuncao(fonte, n)).join('\n\n');
  const codigo = `${cercado}\n${corpos}\nreturn { ${nomes.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(codigo)();
}
