// ── Diagnostic: own Discogs connection status (user-gated) ──
// Users can check if their Discogs OAuth is completed and see counts.
// Does NOT expose env vars or other users' data.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = getAdminClient();
  const { data: tokens } = await admin
    .from('discogs_tokens').select('discogs_username, created_at').eq('user_id', user.id).single();

  const { count: collCount } = await admin
    .from('collection').select('id', { count: 'exact', head: true }).eq('user_id', user.id);

  return NextResponse.json({
    discogs_connected: !!tokens?.discogs_username,
    discogs_username:  tokens?.discogs_username || null,
    linked_at:         tokens?.created_at || null,
    collection_size:   collCount || 0,
  });
}
