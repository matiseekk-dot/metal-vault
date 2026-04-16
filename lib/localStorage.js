// ── Shared localStorage helpers ──────────────────────────────────
// Centralised so every module uses the same key names & safe wrappers.

export const LS_WL = 'mv_watchlist_v2';
export const LS_VC = 'mv_vinyl_cache_v2';

export function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
