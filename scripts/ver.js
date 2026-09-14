import { LcuClient } from '../src/lcu/client.js';
import { abrirBanco } from '../src/dados/banco.js';
import { abrirEm, configuracaoDeReplay, estadoDoArquivo } from '../src/replay/replay.js';

const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

const gameId = Number(process.argv[2]);
const alvo = process.argv[3];

if (!gameId) {
  console.log(`uso:  node scripts/ver.js <gameId> [mm:ss]

sem o tempo, lista os apontamentos daquela partida pra voce escolher.`);
  process.exit(0);
}

const db = abrirBanco();
const achados = db.prepare('SELECT * FROM achados WHERE gameId = ? ORDER BY t').all(gameId);

if (!alvo) {
  const p = db.prepare('SELECT * FROM partidas WHERE gameId = ?').get(gameId);
  if (!p) { console.log('essa partida nao esta no banco.'); process.exit(1); }
  console.log(`${p.meuCampeao} ${p.minhaRole} - ${p.venci ? 'vitoria' : 'derrota'}\n`);
  for (const a of achados) console.log(`  ${mmss(a.t)}  ${'!'.repeat(a.gravidade).padEnd(3)} ${a.titulo}`);
  console.log(`\npra assistir:  node scripts/ver.js ${gameId} ${mmss(achados[0]?.t ?? 0)}`);
  process.exit(0);
}

const [mm, ss] = alvo.split(':').map(Number);
const segundos = mm * 60 + (ss || 0);

const lcu = new LcuClient();
await lcu.conectar();

const cfg = await configuracaoDeReplay(lcu);
if (!cfg.isReplaysEnabled) { console.log('replays estao desabilitados no client.'); process.exit(1); }
if (cfg.isPlayingGame) { console.log('voce esta numa partida. saia antes.'); process.exit(1); }

const meta = await estadoDoArquivo(lcu, gameId);
console.log(`replay: ${meta?.state ?? 'nao baixado'} | patch do client: ${cfg.gameVersion}`);
console.log(`abrindo em ${alvo} (recuando 12s)...`);

try {
  await abrirEm(lcu, gameId, segundos);
  const perto = achados.find((a) => Math.abs(a.t / 1000 - segundos) < 30);
  if (perto) {
    console.log(`\n${perto.titulo}`);
    for (const m of perto.motivos.split(' | ')) console.log(`  - ${m}`);
  }
  console.log('\nreplay aberto e pausado. o app nao fecha o jogo: feche voce quando terminar.');
} catch (erro) {
  console.log(`falhou: ${erro.message}`);
}
lcu.fechar();
