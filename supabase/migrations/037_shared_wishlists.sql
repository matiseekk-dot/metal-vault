-- ============================================================
-- Migration 037 — shared wishlists ("co kupić mi na święta")
-- ============================================================
-- Why this exists:
--   The user's regular watchlist is private — it powers price alerts
--   and personal organization. A "gift wishlist" is fundamentally
--   different: it's curated, named, and meant to be SHARED with
--   someone else (Christmas, birthday, name-day). Different intent,
--   different surface.
--
-- Key shape:
--   wishlists       — one row per named list. share_token is a
--                     random URL-safe id; anyone with the link can
--                     view a public wishlist without auth.
--   wishlist_items  — albums on the list. notes column lets the
--                     owner say "specifically the blue pressing"
--                     — gift-giver context.
--
-- RLS:
--   • Owners can CRUD their own wishlists / items.
--   • Anonymous SELECT allowed for public lists (viewed via share
--     link). Non-public is owner-only.
-- ============================================================

CREATE TABLE IF NOT EXISTS wishlists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 400),
  -- 24-char base64url token. Just random enough to not be guessable
  -- by URL enumeration (~144 bits). Index unique so we never collide
  -- in the rare case the RNG hits the same value twice.
  share_token  text NOT NULL UNIQUE
                CHECK (share_token ~ '^[A-Za-z0-9_-]{16,64}$'),
  is_public    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wishlists_owner ON wishlists(owner_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_token ON wishlists(share_token);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id  uuid NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  artist       text NOT NULL,
  album        text NOT NULL,
  cover        text,
  album_id     text,           -- Discogs release id (numeric) or slug
  discogs_url  text,
  notes        text CHECK (notes IS NULL OR length(notes) <= 200),
  position     int NOT NULL DEFAULT 0,    -- manual order
  added_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wishlist_items_wid
  ON wishlist_items(wishlist_id, position);

-- RLS
ALTER TABLE wishlists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlist_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wishlists owner all"     ON wishlists;
DROP POLICY IF EXISTS "wishlists public select" ON wishlists;
DROP POLICY IF EXISTS "wishlist_items owner all" ON wishlist_items;
DROP POLICY IF EXISTS "wishlist_items public select" ON wishlist_items;

-- Owner: full control over their own rows.
CREATE POLICY "wishlists owner all"
  ON wishlists FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Anyone (incl. anonymous) can read public lists.
-- Important: we still restrict by is_public so a private list never
-- leaks even if someone discovers the share_token.
CREATE POLICY "wishlists public select"
  ON wishlists FOR SELECT
  USING (is_public = true);

-- Items: owner-via-parent for write, public-via-parent for read.
CREATE POLICY "wishlist_items owner all"
  ON wishlist_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM wishlists w
    WHERE w.id = wishlist_items.wishlist_id AND w.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM wishlists w
    WHERE w.id = wishlist_items.wishlist_id AND w.owner_id = auth.uid()
  ));

CREATE POLICY "wishlist_items public select"
  ON wishlist_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM wishlists w
    WHERE w.id = wishlist_items.wishlist_id AND w.is_public = true
  ));

-- Update timestamp helper trigger so updated_at reflects edits.
CREATE OR REPLACE FUNCTION wishlists_touch()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS wishlists_touch_trg ON wishlists;
CREATE TRIGGER wishlists_touch_trg
  BEFORE UPDATE ON wishlists
  FOR EACH ROW EXECUTE FUNCTION wishlists_touch();
