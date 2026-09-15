-- Chali D1 schema (v1)
-- id = original Firestore document id, kept as PRIMARY KEY so the live export
-- is idempotent (INSERT OR IGNORE).

CREATE TABLE IF NOT EXISTS jokes (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL DEFAULT 'single',   -- 'single' | 'qna'
  question        TEXT NOT NULL,
  answer          TEXT,
  image_url       TEXT,
  image_public_id TEXT,
  upvotes         INTEGER NOT NULL DEFAULT 0,
  downvotes       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'quarantine', -- 'active' | 'quarantine' | 'deleted'
  submitted_by    TEXT NOT NULL DEFAULT 'anonymous',
  rand            REAL,  -- random-walk key; set only when a joke is active
  timestamp       INTEGER NOT NULL,  -- epoch ms
  created_at      INTEGER NOT NULL   -- epoch ms
);

-- Public random-walk: WHERE status='active' ORDER BY rand, id LIMIT 1.
CREATE INDEX IF NOT EXISTS idx_jokes_status_rand ON jokes(status, rand, id);
-- Admin list queries order by timestamp within a status.
CREATE INDEX IF NOT EXISTS idx_jokes_status_ts ON jokes(status, timestamp);
CREATE INDEX IF NOT EXISTS idx_jokes_ts ON jokes(timestamp);

CREATE TABLE IF NOT EXISTS memes (
  id                TEXT PRIMARY KEY,
  tag               TEXT NOT NULL DEFAULT 'loading',
  url               TEXT NOT NULL,
  public_id         TEXT,
  original_filename TEXT,
  format            TEXT,
  resource_type     TEXT,
  created_at        INTEGER NOT NULL   -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_memes_tag ON memes(tag, created_at);