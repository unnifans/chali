-- Add an integer sequence column for cheap, uniform random access.
--
-- The previous handler used ORDER BY RANDOM(), which scanned the entire active
-- pool (~2.7k rows) on every request and exhausted the D1 free-plan daily
-- rows-read quota. Instead we sample a random seq within [MIN, MAX] of the
-- active jokes and seek that exact seq through the (status, seq) index
-- (~1-2 rows per read). A miss only happens when the sampled slot holds a
-- non-active joke, so the handler re-rolls (tiny index seeks), with a forward
-- seek from the random point as a guaranteed fallback (MAX(seq) is active).

ALTER TABLE jokes ADD COLUMN seq INTEGER;

-- Backfill in a stable order for existing rows.
UPDATE jokes SET seq = rowid WHERE seq IS NULL;

-- Cheap MIN/MAX bounds + equality / forward seeks for the random draw.
CREATE INDEX IF NOT EXISTS idx_jokes_status_seq ON jokes(status, seq);
-- Deduplicate seq values; also makes MAX(seq) in new-joke INSERTs an O(log n) seek.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jokes_seq ON jokes(seq);