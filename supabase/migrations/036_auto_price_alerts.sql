-- ============================================================
-- Migration 036 — auto price-drop alerts
-- ============================================================
-- Why this exists:
--   Manually setting target_price on every watchlist row is friction.
--   Power users with 50+ watched albums never bother. This migration
--   adds a single user-level "% drop" threshold; the daily cron walks
--   the watchlist and notifies for ANY item that drops that much
--   below its 30-day average. One toggle, full coverage.
--
-- Schema:
--   profiles.auto_drop_pct      int (5..90), NULL = disabled.
--                               25 means "alert when current price
--                               is at least 25% below 30-day avg".
--   watchlist.last_auto_alert_at  cooldown stamp — we won't re-alert
--                               the same item within 7 days even if
--                               the price stays low.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS auto_drop_pct int
  CHECK (auto_drop_pct IS NULL OR (auto_drop_pct BETWEEN 5 AND 90));

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS last_auto_alert_at timestamptz;

-- Helpful index for the cron — quickly find users with auto-alerts on.
CREATE INDEX IF NOT EXISTS idx_profiles_auto_drop
  ON profiles(id)
  WHERE auto_drop_pct IS NOT NULL;
