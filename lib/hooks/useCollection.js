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
import { useState, useCallback } from 'react';
import { t } from '@/lib/i18n';
import {
  DEMO_COLLECTION,
  DEMO_WATCHLIST,
  DEMO_FOLLOWED_ARTISTS,
  DEMO_KEYS,
} from '@/lib/demo-data';

const LS_WL = 'mv_watchlist_v2';
const LS_VC = 'mv_vinyl_cache_v2';
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
  const initial = (() => {
    if (typeof window === 'undefined') return { col: [], wl: [], fa: [] };
    if (!isDemoActive()) return { col: [], wl: [], fa: [] };
    seedDemoIfNeeded();
    return {
      col: loadLS(DEMO_KEYS.collection,      []),
      wl:  loadLS(DEMO_KEYS.watchlist,       []),
      fa:  loadLS(DEMO_KEYS.followedArtists, []),
    };
  })();
  const [collection,        setCollection]        = useState(initial.col);
  const [watchlist,         setWatchlist]         = useState(initial.wl);
  const [followedArtists,   setFollowedArtists]   = useState(initial.fa);
  const [portfolio,         setPortfolio]         = useState(null);
  const [collectionSummary, setCollectionSummary] = useState(null);

  // ── Vinyl (Discogs) cache ──────────────────────────────────────
  const [vinylCache,   setVinylCache]   = useState(() => loadLS(LS_VC, {}));
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
    if (vinylCache[key]) return;
    setVinylLoading(true); setVinylError('');
    try {
      const params = new URLSearchParams({ artist: album.artist, album: album.album });
      const r = await fetch(`/api/discogs?${params}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Discogs error');
      const updated = { ...vinylCache, [key]: d };
      setVinylCache(updated);
      saveLS(LS_VC, updated);
    } catch (e) { setVinylError(e.message); }
    setVinylLoading(false);
  }, [vinylCache]);

  // ── Collection CRUD ────────────────────────────────────────────
  const addToCollection = useCallback(async (item, onSuccess) => {
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
        onSuccess?.();
        return;
      }
      const { toast } = await import('@/app/components/Toast');
      toast.error(t('auth.signInToManage'));
      return;
    }
    const r = await fetch('/api/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
    const d = await r.json();
    if (d.error) {
      if (d.error === 'ALERT_LIMIT_REACHED') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('mv:upgrade', { detail: { reason: 'ALERT_LIMIT_REACHED' } }));
        }
        return;
      }
      const { logError } = await import('@/lib/log');
      logError('addToCollection error', d.error);
      const { toast } = await import('@/app/components/Toast');
      toast.error('Failed to add: ' + d.error);
      return;
    }
    if (d.item) {
      setCollection(c => [d.item, ...c]);
      const [port, coll] = await Promise.all([
        fetch('/api/portfolio').then(r => r.json()),
        fetch('/api/collection').then(r => r.json()),
      ]);
      setPortfolio(port);
      if (coll.items)   setCollection(coll.items);
      if (coll.summary) setCollectionSummary(coll.summary);
      onSuccess?.();
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
