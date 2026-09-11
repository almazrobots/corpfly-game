import { DatabaseSync } from 'node:sqlite';

// Схема. `seq` — порядковый номер активации: ровно то, что игрок видит как «#43».
// Он назначается один раз при первой встрече и больше не меняется, даже если
// игроки уходят: номер — это идентичность, а не позиция в рейтинге.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  tg_id      INTEGER PRIMARY KEY,
  seq        INTEGER NOT NULL UNIQUE,
  initials   TEXT    NOT NULL,
  best       INTEGER NOT NULL DEFAULT 0,
  plays      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS players_best ON players(best DESC, updated_at ASC);
`;

export function openDb(file = process.env.CORPFLY_DB || './data/corpfly.sqlite') {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 4000');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return wrap(db);
}

function wrap(db) {
  const qInsert = db.prepare(
    `INSERT INTO players (tg_id, seq, initials, best, plays, created_at, updated_at)
     VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM players), ?, 0, 0, ?, ?)`,
  );
  const qGet = db.prepare('SELECT tg_id, seq, initials, best, plays, updated_at FROM players WHERE tg_id = ?');
  const qTouchInitials = db.prepare('UPDATE players SET initials = ?, updated_at = ? WHERE tg_id = ?');
  const qBump = db.prepare('UPDATE players SET best = ?, plays = plays + 1, updated_at = ? WHERE tg_id = ?');
  const qPlay = db.prepare('UPDATE players SET plays = plays + 1, updated_at = ? WHERE tg_id = ?');
  const qTop = db.prepare(
    `SELECT seq, initials, best FROM players WHERE best > 0
     ORDER BY best DESC, updated_at ASC LIMIT ?`,
  );
  const qRank = db.prepare(
    `SELECT COUNT(*) + 1 AS rank FROM players p
     WHERE p.best > (SELECT best FROM players WHERE tg_id = ?)`,
  );
  const qCountAll = db.prepare('SELECT COUNT(*) AS n FROM players');
  const qCountRanked = db.prepare('SELECT COUNT(*) AS n FROM players WHERE best > 0');

  return {
    raw: db,
    close: () => db.close(),

    /** Находит игрока или заводит нового, выдавая ему следующий порядковый номер. */
    upsertPlayer(tgId, initials) {
      const now = Date.now();
      const found = qGet.get(tgId);
      if (found) {
        if (found.initials !== initials) {
          qTouchInitials.run(initials, now, tgId);
          found.initials = initials;
        }
        return { ...found, created: false };
      }
      qInsert.run(tgId, initials, now, now);
      return { ...qGet.get(tgId), created: true };
    },

    /** Рекорд обновляется только вверх. Возвращает итоговое состояние игрока. */
    submitScore(tgId, score) {
      const p = qGet.get(tgId);
      if (!p) return null;
      const improved = score > p.best;
      const now = Date.now();
      if (improved) qBump.run(score, now, tgId);
      else qPlay.run(now, tgId);
      return { ...qGet.get(tgId), improved };
    },

    getPlayer: (tgId) => qGet.get(tgId) ?? null,
    rankOf: (tgId) => Number(qRank.get(tgId)?.rank ?? 0),
    top: (limit = 50) => qTop.all(Math.max(1, Math.min(200, limit | 0))),
    counts: () => ({
      players: Number(qCountAll.get().n),
      ranked: Number(qCountRanked.get().n),
    }),
  };
}
