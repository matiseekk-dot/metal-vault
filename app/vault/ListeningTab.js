'use client';
// ── ListeningTab — Vault sub-tab "Scrobbling" ────────────────────
//
// Unified view of everything you've listened to:
//   • Vinyl spins (manual ListenButton presses)
//   • Spotify per-track scrobbles (matched to collection)
//   • Last.fm aggregated top-album rows (one row = N plays)
//
// Layout:
//   [filter chips: ALL · VINYL · DIGITAL]
//   [Discovery card on top — "Brak na winylu, może kup"]
//   [Feed of activity items]
//
// Key UX decision: each row's "do you own this?" status is computed
// server-side at sync time (matched_collection_id link in streaming_history,
// and listen_logs always has a collection_item_id since it's FK-bound).
// So the UI just renders the badge — no per-row verification fetch.
//
// "Verification" prompt = the Discovery card's whole reason for being:
// streamed albums NOT in collection get surfaced for one-tap wishlist add.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';
import { toast } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';
import { track } from '@/lib/analytics';
import StreamingDiscoveries from '@/app/components/StreamingDiscoveries';

const FILTERS = [
  { id: 'all',       i18n: 'listening.filter.all'       },
  { id: 'vinyl',     i18n: 'listening.filter.vinyl'     },
  { id: 'streaming', i18n: 'listening.filter.streaming' },
];

const KIND_BADGE = {
  vinyl:   { label: 'VINYL',    color: '#dc2626', icon: '💿' },
  spotify: { label: 'SPOTIFY',  color: '#1db954', icon: '🟢' },
  lastfm:  { label: 'LAST.FM',  color: '#d51007', icon: '📻' },
};

function FormatPlayedAt({ iso, kind, count }) {
  // Last.fm aggregates use played_at = sync time, not real listens.
  // Render the play_count as the primary signal instead.
  if (kind === 'lastfm') {
    return <span>{count} {count === 1 ? 'play' : 'plays'}</span>;
  }
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  // Relative-ish: today, yesterday, then date.
  const now      = new Date();
  const sameDay  = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYest   = d.toDateString() === yesterday.toDateString();
  if (sameDay) return <span>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
  if (isYest)  return <span>yesterday</span>;
  return <span>{d.toLocaleDateString()}</span>;
}

export default function ListeningTab({ user, onAlbumClick }) {
  const t = useT();
  const [filter, setFilter] = useState('all');
  const [items,  setItems]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);

  const refresh = (currentFilter = filter) => {
    setLoading(true);
    fetch('/api/listening/feed?limit=100&source=' + currentFilter)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setItems(d?.items || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    if (typeof window === 'undefined') return;
    const handler = () => refresh();
    window.addEventListener('mv-streaming-changed', handler);
    window.addEventListener('mv-watchlist-changed', handler);
    return () => {
      window.removeEventListener('mv-streaming-changed', handler);
      window.removeEventListener('mv-watchlist-changed', handler);
    };
  }, []);  // eslint-disable-line

  const switchFilter = (id) => {
    setFilter(id);
    refresh(id);
  };

  const wishlist = async (it, key) => {
    setBusyKey(key);
    try {
      const slug = (it.artist + '::' + it.album).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const r = await fetch('/api/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          album_id: slug,
          artist:   it.artist,
          album:    it.album,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Watchlist failed');
      haptic.success();
      track('listening_action', { action: 'wishlist', kind: it.kind });
      toast.success(t('listening.toast.wishlisted') || 'Added to watchlist ✓');
      // Mark in-place — visual feedback while feed refreshes.
      setItems(prev => prev.map(x =>
        x.artist === it.artist && x.album === it.album
          ? { ...x, watched: true } : x
      ));
      window.dispatchEvent(new CustomEvent('mv-watchlist-changed'));
    } catch (e) {
      toast.error(e.message);
    }
    setBusyKey(null);
  };

  return (
    <div style={{ padding: '12px 16px' }}>
      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto' }}>
        {FILTERS.map(f => {
          const active = filter === f.id;
          return (
            <button key={f.id} onClick={() => switchFilter(f.id)}
              style={{
                padding: '6px 14px', borderRadius: 18,
                background: active ? C.accent + '22' : C.bg2,
                color:      active ? C.accent : C.muted,
                border:     '1px solid ' + (active ? C.accent + '88' : C.border),
                cursor:     'pointer', fontSize: 11, ...MONO,
                whiteSpace: 'nowrap',
                minHeight: 36,
                flexShrink: 0,
              }}>
              {t(f.i18n) || f.id}
            </button>
          );
        })}
      </div>

      {/* Discovery card on top — "Brak na winylu, może kup" */}
      <StreamingDiscoveries/>

      {/* Feed */}
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: C.dim, ...MONO, fontSize: 11 }}>
          ⟳ {t('common.loading') || 'Loading…'}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: C.dim, ...MONO, fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📻</div>
          <div style={{ marginBottom: 8 }}>
            {t('listening.empty.title') || 'No listening activity yet'}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>
            {t('listening.empty.desc') || 'Connect Spotify or Last.fm in Profile, or tap ▶ on a vinyl record.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((it, i) => {
            const key   = (it.collection_id || (it.artist + '::' + it.album)) + '::' + (it.played_at || '') + '::' + i;
            const badge = KIND_BADGE[it.kind] || KIND_BADGE.vinyl;
            const busy  = busyKey === key;
            const clickable = !!it.collection_id;
            return (
              <div key={key}
                onClick={clickable ? () => onAlbumClick?.({
                  ...it,
                  id: it.collection_id,
                  discogs_id: undefined,   // no discogs id here, modal will fetch
                }) : undefined}
                style={{
                  background:    it.in_collection ? '#0a1a0a' : C.bg2,
                  border:        '1px solid ' + (it.in_collection ? '#1a3d1a' : C.border),
                  borderRadius:  8, padding: '10px 12px',
                  display:       'flex', alignItems: 'center', gap: 10,
                  cursor:        clickable ? 'pointer' : 'default',
                }}>
                {/* Cover thumb (if available) */}
                {it.cover ? (
                  <img src={it.cover} alt={it.artist}
                    style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover',
                      flexShrink: 0, border: '1px solid ' + C.border }}
                    onError={e => { e.currentTarget.style.display = 'none'; }}/>
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 4, flexShrink: 0,
                    background: C.bg3, border: '1px solid ' + C.border,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, color: C.dim }}>
                    {badge.icon}
                  </div>
                )}

                {/* Text block */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...BEBAS, fontSize: 14, color: C.text, letterSpacing: '0.04em',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.1 }}>
                    {it.artist}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, ...MONO,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {it.album}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 8, color: badge.color, ...MONO,
                      background: badge.color + '22', padding: '1px 5px', borderRadius: 3,
                      border: '1px solid ' + badge.color + '44', letterSpacing: '0.05em',
                    }}>{badge.label}</span>
                    <span style={{ fontSize: 9, color: C.dim, ...MONO }}>
                      <FormatPlayedAt iso={it.played_at} kind={it.kind} count={it.play_count}/>
                    </span>
                    {it.in_collection && (
                      <span style={{ fontSize: 8, color: '#4ade80', ...MONO,
                        background: '#1a3d1a', padding: '1px 5px', borderRadius: 3,
                        border: '1px solid #4ade8044', letterSpacing: '0.05em' }}>
                        ✓ {t('listening.badge.owned') || 'OWNED'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: action — wishlist if NOT owned + streaming source */}
                {!it.in_collection && it.kind !== 'vinyl' && !it.watched && (
                  <button onClick={e => { e.stopPropagation(); wishlist(it, key); }}
                    disabled={busy}
                    aria-label={t('listening.action.wishlist') || 'Add to watchlist'}
                    style={{
                      flexShrink: 0,
                      background: '#1a3d1a',
                      border: '1px solid #4ade80',
                      borderRadius: 8, color: '#4ade80',
                      cursor: busy ? 'wait' : 'pointer',
                      fontSize: 11, ...MONO, fontWeight: 600,
                      padding: '8px 12px',
                      minHeight: 44, minWidth: 44,
                      opacity: busy ? 0.5 : 1,
                    }}>
                    ☆+
                  </button>
                )}
                {!it.in_collection && it.watched && (
                  <span style={{ flexShrink: 0, fontSize: 10, color: '#f5c842', ...MONO,
                    padding: '6px 10px' }}>
                    ★ {t('listening.badge.watched') || 'WATCHED'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
