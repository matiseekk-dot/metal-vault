-- ============================================================
-- Migration 034 — streaming_history + streaming_dismissed
-- ============================================================
-- Why this exists:
-- listen_logs requires a collection_item_id (FK), so streaming
-- scrobbles for albums the user DOESN'T own get silently dropped
-- by the sync routes — `skipped++` and forgotten. That's exactly
-- the data we need for the "discovery" feature: "you streamed Tool
-- — Lateralus 22× last month, want to add it to wishlist?"
--
-- Architecture:
--   • streaming_history     — every scrobble we receive, with the
--                              normalised (artist, album) tuple
--                              for grouping. matched_collection_id
--                              is set when the scrobble matched
--                              an owned record (used for the
--                              "vinyl-vs-stream" ratio in Stats).
--   • streaming_dismissed   — when the user taps "✕" on a
--                              discovery suggestion, we never
--                              suggest that album again. Keeps
--                              the discovery card from re-showing
--                              the same items endlessly.
--
-- listen_logs stays unchanged for matched scrobbles — that table
-- powers per-collection-item history. streaming_history is the
-- additional source of truth for everything else.
-- ============================================================

CREATE TABLE IF NOT EXISTS streaming_history (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source                text NOT NULL CHECK (source IN ('spotify', 'lastfm')),
  -- Original artist + album as the streaming service sent them.
  -- Useful for surfacing the discovery prompt with proper casing.
  artist                text NOT NULL,
  album                 text NOT NULL,
  -- Normalised forms used for grouping + collection matching. Same
  -- normalisation as the sync routes: lowercase, strip remaster /
  -- reissue suffixes, strip Discogs disambiguation.
  artist_norm           text NOT NULL,
  album_norm            text NOT NULL,
  played_at             timestamptz NOT NULL,
  -- Set when this scrobble matched an owned record. NULL = the user
  -- streamed something they don't own → discovery candidate.
  matched_collection_id uuid REFERENCES collection(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Dedup — same play (same exact second) won't double-write across
-- multiple sync runs. (artist_norm, album_norm) included so e.g.
-- two simultaneous scrobbles of different tracks on the same album
-- don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS streaming_history_uniq
  ON streaming_history(user_id, source, played_at, artist_norm, album_norm);

-- Discovery aggregation — group + count by (artist_norm, album_norm)
-- per user, recently. Index supports the typical "last 90 days,
-- top by count, where matched_collection_id IS NULL".
CREATE INDEX IF NOT EXISTS streaming_history_discovery
  ON streaming_history(user_id, played_at DESC)
  WHERE matched_collection_id IS NULL;

-- Per-user timeline (for general "what did I stream" if we add it later)
CREATE INDEX IF NOT EXISTS streaming_history_recent
  ON streaming_history(user_id, played_at DESC);

-- RLS
ALTER TABLE streaming_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own streaming history" ON streaming_history;
CREATE POLICY "Own streaming history"
  ON streaming_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Discovery dismissals ────────────────────────────────────
-- When the user taps "✕" on a discovery suggestion, persist the
-- normalised (artist, album) so we never re-suggest. Composite
-- primary key handles dedup; INSERT ... ON CONFLICT DO NOTHING is
-- the idiomatic write.
CREATE TABLE IF NOT EXISTS streaming_dismissed (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artist_norm  text NOT NULL,
  album_norm   text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_norm, album_norm)
);

ALTER TABLE streaming_dismissed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own streaming dismissals" ON streaming_dismissed;
CREATE POLICY "Own streaming dismissals"
  ON streaming_dismissed FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
