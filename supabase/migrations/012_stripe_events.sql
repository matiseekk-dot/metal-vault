-- Stripe webhook event deduplication.
-- Stripe retries webhooks on non-2xx responses. Without dedup, we process
-- the same event multiple times (usually idempotent, but racy for concurrent updates).

CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,           -- Stripe event ID (evt_xxx)
  type        TEXT NOT NULL,              -- e.g. customer.subscription.updated
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: only service role (admin client) accesses this table
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- Auto-cleanup: keep only last 90 days of events
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at ON stripe_events(processed_at);
