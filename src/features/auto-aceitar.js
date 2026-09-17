/**
 * Aceita o ready check sozinho.
 *
 * O atraso existe por dois motivos: dar a voce uma janela pra cancelar se mudar de
 * ideia, e nao aceitar em 0.0s toda vez. Nao aceita duas vezes a mesma fila.
 *
 * Assim como a seleção de campeão, isto NÃO confia só no WebSocket do client:
 * uma fila inteira passou sem ser aceita e sem uma linha no registro dizendo por
 * quê. Enquanto o ready check está aberto, o estado também é perguntado de
 * segundo em segundo — a janela é de 12s, perder o evento não é aceitável.
 */
// Os valores podem vir como função pra que mudar a configuração no painel
// valha na hora, sem reiniciar o app.
const valor = (v, padrao) => (typeof v === 'function' ? v() : v ?? padrao);

export function autoAceitar(lcu, { atrasoMs = 0, ativo = () => true, aoAceitar, log = () => {} } = {}) {
  let jaRespondido = false;
  let sonda = null;

  const pararSonda = () => { if (sonda) { clearInterval(sonda); sonda = null; } };

  async function avaliar(dados) {
    if (!dados) { jaRespondido = false; return; }

    // O client repete o evento varias vezes por segundo enquanto o timer corre.
    if (dados.state !== 'InProgress' || dados.playerResponse !== 'None') return;
    if (jaRespondido) return;
    if (!valor(ativo, true)) { jaRespondido = true; log('fila achou partida — aceitar sozinho está desligado'); return; }

    // partida personalizada / treino não tem aceite (o client dispara o evento mesmo assim e responde 500)
    const lobby = await lcu.get('/lol-lobby/v2/lobby').catch(() => null);
    if (lobby?.gameConfig?.isCustom) { jaRespondido = true; return; }
    jaRespondido = true;
    const espera = valor(atrasoMs, 0);
    log(`fila achou partida — aceitando em ${espera}ms`);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));

    try {
      await lcu.post('/lol-matchmaking/v1/ready-check/accept');
      aoAceitar?.(null);
    } catch (erro) {
      // Estourou o timer ou alguem recusou antes: libera pra proxima fila.
      jaRespondido = false;
      aoAceitar?.(erro);
    }
  }

  const avaliarSeguro = (dados) =>
    Promise.resolve().then(() => avaliar(dados)).catch((erro) => log(`erro ao aceitar: ${erro.message}`));

  lcu.observar('/lol-matchmaking/v1/ready-check', avaliarSeguro);

  lcu.observar('/lol-gameflow/v1/gameflow-phase', (f) => {
    if (f !== 'ReadyCheck') { pararSonda(); jaRespondido = false; return; }
    if (sonda) return;
    sonda = setInterval(async () => {
      try { await avaliarSeguro(await lcu.get('/lol-matchmaking/v1/ready-check')); }
      catch { /* 404 enquanto a janela abre é normal */ }
    }, 1000);
  });

  return lcu;
}
