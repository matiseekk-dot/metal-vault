-- ============================================================
-- Migration 040 — per-band "attended" flag for festival lineups
-- ============================================================
-- Why this exists:
--   When the importer pulls a festival's full lineup from Last.fm,
--   the user often gets 100+ bands but actually only SAW maybe 15
--   of them. Without a per-row "attended" flag the user has only
--   two options: delete the bands they didn't see (loses the data)
--   or keep them (inflates the lifetime live count for every band).
--
--   This flag lets the user mark which bands they actually saw at
--   each event. The seen-count badge ("Mayhem ×5") only counts
--   rows where attended=true, so the number reflects reality.
--
-- Default true: pre-existing rows stay "attended" so the
-- migration is non-destructive — the badge and totals don't shift
-- on the day this lands.
--
-- The user can toggle the flag from the expanded festival card
-- (per-band ✓/✗) or a "live mode" view (future enhancement) where
-- they tick bands off during the actual gig.
-- ============================================================

ALTER TABLE user_concerts
  ADD COLUMN IF NOT EXISTS attended boolean NOT NULL DEFAULT true;

-- No index — this column is read alongside band/year and filtered
-- client-side; we don't query "all attended=false" directly.
