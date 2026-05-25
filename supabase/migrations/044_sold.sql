-- ============================================================
-- Migration 044 — sold-record tracking
-- ============================================================
-- Why this exists:
--   Collectors don't just buy — they sell. Until now the only
--   exit door was DELETE, which throws away the entire purchase
--   history (price paid, grade, photos, the concert where it
--   was bought). That's the wrong model for a vault: sold ≠
--   never existed.
--
--   This migration adds a soft "sold" state. The row stays in
--   the table — preserving the history, the PnL signal, and the
--   ability to filter "what did I have, what did I let go".
--
-- Schema additions (idempotent):
--   is_sold     bool    DEFAULT false
--   sold_date   date    NULL  -- when user marked it sold
--   sold_price  numeric NULL  -- what they got for it (any currency, free text fallback)
--
-- UI behaviour (handled client-side, not in this migration):
--   - Sold items hidden from default Vault list (toggleable filter)
--   - "Sold" filter chip surfaces them
--   - Portfolio totalCurrent excludes sold items (we sold them — they
--     no longer represent live market exposure)
--   - PnL stays computable: (sold_price - purchase_price) per row
--   - Cannot mark sold if not in collection (RLS already handles)
--   - Sold flips `for_sale` to false automatically (UI concern,
--     enforced in API too via the writable filter)
--
-- Reversibility:
--   User can un-sell from the detail view (sets is_sold=false,
--   nulls sold_date/sold_price). Data is preserved both ways.
-- ============================================================

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS is_sold    boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sold_date  date,
  ADD COLUMN IF NOT EXISTS sold_price numeric;

-- Index for the "Sold" filter chip + portfolio exclusion query.
-- Partial — most rows are not sold, so the index stays tiny.
CREATE INDEX IF NOT EXISTS idx_collection_sold
  ON collection(user_id, sold_date DESC)
  WHERE is_sold = true;
