import { fichaDoCampeao, elencoCompleto, recargaNoNivel } from '../dados/ddragon.js';
import { confrontoContra } from '../dados/confrontos.js';

/**
 * Ficha de um adversário específico, pra tela ao vivo.
 *
 * O que faz esta ficha ser SUA e não um tooltip: ela é montada em cima das suas
 * mortes contra esse campeão. O banco guarda, em cada morte, quanto dano cada
 * habilidade de cada inimigo te causou — então dá pra dizer "contra Warwick, o R
 * dele abriu 41% das suas mortes", e não "cuidado com o ultimate".
 *
 * Só depende de rede pra taxa do op.gg e pras dicas oficiais; as duas têm cache
 * em disco e a ficha sai mesmo sem elas.
 */

const TECLAS = ['Q', 'W', 'E', 'R'];
const ROLE_DB = { top: 'TOP', jungle: 'JUNGLE', mid: 'MID', adc: 'ADC', sup: 'SUPORTE' };

/** championId de um nome, pelas duas grafias. */
async function idDoNome(nome) {
  const chave = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
  const alvo = chave(nome);
  for (const c of await elencoCompleto()) {
    if (chave(c.chave) === alvo || chave(c.nome) === alvo) return c.id;
  }
  return null;
}

/**
 * Suas partidas contra esse campeão, nessa role dele. Vale pra qualquer inimigo,
 * não só o da sua lane: o jungler inimigo é adversário de todo mundo.
 */
function historico(db, { meuCampeao, minhaRole, rivalCampeao, rivalRole, soComMeuCampeao = false }) {
  const filtroCamp = soComMeuCampeao ? 'AND p.meuCampeao = @meu' : '';
  const jogos = db.prepare(`
    SELECT p.gameId, p.venci, p.meuId, r.participantId rivalId
    FROM partidas p
    JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
    JOIN jogadores r ON r.gameId = p.gameId AND r.time <> meu.time
      AND r.campeao = @rival AND r.role = @rivalRole
    WHERE p.duracaoS >= 300 AND p.minhaRole = @minhaRole ${filtroCamp}`).all(
    // node:sqlite rejeita parâmetro nomeado que a consulta não usa.
    soComMeuCampeao
      ? { meu: meuCampeao, rival: rivalCampeao, rivalRole, minhaRole }
      : { rival: rivalCampeao, rivalRole, minhaRole });
  if (!jogos.length) return null;

  const ids = jogos.map((j) => j.gameId);
  const lista = ids.join(',');

  // Todas as suas mortes nessas partidas, com o detalhe do dano.
  const mortes = db.prepare(`
    SELECT e.gameId, e.t, e.danoRecebido, a.zona
    FROM eventos e
    JOIN partidas p ON p.gameId = e.gameId
    LEFT JOIN achados a ON a.gameId = e.gameId AND a.tipo = 'morte' AND a.t = e.t
    WHERE e.tipo = 'CHAMPION_KILL' AND e.vitimaId = p.meuId AND e.gameId IN (${lista})`).all();

  // Dano por habilidade do rival, somando todas as suas mortes em que ele
  // participou — e quantas dessas mortes ele participou.
  const porTecla = new Map();
  let totalDoRival = 0, totalGeral = 0, mortesComEle = 0;
  const zonas = new Map(), faixas = new Map();

  for (const m of mortes) {
    let dano;
    try { dano = JSON.parse(m.danoRecebido ?? '[]'); } catch { dano = []; }
    let participou = false;
    for (const d of dano) {
      const v = (d.physicalDamage ?? 0) + (d.magicDamage ?? 0) + (d.trueDamage ?? 0);
      totalGeral += v;
      if (d.name !== rivalCampeao) continue;
      participou = true;
      totalDoRival += v;
      const tecla = d.basic ? 'auto' : (TECLAS[d.spellSlot] ?? null);
      if (tecla) porTecla.set(tecla, (porTecla.get(tecla) ?? 0) + v);
    }
    if (participou) {
      mortesComEle++;
      if (m.zona) zonas.set(m.zona, (zonas.get(m.zona) ?? 0) + 1);
      const faixa = m.t < 600000 ? '0-10' : m.t < 1200000 ? '10-20' : m.t < 1800000 ? '20-30' : '30+';
      faixas.set(faixa, (faixas.get(faixa) ?? 0) + 1);
    }
  }

  const topo = (mapa) => [...mapa.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const vitorias = jogos.reduce((s, j) => s + j.venci, 0);

  return {
    jogos: jogos.length,
    vitorias,
    taxa: vitorias / jogos.length,
    mortesPorJogo: mortes.length / jogos.length,
    mortesComEle,
    fatiaDoDano: totalGeral ? totalDoRival / totalGeral : 0,
    habilidades: [...porTecla.entries()]
      .map(([tecla, dano]) => ({ tecla, dano: Math.round(dano), fatia: totalDoRival ? dano / totalDoRival : 0 }))
      .sort((a, b) => b.dano - a.dano),
    zona: topo(zonas) ? { nome: topo(zonas)[0], vezes: topo(zonas)[1] } : null,
    faixa: topo(faixas) ? { nome: topo(faixas)[0], vezes: topo(faixas)[1] } : null,
  };
}

/**
 * A ficha completa de um inimigo: seu histórico contra ele + taxa do op.gg +
 * a habilidade dele que mais te mata, com recarga + dica oficial curta.
 */
export async function fichaContra(db, { meuCampeao, minhaRole, rival }, { regiao = 'br' } = {}) {
  const rivalRoleDb = ROLE_DB[rival.role] ?? String(rival.role ?? '').toUpperCase();
  const minhaRoleDb = ROLE_DB[minhaRole] ?? String(minhaRole ?? '').toUpperCase();

  const rivalId = await idDoNome(rival.campeao).catch(() => null);

  const [ficha, opgg] = await Promise.all([
    rivalId ? fichaDoCampeao(rivalId).catch(() => null) : null,
    // A taxa do op.gg só faz sentido pra quem divide a lane com você.
    (rivalId && rival.role === minhaRole)
      ? confrontoContra(meuCampeao, minhaRoleDb, rivalId, { regiao }).catch(() => null)
      : null,
  ]);

  // Histórico com QUALQUER campeão seu primeiro (amostra maior); se você já
  // jogou esse confronto exato com o campeão de hoje, esse vem junto.
  const geral = historico(db, { meuCampeao, minhaRole: minhaRoleDb, rivalCampeao: rival.campeao, rivalRole: rivalRoleDb });
  const exato = historico(db, { meuCampeao, minhaRole: minhaRoleDb, rivalCampeao: rival.campeao, rivalRole: rivalRoleDb, soComMeuCampeao: true });

  // As habilidades que mais te mataram, com nome e recarga da ficha oficial.
  const habilidades = (geral?.habilidades ?? [])
    .filter((h) => h.tecla !== 'auto' && h.fatia >= 0.12)
    .slice(0, 3)
    .map((h) => {
      const m = ficha?.magias?.find((x) => x.tecla === h.tecla);
      return {
        tecla: h.tecla,
        nome: m?.nome ?? null,
        fatia: Math.round(h.fatia * 100),
        // Recarga no nível 3 da magia: é onde ela costuma estar no meio do jogo.
        recarga: m ? recargaNoNivel(m, 3) : null,
        alcance: m?.alcance ?? null,
      };
    });

  const autos = geral?.habilidades?.find((h) => h.tecla === 'auto');

  return {
    campeao: rival.campeao,
    championId: rivalId,
    role: rival.role,
    ehMinhaLane: rival.role === minhaRole,
    historico: geral,
    exato: exato && exato.jogos >= 2 ? exato : null,
    opgg: opgg ? { taxa: Math.round(opgg.taxa * 100), jogos: opgg.jogos } : null,
    habilidades,
    autosFatia: autos ? Math.round(autos.fatia * 100) : null,
    dicas: (ficha?.contraEle ?? []).filter((t) => t.length <= 160).slice(0, 2),
  };
}

/** Os dois inimigos que importam pra qualquer role: quem divide sua lane e o jungler. */
export async function fichasDaPartida(db, estado, opcoes) {
  const eu = estado.eu;
  const inimigos = estado.jogadores.filter((j) => j.time !== eu.time);
  const laner = inimigos.find((j) => j.role && j.role === eu.role);
  const jungler = inimigos.find((j) => j.role === 'jungle');

  const alvos = [];
  if (laner) alvos.push(laner);
  if (jungler && jungler !== laner) alvos.push(jungler);

  const fichas = await Promise.all(alvos.map((r) =>
    fichaContra(db, { meuCampeao: eu.campeao, minhaRole: eu.role, rival: { campeao: r.campeao, role: r.role } }, opcoes)
      .catch(() => null)));

  return fichas.filter(Boolean);
}
