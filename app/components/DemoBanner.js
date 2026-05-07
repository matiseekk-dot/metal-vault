'use client';
// ── DemoBanner — sticky strip shown to guests in demo mode ────
//
// Visible only when the user has explicitly opted into demo mode
// from the landing page (mv_demo_active = '1'). Positioned just
// below the app header so it doesn't overlap with the value/streak
// chip; collapses out of the layout entirely for signed-in users.
//
// Goal: remind the visitor they're poking at sample data and give
// them a single tap to commit (sign in → real account, demo gets
// wiped automatically by useCollection.loadUserData).
//
// Why not a toast: toasts auto-dismiss. The whole point of demo
// mode is that a Play Store reviewer / first-time visitor might
// browse for several minutes — the banner stays in view across
// every tab swap.
//
// Why not a modal: modals block. We want the user to keep
// exploring; the banner is informational + has one CTA.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';

export default function DemoBanner({ user }) {
  const t = useT();
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try { setActive(localStorage.getItem('mv_demo_active') === '1'); } catch {}
    };
    refresh();
    // The landing page writes mv_demo_active and dispatches this
    // event; we re-read instead of relying on stale state. Also
    // covers the storage-changed-from-another-tab edge case.
    window.addEventListener('mv:demo-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('mv:demo-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Hide while signed in OR if the user never opted into demo.
  if (user || !active) return null;

  return (
    <div style={{
      background:    'linear-gradient(90deg, #2a0a0a 0%, #1a0505 100%)',
      borderBottom:  '1px solid ' + C.accent + '66',
      padding:       '8px 14px',
      display:       'flex',
      alignItems:    'center',
      gap:           10,
      position:      'sticky',
      top:           56,
      zIndex:        49,
    }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>📀</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...BEBAS, fontSize: 13, color: C.gold, lineHeight: 1, letterSpacing: '0.04em' }}>
          {t('demo.bannerTitle') || 'Demo mode'}
        </div>
        <div style={{ fontSize: 10, color: C.muted, ...MONO, marginTop: 2, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t('demo.bannerDesc') || 'Sample records · sign in to save your own collection'}
        </div>
      </div>
      <button
        onClick={() => { window.location.href = '/login'; }}
        style={{
          background:   C.accent,
          border:       'none',
          borderRadius: 6,
          color:        '#fff',
          padding:      '6px 12px',
          ...BEBAS,
          fontSize:     12,
          letterSpacing:'0.06em',
          cursor:       'pointer',
          flexShrink:   0,
        }}>
        {t('demo.bannerCta') || 'Sign in'}
      </button>
    </div>
  );
}
