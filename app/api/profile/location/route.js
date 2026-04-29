// ── Profile location update ───────────────────────────────────
// Used by ProfileTab when user opts in to "concerts near me".
// Stores lat/lng/city/radius_km in profiles table (RLS protected).

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { lat, lng, city, radius_km } = body;

  // Whitelist + validation — never trust client input on numeric fields
  const update = {};
  if (lat != null) {
    const n = Number(lat);
    if (isNaN(n) || n < -90 || n > 90) {
      return NextResponse.json({ error: 'Invalid lat' }, { status: 400 });
    }
    update.location_lat = n;
  }
  if (lng != null) {
    const n = Number(lng);
    if (isNaN(n) || n < -180 || n > 180) {
      return NextResponse.json({ error: 'Invalid lng' }, { status: 400 });
    }
    update.location_lng = n;
  }
  if (city != null) {
    if (typeof city !== 'string' || city.length > 80) {
      return NextResponse.json({ error: 'Invalid city' }, { status: 400 });
    }
    update.location_city = city.trim() || null;
  }
  if (radius_km != null) {
    const n = Number(radius_km);
    if (isNaN(n) || n < 10 || n > 5000) {
      return NextResponse.json({ error: 'Invalid radius' }, { status: 400 });
    }
    update.location_radius_km = Math.round(n);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error } = await sb.from('profiles').update(update).eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, ...update });
}

export async function DELETE() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await sb.from('profiles').update({
    location_lat: null,
    location_lng: null,
    location_city: null,
  }).eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
