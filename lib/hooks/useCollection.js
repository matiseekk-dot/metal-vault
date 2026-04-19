// ── useCollection — all collection/watchlist/vinyl/follow state ──
// Provides the `col` object used by app/page.js.
// Naming matches the refactored page.js (loadUserData, resetUserData,
// fetchVinyl, vinylCache, vinylLoading, vinylError, setVinylError).

'use client';
import { useState, useCallback } from 'react';

const LS_WL = 'mv_watchlist_v2';
const LS_VC = 'mv_vinyl_cache_v2';
function loadLS(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function saveLS(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

export function useCollection(user) {
  // ── Collection / watchlist / follows ──────────────────────────
  const [collection,        setCollection]        = useState([]);
  const [watchlist,         setWatchlist]         = useState([]);
  const [followedArtists,   setFollowedArtists]   = useState([]);
  const [portfolio,         setPortfolio]         = useState(null);
  const [collectionSummary, setCollectionSummary] = useState(null);

  // ── Vinyl (Discogs) cache ──────────────────────────────────────
  const [vinylCache,   setVinylCache]   = useState(() => loadLS(LS_VC, {}));
  const [vinylLoading, setVinylLoading] = useState(false);
  const [vinylError,   setVinylError]   = useState('');

  // ── Server loaders ─────────────────────────────────────────────
  const loadUserData = useCallback(async (_user) => {
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
    } catch (e) { console.error('useCollection.loadUserData', e); }
  }, []);

  const resetUserData = useCallback(() => {
    setCollection([]);
    setFollowedArtists([]);
    setPortfolio(null);
    setCollectionSummary(null);
    setWatchlist(loadLS(LS_WL, []));
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
    if (!user) { alert('Sign in to manage your collection'); return; }
    const r = await fetch('/api/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
    const d = await r.json();
    if (d.error) {
      if (d.error === 'ALERT_LIMIT_REACHED') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('mv:upgrade', { detail: { reason: 'ALERT_LIMIT_REACHED' } }));
        }
        return;
      }
      console.error('addToCollection error:', d.error);
      alert('Failed to add: ' + d.error);
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
    await fetch(`/api/collection?id=${id}`, { method: 'DELETE' });
    setCollection(c => c.filter(x => x.id !== id));
    const port = await fetch('/api/portfolio').then(r => r.json());
    setPortfolio(port);
  }, []);

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
      saveLS(LS_WL, updated);
    }
  }, [user, watchlist]);

  // ── Artist follows ─────────────────────────────────────────────
  const toggleFollow = useCallback(async (artistName) => {
    if (!user) return;
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
