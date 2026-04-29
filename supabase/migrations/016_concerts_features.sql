-- ============================================================
-- Metal Vault — Concert proximity + tour announcement features
-- ============================================================

-- 1) User location for "concerts within radius" filtering.
--    Optional — user grants via geolocation prompt or manual entry.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS location_lat       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_lng       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_city      TEXT,
  ADD COLUMN IF NOT EXISTS location_radius_km INTEGER DEFAULT 300;

-- 2) Track which concerts a user has already been notified about,
--    so we don't push the same "Gojira plays Warsaw in 14 days" twice.
CREATE TABLE IF NOT EXISTS concert_notifications (
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL,           -- Bandsintown event ID
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  kind        TEXT NOT NULL,           -- 'proximity' | 'announcement'
  PRIMARY KEY (user_id, event_id, kind)
);

-- Auto-cleanup old notifications (>180 days) — they aren't useful and bloat
CREATE INDEX IF NOT EXISTS idx_concert_notif_age
  ON concert_notifications(notified_at);

ALTER TABLE concert_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own concert notifs"
  ON concert_notifications FOR ALL USING (auth.uid() = user_id);

-- 3) Snapshot of "what events did each artist have yesterday" so daily-digest
--    can detect NEW announcements (events that weren't in cache 24h ago).
--    This is global (not per-user) — populated once per artist per day.
CREATE TABLE IF NOT EXISTS artist_event_snapshots (
  artist_name  TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  event_date   DATE,
  venue        TEXT,
  city         TEXT,
  country      TEXT,
  first_seen   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (artist_name, event_id)
);

CREATE INDEX IF NOT EXISTS idx_artist_snapshots_artist
  ON artist_event_snapshots(artist_name);

-- Snapshots are server-only. Block client access entirely.
ALTER TABLE artist_event_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_anon" ON artist_event_snapshots
  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "deny_auth" ON artist_event_snapshots
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- 4) Past concerts a user might have attended, prompted but not confirmed.
--    Loop close: Bandsintown event date passes → ask "did you go?" → if yes,
--    move to the user's existing local-storage concert log.
CREATE TABLE IF NOT EXISTS concert_attendance_prompts (
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id     TEXT NOT NULL,
  artist       TEXT NOT NULL,
  venue        TEXT,
  city         TEXT,
  event_date   DATE NOT NULL,
  status       TEXT DEFAULT 'pending',  -- 'pending' | 'attended' | 'dismissed'
  prompted_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id)
);

ALTER TABLE concert_attendance_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own attendance prompts"
  ON concert_attendance_prompts FOR ALL USING (auth.uid() = user_id);

-- Sanity selects (uncomment to inspect):
-- SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name LIKE 'location%';
-- SELECT * FROM concert_notifications LIMIT 1;
-- SELECT * FROM artist_event_snapshots LIMIT 1;
