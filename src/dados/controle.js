/**
 * Painel de controle do Gabriel sobre quem usa o app.
 *
 * Não existe servidor: o "banco" é um repositório PRIVADO no GitHub
 * (Gabrielbs149/LolCoach-controle), lido e escrito pela API de conteúdo com
 * um token que vai embutido no pacote — do mesmo jeito que a chave da Riot.
 *
 *   controle.json          o que vale pra todo mundo: bloqueios, avisos,
 *                          funções desligadas, versão mínima
 *   usuarios/<id>.json     um por instalação: quem é, versão, quando foi
 *                          visto pela última vez, contas que já logou
 *
 * Cada app lê o controle ao abrir e de tempos em tempos, e se apresenta
 * (check-in) ao abrir e a cada hora. O painel admin lê a pasta usuarios/ e
 * grava o controle.json.
 */

const DONO = 'Gabrielbs149';
const REPO = 'LolCoach-controle';
const API = `https://api.github.com/repos/${DONO}/${REPO}/contents`;

/** Valores quando ainda não existe controle.json ou a rede falhou. */
export const CONTROLE_PADRAO = {
  somenteLiberados: false,   // true = só quem está em `liberados` usa
  liberados: [],             // ids de instalação ou "nome#tag" (minúsculo)
  bloqueados: [],            // idem — bloqueado vence liberado
  desligadas: [],            // 'aceitar' | 'escolher' | 'banir' | 'runas' | 'builds' | 'amigos'
  aviso: '',                 // mensagem que aparece na barra de todo mundo
  avisos: {},                // { "nome#tag" ou id: "mensagem só pra essa pessoa" }
  versaoMinima: null,        // abaixo disso o app avisa pra atualizar
  textos: {},                // { "texto original": "texto novo" } — modo edição do admin
  tema: {},                  // { ouro, fonte, raio, largura } — idem
  estilos: {},               // { "seletor": { cor, tamanho, esconder } } — idem
  popup: null,               // { id, texto } — aparece uma vez pra cada um
};

function cabecalhos(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LolCoach',
    'Content-Type': 'application/json',
  };
}

async function pedir(token, metodo, caminho, corpo) {
  const r = await fetch(`${API}/${caminho}`, {
    method: metodo,
    headers: cabecalhos(token),
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 404) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${metodo} ${caminho} → HTTP ${r.status}: ${j.message ?? ''}`);
  return j;
}

const decodificar = (arquivo) => JSON.parse(Buffer.from(arquivo.content, 'base64').toString('utf8'));
const codificar = (obj) => Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8').toString('base64');

/** Lê um JSON do repositório; null se não existir. */
export async function lerArquivo(token, caminho) {
  const a = await pedir(token, 'GET', caminho);
  return a ? { dados: decodificar(a), sha: a.sha } : null;
}

/** Cria ou substitui um JSON (o GitHub exige o sha do atual pra substituir). */
export async function gravarArquivo(token, caminho, dados, mensagem) {
  const atual = await pedir(token, 'GET', caminho);
  return pedir(token, 'PUT', caminho, {
    message: mensagem, content: codificar(dados), ...(atual?.sha ? { sha: atual.sha } : {}),
  });
}

export async function lerControle(token) {
  const a = await lerArquivo(token, 'controle.json');
  return { ...CONTROLE_PADRAO, ...(a?.dados ?? {}) };
}

export function gravarControle(token, controle) {
  return gravarArquivo(token, 'controle.json', { ...CONTROLE_PADRAO, ...controle }, 'painel: controle atualizado');
}

/** Todos os check-ins, um por instalação. */
export async function listarUsuarios(token) {
  const lista = await pedir(token, 'GET', 'usuarios');
  if (!Array.isArray(lista)) return [];
  const usuarios = await Promise.all(lista
    .filter((f) => f.name.endsWith('.json'))
    .map((f) => lerArquivo(token, `usuarios/${f.name}`).then((a) => a?.dados).catch(() => null)));
  return usuarios.filter(Boolean).sort((a, b) => String(b.vistoEm).localeCompare(String(a.vistoEm)));
}

/** O app se apresenta. `id` é o id da instalação (fica no config de cada um). */
export function checkIn(token, id, dados) {
  return gravarArquivo(token, `usuarios/${id}.json`, { id, ...dados }, `check-in ${dados.conta ?? id}`);
}

const chave = (s) => String(s ?? '').trim().toLowerCase();

/**
 * O que este app pode fazer, dado o controle e quem ele é.
 * Bloqueio individual vence tudo; depois a lista de liberados (se ligada);
 * por fim as funções desligadas pra todo mundo.
 */
export function avaliar(controle, { id, conta, versao } = {}) {
  const eu = [chave(id), chave(conta)].filter(Boolean);
  const esta = (lista) => (lista ?? []).some((x) => eu.includes(chave(x)));
  const bloqueado = esta(controle.bloqueados) || (controle.somenteLiberados && !esta(controle.liberados));
  const desligadas = new Set(controle.desligadas ?? []);
  const avisoPessoal = Object.entries(controle.avisos ?? {}).find(([k]) => eu.includes(chave(k)))?.[1] ?? '';
  const desatualizado = !!(controle.versaoMinima && versao && compararVersao(versao, controle.versaoMinima) < 0);
  return {
    bloqueado,
    permite: (funcao) => !bloqueado && !desligadas.has(funcao),
    desligadas: [...desligadas],
    aviso: [controle.aviso, avisoPessoal].filter(Boolean).join(' — '),
    desatualizado,
    versaoMinima: controle.versaoMinima ?? null,
    textos: controle.textos ?? {},
    tema: controle.tema ?? {},
    estilos: controle.estilos ?? {},
    popup: controle.popup ?? null,
  };
}

export function compararVersao(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
}

/** Apaga um check-in (o app dele volta a aparecer quando se apresentar de novo). */
export async function esquecerUsuario(token, id) {
  const atual = await pedir(token, 'GET', `usuarios/${id}.json`);
  if (!atual?.sha) return false;
  await fetch(`${API}/usuarios/${id}.json`, {
    method: 'DELETE', headers: cabecalhos(token),
    body: JSON.stringify({ message: `esquecer ${id}`, sha: atual.sha }),
    signal: AbortSignal.timeout(15_000),
  }).then((r) => { if (!r.ok) throw new Error(`GitHub DELETE → HTTP ${r.status}`); });
  return true;
}

/** Quantas vezes cada instalador foi baixado — releases públicas, sem token. */
export async function downloadsDoInstalador() {
  const r = await fetch('https://api.github.com/repos/Gabrielbs149/LolCoach/releases?per_page=50', {
    headers: { 'User-Agent': 'LolCoach', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return [];
  const lista = await r.json();
  return lista.map((rel) => ({
    versao: String(rel.tag_name ?? '').replace(/^v/, ''),
    downloads: (rel.assets ?? []).filter((a) => a.name.endsWith('.exe')).reduce((s, a) => s + (a.download_count ?? 0), 0),
    em: rel.published_at,
  })).filter((x) => x.versao);
}
