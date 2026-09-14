import { carregarPartida, partidasRecentes } from '../analise/partida.js';
import { analisar } from '../analise/detectores.js';
import { zonaRelativa } from '../analise/mapa.js';
import { idsColetados, salvarPartida } from './banco.js';

/** Acha o jogador da conta logada dentro da partida. */
function acharEu(partida, summoner) {
  return partida.jogadores.find((j) => j.nome === summoner.gameName)
    ?? partida.jogadores.find((j) => j.nome === summoner.displayName)
    ?? null;
}

/**
 * A zona de um achado. Pra morte usamos a posição exata do evento; pro resto,
 * a posição do frame mais próximo, que é o melhor que a timeline oferece.
 */
function fazerZonaDe(partida, eu) {
  return (a) => {
    if (a.tipo === 'morte') {
      const ev = partida.eventos.find((e) => e.tipo === 'CHAMPION_KILL' && e.vitimaId === eu.id && e.t === a.t);
      if (ev?.pos) return zonaRelativa(ev.pos, eu.time);
    }
    const pos = partida.frameEm(a.t).pos[eu.id];
    return pos ? zonaRelativa(pos, eu.time) : null;
  };
}

/** Processa uma partida e grava no banco. Devolve o resumo do que foi salvo. */
export async function coletarUma(lcu, db, gameId, { summoner, quando } = {}) {
  const eu0 = summoner ?? await lcu.get('/lol-summoner/v1/current-summoner');
  const partida = await carregarPartida(lcu, gameId);
  const eu = acharEu(partida, eu0);
  if (!eu) throw new Error(`conta ${eu0.gameName} não aparece na partida ${gameId}`);

  const achados = analisar(partida, eu);
  salvarPartida(db, { partida, eu, achados, quando, zonaDe: fazerZonaDe(partida, eu) });

  return {
    gameId, campeao: eu.campeao, role: eu.role,
    venci: partida.vencedor === eu.time,
    achados: achados.length,
    graves: achados.filter((a) => a.gravidade === 3).length,
  };
}

/**
 * Coleta tudo que o client ainda tem em cache e ainda não está no banco.
 * O cache do client guarda poucas partidas, então isso precisa rodar com
 * frequência pra não perder histórico.
 */
export async function coletarPendentes(lcu, db, { quantas = 20, forcar = false, aoSalvar, aoPular, somenteConta = null } = {}) {
  const summoner = await lcu.get('/lol-summoner/v1/current-summoner');

  // O client coleta as partidas de QUEM ESTIVER LOGADO. Sem este corte, uma
  // conta emprestada ou um smurf entra no banco como se fosse a conta
  // principal — aconteceu: 22 partidas de "o vel da noite" misturaram nas
  // estatísticas do roIindo antes de alguém notar.
  if (somenteConta && String(summoner.gameName).toLowerCase() !== String(somenteConta).toLowerCase()) {
    const erro = new Error(`client logado como ${summoner.gameName}#${summoner.tagLine}, não ${somenteConta} — partidas ignoradas`);
    aoPular?.({ gameId: null }, erro);
    throw erro;
  }
  const recentes = await partidasRecentes(lcu, quantas);
  const jaTem = idsColetados(db);

  const salvos = [];
  for (const r of recentes) {
    if (!forcar && jaTem.has(r.gameId)) { aoPular?.(r); continue; }
    // Remake: ninguém tomou decisão nenhuma, só polui a média.
    if (r.duracaoS < 300) { aoPular?.(r, new Error('remake / partida abortada')); continue; }
    try {
      const resumo = await coletarUma(lcu, db, r.gameId, { summoner, quando: r.quando });
      salvos.push(resumo);
      aoSalvar?.(resumo);
    } catch (erro) {
      aoPular?.(r, erro);
    }
  }
  return salvos;
}
