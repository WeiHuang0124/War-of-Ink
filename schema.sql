-- 墨戰 排行榜
DROP TABLE IF EXISTS scores;

CREATE TABLE scores (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  survived  REAL    NOT NULL,   -- 撐住的秒數，上限 300
  kills     INTEGER NOT NULL,
  level     INTEGER NOT NULL,
  won       INTEGER NOT NULL DEFAULT 0,
  created   INTEGER NOT NULL    -- epoch 毫秒
);

-- 榜單排序用：先比撐多久，再比化了多少墨
CREATE INDEX idx_rank ON scores (survived DESC, kills DESC, id ASC);
