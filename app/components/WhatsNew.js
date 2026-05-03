'use client';
// ── WhatsNew — versioned changelog modal ──────────────────────────
//
// Shows a one-time modal whenever the user opens the app on a version
// newer than the one they last saw. Opt-in mechanism for communicating
// new Pro-tier value, retention-driven updates, and bug-fix highlights
// without spamming push notifications.
//
// Wiring:
//   import WhatsNew, { APP_VERSION } from '@/app/components/WhatsNew';
//   <WhatsNew/>   // mount once near the root for signed-in users
//
// To ship a new version:
//   1. Bump APP_VERSION (semver).
//   2. Add a new entry to CHANGELOG keyed by that version.
//   3. Deploy. Users hit the modal once on next open.
//
// Storage key: `mv_whats_new_seen` = last-seen version string.
// On first install we save APP_VERSION immediately (no modal) so brand
// new users land in the app without a marketing pop-up. Modal only
// fires on actual upgrades.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useBackButton } from '@/lib/hooks/useBackButton';

// ── Version + changelog ───────────────────────────────────────────
// Keep entries newest-first when adding. Three at most are shown.
export const APP_VERSION = '1.0.0';

const CHANGELOG = {
  '1.0.0': {
    date:  '2026-05-03',
    title: 'Welcome to Metal Vault',
    items: [
      'Track your vinyl collection — Discogs sync, barcode scan, manual entry',
      'Smart watchlist with price-drop alerts (3 free, unlimited on Pro)',
      'Concert journal, attendance prompts and Setlist.fm integration',
      'Insurance-ready PDF reports + photo documentation (Pro)',
      'Portfolio change tracking — see your collection value over time (Pro)',
    ],
  },
};

const LS_KEY = 'mv_whats_new_seen';

// Compare semver-ish strings ("1.10.0" > "1.9.5"). Not a full semver
// implementation — assumes plain numeric segments which is what we ship.
function newer(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da > db) return  1;
    if (da < db) return -1;
  }
  return 0;
}

export default function WhatsNew() {
  const [unseen, setUnseen] = useState([]);   // versions newer than `seen`
  const [open, setOpen]     = useState(false);
  useBackButton(open, () => dismiss());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let seen = null;
    try { seen = localStorage.getItem(LS_KEY); } catch {}

    if (!seen) {
      // First-ever load — silently mark current as seen so we never
      // greet a brand-new user with a "what's changed since you weren't
      // here" modal. They'll see updates from this point forward.
      try { localStorage.setItem(LS_KEY, APP_VERSION); } catch {}
      return;
    }

    if (newer(APP_VERSION, seen) <= 0) return;     // already up to date

    // Pick all versions > seen, newest first, capped at 3 for readability.
    const versions = Object.keys(CHANGELOG)
      .filter(v => newer(v, seen) > 0)
      .sort((a, b) => newer(b, a))
      .slice(0, 3);

    if (versions.length > 0) {
      setUnseen(versions);
      setOpen(true);
    } else {
      // Nothing notable to show but APP_VERSION moved (patch with no
      // changelog entry) — still update the marker so we don't keep
      // checking each render.
      try { localStorage.setItem(LS_KEY, APP_VERSION); } catch {}
    }
  }, []);

  const dismiss = () => {
    setOpen(false);
    try { localStorage.setItem(LS_KEY, APP_VERSION); } catch {}
  };

  if (!open || unseen.length === 0) return null;

  return (
    <div
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 4500,
        background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: C.bg2,
          borderRadius: '20px 20px 0 0',
          maxHeight: '85vh', overflow: 'auto',
          paddingBottom: 'env(safe-area-inset-bottom, 24px)',
        }}>
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, background: '#333', borderRadius: 2, margin: '14px auto 0' }} />

        <div style={{ padding: '20px 22px 8px' }}>
          <div style={{ ...MONO, fontSize: 10, color: C.accent, letterSpacing: '0.25em', textTransform: 'uppercase' }}>
            What&rsquo;s new
          </div>
          <div style={{ ...BEBAS, fontSize: 30, color: C.text, letterSpacing: '0.04em', lineHeight: 1.05, marginTop: 6 }}>
            Metal Vault {APP_VERSION}
          </div>
        </div>

        <div style={{ padding: '8px 22px 0' }}>
          {unseen.map(v => {
            const entry = CHANGELOG[v];
            if (!entry) return null;
            return (
              <div key={v} style={{ marginBottom: 18 }}>
                {unseen.length > 1 && (
                  <div style={{ ...MONO, fontSize: 9, color: C.dim, letterSpacing: '0.15em', marginBottom: 6 }}>
                    v{v} · {entry.date}
                  </div>
                )}
                {entry.title && (
                  <div style={{ ...BEBAS, fontSize: 18, color: C.text, letterSpacing: '0.04em', marginBottom: 8 }}>
                    {entry.title}
                  </div>
                )}
                <ul style={{ paddingLeft: 18, margin: 0, listStyle: 'none' }}>
                  {entry.items.map((item, i) => (
                    <li key={i} style={{
                      fontSize: 12, color: C.muted, ...MONO,
                      lineHeight: 1.55, marginBottom: 6, paddingLeft: 14,
                      position: 'relative',
                    }}>
                      <span style={{ position: 'absolute', left: 0, color: C.accent }}>›</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div style={{ padding: '4px 22px 22px' }}>
          <button onClick={dismiss}
            style={{
              width: '100%', padding: '14px',
              background: `linear-gradient(135deg, ${C.accent}, #991b1b)`,
              border: 'none', borderRadius: 12, color: '#fff',
              cursor: 'pointer', ...BEBAS, fontSize: 18,
              letterSpacing: '0.08em',
            }}>
            🤘 Let&rsquo;s go
          </button>
        </div>
      </div>
    </div>
  );
}
