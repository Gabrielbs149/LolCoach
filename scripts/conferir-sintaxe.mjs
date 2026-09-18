/**
 * Trava de segurança antes de publicar: nenhum arquivo de código sobe com erro de sintaxe.
 * (A 2.28.126 saiu com o electron/main.js quebrado e o app de quem atualizou não abria mais.)
 * Confere todo .js/.mjs/.cjs e o <script> de todo .html em src/, electron/ e scripts/.
 * Uso: node scripts/conferir-sintaxe.mjs  (sai com 1 se achar erro)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const arquivos = [];
const varrer = (d) => { for (const n of readdirSync(d)) { const c = join(d, n); if (statSync(c).isDirectory()) { if (n !== 'node_modules') varrer(c); } else if (/\.(js|mjs|cjs|html)$/.test(n)) arquivos.push(c); } };
for (const d of ['src', 'electron', 'scripts']) varrer(d);

const erros = [];
const tmp = join(tmpdir(), `lolcoach-sintaxe-${process.pid}.mjs`);
for (const a of arquivos) {
  try {
    if (a.endsWith('.html')) {
      const m = readFileSync(a, 'utf8').match(/<script>([\s\S]*)<\/script>/);
      if (!m) continue;
      writeFileSync(tmp, m[1]);
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } else {
      execFileSync(process.execPath, ['--check', a], { stdio: 'pipe' });
    }
  } catch (e) {
    erros.push(`${a}: ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 300)}`);
  }
}
try { rmSync(tmp, { force: true }); } catch { /* já foi */ }
if (erros.length) { console.error(`ERRO DE SINTAXE em ${erros.length} arquivo(s) — não publica:\n` + erros.join('\n')); process.exit(1); }
console.log(`sintaxe ok em ${arquivos.length} arquivos`);
