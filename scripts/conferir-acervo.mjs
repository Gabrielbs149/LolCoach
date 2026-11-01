/**
 * conferir-acervo.mjs — o acervo de lineups está inteiro?
 *
 * Por que isto existe: as buscas salvas são lidas com `lerJson`, que engole qualquer erro
 * e devolve o reserva. É a escolha certa — um arquivo torto não pode derrubar o app — mas
 * tem um efeito colateral feio: arquivo truncado vira "não achei lineups nenhuma" sem uma
 * palavra de explicação, e ele fica procurando o que está ali do lado, salvo e quebrado.
 *
 * Arquivo truncado acontece: o app grava durante a partida, e queda de energia ou
 * desligar no meio deixa JSON pela metade.
 *
 *   node scripts/conferir-acervo.mjs            diz o que achou
 *   node scripts/conferir-acervo.mjs --apagar   apaga os que não dá pra ler
 *
 * Apagar é seguro: a busca se refaz sozinha na próxima vez que ele abrir aquele mapa e
 * agente. O que custa é cota do YouTube, por isso não apaga sem pedir.
 */
import { readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PASTA = process.env.LOLCOACH_DIR
  ? join(process.env.LOLCOACH_DIR, 'dados', 'valorant', 'buscas')
  : join(homedir(), 'AppData', 'Roaming', 'LolCoach', 'dados', 'valorant', 'buscas');

const APAGAR = process.argv.includes('--apagar');

let arquivos = [];
try { arquivos = readdirSync(PASTA).filter((f) => f.endsWith('.json')); }
catch { console.log(`sem acervo em ${PASTA}`); process.exit(0); }

const ruins = [];
const formatos = new Map();
let lineups = 0, vazias = 0;

for (const f of arquivos) {
  const caminho = join(PASTA, f);
  const tamanho = statSync(caminho).size;
  let b = null, erro = null;
  try { b = JSON.parse(readFileSync(caminho, 'utf8')); }
  catch (e) { erro = String(e?.message ?? e).split('\n')[0].slice(0, 70); }

  if (erro) { ruins.push({ f, tamanho, motivo: `não é JSON — ${erro}` }); continue; }
  if (!Array.isArray(b?.lineups)) { ruins.push({ f, tamanho, motivo: 'sem a lista de lineups' }); continue; }
  if (!b.lineups.length) vazias++;
  lineups += b.lineups.length;
  formatos.set(b.formato ?? '?', (formatos.get(b.formato ?? '?') ?? 0) + 1);
}

console.log(`acervo: ${arquivos.length} buscas salvas · ${lineups} lineups`);
console.log(`formatos: ${[...formatos].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, n]) => `${k}:${n}`).join(' ')}`);
if (vazias) console.log(`${vazias} busca(s) salva(s) sem lineup nenhuma (a busca não achou nada — não é defeito)`);

if (!ruins.length) { console.log('nenhum arquivo quebrado'); process.exit(0); }

console.log(`\n${ruins.length} arquivo(s) que o app NÃO consegue ler — pra ele isso parece "não achei lineups":`);
for (const r of ruins) console.log(`  ${r.f} (${r.tamanho} bytes) — ${r.motivo}`);
if (!APAGAR) { console.log('\nrode com --apagar pra limpar; a busca se refaz sozinha na próxima abertura'); process.exit(1); }

for (const r of ruins) { try { unlinkSync(join(PASTA, r.f)); console.log(`apagado: ${r.f}`); } catch (e) { console.error(`não deu pra apagar ${r.f}: ${e.message}`); } }
