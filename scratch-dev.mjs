process.env.LOLCOACH_DEV = '1';
import { iniciarDaemon } from './src/daemon.js';
import { criarServidor, criarEstado } from './src/ui/servidor.js';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
const estado = criarEstado();
const app = await iniciarDaemon({ estado });
const { url } = await criarServidor({ db: app.db, estado, porta: 8771, acoes: app.acoes });
const P = 'C:/Users/Gabriel/AppData/Local/Temp/claude/C--Users-Gabriel-OneDrive-Desktop/1dcabd8b-c0fd-45e7-83d1-7fd21bbd4cf1/scratchpad/partida';
http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/lista') { const d = u.searchParams.get('d'); const fs = (await readdir(`${P}/${d}`)).filter((f) => f.endsWith('.png')); res.end(JSON.stringify(fs)); return; }
    const f = await readFile(`${P}${decodeURIComponent(u.pathname)}`);
    res.setHeader('Content-Type', u.pathname.endsWith('.json') ? 'application/json' : 'image/png'); res.end(f);
  } catch { res.statusCode = 404; res.end('x'); }
}).listen(8772);
console.log('dev em', url, '+ amostras em 8772');
