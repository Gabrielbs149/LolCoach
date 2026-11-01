/**
 * medir-valorant.mjs — quanto custa uma volta do laço do Valorant, com o cliente AO VIVO.
 *
 * O laço que descobre mapa e agente roda de 6 em 6 segundos a partida inteira. Até a
 * 2.28.276 ele perguntava três coisas que já sabia: a ordem dos endpoints ignorava o
 * estado (e `pregame` responde 404 durante a partida), região e shard eram perguntados
 * de novo a cada volta, e a falha ao buscar a versão do cliente não esperava nada.
 *
 * Este script mede o que sobrou, e só serve com o Valorant ABERTO — por isso não entra
 * em teste automático: nenhuma trava pode depender de um jogo estar rodando.
 *
 *   node scripts/medir-valorant.mjs [voltas]
 */
import { situacaoDoValorant } from '../src/valorant/jogo.js';

const voltas = Number(process.argv[2]) || 6;
const tempos = [];

for (let i = 0; i < voltas; i++) {
  const a = performance.now();
  const s = await situacaoDoValorant();
  const ms = Math.round(performance.now() - a);
  tempos.push(ms);
  const quem = s.ligado ? `${s.estado ?? 'sem estado'}${s.mapa ? ` · ${s.mapa}` : ''}` : 'fechado';
  console.log(`  volta ${String(i + 1).padStart(2)}: ${String(ms).padStart(5)} ms   ${quem}`);
  if (i < voltas - 1) await new Promise((ok) => setTimeout(ok, 1200));
}

const ordenados = tempos.slice().sort((x, y) => x - y);
const mediana = ordenados[Math.floor(ordenados.length / 2)];
console.log(`\nprimeira volta ${tempos[0]} ms (paga a descoberta de região e versão)`);
console.log(`mediana das seguintes: ${mediana} ms`);
