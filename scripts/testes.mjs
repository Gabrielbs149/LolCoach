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

/* ------------------------------------------------------------------ Valorant: que lado é
 *
 * O lado só existia como palavra na busca, e todo capítulo do vídeo achado virava lineup
 * daquele lado — inclusive os que diziam o contrário. Medido no acervo dele, rodando a
 * migração numa cópia: 2334 das 6245 lineups (37,4%) estavam do lado errado. A pior,
 * Lotus+Fade atacando, mostrava 215 e 131 delas (61%) eram de defesa. */
test('lado: o que o texto diz, nos idiomas que o acervo dele tem', async () => {
  const { ladoPeloTexto } = await import('../src/valorant/lineups.js');
  const casos = [
    // inglês, do jeito que os canais escrevem
    ['Abyss Attack - A Site', 'atacando'],
    ['Abyss Defense - B Site', 'defendendo'],
    ['DEF A Retake 1 High', 'defendendo'],
    ['ATT A Site 1 Close', 'atacando'],
    ['Site A Defuse Prevention Incendiary 01', 'atacando'],
    ['A Site (Delay Defuse)', 'atacando'],
    ['B Main (Anti-Rush)', 'defendendo'],
    ['B Counter push 1', 'defendendo'],
    ['A Site Execute', 'atacando'],
    ['Site Hold', 'defendendo'],
    // lugar que só existe de um lado
    ['A default from Defender Spawn', 'defendendo'],
    ['B Default from CT', 'defendendo'],
    // espanhol e português
    ['Defensa Site A - Retake 1', 'defendendo'],
    ['Ataque Site A - Lineup Post plant', 'atacando'],
    // coreano: NFD quebra hangul em jamo, então isto também trava o normalizador
    ['미드 공격 귀체', 'atacando'],
    ['A 포스트플랜트 귀체', 'atacando'],
    ['A 리테이크 귀체', 'defendendo'],
    ['A 진입 카운터 귀체', 'defendendo'],   // entrada CONTRA-atacada: defesa, não ataque
    // japonês
    ['守りAメイン取りホウント①', 'defendendo'],
    ['攻めAメイン取りホウント①', 'atacando'],
    ['Aエントリーホウント①', 'atacando'],
    // o que NÃO pode virar lado nenhum
    ['A Attack - Shock to clear defender utilities', 'atacando'],  // "defender" ali é o inimigo
    ['B Main Push 1', null],                                       // push é dos dois lados
    ['A Default', null],                                           // "default" não é "def"
    ['Fade Lineup Abyss B Site from B Lobby', null],
  ];
  for (const [nome, esperado] of casos) {
    assert.equal(ladoPeloTexto(nome), esperado, `${JSON.stringify(nome)} tinha que dar ${esperado}`);
  }
});

/* "ainda to vendo lineup de defesa no ataque e vice versa".
 *
 * A herança era de QUALQUER capítulo que dissesse o lado, até o fim do vídeo. No "FADE
 * LINEUPS ASCENT" o capítulo "A RETAKE" — que é UMA lineup, não uma seção — marcava de
 * defesa as 14 seguintes. Agora só cabeçalho de seção passa o lado adiante. */
test('lado: cabeçalho de seção passa o lado adiante, nome de lineup não', async () => {
  const { ladosDosCapitulos, ladoCabecalho } = await import('../src/valorant/lineups.js');

  // é cabeçalho quem só diz o lado, com ou sem enfeite
  for (const cab of ['Attacking', 'DEFENSE---', '❚█══ATTACK══█❚', 'Defense Lineups', 'ATAQUE', 'Post Plant', '수비']) {
    assert.ok(ladoCabecalho(cab), `"${cab}" tinha que ser cabeçalho`);
  }
  // e NÃO é cabeçalho quem diz o lado junto com o resto do nome da lineup
  for (const nao of ['A RETAKE', 'A RETAKE from RAFTERS', 'Abyss Defense - B Site', 'DEF A Retake 1 High']) {
    assert.equal(ladoCabecalho(nao), null, `"${nao}" é nome de lineup, não cabeçalho`);
  }

  const caps = [
    { nome: 'Attacking' },            // cabeçalho de seção
    { nome: 'A Site 1' },
    { nome: 'A Site 2' },
    { nome: 'Defense' },              // virou a chave
    { nome: 'A Main Reveal' },
    { nome: 'B Main Reveal' },
  ];
  const r = ladosDosCapitulos(caps, 'Fade Lineups Ascent');
  assert.deepEqual(r.map((x) => x.lado),
    ['atacando', 'atacando', 'atacando', 'defendendo', 'defendendo', 'defendendo']);
  assert.deepEqual(r.map((x) => x.pista), ['nome', 'bloco', 'bloco', 'nome', 'bloco', 'bloco']);

  // o caso do "FADE LINEUPS ASCENT": uma lineup de retake no meio não vira seção
  const mix = ladosDosCapitulos(
    [{ nome: 'A LOBBY' }, { nome: 'A RETAKE' }, { nome: 'B MAIN' }, { nome: 'GOD A' }],
    'FADE LINEUPS ASCENT - VALORANT');
  assert.deepEqual(mix, [
    { lado: null, pista: null },
    { lado: 'defendendo', pista: 'nome' },
    { lado: null, pista: null },
    { lado: null, pista: null },
  ]);

  // ninguém falou nada ainda: vale o título do vídeo
  const t = ladosDosCapitulos([{ nome: 'A Site' }], 'Best Fade POST PLANT lineups');
  assert.deepEqual(t, [{ lado: 'atacando', pista: 'video' }]);

  // ninguém falou nada em lugar nenhum: fica null, não chuta
  const n = ladosDosCapitulos([{ nome: 'A Site' }], 'Fade Lineups Ascent');
  assert.deepEqual(n, [{ lado: null, pista: null }]);
});

/* As duas pontas de uma lineup: onde a habilidade CAI e de onde ela SAI. O ponto no mapa
 * sai daqui, e é disto que ele reclamou ("pra mim tá sendo aleatório"). */
test('valorant: o diario de partidas vira a ponte entre a hora do clipe e o mapa', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-partidas-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    const P = await import(`../src/valorant/partidas.js?d=${Date.now()}`);

    /* O Outplayed grava numa pasta por SESSAO e cada clipe traz a hora no nome
     * ("VALORANT 11-01-2026 21-29-19-146_7.mp4"), mas nada diz o MAPA. Quem sabe e o app,
     * que le o estado de 6 em 6 segundos — e ate agora nao escrevia isso em lugar nenhum. */
    const t0 = 1_700_000_000_000;
    const min = (n) => t0 + n * 60_000;

    // no menu nao anota nada
    assert.equal(await P.anotarPartida({ estado: 'menu', mapa: null, agora: min(0) }), null);

    // entrou numa partida: abre
    const a = await P.anotarPartida({ estado: 'jogando', mapa: 'Lotus', agenteId: 'fade', agora: min(1) });
    assert.equal(a.mapa, 'Lotus');

    /* Seguiu jogando: NAO cria linha nova, so estica o fim. O laco real olha de 6 em 6
     * segundos, entao o teste tambem olha de pouco em pouco — pular de 1 pra 30 minutos
     * seria o app ter FICADO FORA do ar, que e outra coisa e merece linha nova mesmo. */
    for (let n = 2; n <= 30; n++) {
      await P.anotarPartida({ estado: 'jogando', mapa: 'Lotus', agenteId: 'fade', agora: min(n) });
    }
    assert.equal((await P.partidasGuardadas()).length, 1, 'uma partida, nao uma por volta do laco');

    // a pergunta que o clipe faz: que mapa era as 21:29?
    assert.equal((await P.partidaEm(min(15)))?.mapa, 'Lotus');
    assert.equal((await P.partidaEm(min(90))), null, 'fora da partida, nao inventa');

    // a folga cobre o clipe que comeca antes do app ver: o Outplayed guarda os segundos
    // anteriores ao lance, e o laco so olha de 6 em 6 segundos
    assert.equal((await P.partidaEm(min(1) - 60_000))?.mapa, 'Lotus', 'um minuto antes ainda conta');

    // saiu e entrou em OUTRO mapa: duas partidas, cada uma com a sua janela
    await P.anotarPartida({ estado: 'menu', mapa: null, agora: min(32) });
    for (let n = 40; n <= 70; n++) {
      await P.anotarPartida({ estado: 'jogando', mapa: 'Bind', agenteId: 'fade', agora: min(n) });
    }
    const todas = await P.partidasGuardadas();
    assert.equal(todas.length, 2);
    assert.equal(todas[0].mapa, 'Bind', 'a mais nova vem primeiro');
    assert.equal((await P.partidaEm(min(50)))?.mapa, 'Bind');
    assert.equal((await P.partidaEm(min(15)))?.mapa, 'Lotus', 'a antiga continua respondendo');

    // e sobrevive a reabrir o app: o que importa esta no disco
    P.esquecerDiario();
    assert.equal((await P.partidaEm(min(15)))?.mapa, 'Lotus');
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

test('valorant: em fila conta como ocupado, e nao mexe no estado', async () => {
  const { lerPresenca } = await import('../src/valorant/jogo.js');

  /* Procurando partida, o `sessionLoopState` continua em MENUS — quem conta a fila e o
     `partyState`. Lido do cliente ao vivo: fora da fila vem DEFAULT; na fila, MATCHMAKING.
     Isso importa porque instalar atualizacao REINICIA o app, e o registro ja prometia
     esperar "fila, selecao ou partida" — mas o codigo so sabia ver as duas ultimas.
     Reiniciar no meio de uma fila de tres minutos custa a fila inteira. */

  const noMenu = lerPresenca({
    matchPresenceData: { sessionLoopState: 'MENUS', matchMap: '', queueId: 'unrated' },
    partyPresenceData: { partyState: 'DEFAULT' },
  });
  assert.equal(noMenu.estado, 'menu');
  assert.equal(noMenu.emFila, false);

  const naFila = lerPresenca({
    matchPresenceData: { sessionLoopState: 'MENUS', matchMap: '', queueId: 'competitive' },
    partyPresenceData: { partyState: 'MATCHMAKING' },
  });
  // o estado continua 'menu' DE PROPOSITO: quem ja compara com menu/selecao/jogando nao muda
  assert.equal(naFila.estado, 'menu');
  assert.equal(naFila.emFila, true);

  // achou partida e esta entrando: ainda nao pode reiniciar
  const entrando = lerPresenca({
    matchPresenceData: { sessionLoopState: 'MENUS', matchMap: '' },
    partyPresenceData: { partyState: 'MATCHMADE_GAME_STARTING' },
  });
  assert.equal(entrando.emFila, true);

  // e em partida a fila nao esta mais em jogo
  const jogando = lerPresenca({
    matchPresenceData: { sessionLoopState: 'INGAME', matchMap: '/Game/Maps/Triad/Triad' },
    partyPresenceData: { partyState: 'DEFAULT' },
  });
  assert.equal(jogando.estado, 'jogando');
  assert.equal(jogando.emFila, false);
  assert.equal(jogando.mapa, 'Haven');
});

test('corretor de telas: cada verificacao dispara mesmo, numa tela quebrada de proposito', async () => {
  const { conferirTela } = await import('../scripts/conferir-tela.mjs');
  const { writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  /* POR QUE ISTO EXISTE: ao acrescentar a verificação de id repetido, ela nasceu como um
   * NO-OP — um caractere invisível entrou na expressão e ela nunca casava nada. O corretor
   * continuou dizendo "0 erros" com a maior cara de quem trabalhou, e eu só descobri porque
   * fui conferir contra uma tela quebrada de propósito.
   *
   * Corretor que ninguém confere apodrece calado — e este aqui é a trava 3 da publicação.
   * Então fica a tela quebrada, com um defeito de cada tipo, e a garantia de que cada um
   * deles continua sendo achado.
   *
   * O nome da classe morta é montado na hora, com o número do processo: o corretor procura
   * uso no PROJETO INTEIRO, e este arquivo de teste é parte do projeto — escrito por
   * extenso aqui, o nome se acharia usado por si mesmo e a verificação passaria à toa. */
  const morta = `zzMorta${process.pid}`;
  const arq = join(tmpdir(), `lolcoach-tela-quebrada-${process.pid}.html`);
  writeFileSync(arq, [
    '<!doctype html><html><head><style>',
    '.zzViva{color:red}',
    '.zzViva{color:blue}',
    `.${morta}{color:green}`,
    '</style></head><body>',
    '<div id="zzRepetido"></div>',
    '<div id="zzRepetido"></div>',
    '<div class="zzViva zzSemRegra"></div>',
    '<button onclick="zzNaoExiste()">x</button>',
    '<script>',
    'function zzOutra(){ }',
    "const a = document.querySelector('#zzNuncaCriado');",
    "document.body.style.color = 'var(--zz-nao-definida)';",
    `</${'script'}>`,
    '</body></html>',
  ].join('\n'), 'utf8');

  try {
    const { erros, avisos } = conferirTela(arq);
    const tem = (lista, pedaco) => lista.some((x) => x.includes(pedaco));
    assert.ok(tem(erros, 'zzNaoExiste()'), 'handler órfão');
    assert.ok(tem(erros, '#zzNuncaCriado'), 'id procurado que ninguém cria');
    assert.ok(tem(erros, '.zzViva aparece 2x'), 'duas regras brigando pela ordem do arquivo');
    assert.ok(tem(erros, 'id "zzRepetido" aparece 2x'), 'id repetido na mesma tela');
    assert.ok(tem(erros, '--zz-nao-definida'), 'variável de CSS que ninguém define');
    assert.ok(tem(avisos, '.zzSemRegra'), 'classe usada sem regra de CSS');
    assert.ok(tem(avisos, `.${morta}`), 'regra de CSS que ninguém usa');
  } finally {
    rmSync(arq, { force: true });
  }
});

test('registro: guarda contra enchente segura a repetida sem apagar informacao', async () => {
  const { guardaDeEnchente } = await import('../src/dados/sem-enchente.js');
  const g = guardaDeEnchente({ limite: 3, janela: 10 * 60 * 1000 });
  let t = 1_000_000;

  /* MEDIDO no registro dele: de 21.066 linhas, 18.009 (85%) eram DUAS mensagens se
   * alternando por causa de uma release quebrada. O registro gira com 2 MB, então essa
   * enchente empurrou semanas de histórico de verdade pra fora do arquivo. */

  // as primeiras passam; depois do limite, segura
  const r = [1, 2, 3, 4, 5].map(() => g.deixar('falhou de novo', t));
  assert.deepEqual(r.map((x) => x.escrever), [true, true, true, false, false]);
  // e avisa UMA vez que vai segurar, pra ninguém achar que a linha sumiu
  assert.equal(r[3].aviso !== null, true);
  assert.equal(r[4].aviso, null);

  // outra mensagem não é afetada pela primeira — o limite é POR mensagem
  assert.equal(g.deixar('outra coisa', t).escrever, true);

  /* E o caso que importa aqui: as duas se ALTERNAVAM. Juntar linha repetida seguida não
   * teria resolvido nada; o limite por mensagem resolve. */
  const alternado = [];
  for (let i = 0; i < 6; i++) {
    alternado.push(g.deixar('procurando atualização…', t).escrever);
    alternado.push(g.deixar('falhou de novo', t).escrever);
  }
  assert.equal(alternado.filter(Boolean).length <= 6, true);

  // passada a janela, a conta fecha dizendo quantas foram seguradas, e recomeça
  t += 11 * 60 * 1000;
  const depois = g.deixar('falhou de novo', t);
  assert.equal(depois.escrever, true);
  assert.match(depois.aviso ?? '', /repetiu mais \d+/);
});

test('tentar de novo: uma corrente so, espera que dobra, e registro que da pra ler', async () => {
  const { quandoTentarDeNovo } = await import('../src/dados/tentar-de-novo.js');
  const q = quandoTentarDeNovo({ minimo: 2, maximo: 16, avisarACada: 3 });

  /* O estrago que isto conserta foi MEDIDO no registro dele: a release v2.28.219 subiu
   * sem o `latest.yml`, e como cada falha agendava uma tentativa nova SEM cancelar a
   * anterior, as correntes se acumulavam — 36 pedidos por minuto ao GitHub, de 2 em 2
   * minutos, por 43 horas. 8.957 linhas de uma falha só, 43% do registro inteiro. */

  // a espera DOBRA a cada falha, até o teto, e não passa dele
  assert.deepEqual([2, 4, 8, 16, 16, 16].map(() => q.falhou('404').espera), [2, 4, 8, 16, 16, 16]);

  // deu certo uma vez: a próxima falha volta a esperar pouco
  q.deuCerto();
  assert.equal(q.falhou('404').espera, 2);

  // a MESMA falha não vira linha nova no registro toda vez; vira contagem
  const q2 = quandoTentarDeNovo({ minimo: 2, maximo: 16, avisarACada: 3 });
  const avisos = ['404', '404', '404', '404', '404', '404'].map((f) => q2.falhou(f));
  assert.deepEqual(avisos.map((a) => a.avisar), [true, false, true, false, false, true]);
  assert.deepEqual(avisos.map((a) => a.repetidas), [1, 2, 3, 4, 5, 6]);

  // falha DIFERENTE sempre aparece, e reinicia a contagem
  const q3 = quandoTentarDeNovo({ minimo: 2, maximo: 16, avisarACada: 3 });
  q3.falhou('404'); q3.falhou('404');
  const outra = q3.falhou('sem rede');
  assert.equal(outra.avisar, true);
  assert.equal(outra.mesma, false);
  assert.equal(outra.repetidas, 1);
});

test('ponto: plural nao separa, e apelido so vale se o nome oficial existe no mapa', async () => {
  const { pontoDaLineup } = await import('../src/valorant/lineups.js');
  const ascent = [
    { nome: 'A Site', regiao: 'Site', grande: 'A', site: 'A', x: 0.3, y: 0.3 },
    { nome: 'A Rafters', regiao: 'Rafters', grande: 'A', site: 'A', x: 0.35, y: 0.25 },
    { nome: 'Mid Catwalk', regiao: 'Catwalk', grande: 'Mid', site: null, x: 0.5, y: 0.5 },
    { nome: 'Mid Vent', regiao: 'Vent', grande: 'Mid', site: null, x: 0.55, y: 0.5 },
    { nome: 'A Ramps', regiao: 'Ramps', grande: 'A', site: 'A', x: 0.4, y: 0.4 },
    { nome: 'Defender Side Spawn', regiao: 'Spawn', grande: 'Defender Side', site: null, x: 0.1, y: 0.1 },
    { nome: 'Attacker Side Spawn', regiao: 'Spawn', grande: 'Attacker Side', site: null, x: 0.9, y: 0.9 },
  ];
  const onde = (nome, cs = ascent, site = null) => pontoDaLineup(nome, cs, site)?.nome ?? null;

  /* SINGULAR E PLURAL são a mesma coisa num nome de canto. Os canais escrevem "Mid Vents"
   * e "C Halls"; o catálogo da Riot diz "Mid Vent" e "C Hall". A régua passa nos dois
   * lados, então vale nas duas direções. */
  assert.equal(onde('smoke mid vents'), 'Mid Vent');
  assert.equal(onde('smoke a ramp'), 'A Ramps');
  // e "Defenders Spawn" (com s) passa a desempatar pela região grande, como "Defender"
  assert.equal(onde('Slow Orb Defenders Spawn'), 'Defender Side Spawn');

  /* APELIDO DE LUGAR: "Heaven" é o nome que todo mundo usa pro alto do site, e o catálogo
   * da Riot chama de "Rafters". Vale aqui porque o Ascent TEM Rafters. */
  assert.equal(onde('A Heaven molly'), 'A Rafters');
  assert.equal(onde('flash from cat'), 'Mid Catwalk');

  /* E a regra de ouro: num mapa SEM Rafters, "Heaven" continua sem ponto. Inventar um
   * lugar é pior que não ter — é exatamente a reclamação de "ponto aleatório". */
  const semRafters = [
    { nome: 'B Site', regiao: 'Site', grande: 'B', site: 'B', x: 0.7, y: 0.7 },
    { nome: 'B Tower', regiao: 'Tower', grande: 'B', site: 'B', x: 0.75, y: 0.6 },
  ];
  assert.equal(onde('B Heaven molly', semRafters), null);
  // e com site conhecido cai no centro do site, marcado como aproximado — nunca na Tower
  const comSite = pontoDaLineup('B Heaven molly', semRafters, 'B');
  assert.equal(comSite?.nome, 'B Site');
  assert.equal(comSite?.aproximado, true);
});

test('pontas: carimbo de canal sai da frente, e "from Spawn" se resolve pelo lado', async () => {
  const { pontasDaLineup } = await import('../src/valorant/lineups.js');
  const cs = [
    { nome: 'A Site', regiao: 'Site', grande: 'A', site: 'A', x: 0.3, y: 0.3 },
    { nome: 'A Main', regiao: 'Main', grande: 'A', site: 'A', x: 0.6, y: 0.6 },
    { nome: 'A Short', regiao: 'Short', grande: 'A', site: 'A', x: 0.5, y: 0.4 },
    { nome: 'C Long', regiao: 'Long', grande: 'C', site: 'C', x: 0.2, y: 0.7 },
    { nome: 'Defender Side Spawn', regiao: 'Spawn', grande: 'Defender Side', site: null, x: 0.1, y: 0.1 },
    { nome: 'Attacker Side Spawn', regiao: 'Spawn', grande: 'Attacker Side', site: null, x: 0.9, y: 0.9 },
  ];
  const ler = (nome, site = null, lado = null) => {
    const { alvo, posicao } = pontasDaLineup(nome, cs, site, lado);
    return [alvo?.nome ?? null, posicao?.nome ?? null];
  };

  /* O CARIMBO DO CANAL. "[Recon] A CT to A Main" não casava o spawn: o apelido de "CT" só
   * vale quando o texto inteiro é "CT", e com o carimbo colado na frente nunca era. */
  assert.deepEqual(ler('[Recon] A CT to A Main'), ['A Main', 'Defender Side Spawn']);
  assert.deepEqual(ler('[Def Eye] A Site from A Short'), ['A Site', 'A Short']);
  // o de dois pontos só sai quando o pedaço antes tem "/" ou "," — a assinatura do carimbo
  assert.deepEqual(ler('FLASH/drive: A Short to A Site'), ['A Site', 'A Short']);
  assert.deepEqual(ler('Defense, ZERO/point: A Short to A Site'), ['A Site', 'A Short']);
  /* E NÃO sai quando é carinha no meio do nome. Isto aqui é um caso real do acervo dele:
   * "...ever :D)" casava a regra antiga e levava o nome inteiro embora, e a lineup que caía
   * no C Long passava a cair no centro do site. */
  assert.deepEqual(ler('C Long Cubby 1 (Retake, craziest Brim lineup ever :D)', 'C')[0], 'C Long');
  // nome legítimo com dois pontos continua inteiro
  assert.deepEqual(ler('A Site: default from A Short'), ['A Site', 'A Short']);

  /* "from Spawn" sem dizer qual: casa a região "Spawn" nos dois e empata. O LADO resolve
   * sem adivinhar — quem ataca sai do spawn do atacante, e o spawn "inimigo" de quem
   * ataca é o do defensor. */
  assert.deepEqual(ler('A Site Flash from Spawn', 'A', 'atacando'), ['A Site', 'Attacker Side Spawn']);
  assert.deepEqual(ler('A Site Flash from Spawn', 'A', 'defendendo'), ['A Site', 'Defender Side Spawn']);
  assert.deepEqual(ler('A Site Flash from enemy spawn', 'A', 'atacando'), ['A Site', 'Defender Side Spawn']);
  // sem saber o lado continua empatado e sem ponto, que é a resposta honesta
  assert.deepEqual(ler('A Site Flash from Spawn', 'A'), ['A Site', null]);
});

test('pontas: seta, parêntese e CT viram lugar; e o alvo não rouba o lugar de saída', async () => {
  const { pontasDaLineup } = await import('../src/valorant/lineups.js');
  const cs = [
    { nome: 'A Site', regiao: 'Site', grande: 'A', site: 'A', x: 0.3, y: 0.3 },
    { nome: 'A Lobby', regiao: 'Lobby', grande: 'A', site: 'A', x: 0.8, y: 0.8 },
    { nome: 'B Long', regiao: 'Long', grande: 'B', site: 'B', x: 0.2, y: 0.7 },
    { nome: 'Defender Side Spawn', regiao: 'Spawn', grande: 'Defender Side', site: null, x: 0.1, y: 0.1 },
    { nome: 'Attacker Side Spawn', regiao: 'Spawn', grande: 'Attacker Side', site: null, x: 0.9, y: 0.9 },
    { nome: 'A Wine', regiao: 'Wine', grande: 'A', site: 'A', x: 0.4, y: 0.5 },
  ];
  const ler = (nome, site = null) => {
    const { alvo, posicao } = pontasDaLineup(nome, cs, site);
    return [alvo?.nome ?? null, posicao?.nome ?? null];
  };

  // a seta é o mesmo que "to": sai do A Lobby, cai no A Site
  assert.deepEqual(ler('A Lobby → A Site'), ['A Site', 'A Lobby']);
  assert.deepEqual(ler('A Lobby -> A Site'), ['A Site', 'A Lobby']);
  /* O parêntese era pior que não achar: a palavra entre parênteses não casava o separador,
   * o nome INTEIRO ia pro casamento de alvo, e a lineup aparecia caindo no lugar de onde
   * ela sai — o contrário do que ele quer ver no mapa. */
  assert.deepEqual(ler('A Site 4 Close Flash (From B Long)'), ['A Site', 'B Long']);
  // "CT" é o spawn do defensor pra qualquer canal; o catálogo da Riot só conhece o nome longo
  assert.deepEqual(ler('A Site Default from CT'), ['A Site', 'Defender Side Spawn']);
  assert.deepEqual(ler('A Site from T spawn'), ['A Site', 'Attacker Side Spawn']);
  // mas só quando o lugar INTEIRO é isso: "CT Wine" é outro lugar, não o spawn do defensor
  assert.deepEqual(ler('B default from CT Wine'), [null, 'A Wine']);
  /* E o alvo sai SÓ da metade do alvo. Lendo o nome inteiro de volta, "Single shock from
   * A Wine" virava uma lineup que CAI no A Wine, e a posição ainda era descartada por ser
   * igual ao alvo: o lugar de onde se joga virava o ponto de queda. */
  assert.deepEqual(ler('Single shock from A Wine'), [null, 'A Wine']);
  // sabendo o site, o que sobra é o centro do site, e marcado como aproximado
  const { alvo } = pontasDaLineup('Single shock from A Wine', cs, 'A');
  assert.equal(alvo?.nome, 'A Site');
  assert.equal(alvo?.aproximado, true, 'centro do site é palpite, e tem que se declarar');
});

/* 39,4% das lineups do acervo dele caem num ponto aproximado e 65,4% não dizem de onde se
 * joga. O nome do capítulo é tudo o que existe, então o ponto EXATO só pode vir dele. */
test('lado: "defend" conta, "defender" nao, e "rush" ficou de fora', async () => {
  const { ladoPeloTexto } = await import('../src/valorant/lineups.js');

  /* MEDIDO no acervo dele: 50 lineups diziam "defend" com todas as letras e ficavam sem
   * lado, porque a regra pedia sufixo (`defending`) ou um c/s depois de "defen". */
  assert.equal(ladoPeloTexto('Aggressive flashes to defend A site'), 'defendendo');
  assert.equal(ladoPeloTexto('Flash to help teammates defend B site while rotating'), 'defendendo');
  assert.equal(ladoPeloTexto('defends'), 'defendendo');
  assert.equal(ladoPeloTexto('defended'), 'defendendo');
  // e o que ja funcionava continua
  assert.equal(ladoPeloTexto('DEF A Main Slow Knife'), 'defendendo');
  assert.equal(ladoPeloTexto('A Site Defensive Molly'), 'defendendo');

  /* A ARMADILHA: o conserto obvio seria `defen[cds]\\w*`, que passa a casar "defendER" —
   * e quando ELE ataca, o defensor e o INIMIGO. Isto aqui e um caso real do acervo que
   * trocava de lado com o conserto ingenuo. */
  assert.equal(ladoPeloTexto('A Attack - Shock to clear defender utilities'), 'atacando');
  assert.equal(ladoPeloTexto('smoke to block defenders'), null);

  // entrar no site e ataque: `exec` abreviado e "take A/B/mid" entraram (+10, 0 trocadas)
  assert.equal(ladoPeloTexto('A Site Exec Knife Lineup'), 'atacando');
  assert.equal(ladoPeloTexto('Flash to take B main (op pixel angle)'), 'atacando');

  /* `rush` ficou de FORA de proposito: ganhava 2 e trocava o lado de 2, e eram as mesmas.
   * "Help Team at A Site Rush" tanto pode ser ajudar o time a rushar quanto cobrir um rush
   * inimigo. Palavra que nao decide nao entra. */
  assert.equal(ladoPeloTexto('A Site Rush'), null);
  // mas o anti-rush decide, e continua decidindo
  assert.equal(ladoPeloTexto('Molly anti-rush A main'), 'defendendo');
});

test('acervo: o pedido lido do nome do arquivo fecha o circulo', async () => {
  const { pedidoDoNome, chaveDaBusca } = await import('../src/valorant/lineups.js');
  const cat = {
    mapas: [{ nome: 'Ascent' }, { nome: 'Bind' }, { nome: 'Split' }],
    agentes: [{ nome: 'Fade' }, { nome: 'KAY/O' }, { nome: 'Kayo Teste' }],
  };
  const ler = (chave) => pedidoDoNome(chave, cat);

  /* As buscas salvas antes do acervo existir nao tem o campo `pedido`, e sem ele a
   * migracao automatica nao sabe o que pedir — eram 23 dos 72 arquivos dele, com ~2.000
   * lineups presas num formato antigo. O nome do arquivo tem tudo, mas PARTIR POR `__`
   * se perde: com a habilidade vazia (que vira `_`), `ascent__fade_____defendendo` daria
   * lado `_defendendo`, que nao e lado nenhum — e com o lado errado o nome recalculado da
   * outro arquivo, e a migracao nao acha o que ela mesma acabou de ler. */
  assert.deepEqual(ler('ascent__fade_____defendendo'),
    { mapa: 'Ascent', agente: 'Fade', habilidade: null, lado: 'defendendo' });

  // agente cujo slug tem `_` dentro (KAY/O vira kay_o) e habilidade com espaco
  assert.deepEqual(ler('ascent__kay_o__zero_point__atacando'),
    { mapa: 'Ascent', agente: 'KAY/O', habilidade: 'zero_point', lado: 'atacando' });

  // sem habilidade e sem lado
  assert.deepEqual(ler('ascent__fade______'),
    { mapa: 'Ascent', agente: 'Fade', habilidade: null, lado: null });

  // slug de um agente que COMECA o slug de outro: ganha o mais longo
  assert.equal(ler('bind__kayo_teste_____atacando')?.agente, 'Kayo Teste');

  // mapa que nao esta no catalogo nao vira palpite
  assert.equal(ler('mapaquenaoexiste__fade_____atacando'), null);

  /* E a prova que importa: o nome recalculado tem que dar o MESMO arquivo. Rodado tambem
   * contra os 72 arquivos reais do acervo dele: 72 de 72 fecham. */
  for (const chave of ['ascent__fade_____defendendo', 'ascent__kay_o__zero_point__atacando',
    'ascent__fade______', 'bind__kayo_teste_____atacando', 'split__fade_____atacando']) {
    assert.equal(chaveDaBusca(ler(chave)), chave, `nao fechou: ${chave}`);
  }
});

test('acervo: a migracao de fundo para na hora se ele entrar em partida', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-migrar-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    const buscas = resolve(base, 'dados', 'valorant', 'buscas');
    await mkdir(buscas, { recursive: true });
    const umArquivo = (nome, formato) => writeFile(resolve(buscas, nome), JSON.stringify({
      formato,
      pedido: { mapa: 'Bind', agente: 'Fade', habilidade: '', lado: 'atacando' },
      callouts: [{ nome: 'A Site', regiao: 'Site', grande: 'A', site: 'A', x: 0.3, y: 0.3 }],
      lineups: [{ video: 'abc', segundo: 1, nome: 'A Site molly' }],
    }), 'utf8');

    const L = await import(`../src/valorant/lineups.js?migrar=${Date.now()}`);

    /* A migracao de fundo le, reprocessa e grava 72 arquivos. Isso nao pode competir com
     * o jogo dele — e entrar em partida no meio tem que parar na hora, nao no fim. */
    await umArquivo('bind__fade_____atacando.json', 4);
    await umArquivo('ascent__fade_____atacando.json', 4);

    const emPartida = await L.migrarAcervo({ podeAgora: () => false, pausa: 0, log: () => {} });
    assert.equal(emPartida.migrados, 0, 'em partida nao migra nada');
    assert.equal(emPartida.parou, true, 'e diz que parou, pra tentar de novo depois');

    /* E arquivo que NAO e mais velho que o formato atual nao e tocado. Vale pros dois
     * lados: o que ja esta em dia (a migracao tem que ser barata de rodar a cada abertura)
     * e o que esta a FRENTE, que acontece quando ele volta uma versao — o migrador nao
     * sabe ler, devolveria null, e viraria tentativa frustrada pra sempre. */
    const novo = await import(`../src/valorant/lineups.js?migrar2=${Date.now()}`);
    await umArquivo('bind__fade_____atacando.json', 999);
    await umArquivo('ascent__fade_____atacando.json', 999);
    let falou = 0;
    const nadaAFazer = await novo.migrarAcervo({ podeAgora: () => true, pausa: 0, log: () => { falou++; } });
    assert.equal(nadaAFazer.migrados, 0);
    assert.equal(falou, 0, 'sem nada atrasado, nao escreve nada no registro');
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

test('confirmar: "eu fiz essa" sobrevive a busca, e nao se perde ao apagar o ponto', async () => {
  const { mkdtemp, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-confirmar-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    await mkdir(resolve(base, 'dados', 'valorant'), { recursive: true });
    const L = await import(`../src/valorant/lineups.js?confirmar=${Date.now()}`);
    const busca = () => ({
      callouts: [{ nome: 'A Lobby', regiao: 'Lobby', grande: 'A', x: 0.8, y: 0.8 }],
      lineups: [{ video: 'abc', segundo: 12, nome: 'A Site', ponto: { nome: 'A Site', x: 0.3, y: 0.3, aproximado: true } }],
    });

    /* Ideia dele: testar as lineups no jogo. Dirigir o Valorant esta fora (tecla ou clique
     * sintetico e o que o Vanguard bane), mas treinar no personalizado e marcar a que deu
     * certo e a parte que vale: e a unica informacao do acervo que nao saiu de um video. */
    assert.equal((await L.comMeusPontos(busca())).lineups[0].confirmei, undefined, 'sem confirmar, nada muda');

    await L.confirmarLineup({ video: 'abc', segundo: 12 });
    const depois = await L.comMeusPontos(busca());
    assert.ok(depois.lineups[0].confirmei, 'a confirmacao volta na busca seguinte');
    assert.equal(await L.quantasConfirmadas(), 1);

    // marcar um ponto na MESMA lineup nao atrapalha a confirmacao
    await L.marcarPonto({ video: 'abc', segundo: 12, qual: 'posicao', x: 0.5, y: 0.5 });
    const comPonto = await L.comMeusPontos(busca());
    assert.ok(comPonto.lineups[0].confirmei, 'marcar ponto nao apaga a confirmacao');
    assert.equal(comPonto.lineups[0].posicao?.meu, true);

    // e apagar o ponto TAMBEM nao: sao duas coisas diferentes
    await L.esquecerPonto({ video: 'abc', segundo: 12, qual: 'posicao' });
    const semPonto = await L.comMeusPontos(busca());
    assert.ok(semPonto.lineups[0].confirmei, 'apagar o ponto nao leva a confirmacao junto');
    assert.equal(semPonto.lineups[0].posicao, undefined);

    // nem apagar a lineup inteira do arquivo de pontos
    await L.marcarPonto({ video: 'abc', segundo: 12, qual: 'alvo', x: 0.2, y: 0.2 });
    await L.esquecerPonto({ video: 'abc', segundo: 12 });
    assert.equal(await L.quantasConfirmadas(), 1, 'a confirmacao fica mesmo apagando os dois pontos');

    // e tirar a confirmacao tira so ela
    await L.confirmarLineup({ video: 'abc', segundo: 12, confirmada: false });
    assert.equal(await L.quantasConfirmadas(), 0);
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

test('ponto marcado por ele ganha do que foi deduzido do nome, e sobrevive à busca', async () => {
  const { mkdtemp, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-ponto-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    await mkdir(resolve(base, 'dados', 'valorant'), { recursive: true });
    const L = await import(`../src/valorant/lineups.js?ponto=${Date.now()}`);
    const busca = () => ({
      callouts: [{ nome: 'A Lobby', regiao: 'Lobby', grande: 'A', x: 0.8, y: 0.8 }],
      lineups: [{ video: 'abc', segundo: 12, nome: 'A Site', ponto: { nome: 'A Site', x: 0.3, y: 0.3, aproximado: true }, posicao: null }],
    });

    assert.equal((await L.comMeusPontos(busca())).lineups[0].posicao, null, 'sem marca, nada muda');

    await L.marcarPonto({ video: 'abc', segundo: 12, qual: 'posicao', x: 0.77, y: 0.81 });
    const r = await L.comMeusPontos(busca());
    assert.equal(r.lineups[0].posicao?.x, 0.77);
    assert.equal(r.lineups[0].posicao?.meu, true);
    assert.equal(r.lineups[0].posicao?.nome, 'A Lobby', 'o nome vem do callout mais perto');

    // o alvo também, e deixa de ser aproximado
    await L.marcarPonto({ video: 'abc', segundo: 12, qual: 'alvo', x: 0.31, y: 0.34 });
    const r2 = await L.comMeusPontos(busca());
    assert.equal(r2.lineups[0].ponto.y, 0.34);
    assert.equal(r2.lineups[0].ponto.aproximado, false);

    // fora do mapa não existe: 0..1 e ponto final
    await L.marcarPonto({ video: 'abc', segundo: 12, qual: 'posicao', x: 9, y: -3 });
    const r3 = await L.comMeusPontos(busca());
    assert.deepEqual([r3.lineups[0].posicao.x, r3.lineups[0].posicao.y], [1, 0]);

    // apagar uma ponta deixa a outra de pé
    await L.esquecerPonto({ video: 'abc', segundo: 12, qual: 'posicao' });
    const r4 = await L.comMeusPontos(busca());
    assert.equal(r4.lineups[0].posicao, null);
    assert.equal(r4.lineups[0].ponto.meu, true);
    assert.equal(await L.quantosPontosMeus(), 1);

    await L.esquecerPonto({ video: 'abc', segundo: 12 });
    assert.equal(await L.quantosPontosMeus(), 0);

    assert.ok((await L.marcarPonto({ video: 'abc', segundo: 12, qual: 'chute', x: 0.5, y: 0.5 })).erro);
    assert.ok((await L.marcarPonto({ video: '', segundo: 12, qual: 'alvo', x: 0.5, y: 0.5 })).erro);
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

/* A primeira versão media distância até os dois spawns, e media errado: "A Main to A Site"
 * no Pearl fica mais perto do spawn do defensor e virava defesa; no Fracture o atacante
 * nasce dos dois lados e a conta não quer dizer nada. Território em vez de distância. */
test('lado: o lugar de onde se joga só decide quando é de um lado só', async () => {
  const { ladoPeloLugar, juntarLado } = await import('../src/valorant/lineups.js');
  const callouts = [
    { nome: 'Attacker Side Spawn', grande: 'Attacker Side', regiao: 'Spawn', x: 0.82, y: 0.57 },
    { nome: 'Defender Side Spawn', grande: 'Defender Side', regiao: 'Spawn', x: 0.13, y: 0.43 },
    { nome: 'A Lobby', grande: 'A', regiao: 'Lobby', x: 0.75, y: 0.3 },
    { nome: 'A Main', grande: 'A', regiao: 'Main', x: 0.5, y: 0.3 },
    { nome: 'A Site', grande: 'A', regiao: 'Site', x: 0.3, y: 0.2 },
  ];
  assert.equal(ladoPeloLugar({ nome: 'Attacker Side Spawn' }, callouts), 'atacando');
  assert.equal(ladoPeloLugar({ nome: 'Defender Side Spawn' }, callouts), 'defendendo');
  // lobby é de onde o atacante sai: todo mapa tem o do atacante, nenhum tem o do defensor
  assert.equal(ladoPeloLugar({ nome: 'A Lobby' }, callouts), 'atacando');
  // caminho é dos dois: quem entra passa, quem segura espera
  assert.equal(ladoPeloLugar({ nome: 'A Main' }, callouts), null);
  assert.equal(ladoPeloLugar({ nome: 'A Site' }, callouts), null);
  assert.equal(ladoPeloLugar(null, callouts), null);

  // a ordem: o que o capítulo DIZ ganha do lugar; o lugar ganha da seção e do título
  assert.deepEqual(juntarLado({ lado: 'defendendo', pista: 'nome' }, { nome: 'A Lobby' }, callouts),
    { lado: 'defendendo', pista: 'nome' });
  assert.deepEqual(juntarLado({ lado: 'defendendo', pista: 'bloco' }, { nome: 'A Lobby' }, callouts),
    { lado: 'atacando', pista: 'lugar' });
  assert.deepEqual(juntarLado({ lado: 'atacando', pista: 'video' }, { nome: 'A Main' }, callouts),
    { lado: 'atacando', pista: 'video' });
  assert.deepEqual(juntarLado({ lado: null, pista: null }, { nome: 'A Main' }, callouts),
    { lado: null, pista: null });
});

/* "lineup de fade apareceu uma do sova, deve ter varios assim tbm". Tem: 135 das 6245 do
 * acervo dele — 99 de vídeo que não é do agente pedido (a busca do YouTube devolve "Sunset
 * Sova Lineups" numa procura por Fade) e 36 de capítulo de outro agente dentro de vídeo de
 * dois ("Sova&KAY/O Lineup Guide", com blocos de Gekko, Killjoy e Tejo no meio). */
test('agente: capítulo e vídeo de outro agente ficam de fora', async () => {
  const { capitulosDesteAgente, agentesNoNome } = await import('../src/valorant/lineups.js');
  const nomes = ['Fade', 'Sova', 'KAY/O', 'Gekko', 'Killjoy', 'Tejo', 'Brimstone'];

  // o canal escreve KAY/O de três jeitos
  for (const jeito of ['KAYO Lineups Split', 'Sova&KAY/O Lineup Guide', 'KAY O lineups']) {
    assert.ok(agentesNoNome(jeito, nomes).includes('KAY/O'), jeito);
  }
  assert.deepEqual(agentesNoNome('Sova&KAY/O Lineup Guide', nomes), ['Sova', 'KAY/O'], 'na ordem em que aparecem');
  assert.deepEqual(agentesNoNome('A Site Haunt 01', nomes), []);

  // vídeo de dois agentes, com bloco de cada um: fica só o bloco dele
  const caps = [
    { nome: 'Gekko - A molly' }, { nome: 'Killjoy - A molly' },
    { nome: 'Sova - A shocks' }, { nome: 'Tejo explanation' },
    { nome: 'KAY/O - A molly' }, { nome: 'Mid molly' },
  ];
  assert.deepEqual(capitulosDesteAgente(caps, 'Sova&KAY/O Lineup Guide - ALL Closing Doors on Summit', 'KAY/O', nomes),
    [false, false, false, false, true, true], 'o capítulo calado herda o último agente dito');

  // vídeo que não é dele de jeito nenhum: não entra nada
  const outro = [{ nome: 'Fast A Elbow Reveal' }, { nome: 'A Main Reveal' }];
  assert.deepEqual(capitulosDesteAgente(outro, 'Sunset Sova Lineups – VALORANT 2026 *NEW*', 'Fade', nomes),
    [false, false]);
  // e o vídeo dele fica inteiro, mesmo sem nenhum capítulo dizer o nome
  assert.deepEqual(capitulosDesteAgente(outro, 'Fade Lineups Sunset - Valorant Guide', 'Fade', nomes),
    [true, true]);
  // sem catálogo de agente não dá pra afirmar nada: fica tudo
  assert.deepEqual(capitulosDesteAgente(outro, 'Sunset Sova Lineups', 'Fade', []), [true, true]);
});

test('lado: busca já salva ganha o lado sem tocar na rede', async () => {
  const { mkdtemp, mkdir, writeFile, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');

  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-lado-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    const val = resolve(base, 'dados', 'valorant');
    await mkdir(resolve(val, 'buscas'), { recursive: true });
    await writeFile(resolve(val, 'catalogo.json'), JSON.stringify({
      em: Date.now(), formato: 4,
      mapas: [{ nome: 'Ascent', planta: null, callouts: [
        { nome: 'Attacker Side Spawn', grande: 'Attacker Side', regiao: 'Spawn', x: 0.82, y: 0.57 },
        { nome: 'Defender Side Spawn', grande: 'Defender Side', regiao: 'Spawn', x: 0.13, y: 0.43 },
        { nome: 'A Lobby', grande: 'A', regiao: 'Lobby', site: 'A', x: 0.75, y: 0.62 },
      ] }],
      agentes: [{ nome: 'Sova', icone: null, habilidades: [] }, { nome: 'Fade', icone: null, habilidades: [] }],
    }), 'utf8');

    const ontem = Date.now() - 24 * 60 * 60 * 1000;
    const l = (nome, seg, pos) => ({ video: 'v1', titulo: 'Sova Ascent Lineups', nome, segundo: seg, fim: seg + 20, posicao: pos ?? null });
    await writeFile(resolve(val, 'buscas', 'ascent__sova_____atacando.json'), JSON.stringify({
      formato: 4, em: ontem, lidos: 18,
      pedido: { mapa: 'Ascent', agente: 'Sova', habilidade: null, lado: 'atacando' },
      lineups: [
        l('Attacking', 10), l('A Site Dart', 20),
        l('Defense', 30), l('A Main Dart', 40),
        // esta diz de onde se joga: o A Lobby, que é lugar de atacante
        l('Mid Dart from A Lobby', 50),
        l('Fade Haunt A Site', 60),
      ],
    }), 'utf8');

    const { buscaGuardada } = await import(`../src/valorant/lineups.js?lado=${Date.now()}`);
    const g = await buscaGuardada({ mapa: 'Ascent', agente: 'Sova', lado: 'atacando' });
    assert.ok(g, 'o arquivo do formato 4 tinha que ser aproveitado');
    assert.deepEqual(g.lineups.map((x) => [x.nome, x.lado, x.ladoPista]), [
      ['Attacking', 'atacando', 'nome'],
      ['A Site Dart', 'atacando', 'bloco'],
      ['Defense', 'defendendo', 'nome'],
      ['A Main Dart', 'defendendo', 'bloco'],
      // esta herdaria defesa da seção, mas se joga do A Lobby, que é de atacante: o lugar
      // é fato, a seção é dedução, então o lugar manda
      ['Mid Dart from A Lobby', 'atacando', 'lugar'],
      // e a do Fade saiu: busca de Sova não mostra lineup de Fade
    ]);
    // e a migração releu as duas pontas do nome: o lugar saiu do arquivo, não de palpite
    assert.equal(g.lineups[4].posicao?.nome, 'A Lobby', 'o lugar tinha que ser lido do nome');
    assert.equal(g.em, ontem, 'a data original não pode virar "agora"');
    const salvo = JSON.parse(await readFile(resolve(val, 'buscas', 'ascent__sova_____atacando.json'), 'utf8'));
    assert.ok(salvo.formato >= 7, 'o lado tem que ficar gravado, não ser recalculado toda vez');
    assert.equal(salvo.lineups[1].lado, 'atacando');
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
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
    partyPresenceData: { partyOwnerSessionLoopState: 'INGAME', partyOwnerMatchMap: '/Game/Maps/Rook/Rook' },
  });
  assert.equal(r.estado, 'jogando');
  assert.equal(r.mapa, 'Corrode');
});

/* O mapa dele vinha errado, e errado do pior jeito: em vez de "não sei", o app dizia o nome
 * de OUTRO mapa e buscava lineup dele. Três erros na tabela à mão que traduzia o caminho
 * interno do jogo, todos conferidos contra a lista oficial do valorant-api. */
test('mapa: Corrode não é Summit, Summit existe, e Deathmatch não é mapa de lineup', async () => {
  const { mapaPeloCaminho } = await import('../src/valorant/jogo.js');
  // 1. /Game/Maps/Rook/Rook é Corrode. A tabela dizia Summit: jogando Corrode ele via Summit.
  assert.equal(mapaPeloCaminho('/Game/Maps/Rook/Rook'), 'Corrode');
  // 2. Summit é `plummet`, e não estava na tabela: jogando Summit, não achava mapa nenhum.
  assert.equal(mapaPeloCaminho('/Game/Maps/Plummet/Plummet'), 'Summit');
  // 3. HURM é o prefixo dos mapas de Deathmatch, e a tabela traduzia isso como Corrode.
  //    Pior: a busca era por pedaço de caminho, então casava em qualquer posição.
  for (const m of ['HURM_Alley', 'HURM_Bowl', 'HURM_Helix', 'HURM_HighTide', 'HURM_Yard']) {
    assert.equal(mapaPeloCaminho(`/Game/Maps/HURM/${m}/${m}`), null, `${m} não é mapa de lineup`);
  }
  // Range e os modos avulsos também não são
  assert.equal(mapaPeloCaminho('/Game/Maps/Poveglia/Range'), null);
  assert.equal(mapaPeloCaminho('/Game/Maps/AbilityDraft/AbilityDraft'), null);
  // e o resto da tabela continua de pé
  assert.equal(mapaPeloCaminho('/Game/Maps/Triad/Triad'), 'Haven');
  assert.equal(mapaPeloCaminho('/Game/Maps/Duality/Duality'), 'Bind');
  assert.equal(mapaPeloCaminho(''), null);
  assert.equal(mapaPeloCaminho(null), null);
});

test('mapa: o catálogo manda mais que a tabela à mão', async () => {
  const { mapaPeloCaminho } = await import('../src/valorant/jogo.js');
  // é o catálogo (valorant-api, por patch) que carrega o caminho interno de cada mapa:
  // mapa novo passa a ser reconhecido sem ninguém precisar atualizar o app
  const mapas = [
    { nome: 'Corrode', caminho: '/Game/Maps/Rook/Rook' },
    { nome: 'MapaNovo', caminho: '/Game/Maps/Codinome/Codinome' },
  ];
  assert.equal(mapaPeloCaminho('/Game/Maps/Codinome/Codinome', mapas), 'MapaNovo');
  assert.equal(mapaPeloCaminho('/Game/Maps/Rook/Rook', mapas), 'Corrode');
  // com catálogo em mãos, caminho que não casa com mapa de partida é null de propósito
  assert.equal(mapaPeloCaminho('/Game/Maps/HURM/HURM_Yard/HURM_Yard', mapas), null);
  // catálogo velho, sem o caminho: cai na tabela em vez de ficar sem mapa
  assert.equal(mapaPeloCaminho('/Game/Maps/Triad/Triad', [{ nome: 'Haven' }]), 'Haven');
});

/* Amigo que convida pro grupo no meio de uma partida publica o mapa DELE em
 * partyOwnerMatchMap. Gabriel está no menu, e a aba de lineups trocava pro mapa do amigo. */
test('mapa: o do dono do grupo só vale quando o estado também é dele', async () => {
  const { lerPresenca } = await import('../src/valorant/jogo.js');
  const r = lerPresenca({
    matchPresenceData: { sessionLoopState: 'MENUS', matchMap: '' },
    partyPresenceData: { partyOwnerSessionLoopState: 'INGAME', partyOwnerMatchMap: '/Game/Maps/Juliett/Juliett' },
  });
  assert.equal(r.estado, 'menu', 'o estado é o DELE: menu');
  assert.equal(r.mapa, null, 'no menu não existe mapa — e o do amigo não é o dele');
  // e no menu não sobra mapa de partida que acabou
  const s = lerPresenca({ matchPresenceData: { sessionLoopState: 'MENUS', matchMap: '/Game/Maps/Ascent/Ascent' } });
  assert.equal(s.mapa, null);
});

/* ------------------------------------------------------------------ Valorant: de quem é
 *
 * O mapa dele trocou no meio de uma partida — estava numa Haven e virou Sunset. A causa:
 * /chat/v4/presences devolve a dele E a de cada amigo online, e o código pegava a primeira
 * de Valorant que aparecesse. A ordem da lista muda sozinha, então a partida de um amigo
 * virava a partida dele. Conferido na máquina dele: a primeira presença com blob é de um
 * amigo. Isto trava o conserto. */
test('presença: pega a dele, não a do amigo que vier primeiro', async () => {
  const { presencaDele } = await import('../src/valorant/jogo.js');
  const blob = (m) => Buffer.from(JSON.stringify({ matchPresenceData: { matchMap: m } })).toString('base64');
  const lista = { presences: [
    { product: 'league_of_legends', puuid: 'amigo-1', private: blob('') },
    { product: 'valorant', puuid: 'amigo-2', private: blob('/Game/Maps/Juliett/Juliett') },  // Sunset
    { product: 'riot_client', puuid: 'eu', private: null },
    { product: 'valorant', puuid: 'eu', private: blob('/Game/Maps/Triad/Triad') },          // Haven
  ] };

  const minha = presencaDele(lista, 'eu');
  assert.equal(minha?.puuid, 'eu', 'tem que ser a dele, mesmo vindo depois');

  const { lerPresenca } = await import('../src/valorant/jogo.js');
  const lido = lerPresenca(JSON.parse(Buffer.from(minha.private, 'base64').toString('utf8')));
  assert.equal(lido.mapa, 'Haven', 'o mapa é o DELE, não o do amigo');

  // sem saber quem eu sou: uma candidata serve, duas não — chutar é o que causava o bug
  const so = { presences: [lista.presences[1]] };
  assert.equal(presencaDele(so, null)?.puuid, 'amigo-2', 'candidata única pode');
  assert.equal(presencaDele(lista, null), null, 'com duas, não chuta');
  assert.equal(presencaDele(lista, 'ninguem'), null, 'não é pra inventar presença');
  assert.equal(presencaDele(null, 'eu'), null);
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
    assert.ok(salvo.formato >= 5, 'o arquivo tinha que subir de formato no disco');

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
/* A tabela à mão de codinome→mapa dentro de jogo.js envelheceu e passou a apontar Corrode
 * como Summit. Ela só é usada quando o catálogo não chegou, mas é justo aí que ninguém olha.
 * Este teste confere a tabela contra o catálogo de verdade: se a Riot lançar mapa novo ou eu
 * digitar errado, cai aqui em vez de cair no meio de uma partida dele. */
test('mapa: a tabela de reserva concorda com a lista oficial', async (t) => {
  const { mapaPeloCaminho } = await import('../src/valorant/jogo.js');
  let dados;
  try {
    const r = await fetch('https://valorant-api.com/v1/maps?language=en-US', { signal: AbortSignal.timeout(12000) });
    dados = r.ok ? (await r.json()).data : null;
  } catch { /* sem internet */ }
  if (!dados?.length) return t.skip('sem internet pra conferir a lista oficial');

  // mapa de partida é o que tem tacticalDescription — o mesmo filtro que o catálogo usa
  const errados = [];
  for (const m of dados.filter((x) => x.displayName && x.tacticalDescription && x.mapUrl)) {
    const daTabela = mapaPeloCaminho(m.mapUrl);     // sem catálogo: força a tabela
    if (daTabela !== m.displayName) errados.push(`${m.mapUrl} → tabela diz ${daTabela ?? 'nada'}, a Riot diz ${m.displayName}`);
  }
  assert.deepEqual(errados, [], 'tabela de reserva desencontrada da lista oficial');

  // e o contrário: o que NÃO é mapa de partida não pode virar mapa de lineup
  const inventados = dados.filter((x) => !x.tacticalDescription && x.mapUrl && mapaPeloCaminho(x.mapUrl))
    .map((x) => `${x.mapUrl} virou ${mapaPeloCaminho(x.mapUrl)}`);
  assert.deepEqual(inventados, [], 'Deathmatch e Range não são mapa de lineup');
});

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

/* ------------------------------------------------------- o ponto que ELE marcou
 *
 * Duas queixas dele no mesmo dia, e as duas eram a mesma conta: "n ficava exatamente onde
 * eu colocava" e "várias q iam pro mesmo lugar e jogavam do mesmo lugar, mas no mapa
 * estavam em lugares diferentes".
 *
 * O desempilhador afasta marcadores pra um não cobrir o outro. Pra ponto DEDUZIDO do
 * título do vídeo isso está certo — é palpite, e palpite empilhado não dá pra clicar. Pra
 * ponto que ele marcou a mão é errado: ele foi lá e pôs o tijolo. No acervo dele o desenho
 * arrastava as 20 marcas, em média 7,5 m e a pior a 16,6 m do lugar clicado.
 *
 * O teste tira as funções de dentro da tela (elas moram no painel.html, inline) justamente
 * pra não depender de alguém lembrar de abrir o navegador e medir de novo.
 */
const CERCADO_DO_MAPA = `
  const JANELA = { x0: 0.05, y0: 0.05, lx: 0.9, ly: 0.9 };
  const lnJanelaDoMapa = () => JANELA;
  const lnLarguraCrua = () => JANELA.lx;
  const LN_LONGE = 0.090, LN_LONGE_PINO = 0.078;
  const longe = (f) => Math.max(0.015, lnLarguraCrua() * f);
`;

test('lineups: o ponto que ele marcou a mão fica exatamente onde ele clicou', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');
  const { lnDesempilhar, lnAfastar } = await funcoesDaTela(
    'painel.html', ['lnPrender', 'lnDesencalhar', 'lnDesempilhar', 'lnAfastar'], CERCADO_DO_MAPA);

  const pino = { x: 0.5, y: 0.45 };
  const p = { x: 0.62, y: 0.52 };
  const dist = (a, b) => Math.hypot(a.dx - b.x, a.dy - b.y);
  const SEPARACAO = Math.max(0.015, 0.9 * 0.090);

  // duas marcas dele no MESMO ponto: as duas ficam lá. Ele avisou que pode precisar pôr
  // uma lineup em cima da outra — duas saindo do mesmo tijolo é fato, não defeito.
  const r = lnDesempilhar([
    { fixo: true, de: { ...p } },
    { fixo: true, de: { ...p } },
    { fixo: false, de: { ...p } },
  ], pino, []);
  assert.equal(dist(r[0], p), 0, 'a marca dele não se mexe');
  assert.equal(dist(r[1], p), 0, 'nem a segunda, empilhada na primeira');
  assert.ok(dist(r[2], p) >= SEPARACAO * 0.99, 'o deduzido é que sai da frente, inteiro');

  // e nem por estar em cima do próprio pino: o pino é a área, a marca é o tijolo dentro dela
  const emCima = lnDesempilhar([{ fixo: true, de: { ...pino } }], pino, []);
  assert.equal(dist(emCima[0], pino), 0, 'marca em cima do pino continua em cima do pino');

  // os deduzidos continuam se afastando — senão viram um retrato só, inclicável
  const juntos = lnDesempilhar(
    Array.from({ length: 8 }, (_, i) => ({ fixo: false, de: { x: 0.55 + i * 0.002, y: 0.5 } })), pino, []);
  let menor = Infinity;
  for (let i = 0; i < juntos.length; i++) {
    for (let j = i + 1; j < juntos.length; j++) {
      menor = Math.min(menor, Math.hypot(juntos[i].dx - juntos[j].dx, juntos[i].dy - juntos[j].dy));
    }
  }
  assert.ok(menor >= SEPARACAO * 0.95, `deduzidos empilhados: ${menor.toFixed(4)} < ${SEPARACAO.toFixed(4)}`);

  // o mesmo vale pro outro lado do mapa: o pino de ONDE CAI passa pelo lnAfastar
  const pinos = lnAfastar([
    { fixo: true, x: 0.62, y: 0.52 },
    { fixo: true, x: 0.62, y: 0.52 },
    { fixo: false, x: 0.62, y: 0.52 },
  ], SEPARACAO);
  assert.equal(dist(pinos[0], p), 0, 'pino marcado por ele também não se mexe');
  assert.equal(dist(pinos[1], p), 0);
  assert.ok(dist(pinos[2], p) >= SEPARACAO * 0.99, 'o pino deduzido é que cede');

  // na beirada, onde a correção anterior tinha falhado: prender na janela não pode arrastar
  const naBorda = { x: 0.051, y: 0.051 };
  const beira = lnDesempilhar([{ fixo: true, de: { ...naBorda } }], { x: 0.05, y: 0.05 }, []);
  assert.equal(dist(beira[0], naBorda), 0, 'marca na beirada fica na beirada');
});

test('lineups: apagar a marca devolve o que o vídeo dizia, não um buraco', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');

  /* A tela guarda o clipe aberto numa variável solta e fala com o servidor por fetch.
   * Aqui os dois viram cenário: o que está sob teste é só o que acontece com `l.posicao` e
   * `l.ponto` entre marcar e apagar. */
  const cercado = `
    let lnClipe = null, lnMarcando = null, lnPlanta = '';
    const lnCallouts = [{ nome: 'A Lobby', x: 0.2, y: 0.2 }, { nome: 'A Main', x: 0.8, y: 0.8 }];
    const lnCalloutPerto = (p) => lnCallouts
      .map((c) => ({ c, d: Math.hypot(c.x - p.x, c.y - p.y) }))
      .sort((a, b) => a.d - b.d)[0].c;
    const lnRecorteEm = (p, lado) => ({ x: p.x - lado / 2, y: p.y - lado / 2, lado });
    const fetch = () => ({ catch: () => {} });
    const lnPintarLado = () => {}, lnDesenharMapa = () => {}, lnPintarResumo = () => {};
    const extras = {
      abrir: (l) => { lnClipe = l; },
      clicar: (qual, x, y) => {
        lnMarcando = { qual, passo: 2, r: { x: 0, y: 0, lado: 1 } };
        lnCliqueNoMapinha({ clientX: x * 100, clientY: y * 100,
          currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } });
      },
    };
  `;
  const t = await funcoesDaTela('painel.html', ['lnCliqueNoMapinha', 'lnEsquecerMeuPonto'], cercado);

  // 1. o vídeo DIZIA de onde se joga: apagar a marca devolve aquilo, não null
  const comLugar = { video: 'v', segundo: 1, posicao: { nome: 'A Lobby', x: 0.2, y: 0.2, aproximado: false } };
  t.abrir(comLugar);
  t.clicar('posicao', 0.7, 0.7);
  assert.equal(comLugar.posicao.meu, true, 'marcou');
  t.lnEsquecerMeuPonto('posicao');
  assert.equal(comLugar.posicao?.nome, 'A Lobby', 'o que o vídeo dizia volta');
  assert.ok(!comLugar.posicao.meu, 'e volta como dedução, não como marca dele');

  // 2. o vídeo NÃO dizia: apagar deixa vazio de novo — null é uma resposta, não um erro
  const semLugar = { video: 'v', segundo: 2, posicao: null };
  t.abrir(semLugar);
  t.clicar('posicao', 0.3, 0.3);
  assert.equal(semLugar.posicao.meu, true);
  t.lnEsquecerMeuPonto('posicao');
  assert.equal(semLugar.posicao, null, 'sem dedução, continua sem — não inventa');

  // 3. alvo EXATO lido do callout não pode voltar rebaixado a "aproximado"
  const exato = { video: 'v', segundo: 3, ponto: { nome: 'A Main', x: 0.8, y: 0.8, aproximado: false } };
  t.abrir(exato);
  t.clicar('alvo', 0.1, 0.1);
  assert.equal(exato.ponto.meu, true);
  t.lnEsquecerMeuPonto('alvo');
  assert.equal(exato.ponto.nome, 'A Main');
  assert.equal(exato.ponto.aproximado, false, 'alvo exato não vira palpite ao apagar a marca');
  assert.ok(!exato.ponto.meu);

  // 4. marcar DUAS vezes e apagar ainda devolve o original, não a marca do meio
  const duas = { video: 'v', segundo: 4, posicao: { nome: 'A Lobby', x: 0.2, y: 0.2, aproximado: true } };
  t.abrir(duas);
  t.clicar('posicao', 0.6, 0.6);
  t.clicar('posicao', 0.9, 0.9);
  t.lnEsquecerMeuPonto('posicao');
  assert.equal(duas.posicao?.nome, 'A Lobby');
  assert.equal(duas.posicao.aproximado, true, 'o "aproximado" original também volta');
});

test('lineups: dois alvos marcados no mesmo tijolo viram um pino, não um pino sem clique', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');

  /* Marca dele ganha pino próprio de propósito — o callout é a área, a marca é o tijolo.
   * Só que desde que pino marcado a mão parou de ser empurrado (2.28.285), dois tijolos
   * vizinhos se cobrem e o de baixo fica sem clique. No acervo dele apareceu no mesmo dia:
   * "Site B Haunt 01" e "Lotus Attack - B Site", alvos a 0,9 m um do outro. */
  const cercado = `
    let lnAchadas = [];
    const lnLarguraCrua = () => 0.9;
    const LN_LONGE_PINO = 0.078;
    const longe = (f) => Math.max(0.015, lnLarguraCrua() * f);
    const extras = { pôr: (ls) => { lnAchadas = ls; }, pino: () => longe(LN_LONGE_PINO) };
  `;
  const t = await funcoesDaTela('painel.html', ['lnPinos'], cercado);
  const pino = t.pino();   // a largura do próprio desenho do pino

  const marcado = (nome, x, y, i) => ({
    video: 'v', segundo: i, nome: `lineup ${i}`,
    ponto: { nome, x, y, aproximado: false, meu: true },
  });

  // 1. dois alvos marcados colados viram UM pino com as duas lineups
  t.pôr([marcado('B Site', 0.560, 0.443, 1), marcado('A Link', 0.567, 0.447, 2)]);
  let p = t.lnPinos();
  assert.equal(p.length, 1, 'dois tijolos vizinhos marcados a mão são um pino só');
  assert.equal(p[0].lista.length, 2, 'e o leque abre as duas');
  assert.equal(p[0].meu, true);

  // 2. marcados LONGE continuam separados — juntar seria jogar fora a precisão dele
  t.pôr([marcado('B Site', 0.20, 0.20, 1), marcado('A Site', 0.80, 0.80, 2)]);
  assert.equal(t.lnPinos().length, 2, 'marcas distantes seguem sendo pinos distintos');

  /* 3. o corte é o CÍRCULO INTEIRO, não meio. Começou em meio pino (só o que ficava sem
   *    clique) e ele disse que faltava: "ta ficando um circulo em cima do outro". Dois
   *    desenhos que se encostam ele não distingue, então valem mais como um pino só. */
  t.pôr([marcado('B Site', 0.5, 0.5, 1), marcado('A Link', 0.5 + pino * 0.8, 0.5, 2)]);
  assert.equal(t.lnPinos().length, 1, 'círculos encostados viram um, mesmo sem roubar clique');

  t.pôr([marcado('B Site', 0.5, 0.5, 1), marcado('A Link', 0.5 + pino * 1.2, 0.5, 2)]);
  assert.equal(t.lnPinos().length, 2, 'separados na tela seguem separados no mapa');

  // 4. pino DEDUZIDO não entra na fusão: ele se afasta sozinho e o nome do callout informa
  t.pôr([
    { video: 'v', segundo: 1, ponto: { nome: 'B Site', x: 0.50, y: 0.50, aproximado: false } },
    { video: 'v', segundo: 2, ponto: { nome: 'A Link', x: 0.501, y: 0.501, aproximado: false } },
  ]);
  assert.equal(t.lnPinos().length, 2, 'dedução colada não se funde — quem se afasta é ela');

  // 5. lineups do MESMO callout deduzido continuam num pino só, como sempre foram
  t.pôr([
    { video: 'v', segundo: 1, ponto: { nome: 'B Site', x: 0.5, y: 0.5, aproximado: false } },
    { video: 'v', segundo: 2, ponto: { nome: 'B Site', x: 0.5, y: 0.5, aproximado: false } },
  ]);
  const um = t.lnPinos();
  assert.equal(um.length, 1);
  assert.equal(um[0].lista.length, 2);
});

test('valorant: jogar uma lineup fora não apaga o que ele marcou, e volta inteira', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-esconder-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    const L = await import(`../src/valorant/lineups.js?d=${Date.now()}`);

    /* Tudo mora no mesmo arquivo e na mesma chave (vídeo + segundo): o ponto que ele
     * marcou, o "eu fiz essa" e agora o "joguei fora". São três coisas independentes, e
     * mexer numa não pode levar as outras — foi exatamente assim que a confirmação quase
     * se perdeu quando os pontos ganharam o "apagar". */
    const v = { video: 'abc123', segundo: 42 };

    await L.marcarPonto({ ...v, qual: 'posicao', x: 0.3, y: 0.4 });
    await L.confirmarLineup({ ...v, confirmada: true });
    assert.equal(await L.quantasEscondidas(), 0);

    // joga fora: a marca e a confirmação continuam lá
    assert.equal((await L.esconderLineup(v)).escondida, true);
    assert.equal(await L.quantasEscondidas(), 1);
    let r = await L.comMeusPontos({ lineups: [{ ...v, nome: 'x' }], callouts: [] });
    assert.ok(r.lineups[0].escondida, 'a escondida vem MARCADA, não filtrada: quem tira é a tela');
    assert.equal(r.lineups[0].posicao?.meu, true, 'o ponto que ele marcou continua');
    assert.ok(r.lineups[0].confirmei, 'e a confirmação também');

    // traz de volta: some só a marca de escondida
    assert.equal((await L.esconderLineup({ ...v, esconder: false })).escondida, false);
    assert.equal(await L.quantasEscondidas(), 0);
    r = await L.comMeusPontos({ lineups: [{ ...v, nome: 'x' }], callouts: [] });
    assert.ok(!r.lineups[0].escondida);
    assert.equal(r.lineups[0].posicao?.meu, true);
    assert.ok(r.lineups[0].confirmei);

    // apagar o ponto NÃO traz de volta o que ele jogou fora
    await L.esconderLineup(v);
    await L.esquecerPonto({ ...v, qual: 'posicao' });
    assert.equal(await L.quantasEscondidas(), 1, 'apagar o ponto não desfaz o "joguei fora"');
    assert.equal(await L.quantasConfirmadas(), 1, 'nem a confirmação');

    // tirar a confirmação também não
    await L.confirmarLineup({ ...v, confirmada: false });
    assert.equal(await L.quantasEscondidas(), 1);

    /* E uma jogada fora SEM nada marcado some do arquivo ao voltar — senão o
     * meus-pontos.json vira um cemitério de chaves vazias, uma por lineup que ele olhou. */
    const so = { video: 'zzz999', segundo: 7 };
    await L.esconderLineup(so);
    assert.equal(await L.quantasEscondidas(), 2);
    await L.esconderLineup({ ...so, esconder: false });
    assert.equal(await L.quantasEscondidas(), 1);
    assert.equal(await L.quantosPontosMeus(), 1, 'não deixa chave vazia pra trás');

    assert.equal((await L.esconderLineup({ segundo: 1 })).erro, 'faltou o vídeo');
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

/* ------------------------------------------- o mapinha cortado
 *
 * Ele mandou a foto: "cortou um mapa, testa todos". A arte da Riot vem num quadrado de
 * 1024 com o mapa no miolo e margem preta em volta -- medido pela caixa dos callouts, o
 * Lotus usa 49% da imagem. O recorte do mapinha so era preso em 0..1, entao lineup perto
 * da beirada puxava a janela pra cima da margem e metade do mapinha vinha preta.
 *
 * Medido nos 13 mapas, 1.354 lineups: margem preta mediana 5% -> 0%, e as com mais de 15%
 * de preto 331 -> 4 (as 4 que sobram cruzam o mapa inteiro no Split, onde janela quadrada
 * nao cabe na area jogavel -- aquilo nao e defeito, e geometria).
 */
test('lineups: o recorte do mapinha nao sai da parte jogavel do mapa', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');

  // uma arte com margem larga, como a do Lotus: o jogavel e um pedaco no meio
  const cercado = `
    const JANELA = { x0: 0.20, y0: 0.30, lx: 0.60, ly: 0.40 };
    const lnJanelaDoMapa = () => JANELA;
    const LN_FOLGA = 0.06;
    const extras = { janela: () => JANELA };
  `;
  const t = await funcoesDaTela('painel.html',
    ['lnPrenderNoJogavel', 'lnRecorte', 'lnRecorteEm'], cercado);
  const j = t.janela();

  /** quanto do recorte cai FORA da parte jogavel (0 = nada de margem preta) */
  const preto = (r) => {
    const dx = Math.max(0, Math.min(r.x + r.lado, j.x0 + j.lx) - Math.max(r.x, j.x0));
    const dy = Math.max(0, Math.min(r.y + r.lado, j.y0 + j.ly) - Math.max(r.y, j.y0));
    return 1 - (dx * dy) / (r.lado * r.lado);
  };
  /* A conta passa por divisao e subtracao, entao "zero" sai -2e-16. Comparar com zero
   * cravado reprova codigo certo; um decimo de por cento ja e menos que um pixel. */
  const semPreto = (r, oQue) => assert.ok(preto(r) < 0.001, `${oQue}: ${(preto(r) * 100).toFixed(2)}% de margem preta`);

  // ponto no canto de cima e da esquerda do jogavel: o pior caso do defeito
  const canto = t.lnRecorte(null, { x: j.x0 + 0.02, y: j.y0 + 0.02 });
  semPreto(canto, 'lineup na beirada nao pode abrir mapinha meio preto');
  assert.ok(canto.x >= j.x0 - 1e-9 && canto.y >= j.y0 - 1e-9, 'nao comeca antes do jogavel');

  // e no canto oposto
  const outro = t.lnRecorte(null, { x: j.x0 + j.lx - 0.02, y: j.y0 + j.ly - 0.02 });
  semPreto(outro, 'nem no canto oposto');
  assert.ok(outro.x + outro.lado <= j.x0 + j.lx + 1e-9, 'nem passa do fim do jogavel');

  // o ponto marcado CONTINUA dentro do recorte: prender nao pode empurrar o alvo pra fora
  for (const p of [{ x: j.x0 + 0.01, y: j.y0 + 0.01 }, { x: j.x0 + j.lx - 0.01, y: j.y0 + j.ly - 0.01 }]) {
    const r = t.lnRecorte(null, p);
    assert.ok(p.x >= r.x && p.x <= r.x + r.lado, 'o ponto sumiu do recorte no eixo x');
    assert.ok(p.y >= r.y && p.y <= r.y + r.lado, 'o ponto sumiu do recorte no eixo y');
  }

  // as duas pontas de uma rota longa continuam visiveis
  const a = { x: j.x0 + 0.03, y: j.y0 + 0.03 }, b = { x: j.x0 + j.lx - 0.03, y: j.y0 + j.ly - 0.03 };
  const rota = t.lnRecorte(a, b);
  for (const p of [a, b]) {
    assert.ok(p.x >= rota.x - 1e-9 && p.x <= rota.x + rota.lado + 1e-9, 'ponta fora do recorte');
    assert.ok(p.y >= rota.y - 1e-9 && p.y <= rota.y + rota.lado + 1e-9, 'ponta fora do recorte');
  }

  /* Quando a janela quadrada e MAIOR que o jogavel naquele eixo nao ha o que prender:
   * centraliza. Aqui o jogavel tem 0,40 de altura e o recorte 0,60 -- sobra preto em cima
   * e embaixo, e isso e geometria, nao defeito. O que nao pode e ficar torto pra um lado. */
  const grande = t.lnPrenderNoJogavel(0, 0.60, 'y');
  assert.ok(Math.abs((grande + 0.30) - (j.y0 + j.ly / 2)) < 1e-9, 'recorte maior que o jogavel fica centrado nele');

  // o recorte de marcar usa a mesma conta
  const marcar = t.lnRecorteEm({ x: j.x0 + 0.01, y: j.y0 + 0.01 }, 0.2);
  semPreto(marcar, 'marcar na beirada tambem nao pode abrir no escuro');
});

test('valorant: o lado dito por ele ganha da dedução, e desfazer devolve a dedução', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-lado-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    const L = await import(`../src/valorant/lineups.js?d=${Date.now()}`);

    /* Pedido dele: "preciso que tu coloque um negocio pra eu defini se é do ataque ou
     * defesa". Metade do acervo não diz o lado (4.358 de 8.150) e o parser já chegou no
     * teto; quem viu o clipe sabe. */
    const v = { video: 'abc123', segundo: 42 };
    const comoVem = (lado, pista) => ({ lineups: [{ ...v, nome: 'x', lado, ladoPista: pista }], callouts: [] });

    // o vídeo não disse nada: ele diz
    assert.equal((await L.marcarLado({ ...v, lado: 'defendendo' })).lado, 'defendendo');
    let r = await L.comMeusPontos(comoVem(null, null));
    assert.equal(r.lineups[0].lado, 'defendendo');
    assert.equal(r.lineups[0].ladoPista, 'meu', 'a pista diz que foi ele, pra tela não mentir');

    // o vídeo dizia o CONTRÁRIO: o dele ganha, porque ele viu o clipe
    r = await L.comMeusPontos(comoVem('atacando', 'nome'));
    assert.equal(r.lineups[0].lado, 'defendendo');
    assert.equal(r.lineups[0].ladoPista, 'meu');

    // desmarcar devolve o que o texto dizia, e não deixa a lineup sem lado
    assert.equal((await L.marcarLado({ ...v, lado: null })).lado, null);
    r = await L.comMeusPontos(comoVem('atacando', 'nome'));
    assert.equal(r.lineups[0].lado, 'atacando');
    assert.equal(r.lineups[0].ladoPista, 'nome');

    // lado inventado não entra
    assert.ok((await L.marcarLado({ ...v, lado: 'meio' })).erro);
    assert.ok((await L.marcarLado({ segundo: 1, lado: 'atacando' })).erro);

    /* Os campos do arquivo são independentes: dizer o lado não pode mexer no ponto que ele
     * marcou nem na confirmação, e tirar o lado não pode levá-los junto. */
    await L.marcarPonto({ ...v, qual: 'posicao', x: 0.3, y: 0.4 });
    await L.confirmarLineup({ ...v, confirmada: true });
    await L.esconderLineup(v);
    await L.marcarLado({ ...v, lado: 'atacando' });
    await L.marcarLado({ ...v, lado: null });
    r = await L.comMeusPontos(comoVem(null, null));
    assert.equal(r.lineups[0].posicao?.meu, true, 'tirar o lado não apaga o ponto');
    assert.ok(r.lineups[0].confirmei, 'nem a confirmação');
    assert.ok(r.lineups[0].escondida, 'nem o "joguei fora"');

    // e um lado sozinho some do arquivo ao ser tirado, sem deixar chave vazia
    const so = { video: 'zzz999', segundo: 7 };
    await L.marcarLado({ ...so, lado: 'defendendo' });
    assert.equal(await L.quantosPontosMeus(), 2);
    await L.marcarLado({ ...so, lado: null });
    assert.equal(await L.quantosPontosMeus(), 1, 'não deixa chave vazia pra trás');
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

/* ------------------------------------ a tecla nao pode morrer calada
 *
 * A lineup ABERTA pode sair da lista debaixo dele: dizer "esta e de defesa" com ele no
 * ataque tira a lineup do filtro na hora, e isso esta certo -- e o que ele acabou de
 * afirmar. So que ai o indexOf da -1, e o lnIrPara desistia: medido na tela, depois de um
 * D as setas e o Delete nao faziam mais nada, sem erro e sem aviso.
 */
test('lineups: as setas continuam andando quando a lineup aberta sai da lista', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');

  const cercado = `
    let lnAchadas = [], lnClipe = null, lnPinoAtivo = null, lnOndeEstava = -1;
    const vistas = [];
    const lnPinos = () => [];                 // sem pino aberto: a lista e a da busca
    const lnVer = (i) => { const l = lnAchadas[i]; if (!l) return; lnOndeEstava = i; lnClipe = l; vistas.push(l.nome); };
    const extras = {
      pôr: (ls) => { lnAchadas = ls; lnClipe = null; lnOndeEstava = -1; vistas.length = 0; },
      abrir: (i) => lnVer(i),
      tirar: (l) => { lnAchadas = lnAchadas.filter((x) => x !== l); },   // o filtro tirou ela
      clipe: () => lnClipe,
      vistas: () => vistas.slice(),
    };
  `;
  const t = await funcoesDaTela('painel.html', ['lnIrPara'], cercado);
  const lista = () => ['a', 'b', 'c', 'd', 'e'].map((n) => ({ nome: n }));

  // o caminho normal continua igual
  let ls = lista();
  t.pôr(ls); t.abrir(2);
  t.lnIrPara(1);
  assert.equal(t.clipe().nome, 'd');
  t.lnIrPara(-1);
  assert.equal(t.clipe().nome, 'c');

  // a aberta sai da lista e ele aperta ->: vai pra quem entrou na vaga dela
  ls = lista();
  t.pôr(ls); t.abrir(2);                 // abriu 'c', na vaga 2
  const c = t.clipe();
  t.tirar(c);                            // a lista vira a,b,d,e -- 'd' esta na vaga 2
  t.lnIrPara(1);
  assert.equal(t.clipe().nome, 'd', 'a seta tem que andar, nao morrer calada');

  // e pra tras, a de antes da vaga
  ls = lista();
  t.pôr(ls); t.abrir(2);
  t.tirar(t.clipe());
  t.lnIrPara(-1);
  assert.equal(t.clipe().nome, 'b');

  // saiu a PRIMEIRA e ele volta: nao pode cair fora da lista nem travar
  ls = lista();
  t.pôr(ls); t.abrir(0);
  t.tirar(t.clipe());
  t.lnIrPara(-1);
  assert.ok(t.clipe(), 'voltar da primeira tem que parar em alguma, nao em nada');

  // saiu a ULTIMA e ele avanca: nao existe proxima, e tudo bem -- so nao pode quebrar
  ls = lista();
  t.pôr(ls); t.abrir(4);
  t.tirar(t.clipe());
  const antes = t.clipe().nome;
  t.lnIrPara(1);
  assert.ok(t.clipe().nome !== undefined, 'avancar da ultima nao pode deixar o clipe quebrado');
  assert.ok([antes, 'e', 'd'].includes(t.clipe().nome));

  // lista de uma so, que sai: nao ha pra onde ir, e isso nao e erro
  t.pôr([{ nome: 'unica' }]); t.abrir(0);
  t.tirar(t.clipe());
  t.lnIrPara(1);
  assert.equal(t.clipe().nome, 'unica', 'sem pra onde ir, fica onde esta');
});

/* ------------------------------------------- "os mapas estao cortados"
 *
 * Ele mandou foto do Sunset com os pinos da direita cortados. Medido: o pino "A Elbow" que
 * ELE marcou estava em x 0,872 e a caixa desenhada terminava em 0,875 -- 2,7 px da borda
 * numa caixa de 801 px. Como o pino tem 32 px, METADE dele ficava fora e o overflow:hidden
 * cortava.
 *
 * A caixa saia so dos callouts, e isso bastava enquanto TODO marcador passava pelo
 * lnPrender (que o mantinha 4,5% pra dentro). Desde a 2.28.285 o ponto marcado a mao pula o
 * lnPrender de proposito -- e eu escrevi no comentario que "ele clicou DENTRO". Clicou
 * dentro da caixa; sem espaco pro icone, nao.
 */
test('lineups: a caixa do mapa cabe o que ele marcou, inteiro', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');

  const cercado = `
    let lnCallouts = [], lnTodas = [];
    const LN_MARGEM_RECORTE = 0.06;
    const extras = {
      pôr: (cs, ls) => { lnCallouts = cs; lnTodas = ls ?? []; },
    };
  `;
  const t = await funcoesDaTela('painel.html', ['lnJanelaDoMapa'], cercado);

  // callouts de um mapa que nao chega nas bordas da arte, como os de verdade
  const callouts = [
    { nome: 'a', x: 0.10, y: 0.20 }, { nome: 'b', x: 0.50, y: 0.50 }, { nome: 'c', x: 0.80, y: 0.70 },
  ];
  const marca = (x, y) => ({ posicao: { x, y, meu: true }, ponto: null });

  // sem marca nenhuma: a caixa e a dos callouts, como sempre foi
  t.pôr(callouts, []);
  const so = t.lnJanelaDoMapa();
  assert.ok(Math.abs((so.x0 + so.lx) - (0.80 + 0.70 * 0.06)) < 1e-9, 'sem marca, a caixa nao muda');

  /* Marca ALEM do callout mais a direita: a caixa tem que crescer, e com folga pro icone.
   * O pino tem 32 px; o que se exige aqui e que sobre pelo menos 2% da largura da janela
   * depois da marca, que num mapa de 800 px da uns 16 px -- meio pino. */
  t.pôr(callouts, [marca(0.95, 0.50)]);
  const cresceu = t.lnJanelaDoMapa();
  const fimX = cresceu.x0 + cresceu.lx;
  assert.ok(fimX > 0.95, `a caixa tem que passar da marca: terminou em ${fimX.toFixed(3)}`);
  assert.ok((fimX - 0.95) / cresceu.lx > 0.02,
    `pouca folga depois da marca: ${(((fimX - 0.95) / cresceu.lx) * 100).toFixed(1)}% da janela`);

  // e nos outros tres lados
  t.pôr(callouts, [marca(0.02, 0.98)]);
  const outro = t.lnJanelaDoMapa();
  assert.ok(outro.x0 <= 0.02, 'cresce pra esquerda');
  assert.ok(outro.y0 + outro.ly >= 0.98, 'e pra baixo');

  // marca de ONDE CAI conta igual
  t.pôr(callouts, [{ posicao: null, ponto: { x: 0.97, y: 0.5, meu: true } }]);
  assert.ok(t.lnJanelaDoMapa().x0 + t.lnJanelaDoMapa().lx > 0.97, 'o alvo marcado tambem cabe');

  // ponto DEDUZIDO (sem `meu`) nao mexe na caixa: esse passa pelo lnPrender e se ajeita
  t.pôr(callouts, [{ posicao: { x: 0.99, y: 0.5 }, ponto: null }]);
  const deduzido = t.lnJanelaDoMapa();
  assert.ok(Math.abs((deduzido.x0 + deduzido.lx) - (so.x0 + so.lx)) < 1e-9,
    'deducao nao estica a caixa -- so o que ele marcou a mao');

  // a caixa nunca sai da arte, que e 0..1
  t.pôr(callouts, [marca(1, 1), marca(0, 0)]);
  const tudo = t.lnJanelaDoMapa();
  assert.ok(tudo.x0 >= 0 && tudo.y0 >= 0 && tudo.x0 + tudo.lx <= 1 && tudo.y0 + tudo.ly <= 1,
    'a caixa nao pode passar da imagem');

  // poucos callouts: continua caindo no mapa inteiro, como antes
  t.pôr([{ x: 0.5, y: 0.5 }], [marca(0.9, 0.9)]);
  const poucos = t.lnJanelaDoMapa();
  assert.deepEqual(poucos, { x0: 0, y0: 0, lx: 1, ly: 1 });
});

/* ------------------------------------------- o piso de qualidade do video
 *
 * Ele cobrou: "pq tu colocou 360p?? no minimo 720p". O app nunca pediu 360p -- nao ha `vq`
 * nem setPlaybackQuality em lugar nenhum, quem escolhe e o YouTube pelo tamanho do player.
 * O que era meu: a recuperacao so reagia a 360p OU PIOR, entao parar em 480p era tratado
 * como bom; e o ultimo degrau da escada limitava o quadro a 960 px, que pede ~480p -- ou
 * seja, a propria escada levava o video pra baixo do piso que ele queria.
 */
test('lineups: a recuperacao de qualidade trata tudo abaixo de 720p como ruim', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');

  const cercado = `
    const LN_ALTURA = { tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160 };
    const lnAltura = (q) => LN_ALTURA[q] ?? 0;
    let lnTentouHD = 0, lnQuerRecarregar = false;
    const selo = { textContent: '', className: '', title: '', classList: { toggle(c, v) { selo.ruim = v; } } };
    const $ = () => selo;
    const extras = {
      selo, lnAltura,
      estado: (t, recarregar) => { lnTentouHD = t; lnQuerRecarregar = recarregar; },
      teto: () => LN_TETO,
    };
  `;
  // LN_TETO vem do arquivo, nao redeclarada aqui: senao o teste conferiria um numero
  // inventado por ele mesmo em vez da escada de verdade
  const t = await funcoesDaTela('painel.html', ['lnPintarQualidade'], cercado, ['LN_TETO']);

  /* A ESCADA nao pode pedir menos que 720p. O degrau de 960 px (que dava ~480p) saiu; o
   * mais baixo e 1.280, que e exatamente a largura de 720p. */
  const teto = t.teto();
  for (const px of teto) {
    assert.ok(px === null || px >= 1280, `degrau de ${px}px pede menos que 720p`);
  }

  // 480p agora conta como RUIM -- era isso que o app aceitava calado
  t.estado(0, false);
  t.lnPintarQualidade('large');
  assert.equal(t.selo.textContent.startsWith('480p'), true);
  assert.equal(t.selo.ruim, true, '480p tem que contar como ruim, senao ninguem tenta de novo');

  // 360p, idem
  t.estado(0, false);
  t.lnPintarQualidade('medium');
  assert.equal(t.selo.ruim, true);

  // 720p e bom, e 1080 tambem
  t.estado(0, false);
  t.lnPintarQualidade('hd720');
  assert.equal(t.selo.ruim, false, '720p e o piso: nao pode contar como ruim');
  t.lnPintarQualidade('hd1080');
  assert.equal(t.selo.ruim, false);

  /* Quando tentou tudo e nao chegou nos 720, o selo AVISA em vez de aceitar calado -- que
   * era o comportamento antigo (ficava 480p sem dizer nada). */
  t.estado(teto.length, false);
  t.lnPintarQualidade('large');
  assert.ok(t.selo.textContent.includes('!'), 'desistir tem que aparecer no selo');
  assert.match(t.selo.title, /não passou de 480p/);

  // enquanto vai tentar de novo, o selo diz isso e nao "desisti"
  t.estado(1, true);
  t.lnPintarQualidade('medium');
  assert.ok(t.selo.textContent.includes('⟳'));
  assert.match(t.selo.title, /abaixo de 720p/);

  // sem medida ainda, nao inventa numero
  t.estado(0, false);
  t.lnPintarQualidade('');
  assert.equal(t.selo.textContent, '…');
});

/* ------------------------------------------- a marcacao a mao nao pode sumir
 *
 * Esse arquivo e o unico dado do app que nao da pra refazer: o acervo e o catalogo voltam
 * com uma busca nova, as 149 marcas dele nao voltam de lugar nenhum -- o parser tem teto de
 * 30% exatamente porque o resto so sai a mao.
 *
 * E ele era gravado com writeFile direto, que TRUNCA antes de escrever: morrer nesse vao
 * deixava o arquivo vazio, sem copia e sem volta. Agora grava ao lado e renomeia em cima,
 * guardando a versao anterior.
 */
test('lineups: a marcacao a mao sobrevive a arquivo quebrado', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-marcas-'));
  const antes = process.env.LOLCOACH_DIR;
  process.env.LOLCOACH_DIR = base;
  try {
    const pasta = resolve(base, 'dados', 'valorant');
    await mkdir(pasta, { recursive: true });
    const arq = resolve(pasta, 'meus-pontos.json');
    const bak = `${arq}.bak`;

    // duas marcas que ele ja tinha feito
    const jaTinha = {
      formato: 1,
      pontos: {
        'v1#10': { posicao: { x: 0.2, y: 0.3 }, em: 1 },
        'v2#20': { alvo: { x: 0.8, y: 0.9 }, confirmei: true, em: 2 },
      },
    };
    await writeFile(arq, JSON.stringify(jaTinha), 'utf8');

    const L = await import(`../src/valorant/lineups.js?marcas=${Date.now()}`);

    /* 1) A copia nasce na LEITURA, nao na primeira marca. Medido: com o arquivo dele de
     *    149 marcas e nenhuma copia, um arquivo cortado fazia 149 virar 1. Se a copia só
     *    aparecesse ao marcar, quem abre o app e nao marca nada seguiria sem rede. */
    await L.comMeusPontos({ callouts: [], lineups: [{ video: 'v1', segundo: 10 }] });
    assert.equal(Object.keys(JSON.parse(await readFile(bak, 'utf8')).pontos).length, 2,
      'a copia tinha que existir so de ler');

    /* 2) Gravar guarda a versao anterior. Sem isso, um arquivo quebrado nao tem de onde
     *    voltar -- que era a situacao ate agora. */
    await L.marcarPonto({ video: 'v3', segundo: 30, qual: 'posicao', x: 0.5, y: 0.5 });
    const copia = JSON.parse(await readFile(bak, 'utf8'));
    assert.equal(Object.keys(copia.pontos).length, 2, 'a copia tem que ser a versao ANTERIOR');
    const agora = JSON.parse(await readFile(arq, 'utf8'));
    assert.equal(Object.keys(agora.pontos).length, 3, 'e o principal tem a marca nova');

    /* 3) Nao sobra arquivo temporario na pasta dele. */
    const sobrou = (await readdir(pasta)).filter((n) => n.endsWith('.novo'));
    assert.deepEqual(sobrou, [], `sobrou temporario: ${sobrou.join(', ')}`);

    /* 4) O principal quebrado NAO apaga o trabalho: le da copia.
     *    Isto e o teste que importa -- e o cenario de perder tudo. */
    await writeFile(arq, '{"formato":1,"pontos":{"v1#10":{"posic', 'utf8');  // escrita cortada no meio
    const R = await import(`../src/valorant/lineups.js?quebrado=${Date.now()}`);
    const r = await R.comMeusPontos({
      callouts: [],
      lineups: [{ video: 'v1', segundo: 10 }, { video: 'v2', segundo: 20 }],
    });
    assert.equal(r.lineups[0].posicao?.meu, true, 'a marca de v1 tinha que voltar da copia');
    assert.equal(r.lineups[1].confirmei, true, 'e o "eu fiz essa e funcionou" tambem');

    // e a copia boa continua boa: recuperar nao pode promover o arquivo quebrado a copia
    const copiaDepois = JSON.parse(await readFile(bak, 'utf8'));
    assert.equal(Object.keys(copiaDepois.pontos).length, 2, 'a copia nao pode virar o lixo');
    // o principal foi reescrito com o que se salvou
    assert.equal(Object.keys(JSON.parse(await readFile(arq, 'utf8')).pontos).length, 2);

    /* 5) Copia vazia nao conta como recuperacao: comecar do zero e o certo quando nao ha
     *    nada guardado, senao qualquer app novo acharia que perdeu algo. */
    await writeFile(arq, 'lixo', 'utf8');
    await writeFile(bak, JSON.stringify({ formato: 1, pontos: {} }), 'utf8');
    const Z = await import(`../src/valorant/lineups.js?zero=${Date.now()}`);
    const vazio = await Z.comMeusPontos({ callouts: [], lineups: [{ video: 'v1', segundo: 10 }] });
    assert.equal(vazio.lineups[0].posicao?.meu, undefined, 'sem nada guardado, nao inventa marca');
  } finally {
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

/* ------------------------------------------- o app e dois: LoL e Valorant
 *
 * O Valorant era UMA aba no fim de uma barra inteira de LoL. Duas coisas davam errado por
 * causa disso, e as duas estao medidas aqui:
 *
 *  - o rodape so sabia falar do client do LoL. Numa partida de Valorant com o League
 *    fechado ele dizia "client desconectado" -- verdade e inutil;
 *  - nao havia onde por o que e de Valorant (as 11 partidas gravadas nao apareciam em
 *    tela nenhuma).
 *
 * O que este teste protege e o comportamento que e facil quebrar sem ninguem ver: qual aba
 * fica aberta ao trocar de modo, e em que jogo o app abre.
 */
test('painel: os dois modos trocam a barra e o rodape fala do jogo certo', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');

  const cercado = `
    const els = {};
    const achar = (k) => (els[k] ??= { textContent: '', className: '' });
    const $ = (s) => achar(s);
    const botoes = [
      { dataset: { aba: 'visao', jogo: 'lol' } },
      { dataset: { aba: 'patch', jogo: 'lol' } },
      { dataset: { aba: 'lineups', jogo: 'val' } },
      { dataset: { aba: 'config' } },
    ];
    const modos = ['lol', 'val'].map((m) => ({ dataset: { modo: m }, on: false,
      classList: { toggle(c, v) { this.ligado = v; } } }));
    const document = {
      body: { dataset: {} },
      querySelectorAll: (s) => (s === 'nav button' ? botoes : s === '#modos button' ? modos : []),
      getElementById: (id) => (botoes.some((b) => b.dataset.aba === id) ? {} : null),
    };
    const guardado = {};
    const localStorage = { getItem: (k) => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = v; } };
    const location = { hash: '' };
    const FASE_PT = { ChampSelect: 'selecao' };
    let lnCatalogo = { agentes: [{ id: 'fade-id', nome: 'Fade' }] };
    let abaAtual = 'visao', modoJogo = 'lol', ultimoEstado = null, valSituacao = null, valEspiadoEm = 0;
    const abertas = [];
    function abrirAba(nome) { abertas.push(nome); abaAtual = nome; }
    let resposta = null;
    const pegar = async () => { if (resposta === 'erro') throw new Error('sem rede'); return resposta; };

    const extras = {
      els, abertas, guardado, location, modos, document,
      estado: (e) => { ultimoEstado = e; },
      valor: (j) => { valSituacao = j; },
      responder: (r) => { resposta = r; },
      lembrar: (v) => { guardado.modoJogo = v; },
      ondeEsta: (a) => { abaAtual = a; },
      modo: () => modoJogo,
      aba: () => abaAtual,
      zerarEspiada: () => { valEspiadoEm = 0; },
    };
  `;
  const t = await funcoesDaTela('painel.html',
    ['trocarModo', 'pintarEstado', 'espiarValorant', 'escolherModoDeEntrada'],
    cercado, ['ABA_INICIAL', 'VAL_ONDE', 'jogoDaAba']);

  /* 1) O RODAPE. Em partida de Valorant ele diz Valorant -- com mapa e agente -- e nao
   *    fala do client do LoL, que e exatamente a frase errada que ele lia antes. */
  t.valor({ ligado: true, estado: 'jogando', emFila: false, mapa: 'Corrode', agenteId: 'fade-id' });
  t.trocarModo('val');
  assert.equal(t.els['#estClient'].textContent, 'Valorant em partida');
  assert.equal(t.els['#estFase'].textContent, 'Corrode · Fade');
  assert.ok(t.els['#luz'].className.includes('on'), 'jogo aberto acende a luz');

  // na fila, e na selecao de agente
  t.valor({ ligado: true, estado: 'menu', emFila: true, mapa: null, agenteId: null });
  t.pintarEstado();
  assert.equal(t.els['#estClient'].textContent, 'Valorant na fila');
  assert.equal(t.els['#estFase'].textContent, '', 'sem mapa nao inventa texto');
  t.valor({ ligado: true, estado: 'selecao', emFila: false, mapa: 'Bind', agenteId: 'fade-id' });
  t.pintarEstado();
  assert.equal(t.els['#estClient'].textContent, 'Valorant escolhendo agente');

  // jogo fechado
  t.valor({ ligado: false });
  t.pintarEstado();
  assert.equal(t.els['#estClient'].textContent, 'Valorant fechado');
  assert.equal(t.els['#luz'].className.includes('on'), false);

  // e o modo LoL continua falando do LoL
  t.estado({ conectado: true, fase: 'ChampSelect' });
  t.trocarModo('lol');
  assert.equal(t.els['#estClient'].textContent, 'client conectado');
  assert.equal(t.els['#estFase'].textContent, 'selecao');
  t.estado(null);
  t.pintarEstado();
  assert.equal(t.els['#estClient'].textContent, 'painel sem conexão');

  /* 2) A ABA ABERTA. Trocar de modo nao pode deixar no ar uma tela cujo botao a barra nao
   *    mostra mais -- o Perfil ficava aceso sem botao nenhum. */
  t.ondeEsta('visao');
  t.abertas.length = 0;
  t.trocarModo('val');
  assert.deepEqual(t.abertas, ['lineups'], 'saindo do LoL abre a primeira aba do Valorant');

  // aba dos DOIS (Configuração) nao se mexe: ele estava mexendo ali, continua ali
  t.ondeEsta('config');
  t.abertas.length = 0;
  t.trocarModo('lol');
  assert.deepEqual(t.abertas, [], 'aba dos dois jogos fica onde esta');
  assert.equal(t.aba(), 'config');

  // e trocar pro modo em que a aba JA esta tambem nao mexe
  t.ondeEsta('lineups');
  t.abertas.length = 0;
  t.trocarModo('val');
  assert.deepEqual(t.abertas, []);

  /* 3) EM QUE JOGO O APP ABRE. O jogo rodando manda, mas nao sobrescreve a escolha dele:
   *    senao abrir o app uma vez com o Valorant ligado mudaria a preferencia pra sempre. */
  t.lembrar('lol');
  t.responder({ ligado: true, estado: 'jogando', mapa: 'Corrode', agenteId: 'fade-id' });
  await t.escolherModoDeEntrada();
  assert.equal(t.modo(), 'val', 'Valorant rodando: abre no Valorant');
  assert.equal(t.guardado.modoJogo, 'lol', 'mas o lembrado continua o dele');

  // nada rodando: vale o lembrado
  t.responder({ ligado: false });
  t.lembrar('val');
  await t.escolherModoDeEntrada();
  assert.equal(t.modo(), 'val');
  t.lembrar('lol');
  await t.escolherModoDeEntrada();
  assert.equal(t.modo(), 'lol');

  // sem nada lembrado, abre no LoL
  delete t.guardado.modoJogo;
  await t.escolherModoDeEntrada();
  assert.equal(t.modo(), 'lol');

  /* A URL manda em tudo: e por #lineups que a janela da segunda tela nasce no meio da
   * partida. Ela nao pode ser jogada de volta pro LoL por esta funcao, que resolve depois
   * porque e async. */
  t.location.hash = '#lineups';
  t.responder({ ligado: false });
  t.lembrar('lol');
  await t.escolherModoDeEntrada();
  assert.equal(t.modo(), 'val', 'a aba pedida na URL decide o modo');
  t.location.hash = '';

  // daemon fora do ar na abertura nao trava nem muda nada: cai no lembrado
  t.responder('erro');
  t.lembrar('lol');
  await t.escolherModoDeEntrada();
  assert.equal(t.modo(), 'lol');

  /* 4) A ESPIADA. 5 s e o ritmo; o tick e de 2 s, e consultar tres vezes mais no meio da
   *    partida dele nao traz informacao nova. */
  t.trocarModo('val');
  t.zerarEspiada();
  t.responder({ ligado: true, estado: 'jogando', mapa: 'Ascent', agenteId: 'fade-id' });
  await t.espiarValorant();
  assert.equal(t.els['#estFase'].textContent, 'Ascent · Fade');
  t.responder({ ligado: true, estado: 'jogando', mapa: 'Sunset', agenteId: 'fade-id' });
  await t.espiarValorant();
  assert.equal(t.els['#estFase'].textContent, 'Ascent · Fade', 'dentro dos 5 s nao consulta de novo');
});

/* ------------------------------------------- a tela de partidas do Valorant
 *
 * O diario ja era gravado desde que existe e nao aparecia em tela nenhuma: 12 partidas com
 * mapa, agente e duracao guardadas as cegas. A conta que importa aqui e a do TEMPO: a
 * partida em andamento tem `fim` = ultima vez que o app olhou o jogo, entao somar ela diz
 * "2 min" numa partida no terceiro round e derruba a media justamente enquanto ele joga.
 */
test('painel: as partidas de Valorant nao contam a que esta em andamento no tempo', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');

  const cercado = `
    const els = {};
    const achar = (k) => (els[k] ??= { innerHTML: '' });
    const $ = (s) => achar(s);
    const esc = (s) => String(s ?? '');
    const carregando = () => 'carregando';
    const barras = (linhas) => linhas.map((l) => l.rotulo + '=' + l.destaque + '/' + l.sub).join(' ');
    let resposta = null;
    const pegar = async () => { if (resposta === 'erro') throw new Error('sem rede'); return resposta; };
    const extras = { els, responder: (r) => { resposta = r; } };
  `;
  const t = await funcoesDaTela('painel.html', ['carregarValPartidas'], cercado,
    ['VP_FILA', 'vpMin', 'vpTempo', 'vpMaisJogado']);

  const min = 60000;
  t.responder({ partidas: [
    // em andamento: 2 min de "duracao" porque o app olhou o jogo agora
    { em: 100 * min, fim: 102 * min, mapa: 'Corrode', agente: 'Fade', fila: 'competitive', fechada: false },
    { em: 60 * min, fim: 90 * min, mapa: 'Sunset', agente: 'Fade', fila: 'competitive', fechada: true },
    { em: 10 * min, fim: 40 * min, mapa: 'Sunset', agente: 'Fade', fila: 'unrated', fechada: true },
    { em: 0, fim: 30 * min, mapa: 'Bind', agente: 'Omen', fila: 'competitive', fechada: true },
  /* A Lotus entra com ZERO marca de propósito, e ele não jogou Lotus nenhuma vez aqui: é o
   * que faz a asserção de baixo valer algo. Uma versão que varresse a contagem inteira em
   * vez das partidas acharia a Lotus como "onde marcar rende" — e mandaria ele marcar um
   * mapa que ele não pega. */
  ], marcasPorMapa: { Sunset: 23, Bind: 30, Corrode: 1, Lotus: 0 } });
  await t.carregarValPartidas();

  const cartoes = t.els['#vpCartoes'].innerHTML;
  assert.match(cartoes, />4</, 'conta as 4 partidas, inclusive a em andamento');
  assert.match(cartoes, /1 em andamento/);
  /* 3 fechadas de 30 min = 1h30. Se a em andamento entrasse, daria 1h32 e media de 23 min
   * em vez de 30 -- que e o erro que este teste existe pra pegar. */
  assert.match(cartoes, /1 h 30 min/, 'tempo = so as fechadas');
  assert.doesNotMatch(cartoes, /1 h 32 min/, 'somar a em andamento daria 1h32');
  assert.match(cartoes, /média de 30 min/, 'a media tambem ignora a em andamento');

  // o mapa mais jogado conta TODAS, inclusive a em andamento: ali a pergunta e "onde eu jogo"
  assert.match(cartoes, /Sunset/);

  /* ONDE MARCAR RENDE: o mapa que ele joga e tem menos marca. Com estes dados e a Corrode
   * (1 marca contra 23 da Sunset e 30 da Bind) -- que e exatamente o caso real que fez
   * isto existir: 35 marcas na Lotus, UMA na Corrode, e duas competitivas na Corrode. */
  assert.match(cartoes, /Onde marcar rende/);
  assert.match(cartoes, />Corrode</, `o buraco tinha que ser a Corrode: ${cartoes}`);
  assert.match(cartoes, /1 partida · 1 marca/, 'singular no 1, e nao "1 partidas"');

  /* A Lotus tem MENOS marca que a Bind, mas ele nao jogou Lotus nenhuma vez aqui: mapa que
   * ele nao pega nao e falta de marca, e mapa que nao importa. */
  assert.doesNotMatch(cartoes, /Lotus/, 'mapa que ele nao jogou nao entra no buraco');

  // ao lado de cada mapa, quanta lineup ja tem ali -- a % de partidas a barra ja mostra
  assert.match(t.els['#vpMapas'].innerHTML, /Sunset=2\/23 marcas/);
  // o espaço no fim importa: sem ele, "1 marcas" também casaria e o singular não estaria testado
  assert.match(t.els['#vpMapas'].innerHTML, /Corrode=1\/1 marca /, 'singular no 1');
  // no agente nao existe marca por agente, entao ali continua a porcentagem
  assert.match(t.els['#vpAgentes'].innerHTML, /Fade=3\/75%/);

  // a lista traduz a fila e nao chama "21 min" o que ainda esta rolando
  const lista = t.els['#vpLista'].innerHTML;
  assert.match(lista, /Competitiva/);
  assert.match(lista, /Sem classificação/);
  assert.match(lista, /em andamento/);
  assert.match(lista, /30 min/);

  // fila que o jogo inventar depois aparece crua em vez de sumir da tabela
  t.responder({ partidas: [{ em: 0, fim: 10 * min, mapa: 'Abyss', agente: 'Fade', fila: 'modoNovo2027', fechada: true }] });
  await t.carregarValPartidas();
  // sem contagem nenhuma (varredura falhou) a tela nao quebra: mostra zero, nao "undefined"
  assert.match(t.els['#vpMapas'].innerHTML, /Abyss=1\/0 marcas/);
  assert.match(t.els['#vpCartoes'].innerHTML, /0 marcas/);
  assert.match(t.els['#vpLista'].innerHTML, /modoNovo2027/);

  // sem nada anotado, diz que anota sozinho -- nao fica uma tela vazia sem explicacao
  t.responder({ partidas: [] });
  await t.carregarValPartidas();
  assert.match(t.els['#vpLista'].innerHTML, /anota sozinho/);
  assert.equal(t.els['#vpCartoes'].innerHTML, '');

  // daemon fora do ar nao deixa "carregando..." pra sempre
  t.responder('erro');
  await t.carregarValPartidas();
  assert.match(t.els['#vpLista'].innerHTML, /não consegui ler o diário/);
});

/* ------------------------------------------- notas de atualizacao dos DOIS jogos
 *
 * O modulo de notas era so do LoL e passou a servir os dois. Era refatoracao em codigo que
 * funciona e nao tinha UM teste -- estes sao os primeiros.
 *
 * O que protege: o caminho do LoL continuar igualzinho (e o que ele usa hoje), cada jogo
 * guardar cache no seu canto, e o item de indice que aponta pra FORA do site nao virar
 * nota -- medido, o indice do LoL tem 1 em 178 assim, e com ele a URL saia colada
 * ("https://www.leagueoflegends.com" + "https://br.leagueoflegends.com/..."), impossivel
 * de abrir.
 */
test('patchnotes: os dois jogos, cada um no seu site e no seu cache', async () => {
  const { mkdtemp, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const base = await mkdtemp(resolve(tmpdir(), 'lolcoach-patch-'));
  const antes = process.env.LOLCOACH_DIR;
  const buscaDeVerdade = globalThis.fetch;
  process.env.LOLCOACH_DIR = base;

  // o indice que a Riot serve, do jeito que serve: __NEXT_DATA__ com a lista dentro
  const indice = (itens) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { page: { blades: [{ items: itens }] } } },
  })}</script></html>`;
  const item = (titulo, url) => ({
    title: titulo, publishedAt: '2026-10-27T13:00:00.000Z', description: 'resumo',
    action: { payload: { url } }, media: { url: 'https://cdn/x.png' },
  });
  const nota = (corpo) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { page: { body: corpo } } },
  })}</script></html>`;

  const pedidas = [];
  globalThis.fetch = async (url) => {
    pedidas.push(String(url));
    const u = String(url);
    let html;
    if (u.includes('leagueoflegends.com') && u.includes('tags/patch-notes')) {
      html = indice([
        item('Notas da Atualização 26.22', '/pt-br/news/game-updates/lol-26-22'),
        item('Notas da Atualização 26.21', '/pt-br/news/game-updates/lol-26-21'),
        item('Notas da Atualização 26.20', '/pt-br/news/game-updates/lol-26-20'),
        item('Notas da Atualização 26.19', '/pt-br/news/game-updates/lol-26-19'),
        // o de fora: existe no indice de verdade e nao e nota
        item('Gwen – Resumo das Habilidades', 'https://br.leagueoflegends.com/pt-br/event/gwen/'),
      ]);
    } else if (u.includes('playvalorant.com') && u.includes('tags/patch-notes')) {
      html = indice([
        item('Atualização 13.09 do VALORANT', '/pt-br/news/game-updates/val-1309'),
        item('Notas da Atualização 13.08', '/pt-br/news/game-updates/val-13-08'),
        item('Atualização 13.06 do VALORANT', '/pt-br/news/game-updates/val-13-06'),
        item('Atualização 13.05 do VALORANT', '/pt-br/news/game-updates/val-13-05'),
      ]);
    } else if (u.includes('/val-1309')) {
      // nota do Valorant: secoes em h2, sem a estrutura de campeao do LoL
      html = nota(`<h2>ATUALIZAÇÕES DOS AGENTES</h2><p>Hush chegou. ${'texto '.repeat(200)}</p>`
        + `<h2>ATUALIZAÇÕES DE ARMAS</h2><p>Dano 140 ⇒ 120</p>`
        + `<p><a href="/pt-br/alguma-coisa/">link relativo</a></p>`
        + `<script src="https://x.js" /><iframe src="https://x" />`);
    } else if (u.includes('/lol-26-22')) {
      html = nota(`<h2 id="patch-top">Destaques</h2><h3 class="change-title" id="patch-ahri">Ahri</h3>`
        + `<p>Dano 80 ⇒ 70. ${'texto '.repeat(200)}</p>`
        + `<p><a href="/pt-br/champions/ahri/">link relativo</a></p>`);
    } else {
      throw new Error(`pedido inesperado: ${u}`);
    }
    return { ok: true, status: 200, text: async () => html };
  };

  try {
    const P = await import(`../src/dados/patchnotes.js?dois=${Date.now()}`);

    /* 1) Cada jogo no SEU site. Sem isto, as notas do Valorant seriam buscadas no site do
     *    LoL e a tela do Valorant mostraria patch de campeão. */
    const lol = await P.listarAtualizacoes({ limite: 10 });
    const val = await P.listarAtualizacoes({ limite: 10, jogo: 'val' });
    assert.ok(pedidas.some((u) => u.startsWith('https://www.leagueoflegends.com')), 'LoL pelo site do LoL');
    assert.ok(pedidas.some((u) => u.startsWith('https://playvalorant.com')), 'Valorant pelo site do Valorant');
    assert.deepEqual(val.map((n) => n.slug), ['val-1309', 'val-13-08', 'val-13-06', 'val-13-05']);

    /* 2) O item que aponta pra fora do site NAO vira nota: 5 itens no indice do LoL, 4
     *    notas. Antes ele entrava e a URL saia colada, impossivel de abrir. */
    assert.equal(lol.length, 4, `o item de fora entrou: ${lol.map((n) => n.slug).join(', ')}`);
    assert.ok(!lol.some((n) => n.slug.includes('gwen')));

    /* 3) Jogo sem nome no mapa cai no LoL, que e o padrao de quem ja chamava sem `jogo`. */
    const semNome = await P.listarAtualizacoes({ limite: 1, jogo: 'jogo-que-nao-existe' });
    assert.equal(semNome[0].slug, 'lol-26-22');

    /* 4) A NOTA do Valorant: corpo limpo, zero blocos de campeao (a estrutura do LoL nao
     *    casa), script e iframe fora, e link relativo apontando pro site CERTO. */
    const nv = await P.lerAtualizacao('val-1309', { jogo: 'val' });
    assert.equal(nv.url, 'https://playvalorant.com/pt-br/news/game-updates/val-1309');
    assert.equal(nv.blocos.length, 0, 'nota de Valorant nao tem bloco de campeao');
    assert.doesNotMatch(nv.corpo, /<script|<iframe/i, 'script e iframe tem que sair');
    assert.match(nv.corpo, /href="https:\/\/playvalorant\.com\/pt-br\/alguma-coisa\//,
      'link relativo tem que virar absoluto NO SITE DO VALORANT');
    assert.match(nv.corpo, /ATUALIZAÇÕES DOS AGENTES/);
    assert.match(nv.corpo, /class="depois"/, 'o destaque de antes/depois vale pros dois');

    /* 5) A nota do LoL continua inteira: bloco de campeao achado, preambulo fora, link no
     *    site do LoL. E o que ele usa hoje -- nao pode ter mudado. */
    const nl = await P.lerAtualizacao('lol-26-22', { elenco: [{ chave: 'Ahri', nome: 'Ahri' }] });
    assert.equal(nl.url, 'https://www.leagueoflegends.com/pt-br/news/game-updates/lol-26-22');
    assert.equal(nl.blocos.length, 1, 'o bloco da Ahri tinha que ser achado');
    assert.equal(nl.blocos[0].chave, 'ahri');
    assert.doesNotMatch(nl.corpo, /Destaques/, 'o preambulo do LoL sai');
    assert.match(nl.corpo, /href="https:\/\/www\.leagueoflegends\.com\/pt-br\/champions\/ahri\//);

    /* 6) Cada um no seu cache. Mesma pasta faria "indice.json" de um jogo responder pelo
     *    outro -- e o cache de indice vale 6 h, entao o estrago duraria. */
    const pastas = await readdir(resolve(base, 'dados'));
    assert.ok(pastas.includes('patchnotes'), `faltou a pasta do LoL: ${pastas.join(', ')}`);
    assert.ok(pastas.includes('patchnotes-val'), `faltou a pasta do Valorant: ${pastas.join(', ')}`);
    assert.deepEqual((await readdir(resolve(base, 'dados', 'patchnotes-val'))).sort(),
      ['indice.json', 'val-1309.json']);
    assert.deepEqual((await readdir(resolve(base, 'dados', 'patchnotes'))).sort(),
      ['indice.json', 'lol-26-22.json']);
  } finally {
    globalThis.fetch = buscaDeVerdade;
    if (antes === undefined) delete process.env.LOLCOACH_DIR; else process.env.LOLCOACH_DIR = antes;
  }
});

/* A tela de Patch do Valorant: as fichas de secao saem do DOM depois de o corpo entrar,
 * porque os titulos da Riot nao tem `id`. Se isso parar de pôr ancora, as fichas ficam
 * clicaveis e nao levam a lugar nenhum -- falha silenciosa, a pior. */
test('painel: as fichas de secao do patch do Valorant ganham ancora', async () => {
  const { funcoesDaTela } = await import('./pegar-funcao.mjs');

  const cercado = `
    const els = {};
    const achar = (k) => (els[k] ??= { innerHTML: '', titulos: [],
      querySelectorAll() { return this.titulos; } });
    const $ = (s) => achar(s);
    const esc = (s) => String(s ?? '');
    const carregando = () => 'carregando';
    const dia = (s) => String(s ?? '').slice(0, 10);
    let vpatchNotas = [], vpatchAberta = null;   // estado solto da tela
    let resposta = null;
    const pegar = async (u) => { if (resposta === 'erro') throw new Error('sem rede'); return resposta(u); };
    const extras = { els, responder: (r) => { resposta = r; }, aberta: () => vpatchAberta,
      titulo: (s) => vpatchTitulo(s), el: (k) => achar(k) };
  `;
  const t = await funcoesDaTela('painel.html',
    ['carregarValPatch', 'desenharListaValPatch', 'abrirNotaVal'], cercado, ['vpatchTitulo']);

  // o título perde o "do VALORANT" e o "Notas da", que só ocupam a lista
  assert.equal(t.titulo('Atualização 13.09 do VALORANT'), 'Atualização 13.09');
  assert.equal(t.titulo('Notas da Atualização 13.08'), 'Atualização 13.08');

  // três títulos, um deles já com id próprio e um vazio (que não vira ficha)
  const titulos = [
    { textContent: 'ATUALIZAÇÕES DOS AGENTES', id: '' },
    { textContent: 'DE ARMAS', id: 'jaTinha' },
    { textContent: '   ', id: '' },
  ];
  t.el('#vpatchCorpo').titulos = titulos;

  t.responder(async (u) => (u === '/api/val/patch'
    ? [{ slug: 'val-1309', titulo: 'Atualização 13.09 do VALORANT', data: '2026-10-27' }]
    : { corpo: '<h2>x</h2>', url: 'https://playvalorant.com/x' }));
  await t.carregarValPatch();
  /* `carregarValPatch` dispara `abrirNotaVal` SEM await (igual ao lado do LoL), entao a
   * nota ainda esta chegando quando ele volta. Sem esperar um tique, o teste media a tela
   * antes de ela existir. */
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(titulos[0].id, 'vpSec0', 'título sem id ganha âncora');
  assert.equal(titulos[1].id, 'jaTinha', 'título que já tinha id mantém o dele');
  const topo = t.els['#vpatchTopo'].innerHTML;
  assert.match(topo, /2 seções/, 'o título vazio não conta como seção');
  assert.match(topo, /irPara\('vpSec0'\)/);
  assert.match(topo, /irPara\('jaTinha'\)/);
  assert.equal(t.aberta(), 'val-1309', 'abre a mais nova sozinho');
  assert.match(t.els['#vpatchLista'].innerHTML, /Atualização 13\.09</);

  // uma seção só não merece barra de atalho
  t.el('#vpatchCorpo').titulos = [{ textContent: 'TUDO', id: '' }];
  await t.abrirNotaVal('val-1309');
  assert.equal(t.els['#vpatchTopo'].innerHTML, '');

  // sem rede não deixa "carregando" pra sempre
  t.responder('erro');
  await t.carregarValPatch();
  assert.match(t.els['#vpatchLista'].innerHTML, /sem internet/);

  // resposta que não é lista também não derruba a tela (já quebrou no lado do LoL)
  t.responder(async () => ({ qualquer: 'coisa' }));
  await t.carregarValPatch();
  assert.match(t.els['#vpatchLista'].innerHTML, /não vieram agora/);
  t.responder(async () => ({ erro: 'o site da Riot respondeu HTTP 503' }));
  await t.carregarValPatch();
  assert.match(t.els['#vpatchLista'].innerHTML, /HTTP 503/);
});

/* ------------------------------------------- o olho parou de culpar a tela cheia a toa
 *
 * MEDIDO no registro dele, 18 dias: o aviso "nao achei o minimapa (jogo em tela cheia
 * exclusiva? overlay por cima?)" saiu 14 vezes, TODAS entre 12,8 s e 28,4 s do inicio da
 * captura -- nenhuma depois. E em 13 das 14 o olho achou o minimapa logo em seguida.
 *
 * Ou seja: a mensagem so aparecia na janela em que ela nao quer dizer nada, e culpava a
 * configuracao dele. Agora espera a partida ter tempo de desenhar o minimapa.
 */
test('olho: so desconfia da tela cheia depois que a partida desenhou o minimapa', async () => {
  const { devoAvisarSemMinimapa, ESPERA_MINIMAPA } = await import('../src/vivo/olho.js');

  /* O teto sai da pior recuperacao medida (94 s do inicio da captura ate achar). Menos que
   * isso traria de volta os falsos alarmes. */
  assert.ok(ESPERA_MINIMAPA >= 94, `espera de ${ESPERA_MINIMAPA}s e menor que a pior recuperacao medida (94s)`);

  // os 14 alarmes reais: todos entre 12,8 e 28,4 s. Nenhum pode mais sair.
  for (const t of [12.8, 13.2, 16.1, 19.1, 28.4]) {
    assert.equal(devoAvisarSemMinimapa({ achou: false, tempoDeJogo: t, avisadoEm: 0 }), false,
      `aos ${t}s ainda nao da pra culpar a tela cheia`);
  }

  // passado o tempo, o aviso serve e sai
  assert.equal(devoAvisarSemMinimapa({ achou: false, tempoDeJogo: 200, avisadoEm: 0 }), true);

  // achou o minimapa: nunca avisa, por mais tarde que seja
  assert.equal(devoAvisarSemMinimapa({ achou: true, tempoDeJogo: 900, avisadoEm: 0 }), false);

  /* Sem tempo de jogo (fora de partida, ou o estado ainda nao chegou) nao avisa. Antes
   * isso nem era olhado -- e e justamente o comeco, quando o minimapa nao esta la. */
  assert.equal(devoAvisarSemMinimapa({ achou: false, tempoDeJogo: null, avisadoEm: 0 }), false);
  assert.equal(devoAvisarSemMinimapa({ achou: false, tempoDeJogo: undefined, avisadoEm: 0 }), false);
  assert.equal(devoAvisarSemMinimapa({ achou: false, tempoDeJogo: 0, avisadoEm: 0 }), false);

  // a cadencia de 30 s continua: o aviso nao vira enchente no registro
  const agora = 1_000_000;
  assert.equal(devoAvisarSemMinimapa({ achou: false, tempoDeJogo: 200, avisadoEm: agora - 5000, agora }), false);
  assert.equal(devoAvisarSemMinimapa({ achou: false, tempoDeJogo: 200, avisadoEm: agora - 31000, agora }), true);
});

/* ------------------------------------------- "tem janela na frente do jogo" tambem mentia
 *
 * Este aviso nao e so registro: vira FALA no meio da partida. A guarda que existia era o
 * tempo de JOGO (> 60 s), e ela nao cobre o caso real -- quando o app pega uma partida JA
 * EM ANDAMENTO (reconexao, ou o app abriu no meio), o tempo de jogo ja nasce alto e nao
 * segura nada, enquanto o olho ainda esta comecando.
 *
 * MEDIDO: 6 avisos em 18 dias. Os 2 que nao se resolveram dispararam 12 e 14 s depois de o
 * minimapa ser achado (34 s e 60 s de captura). Os outros 4 voltaram a enxergar em 0,5 a
 * 2,3 s -- minimapa vazio, nao janela na frente.
 */
test('olho: so culpa a janela depois que o olho esta enxergando ha um tempo', async () => {
  const { devoAvisarCego, ESPERA_OLHO } = await import('../src/vivo/olho.js');

  const agora = 1_000_000;
  const ha = (s) => agora - s * 1000;
  const base = { calib: true, cegoHa: 20, tempoDeJogo: 600, agora };

  /* Os dois casos REAIS do registro: 12 s e 14 s depois de achar o minimapa, com o tempo
   * de jogo ja alto (partida pega em andamento). Nenhum pode mais avisar. */
  assert.equal(devoAvisarCego({ ...base, calibDesde: ha(12) }), false, '12 s de olho aberto nao basta');
  assert.equal(devoAvisarCego({ ...base, calibDesde: ha(14) }), false, '14 s tambem nao');

  // enxergando ha tempo e cego mesmo assim: aviso legitimo, continua saindo
  assert.equal(devoAvisarCego({ ...base, calibDesde: ha(120) }), true);
  assert.equal(devoAvisarCego({ ...base, calibDesde: ha(ESPERA_OLHO) }), true, 'no limite, avisa');

  // sem minimapa nao e este aviso -- quem fala disso e o devoAvisarSemMinimapa
  assert.equal(devoAvisarCego({ ...base, calib: false, calibDesde: ha(300) }), false);

  // as guardas que ja existiam continuam valendo
  assert.equal(devoAvisarCego({ ...base, cegoHa: 14, calibDesde: ha(300) }), false, 'menos de 15 s cego, nao');
  assert.equal(devoAvisarCego({ ...base, tempoDeJogo: 30, calibDesde: ha(300) }), false, 'comeco de jogo, nao');

  // sem saber desde quando enxerga, nao inventa
  assert.equal(devoAvisarCego({ ...base, calibDesde: 0 }), false);
  assert.equal(devoAvisarCego({ ...base, calibDesde: undefined }), false);
  assert.equal(devoAvisarCego(), false);
});
