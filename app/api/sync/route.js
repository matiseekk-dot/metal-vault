export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

import { discogsApiHeaders } from '@/lib/oauth';

const UA = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

// Returns a per-request signer: (url, method?) => headers
// Uses HMAC-SHA1 (OAuth) or personal token as fallback.
function buildSigner(oauthToken) {
  const token = process.env.DISCOGS_TOKEN;

  if (oauthToken?.access_token && oauthToken?.access_secret
      && process.env.DISCOGS_KEY && process.env.DISCOGS_SECRET) {
    // HMAC-SHA1: each call is signed with the full URL (includes pagination params)
    return (url, method = 'GET') => discogsApiHeaders(url, method, oauthToken);
  }

  // Personal token fallback — signature doesn't depend on URL
  if (token) return (_url) => ({ ...UA, Authorization: 'Discogs token=' + token });
  return null;
}

async function fetchAllPages(baseUrl, signer) {
  const items = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages && page <= 20) {
    const fullUrl = baseUrl + `&page=${page}&per_page=100`;
    const headers = signer(fullUrl, 'GET');
    const r = await fetch(fullUrl, { headers, cache: 'no-store' });
    if (!r.ok) {
      if (r.status === 401) throw new Error('Discogs auth failed (401) — reconnect Discogs OAuth');
      if (r.status === 403) throw new Error('Discogs forbidden (403) — collection is private, OAuth needed');
      if (r.status === 404) throw new Error('Discogs user not found (404) — check username');
      if (r.status === 429) throw new Error('Discogs rate limited (429) — wait a moment');
      const txt = await r.text().catch(()=>'');
      throw new Error(`Discogs error ${r.status}: ${txt.slice(0,80)}`);
    }
    const data = await r.json();
    totalPages = data.pagination?.pages || 1;
    items.push(...(data.releases || data.wants || []));
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, 400));
  }
  return items;
}

function normalizeItem(r) {
  const info = r.basic_information || r;
  return {
    discogs_id:     String(info.id || r.id),
    artist:         (info.artists?.[0]?.name || 'Unknown').replace(/\s*\(\d+\)$/, ''),
    album:          info.title || '',
    cover:          info.cover_image || info.thumb || null,
    format:         info.formats?.[0]?.name || 'Vinyl',
    label:          info.labels?.[0]?.name || null,
    year:           info.year || null,
    genres:         info.genres || [],
    styles:         info.styles || [],
    discogsUrl:     `https://www.discogs.com/release/${info.id || r.id}`,
    date_added:     r.date_added || null,
    rating:         r.rating || null,
    purchase_price: r.notes?.find?.(n => n.field_id === 1)?.value
                    ? parseFloat(r.notes.find(n => n.field_id === 1).value) || null
                    : null,
  };
}

export async function POST(req) {
  try {
    const sb    = await createClient();
    const admin = getAdminClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { type = 'both', username: overrideUsername } = body;

    // ── Get OAuth token (if user connected Discogs) ──────────────
    const { data: oauthToken } = await admin
      .from('discogs_tokens')
      .select('access_token, access_secret, discogs_username')
      .eq('user_id', user.id)
      .single();

    // ── Resolve username: body param → OAuth username → personal token identity
    let username = (overrideUsername || '').trim() || oauthToken?.discogs_username || null;

    // If no username stored, try to get it from personal token
    if (!username && process.env.DISCOGS_TOKEN) {
      try {
        const idR = await fetch('https://api.discogs.com/oauth/identity', {
          headers: { 'Authorization': 'Discogs token=' + process.env.DISCOGS_TOKEN, ...UA },
        });
        if (idR.ok) {
          const idData = await idR.json();
          username = idData.username;
          // Persist for next time
          await admin.from('discogs_tokens').upsert({
            user_id: user.id,
            discogs_username: username,
            access_token:  oauthToken?.access_token  || null,
            access_secret: oauthToken?.access_secret || null,
          }, { onConflict: 'user_id' });
        }
      } catch {}
    }

    if (!username) {
      return NextResponse.json({
        error: 'No Discogs username available. Pass { username: "..." } in request body or connect Discogs OAuth.',
        hint: 'Try: fetch("/api/sync", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({type:"collection", username:"YOUR_DISCOGS_USERNAME"})})',
      }, { status: 400 });
    }

    // ── Build auth headers ──────────────────────────────────────
    const signer = buildSigner(oauthToken);
    if (!signer) {
      return NextResponse.json({ error: 'No Discogs auth configured' }, { status: 503 });
    }

    const result = { added: 0, updated: 0, watchAdded: 0, errors: [], username };

    // ── Sync Collection ─────────────────────────────────────────
    if (type === 'collection' || type === 'both') {
      try {
        const raw = await fetchAllPages(
          `https://api.discogs.com/users/${username}/collection/folders/0/releases?sort=added&sort_order=desc`,
          signer
        );
        result.discogs_total = raw.length;

        // Fetch existing items for fast lookup
        const { data: existing } = await admin
          .from('collection')
          .select('id, discogs_id, purchase_price, grade')
          .eq('user_id', user.id);
        const existingMap = {};
        (existing||[]).forEach(e => { existingMap[e.discogs_id] = e; });

        for (const r of raw) {
          const item = normalizeItem(r);
          const ex   = existingMap[item.discogs_id];

          if (ex) {
            await admin.from('collection').update({
              cover:   item.cover   || undefined,
              format:  item.format  || undefined,
              label:   item.label   || undefined,
              year:    item.year    || undefined,
              genres:  item.genres,
              styles:  item.styles,
              ...(item.purchase_price && !ex.purchase_price ? { purchase_price: item.purchase_price } : {}),
            }).eq('id', ex.id);
            result.updated++;
          } else {
            await admin.from('collection').insert({
              user_id:        user.id,
              discogs_id:     item.discogs_id,
              artist:         item.artist,
              album:          item.album,
              cover:          item.cover,
              format:         item.format,
              label:          item.label,
              year:           item.year,
              genres:         item.genres,
              styles:         item.styles,
              discogsUrl:     item.discogsUrl,
              date_added:     item.date_added,
              purchase_price: item.purchase_price,
              rating:         item.rating,
              added_at:       new Date().toISOString(),
            });
            result.added++;
          }
        }
      } catch (e) {
        result.errors.push({ source: 'collection', error: e.message });
      }
    }

    // ── Sync Wantlist ───────────────────────────────────────────
    if (type === 'wantlist' || type === 'both') {
      try {
        const raw = await fetchAllPages(
          `https://api.discogs.com/users/${username}/wants?sort=added&sort_order=desc`,
          signer
        );

        const { data: existingWatch } = await admin
          .from('watchlist')
          .select('album_id')
          .eq('user_id', user.id);
        const existingSet = new Set((existingWatch||[]).map(e => e.album_id));

        for (const r of raw) {
          const item = normalizeItem(r);
          if (!existingSet.has(item.discogs_id)) {
            await admin.from('watchlist').insert({
              user_id:      user.id,
              album_id:     item.discogs_id,
              artist:       item.artist,
              album:        item.album,
              cover:        item.cover,
              year:         item.year,
              discogsUrl:   item.discogsUrl,
              release_date: item.year ? String(item.year) : null,
              added_at:     new Date().toISOString(),
            });
            result.watchAdded++;
          }
        }
      } catch (e) {
        result.errors.push({ source: 'wantlist', error: e.message });
      }
    }

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message, stack: e.stack?.slice(0,300) }, { status: 500 });
  }
}
