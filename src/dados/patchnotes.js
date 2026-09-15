import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pastaBase } from '../caminhos.js';

/**
 * Notas de atualização, do site oficial da Riot em português.
 *
 * Não existe API pública pra isso. O site é Next.js e serve o conteúdo já
 * pronto dentro do `__NEXT_DATA__` da própria página — é de lá que sai, e não
 * de raspar `<div>` por seletor de CSS, que quebraria a cada redesenho.
 *
 * A lista de notas nunca é adivinhada por padrão de URL: as URLs vêm do índice
 * oficial. Chutar "patch-16-18-notes" dava 404 — o site usa "26-18".
 *
 * **O HTML que vem daqui é conteúdo de terceiro e nunca é injetado cru.**
 * Passa por uma lista branca de tags e atributos antes de chegar na tela.
 */

const SITE = 'https://www.leagueoflegends.com';
const INDICE = `${SITE}/pt-br/news/tags/patch-notes/`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

const pasta = () => resolve(pastaBase(), 'dados', 'patchnotes');
const VALIDADE_INDICE = 6 * 60 * 60 * 1000;

async function baixar(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`o site da Riot respondeu HTTP ${r.status}`);
  return r.text();
}

/** O JSON que o Next.js embute na página. */
function dadosDaPagina(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('a página não veio no formato esperado');
  return JSON.parse(m[1]);
}

/** Primeira ocorrência, em profundidade, de um nó que satisfaça `teste`. */
function procurar(objeto, teste, prof = 0) {
  if (prof > 10 || !objeto || typeof objeto !== 'object') return null;
  if (teste(objeto)) return objeto;
  for (const v of Object.values(objeto)) {
    const achado = procurar(v, teste, prof + 1);
    if (achado) return achado;
  }
  return null;
}

async function lerCache(nome) {
  try { return JSON.parse(await readFile(resolve(pasta(), nome), 'utf8')); } catch { return null; }
}

async function gravarCache(nome, dados) {
  try {
    await mkdir(pasta(), { recursive: true });
    await writeFile(resolve(pasta(), nome), JSON.stringify(dados), 'utf8');
  } catch { /* sem disco, segue só com a rede */ }
}

/* ------------------------------------------------------------------ lista */

/** As últimas notas publicadas: título, data, resumo e endereço. */
export async function listarAtualizacoes({ limite = 12 } = {}) {
  const cache = await lerCache('indice.json');
  if (cache && Date.now() - cache.em < VALIDADE_INDICE) return cache.lista.slice(0, limite);

  let lista;
  try {
    const j = dadosDaPagina(await baixar(INDICE));
    const itens = procurar(j.props?.pageProps ?? j,
      (o) => Array.isArray(o) && o.length > 3 && o[0]?.title && o[0]?.action);
    if (!itens) throw new Error('não achei a lista de notas no índice');

    lista = itens.map((x) => {
      const caminho = x.action?.payload?.url ?? '';
      return {
        titulo: x.title,
        data: x.publishedAt ?? null,
        resumo: typeof x.description === 'string' ? x.description : (x.description?.body ?? ''),
        caminho,
        slug: caminho.split('/').filter(Boolean).pop() ?? '',
        imagem: x.media?.url ?? x.imageMedia?.url ?? null,
      };
    }).filter((x) => x.slug);
  } catch (erro) {
    // Sem internet: um índice vencido ainda vale mais que uma tela vazia.
    if (cache) return cache.lista.slice(0, limite);
    throw erro;
  }

  await gravarCache('indice.json', { em: Date.now(), lista });
  return lista.slice(0, limite);
}

/* ------------------------------------------------------------- higienização */

// Só o que serve pra texto formatado. Nada que execute, carregue ou navegue
// sozinho: script, iframe, object, form, style e afins simplesmente não entram.
const TAGS_OK = new Set([
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 'span', 'div', 'section', 'header',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'sup', 'sub',
]);

const ATRIBUTOS_OK = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  '*': ['id', 'class'],
};

const seguroHref = (v) => /^(https?:\/\/|\/|#)/i.test(v) && !/^javascript:/i.test(v);

// Tags que não têm fechamento e não entram na pilha de balanceamento.
const VAZIAS = new Set(['br', 'hr', 'img']);

/**
 * Fecha o que ficou aberto e joga fora o que fecha sem ter aberto.
 *
 * Necessário porque os blocos são recortados do meio do documento: um pedaço
 * que começa num `<h3>` e termina antes do próximo carrega `</div>` de wrappers
 * que abriram lá atrás. Sem isso o navegador fecha o contêiner do bloco cedo
 * demais e aninha todos os blocos seguintes dentro do primeiro — foi
 * exatamente o que aconteceu: 12 blocos viraram 1.
 */
function balancear(html) {
  const pilha = [];
  const saida = html.replace(/<(\/?)([a-z0-9]+)((?:\s[^>]*)?)\/?>/gi, (inteiro, barra, tagBruta) => {
    const tag = tagBruta.toLowerCase();
    if (VAZIAS.has(tag)) return inteiro;
    if (!barra) { pilha.push(tag); return inteiro; }

    const i = pilha.lastIndexOf(tag);
    if (i === -1) return '';            // fecha algo que nunca abriu aqui
    // Fecha também o que ficou pendurado dentro dele, na ordem certa.
    const pendentes = pilha.splice(i).slice(1).reverse();
    return pendentes.map((t) => `</${t}>`).join('') + inteiro;
  });

  return saida + pilha.reverse().map((t) => `</${t}>`).join('');
}

/**
 * Reescreve o HTML mantendo só tags e atributos da lista branca.
 * Tag proibida perde as marcas mas mantém o texto de dentro; o que era um
 * `<script>` vira texto inofensivo em vez de sumir sem aviso.
 */
export function higienizar(html) {
  if (!html) return '';
  let saida = String(html)
    // Conteúdo executável ou de carregamento vai inteiro, com miolo e tudo.
    .replace(/<(script|style|iframe|object|embed|form|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|noscript)\b[^>]*\/?>/gi, '');

  saida = saida.replace(/<(\/?)([a-zA-Z0-9]+)((?:\s[^>]*)?)\/?>/g, (inteiro, barra, tagBruta, attrs) => {
    const tag = tagBruta.toLowerCase();
    if (!TAGS_OK.has(tag)) return '';
    if (barra) return `</${tag}>`;

    const permitidos = [...(ATRIBUTOS_OK[tag] ?? []), ...ATRIBUTOS_OK['*']];
    const mantidos = [];
    for (const m of attrs.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) {
      const nome = m[1].toLowerCase();
      const valor = m[2];
      if (nome.startsWith('on')) continue;                    // handler de evento
      if (!permitidos.includes(nome)) continue;
      if ((nome === 'href' || nome === 'src') && !seguroHref(valor)) continue;
      // Link relativo do site precisa virar absoluto pra funcionar fora dele.
      const final = (nome === 'href' && valor.startsWith('/')) ? SITE + valor : valor;
      mantidos.push(`${nome}="${final.replace(/"/g, '&quot;')}"`);
    }
    // Link externo sempre abre fora e sem passar referência de janela.
    if (tag === 'a') mantidos.push('target="_blank"', 'rel="noopener noreferrer"');
    const fecha = VAZIAS.has(tag) ? ' /' : '';
    return `<${tag}${mantidos.length ? ' ' + mantidos.join(' ') : ''}${fecha}>`;
  });

  return balancear(saida);
}

/* ------------------------------------------------------------------ leitura */

// Escrito com escape em vez do caractere literal: a faixa de acentos combinantes
// é invisível no editor e some em qualquer cópia mal feita do arquivo.
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
export const chaveNome = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Marca cada campeão alterado com uma âncora, sem picotar o texto.
 *
 * A primeira versão recortava o corpo em cada `<h3 class="change-title">` e
 * montava a tela só com os pedaços. Saiu torto por dois motivos, os dois
 * visíveis na tela:
 *
 * 1. O retrato do campeão fica **antes** do `<h3>`, dentro do mesmo
 *    `<div class="content-border">`. Cortando no `<h3>`, a foto de cada
 *    campeão caía no fim do bloco do campeão anterior.
 * 2. Tudo o que não é bloco de campeão (introdução, itens, sistema, skins)
 *    simplesmente sumia da tela.
 *
 * Agora o corpo vai inteiro, do jeito que a Riot montou, e a única alteração é
 * um `id` injetado na `div.content-border` que embrulha cada campeão — o que
 * dá o "pular pra mudança" sem mexer no conteúdo.
 *
 * A chave sai do atributo `id` do h3 (`id="patch-bard"`), não do texto: o texto
 * está traduzido ("Bardo") e o resto do app usa o nome do Data Dragon ("Bard").
 */
const ABRE_BLOCO = '<div class="content-border">';

const textoDe = (h) => String(h).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

/** Em que seção (`<h2>`) da nota está esta posição — "Campeões", "Classic"… */
function secaoEm(bruto, posicao) {
  const antes = bruto.lastIndexOf('<h2', posicao);
  if (antes < 0) return '';
  const fim = bruto.indexOf('</h2>', antes);
  return fim < 0 ? '' : textoDe(bruto.slice(antes, fim));
}

/**
 * Acha os campeões alterados e marca cada um com uma âncora, sem picotar o texto.
 *
 * A primeira versão recortava o corpo em cada `<h3 class="change-title">` e
 * montava a tela só com os pedaços. Saiu torto por dois motivos, os dois
 * visíveis na tela:
 *
 * 1. O retrato do campeão fica **antes** do `<h3>`, dentro do mesmo
 *    `<div class="content-border">`. Cortando no `<h3>`, a foto de cada campeão
 *    caía no fim do bloco do campeão anterior.
 * 2. Tudo o que não era bloco de campeão sumia da tela.
 *
 * E faltava metade dos campeões: a nota tem seções por modo de jogo
 * ("Campeões", "Itens", **"Classic"**, "ARAM: Desordem") e só a primeira usa
 * `change-title`. Nas seções de modo o campeão é um `<p><strong>Nome</strong></p>`
 * simples — do mesmo jeito que "Passiva – Duelista" ou "Q – Negociarrr". Por
 * isso a segunda varredura só aceita nome que exista no elenco de verdade.
 */
function prepararCorpo(bruto, elenco = []) {
  // Uma busca por nome sem acento, aceitando a grafia traduzida e a do Data
  // Dragon: a nota diz "Bardo" e o banco diz "Bard".
  const porNome = new Map();
  for (const c of elenco) {
    const alvo = { chave: chaveNome(c.chave), nome: c.nome };
    porNome.set(chaveNome(c.nome), alvo);
    porNome.set(chaveNome(c.chave), alvo);
  }

  const achados = [];

  // 1) Seção principal: cada campeão tem título próprio e vive num content-border.
  for (const m of bruto.matchAll(/<h3[^>]*class="[^"]*change-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/g)) {
    const nome = textoDe(m[1]);
    const id = m[0].match(/id="patch-([^"]+)"/)?.[1] ?? '';
    achados.push({
      nome,
      chave: chaveNome(id || nome),
      chaveTexto: chaveNome(nome),
      secao: secaoEm(bruto, m.index),
      onde: bruto.lastIndexOf(ABRE_BLOCO, m.index),
      tipo: 'bloco',
    });
  }

  // 2) Seções de modo: parágrafo em negrito que bate com um campeão real.
  for (const m of bruto.matchAll(/<p>\s*<strong>([^<]{2,40})<\/strong>\s*<\/p>/g)) {
    const nome = textoDe(m[1]);
    const alvo = porNome.get(chaveNome(nome));
    if (!alvo) continue;                       // é nome de habilidade, não de campeão
    achados.push({
      nome,
      chave: alvo.chave,
      chaveTexto: chaveNome(nome),
      secao: secaoEm(bruto, m.index),
      onde: m.index,
      tipo: 'paragrafo',
    });
  }

  achados.sort((a, b) => a.onde - b.onde);

  // Id único: o mesmo campeão pode aparecer na seção principal e de novo numa
  // seção de modo, e dois elementos com o mesmo id quebram o "pular pra lá".
  const usados = new Map();
  for (const a of achados) {
    const n = (usados.get(a.chave) ?? 0) + 1;
    usados.set(a.chave, n);
    a.ancora = n === 1 ? `bloco-${a.chave}` : `bloco-${a.chave}-${n}`;
  }

  // De trás pra frente pra não invalidar os índices já calculados.
  let corpo = bruto;
  for (const a of [...achados].reverse()) {
    if (a.onde < 0) continue;
    if (a.tipo === 'bloco') {
      corpo = corpo.slice(0, a.onde)
        + `<div class="content-border" id="${a.ancora}">`
        + corpo.slice(a.onde + ABRE_BLOCO.length);
    } else {
      corpo = corpo.slice(0, a.onde)
        + `<p class="campeao-modo" id="${a.ancora}"><strong>${a.nome}</strong></p>`
        + corpo.slice(a.onde + (corpo.slice(a.onde).match(/<p>\s*<strong>[^<]*<\/strong>\s*<\/p>/)?.[0].length ?? 0));
    }
  }

  // Fora o preâmbulo: o texto de abertura da Riot, o "procurando mais
  // informações", o "notas erradas? TFT aqui" e as fotos de quem assinou.
  // O que importa começa em "Destaques da Atualização".
  corpo = corpo
    .replace(/<h2[^>]*id="patch-top"[^>]*>[\s\S]*?<\/h2>/i, '')
    .replace(/<blockquote[^>]*class="[^"]*\bcontext\b[^"]*"[^>]*>[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<div[^>]*class="[^"]*context-designers[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

  // "80/90/100 ⇒ 70/80/90" vira antes riscado e depois em destaque — o que
  // mudou salta aos olhos sem ler o parágrafo.
  corpo = corpo.replace(/([^<>⇒:]{1,60}?)\s*⇒\s*(?:<strong>)?([^<>]{1,60}?)(?:<\/strong>)?(?=<|$)/g,
    (m, antes, depois) => `<span class="antes"> ${antes.trim()}</span> ⇒ <span class="depois">${depois.trim()}</span>`);

  return {
    corpo: higienizar(corpo),
    blocos: achados.map(({ nome, chave, chaveTexto, secao, ancora }) =>
      ({ nome, chave, chaveTexto, secao, ancora })),
  };
}

/**
 * Uma nota de atualização inteira. Fica guardada em disco pra sempre: nota
 * publicada não muda, e reler custa 300 KB de download à toa.
 */
// Sobe quando a forma do que é guardado muda: o cache em disco é pra sempre, e
// sem isto uma nota lida por uma versão antiga ficaria velha para sempre também.
const FORMATO = 5;   // 4: antes ⇒ depois destacado

export async function lerAtualizacao(slug, { elenco = [] } = {}) {
  const limpo = String(slug).replace(/[^a-zA-Z0-9-]/g, '');
  if (!limpo) throw new Error('endereço de atualização inválido');

  const cache = await lerCache(`${limpo}.json`);
  if (cache?.formato === FORMATO) return cache;

  const lista = await listarAtualizacoes({ limite: 60 }).catch(() => []);
  const item = lista.find((x) => x.slug === limpo);
  const url = `${SITE}${item?.caminho ?? `/pt-br/news/game-updates/${limpo}`}`;

  const j = dadosDaPagina(await baixar(url));
  const no = procurar(j.props?.pageProps ?? j,
    (o) => typeof o.body === 'string' && o.body.length > 1000);
  if (!no) throw new Error('não achei o texto da atualização nesta página');

  const { corpo, blocos } = prepararCorpo(no.body, elenco);
  const dados = {
    formato: FORMATO,
    slug: limpo,
    url,
    titulo: item?.titulo ?? limpo,
    data: item?.data ?? null,
    resumo: item?.resumo ?? '',
    corpo,
    blocos,
  };

  await gravarCache(`${limpo}.json`, dados);
  return dados;
}

/**
 * Os blocos que falam dos campeões que ELE joga.
 *
 * `meus` é uma lista de nomes de campeão. O casamento é por nome sem acento e
 * sem espaço, porque a nota escreve "Bardo" e o Data Dragon escreve "Bard" —
 * então quem chama manda os dois nomes quando souber.
 */
export function mudancasDele(atualizacao, meus) {
  const alvo = new Set(meus.map(chaveNome));
  // Casa pelas duas grafias: o banco guarda "Bard" e a nota escreve "Bardo".
  return (atualizacao.blocos ?? [])
    .filter((b) => alvo.has(b.chave) || alvo.has(b.chaveTexto));
}
