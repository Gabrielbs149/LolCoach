import { carregarConfig } from '../src/config.js';
import { RiotApi } from '../src/dados/riot.js';
import { abrirBanco } from '../src/dados/banco.js';
import { backfillHistorico } from '../src/dados/historico.js';

/**
 *   node scripts/historico.js 250 420           250 ranqueadas solo
 *   node scripts/historico.js 100 todas         100 de qualquer fila
 *   node scripts/historico.js 250 420 --reprocessar
 */
const quantas = Number(process.argv[2] ?? 100);
const filaArg = process.argv[3] ?? '420';
const fila = filaArg === 'todas' ? null : Number(filaArg);

const cfg = await carregarConfig();
if (!cfg.riot?.apiKey) {
  console.log('sem chave da Riot no config.json — este comando precisa dela.');
  process.exit(1);
}

const riot = new RiotApi(cfg.riot);
const db = abrirBanco();
const inicio = Date.now();

const r = await backfillHistorico(riot, db, {
  quantas, fila,
  gameName: cfg.riot.gameName ?? 'roIindo',
  tagLine: cfg.riot.tagLine ?? 'br1',
  refazerTudo: process.argv.includes('--reprocessar'),
  aoContar: (c) => console.log(`conta: ${c.conta.gameName}#${c.conta.tagLine}\n${c.naLista} na lista, ${c.aProcessar} a processar.\n`),
  aoSalvar: (s) => {
    const ritmo = (Date.now() - inicio) / s.indice;
    const falta = Math.round((ritmo * (s.de - s.indice)) / 60000);
    console.log(`  + [${s.indice}/${s.de}] ${s.campeao} ${s.role} ${s.venci ? 'V' : 'D'} — ${s.achados} achados${falta ? `  (~${falta}min restantes)` : ''}`);
  },
  aoPular: (id, erro) => console.log(`  - ${id}: ${erro.message}`),
});

const total = db.prepare('SELECT COUNT(*) n FROM partidas').get().n;
const frames = db.prepare('SELECT COUNT(*) n FROM frames').get().n;
console.log(`\n${r.ok} salvas, ${r.falhas} falhas. Banco: ${total} partidas, ${frames.toLocaleString('pt-BR')} posicoes.`);
db.close();
