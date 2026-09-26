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

test('leitura do olho: só vira fala de rota com anel ou casamento alto', async () => {
  const { leituraForte } = await import('../src/vivo/situacoes.js');
  assert.equal(leituraForte(null), false);
  assert.equal(leituraForte({}), false);
  // anel colorido: terreno não tem, então basta
  assert.equal(leituraForte({ ultimo: { anel: true, score: 0.7 } }), true);
  // sem anel e casamento fraco (o caso do fantasma travado): não fala
  assert.equal(leituraForte({ ultimo: { anel: false, score: 0.7 } }), false);
  // sem anel mas casamento alto: fala
  assert.equal(leituraForte({ ultimo: { anel: false, score: 0.9 } }), true);
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
