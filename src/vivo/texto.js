/**
 * Falas personalizáveis. Cada frase da voz é escrita no código como
 * F`Flash do ${campeao} marcado.` — a parte fixa vira o "modelo"
 * ("Flash do {1} marcado.") e é por ele que o admin troca o texto na
 * Configuração: o que ele escrever, com os mesmos {1}, {2}, vale no lugar.
 *
 * `render()` aplica a personalização; `catalogo()` lê os arquivos-fonte e
 * lista todos os modelos (é o que a tela mostra), sem precisar rodar a
 * partida.
 */
let personalizadas = {};

/** Personalizações do config: { modelo: 'texto novo com {1}' }. */
export function personalizar(mapa) { personalizadas = mapa && typeof mapa === 'object' ? mapa : {}; }

/** Tag de template (F`...`) ou função (F('...')): guarda modelo + valores. */
export function F(partes, ...valores) {
  if (!Array.isArray(partes)) return { modelo: String(partes), valores: [] };
  const modelo = partes.raw.length === 1 ? partes[0] : partes.map((p, i) => (i < valores.length ? `${p}{${i + 1}}` : p)).join('');
  return { modelo, valores };
}

/** Texto final: personalização se houver, senão o modelo, com os {n} preenchidos. */
export function render(f) {
  if (f == null) return f;
  if (typeof f === 'string') return f;
  const modelo = Object.hasOwn(personalizadas, f.modelo) && String(personalizadas[f.modelo]).trim() ? String(personalizadas[f.modelo]) : f.modelo;
  // singular quando o número cai em 1 ("a 1 segundos" saía da voz)
  return modelo.replace(/\{(\d+)\}/g, (m, n) => { const v = f.valores[Number(n) - 1]; return v == null ? '' : String(v); }).replace(/\b1 (segundo|minuto|kill|jogo|vitória|derrota|morte)s\b/g, '1 $1').replace(/\b1 vezes\b/g, '1 vez');
}

/* --------------------------------------------------------- catálogo */
const MODULOS = new Set(['timers', 'flash', 'kills', 'jungler', 'spikes', 'economia', 'lane', 'mapa', 'selecao']);

/** Lê um template literal a partir da crase de abertura; devolve { modelo, fim }. */
function lerTemplate(src, i) {
  let modelo = '', n = 0, j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { modelo += src[j + 1]; j += 2; continue; }
    if (c === '`') return { modelo, fim: j + 1 };
    if (c === '$' && src[j + 1] === '{') {
      // pula a expressão, contando chaves e strings dentro dela
      let prof = 1; j += 2;
      while (j < src.length && prof > 0) {
        const d = src[j];
        if (d === '`') { j = lerTemplate(src, j).fim; continue; }
        if (d === "'" || d === '"') { j = lerString(src, j).fim; continue; }
        if (d === '{') prof++; else if (d === '}') prof--;
        j++;
      }
      modelo += `{${++n}}`;
      continue;
    }
    modelo += c; j++;
  }
  return { modelo, fim: j };
}
function lerString(src, i) {
  const q = src[i]; let s = '', j = i + 1;
  while (j < src.length && src[j] !== q) { if (src[j] === '\\') { s += src[j + 1]; j += 2; } else { s += src[j]; j++; } }
  return { texto: s, fim: j + 1 };
}

/**
 * Todos os F`...`/F('...') de um arquivo-fonte, com módulo (do dizer(...)
 * que os cerca) e seção (comentário  ---- assim ----  mais próximo acima).
 */
export function escanear(src, arquivo = '', { moduloFixo = null, secaoFixa = null } = {}) {
  const saida = [];
  const limiteSelecao = src.search(/export (async )?function sugerirPick/);
  const re = /F(`|\(')/g;
  let m;
  while ((m = re.exec(src))) {
    const inicio = m.index;
    let modelo, fim;
    if (m[1] === '`') ({ modelo, fim } = lerTemplate(src, inicio + 1));
    else { const r = lerString(src, inicio + 2); modelo = r.texto; fim = r.fim + 1; }
    re.lastIndex = fim;
    if (!modelo.trim()) continue;
    // módulo: primeiro literal sem espaço dentro do dizer( mais próximo que seja um módulo conhecido
    const antes = src.slice(Math.max(0, inicio - 900), inicio);
    const chamada = antes.lastIndexOf('dizer(');
    let modulo = null;
    if (chamada >= 0) {
      const args = antes.slice(chamada + 6);
      for (const lit of args.matchAll(/'([a-z]+)'/g)) if (MODULOS.has(lit[1])) { modulo = lit[1]; break; }
    }
    if (!modulo) { const mm = antes.match(/modulo:\s*'([a-z]+)'/g); if (mm) { const ult = mm.at(-1).match(/'([a-z]+)'/)[1]; if (MODULOS.has(ult)) modulo = ult; } }
    const secoes = [...src.slice(0, inicio).matchAll(/\/\*\s*-{2,}\s*([^*]+?)\s*-{2,}\s*\*\//g)];
    const secao = secoes.length ? secoes.at(-1)[1] : '';
    if (limiteSelecao >= 0 && inicio > limiteSelecao) { modulo = 'selecao'; }
    saida.push({ modelo, modulo: moduloFixo ?? modulo ?? 'outros', secao: secaoFixa ?? (modulo === 'selecao' && limiteSelecao >= 0 && inicio > limiteSelecao ? 'seleção de campeão' : secao), arquivo });
  }
  return saida;
}

/** Catálogo sem repetição, na ordem dos arquivos. */
export function catalogo(fontes) {
  const vistos = new Set(), lista = [];
  for (const { src, arquivo, ...opcoes } of fontes) for (const f of escanear(src, arquivo, opcoes)) {
    if (vistos.has(f.modelo)) continue;
    vistos.add(f.modelo); lista.push(f);
  }
  return lista;
}
