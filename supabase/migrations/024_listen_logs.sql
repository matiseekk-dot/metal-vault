-- ============================================================
-- Metal Vault — Listen logs (vinyl play tracking)
-- ============================================================
-- One row per "I just played this record". Lets us answer:
--   • What did I play this week / month / year?
--   • Top played records of all time
--   • "Dust collection" — records I haven't played in N months
--   • Listening streak — consecutive days with at least one play
--
-- Why a separate table instead of just incrementing a counter on
-- collection? Two reasons:
--   1. We want a play timeline (heatmaps, "haven't played since X")
--   2. Future granularity: side A/B, mood tags, session notes
--
-- Counters on `collection` (play_count, last_played_at) are
-- denormalized for fast card rendering — kept in sync via trigger
-- so app code never needs to update both.
-- ============================================================

CREATE TABLE IF NOT EXISTS listen_logs (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  collection_item_id UUID REFERENCES collection(id) ON DELETE CASCADE NOT NULL,
  played_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- 'A' / 'B' / 'C' / 'D' (for double LPs) or 'AB' (full play) or NULL (unspecified)
  side               TEXT CHECK (side IS NULL OR side ~ '^[A-D]{1,2}$'),
  duration_min       INT CHECK (duration_min IS NULL OR duration_min > 0),
  -- Free-text mood / occasion ("Friday night", "morning coffee", "test press")
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Per-user timeline queries hit this index hard
CREATE INDEX IF NOT EXISTS idx_listen_logs_user_played
  ON listen_logs (user_id, played_at DESC);

-- Per-record history (for "your last 5 listens of this album")
CREATE INDEX IF NOT EXISTS idx_listen_logs_item
  ON listen_logs (collection_item_id, played_at DESC);

-- ── Denormalized counters on collection ──────────────────────
-- Reading these from the card row is much cheaper than aggregating
-- listen_logs every render.
ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS play_count     INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_played_at TIMESTAMPTZ;

-- Sort "dust collection" suggestions efficiently
CREATE INDEX IF NOT EXISTS idx_collection_last_played
  ON collection (user_id, last_played_at NULLS FIRST);

-- ── Sync trigger ──────────────────────────────────────────────
-- On INSERT: bump play_count and update last_played_at if the new
-- played_at is more recent than the cached one.
-- On DELETE: decrement and recompute last_played_at from remaining
-- logs (most recent of what's left, or NULL if none).
CREATE OR REPLACE FUNCTION sync_collection_play_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE collection SET
      play_count     = play_count + 1,
      last_played_at = GREATEST(COALESCE(last_played_at, NEW.played_at), NEW.played_at)
    WHERE id = NEW.collection_item_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE collection SET
      play_count     = GREATEST(play_count - 1, 0),
      last_played_at = (
        SELECT MAX(played_at)
        FROM listen_logs
        WHERE collection_item_id = OLD.collection_item_id
          AND id <> OLD.id
      )
    WHERE id = OLD.collection_item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_listen_logs_sync_collection ON listen_logs;
CREATE TRIGGER trg_listen_logs_sync_collection
  AFTER INSERT OR DELETE ON listen_logs
  FOR EACH ROW EXECUTE FUNCTION sync_collection_play_stats();

-- ── Row-level security ───────────────────────────────────────
ALTER TABLE listen_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own listen logs" ON listen_logs;
CREATE POLICY "Own listen logs"
  ON listen_logs FOR ALL
  USING       (auth.uid() = user_id)
  WITH CHECK  (auth.uid() = user_id);

-- ── Backfill existing rows ────────────────────────────────────
-- Counters default to 0 so users joining now see the feature with
-- a clean slate. No backfill needed; trigger handles all new logs.
