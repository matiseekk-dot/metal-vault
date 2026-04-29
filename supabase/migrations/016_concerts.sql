-- ============================================================
-- Metal Vault — Concert proximity push infrastructure
-- ============================================================
-- Two new tables + 3 optional columns on profiles.
--
-- 1. artist_event_snapshots — daily snapshot of Bandsintown events per
--    artist. Used by cron to detect NEW announcements (events not seen
--    yesterday). Globally shared across all users (one row per
--    artist+event), so we don't multiply storage by user count.
--
-- 2. concert_notifications — per-user dedup log of which concert pushes
--    we've already sent. Prevents spamming the same notification on
--    consecutive cron runs.
--
-- 3. profiles.location_lat/lng/radius_km — optional, lets users get
--    proximity-filtered concert pushes. NULL = worldwide alerts (still
--    works, just less useful for users in remote areas).
-- ============================================================

-- ── artist_event_snapshots ──
-- Server-side snapshot of all known Bandsintown events. Populated by the
-- daily-digest cron. Service-role only (no RLS policies needed because
-- we'll explicitly DENY anon/auth in next migration), but we enable RLS
-- per the security policy (see migration 015 pattern).
CREATE TABLE IF NOT EXISTS artist_event_snapshots (
  artist_name  TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  event_date   DATE NOT NULL,
  venue        TEXT,
  city         TEXT,
  country      TEXT,
  first_seen   TIMESTAMPTZ DEFAULT NOW(),
  last_seen    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (artist_name, event_id)
);

CREATE INDEX IF NOT EXISTS idx_artist_event_snapshots_date
  ON artist_event_snapshots(event_date);
CREATE INDEX IF NOT EXISTS idx_artist_event_snapshots_artist
  ON artist_event_snapshots(artist_name);

ALTER TABLE artist_event_snapshots ENABLE ROW LEVEL SECURITY;
-- Server-only table — explicit DENY for anon/authenticated to satisfy Advisor
DROP POLICY IF EXISTS "deny_anon" ON artist_event_snapshots;
DROP POLICY IF EXISTS "deny_auth" ON artist_event_snapshots;
CREATE POLICY "deny_anon" ON artist_event_snapshots FOR ALL TO anon          USING (false) WITH CHECK (false);
CREATE POLICY "deny_auth" ON artist_event_snapshots FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ── concert_notifications ──
-- Per-user log of concert pushes already delivered. Two kinds:
--   • 'proximity'   — concert within radius and ≤14 days
--   • 'announcement' — newly-detected event (not in snapshot yesterday)
-- One row per (user, event, kind). Kind is part of the key because a user
-- might get a proximity ping for an event they previously got an
-- announcement ping for, weeks earlier — those are different signals.
CREATE TABLE IF NOT EXISTS concert_notifications (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('proximity', 'announcement')),
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_concert_notifications_user
  ON concert_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_concert_notifications_event
  ON concert_notifications(event_id);

ALTER TABLE concert_notifications ENABLE ROW LEVEL SECURITY;
-- User can read their own dedup log (e.g. for showing notification history),
-- but never write — only the cron service_role inserts.
DROP POLICY IF EXISTS "Own concert notifications read" ON concert_notifications;
CREATE POLICY "Own concert notifications read" ON concert_notifications
  FOR SELECT USING (auth.uid() = user_id);
-- Inserts are service_role only (bypasses RLS automatically).

-- ── profiles location columns ──
-- Optional. NULL means user accepts worldwide alerts.
-- location_radius_km defaults to 300 — broad enough to cover most road trips,
-- narrow enough to filter out continent-spanning tours.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS location_lat        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_lng        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_radius_km  INTEGER DEFAULT 300;

COMMENT ON COLUMN profiles.location_lat IS
  'Optional user latitude for concert proximity push notifications. NULL = no proximity filter.';
COMMENT ON COLUMN profiles.location_radius_km IS
  'Radius in km for proximity-filtered concert pings. Default 300km. Min 50, recommended max 1000.';
