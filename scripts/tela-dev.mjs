/**
 * tela-dev.mjs — ver a tela NOVA com os dados VIVOS, sem reinstalar o app.
 *
 * O problema que isto resolve: pra olhar uma mudança de tela eu precisava publicar uma
 * versão, esperar o app atualizar e reabrir a janela — o que é lento e, pior, mexe na
 * janela dele. E servir o painel.html sozinho não funciona: sem o /api ele não pinta nada.
 *
 * Então este servidorzinho faz as duas metades:
 *   - o que é TELA (html, css) sai do projeto, direto do arquivo que acabei de editar;
 *   - todo o resto (/api, /arte, /emblemas, imagens) é repassado pro app que já está
 *     rodando em 127.0.0.1:8770, com os dados verdadeiros dele.
 *
 * Ou seja: dá pra abrir http://127.0.0.1:8791 e ver a tela nova com o acervo, as partidas
 * e os amigos reais, sem tocar no app instalado. Só LEITURA de GET é repassada por
 * padrão; POST exige --pode-escrever, pra uma conferida de tela não sair mexendo no
 * acervo dele sem querer.
 *
 *   node scripts/tela-dev.mjs [--porta 8791] [--app 8770] [--pode-escrever]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui');
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const PORTA = Number(arg('--porta', 8791));
const APP = Number(arg('--app', 8770));
const PODE_ESCREVER = process.argv.includes('--pode-escrever');

const TIPO = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** as telas, pelo endereço que o app usa */
const TELAS = {
  '/': 'painel.html',
  '/painel': 'painel.html',
  '/olho': 'olho.html',
  '/vivo': 'vivo.html',
  '/overlay': 'overlay.html',
  '/identidade.css': 'identidade.css',
};

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORTA}`);
  const caminho = url.pathname;

  // 1. é tela? sai do projeto
  const tela = TELAS[caminho] ?? (/^\/[\w-]+\.(html|css)$/.test(caminho) ? caminho.slice(1) : null);
  if (tela) {
    try {
      const corpo = await readFile(join(AQUI, tela), 'utf8');
      res.writeHead(200, {
        'content-type': TIPO[extname(tela)] ?? 'text/plain; charset=utf-8',
        // sem cache: cada recarga tem que pegar o arquivo que eu acabei de salvar
        'cache-control': 'no-store',
      });
      return res.end(corpo);
    } catch {
      res.writeHead(404); return res.end('tela não encontrada no projeto');
    }
  }

  // 2. o resto é do app que está rodando
  if (req.method !== 'GET' && !PODE_ESCREVER) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ erro: 'tela-dev só repassa GET; use --pode-escrever' }));
  }
  try {
    const r = await fetch(`http://127.0.0.1:${APP}${req.url}`, {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await corpoDe(req),
    });
    const bytes = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'content-type': r.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    return res.end(bytes);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ erro: `o app em ${APP} não respondeu`, detalhe: String(e?.message ?? e) }));
  }
});

const corpoDe = (req) => new Promise((ok) => {
  const p = []; req.on('data', (c) => p.push(c)); req.on('end', () => ok(Buffer.concat(p)));
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`tela-dev em http://127.0.0.1:${PORTA} — telas do projeto, dados do app em ${APP}`);
  console.log(PODE_ESCREVER ? 'POST LIBERADO (mexe no acervo de verdade)' : 'só leitura');
});
