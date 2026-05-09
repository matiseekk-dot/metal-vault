-- ============================================================
-- Migration 028 — Repress announcements
-- ============================================================
-- Why this exists:
-- Most metal collectors learn about a repress 2-3 days too late, when
-- pre-orders are already sold out. CLZ Music doesn't track this at
-- all. Discogs surfaces "upcoming releases" via artist pages, but
-- there's no proactive alerting — you have to manually check every
-- few days for every artist you care about.
--
-- This table stores repress events the cron detects (a new Discogs
-- release for an album the user already owns + a Discogs release
-- date that's ≥ today). Each row is a row of a "repress feed" the
-- user can browse + the source of a push notification.
--
-- A row exists per (user, master_id) so a single Mastodon "Crack The
-- Skye" repress fans out into one row per user who has the album
-- in their collection. Saves a join in the read path.
-- ============================================================

CREATE TABLE IF NOT EXISTS repress_announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Discogs master_release_id (groups all variants of an album)
  -- Plus the specific release_id of the new repress so we can
  -- deep-link directly to the Discogs marketplace listing.
  master_id       bigint NOT NULL,
  release_id      bigint NOT NULL,
  artist          text NOT NULL,
  album           text NOT NULL,
  cover           text,
  format          text,             -- "Vinyl, LP, Reissue, Limited Edition" etc.
  label           text,
  catno           text,
  country         text,
  release_date    date NOT NULL,    -- the announced release date
  detected_at     timestamptz NOT NULL DEFAULT now(),
  -- Did we already push for this row? Stops re-notifying when the
  -- cron sees the same release on the next pass.
  notified_at     timestamptz,
  -- User-side acknowledgement — when they tapped the row in the UI.
  -- Lets the feed "fade" handled items without deleting them
  -- (history is useful for "did I miss the Nuclear Blast repress?").
  dismissed_at    timestamptz
);

-- Idempotency: same user can't get two notifications for the same
-- release. Cron uses ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS repress_announcements_uniq
  ON repress_announcements(user_id, release_id);

-- Read path: most-recent unread repressy on top.
CREATE INDEX IF NOT EXISTS repress_announcements_user_recent
  ON repress_announcements(user_id, dismissed_at NULLS FIRST, detected_at DESC);

-- RLS
ALTER TABLE repress_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own repress" ON repress_announcements;
CREATE POLICY "Own repress"
  ON repress_announcements FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
