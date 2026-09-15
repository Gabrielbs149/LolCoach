/**
 * Gera o ícone do app (electron/icone.png, 512px) a partir de um SVG desenhado
 * aqui: monograma LC dourado num quadrado escuro. Roda uma vez; o PNG vai no
 * repo e o electron-builder converte pra .ico no instalador.
 *
 *   npx electron scripts/icone.cjs
 */
const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#131c27"/><stop offset="1" stop-color="#070a0f"/></linearGradient>
    <linearGradient id="o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0d9a8"/><stop offset="1" stop-color="#c8aa6e"/></linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="96" fill="url(#f)" stroke="#c8aa6e" stroke-width="14"/>
  <path d="M120 140 v232 h112" fill="none" stroke="url(#o)" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M392 190 a84 84 0 1 0 0 132" fill="none" stroke="url(#o)" stroke-width="44" stroke-linecap="round"/>
  <circle cx="256" cy="400" r="14" fill="#31b073"/>
</svg>`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 512, height: 512, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${SVG}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  await writeFile(join(__dirname, '..', 'electron', 'icone.png'), img.toPNG());
  // Versão pequena pra bandeja fica nítida em 32px.
  await writeFile(join(__dirname, '..', 'electron', 'icone-bandeja.png'), img.resize({ width: 32, height: 32, quality: 'best' }).toPNG());
  console.log('icone.png 512px + icone-bandeja.png 32px');
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
