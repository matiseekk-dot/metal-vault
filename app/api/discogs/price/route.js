export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

function authHeader() {
  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token  = process.env.DISCOGS_TOKEN;
  if (!key && !token) return null;
  return key && secret
    ? 'Discogs key=' + key + ', secret=' + secret
    : 'Discogs token=' + token;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const releaseId = searchParams.get('releaseId');

  if (!releaseId) {
    return NextResponse.json({ error: 'Provide releaseId' }, { status: 400 });
  }

  const auth = authHeader();
  if (!auth) {
    return NextResponse.json({ error: 'Discogs not configured' }, { status: 503 });
  }

  // Check cache first
  const cacheKey = 'price::' + releaseId;
  try {
    const sb = getAdminClient();
    const { data: cached } = await sb
      .from('discogs_cache')
      .select('data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (cached && new Date(cached.expires_at) > new Date()) {
      return NextResponse.json({ ...cached.data, cached: true });
    }
  } catch {}

  try {
    // Fetch release marketplace stats
    const res = await fetch(
      'https://api.discogs.com/marketplace/stats/' + releaseId,
      {
        headers: {
          Authorization: auth,
          'User-Agent': 'MetalVault/1.0 +https://metal-vault.app',
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Discogs ' + res.status }, { status: res.status });
    }

    const data = await res.json();

    const payload = {
      releaseId,
      lowestPrice:  data.lowest_price?.value  || null,
      medianPrice:  data.median?.value         || null,
      numForSale:   data.num_for_sale          || 0,
      currency:     data.lowest_price?.currency || 'USD',
      blockedFromSale: data.blocked_from_sale  || false,
    };

    // Cache for 24h
    try {
      const sb = getAdminClient();
      await sb.from('discogs_cache').upsert(
        {
          cache_key:  cacheKey,
          data:       payload,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: 'cache_key' }
      );
    } catch {}

    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
