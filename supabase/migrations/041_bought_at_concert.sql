-- ============================================================
-- Migration 041 — link a vinyl in the Vault to the concert it
-- was bought at. The "vinyl × concert" bridge.
-- ============================================================
-- Why this exists:
--   Nobody else does this. Discogs doesn't know you went to the
--   show. Bandsintown doesn't know you bought the record. Tagging
--   a Vault item with the concert where you grabbed it makes the
--   "concert → memory → physical thing" loop concrete and turns
--   the journal into a real time-machine ("which records did I
--   get at Brutal Assault 2018?").
--
-- Storage:
--   bought_at_concert_id  text NULL — references user_concerts.client_id
--
-- No foreign key:
--   user_concerts.client_id is itself a denormalised text PK that
--   can be a UUID OR a JS-generated id depending on origin (manual
--   add vs LFM import). Cross-table FK on a free-form text column
--   is a maintenance pain; we treat the linkage as a soft pointer
--   and tolerate dangling references (concert deleted → vinyl just
--   shows no link). Cheap, safe, RLS already covers access.
--
-- Optional sub-features (NOT in this migration, may come later):
--   bought_price (free text — "150 PLN at merch booth"). Already
--   covered by purchase_price + a note in the existing schema; no
--   new column needed.
-- ============================================================

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS bought_at_concert_id text;

-- Index so the reverse lookup ("which Vault items are linked to
-- this concert?") in ConcertsTab is one quick scan.
CREATE INDEX IF NOT EXISTS idx_collection_bought_at_concert
  ON collection(user_id, bought_at_concert_id)
  WHERE bought_at_concert_id IS NOT NULL;
