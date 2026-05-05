-- ============================================================
-- Metal Vault — performance indexes
-- ============================================================
-- Adds indexes for query patterns the audit flagged as scanning the
-- whole table without an index. None of these tables is huge today
-- but the queries run on every dashboard render, every cron, and every
-- watchlist open — they'll get slow fast.
--
-- All idempotent (CREATE INDEX IF NOT EXISTS).
-- ============================================================

-- Watchlist + vault open both call /api/alerts which does:
--   SELECT * FROM price_alerts WHERE user_id = $1
-- with no index → sequential scan. Most common query in the app.
CREATE INDEX IF NOT EXISTS idx_alerts_user
  ON price_alerts (user_id);

-- /api/cron/prices orders by last_price_check ASC NULLS FIRST so the
-- staleness filter can pick the oldest rows. Without an index that
-- ORDER BY scans the whole collection table for every cron run.
CREATE INDEX IF NOT EXISTS idx_collection_last_price_check
  ON collection (last_price_check NULLS FIRST);

-- /api/portfolio/change uses price_history with .gte(snapshot_date, ...).
-- The original migration only indexed (discogs_id, snapshot_date) via the
-- primary key; explicit index on snapshot_date alone helps the
-- range-scan when the discogs_id list is wide.
CREATE INDEX IF NOT EXISTS idx_price_history_snapshot_date
  ON price_history (snapshot_date);
