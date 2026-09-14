import { writeFile } from 'node:fs/promises';
import { abrirBanco } from '../src/dados/banco.js';
import { role } from '../src/analise/linguagem.js';

/**
 * Padrões entre partidas.
 *
 *   node scripts/padroes.js          todas as filas
 *   node scripts/padroes.js 420      só ranqueada solo
 *   node scripts/padroes.js 440      só flex
 *
 * Misturar filas engana quando o nível é diferente em cada uma, então quando há
 * as duas na base o relatório fecha com uma comparação lado a lado.
 */

const FILAS = { 420: 'Solo/Duo', 440: 'Flex', 400: 'Normal', 430: 'Normal', 450: 'ARAM', 490: 'Rápida' };
const L = [];
const push = (...s) => L.push(...s);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

const db = abrirBanco();
const filaPedida = process.argv[2] ? Number(process.argv[2]) : null;

// Só partida de verdade entra: remake não tem decisão pra analisar.
const base = (fila = filaPedida) => `duracaoS >= 300${fila ? ` AND fila = ${fila}` : ''}`;

const total = db.prepare(`SELECT COUNT(*) n FROM partidas WHERE ${base()}`).get().n;
if (!total) {
  console.log('Sem partidas suficientes no banco. Rode `npm run historico -- 250 420` primeiro.');
  process.exit(0);
}

const geral = db.prepare(`
  SELECT COUNT(*) n, SUM(venci) v, MIN(quando) de, MAX(quando) ate, SUM(duracaoS)/3600.0 horas
  FROM partidas WHERE ${base()}`).get();

push(`# Padrões entre partidas`, '',
  filaPedida ? `Fila: **${FILAS[filaPedida] ?? filaPedida}**` : 'Todas as filas',
  '',
  `${geral.n} partidas · ${geral.v}V ${geral.n - geral.v}D (${pct(geral.v, geral.n)} de vitória) · ${geral.horas.toFixed(1)}h de jogo`,
  `De ${geral.de?.slice(0, 10) ?? '?'} a ${geral.ate?.slice(0, 10) ?? '?'}`, '');

const contarAchados = (onde, extra = '') => db.prepare(`
  SELECT COUNT(*) t, SUM(CASE WHEN gravidade = 3 THEN 1 ELSE 0 END) g
  FROM achados WHERE gameId IN (SELECT gameId FROM partidas WHERE ${onde}${extra})`).get();

/* ---------------------------------------------------------------- roles */
push('## Por role', '', '| role | jogos | vitórias | achados/jogo | graves/jogo |', '|---|---:|---:|---:|---:|');
for (const r of db.prepare(`
  SELECT minhaRole role, COUNT(*) n, SUM(venci) v FROM partidas
  WHERE ${base()} GROUP BY minhaRole ORDER BY n DESC`).all()) {
  const a = contarAchados(base(), ` AND minhaRole = '${r.role}'`);
  push(`| ${role(r.role)} | ${r.n} | ${r.v} (${pct(r.v, r.n)}) | ${(a.t / r.n).toFixed(1)} | ${(a.g / r.n).toFixed(1)} |`);
}
push('');

/* ------------------------------------------------------------- campeões */
push('## Campeões mais jogados', '', '| campeão | jogos | vitórias | graves/jogo |', '|---|---:|---:|---:|');
for (const c of db.prepare(`
  SELECT meuCampeao c, COUNT(*) n, SUM(venci) v FROM partidas
  WHERE ${base()} GROUP BY meuCampeao HAVING n >= 3 ORDER BY n DESC LIMIT 12`).all()) {
  const a = contarAchados(base(), ` AND meuCampeao = '${c.c.replace(/'/g, "''")}'`);
  push(`| ${c.c} | ${c.n} | ${c.v} (${pct(c.v, c.n)}) | ${(a.g / c.n).toFixed(1)} |`);
}
push('');

/* ---------------------------------------------------------- tipos de erro */
push('## O que mais se repete', '', '| tipo | ocorrências | por jogo | em quantos jogos |', '|---|---:|---:|---:|');
for (const t of db.prepare(`
  SELECT tipo, COUNT(*) n, COUNT(DISTINCT gameId) jogos FROM achados
  WHERE gameId IN (SELECT gameId FROM partidas WHERE ${base()})
  GROUP BY tipo ORDER BY n DESC`).all()) {
  push(`| ${t.tipo} | ${t.n} | ${(t.n / total).toFixed(1)} | ${t.jogos}/${total} (${pct(t.jogos, total)}) |`);
}
push('');

/* ------------------------------------------------------------- mortes */
const mortesTot = db.prepare(`
  SELECT COUNT(*) n FROM achados WHERE tipo = 'morte'
  AND gameId IN (SELECT gameId FROM partidas WHERE ${base()})`).get().n;

push('## Onde você morre', '', '| zona | mortes | % |', '|---|---:|---:|');
for (const z of db.prepare(`
  SELECT zona, COUNT(*) n FROM achados WHERE tipo = 'morte' AND zona IS NOT NULL
  AND gameId IN (SELECT gameId FROM partidas WHERE ${base()})
  GROUP BY zona ORDER BY n DESC LIMIT 10`).all()) {
  push(`| ${z.zona} | ${z.n} | ${pct(z.n, mortesTot)} |`);
}
push('');

push('## Quando você morre', '', '| faixa | mortes | por jogo |', '|---|---:|---:|');
for (const f of db.prepare(`
  SELECT CASE
    WHEN t <  600000 THEN '00-10 min'
    WHEN t < 1200000 THEN '10-20 min'
    WHEN t < 1800000 THEN '20-30 min'
    ELSE '30+ min' END faixa, COUNT(*) n
  FROM achados WHERE tipo = 'morte'
  AND gameId IN (SELECT gameId FROM partidas WHERE ${base()})
  GROUP BY faixa ORDER BY faixa`).all()) {
  push(`| ${f.faixa} | ${f.n} | ${(f.n / total).toFixed(1)} |`);
}
push('');

/* -------------------------------------------------------- vitória x derrota */
push('## Vitória x derrota', '', '| | jogos | achados/jogo | graves/jogo | mortes/jogo |', '|---|---:|---:|---:|---:|');
for (const [rot, venci] of [['Vitórias', 1], ['Derrotas', 0]]) {
  const n = db.prepare(`SELECT COUNT(*) n FROM partidas WHERE ${base()} AND venci = ${venci}`).get().n;
  if (!n) continue;
  const a = contarAchados(base(), ` AND venci = ${venci}`);
  const m = db.prepare(`
    SELECT COUNT(*) n FROM achados WHERE tipo = 'morte'
    AND gameId IN (SELECT gameId FROM partidas WHERE ${base()} AND venci = ${venci})`).get().n;
  push(`| ${rot} | ${n} | ${(a.t / n).toFixed(1)} | ${(a.g / n).toFixed(1)} | ${(m / n).toFixed(1)} |`);
}
push('');

/* ------------------------------------------------------ solo x flex */
if (!filaPedida) {
  const filas = db.prepare(`
    SELECT fila, COUNT(*) n FROM partidas WHERE duracaoS >= 300 AND fila IN (420, 440)
    GROUP BY fila HAVING n >= 20`).all();

  if (filas.length === 2) {
    push('## Solo/Duo x Flex', '',
      'Mesmo jogador, contextos diferentes. Se o erro só aparece numa das filas, é',
      'situacional; se aparece nas duas, é hábito.', '',
      '| | Solo/Duo | Flex |', '|---|---:|---:|');

    const dados = {};
    for (const f of [420, 440]) {
      const g = db.prepare(`SELECT COUNT(*) n, SUM(venci) v FROM partidas WHERE ${base(f)}`).get();
      const a = contarAchados(base(f));
      const m = db.prepare(`
        SELECT COUNT(*) n FROM achados WHERE tipo = 'morte'
        AND gameId IN (SELECT gameId FROM partidas WHERE ${base(f)})`).get().n;
      dados[f] = { ...g, ...a, mortes: m };
    }
    const linha = (rot, fn) => push(`| ${rot} | ${fn(dados[420])} | ${fn(dados[440])} |`);
    linha('Partidas', (d) => d.n);
    linha('Vitórias', (d) => `${d.v} (${pct(d.v, d.n)})`);
    linha('Erros graves por jogo', (d) => (d.g / d.n).toFixed(1));
    linha('Mortes por jogo', (d) => (d.mortes / d.n).toFixed(1));
    push('');

    push('| tipo de erro | Solo/Duo | Flex |', '|---|---:|---:|');
    const tipos = db.prepare(`
      SELECT DISTINCT tipo FROM achados
      WHERE gameId IN (SELECT gameId FROM partidas WHERE duracaoS >= 300)`).all().map((r) => r.tipo);
    for (const tipo of tipos) {
      const taxa = (f) => {
        const n = db.prepare(`
          SELECT COUNT(*) n FROM achados WHERE tipo = ?
          AND gameId IN (SELECT gameId FROM partidas WHERE ${base(f)})`).get(tipo).n;
        return (n / dados[f].n).toFixed(2);
      };
      push(`| ${tipo} | ${taxa(420)} | ${taxa(440)} |`);
    }
    push('');
  }
}

/* ---------------------------------------------------------- plano de treino */

// Um erro que aparece em 8% dos jogos é ruído; em 50% é hábito. O plano só
// entra em coisa que se repete de verdade.
const TREINO = {
  'sem-visao-antes-de-entrar': {
    titulo: 'Ward antes de cruzar o river',
    texto: 'Toda vez que for pro lado deles, coloque uma ward antes — mesmo parecendo seguro, mesmo com vantagem. Essas mortes acontecem exatamente onde faltou a informação que a ward daria.',
    treino: 'Nos próximos 10 jogos: antes de atravessar o river, olhe o item de visão. Se estiver em cooldown, não atravessa.',
  },
  'primeiro-a-cair': {
    titulo: 'Não seja quem abre a briga morrendo',
    texto: 'Quem cai primeiro decide quem perde a briga. O time inteiro luta em desvantagem numérica desde o primeiro segundo.',
    treino: 'Nos próximos 10 jogos: espere eles gastarem o primeiro flash ou a primeira ult antes de entrar. Conte até isso acontecer.',
  },
  morte: {
    // Sem este filtro o número contaria TODA morte, e aí o texto falaria de
    // mortes isoladas exibindo a estatística de mortes em geral.
    filtro: "titulo LIKE '%sozinho%'",
    titulo: 'Reduzir mortes isoladas',
    texto: 'Essas são as mortes em que nenhum aliado estava a uma tela. Não é erro de mecânica, é decisão de onde estar.',
    treino: 'Nos próximos 10 jogos: antes de andar pra frente, acha um aliado a menos de uma tela. Sem isso, recua.',
  },
  'briga-sem-voce': {
    titulo: 'Estar onde o time está',
    texto: 'Perder briga com você vivo e longe é 4v5 por escolha. Ou vai junto, ou pega algo que valha mais que a briga.',
    treino: 'Nos próximos 10 jogos: quando 3 aliados se juntarem no mapa, decide na hora — vou junto ou pego torre. Não fica no meio-termo.',
  },
  'objetivo-sem-voce': {
    titulo: 'Chegar antes do objetivo nascer',
    texto: 'Dragão e barão têm timer. Chegar depois que a briga começou é o mesmo que não ter ido.',
    treino: 'Nos próximos 10 jogos: 30 segundos antes do spawn, comece a rotacionar. Larga a wave, o farm volta.',
  },
  'ritmo-de-selva': {
    titulo: 'Terminar o clear antes de sair',
    texto: 'Camp é gold garantido; gank duvidoso é aposta. Ficar atrás do jungler inimigo em farm atrasa tudo.',
    treino: 'Nos próximos 10 jogos de jungle: só sai pra gank se a lane tiver prio ou o inimigo estiver sem flash.',
  },
  'visao-atras': {
    titulo: 'Comprar ward rosa todo recall',
    texto: '75 de gold apagam a visão inteira de um objetivo. É o item com melhor retorno do jogo.',
    treino: 'Nos próximos 10 jogos: todo recall, compra uma. Sem exceção.',
  },
};

{
  // Cada tipo é contado com o seu próprio filtro, pra que o número exibido
  // meça exatamente o que o texto do conselho afirma.
  const recorrentes = Object.entries(TREINO).map(([tipo, c]) => {
    const r = db.prepare(`
      SELECT COUNT(*) n, COUNT(DISTINCT gameId) jogos, AVG(gravidade) g
      FROM achados WHERE tipo = ? ${c.filtro ? `AND ${c.filtro}` : ''}
      AND gameId IN (SELECT gameId FROM partidas WHERE ${base()})`).get(tipo);
    return { tipo, ...r };
  })
    .filter((t) => t.jogos / total >= 0.25)
    .sort((a, b) => (b.jogos / total) * b.g - (a.jogos / total) * a.g)
    .slice(0, 3);

  if (recorrentes.length) {
    push('## Plano de treino', '',
      `Os erros abaixo se repetem em pelo menos um quarto das suas ${total} partidas.`,
      'Não são deslizes de uma partida ruim — são hábitos.', '');

    recorrentes.forEach((t, i) => {
      const c = TREINO[t.tipo];
      push(`### ${i + 1}. ${c.titulo}`, '',
        `Aparece em **${t.jogos} de ${total} partidas (${pct(t.jogos, total)})**, ${(t.n / total).toFixed(1)} vez${t.n / total >= 2 ? 'es' : ''} por jogo.`, '',
        c.texto, '',
        `**Treino:** ${c.treino}`, '');
    });
  }
}

/* -------------------------------------------------------- piores partidas */
push('## Partidas com mais erros graves', '');
for (const p of db.prepare(`
  SELECT p.gameId, p.meuCampeao, p.minhaRole, p.venci, p.quando, p.fila,
         (SELECT COUNT(*) FROM achados a WHERE a.gameId = p.gameId AND a.gravidade = 3) g
  FROM partidas p WHERE ${base()} ORDER BY g DESC LIMIT 5`).all()) {
  push(`- **${p.g} graves** — ${p.meuCampeao} ${p.minhaRole}, ${p.venci ? 'vitória' : 'derrota'}, ${FILAS[p.fila] ?? p.fila}, ${p.quando?.slice(0, 10) ?? '?'}  \`npm run ver -- ${p.gameId}\``);
}
push('');

const texto = L.join('\n');
const arquivo = filaPedida ? `padroes-${filaPedida}.md` : 'padroes.md';
await writeFile(arquivo, texto, 'utf8');
process.stdout.write(texto + `\n\nSalvo em ${arquivo}\n`);
db.close();
