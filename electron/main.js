import { app, BrowserWindow, Tray, Menu, shell, nativeImage, Notification, dialog, globalShortcut, screen, session, desktopCapturer } from 'electron';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import electronUpdater from 'electron-updater';
import { iniciarDaemon } from '../src/daemon.js';
import { criarServidor, criarEstado } from '../src/ui/servidor.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
// Notificação do Windows só fora de partida e de seleção — nada de roubar
// foco com o jogo aberto. Silenciosa (sem som) e sem clique que traga janela.
const estado = criarEstado({
  aoAvisar(titulo, texto, fase) {
    if (['InProgress', 'ChampSelect', 'GameStart'].includes(fase) || !Notification.isSupported()) return;
    new Notification({ title: titulo, body: texto, silent: true, icon: join(AQUI, 'icone.png') }).show();
  },
});

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
let baixada = null;
let pedidoManual = false;   // ele clicou em Atualizar agora: instala assim que baixar

/**
 * O botão "Atualizar agora" da Configuração. Procura; se já estiver baixada,
 * instala e reabre — nunca com a partida rodando (a regra da casa).
 */
async function atualizarAgora() {
  if (!app.isPackaged) return { erro: 'rodando do código — sem atualização automática' };
  if (faseAtual === 'InProgress' || faseAtual === 'ChampSelect') return { erro: 'espera acabar a partida' };
  if (baixada) {
    estado.log(`instalando a ${baixada} e reabrindo…`);
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
    return { instalando: baixada };
  }
  try {
    const r = await autoUpdater.checkForUpdates();
    const nova = r?.updateInfo?.version;
    if (!nova || nova === app.getVersion()) return { atual: app.getVersion() };
    pedidoManual = true;
    return { baixando: nova };   // o 'update-downloaded' instala na sequência
  } catch (e) {
    return { erro: e?.message ?? String(e) };
  }
}

/**
 * Backup: copia config.json, dados/partidas.db e dados/contas.json pra uma
 * pasta que ele escolhe. Restaurar faz o caminho inverso e reabre o app.
 * Nunca com partida rodando (a caixa de diálogo rouba foco).
 */
const pastaDados = () => process.env.LOLCOACH_DIR ?? process.env.PORTABLE_EXECUTABLE_DIR ?? process.cwd();
const ARQUIVOS_BACKUP = ['config.json', 'dados/partidas.db', 'dados/contas.json', 'dados/uso.json'];
async function backup() {
  if (faseAtual === 'InProgress') return { erro: 'espera acabar a partida' };
  const r = await dialog.showOpenDialog(janela, { title: 'Onde guardar o backup', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { cancelado: true };
  const carimbo = new Date().toISOString().slice(0, 10);
  const destino = join(r.filePaths[0], `LolCoach-backup-${carimbo}`);
  await mkdir(join(destino, 'dados'), { recursive: true });
  let n = 0;
  for (const a of ARQUIVOS_BACKUP) {
    try { await cp(join(pastaDados(), a), join(destino, a)); n++; } catch { /* arquivo que não existe */ }
  }
  estado.log(`backup: ${n} arquivos em ${destino}`);
  return { ok: true, pasta: destino, arquivos: n };
}
async function restaurar() {
  if (faseAtual === 'InProgress') return { erro: 'espera acabar a partida' };
  const r = await dialog.showOpenDialog(janela, { title: 'Pasta do backup (LolCoach-backup-…)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { cancelado: true };
  const origem = r.filePaths[0];
  const tem = (await readdir(origem).catch(() => [])).includes('config.json');
  if (!tem) return { erro: 'essa pasta não tem um backup do LolCoach' };
  let n = 0;
  for (const a of ARQUIVOS_BACKUP) {
    try { await cp(join(origem, a), join(pastaDados(), a)); n++; } catch { /* não tinha */ }
  }
  estado.log(`restaurado: ${n} arquivos de ${origem} — reabrindo`);
  setTimeout(() => { app.relaunch(); app.exit(0); }, 800);
  return { ok: true, arquivos: n };
}

/** Escolher VÁRIAS pastas de skins de uma vez (diálogo nativo; o do navegador só pega uma). */
async function skinsEscolherPastas() {
  if (faseAtual === 'InProgress') return [];   // nunca abre diálogo com o jogo rodando
  const r = await dialog.showOpenDialog(janela ?? undefined, { title: 'Pastas com skins (.fantome / .zip) — pode marcar várias', properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
}
async function skinsEscolherFerramenta() {
  if (faseAtual === 'InProgress') return null;
  const r = await dialog.showOpenDialog(janela ?? undefined, { title: 'Pasta que tem mod-tools.exe e cslol-dll.dll (ex.: a instalação do Rose)', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}
function ligarAtualizacao() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // procura de 5 em 5 min: só registra quando acha algo (senão o registro vira só isso)
  let primeiraBusca = true;
  autoUpdater.on('checking-for-update', () => { if (primeiraBusca) estado.log('procurando atualização…'); });
  autoUpdater.on('update-available', (i) => estado.log(`atualização ${i.version} encontrada — baixando em segundo plano`));
  autoUpdater.on('update-not-available', () => { if (primeiraBusca) estado.log(`você está na versão mais recente (${app.getVersion()})`); primeiraBusca = false; });
  autoUpdater.on('download-progress', (p) => { if (Math.round(p.percent) % 25 === 0) estado.set('atualizacao', { baixando: Math.round(p.percent) }); });
  autoUpdater.on('update-downloaded', (i) => {
    baixada = i.version;
    estado.set('atualizacao', { pronta: i.version });
    estado.log(`atualização ${i.version} pronta — instalo assim que você não estiver em fila, seleção ou partida`);
    // Quem deixa o app aberto pra sempre nunca fechava e ficava preso na
    // versão velha. Instala sozinho no primeiro momento em que não atrapalha:
    // client fechado, ou em None/Lobby/EndOfGame. Nunca com o jogo rodando.
    const tranquilo = () => faseAtual == null || ['None', 'Lobby', 'EndOfGame', 'PreEndOfGame', 'WaitingForStats'].includes(faseAtual);
    if (pedidoManual && tranquilo()) {
      estado.log(`instalando a ${i.version} e reabrindo…`);
      return setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500);
    }
    const tentar = setInterval(() => {
      if (!tranquilo()) return;
      clearInterval(tentar);
      estado.log(`instalando a ${i.version} e reabrindo…`);
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500);
    }, 30_000);
  });
  // Erro (GitHub fora, latest.yml ainda subindo logo depois de publicar): tenta de novo em 2 min, sem esperar os 5
  autoUpdater.on('error', (e) => { const msg = String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 160); estado.log(`atualização: ${msg} — tento de novo em 2 min`); setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 1000); });
  autoUpdater.checkForUpdates().catch(() => {});
  // Ninguém fica em versão velha: procura de 5 em 5 min (é um GET pequeno no latest.yml) e sempre que uma
  // partida termina; o que baixou instala sozinho no primeiro momento tranquilo (None/Lobby/EndOfGame).
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 5 * 60 * 1000);
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
    icon: join(AQUI, 'icone.png'),
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
/**
 * A segunda tela: qualquer monitor que não seja o principal (onde o jogo
 * roda). Com um monitor só, null — e a janela abre pequena, sem foco.
 */
function segundaTela() {
  const principal = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find((d) => d.id !== principal.id) ?? null;
}

/**
 * A tela ao vivo é uma janela própria, aberta na seleção de campeão e SEMPRE
 * na segunda tela, ocupando ela inteira. Nunca rouba o foco: showInactive.
 * Com um monitor só, abre do lado, pequena, também sem foco.
 */
function abrirVivo({ focar = true } = {}) {
  const tela = segundaTela();
  if (janelaVivo && !janelaVivo.isDestroyed()) {
    if (tela) posicionarNaTela(janelaVivo, tela);
    if (focar) { janelaVivo.show(); janelaVivo.focus(); }
    else if (!janelaVivo.isVisible()) janelaVivo.showInactive();
    return;
  }
  janelaVivo = new BrowserWindow({
    width: 520, height: 780, minWidth: 380, minHeight: 420, icon: join(AQUI, 'icone.png'),
    backgroundColor: '#080b11',
    title: 'LolCoach — ao vivo',
    autoHideMenuBar: true,
    show: false,
    ...(tela ? { x: tela.workArea.x, y: tela.workArea.y, width: tela.workArea.width, height: tela.workArea.height } : {}),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  janelaVivo.loadURL(endereco ? `${endereco}/vivo` : PAGINA_DE_ERRO('o painel local não subiu.'));
  janelaVivo.once('ready-to-show', () => {
    if (janelaVivo?.isDestroyed()) return;
    if (tela) posicionarNaTela(janelaVivo, tela);
    if (focar) janelaVivo.show(); else janelaVivo.showInactive();
  });
  janelaVivo.on('closed', () => { janelaVivo = null; });
}
function posicionarNaTela(j, tela) {
  const a = tela.workArea;
  j.setBounds({ x: a.x, y: a.y, width: a.width, height: a.height });
}

/**
 * Overlay em cima do jogo: janela transparente, sempre por cima, que NÃO
 * aceita foco nem clique (passa direto pro jogo) — por isso não minimiza o
 * LoL. Mostra timers, flashes marcados e a última fala, com dados da API
 * pública do jogo. Só aparece com o LoL em "sem bordas" ou janela: em tela
 * cheia exclusiva nada fica por cima (e é assim que a Riot quer).
 */
let janelaOverlay = null;
let overlayLigado = true;
function abrirOverlay() {
  if (!overlayLigado || !endereco) return;
  if (janelaOverlay && !janelaOverlay.isDestroyed()) { if (!janelaOverlay.isVisible()) janelaOverlay.showInactive(); return; }
  const tela = screen.getPrimaryDisplay().workArea;
  const salvo = daemon?.config?.overlay?.posicao;
  janelaOverlay = new BrowserWindow({
    width: salvo?.w || 344, height: salvo?.h || 330, x: salvo?.x ?? tela.x + 10, y: salvo?.y ?? tela.y + Math.round(tela.height * 0.28),
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false,
    resizable: false, hasShadow: false, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  });
  janelaOverlay.setAlwaysOnTop(true, 'screen-saver');
  janelaOverlay.setIgnoreMouseEvents(!overlayAjuste);
  janelaOverlay.setVisibleOnAllWorkspaces(true);
  janelaOverlay.loadURL(`${endereco}/overlay`);
  janelaOverlay.once('ready-to-show', () => { if (janelaOverlay && !janelaOverlay.isDestroyed()) janelaOverlay.showInactive(); });
  janelaOverlay.on('closed', () => { janelaOverlay = null; });
}
function fecharOverlay() {
  if (janelaOverlay && !janelaOverlay.isDestroyed()) janelaOverlay.close();
  janelaOverlay = null;
}
/**
 * Modo ajuste do overlay: a janela passa a receber o mouse (sem pegar foco),
 * a página mostra uma barra pra arrastar, um canto pra redimensionar e
 * botões de escala; ao terminar, salva posição/tamanho no config e volta a
 * ser transparente ao mouse. Fora da partida abre o overlay só pra ajustar.
 */
let overlayAjuste = false;
function overlayAjustar({ ligar } = {}) {
  overlayAjuste = ligar !== false && ligar !== 'false' && ligar !== '0';
  if (overlayAjuste) {
    if (!janelaOverlay || janelaOverlay.isDestroyed()) { const antes = overlayLigado; overlayLigado = true; abrirOverlay(); overlayLigado = antes; }
    else janelaOverlay.setIgnoreMouseEvents(false);
    estado.log('overlay: modo ajuste (arrasta, redimensiona, escala; "Pronto" salva)');
  } else if (janelaOverlay && !janelaOverlay.isDestroyed()) {
    janelaOverlay.setIgnoreMouseEvents(true);
    const b = janelaOverlay.getBounds();
    daemon.acoes.salvarConfig({ overlay: { posicao: { x: b.x, y: b.y, w: b.width, h: b.height } } }).catch(() => {});
    estado.log(`overlay: posição salva (${b.x},${b.y} ${b.width}×${b.height})`);
    if (faseAtual !== 'InProgress' && faseAtual !== 'GameStart') fecharOverlay();
  }
  return { ajuste: overlayAjuste };
}
function overlayMover({ dx = 0, dy = 0, dw = 0, dh = 0 } = {}) {
  if (!janelaOverlay || janelaOverlay.isDestroyed() || !overlayAjuste) return { ok: false };
  const b = janelaOverlay.getBounds();
  janelaOverlay.setBounds({ x: b.x + Number(dx), y: b.y + Number(dy), width: Math.max(220, b.width + Number(dw)), height: Math.max(160, b.height + Number(dh)) });
  return { ok: true };
}
const overlayEstado = () => ({ ajuste: overlayAjuste, aberto: !!(janelaOverlay && !janelaOverlay.isDestroyed()) });

/**
 * O olho: janela escondida que captura a tela do jogo (como o OBS, pela
 * API de captura do Chromium — nada de memória) e procura os ícones dos
 * inimigos no minimapa. É o "jungle tracking" do ABSOL. Só existe durante a
 * partida; nunca aparece nem pega foco. Desliga em config.olho.ligado=false.
 */
let janelaOlho = null;
function abrirOlho() {
  if (!endereco || daemon?.config?.olho?.ligado === false) return;
  if (janelaOlho && !janelaOlho.isDestroyed()) return;
  janelaOlho = new BrowserWindow({
    width: 400, height: 300, show: false, skipTaskbar: true, focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  });
  janelaOlho.loadURL(`${endereco}/olho`);
  // O que a janela escondida diz vai pro registro do app: é a única forma de ver por que não achou o minimapa.
  janelaOlho.webContents.on('console-message', (ev) => { const msg = String(ev?.message ?? ''); if (msg.includes('[olho]')) estado.log(msg.replace('[olho] ', 'olho: ')); });
  janelaOlho.webContents.on('did-fail-load', (_e, code, desc) => estado.log(`olho: não carregou (${code} ${desc})`));
  estado.log('olho: janela aberta');
  janelaOlho.on('closed', () => { janelaOlho = null; });
}
/**
 * A voz: janela escondida que toca as falas da seleção até o fim da partida.
 * Nunca aparece; sem "hidden" por estar coberta (backgroundThrottling off) e
 * sem exigir clique pra tocar áudio (autoplayPolicy).
 */
let janelaVoz = null;
function abrirVoz() {
  if (!endereco) return;
  if (janelaVoz && !janelaVoz.isDestroyed()) return;
  janelaVoz = new BrowserWindow({
    width: 300, height: 200, show: false, skipTaskbar: true, focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  janelaVoz.loadURL(`${endereco}/voz`);
  janelaVoz.webContents.on('console-message', (ev) => { const msg = String(ev?.message ?? ''); if (msg.includes('[voz]')) estado.log(msg.replace('[voz] ', 'voz: ')); });
  janelaVoz.on('closed', () => { janelaVoz = null; });
}
function fecharVoz() {
  if (janelaVoz && !janelaVoz.isDestroyed()) janelaVoz.close();
  janelaVoz = null;
}
function fecharOlho() {
  if (janelaOlho && !janelaOlho.isDestroyed()) janelaOlho.close();
  janelaOlho = null;
}
/** A captura pede "qual tela?"; respondemos sozinhos: a tela principal, onde o jogo roda. */
function prepararCaptura() {
  session.defaultSession.setDisplayMediaRequestHandler((_pedido, responder) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then((fontes) => {
      const principal = String(screen.getPrimaryDisplay().id);
      const fonte = fontes.find((f) => f.display_id === principal) ?? fontes[0];
      if (fonte) responder({ video: fonte, audio: false }); else responder(null);
    }).catch(() => responder(null));
  }, { useSystemPicker: false });
}

/**
 * Atalhos globais, configuráveis na aba Configuração (config.atalhos). O do
 * flash vale pra posição 1; as outras seguem: se termina em dígito, 1..5;
 * se termina em F-tecla, F(n)..F(n+4). Só escuta a tecla — nada entra no jogo.
 */
function variantesDoFlash(acelerador) {
  const partes = String(acelerador || 'Control+Alt+1').split('+');
  const ultima = partes.pop();
  const prefixo = partes.length ? partes.join('+') + '+' : '';
  if (/^\d$/.test(ultima)) return [1, 2, 3, 4, 5].map((n) => `${prefixo}${n}`);
  const f = ultima.match(/^F(\d{1,2})$/i);
  if (f) return [0, 1, 2, 3, 4].map((i) => `${prefixo}F${Math.min(24, Number(f[1]) + i)}`);
  return [`${prefixo}${ultima}`];   // uma tecla só: marca a posição 1
}
/**
 * As teclas. O atalho global do Electron (RegisterHotKey) NÃO dispara com o
 * jogo em foco — foi o que ele viu: só funcionava clicando na outra tela.
 * Então um vigia em PowerShell (electron/teclas.ps1) pergunta ao Windows 40x
 * por segundo se a tecla está apertada (GetAsyncKeyState, o mesmo que o
 * push-to-talk do Discord) e avisa pela porta local. Um processo só, vive
 * enquanto o app vive; reinicia só quando a configuração de teclas muda.
 */
let vigia = null;
function acoesDasTeclas() {
  return {
    flash: (n) => { if (endereco) fetch(`${endereco}/api/flash?posicao=${n}`, { method: 'POST' }).catch(() => {}); },
    overlay: () => {
      overlayLigado = !overlayLigado;
      if (overlayLigado && (faseAtual === 'InProgress' || faseAtual === 'GameStart')) abrirOverlay(); else fecharOverlay();
      estado.log(`overlay ${overlayLigado ? 'ligado' : 'desligado'}`);
    },
    hud: () => { if (endereco) fetch(`${endereco}/api/overlay/tamanho`, { method: 'POST' }).catch(() => {}); },
    bom: () => { if (endereco) fetch(`${endereco}/api/situacoes/avaliar-ultima?nota=1`, { method: 'POST' }).catch(() => {}); },
    ruim: () => { if (endereco) fetch(`${endereco}/api/situacoes/avaliar-ultima?nota=-1`, { method: 'POST' }).catch(() => {}); },
    painel: () => {
      if (!janela || janela.isDestroyed() || faseAtual === 'InProgress') return;
      if (janela.isVisible() && janela.isFocused()) janela.hide(); else { janela.show(); janela.focus(); }
    },
  };
}
/** Chamado pelo servidor local quando o vigia vê uma tecla: "flash3", "overlay", "painel". */
function teclaApertada(acao) {
  const f = acoesDasTeclas();
  const flash = String(acao).match(/^flash(\d)$/);
  if (flash) return f.flash(Number(flash[1]));
  if (f[acao]) return f[acao]();
}
function registrarAtalhos(cfg) {
  const at = { overlay: 'Control+Shift+O', painel: 'Control+Shift+L', bom: 'num6', ruim: 'num9', hud: 'num0', ...(cfg?.atalhos ?? {}) };
  const flashes = Array.isArray(at.flashes) && at.flashes.length ? at.flashes : variantesDoFlash(at.flash);
  const pares = [...flashes.slice(0, 5).map((acel, i) => `flash${i + 1}=${acel}`), `overlay=${at.overlay}`, `painel=${at.painel}`, `bom=${at.bom}`, `ruim=${at.ruim}`, `hud=${at.hud}`]
    .filter((p) => !p.endsWith('=') && !p.endsWith('=null') && !p.endsWith('=undefined'));
  if (vigia) { try { vigia.kill(); } catch { /* já morreu */ } vigia = null; }
  const script = app.isPackaged ? join(process.resourcesPath, 'teclas.ps1') : join(AQUI, 'teclas.ps1');
  try {
    vigia = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Porta', '8770', '-Teclas', pares.join(';')],
      { windowsHide: true, stdio: 'ignore' });
    const este = vigia;
    este.on('exit', (codigo) => { if (vigia === este) { vigia = null; estado.set('atalhos', { vigia: false }); estado.log(`vigia de teclas parou (${codigo})`); } });
    estado.set('atalhos', { vigia: true, teclas: pares });
    estado.log(`teclas: ${pares.join(', ')}`);
  } catch (erro) {
    estado.set('atalhos', { vigia: false });
    estado.log(`não consegui iniciar o vigia de teclas: ${erro.message}`);
  }
}

/**
 * Abre junto com o Windows (padrão: ligado pra todo mundo — ninguém joga sem o app). Quando o Windows
 * abre o app, ele nasce só na bandeja, sem painel na cara. Desliga pelo menu da bandeja (fica no config).
 */
const ABERTO_PELO_WINDOWS = process.argv.includes('--iniciado-pelo-windows');
function ligarInicioComWindows(ligar) {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!ligar, path: process.execPath, args: ['--iniciado-pelo-windows'] });
  } catch (e) { estado.log(`abrir com o Windows: ${e.message}`); }
}
function criarBandeja() {
  const icone = nativeImage.createFromPath(join(AQUI, 'icone-bandeja.png'));
  bandeja = new Tray(icone.isEmpty() ? nativeImage.createEmpty() : icone);
  bandeja.setToolTip('LolCoach');
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir painel', click: () => (janela ? janela.show() : criarJanela()) },
    { label: 'Abrir tela ao vivo', click: () => abrirVivo() },
    { label: 'Ajustar overlay (posição e tamanho)', click: () => overlayAjustar({ ligar: true }) },
    { label: 'Abrir com o Windows', type: 'checkbox', checked: daemon?.config?.iniciarComWindows !== false, click: (item) => { ligarInicioComWindows(item.checked); daemon?.acoes?.salvarConfig?.({ iniciarComWindows: item.checked }).catch(() => {}); estado.log(item.checked ? 'abre com o Windows: ligado' : 'abre com o Windows: desligado'); } },
    { label: 'Overlay no jogo (Ctrl+Shift+O)', type: 'checkbox', checked: true, click: (item) => { overlayLigado = item.checked; if (!overlayLigado) fecharOverlay(); else if (faseAtual === 'InProgress') abrirOverlay(); } },
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
      aoSelecionar: () => { abrirVoz(); abrirVivo({ focar: false }); },
      aoConfig: (cfg) => registrarAtalhos(cfg),
      aoFase: (fase) => {
        const antes = faseAtual;
        faseAtual = fase;
        // Saiu da partida: se o painel estava esperando pra aparecer, agora pode.
        if (fase !== 'InProgress') mostrarPainelSeSeguro();
        // Overlay: nasce quando o jogo carrega e some quando acaba.
        if (fase === 'InProgress' || fase === 'GameStart' || fase === 'ChampSelect') abrirVoz();
        else if (['None', 'Lobby', 'Matchmaking'].includes(fase)) fecharVoz();
        else if (fase === 'EndOfGame') setTimeout(() => { if (faseAtual === 'EndOfGame' || faseAtual === 'None' || faseAtual === 'Lobby') fecharVoz(); }, 25_000);   // dá tempo do "avalia as falas"
        if (fase === 'InProgress' || fase === 'GameStart') { abrirOverlay(); abrirOlho(); }
        else if (antes === 'InProgress' || antes === 'GameStart') { fecharOverlay(); fecharOlho(); }
        // Acabou uma partida: boa hora pra procurar (e instalar) atualização.
        if (antes === 'InProgress' && fase !== 'InProgress' && app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
      },
    });
    ({ url: endereco } = await criarServidor({
      db: daemon.db, estado, porta: 8770,
      acoes: { ...daemon.acoes, atualizar: atualizarAgora, backup, restaurar, tecla: teclaApertada, overlayAjustar, overlayMover, overlayEstado, skinsEscolherPastas, skinsEscolherFerramenta },
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
  ligarInicioComWindows(daemon?.config?.iniciarComWindows !== false);
  if (ABERTO_PELO_WINDOWS) { painelPendente = false; estado.log('aberto junto com o Windows — fica na bandeja'); }
  ligarAtualizacao();
  registrarAtalhos(daemon.config);
  prepararCaptura();
  if (faseAtual === 'InProgress') { abrirOverlay(); abrirOlho(); abrirVoz(); }

  setTimeout(() => {
    if (!painelPendente) return;
    if (faseAtual === 'InProgress') {
      estado.log('app aberto durante a partida — painel fica escondido até o jogo acabar');
      return;
    }
    mostrarPainelSeSeguro();
  }, 4000);
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); if (vigia) { try { vigia.kill(); } catch { /* já morreu */ } } });
app.on('window-all-closed', (e) => e.preventDefault());  // vive na bandeja
app.on('before-quit', () => {
  app.saindo = true;
  janelaVivo?.destroy();
  daemon?.fechar();
});
