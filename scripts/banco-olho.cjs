/**
 * Servidor da bancada do olho: serve o olho.html do repositório, as FOTOS de minimapa
 * que o app gravou, e repassa ícone/arte/campeões pro app que está rodando na 8770.
 * É o que permite medir molde e limiar sem jogar nada.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Gabriel/AppData/Roaming/lolcoach/dados/partidas.db', { readOnly: true });
const SITU = 'C:/Users/Gabriel/AppData/Roaming/lolcoach/dados/situacoes';
const MAPA = 14820;

/**
 * Verdade da Riot pra cada foto: só as que caem a menos de 4 s de um minuto cheio,
 * onde o frame gravado pela Riot é praticamente exato. Interpolar posição no meio do
 * minuto erraria em TP e renascimento, e aí eu estaria medindo o meu chute.
 */
function verdadeDasFotos() {
  const saida = {};
  for (const pasta of fs.readdirSync(SITU)) {
    const pj = path.join(SITU, pasta, 'partida.json');
    if (!fs.existsSync(pj)) continue;
    let info; try { info = JSON.parse(fs.readFileSync(pj, 'utf8').split('\n')[0]); } catch { continue; }
    if (!info?.gameId) continue;
    const jogs = db.prepare('SELECT participantId, campeao FROM jogadores WHERE gameId = ?').all(info.gameId);
    if (!jogs.length) continue;
    const porId = new Map(jogs.map((j) => [j.participantId, j.campeao]));
    const porMinuto = new Map();
    for (const f of db.prepare('SELECT minuto, participantId, x, y FROM frames WHERE gameId = ?').all(info.gameId)) {
      const c = porId.get(f.participantId); if (!c) continue;
      const m = porMinuto.get(f.minuto) ?? {};
      m[c] = { x: Math.round((f.x / MAPA) * 1000) / 1000, y: Math.round((1 - f.y / MAPA) * 1000) / 1000 };
      porMinuto.set(f.minuto, m);
    }
    if (porMinuto.size) saida[pasta] = Object.fromEntries(porMinuto);
  }
  return saida;
}
let verdadeCache = null;
const REPO = 'C:/Users/Gabriel/OneDrive/Desktop/LolCoach/src/ui';
const FOTOS = 'C:/Users/Gabriel/AppData/Roaming/lolcoach/dados/olho';

const proxy = (req, res) => {
  const r = http.request({ host: '127.0.0.1', port: 8770, path: req.url, method: req.method }, (pr) => {
    res.writeHead(pr.statusCode, pr.headers); pr.pipe(res);
  });
  r.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(r);
};

http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && u.startsWith('/api/olho')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (u === '/api/campeoes' || u.startsWith('/icone/') || u.startsWith('/circulo/') || u.startsWith('/arte/') || u === '/minimapa.png') return proxy(req, res);
  if (u === '/olho') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(REPO, 'olho.html')).pipe(res); }

  // lista das fotos: /fotos  -> [{pasta, frames:[{png, json}]}]
  if (u === '/verdade') {
    verdadeCache ??= verdadeDasFotos();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(verdadeCache));
  }
  if (u === '/fotos') {
    const saida = [];
    for (const pasta of fs.readdirSync(FOTOS)) {
      const dir = path.join(FOTOS, pasta);
      if (!fs.statSync(dir).isDirectory()) continue;
      const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
      const frames = [];
      for (const png of pngs) {
        const js = path.join(dir, png.replace(/\.png$/, '.json'));
        if (!fs.existsSync(js)) continue;
        frames.push({ png: `/fotos/${pasta}/${png}`, meta: JSON.parse(fs.readFileSync(js, 'utf8')) });
      }
      if (frames.length) saida.push({ pasta, frames });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(saida));
  }
  if (u.startsWith('/fotos/')) {
    const p = path.join(FOTOS, u.slice('/fotos/'.length));
    // path.join devolve com barra invertida no Windows: normaliza antes de comparar
    const norm = (q) => q.split(path.sep).join('/');
    if (!norm(p).startsWith(FOTOS) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': p.endsWith('.png') ? 'image/png' : 'application/json' });
    return fs.createReadStream(p).pipe(res);
  }
  res.writeHead(404); res.end();
}).listen(8785, () => console.log('bancada em http://127.0.0.1:8785/olho?banco=1'));
setTimeout(() => process.exit(0), 1800000);
