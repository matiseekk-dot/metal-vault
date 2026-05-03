'use client';
import { useEffect } from 'react';

// ── useBackButton ───────────────────────────────────────────────
// Make Android's hardware back button close a transient overlay (modal,
// sheet, scanner, etc.) instead of exiting the app.
//
// Mechanism: while `active` is true, push a sentinel history entry. When
// the user hits the back button, the browser pops that entry and fires
// `popstate` — we treat that as "close this overlay" and call `onClose`
// without further history manipulation.
//
// If the overlay is closed in any other way (button click, swipe, escape),
// we manually pop the sentinel back off so we don't leave it in history.
//
// Usage:
//   useBackButton(isOpen, () => setIsOpen(false));
//
// Notes:
//   - Multiple open overlays each push their own entry; LIFO order, which
//     matches the visual stack (closes the topmost first).
//   - Safe to call on the server (no-op until effect runs).
export function useBackButton(active, onClose) {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;

    // Mark this entry so we know it's ours and not from the user's normal nav.
    const sentinel = { __mvOverlay: Date.now() };
    window.history.pushState(sentinel, '');

    let closedByPopstate = false;

    const handler = () => {
      closedByPopstate = true;
      onClose?.();
    };

    window.addEventListener('popstate', handler);

    return () => {
      window.removeEventListener('popstate', handler);
      // If the overlay was closed by something other than the back button,
      // remove the sentinel we pushed so the back stack stays clean.
      if (!closedByPopstate) {
        const current = window.history.state;
        if (current && current.__mvOverlay === sentinel.__mvOverlay) {
          window.history.back();
        }
      }
    };
  }, [active, onClose]);
}
