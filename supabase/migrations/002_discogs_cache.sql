-- ============================================================
-- Metal Vault — Discogs Cache
-- Run in Supabase → SQL Editor → New query → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS discogs_cache (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key   TEXT UNIQUE NOT NULL,  -- "artist::album"
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

-- Index for fast lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_discogs_cache_key     ON discogs_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_discogs_cache_expires ON discogs_cache(expires_at);

-- Auto-delete expired rows (runs via Supabase pg_cron if enabled,
-- otherwise the API cleans up on read)
-- Optional: enable pg_cron in Supabase → Database → Extensions → pg_cron
-- SELECT cron.schedule('cleanup-discogs-cache', '0 * * * *',
--   'DELETE FROM discogs_cache WHERE expires_at < NOW()');

-- No RLS needed — only service role writes, anon key reads
-- (all access goes through our API route, never directly from browser)
