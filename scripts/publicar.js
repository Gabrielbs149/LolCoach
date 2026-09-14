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

console.log(`publicando LolCoach v${pkg.version} em ${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}…`);
const r = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'], {
  stdio: 'inherit', shell: true,
  env: { ...process.env, GH_TOKEN: token },
});
process.exit(r.status ?? 1);
