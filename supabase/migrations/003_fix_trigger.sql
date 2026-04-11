-- ============================================================
-- Metal Vault — Fix missing trigger (run this in SQL Editor)
-- ============================================================

-- Re-create the trigger that auto-creates profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Discogs cache table (if not exists)
CREATE TABLE IF NOT EXISTS discogs_cache (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key   TEXT UNIQUE NOT NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_discogs_cache_key     ON discogs_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_discogs_cache_expires ON discogs_cache(expires_at);
