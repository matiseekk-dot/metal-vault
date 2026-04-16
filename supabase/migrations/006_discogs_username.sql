-- Add discogs_username to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS discogs_username TEXT;
