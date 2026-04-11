export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const barcode = (searchParams.get('barcode') || '').trim();

  if (!barcode) {
    return NextResponse.json({ error: 'Provide barcode' }, { status: 400 });
  }

  const token  = process.env.DISCOGS_TOKEN;
  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;

  if (!key && !token) {
    return NextResponse.json({ error: 'Discogs not configured' }, { status: 503 });
  }

  const authHeader = key && secret
    ? `Discogs key=${key}, secret=${secret}`
    : `Discogs token=${token}`;

  // Check cache first
  const cacheKey = `barcode::${barcode}`;
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
    // Search Discogs by barcode
    const res = await fetch(
      `https://api.discogs.com/database/search?barcode=${encodeURIComponent(barcode)}&per_page=5`,
      {
        headers: {
          Authorization: authHeader,
          'User-Agent': 'MetalVault/1.0 +https://metal-vault.app',
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: `Discogs ${res.status}` }, { status: res.status });
    }

    const data    = await res.json();
    const results = data.results || [];

    if (results.length === 0) {
      return NextResponse.json({ found: false, barcode, results: [] });
    }

    // Build response
    const releases = results.map(r => ({
      id:          r.id,
      title:       r.title,
      thumb:       r.thumb || null,
      year:        r.year,
      label:       r.label?.[0] || null,
      format:      r.format?.join(' · ') || 'Vinyl',
      country:     r.country || null,
      lowestPrice: r.lowest_price || null,
      numForSale:  r.num_for_sale || 0,
      community:   r.community || null,
      discogsUrl:  `https://www.discogs.com/release/${r.id}`,
      catno:       r.catno || null,
    }));

    const payload = { found: true, barcode, results: releases, best: releases[0] };

    // Cache for 24h
    try {
      const sb = getAdminClient();
      await sb.from('discogs_cache').upsert(
        { cache_key: cacheKey, data: payload, expires_at: new Date(Date.now() + 24*60*60*1000).toISOString() },
        { onConflict: 'cache_key' }
      );
    } catch {}

    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
