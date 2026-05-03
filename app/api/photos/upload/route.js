// ── /api/photos/upload — sign upload URL for user collection photo ──
// Two-phase upload: client posts here to get a signed URL → uploads
// directly to Supabase Storage (we don't proxy bytes through our serverless
// function — Vercel has 4.5MB body limit + photo bytes wasted).
//
// POST body: { collection_item_id, label?, mime_type }
// Returns: { signedUrl, path, token }
//
// Server validates that the user OWNS the collection item before signing.
// Path convention: {user_id}/{item_id}/{uuid}.{ext}

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';
import { isPremium } from '@/lib/stripe';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
// Pro-only feature. Free tier = 0 photos. Coherent with Insurance PDF
// (Pro), sparkline (Pro), detailed grading (Pro) — all "professional
// collection management" tools live behind one paywall.
const FREE_PHOTOS_PER_ITEM = 0;
const PRO_PHOTOS_PER_ITEM  = 6;

function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png')  return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

// Random ID — Web Crypto's randomUUID is available in Node 19+ and the
// Edge runtime; we fall back only on the (theoretical) Node <19 case.
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ (Math.random() * 16) >> c / 4).toString(16)
  );
}

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { collection_item_id, label, mime_type } = body;

  // Validate
  if (!collection_item_id) {
    return NextResponse.json({ error: 'collection_item_id required' }, { status: 400 });
  }
  if (!ALLOWED_MIME.includes(mime_type)) {
    return NextResponse.json({ error: 'mime_type must be jpeg/png/webp' }, { status: 400 });
  }
  if (label != null && (typeof label !== 'string' || label.length > 40)) {
    return NextResponse.json({ error: 'label must be string ≤40 chars' }, { status: 400 });
  }

  // Verify ownership — user can only upload to items they own
  const { data: item } = await sb
    .from('collection')
    .select('id, user_id, user_photos')
    .eq('id', collection_item_id)
    .eq('user_id', user.id)
    .single();

  if (!item) {
    return NextResponse.json({ error: 'Collection item not found or not yours' }, { status: 403 });
  }

  // Tier-based photo limit
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('subscription_status, subscription_end, plan')
    .eq('id', user.id).single();

  const limit = isPremium(profile) ? PRO_PHOTOS_PER_ITEM : FREE_PHOTOS_PER_ITEM;
  const existingCount = Array.isArray(item.user_photos) ? item.user_photos.length : 0;

  if (existingCount >= limit) {
    return NextResponse.json({
      error: 'PHOTO_LIMIT_REACHED',
      message: isPremium(profile)
        ? `Maximum ${PRO_PHOTOS_PER_ITEM} photos per record`
        : `Photo upload is a Pro feature. Upgrade for ${PRO_PHOTOS_PER_ITEM} photos per record.`,
      currentCount: existingCount,
      limit,
    }, { status: 403 });
  }

  // Build storage path: user_id/item_id/uuid.ext
  const ext = extFromMime(mime_type);
  const filename = uuid() + '.' + ext;
  const path = user.id + '/' + collection_item_id + '/' + filename;

  // Create signed upload URL via storage admin client
  // (regular createClient with anon key cannot create signed upload URLs)
  const { data: signed, error: signError } = await supabaseAdmin
    .storage
    .from('collection-photos')
    .createSignedUploadUrl(path);

  if (signError) {
    return NextResponse.json({ error: signError.message }, { status: 500 });
  }

  return NextResponse.json({
    signedUrl: signed.signedUrl,
    token:     signed.token,
    path,
    label:     label || null,
  });
}
