import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { caminhoBanco } from '../caminhos.js';

export const CAMINHO_PADRAO = caminhoBanco();

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS partidas (
  gameId      INTEGER PRIMARY KEY,
  fila        INTEGER,
  quando      TEXT,
  duracaoS    INTEGER,
  vencedor    INTEGER,
  meuId       INTEGER,
  minhaRole   TEXT,
  meuCampeao  TEXT,
  venci       INTEGER,
  coletadoEm  TEXT
);

CREATE TABLE IF NOT EXISTS jogadores (
  gameId      INTEGER,
  participantId INTEGER,
  time        INTEGER,
  championId  INTEGER,
  campeao     TEXT,
  nome        TEXT,
  role        TEXT,
  kills       INTEGER, deaths INTEGER, assists INTEGER,
  cs          INTEGER, ouro INTEGER, dano INTEGER,
  visao       INTEGER, wards INTEGER,
  PRIMARY KEY (gameId, participantId)
);

-- Uma linha por jogador por minuto. E a tabela que sustenta toda analise de
-- posicionamento, entao vale o volume: ~300 linhas por partida.
-- 'minuto' e o indice do frame, nao o timestamp arredondado: os frames nao caem
-- exatamente de 60 em 60s e dois deles podiam arredondar pro mesmo minuto.
-- O tempo exato fica em 't'.
CREATE TABLE IF NOT EXISTS frames (
  gameId      INTEGER,
  minuto      INTEGER,
  t           INTEGER,
  participantId INTEGER,
  x INTEGER, y INTEGER,
  nivel INTEGER, ouro INTEGER, ouroTotal INTEGER,
  cs INTEGER, csSelva INTEGER, xp INTEGER,
  PRIMARY KEY (gameId, minuto, participantId)
);

CREATE TABLE IF NOT EXISTS eventos (
  gameId INTEGER, t INTEGER, tipo TEXT,
  x INTEGER, y INTEGER,
  autorId INTEGER, vitimaId INTEGER,
  monstro TEXT, predio TEXT, torre TEXT, rota TEXT, timeVitima INTEGER
);

-- Achados dos detectores ficam gravados junto. E o que permite perguntar
-- "esse erro se repete?" sem reprocessar todas as partidas.
CREATE TABLE IF NOT EXISTS achados (
  gameId INTEGER, t INTEGER, tipo TEXT,
  gravidade INTEGER, titulo TEXT, motivos TEXT, zona TEXT,
  PRIMARY KEY (gameId, t, tipo, titulo)
);

-- Elo a cada leitura que mudou: dá a curva de PDL e o "+34 hoje".
CREATE TABLE IF NOT EXISTS elo_hist (
  conta TEXT, fila TEXT, tier TEXT, rank TEXT, pdl INTEGER,
  vitorias INTEGER, derrotas INTEGER, em TEXT,
  PRIMARY KEY (conta, fila, em)
);
-- Partidas que ele marcou pra "estudar depois".
CREATE TABLE IF NOT EXISTS marcadas (gameId INTEGER PRIMARY KEY, em TEXT);

CREATE INDEX IF NOT EXISTS idx_frames_jogador ON frames (gameId, participantId);
CREATE INDEX IF NOT EXISTS idx_eventos_tipo   ON eventos (tipo, gameId);
CREATE INDEX IF NOT EXISTS idx_achados_tipo   ON achados (tipo);
CREATE INDEX IF NOT EXISTS idx_partidas_quando ON partidas (quando DESC);
`;

export function abrirBanco(caminho = caminhoBanco()) {
  mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(ESQUEMA);
  migrar(db);
  return db;
}

/**
 * Colunas que so existem quando o dado vem da API oficial da Riot. Adicionadas
 * por ALTER porque o banco ja existia antes de a chave entrar em cena.
 */
function migrar(db) {
  const colunas = (tabela) => db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);

  const novas = {
    eventos: { wardType: 'TEXT', itemId: 'INTEGER', skillSlot: 'INTEGER', danoRecebido: 'TEXT' },
    partidas: { matchId: 'TEXT', fonte: 'TEXT' },
    jogadores: { tag: 'TEXT', puuid: 'TEXT' },
  };
  for (const [tabela, campos] of Object.entries(novas)) {
    const tem = colunas(tabela);
    for (const [nome, tipo] of Object.entries(campos)) {
      if (!tem.includes(nome)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${tipo}`);
    }
  }
}

export function jaColetada(db, gameId) {
  return !!db.prepare('SELECT 1 FROM partidas WHERE gameId = ?').get(gameId);
}

export function idsColetados(db) {
  return new Set(db.prepare('SELECT gameId FROM partidas').all().map((r) => r.gameId));
}

/**
 * Grava a partida inteira numa transacao. Regrava por cima se ja existir,
 * pra poder reprocessar quando os detectores mudarem.
 */
export function salvarPartida(db, { partida: p, eu, achados, quando, zonaDe }) {
  const del = (tabela) => db.prepare(`DELETE FROM ${tabela} WHERE gameId = ?`).run(p.gameId);

  db.exec('BEGIN');
  try {
    for (const t of ['partidas', 'jogadores', 'frames', 'eventos', 'achados']) del(t);

    db.prepare(`INSERT INTO partidas
      (gameId, fila, quando, duracaoS, vencedor, meuId, minhaRole, meuCampeao, venci, coletadoEm, matchId, fonte)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      p.gameId, p.fila, quando ?? p.quando ?? null, p.duracaoS, p.vencedor,
      eu.id, eu.role, eu.campeao, p.vencedor === eu.time ? 1 : 0, new Date().toISOString(),
      p.matchId ?? null, p.fonte ?? 'lcu');

    const insJog = db.prepare(`INSERT INTO jogadores
      (gameId, participantId, time, championId, campeao, nome, role, kills, deaths, assists, cs, ouro, dano, visao, wards, tag, puuid)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const j of p.jogadores) {
      const s = j.stats;
      insJog.run(p.gameId, j.id, j.time, j.championId, j.campeao, j.nome, j.role,
        s.kills, s.deaths, s.assists,
        s.totalMinionsKilled + s.neutralMinionsKilled, s.goldEarned,
        s.totalDamageDealtToChampions, s.visionScore, s.wardsPlaced, j.tag ?? null, j.puuid ?? null);
    }

    const insFrame = db.prepare(`INSERT INTO frames
      (gameId, minuto, t, participantId, x, y, nivel, ouro, ouroTotal, cs, csSelva, xp)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    p.frames.forEach((f, minuto) => {
      for (const j of p.jogadores) {
        const pos = f.pos[j.id], d = f.dados[j.id];
        if (!pos || !d) continue;
        insFrame.run(p.gameId, minuto, f.t, j.id, pos.x, pos.y, d.nivel, d.ouro, d.ouroTotal, d.cs, d.csSelva, d.xp);
      }
    });

    const insEv = db.prepare(`INSERT INTO eventos
      (gameId, t, tipo, x, y, autorId, vitimaId, monstro, predio, torre, rota, timeVitima, wardType, itemId, skillSlot, danoRecebido)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const e of p.eventos) {
      insEv.run(p.gameId, e.t, e.tipo, e.pos?.x ?? null, e.pos?.y ?? null,
        e.autorId, e.vitimaId, e.monstro, e.predio, e.torre, e.rota, e.timeVitima,
        e.wardType ?? null, e.itemId ?? null, e.skillSlot ?? null,
        e.danoRecebido ? JSON.stringify(e.danoRecebido) : null);
    }

    const insAch = db.prepare(`INSERT OR REPLACE INTO achados
      (gameId, t, tipo, gravidade, titulo, motivos, zona) VALUES (?,?,?,?,?,?,?)`);
    for (const a of achados) {
      insAch.run(p.gameId, a.t, a.tipo, a.gravidade, a.titulo, a.motivos.join(' | '), zonaDe?.(a) ?? null);
    }

    db.exec('COMMIT');
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}
