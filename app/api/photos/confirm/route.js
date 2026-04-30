// ── /api/photos/confirm — record uploaded photo in collection.user_photos ──
// Called by client AFTER successful upload to Supabase Storage.
// Generates signed display URL (1 year) and appends to user_photos array.
//
// POST body: { collection_item_id, path, label? }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';

const SIGNED_URL_TTL_SEC = 365 * 24 * 3600;  // 1 year — re-signed if needed later

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { collection_item_id, path, label } = body;

  if (!collection_item_id || !path) {
    return NextResponse.json({ error: 'collection_item_id and path required' }, { status: 400 });
  }

  // Defense: ensure path matches user_id prefix (user can't claim someone else's photo)
  if (!path.startsWith(user.id + '/')) {
    return NextResponse.json({ error: 'Invalid path — must be in your folder' }, { status: 403 });
  }

  // Get current item
  const { data: item } = await sb
    .from('collection')
    .select('id, user_photos')
    .eq('id', collection_item_id)
    .eq('user_id', user.id)
    .single();

  if (!item) {
    return NextResponse.json({ error: 'Collection item not found' }, { status: 404 });
  }

  // Generate signed URL for display
  const { data: signed, error: signError } = await supabaseAdmin
    .storage.from('collection-photos')
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);

  if (signError) {
    return NextResponse.json({ error: signError.message }, { status: 500 });
  }

  // Append to photos array
  const newPhoto = {
    url:         signed.signedUrl,
    path,
    label:       label || null,
    uploaded_at: new Date().toISOString(),
  };

  const photos = Array.isArray(item.user_photos) ? item.user_photos : [];
  photos.push(newPhoto);

  const { error: updateError } = await sb
    .from('collection')
    .update({ user_photos: photos })
    .eq('id', collection_item_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, photo: newPhoto });
}
