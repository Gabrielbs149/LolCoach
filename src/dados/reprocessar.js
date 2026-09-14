import { criarPartida } from '../analise/partida.js';
import { analisar } from '../analise/detectores.js';
import { zonaRelativa } from '../analise/mapa.js';

/**
 * Roda os detectores de novo em cima do que já está no banco, sem tocar na API.
 *
 * Frames e eventos já foram salvos, então mudar um detector não deveria custar
 * meia hora de chamadas. Use sempre que mexer em `src/analise/detectores.js` —
 * senão partidas antigas ficam com achados de uma versão velha do código e a
 * comparação entre elas mede o código, não o jogo.
 */
export function reprocessarTudo(db, { fila = null, aoProgresso } = {}) {
  const partidas = db.prepare(`
    SELECT * FROM partidas WHERE duracaoS >= 300 ${fila ? 'AND fila = ?' : ''}
    ORDER BY quando DESC`).all(...(fila ? [fila] : []));

  const qJogadores = db.prepare('SELECT * FROM jogadores WHERE gameId = ? ORDER BY participantId');
  const qFrames = db.prepare('SELECT * FROM frames WHERE gameId = ? ORDER BY minuto, participantId');
  const qEventos = db.prepare('SELECT * FROM eventos WHERE gameId = ? ORDER BY t');
  const apagaAchados = db.prepare('DELETE FROM achados WHERE gameId = ?');
  const insAchado = db.prepare(`INSERT OR REPLACE INTO achados
    (gameId, t, tipo, gravidade, titulo, motivos, zona) VALUES (?,?,?,?,?,?,?)`);

  let feitas = 0, total = 0, erros = 0;

  for (const p of partidas) {
    try {
      const jogadores = qJogadores.all(p.gameId).map((j) => ({
        id: j.participantId, time: j.time, championId: j.championId,
        campeao: j.campeao, nome: j.nome, role: null,
        spells: [], // não são gravados; a role salva serve de dica mais abaixo
        stats: {
          kills: j.kills, deaths: j.deaths, assists: j.assists,
          totalMinionsKilled: j.cs, neutralMinionsKilled: 0,
          goldEarned: j.ouro, totalDamageDealtToChampions: j.dano,
          visionScore: j.visao, wardsPlaced: j.wards,
        },
        rolePrevia: j.role,
      }));

      const porFrame = new Map();
      for (const f of qFrames.all(p.gameId)) {
        if (!porFrame.has(f.minuto)) porFrame.set(f.minuto, { t: f.t, minuto: f.t / 60000, pos: {}, dados: {} });
        const alvo = porFrame.get(f.minuto);
        alvo.pos[f.participantId] = { x: f.x, y: f.y };
        alvo.dados[f.participantId] = {
          nivel: f.nivel, ouro: f.ouro, ouroTotal: f.ouroTotal,
          cs: f.cs, csSelva: f.csSelva, xp: f.xp,
        };
      }
      const frames = [...porFrame.values()].sort((a, b) => a.t - b.t);

      const eventos = qEventos.all(p.gameId).map((e) => ({
        tipo: e.tipo, t: e.t, minuto: e.t / 60000,
        pos: e.x === null ? null : { x: e.x, y: e.y },
        autorId: e.autorId, vitimaId: e.vitimaId, assists: [],
        monstro: e.monstro, predio: e.predio, torre: e.torre, rota: e.rota,
        timeVitima: e.timeVitima, wardType: e.wardType, itemId: e.itemId,
        skillSlot: e.skillSlot,
        danoRecebido: e.danoRecebido ? JSON.parse(e.danoRecebido) : null,
      }));

      const partida = criarPartida({
        gameId: p.gameId, fila: p.fila, duracaoS: p.duracaoS,
        vencedor: p.vencedor, jogadores, frames, eventos,
      });

      // Sem os feitiços salvos a dedução erra o caçador; a role gravada na
      // coleta veio do dado completo, então ela manda.
      for (const j of partida.jogadores) if (j.rolePrevia) j.role = j.rolePrevia;

      const eu = partida.jogador(p.meuId);
      if (!eu) { erros++; continue; }

      const achados = analisar(partida, eu);
      const zonaDe = (a) => {
        if (a.tipo === 'morte') {
          const ev = partida.eventos.find((e) => e.tipo === 'CHAMPION_KILL' && e.vitimaId === eu.id && e.t === a.t);
          if (ev?.pos) return zonaRelativa(ev.pos, eu.time);
        }
        const pos = partida.frameEm(a.t).pos[eu.id];
        return pos ? zonaRelativa(pos, eu.time) : null;
      };

      db.exec('BEGIN');
      apagaAchados.run(p.gameId);
      for (const a of achados) {
        insAchado.run(p.gameId, a.t, a.tipo, a.gravidade, a.titulo, a.motivos.join(' | '), zonaDe(a));
      }
      db.exec('COMMIT');

      feitas++;
      total += achados.length;
      if (feitas % 100 === 0) aoProgresso?.({ feitas, de: partidas.length });
    } catch (erro) {
      try { db.exec('ROLLBACK'); } catch {}
      erros++;
    }
  }

  return { feitas, total, erros, de: partidas.length };
}
