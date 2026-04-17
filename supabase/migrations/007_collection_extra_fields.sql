-- ============================================================
-- Metal Vault — Add extended Discogs fields to collection
-- Run in Supabase → SQL Editor → New query → Run
-- ============================================================

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS year        INTEGER,
  ADD COLUMN IF NOT EXISTS genres      TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS styles      TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS discogs_url TEXT,
  ADD COLUMN IF NOT EXISTS date_added  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rating      INTEGER;

-- Also add to watchlist (used in sync)
ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS year         TEXT,
  ADD COLUMN IF NOT EXISTS discogs_url  TEXT;
