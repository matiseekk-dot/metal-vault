-- ============================================================
-- Metal Vault — Database Schema
-- Run this in Supabase → SQL Editor → New query → Run
-- ============================================================

-- User profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username    TEXT UNIQUE,
  display_name TEXT,
  avatar_url  TEXT,
  is_public   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on sign-up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Watchlist (want to buy)
CREATE TABLE IF NOT EXISTS watchlist (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  album_id     TEXT NOT NULL,
  artist       TEXT NOT NULL,
  album        TEXT NOT NULL,
  cover        TEXT,
  release_date TEXT,
  spotify_url  TEXT,
  added_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, album_id)
);

-- Collection (owned vinyl)
CREATE TABLE IF NOT EXISTS collection (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  discogs_id      BIGINT,
  artist          TEXT NOT NULL,
  album           TEXT NOT NULL,
  cover           TEXT,
  format          TEXT,
  color           TEXT,
  label           TEXT,
  purchase_price  DECIMAL(10,2),
  purchase_date   DATE,
  current_price   DECIMAL(10,2),
  last_price_check TIMESTAMPTZ,
  notes           TEXT,
  added_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Price alerts
CREATE TABLE IF NOT EXISTS price_alerts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  collection_id   UUID REFERENCES collection(id) ON DELETE CASCADE,
  discogs_id      BIGINT NOT NULL,
  artist          TEXT NOT NULL,
  album           TEXT NOT NULL,
  target_price    DECIMAL(10,2) NOT NULL,
  is_active       BOOLEAN DEFAULT true,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Artist follows (for new release notifications)
CREATE TABLE IF NOT EXISTS artist_follows (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  artist_name       TEXT NOT NULL,
  artist_spotify_id TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, artist_name)
);

-- Portfolio snapshots (for value-over-time chart)
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  snapshot_date DATE DEFAULT CURRENT_DATE,
  total_value   DECIMAL(10,2) DEFAULT 0,
  item_count    INTEGER DEFAULT 0,
  UNIQUE(user_id, snapshot_date)
);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist          ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection         ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_alerts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_follows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- Profiles: own row + public profiles readable by all
CREATE POLICY "Users can manage own profile"
  ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "Public profiles visible to all"
  ON profiles FOR SELECT USING (is_public = true);

-- All other tables: only own rows
CREATE POLICY "Own watchlist" ON watchlist FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Own collection" ON collection FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Own alerts" ON price_alerts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Own follows" ON artist_follows FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Own snapshots" ON portfolio_snapshots FOR ALL USING (auth.uid() = user_id);

-- Public collection items (if profile is public)
CREATE POLICY "Public collection visible"
  ON collection FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = collection.user_id
      AND profiles.is_public = true
    )
  );

-- ============================================================
-- Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_watchlist_user    ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_user   ON collection(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active     ON price_alerts(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_follows_user      ON artist_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user    ON portfolio_snapshots(user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
