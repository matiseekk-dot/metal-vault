// ── /api/photos/delete — remove photo from storage + collection ──
// DELETE body: { collection_item_id, path }
// Removes file from Storage and entry from user_photos array.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { collection_item_id, path } = await request.json().catch(() => ({}));
  if (!collection_item_id || !path) {
    return NextResponse.json({ error: 'collection_item_id and path required' }, { status: 400 });
  }

  // Defense — only allow deletion of own files
  if (!path.startsWith(user.id + '/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  // 1) Remove from Storage
  const { error: storageError } = await supabaseAdmin
    .storage.from('collection-photos').remove([path]);
  // Don't fail hard if file already gone — DB cleanup matters more

  // 2) Remove from user_photos array
  const { data: item } = await sb
    .from('collection')
    .select('user_photos')
    .eq('id', collection_item_id)
    .eq('user_id', user.id)
    .single();

  if (!item) {
    return NextResponse.json({ error: 'Collection item not found' }, { status: 404 });
  }

  const photos = (Array.isArray(item.user_photos) ? item.user_photos : [])
    .filter(p => p.path !== path);

  const { error: updateError } = await sb
    .from('collection')
    .update({ user_photos: photos })
    .eq('id', collection_item_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, remaining: photos.length, storageError: storageError?.message });
}
