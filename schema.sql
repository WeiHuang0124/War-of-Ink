-- 墨戰 排行榜
DROP TABLE IF EXISTS scores;

CREATE TABLE scores (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  survived  REAL    NOT NULL,
  kills     INTEGER NOT NULL,
  level     INTEGER NOT NULL,
  won       INTEGER NOT NULL DEFAULT 0,
  created   INTEGER NOT NULL,
  mode      TEXT    NOT NULL DEFAULT 'timed'
);

CREATE INDEX idx_rank ON scores (mode, survived DESC, kills DESC, id ASC);
