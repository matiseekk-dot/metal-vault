// ── /api/profile/auto-drop — read/write the user's auto-alert threshold ─
//
// GET    → { pct: 25 | null }
// PATCH  → body { pct: 25 | null }    null = disable
//
// pct is integer 5..90 (anything outside disables). One value per user;
// applied to every watchlist row by the daily cron in /api/cron/prices.
//
// Why server-side instead of just client localStorage: the cron needs
// to know the user's threshold without the user being online. Storing
// in profiles makes it canonically server-known.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Defensive: column may not exist yet on databases without migration 036
  // applied. Fall back to null (= disabled) so the UI degrades gracefully
  // instead of erroring.
  let pct = null;
  try {
    const { data } = await sb.from('profiles')
      .select('auto_drop_pct')
      .eq('id', user.id)
      .maybeSingle();
    pct = data?.auto_drop_pct ?? null;
  } catch {}

  return NextResponse.json({ pct });
}

export async function PATCH(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { body = {}; }

  let pct = body.pct;
  // Coerce to int or null. Anything outside 5..90 disables.
  if (pct === null || pct === undefined || pct === '') {
    pct = null;
  } else {
    pct = Number(pct);
    if (!Number.isFinite(pct) || pct < 5 || pct > 90) pct = null;
    else pct = Math.round(pct);
  }

  // Upsert: if profiles row doesn't exist yet (rare — usually created
  // by trigger on signup) we insert with id only.
  try {
    const { error } = await sb.from('profiles')
      .upsert({ id: user.id, auto_drop_pct: pct }, { onConflict: 'id' });
    if (error) throw error;
  } catch (e) {
    // If the column doesn't exist (migration 036 not yet applied), we
    // can't store the preference. Tell the UI so it can show a helpful
    // message rather than silently swallowing.
    return NextResponse.json({
      error:   'auto_drop_pct column missing — apply migration 036',
      detail:  String(e.message || e),
    }, { status: 503 });
  }

  return NextResponse.json({ pct });
}
