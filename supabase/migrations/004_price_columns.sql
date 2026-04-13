-- ============================================================
-- Metal Vault — Add price columns to collection
-- Run in Supabase → SQL Editor → New query → Run
-- ============================================================

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS current_price   DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS median_price    DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS last_price_check TIMESTAMPTZ;

-- Add total_paid to portfolio_snapshots
ALTER TABLE portfolio_snapshots
  ADD COLUMN IF NOT EXISTS total_paid DECIMAL(10,2) DEFAULT 0;
