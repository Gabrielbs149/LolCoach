/**
 * Testes do que dá pra testar sem o jogo aberto.
 *
 * O portão antes de publicar era só `node --check` (sintaxe). Sintaxe passa em
 * código errado: o canhão na onda errada, o suporte medido por CS, a lição
 * escolhendo o candidato errado. Aqui ficam os casos que já quebraram ou que
 * seriam caros de descobrir em partida.
 *
 * Roda com: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nasceEm, temCanhao, ondaEm, proximoCanhao } from '../src/vivo/ondas.js';
import { avisosDeComposicao, retratoDoTime } from '../src/vivo/composicao.js';
import { somaDosItens, fichaDoInimigo, vidaEfetiva, danoPorSegundo, ordemDeAlvos } from '../src/vivo/troca.js';
import { daRota, ROTA } from '../src/vivo/rotas.js';
import { licaoDaPartida } from '../src/analise/licao.js';
import { recadoDeSequencia, padraoDeSequencia } from '../src/analise/parar.js';
import { falasNovas, novaMemoriaFalas } from '../src/vivo/falas.js';
import { render } from '../src/vivo/texto.js';

/* ------------------------------------------------------------------ ondas */

test('ondas: a primeira nasce em 1:05 e a cada 30 s', () => {
  assert.equal(nasceEm(1), 65);
  assert.equal(nasceEm(2), 95);
  assert.equal(nasceEm(3), 125);
  assert.equal(ondaEm(64), 0);
  assert.equal(ondaEm(65), 1);
  assert.equal(ondaEm(124), 2);
});

test('ondas: o primeiro canhão é o da onda 3, às 2:05', () => {
  assert.equal(temCanhao(1), false);
  assert.equal(temCanhao(2), false);
  assert.equal(temCanhao(3), true);
  assert.equal(nasceEm(3), 125);
});

test('ondas: canhão a cada 3 até os 15 min, a cada 2 até os 25, todas depois', () => {
  const canhoes = [];
  for (let n = 1; nasceEm(n) <= 28 * 60; n++) if (temCanhao(n)) canhoes.push(nasceEm(n));
  // antes dos 15: de 90 em 90 segundos
  const cedo = canhoes.filter((t) => t < 900);
  for (let i = 1; i < cedo.length; i++) assert.equal(cedo[i] - cedo[i - 1], 90);
  // entre 15 e 25: de 60 em 60
  const meio = canhoes.filter((t) => t >= 960 && t < 1500);
  for (let i = 1; i < meio.length; i++) assert.equal(meio[i] - meio[i - 1], 60);
  // depois dos 25: toda onda
  const tarde = canhoes.filter((t) => t >= 1520);
  for (let i = 1; i < tarde.length; i++) assert.equal(tarde[i] - tarde[i - 1], 30);
});

test('ondas: proximoCanhao nunca devolve um que já passou', () => {
  for (const t of [0, 100, 130, 900, 1500, 2000]) {
    const p = proximoCanhao(t);
    assert.ok(p && p.nasce > t, `em ${t} veio ${p?.nasce}`);
  }
});

/* -------------------------------------------------------------- composição */

const PERFIS = new Map([
  ['Zed', { tags: ['Assassin'], dano: 'ad' }], ['Kha\'Zix', { tags: ['Assassin'], dano: 'ad' }],
  ['Yasuo', { tags: ['Fighter', 'Assassin'], dano: 'ad' }], ['Caitlyn', { tags: ['Marksman'], dano: 'ad' }],
  ['Pyke', { tags: ['Support', 'Assassin'], dano: 'ad' }], ['Ornn', { tags: ['Tank', 'Fighter'], dano: 'misto' }],
  ['Sejuani', { tags: ['Tank', 'Fighter'], dano: 'misto' }], ['Ahri', { tags: ['Mage'], dano: 'ap' }],
  ['Jinx', { tags: ['Marksman'], dano: 'ad' }], ['Lulu', { tags: ['Support', 'Mage'], dano: 'ap' }],
  ['Leona', { tags: ['Tank', 'Support'], dano: 'misto' }], ['Malphite', { tags: ['Tank', 'Fighter'], dano: 'misto' }],
  ['Diana', { tags: ['Fighter', 'Mage'], dano: 'ap' }], ['Nocturne', { tags: ['Assassin', 'Fighter'], dano: 'ad' }],
  ['Graves', { tags: ['Marksman'], dano: 'ad' }], ['Brand', { tags: ['Mage'], dano: 'ap' }],
  ['Ezreal', { tags: ['Marksman'], dano: 'misto' }], ['Vi', { tags: ['Fighter', 'Assassin'], dano: 'ad' }],
  ['Darius', { tags: ['Fighter', 'Tank'], dano: 'ad' }], ['Syndra', { tags: ['Mage'], dano: 'ap' }],
  ['Thresh', { tags: ['Support', 'Fighter'], dano: 'misto' }],
]);

test('composição: Fighter+Assassin não conta como frente (Yasuo não segura nada)', () => {
  const r = retratoDoTime(['Yasuo'], PERFIS);
  assert.equal(r.frente, 0);
  assert.equal(retratoDoTime(['Ornn'], PERFIS).frente, 1);
});

test('composição: time equilibrado não gera aviso nenhum', () => {
  const avisos = avisosDeComposicao({
    nossos: ['Ornn', 'Sejuani', 'Ahri', 'Jinx', 'Lulu'],
    deles: ['Darius', 'Vi', 'Syndra', 'Caitlyn', 'Thresh'],
    perfis: PERFIS, minhaRole: 'adc',
  });
  assert.deepEqual(avisos, []);
});

test('composição: dano todo de um tipo e sem frente viram avisos', () => {
  const avisos = avisosDeComposicao({
    nossos: ['Zed', 'Kha\'Zix', 'Yasuo', 'Caitlyn', 'Pyke'],
    deles: ['Malphite', 'Sejuani', 'Ahri', 'Jinx', 'Lulu'],
    perfis: PERFIS, minhaRole: 'adc',
  });
  const chaves = avisos.map((a) => a.chave);
  assert.ok(chaves.includes('so-ad'), 'faltou o aviso de dano só físico');
  assert.ok(chaves.includes('sem-frente'), 'faltou o aviso de time sem frente');
  assert.ok(avisos.length <= 3, 'no máximo 3 avisos');
});

test('composição: draft pela metade não fala nada', () => {
  assert.deepEqual(avisosDeComposicao({ nossos: ['Jinx', 'Zed'], deles: ['Leona'], perfis: PERFIS, minhaRole: 'adc' }), []);
});

/* -------------------------------------------------------------- vida e dano */

const BASES = new Map([
  ['Jinx', { hp: 630, hpNv: 100, armadura: 26, armaduraNv: 4.7, mr: 30, mrNv: 1.3, ad: 59, adNv: 3.1, as: 0.625, asNv: 0.014 }],
  ['Ornn', { hp: 660, hpNv: 109, armadura: 33, armaduraNv: 5.2, mr: 32, mrNv: 2.05, ad: 69, adNv: 3.5, as: 0.625, asNv: 0.02 }],
]);
const ITENS = new Map([
  [3031, { nome: 'Gume do Infinito', preco: 3500, atributos: { FlatPhysicalDamageMod: 75, FlatCritChanceMod: 0.25 } }],
  [3742, { nome: 'Placa do Morto', preco: 2900, atributos: { FlatHPPoolMod: 300, FlatArmorMod: 45 } }],
]);

test('itens: os atributos somam certo', () => {
  const s = somaDosItens([{ id: 3031 }, { id: 3742 }], ITENS);
  assert.equal(s.ad, 75);
  assert.equal(s.hp, 300);
  assert.equal(s.armadura, 45);
  assert.equal(s.crit, 0.25);
});

test('vida efetiva: armadura vira vida de verdade e a penetração desconta', () => {
  const f = fichaDoInimigo({ campeao: 'Jinx', nivel: 11, itens: [] }, BASES, ITENS);
  assert.equal(f.hp, 630 + 100 * 10);
  assert.equal(f.armadura, Math.round(26 + 4.7 * 10));
  const semPen = vidaEfetiva(f, { tipo: 'fisico' });
  const comPen = vidaEfetiva(f, { tipo: 'fisico', penPct: 0.7 });
  assert.ok(comPen < semPen, 'penetração tem que baixar a vida efetiva');
  assert.ok(semPen > f.hp, 'com armadura a vida efetiva é maior que a vida crua');
});

test('dano por segundo: crítico entra na conta e velocidade tem teto', () => {
  assert.equal(danoPorSegundo({ ad: 100, as: 1, crit: 0 }), 100);
  assert.equal(danoPorSegundo({ ad: 100, as: 1, crit: 1 }), 175);
  assert.equal(danoPorSegundo({ ad: 100, as: 9, crit: 0 }), 250);   // teto de 2.5
});

test('ordem de alvos: o tanque com item fica por último', () => {
  const eu = { atributos: { ad: 200, ap: 0, as: 1, crit: 0.4, penArm: 0, penArmPct: 1 } };
  const lista = ordemDeAlvos({
    eu, bases: BASES, itensTab: ITENS,
    inimigos: [{ campeao: 'Ornn', nivel: 12, itens: [{ id: 3742 }], role: 'top' }, { campeao: 'Jinx', nivel: 11, itens: [], role: 'adc' }],
  });
  assert.equal(lista[0].campeao, 'Jinx');
  assert.equal(lista.at(-1).campeao, 'Ornn');
});

/* --------------------------------------------------------------- por rota */

test('rotas: cada rota tem as cinco palavras e o suporte volta com menos gold', () => {
  for (const [nome, r] of Object.entries(ROTA)) {
    for (const campo of ['recurso', 'gastarEm', 'janela', 'atrasado', 'semBriga', 'baseAcao', 'rivalNaBase']) {
      assert.ok(r[campo], `${nome} sem ${campo}`);
    }
  }
  assert.ok(ROTA.sup.gastarEm < ROTA.adc.gastarEm);
  assert.equal(ROTA.sup.recurso, 'visão');
  assert.equal(ROTA.jungle.recurso, 'campo');
  assert.equal(daRota('inventada').recurso, ROTA.mid.recurso);   // padrão
});

/* ----------------------------------------------------------------- lição */

const morte = (minuto, fazer, extra = {}) => ({ minuto, fase: 'lane', fazer, linhas: [], ...extra });

test('lição: erro repetido ganha do resto', () => {
  const l = licaoDaPartida({
    situacoes: { mortes: [morte('5:00', ['Ward no rio antes de empurrar.']), morte('9:00', ['Ward no rio antes de empurrar.']), morte('14:00', ['Outra coisa.'])], padrao: [] },
  });
  assert.equal(l.chave, 'repetido');
  assert.match(l.texto, /Ward no rio/);
  assert.equal(l.quando, '5:00, 9:00');
});

test('lição: sem morrer devolve a lição boa, e sem nada devolve null', () => {
  assert.equal(licaoDaPartida({ situacoes: { mortes: [], padrao: [] } }).chave, 'perfeito');
  assert.equal(licaoDaPartida({ situacoes: { mortes: [morte('5:00', [])], padrao: [] } }), null);
});

test('lição: o mesmo algoz três vezes vira lição', () => {
  const l = licaoDaPartida({
    situacoes: { mortes: [morte('4:00', [], { algoz: 'Darius' }), morte('8:00', [], { algoz: 'Darius' }), morte('12:00', [], { algoz: 'Darius' })], padrao: [] },
  });
  assert.equal(l.chave, 'algoz');
  assert.match(l.titulo, /Darius te matou 3 vezes/);
});

/* ------------------------------------------------------------ quando parar */

function bancoDeMentira(partidas) {
  // só o que padraoDeSequencia usa: db.prepare(sql).all()
  return { prepare: () => ({ all: () => partidas }) };
}

test('parar: sem amostra o app não fala nada', () => {
  const ps = Array.from({ length: 10 }, (_, i) => ({ quando: new Date(2026, 0, 1, 12, i * 40).toISOString(), duracaoS: 1800, venci: i % 2 }));
  assert.equal(recadoDeSequencia(bancoDeMentira(ps), { conta: 'teste-sem-amostra', seguidas: 2 }), null);
});

test('parar: com queda de verdade o recado sai com o número', () => {
  // 200 partidas: depois de derrota, ganha só 20% das vezes
  const ps = [];
  const inicio = Date.parse('2026-01-01T12:00:00Z');
  let anterior = 1;
  for (let i = 0; i < 200; i++) {
    const venci = anterior === 0 ? (i % 5 === 0 ? 1 : 0) : (i % 2);
    ps.push({ quando: new Date(inicio + i * 40 * 60_000).toISOString(), duracaoS: 1800, venci });
    anterior = venci;
  }
  const p = padraoDeSequencia(bancoDeMentira(ps), { conta: 'teste-queda', cacheMs: 0 });
  assert.ok(p.depois[1].n >= 25, 'a faixa de 1 derrota precisa de amostra');
  assert.ok(p.depois[1].taxa < p.base.taxa - 4, 'a queda tem que aparecer');
  const r = recadoDeSequencia(bancoDeMentira(ps), { conta: 'teste-queda', seguidas: 1 });
  assert.ok(r, 'devia falar');
  assert.match(r.texto, /\d+(\.\d+)?%/);
});

/* ------------------------------------------------------------------ falas */

const jogador = (time, role, extra = {}) => ({
  nome: role + time, campeao: 'C' + role, time, role, nivel: 9, kills: 2, mortes: 2, assists: 2,
  cs: 100, visao: 10, morto: false, renasceEm: 0, spells: [], runas: {}, itens: [{ id: 1, nome: 'x', preco: 3000 }], ...extra,
});
function mundo(tempo, role = 'adc', extra = {}) {
  const eu = { ...jogador(100, role), souEu: true, ouro: 300, vida: 1800, vidaMax: 2000, magias: {}, ...extra };
  const jogadores = [eu,
    ...['top', 'jungle', 'mid', 'adc', 'sup'].filter((r) => r !== role).map((r) => jogador(100, r)),
    ...['top', 'jungle', 'mid', 'adc', 'sup'].map((r) => jogador(200, r))];
  return { tempo, eu, jogadores, eventos: [] };
}
const rodar = (estado, mem) => falasNovas({ estado, rastreio: null, objetivos: [], conselhos: [], extras: null }, mem);

test('falas: o canhão sai na onda certa e nunca pro jungler', () => {
  const mem = novaMemoriaFalas();
  const ditas = [];
  for (let t = 100; t <= 400; t++) for (const f of rodar(mundo(t, 'adc'), mem)) if (f.id.startsWith('canhao-')) ditas.push(t);
  assert.deepEqual(ditas, [125, 215, 305, 395]);

  const memJg = novaMemoriaFalas();
  for (let t = 100; t <= 400; t++) for (const f of rodar(mundo(t, 'jungle'), memJg)) assert.ok(!f.id.startsWith('canhao'), 'jungler não ouve canhão');
});

test('falas: inimigo que comprou item caro virou "voltou pra base"', () => {
  const mem = novaMemoriaFalas();
  rodar(mundo(300, 'adc'), mem);                                     // primeira leitura: guarda o valor
  const depois = mundo(305, 'adc');
  const rival = depois.jogadores.find((j) => j.time === 200 && j.role === 'adc');
  rival.itens = [{ id: 1, nome: 'x', preco: 3000 }, { id: 2, nome: 'y', preco: 1300 }];
  const falas = rodar(depois, mem).filter((f) => f.id.startsWith('base-'));
  assert.ok(falas.length, 'devia avisar que o rival voltou');
  assert.match(render(falas[0].serio), /voltou pra base/);
});

test('falas: quem acabou de morrer comprando não conta como recall', () => {
  const mem = novaMemoriaFalas();
  const morto = mundo(500, 'adc');
  morto.jogadores.find((j) => j.time === 200 && j.role === 'adc').morto = true;
  rodar(morto, mem);
  const renasceu = mundo(506, 'adc');
  const rival = renasceu.jogadores.find((j) => j.time === 200 && j.role === 'adc');
  rival.itens = [{ id: 1, nome: 'x', preco: 3000 }, { id: 2, nome: 'y', preco: 1300 }];
  assert.equal(rodar(renasceu, mem).filter((f) => f.id.startsWith('base-')).length, 0);
});

test('falas: a leitura do jogo muda com a rota', () => {
  const frases = {};
  for (const role of ['adc', 'sup', 'jungle']) {
    const mem = novaMemoriaFalas();
    const f = rodar(mundo(602, role), mem).find((x) => x.id.startsWith('leitura-'));
    frases[role] = f ? render(f.serio) : null;
  }
  assert.ok(frases.adc && frases.sup && frases.jungle);
  assert.notEqual(frases.adc, frases.sup);
  assert.match(frases.sup, /visão|carry/);
});

/* ------------------------------------------------------- evidência da leitura */

test('leitura do olho: fala de rota só com casamento alto (corte medido, não chutado)', async () => {
  const { leituraForte } = await import('../src/vivo/situacoes.js');
  assert.equal(leituraForte(null), false);
  assert.equal(leituraForte({}), false);
  // o corte é 0,90: abaixo disso o erro medido passa de 35%
  assert.equal(leituraForte({ ultimo: { score: 0.89 } }), false);
  assert.equal(leituraForte({ ultimo: { score: 0.9 } }), true);
  // o anel NÃO vale mais de atalho: deu 75% de erro nas leituras em que apareceu
  assert.equal(leituraForte({ ultimo: { anel: true, score: 0.7 } }), false);
  // gravação antiga, sem evidência guardada: continua valendo
  assert.equal(leituraForte({ ultimo: { x: 1, y: 1 } }), true);
});

/* ------------------------------------------- rota que o painel usa está liberada? */

test('toda ação que o servidor chama está na lista do painel', async () => {
  const { readFile } = await import('node:fs/promises');
  const srv = await readFile(new URL('../src/ui/servidor.js', import.meta.url), 'utf8');
  const dae = await readFile(new URL('../src/daemon.js', import.meta.url), 'utf8');

  // o que o servidor espera receber: acoes.X
  const usadas = new Set([...srv.matchAll(/\bacoes\.([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]));
  // o que o daemon entrega: a lista ACOES_DO_PAINEL
  const bloco = dae.match(/const ACOES_DO_PAINEL = \[([\s\S]*?)\];/);
  assert.ok(bloco, 'não achei ACOES_DO_PAINEL no daemon');
  const liberadas = new Set([...bloco[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  // ações que o main.js do Electron injeta por fora (não vêm do daemon)
  const doElectron = new Set(['atualizar', 'backup', 'restaurar', 'diagnostico', 'tecla', 'overlayAjustar', 'overlayMover', 'overlayEstado']);

  const faltando = [...usadas].filter((n) => !liberadas.has(n) && !doElectron.has(n)).sort();
  assert.deepEqual(faltando, [], `o servidor chama acoes.${faltando.join(', acoes.')} mas o daemon não expõe — a rota vira 404 calado (foi o que aconteceu com 'circulo': o olho ficou usando o retrato quadrado como molde)`);
});

/* ------------------------------------------------- lugar com nome (camps e buffs) */

test('lugar: camp e buff têm nome, e o lado vermelho é o espelho', async () => {
  const { lugar } = await import('../src/vivo/olho.js');
  // jogando de azul (time 100)
  assert.equal(lugar(0.256, 0.469, 100).texto, 'no azul nosso');
  assert.equal(lugar(0.526, 0.731, 100).texto, 'no red nosso');
  assert.equal(lugar(0.47, 0.62, 100).texto, 'nos raptors nossos');   // plural concorda
  assert.equal(lugar(0.53, 0.38, 100).texto, 'nos raptors deles');
  // o mesmo ponto, jogando de vermelho: o que era "nosso" vira "deles"
  assert.equal(lugar(0.256, 0.469, 200).texto, 'no azul deles');
  assert.equal(lugar(0.53, 0.38, 200).texto, 'nos raptors nossos');
});

test('lugar: jungle sem camp em cima cita o camp mais perto, não o quadrante', async () => {
  const { lugar } = await import('../src/vivo/olho.js');
  const l = lugar(0.33, 0.52, 100);   // entre azul e lobos, do lado azul
  assert.equal(l.lane, 'jungle');
  assert.match(l.texto, /perto d/);
  assert.ok(!/de cima|de baixo/.test(l.texto), `ainda é quadrante: ${l.texto}`);
});

test('fala do alvo: cala quando o mais frágil é o carry (o óbvio)', async () => {
  const { falasNovas, novaMemoriaFalas } = await import('../src/vivo/falas.js');
  const bases = new Map([
    ['Ornn', { hp: 660, hpNv: 109, armadura: 33, armaduraNv: 5.2, mr: 32, mrNv: 2.05, ad: 69, adNv: 3.5, as: 0.6, asNv: 0.02 }],
    ['Jinx', { hp: 630, hpNv: 100, armadura: 26, armaduraNv: 4.7, mr: 30, mrNv: 1.3, ad: 59, adNv: 3.1, as: 0.6, asNv: 0.01 }],
    ['Vi', { hp: 655, hpNv: 105, armadura: 30, armaduraNv: 4.6, mr: 32, mrNv: 2.05, ad: 63, adNv: 3.5, as: 0.64, asNv: 0.02 }],
    ['Syndra', { hp: 620, hpNv: 105, armadura: 25, armaduraNv: 4.3, mr: 30, mrNv: 1.3, ad: 54, adNv: 3, as: 0.62, asNv: 0.02 }],
    ['Leona', { hp: 646, hpNv: 104, armadura: 42, armaduraNv: 4.8, mr: 32, mrNv: 2.05, ad: 60, adNv: 3, as: 0.62, asNv: 0.02 }],
    ['Evelynn', { hp: 642, hpNv: 98, armadura: 27, armaduraNv: 4.2, mr: 30, mrNv: 1.3, ad: 61, adNv: 3.3, as: 0.66, asNv: 0.02 }],
  ]);
  const itensTab = new Map([[3742, { nome: 'Placa', preco: 2900, atributos: { FlatHPPoolMod: 300, FlatArmorMod: 45 } }]]);
  const extras = { bases, itensTab, build: null, dano: null, mains: [] };
  const jog = (time, role, campeao, nivel = 11, itens = []) => ({ nome: campeao, campeao, time, role, nivel, kills: 2, mortes: 2, assists: 2, cs: 150, visao: 10, morto: false, renasceEm: 0, spells: [], runas: {}, itens });
  const meu = { ...jog(100, 'adc', 'Caitlyn'), souEu: true, ouro: 300, vida: 1500, vidaMax: 1600, magias: {},
    atributos: { ad: 210, ap: 0, as: 1.05, crit: 0.5, penArm: 0, penArmPct: 1 } };
  const nossos = ['top', 'jungle', 'mid', 'sup'].map((r) => jog(100, r, 'C' + r));
  const roda = (deles) => {
    const mem = novaMemoriaFalas(); const ditas = [];
    for (let t = 470; t <= 700; t++) for (const f of falasNovas({ estado: { tempo: t, eu: meu, jogadores: [meu, ...nossos, ...deles], eventos: [] }, rastreio: null, objetivos: [], conselhos: [], extras }, mem)) if (f.id.startsWith('alvo-')) ditas.push(f);
    return ditas;
  };
  // adc deles é o mais frágil: todo mundo já sabe, não fala
  assert.equal(roda([jog(200, 'top', 'Ornn', 12, [{ id: 3742 }]), jog(200, 'jungle', 'Vi'), jog(200, 'mid', 'Syndra'), jog(200, 'adc', 'Jinx'), jog(200, 'sup', 'Leona')]).length, 0);
  // jungler atrasado é o mais frágil: isso é notícia
  assert.equal(roda([jog(200, 'top', 'Ornn', 14, [{ id: 3742 }]), jog(200, 'jungle', 'Evelynn', 8), jog(200, 'mid', 'Syndra', 14), jog(200, 'adc', 'Jinx', 14), jog(200, 'sup', 'Leona', 14)]).length, 1);
});

test('lugar: torre tem nome, e o lado é o de quem joga', async () => {
  const { lugar } = await import('../src/vivo/olho.js');
  assert.equal(lugar(0.709, 0.931, 100).texto, 'na torre de fora do bot nossa');
  assert.equal(lugar(0.709, 0.931, 200).texto, 'na torre de fora do bot deles');
  assert.equal(lugar(0.066, 0.295, 100).texto, 'na torre de fora do top nossa');
  assert.equal(lugar(0.604, 0.426, 100).texto, 'na torre de fora do mid deles');
  // longe de qualquer torre continua sendo a rota
  assert.match(lugar(0.80, 0.90, 100).texto, /^no bot/);
});

/* ------------------------------------------- aviso de morte iminente: a ordem vem na frente */

test('aviso de perigo em cima: a ordem vem na frente e a frase cabe no tempo', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/vivo/situacoes.js', import.meta.url), 'utf8');

  // Medido no historico: a antecedencia mediana do aviso e 3,8 s e a voz fala ~14
  // caracteres por segundo. So 54% das frases terminavam antes da morte; so a ordem
  // curta terminaria em 91%. Por isso o verbo vem primeiro: mesmo cortada, ele ouviu
  // o que fazer. Vale so pros avisos de inimigo em cima de voce -- objetivo e timer
  // tem 30 s de folga e podem ser longos.
  const IDS = ['vida-baixa-vindo', 'perigo-perto', 'jg-em-cima', 'dive', 'invade-cedo', 'perto-'];
  const ORDEM = /^(Sai|Recua|Corre|Volta|Foge|Cuidado)\b/;
  const CPS = 14;

  const achadas = [];
  for (const linha of src.split('\n')) {
    if (!/prioridade: 3\b/.test(linha)) continue;
    if (!IDS.some((id) => linha.includes(`'${id}`) || linha.includes(`\`${id}`))) continue;
    for (const m of linha.matchAll(/\bF`([^`]*)`/g)) achadas.push(m[1]);
    for (const m of linha.matchAll(/\bF\('([^']*)'\)/g)) achadas.push(m[1]);
  }
  assert.ok(achadas.length >= 8, `achei so ${achadas.length} frases de perigo em cima -- o teste parou de enxergar as falas`);

  for (const f of achadas) {
    // a frase "X a N segundos, no top" e informativa (o inimigo ainda esta longe): nao exige ordem
    const informativa = /^\$\{[^}]*\} a \$\{s\} segundos/.test(f) || /^Jungler a \$\{s\} segundos/.test(f);
    const primeira = f.split(/[!.,]/)[0].trim();
    if (!informativa) assert.match(primeira, ORDEM, `"${f}" nao comeca com a ordem -- se a morte cortar a fala ele nao ouviu o que fazer`);
    const chars = f.replace(/\$\{[^}]*\}/g, 'Caitlyn').length;
    assert.ok(chars / CPS <= 3.6, `"${f}" leva ${(chars / CPS).toFixed(1)} s de voz; a antecedencia mediana e 3,8 s`);
  }
});

/* ------------------------------------------- a fala gravada precisa levar a identidade dela */

test('falas.jsonl grava o id da situacao (chave), nao so o id dos modulos', async () => {
  const { readFile } = await import('node:fs/promises');
  const dae = await readFile(new URL('../src/daemon.js', import.meta.url), 'utf8');

  // As situacoes do minimapa (situacoes.js) guardam o identificador em `chave`; os
  // modulos de API (timers, kills, economia) em `id`. A gravacao lia so `id`, entao
  // 80% das falas de uma partida saiam com id nulo -- sem isso so da pra analisar por
  // regex no texto, e foi assim que uma analise misturou canhao com aviso de perigo.
  const linha = dae.split('\n').find((l) => l.includes("'falas.jsonl'") && l.includes('appendFile'));
  assert.ok(linha, 'nao achei a linha que grava falas.jsonl');
  assert.match(linha, /id:\s*pronta\.id\s*\?\?\s*pronta\.chave/, 'a gravacao de falas.jsonl precisa cair em pronta.chave quando nao tem pronta.id');

  // e o `situ` do situacoes.js tem mesmo que produzir `chave`
  const sit = await readFile(new URL('../src/vivo/situacoes.js', import.meta.url), 'utf8');
  assert.match(sit, /const s = \{ chave,/, 'situ() parou de guardar a identidade em `chave` -- a gravacao acima quebra junto');

  // e o caminho que transforma situacao em fala tem que PASSAR a chave adiante --
  // na 2.28.212 so a gravacao foi corrigida e o objeto chegava la sem chave nenhuma,
  // entao o id continuou nulo.
  const monta = dae.split(/\r?\n/).find((l) => l.includes('const pronta = prontaFala({'));
  assert.ok(monta, 'nao achei onde a situacao vira fala');
  assert.match(monta, /chave: sit\.chave/, 'prontaFala precisa receber sit.chave, senao a gravacao nao tem o que gravar');
});

/* ------------------------------------------- modulo mapa: a janela de fala e 5 s */

test('aviso "X a N segundos": fala ate 5 s, so registra de 6 a 8', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/vivo/situacoes.js', import.meta.url), 'utf8');
  const linha = src.split('\n').find((l) => l.includes('`perto-${f.nome}`'));
  assert.ok(linha, 'nao achei o gatilho perto-<campeao>');

  // Medido em 138 avisos desses nas partidas gravadas:
  //   janela de 8 s -> 138 falas, 22 mortes pegas, 16% de acerto
  //   janela de 5 s ->  63 falas, 17 mortes pegas, 27% de acerto, antecedencia 11,2 -> 9,9 s
  // O de 6 a 8 s continua entrando como prioridade 0 (gravado, nao falado) pra nao perder o dado.
  assert.match(linha, /prioridade: s <= 5 \? 3 : 0/, 'a janela de FALA do aviso de aproximacao tem que ser 5 s; de 6 a 8 fica so no registro');
  assert.match(linha, /if \(s <= 8 && chegando\)/, 'a janela de REGISTRO tem que continuar em 8 s -- e o dado pra medir a proxima mudanca');
});

/* ------------------------------------------- a vida gravada em cada situacao */

test('contexto da situacao: a vida sai preenchida (guarda e conta no mesmo nivel)', async () => {
  const { readFile } = await import('node:fs/promises');
  const dae = await readFile(new URL('../src/daemon.js', import.meta.url), 'utf8');
  const linha = dae.split('\n').find((l) => l.includes('contexto: { kills:'));
  assert.ok(linha, 'nao achei a linha que monta o contexto da situacao');

  // O bug: a guarda olhava `e.vidaMax` (nao existe) e a conta usava `e.eu.vidaMax`.
  // Resultado: vida nula em 100% das situacoes gravadas -- nenhum gate por vida podia
  // ser medido. vidaMax mora em `eu`, nunca na raiz do estado.
  assert.ok(!/[^.]\be\.vidaMax\b/.test(linha), 'a guarda da vida esta lendo e.vidaMax, que nao existe -- vidaMax mora em e.eu');
  assert.match(linha, /vida: e\.eu\?\.vidaMax \? Math\.round\(100 \* e\.eu\.vida \/ e\.eu\.vidaMax\)/, 'guarda e conta da vida tem que ler o mesmo campo');

  // e a gravacao do estado tem que continuar salvando vidaMax, senao nao ha o que dividir
  const estado = dae.split(/\r?\n/).find((l) => l.includes("'estado.jsonl'") && l.includes('appendFile'));
  assert.match(estado ?? '', /vidaMax: estado\.eu\.vidaMax/, 'estado.jsonl parou de gravar vidaMax');
});

/* ------------------------------------------- dive: 2+ dentro da sua torre, sem exigir o jungler */

test('dive: nao depende de ver o jungler, e substitui o aviso generico', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/vivo/situacoes.js', import.meta.url), 'utf8');
  const linhas = src.split(/\r?\n/);

  // O gatilho antigo exigia o jungler deles visivel colado em voce. Medido nas 13
  // partidas gravadas: disparou 0 vezes, e nas 15 mortes debaixo da propria torre o
  // jungler nao estava visivel em NENHUMA (a aquisicao a frio do olho e 27%).
  const dive = linhas.find((l) => l.includes("situ('dive'"));
  assert.ok(dive, 'nao achei o gatilho do dive');
  assert.ok(!/jg\b/.test(dive), 'o dive voltou a depender do jungler -- foi isso que o deixou morto');
  assert.match(dive, /dentroDaMinhaTorre\[0\]\.campeao/, 'o dive tem que nomear quem entrou na torre');

  // e tem que SUBSTITUIR o aviso generico, nao somar: a condicao do dive e subconjunto
  // da dele, entao disparar os dois seria falar duas vezes o mesmo perigo.
  const generico = linhas.find((l) => l.includes("'perigo-perto-mais' : 'perigo-perto'"));
  assert.ok(generico, 'nao achei o aviso generico de 2+ inimigos');
  assert.match(generico, /if \(!temDive &&/, 'o aviso generico tem que calar quando o dive dispara');

  // a condicao do dive: os inimigos DENTRO do alcance da torre, nao so perto de voce
  const cond = linhas.find((l) => l.includes('const dentroDaMinhaTorre'));
  assert.ok(cond, 'nao achei a condicao do dive');
  assert.match(cond, /naTorreDe\(minhaPos, meuTime\)/, 'precisa exigir que VOCE esteja na sua torre');
  assert.match(cond, /filter\(\(f\) => naTorreDe\(f\.ultimo, meuTime\)\)/, 'precisa exigir que ELES entrem na sua torre -- so estar perto de voce e wave empurrando, nao dive');
  assert.match(cond, /t >= 150/, 'antes de 2:30 e invade, nao dive');
});

/* ------------------------------------------- prioridade 1 precisa ter como sair */

test('cerebro: prioridade 1 fala quando sobra espaco, e cala quando nao sobra', async () => {
  const { decidir, novaMemoriaCerebro } = await import('../src/vivo/cerebro.js');
  const ctx = { t: 600, minhaLane: 'bot', minhaRole: 'adc', morto: false };
  const umaP1 = () => [{ chave: 'jg-nasce', tipo: 'jungler', prioridade: 1, dados: {} }];

  // Com o app quieto (nenhuma fala no ultimo minuto) ela tem que sair. Antes disso o corte
  // era nota >= 2 e a prioridade 1 comeca em 1,0: jg-nasce, jg-lado-livre, aliado-sozinho e
  // agrupados dispararam 618 vezes em 96 partidas sem nunca ser falados.
  const quieto = novaMemoriaCerebro();
  assert.equal(decidir(umaP1(), ctx, quieto)[0].falar, true, 'com o app quieto a prioridade 1 tem que falar');

  // Com o app falando muito ela tem que calar -- a folga e justamente o que a limita.
  const cheio = novaMemoriaCerebro();
  cheio.faladasEm = [560, 570, 580, 590];
  cheio.ultimaFalaEm = 590;
  assert.equal(decidir(umaP1(), ctx, cheio)[0].falar, false, 'com 4 falas no ultimo minuto a prioridade 1 nao pode entrar');

  // prioridade 0 continua so no registro, com folga ou sem
  const zero = novaMemoriaCerebro();
  assert.equal(decidir([{ chave: 'wave-bot-nosso', tipo: 'wave', prioridade: 0, dados: {} }], ctx, zero)[0].falar, false, 'prioridade 0 e so registro');

  // e o silenciamento por avaliacao continua valendo mesmo com folga
  const calado = novaMemoriaCerebro();
  const r = decidir(umaP1(), { ...ctx, silenciadas: new Set(['jg-nasce']) }, calado);
  assert.equal(r[0].falar, false, 'situacao silenciada pelas avaliacoes nao pode voltar pela folga');
});

/* ------------------------------------------- o conselho tem que acompanhar o jogo */

test('ace: o alvo muda conforme o jogo, nao e sempre Barao', () => {
  const objetivos = [{ nome: 'Barão', em: -10, vivo: true, quando: 'no mapa' }];
  const ace = (eventos) => {
    const e = mundo(1500, 'adc');
    e.eventos = [...eventos, { id: 999, tipo: 'Ace', t: 1500, autor: e.eu.nome, assistentes: [] }];
    const out = falasNovas({ estado: e, rastreio: null, objetivos, conselhos: [], extras: null }, novaMemoriaFalas());
    const f = out.find((q) => String(q.id).startsWith('ace-'));
    return f ? render(f.serio) : null;
  };
  const meu = mundo(1500, 'adc').eu.nome;
  const torreDeles = (p) => ({ id: p, tipo: 'TurretKilled', t: 900 + p, autor: meu, torre: `Turret_TChaos_L1_P${p}` });

  // jogo aberto, Barao vivo: continua valendo
  assert.match(ace([]), /Bar[ãa]o/, 'sem nada tomado, Barao e a jogada');
  // base deles aberta: nao manda mais sair do jogo ganho pra buscar buff
  const comInib = ace([{ id: 50, tipo: 'InhibKilled', t: 1400, autor: meu, assistentes: [] }]);
  assert.ok(!/Bar[ãa]o ou torre/.test(comInib), `com inibidor caido nao pode ser o conselho antigo: "${comInib}"`);
  // torre do nexus no chao: so existe uma jogada
  const noNexus = ace([torreDeles(4), { id: 50, tipo: 'InhibKilled', t: 1400, autor: meu, assistentes: [] }]);
  assert.match(noNexus, /nexus/i, `com a torre do nexus caida o conselho tem que ser o nexus: "${noNexus}"`);
});

test('timers de objetivo calam quando o jogo ja esta na base', () => {
  const objetivos = [{ nome: 'Dragão', em: 30, vivo: false, quando: 'em 0:30' }, { nome: 'Barão', em: 30, vivo: false, quando: 'em 0:30' }];
  const rodarCom = (eventos) => {
    const e = mundo(1800, 'adc');
    e.eventos = eventos;
    return falasNovas({ estado: e, rastreio: null, objetivos, conselhos: [], extras: null }, novaMemoriaFalas()).filter((f) => String(f.id).startsWith('t30-')).map((f) => render(f.serio));
  };
  const meu = mundo(1800, 'adc').eu.nome;

  // jogo normal: os dois timers saem
  assert.equal(rodarCom([]).length, 2, 'sem base aberta os dois timers saem');
  // inibidor caido: Dragao nao decide mais nada, Barao ainda decide
  const comInib = rodarCom([{ id: 1, tipo: 'InhibKilled', t: 1700, autor: meu, assistentes: [] }]);
  assert.deepEqual(comInib.map((s) => /Barão/.test(s)), [true], `com inibidor caido so o Barao fica: ${JSON.stringify(comInib)}`);
  // torre do nexus caida: nenhum timer de pit importa
  assert.deepEqual(rodarCom([{ id: 2, tipo: 'TurretKilled', t: 1700, autor: meu, torre: 'Turret_TChaos_L1_P4' }]), [], 'com a torre do nexus caida nenhum timer de objetivo sai');
});

/* ------------------------------------------- a tela ao vivo so existe durante a partida */

test('tela ao vivo: abre no jogo, fecha depois, e nunca rouba foco pela troca de fase', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');

  // Ela abria na SELECAO e nada nunca a fechava -- ficava aberta o tempo todo.
  const sel = main.split(/\r?\n/).find((l) => l.includes('aoSelecionar:'));
  assert.ok(sel, 'nao achei o gancho da selecao de campeao');
  assert.ok(!/abrirVivo/.test(sel), 'a tela ao vivo nao pode mais abrir na selecao de campeao');

  // o bloco da troca de fase: pego do aoFase ate o fim do handler
  const i = main.indexOf('aoFase: (fase) =>');
  assert.ok(i > 0, 'nao achei o aoFase');
  const bloco = main.slice(i, main.indexOf('\n      },', i));
  assert.match(bloco, /fase === 'InProgress' \|\| fase === 'GameStart'\) abrirVivo\(\{ focar: false \}\)/, 'a tela ao vivo tem que abrir quando o jogo comeca');
  assert.match(bloco, /fecharVivo\(\)/, 'alguma coisa tem que fechar a tela ao vivo');

  // REGRA DE OURO: com o jogo rodando o app nao chama show()/focus() em janela normal --
  // show() ATIVA a janela, o Windows tira o foco do jogo e o LoL em tela cheia minimiza.
  // Toda abertura vinda da troca de fase tem que ser showInactive, ou seja focar: false.
  for (const m of bloco.matchAll(/abrirVivo\(([^)]*)\)/g)) {
    assert.match(m[1], /focar:\s*false/, `abrirVivo sem "focar: false" dentro do aoFase: "${m[0]}" -- isso minimiza o LoL dele`);
  }
  assert.ok(!/janelaVivo\.(show|focus)\(\)/.test(bloco), 'nada de show()/focus() direto na janela ao vivo dentro do aoFase');

  // e o fecharVivo tem que existir de verdade
  assert.match(main, /function fecharVivo\(\)/, 'fecharVivo nao existe');
});

/* ------------------------------------------- fala repetida sai sem a explicacao */

test('repetida: corta a explicacao, nunca a ordem nem o numero', async () => {
  const { encurtarRepetida } = await import('../src/vivo/texto.js');

  // Medido em 13 partidas: 33% das falas de uma partida sao repeticao da mesma coisa.
  // A campea e "Canhao nessa wave. Ela empurra sozinha." -- 6,8 vezes por partida, ate 8.
  assert.equal(encurtarRepetida('Canhão nessa wave. Ela empurra sozinha.'), 'Canhão nessa wave.');
  assert.equal(encurtarRepetida('Jungler deles voltou pra base. Dá pra avançar agora.'), 'Jungler deles voltou pra base.');
  assert.equal(encurtarRepetida('Seu jungler sem flash por {1}. Gank sem flash: só com a lane na torre.'), 'Seu jungler sem flash por {1}.');

  // a ORDEM nunca cai: e o que ele tem que fazer
  assert.equal(encurtarRepetida('Vida baixa e gold sobrando. Base.'), 'Vida baixa e gold sobrando. Base.');
  assert.equal(encurtarRepetida('Barão nosso. Empurra as três lanes.'), 'Barão nosso. Empurra as três lanes.');
  assert.equal(encurtarRepetida('Eles no Barão. Solta o que está fazendo.'), 'Eles no Barão. Solta o que está fazendo.');

  // frase com numero nunca cai: e o dado que mudou desde a ultima vez
  assert.equal(encurtarRepetida('Jungler deles morreu. {1} segundos livres.'), 'Jungler deles morreu. {1} segundos livres.');

  // se sobrar quase nada, fica tudo ("Ace." sozinho nao diz nada)
  assert.equal(encurtarRepetida('Ace. Barão ou torre agora.'), 'Ace. Barão ou torre agora.');

  // frase de uma sentenca so passa direto
  assert.equal(encurtarRepetida('Trinta segundos pro Dragão.'), 'Trinta segundos pro Dragão.');
  assert.equal(encurtarRepetida('Sai! {1} em cima.'), 'Sai! {1} em cima.');
});

test('repetida: a estreia sai inteira, a 2a vez sai curta', async () => {
  const { render, personalizar, encurtarRepetida, temPersonalizacao } = await import('../src/vivo/texto.js');
  personalizar({});
  const modelo = 'Canhão nessa wave. Ela empurra sozinha.';
  const fala = { modelo, valores: [] };

  // o mesmo controle que o daemon faz: a decisao e uma so por fala
  const ditos = new Set();
  const falar = () => {
    const repetida = ditos.has(modelo);
    if (!repetida) ditos.add(modelo);
    const t = repetida && !temPersonalizacao(modelo) ? { ...fala, modelo: encurtarRepetida(modelo) } : fala;
    return render(t);
  };
  assert.equal(falar(), 'Canhão nessa wave. Ela empurra sozinha.', 'a primeira vez sai inteira');
  assert.equal(falar(), 'Canhão nessa wave.', 'a segunda ja sai sem a explicacao');
  assert.equal(falar(), 'Canhão nessa wave.', 'e segue curta');

  // frase que ELE personalizou nao se mexe
  personalizar({ [modelo]: 'Canhão. Olha a wave.' });
  assert.equal(temPersonalizacao(modelo), true);
  assert.equal(render(fala), 'Canhão. Olha a wave.', 'a personalizada dele manda');
  personalizar({});
});

/* ------------------------------------------------------------------ Valorant: presença
 * O formato do blob mudou sem aviso e derrubou a detecção inteira em silêncio. Estes
 * testes travam os dois formatos pra isso não voltar. */
test('presença no formato novo: estado e mapa vêm de matchPresenceData', async () => {
  const { lerPresenca } = await import('../src/valorant/jogo.js');
  const r = lerPresenca({
    isIdle: false, partySize: 1, queueId: 'unrated',
    matchPresenceData: { sessionLoopState: 'INGAME', matchMap: '/Game/Maps/Triad/Triad', queueId: 'competitive' },
  });
  assert.equal(r.estado, 'jogando');
  assert.equal(r.mapa, 'Haven');
  assert.equal(r.fila, 'competitive');
});

test('presença no formato antigo (raiz) continua lida', async () => {
  const { lerPresenca } = await import('../src/valorant/jogo.js');
  const r = lerPresenca({ sessionLoopState: 'PREGAME', matchMap: '/Game/Maps/Duality/Duality', queueId: 'unrated' });
  assert.equal(r.estado, 'selecao');
  assert.equal(r.mapa, 'Bind');
});

test('no menu: estado menu e mapa nulo, sem estourar', async () => {
  const { lerPresenca } = await import('../src/valorant/jogo.js');
  const r = lerPresenca({ matchPresenceData: { sessionLoopState: 'MENUS', matchMap: '' } });
  assert.equal(r.estado, 'menu');
  assert.equal(r.mapa, null);
  assert.equal(lerPresenca(null).estado, null);
});

test('partida do grupo: cai pro que o dono reporta', async () => {
  const { lerPresenca } = await import('../src/valorant/jogo.js');
  const r = lerPresenca({
    matchPresenceData: {},
    partyPresenceData: { partyOwnerSessionLoopState: 'INGAME', partyOwnerMatchMap: '/Game/Maps/Hurm/Hurm' },
  });
  assert.equal(r.estado, 'jogando');
  assert.equal(r.mapa, 'Corrode');
});

/* ------------------------------------------------------------------ pacote nao declarado
 * Esta e a rede pro bug que derrubou a deteccao do Valorant em silencio: o codigo importava
 * `undici`, que existe em node_modules como dependencia TRANSITIVA. Em desenvolvimento o
 * import funcionava e tudo parecia certo; mas o electron-builder so empacota dependencia
 * DECLARADA, entao no app instalado o pacote nao existia e a funcao desistia antes de
 * qualquer requisicao. O bug so aparecia onde importa, e nenhum teste daqui via.
 * Agora ve. */
test('nada em src/ e electron/ importa pacote fora do package.json', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { builtinModules } = await import('node:module');

  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(await readFile(join(raiz, 'package.json'), 'utf8'));
  const declarados = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  const embutidos = new Set(builtinModules);

  async function varrer(dir) {
    const fora = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const caminho = join(dir, e.name);
      if (e.isDirectory()) { fora.push(...await varrer(caminho)); continue; }
      if (!/\.(mjs|js)$/.test(e.name)) continue;
      fora.push([caminho, await readFile(caminho, 'utf8')]);
    }
    return fora;
  }

  const arquivos = [...await varrer(join(raiz, 'src')), ...await varrer(join(raiz, 'electron'))];
  const padrao = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
  const problemas = [];

  for (const [caminho, texto] of arquivos) {
    for (const m of texto.matchAll(padrao)) {
      const alvo = m[1];
      if (alvo.startsWith('.') || alvo.startsWith('/') || alvo.startsWith('node:')) continue;
      // nome do pacote, lidando com escopo (@org/pacote/sub -> @org/pacote)
      const partes = alvo.split('/');
      const nome = alvo.startsWith('@') ? partes.slice(0, 2).join('/') : partes[0];
      if (embutidos.has(nome) || declarados.has(nome)) continue;
      problemas.push(`${caminho.replace(raiz, '')} importa '${alvo}'`);
    }
  }

  assert.deepEqual(problemas, [], 'pacote usado sem estar no package.json — some no app empacotado:\n' + problemas.join('\n'));
});

/* --------------------------------------------------------------------------
 * Lineups de Valorant: o capítulo é DESTE mapa?
 *
 * Medido antes do filtro: buscando Breeze com Fade vinham 85 lineups, e 38 delas saíam de
 * um único vídeo — "BEST Fade Lineups ALL MAPS" — sem nenhuma ser de Breeze. Abyss, Bind,
 * Corrode, Fracture, Haven, Lotus, Pearl e Sunset iam todas pra planta do Breeze.
 * -------------------------------------------------------------------------- */
const MAPAS = ['Abyss', 'Ascent', 'Bind', 'Breeze', 'Corrode', 'Fracture', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split', 'Sunset'];
const caps = (...nomes) => nomes.map((nome, i) => ({ nome, segundo: 30 + i * 30 }));

test('lineup: vídeo de todos os mapas só entrega os capítulos do mapa pedido', async () => {
  const { capitulosDesteMapa } = await import('../src/valorant/lineups.js');
  const c = caps(
    'Fade Lineup Abyss A Site (Front) from A Main',
    'Fade Lineup Bind B Site from B Long',
    'Fade Lineup Haven A Site from A Long',
    'Fade Lineup Haven C Site from C Long',
    'Fade Lineup Lotus C Main from C Lobby',
  );
  const titulo = 'BEST Fade Lineups ALL MAPS 2026 Guide Valorant!';
  assert.deepEqual(capitulosDesteMapa(c, titulo, 'Breeze', MAPAS), [false, false, false, false, false]);
  assert.deepEqual(capitulosDesteMapa(c, titulo, 'Haven', MAPAS), [false, false, true, true, false]);
  assert.deepEqual(capitulosDesteMapa(c, titulo, 'Bind', MAPAS), [false, true, false, false, false]);
});

test('lineup: capítulo sem mapa herda o do capítulo anterior (cabeçalho de seção)', async () => {
  const { capitulosDesteMapa } = await import('../src/valorant/lineups.js');
  const c = caps('ASCENT', 'A Site from A Main', 'B Site from B Lobby', 'HAVEN', 'C Long reveal');
  assert.deepEqual(capitulosDesteMapa(c, 'Fade lineups guide', 'Ascent', MAPAS), [true, true, true, false, false]);
  assert.deepEqual(capitulosDesteMapa(c, 'Fade lineups guide', 'Haven', MAPAS), [false, false, false, true, true]);
});

test('lineup: o título manda enquanto nenhum capítulo disser o mapa', async () => {
  const { capitulosDesteMapa } = await import('../src/valorant/lineups.js');
  const c = caps('Site B Seize 01', 'A Site Haunt 03', 'Mid Haunt 01');
  const titulo = 'All 16 Fade Lineups on Breeze | VALORANT';
  assert.deepEqual(capitulosDesteMapa(c, titulo, 'Breeze', MAPAS), [true, true, true]);
  assert.deepEqual(capitulosDesteMapa(c, titulo, 'Ascent', MAPAS), [false, false, false]);
  // ninguém disse nada: não dá pra afirmar que é de outro mapa, então fica
  assert.deepEqual(capitulosDesteMapa(c, 'Fade lineups', 'Breeze', MAPAS), [true, true, true]);
});

/* --------------------------------------------------------------------------
 * O acervo: o que está em disco tem que ser aproveitado, não descartado.
 *
 * Quando o FORMATO_BUSCA subiu pra 4 (por causa do filtro de mapa), os 51 arquivos que ele
 * já tinha viraram lixo de um dia pro outro — 3,1 MB e ~25 s de busca por arquivo pra
 * recuperar. O migrador roda o filtro em cima do que está salvo e sobe o arquivo sem rede.
 * -------------------------------------------------------------------------- */
test('acervo: arquivo do formato antigo é aproveitado, não descartado', async () => {
  const { mkdtemp, mkdir, writeFile, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');

  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-acervo-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    const val = resolve(base, 'dados', 'valorant');
    await mkdir(resolve(val, 'buscas'), { recursive: true });
    // catálogo falso, pra não depender de rede
    await writeFile(resolve(val, 'catalogo.json'), JSON.stringify({
      em: Date.now(), formato: 4,
      mapas: ['Ascent', 'Bind', 'Breeze', 'Haven'].map((nome) => ({ nome, planta: null, callouts: [] })),
      agentes: [{ nome: 'Fade', icone: null, habilidades: [] }],
    }), 'utf8');

    const ontem = Date.now() - 24 * 60 * 60 * 1000;
    const l = (video, nome) => ({ video, titulo: 'BEST Fade Lineups ALL MAPS', nome, segundo: 30, fim: 60 });
    await writeFile(resolve(val, 'buscas', 'breeze__fade_____atacando.json'), JSON.stringify({
      formato: 3, em: ontem,
      lineups: [l('v1', 'Fade Lineup Bind A Site'), l('v1', 'Fade Lineup Breeze B Site'), l('v1', 'Fade Lineup Haven C Site')],
    }), 'utf8');
    // arquivo por habilidade: o app não lê mais, então não pode entrar na conta
    await writeFile(resolve(val, 'buscas', 'breeze__fade__haunt__atacando.json'), JSON.stringify({
      formato: 3, em: ontem, lineups: [l('v2', 'Breeze A Site Haunt')],
    }), 'utf8');

    const { buscaGuardada, acervo } = await import(`../src/valorant/lineups.js?acervo=${Date.now()}`);
    const g = await buscaGuardada({ mapa: 'Breeze', agente: 'Fade', lado: 'atacando' });
    assert.ok(g, 'o arquivo do formato 3 tinha que ser aproveitado');
    assert.deepEqual(g.lineups.map((x) => x.nome), ['Fade Lineup Breeze B Site'], 'só a de Breeze fica');
    assert.equal(g.em, ontem, 'a data original não pode virar "agora"');

    const salvo = JSON.parse(await readFile(resolve(val, 'buscas', 'breeze__fade_____atacando.json'), 'utf8'));
    assert.equal(salvo.formato, 4, 'o arquivo tinha que subir de formato no disco');

    const a = await acervo();
    const fade = a.agentes.find((x) => x.agente === 'Fade');
    assert.equal(fade.lineups, 1, 'a conta é só do que o app lê');
    assert.equal(a.sobra.arquivos, 1, 'a busca por habilidade entra como sobra, não na conta');
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

/* --------------------------------------------------------------------------
 * Vídeo que não toca tem que sumir das buscas JÁ SALVAS também.
 *
 * Filtrar na hora da busca só resolve o que vem de hoje em diante. No acervo dele, 135 das
 * 7890 lineups apontam pra dois vídeos que o dono marcou como "não pode tocar fora do
 * YouTube" — e isso não dá pra saber sem tentar. Então quando o player erra, a tela avisa,
 * e o vídeo sai de tudo: do que está em disco e do que for buscado depois.
 * -------------------------------------------------------------------------- */
test('lineups: vídeo que deu erro no player some até do que já estava salvo', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');

  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-ruim-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    const val = resolve(base, 'dados', 'valorant');
    await mkdir(resolve(val, 'buscas'), { recursive: true });
    await writeFile(resolve(val, 'catalogo.json'), JSON.stringify({
      em: Date.now(), formato: 4,
      mapas: [{ nome: 'Ascent', planta: null, callouts: [] }],
      agentes: [{ nome: 'Sova', icone: null, habilidades: [] }],
    }), 'utf8');

    const l = (video, nome) => ({ video, titulo: 'Sova Ascent', nome, segundo: 10, fim: 40 });
    await writeFile(resolve(val, 'buscas', 'ascent__sova_____atacando.json'), JSON.stringify({
      formato: 4, em: Date.now(), lidos: 18,
      lineups: [l('bom1', 'A Site'), l('ruim', 'A Main'), l('bom2', 'B Site'), l('ruim', 'Mid')],
    }), 'utf8');

    const { lineupsDe, marcarVideoRuim } = await import(`../src/valorant/lineups.js?ruim=${Date.now()}`);
    const pedido = { mapa: 'Ascent', agente: 'Sova', lado: 'atacando' };

    const antesDeMarcar = await lineupsDe(pedido);
    assert.equal(antesDeMarcar.lineups.length, 4, 'começa com as quatro');

    await marcarVideoRuim('ruim', '150');
    const depois = await lineupsDe(pedido);
    assert.deepEqual(depois.lineups.map((x) => x.video), ['bom1', 'bom2'], 'as do vídeo ruim saem');

    // e continua valendo depois de reler do disco
    const { lineupsDe: deNovo } = await import(`../src/valorant/lineups.js?ruim2=${Date.now()}`);
    const terceira = await deNovo(pedido);
    assert.deepEqual(terceira.lineups.map((x) => x.video), ['bom1', 'bom2'], 'a lista de ruins tem que ficar gravada');
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

/* --------------------------------------------------------------------------
 * Busca magra tem que se marcar como velha sozinha.
 *
 * Os 56 arquivos do acervo dele foram salvos quando a busca lia 6 vídeos; hoje lê 18 e
 * traz o triplo de capítulos, de o dobro de canais. Jogar os arquivos fora (subindo o
 * FORMATO_BUSCA) tirava o "sai na hora", que é o ponto do acervo. Então o arquivo magro
 * continua valendo e sai na hora — só vem marcado `velho`, que é o que dispara a
 * revalidação por baixo e faz a varredura refazer em vez de pular.
 * -------------------------------------------------------------------------- */
test('acervo: busca salva com poucos vídeos se marca velha, sem ser descartada', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');

  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-magro-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    const val = resolve(base, 'dados', 'valorant');
    await mkdir(resolve(val, 'buscas'), { recursive: true });
    await writeFile(resolve(val, 'catalogo.json'), JSON.stringify({
      em: Date.now(), formato: 4,
      mapas: [{ nome: 'Ascent', planta: null, callouts: [] }],
      agentes: [{ nome: 'Sova', icone: null, habilidades: [] }],
    }), 'utf8');

    const lineups = [{ video: 'v1', titulo: 'Sova Ascent', nome: 'A Site Shock Dart', segundo: 10, fim: 40 }];
    const salvar = (arquivo, extra) => writeFile(
      resolve(val, 'buscas', arquivo),
      JSON.stringify({ formato: 4, em: Date.now(), lineups, ...extra }), 'utf8',
    );
    await salvar('ascent__sova_____atacando.json', { lidos: 6 });
    await salvar('ascent__sova_____defendendo.json', { lidos: 18 });

    const { buscaGuardada } = await import(`../src/valorant/lineups.js?magro=${Date.now()}`);
    const magro = await buscaGuardada({ mapa: 'Ascent', agente: 'Sova', lado: 'atacando' });
    const cheio = await buscaGuardada({ mapa: 'Ascent', agente: 'Sova', lado: 'defendendo' });

    assert.ok(magro, 'o arquivo magro tem que continuar servindo, não ser descartado');
    assert.equal(magro.lineups.length, 1, 'e vir com as lineups dele');
    assert.equal(magro.velho, true, 'salvo com 6 vídeos: tem que pedir revalidação');
    assert.equal(cheio.velho, false, 'salvo já com 18: não precisa refazer');
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

/* --------------------------------------------------------------------------
 * O giro do mapa depende de a Riot publicar os dois spawns como callout. Se um dia
 * publicarem um mapa sem eles, o mapa volta a ficar na orientação da planta sem avisar —
 * e foi exatamente isso que o incomodava. Este teste olha o catálogo que está em disco.
 * -------------------------------------------------------------------------- */
test('mapa: todo mapa do catálogo tem os dois spawns, senão o giro não acontece', async (t) => {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const { pastaBase } = await import('../src/caminhos.js');
  let cat;
  try { cat = JSON.parse(await readFile(resolve(pastaBase(), 'dados', 'valorant', 'catalogo.json'), 'utf8')); }
  catch { return t.skip('sem catálogo em disco'); }
  if (!cat?.mapas?.length) return t.skip('catálogo vazio');

  const sem = [];
  for (const m of cat.mapas) {
    const nomes = (m.callouts ?? []).map((c) => c.nome);
    const atq = nomes.some((n) => /attacker side spawn/i.test(n));
    const def = nomes.some((n) => /defender side spawn/i.test(n));
    if (!atq || !def) sem.push(`${m.nome}${atq ? '' : ' (sem spawn atacante)'}${def ? '' : ' (sem spawn defensor)'}`);
  }
  assert.deepEqual(sem, [], 'mapa sem spawn não gira e fica na orientação da planta');

  // e o giro tem que ser um múltiplo de 90 — a conta é a mesma do painel
  for (const m of cat.mapas) {
    const atq = m.callouts.find((c) => /attacker side spawn/i.test(c.nome));
    const def = m.callouts.find((c) => /defender side spawn/i.test(c.nome));
    const ang = Math.atan2(def.y - atq.y, def.x - atq.x) * 180 / Math.PI;
    const giro = ((Math.round((-90 - ang) / 90) * 90) % 360 + 360) % 360;
    assert.ok([0, 90, 180, 270].includes(giro), `${m.nome}: giro ${giro} não é múltiplo de 90`);
  }
});
