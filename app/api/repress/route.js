// ── /api/repress — list + dismiss user's repress announcements ──
//
// GET  → list, newest non-dismissed first, then dismissed history
// POST → mark a row dismissed (UI "got it" tap)
//
// Schema lives at supabase/migrations/028_repress_announcements.sql.
// RLS handles ownership — we don't filter by user_id manually because
// the policy already does.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await sb
    .from('repress_announcements')
    .select('*')
    .eq('user_id', user.id)
    // Active first (NULL dismissed_at), then most recent overall
    .order('dismissed_at', { ascending: true, nullsFirst: true })
    .order('detected_at',  { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = body?.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await sb
    .from('repress_announcements')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
