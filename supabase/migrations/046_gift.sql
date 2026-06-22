-- ============================================================
-- Migration 046 — gift flag on collection
-- ============================================================
-- Why this exists:
--   Collectors often receive records as presents — birthday gifts,
--   Christmas, "thanks for the show" from a band, hand-me-downs
--   from a friend who downsized. Flagging these matters because:
--     (a) they don't belong in the lifetime-spend chart (the user
--         didn't actually pay for them)
--     (b) the sentimental story attached ("from my dad's collection")
--         is worth preserving as structured data, not just buried
--         in the free-text notes field
--     (c) collectors love seeing "how much of my vault was gifted"
--         — small stat that surfaces well on the profile page
--
-- Schema additions (idempotent):
--   is_gift   boolean NOT NULL DEFAULT false
--   gift_from text    NULL  -- free-text, e.g. "Tata", "Łukasz", "Brutal Assault 2018"
--
-- UI behaviour (handled client-side):
--   - Toggle in Vault expanded card: "🎁 Otrzymane w prezencie"
--   - Optional "Od kogo" input that surfaces when is_gift=true
--   - "🎁 GIFT" badge on the row
--   - Filter chip "🎁 Prezenty" surfaces gift items
--   - Portfolio summary: purchase_price for gifts treated as 0 in
--     totalPaid (we didn't spend that money) but counted in
--     current value/itemCount (we OWN the record)
-- ============================================================

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS is_gift   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_from text;

-- Index for the "Prezenty" filter chip — partial keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_collection_gift
  ON collection(user_id)
  WHERE is_gift = true;
