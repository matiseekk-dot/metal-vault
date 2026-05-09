-- ============================================================
-- Migration 035 — streaming_history.play_count (aggregate-friendly)
-- ============================================================
-- Why this exists:
-- The previous schema treated each row as 1 scrobble (count(*) for
-- aggregation). That works for Spotify (their API only exposes
-- per-track recently-played) but is wasteful for Last.fm, which
-- exposes user.getTopAlbums returning pre-aggregated playcounts.
--
-- For a user with a 2008-era Last.fm account, paginating
-- recenttracks took 30-60s and capped at 12k tracks. getTopAlbums
-- returns the top 200 albums with playcount in ONE request (~1s)
-- and is the more honest data source for the Discovery feature
-- ("albums you've played a lot but don't own") — we want
-- *aggregate* affinity, not raw scrobble timestamps.
--
-- Schema:
-- - play_count INT DEFAULT 1: lets a single row represent N plays.
--   Existing per-scrobble rows from Spotify keep play_count=1 and
--   COUNT(*) ≡ SUM(play_count). Last.fm rows from getTopAlbums set
--   play_count = the API's playcount field directly.
-- ============================================================

ALTER TABLE streaming_history
  ADD COLUMN IF NOT EXISTS play_count int NOT NULL DEFAULT 1
  CHECK (play_count >= 1);

-- The discovery index already covers the aggregate use case
-- (user_id + matched_collection_id IS NULL + played_at) — adding a
-- BTREE on play_count would be wasted (we always GROUP BY artist_norm,
-- album_norm before summing).
