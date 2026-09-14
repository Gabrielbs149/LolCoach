import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { carregarConfig } from '../src/config.js';
import { pastaBase } from '../src/caminhos.js';
import { abrirBanco } from '../src/dados/banco.js';
import { RiotApi, carregarPartidaDaRiot } from '../src/dados/riot.js';
import { LcuClient } from '../src/lcu/client.js';
import { carregarPartida, mmss } from '../src/analise/partida.js';
import { analisar } from '../src/analise/detectores.js';
import { detalharPartida } from '../src/analise/detalhe.js';
import { preencherResolucoes, fichaDoConfronto } from '../src/analise/resolucao.js';
import { relatorioHtml } from '../src/analise/relatorio-html.js';

/**
 *   npm run analisar                 última partida do banco
 *   npm run analisar -- 3281219783   uma partida específica
 *
 * Busca sempre pela API da Riot quando há chave: o relatório detalhado depende
 * de campos (vida por minuto, dano por magia, recompensa da morte) que só
 * existem lá. Sem chave, cai pro client e sai mais raso.
 */

const cfg = await carregarConfig();
const db = abrirBanco();

const alvo = process.argv[2]
  ? Number(process.argv[2])
  : db.prepare('SELECT gameId FROM partidas WHERE duracaoS >= 300 ORDER BY quando DESC LIMIT 1').get()?.gameId;

if (!alvo) {
  console.log('Nenhuma partida no banco. Rode `npm run historico -- 250 420` ou jogue com o app aberto.');
  process.exit(0);
}

const noBanco = db.prepare('SELECT * FROM partidas WHERE gameId = ?').get(alvo);
let partida = null;
let meuNome = cfg.riot?.gameName;

if (cfg.riot?.apiKey) {
  const riot = new RiotApi(cfg.riot);
  const matchId = noBanco?.matchId ?? `${String(cfg.riot.regiao ?? 'br1').toUpperCase()}_${alvo}`;
  partida = await carregarPartidaDaRiot(riot, matchId);
} else {
  console.log('sem chave da Riot — usando o client, relatório sai sem vida/dano por magia.\n');
  const lcu = new LcuClient();
  await lcu.conectar();
  const eu0 = await lcu.get('/lol-summoner/v1/current-summoner');
  meuNome = eu0.gameName;
  partida = await carregarPartida(lcu, alvo);
  lcu.fechar();
}

const eu = partida.jogadores.find((j) => j.nome === meuNome)
  ?? partida.jogadores.find((j) => j.id === noBanco?.meuId);

if (!eu) {
  console.log(`Não achei você entre os jogadores da partida ${alvo}.`);
  process.exit(1);
}

const achados = analisar(partida, eu);
const detalhe = detalharPartida(partida, eu, achados);
const opcoesRes = { regiao: cfg.runas?.regiao ?? 'br' };
await preencherResolucoes(partida, eu, detalhe.achados, opcoesRes);
detalhe.confronto = await fichaDoConfronto(partida, eu, opcoesRes).catch(() => null);
const html = relatorioHtml(partida, eu, detalhe);

const arquivo = resolve(pastaBase(), `relatorio-${partida.gameId}.html`);
await writeFile(arquivo, html, 'utf8');

/* ---- resumo no terminal ---- */
const r = detalhe.resumo;
console.log(`${r.campeao} ${r.role} — ${r.venci ? 'VITÓRIA' : 'DERROTA'} em ${r.duracao.toFixed(0)}min`);
console.log(`KDA ${r.kda} · CS ${r.cs} (${r.csMin}/min) · ${r.fatiaDeDano}% do dano do time · ${r.custoTotal} de ouro entregue\n`);

console.log('O QUE MELHORAR');
detalhe.prioridades.forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.titulo}`);
  console.log(`     ${p.texto}`);
  console.log(`     em ${p.momentos.map(mmss).join(', ')}\n`);
});

console.log(`${achados.length} apontamentos. Relatório com mapas: ${arquivo}`);
db.close();
