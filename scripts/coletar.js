import { LcuClient } from '../src/lcu/client.js';
import { abrirBanco, CAMINHO_PADRAO } from '../src/dados/banco.js';
import { coletarPendentes } from '../src/dados/coletor.js';

const lcu = new LcuClient();
await lcu.conectar();
const db = abrirBanco();

console.log(`banco: ${CAMINHO_PADRAO}\n`);

const salvos = await coletarPendentes(lcu, db, {
  quantas: 20,
  forcar: process.argv.includes('--reprocessar'),
  aoSalvar: (r) => console.log(`  + ${r.gameId}  ${r.campeao} ${r.role}  ${r.venci ? 'V' : 'D'}  ${r.achados} achados (${r.graves} graves)`),
  aoPular: (r, erro) => console.log(erro ? `  ! ${r.gameId} falhou: ${erro.message}` : `  = ${r.gameId} já estava no banco`),
});

const total = db.prepare('SELECT COUNT(*) n FROM partidas').get().n;
const frames = db.prepare('SELECT COUNT(*) n FROM frames').get().n;
console.log(`\n${salvos.length} partida(s) nova(s). Banco tem ${total} partidas e ${frames.toLocaleString('pt-BR')} pontos de posição.`);

db.close();
lcu.fechar();
