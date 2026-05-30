'use client';
// ── ListeningTab — Vault sub-tab "Scrobbling" ────────────────────
//
// Unified view of everything you've listened to:
//   • Vinyl spins (manual ListenButton presses)
//   • Spotify per-track scrobbles (matched to collection)
//   • Last.fm aggregated top-album rows (one row = N plays)
//
// Layout:
//   [filter chips: ALL · VINYL · DIGITAL]
//   [Discovery card on top — "Brak na winylu, może kup"]
//   [Feed of activity items]
//
// Key UX decision: each row's "do you own this?" status is computed
// server-side at sync time (matched_collection_id link in streaming_history,
// and listen_logs always has a collection_item_id since it's FK-bound).
// So the UI just renders the badge — no per-row verification fetch.
//
// "Verification" prompt = the Discovery card's whole reason for being:
// streamed albums NOT in collection get surfaced for one-tap wishlist add.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';
import { toast } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';
import { track } from '@/lib/analytics';
import StreamingDiscoveries from '@/app/components/StreamingDiscoveries';
import ListenStats from '@/app/components/ListenStats';
import Recommendations from '@/app/components/Recommendations';
import { VINYL_SHOPS } from '@/lib/vinyl-shops';

const FILTERS = [
  { id: 'all',       i18n: 'listening.filter.all'       },
  { id: 'vinyl',     i18n: 'listening.filter.vinyl'     },
  { id: 'streaming', i18n: 'listening.filter.streaming' },
];

// Time-range chips. Last.fm aggregates have synthetic timestamps so a
// non-"all" range hides them — the API filters them out automatically.
// 'all' is the default since most users want lifetime totals on first
// visit (matches what ListenStats / heatmap already show).
const RANGES = [
  { id: 'all',  i18n: 'listening.range.all',  label: 'Wszystko' },
  { id: '30d',  i18n: 'listening.range.30d',  label: '30 dni'   },
  { id: '90d',  i18n: 'listening.range.90d',  label: '90 dni'   },
  { id: '365d', i18n: 'listening.range.365d', label: 'Rok'      },
];

const KIND_BADGE = {
  vinyl:   { label: 'VINYL',    color: '#dc2626', icon: '💿' },
  spotify: { label: 'SPOTIFY',  color: '#1db954', icon: '🟢' },
  lastfm:  { label: 'LAST.FM',  color: '#d51007', icon: '📻' },
};

function FormatPlayedAt({ iso, kind, count }) {
  // All sources now aggregated per album. When count > 1 the play count
  // is the primary signal ("47 plays"). For count === 1 we fall through
  // to the timestamp display so the row still tells you WHEN you last
  // engaged — useful for one-time vinyl spins or freshly-scrobbled albums.
  // Last.fm always shows count even at 1 because its timestamp is
  // synthetic (sync time, not real play time).
  if (kind === 'lastfm' || count > 1) {
    return <span>{count} {count === 1 ? 'play' : 'plays'}</span>;
  }
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  // Relative-ish: today, yesterday, then date.
  const now      = new Date();
  const sameDay  = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYest   = d.toDateString() === yesterday.toDateString();
  if (sameDay) return <span>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
  if (isYest)  return <span>yesterday</span>;
  return <span>{d.toLocaleDateString()}</span>;
}

export default function ListeningTab({ user, onAlbumClick, premium = false }) {
  const t = useT();
  const [filter, setFilter] = useState('all');
  const [range,  setRange]  = useState('all');
  const [items,  setItems]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);

  const [totals, setTotals] = useState({ items: 0, lastfm: 0, spotify: 0, vinyl: 0 });
  // Lookup caches keyed on artist::album. Discogs gives canonical cover
  // + a marketplace floor; eBay gives an independent live-listings price
  // (often very different — auctions vs collector pressings). Both run
  // in parallel and the UI shows whichever resolved.
  const [lookups,     setLookups]     = useState({});   // Discogs
  const [ebayLookups, setEbayLookups] = useState({});   // eBay
  // Set of artist names the user follows. Powers the +Follow / ✓Following
  // toggle on each row — followed artists feed cron/releases, daily-digest
  // push, concerts, and recommendations. So even for artists you don't
  // OWN on vinyl yet (just stream), follow makes sure you find out when
  // they drop something pressable.
  const [followed, setFollowed] = useState(new Set());

  const refresh = (currentFilter = filter, currentRange = range) => {
    setLoading(true);
    fetch('/api/listening/feed?limit=2000&source=' + currentFilter + '&since=' + currentRange)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const list = d?.items || [];
        setItems(list);
        setTotals({
          items:   list.length,
          lastfm:  list.filter(x => x.kind === 'lastfm').length,
          spotify: list.filter(x => x.kind === 'spotify').length,
          vinyl:   list.filter(x => x.kind === 'vinyl').length,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  // ── Background shop resolve for unmatched rows ────────────────
  // Items NOT in collection have no cover (Last.fm killed image URLs
  // in 2019) or price. Hit Discogs + eBay in PARALLEL, batches of 12,
  // 1.5s spacing per batch. Both endpoints cache server-side (7d TTL)
  // so subsequent loads are instant.
  //
  // Each shop runs as its own background loop — if eBay isn't
  // configured (503), Discogs still fills covers. If both fail the UI
  // gracefully shows just the search chips for iMusic / Groovespin.
  useEffect(() => {
    if (!items.length) return;

    const fillFrom = async (endpoint, setMap, currentMap) => {
      const targets = items.filter(it =>
        !it.in_collection &&
        it.kind !== 'vinyl' &&
        !currentMap[(it.artist + '::' + it.album).toLowerCase()]
      );
      if (targets.length === 0) return;

      for (let i = 0; i < targets.length; i += 12) {
        const slice = targets.slice(i, i + 12).map(t => ({ artist: t.artist, album: t.album }));
        let r;
        try {
          r = await fetch(endpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ items: slice }),
          });
        } catch { return; }
        if (!r.ok) return;   // 503 (shop not configured) — stop, don't retry
        let d;
        try { d = await r.json(); } catch { return; }
        setMap(prev => {
          const next = { ...prev };
          for (const res of (d.results || [])) {
            const k = (res.artist + '::' + res.album).toLowerCase();
            next[k] = res;
          }
          return next;
        });
        if (i + 12 < targets.length) await new Promise(r => setTimeout(r, 1500));
      }
    };

    let cancelled = false;
    const guard = (fn) => fn().catch(() => {}).finally(() => {});

    // Run both shops in parallel — they don't share rate limits and
    // the user wants both prices ASAP.
    Promise.all([
      guard(() => fillFrom('/api/discogs/album-lookup', setLookups,     lookups)),
      guard(() => fillFrom('/api/listings/ebay',        setEbayLookups, ebayLookups)),
    ]).catch(() => {});

    return () => { cancelled = true; };   // eslint-disable-line
  }, [items]);   // eslint-disable-line

  useEffect(() => {
    refresh();
    // Hydrate the followed-artists set so per-row toggles render correct
    // state on first paint instead of flashing "+Follow" → "✓Following".
    fetch('/api/artists').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.artists) setFollowed(new Set(d.artists.map(a => a.artist_name)));
    }).catch(() => {});
    if (typeof window === 'undefined') return;
    const handler = () => refresh();
    window.addEventListener('mv-streaming-changed', handler);
    window.addEventListener('mv-watchlist-changed', handler);
    return () => {
      window.removeEventListener('mv-streaming-changed', handler);
      window.removeEventListener('mv-watchlist-changed', handler);
    };
  }, []);  // eslint-disable-line

  const switchRange = (id) => {
    setRange(id);
    refresh(filter, id);
  };

  const switchFilter = (id) => {
    setFilter(id);
    refresh(id, range);
  };

  const toggleFollow = async (artistName) => {
    if (!artistName) return;
    const isFollowing = followed.has(artistName);
    // Optimistic UI — flip the set immediately so the user feels the tap
    // even on a slow network. If the network call fails we'll revert.
    setFollowed(prev => {
      const next = new Set(prev);
      if (isFollowing) next.delete(artistName);
      else             next.add(artistName);
      return next;
    });
    try {
      let r;
      if (isFollowing) {
        r = await fetch('/api/artists?artist_name=' + encodeURIComponent(artistName), { method: 'DELETE' });
      } else {
        r = await fetch('/api/artists', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ artist_name: artistName }),
        });
      }
      if (!r.ok) throw new Error('http_' + r.status);
      if (!isFollowing) {
        haptic.success();
        track('listening_action', { action: 'follow_artist' });
        // Confirmation toast tells the user where the change shows up.
        // Without this they wonder "did anything happen" because the
        // chip flip is subtle.
        toast.success(
          (t('listening.toast.followed', { name: artistName })
            || ('Obserwujesz ' + artistName + ' — Vault → Zespoły'))
        );
      } else {
        toast(t('listening.toast.unfollowed', { name: artistName })
          || ('Przestałeś obserwować ' + artistName));
      }
      // Notify the global useCollection hook so BandsTab and any other
      // consumer of followedArtists refetches and re-renders. Without
      // this the user would tap follow here and not see the band appear
      // in Bands tab until a full page reload.
      window.dispatchEvent(new CustomEvent('mv-artists-changed'));
    } catch (e) {
      // Network failed — revert the optimistic flip and surface the error.
      setFollowed(prev => {
        const next = new Set(prev);
        if (isFollowing) next.add(artistName);
        else             next.delete(artistName);
        return next;
      });
      toast.error(t('listening.toast.followFailed') || 'Nie udało się — spróbuj ponownie');
    }
  };

  const wishlist = async (it, key) => {
    setBusyKey(key);
    try {
      const slug = (it.artist + '::' + it.album).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      // Carry the cover we already resolved from Discogs / eBay into the
      // watchlist row. Otherwise Watchlist renders a coverless placeholder
      // and the user has to wait for its own lazy resolver to fill in.
      const lookupKey   = (it.artist + '::' + it.album).toLowerCase();
      const resolvedCov = it.cover
        || lookups[lookupKey]?.cover
        || ebayLookups[lookupKey]?.image
        || null;
      const resolvedDgId = lookups[lookupKey]?.releaseId || null;
      const r = await fetch('/api/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          album_id:   slug,
          artist:     it.artist,
          album:      it.album,
          cover:      resolvedCov,
          discogs_id: resolvedDgId,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Watchlist failed');
      haptic.success();
      track('listening_action', { action: 'wishlist', kind: it.kind });
      toast.success(t('listening.toast.wishlisted') || 'Added to watchlist ✓');
      // Mark in-place — visual feedback while feed refreshes.
      setItems(prev => prev.map(x =>
        x.artist === it.artist && x.album === it.album
          ? { ...x, watched: true } : x
      ));
      window.dispatchEvent(new CustomEvent('mv-watchlist-changed'));
    } catch (e) {
      toast.error(e.message);
    }
    setBusyKey(null);
  };

  return (
    <div style={{ padding: '12px 16px' }}>
      {/* Filter chips. touch-action: pan-x lets Android Chromium know
          this element handles only horizontal pan — vertical drags
          bubble up to the page scroller. Without this, swiping down
          on the chips on Android does nothing (scroll-chaining quirk
          that iOS Safari handles automatically). */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', touchAction: 'pan-x' }}>
        {FILTERS.map(f => {
          const active = filter === f.id;
          return (
            <button key={f.id} onClick={() => switchFilter(f.id)}
              style={{
                padding: '6px 14px', borderRadius: 18,
                background: active ? C.accent + '22' : C.bg2,
                color:      active ? C.accent : C.muted,
                border:     '1px solid ' + (active ? C.accent + '88' : C.border),
                cursor:     'pointer', fontSize: 11, ...MONO,
                whiteSpace: 'nowrap',
                minHeight: 36,
                flexShrink: 0,
              }}>
              {t(f.i18n) || f.id}
            </button>
          );
        })}
      </div>

      {/* Time-range chips — Wszystko / 30d / 90d / Rok. Scopes the feed
          to a window of recent listening activity. Last.fm aggregates
          drop out of any non-"all" range because their played_at is
          synthetic (sync time). */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto',
        touchAction: 'pan-x' }}>
        {RANGES.map(r => {
          const active = range === r.id;
          return (
            <button key={r.id} onClick={() => switchRange(r.id)}
              style={{
                padding: '5px 12px', borderRadius: 14,
                background: active ? C.bg3 : 'transparent',
                color:      active ? C.text : C.dim,
                border:     '1px solid ' + (active ? C.border : 'transparent'),
                cursor:     'pointer', fontSize: 10, ...MONO,
                whiteSpace: 'nowrap',
                minHeight: 32,
                flexShrink: 0,
                letterSpacing: '0.04em',
              }}>
              {t(r.i18n) || r.label}
            </button>
          );
        })}
      </div>

      {/* Counter strip — diagnostic + at-a-glance summary. If it shows
          0 / 0 / 0 the user knows their sync didn't land anything. */}
      {!loading && totals.items > 0 && (
        <div style={{
          display: 'flex', gap: 10, marginBottom: 10, padding: '6px 10px',
          background: C.bg2, border: '1px solid ' + C.border, borderRadius: 8,
          fontSize: 10, color: C.dim, ...MONO, letterSpacing: '0.04em',
          flexWrap: 'wrap',
        }}>
          <span><strong style={{ color: C.text }}>{totals.items}</strong> {t('listening.totals.items') || 'total'}</span>
          {totals.lastfm  > 0 && <span>· <strong style={{ color: '#d51007' }}>{totals.lastfm}</strong> Last.fm</span>}
          {totals.spotify > 0 && <span>· <strong style={{ color: '#1db954' }}>{totals.spotify}</strong> Spotify</span>}
          {totals.vinyl   > 0 && <span>· <strong style={{ color: '#dc2626' }}>{totals.vinyl}</strong> Vinyl</span>}
        </div>
      )}

      {/* Vinyl-spin analytics — streak, heatmap, top played, dust.
          Hides itself when there are no plays AND no collection, so
          first-time users don't see an empty stats block. Gated to
          'all' / 'vinyl' filters because the data is vinyl-only —
          showing it under "Cyfrowo" would be misleading. */}
      {(filter === 'all' || filter === 'vinyl') && (
        <ListenStats/>
      )}

      {/* Discovery card — "Brak na winylu, może kup". Streaming-side
          counterpart to the vinyl analytics above. */}
      {(filter === 'all' || filter === 'streaming') && (
        <StreamingDiscoveries/>
      )}

      {/* "You might also like X" — collaborative-filter recs from Last.fm,
          aggregated across the user's top 5 most-engaged artists. Only
          shows when there's enough listening data to seed it (the API
          self-empty-states). Available across all and streaming views;
          hidden under vinyl-only since recs are about expanding listening
          horizon, which is more streaming-shaped behaviour.
          Free tier sees 3 recs + "Pro for full list"; Pro sees all 12. */}
      {(filter === 'all' || filter === 'streaming') && (
        <Recommendations premium={premium}/>
      )}

      {/* Feed */}
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: C.dim, ...MONO, fontSize: 11 }}>
          ⟳ {t('common.loading') || 'Loading…'}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: C.dim, ...MONO, fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📻</div>
          <div style={{ marginBottom: 8 }}>
            {t('listening.empty.title') || 'No listening activity yet'}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>
            {t('listening.empty.desc') || 'Connect Spotify or Last.fm in Profile, or tap ▶ on a vinyl record.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((it, i) => {
            const key   = (it.collection_id || (it.artist + '::' + it.album)) + '::' + (it.played_at || '') + '::' + i;
            const badge = KIND_BADGE[it.kind] || KIND_BADGE.vinyl;
            const busy  = busyKey === key;
            const lookupKey = (it.artist + '::' + it.album).toLowerCase();
            const lookup     = !it.in_collection ? lookups[lookupKey]     : null;
            const ebayLookup = !it.in_collection ? ebayLookups[lookupKey] : null;
            // Effective cover: collection cover first (most reliable),
            // then Discogs lookup result, finally eBay's listing image.
            const effectiveCover = it.cover || lookup?.cover || ebayLookup?.image || null;
            const hasDiscogsPrice = lookup     && !lookup.notFound     && lookup.lowestPrice     != null;
            const hasEbayPrice    = ebayLookup && !ebayLookup.notFound && ebayLookup.lowestPrice != null;
            // Cross-source price comparison — when BOTH sources resolved
            // a number, mark whichever is lower. Drives the "💚 NAJTAŃSZE"
            // badge in the render so the user can see at a glance where
            // to buy. Tie → no badge (no meaningful winner).
            // Note: currencies might differ in edge cases (Discogs USD vs
            // eBay regional). We compare raw values — fine in practice
            // because both default to USD; future improvement: convert
            // via lib/currency before compare.
            const bothResolved     = hasDiscogsPrice && hasEbayPrice;
            const discogsIsCheaper = bothResolved && lookup.lowestPrice     <  ebayLookup.lowestPrice;
            const ebayIsCheaper    = bothResolved && ebayLookup.lowestPrice <  lookup.lowestPrice;
            const clickable = !!it.collection_id;
            return (
              <div key={key}
                onClick={clickable ? () => onAlbumClick?.({
                  ...it,
                  id: it.collection_id,
                  discogs_id: undefined,   // no discogs id here, modal will fetch
                }) : undefined}
                style={{
                  background:    it.in_collection ? '#0a1a0a' : C.bg2,
                  border:        '1px solid ' + (it.in_collection ? '#1a3d1a' : C.border),
                  borderRadius:  8, padding: '10px 12px',
                  display:       'flex', alignItems: 'center', gap: 10,
                  cursor:        clickable ? 'pointer' : 'default',
                }}>
                {/* Cover thumb — collection cover OR Discogs lookup */}
                {effectiveCover ? (
                  <img src={effectiveCover} alt={it.artist}
                    style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover',
                      flexShrink: 0, border: '1px solid ' + C.border }}
                    onError={e => { e.currentTarget.style.display = 'none'; }}/>
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 4, flexShrink: 0,
                    background: C.bg3, border: '1px solid ' + C.border,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, color: C.dim }}>
                    {badge.icon}
                  </div>
                )}

                {/* Text block */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...BEBAS, fontSize: 14, color: C.text, letterSpacing: '0.04em',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.1 }}>
                    {it.artist}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, ...MONO,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {it.album}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 8, color: badge.color, ...MONO,
                      background: badge.color + '22', padding: '1px 5px', borderRadius: 3,
                      border: '1px solid ' + badge.color + '44', letterSpacing: '0.05em',
                    }}>{badge.label}</span>
                    {/* Vinyl: show timestamp ("yesterday", "14:23"). Streaming
                        aggregates: skip the timestamp here — the play_count
                        on the right edge IS the primary metric, and Last.fm's
                        played_at is synthetic anyway. */}
                    {it.kind === 'vinyl' && (
                      <span style={{ fontSize: 9, color: C.dim, ...MONO }}>
                        <FormatPlayedAt iso={it.played_at} kind={it.kind} count={it.play_count}/>
                      </span>
                    )}
                    {it.in_collection && (
                      <span style={{ fontSize: 8, color: '#4ade80', ...MONO,
                        background: '#1a3d1a', padding: '1px 5px', borderRadius: 3,
                        border: '1px solid #4ade8044', letterSpacing: '0.05em' }}>
                        ✓ {t('listening.badge.owned') || 'OWNED'}
                      </span>
                    )}
                    {/* Follow-band toggle. Available on every row regardless
                        of collection / kind — even an album you OWN may
                        belong to a band you don't yet follow (and miss
                        repress / release alerts for). */}
                    <button onClick={e => { e.stopPropagation(); toggleFollow(it.artist); }}
                      style={{
                        fontSize: 8, ...MONO, padding: '1px 6px', borderRadius: 3,
                        letterSpacing: '0.05em', cursor: 'pointer',
                        background:  followed.has(it.artist) ? '#1a1a3d' : 'transparent',
                        color:       followed.has(it.artist) ? '#a5b4fc' : C.dim,
                        border: '1px solid ' + (followed.has(it.artist) ? '#a5b4fc44' : C.border),
                      }}>
                      {followed.has(it.artist)
                        ? '★ ' + (t('listening.badge.following') || 'FOLLOWING')
                        : '+ ' + (t('listening.badge.follow')    || 'FOLLOW')}
                    </button>
                  </div>
                </div>

                {/* Right column — stack: play count (prominent), then action */}
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                  gap: 6, flexShrink: 0,
                }}>
                  {/* Big play count for all per-album aggregates — the
                      "what's best" signal. Vinyl thresholds are tighter
                      than streaming (10 vinyl spins is genuinely heavy
                      rotation, vs 10 scrobbles which is one casual
                      listen-through). */}
                  {(() => {
                    // When the 30d range chip is active, prefer
                    // recent_play_count (plays inside the window)
                    // over the lifetime play_count. The window-
                    // specific number is the actual "what I listened
                    // to lately" signal — lifetime is misleading
                    // ("591× plays this month" on an album the user
                    // touched twice). Other ranges (90d/365d/all)
                    // keep showing lifetime because the LFM sync
                    // only computes recent_play_count for the 30-day
                    // window; for wider windows lifetime is still
                    // the most useful number on display.
                    const useRecent = range === '30d'
                      && (it.kind === 'lastfm' || it.kind === 'streaming')
                      && typeof it.recent_play_count === 'number';
                    const displayCount = useRecent
                      ? it.recent_play_count
                      : (it.play_count || 0);
                    if (displayCount <= 0) return null;

                    return (
                      <span
                        title={useRecent
                          ? `${displayCount} plays in the last 30 days · ${it.play_count} lifetime`
                          : (it.kind === 'lastfm' || it.kind === 'streaming'
                              ? `${displayCount} lifetime scrobbles`
                              : `${displayCount} vinyl spins logged`)}
                        style={{
                          ...BEBAS,
                          fontSize:    (it.kind === 'vinyl'
                                           ? (displayCount >= 10 ? 24 : displayCount >= 3 ? 20 : 16)
                                           : (displayCount >= 50 ? 24 : displayCount >= 10 ? 20 : 16)),
                          color:       (it.kind === 'vinyl'
                                           ? (displayCount >= 10 ? '#f97316' : displayCount >= 3 ? C.accent : C.muted)
                                           : (displayCount >= 50 ? '#f97316' : displayCount >= 10 ? C.accent : C.muted)),
                          lineHeight:  1,
                          letterSpacing: '0.02em',
                          cursor: 'help',
                      }}>
                        {displayCount}×
                      </span>
                    );
                  })()}

                  {/* "Where to buy" row — only for unowned streaming rows.
                      Two visual tiers:
                        • Priced pills (orange Discogs, blue eBay) when
                          we resolved a real marketplace number.
                        • Tiny abbr chips for shops without API (iMusic,
                          Groovespin) that deep-search the shop's site.
                      stopPropagation on each click so the chip doesn't
                      also fire the row's onClick. */}
                  {!it.in_collection && it.kind !== 'vinyl' && (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
                      justifyContent: 'flex-end', maxWidth: 180 }}>
                      {hasDiscogsPrice && (
                        <a href={lookup.discogsUrl} target="_blank" rel="noopener noreferrer"
                          onClick={e => { e.stopPropagation(); track('listening_action', { action: 'price_click', shop: 'discogs' }); }}
                          style={{
                            ...MONO, fontSize: 11, fontWeight: 600,
                            color: '#f97316', textDecoration: 'none',
                            background: '#3a1a06',
                            // Brighter border + extra glow on the winning
                            // price so the eye snaps to it. Loser dims a
                            // notch so the comparison reads cleanly.
                            border: '1px solid ' + (discogsIsCheaper ? '#4ade80' : '#f9731644'),
                            boxShadow: discogsIsCheaper ? '0 0 0 1px #4ade8044' : 'none',
                            opacity: ebayIsCheaper ? 0.55 : 1,
                            padding: '3px 7px', borderRadius: 6,
                            whiteSpace: 'nowrap',
                          }}>
                          {discogsIsCheaper && '💚 '}
                          DG {(t('listening.priceFrom') || 'od') + ' '}
                          {Number(lookup.lowestPrice).toFixed(0)} {lookup.currency || 'USD'}
                        </a>
                      )}
                      {hasEbayPrice && (
                        <a href={ebayLookup.itemUrl} target="_blank" rel="noopener noreferrer"
                          onClick={e => { e.stopPropagation(); track('listening_action', { action: 'price_click', shop: 'ebay' }); }}
                          style={{
                            ...MONO, fontSize: 11, fontWeight: 600,
                            color: '#60a5fa', textDecoration: 'none',
                            background: '#0a1830',
                            border: '1px solid ' + (ebayIsCheaper ? '#4ade80' : '#60a5fa44'),
                            boxShadow: ebayIsCheaper ? '0 0 0 1px #4ade8044' : 'none',
                            opacity: discogsIsCheaper ? 0.55 : 1,
                            padding: '3px 7px', borderRadius: 6,
                            whiteSpace: 'nowrap',
                          }}>
                          {ebayIsCheaper && '💚 '}
                          eBay {(t('listening.priceFrom') || 'od') + ' '}
                          {Number(ebayLookup.lowestPrice).toFixed(0)} {ebayLookup.currency || 'USD'}
                        </a>
                      )}
                      {/* Search-only shop chips. Skip Discogs here when
                          we already rendered the priced Discogs pill. */}
                      {VINYL_SHOPS
                        .filter(s => !(s.id === 'discogs' && hasDiscogsPrice))
                        .map(shop => (
                          <a key={shop.id}
                            href={shop.searchUrl(it.artist, it.album)}
                            target="_blank" rel="noopener noreferrer"
                            onClick={e => { e.stopPropagation(); track('listening_action', { action: 'shop_click', shop: shop.id }); }}
                            title={shop.name + ' — ' + (t('listening.searchAt') || 'search')}
                            style={{
                              ...MONO, fontSize: 9, fontWeight: 700,
                              color: shop.color, background: shop.bg,
                              padding: '3px 6px', borderRadius: 4,
                              textDecoration: 'none',
                              letterSpacing: '0.04em',
                              minWidth: 22, textAlign: 'center',
                            }}>
                            {shop.abbr}
                          </a>
                        ))}
                    </div>
                  )}

                  {/* Wishlist if NOT owned + streaming source */}
                  {!it.in_collection && it.kind !== 'vinyl' && !it.watched && (
                    <button onClick={e => { e.stopPropagation(); wishlist(it, key); }}
                      disabled={busy}
                      aria-label={t('listening.action.wishlist') || 'Add to watchlist'}
                      style={{
                        background: '#1a3d1a',
                        border: '1px solid #4ade80',
                        borderRadius: 8, color: '#4ade80',
                        cursor: busy ? 'wait' : 'pointer',
                        fontSize: 11, ...MONO, fontWeight: 600,
                        padding: '6px 10px',
                        minHeight: 36, minWidth: 36,
                        opacity: busy ? 0.5 : 1,
                      }}>
                      ☆+
                    </button>
                  )}
                  {!it.in_collection && it.watched && (
                    <span style={{ fontSize: 10, color: '#f5c842', ...MONO }}>
                      ★ {t('listening.badge.watched') || 'WATCHED'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
