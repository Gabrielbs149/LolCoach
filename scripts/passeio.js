/**
 * passeio.js — o passeio automático pelas telas.
 *
 * `conferir-sintaxe` garante que o JS compila e `conferir-tela` LÊ o arquivo procurando
 * botão órfão, id que ninguém cria e CSS brigando. Nenhum dos dois EXECUTA a tela, e tem
 * uma família inteira de erro que só aparece rodando: `r.lista.map` quando `lista` não
 * veio, `x.toFixed` num nulo, um `await` que estoura e deixa a aba pela metade.
 *
 * Este passeio abre o painel de verdade numa janela OCULTA do Electron (`show: false`,
 * nunca mostrada — com jogo aberto não aparece nada na tela dele), passa por TODAS as
 * abas e falha se o console reclamar.
 *
 * A API é FALSA, de propósito, por dois motivos. Primeiro, privacidade: gravar respostas
 * de verdade colocaria puuid, nome de amigo e histórico num repositório público. Segundo,
 * é justamente a resposta ruim que quebra tela — então o passeio responde `{erro: ...}`
 * em tudo, que é a forma que a app recebe quando a Riot cai ou a internet some. Tela que
 * quebra com isso ia quebrar na mão dele no primeiro dia ruim de rede.
 *
 *   npm run passear            — passeia e diz o que achou
 *   npm run passear -- --ver   — mostra TODAS as mensagens do console, não só as de erro
 */
import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui');
const VERBOSO = process.argv.includes('--ver');

/* ── a tela sendo visitada ────────────────────────────────────────────────────────── */
const ABAS = [
  'visao', 'calendario', 'partidas', 'estat', 'amigos',
  'meta', 'builds', 'patch', 'lineups', 'admin', 'config',
];

/* ── a API falsa ─────────────────────────────────────────────────────────────────── */
// O estado é o único que precisa ser plausível: é dele que a tela tira versão, fase do
// jogo e se é admin. `admin: true` de propósito, pra o passeio também entrar no Admin.
const ESTADO = {
  versao: '0.0.0-passeio',
  fase: null,
  valorant: null,
  config: { admin: true, conta: null },
  registro: [],
  contas: [],
};
const RUIM = { erro: 'sem rede (passeio de teste)' };

// 1x1 transparente: as telas pedem muita imagem e o que importa aqui não é a arte
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const TIPO = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const TELAS = { '/': 'painel.html', '/painel': 'painel.html', '/identidade.css': 'identidade.css' };

function servidor() {
  return createServer(async (req, res) => {
    const caminho = new URL(req.url, 'http://127.0.0.1').pathname;
    const tela = TELAS[caminho] ?? (/^\/[\w-]+\.(html|css)$/.test(caminho) ? caminho.slice(1) : null);
    if (tela) {
      try {
        const corpo = await readFile(join(AQUI, tela), 'utf8');
        res.writeHead(200, { 'content-type': TIPO[extname(tela)], 'cache-control': 'no-store' });
        return res.end(corpo);
      } catch { res.writeHead(404); return res.end('sem tela'); }
    }
    if (caminho.startsWith('/api/')) {
      const corpo = caminho === '/api/estado' ? ESTADO : RUIM;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(corpo));
    }
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(PNG);
  });
}

/* ── o passeio ───────────────────────────────────────────────────────────────────── */
const queixas = [];
const todas = [];

/** O console da tela muda de assinatura entre versões do Electron; lê das duas formas. */
function ouvirConsole(wc, ondeEstou) {
  wc.on('console-message', (...args) => {
    const e = args[0];
    const nivel = typeof e === 'object' && e !== null && 'level' in e ? e.level : args[1];
    const texto = typeof e === 'object' && e !== null && 'message' in e ? e.message : args[2];
    const linha = String(texto ?? '');
    todas.push(`[${ondeEstou()}] ${linha}`);
    // 'error'/3 conforme a versão. Aviso não derruba o passeio: ruído de terceiro é comum.
    const ruim = nivel === 'error' || nivel === 3;
    // o YouTube e a rede falham de propósito aqui — isso é o cenário, não o defeito
    const esperado = /favicon|net::ERR|Failed to load resource|youtube|googlevideo|ytimg/i.test(linha);
    if (ruim && !esperado) queixas.push(`${ondeEstou()}: ${linha}`);
  });
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

app.disableHardwareAcceleration();

/* Cão de guarda: isto entra na trava da publicação, e trava que PENDURA é pior que trava
 * que falha. Se em 90 s o passeio não terminou, alguma coisa está presa — sai com erro. */
const guarda = setTimeout(() => {
  console.error('passeio: passou de 90 s sem terminar — alguma coisa travou');
  app.exit(1);
}, 90_000);
guarda.unref?.();

app.whenReady().then(async () => {
  const s = servidor();
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const porta = s.address().port;

  let onde = 'abrindo';
  const janela = new BrowserWindow({
    show: false,                     // NUNCA mostrada: com jogo aberto nada aparece
    width: 1500, height: 950,
    webPreferences: {
      backgroundThrottling: false,
      // o preload roda ANTES do script da tela e guarda a PILHA de cada erro: sem ela,
      // "Cannot read properties of undefined" não dá pra procurar em 5 mil linhas
      preload: join(dirname(fileURLToPath(import.meta.url)), 'passeio-antes.cjs'),
      contextIsolation: false,
      sandbox: false,
    },
  });
  ouvirConsole(janela.webContents, () => onde);

  try {
    await janela.loadURL(`http://127.0.0.1:${porta}/`);
    await esperar(1500);

    for (const aba of ABAS) {
      onde = aba;
      await janela.webContents.executeJavaScript(
        `(() => { try { abrirAba(${JSON.stringify(aba)}); return 'ok'; }
                  catch (e) { console.error('abrirAba estourou: ' + (e && e.message || e)); return 'erro'; } })()`,
      );
      await esperar(700);
    }

    /* As telas que só nascem com clique. Um painel que abre e um que não abre não é o
     * mesmo teste: metade do código de desenho está atrás de um clique. */
    onde = 'clicando no que aparece';
    await janela.webContents.executeJavaScript(`(() => {
      const clicaveis = [...document.querySelectorAll('[onclick]')].filter(el => el.offsetParent !== null);
      let n = 0;
      for (const el of clicaveis.slice(0, 40)) {
        try { el.click(); n++; } catch (e) { console.error('clique estourou: ' + (e && e.message || e)); }
      }
      return n;
    })()`);
    await esperar(1200);
  } catch (e) {
    queixas.push(`${onde}: o passeio nem terminou — ${e?.message ?? e}`);
  }

  // o que o preload juntou, com arquivo e linha
  let comPilha = [];
  try {
    comPilha = await janela.webContents.executeJavaScript('window.__erros || []');
  } catch { /* janela já foi */ }
  for (const e of comPilha) queixas.push(`${e.quem}: ${e.msg}
          em ${e.pilha}`);

  janela.destroy();
  s.close();

  clearTimeout(guarda);
  if (VERBOSO) for (const l of todas) console.log(`  · ${l}`);
  if (queixas.length) {
    console.error(`passeio: ${queixas.length} queixa(s) do console`);
    for (const q of [...new Set(queixas)]) console.error(`  ERRO  ${q}`);
    app.exit(1);
    return;
  }
  console.log(`passeio ok: ${ABAS.length} abas abertas, console limpo`);
  app.exit(0);
});
