/**
 * conferir-tela.mjs — o corretor das TELAS.
 *
 * Por que isto existe: `conferir-sintaxe.mjs` garante que o JavaScript das telas COMPILA,
 * e `testes.mjs` garante que a lógica de fora da tela está certa. Entre os dois sobrava um
 * buraco enorme, e é dele que saía a maior parte do "arrumei um, apareceu outro":
 *
 *   - um `onclick="fazerCoisa()"` para uma função renomeada ou apagada: compila, e no
 *     clique o botão simplesmente não faz nada (o erro fica no console, que ele não abre);
 *   - um `$('#algo')` para um id que nenhum template cria mais: compila, e a tela deixa
 *     de pintar aquele pedaço, calada;
 *   - uma classe usada no HTML que não tem regra de CSS: compila, e o elemento aparece
 *     sem estilo nenhum;
 *   - DUAS regras de CSS com exatamente o mesmo seletor de classe, em lugares diferentes
 *     do arquivo, mexendo na mesma propriedade: compila, e quem ganha é a ORDEM do
 *     arquivo. Isto já quebrou duas telas aqui — `.lnLinha` do mapa colidiu com a linha
 *     da lista e espalhou linhas invisíveis por cima de tudo, e `.lnMini` deixou o
 *     mapinha com 619 px porque a regra base vinha depois da do @media;
 *   - um `var(--cor-que-nao-existe)`: compila, e a cor sai transparente.
 *
 * Tudo isso é achável sem abrir navegador, em menos de um segundo, lendo o arquivo. É o
 * que este corretor faz. Erro (sai 1) só pro que QUEBRA de verdade; o resto sai como
 * aviso, pra não travar uma publicação às três da manhã por causa de classe morta.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Todo o código do projeto num texto só, pra responder "este nome de classe aparece em
 * algum lugar?". Tem que ser o projeto INTEIRO e não só a tela: metade das classes do
 * painel é escrita por outro arquivo (`patchnotes.js` monta `campeao-modo`,
 * `relatorio-html.js` monta as `t2`/`t3`), e olhar só a tela diria que estão mortas.
 * O CSS das próprias telas sai fora — senão toda classe se acha usada por si mesma.
 */
let _codigo = null;
function codigoDoProjeto() {
  if (_codigo !== null) return _codigo;
  const pedacos = [];
  const andar = (pasta) => {
    for (const nome of readdirSync(pasta)) {
      const p = join(pasta, nome);
      if (statSync(p).isDirectory()) { if (nome !== 'node_modules') andar(p); continue; }
      // .css fica FORA: folha de estilo é declaração, não uso — se contasse, toda classe
      // se acharia usada por si mesma e nada nunca estaria morto
      if (!['.js', '.mjs', '.cjs', '.html', '.json'].includes(extname(nome))) continue;
      let t = readFileSync(p, 'utf8');
      if (extname(nome) === '.html') t = t.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
      pedacos.push(t);
    }
  };
  for (const pasta of ['src', 'electron', 'scripts']) {
    try { andar(join(RAIZ, pasta)); } catch { /* pasta que não existe neste checkout */ }
  }
  _codigo = pedacos.join('\n');
  return _codigo;
}

/* ── o que é global e pode ser chamado sem estar declarado na tela ─────────────────── */
const DO_NAVEGADOR = new Set([
  'alert', 'confirm', 'prompt', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date',
  'RegExp', 'Error', 'Promise', 'Map', 'Set', 'WeakMap', 'Symbol', 'BigInt', 'Intl',
  'structuredClone', 'queueMicrotask', 'open', 'close', 'print', 'blur', 'focus',
  'scrollTo', 'scrollBy', 'getComputedStyle', 'matchMedia', 'atob', 'btoa', 'Image',
  'Audio', 'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'FileReader',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'AbortController',
  'CustomEvent', 'Event', 'DOMParser', 'XMLHttpRequest', 'WebSocket', 'Worker',
  'performance', 'navigator', 'location', 'history', 'document', 'window', 'console',
  'YT', 'onYouTubeIframeAPIReady', 'require', 'module', 'exports', 'process',
  // palavras da linguagem que a varredura de "nome(" pode pegar sem querer
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new',
  'await', 'void', 'delete', 'in', 'of', 'do', 'else', 'try', 'throw', 'super',
]);

/* ── propriedades em que duas regras iguais brigando NÃO é problema de verdade ─────── */
const PROP_INOFENSIVA = new Set(['content', 'transition', 'animation', 'cursor', 'will-change']);

/**
 * Os pedaços de um arquivo de tela: o CSS dos <style>, o CSS das folhas LIGADAS por
 * <link> (o painel usa /identidade.css, que é de todo mundo) e o JS dos <script> sem src.
 *
 * Separar o CSS próprio do emprestado importa: uma classe que só existe no identidade.css
 * e não é usada NESTA tela pode muito bem estar sendo usada em outra, então não é morta.
 */
/**
 * Deixa só o que está dentro das marcas pedidas e apaga o resto com espaço, mantendo as
 * quebras de linha. É o que faz o número da linha do aviso ser o número de linha DO
 * ARQUIVO — recortar os pedaços e juntar dava linha de um texto que não existe, e um
 * aviso com linha errada é pior que aviso nenhum.
 */
function soDentroDe(txt, re) {
  const out = txt.replace(/[^\n]/g, ' ').split('');
  for (const m of txt.matchAll(re)) {
    const ini = m.index + m[1].length;
    for (let i = 0; i < m[2].length; i++) out[ini + i] = m[2][i];
  }
  return out.join('');
}

function partes(txt, pasta) {
  const css = soDentroDe(txt, /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi);
  let emprestado = '';
  for (const m of txt.matchAll(/<link[^>]*rel\s*=\s*"stylesheet"[^>]*>/gi)) {
    const href = m[0].match(/href\s*=\s*"([^"]+)"/)?.[1] ?? '';
    if (!href || /^https?:/i.test(href)) continue;
    try { emprestado += `\n${readFileSync(join(pasta, href.replace(/^\//, '')), 'utf8')}`; }
    catch { /* folha que não é um arquivo nosso: o servidor que explique */ }
  }
  const js = soDentroDe(txt, /(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi);
  return { css, emprestado, js };
}

/** a linha de um índice dentro do texto, pra mensagem de erro ser clicável */
const linhaDe = (txt, i) => txt.slice(0, i).split('\n').length;

/* ── 1. o que a tela declara ──────────────────────────────────────────────────────── */
function funcoesDeclaradas(js) {
  const n = new Set();
  for (const m of js.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) n.add(m[1]);
  for (const m of js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) n.add(m[1]);
  for (const m of js.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) n.add(m[1]);
  for (const m of js.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) n.add(m[1]);
  return n;
}

/* ── 2. handlers escritos no HTML: onclick="isto()" ───────────────────────────────── */
const EVENTOS = 'click|change|input|keydown|keyup|keypress|submit|focus|blur|load|error'
  + '|mouseenter|mouseleave|mousedown|mouseup|mousemove|wheel|contextmenu|dblclick|toggle';
function handlers(txt) {
  const achados = [];
  for (const m of txt.matchAll(new RegExp(`\\bon(${EVENTOS})\\s*=\\s*"([^"]*)"`, 'gi'))) {
    for (const c of m[2].matchAll(/(^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g)) {
      achados.push({ nome: c[2], linha: linhaDe(txt, m.index), onde: `on${m[1]}` });
    }
  }
  return achados;
}

/* ── 3. ids: quem é procurado no JS e quem é criado em algum template ─────────────── */
function idsProcurados(js) {
  const r = [];
  const pegar = (re) => {
    for (const m of js.matchAll(re)) r.push({ id: m[1], linha: linhaDe(js, m.index) });
  };
  pegar(/\$\(\s*['"]#([\w-]+)['"]\s*\)/g);
  pegar(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g);
  pegar(/querySelector(?:All)?\(\s*['"]#([\w-]+)['"]\s*\)/g);
  return r;
}
function idsCriados(txt) {
  const s = new Set();
  // id="algo" — mas não os montados na hora (id="ln${i}"), que não dá pra conferir aqui
  for (const m of txt.matchAll(/\bid\s*=\s*"([^"${}]+)"/g)) s.add(m[1]);
  for (const m of txt.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) s.add(m[1]);
  return s;
}

/* ── 4. classes: quem é usada e quem tem regra ────────────────────────────────────── */
function classesUsadas(txt) {
  const r = [];
  for (const m of txt.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) {
    // tira as interpolações, mas aproveita as strings de dentro delas:
    //   class="fala ${v ? 'mudada' : ''}"  →  fala, mudada
    const deDentro = [];
    const corpo = m[1].replace(/\$\{[\s\S]*?\}/g, (pedaco) => {
      for (const s of pedaco.matchAll(/['"`]([^'"`]*)['"`]/g)) deDentro.push(s[1]);
      return ' ';
    });
    for (const nome of `${corpo} ${deDentro.join(' ')}`.split(/\s+/)) {
      if (/^[A-Za-z][\w-]*$/.test(nome)) r.push({ nome, linha: linhaDe(txt, m.index) });
    }
  }
  for (const m of txt.matchAll(/classList\.(?:add|remove|toggle|contains|replace)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/['"]([\w-]+)['"]/g)) {
      r.push({ nome: s[1], linha: linhaDe(txt, m.index) });
    }
  }
  return r;
}

/** as regras do CSS, uma a uma, já sabendo dentro de qual @media cada uma está */
function regrasDoCss(css) {
  // os comentários somem, mas as QUEBRAS DE LINHA deles ficam: senão todo número de
  // linha depois de um comentário de três linhas sai três linhas adiantado
  const limpo = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const regras = [], pilha = [];
  let buf = '', i = 0;
  while (i < limpo.length) {
    const ch = limpo[i];
    if (ch === '{') {
      const sel = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (sel.startsWith('@')) { pilha.push(sel); i++; continue; }
      let fim = i + 1, nivel = 1;
      while (fim < limpo.length && nivel > 0) {
        if (limpo[fim] === '{') nivel++;
        else if (limpo[fim] === '}') nivel--;
        fim++;
      }
      regras.push({
        sel, corpo: limpo.slice(i + 1, fim - 1), dentro: pilha.join(' '), linha: linhaDe(limpo, i),
      });
      i = fim;
      continue;
    }
    if (ch === '}') { pilha.pop(); buf = ''; i++; continue; }
    buf += ch; i++;
  }
  return regras;
}

const propsDe = (corpo) => {
  const m = new Map();
  for (const p of corpo.split(';')) {
    const d = p.indexOf(':');
    if (d > 0) m.set(p.slice(0, d).trim().toLowerCase(), p.slice(d + 1).trim());
  }
  return m;
};

/* ── o corretor de uma tela ───────────────────────────────────────────────────────── */
export function conferirTela(caminho) {
  const txt = readFileSync(caminho, 'utf8');
  const { css, emprestado, js } = partes(txt, dirname(caminho));
  const semCss = txt.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, (b) => ' '.repeat(b.length));
  const erros = [], avisos = [];
  const arq = basename(caminho);
  const erro = (linha, msg) => erros.push(`${arq}:${linha} ${msg}`);
  const aviso = (linha, msg) => avisos.push(`${arq}:${linha} ${msg}`);

  /* handlers órfãos: o botão que não faz nada */
  const temFn = funcoesDeclaradas(js);
  const fnDitas = new Set();
  for (const h of handlers(txt)) {
    if (temFn.has(h.nome) || DO_NAVEGADOR.has(h.nome) || fnDitas.has(h.nome)) continue;
    fnDitas.add(h.nome);
    erro(h.linha, `${h.onde} chama ${h.nome}(), que não existe nesta tela`);
  }

  /* ids procurados que nenhum template cria */
  const temId = idsCriados(txt);
  const idsDitos = new Set();
  for (const r of idsProcurados(js)) {
    if (temId.has(r.id) || idsDitos.has(r.id)) continue;
    idsDitos.add(r.id);
    erro(r.linha, `procura #${r.id}, que nenhum template cria`);
  }

  /* classes sem CSS, e CSS sem classe */
  const regras = regrasDoCss(css);
  const comRegra = new Set();
  for (const r of [...regras, ...regrasDoCss(emprestado)]) {
    for (const m of r.sel.matchAll(/\.([\w-]+)/g)) comRegra.add(m[1]);
  }
  const clsDitas = new Set();
  for (const u of classesUsadas(txt)) {
    if (comRegra.has(u.nome) || clsDitas.has(u.nome)) continue;
    clsDitas.add(u.nome);
    aviso(u.linha, `usa a classe .${u.nome}, que não tem regra de CSS`);
  }
  /* Classes de HTML que não é nosso. As notas de atualização da Riep vêm como HTML cru e
     são estilizadas por classes que a Riot escreve (`reference-link`, `ability-title`...):
     elas nunca aparecem no nosso código e não são mortas. A tela declara quais são os
     recipientes desse HTML numa linha de comando pro corretor. */
  const externas = [];
  for (const m of css.matchAll(/conferir-tela\s*:\s*externas?\s+([^*]+)/g)) {
    for (const c of m[1].matchAll(/\.([\w-]+)/g)) externas.push(c[1]);
  }
  const deFora = (sel) => externas.some((e) => sel.includes(`.${e}`));

  const doProprioCss = new Map();
  for (const r of regras) {
    if (deFora(r.sel)) continue;
    for (const m of r.sel.matchAll(/\.([\w-]+)/g)) {
      if (!doProprioCss.has(m[1])) doProprioCss.set(m[1], r.linha);
    }
  }
  const codigo = codigoDoProjeto();
  for (const [c, linha] of doProprioCss) {
    // conservador de propósito: só é morta se o nome não aparece em NENHUM lugar do código
    if (semCss.includes(c) || codigo.includes(c)) continue;
    aviso(linha, `.${c} tem CSS mas não é usada em lugar nenhum`);
  }

  /* duas regras com o MESMO seletor de uma classe só, brigando pela mesma propriedade */
  const porSeletor = new Map();
  for (const r of regras) {
    if (!/^\.[\w-]+$/.test(r.sel)) continue;
    if (!porSeletor.has(r.sel)) porSeletor.set(r.sel, []);
    porSeletor.get(r.sel).push(r);
  }
  for (const [sel, lista] of porSeletor) {
    for (let a = 0; a < lista.length; a++) {
      for (let b = a + 1; b < lista.length; b++) {
        const pa = propsDe(lista[a].corpo), pb = propsDe(lista[b].corpo);
        const briga = [...pa.keys()]
          .filter((k) => pb.has(k) && pa.get(k) !== pb.get(k) && !PROP_INOFENSIVA.has(k));
        if (!briga.length) continue;
        const mesmoLugar = lista[a].dentro === lista[b].dentro;
        const msg = `${sel} aparece 2x (linhas ${lista[a].linha} e ${lista[b].linha}), `
          + `brigando por ${briga.join(', ')}`
          + (mesmoLugar
            ? ' — quem ganha é a ORDEM do arquivo'
            : ` — uma delas está em ${lista[b].dentro || lista[a].dentro}`);
        (mesmoLugar ? erros : avisos).push(`${arq}:${lista[b].linha} ${msg}`);
      }
    }
  }

  /* var(--x) que ninguém define: a declaração inteira morre e o valor volta pro inicial —
     borda que era arredondada vira quadrada, cor clara vira a cor herdada, e ninguém vê */
  const definidas = new Set();
  // inclui o txt inteiro de propósito: o JS também define variável em style="--pct:..."
  for (const m of `${txt}\n${emprestado}`.matchAll(/(--[\w-]+)\s*:/g)) definidas.add(m[1]);
  const varsDitas = new Set();
  for (const m of txt.matchAll(/var\(\s*(--[\w-]+)\s*([,)$])/g)) {
    // var(--x, outra-coisa) tem plano B, e var(--g${n}) é montada na hora: não dá pra conferir
    if (m[2] !== ')' || definidas.has(m[1]) || varsDitas.has(m[1])) continue;
    varsDitas.add(m[1]);
    erro(linhaDe(txt, m.index), `usa var(${m[1]}), que ninguém define`);
  }

  return { erros, avisos };
}

/* ── todas as telas ──────────────────────────────────────────────────────────────── */
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const pasta = join(RAIZ, 'src', 'ui');
  const telas = readdirSync(pasta).filter((f) => f.endsWith('.html')).map((f) => join(pasta, f));
  const soErros = process.argv.includes('--erros');
  let nErro = 0, nAviso = 0;
  for (const t of telas) {
    const { erros, avisos } = conferirTela(t);
    nErro += erros.length;
    nAviso += avisos.length;
    for (const e of erros) console.error(`  ERRO  ${e}`);
    if (!soErros) for (const a of avisos) console.error(`  aviso ${a}`);
  }
  console.log(`telas conferidas: ${telas.length} · ${nErro} erro(s), ${nAviso} aviso(s)`);
  process.exit(nErro ? 1 : 0);
}
