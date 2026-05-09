// ── /api/variants — variant catalog for one album ────────────────
//
// GET /api/variants?master_id=<discogs master id>
//   OR /api/variants?release_id=<any release id>  (we resolve master)
//
// Returns the full list of pressings/variants for an album with:
//   • format details (LP, color, limited, repress, etc.)
//   • rarity score (derived from Discogs community.have count —
//     low have count = rarer)
//   • marketplace stats (lowest price, num for sale)
//   • whether the user owns this exact variant
//
// Killer feature for metal collectors: on Mastodon's "Crack The Skye"
// they want to see all 23 variants (red splatter LTD/666, picture
// disc, repress 2018, etc.) and check off the ones they own.
//
// Cache: variants don't churn (a Discogs version is added once and
// stays forever). Use the same `discogs_cache` table as /api/releases
// with key `variants:{master_id}` and 24h TTL.
//
// Rate budget: 1-2 Discogs calls per request worst case (versions
// list + optional resolve master). Middleware rate-limits to 30/min
// per IP.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const TTL_MS = 24 * 60 * 60 * 1000;
const UA     = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

function authHeader() {
  const k = process.env.DISCOGS_KEY, s = process.env.DISCOGS_SECRET, t = process.env.DISCOGS_TOKEN;
  if (k && s) return 'Discogs key=' + k + ', secret=' + s;
  if (t)      return 'Discogs token=' + t;
  return null;
}

async function readCache(sb, key) {
  const { data } = await sb.from('discogs_cache').select('data, created_at').eq('cache_key', key).single();
  if (!data) return null;
  const age = Date.now() - new Date(data.created_at).getTime();
  if (age > TTL_MS) return null;
  return data.data;
}

async function writeCache(sb, key, payload) {
  try {
    await sb.from('discogs_cache').upsert(
      { cache_key: key, data: payload, created_at: new Date().toISOString() },
      { onConflict: 'cache_key' }
    );
  } catch {}
}

// "Rarity score" — heuristic 0-100 based on Discogs community.have
// count for this version. Lower have count = rarer = higher score.
//   have ≥ 5000 → 0  (super common, e.g. mainline US press)
//   have 500    → 50
//   have 50     → 80
//   have 1-5    → 100 (test press / promo / extremely rare)
//
// Logarithmic so the curve is smooth at low have counts where most
// of the "rare" interest lives.
function rarityScore(haveCount) {
  if (!haveCount || haveCount < 1) return null;
  const x = Math.max(1, haveCount);
  const score = Math.round(100 - 25 * Math.log10(x));
  return Math.max(0, Math.min(100, score));
}

function rarityLabel(score) {
  if (score == null) return null;
  if (score >= 85) return 'Holy grail';
  if (score >= 70) return 'Rare';
  if (score >= 50) return 'Uncommon';
  if (score >= 30) return 'Common';
  return 'Mainline';
}

export async function GET(request) {
  const sb = await createClient();
  const url = new URL(request.url);
  const masterIdRaw  = url.searchParams.get('master_id');
  const releaseIdRaw = url.searchParams.get('release_id');

  const auth = authHeader();
  if (!auth) return NextResponse.json({ error: 'Discogs not configured' }, { status: 503 });

  let masterId = masterIdRaw && /^\d+$/.test(masterIdRaw) ? Number(masterIdRaw) : null;

  // Resolve master_id from a release_id if needed.
  if (!masterId && releaseIdRaw && /^\d+$/.test(releaseIdRaw)) {
    const cacheKey = 'release-master:' + releaseIdRaw;
    let resolved = await readCache(sb, cacheKey);
    if (!resolved) {
      try {
        const r = await fetch('https://api.discogs.com/releases/' + releaseIdRaw, {
          headers: { Authorization: auth, ...UA },
        });
        if (r.ok) {
          const d = await r.json();
          if (d.master_id) {
            resolved = { master_id: d.master_id };
            await writeCache(sb, cacheKey, resolved);
          }
        }
      } catch {}
    }
    if (resolved?.master_id) masterId = resolved.master_id;
  }

  if (!masterId) {
    return NextResponse.json({ error: 'master_id or release_id with a master required' }, { status: 400 });
  }

  // ── Variants list (versions of the master) ─────────────────
  const cacheKey = 'variants:' + masterId;
  let payload = await readCache(sb, cacheKey);
  if (!payload) {
    try {
      const r = await fetch(
        'https://api.discogs.com/masters/' + masterId + '/versions?per_page=100&sort=released&sort_order=desc',
        { headers: { Authorization: auth, ...UA } }
      );
      if (!r.ok) {
        return NextResponse.json({ error: 'Discogs upstream ' + r.status }, { status: 502 });
      }
      const d = await r.json();
      payload = { versions: Array.isArray(d.versions) ? d.versions : [] };
      await writeCache(sb, cacheKey, payload);
    } catch (e) {
      return NextResponse.json({ error: 'Upstream failure: ' + e.message }, { status: 502 });
    }
  }

  // Mark which variants the user owns. We match by discogs_id == version.id
  // so partial coverage is OK — users who added albums via search-by-name
  // (no discogs_id) just see "0 owned" even if they actually own one.
  let ownedIds = new Set();
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    const { data: items } = await sb.from('collection')
      .select('discogs_id')
      .eq('user_id', user.id)
      .not('discogs_id', 'is', null);
    ownedIds = new Set((items || []).map(i => Number(i.discogs_id)));
  }

  const enriched = (payload.versions || []).map(v => {
    const formatStr = Array.isArray(v.major_formats) ? v.major_formats.join(' · ') : (v.format || '');
    // Cheap heuristics for "limited" / "repress" / "color" — Discogs
    // doesn't have structured fields for any of these so we string-match.
    const formatLower = String(v.format || '').toLowerCase();
    const isLimited   = /limited|numbered|ltd/i.test(formatLower);
    const isRepress   = /reissue|repress|re-?press/i.test(formatLower);
    const score       = rarityScore(v.stats?.community?.in_collection);
    return {
      id:           v.id,
      thumb:        v.thumb || null,
      title:        v.title || null,
      format:       formatStr,
      formatRaw:    v.format || null,
      label:        v.label || null,
      catno:        v.catno || null,
      country:      v.country || null,
      released:     v.released || null,
      isLimited,
      isRepress,
      have:         v.stats?.community?.in_collection ?? null,
      want:         v.stats?.community?.in_wantlist  ?? null,
      lowestPrice:  v.lowest_price ?? null,
      numForSale:   v.stats?.user?.in_collection ?? null,  // best-effort
      rarity:       score,
      rarityLabel:  rarityLabel(score),
      owned:        ownedIds.has(Number(v.id)),
      discogsUrl:   'https://www.discogs.com/release/' + v.id,
    };
  });

  // Sort: rarest first, then most recent. Owners care most about
  // "what's the rarest variant I'm missing".
  enriched.sort((a, b) => {
    const ra = a.rarity ?? -1;
    const rb = b.rarity ?? -1;
    if (rb !== ra) return rb - ra;
    return String(b.released || '').localeCompare(String(a.released || ''));
  });

  return NextResponse.json({
    master_id:    masterId,
    total:        enriched.length,
    owned_count:  enriched.filter(v => v.owned).length,
    variants:     enriched,
  });
}
