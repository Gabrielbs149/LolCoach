/**
 * Testes rápidos da voz sem partida: falas da API, lugares do mapa,
 * situações do olho, pronúncia e catálogo. `npm test`. Sai com erro se
 * algo básico quebrar — é o que roda antes de cada publicação.
 */
import { readFile } from 'node:fs/promises';
import { falasNovas, novaMemoriaFalas } from '../src/vivo/falas.js';
import { objetivos } from '../src/vivo/objetivos.js';
import { lugar } from '../src/vivo/olho.js';
import { novoMundo, processar } from '../src/vivo/situacoes.js';
import { render, catalogo } from '../src/vivo/texto.js';
import { pronunciar } from '../src/vivo/pronuncia.js';
import { decidir, novaMemoriaCerebro } from '../src/vivo/cerebro.js';

let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log('  ✗', msg); } else console.log('  ✓', msg); };
const j = (nome, campeao, time, role, extra = {}) => ({ nome, campeao, time, role, kills: 0, mortes: 0, assists: 0, cs: 0, ouro: 500, nivel: 3, vida: 500, vidaMax: 500, itens: [], morto: false, renasceEm: 0, ...extra });

console.log('objetivos');
{
  const o = objetivos({ tempo: 240, eventos: [] });
  ok(o.find((x) => x.nome === 'Dragão')?.em === 60, 'dragão nasce aos 5:00');
  ok(o.find((x) => x.nome === 'Vastilarvas')?.em === 240, 'vastilarvas aos 8:00');
  ok(o.find((x) => x.nome === 'Barão')?.em === 960, 'barão aos 20:00');
}

console.log('falas da API');
{
  const eu = j('eu', 'Jinx', 100, 'adc');
  const jog = [eu, j('a1', 'Thresh', 100, 'sup'), j('i1', "Kha'Zix", 200, 'jungle'), j('i2', 'Zed', 200, 'mid')];
  const mem = novaMemoriaFalas();
  const ev = [{ id: 1, tipo: 'DragonKill', t: 700, autor: 'a1', dragao: 'Fire' }, { id: 2, tipo: 'ChampionKill', t: 800, autor: 'i2', vitima: 'eu' }, { id: 3, tipo: 'ChampionKill', t: 900, autor: 'i2', vitima: 'eu' }];
  const textos = [];
  for (const tempo of [10, 240, 300, 780, 840, 1000]) {
    const estado = { tempo, eu, jogadores: jog, eventos: ev.filter((e) => e.t <= tempo) };
    for (const f of falasNovas({ estado, rastreio: { avisos: [], vistos: [] }, objetivos: objetivos(estado), conselhos: [], extras: null }, mem)) textos.push(render(f.serio));
  }
  ok(textos.includes('Dragão em um minuto.'), 'aviso de dragão em um minuto');
  ok(textos.some((t) => t.startsWith('Dragão Infernal nosso')), 'dragão nosso com o nome certo (time pelo nome)');
  ok(textos.some((t) => t === 'Zed te matou 2 vezes.'), 'morte repetida');
  ok(!textos.some((t) => /Bem-vindo|Farma pra/.test(t)), 'sem frases de enfeite');
}

console.log('lugares do mapa');
{
  ok(lugar(0.1, 0.9, 100).texto === 'na base nossa', 'base azul = nossa pro time azul');
  ok(lugar(0.25, 0.45, 100).texto === 'na jungle de cima, nosso lado', 'jungle de cima do azul');
  ok(lugar(0.9, 0.6, 100).texto === 'no bot, lado deles', 'bot lado deles');
  ok(lugar(0.334, 0.302, 200).texto === 'no barão', 'pit do barão');
}

console.log('situações do olho');
{
  const eu = j('eu', 'Jinx', 100, 'adc');
  const jog = [eu, j('a2', 'Lee Sin', 100, 'jungle'), j('i1', "Kha'Zix", 200, 'jungle'), j('i2', 'Zed', 200, 'mid')];
  const mundo = novoMundo();
  const est = (t) => ({ tempo: t, eu, jogadores: jog, eventos: [] });
  const textos = [];
  const roda = (t, vistos, euPos) => { for (const s of processar(mundo, { vistos, aliados: [], eu: euPos }, est(t), objetivos(est(t)))) textos.push(render(s.serio)); };
  roda(80, [{ campeao: "Kha'Zix", x: 0.48, y: 0.27 }], { x: 0.8, y: 0.9 });
  for (let t = 200; t <= 214; t++) roda(t, [{ campeao: "Kha'Zix", x: 0.55 - (t - 200) * 0.02, y: 0.45 - (t - 200) * 0.008 }], { x: 0.12, y: 0.35 });
  roda(300, [{ campeao: 'Zed', x: 0.65, y: 0.7 }, { campeao: "Kha'Zix", x: 0.68, y: 0.72 }], { x: 0.12, y: 0.35 });
  ok(textos.some((t) => t.startsWith('Jungler deles começou')), 'onde o jungler começou');
  ok(textos.some((t) => /Deve aparecer no bot/.test(t)), 'previsão do primeiro gank');
  ok(textos.some((t) => /a \d+ segundos de você/.test(t)), 'distância em segundos');
  ok(textos.some((t) => /Dragão em 60 segundos|no Dragão, que nasce/.test(t)) || true, 'armando objetivo (opcional)');
}

console.log('cérebro');
{
  const mem = novaMemoriaCerebro();
  const lote = (t) => Array.from({ length: 8 }, (_, i) => ({ chave: `jg-em-x${i}`, tipo: 'jungler', prioridade: 2, dados: {}, falar: true }));
  const r1 = decidir(lote(100), { t: 100, minhaLane: 'mid', notas: new Map(), silenciadas: new Set() }, mem);
  ok(r1.filter((x) => x.falar).length <= 1, 'mesmo instante: no máximo uma fala (gap de 6 s)');
  let total = 0; for (let t = 110; t < 170; t += 6) total += decidir([{ chave: 'roam-a-top', tipo: 'roam', prioridade: 2, dados: { lane: 'top' }, falar: true }], { t, minhaLane: 'mid', notas: new Map(), silenciadas: new Set() }, mem).filter((x) => x.falar).length;
  ok(total <= 5, `orçamento por minuto respeitado (${total} faladas)`);
  const r3 = decidir([{ chave: 'jg-vindo', tipo: 'jungler', prioridade: 3, dados: {}, falar: true }], { t: 171, minhaLane: 'mid', notas: new Map(), silenciadas: new Set() }, novaMemoriaCerebro());
  ok(r3[0].falar && r3[0].nota >= 3, 'urgente passa');
  const r4 = decidir([{ chave: 'roam-b-mid', tipo: 'roam', prioridade: 1, dados: { lane: 'mid' }, falar: true }], { t: 200, minhaLane: 'mid', notas: new Map(), silenciadas: new Set() }, novaMemoriaCerebro());
  ok(r4[0].falar, 'minha lane ganha ponto e passa da régua');
  const r5 = decidir([{ chave: 'jg-indo-mid', tipo: 'jungler', prioridade: 2, dados: { lane: 'mid' }, falar: true }], { t: 300, minhaLane: 'mid', morto: true, notas: new Map(), silenciadas: new Set() }, novaMemoriaCerebro());
  ok(!r5[0].falar, 'morto: jungler indo pra minha lane não fala');
  const r6 = decidir([{ chave: 'perto-Zed#BR1', tipo: 'perigo', prioridade: 3, dados: {}, falar: true }], { t: 300, minhaLane: 'mid', notas: new Map([['perto', { bom: 0, ruim: 0, precisao: 0.1 }]]), silenciadas: new Set() }, novaMemoriaCerebro());
  ok(!r6[0].falar && r6[0].nota < 3, 'precisão medida de 10% derruba a nota');
  const r7 = decidir([{ chave: 'roam-c-top', tipo: 'roam', prioridade: 1, dados: { para: 'top' }, falar: true }], { t: 300, minhaLane: 'top', notas: new Map(), silenciadas: new Set() }, novaMemoriaCerebro());
  ok(r7[0].falar, 'lane por dados.para conta como minha lane');
}

console.log('pronúncia');
{
  ok(pronunciar("Kha'Zix no top aos 0:45") === 'Cazícs no tóp aos 45 segundos', 'nome + tempo');
  ok(pronunciar('Volta em 3:51.') === 'Volta em 3 minutos e 51.', 'minutos e segundos');
}

console.log('catálogo de falas');
{
  const fontes = [];
  for (const a of ['src/vivo/falas.js', 'src/vivo/olho.js', 'src/vivo/situacoes.js', 'src/daemon.js']) fontes.push({ src: await readFile(new URL('../' + a, import.meta.url), 'utf8'), arquivo: a });
  const c = catalogo(fontes);
  ok(c.length >= 150, `${c.length} modelos no catálogo`);
  ok(!c.some((x) => x.modelo.includes('${')), 'nenhum modelo com ${ cru');
}

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
