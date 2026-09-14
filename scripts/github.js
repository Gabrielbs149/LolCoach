import { spawnSync } from 'node:child_process';

/**
 * Chamadas mínimas à API do GitHub com o login que já está no PC (Git
 * Credential Manager). O token não é impresso nem gravado em lugar nenhum.
 *
 *   node scripts/github.js quem
 *   node scripts/github.js criar-repo <nome> [--privado]
 */

function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const r = spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const l = (r.stdout ?? '').split('\n').find((x) => x.startsWith('password='));
  return l ? l.slice(9).trim() : null;
}

async function api(metodo, caminho, corpo) {
  const t = token();
  if (!t) throw new Error('sem login do GitHub no PC');
  const r = await fetch(`https://api.github.com${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'User-Agent': 'LolCoach', 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${metodo} ${caminho} → HTTP ${r.status}: ${j.message ?? ''}`);
  return j;
}

const [, , cmd, ...args] = process.argv;

if (cmd === 'quem') {
  const u = await api('GET', '/user');
  console.log(`logado como ${u.login}`);
} else if (cmd === 'criar-repo') {
  const nome = args[0];
  const privado = args.includes('--privado');
  const r = await api('POST', '/user/repos', {
    name: nome, private: privado, has_issues: true, has_wiki: false,
    description: 'Ferramenta de LoL: automação do client + análise das suas partidas + builds do op.gg',
  });
  console.log(`repositório criado: ${r.html_url} (${privado ? 'privado' : 'público'})`);
} else if (cmd === 'arrumar-release') {
  // O electron-builder às vezes cria DUAS releases pra mesma tag (uma corrida
  // ao publicar) e os arquivos ficam divididos. O atualizador lê a "latest" e,
  // se o latest.yml não estiver nela, ninguém recebe a atualização. Junta tudo
  // numa só, subindo o que faltar da pasta build/, e apaga a sobra.
  const tag = args[0];
  if (!tag) throw new Error('uso: arrumar-release v1.2.3');
  const { readFile } = await import('node:fs/promises');
  const { basename } = await import('node:path');
  const dono = 'Gabrielbs149', repo = 'LolCoach';

  const todas = (await api('GET', `/repos/${dono}/${repo}/releases?per_page=50`)).filter((r) => r.tag_name === tag);
  if (!todas.length) throw new Error(`nenhuma release com a tag ${tag}`);
  todas.sort((a, b) => b.assets.length - a.assets.length);
  const [principal, ...sobras] = todas;
  const nomes = new Set(principal.assets.map((a) => a.name));

  const versao = tag.replace(/^v/, '');
  for (const arquivo of [`LolCoach-Setup-${versao}.exe`, `LolCoach-Setup-${versao}.exe.blockmap`, 'latest.yml']) {
    if (nomes.has(arquivo)) continue;
    const corpo = await readFile(`build/${arquivo}`);
    const url = principal.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(basename(arquivo))}`;
    const r = await fetch(url, {
      method: 'POST', body: corpo,
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/octet-stream', 'User-Agent': 'LolCoach' },
    });
    if (!r.ok) throw new Error(`subindo ${arquivo}: HTTP ${r.status}`);
    console.log(`subiu ${arquivo}`);
  }
  for (const s of sobras) {
    await api('DELETE', `/repos/${dono}/${repo}/releases/${s.id}`);
    console.log(`apagou a release repetida ${s.id} (${s.assets.map((a) => a.name).join(', ') || 'vazia'})`);
  }
  const final = await api('GET', `/repos/${dono}/${repo}/releases/latest`);
  console.log(`latest: ${final.tag_name} com ${final.assets.map((a) => a.name).join(', ')}`);
} else {
  console.log('uso: quem | criar-repo <nome> [--privado] | arrumar-release <tag>');
  process.exit(1);
}
