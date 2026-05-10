'use client';
// ── ListenStats — vinyl listening dashboard ──────────────────
//
// Renders inside StatsTab. Pulls everything from /api/listens/stats
// (one request) and shows:
//   • Streak — current + longest, with a flame icon
//   • Counters — last 30/90/365d
//   • Heatmap — last 12 mo grid like GitHub contributions
//   • Top 10 most played
//   • Dust collection — never played + cold for 90+ days
//
// Renders nothing for users with zero plays AND zero collection,
// so the section doesn't clutter the Stats page until they actually
// engage.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';

function relativeDays(days, t) {
  if (days == null)        return t('listen.neverPlayed');
  if (days <= 0)           return t('listen.justPlayed.justNow');
  if (days === 1)          return t('listen.justPlayed.daysAgo', { n: 1 });
  if (days < 30)           return t('listen.justPlayed.daysAgo', { n: days });
  if (days < 365)          return t('listen.justPlayed.monthsAgo', { n: Math.floor(days / 30) });
  return t('listen.justPlayed.yearsAgo', { n: Math.floor(days / 365) });
}

// ── Heatmap — 12 mo of weeks, GitHub-style ───────────────────
function Heatmap({ heatmap }) {
  const t = useT();
  // Compute week-aligned grid: 53 columns × 7 rows. We anchor on today
  // and walk back 365 days. Empty days render as muted squares.
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 365; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: d, key, count: heatmap[key] || 0 });
  }

  // Pad start so column 0 row 0 is Sunday (or Monday — locale matters,
  // we use Sunday-start for simplicity)
  const firstDow = days[0].date.getDay();   // 0=Sun .. 6=Sat
  for (let i = 0; i < firstDow; i++) days.unshift({ date: null, key: null, count: 0 });

  // Group into weeks of 7
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // Color scale based on count. Anything >0 gets a tier.
  const colorFor = (n) => {
    if (n <= 0) return C.bg3;
    if (n === 1) return C.accent + '55';
    if (n === 2) return C.accent + '99';
    if (n === 3) return C.accent + 'cc';
    return C.accent;
  };

  const max = Math.max(0, ...days.map(d => d.count));
  if (max === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 4,
        // Heatmap is wider than viewport — keep horizontal swipe but
        // let vertical drags bubble up so the Stats page still scrolls
        // when finger starts on the heatmap (Android Chromium quirk).
        touchAction: 'pan-x' }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {week.map((day, di) => (
              <div key={di}
                title={day.date ? `${day.key}: ${day.count} ${day.count === 1 ? t('listen.play') : t('listen.plays')}` : ''}
                style={{
                  width: 9, height: 9, borderRadius: 2,
                  background: day.date ? colorFor(day.count) : 'transparent',
                }}/>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 9, color: C.dim, ...MONO }}>{t('listen.heatmapLess')}</span>
        {[0, 1, 2, 3, 4].map(n => (
          <div key={n} style={{ width: 9, height: 9, borderRadius: 2, background: colorFor(n) }}/>
        ))}
        <span style={{ fontSize: 9, color: C.dim, ...MONO }}>{t('listen.heatmapMore')}</span>
      </div>
    </div>
  );
}

export default function ListenStats({ collectionLength = 0 }) {
  const t = useT();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/listens/stats')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
        .catch(() => { if (!cancelled) setLoading(false); });
    };
    load();
    if (typeof window === 'undefined') return () => { cancelled = true; };
    // Refetch on streaming sync (Last.fm / Spotify just imported).
    const handler = () => { setLoading(true); load(); };
    window.addEventListener('mv-streaming-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('mv-streaming-changed', handler);
    };
  }, []);

  // Hide the whole section for users who haven't started using listen
  // tracking yet AND don't have a collection. Once they own records,
  // we DO show it (with a "log your first play" empty state) to drive
  // engagement.
  if (loading) return null;
  if (!data) return null;
  if (data.total?.allTime === 0 && collectionLength === 0) return null;

  // Empty-state CTA when they have a collection but never logged a play
  const hasNoPlays = data.total?.allTime === 0;

  return (
    <div style={{
      background: C.bg2, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <Icon name="play" size={12} color={C.accent}/>
        <span style={{ fontSize: 10, color: C.accent, ...MONO,
          letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          {t('listen.section.title')}
        </span>
      </div>

      {hasNoPlays ? (
        <div style={{ fontSize: 12, color: C.muted, ...MONO, lineHeight: 1.6 }}>
          {t('listen.section.empty')}
        </div>
      ) : (
        <>
          {/* Counter row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
            <Stat label={t('listen.section.allTime')} value={data.total.allTime}/>
            <Stat label={t('listen.section.last30')}  value={data.total.last30d}/>
            <Stat label={t('listen.section.last90')}  value={data.total.last90d}/>
            <Stat label={t('listen.section.streak')}  value={data.streak.current_days} suffix="d"
              accent={data.streak.current_days > 0 ? '#f97316' : undefined}/>
          </div>

          {/* Streak detail */}
          {data.streak.longest_days > 0 && (
            <div style={{ fontSize: 10, color: C.dim, ...MONO, marginBottom: 12,
              display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>
                <Icon name="fire" size={10} color="#f97316" style={{ verticalAlign: 'middle' }}/>
                {' '}{t('listen.section.longestStreak', { n: data.streak.longest_days })}
              </span>
              {data.streak.last_played_at && (
                <span>
                  {t('listen.section.lastPlay', {
                    when: new Date(data.streak.last_played_at).toLocaleDateString(),
                  })}
                </span>
              )}
            </div>
          )}

          {/* Heatmap */}
          <Heatmap heatmap={data.heatmap || {}}/>

          {/* Top played */}
          {data.topPlayed?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 9, color: C.accent, ...MONO,
                letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>
                {t('listen.section.top')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.topPlayed.map((it, i) => (
                  <div key={it.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                      borderBottom: i < data.topPlayed.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                    <span style={{ ...BEBAS, fontSize: 14, color: C.dim, width: 22, textAlign: 'right' }}>
                      {i + 1}.
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.text, ...MONO,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.artist}
                      </div>
                      <div style={{ fontSize: 10, color: C.dim, ...MONO,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.album}
                      </div>
                    </div>
                    <span style={{ ...BEBAS, fontSize: 16, color: C.accent }}>
                      {it.play_count}×
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Streaming activity card moved to Vault → Scrobbling tab.
              Stats stays vinyl-only — streak / dust / top played make
              sense ONLY for physical interaction. Streaming totals +
              top streamed live next to the listening feed where
              they're actionable. */}

          {/* Dust collection */}
          {data.dust?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 9, color: '#f97316', ...MONO,
                letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>
                {t('listen.section.dust')}
              </div>
              <div style={{ fontSize: 10, color: C.dim, ...MONO, marginBottom: 8, lineHeight: 1.5 }}>
                {t('listen.section.dustHint')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.dust.slice(0, 5).map((it, i) => (
                  <div key={it.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                      borderBottom: i < Math.min(4, data.dust.length - 1) ? `1px solid ${C.border}` : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.text, ...MONO,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.artist}
                      </div>
                      <div style={{ fontSize: 10, color: C.dim, ...MONO,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.album}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: '#f97316', ...MONO, flexShrink: 0 }}>
                      {it.never_played ? t('listen.neverPlayed') : relativeDays(it.days_since, t)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Single counter cell ──────────────────────────────────────
function Stat({ label, value, suffix, accent }) {
  return (
    <div style={{
      background: C.bg3, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '8px 10px', textAlign: 'center',
    }}>
      <div style={{ ...BEBAS, fontSize: 22, color: accent || C.text, lineHeight: 1 }}>
        {value || 0}{suffix || ''}
      </div>
      <div style={{ fontSize: 8, color: C.dim, ...MONO, marginTop: 4,
        letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  );
}
