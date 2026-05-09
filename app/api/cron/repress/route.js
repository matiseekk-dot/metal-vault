// ── /api/cron/repress — daily repress detection ──────────────────
//
// Runs once per day (Vercel cron). For every distinct (artist, album)
// pair across all users' collections + watchlists, queries Discogs
// for releases whose `released` date is ≥ today and whose master_id
// matches an album the user already has. New release_id = "repress
// detected" → insert into repress_announcements, send push.
//
// Why query Discogs by master_id, not by artist:
//   Discogs Search by artist returns ALL releases including originals.
//   What we want is: same master, new release_id we haven't seen yet,
//   with a future release_date. Looking up by master_id directly is
//   cheaper (1 call per album in collection vs 1 per artist) AND
//   guarantees match (no fuzzy artist-name resolution).
//
// Rate budget: Discogs auth limit is 60 req/min. We pace at 600ms
// between calls and cap a run at MAX_ITEMS so cold-cache cron
// completes inside Vercel's 5-min Pro maxDuration.
//
// Push: reuses the same notifyUser path as price-alerts cron.
// One push per repress, batched by user.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
// 5 minutes — Vercel Pro plan ceiling. Hobby capped at 10s would
// chew through 16 items max; we deliberately need Pro for this.
export const maxDuration = 300;

const BUDGET_MS = 4 * 60 * 1000;
const PACING_MS = 600;
const MAX_ITEMS = Math.floor(BUDGET_MS / PACING_MS);

function authHeader() {
  const k = process.env.DISCOGS_KEY, s = process.env.DISCOGS_SECRET, t = process.env.DISCOGS_TOKEN;
  if (!k && !t) return null;
  return k && s ? 'Discogs key=' + k + ', secret=' + s : 'Discogs token=' + t;
}

async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const { notifyUser } = await import('@/app/api/push/notify/route');
    await notifyUser(userId, payload);
  } catch {}
}

// Look up a master release on Discogs and return its child versions
// (each variant — limited, repress, region-specific). The /masters/{id}/versions
// endpoint paginates; first page is enough for our use (most albums
// have <100 variants total, never see new ones beyond page 1).
async function fetchMasterVersions(masterId, auth) {
  const r = await fetch(
    'https://api.discogs.com/masters/' + masterId + '/versions?per_page=100&sort=released&sort_order=desc',
    { headers: { Authorization: auth, 'User-Agent': 'MetalVault/1.0' } }
  );
  if (!r.ok) return null;
  const d = await r.json();
  return Array.isArray(d.versions) ? d.versions : [];
}

export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured: CRON_SECRET unset' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getAdminClient();
  const discogsAuth = authHeader();
  if (!discogsAuth) return NextResponse.json({ error: 'Discogs not configured' });

  const startedAt = Date.now();
  const budgetExpired = () => (Date.now() - startedAt) > BUDGET_MS;
  const today = new Date().toISOString().split('T')[0];
  const stats = {
    masters_checked: 0,
    new_repressy:    0,
    pushes_sent:     0,
    skipped_budget:  0,
    errors:          [],
  };

  // 1) Pull every distinct (master_id, user_id) pair from collection.
  //    We need master_id (Discogs master_release_id) — without it we
  //    can't query versions reliably. Items with NULL master_id are
  //    skipped (manually-added, no Discogs link).
  //
  //    Note: schema has discogs_id (release id) but not master_id
  //    on `collection`. Resolve master_id at query time by hitting
  //    /releases/{id} → master_id. Since we run daily and most users
  //    have <500 records, we cache master_id once per item and reuse.
  //
  //    Implementation shortcut: select discogs_id and resolve via
  //    Discogs only when needed. To avoid adding a schema column for
  //    master_id we cache it in-memory for this run. (TODO: persist
  //    via 029 migration once we confirm the volume; for now in-mem
  //    is fine — daily run, no re-query within the run.)
  const { data: items, error } = await sb
    .from('collection')
    .select('id, user_id, discogs_id, artist, album, cover, master_id')
    .not('discogs_id', 'is', null)
    .limit(MAX_ITEMS);

  if (error) {
    return NextResponse.json({ error: 'Collection select failed: ' + error.message }, { status: 500 });
  }

  // Group by (master_id || discogs_id) so two users with the same album
  // share the Discogs lookup. Reduces request count linearly with
  // concurrent users sharing albums (often 30-50% on second day onward).
  const masterIndex = {};   // key = `m:${master}` or `r:${discogs}` → list of {user_id, artist, album, cover}
  for (const it of (items || [])) {
    const key = it.master_id ? 'm:' + it.master_id : 'r:' + it.discogs_id;
    if (!masterIndex[key]) masterIndex[key] = [];
    masterIndex[key].push(it);
  }

  // Per-user push payload aggregation — at most ONE summary push per
  // user per run, even if multiple repressy detected. Reduces noise.
  const userQueue = {};   // user_id → [{ artist, album, release_date }, ...]

  for (const [key, ownersAll] of Object.entries(masterIndex)) {
    if (budgetExpired()) {
      stats.skipped_budget = Object.keys(masterIndex).length - stats.masters_checked;
      break;
    }

    let masterId = null;
    if (key.startsWith('m:')) {
      masterId = Number(key.slice(2));
    } else {
      // No cached master — resolve via /releases/{id}
      const releaseId = Number(key.slice(2));
      try {
        const r = await fetch(
          'https://api.discogs.com/releases/' + releaseId,
          { headers: { Authorization: discogsAuth, 'User-Agent': 'MetalVault/1.0' } }
        );
        if (r.ok) {
          const d = await r.json();
          masterId = d.master_id || null;
          // Persist so the next run takes the fast path. Best-effort,
          // schema may not have the column on every deploy yet.
          if (masterId) {
            for (const o of ownersAll) {
              await sb.from('collection').update({ master_id: masterId }).eq('id', o.id).maybeSingle();
            }
          }
        }
        await new Promise(r => setTimeout(r, PACING_MS));
      } catch (e) {
        stats.errors.push('release:' + releaseId + ':' + e.message.slice(0, 30));
        continue;
      }
    }
    if (!masterId) continue;

    const versions = await fetchMasterVersions(masterId, discogsAuth);
    stats.masters_checked++;
    await new Promise(r => setTimeout(r, PACING_MS));
    if (!versions) continue;

    // Filter to versions whose release date is ≥ today (= future repressy).
    // Discogs returns `released` as YYYY, YYYY-MM or YYYY-MM-DD; treat
    // missing day as 1st of month. Anything fuzzier (just year) we
    // can't trust as "future" — skip.
    const futureVersions = versions.filter(v => {
      const r = String(v.released || '').trim();
      if (!/^\d{4}-\d{2}/.test(r)) return false;
      const normalized = r.length === 7 ? r + '-01' : r;
      return normalized >= today;
    });
    if (futureVersions.length === 0) continue;

    // For each owner of this album × each future version → upsert
    // repress_announcements. Unique index prevents duplicates.
    for (const owner of ownersAll) {
      for (const v of futureVersions) {
        const row = {
          user_id:      owner.user_id,
          master_id:    masterId,
          release_id:   v.id,
          artist:       owner.artist,
          album:        owner.album,
          cover:        v.thumb || owner.cover || null,
          format:       Array.isArray(v.major_formats) ? v.major_formats.join(', ') : (v.format || null),
          label:        v.label || null,
          catno:        v.catno || null,
          country:      v.country || null,
          release_date: v.released.length === 7 ? v.released + '-01' : v.released,
        };
        const { data: inserted } = await sb
          .from('repress_announcements')
          .upsert(row, { onConflict: 'user_id,release_id', ignoreDuplicates: true })
          .select('id, notified_at')
          .maybeSingle();
        if (inserted && !inserted.notified_at) {
          stats.new_repressy++;
          if (!userQueue[owner.user_id]) userQueue[owner.user_id] = [];
          userQueue[owner.user_id].push({ id: inserted.id, artist: owner.artist, album: owner.album, release_date: row.release_date });
        }
      }
    }
  }

  // 2) Send one summary push per user.
  for (const [userId, repressy] of Object.entries(userQueue)) {
    if (budgetExpired()) break;
    const first = repressy[0];
    const more  = repressy.length - 1;
    const body = more > 0
      ? first.artist + ' — ' + first.album + ' + ' + more + ' more repress' + (more === 1 ? '' : 'es')
      : first.artist + ' — ' + first.album + ' (out ' + first.release_date.slice(0, 7) + ')';
    await sendPushToUser(userId, {
      title: '🚨 Repress detected',
      body,
      url:   '/?tab=feed',
      tag:   'repress-' + userId,
    });
    // Mark all rows we just notified about so next run doesn't re-push.
    await sb.from('repress_announcements')
      .update({ notified_at: new Date().toISOString() })
      .in('id', repressy.map(r => r.id));
    stats.pushes_sent++;
  }

  stats.duration_ms = Date.now() - startedAt;
  return NextResponse.json({ success: true, ...stats });
}
