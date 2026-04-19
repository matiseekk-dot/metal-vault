export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

import { discogsApiHeaders } from '@/lib/oauth';

const UA = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

// PLAINTEXT signature does not depend on the request URL or body,
// so we compute headers once and reuse for every paginated call.
function buildHeaders(oauthToken) {
  return discogsApiHeaders(oauthToken);
}

async function fetchAllPages(baseUrl, headers) {
  const items = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages && page <= 20) {
    const r = await fetch(baseUrl + `&page=${page}&per_page=100`, { headers, cache: 'no-store' });
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
    discogs_id:     info.id || r.id,  // BIGINT — no String() cast
    artist:         (info.artists?.[0]?.name || 'Unknown').replace(/\s*\(\d+\)$/, ''),
    album:          info.title || '',
    cover:          info.cover_image || info.thumb || null,
    format:         info.formats?.[0]?.name || 'Vinyl',
    label:          info.labels?.[0]?.name || null,
    year:           info.year || null,
    genres:         info.genres || [],
    styles:         info.styles || [],
    discogs_url:    `https://www.discogs.com/release/${info.id || r.id}`,
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
    const headers = buildHeaders(oauthToken);
    if (!headers) {
      return NextResponse.json({ error: 'No Discogs auth configured' }, { status: 503 });
    }

    const result = { added: 0, updated: 0, watchAdded: 0, errors: [], username };

    // ── Sync Collection ─────────────────────────────────────────
    if (type === 'collection' || type === 'both') {
      try {
        const raw = await fetchAllPages(
          `https://api.discogs.com/users/${username}/collection/folders/0/releases?sort=added&sort_order=desc`,
          headers
        );
        result.discogs_total = raw.length;

        // Fetch existing items for fast lookup
        const { data: existing } = await admin
          .from('collection')
          .select('id, discogs_id, purchase_price, grade')
          .eq('user_id', user.id);
        const existingMap = {};
        (existing||[]).forEach(e => { existingMap[String(e.discogs_id)] = e; });

        for (const r of raw) {
          const item = normalizeItem(r);
          const ex   = existingMap[String(item.discogs_id)];

          if (ex) {
            await admin.from('collection').update({
              cover:       item.cover       || undefined,
              format:      item.format      || undefined,
              label:       item.label       || undefined,
              year:        item.year        || undefined,
              genres:      item.genres,
              styles:      item.styles,
              discogs_url: item.discogs_url || undefined,
              ...(item.purchase_price && !ex.purchase_price ? { purchase_price: item.purchase_price } : {}),
            }).eq('id', ex.id);
            result.updated++;
          } else {
            const { error: insertErr } = await admin.from('collection').insert({
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
              discogs_url:    item.discogs_url,
              date_added:     item.date_added,
              purchase_price: item.purchase_price,
              rating:         item.rating,
              added_at:       new Date().toISOString(),
            });
            if (insertErr) {
              result.errors.push({ source: 'insert', id: item.discogs_id, error: insertErr.message });
            } else {
              result.added++;
            }
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
          headers
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
              year:         item.year ? String(item.year) : null,
              discogs_url:  item.discogs_url,
              release_date: item.year ? String(item.year) : null,
              format:       item.format || null,
              label:        item.label  || null,
              added_at:     new Date().toISOString(),
            });
            result.watchAdded++;
          }
        }
      } catch (e) {
        result.errors.push({ source: 'wantlist', error: e.message });
      }
    }

    // Update portfolio snapshot so the value-over-time chart reflects the sync
    try {
      const { data: allItems } = await admin
        .from('collection').select('purchase_price, current_price, median_price')
        .eq('user_id', user.id);
      if (allItems?.length) {
        const totalValue = allItems.reduce((s,i)=>s+(Number(i.median_price||i.current_price||i.purchase_price)||0),0);
        const totalPaid  = allItems.reduce((s,i)=>s+(Number(i.purchase_price)||0),0);
        await admin.from('portfolio_snapshots').upsert({
          user_id:       user.id,
          snapshot_date: new Date().toISOString().split('T')[0],
          total_value:   totalValue,
          total_paid:    totalPaid,
          item_count:    allItems.length,
        }, { onConflict: 'user_id,snapshot_date' });
      }
    } catch {}

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message, stack: e.stack?.slice(0,300) }, { status: 500 });
  }
}
