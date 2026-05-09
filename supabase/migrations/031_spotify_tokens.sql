-- ============================================================
-- Migration 031 — spotify_tokens
-- ============================================================
-- Per-user Spotify Authorization Code OAuth tokens. Stores the
-- refresh_token (never expires unless revoked) so the auto-listen
-- sync can run server-side without re-auth. The access_token is
-- short-lived (1h) — we refresh it on every sync run rather than
-- caching.
--
-- Scope used: `user-read-recently-played` only. We deliberately
-- don't request playlist scopes — listen import is the entire
-- product surface, and asking for more breeds permission anxiety.
-- ============================================================

CREATE TABLE IF NOT EXISTS spotify_tokens (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token  text NOT NULL,
  scope          text,
  -- Spotify "user_id" within their domain — for show-in-UI confirm
  -- ("Connected as <display_name>") + sanity check on token reuse.
  spotify_id     text,
  display_name   text,
  -- Last successful auto-import — used to query Spotify
  -- /me/player/recently-played?after=<this> on next sync, so we
  -- don't re-import the same play twice.
  last_synced_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS — user can only see/manage their own row
ALTER TABLE spotify_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own spotify token" ON spotify_tokens;
CREATE POLICY "Own spotify token"
  ON spotify_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
