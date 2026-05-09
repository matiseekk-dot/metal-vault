'use client';
// ── InstallPrompt — discrete "Install Metal Vault" CTA ─────────────
//
// Most browser users on the landing page have no idea this site is a
// PWA. Chrome's native install prompt is opaque (small ⊕ icon in URL
// bar that shows up only sometimes), and most users never trigger it.
//
// We capture `beforeinstallprompt` and surface our own button at a
// natural moment (footer of landing). Click → prompt() → install →
// done. If the browser doesn't fire the event (Firefox, Safari, an
// already-installed install) the component renders nothing.
//
// Sticky-dismiss: a click on "Not now" sets mv_install_dismissed and
// the bar stays gone for 30 days. Reappears after that — by then the
// user might be ready to commit.
//
// Telemetry: emits 'install_prompt_shown' / 'install_prompt_accepted'
// / 'install_prompt_dismissed' so we can measure the bar's actual
// conversion (PostHog, no-op without the env var).

import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics';

const DISMISS_KEY      = 'mv_install_dismissed';
const DISMISS_TTL_DAYS = 30;

function isRecentlyDismissed() {
  if (typeof localStorage === 'undefined') return false;
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (!at) return false;
    const ageDays = (Date.now() - at) / 86_400_000;
    return ageDays < DISMISS_TTL_DAYS;
  } catch { return false; }
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  // Chrome / Android TWA
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari
  if (window.navigator.standalone === true) return true;
  // Bubblewrap TWA — referrer trick (matches lib/payments.js)
  if ((document.referrer || '').startsWith('android-app://')) return true;
  return false;
}

export default function InstallPrompt({ accent = '#dc2626' }) {
  const [event, setEvent] = useState(null);   // BeforeInstallPromptEvent
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone() || isRecentlyDismissed()) return;

    const onBeforeInstall = (e) => {
      e.preventDefault();          // hold the event so we can fire later
      setEvent(e);
      track('install_prompt_shown');
    };
    const onInstalled = () => {
      // User installed via our prompt OR via the URL-bar fallback. Either
      // way clear the dismissed flag and hide the button for this session.
      setEvent(null);
      track('install_prompt_accepted');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!event || dismissed) return null;

  const handleInstall = async () => {
    try {
      await event.prompt();
      const outcome = await event.userChoice;
      if (outcome?.outcome === 'accepted') {
        track('install_prompt_accepted', { source: 'cta' });
        setEvent(null);
      } else {
        track('install_prompt_declined', { source: 'cta' });
        // Treat OS-level "no" as a 30d dismiss too — don't badger.
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
        setDismissed(true);
      }
    } catch {
      // prompt() can throw if called more than once per gesture chain.
      setDismissed(true);
    }
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    track('install_prompt_dismissed');
    setDismissed(true);
  };

  return (
    <div style={{
      position:     'fixed',
      bottom:       'calc(16px + env(safe-area-inset-bottom, 0px))',
      left:         12, right: 12,
      maxWidth:     420, margin: '0 auto',
      background:   'linear-gradient(135deg,#1a0500,#0a0a0a)',
      border:       '1px solid ' + accent + '66',
      borderRadius: 14,
      padding:      '12px 14px',
      display:      'flex', alignItems: 'center', gap: 12,
      boxShadow:    '0 6px 24px rgba(0,0,0,0.55)',
      zIndex:       9000,
      fontFamily:   "var(--font-space-mono), monospace",
    }} role="region" aria-label="Install Metal Vault">
      <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">📥</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#f0f0f0', lineHeight: 1.2 }}>
          Install Metal Vault
        </div>
        <div style={{ fontSize: 10, color: '#888', marginTop: 2, lineHeight: 1.4 }}>
          One-tap launch · works offline · no app store account needed
        </div>
      </div>
      <button onClick={handleInstall}
        style={{
          background: accent, border: 'none', borderRadius: 8,
          color: '#fff', padding: '10px 14px', cursor: 'pointer',
          fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
          minWidth: 72, minHeight: 44,
        }}>
        Install
      </button>
      <button onClick={handleDismiss}
        aria-label="Not now"
        style={{
          background: 'transparent', border: 'none',
          color: '#666', cursor: 'pointer',
          fontSize: 18, lineHeight: 1, padding: 8,
          minWidth: 44, minHeight: 44,
        }}>×</button>
    </div>
  );
}
