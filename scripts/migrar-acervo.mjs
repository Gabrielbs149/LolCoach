/**
 * migrar-acervo.mjs — põe TODO o acervo no formato mais novo, de uma vez.
 *
 * O acervo migra sozinho, mas só quando ele abre aquele mapa e agente. Medido hoje: dos
 * 72 arquivos salvos dele, 6 estavam no formato novo e 66 nos antigos — ou seja, as
 * melhorias de leitura de nome (+233 pontos de saída, +159 alvos que deixaram de ser o
 * centro do site) só valiam em 6 das 72 combinações. O resto ficava esperando ele abrir.
 *
 * Isto força a migração dos 72 de uma vez. Não custa NADA de cota: `buscaGuardada` só lê
 * o arquivo, relê os nomes e grava de volta — quem fala com o YouTube é outra função.
 * A única ida à rede é o catálogo oficial de mapas e agentes (valorant-api), uma vez.
 *
 *   node scripts/migrar-acervo.mjs            diz o que faria
 *   node scripts/migrar-acervo.mjs --valendo  migra de verdade
 *
 * NÃO rode com ele em partida: são 72 arquivos lidos, reprocessados e gravados, e o app
 * pode estar gravando os mesmos arquivos.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const RAIZ = process.env.LOLCOACH_DIR ?? join(homedir(), 'AppData', 'Roaming', 'LolCoach');
process.env.LOLCOACH_DIR = RAIZ;
const PASTA = join(RAIZ, 'dados', 'valorant', 'buscas');
const VALENDO = process.argv.includes('--valendo');

const { buscaGuardada } = await import('../src/valorant/lineups.js');

const arquivos = readdirSync(PASTA).filter((f) => f.endsWith('.json'));
const antes = new Map();
const pedidos = [];
for (const f of arquivos) {
  let b;
  try { b = JSON.parse(readFileSync(join(PASTA, f), 'utf8')); } catch { continue; }
  antes.set(f, { formato: b.formato ?? '?', lineups: (b.lineups ?? []).length,
    comLugar: (b.lineups ?? []).filter((l) => l.posicao).length,
    exatos: (b.lineups ?? []).filter((l) => l.ponto && !l.ponto.aproximado).length });
  if (b.pedido) pedidos.push({ f, pedido: b.pedido });
}

const conta = (campo) => [...antes.values()].reduce((a, x) => a + x[campo], 0);
console.log(`acervo: ${arquivos.length} buscas · ${conta('lineups')} lineups`);
console.log(`antes: ${conta('comLugar')} com ponto de saída · ${conta('exatos')} com alvo exato`);
const velhos = [...antes.values()].filter((x) => x.formato !== 9).length;
console.log(`no formato antigo: ${velhos} de ${antes.size}`);

if (!VALENDO) { console.log('\n(rode com --valendo pra migrar; não gasta cota nenhuma)'); process.exit(0); }

let migrados = 0, falhas = 0;
for (const { f, pedido } of pedidos) {
  try {
    const r = await buscaGuardada(pedido);
    if (r) migrados++; else { falhas++; console.log(`  não migrou: ${f}`); }
  } catch (e) { falhas++; console.log(`  estourou em ${f}: ${String(e?.message ?? e).slice(0, 60)}`); }
}

// relê pra contar o resultado de verdade, do disco
let depoisLugar = 0, depoisExatos = 0, aindaVelhos = 0;
for (const f of arquivos) {
  let b; try { b = JSON.parse(readFileSync(join(PASTA, f), 'utf8')); } catch { continue; }
  depoisLugar += (b.lineups ?? []).filter((l) => l.posicao).length;
  depoisExatos += (b.lineups ?? []).filter((l) => l.ponto && !l.ponto.aproximado).length;
  if ((b.formato ?? 0) !== 9) aindaVelhos++;
}
console.log(`\nmigrados: ${migrados} · não migraram: ${falhas} · ainda no formato antigo: ${aindaVelhos}`);
console.log(`depois: ${depoisLugar} com ponto de saída (${depoisLugar - conta('comLugar') >= 0 ? '+' : ''}${depoisLugar - conta('comLugar')})`
  + ` · ${depoisExatos} com alvo exato (${depoisExatos - conta('exatos') >= 0 ? '+' : ''}${depoisExatos - conta('exatos')})`);
