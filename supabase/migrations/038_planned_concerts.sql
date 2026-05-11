-- ============================================================
-- Migration 038 — planned concerts (going + tickets bought)
-- ============================================================
-- Why this exists:
--   user_concerts up to now only logged PAST gigs. Users asked for
--   a forward-looking "I'm going to this one" mode with a separate
--   flag for whether tickets are already bought (so the upcoming
--   list can highlight the unticketed ones — actionable signal).
--
-- Schema additions (idempotent):
--   is_planned        bool DEFAULT false
--   tickets_bought    bool DEFAULT false  -- only meaningful when is_planned
--   planned_date      date NULL           -- when the concert is, for filtering
--
-- Existing past-gig rows keep is_planned=false. The aggregation /
-- ranking code in ConcertsTab filters on is_planned to keep the
-- two universes separate.
-- ============================================================

ALTER TABLE user_concerts
  ADD COLUMN IF NOT EXISTS is_planned       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tickets_bought   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS planned_date     date;

-- Helpful index: most queries ask "upcoming for this user" — filter
-- on is_planned=true ordered by planned_date.
CREATE INDEX IF NOT EXISTS idx_user_concerts_planned
  ON user_concerts(user_id, planned_date)
  WHERE is_planned = true;
