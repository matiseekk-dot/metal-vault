export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

export async function POST(request) {
  const { user_id, username } = await request.json();
  
  if (!user_id || !username) {
    return NextResponse.json({ error: 'Missing user_id or username' }, { status: 400 });
  }

  const admin = getAdminClient();

  try {
    // Insert/update discogs_tokens with manual username
    const { error } = await admin
      .from('discogs_tokens')
      .upsert({
        user_id,
        access_token: 'manual_token',
        access_secret: 'manual_secret',
        discogs_username: username,
      }, { onConflict: 'user_id' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `Manual sync activated for ${username}` });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
