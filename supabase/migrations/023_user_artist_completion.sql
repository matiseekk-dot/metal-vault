-- ============================================================
-- Metal Vault — User artist completion sync
-- ============================================================
-- "I own all this band's albums" toggle in BandsTab. One row per
-- (user, artist_name); presence = completed.
--
-- Previously stored only in localStorage as `mv_complete_artists`,
-- so it didn't follow the user across devices.
-- ============================================================

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
