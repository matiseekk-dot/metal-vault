'use client';
// ── StreamingDiscoveries — wishlist suggestions from streaming history ──
//
// Pulls /api/streaming/discoveries (top albums you streamed in last
// 90d but don't own + aren't watching + haven't dismissed). Each row
// has two CTAs:
//   • + Wishlist — POST /api/watchlist with the slug album_id, then
//                  also dismiss so it doesn't resurface as a duplicate
//   • ✕ Dismiss — DELETE /api/streaming/discoveries (server records
//                  dismissal in streaming_dismissed)
//
// Card hides itself when there are zero candidates — common state
// for users with full collections or who just connected streaming
// for the first time.
//
// Why "discovery" not "auto-add to wishlist": auto-adding without
// confirmation breaks user trust (suddenly you have 50 watchlist
// rows you didn't ask for). The two-button paradigm makes intent
// explicit + gives Sentry/PostHog clear conversion data.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { toast } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';
import { track } from '@/lib/analytics';

export default function StreamingDiscoveries() {
  const t = useT();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);

  const refresh = async () => {
    try {
      const r = await fetch('/api/streaming/discoveries');
      const d = await r.json();
      setItems(d.items || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // Refetch when sync just finished — the LastfmSyncCard /
    // SpotifySyncCard dispatch this after a successful POST.
    if (typeof window === 'undefined') return;
    const handler = () => { setLoading(true); refresh(); };
    window.addEventListener('mv-streaming-changed', handler);
    return () => window.removeEventListener('mv-streaming-changed', handler);
  }, []);

  if (loading) return null;
  if (items.length === 0) return null;

  const keyOf = (it) => it.artist_norm + '::' + it.album_norm;

  const wishlist = async (it) => {
    setBusyKey(keyOf(it));
    try {
      // album_id slug — Discogs id is unknown for streamed-only
      // albums. Watchlist row uses the same slug pattern as
      // BandsTab "♥ wanted" toggle.
      const slug = (it.artist_norm + '::' + it.album_norm).replace(/\s+/g, '-');
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
      if (!r.ok) throw new Error(d.error || 'Watchlist add failed');

      // Also dismiss so it doesn't resurface (now in watchlist
      // anyway, but user may move it OUT later — keeping the
      // dismissal makes the discovery card honour the "I dealt
      // with this" intent permanently).
      fetch('/api/streaming/discoveries', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ artist: it.artist, album: it.album }),
      }).catch(() => {});

      haptic.success();
      track('discovery_action', { action: 'wishlist', plays: it.plays });
      toast.success(t('discovery.toast.wishlisted') || 'Added to watchlist ✓');
      window.dispatchEvent(new CustomEvent('mv-watchlist-changed'));
      setItems(prev => prev.filter(x => keyOf(x) !== keyOf(it)));
    } catch (e) {
      toast.error(e.message);
    }
    setBusyKey(null);
  };

  const dismiss = async (it) => {
    setBusyKey(keyOf(it));
    try {
      const r = await fetch('/api/streaming/discoveries', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ artist: it.artist, album: it.album }),
      });
      if (!r.ok) throw new Error('Dismiss failed');
      haptic.tap();
      track('discovery_action', { action: 'dismiss', plays: it.plays });
      setItems(prev => prev.filter(x => keyOf(x) !== keyOf(it)));
    } catch (e) {
      toast.error(e.message);
    }
    setBusyKey(null);
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0a1a0a 0%, #14201a 100%)',
      border: '1px solid #4ade8055', borderRadius: 12,
      padding: 14, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 14 }}>🔭</span>
        <span style={{ fontSize: 10, color: '#86efac', ...MONO,
          letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          {t('discovery.title') || 'Discovered via streaming'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: C.muted, ...MONO, lineHeight: 1.5, marginBottom: 12 }}>
        {t('discovery.subtitle') || "Albums you've been streaming a lot but don't own. Skip or save for later."}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(it => {
          const k    = keyOf(it);
          const busy = busyKey === k;
          return (
            <div key={k} style={{
              background: '#0a0a0a', border: '1px solid ' + C.border,
              borderRadius: 8, padding: '10px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: C.text, ...BEBAS, letterSpacing: '0.04em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.artist}
                </div>
                <div style={{ fontSize: 11, color: C.muted, ...MONO,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.album}
                </div>
                <div style={{ fontSize: 9, color: '#86efac', ...MONO, marginTop: 2 }}>
                  {it.plays} {t('discovery.plays', { n: it.plays }) || 'plays'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => wishlist(it)} disabled={busy}
                  aria-label={t('discovery.wishlist') || 'Add to watchlist'}
                  style={{
                    background: '#1a3d1a', border: '1px solid #4ade80',
                    borderRadius: 8, color: '#4ade80', cursor: busy ? 'wait' : 'pointer',
                    fontSize: 12, ...MONO, fontWeight: 600,
                    padding: '8px 14px', minHeight: 44, minWidth: 44,
                    opacity: busy ? 0.5 : 1,
                  }}>
                  ☆+
                </button>
                <button onClick={() => dismiss(it)} disabled={busy}
                  aria-label={t('discovery.dismiss') || 'Dismiss'}
                  style={{
                    background: 'transparent', border: '1px solid ' + C.border,
                    borderRadius: 8, color: C.dim, cursor: busy ? 'wait' : 'pointer',
                    fontSize: 14, ...MONO,
                    padding: '8px 12px', minHeight: 44, minWidth: 44,
                    opacity: busy ? 0.5 : 1,
                  }}>
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
