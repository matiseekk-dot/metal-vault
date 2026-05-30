-- ============================================================
-- Migration 045 — recent_play_count for last-30-days listening view
-- ============================================================
-- Why this exists:
--   ListeningTab can filter to 'last 30 days'. After migration 044
--   the played_at column carries the real timestamp of the most-
--   recent scrobble per album, so the filter correctly picks rows
--   that were touched in the window. But the play_count column has
--   always been LIFETIME — every scrobble of that album ever.
--
--   User feedback: '591× plays in last 30 days' is misleading when
--   the album was played 5 years ago and once last week. They want
--   'how many plays in the selected window' instead.
--
-- Schema addition:
--   recent_play_count integer NOT NULL DEFAULT 0
--
-- Populated by:
--   /api/lastfm/sync POST + /api/cron/lastfm-scrobble-sync
--   Both count tracks whose date.uts is within the last 30 days
--   and write that count alongside the lifetime play_count.
--
-- UI:
--   When the filter is 'last 30 days' the listening feed surfaces
--   recent_play_count instead of play_count. Other filters keep
--   showing lifetime — that's still the most useful number for
--   90-day / 365-day / all-time views (those windows roughly
--   approximate lifetime for active scrobblers).
-- ============================================================

ALTER TABLE streaming_history
  ADD COLUMN IF NOT EXISTS recent_play_count integer NOT NULL DEFAULT 0;

-- No index needed — listening feed already filters by user_id +
-- source and the new column is just a payload field surfaced to UI.
