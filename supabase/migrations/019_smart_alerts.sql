-- ============================================================
-- Metal Vault — Smart price alerts (extended types)
-- ============================================================
-- Original: target_price + direction = "alert when price drops below X"
-- Extended types:
--   • PRICE_DROP        — original (price ≤ target)
--   • PRICE_RISE        — alert when price ≥ target (e.g. owned record going up)
--   • PERCENT_DROP      — alert when price drops N% from baseline_price
--   • PERCENT_RISE      — alert when price rises N% from baseline_price  
--   • LOW_STOCK         — alert when num_for_sale on Discogs falls below threshold
--
-- target_price meaning depends on alert_type:
--   PRICE_DROP/RISE  → absolute USD threshold
--   PERCENT_*        → percentage (e.g. 20 = 20% change)
--   LOW_STOCK        → max copies on Discogs to trigger

ALTER TABLE price_alerts
  ADD COLUMN IF NOT EXISTS alert_type TEXT NOT NULL DEFAULT 'PRICE_DROP',
  ADD COLUMN IF NOT EXISTS baseline_price NUMERIC(10,2);

-- Sanity check (run after migration):
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name='price_alerts' ORDER BY ordinal_position;

-- Validation constraint
ALTER TABLE price_alerts
  DROP CONSTRAINT IF EXISTS price_alerts_alert_type_check;
ALTER TABLE price_alerts
  ADD CONSTRAINT price_alerts_alert_type_check
  CHECK (alert_type IN ('PRICE_DROP', 'PRICE_RISE', 'PERCENT_DROP', 'PERCENT_RISE', 'LOW_STOCK'));
