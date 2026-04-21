-- Detailed grading per collection item (Pro feature)
-- Existing `grade` column kept for backward compat = overall/record grade
-- New columns break it down per component

ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS sleeve_grade        TEXT,  -- outer cover condition
  ADD COLUMN IF NOT EXISTS vinyl_grade         TEXT,  -- playing surface condition
  ADD COLUMN IF NOT EXISTS inner_sleeve_grade  TEXT,  -- inner sleeve / lyric insert
  ADD COLUMN IF NOT EXISTS hype_sticker        BOOLEAN DEFAULT false,  -- original hype sticker intact
  ADD COLUMN IF NOT EXISTS playback_notes      TEXT;  -- free-form notes (pops, clicks, skips, warps)

COMMENT ON COLUMN collection.sleeve_grade IS 'Goldmine grade of outer sleeve/jacket (M/NM/VG+/VG/G+/G/F/P)';
COMMENT ON COLUMN collection.vinyl_grade IS 'Goldmine grade of the record/vinyl itself';
COMMENT ON COLUMN collection.inner_sleeve_grade IS 'Goldmine grade of inner sleeve, lyric sheet, or insert';
COMMENT ON COLUMN collection.hype_sticker IS 'Original hype sticker still attached/intact';
COMMENT ON COLUMN collection.playback_notes IS 'Playback issues: pops, clicks, surface noise, skips, warps';
