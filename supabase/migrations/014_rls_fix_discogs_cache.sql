-- ============================================================
-- Metal Vault — Security fix: enable RLS on discogs_cache
-- ============================================================
-- CRITICAL: Without RLS, the anon key (which is shipped to every browser)
-- has full read/write access to this table by default. This means:
--   • anyone with the project URL can dump the entire cache
--   • anyone can POISON the cache with fake price data
--   • anyone can mass-delete or spam-insert rows
--
-- This table is a server-side cache — no end user should ever read or write
-- to it directly. All access goes through our API routes using the
-- service_role key (which bypasses RLS).
--
-- Fix: enable RLS and create NO permissive policies. This blocks anon/auth
-- access entirely. Service role continues to work (bypasses RLS by design).
-- ============================================================

ALTER TABLE discogs_cache ENABLE ROW LEVEL SECURITY;

-- No permissive policies created on purpose — this locks the table to
-- service_role only. If we ever need public reads, add:
--   CREATE POLICY "cache_public_read" ON discogs_cache FOR SELECT USING (true);
-- But for now: pure server-side cache, no client access.

-- Sanity check: show that no policies exist (should return 0 rows)
-- SELECT policyname FROM pg_policies WHERE tablename = 'discogs_cache';
