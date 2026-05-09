-- ============================================================
-- Migration 033 — listen_logs.source + split vinyl/streaming counters
-- ============================================================
-- Why this exists:
-- Migration 031/032 wired Spotify + Last.fm auto-import directly
-- into listen_logs. That conflated two genuinely different signals:
--
--   1. VINYL plays — physical interaction. User pulled a record off
--      the shelf, put it on the turntable, played side A. This is
--      the canonical "listen" the app was built around. The
--      "dust collection" suggestion + "haven't played since X"
--      analytics depend on this being clean.
--
--   2. STREAMING plays — user listened to the digital version on
--      Spotify / Apple Music (via Last.fm) / YT Music / Tidal.
--      Different ritual entirely; you can stream a record 50× while
--      its vinyl gathers dust.
--
-- Mixing them broke `play_count` ("12 plays" when actually you
-- streamed 11× and only spun the vinyl once) and made the
-- streak / heatmap / dust-suggestion features useless for any
-- user who connected Spotify or Last.fm.
--
-- Fix:
--   • New column `source` on listen_logs (vinyl / spotify / lastfm)
--   • Existing rows tagged 'spotify' or 'lastfm' based on the
--     `notes` marker the sync routes wrote ('[spotify]' / '[lastfm]')
--   • Trigger updated to count VINYL only toward play_count /
--     last_played_at — so the collection card stays clean
--   • Recompute play_count + last_played_at for affected rows so
--     anyone who already imported scrobbles into a vinyl-counted
--     listen log gets fixed retroactively
-- ============================================================

-- 1) Add source column. Default 'vinyl' so existing rows that were
-- ACTUALLY vinyl plays (created via the manual ListenButton UI)
-- stay correctly classified.
ALTER TABLE listen_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'vinyl'
  CHECK (source IN ('vinyl', 'spotify', 'lastfm'));

-- 2) Reclassify rows the sync routes already wrote. The Spotify/
-- Last.fm sync routes used `notes='[spotify]'` / `notes='[lastfm]'`
-- as a marker — that's our signal.
UPDATE listen_logs SET source = 'spotify' WHERE notes = '[spotify]';
UPDATE listen_logs SET source = 'lastfm'  WHERE notes = '[lastfm]';

-- Index — most queries filter by source first.
CREATE INDEX IF NOT EXISTS idx_listen_logs_user_source_played
  ON listen_logs (user_id, source, played_at DESC);

-- 3) Add streaming counter on collection so cards can show "you
-- streamed this 47× recently" without re-aggregating logs every
-- render. Per-source counters keep the original `play_count`
-- (vinyl) untouched.
ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS streaming_count INT NOT NULL DEFAULT 0;

-- 4) Replace the trigger so VINYL plays update play_count AND
-- streaming plays update streaming_count — without crossing.
CREATE OR REPLACE FUNCTION sync_collection_play_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.source = 'vinyl' THEN
      UPDATE collection SET
        play_count     = play_count + 1,
        last_played_at = GREATEST(COALESCE(last_played_at, NEW.played_at), NEW.played_at)
      WHERE id = NEW.collection_item_id;
    ELSE
      UPDATE collection SET
        streaming_count = streaming_count + 1
      WHERE id = NEW.collection_item_id;
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.source = 'vinyl' THEN
      UPDATE collection SET
        play_count     = GREATEST(play_count - 1, 0),
        last_played_at = (
          SELECT MAX(played_at)
          FROM listen_logs
          WHERE collection_item_id = OLD.collection_item_id
            AND id <> OLD.id
            AND source = 'vinyl'
        )
      WHERE id = OLD.collection_item_id;
    ELSE
      UPDATE collection SET
        streaming_count = GREATEST(streaming_count - 1, 0)
      WHERE id = OLD.collection_item_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5) Backfill the cached counters from authoritative listen_logs.
-- Without this, anyone who already imported Spotify/Last.fm has
-- play_count inflated by streaming rows AND streaming_count = 0.
WITH agg AS (
  SELECT collection_item_id,
         COUNT(*) FILTER (WHERE source = 'vinyl')                          AS vinyl_plays,
         COUNT(*) FILTER (WHERE source IN ('spotify','lastfm'))            AS streaming_plays,
         MAX(played_at)  FILTER (WHERE source = 'vinyl')                   AS vinyl_last_played
  FROM listen_logs
  GROUP BY collection_item_id
)
UPDATE collection c SET
  play_count      = COALESCE(agg.vinyl_plays,     0),
  streaming_count = COALESCE(agg.streaming_plays, 0),
  last_played_at  = agg.vinyl_last_played
FROM agg
WHERE c.id = agg.collection_item_id;

-- 6) Items with zero logs of either kind reset to clean zero/NULL
-- (covers the case where prior import wrote rows we've since
-- reclassified — the WHERE clause above only touches items with
-- logs at all, so a user who deletes all imports cleanly afterwards
-- gets reset by trigger DELETE path).
UPDATE collection SET
  play_count      = 0,
  streaming_count = 0,
  last_played_at  = NULL
WHERE id NOT IN (SELECT DISTINCT collection_item_id FROM listen_logs);
