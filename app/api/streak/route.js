// ── Daily streak tracker ──────────────────────────────────────
// POST: marks today as active and updates streak counter.
// GET: returns current streak state.
// Idempotent: calling POST multiple times per day is safe.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('user_streaks').select('*').eq('user_id', user.id).single();

  if (!data) return NextResponse.json({ current_streak: 0, longest_streak: 0, last_active_date: null });

  const today = todayStr();
  const yesterday = yesterdayStr();
  let currentStreak = data.current_streak;
  if (data.last_active_date && data.last_active_date !== today && data.last_active_date !== yesterday) {
    currentStreak = 0;
  }

  return NextResponse.json({
    current_streak:    currentStreak,
    longest_streak:    data.longest_streak,
    last_active_date:  data.last_active_date,
    total_days_active: data.total_days_active,
  });
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const today = todayStr();
  const yesterday = yesterdayStr();

  const { data: existing } = await supabase
    .from('user_streaks').select('*').eq('user_id', user.id).single();

  let currentStreak, longestStreak, totalDays;

  if (!existing) {
    currentStreak = 1;
    longestStreak = 1;
    totalDays = 1;
  } else if (existing.last_active_date === today) {
    return NextResponse.json({
      current_streak: existing.current_streak,
      longest_streak: existing.longest_streak,
      last_active_date: existing.last_active_date,
      total_days_active: existing.total_days_active,
      updated: false,
    });
  } else if (existing.last_active_date === yesterday) {
    currentStreak = existing.current_streak + 1;
    longestStreak = Math.max(existing.longest_streak, currentStreak);
    totalDays = existing.total_days_active + 1;
  } else {
    currentStreak = 1;
    longestStreak = existing.longest_streak;
    totalDays = existing.total_days_active + 1;
  }

  const { error } = await supabase.from('user_streaks').upsert({
    user_id:           user.id,
    current_streak:    currentStreak,
    longest_streak:    longestStreak,
    last_active_date:  today,
    total_days_active: totalDays,
    updated_at:        new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    current_streak: currentStreak,
    longest_streak: longestStreak,
    last_active_date: today,
    total_days_active: totalDays,
    updated: true,
  });
}
