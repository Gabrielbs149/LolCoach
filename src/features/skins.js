/**
 * Skins só pra você (custom skins): o LolCoach NÃO mexe no processo do jogo — quem
 * faz isso é o cslol-manager (código aberto, LeagueToolkit), que a gente baixa do
 * GitHub dele e usa pela linha de comando (cslol-tools/mod-tools.exe):
 *   import    .fantome/.zip → pasta do mod
 *   mkoverlay mods escolhidos → overlay
 *   runoverlay overlay → fica esperando o jogo abrir e aplica (é o "patcher")
 *
 * Tudo fica em <dados>/skins: tools/ (cslol-tools + version.txt), mods/<nome>/,
 * overlay/. A escolha por campeão fica no config (skins.porCampeao). Quando o
 * campeão trava na seleção, o overlay do mod dele é montado e o patcher sobe;
 * ele morre quando a partida acaba.
 *
 * A Riot diz que não pune skin customizada, mas é modificação do cliente do jogo —
 * a tela avisa, e o painel de controle pode desligar a função pra todo mundo ('skins').
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, readdir, rm, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pastaBase } from '../caminhos.js';

const execFileP = promisify(execFile);
const REPO = 'LeagueToolkit/cslol-manager';
const UA = 'LolCoach';
const CAMINHOS_JOGO = ['C:\\Riot Games\\League of Legends\\Game', 'D:\\Riot Games\\League of Legends\\Game', 'C:\\Program Files\\Riot Games\\League of Legends\\Game', 'C:\\Program Files (x86)\\Riot Games\\League of Legends\\Game'];

const pasta = () => resolve(pastaBase(), 'skins');
const pastaTools = () => join(pasta(), 'tools');
const pastaMods = () => join(pasta(), 'mods');
const pastaOverlay = () => join(pasta(), 'overlay');
const modTools = () => join(pastaTools(), 'mod-tools.exe');

export function criarSkins({ config, salvarConfig, log = () => {}, lcu = null }) {
  let patcher = null;          // processo do runoverlay
  let patcherDesde = 0, patcherMod = null;
  let instalando = null;

  const instalado = () => existsSync(modTools());
  async function versaoInstalada() { try { return (await readFile(join(pastaTools(), 'version.txt'), 'utf8')).replace(/^Version:\s*/i, '').trim(); } catch { return null; } }

  /** Pasta Game do League: pelo lockfile do client conectado, senão os caminhos comuns, senão o config. */
  function pastaDoJogo() {
    const cfg = config.skins?.jogo;
    if (cfg && existsSync(join(cfg, 'League of Legends.exe'))) return cfg;
    const lock = lcu?.credenciais?.caminho;
    if (lock) { const g = join(dirname(lock), 'Game'); if (existsSync(join(g, 'League of Legends.exe'))) return g; }
    return CAMINHOS_JOGO.find((g) => existsSync(join(g, 'League of Legends.exe'))) ?? null;
  }

  /** Baixa a última release do cslol-manager (exe auto-extraível 7z) e guarda só o cslol-tools. */
  async function instalar() {
    if (instalando) return instalando;
    instalando = (async () => {
      const rel = await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': UA } })).json();
      const asset = (rel.assets ?? []).find((a) => a.name === 'cslol-manager-windows.exe');
      if (!asset) throw new Error('release do cslol-manager sem o instalador do Windows');
      const versao = String(rel.tag_name ?? '');
      if (instalado() && (await versaoInstalada()) === versao) return { versao, jaTinha: true };
      log(`skins: baixando cslol-manager ${versao} (${Math.round(asset.size / 1e6)} MB)…`);
      const tmp = join(tmpdir(), `lolcoach-cslol-${Date.now()}`);
      await mkdir(tmp, { recursive: true });
      const exe = join(tmp, 'cslol.exe');
      const corpo = Buffer.from(await (await fetch(asset.browser_download_url, { headers: { 'User-Agent': UA } })).arrayBuffer());
      await writeFile(exe, corpo);
      // auto-extraível 7z: -y -o<pasta>
      await execFileP(exe, ['-y', `-o${join(tmp, 'ext')}`], { windowsHide: true, timeout: 120_000 });
      const raiz = (await readdir(join(tmp, 'ext'))).map((n) => join(tmp, 'ext', n)).find((p) => existsSync(join(p, 'cslol-tools', 'mod-tools.exe')));
      if (!raiz) throw new Error('não achei cslol-tools dentro do pacote');
      await rm(pastaTools(), { recursive: true, force: true });
      await mkdir(pastaTools(), { recursive: true });
      for (const n of await readdir(join(raiz, 'cslol-tools'))) await copyFile(join(raiz, 'cslol-tools', n), join(pastaTools(), n));
      await writeFile(join(pastaTools(), 'version.txt'), `Version: ${versao}`);
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
      log(`skins: cslol-tools ${versao} pronto`);
      return { versao };
    })().finally(() => { instalando = null; });
    return instalando;
  }

  /** Lê os mods importados: nome, campeão (pelo WAD), info do META. */
  async function listarMods() {
    const saida = [];
    for (const nome of await readdir(pastaMods()).catch(() => [])) {
      const dir = join(pastaMods(), nome);
      try { if (!(await stat(dir)).isDirectory()) continue; } catch { continue; }
      let info = {}; try { info = JSON.parse(await readFile(join(dir, 'META', 'info.json'), 'utf8')); } catch { /* sem META */ }
      const wads = await readdir(join(dir, 'WAD')).catch(() => []);
      const campeoes = [...new Set(wads.map((w) => w.replace(/\.wad\.client$/i, '')).filter((w) => /^[A-Za-z]+$/.test(w) && !/^(Global|UI|Map\d+|Shared|Common)/i.test(w)))];
      saida.push({ nome, titulo: info.Name ?? nome, autor: info.Author ?? null, versao: info.Version ?? null, descricao: info.Description ?? null, campeoes });
    }
    return saida.sort((a, b) => a.titulo.localeCompare(b.titulo));
  }

  /** Importa um .fantome/.zip (o corpo do upload) como mod. */
  async function importar({ nome, corpo }) {
    if (!instalado()) throw new Error('instala o cslol-tools primeiro');
    const jogo = pastaDoJogo(); if (!jogo) throw new Error('não achei a pasta do jogo (abre o League uma vez)');
    const limpo = String(nome ?? 'mod').replace(/\.(fantome|zip)$/i, '').replace(/[^\w .\-()\[\]]/g, '_').trim() || `mod-${Date.now()}`;
    const tmp = join(tmpdir(), `lolcoach-mod-${Date.now()}.fantome`);
    await writeFile(tmp, corpo);
    await mkdir(pastaMods(), { recursive: true });
    const destino = join(pastaMods(), limpo);
    await rm(destino, { recursive: true, force: true });
    try {
      const { stderr } = await execFileP(modTools(), ['import', tmp, destino, `--game:${jogo}`], { windowsHide: true, timeout: 180_000 });
      if (stderr?.trim()) log(`skins: import ${limpo}: ${stderr.trim().slice(0, 200)}`);
    } finally { await rm(tmp, { force: true }).catch(() => {}); }
    const m = (await listarMods()).find((x) => x.nome === limpo);
    log(`skins: mod "${m?.titulo ?? limpo}" importado (${(m?.campeoes ?? []).join(', ') || 'campeão não identificado'})`);
    // sem escolha pra esse campeão ainda: já deixa escolhido
    for (const c of m?.campeoes ?? []) if (!config.skins?.porCampeao?.[c]) await escolher({ campeao: c, mod: limpo });
    return m;
  }

  /** Varre pastas do disco (recursivo) e importa todo .fantome/.zip — progresso fica em estado().importando */
  let importando = null;
  async function importarPastas({ pastas = [] } = {}) {
    if (importando) return { erro: 'já tem uma importação rodando' };
    const arquivos = [];
    const varrer = async (dir, prof = 0) => {
      if (prof > 6) return;
      for (const n of await readdir(dir).catch(() => [])) {
        const c = join(dir, n);
        let st; try { st = await stat(c); } catch { continue; }
        if (st.isDirectory()) await varrer(c, prof + 1);
        else if (/\.(fantome|zip)$/i.test(n)) arquivos.push(c);
      }
    };
    for (const p of pastas) await varrer(p);
    if (!arquivos.length) return { total: 0, ok: 0, erros: [] };
    importando = { total: arquivos.length, feitos: 0, atual: null, ok: 0, erros: [] };
    (async () => {
      for (const arq of arquivos) {
        importando.atual = basename(arq);
        try { await importar({ nome: basename(arq), corpo: await readFile(arq) }); importando.ok++; }
        catch (e) { importando.erros.push(`${basename(arq)}: ${e.message}`); }
        importando.feitos++;
      }
      log(`skins: ${importando.ok} de ${importando.total} skins importadas das pastas${importando.erros.length ? ` (${importando.erros.length} com erro)` : ''}`);
      const fim = importando; importando = null; ultimaImportacao = fim;
    })();
    return { total: arquivos.length, iniciado: true };
  }
  let ultimaImportacao = null;

  async function remover({ mod }) {
    const nome = basename(String(mod ?? '')); if (!nome) throw new Error('mod?');
    await rm(join(pastaMods(), nome), { recursive: true, force: true });
    const por = { ...(config.skins?.porCampeao ?? {}) };
    for (const [c, m] of Object.entries(por)) if (m === nome) delete por[c];
    config.skins = { ...(config.skins ?? {}), porCampeao: por };
    await salvarConfig({ skins: config.skins });
    return { ok: true };
  }

  async function escolher({ campeao, mod }) {
    if (!campeao) throw new Error('campeão?');
    const por = { ...(config.skins?.porCampeao ?? {}) };
    if (mod) por[campeao] = basename(String(mod)); else delete por[campeao];
    config.skins = { ...(config.skins ?? {}), porCampeao: por };
    await salvarConfig({ skins: config.skins });
    return { ok: true, porCampeao: por };
  }

  const chaveCampeao = (n) => String(n ?? '').replace(/[^A-Za-z]/g, '').toLowerCase();

  /** Na seleção, com o campeão travado: monta o overlay do mod escolhido e sobe o patcher. */
  async function aplicar(campeao) {
    if (config.skins?.ativo === false || !instalado()) return null;
    const por = config.skins?.porCampeao ?? {};
    const nomeMod = Object.entries(por).find(([c]) => chaveCampeao(c) === chaveCampeao(campeao))?.[1];
    if (!nomeMod) return null;
    if (!existsSync(join(pastaMods(), nomeMod))) { log(`skins: mod "${nomeMod}" sumiu`); return null; }
    const jogo = pastaDoJogo(); if (!jogo) { log('skins: não achei a pasta do jogo'); return null; }
    await parar();
    await rm(pastaOverlay(), { recursive: true, force: true }).catch(() => {});
    await mkdir(pastaOverlay(), { recursive: true });
    try {
      await execFileP(modTools(), ['mkoverlay', pastaMods(), pastaOverlay(), `--game:${jogo}`, `--mods:${nomeMod}`, '--noTFT'], { windowsHide: true, timeout: 180_000 });
    } catch (e) { log(`skins: overlay de "${nomeMod}" falhou: ${String(e.stderr || e.message).slice(0, 200)}`); return null; }
    const cfgArq = join(pasta(), 'patcher.cfg');
    // stdin fica aberto: o runoverlay lê comandos por ele e fecha no EOF (com 'ignore' morria em 5 s)
    patcher = spawn(modTools(), ['runoverlay', pastaOverlay(), cfgArq, `--game:${jogo}`, '--opts:configless'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    patcherDesde = Date.now(); patcherMod = nomeMod;
    const eco = (b) => { const t = String(b).trim(); if (t && !/^\[DLL\]|^\s*$/.test(t)) log(`skins: ${t.split('\n').at(-1).slice(0, 140)}`); };
    patcher.stdout.on('data', eco); patcher.stderr.on('data', eco);
    patcher.on('exit', (code) => { if (patcherMod === nomeMod) { log(`skins: patcher fechou (${code})`); patcher = null; } });
    log(`skins: "${nomeMod}" pronta pra ${campeao} — patcher esperando o jogo abrir`);
    return { mod: nomeMod };
  }

  async function parar() {
    if (!patcher) return;
    try { patcher.kill(); } catch { /* já morreu */ }
    patcher = null; patcherMod = null;
  }

  async function estado() {
    return {
      instalado: instalado(), versao: await versaoInstalada(), instalando: !!instalando,
      jogo: pastaDoJogo(), ativo: config.skins?.ativo !== false,
      mods: await listarMods(), porCampeao: config.skins?.porCampeao ?? {},
      patcher: patcher ? { mod: patcherMod, desde: patcherDesde } : null,
      importando, ultimaImportacao,
    };
  }

  return { instalar, importar, importarPastas, remover, escolher, aplicar, parar, estado, instalado };
}
