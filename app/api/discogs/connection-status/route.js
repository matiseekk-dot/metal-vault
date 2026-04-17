// Returns whether the current user has a valid Discogs OAuth connection.
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false });

  const { data } = await getAdminClient()
    .from('discogs_tokens')
    .select('discogs_username, access_token')
    .eq('user_id', user.id)
    .single();

  // Connected = has a real access token (not the 'manual_token' placeholder)
  // and has a username stored (Step 2 completed)
  const connected = !!(
    data?.discogs_username &&
    data?.access_token &&
    data.access_token !== 'manual_token'
  );

  return NextResponse.json({
    connected,
    username: data?.discogs_username || null,
  });
}
