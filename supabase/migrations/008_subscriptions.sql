-- ============================================================
-- Metal Vault — Premium subscription support
-- Run in Supabase → SQL Editor → New query → Run
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id   TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS subscription_status  TEXT NOT NULL DEFAULT 'free',
  -- 'free' | 'active' | 'past_due' | 'canceled' | 'trialing'
  ADD COLUMN IF NOT EXISTS subscription_id      TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS subscription_end     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan                 TEXT NOT NULL DEFAULT 'free';
  -- 'free' | 'pro_monthly' | 'pro_yearly'

-- Index for Stripe webhook lookups
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer
  ON profiles(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_profiles_subscription
  ON profiles(subscription_id);
