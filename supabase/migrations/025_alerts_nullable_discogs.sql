-- ============================================================
-- Metal Vault — Allow alerts without a Discogs ID
-- ============================================================
-- The original 001_schema.sql declared price_alerts.discogs_id as
-- BIGINT NOT NULL, which assumed every alertable item came from a
-- Discogs API search. In practice, watchlist items that originate
-- from BandsTab's "♥ wanted" toggle (Discogs master ID is a stringy
-- master release, not always BIGINT-castable) and items resolved via
-- the MusicBrainz fallback don't have a numeric Discogs ID at all.
--
-- We now allow NULL: alerts on identifiers other than discogs_id are
-- matched by album_id (text watchlist key). The price-monitoring cron
-- skips alerts with NULL discogs_id since it has no Discogs row to
-- query for current price — those items become "wishlist reminders"
-- rather than live price alerts.
-- ============================================================

ALTER TABLE price_alerts
  ALTER COLUMN discogs_id DROP NOT NULL;

-- Add the album_id link for non-Discogs watchlist items. We keep it
-- as TEXT to mirror watchlist.album_id (which is sometimes a slugged
-- artist::title and sometimes a Discogs master ID).
ALTER TABLE price_alerts
  ADD COLUMN IF NOT EXISTS album_id TEXT;

CREATE INDEX IF NOT EXISTS idx_alerts_album_id
  ON price_alerts (user_id, album_id) WHERE album_id IS NOT NULL;
