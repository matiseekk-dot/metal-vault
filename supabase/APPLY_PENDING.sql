-- ============================================================
-- METAL VAULT  --  APPLY ALL PENDING MIGRATIONS  (021 + 022 + 023)
-- ============================================================
-- One-shot copy-paste file. In Supabase Dashboard:
--   SQL Editor  >  New query  >  paste this whole file  >  Run.
--
-- All three migrations are idempotent
-- (DROP POLICY IF EXISTS, CREATE TABLE IF NOT EXISTS, etc.)
-- so it is safe to re-run.
--
-- After it runs, the two SANITY CHECKs at the bottom should
-- return: zero rows for check A, three rows for check B.
-- ============================================================


-- ============================================================
-- Migration 021: WITH CHECK on user-data RLS policies
-- ============================================================
-- Earlier policies used `FOR ALL USING (auth.uid() = user_id)` without
-- WITH CHECK. Postgres treats USING as the read predicate; for
-- INSERT/UPDATE the WITH CHECK predicate is what guards new row values.
-- Without it, a user could UPDATE a row to swap user_id to someone else.

DROP POLICY IF EXISTS "Users can manage own profile" ON profiles;
CREATE POLICY "Users can manage own profile"
  ON profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Own watchlist" ON watchlist;
CREATE POLICY "Own watchlist"
  ON watchlist FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own collection" ON collection;
CREATE POLICY "Own collection"
  ON collection FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own alerts" ON price_alerts;
CREATE POLICY "Own alerts"
  ON price_alerts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own follows" ON artist_follows;
CREATE POLICY "Own follows"
  ON artist_follows FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own snapshots" ON portfolio_snapshots;
CREATE POLICY "Own snapshots"
  ON portfolio_snapshots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own push subs" ON push_subscriptions;
CREATE POLICY "Own push subs"
  ON push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own share tokens" ON share_tokens;
CREATE POLICY "Own share tokens"
  ON share_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own discogs token" ON discogs_tokens;
CREATE POLICY "Own discogs token"
  ON discogs_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own streak" ON user_streaks;
CREATE POLICY "Own streak"
  ON user_streaks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own concert notifications" ON concert_notifications;
CREATE POLICY "Own concert notifications"
  ON concert_notifications FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own concert attendance prompts" ON concert_attendance_prompts;
CREATE POLICY "Own concert attendance prompts"
  ON concert_attendance_prompts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- Migration 022: user_concerts + user_venues
-- ============================================================
-- Personal concert journal that previously lived only in localStorage.
-- client_id holds the crypto.randomUUID() the client already generates,
-- so existing localStorage rows migrate up without any ID rewrite.
-- Built-in venues stay hardcoded in app/concerts/ConcertsTab.js.

CREATE TABLE IF NOT EXISTS user_concerts (
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id   TEXT NOT NULL,
  band        TEXT NOT NULL,
  venue_id    TEXT,
  year        TEXT,
  genre       TEXT DEFAULT 'Metal',
  rating      SMALLINT DEFAULT 0,
  price       TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS user_venues (
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  city        TEXT DEFAULT '',
  cat         TEXT DEFAULT 'Other',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_user_concerts_user
  ON user_concerts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_venues_user
  ON user_venues(user_id);

ALTER TABLE user_concerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_venues   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own concerts" ON user_concerts;
CREATE POLICY "Own concerts"
  ON user_concerts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own venues" ON user_venues;
CREATE POLICY "Own venues"
  ON user_venues FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION user_concerts_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_concerts_touch ON user_concerts;
CREATE TRIGGER user_concerts_touch
  BEFORE UPDATE ON user_concerts
  FOR EACH ROW EXECUTE FUNCTION user_concerts_touch_updated_at();


-- ============================================================
-- Migration 023: user_artist_completion
-- ============================================================
-- "I own all this band's albums" toggle in BandsTab. One row per
-- (user, artist_name); presence = completed. Previously localStorage
-- only as `mv_complete_artists`, did not sync between devices.

CREATE TABLE IF NOT EXISTS user_artist_completion (
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  artist_name  TEXT NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, artist_name)
);

ALTER TABLE user_artist_completion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own artist completion" ON user_artist_completion;
CREATE POLICY "Own artist completion"
  ON user_artist_completion FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- SANITY CHECK A  --  should return ZERO rows after a successful run.
-- Every user-data FOR ALL policy must have WITH CHECK populated.
-- ============================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles','watchlist','collection','price_alerts','artist_follows',
    'portfolio_snapshots','push_subscriptions','share_tokens',
    'discogs_tokens','user_streaks','concert_notifications',
    'concert_attendance_prompts','user_concerts','user_venues',
    'user_artist_completion'
  )
  AND cmd = 'ALL'
  AND with_check IS NULL;


-- ============================================================
-- SANITY CHECK B  --  should return THREE rows after a successful run.
-- The three new tables created by 022+023.
-- ============================================================
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('user_concerts','user_venues','user_artist_completion')
ORDER BY table_name;
