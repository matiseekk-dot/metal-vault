import { NextResponse } from 'next/server';
import { TIERS } from '@/lib/stripe';
import { createClient } from '@/lib/supabase-server';


export const dynamic = 'force-dynamic';

async function getUser(sb) {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

export async function GET() {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Narrow select — UI uses these 8 fields. The table also stores
  // last_triggered, last_seen_price, baseline_price (cron-only), and
  // collection_item_id (rarely needed). Skip them on the read path.
  const { data, error } = await supabase
    .from('price_alerts')
    .select('id, discogs_id, album_id, artist, album, target_price, alert_type, is_active, direction, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alerts: data });
}

export async function POST(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Alert limits: free = 1, pro = unlimited ─────────────────
  const { data: profile } = await supabase
    .from('profiles').select('subscription_status, subscription_end').eq('id', user.id).single();
  const premium = profile?.subscription_status === 'active' ||
                  profile?.subscription_status === 'trialing' ||
                 (profile?.subscription_status === 'past_due' && profile?.subscription_end &&
                  Date.now() < new Date(profile.subscription_end).getTime() + 3*24*60*60*1000);
  if (!premium) {
    const { count } = await supabase
      .from('price_alerts').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('is_active', true);
    const FREE_LIMIT = TIERS.free.alertLimit;
    if ((count || 0) >= FREE_LIMIT) {
      return NextResponse.json({
        error:   'ALERT_LIMIT_REACHED',
        message: 'Free plan includes ' + FREE_LIMIT + ' price alerts. Upgrade to Pro for unlimited.',
        count, limit: FREE_LIMIT,
      }, { status: 403 });
    }
  }

  const body = await request.json();

  // SECURITY: whitelist writable fields — user_id, created_at,
  // triggered_at are server-owned. We DO accept discogs_id / artist /
  // album from the client because the alert needs to be attributable
  // even when the source row (collection or watchlist) has been
  // edited/deleted; we copy them at insert time as a denormalized
  // snapshot used by digest emails and cron logs.
  const ALLOWED = [
    'collection_id', 'collection_item_id',
    'album_id', 'discogs_id', 'artist', 'album',
    'target_price', 'direction', 'is_active', 'alert_type', 'baseline_price',
  ];
  const safe = Object.fromEntries(
    Object.entries(body || {}).filter(([k]) => ALLOWED.includes(k))
  );

  // Validation
  if (safe.target_price !== undefined) {
    const p = Number(safe.target_price);
    if (isNaN(p) || p <= 0 || p > 100000) {
      return NextResponse.json({ error: 'target_price must be between 0 and 100000' }, { status: 400 });
    }
    safe.target_price = p;
  }
  if (safe.direction && !['above', 'below'].includes(safe.direction)) {
    return NextResponse.json({ error: 'direction must be "above" or "below"' }, { status: 400 });
  }

  // discogs_id may arrive as a string (Discogs master IDs sometimes
  // come through that way). Normalize to BIGINT-castable or null.
  // Slugged watchlist IDs like "hypno5e::acid_mist" become null here
  // and the row is matched by album_id at cron-time instead.
  if (safe.discogs_id !== undefined) {
    const n = Number(safe.discogs_id);
    safe.discogs_id = Number.isFinite(n) && n > 0 ? n : null;
  }

  // Require at least one identifier so the cron can find this alert.
  if (!safe.discogs_id && !safe.album_id && !safe.collection_id && !safe.collection_item_id) {
    return NextResponse.json({
      error: 'Need at least one of: discogs_id, album_id, collection_id'
    }, { status: 400 });
  }

  // Default identity fields if client didn't provide them. The schema
  // declares artist/album NOT NULL — fill from explicit body or a
  // generic placeholder if the alert is purely identifier-based.
  if (!safe.artist) safe.artist = body?.artist || 'Unknown';
  if (!safe.album)  safe.album  = body?.album  || 'Unknown';

  const { data, error } = await supabase
    .from('price_alerts')
    .insert({ ...safe, user_id: user.id })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alert: data });
}

export async function PATCH(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id   = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const body = await request.json();

  const ALLOWED = ['target_price', 'direction', 'is_active', 'alert_type', 'baseline_price'];
  const safe = Object.fromEntries(
    Object.entries(body || {}).filter(([k]) => ALLOWED.includes(k))
  );
  if (safe.target_price !== undefined) {
    const p = Number(safe.target_price);
    if (isNaN(p) || p <= 0 || p > 100000) return NextResponse.json({ error: 'Invalid target_price' }, { status: 400 });
    safe.target_price = p;
  }
  if (Object.keys(safe).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

  const { data, error } = await supabase
    .from('price_alerts').update(safe)
    .eq('id', id).eq('user_id', user.id)
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alert: data });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const id         = url.searchParams.get('id');
  const discogsId  = url.searchParams.get('discogs_id');

  if (!id && !discogsId) {
    return NextResponse.json({ error: 'id or discogs_id required' }, { status: 400 });
  }

  let q = supabase.from('price_alerts').delete().eq('user_id', user.id);
  if (id)        q = q.eq('id', id);
  if (discogsId) q = q.eq('discogs_id', discogsId);

  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
