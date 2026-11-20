-- 「语块」云同步数据表
-- 在 Cloudflare D1 控制台或 wrangler 里执行一次即可。

CREATE TABLE IF NOT EXISTS cards (
  id           TEXT PRIMARY KEY,
  en           TEXT NOT NULL DEFAULT '',
  zh           TEXT NOT NULL DEFAULT '',
  example      TEXT NOT NULL DEFAULT '',
  usage        TEXT NOT NULL DEFAULT '',
  source_zh    TEXT NOT NULL DEFAULT '',
  source_en    TEXT NOT NULL DEFAULT '',
  scene        TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT 0,
  ease         REAL    NOT NULL DEFAULT 2.5,
  interval     INTEGER NOT NULL DEFAULT 0,
  reps         INTEGER NOT NULL DEFAULT 0,
  due          INTEGER NOT NULL DEFAULT 0,
  last_review  INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  -- FSRS 字段(2026-05-08 新增)
  stability    REAL    NOT NULL DEFAULT 0,
  difficulty   REAL    NOT NULL DEFAULT 0,
  state        INTEGER NOT NULL DEFAULT 0,
  lapses       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cards_updated_at ON cards(updated_at);
