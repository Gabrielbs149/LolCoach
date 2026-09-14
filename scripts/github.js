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
} else {
  console.log('uso: quem | criar-repo <nome> [--privado]');
  process.exit(1);
}
