'use client';
import { useEffect, useRef } from 'react';

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
//   - `onClose` is intentionally NOT in the effect dep array. It's
//     stored in a ref so callers can pass an inline arrow function
//     without retriggering the effect on every render — that would
//     have us pushing+popping a fresh history entry continuously while
//     the overlay is open, which manifests as a hardware-back close
//     after a single click anywhere in the modal.
//   - Multiple open overlays each push their own entry; LIFO order
//     matches the visual stack (topmost closes first).
//   - Safe to call on the server (no-op until effect runs).
export function useBackButton(active, onClose) {
  const cbRef = useRef(onClose);
  cbRef.current = onClose;

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;

    // Mark this entry so we know it's ours and not from the user's normal nav.
    const sentinel = { __mvOverlay: Date.now() };
    window.history.pushState(sentinel, '');

    let closedByPopstate = false;

    const handler = () => {
      closedByPopstate = true;
      cbRef.current?.();
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
  // Intentionally NOT including onClose — see note above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
