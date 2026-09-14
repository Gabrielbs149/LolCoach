import { iniciarDaemon } from '../src/daemon.js';
import { criarServidor, criarEstado } from '../src/ui/servidor.js';

const estado = criarEstado();
const app = await iniciarDaemon({ estado });
const { url } = await criarServidor({
  db: app.db, estado, porta: 8770,
  acoes: app.acoes,
});

const c = app.config;
console.log(`
painel: ${url}

  aceitar fila      ${c.autoAceitar.ativo ? `sim (${c.autoAceitar.atrasoMs}ms)` : 'nao'}
  banir             ${c.champSelect.ativo ? 'sim, travando' : 'nao'}
  escolher campeao  ${c.champSelect.ativo ? (c.champSelect.travarPick ? 'sim, travando' : 'sim, so declara (voce trava)') : 'nao'}
  runas do op.gg    ${c.runas.ativo ? `sim (criterio: ${c.runas.criterio}${c.runas.paginaAlvo ? `, sobrescrevendo "${c.runas.paginaAlvo}"` : ''})` : 'nao'}
  coletar partidas  ${c.coleta.ativo ? 'sim' : 'nao'}

ctrl+c pra sair.
`);

process.on('SIGINT', () => { app.fechar(); process.exit(0); });
