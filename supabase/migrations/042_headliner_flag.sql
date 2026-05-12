-- ============================================================
-- Migration 042 — per-band "is headliner" flag for festival aggregates
-- ============================================================
-- Why this exists:
--   Headliner picks shipped in commit 62ffeae as a client-side
--   localStorage map (`mv-headliner-picks` keyed by venueId::date).
--   That worked for one device but didn't sync — if the user picked
--   IGORRR as headliner on their laptop and opened the app on phone,
--   the pick was gone. Also vanished on cache clear.
--
--   This migration lifts the data into Supabase so it travels with
--   the user_concerts row itself. Single source of truth, cross-
--   device sync for free, survives any client-state wipe.
--
-- Storage:
--   is_headliner  boolean NOT NULL DEFAULT false
--
-- Constraint we intentionally DON'T add:
--   A "max one headliner per (user_id, venue_id, planned_date)" check
--   would be cleaner but Postgres doesn't support partial unique
--   indexes with WHERE on multiple columns simply, and we already
--   enforce single-select in the client (setting one clears the
--   others). Trade-off accepted.
--
-- Reversibility:
--   `DROP COLUMN is_headliner` rolls back without data loss for
--   other columns. The client falls back to the legacy LS map on
--   schema-check failure.
-- ============================================================

ALTER TABLE user_concerts
  ADD COLUMN IF NOT EXISTS is_headliner boolean NOT NULL DEFAULT false;

-- Helps the per-group "find current headliner" lookup. The aggregator
-- iterates festival items in JS and picks the one with is_headliner=
-- true; this index is mostly useful if we ever add a server-side
-- "all my headliners" query (e.g. ranking by venues where you saw
-- a headlining set). Cheap to have either way.
CREATE INDEX IF NOT EXISTS idx_user_concerts_headliner
  ON user_concerts(user_id)
  WHERE is_headliner = true;
