import { carregarPartidaDaRiot } from './riot.js';
import { idsColetados, salvarPartida } from './banco.js';
import { analisar } from '../analise/detectores.js';
import { zonaRelativa } from '../analise/mapa.js';

/**
 * Puxa histórico profundo pela API da Riot.
 *
 * O client guarda ~20 partidas e depois esquece; aqui dá pra descer centenas.
 * O ritmo é ditado pelo limite da chave (100 chamadas a cada 2 minutos, duas
 * por partida), então algumas centenas levam minutos — é limite, não lentidão.
 */
export async function backfillHistorico(riot, db, {
  quantas = 250, fila = 420, gameName, tagLine,
  refazerTudo = false, aoSalvar, aoPular, aoContar,
} = {}) {
  const conta = await riot.contaPorRiotId(gameName, tagLine);
  if (!conta) throw new Error(`não achei a conta ${gameName}#${tagLine}`);

  const ids = [];
  for (let inicio = 0; ids.length < quantas; inicio += 100) {
    const lote = await riot.idsDePartidas(conta.puuid, { inicio, quantas: 100, fila });
    if (!lote?.length) break;
    ids.push(...lote);
    if (lote.length < 100) break;
  }
  ids.length = Math.min(ids.length, quantas);

  // Partidas que entraram pela LCU têm dado pobre (sem ward, sem detalhe de
  // dano); vale refazer pela API mesmo já estando no banco.
  const pobres = new Set(db.prepare("SELECT gameId FROM partidas WHERE fonte IS NULL OR fonte != 'riot'").all().map((r) => r.gameId));
  const jaTem = idsColetados(db);

  const faltam = ids.filter((id) => {
    const gid = Number(id.split('_')[1]);
    return refazerTudo || !jaTem.has(gid) || pobres.has(gid);
  });

  aoContar?.({ naLista: ids.length, aProcessar: faltam.length, pobres: pobres.size, conta });

  let ok = 0, falhas = 0;
  for (const [i, matchId] of faltam.entries()) {
    try {
      const p = await carregarPartidaDaRiot(riot, matchId);
      if (p.duracaoS < 300) { aoPular?.(matchId, new Error('remake')); continue; }

      const eu = p.jogadores.find((j) => j.nome === conta.gameName);
      if (!eu) { falhas++; aoPular?.(matchId, new Error('você não aparece entre os jogadores')); continue; }

      const achados = analisar(p, eu);
      const zonaDe = (a) => {
        if (a.tipo === 'morte') {
          const ev = p.eventos.find((e) => e.tipo === 'CHAMPION_KILL' && e.vitimaId === eu.id && e.t === a.t);
          if (ev?.pos) return zonaRelativa(ev.pos, eu.time);
        }
        const pos = p.frameEm(a.t).pos[eu.id];
        return pos ? zonaRelativa(pos, eu.time) : null;
      };

      salvarPartida(db, { partida: p, eu, achados, quando: p.quando, zonaDe });
      ok++;
      aoSalvar?.({
        matchId, indice: i + 1, de: faltam.length,
        campeao: eu.campeao, role: eu.role,
        venci: p.vencedor === eu.time, achados: achados.length,
      });
    } catch (erro) {
      falhas++;
      aoPular?.(matchId, erro);
      if (erro.message.includes('inválida ou expirada')) break;
    }
  }

  return { ok, falhas, naLista: ids.length, processadas: faltam.length };
}
