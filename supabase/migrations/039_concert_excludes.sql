-- ============================================================
-- Migration 039 — sticky deletions for LFM-imported festival bands
-- ============================================================
-- Why this exists:
--   When a user runs the Last.fm import, festivals come back with
--   their FULL lineup — but nobody actually saw every band at a
--   200-act festival. The user wants to whittle the lineup down to
--   "bands I actually saw" and have that pruning STICK across future
--   imports. Without this table, the next 📻 Last.fm click happily
--   re-imports the bands the user just deleted.
--
-- How it works:
--   On delete of an LFM-imported concert row, /api/user-concerts
--   inserts an exclude row keyed by:
--      exclude_key = lower(band) || '::' || year || '::' || venue_norm
--   Same shape the importer uses for dedup-by-identity. The next
--   import does a SELECT on this table, builds a Set of keys, and
--   skips any insert whose key matches.
--
-- Why a separate table (not a soft-delete flag on user_concerts):
--   Soft-delete bloats the journal table (200-band festivals × dozens
--   of users) and complicates every read path. A side table of
--   exclude_keys is small, write-once, and only consulted at import
--   time.
--
-- Reversibility:
--   User clicks "Wyczyść" (clear-lastfm) → wipes the journal AND
--   wipes the exclusion list, so next import starts from a true
--   blank slate. That delete is wired in the clear-lastfm endpoint.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_concert_excludes (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exclude_key  text        NOT NULL,
  band         text,                              -- denormalised for debug / future UI
  year         text,
  venue_norm   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, exclude_key)
);

ALTER TABLE user_concert_excludes ENABLE ROW LEVEL SECURITY;

-- RLS: users see and manage only their own excludes. The service-role
-- import endpoint bypasses RLS via the admin client when it consults
-- the table during a scrape pass.
CREATE POLICY "user_reads_own_excludes" ON user_concert_excludes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_writes_own_excludes" ON user_concert_excludes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_removes_own_excludes" ON user_concert_excludes
  FOR DELETE USING (auth.uid() = user_id);

-- Help the importer's per-user lookup.
CREATE INDEX IF NOT EXISTS idx_user_concert_excludes_user
  ON user_concert_excludes(user_id);
