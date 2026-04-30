-- ============================================================
-- Metal Vault — Rarity tracking via Discogs num_for_sale
-- ============================================================
-- Stores how many copies of a release are listed for sale on Discogs
-- at any given snapshot. Smaller number = rarer record.
--
-- Updated daily by /api/cron/prices alongside median_price refresh.

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS num_for_sale INTEGER;

-- Index for queries that filter/sort by rarity
CREATE INDEX IF NOT EXISTS idx_collection_rarity
  ON collection(num_for_sale)
  WHERE num_for_sale IS NOT NULL;

-- Sanity check (run after migration):
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='collection' AND column_name='num_for_sale';
