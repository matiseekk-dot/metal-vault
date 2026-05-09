-- ============================================================
-- Migration 032 — lastfm_tokens
-- ============================================================
-- Per-user Last.fm session_key. Last.fm's web-auth flow yields a
-- key that never expires unless the user explicitly revokes from
-- last.fm/settings/applications, so we don't need refresh logic
-- like the Spotify table.
--
-- Why Last.fm matters: it's a bridge to nearly every streaming
-- service via free third-party scrobblers — Apple Music (via iOS
-- shortcuts / Marvis app), Tidal, YouTube Music, Plex, iTunes.
-- One auth → coverage of platforms we'd otherwise need 5
-- separate integrations for.
-- ============================================================

CREATE TABLE IF NOT EXISTS lastfm_tokens (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key    text NOT NULL,         -- Last.fm sk= for user-context calls
  username       text NOT NULL,         -- Last.fm display username
  -- last_synced_at is the unix-seconds threshold for the next
  -- `from=` parameter on user.getRecentTracks. Stored as timestamptz
  -- for human readability; we convert to seconds at query time.
  last_synced_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS — user can only see/manage their own row
ALTER TABLE lastfm_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own lastfm token" ON lastfm_tokens;
CREATE POLICY "Own lastfm token"
  ON lastfm_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
