-- ============================================================
-- Metal Vault — Watchlist variant fields (format, color, label)
-- So users can distinguish different pressings of same album
-- ============================================================

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS format TEXT,
  ADD COLUMN IF NOT EXISTS color  TEXT,
  ADD COLUMN IF NOT EXISTS label  TEXT;
