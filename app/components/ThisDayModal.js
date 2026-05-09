'use client';
// ── ThisDayModal — surfaces the "today in metal" fact when the
//    user opens the app from the daily push ──────────────────────
//
// Triggered by `?day=YYYY-MM-DD` query param (set by the push payload
// in /api/cron/this-day). Shows a sheet with the fact + three CTAs:
//   • "I'll listen today" → log a listen via /api/listens
//   • "+ Wishlist"        → add to watchlist
//   • "✕ Skip"            → just close
//
// Drops the ?day= param after rendering so a refresh doesn't show
// the modal again. Fires PostHog 'this_day_action' so we can measure
// which CTA wins the most engagement.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { metalForDate } from '@/lib/metal-history';
import { track } from '@/lib/analytics';
import { haptic } from '@/lib/haptics';
import { toast } from '@/app/components/Toast';

export default function ThisDayModal({ user }) {
  const t = useT();
  const [fact, setFact] = useState(null);
  const [busy, setBusy] = useState(false);
  useBackButton(!!fact, () => closeAndForget());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const day = params.get('day');
    if (!day) return;
    // Resolve the fact by parsing the day param (YYYY-MM-DD). Falls
    // back to today's UTC date if the param is malformed.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(day + 'T12:00:00Z') : new Date();
    const f = metalForDate(d);
    if (f) {
      setFact(f);
      track('this_day_viewed', { date: day, artist: f.artist, album: f.album });
    }
  }, []);

  const closeAndForget = () => {
    setFact(null);
    if (typeof window === 'undefined') return;
    // Strip ?day= from URL so a back/forward navigation doesn't
    // reopen the modal.
    const url = new URL(window.location.href);
    url.searchParams.delete('day');
    window.history.replaceState({}, '', url.pathname + (url.search || ''));
  };

  const onListenedToday = async () => {
    if (!user) {
      toast.error(t('auth.signInToManage') || 'Sign in to log listens');
      return;
    }
    setBusy(true);
    try {
      // /api/listens requires a collection_item_id (server validates
      // ownership). Look up the matching item in the user's
      // collection — if found, log the listen; if not, fall through
      // to a friendly toast suggesting they add it to wishlist.
      const r = await fetch('/api/collection');
      const d = await r.json();
      const norm = s => String(s || '').toLowerCase().trim();
      const found = (d.items || []).find(i =>
        norm(i.artist) === norm(fact.artist) &&
        norm(i.album)  === norm(fact.album)
      );
      if (found) {
        await fetch('/api/listens', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ collection_item_id: found.id }),
        });
        haptic.success();
        toast.success(t('thisDay.toast.listened') || 'Logged ✓');
      } else {
        // Not in collection — pivot to wishlist. The user clicked
        // "I'll listen today" presumably because they don't have it
        // — adding it to wishlist captures that intent.
        haptic.tap();
        toast(t('thisDay.toast.notOwned') || "You don't own this — adding to wishlist instead.");
        await onWishlist();
        return;
      }
      track('this_day_action', { action: 'listened', artist: fact.artist });
    } catch {}
    setBusy(false);
    closeAndForget();
  };

  const onWishlist = async () => {
    if (!user) { toast.error(t('auth.signInToManage') || 'Sign in to add'); return; }
    setBusy(true);
    try {
      // Slug-based album_id keeps the watchlist row keyed even though
      // we have no Discogs id for a curated fact. CollectionTab UI
      // already handles slug-based watchlist entries.
      const slug = (fact.artist + '::' + fact.album).toLowerCase().replace(/\s+/g, '-');
      await fetch('/api/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          album_id: slug,
          artist:   fact.artist,
          album:    fact.album,
          year:     String(fact.year),
        }),
      });
      window.dispatchEvent(new CustomEvent('mv-watchlist-changed'));
      haptic.success();
      track('this_day_action', { action: 'wishlist', artist: fact.artist });
      toast.success(t('thisDay.toast.wishlisted') || 'Added to watchlist ✓');
    } catch {}
    setBusy(false);
    closeAndForget();
  };

  const onSkip = () => {
    track('this_day_action', { action: 'skip', artist: fact?.artist });
    closeAndForget();
  };

  if (!fact) return null;

  return (
    <div onClick={onSkip} style={{
      position: 'fixed', inset: 0, zIndex: 350,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: 'linear-gradient(180deg, #1a0500 0%, #0a0a0a 100%)',
          borderTop: '2px solid ' + C.accent,
          borderRadius: '16px 16px 0 0',
          maxHeight: '85vh', overflow: 'auto',
          paddingBottom: 'env(safe-area-inset-bottom, 24px)',
        }}>
        <div style={{ width: 40, height: 4, background: '#333', borderRadius: 2, margin: '12px auto 0' }}/>

        <div style={{ padding: '20px 22px 8px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: C.accent, ...MONO,
            letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: 8 }}>
            {t('thisDay.eyebrow') || 'Today in metal'}
          </div>
          <div style={{ ...BEBAS, fontSize: 56, color: C.gold, lineHeight: 1, marginBottom: 4 }}>
            {fact.year}
          </div>
          <div style={{ ...BEBAS, fontSize: 24, color: C.text, letterSpacing: '0.04em', lineHeight: 1.1, marginBottom: 6 }}>
            {fact.artist}
          </div>
          <div style={{ fontSize: 14, color: C.muted, ...MONO, marginBottom: 24, lineHeight: 1.5 }}>
            {fact.album}
            {fact.genre ? ' · ' + fact.genre : ''}
          </div>
        </div>

        <div style={{ padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onListenedToday} disabled={busy}
            style={{
              width: '100%', padding: '14px',
              background: 'linear-gradient(135deg, #dc2626, #991b1b)',
              border: 'none', borderRadius: 12,
              color: '#fff', cursor: busy ? 'wait' : 'pointer',
              ...BEBAS, fontSize: 18, letterSpacing: '0.08em',
              opacity: busy ? 0.6 : 1,
            }}>
            🎧 {t('thisDay.listen') || "I'll listen today"}
          </button>
          <button onClick={onWishlist} disabled={busy}
            style={{
              width: '100%', padding: '12px',
              background: 'transparent',
              border: '1px solid ' + C.gold,
              borderRadius: 12,
              color: C.gold, cursor: busy ? 'wait' : 'pointer',
              ...MONO, fontSize: 13, letterSpacing: '0.05em',
              opacity: busy ? 0.6 : 1,
            }}>
            ☆ {t('thisDay.wishlist') || 'Add to watchlist'}
          </button>
          <button onClick={onSkip}
            style={{
              width: '100%', padding: '10px',
              background: 'none', border: 'none',
              color: C.dim, ...MONO, fontSize: 11,
              cursor: 'pointer',
            }}>
            {t('common.skip') || 'Skip'}
          </button>
        </div>
      </div>
    </div>
  );
}
