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

/* As QUATRO telas do app, não só o painel. As três de baixo são as que ficam abertas
 * DURANTE a partida — a janela ao vivo, o olho do minimapa e o overlay — e é justamente
 * aí que um erro é pior: ele não tem como ver o console no meio de um jogo, e a tela
 * simplesmente para de atualizar. */
const TELAS_VISITADAS = [
  { arquivo: 'painel.html', abas: ABAS },
  { arquivo: 'vivo.html' },
  { arquivo: 'olho.html' },
  { arquivo: 'overlay.html', espera: 1200 },
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
/* DUAS formas de resposta ruim, porque elas passam por caminhos DIFERENTES do código.
 *
 *  - `erro`: `{erro: ...}`, que é o que a app recebe quando a Riot cai ou a chave vence.
 *    Quem testa `if (r?.erro)` escapa; quem não testa, estoura no primeiro `.map`.
 *  - `vazio`: `{}`. Este passa por QUEM TESTA o erro — não tem `erro` nenhum — e só
 *    estoura lá na frente, no campo que não veio. É o caso mais traiçoeiro dos dois.
 *
 * Nenhum dos dois precisa saber o formato de resposta de nada, o que importa: inventar
 * formato daria confiança falsa, e passar a mão num formato errado é pior que não testar.
 */
const RESPOSTAS = {
  erro: () => ({ erro: 'sem rede (passeio de teste)' }),
  vazio: () => ({}),
  /* LENTO: a resposta chega, mas tarde e fora de ordem. É o cenário que nenhuma das duas
   * de cima testa, e é de onde vem o erro intermitente — aquele que ele nunca consegue
   * descrever direito. Pedido disparado numa aba, ele troca de aba antes de chegar, a
   * resposta volta e escreve numa tela que não existe mais. Com a internet dele rápida
   * isso é raro; com a Riot lerda no horário de pico, não é. */
  lento: () => ({}),
};
const ATRASO = { erro: 0, vazio: 0, lento: () => 80 + Math.random() * 900 };
let modo = 'erro';

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
      const corpo = caminho === '/api/estado' ? ESTADO : RESPOSTAS[modo]();
      const espera = typeof ATRASO[modo] === 'function' ? ATRASO[modo]() : 0;
      const responder = () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(corpo));
      };
      if (espera) setTimeout(responder, espera); else responder();
      return;
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
  ouvirConsole(janela.webContents, () => `${modo}/${onde}`);

  for (const qual of Object.keys(RESPOSTAS)) {
  modo = qual;
  for (const tela of TELAS_VISITADAS) {
    try {
      onde = `${tela.arquivo} abrindo`;
      await janela.loadURL(`http://127.0.0.1:${porta}/${tela.arquivo}`);
      await esperar(tela.espera ?? 1500);

      for (const aba of tela.abas ?? []) {
        onde = `${tela.arquivo} · ${aba}`;
        await janela.webContents.executeJavaScript(
          `(() => { try { abrirAba(${JSON.stringify(aba)}); return 'ok'; }
                    catch (e) { console.error('abrirAba estourou: ' + (e && e.message || e)); return 'erro'; } })()`,
        );
        // no modo lento a troca é RÁPIDA de propósito: sai da aba antes da resposta chegar
        await esperar(modo === 'lento' ? 180 : 700);
      }
      /* E então espera as respostas atrasadas caírem numa tela que já mudou. É aqui que
       * aparece quem escreve em elemento que não existe mais. */
      if (modo === 'lento') await esperar(2500);

      /* O que só nasce com clique. Uma tela que abre e uma tela que não abre não é o
       * mesmo teste: metade do código de desenho está atrás de um clique. */
      onde = `${tela.arquivo} · clicando`;
      await janela.webContents.executeJavaScript(`(() => {
        const clicaveis = [...document.querySelectorAll('[onclick]')].filter(el => el.offsetParent !== null);
        let n = 0;
        for (const el of clicaveis.slice(0, 40)) {
          try { el.click(); n++; } catch (e) { console.error('clique estourou: ' + (e && e.message || e)); }
        }
        return n;
      })()`);
      await esperar(1000);
    } catch (e) {
      queixas.push(`${onde}: o passeio nem terminou — ${e?.message ?? e}`);
    }

    // o que o preload juntou, com arquivo e linha. Tem que ser colhido ANTES de trocar
    // de tela: `window.__erros` morre junto com o documento.
    try {
      const comPilha = await janela.webContents.executeJavaScript('window.__erros || []');
      for (const e of comPilha) queixas.push(`${modo}/${tela.arquivo}: ${e.quem}: ${e.msg}\n          em ${e.pilha}`);
    } catch { /* janela já foi */ }
  }
  }

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
  console.log(`passeio ok: ${TELAS_VISITADAS.length} telas x ${Object.keys(RESPOSTAS).length} respostas ruins, ${ABAS.length} abas, console limpo`);
  app.exit(0);
});
