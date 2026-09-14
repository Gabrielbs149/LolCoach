/**
 * Baixa os emblemas de elo do client (Community Dragon), recorta o miolo e
 * salva em src/ui/emblemas/{tier}.png. Roda uma vez; o resultado vai no repo.
 *
 *   npx electron scripts/emblemas.cjs
 *
 * Usa o nativeImage do Electron porque não tem biblioteca de imagem no projeto
 * e o original é um quadro 2560x1440 com o emblema pequeno no meio.
 */
const { app, nativeImage } = require('electron');
const { writeFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');

const BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem';
const TIERS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'];
const DESTINO = join(__dirname, '..', 'src', 'ui', 'emblemas');
const LADO = 160;

/** Caixa dos pixels não transparentes, pra centralizar sem depender do desenho. */
function caixa(img) {
  const { width, height } = img.getSize();
  const bmp = img.toBitmap(); // BGRA
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bmp[(y * width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

app.whenReady().then(async () => {
  await mkdir(DESTINO, { recursive: true });
  for (const tier of TIERS) {
    const r = await fetch(`${BASE}/emblem-${tier}.png`);
    if (!r.ok) { console.log(`${tier}: HTTP ${r.status}`); continue; }
    const img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
    const { x0, y0, x1, y1 } = caixa(img);
    // Quadrado em volta do emblema, com uma folga de 6%.
    const lado = Math.round(Math.max(x1 - x0, y1 - y0) * 1.06);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const recorte = img.crop({ x: Math.round(cx - lado / 2), y: Math.round(cy - lado / 2), width: lado, height: lado })
      .resize({ width: LADO, height: LADO, quality: 'best' });
    const png = recorte.toPNG();
    await writeFile(join(DESTINO, `${tier}.png`), png);
    console.log(`${tier}: ${x1 - x0}x${y1 - y0} → ${LADO}px, ${Math.round(png.length / 1024)} KB`);
  }
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
