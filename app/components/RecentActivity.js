'use client';
// ── RecentActivity — home-screen activity feed ──────────────────
//
// Pulls a thin slice from each major data source the user has
// touched recently and reduces them to a unified 'card' shape
// sorted by timestamp. Five categories:
//
//   📦 Added — last record added to collection
//   💰 Sold  — last record sold (with PnL)
//   🎤 Concert — last attended concert
//   🔥 New release — earliest upcoming release from a followed artist
//   📍 Festival — upcoming festival in your area (if location set)
//
// Lives at the top of Feed tab, above StatsBar — gives the user
// a 'why this app is useful' loop the moment they open it.
// Compact (≤5 items shown), tappable rows that route to the
// relevant tab.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { useCurrency, useFx, formatPrice } from '@/lib/currency';

function timeAgo(iso, t) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('recent.justNow') || 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  return d.toISOString().slice(0, 10);
}

export default function RecentActivity({ collection = [], concerts: concertsProp, releases = [], followedArtists = [], onNavigate }) {
  const t = useT();
  const cur = useCurrency();
  const fx  = useFx();
  const [collapsed, setCollapsed] = useState(false);
  const [fetchedConcerts, setFetchedConcerts] = useState([]);

  // Caller can pass concerts directly (when the parent already has
  // them loaded — concerts tab mounted, etc). When not provided,
  // fetch /api/user-concerts ourselves. Cheap call, cached by SW
  // on subsequent renders.
  useEffect(() => {
    if (Array.isArray(concertsProp)) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/user-concerts');
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled && Array.isArray(d?.concerts)) {
          setFetchedConcerts(d.concerts);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [concertsProp]);

  const concerts = Array.isArray(concertsProp) ? concertsProp : fetchedConcerts;

  // Build the unified feed. Each entry: { id, ts, kind, icon, title, sub, color, target }.
  // 'target' is a tab name or external action — caller's onNavigate
  // dispatches it ('feed', 'vault', 'concerts', etc.).
  const items = [];

  // 1. Last added record
  const sortedByAdded = [...(collection || [])]
    .filter(c => !c.is_sold)
    .sort((a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')))
    .slice(0, 1);
  if (sortedByAdded[0]) {
    const c = sortedByAdded[0];
    items.push({
      id: 'add:' + c.id,
      ts: c.added_at || '',
      kind: 'add',
      icon: '📦',
      title: t('recent.added') || 'Dodano do kolekcji',
      sub: `${c.artist} — ${c.album}`,
      color: '#4ade80',
      target: 'vault',
    });
  }

  // 2. Last sold record (with realized PnL)
  const sortedBySold = (collection || [])
    .filter(c => c.is_sold && c.sold_date)
    .sort((a, b) => String(b.sold_date || '').localeCompare(String(a.sold_date || '')))
    .slice(0, 1);
  if (sortedBySold[0]) {
    const c = sortedBySold[0];
    const sold = Number(c.sold_price) || 0;
    const paid = Number(c.purchase_price) || 0;
    const pnl  = paid > 0 ? sold - paid : 0;
    const pnlStr = paid > 0
      ? (pnl >= 0 ? '+' : '') + formatPrice(pnl, cur, fx)
      : '';
    items.push({
      id: 'sold:' + c.id,
      ts: c.sold_date || '',
      kind: 'sold',
      icon: '💰',
      title: (t('recent.sold') || 'Sprzedano')
        + (sold > 0 ? ` · ${formatPrice(sold, cur, fx)}` : '')
        + (pnlStr ? ` (${pnlStr})` : ''),
      sub: `${c.artist} — ${c.album}`,
      color: pnl >= 0 ? '#f5c842' : '#f87171',
      target: 'vault',
    });
  }

  // 3. Last attended concert (planned_date in past, attended=true)
  const todayIso = new Date().toISOString().slice(0, 10);
  const pastConcerts = (concerts || [])
    .filter(c => c.attended !== false
      && c.planned_date
      && String(c.planned_date).slice(0, 10) <= todayIso)
    .sort((a, b) => String(b.planned_date || '').localeCompare(String(a.planned_date || '')))
    .slice(0, 1);
  if (pastConcerts[0]) {
    const c = pastConcerts[0];
    items.push({
      id: 'concert:' + c.id,
      ts: c.planned_date || '',
      kind: 'concert',
      icon: '🎤',
      title: t('recent.concert') || 'Byłeś na koncercie',
      sub: c.band || '?',
      color: '#dc2626',
      target: 'concerts',
    });
  }

  // 4. Next upcoming release from followed artists
  const followedLower = new Set(
    (followedArtists || []).map(a => (a.artist_name || '').toLowerCase())
  );
  if (followedLower.size > 0 && (releases || []).length > 0) {
    const upcoming = releases
      .filter(r => {
        if (!r.artist || !r.releaseDate) return false;
        if (!followedLower.has(r.artist.toLowerCase())) return false;
        const d = new Date(r.releaseDate);
        if (isNaN(d)) return false;
        const daysFromNow = (d - Date.now()) / 86400000;
        return daysFromNow >= 0 && daysFromNow <= 180;
      })
      .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate))
      .slice(0, 1);
    if (upcoming[0]) {
      const r = upcoming[0];
      const daysFromNow = Math.round((new Date(r.releaseDate) - Date.now()) / 86400000);
      const when = daysFromNow === 0 ? (t('recent.today') || 'dziś')
        : daysFromNow === 1 ? (t('recent.tomorrow') || 'jutro')
        : daysFromNow < 7 ? `za ${daysFromNow}d`
        : daysFromNow < 30 ? `za ${Math.round(daysFromNow / 7)}t`
        : String(r.releaseDate).slice(0, 10);
      items.push({
        id: 'rel:' + r.id,
        ts: r.releaseDate || '',
        kind: 'release',
        icon: '🔥',
        title: (t('recent.newRelease') || 'Nowa płyta · ' + when),
        sub: `${r.artist} — ${r.album}`,
        color: '#f5c842',
        target: 'feed',
      });
    }
  }

  if (items.length === 0) return null;

  return (
    <div style={{ padding: '12px 16px 0' }}>
      <div onClick={() => setCollapsed(c => !c)}
        style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 8, cursor: 'pointer' }}>
        <div style={{ fontSize: 11, color: C.accent, ...MONO,
          letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          {t('recent.title') || '🕒 Ostatnia aktywność'}
        </div>
        <div style={{ fontSize: 10, color: C.dim, ...MONO }}>
          {collapsed ? '▼' : '▲'}
        </div>
      </div>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
          marginBottom: 12 }}>
          {items.map(it => (
            <button key={it.id}
              onClick={() => it.target && onNavigate?.(it.target)}
              style={{
                background: C.bg2, border: '1px solid ' + C.border,
                borderRadius: 10, padding: '10px 12px',
                display: 'flex', gap: 10, alignItems: 'flex-start',
                cursor: it.target ? 'pointer' : 'default',
                textAlign: 'left', width: '100%',
              }}>
              <div style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{it.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: it.color, ...MONO,
                  fontWeight: 600, lineHeight: 1.2 }}>
                  {it.title}
                </div>
                <div style={{ fontSize: 12, color: C.text, ...MONO,
                  marginTop: 3, lineHeight: 1.3,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap' }}>
                  {it.sub}
                </div>
              </div>
              <div style={{ fontSize: 9, color: C.dim, ...MONO,
                flexShrink: 0, marginTop: 3 }}>
                {timeAgo(it.ts, t)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
