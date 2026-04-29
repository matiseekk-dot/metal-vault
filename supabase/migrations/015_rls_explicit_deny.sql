-- ============================================================
-- Metal Vault — Explicit DENY policies for server-only tables
-- ============================================================
-- Why this migration exists:
-- Supabase Security Advisor flags tables with RLS enabled + 0 policies as
-- "Info: RLS Enabled No Policy". The previous setup (migration 014 for
-- discogs_cache and 012 for stripe_events) was intentional — these tables
-- should ONLY be accessed by service_role, which bypasses RLS.
--
-- However, Advisor can't tell intent from config alone. This migration adds
-- EXPLICIT DENY policies that produce identical runtime behavior but
-- quiet the Advisor Info flag.
--
-- The policies are technically redundant (no policies = no access) but make
-- the intent self-documenting: "anon and authenticated roles are blocked
-- on purpose."
-- ============================================================

-- discogs_cache — server-side price cache, never touched by clients
DROP POLICY IF EXISTS "deny_anon"    ON discogs_cache;
DROP POLICY IF EXISTS "deny_auth"    ON discogs_cache;
CREATE POLICY "deny_anon" ON discogs_cache FOR ALL TO anon          USING (false) WITH CHECK (false);
CREATE POLICY "deny_auth" ON discogs_cache FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- stripe_events — Stripe webhook idempotency log, never touched by clients
DROP POLICY IF EXISTS "deny_anon"    ON stripe_events;
DROP POLICY IF EXISTS "deny_auth"    ON stripe_events;
CREATE POLICY "deny_anon" ON stripe_events FOR ALL TO anon          USING (false) WITH CHECK (false);
CREATE POLICY "deny_auth" ON stripe_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Sanity check (uncomment to verify):
-- SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE tablename IN ('discogs_cache', 'stripe_events')
--   ORDER BY tablename, policyname;
