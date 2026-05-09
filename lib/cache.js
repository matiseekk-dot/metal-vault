// ── LRU + TTL cache backed by localStorage ────────────────────────
//
// Why this exists: useCollection.fetchVinyl() previously persisted the
// full Discogs response per album-id into `mv_vinyl_cache_v2` with no
// size cap, no TTL, and no eviction (lib/hooks/useCollection.js). Power
// users who scrolled the feed for months would accumulate hundreds of
// entries × 5-10 kB each → eventual QuotaExceededError → silent failure
// (`saveLS` swallows the throw) → cache writes stop, RAM keeps growing,
// price freshness rots because `if (vinylCache[key]) return` short-
// circuits even on stale data.
//
// This module wraps that pattern with:
//   • TTL — entries older than `maxAgeMs` are treated as misses
//   • LRU eviction — when count > maxEntries, the oldest-touched entry
//     is dropped. "Touched" means written OR read (read updates access
//     timestamp), so frequently-viewed albums stay warm even if they
//     were added long ago.
//   • Lazy migration — first call to load() seeds from the legacy flat
//     `mv_vinyl_cache_v2` shape if present, then writes back in the new
//     wrapped shape. Subsequent calls only touch the new key.
//
// Usage:
//   import { createLRUCache } from '@/lib/cache';
//   const vinyl = createLRUCache({
//     key:        'mv_vinyl_cache_v3',
//     legacyKey:  'mv_vinyl_cache_v2',
//     maxEntries: 200,
//     maxAgeMs:   7 * 24 * 60 * 60 * 1000,  // 7 days
//   });
//   const cached = vinyl.get(albumId);
//   if (!cached) {
//     const data = await fetch(...);
//     vinyl.set(albumId, data);
//   }
//
// Format on disk:
//   {
//     "v": 1,                                    // schema version
//     "entries": {
//       "<id>": { "data": {...}, "t": <epoch> }  // t = last-access ms
//     }
//   }

const SCHEMA_VERSION = 1;

function nowMs() { return Date.now(); }

function safeParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function createLRUCache({ key, legacyKey, maxEntries = 200, maxAgeMs = 7 * 24 * 60 * 60 * 1000 }) {
  // SSR-safe — no-op cache object. Same surface as the real one so
  // callers don't need to null-check on the server.
  if (typeof window === 'undefined') {
    return { get: () => null, set: () => {}, delete: () => {}, clear: () => {}, snapshot: () => ({}) };
  }

  // Hot in-memory mirror so hot reads don't repeat JSON.parse on every
  // tap. Kept in sync with localStorage on every set / delete.
  let mem = null;

  function load() {
    if (mem) return mem;
    const stored = safeParse(localStorage.getItem(key));
    if (stored && stored.v === SCHEMA_VERSION && stored.entries) {
      mem = stored;
    } else if (legacyKey) {
      // Legacy migration — convert flat { id: data } to wrapped shape.
      const legacy = safeParse(localStorage.getItem(legacyKey));
      const t = nowMs();
      const entries = {};
      if (legacy && typeof legacy === 'object') {
        for (const [k, v] of Object.entries(legacy)) {
          // Stamp legacy entries with current time so they enjoy the
          // full TTL window once. They'll evict naturally as their
          // access time falls behind newer reads.
          entries[k] = { data: v, t };
        }
      }
      mem = { v: SCHEMA_VERSION, entries };
      // Best-effort persist; if quota errors, fine — we still have mem.
      persist();
      // Drop the legacy key so we don't keep paying its size cost.
      try { localStorage.removeItem(legacyKey); } catch {}
    } else {
      mem = { v: SCHEMA_VERSION, entries: {} };
    }
    return mem;
  }

  function persist() {
    if (!mem) return;
    try {
      localStorage.setItem(key, JSON.stringify(mem));
    } catch {
      // QuotaExceededError or storage unavailable. Try one aggressive
      // eviction pass and persist again. If that still fails, drop the
      // entry from memory too — better to refetch than keep a ghost.
      evictUntilFits(Math.floor(maxEntries / 2));
      try { localStorage.setItem(key, JSON.stringify(mem)); } catch {}
    }
  }

  function evictUntilFits(targetCount) {
    if (!mem) return;
    const entries = Object.entries(mem.entries);
    if (entries.length <= targetCount) return;
    // Sort ascending by access time — oldest first, drop them.
    entries.sort((a, b) => (a[1].t || 0) - (b[1].t || 0));
    const toRemove = entries.length - targetCount;
    for (let i = 0; i < toRemove; i++) {
      delete mem.entries[entries[i][0]];
    }
  }

  function get(id) {
    if (id == null) return null;
    const c = load();
    const entry = c.entries[String(id)];
    if (!entry) return null;
    const age = nowMs() - (entry.t || 0);
    if (age > maxAgeMs) {
      // Stale → drop and miss. Caller refetches.
      delete c.entries[String(id)];
      persist();
      return null;
    }
    // Touch — update access time so LRU keeps frequently-read items.
    // Skip persist on every read (would write storage on every paint);
    // batch via the next set() call instead.
    entry.t = nowMs();
    return entry.data;
  }

  function set(id, data) {
    if (id == null) return;
    const c = load();
    c.entries[String(id)] = { data, t: nowMs() };
    // Evict before persist so we never exceed the cap on disk.
    evictUntilFits(maxEntries);
    persist();
  }

  function del(id) {
    if (id == null) return;
    const c = load();
    if (c.entries[String(id)]) {
      delete c.entries[String(id)];
      persist();
    }
  }

  function clear() {
    mem = { v: SCHEMA_VERSION, entries: {} };
    try { localStorage.removeItem(key); } catch {}
  }

  function snapshot() {
    // Returns a flat { id: data } view for callers that still expect
    // the legacy shape (e.g. React state initializers).
    const c = load();
    const out = {};
    const cutoff = nowMs() - maxAgeMs;
    for (const [k, v] of Object.entries(c.entries)) {
      if ((v.t || 0) >= cutoff) out[k] = v.data;
    }
    return out;
  }

  return { get, set, delete: del, clear, snapshot };
}

// ── Default vinyl cache instance — used by useCollection.fetchVinyl ──
// 200 entries × ~5 kB ≈ 1 MB max — well under LS 5 MB origin cap, leaves
// 80% of quota for the rest of the app's state.
export const vinylCache = createLRUCache({
  key:        'mv_vinyl_cache_v3',
  legacyKey:  'mv_vinyl_cache_v2',
  maxEntries: 200,
  maxAgeMs:   7 * 24 * 60 * 60 * 1000,  // 7 days
});
