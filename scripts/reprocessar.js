import { abrirBanco } from '../src/dados/banco.js';
import { reprocessarTudo } from '../src/dados/reprocessar.js';

/**
 *   node scripts/reprocessar.js         tudo
 *   node scripts/reprocessar.js 420     so uma fila
 */
const fila = process.argv[2] ? Number(process.argv[2]) : null;
const db = abrirBanco();

const alvo = db.prepare(`SELECT COUNT(*) n FROM partidas WHERE duracaoS >= 300 ${fila ? 'AND fila = ' + fila : ''}`).get().n;
if (!alvo) { console.log('nada no banco pra reprocessar.'); process.exit(0); }

console.log(`reprocessando ${alvo} partidas direto do banco (zero chamadas a API)...\n`);
const r = reprocessarTudo(db, { fila, aoProgresso: (p) => console.log(`  ${p.feitas}/${p.de}...`) });
console.log(`\n${r.feitas} partidas reprocessadas, ${r.total.toLocaleString('pt-BR')} achados, ${r.erros} erros.`);
db.close();
