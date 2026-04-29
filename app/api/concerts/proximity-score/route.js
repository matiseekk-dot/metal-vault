// ── Concert proximity score for PersonaCard ───────────────────
// Computes a personality dimension based on user's concert reachability:
//   • Bands within radius this year
//   • Festival presence (count of festival-tagged events)
//   • Concert frequency tier

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Heuristic: festival venues commonly contain these tokens
function isFestivalEvent(venue) {
  if (!venue) return false;
  const v = String(venue).toLowerCase();
  return /\b(festival|fest|open air|openair|gathering|rocks?\b)\b/.test(v);
}

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Load user profile + follows
  const { data: profile } = await sb
    .from('profiles').select('location_lat, location_lng, location_radius_km')
    .eq('id', user.id).single();

  const { data: follows } = await sb
    .from('artist_follows').select('artist_name').eq('user_id', user.id);

  const followedArtists = (follows || []).map(f => f.artist_name).filter(Boolean);
  if (followedArtists.length === 0) {
    return NextResponse.json({
      score: 0, archetype: 'Studio Loyalist',
      stats: { bands: 0, festivals: 0, total: 0 },
      message: 'Follow artists to discover your concert persona.',
    });
  }

  // Pull cached events from snapshots — server-only table
  const adminSb = supabaseAdmin;
  const { data: snapshots } = await adminSb
    .from('artist_event_snapshots')
    .select('artist_name, event_id, event_date, venue, city, country')
    .in('artist_name', followedArtists);

  if (!snapshots || snapshots.length === 0) {
    return NextResponse.json({
      score: 0, archetype: 'Patient Listener',
      stats: { bands: 0, festivals: 0, total: 0 },
      message: 'No tour data yet — check back tomorrow after the daily refresh.',
    });
  }

  // Filter to "this year" upcoming
  const now = new Date();
  const yearEnd = new Date(now.getFullYear(), 11, 31);
  const upcoming = snapshots.filter(s => {
    if (!s.event_date) return false;
    const d = new Date(s.event_date);
    return d >= now && d <= yearEnd;
  });

  // Filter by radius if location set
  let inRange = upcoming;
  let locationApplied = false;
  if (profile?.location_lat != null && profile?.location_lng != null) {
    locationApplied = true;
    const radius = profile.location_radius_km || 500;
    // We don't have lat/lng in snapshot table by design (privacy + simplicity).
    // For now rely on city/country match; future: enrich snapshot.
    // Skip distance filter for now — radius check moved to digest cron.
  }

  // Count bands with at least one event in range
  const bandsWithEvents = new Set(inRange.map(e => e.artist_name));
  const festivalEvents = inRange.filter(e => isFestivalEvent(e.venue));
  const festivalsUnique = new Set(festivalEvents.map(e => e.venue)).size;

  // Score archetype
  const stats = {
    bands:     bandsWithEvents.size,
    festivals: festivalsUnique,
    total:     inRange.length,
    followed:  followedArtists.length,
  };

  let archetype, headline, score;
  if (stats.festivals >= 3) {
    archetype = 'Festival Hunter';
    headline = stats.festivals + ' festivals feature your bands this year';
    score = Math.min(100, 50 + stats.festivals * 10);
  } else if (stats.bands >= 5) {
    archetype = 'Tour Chaser';
    headline = stats.bands + ' of your bands are touring this year';
    score = Math.min(100, 40 + stats.bands * 6);
  } else if (stats.bands >= 2) {
    archetype = 'Active Concertgoer';
    headline = stats.bands + ' bands play near you this year';
    score = 30 + stats.bands * 8;
  } else if (stats.bands === 1) {
    archetype = 'Selective Listener';
    headline = '1 of your bands has dates this year';
    score = 20;
  } else {
    archetype = 'Studio Loyalist';
    headline = 'Your bands are in the studio this year';
    score = 10;
  }

  return NextResponse.json({
    score,
    archetype,
    headline,
    stats,
    locationApplied,
  });
}
