-- ============================================================
-- Migration 029 — collection.master_id
-- ============================================================
-- Why this exists:
-- The repress-detection cron (api/cron/repress) needs to query
-- Discogs /masters/{master_id}/versions for every album in the
-- collection. Without a stored master_id we'd have to first hit
-- /releases/{discogs_id} → master_id every run = 2× the request
-- count + 2× the rate-limit pressure.
--
-- master_id is also useful for variant tracking (the "deep variant"
-- feature in v1.1 — same master, all variants visible).
--
-- Backfill is lazy: cron resolves missing master_id on first run
-- per item and writes back. No bulk migration script needed.
-- ============================================================

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS master_id bigint;

-- Index because cron groups by master_id (multiple users sharing
-- the same album → one Discogs lookup serves all).
CREATE INDEX IF NOT EXISTS collection_master_id_idx
  ON collection(master_id)
  WHERE master_id IS NOT NULL;
