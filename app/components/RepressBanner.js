'use client';
// ── RepressBanner — sticky strip showing newly-detected repressy ──
//
// Reads /api/repress on mount, shows top non-dismissed item as a
// sticky strip below the header. Tap → dismisses + opens Discogs
// listing in a new tab. Auto-collapses when there's nothing to show.
//
// Why a banner not a tab: most users will see 0-1 repressy a week.
// A dedicated tab would feel empty 99% of the time. A banner is
// non-blocking, dismissable, and naturally surfaces the value when
// it matters.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';

export default function RepressBanner({ user }) {
  const t = useT();
  const [items, setItems]   = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/repress');
        const d = await r.json();
        if (cancelled) return;
        // Filter to non-dismissed only — schema returns dismissed too
        // (history) but the banner is for active items.
        const active = (d.items || []).filter(i => !i.dismissed_at);
        setItems(active);
      } catch {}
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!loaded || items.length === 0) return null;

  const top  = items[0];
  const more = items.length - 1;

  const dismiss = async (id) => {
    setItems(prev => prev.filter(x => x.id !== id));
    try {
      await fetch('/api/repress', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id }),
      });
    } catch {}
  };

  const openDiscogs = (releaseId) => {
    window.open('https://www.discogs.com/release/' + releaseId, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{
      background:    'linear-gradient(90deg, #2a1500 0%, #1a0a00 100%)',
      borderBottom:  '1px solid #f5c84266',
      padding:       '8px 14px',
      display:       'flex',
      alignItems:    'center',
      gap:           10,
      position:      'sticky',
      top:           56,
      zIndex:        49,
    }}
    onClick={() => openDiscogs(top.release_id)}
    role="button" aria-label={t('repress.open') || 'View repress on Discogs'}>
      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">🚨</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...BEBAS, fontSize: 13, color: '#f5c842', lineHeight: 1, letterSpacing: '0.04em' }}>
          {t('repress.title') || 'REPRESS DETECTED'}
        </div>
        <div style={{ fontSize: 10, color: C.muted, ...MONO, marginTop: 2, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {top.artist} — {top.album}
          {top.release_date ? ' · ' + top.release_date.slice(0, 7) : ''}
          {more > 0 ? ' · +' + more + ' more' : ''}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(top.id); }}
        aria-label={t('common.close')}
        style={{
          background:   'transparent',
          border:       'none',
          color:        '#888',
          cursor:       'pointer',
          fontSize:     16, lineHeight: 1, padding: 8,
          minWidth:     44, minHeight: 44,
          flexShrink:   0,
        }}>×</button>
    </div>
  );
}
