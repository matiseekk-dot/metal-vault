// ── Concert attendance prompts ─────────────────────────────────
// GET  → list pending prompts for the user (events past datetime, matched
//        from snapshot of followed artists). Lazy-generated on read.
// PATCH → user confirms ('attended') or rejects ('dismissed') a prompt.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminSb = supabaseAdmin;
  const today = new Date();
  const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);

  // Step 1: Lazy-generate new prompts for events that ended in last 30 days
  // and match the user's followed artists.
  const { data: follows } = await adminSb
    .from('artist_follows').select('artist_name').eq('user_id', user.id);
  const userArtists = (follows || []).map(f => f.artist_name).filter(Boolean);

  if (userArtists.length > 0) {
    const { data: pastEvents } = await adminSb
      .from('artist_event_snapshots')
      .select('artist_name, event_id, event_date, venue, city')
      .in('artist_name', userArtists)
      .gte('event_date', monthAgo.toISOString().split('T')[0])
      .lte('event_date', today.toISOString().split('T')[0]);

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

  // Step 2: Return pending prompts
  const { data: prompts } = await sb
    .from('concert_attendance_prompts')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('event_date', { ascending: false })
    .limit(20);

  return NextResponse.json({ prompts: prompts || [] });
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
