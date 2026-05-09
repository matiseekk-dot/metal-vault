-- ============================================================
-- Migration 030 — collection.for_sale_*
-- ============================================================
-- "Want to sell" flow: Pro tier feature that flags collection
-- items as up-for-grabs, captures asking price + condition note,
-- and (in v1) generates a deep-link to Discogs Marketplace listing.
-- v2 will use Discogs Marketplace API to actually create listings
-- programmatically, but that needs an OAuth scope we don't have yet.
--
-- Why columns on `collection` not a separate table:
-- The data is 1:1 with a collection item — same artist/album/grade.
-- A separate `for_sale_listings` table would require joining on
-- every read of the for-sale view AND would lose RLS-by-cascade
-- when a user deletes a collection item. Three columns it is.
-- ============================================================

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS for_sale          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asking_price      numeric(10, 2),
  ADD COLUMN IF NOT EXISTS for_sale_note     text;

-- Read-path: user opens "For sale" view → filter by for_sale=true.
-- Partial index keeps it tiny — most rows are NOT for sale.
CREATE INDEX IF NOT EXISTS collection_for_sale_idx
  ON collection(user_id, for_sale)
  WHERE for_sale = true;
