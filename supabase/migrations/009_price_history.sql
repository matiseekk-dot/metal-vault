-- ============================================================
-- Metal Vault — Price history per album (Pro feature)
-- Run in Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS price_history (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discogs_id   BIGINT NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  lowest_price  NUMERIC(10,2),
  median_price  NUMERIC(10,2),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(discogs_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_price_history_discogs
  ON price_history(discogs_id, snapshot_date DESC);

ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

-- Price history is public read (anonymous, no RLS needed — it's market data)
CREATE POLICY "Price history readable by all"
  ON price_history FOR SELECT USING (true);

-- Only service role can insert (via cron)
