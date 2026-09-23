import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Gera o instalador e publica como release no GitHub — é isso que dispara a
 * atualização automática em todo mundo que instalou.
 *
 * Token: usa GH_TOKEN se estiver no ambiente; senão pede ao Git Credential
 * Manager, que é onde o login do GitHub do PC já está guardado. O token nunca
 * é impresso nem gravado — vai só pro processo do electron-builder.
 *
 * Uso: `npm version patch && npm run publicar`
 */

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function tokenDoGit() {
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
  });
  const linha = (r.stdout ?? '').split('\n').find((l) => l.startsWith('password='));
  return linha ? linha.slice('password='.length).trim() : null;
}

const token = process.env.GH_TOKEN ?? tokenDoGit();
if (!token) {
  console.error('sem token do GitHub: defina GH_TOKEN ou faça login no Git Credential Manager (git push uma vez)');
  process.exit(1);
}

/**
 * As chaves vão junto no pacote (resources/chave.json): a da Riot, pra
 * ninguém precisar de chave própria, e o token do GitHub do repositório
 * privado de controle (painel admin). Saem do config do Gabriel, nunca do git.
 */
const { writeFileSync, readFileSync: ler } = await import('node:fs');
function doConfig(pega) {
  for (const arq of [
    new URL('../config.json', import.meta.url),
    `${process.env.APPDATA}\\LolCoach\\config.json`,
  ]) {
    try { const v = pega(JSON.parse(ler(arq, 'utf8'))); if (v) return v; } catch { /* próximo */ }
  }
  return null;
}
const chave = process.env.RIOT_KEY ?? doConfig((c) => c.riot?.apiKey);
if (!chave) { console.error('sem chave da Riot pra embutir: preencha riot.apiKey no config.json ou defina RIOT_KEY'); process.exit(1); }
// Sem o token o app continua funcionando, só não se apresenta nem obedece ao painel.
const githubToken = process.env.LOLCOACH_GH_TOKEN ?? doConfig((c) => c.controle?.githubToken);
if (!githubToken) console.warn('AVISO: sem controle.githubToken no config.json — o painel admin não vai funcionar nesta versão');
writeFileSync(new URL('../chave-embutida.json', import.meta.url),
  JSON.stringify({ apiKey: chave, ...(githubToken ? { githubToken } : {}) }) + '\n', 'utf8');
console.log(`chave da Riot embutida${githubToken ? ' + token do controle' : ''}`);

const { owner, repo } = pkg.build.publish[0];
const tag = `v${pkg.version}`;

/**
 * Cria a release ANTES de gerar: o electron-builder sobe o .exe e o .blockmap
 * em paralelo e, quando a release ainda não existe, cada envio cria a sua —
 * ficam duas com a mesma tag e o latest.yml numa só, e o atualizador não acha.
 */
const cab = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'LolCoach', 'Content-Type': 'application/json' };
const existente = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, { headers: cab });
if (existente.status === 404) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST', headers: cab,
    body: JSON.stringify({ tag_name: tag, name: tag, draft: false, prerelease: false }),
  });
  if (!r.ok) { console.error(`não consegui criar a release ${tag}: HTTP ${r.status}`); process.exit(1); }
  console.log(`release ${tag} criada`);
} else if (existente.ok) {
  console.log(`release ${tag} já existe — os arquivos vão pra ela`);
}

// trava: nenhum arquivo com erro de sintaxe sobe (scripts/conferir-sintaxe.mjs)
{ const c = spawnSync(process.execPath, ['scripts/conferir-sintaxe.mjs'], { stdio: 'inherit' }); if (c.status) process.exit(c.status); }
// trava 2: os testes têm que passar. Sintaxe passa em código errado — o canhão na
// onda errada e o suporte medido por CS passariam pelo --check sem reclamar.
{ const c = spawnSync(process.execPath, ['--test', 'scripts/testes.mjs'], { stdio: 'inherit' }); if (c.status) { console.error('teste falhou — não publica'); process.exit(c.status); } }
console.log(`publicando LolCoach v${pkg.version} em ${owner}/${repo}…`);
const r = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'], {
  stdio: 'inherit', shell: true,
  env: { ...process.env, GH_TOKEN: token },
});
if (r.status) process.exit(r.status);

// Confere o que o atualizador vai ver.
const latest = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers: cab }).then((x) => x.json());
const nomes = (latest.assets ?? []).map((a) => a.name);
console.log(`latest = ${latest.tag_name}: ${nomes.join(', ')}`);
if (latest.tag_name !== tag || !nomes.includes('latest.yml')) {
  console.error(`ALGO ERRADO: rode "node scripts/github.js arrumar-release ${tag}"`);
  process.exit(1);
}

// Ninguém fica em versão velha: a versão mínima do painel de controle passa a ser a que acabou de sair.
// Quem está abaixo vê o aviso na hora e o app dele procura/instala a atualização imediatamente.
if (githubToken) {
  try {
    const { lerControle, gravarControle } = await import('../src/dados/controle.js');
    const controle = await lerControle(githubToken);
    if (controle.versaoMinima !== pkg.version) {
      await gravarControle(githubToken, { ...controle, versaoMinima: pkg.version });
      console.log(`versão mínima no controle: ${pkg.version}`);
    }
  } catch (e) { console.warn(`não consegui subir a versão mínima no controle: ${e.message}`); }
}
