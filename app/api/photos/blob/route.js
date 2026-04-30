// ── /api/photos/blob — proxy a user's photo for PDF embedding ──
// Insurance PDF needs base64 data URL of each photo. Direct fetch from
// Supabase Storage signed URLs sometimes fails CORS in client context,
// especially after long TTLs. This endpoint resolves it server-side
// using admin credentials, then streams binary back to client.
//
// Security: caller MUST own the collection_item the photo belongs to.
// Path format: {user_id}/{collection_item_id}/{filename}.
// We verify the path's user_id prefix matches the authenticated user.
//
// GET ?path=<storage-path>

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const path = new URL(request.url).searchParams.get('path');
  if (!path) {
    return new Response('path query param required', { status: 400 });
  }

  // Defense — only the owner can fetch a given photo
  if (!path.startsWith(user.id + '/')) {
    return new Response('Forbidden', { status: 403 });
  }

  // Use admin client to bypass RLS (we already verified ownership above)
  const { data, error } = await supabaseAdmin
    .storage.from('collection-photos').download(path);

  if (error || !data) {
    return new Response('Photo not found: ' + (error?.message || 'unknown'), { status: 404 });
  }

  // Stream binary with appropriate content type
  // Supabase returns Blob; we infer type from extension
  const ext = path.split('.').pop()?.toLowerCase();
  const contentType = ext === 'png' ? 'image/png'
                    : ext === 'webp' ? 'image/webp'
                    : 'image/jpeg';

  const arrayBuffer = await data.arrayBuffer();
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=86400',  // 24h browser cache OK — same user
    },
  });
}
