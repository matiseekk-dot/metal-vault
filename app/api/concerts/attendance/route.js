// ── Concert attendance prompts ─────────────────────────────────
// GET  → list pending prompts for the user (events past datetime, matched
//        from snapshot of followed artists). Lazy-generated on read.
//        Filtered by user's locale → country whitelist so a Polish user
//        doesn't get prompts for shows in Texas they obviously didn't
//        attend.
// PATCH → user confirms ('attended') or rejects ('dismissed') a prompt.

import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';


export const dynamic = 'force-dynamic';

// Country whitelist by app locale. Conservative neighbour set so road-
// trippable events still surface. Bandsintown stores the country as a
// full English name (e.g. "Poland", "United States") — match accordingly.
// If user's locale isn't here we fall through to no filter so we don't
// silently hide everything for English-speakers globally.
const COUNTRIES_BY_LOCALE = {
  pl: ['Poland', 'Germany', 'Czech Republic', 'Slovakia', 'Austria',
       'Hungary', 'Lithuania', 'Belarus', 'Ukraine', 'Netherlands'],
  de: ['Germany', 'Austria', 'Switzerland', 'Poland', 'Czech Republic',
       'France', 'Belgium', 'Netherlands', 'Denmark', 'Italy'],
};

// Look up country list from explicit ?locale= param, then accept-language
// header, then null (no filter). Profile.location_country could override
// this in a future migration; for now locale is good enough for the
// 95% case.
function countriesForRequest(req) {
  const explicit = new URL(req.url).searchParams.get('locale');
  if (explicit && COUNTRIES_BY_LOCALE[explicit]) return COUNTRIES_BY_LOCALE[explicit];
  const accept = req.headers.get('accept-language') || '';
  const code   = accept.split(',')[0]?.split('-')[0]?.toLowerCase();
  return COUNTRIES_BY_LOCALE[code] || null;
}

export async function GET(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminSb = supabaseAdmin;
  const today = new Date();
  const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);

  // Country whitelist for the user. If null we don't filter (legacy
  // behaviour, English-locale users on global tours).
  const countries = countriesForRequest(request);

  // Step 1: Lazy-generate new prompts for events that ended in last 30 days
  // and match the user's followed artists. We pull `country` so we can
  // filter out shows the user obviously didn't attend (different
  // continent) before persisting them.
  const { data: follows } = await adminSb
    .from('artist_follows').select('artist_name').eq('user_id', user.id);
  const userArtists = (follows || []).map(f => f.artist_name).filter(Boolean);

  if (userArtists.length > 0) {
    let q = adminSb
      .from('artist_event_snapshots')
      .select('artist_name, event_id, event_date, venue, city, country')
      .in('artist_name', userArtists)
      .gte('event_date', monthAgo.toISOString().split('T')[0])
      .lte('event_date', today.toISOString().split('T')[0]);
    if (countries) q = q.in('country', countries);

    const { data: pastEvents } = await q;

    if (pastEvents && pastEvents.length > 0) {
      const newPrompts = pastEvents.map(e => ({
        user_id:    user.id,
        event_id:   e.event_id,
        artist:     e.artist_name,
        venue:      e.venue || '',
        city:       e.city || '',
        event_date: e.event_date,
        status:     'pending',
      }));
      await adminSb.from('concert_attendance_prompts').upsert(newPrompts, {
        onConflict: 'user_id,event_id',
        ignoreDuplicates: true,  // never overwrite user's status decision
      });
    }
  }

  // Step 2: Return pending prompts. We re-filter here too because the
  // user might have prompts persisted from before the country filter
  // landed — those rows lack stored country info and we look it up live.
  let { data: prompts } = await sb
    .from('concert_attendance_prompts')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('event_date', { ascending: false })
    .limit(60);                         // overfetch for client-side country filter
  prompts = prompts || [];

  if (countries && prompts.length > 0) {
    // Map prompts back to snapshots by event_id so we know each event's
    // country. One IN-query covers the whole batch.
    const ids = prompts.map(p => p.event_id);
    const { data: snaps } = await adminSb
      .from('artist_event_snapshots')
      .select('event_id, country').in('event_id', ids);
    const countryByEvent = Object.fromEntries(
      (snaps || []).map(s => [s.event_id, s.country])
    );
    prompts = prompts.filter(p => {
      const c = countryByEvent[p.event_id];
      // Unknown country (legacy snapshot or already deleted) → keep,
      // we'd rather show one extra than silently drop everything.
      return !c || countries.includes(c);
    });
  }

  return NextResponse.json({ prompts: prompts.slice(0, 20) });
}

export async function PATCH(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { event_id, status } = await request.json().catch(() => ({}));
  if (!event_id || !['attended', 'dismissed'].includes(status)) {
    return NextResponse.json({ error: 'event_id and status (attended|dismissed) required' }, { status: 400 });
  }

  const { error } = await sb
    .from('concert_attendance_prompts')
    .update({ status })
    .eq('user_id', user.id)
    .eq('event_id', event_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
