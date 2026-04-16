export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export async function GET() {
  const sb    = await createClient();
  const admin = getAdminClient();

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tokens } = await admin
    .from('discogs_tokens').select('*').eq('user_id', user.id).single();

  const { count: collCount } = await admin
    .from('collection').select('*', { count: 'exact', head: true }).eq('user_id', user.id);

  const envCheck = {
    DISCOGS_TOKEN: !!process.env.DISCOGS_TOKEN,
    DISCOGS_KEY:   !!process.env.DISCOGS_KEY,
    DISCOGS_SECRET:!!process.env.DISCOGS_SECRET,
  };

  let personalIdentity = null;
  if (process.env.DISCOGS_TOKEN) {
    try {
      const r = await fetch('https://api.discogs.com/oauth/identity', {
        headers: {
          'Authorization': 'Discogs token=' + process.env.DISCOGS_TOKEN,
          'User-Agent': 'MetalVault/1.0',
        },
      });
      const txt = await r.text();
      if (r.ok) personalIdentity = JSON.parse(txt);
      else personalIdentity = { error: r.status + ': ' + txt.slice(0, 100) };
    } catch (e) { personalIdentity = { error: e.message }; }
  }

  return NextResponse.json({
    user_id: user.id,
    email:   user.email,
    discogs_tokens: tokens ? {
      has_access_token:  !!tokens.access_token,
      has_access_secret: !!tokens.access_secret,
      discogs_username:  tokens.discogs_username,
    } : null,
    collection_count: collCount,
    env: envCheck,
    personal_token_identity: personalIdentity,
  });
}
