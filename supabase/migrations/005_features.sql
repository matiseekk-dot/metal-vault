-- ============================================================
-- Metal Vault — Push notifications, grading, share tokens
-- Run in Supabase → SQL Editor → New query → Run
-- ============================================================

-- Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own push subs" ON push_subscriptions FOR ALL USING (auth.uid() = user_id);

-- Vinyl grading on collection items
ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS grade      TEXT DEFAULT 'NM',
  ADD COLUMN IF NOT EXISTS grade_note TEXT;

-- Share tokens for public collection links
CREATE TABLE IF NOT EXISTS share_tokens (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  label      TEXT DEFAULT 'My Collection',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE share_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own share tokens" ON share_tokens FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public share tokens readable" ON share_tokens FOR SELECT USING (true);

-- Discogs OAuth tokens (for import without manual username)
CREATE TABLE IF NOT EXISTS discogs_tokens (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  access_token     TEXT NOT NULL,
  access_secret    TEXT NOT NULL,
  discogs_username TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE discogs_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own discogs token" ON discogs_tokens FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_share_token ON share_tokens(token);
