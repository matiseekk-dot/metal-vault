-- ── Native push (FCM) device tokens ──────────────────────────────
--
-- push_subscriptions holds Web Push endpoints (VAPID) — the Android
-- WebView can't produce those, so the Capacitor app registers an FCM
-- token instead. Separate table because the shapes differ (no
-- p256dh/auth keys) and web-push sending must never see FCM rows.
--
-- token is UNIQUE across users on purpose: an FCM token identifies one
-- app install. If a different account signs in on the same phone, the
-- register endpoint re-assigns the row to the new user instead of
-- leaving the old account receiving the new account's notifications.
--
-- Writes go through the service role (POST/DELETE /api/push/device),
-- so RLS only needs to let a user read their own rows.

CREATE TABLE IF NOT EXISTS device_tokens (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        TEXT        NOT NULL UNIQUE,
  platform     TEXT        NOT NULL DEFAULT 'android',
  app_version  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own device tokens readable" ON device_tokens;
CREATE POLICY "Own device tokens readable" ON device_tokens
  FOR SELECT USING (auth.uid() = user_id);
