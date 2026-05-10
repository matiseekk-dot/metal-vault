// ── /api/photos/annotate — save defect annotations on a photo ──
//
// PATCH body: { collection_item_id, path, annotations: [...] }
//
// Locates the photo by path (Supabase storage path is the primary key
// inside the collection.user_photos JSONB array), replaces its
// annotations field with the new array. No partial-merge — the client
// always sends the full annotation set for that photo.
//
// annotation shape (validated lightly):
//   { type: 'circle' | 'arrow' | 'text',
//     x: 0..1, y: 0..1                        // normalised image coords
//     r?: 0..1,                                // circle radius
//     x2?, y2?: 0..1,                          // arrow endpoint
//     text?: string,                           // text label
//     color?: '#RRGGBB',                       // hex
//     note?: string }                          // free-text caption
//
// Coords are normalised so they survive image resizing — the client
// renders by multiplying with the rendered <img> bounding box.
//
// Pro-only — same gate as PhotoUploader. Free tier doesn't have photos
// to annotate anyway, but the explicit check defends against a free
// user manually crafting a PATCH.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';
import { isPremium } from '@/lib/stripe';

// Soft caps. UI shouldn't ever push more than a few annotations per
// photo (typical sleeve defect set: 3-5 marks). The cap exists to stop
// a runaway client from filling the row with tens of thousands of marks.
const MAX_ANNOTATIONS_PER_PHOTO = 50;
const MAX_NOTE_LEN              = 120;

function sanitiseAnnotation(a) {
  if (!a || typeof a !== 'object') return null;
  const type = String(a.type || '').toLowerCase();
  if (!['circle', 'arrow', 'text'].includes(type)) return null;

  const num01 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(1, n));
  };

  const x = num01(a.x);
  const y = num01(a.y);
  if (x === null || y === null) return null;

  const out = { type, x, y };
  if (type === 'circle') {
    const r = num01(a.r);
    if (r === null) return null;
    out.r = Math.max(0.005, r);   // floor so a 1-px circle isn't recorded
  } else if (type === 'arrow') {
    const x2 = num01(a.x2);
    const y2 = num01(a.y2);
    if (x2 === null || y2 === null) return null;
    out.x2 = x2; out.y2 = y2;
  } else if (type === 'text') {
    out.text = String(a.text || '').slice(0, 40);
    if (!out.text) return null;
  }

  if (a.color && /^#[0-9a-fA-F]{6}$/.test(a.color)) out.color = a.color;
  if (a.note)  out.note  = String(a.note).slice(0, MAX_NOTE_LEN);
  return out;
}

export async function PATCH(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro gate. Same shape as /api/photos/upload — read profile, check
  // subscription status via the canonical helper.
  let premium = false;
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('subscription_status, subscription_end, subscription_source')
      .eq('id', user.id).maybeSingle();
    premium = isPremium(profile);
  } catch {}
  if (!premium) {
    return NextResponse.json({ error: 'Pro feature', reason: 'ANNOTATIONS' }, { status: 402 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const { collection_item_id, path, annotations } = body;
  if (!collection_item_id || !path) {
    return NextResponse.json({ error: 'collection_item_id and path required' }, { status: 400 });
  }
  if (!Array.isArray(annotations)) {
    return NextResponse.json({ error: 'annotations must be an array' }, { status: 400 });
  }

  // Sanitise + cap. Drop anything that doesn't survive validation; we
  // never throw on a malformed entry, just filter it out.
  const cleaned = annotations
    .map(sanitiseAnnotation)
    .filter(Boolean)
    .slice(0, MAX_ANNOTATIONS_PER_PHOTO);

  // Fetch current photos, locate the target by path, replace its
  // annotations. Path uniqueness inside a user's folder is guaranteed
  // by upload — each upload generates a fresh uuid filename.
  const { data: item } = await sb.from('collection')
    .select('id, user_photos').eq('id', collection_item_id).eq('user_id', user.id).single();
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  const photos = Array.isArray(item.user_photos) ? item.user_photos : [];
  const idx = photos.findIndex(p => p?.path === path);
  if (idx === -1) return NextResponse.json({ error: 'Photo not found on this item' }, { status: 404 });

  photos[idx] = { ...photos[idx], annotations: cleaned };

  const { error } = await sb.from('collection')
    .update({ user_photos: photos }).eq('id', collection_item_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, photo: photos[idx] });
}
