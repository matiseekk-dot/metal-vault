export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

const UA = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

// Build auth header — OAuth if available, else personal token
function buildHeader(discogsToken) {
  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token  = process.env.DISCOGS_TOKEN;

  // OAuth (user connected their account)
  if (discogsToken?.access_token && key && secret) {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return {
      ...UA,
      Authorization: `OAuth oauth_consumer_key="${key}",oauth_token="${discogsToken.access_token}",oauth_signature_method="PLAINTEXT",oauth_signature="${secret}&${discogsToken.access_secret}",oauth_version="1.0",oauth_timestamp="${Math.floor(Date.now()/1000)}",oauth_nonce="${nonce}"`,
    };
  }

  // Personal token — works for your OWN private collection
  if (token) return { ...UA, Authorization: 'Discogs token=' + token };

  return null;
}

// Auto-detect Discogs username via /oauth/identity
async function getUsername(headers) {
  try {
    const r = await fetch('https://api.discogs.com/oauth/identity', { headers, cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      return d.username || null;
    }
  } catch {}
  return null;
}

async function fetchAllPages(baseUrl, headers) {
  const items = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages && page <= 20) {
    const r = await fetch(baseUrl + `&page=${page}&per_page=100`, { headers, cache: 'no-store' });
    if (!r.ok) {
      if (r.status === 401) throw new Error('Discogs auth failed — check DISCOGS_TOKEN in Vercel');
      if (r.status === 404) throw new Error('Collection not found — make sure Discogs username is correct');
      if (r.status === 429) throw new Error('Discogs rate limited — try again in a moment');
      throw new Error('Discogs error ' + r.status);
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

    // Auth check
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { type = 'both' } = body;

    // ── Get Discogs credentials ──────────────────────────────
    // First try OAuth token from DB, fallback to env personal token
    const { data: oauthToken } = await admin
      .from('discogs_tokens')
      .select('access_token, access_secret, discogs_username')
      .eq('user_id', user.id)
      .single();

    const headers = buildHeader(oauthToken);
    if (!headers) {
      return NextResponse.json({
        error: 'Discogs not configured — add DISCOGS_TOKEN to Vercel environment variables',
      }, { status: 503 });
    }

    // ── Get username ─────────────────────────────────────────
    // Priority: stored OAuth username → identity API → error
    let username = oauthToken?.discogs_username || null;

    if (!username) {
      // Auto-detect via /oauth/identity (works with personal token too!)
      username = await getUsername(headers);
    }

    if (!username) {
      return NextResponse.json({
        error: 'Could not determine Discogs username. Connect your Discogs account in the Me tab.',
        needsConnect: true,
      }, { status: 400 });
    }

    // Store username for next time
    if (!oauthToken?.discogs_username) {
      try {
        await admin.from('discogs_tokens').upsert({
          user_id: user.id,
          discogs_username: username,
          access_token: null,
          access_secret: null,
        }, { onConflict: 'user_id' });
      } catch {}
    }

    const result = { added: 0, updated: 0, watchAdded: 0, errors: [], username };

    // ── Sync Collection ──────────────────────────────────────
    if (type === 'collection' || type === 'both') {
      try {
        const raw = await fetchAllPages(
          `https://api.discogs.com/users/${username}/collection/folders/0/releases?sort=added&sort_order=desc`,
          headers
        );

        // Fetch all existing discogs_ids at once for faster lookup
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
            // Update — preserve user-set purchase_price and grade
            await admin.from('collection').update({
              cover:   item.cover   || undefined,
              format:  item.format  || undefined,
              label:   item.label   || undefined,
              year:    item.year    || undefined,
              genres:  item.genres,
              styles:  item.styles,
              ...(item.purchase_price && !ex.purchase_price
                ? { purchase_price: item.purchase_price }
                : {}),
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

    // ── Sync Wantlist ────────────────────────────────────────
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
        const existingWatchSet = new Set((existingWatch||[]).map(e => e.album_id));

        for (const r of raw) {
          const item = normalizeItem(r);
          if (!existingWatchSet.has(item.discogs_id)) {
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
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
