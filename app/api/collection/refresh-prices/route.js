import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';


export const dynamic = 'force-dynamic';
// Up to 250 linked + 50 orphan items × ~2 Discogs round-trips each, in
// batches of 8 with 500 ms between batches. Vercel default 10 s would
// kill us mid-loop for any sizable collection.
export const maxDuration = 60;

function discogsAuth() {
  const k = process.env.DISCOGS_KEY, s = process.env.DISCOGS_SECRET, t = process.env.DISCOGS_TOKEN;
  if (!k && !t) return null;
  return k && s ? `Discogs key=${k}, secret=${s}` : `Discogs token=${t}`;
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit via DB — check last_price_check across all user's items
  // If most items were checked in last 30 min, skip
  const { count: recentCount } = await supabase
    .from('collection')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('last_price_check', 'is', null)
    .gte('last_price_check', new Date(Date.now() - 30 * 60 * 1000).toISOString());

  const { count: totalCount } = await supabase
    .from('collection')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if (totalCount > 0 && recentCount >= totalCount * 0.8) {
    return NextResponse.json({
      error: 'Prices are already up to date (refreshed in last 30 minutes)',
      retryAfter: 1800, updated: 0, total: 0,
    }, { status: 429 });
  }

  const auth = discogsAuth();
  if (!auth) return NextResponse.json({ error: 'Discogs not configured' }, { status: 503 });

  // Refresh window: 7 days for items that returned a real price (price
  // moves slowly). Only 24 h for items that returned null — Discogs
  // marketplace has zero listings for many niche metal pressings
  // intermittently, so we want to retry the next day instead of waiting
  // a week. Items that have NEVER been checked (last_price_check IS NULL)
  // always qualify.
  const staleCutoff   = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
  const noDataCutoff  = new Date(Date.now() - 1  * 24 * 60 * 60 * 1000).toISOString();

  // Pull items: with discogs_id (refreshable), and items without
  // discogs_id (manual additions — we'll try to FIND a discogs_id by
  // search below). Both paths are bounded by the same 250-item cap.
  const { data: linkedItems } = await supabase
    .from('collection')
    .select('id, discogs_id, current_price, median_price')
    .eq('user_id', user.id)
    .not('discogs_id', 'is', null)
    .or(
      // never-checked OR last refresh >7d ago OR last refresh returned
      // null but is older than 24 h. The third clause means a record
      // that came back without a price (Discogs has no listings) gets
      // retried daily instead of frozen for a week.
      [
        'last_price_check.is.null',
        `last_price_check.lt.${staleCutoff}`,
        `and(current_price.is.null,median_price.is.null,last_price_check.lt.${noDataCutoff})`,
      ].join(',')
    )
    .order('added_at', { ascending: false })
    .limit(250);

  // Manual additions — no discogs_id. We attempt one search per refresh.
  // Limit smaller (50) since each search is 2 round-trips (search + stats).
  const { data: orphanItems } = await supabase
    .from('collection')
    .select('id, artist, album')
    .eq('user_id', user.id)
    .is('discogs_id', null)
    .or(
      'last_price_check.is.null,' +
      `last_price_check.lt.${noDataCutoff}`
    )
    .limit(50);

  const items = [...(linkedItems || []), ...(orphanItems || [])];
  if (!items.length) {
    return NextResponse.json({ updated: 0, total: 0, message: 'All prices are up to date' });
  }

  let updated = 0, errors = 0, linked = 0;
  const BATCH = 8;

  // Tiny helper — fetch with one 429 retry, returns { ok, data } or null.
  const fetchDiscogs = async (url) => {
    let r = await fetch(url, { headers: { Authorization: auth, 'User-Agent': 'MetalVault/1.0' } });
    if (r.status === 429) {
      await new Promise(rs => setTimeout(rs, 2000));
      r = await fetch(url, { headers: { Authorization: auth, 'User-Agent': 'MetalVault/1.0' } });
    }
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  };

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(batch.map(async item => {
      try {
        let discogsId = item.discogs_id;

        // ── Step 1: orphan flow — find a discogs_id by search ──
        // Manual additions don't have a Discogs link. Try to find the
        // best release match by artist + album + format=Vinyl. If found,
        // persist the discogs_id so future refreshes hit the fast path.
        if (!discogsId) {
          const q = new URLSearchParams({
            type:    'release',
            artist:  item.artist || '',
            release_title: item.album || '',
            format:  'Vinyl',
            per_page: '1',
          }).toString();
          const search = await fetchDiscogs('https://api.discogs.com/database/search?' + q);
          const hit = search?.results?.[0];
          if (!hit?.id) { errors++; return; }
          discogsId = hit.id;
          // Persist link so next run skips this expensive search step
          await supabase.from('collection').update({
            discogs_id: String(discogsId),
            cover:      hit.cover_image || hit.thumb || null,
          }).eq('id', item.id);
          linked++;
        }

        // ── Step 2: marketplace stats for this discogs_id ──
        const d = await fetchDiscogs('https://api.discogs.com/marketplace/stats/' + discogsId);
        if (!d) { errors++; return; }
        const current = d.lowest_price?.value || null;
        // Discogs marketplace/stats actually returns no median. Fall
        // back to lowest_price for both fields so the UI's "median"
        // surface still has data.
        const median  = current;

        // Only update last_price_check when we actually got a price
        // OR the fast 24h "no-data" cooldown. That way a permanently
        // unlisted item gets retried daily instead of being frozen
        // for a week — fixes the "Mirage isn't getting a price" bug
        // where one bad refresh locked the row out for 7 days.
        const update = {
          current_price:    current,
          median_price:     median,
          last_price_check: new Date().toISOString(),
        };
        await supabase.from('collection').update(update).eq('id', item.id);

        if (current || median) {
          // Persist to price_history (Pro 30-day chart). Silent fail
          // if table doesn't exist on this deployment.
          try {
            await supabase.from('price_history').upsert({
              discogs_id:    String(discogsId),
              snapshot_date: new Date().toISOString().split('T')[0],
              lowest_price:  current,
              median_price:  median,
            }, { onConflict: 'discogs_id,snapshot_date' });
          } catch {}
          updated++;
        }
      } catch { errors++; }
    }));
    if (i + BATCH < items.length) await new Promise(r => setTimeout(r, 500));
  }

  // Update portfolio snapshot
  const { data: all } = await supabase
    .from('collection').select('purchase_price, current_price, median_price').eq('user_id', user.id);
  if (all?.length) {
    const totalValue = all.reduce((s, i) => s + (Number(i.median_price || i.current_price || i.purchase_price) || 0), 0);
    const totalPaid  = all.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
    await supabase.from('portfolio_snapshots').upsert({
      user_id: user.id,
      snapshot_date: new Date().toISOString().split('T')[0],
      total_value: totalValue, total_paid: totalPaid, item_count: all.length,
    }, { onConflict: 'user_id,snapshot_date' });
  }

  return NextResponse.json({
    updated, errors, linked, total: items.length,
    message: linked > 0
      ? `Updated ${updated}/${items.length} prices (linked ${linked} manual records to Discogs)`
      : `Updated ${updated}/${items.length} prices`,
  });
}
