-- ============================================================
-- Metal Vault — Add WITH CHECK to user-data RLS policies
-- ============================================================
-- Background:
-- Earlier migrations created policies as `FOR ALL USING (auth.uid() = user_id)`
-- without a `WITH CHECK` clause. Postgres treats USING as the read/visibility
-- predicate; for INSERT/UPDATE the WITH CHECK predicate is what guards new
-- row values. When WITH CHECK is omitted on a `FOR ALL` policy, INSERT is
-- effectively wide open (any value of user_id is accepted) and UPDATE allows
-- a row's user_id to be reassigned to another user as long as the OLD row
-- was visible to the caller.
--
-- This migration drops and recreates each affected policy with explicit
-- WITH CHECK so write paths require auth.uid() = user_id (or = id for
-- profiles).
-- ============================================================

-- profiles (PK column is id, not user_id)
DROP POLICY IF EXISTS "Users can manage own profile" ON profiles;
CREATE POLICY "Users can manage own profile"
  ON profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- watchlist
DROP POLICY IF EXISTS "Own watchlist" ON watchlist;
CREATE POLICY "Own watchlist"
  ON watchlist FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- collection
DROP POLICY IF EXISTS "Own collection" ON collection;
CREATE POLICY "Own collection"
  ON collection FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- price_alerts
DROP POLICY IF EXISTS "Own alerts" ON price_alerts;
CREATE POLICY "Own alerts"
  ON price_alerts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- artist_follows
DROP POLICY IF EXISTS "Own follows" ON artist_follows;
CREATE POLICY "Own follows"
  ON artist_follows FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- portfolio_snapshots
DROP POLICY IF EXISTS "Own snapshots" ON portfolio_snapshots;
CREATE POLICY "Own snapshots"
  ON portfolio_snapshots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- push_subscriptions  (from 005_features.sql)
DROP POLICY IF EXISTS "Own push subs" ON push_subscriptions;
CREATE POLICY "Own push subs"
  ON push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- share_tokens  (from 005_features.sql)
DROP POLICY IF EXISTS "Own share tokens" ON share_tokens;
CREATE POLICY "Own share tokens"
  ON share_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- discogs_tokens  (from 005_features.sql)
DROP POLICY IF EXISTS "Own discogs token" ON discogs_tokens;
CREATE POLICY "Own discogs token"
  ON discogs_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_streaks  (from 013_user_streaks.sql)
DROP POLICY IF EXISTS "Own streak" ON user_streaks;
CREATE POLICY "Own streak"
  ON user_streaks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- concert_notifications  (from 016_concerts_features.sql)
DROP POLICY IF EXISTS "Own concert notifications" ON concert_notifications;
CREATE POLICY "Own concert notifications"
  ON concert_notifications FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- concert_attendance_prompts  (from 016_concerts_features.sql)
DROP POLICY IF EXISTS "Own concert attendance prompts" ON concert_attendance_prompts;
CREATE POLICY "Own concert attendance prompts"
  ON concert_attendance_prompts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Sanity check (uncomment in SQL editor to verify all policies have WITH CHECK):
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'profiles','watchlist','collection','price_alerts','artist_follows',
--     'portfolio_snapshots','push_subscriptions','share_tokens',
--     'discogs_tokens','user_streaks','concert_notifications',
--     'concert_attendance_prompts'
--   )
--   AND with_check IS NULL;
-- The above query should return ZERO rows.
