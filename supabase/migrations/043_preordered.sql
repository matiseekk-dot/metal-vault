-- ============================================================
-- Migration 043 — pre-order flag on collection
-- ============================================================
-- Why this exists:
--   User asked: "fane byłaby jeszcze opcja zamówione w preorder".
--   Watchlist is for "watching for price drops" — passive interest.
--   Pre-order is "I already committed to buying, waiting for shipment".
--   Different intent, different UI affordance, hence a separate flag.
--
-- Storage:
--   is_preordered boolean NOT NULL DEFAULT false
--
-- UI behaviour:
--   - When TRUE: item shows a "📦 PRE-ORDER · za N dni" badge in the
--     Vault, sorted to top of the list. The release date pulls from
--     the existing `year` column or `purchase_date` when set.
--   - When FALSE: regular owned-record semantics.
--   - User flips manually via the toggle in the expanded vault card
--     (e.g. when the vinyl arrives and they want it to behave like
--     any other owned item).
--
-- No retroactive flip on release-date-passing — the user might still
-- be waiting on shipping past street date. Explicit flip is honest.
-- ============================================================

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS is_preordered boolean NOT NULL DEFAULT false;

-- Index for the "Pre-orders" filter chip in Vault, which scans
-- WHERE is_preordered = true. Partial index keeps it cheap — most
-- collection rows are NOT pre-orders.
CREATE INDEX IF NOT EXISTS idx_collection_preordered
  ON collection(user_id, year)
  WHERE is_preordered = true;
