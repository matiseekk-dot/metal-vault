// ── Haptic feedback — single tap / success / error patterns ──────
//
// Wraps navigator.vibrate with semantic helpers so callsites stay
// readable and the actual ms patterns live in one file (easy to
// tune later, easy to mute). Safe on every platform: navigator.vibrate
// returns false on iOS Safari and on desktop, the helpers no-op
// silently.
//
// Why bother: in a TWA shell + barebones SPA, success actions feel
// "weightless" without haptics. Adding a 10ms pulse on add-to-vault /
// alert-saved / barcode-match takes the experience from "web page that
// happens to be installed" to "actual app". Zero KB cost.
//
// Mute toggle: respects localStorage `mv_haptics_off === '1'`. ProfileTab
// can expose a switch later if users complain.
//
// Usage:
//   import { haptic } from '@/lib/haptics';
//   haptic.tap();      // 10 ms — navigation, selection
//   haptic.success();  // 15-30-15 — saved, added, scanned
//   haptic.error();    // 50-30-50 — destructive cancel, validation fail
//
// All helpers fire-and-forget. No await, no return value to check.

const PATTERNS = {
  tap:     [10],
  success: [15, 30, 15],
  error:   [50, 30, 50],
  warn:    [25, 50, 25],
};

function isMuted() {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem('mv_haptics_off') === '1'; } catch { return false; }
}

function fire(pattern) {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  if (isMuted()) return;
  try { navigator.vibrate(pattern); } catch {}
}

export const haptic = {
  tap:     () => fire(PATTERNS.tap),
  success: () => fire(PATTERNS.success),
  error:   () => fire(PATTERNS.error),
  warn:    () => fire(PATTERNS.warn),
  // Stop any in-progress vibration. Useful when navigating away mid-pattern.
  stop:    () => fire(0),
};
