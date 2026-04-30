-- ============================================================
-- Metal Vault — User photos for collection items
-- Lets users upload sleeve/condition photos for insurance and
-- personal cataloging beyond the generic Discogs cover.
-- ============================================================
-- IDEMPOTENT — safe to re-run multiple times. Each section uses
-- IF NOT EXISTS or DROP-then-CREATE to handle partial-runs gracefully.

-- 1) Add user_photos column to collection table
-- JSONB array of photo metadata: [{ url, path, uploaded_at, label }]
-- Path is the Supabase Storage path (so we can delete on item removal).
-- Label is optional ("front", "back", "inside", custom) — UI may show.
ALTER TABLE collection
  ADD COLUMN IF NOT EXISTS user_photos JSONB DEFAULT '[]'::jsonb;

-- Index for queries that filter by photo presence (rare but cheap)
CREATE INDEX IF NOT EXISTS idx_collection_has_photos
  ON collection ((jsonb_array_length(user_photos) > 0))
  WHERE jsonb_array_length(user_photos) > 0;

-- 2) Create Supabase Storage bucket for collection photos.
-- Bucket is PRIVATE — photos accessed via signed URLs only.
-- This protects user content from being scraped via predictable URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'collection-photos',
  'collection-photos',
  false,                                    -- private bucket
  10485760,                                  -- 10MB cap per file (compress before upload)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 3) Storage RLS policies — users can only access their own photos.
-- Path convention: {user_id}/{collection_item_id}/{uuid}.{ext}
--
-- Postgres doesn't support CREATE POLICY IF NOT EXISTS, so we DROP first.
-- This is safe even on first run — DROP IF EXISTS is no-op if missing.

DROP POLICY IF EXISTS "Users upload own photos" ON storage.objects;
DROP POLICY IF EXISTS "Users read own photos"   ON storage.objects;
DROP POLICY IF EXISTS "Users delete own photos" ON storage.objects;
DROP POLICY IF EXISTS "Anon no access"          ON storage.objects;

-- Users can upload to their own folder
CREATE POLICY "Users upload own photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'collection-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can read their own photos
CREATE POLICY "Users read own photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'collection-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete their own photos
CREATE POLICY "Users delete own photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'collection-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Anonymous = no access at all
CREATE POLICY "Anon no access"
  ON storage.objects FOR ALL TO anon
  USING (bucket_id = 'collection-photos' AND false)
  WITH CHECK (false);

-- Verify after migration:
-- SELECT column_name FROM information_schema.columns WHERE table_name='collection' AND column_name='user_photos';
-- SELECT * FROM storage.buckets WHERE id='collection-photos';
-- SELECT policyname FROM pg_policies WHERE tablename='objects' AND policyname LIKE '%photo%';
