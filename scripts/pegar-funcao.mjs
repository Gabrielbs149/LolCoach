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
  /* O `async` vem junto. Sem ele, uma função assíncrona da tela chega aqui como função
   * comum e o `await` de dentro vira SyntaxError — o teste morre antes de testar nada. */
  const antes = /async\s+$/.exec(fonte.slice(Math.max(0, i - 12), i));
  const inicio = antes ? i - antes[0].length : i;

  /* A chave do CORPO vem depois da lista de parâmetros fechar.
   *
   * Pegar a primeira `{` depois do nome parece dar no mesmo, e dá — até a função receber um
   * parâmetro desestruturado. Aí a primeira `{` é a do parâmetro, a contagem fecha nela, e
   * o que volta é meia assinatura: `function f(a, { b = 1 }`. Compila em nada. */
  const abreP = fonte.indexOf('(', i);
  let parens = 0, fimP = -1;
  for (let k = abreP; k < fonte.length; k++) {
    if (fonte[k] === '(') parens++;
    else if (fonte[k] === ')' && --parens === 0) { fimP = k; break; }
  }
  if (fimP < 0) throw new Error(`"${nome}" não fecha os parênteses`);
  const abre = fonte.indexOf('{', fimP);
  if (abre < 0) throw new Error(`"${nome}" sem corpo`);
  let nivel = 0;
  for (let k = abre; k < fonte.length; k++) {
    const c = fonte[k];
    if (c === '{') nivel++;
    else if (c === '}') {
      nivel--;
      if (nivel === 0) return fonte.slice(inicio, k + 1);
    }
  }
  throw new Error(`"${nome}" não fecha as chaves`);
}

/**
 * Monta um módulo com as funções pedidas da tela, mais o `cercado` que você escrever
 * (as variáveis e funções de que elas dependem). Devolve o objeto com todas elas.
 *
 * Se o cercado definir `const extras = { ... }`, o que estiver ali vem junto — é por onde
 * o teste mexe no estado que a tela guarda em variável solta (`lnClipe`, `lnMarcando`).
 */
/**
 * A linha `const NOME = ...;` como está escrita na tela.
 *
 * Serve pra constante que o teste precisa CONFERIR, não só ter: redeclarar o valor no
 * cercado faria o teste passar contra um número inventado por ele mesmo. Uma linha só, que
 * é como essas constantes são escritas no painel.
 */
export function constanteDaTela(fonte, nome) {
  const m = new RegExp(`^const ${nome}\\s*=.*?;\\s*$`, 'm').exec(fonte);
  if (!m) throw new Error(`não achei "const ${nome} = ...;" numa linha só — foi renomeada ou quebrada em várias linhas?`);
  return m[0];
}

export async function funcoesDaTela(tela, nomes, cercado = '', constantes = []) {
  const fonte = await readFile(resolve(AQUI, '..', 'src', 'ui', tela), 'utf8');
  const consts = constantes.map((n) => constanteDaTela(fonte, n)).join('\n');
  const corpos = [consts, nomes.map((n) => corpoDaFuncao(fonte, n)).join('\n\n')].filter(Boolean).join('\n\n');
  const codigo = `${cercado}\n${corpos}\n`
    + `return Object.assign({}, typeof extras === 'undefined' ? {} : extras, { ${nomes.join(', ')} });`;
  // eslint-disable-next-line no-new-func
  return new Function(codigo)();
}
