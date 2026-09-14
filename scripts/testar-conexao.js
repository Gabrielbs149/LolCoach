import { LcuClient } from '../src/lcu/client.js';
import { autoAceitar } from '../src/features/auto-aceitar.js';

const lcu = new LcuClient();

lcu.on('conectado', (c) => console.log(`\n[ok] conectado ao client (porta ${c.porta}, via ${c.origem})`));
lcu.on('desconectado', () => console.log('[!] client fechou - esperando reabrir...'));

await lcu.conectar();

const eu = await lcu.get('/lol-summoner/v1/current-summoner').catch(() => null);
const fase = await lcu.get('/lol-gameflow/v1/gameflow-phase').catch(() => null);

console.log(`     invocador : ${eu ? `${eu.gameName}#${eu.tagLine} (nivel ${eu.summonerLevel})` : 'nao logado'}`);
console.log(`     fase atual: ${fase ?? 'desconhecida'}`);

autoAceitar(lcu, {
  aoAceitar: (erro) => console.log(erro ? `[x] falhou ao aceitar: ${erro.message}` : '[ok] partida aceita automaticamente'),
});

// Mostra as trocas de fase pra confirmar que o WebSocket esta vivo.
lcu.observar('/lol-gameflow/v1/gameflow-phase', (f) => console.log(`     -> fase: ${f}`));

console.log('\nauto-aceitar ligado. entre numa fila pra testar. ctrl+c pra sair.\n');
