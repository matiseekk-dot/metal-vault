-- ============================================================
-- Metal Vault — RevenueCat subscription support (dual-mode)
-- ============================================================
-- Architecture decision: Stripe (web) and RevenueCat (Play Store) coexist.
-- Both write to canonical subscription_status / subscription_end columns.
-- The isPremium() check stays unchanged — single source of truth.
--
-- New columns:
--   subscription_source       — which provider made the purchase
--   revenuecat_user_id        — RC's customer identifier (usually = supabase user.id)
--   revenuecat_entitlements   — JSONB snapshot of RC entitlements (debug/audit)
--
-- The subscription_id column already exists from migration 008 (Stripe).
-- We reuse it for RevenueCat too — stores the RC original_app_user_id or
-- the latest transaction_id depending on context.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS subscription_source     TEXT
    CHECK (subscription_source IN ('stripe', 'revenuecat') OR subscription_source IS NULL),
  ADD COLUMN IF NOT EXISTS revenuecat_user_id      TEXT,
  ADD COLUMN IF NOT EXISTS revenuecat_entitlements JSONB;

CREATE INDEX IF NOT EXISTS idx_profiles_revenuecat_user
  ON profiles(revenuecat_user_id)
  WHERE revenuecat_user_id IS NOT NULL;

-- Idempotency table for RC webhooks (mirrors stripe_events pattern)
-- Each RC event has a unique `id` field — we use INSERT-first to dedupe.
CREATE TABLE IF NOT EXISTS revenuecat_events (
  id           TEXT PRIMARY KEY,             -- RC event.id
  event_type   TEXT NOT NULL,                -- INITIAL_PURCHASE, RENEWAL, CANCELLATION, etc.
  app_user_id  TEXT,                          -- RC's user identifier
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  payload      JSONB                          -- raw event for debug
);

CREATE INDEX IF NOT EXISTS idx_revenuecat_events_user
  ON revenuecat_events(app_user_id);

ALTER TABLE revenuecat_events ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write (this table is internal billing infra).
-- DROP IF EXISTS first so re-running migration doesn't fail with policy conflict.
DROP POLICY IF EXISTS "deny_anon_revenuecat_events" ON revenuecat_events;
DROP POLICY IF EXISTS "deny_auth_revenuecat_events" ON revenuecat_events;

CREATE POLICY "deny_anon_revenuecat_events" ON revenuecat_events
  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "deny_auth_revenuecat_events" ON revenuecat_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Verify after migration:
-- SELECT column_name FROM information_schema.columns 
--   WHERE table_name='profiles' AND column_name LIKE '%revenuecat%';
-- SELECT * FROM revenuecat_events LIMIT 1;
