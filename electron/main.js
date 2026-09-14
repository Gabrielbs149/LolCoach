import { app, BrowserWindow, Tray, Menu, shell, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import electronUpdater from 'electron-updater';
import { iniciarDaemon } from '../src/daemon.js';
import { criarServidor, criarEstado } from '../src/ui/servidor.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const estado = criarEstado();

/**
 * Onde ficam config e banco. Instalado pelo Setup, cada pessoa tem os seus em
 * %APPDATA%\LolCoach — o `src/caminhos.js` lê esta variável. No portátil
 * antigo, a pasta do .exe continua valendo (PORTABLE_EXECUTABLE_DIR).
 */
if (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR) {
  process.env.LOLCOACH_DIR = app.getPath('userData');
}

/**
 * Atualização automática pelas releases do GitHub.
 *
 * Checa ao abrir, baixa em segundo plano e instala quando o app fechar. Sem
 * notificação nativa do Windows de propósito: notificação pode roubar foco, e
 * a regra do projeto é não mexer em nada visível com a partida rodando. O aviso
 * vai pro painel e pra Atividade.
 */
const { autoUpdater } = electronUpdater;
function ligarAtualizacao() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => estado.log('procurando atualização…'));
  autoUpdater.on('update-available', (i) => estado.log(`atualização ${i.version} encontrada — baixando em segundo plano`));
  autoUpdater.on('update-not-available', () => estado.log(`você está na versão mais recente (${app.getVersion()})`));
  autoUpdater.on('download-progress', (p) => { if (Math.round(p.percent) % 25 === 0) estado.set('atualizacao', { baixando: Math.round(p.percent) }); });
  autoUpdater.on('update-downloaded', (i) => {
    estado.set('atualizacao', { pronta: i.version });
    estado.log(`atualização ${i.version} pronta — instala sozinha quando você fechar o LolCoach`);
  });
  autoUpdater.on('error', (e) => estado.log(`atualização: ${e?.message ?? e}`));
  autoUpdater.checkForUpdates().catch(() => {});
  // E de novo a cada 6h, pra quem deixa o app aberto o dia inteiro.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}
let janela = null;
let bandeja = null;
let daemon = null;
let endereco = null;
let falha = null;

// Se o painel não subiu, a janela ainda tem que abrir e dizer o porquê —
// janela nenhuma é o pior resultado possível.
const PAGINA_DE_ERRO = (msg) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`
  <body style="background:#080b11;color:#e3ebf5;font:15px/1.6 'Segoe UI',system-ui,sans-serif;
               display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <div style="max-width:420px;text-align:center">
      <h1 style="color:#c8aa6e;font-size:19px;margin:0 0 12px">LolCoach não conseguiu iniciar</h1>
      <p style="color:#7c8da0">${msg}</p>
      <p style="color:#55647a;font-size:13px">Feche e abra de novo. Se continuar, rode
      <code style="color:#c8aa6e">npm run auto</code> na pasta do projeto pra ver o erro completo.</p>
    </div>
  </body>`);

/**
 * Abrir o app COM UMA PARTIDA RODANDO (atalho clicado sem querer, reinício do
 * PC, uma atualização minha) não pode mostrar janela: mostrar janela ativa
 * janela, e o jogo em tela cheia minimiza. A principal nasce escondida e só
 * aparece quando o daemon disser que não há partida — ou depois de 4s sem
 * client nenhum, que é o caso "League fechado".
 */
let faseAtual = null;
let painelPendente = true;

function mostrarPainelSeSeguro(motivo) {
  if (!painelPendente || !janela || janela.isDestroyed()) return;
  if (faseAtual === 'InProgress') return;
  painelPendente = false;
  janela.show();
  if (motivo) estado.log(motivo);
}

function criarJanela({ esconder = false } = {}) {
  janela = new BrowserWindow({
    width: 1180, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: '#0a0e14',
    title: 'LolCoach',
    autoHideMenuBar: true,
    show: !esconder,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  if (!esconder) painelPendente = false;
  janela.loadURL(endereco ?? PAGINA_DE_ERRO(falha ?? 'o painel local não subiu.'));
  // Link externo abre no navegador, nunca dentro do app.
  janela.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  janela.on('close', (e) => {
    if (app.saindo) return;
    e.preventDefault();       // fechar a janela só esconde: o daemon continua
    janela.hide();
  });
}

/**
 * Janela separada pra partida em andamento.
 *
 * É janela normal, de propósito: sobreposição desenhada por cima do jogo é
 * exatamente o tipo de coisa que o anti-cheat trata como trapaça. Esta fica no
 * segundo monitor ou no alt-tab.
 */
let janelaVivo = null;

/**
 * REGRA: com a partida rodando, o app NÃO mexe em janela nenhuma.
 *
 * A versão anterior chamava `show()` na janela ao vivo quando a fase virava
 * InProgress. `show()` ATIVA a janela; o Windows tira o foco do jogo, e jogo em
 * tela cheia exclusiva minimiza ao perder o foco. Resultado: o League do
 * Gabriel minimizava no meio da partida, da segunda partida em diante (na
 * primeira a janela nascia com `show:false` e ele nem a via).
 *
 * Agora a janela abre na SELEÇÃO DE CAMPEÃO — ele está no client, não no jogo,
 * e ali roubar foco não custa nada — e sem ativar (`showInactive`). Quando o
 * jogo começa, ela já está aberta onde ele a deixou.
 */
function abrirVivo({ focar = true } = {}) {
  if (janelaVivo && !janelaVivo.isDestroyed()) {
    if (focar) { janelaVivo.show(); janelaVivo.focus(); }
    else if (!janelaVivo.isVisible()) janelaVivo.showInactive();
    return;
  }
  janelaVivo = new BrowserWindow({
    width: 520, height: 780, minWidth: 380, minHeight: 420,
    backgroundColor: '#080b11',
    title: 'LolCoach — ao vivo',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  janelaVivo.loadURL(endereco ? `${endereco}/vivo` : PAGINA_DE_ERRO('o painel local não subiu.'));
  janelaVivo.once('ready-to-show', () => {
    if (janelaVivo?.isDestroyed()) return;
    if (focar) janelaVivo.show(); else janelaVivo.showInactive();
  });
  janelaVivo.on('closed', () => { janelaVivo = null; });
}

function criarBandeja() {
  const icone = nativeImage.createFromPath(join(AQUI, 'icone.png'));
  bandeja = new Tray(icone.isEmpty() ? nativeImage.createEmpty() : icone);
  bandeja.setToolTip('LolCoach');
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir painel', click: () => (janela ? janela.show() : criarJanela()) },
    { label: 'Abrir tela ao vivo', click: () => abrirVivo() },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.saindo = true; app.quit(); } },
  ]));
  bandeja.on('double-click', () => (janela ? janela.show() : criarJanela()));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Clicou no atalho de novo COM A PARTIDA RODANDO (acontece sem querer):
    // mostrar o painel agora roubaria o foco e minimizaria o jogo. Espera.
    if (estado.instantaneo().fase === 'InProgress') {
      estado.log('atalho aberto durante a partida — painel fica quieto até o jogo acabar');
      return;
    }
    if (janela) { janela.show(); janela.focus(); } else criarJanela();
  });
}

app.whenReady().then(async () => {
  try {
    daemon = await iniciarDaemon({
      estado,
      aoSelecionar: () => abrirVivo({ focar: false }),
      aoFase: (fase) => {
        faseAtual = fase;
        // Saiu da partida: se o painel estava esperando pra aparecer, agora pode.
        if (fase !== 'InProgress') mostrarPainelSeSeguro();
      },
    });
    ({ url: endereco } = await criarServidor({
      db: daemon.db, estado, porta: 8770,
      acoes: daemon.acoes,
    }));
  } catch (erro) {
    // Sem client aberto o painel ainda deve subir, só sem dados ao vivo.
    console.error('falha ao iniciar:', erro.message);
    estado.log(`falha ao iniciar: ${erro.message}`);
    falha = erro.message;
  }
  // Nasce escondida. Aparece quando o daemon confirmar que não há partida, ou
  // em 4s se não houver client nenhum pra perguntar.
  criarJanela({ esconder: true });
  criarBandeja();
  ligarAtualizacao();
  setTimeout(() => {
    if (!painelPendente) return;
    if (faseAtual === 'InProgress') {
      estado.log('app aberto durante a partida — painel fica escondido até o jogo acabar');
      return;
    }
    mostrarPainelSeSeguro();
  }, 4000);
});

app.on('window-all-closed', (e) => e.preventDefault());  // vive na bandeja
app.on('before-quit', () => {
  app.saindo = true;
  janelaVivo?.destroy();
  daemon?.fechar();
});
