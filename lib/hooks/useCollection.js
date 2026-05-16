// ── useCollection — all collection/watchlist/vinyl/follow state ──
// Provides the `col` object used by app/page.js.
// Naming matches the refactored page.js (loadUserData, resetUserData,
// fetchVinyl, vinylCache, vinylLoading, vinylError, setVinylError).
//
// Guest mode: when user is null AND the demo flag is set in
// localStorage (because they tapped "Try as guest" on the landing
// page), this hook seeds the demo dataset on first call and treats
// the demo localStorage keys as the source of truth — every
// add/remove/edit persists to LS instead of hitting Supabase. Sign-in
// detects the seeded demo and clears it before loading the real
// account data, so the user's actual collection isn't polluted.

'use client';
import { useState, useCallback, useEffect } from 'react';
import { t } from '@/lib/i18n';
import {
  DEMO_COLLECTION,
  DEMO_WATCHLIST,
  DEMO_FOLLOWED_ARTISTS,
  DEMO_KEYS,
} from '@/lib/demo-data';
import { vinylCache as vinylCacheStore } from '@/lib/cache';
import { trackAddToCollection } from '@/lib/analytics';
import { haptic } from '@/lib/haptics';

const LS_WL = 'mv_watchlist_v2';
function loadLS(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function saveLS(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// True iff guest opted into demo mode (clicked "Try as guest" on
// landing page). Drives the entire LS-as-source-of-truth path
// inside this hook.
function isDemoActive() {
  try { return localStorage.getItem(DEMO_KEYS.active) === '1'; } catch { return false; }
}

// Seed the demo localStorage keys once. Idempotent — re-running
// after the user has edited a record won't reset their changes.
function seedDemoIfNeeded() {
  try {
    if (localStorage.getItem(DEMO_KEYS.seeded) === '1') return;
    localStorage.setItem(DEMO_KEYS.collection,      JSON.stringify(DEMO_COLLECTION));
    localStorage.setItem(DEMO_KEYS.watchlist,       JSON.stringify(DEMO_WATCHLIST));
    localStorage.setItem(DEMO_KEYS.followedArtists, JSON.stringify(DEMO_FOLLOWED_ARTISTS));
    localStorage.setItem(DEMO_KEYS.seeded, '1');
  } catch {}
}

// Wipe demo state on sign-in so the real account data takes over
// without merge collisions. Called from loadUserData when we detect
// the user just transitioned guest → signed-in.
export function clearDemoData() {
  try {
    [DEMO_KEYS.collection, DEMO_KEYS.watchlist, DEMO_KEYS.followedArtists,
     DEMO_KEYS.concerts,   DEMO_KEYS.seeded,    DEMO_KEYS.active].forEach(k =>
       localStorage.removeItem(k));
  } catch {}
}

export function useCollection(user) {
  // ── Collection / watchlist / follows ──────────────────────────
  // Initial state honours demo mode: if the guest has opted in (the
  // landing-page "Try as guest" button writes mv_demo_active=1),
  // seed and load from the demo LS keys so the very first paint of
  // Vault → Collection isn't an empty placeholder. Without demo
  // mode, start empty — the auth listener fills these in via
  // loadUserData() once the session resolves.
  // Initial state MUST be the same server-side and client-first-render
  // (React #418 otherwise). Demo-mode hydration happens in useEffect
  // below — server can't read localStorage, so it returns [] for all
  // three. The client's first render also returns [] (because we no
  // longer read localStorage in the initializer), matches the server's
  // HTML, then useEffect rehydrates demo data on next tick.
  const [collection,        setCollection]        = useState([]);
  const [watchlist,         setWatchlist]         = useState([]);
  const [followedArtists,   setFollowedArtists]   = useState([]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isDemoActive()) return;
    seedDemoIfNeeded();
    try {
      const col = loadLS(DEMO_KEYS.collection,      []);
      const wl  = loadLS(DEMO_KEYS.watchlist,       []);
      const fa  = loadLS(DEMO_KEYS.followedArtists, []);
      if (Array.isArray(col) && col.length > 0) setCollection(col);
      if (Array.isArray(wl)  && wl.length  > 0) setWatchlist(wl);
      if (Array.isArray(fa)  && fa.length  > 0) setFollowedArtists(fa);
    } catch {}
  }, []);
  const [portfolio,         setPortfolio]         = useState(null);
  const [collectionSummary, setCollectionSummary] = useState(null);

  // ── Vinyl (Discogs) cache ──────────────────────────────────────
  // Source of truth is lib/cache.js (LRU + 7d TTL, max 200 entries,
  // legacy mv_vinyl_cache_v2 migrated lazily). React state below is a
  // snapshot for re-render triggering; mutations always go through
  // vinylCacheStore so eviction stays consistent.
  //
  // CRITICAL: must start as `{}` server-side AND client-first-render
  // identically. The lazy `() => vinylCacheStore.snapshot()` initializer
  // runs on BOTH sides — server returns {} (no localStorage), client
  // returns actual cached entries → hydration mismatch (React #418)
  // when AlbumCard renders different content for same album id. Lift
  // the snapshot read into a useEffect that fires after hydration.
  const [vinylCache,   setVinylCache]   = useState({});
  useEffect(() => {
    try {
      const snap = vinylCacheStore.snapshot();
      if (snap && Object.keys(snap).length > 0) setVinylCache(snap);
    } catch {}
  }, []);
  const [vinylLoading, setVinylLoading] = useState(false);
  const [vinylError,   setVinylError]   = useState('');

  // ── Server loaders ─────────────────────────────────────────────
  const loadUserData = useCallback(async (_user) => {
    // User just transitioned guest → signed-in. Drop the demo flag
    // and LS keys so the real account data isn't visually merged
    // with leftover demo state. (We deliberately don't auto-import
    // demo records into the user's Supabase rows — those were
    // marketing-time samples, not their real collection.)
    if (isDemoActive()) clearDemoData();
    try {
      const [wl, coll, arts, port] = await Promise.all([
        fetch('/api/watchlist').then(r => r.json()),
        fetch('/api/collection').then(r => r.json()),
        fetch('/api/artists').then(r => r.json()),
        fetch('/api/portfolio').then(r => r.json()),
      ]);
      if (wl.items)       setWatchlist(wl.items);
      if (coll.items)     setCollection(coll.items);
      if (coll.summary)   setCollectionSummary(coll.summary);
      if (arts.artists)   setFollowedArtists(arts.artists);
      if (port.snapshots) setPortfolio(port);

      // Sync barcodes to IDB so scanner works offline at record fairs.
      // Fire-and-forget — don't block UI on this.
      try {
        const { syncBarcodesToIdb } = await import('@/lib/offline-barcode');
        syncBarcodesToIdb({
          collection: coll.items || [],
          watchlist:  wl.items   || [],
        }).catch(() => {});
      } catch {}
    } catch (e) {
      const { logError } = await import('@/lib/log');
      logError('useCollection.loadUserData', e);
    }
  }, []);

  // ── Cross-component sync: refetch followed artists on demand ──
  // Surfaces like ListeningTab let the user follow a band directly via
  // POST /api/artists, bypassing useCollection.toggleFollow. Without
  // this listener, BandsTab and other consumers of `followedArtists`
  // wouldn't see the change until a full reload. The event is dispatched
  // wherever direct API mutations happen.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refreshArtists = async () => {
      try {
        const r = await fetch('/api/artists');
        if (!r.ok) return;
        const d = await r.json();
        if (d.artists) setFollowedArtists(d.artists);
      } catch {}
    };
    window.addEventListener('mv-artists-changed', refreshArtists);

    // Same pattern for collection-level mutations (for-sale toggle, etc.)
    // that happen deep in the modal tree where the parent collection
    // state isn't reachable as a prop callback. Without this the
    // "💲 LISTED" badge and the "Na sprzedaż" filter chip count stay
    // stale until next full reload.
    const refreshCollection = async () => {
      try {
        const r = await fetch('/api/collection');
        if (!r.ok) return;
        const d = await r.json();
        if (d.items) setCollection(d.items);
        if (d.summary) setCollectionSummary(d.summary);
      } catch {}
    };
    window.addEventListener('mv-collection-changed', refreshCollection);

    return () => {
      window.removeEventListener('mv-artists-changed', refreshArtists);
      window.removeEventListener('mv-collection-changed', refreshCollection);
    };
  }, []);

  const resetUserData = useCallback(() => {
    // Sign-out path. If demo is active (or the user explicitly chose
    // "stay as guest"), restore demo data so the app doesn't suddenly
    // look empty after logout. Without demo mode, fall back to the
    // anonymous watchlist-only behaviour from before the demo
    // existed.
    if (isDemoActive()) {
      seedDemoIfNeeded();
      setCollection(loadLS(DEMO_KEYS.collection,      []));
      setWatchlist(loadLS(DEMO_KEYS.watchlist,        []));
      setFollowedArtists(loadLS(DEMO_KEYS.followedArtists, []));
    } else {
      setCollection([]);
      setFollowedArtists([]);
      setWatchlist(loadLS(LS_WL, []));
    }
    setPortfolio(null);
    setCollectionSummary(null);
  }, []);

  // ── Vinyl fetch (Discogs) ──────────────────────────────────────
  const fetchVinyl = useCallback(async (album) => {
    const key = album.id;
    // Hit lib/cache LRU first — it handles TTL + eviction. Skip the
    // network round-trip + spinner if we have a fresh entry.
    const cached = vinylCacheStore.get(key);
    if (cached) {
      setVinylCache(prev => prev[key] === cached ? prev : { ...prev, [key]: cached });
      return;
    }
    setVinylLoading(true); setVinylError('');
    try {
      const params = new URLSearchParams({ artist: album.artist, album: album.album });
      const r = await fetch(`/api/discogs?${params}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Discogs error');
      vinylCacheStore.set(key, d);
      setVinylCache(prev => ({ ...prev, [key]: d }));
    } catch (e) { setVinylError(e.message); }
    setVinylLoading(false);
  }, []);

  // ── Collection CRUD ────────────────────────────────────────────
  const addToCollection = useCallback(async (item, onSuccess) => {
    // Source attribution for funnel analysis. Inferred from the shape
    // of `item`:
    //   - has `barcode` field → barcode_scan
    //   - has `discogs_id` from sync route → discogs_sync (best guess)
    //   - has just artist/album → manual or feed_quick_add
    // Callsites with cleaner intent should pass their own source via
    // item._source (kept private, stripped server-side via whitelist).
    const source = item?._source
      || (item?.barcode ? 'barcode_scan'
        : item?.discogs_id ? 'feed_quick_add'
        : 'manual');

    // Guest in demo mode → write to demo LS instead of bouncing the
    // user to the sign-in screen. Lets reviewers + first-time
    // visitors see the "add a record" flow end-to-end without an
    // account.
    if (!user) {
      if (isDemoActive()) {
        const newItem = {
          ...item,
          id: 'demo-' + Date.now().toString(36),
          added_at: new Date().toISOString(),
        };
        setCollection(c => {
          const next = [newItem, ...c];
          saveLS(DEMO_KEYS.collection, next);
          return next;
        });
        trackAddToCollection('demo_seed');
        haptic.success();
        onSuccess?.();
        return;
      }
      const { toast } = await import('@/app/components/Toast');
      toast.error(t('auth.signInToManage'));
      return;
    }
    // Belt-and-braces: wrap everything in try/catch so a network blip,
    // non-JSON response, or thrown dynamic import never leaves the
    // caller hanging with zero feedback. Always emit a toast in failure
    // paths, log every error to console for in-the-field diagnostics.
    let r, d;
    try {
      r = await fetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
    } catch (netErr) {
      console.error('[addToCollection] fetch failed', netErr);
      const { toast } = await import('@/app/components/Toast');
      toast.error('Network error — check connection');
      return;
    }
    try {
      d = await r.json();
    } catch (parseErr) {
      console.error('[addToCollection] non-JSON response', r.status, parseErr);
      const { toast } = await import('@/app/components/Toast');
      toast.error('Server error (' + r.status + ')');
      return;
    }

    if (d.error) {
      if (d.error === 'ALERT_LIMIT_REACHED') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('mv:upgrade', { detail: { reason: 'ALERT_LIMIT_REACHED' } }));
        }
        return;
      }

      // Migration 043 not applied yet → `is_preordered` column missing.
      // Retry the same insert without the flag so the row at least
      // lands in the collection (user can mark delivered/preorder later
      // once the migration runs). Detect by the typical Postgres error
      // string.
      const errStr = String(d.error || '').toLowerCase();
      if (item.is_preordered && (errStr.includes('is_preordered') || errStr.includes('column'))) {
        console.warn('[addToCollection] is_preordered column missing — retrying without flag');
        const { is_preordered, ...stripped } = item;
        try {
          const r2 = await fetch('/api/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stripped),
          });
          const d2 = await r2.json();
          if (d2.item) {
            setCollection(c => [d2.item, ...c]);
            trackAddToCollection(source);
            haptic.success();
            const { toast } = await import('@/app/components/Toast');
            toast('Added (preorder flag pending DB migration)');
            onSuccess?.();
            return;
          }
        } catch (e) {
          console.error('[addToCollection] retry failed', e);
        }
      }

      console.error('[addToCollection] server error', d.error);
      const { logError } = await import('@/lib/log');
      logError('addToCollection error', d.error);
      const { toast } = await import('@/app/components/Toast');
      toast.error('Failed to add: ' + d.error);
      return;
    }
    if (d.item) {
      setCollection(c => [d.item, ...c]);
      // Optimistic success — surface a toast immediately, refresh
      // portfolio + collection in background. Previously the toast
      // never fired and users assumed the click did nothing.
      const { toast } = await import('@/app/components/Toast');
      toast.success(item.is_preordered ? 'Marked as pre-ordered' : 'Added to collection');
      const [port, coll] = await Promise.all([
        fetch('/api/portfolio').then(r => r.json()),
        fetch('/api/collection').then(r => r.json()),
      ]);
      setPortfolio(port);
      if (coll.items)   setCollection(coll.items);
      if (coll.summary) setCollectionSummary(coll.summary);
      trackAddToCollection(source);
      haptic.success();
      onSuccess?.();
    } else {
      // Response had neither `error` nor `item` — shouldn't happen with
      // the current /api/collection contract, but log it so we'd notice
      // a future regression.
      console.warn('[addToCollection] empty response shape', d);
      const { toast } = await import('@/app/components/Toast');
      toast.error('Unexpected server response');
    }
  }, [user]);

  const batchImportCollection = useCallback(async (item) => {
    if (!user) return;
    const r = await fetch('/api/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
    const d = await r.json();
    if (d.item) setCollection(c => c.some(x => x.discogs_id === item.discogs_id) ? c : [d.item, ...c]);
  }, [user]);

  const batchImportWatchlist = useCallback(async (item) => {
    if (!user) return;
    const r = await fetch('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
    const d = await r.json();
    if (d.item) setWatchlist(w => w.some(x => (x.album_id || x.id) === item.album_id) ? w : [d.item, ...w]);
  }, [user]);

  const removeFromCollection = useCallback(async (id) => {
    // Demo mode → just splice from LS, no server hit. Anonymous
    // non-demo users shouldn't reach this code path because the
    // delete UI is gated by user presence in CollectionTab.
    if (!user) {
      if (isDemoActive()) {
        setCollection(c => {
          const next = c.filter(x => x.id !== id);
          saveLS(DEMO_KEYS.collection, next);
          return next;
        });
      }
      return;
    }
    await fetch(`/api/collection?id=${id}`, { method: 'DELETE' });
    setCollection(c => c.filter(x => x.id !== id));
    const port = await fetch('/api/portfolio').then(r => r.json());
    setPortfolio(port);
  }, [user]);

  // ── Watchlist ──────────────────────────────────────────────────
  const toggleWatch = useCallback(async (album) => {
    const albumId = album.id || album.album_id;
    const exists  = watchlist.some(w => (w.id || w.album_id) === albumId);

    if (user) {
      // Optimistic update first (instant UI feedback, even offline)
      if (exists) {
        setWatchlist(w => w.filter(x => (x.album_id || x.id) !== albumId));
      } else {
        const optimistic = { id: albumId, album_id: albumId, artist: album.artist, album: album.album, cover: album.cover, release_date: album.releaseDate };
        setWatchlist(w => [optimistic, ...w]);
      }
      // Then sync to server (silent fail if offline)
      try {
        if (exists) {
          await fetch(`/api/watchlist?album_id=${albumId}`, { method: 'DELETE' });
        } else {
          const r = await fetch('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ album_id: albumId, artist: album.artist, album: album.album, cover: album.cover, release_date: album.releaseDate, spotify_url: album.spotifyUrl }) });
          const d = await r.json();
          // Replace optimistic with real server item
          if (d.item) setWatchlist(w => w.map(x => (x.id === albumId || x.album_id === albumId) ? d.item : x));
        }
      } catch {
        // Offline — keep optimistic state, will sync on next open
      }
    } else {
      const updated = exists ? watchlist.filter(w => w.id !== albumId) : [...watchlist, { id: albumId, ...album }];
      setWatchlist(updated);
      // Persist to the demo key when in demo mode so reseed-on-logout
      // sees the user's edits, otherwise to the legacy anonymous
      // watchlist key.
      saveLS(isDemoActive() ? DEMO_KEYS.watchlist : LS_WL, updated);
    }
  }, [user, watchlist]);

  // ── Artist follows ─────────────────────────────────────────────
  const toggleFollow = useCallback(async (artistName) => {
    // Demo mode → toggle in LS so the Bands tab "follow" interactions
    // produce visible state changes for guests.
    if (!user) {
      if (!isDemoActive()) return;
      const exists = followedArtists.some(a => a.artist_name === artistName);
      const next = exists
        ? followedArtists.filter(a => a.artist_name !== artistName)
        : [{ artist_name: artistName }, ...followedArtists];
      setFollowedArtists(next);
      saveLS(DEMO_KEYS.followedArtists, next);
      return;
    }
    const exists = followedArtists.some(a => a.artist_name === artistName);
    if (exists) {
      await fetch(`/api/artists?artist_name=${encodeURIComponent(artistName)}`, { method: 'DELETE' });
      setFollowedArtists(a => a.filter(x => x.artist_name !== artistName));
    } else {
      const r = await fetch('/api/artists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist_name: artistName }) });
      const d = await r.json();
      if (d.artist) setFollowedArtists(a => [d.artist, ...a]);
    }
  }, [user, followedArtists]);

  return {
    // state
    collection,   setCollection,
    watchlist,    setWatchlist,
    followedArtists, setFollowedArtists,
    portfolio,    setPortfolio,
    collectionSummary, setCollectionSummary,
    vinylCache,   setVinylCache,
    vinylLoading, setVinylLoading,
    vinylError,   setVinylError,
    // actions
    loadUserData, resetUserData,
    fetchVinyl,
    addToCollection,
    batchImportCollection, batchImportWatchlist,
    removeFromCollection,
    toggleWatch,
    toggleFollow,
  };
}
