// ── CollectionTab ────────────────────────────────────────────────
// Extracted from app/page.js — contains:
//   CollectionTab (main), WatchlistTab, PortfolioChart
// Shared UI primitives (AlbumCover, Badge) stay in page.js because
// the feed also uses them; pass them in as props or import separately.

'use client';
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { C, MONO, BEBAS, VINYL_GRADES, GRADE_COLOR, inputSt } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';
import Sparkline from '@/app/components/Sparkline';
import { rarityFromCount } from '@/lib/rarity';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { toast, confirm as mvConfirm } from '@/app/components/Toast';
import WishlistsManager from '@/app/components/WishlistsManager';
import ListenButton from '@/app/components/ListenButton';
import { useCurrency, useFx, formatPrice, formatChange } from '@/lib/currency';
import ManualAddForm from '@/app/collection/ManualAddForm';
import PriceModal from '@/app/collection/PriceModal';
import { trackAlertCreated } from '@/lib/analytics';
import { haptic } from '@/lib/haptics';
// (Previously had a dynamic-import for BandsTab here — dead code, never
// referenced inside this file, and BandsTab is also statically imported
// by VaultTab.js. Mixing static + dynamic imports of the same module
// across the parent/child tree creates a webpack tree-shake collision
// that surfaces at runtime as ReferenceError; same root cause as the
// page.js revert. Removed.)

// ── PortfolioChart ────────────────────────────────────────────────
function PortfolioChart({ snapshots }) {
  const t = useT();
  // Mount-then-render guard. The SVG below has inline-style
  // `repeating-linear-gradient` which React serialises differently on
  // the server vs the client in some bundler configurations — caused a
  // hydration mismatch (React #418) on production builds. Deferring
  // chart paint until after first mount sidesteps it entirely while
  // costing one extra render frame the user will never notice.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) {
    return (
      <div style={{ height: 110, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: C.dim, ...MONO, fontSize: 10 }}>
        …
      </div>
    );
  }
  if (!snapshots || snapshots.length < 2) return (
    <div style={{ textAlign: 'center', padding: '30px 0', color: C.dim, ...MONO, fontSize: 11 }}>
      No historical data — add records to your collection
    </div>
  );

  // Dedupe consecutive snapshots that share both total_value AND
  // total_paid — otherwise the chart shows a long flat plateau when the
  // user hasn't added/sold records or refreshed prices for weeks. Keep
  // the FIRST and LAST snapshot always so the time-range stays correct.
  const condensed = snapshots.filter((s, i) => {
    if (i === 0 || i === snapshots.length - 1) return true;
    const prev = snapshots[i - 1];
    return Number(s.total_value) !== Number(prev.total_value)
        || Number(s.total_paid)  !== Number(prev.total_paid);
  });

  // Two series: total_value (current market value of the whole
  // collection, accent red) and total_paid (cumulative spending, gold).
  // Paid is usually the more interesting line because it grows
  // monotonically with every purchase the user logs — value is mostly
  // flat in the short term since Discogs prices don't tick every day.
  // Showing both gives the user a "spent vs worth now" delta at a glance.
  const valueSeries = condensed.map(s => Number(s.total_value) || 0);
  const paidSeries  = condensed.map(s => Number(s.total_paid)  || 0);
  const maxV = Math.max(...valueSeries, ...paidSeries, 1);
  const range = maxV || 1;
  const W = 300, H = 110, PL = 40, PR = 8, PT = 8, PB = 24;

  const buildPts = (series) => condensed.map((_, i) => {
    const x = PL + (i / Math.max(1, condensed.length - 1)) * (W - PL - PR);
    const v = Number(series[i]) || 0;
    const y = PT + ((maxV - v) / range) * (H - PT - PB);
    return [x, y, v];
  });
  const valuePts = buildPts(valueSeries);
  const paidPts  = buildPts(paidSeries);
  const valueStr = valuePts.map(([x, y]) => `${x},${y}`).join(' ');
  const paidStr  = paidPts .map(([x, y]) => `${x},${y}`).join(' ');
  const area = `${PL},${H - PB} ${valueStr} ${W - PR},${H - PB}`;

  // Endpoint labels — read the latest values so the user immediately sees
  // total spent vs total market value without doing the math in their head.
  const lastValue = valueSeries[valueSeries.length - 1] || 0;
  const lastPaid  = paidSeries [paidSeries.length  - 1] || 0;
  const gain      = lastValue - lastPaid;
  const gainPct   = lastPaid > 0 ? (gain / lastPaid) * 100 : 0;
  const gainColor = gain >= 0 ? '#4ade80' : '#f87171';

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        <defs>
          <linearGradient id="cg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor={C.accent} stopOpacity="0.25" />
            <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map(pct => {
          const y = PT + pct * (H - PT - PB);
          const val = maxV - pct * range;
          return (
            <g key={pct}>
              <line x1={PL} x2={W - PR} y1={y} y2={y} stroke={C.border} strokeWidth="1" />
              <text x={PL - 3} y={y + 3} textAnchor="end" fontSize="7" fill={C.dim}>{val.toFixed(0)}</text>
            </g>
          );
        })}
        {/* Value area + line (red accent) */}
        <polygon points={area} fill="url(#cg)" />
        <polyline points={valueStr} fill="none" stroke={C.accent} strokeWidth="1.6" />
        {/* Paid line (gold, dashed) — distinct stroke so colour-blind
            readers can still tell them apart by the dash pattern. */}
        <polyline points={paidStr} fill="none" stroke="#f5c842"
          strokeWidth="1.4" strokeDasharray="3,2" />
        {/* Datapoint dots only on the last snapshot so the chart doesn't
            look like measles. End-of-line markers anchor the eye to the
            current position. */}
        {(() => {
          const lastIdx = condensed.length - 1;
          return (
            <g>
              <circle cx={valuePts[lastIdx][0]} cy={valuePts[lastIdx][1]} r="3" fill={C.accent} />
              <circle cx={paidPts [lastIdx][0]} cy={paidPts [lastIdx][1]} r="3" fill="#f5c842" />
            </g>
          );
        })()}
      </svg>
      {/* Legend + endpoint readout: shows the latest paid vs value so
          the user has the "spent / worth / delta" trio in one glance.
          Compact mono grid keeps it visually consistent with the rest
          of the stats card. */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginTop: 4, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 12, ...MONO, fontSize: 9 }}>
          <span style={{ color: C.accent }}>
            <span style={{ display: 'inline-block', width: 10, height: 2,
              background: C.accent, verticalAlign: 'middle', marginRight: 4 }}/>
            rynek {lastValue.toFixed(0)}
          </span>
          <span style={{ color: '#f5c842' }}>
            <span style={{ display: 'inline-block', width: 10, height: 2,
              background: 'repeating-linear-gradient(90deg,#f5c842 0,#f5c842 3px,transparent 3px,transparent 5px)',
              verticalAlign: 'middle', marginRight: 4 }}/>
            wpłacone {lastPaid.toFixed(0)}
          </span>
        </div>
        {lastPaid > 0 && (
          <span style={{ ...MONO, fontSize: 9, color: gainColor }}>
            {gain >= 0 ? '+' : ''}{gain.toFixed(0)} ({gainPct >= 0 ? '+' : ''}{gainPct.toFixed(0)}%)
          </span>
        )}
      </div>
    </div>
  );
}

// ── WatchlistTab ──────────────────────────────────────────────────
export function WatchlistTab({ watchlist, onRemove, onAlbumClick, user, AlbumCover, premium = false }) {
  const t = useT();
  const [sort, setSort]           = useState('added');
  const [alertItem, setAlertItem]     = useState(null);
  const [alertPrice, setAlertPrice]   = useState('');
  const [alertType, setAlertType]     = useState('PRICE_DROP');  // PRICE_DROP / PERCENT_DROP / LOW_STOCK
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertDone, setAlertDone]     = useState({});
  // Lazy Discogs lookup map for watchlist rows that didn't ship with a
  // cover (e.g. wishlist'd from Listening tab before that flow learned
  // to pass the cover through; also any pre-existing rows). Keyed on
  // artist::album lower-case. Resolved values pull from the same
  // server-side 7d cache that powers the Listening tab.
  const [resolved, setResolved] = useState({});
  // Auto-drop threshold (% off 30d avg). null = disabled. Lives on the
  // server in profiles.auto_drop_pct so the daily cron can see it.
  const [autoPct, setAutoPct]   = useState(null);
  const [autoOpen, setAutoOpen] = useState(false);
  // Wishlists — lifted into WatchlistTab so each row can fire a quick
  // "Add this album to a gift list" picker. Refresh handler is exposed
  // via window event so WishlistsManager can trigger a re-pull when it
  // mutates (create / delete).
  const [wishlists, setWishlists] = useState([]);
  // When the user taps the gift icon on a row, we stash that album so
  // the picker overlay knows which item to add on confirm.
  const [pickerAlbum, setPickerAlbum] = useState(null);
  // When non-null, the inline form is editing that alert id (PATCH
  // instead of POST). Set when clicking "Alert aktywny" on an item
  // that already has an alert.
  const [editingAlertId, setEditingAlertId] = useState(null);
  // Inline variant editor — which row is currently being edited and
  // the local draft text. Saving fires an upsert via /api/watchlist
  // POST; the parent re-fetches via mv-watchlist-changed.
  const [editVariant, setEditVariant]       = useState(null);
  const [variantDraft, setVariantDraft]     = useState({ format: '', color: '', label: '' });

  const saveVariant = async (album) => {
    try {
      await fetch('/api/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          album_id: album.album_id,
          artist:   album.artist,
          album:    album.album,
          cover:    album.cover || null,
          year:     album.year || null,
          format:   variantDraft.format?.trim() || null,
          color:    variantDraft.color?.trim()  || null,
          label:    variantDraft.label?.trim()  || null,
        }),
      });
      window.dispatchEvent(new CustomEvent('mv-watchlist-changed'));
      setEditVariant(null);
    } catch {}
  };

  // ── Lazy resolve covers + prices for watchlist rows ───────────
  // Walks the current watchlist, picks rows without a cover (or never
  // resolved before), batches them 12 at a time through the album-
  // lookup endpoint. Server-side 7d cache means second visits are
  // instant. Same pattern as ListeningTab — covers, prices and the
  // Discogs URL go straight into a lookup map the render reads from.
  useEffect(() => {
    if (!watchlist?.length) return;
    const targets = watchlist
      .filter(it => {
        if (!it.artist || !it.album) return false;
        const k = (it.artist + '::' + it.album).toLowerCase();
        if (resolved[k]) return false;          // already resolved this session
        // Re-resolve if either the cover is missing OR no price/url yet
        // (a row added with a cover but no Discogs link still benefits
        // from the price + deep-link).
        return !it.cover || !resolved[k]?.lowestPrice;
      })
      .map(it => ({ artist: it.artist, album: it.album }));
    if (targets.length === 0) return;

    let cancelled = false;
    (async () => {
      for (let i = 0; i < targets.length && !cancelled; i += 12) {
        const slice = targets.slice(i, i + 12);
        let r;
        try {
          r = await fetch('/api/discogs/album-lookup', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ items: slice }),
          });
        } catch { return; }
        if (!r.ok) return;
        let d;
        try { d = await r.json(); } catch { return; }
        setResolved(prev => {
          const next = { ...prev };
          for (const res of (d.results || [])) {
            const k = (res.artist + '::' + res.album).toLowerCase();
            next[k] = res;
          }
          return next;
        });
        if (i + 12 < targets.length) await new Promise(r => setTimeout(r, 1500));
      }
    })();
    return () => { cancelled = true; };
  }, [watchlist]);   // eslint-disable-line

  // Load auto-drop threshold once on mount. Silent fall-back to null
  // if the column / endpoint is missing (migration 036 not applied).
  useEffect(() => {
    if (!user) return;
    fetch('/api/profile/auto-drop')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.pct != null) setAutoPct(Number(d.pct)); })
      .catch(() => {});
  }, [user]);

  // Wishlists list — populates the per-row "🎁+" picker.
  // Re-fetch when the manager component fires a custom event after CRUD.
  useEffect(() => {
    if (!user) return;
    const load = () => {
      fetch('/api/wishlists')
        .then(r => r.ok ? r.json() : null)
        .then(d => setWishlists(d?.wishlists || []))
        .catch(() => {});
    };
    load();
    const handler = () => load();
    window.addEventListener('mv-wishlists-changed', handler);
    return () => window.removeEventListener('mv-wishlists-changed', handler);
  }, [user]);

  const addToWishlist = async (wlId, album) => {
    try {
      const r = await fetch('/api/wishlists/' + wlId + '/items', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          artist:      album.artist,
          album:       album.album,
          cover:       album.cover || resolved[(album.artist + '::' + album.album).toLowerCase()]?.cover || null,
          album_id:    album.album_id ? String(album.album_id) : null,
          discogs_url: album.discogs_url || resolved[(album.artist + '::' + album.album).toLowerCase()]?.discogsUrl || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error || t('wishlists.addFailed') || 'Add failed');
        return;
      }
      const wl = wishlists.find(w => w.id === wlId);
      toast.success(
        (t('wishlists.addedTo', { name: wl?.name }) || ('Added to ' + (wl?.name || 'wishlist')))
      );
      window.dispatchEvent(new CustomEvent('mv-wishlists-changed'));
      setPickerAlbum(null);
    } catch (e) { toast.error(e.message); }
  };

  const saveAutoPct = async (newPct) => {
    setAutoPct(newPct);
    setAutoOpen(false);
    try {
      const r = await fetch('/api/profile/auto-drop', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pct: newPct }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error || 'Save failed');
        // Revert UI
        setAutoPct(autoPct);
      } else if (newPct != null) {
        toast.success(t('autoDrop.toastOn', { n: newPct })
          || ('Auto-drop ON: -' + newPct + '%'));
      } else {
        toast(t('autoDrop.toastOff') || 'Auto-drop disabled');
      }
    } catch (e) { toast.error(e.message); setAutoPct(autoPct); }
  };

  // Load saved alerts on mount — persists across tab switches.
  // Index by every identifier the watchlist UI might know about
  // (album_id slug OR numeric discogs_id) so the active-alert badge
  // shows up regardless of how the watchlist row was added.
  useEffect(() => {
    if (!user) return;
    fetch('/api/alerts').then(r => r.json()).then(d => {
      if (!d.alerts) return;
      const map = {};
      for (const a of d.alerts) {
        if (a.is_active === false) continue;
        const entry = {
          id:    a.id,
          price: Number(a.target_price),
          type:  a.alert_type || 'PRICE_DROP',
        };
        if (a.album_id != null)   map[String(a.album_id)]   = entry;
        if (a.discogs_id != null) map[String(a.discogs_id)] = entry;
      }
      setAlertDone(map);
    }).catch(() => {});
  }, [user]);

  const sorted = [...watchlist].sort((a, b) => {
    if (sort === 'artist') return (a.artist || '').localeCompare(b.artist || '');
    if (sort === 'year')   return (b.release_date || '0').localeCompare(a.release_date || '0');
    // 'added' (default): newest first by added_at timestamp
    return new Date(b.date_added || b.added_at || 0) - new Date(a.date_added || a.added_at || 0);
  });

  const saveAlert = async (album) => {
    if (!alertPrice || isNaN(alertPrice) || !user) return;
    setAlertSaving(true);
    // Identify the watchlist row for the alert. Three cases the cron
    // needs to distinguish:
    //   (a) numeric Discogs release id → discogs_id BIGINT (fastest path)
    //   (b) slug like "gaahls-wyrd::ghosts-invited" → album_id TEXT
    //   (c) numeric stored as string → both can be set; trigger uses
    //       discogs_id first, then falls back to album_id parse
    // Earlier code only sent discogs_id, so slug-based watchlist rows
    // got their identifier silently dropped at the POST normalisation
    // step (Number(slug) → NaN → null) and the alert was unevaluable
    // forever — the user reported "Sprawdź teraz" returning 0 even
    // though the alert clearly existed. Sending album_id alongside
    // gives the trigger flow something to fall back on.
    const rawId = album.album_id || album.id;
    const numericId = Number(rawId);
    const isNumeric = Number.isFinite(numericId) && numericId > 0;

    const editing = !!editingAlertId;
    // PATCH only takes mutable fields. POST takes full identity.
    const payload = editing
      ? { target_price: parseFloat(alertPrice), alert_type: alertType }
      : {
          discogs_id:   isNumeric ? numericId : null,
          album_id:     String(rawId),
          artist:       album.artist,
          album:        album.album,
          target_price: parseFloat(alertPrice),
          alert_type:   alertType,
        };
    if (alertType === 'PERCENT_DROP') {
      payload.baseline_price = parseFloat(alertPrice);
    }
    const url    = editing ? '/api/alerts?id=' + encodeURIComponent(editingAlertId) : '/api/alerts';
    const method = editing ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.message || data.error || t('vault.alert.failed'));
      setAlertSaving(false);
      return;
    }
    // Immediately reload alerts from server to get authoritative state
    try {
      const r = await fetch('/api/alerts').then(r => r.json());
      if (r.alerts) {
        const map = {};
        for (const a of r.alerts) {
          if (a.is_active !== false) {
            // Index by every identifier we know — trigger flow may
            // resolve via any of them, the UI lookup uses album_id ||
            // discogs_id from the watchlist row.
            const k = a.album_id || a.discogs_id;
            if (k != null) {
              map[String(k)] = {
                id:    a.id,
                price: Number(a.target_price),
                type:  a.alert_type || 'PRICE_DROP',
              };
            }
          }
        }
        setAlertDone(map);
      }
    } catch {}
    setAlertSaving(false); setAlertItem(null); setAlertPrice(''); setAlertType('PRICE_DROP');
    setEditingAlertId(null);
  };


  const removeAlert = async (album) => {
    if (!user) return;
    const id = album.album_id || album.id;
    // Optimistic UI: remove from local map immediately
    setAlertDone(m => {
      const copy = { ...m };
      delete copy[String(id)];
      return copy;
    });
    // Authoritative state always refetched on completion — covers
    // both 4xx/5xx (silent rollback) and network failure. The audit
    // caught a bug where `await fetch(...)` succeeded with a 4xx but
    // the catch block wasn't entered, so a failed delete left the UI
    // de-synced from the server forever.
    let ok = false;
    try {
      const res = await fetch('/api/alerts?discogs_id=' + encodeURIComponent(id), { method: 'DELETE' });
      ok = res.ok;
    } catch {}
    if (!ok) {
      try {
        const r = await fetch('/api/alerts').then(r => r.json());
        if (r.alerts) {
          const map = {};
          for (const a of r.alerts) {
            if (a.is_active !== false) {
              map[String(a.discogs_id)] = {
                price: Number(a.target_price),
                type:  a.alert_type || 'PRICE_DROP',
              };
            }
          }
          setAlertDone(map);
        }
      } catch {}
    }
  };

  function formatDate(d) {
    if (!d) return '';
    if (/^\d{4}$/.test(d)) return d;
    return d;
  }

  if (watchlist.length === 0) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: C.dim, ...MONO }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>☆</div>
      <div style={{ fontSize: 14, lineHeight: 1.6 }}>
        {t('empty.watchlist.title')}<br />
        <span style={{ color: C.accent, fontSize: 11 }}>{t('empty.watchlist.desc')}</span>
      </div>
    </div>
  );

  // ── Manual "check alerts now" — bypasses the daily cron schedule.
  // Hits /api/alerts/trigger which re-evaluates this user's active
  // alerts against live Discogs prices and fires push/email for any
  // that hit the threshold. Useful for verifying setup without
  // waiting for 09:00 UTC.
  const checkAlertsNow = async () => {
    try {
      const r = await fetch('/api/alerts/trigger', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error || t('alert.checkFailed'));
        return;
      }
      if (d.triggered > 0) {
        toast.success(t('alert.checkTriggered', { n: d.triggered }));
        try {
          const fresh = await fetch('/api/alerts').then(r => r.json());
          if (fresh.alerts) {
            const map = {};
            for (const a of fresh.alerts) {
              if (a.is_active === false) continue;
              const entry = { id: a.id, price: Number(a.target_price), type: a.alert_type || 'PRICE_DROP' };
              if (a.album_id != null)   map[String(a.album_id)]   = entry;
              if (a.discogs_id != null) map[String(a.discogs_id)] = entry;
            }
            setAlertDone(map);
          }
        } catch {}
      } else if (d.checked === 0 && d.skipped_no_id > 0) {
        // Every alert was skipped because no resolvable Discogs ID.
        // Most likely the rows were created before saveAlert started
        // sending album_id alongside discogs_id. User has to delete +
        // recreate the alert to get a fresh row with the proper
        // identifier set.
        toast.error(t('alert.checkAllSkipped', { n: d.skipped_no_id })
          || (d.skipped_no_id + ' alert(s) couldn\'t be checked — re-add to fix'));
      } else {
        toast.success(t('alert.checkClean', { n: d.checked || 0 }));
      }
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div style={{ padding: '16px' }}>
      {/* Toolbar — count on first line, action buttons on a second
          flex-wrapping line. Mobile (320–360px wide) couldn't fit four
          buttons + sort + count in one row; the right cluster used to
          have flexShrink:0 and overflowed off-screen sideways. Now
          actions wrap to extra rows on narrow displays without
          horizontal scroll. */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.dim, ...MONO, letterSpacing: '0.15em',
          textTransform: 'uppercase', marginBottom: 8 }}>
          {watchlist.length} {watchlist.length === 1 ? t('watchlist.album') : t('watchlist.albums')}
          {user && <span style={{ color: '#4ade80' }}> {t('watchlist.synced')}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Pull Discogs wantlist → watchlist. The full /api/sync POST
              already does both collection AND wantlist under type:'both',
              but power users on Discogs add to their wantlist constantly
              and don't want to re-sync the whole collection every time.
              This button hits type:'wantlist' only — fast, additive,
              non-destructive. */}
          {user && (
            <button onClick={async () => {
              try {
                const r = await fetch('/api/sync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type: 'wantlist' }),
                });
                const d = await r.json();
                if (!r.ok) { toast.error(d.error || 'Sync failed'); return; }
                if (d.watchAdded > 0) {
                  toast.success((t('watchlist.syncAdded', { n: d.watchAdded }) || (d.watchAdded + ' added')));
                  window.dispatchEvent(new CustomEvent('mv-watchlist-changed'));
                } else {
                  toast(t('watchlist.syncEmpty') || 'Already up to date');
                }
              } catch (e) { toast.error(e.message); }
            }}
              title={t('watchlist.syncDiscogsTitle') || 'Pull from Discogs wantlist'}
              style={{ background: '#0d1f3a', border: '1px solid #3b82f666', borderRadius: 6, color: '#60a5fa', padding: '5px 9px', fontSize: 10, ...MONO, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ↓ {t('watchlist.syncDiscogs') || 'Discogs'}
            </button>
          )}
          {/* Auto price-drop threshold — applies to ALL watchlist rows.
              Cron checks each row's 30d avg from price_history and
              fires push/email when current ≤ avg × (1 − pct/100).
              Single user-level setting beats configuring 50 alerts
              one by one. */}
          {user && (
            <button onClick={() => {
              if (!premium) {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('mv:upgrade', { detail: { reason: 'AUTO_DROP_ALERTS' } }));
                }
                return;
              }
              setAutoOpen(true);
            }}
              title={t('autoDrop.title') || 'Auto price-drop alerts'}
              style={{
                background: autoPct != null ? '#3a1a06' : C.bg3,
                border: '1px solid ' + (autoPct != null ? '#f9731666' : C.border),
                borderRadius: 6,
                color:      autoPct != null ? '#f97316' : C.dim,
                padding: '5px 9px', fontSize: 10, ...MONO,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {autoPct != null
                ? '🔻 ' + (t('autoDrop.chipOn', { n: autoPct }) || 'Auto -' + autoPct + '%')
                : '🔻 ' + (t('autoDrop.chipOff') || 'Auto drop')}
            </button>
          )}
          {user && Object.keys(alertDone).length > 0 && (
            <button onClick={checkAlertsNow}
              title={t('alert.checkNowTitle')}
              style={{ background: C.gold + '22', border: '1px solid ' + C.gold + '66', borderRadius: 6, color: C.gold, padding: '5px 9px', fontSize: 10, ...MONO, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              🔔 {t('alert.checkNow')}
            </button>
          )}
          <select value={sort} onChange={e => setSort(e.target.value)}
            style={{ background: C.bg3, border: '1px solid ' + C.border, borderRadius: 6, color: C.muted, padding: '5px 8px', fontSize: 11, ...MONO, cursor: 'pointer', outline: 'none' }}>
            <option value="added">{t('vault.sort.added')}</option>
            <option value="artist">{t('vault.sort.artist')}</option>
            <option value="year">{t('vault.sort.year')}</option>
          </select>
        </div>
      </div>

      {/* Auto-drop modal — list of presets + Off button. Tapping a value
          PATCHes profiles.auto_drop_pct and closes. */}
      {autoOpen && (
        <div onClick={() => setAutoOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}>
          <div onClick={e => e.stopPropagation()}
            style={{
              background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12,
              padding: 18, maxWidth: 360, width: '100%',
            }}>
            <div style={{ ...BEBAS, fontSize: 16, color: C.text, letterSpacing: '0.04em', marginBottom: 6 }}>
              {t('autoDrop.title') || 'Auto price-drop alerts'}
            </div>
            <div style={{ fontSize: 11, color: C.dim, ...MONO, lineHeight: 1.5, marginBottom: 14 }}>
              {t('autoDrop.desc') || 'Powiadom mnie gdy cena spadnie o X% poniżej 30-dniowej średniej. Działa dla każdej płyty z watchlisty.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[10, 15, 20, 25, 30, 40].map(p => (
                <button key={p} onClick={() => saveAutoPct(p)}
                  style={{
                    padding: '12px 6px', borderRadius: 8,
                    background: autoPct === p ? '#3a1a06' : C.bg3,
                    border: '1px solid ' + (autoPct === p ? '#f97316' : C.border),
                    color:   autoPct === p ? '#f97316' : C.text,
                    cursor: 'pointer', ...BEBAS, fontSize: 18, letterSpacing: '0.02em',
                  }}>
                  -{p}%
                </button>
              ))}
            </div>
            <button onClick={() => saveAutoPct(null)}
              style={{
                marginTop: 10, width: '100%', padding: '10px',
                background: 'transparent', border: '1px solid ' + C.border,
                borderRadius: 8, color: C.dim, cursor: 'pointer',
                ...MONO, fontSize: 11,
              }}>
              {t('autoDrop.off') || 'Wyłącz auto-alert'}
            </button>
          </div>
        </div>
      )}

      {/* Gift wishlists — collapsible, owner-only. Each watchlist row
          below also has its own "Add to gift list" picker so power users
          can curate "buy this for me at Christmas" lists per occasion.
          Premium gates list count (1 free → unlimited Pro). */}
      <WishlistsManager user={user} premium={premium}/>

      {/* Gift-list picker overlay — appears when the user taps "🎁+" on
          a row. Lists their wishlists; tapping one adds the album and
          closes. Tap-outside dismisses. */}
      {pickerAlbum && (
        <div onClick={() => setPickerAlbum(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}>
          <div onClick={e => e.stopPropagation()}
            style={{
              background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12,
              padding: 18, maxWidth: 360, width: '100%',
            }}>
            <div style={{ ...BEBAS, fontSize: 16, color: C.text, letterSpacing: '0.04em', marginBottom: 4 }}>
              🎁 {t('wishlists.addToList') || 'Add to gift list'}
            </div>
            <div style={{ fontSize: 11, color: C.dim, ...MONO, lineHeight: 1.5, marginBottom: 12,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pickerAlbum.artist} — {pickerAlbum.album}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {wishlists.map(wl => (
                <button key={wl.id} onClick={() => addToWishlist(wl.id, pickerAlbum)}
                  style={{
                    padding: '10px 12px', textAlign: 'left',
                    background: C.bg3, border: '1px solid ' + C.border,
                    borderRadius: 8, color: C.text, cursor: 'pointer',
                    ...MONO, fontSize: 12,
                  }}>
                  {wl.name}
                  <span style={{ float: 'right', color: C.dim, fontSize: 10 }}>
                    {wl.item_count || 0}
                  </span>
                </button>
              ))}
            </div>
            <button onClick={() => setPickerAlbum(null)}
              style={{
                marginTop: 12, width: '100%', padding: '8px',
                background: 'transparent', border: '1px solid ' + C.border,
                borderRadius: 8, color: C.dim, cursor: 'pointer',
                ...MONO, fontSize: 11,
              }}>
              {t('common.cancel') || 'Cancel'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map(album => {
          const id = String(album.album_id || album.id);
          const hasAlert = alertDone[id];
          // Stitch resolved Discogs cover + price into the row data so
          // late-arriving lookups update the UI in place. The album
          // object itself wins when it has a cover (already saved with
          // the watchlist row); only fall back to resolved lookup when
          // the stored cover is missing.
          const lookupKey  = (album.artist + '::' + album.album).toLowerCase();
          const resv       = resolved[lookupKey];
          const finalCover = album.cover || resv?.cover || null;
          const hasPrice   = resv && !resv.notFound && resv.lowestPrice != null;
          return (
            <div key={id} style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, overflow: 'hidden' }}>
              {/* CSS Grid: fixed cover | fluid text (truncates) | fixed X button */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '52px minmax(0, 1fr) 40px',
                gap: 12, padding: '12px 14px', alignItems: 'center',
              }}>
                {/* Cover — clickable */}
                <div onClick={() => onAlbumClick(album)} style={{ cursor: 'pointer' }}>
                  {AlbumCover && <AlbumCover src={finalCover} artist={album.artist} size={52} />}
                </div>
                {/* Text column — guaranteed to shrink via minmax(0, 1fr) */}
                <div onClick={() => onAlbumClick(album)} style={{ cursor: 'pointer', minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ ...BEBAS, fontSize: 17, color: C.text, lineHeight: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.artist}</div>
                  <div style={{ fontSize: 11, color: C.muted, ...MONO, marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.album}</div>
                  {/* Version info chips */}
                  <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    {album.format && album.format !== 'Vinyl' && album.format !== 'LP' && (
                      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: C.bg3, color: C.dim, ...MONO }}>{album.format}</span>
                    )}
                    {album.color && (
                      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: C.bg3, color: '#aaa', ...MONO }}>🎨 {album.color}</span>
                    )}
                    {album.label && (
                      <span style={{ fontSize: 9, color: C.dim, ...MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{album.label}</span>
                    )}
                    {(album.release_date || album.releaseDate || album.year) && (
                      <span style={{ fontSize: 9, color: C.dim, ...MONO }}>
                        {formatDate(album.release_date || album.releaseDate || album.year)}
                      </span>
                    )}
                    {/* Discogs marketplace floor — turns the watchlist
                        into a price-comparison list. Click skips the
                        row's own onClick (don't open VinylModal) and
                        deep-links into the Discogs release page where
                        the user can actually buy. */}
                    {hasPrice && (
                      <a href={resv.discogsUrl}
                        target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{
                          fontSize: 10, fontWeight: 600,
                          color: '#f97316', textDecoration: 'none',
                          background: '#3a1a06', border: '1px solid #f9731644',
                          padding: '2px 7px', borderRadius: 5,
                          ...MONO, whiteSpace: 'nowrap',
                        }}>
                        {(t('listening.priceFrom') || 'od') + ' '}
                        {Number(resv.lowestPrice).toFixed(0)} {resv.currency || 'USD'}
                      </a>
                    )}
                    {/* Add to gift list — only renders if the user has at
                        least one wishlist (no point teasing the picker
                        when there's nothing to pick). */}
                    {wishlists.length > 0 && (
                      <button onClick={e => { e.stopPropagation(); setPickerAlbum(album); }}
                        style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 5,
                          background: '#1a1a3d', color: '#a5b4fc',
                          border: '1px solid #a5b4fc44',
                          ...MONO, cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>
                        🎁+
                      </button>
                    )}
                  </div>
                  {hasAlert && (
                    <div style={{ fontSize: 10, color: '#f5c842', ...MONO, marginTop: 2 }}>
                      🔔 {hasAlert.type === 'PRICE_DROP'   && t('alert.summaryPrice',   { n: hasAlert.price })}
                      {  hasAlert.type === 'PERCENT_DROP' && t('alert.summaryPercent', { n: hasAlert.price })}
                      {  hasAlert.type === 'LOW_STOCK'    && t('alert.summaryStock',   { n: hasAlert.price })}
                    </div>
                  )}
                  {/* Variant edit — small chip clicker that turns the
                      row's variant info into editable fields. Lets the
                      user record which exact pressing they want when
                      multiple editions exist (Limited, color, label). */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (editVariant === id) {
                        setEditVariant(null);
                      } else {
                        setEditVariant(id);
                        setVariantDraft({
                          format: album.format || '',
                          color:  album.color  || '',
                          label:  album.label  || '',
                        });
                      }
                    }}
                    style={{
                      marginTop: 4, fontSize: 9, padding: '2px 8px', borderRadius: 4,
                      background: editVariant === id ? C.accent + '22' : 'transparent',
                      border: '1px dashed ' + (editVariant === id ? C.accent : C.border),
                      color: editVariant === id ? C.accent : C.dim,
                      ...MONO, cursor: 'pointer',
                    }}>
                    {(album.format || album.color || album.label) ? '✏ ' + t('watchlist.editVariant') : '+ ' + t('watchlist.addVariant')}
                  </button>
                </div>
                {/* × button — always visible, fixed 40px column */}
                <button onClick={() => onRemove(id)}
                  style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer',
                    fontSize: 26, padding: 0, lineHeight: 1, width: 40, height: 40,
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
              {/* Variant edit form — rendered between header and alert
                  row when active. Three small fields: format, color,
                  label. Free-form so users can write anything ("Splatter
                  red/black", "Limited 500", "Nuclear Blast 2023 reissue"). */}
              {editVariant === id && (
                <div style={{ borderTop: '1px solid ' + C.border, padding: '10px 14px', background: C.bg3 }}>
                  <div style={{ fontSize: 10, color: C.accent, ...MONO, marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    {t('watchlist.editVariantTitle')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      value={variantDraft.format}
                      onChange={e => setVariantDraft(d => ({ ...d, format: e.target.value }))}
                      placeholder={t('watchlist.variantFormat')}
                      style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 12, ...MONO, outline: 'none' }}/>
                    <input
                      value={variantDraft.color}
                      onChange={e => setVariantDraft(d => ({ ...d, color: e.target.value }))}
                      placeholder={t('watchlist.variantColor')}
                      style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 12, ...MONO, outline: 'none' }}/>
                    <input
                      value={variantDraft.label}
                      onChange={e => setVariantDraft(d => ({ ...d, label: e.target.value }))}
                      placeholder={t('watchlist.variantLabel')}
                      style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 12, ...MONO, outline: 'none' }}/>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button onClick={() => setEditVariant(null)}
                      style={{ flex: 1, padding: '7px', background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, cursor: 'pointer', fontSize: 11, ...MONO }}>
                      {t('common.cancel')}
                    </button>
                    <button onClick={() => saveVariant(album)}
                      style={{ flex: 2, padding: '7px', background: C.accent, border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 11, ...BEBAS, letterSpacing: '0.06em' }}>
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', borderTop: '1px solid ' + C.border }}>
                <button onClick={() => {
                    if (alertItem === id) {
                      // Toggle close
                      setAlertItem(null);
                      setEditingAlertId(null);
                      setAlertPrice('');
                      setAlertType('PRICE_DROP');
                    } else {
                      setAlertItem(id);
                      // Edit mode — pre-populate from existing alert
                      // so user sees current value and PATCH semantics.
                      // Without this, opening the form on an active
                      // alert would create a duplicate and confuse the
                      // index-by-key dedupe.
                      if (hasAlert) {
                        setEditingAlertId(hasAlert.id);
                        setAlertType(hasAlert.type || 'PRICE_DROP');
                        setAlertPrice(String(hasAlert.price ?? ''));
                      } else {
                        setEditingAlertId(null);
                        setAlertPrice('');
                      }
                    }
                  }}
                  style={{ flex: 1, padding: '8px 14px', background: alertItem === id ? '#1a0a00' : 'transparent', border: 'none', color: alertItem === id ? '#f5c842' : hasAlert ? '#f5c842' : '#555', cursor: 'pointer', fontSize: 11, ...MONO, display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.05em', textAlign: 'left' }}>
                  🔔 {hasAlert ? (
                    hasAlert.type === 'PRICE_DROP'   ? t('alert.activePrice',   { n: hasAlert.price }) :
                    hasAlert.type === 'PERCENT_DROP' ? t('alert.activePercent', { n: hasAlert.price }) :
                    hasAlert.type === 'LOW_STOCK'    ? t('alert.activeStock',   { n: hasAlert.price }) :
                    t('alert.active')
                  ) : t('alert.set')}
                </button>
                {hasAlert && (
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    if (await mvConfirm(t('alert.confirmRemove'), { kind: 'danger', confirmLabel: t('common.delete') })) {
                      removeAlert(album);
                    }
                  }}
                    title={t('alert.removeTitle')}
                    style={{ padding: '8px 14px', background: 'transparent', border: 'none', borderLeft: '1px solid ' + C.border, color: '#f87171', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>
                    🗑
                  </button>
                )}
              </div>
              {alertItem === id && (
                <div style={{ borderTop: '1px solid ' + C.border, padding: '10px 14px', background: '#1a0a00', borderRadius: '0 0 10px 10px' }}>
                  <div style={{ fontSize: 10, color: '#f5c842', ...MONO, marginBottom: 6 }}>{t('alert.typeLabel')}</div>
                  {/* Alert type selector — 3 options for wantlist */}
                  <select value={alertType} onChange={e => setAlertType(e.target.value)}
                    style={{ width: '100%', background: C.bg3, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 12, ...MONO, marginBottom: 8, outline: 'none' }}>
                    <option value="PRICE_DROP">{t('alert.type.priceDrop')}</option>
                    <option value="PERCENT_DROP">{t('alert.type.percentDrop')}</option>
                    <option value="LOW_STOCK">{t('alert.type.lowStock')}</option>
                  </select>
                  <div style={{ fontSize: 10, color: C.muted, ...MONO, marginBottom: 6 }}>
                    {alertType === 'PRICE_DROP'   && t('alert.help.priceDrop')}
                    {alertType === 'PERCENT_DROP' && t('alert.help.percentDrop')}
                    {alertType === 'LOW_STOCK'    && t('alert.help.lowStock')}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ ...BEBAS, fontSize: 18, color: C.muted, minWidth: 16, textAlign: 'center' }}>
                      {alertType === 'PRICE_DROP' ? '$' : alertType === 'PERCENT_DROP' ? '%' : '#'}
                    </span>
                    <input type="number" value={alertPrice} onChange={e => setAlertPrice(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveAlert(album)}
                      placeholder={alertType === 'PRICE_DROP' ? t('alert.placeholderPrice') : alertType === 'PERCENT_DROP' ? t('alert.placeholderPct') : t('alert.placeholderStock')}
                      autoFocus
                      style={{ flex: 1, background: C.bg3, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 16, ...MONO, outline: 'none' }} />
                    <button onClick={() => saveAlert(album)} disabled={alertSaving || !user}
                      style={{ padding: '10px 18px', background: !user || alertSaving ? C.bg3 : C.accent, border: 'none', borderRadius: 8, color: '#fff', cursor: !user ? 'default' : 'pointer', ...BEBAS, fontSize: 17, flexShrink: 0 }}>
                      {alertSaving ? t('alert.savingShort') : t('alert.ok')}
                    </button>
                    <button onClick={() => {
                        setAlertItem(null);
                        setAlertPrice('');
                        setAlertType('PRICE_DROP');
                        setEditingAlertId(null);
                      }}
                      style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, padding: '7px 10px', cursor: 'pointer', ...MONO, fontSize: 10, flexShrink: 0 }}>✕</button>
                  </div>
                  {!user && <div style={{ fontSize: 10, color: '#f87171', ...MONO, marginTop: 4 }}>{t('alert.signInRequired')}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── CollectionTab ─────────────────────────────────────────────────
// ── VaultScore — gamified completeness indicator ─────────────
function VaultScore({ collection }) {
  const t = useT();
  if (!collection.length) return null;

  const total = collection.length;
  const withCover    = collection.filter(i => i.cover).length;
  const withPrice    = collection.filter(i => i.purchase_price).length;
  const withGrade    = collection.filter(i => i.grade).length;
  const withMktPrice = collection.filter(i => i.median_price || i.current_price).length;

  // Score = weighted average of completeness dimensions
  const score = Math.round(
    (withCover    / total * 25) +
    (withPrice    / total * 25) +
    (withGrade    / total * 25) +
    (withMktPrice / total * 25)
  );

  const color = score >= 75 ? '#4ade80' : score >= 40 ? '#f5c842' : '#f97316';

  // Find the biggest gap to suggest next action
  const gaps = [
    { pct: withCover / total,    label: 'covers missing',         action: 'sync Discogs to import covers' },
    { pct: withPrice / total,    label: 'no purchase price',      action: 'add purchase prices' },
    { pct: withGrade / total,    label: 'not graded',             action: 'grade your records' },
    { pct: withMktPrice / total, label: 'no market price',        action: 'tap "Fetch prices now"' },
  ].sort((a, b) => a.pct - b.pct);
  const biggestGap = gaps[0];
  const gapCount   = Math.round((1 - biggestGap.pct) * total);

  return (
    <div style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: C.dim, ...MONO, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          🏆 Vault Score
        </div>
        <div style={{ ...BEBAS, fontSize: 26, color, lineHeight: 1, letterSpacing: '0.04em' }}>
          {score}<span style={{ fontSize: 13, color: C.dim }}>/100</span>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 6, background: C.bg3, borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ height: '100%', width: score + '%', borderRadius: 3, transition: 'width 0.8s ease',
          background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
      </div>
      {/* Dimension dots */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {[
          { label: 'Covers',  pct: withCover / total },
          { label: 'Paid',    pct: withPrice / total },
          { label: 'Grade',   pct: withGrade / total },
          { label: 'Market',  pct: withMktPrice / total },
        ].map(d => (
          <div key={d.label} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: C.dim, ...MONO, marginBottom: 3 }}>{d.label}</div>
            <div style={{ height: 3, background: C.bg3, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: Math.round(d.pct * 100) + '%',
                background: d.pct > 0.7 ? '#4ade80' : d.pct > 0.3 ? '#f5c842' : '#f97316',
                borderRadius: 2, transition: 'width 0.6s' }} />
            </div>
            <div style={{ fontSize: 8, color: C.dim, ...MONO, marginTop: 2 }}>{Math.round(d.pct * 100)}%</div>
          </div>
        ))}
      </div>
      {/* Next action hint */}
      {gapCount > 0 && score < 95 && (
        <div style={{ fontSize: 10, color: C.dim, ...MONO, lineHeight: 1.5 }}>
          💡 <span style={{ color: C.muted }}>{gapCount} records {biggestGap.label}</span>
          {' — '}{biggestGap.action}
        </div>
      )}
      {score >= 95 && (
        <div style={{ fontSize: 10, color: '#4ade80', ...MONO }}>
          🤘 {t('vault.score.title')} ✓
        </div>
      )}
    </div>
  );
}

// ── PriceEditForm — iOS-safe, no auto-focus (avoids iOS keyboard race) ──
const PriceEditForm = memo(function PriceEditForm({ itemId, currentPrice, onSave, onCancel }) {
  const [val, setVal]       = useState(currentPrice ? String(currentPrice) : '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    const n = parseFloat(String(val).trim().replace(',', '.'));
    if (!String(val).trim() || isNaN(n)) { onCancel(); return; }
    setSaving(true);
    try { await onSave(n); } catch {}
    setSaving(false);
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: C.dim, ...MONO, marginBottom: 4, letterSpacing: '0.05em' }}>
        Tap below to enter price
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          placeholder="$0"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          style={{ flex: 1, background: C.bg3, border: '2px solid ' + C.accent + '66',
            borderRadius: 8, color: C.text, padding: '12px 14px', fontSize: 18,
            fontFamily: 'var(--font-space-mono), monospace', outline: 'none', minHeight: 44,
            WebkitAppearance: 'none', MozAppearance: 'textfield' }}
        />
        <button onClick={handleSave} disabled={saving}
          style={{ background: C.accent, border: 'none', borderRadius: 8,
            color: '#fff', padding: '12px 16px', cursor: 'pointer', minHeight: 44,
            fontFamily: "var(--font-bebas-neue), sans-serif", fontSize: 16, letterSpacing: '0.06em',
            opacity: saving ? 0.6 : 1 }}>
          {saving ? '…' : 'SAVE'}
        </button>
        <button onClick={onCancel}
          style={{ background: 'none', border: '1px solid ' + C.border,
            borderRadius: 8, color: C.dim, padding: '12px 12px', minHeight: 44,
            cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>
    </div>
  );
}, (prev, next) => prev.itemId === next.itemId && prev.currentPrice === next.currentPrice);

// ── ManualAddForm ─────────────────────────────────────────────
// Holding period — human-readable "2y 3mo" / "5mo" / "" (empty if < 30 days)
function holdingPeriod(addedAt) {
  if (!addedAt) return '';
  const days = Math.floor((Date.now() - new Date(addedAt).getTime()) / 86400000);
  if (isNaN(days) || days < 30) return '';
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months + 'mo';
  }
  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days - years * 365) / 30);
  return remMonths > 0 ? years + 'y ' + remMonths + 'mo' : years + 'y';
}

export function CollectionTab({
  user, collection, watchlist = [], onRemoveWatch, onRemove, onUpdate,
  portfolio, onAlbumClick, onAddToWatchlist, AlbumCover, onManualAdd,
  premium, onUpgrade, onRefreshPrices,
  onConnectDiscogs, discogsConnected,
  followedArtists = [], onToggleFollow, onBatchFollow,
}) {
  const t = useT();
  const cur = useCurrency();
  const fx  = useFx();
  const [view, setView]                   = useState('vinyl');
  const [vaultSearch,    setVaultSearch]   = useState('');
  const [vaultFilter,    setVaultFilter]   = useState('all');
  const [showAddManual,  setShowAddManual] = useState(false);
  const [priceHistories, setPriceHistories] = useState({});  // discogs_id → values[]
  const [refreshing,     setRefreshing]    = useState(false);
  const [refreshResult,  setRefreshResult] = useState(null);
  const [expandedId,     setExpandedId]    = useState(null);

  // Batch fetch 30-day price history for all records in collection (Pro feature).
  // One POST per collection load — sparklines render as data arrives. Empty
  // response (Free tier or no history) just leaves cards without sparkline.
  useEffect(() => {
    if (!premium) return;
    if (!collection || collection.length === 0) return;
    const ids = collection.map(i => i.discogs_id).filter(Boolean);
    if (ids.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/price-history/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discogs_ids: ids }),
        });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled && d.histories) setPriceHistories(d.histories);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [collection.length, premium]);  // eslint-disable-line
  const [showAlertForm, setShowAlertForm] = useState(null);
  const [priceModalItem, setPriceModalItem] = useState(null);
  const [priceInputVal, setPriceInputVal] = useState('');
  const [targetPrice, setTargetPrice]     = useState('');
  const [alertType,   setAlertType]       = useState('PRICE_DROP');
  // When non-null, the inline alert form is in EDIT mode for that
  // alert id — saving fires PATCH /api/alerts?id= instead of POST.
  // Null means create new.
  const [editingAlertId, setEditingAlertId] = useState(null);
  const [gradingExpandedId, setGradingExpandedId] = useState(null);
  const [gradingDraft, setGradingDraft]   = useState({});  // per-item draft {sleeve_grade, vinyl_grade, inner_sleeve_grade, hype_sticker, playback_notes}
  const [gradingSaving, setGradingSaving] = useState(false);
  const [saving, setSaving]               = useState(false);
  // Map of {[discogs_id|collection_id]: {price, type, id}} so the
  // collection-card render can show "🔔 Active" badges on items that
  // already have an alert. Loaded from /api/alerts on mount, kept in
  // sync after createAlert/removeAlert.
  const [activeAlerts, setActiveAlerts] = useState({});
  if (!onUpdate) onUpdate = () => {};

  // Load existing alerts on mount so the cards know which items already
  // have an alert. Without this state the user clicked "Set alert",
  // typed a price, hit save, and got zero feedback either way (the
  // earlier fire-and-forget createAlert dropped both 4xx errors AND
  // success state on the floor).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch('/api/alerts').then(r => r.ok ? r.json() : null).then(d => {
      if (cancelled || !d?.alerts) return;
      const map = {};
      for (const a of d.alerts) {
        if (a.is_active === false) continue;
        const key = a.collection_id || a.discogs_id;
        if (!key) continue;
        map[String(key)] = {
          id:    a.id,
          price: Number(a.target_price),
          type:  a.alert_type || 'PRICE_DROP',
        };
      }
      setActiveAlerts(map);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  // Save detailed grading fields atomically — optimistic UI:
  // 1. Update local collection immediately (instant feedback, no lag)
  // 2. PATCH in background
  // 3. On error, refetch from server to revert
  const saveGrading = async (itemId) => {
    const draft = gradingDraft[itemId] || {};
    const payload = {
      sleeve_grade:        draft.sleeve_grade        || null,
      vinyl_grade:         draft.vinyl_grade         || null,
      inner_sleeve_grade:  draft.inner_sleeve_grade  || null,
      hype_sticker:        !!draft.hype_sticker,
      playback_notes:      draft.playback_notes      || null,
    };

    // Optimistic update — apply to local collection immediately
    const optimistic = collection.map(i => i.id === itemId ? { ...i, ...payload } : i);
    onUpdate(optimistic);
    setGradingExpandedId(null);
    setGradingSaving(true);

    try {
      const res = await fetch('/api/collection?id=' + itemId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('PATCH failed: ' + res.status);
      // Success — local state already correct, skip refetch
    } catch (e) {
      const { logError } = await import('@/lib/log');
      logError('Grading save error — reverting', e);
      // Revert by refetching authoritative data
      try {
        const fresh = await fetch('/api/collection').then(r => r.json());
        if (fresh.items) onUpdate(fresh.items);
      } catch {}
      toast.error('Failed to save grading. Your changes were reverted.');
    }
    setGradingSaving(false);
  };

  const createAlert = async (item) => {
    const price = parseFloat(targetPrice);
    if (!targetPrice || !Number.isFinite(price) || price <= 0) {
      toast.error(t('alert.invalidPrice') || 'Enter a valid price');
      return;
    }
    setSaving(true);
    const editing = !!editingAlertId;
    // Capture current price as baseline for percent-based alerts
    const currentPrice = Number(item.median_price || item.current_price) || null;
    // PATCH only accepts these mutable fields; POST takes the full
    // identity payload because the alert is new.
    const payload = editing
      ? { target_price: price, alert_type: alertType }
      : {
          discogs_id:    item.discogs_id,
          collection_id: item.id,
          artist:        item.artist,
          album:         item.album,
          target_price:  price,
          alert_type:    alertType,
        };
    if (alertType === 'PERCENT_DROP' || alertType === 'PERCENT_RISE' || alertType === 'PRICE_RISE') {
      payload.baseline_price = currentPrice;
    }
    try {
      const url    = editing ? '/api/alerts?id=' + encodeURIComponent(editingAlertId) : '/api/alerts';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d.error === 'ALERT_LIMIT_REACHED') {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('mv:upgrade', { detail: { reason: 'ALERT_LIMIT_REACHED' } }));
          }
        } else {
          toast.error(d.message || d.error || t('vault.alert.failed') || 'Could not save alert');
        }
        setSaving(false);
        return;
      }
      const a = d.alert;
      if (a) {
        const key = a.collection_id || a.discogs_id;
        if (key) {
          setActiveAlerts(m => ({
            ...m,
            [String(key)]: { id: a.id, price: Number(a.target_price), type: a.alert_type || 'PRICE_DROP' },
          }));
        }
      }
      toast.success(t('alert.saved') || 'Alert set');
      // Only count NEW alerts (not edits) toward the funnel — edits
      // are a different signal (user changing their mind about target).
      if (!editing) trackAlertCreated(alertType);
      haptic.success();
      // Permission-on-context: now that the user just declared they
      // care about a price, this is the correct moment to ask for
      // push permission. Fire a global event app/page.js listens
      // for; we don't await — letting the success toast land first
      // makes the prompt feel less like a hijack. Self-throttled to
      // once per device (mv_push_prompt_seen).
      if (!editing && typeof window !== 'undefined') {
        try {
          if (localStorage.getItem('mv_push_prompt_seen') !== '1') {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('mv:request-push', {
                detail: { reason: 'first_alert' },
              }));
            }, 600);
          }
        } catch {}
      }
      setShowAlertForm(null); setTargetPrice(''); setAlertType('PRICE_DROP');
      setEditingAlertId(null);
    } catch (e) {
      toast.error(t('vault.alert.failed') || ('Could not save alert: ' + e.message));
    } finally {
      setSaving(false);
    }
  };

  // Switch the inline alert form into edit mode for an existing
  // alert. Pre-populates type + price; createAlert() will detect
  // editingAlertId and use PATCH instead of POST.
  const startEditAlert = (item, alert) => {
    setEditingAlertId(alert.id);
    setAlertType(alert.type || 'PRICE_DROP');
    setTargetPrice(String(alert.price ?? ''));
    setShowAlertForm(item.id);
  };

  // Trigger /api/alerts/trigger on demand — re-evaluates this user's
  // active alerts against live Discogs prices NOW instead of waiting
  // for the daily 09:00 UTC cron. Mirrors the WatchlistTab equivalent.
  // Important for users who just set an alert and want to verify the
  // pipeline (push subscription + VAPID + Resend) actually fires.
  const checkAlertsNow = async () => {
    try {
      const r = await fetch('/api/alerts/trigger', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(d.error || t('alert.checkFailed') || 'Could not check alerts');
        return;
      }
      if (d.triggered > 0) {
        toast.success(t('alert.checkTriggered', { n: d.triggered })
          || (d.triggered + ' alert(s) fired'));
        // Refresh active-alerts state — triggered alerts flip to
        // is_active=false, so they should disappear from the badge.
        try {
          const fresh = await fetch('/api/alerts').then(r => r.json());
          if (fresh.alerts) {
            const map = {};
            for (const a of fresh.alerts) {
              if (a.is_active === false) continue;
              const key = a.collection_id || a.discogs_id;
              if (!key) continue;
              map[String(key)] = { id: a.id, price: Number(a.target_price), type: a.alert_type || 'PRICE_DROP' };
            }
            setActiveAlerts(map);
          }
        } catch {}
      } else if (d.checked === 0 && d.skipped_no_id > 0) {
        toast.error(t('alert.checkAllSkipped', { n: d.skipped_no_id })
          || (d.skipped_no_id + ' alert(s) couldn\'t be checked — re-add to fix'));
      } else {
        toast.success(t('alert.checkClean', { n: d.checked || 0 })
          || ('Checked ' + (d.checked || 0) + ' alert(s) — no triggers'));
      }
    } catch (e) {
      toast.error(e.message);
    }
  };

  // Delete an alert by id. Mirrors WatchlistTab.removeAlert: optimistic
  // local removal, refetch authoritative on any non-OK response.
  const deleteAlert = async (key, alertId) => {
    if (!alertId) return;
    setActiveAlerts(m => {
      const copy = { ...m }; delete copy[String(key)]; return copy;
    });
    let ok = false;
    try {
      const res = await fetch('/api/alerts?id=' + encodeURIComponent(alertId), { method: 'DELETE' });
      ok = res.ok;
    } catch {}
    if (!ok) {
      // Refetch on failure — same pattern as WatchlistTab
      try {
        const r = await fetch('/api/alerts').then(r => r.json());
        if (r.alerts) {
          const map = {};
          for (const a of r.alerts) {
            if (a.is_active === false) continue;
            const k = a.collection_id || a.discogs_id;
            if (k) map[String(k)] = { id: a.id, price: Number(a.target_price), type: a.alert_type || 'PRICE_DROP' };
          }
          setActiveAlerts(map);
        }
      } catch {}
    }
  };

  // No `if (!user) return …` guard here. When the user is a guest,
  // useCollection seeds the demo dataset and the rest of this
  // component renders normally against `collection` (which holds the
  // demo records). The signed-out empty-state is only ever reached
  // now if a user has explicitly signed out without enabling demo
  // mode — in that case `collection` is `[]` and the `length === 0`
  // branch below shows the empty-vault illustration.

  const summary = portfolio?.summary;

  return (
    <div style={{ padding: '0 0 16px' }}>

      {/* ═══ HERO: Collection Value ═══ */}
      {collection.length > 0 && (() => {
        const paid      = collection.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
        const marketVal = collection.reduce((s, i) => s + (Number(i.median_price || i.current_price) || 0), 0);
        const totalVal  = marketVal > 0 ? marketVal : paid;
        const gain      = marketVal > 0 ? marketVal - paid : 0;
        const gainPct   = paid > 0 ? Math.max(-999, Math.min(999, (gain / paid) * 100)) : 0;
        const gainColor = gain >= 0 ? '#4ade80' : '#f87171';
        const priceTracked = collection.filter(i => Number(i.median_price || i.current_price) > 0).length;
        // Items that were checked but Discogs has no marketplace data (not really "pending")
        const noMarketData = collection.filter(i =>
          i.last_price_check && !Number(i.median_price) && !Number(i.current_price)
        ).length;
        const trulyPending = collection.length - priceTracked - noMarketData;
        return (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + C.border }}>
            <div style={{ background: 'linear-gradient(135deg,#1a0800,#2a0a00,#1a0800)', border: '1px solid ' + C.accent, borderRadius: 14, padding: '16px', marginBottom: 10, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', right: -8, top: -8, fontSize: 70, ...BEBAS, opacity: 0.04, userSelect: 'none' }}>$</div>
              <div style={{ fontSize: 9, color: C.accent, ...MONO, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>💰 {t('vault.summary.value')}</div>
              <div style={{ ...BEBAS, fontSize: 44, color: C.text, lineHeight: 1, marginBottom: 6 }}>{totalVal > 0 ? formatPrice(totalVal, cur, fx) : '—'}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {paid > 0 && totalVal > 0 && (
                  // gain shown via formatChange so the prefix sign comes
                  // from one source of truth + symbol matches user currency

                  <span style={{ fontSize: 14, color: gainColor, ...MONO, fontWeight: 'bold' }}>
                    {(gain >= 0 ? '▲ ' : '▼ ') + formatChange(gain, cur, fx)}
                    <span style={{ fontSize: 10, opacity: 0.8, marginLeft: 4 }}>({gain >= 0 ? '+' : ''}{gainPct.toFixed(1)}%)</span>
                  </span>
                )}
                {paid > 0 && <span style={{ fontSize: 10, color: C.dim, ...MONO }}>{t('stats.paid', { n: formatPrice(paid, cur, fx) })}</span>}
              </div>
              <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 5 }}>
                {priceTracked > 0
                  ? ('Discogs · ' + priceTracked + '/' + collection.length)
                  : refreshResult
                    ? '✓ ' + refreshResult
                    : '⏳ —'}
                {priceTracked < collection.length && !refreshing && (
                  <button onClick={async () => {
                    setRefreshing(true); setRefreshResult(null);
                    const result = await onRefreshPrices?.();
                    if (result) setRefreshResult(result);
                    setRefreshing(false);
                  }} style={{
                    display: 'block', marginTop: 6,
                    background: 'linear-gradient(135deg,#dc2626,#991b1b)',
                    border: 'none', borderRadius: 8,
                    color: '#fff', padding: '8px 16px',
                    cursor: 'pointer', ...MONO, fontSize: 11,
                    letterSpacing: '0.05em',
                  }}>
                    {t('vault.refreshPrices')} ({trulyPending > 0 ? trulyPending + ' ' + t('vault.refreshPrices.pending') : t('vault.refreshPrices.refreshAll')})
                  </button>
                )}
                {refreshing && (
                  <div style={{ marginTop: 6, fontSize: 11, color: C.accent, ...MONO }}>
                    ⏳ Fetching prices… this takes ~{Math.ceil(collection.length / 10 * 0.6)}s
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {[
                { l: t('vault.summary.records'), v: summary?.itemCount ?? collection.length, c: C.accent },
                { l: t('stats.cards.totalPaid') || 'Paid', v: paid > 0 ? formatPrice(paid, cur, fx) : '—',  c: C.muted },
                { l: t('vault.summary.gain'),    v: gain !== 0 ? formatChange(gain, cur, fx) : '—', c: gainColor },
              ].map(s => (
                <div key={s.l} style={{ background: C.bg2, borderRadius: 8, padding: '8px', textAlign: 'center', border: '1px solid ' + C.border }}>
                  <div style={{ ...BEBAS, fontSize: 17, color: s.c, lineHeight: 1 }}>{s.v}</div>
                  <div style={{ fontSize: 8, color: C.dim, ...MONO, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Portfolio chart */}
      {portfolio?.snapshots?.length >= 2 && (
        <div style={{ padding: '16px', borderBottom: '1px solid ' + C.border }}>
          <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 10 }}>{t('stats.value.over.time')}</div>
          <PortfolioChart snapshots={portfolio.snapshots} />
        </div>
      )}

      {/* Sub-tabs Vinyl/Watchlist/Bands removed — these duplicate the top-level
          Vault sub-tabs (VAULT/WANTLIST/BANDS/FIND/STATS) in the parent IA.
          Always render the vinyl list directly. */}

      <div style={{ padding: '16px' }}>
          {/* Search + Add */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={vaultSearch} onChange={e => { setVaultSearch(e.target.value); setExpandedId(null); }}
              placeholder={t('vault.search')}
              style={{ ...inputSt, flex: 1, padding: '9px 12px', fontSize: 14 }} />
            <button onClick={() => setShowAddManual(true)}
              style={{ background: C.accent, border: 'none', borderRadius: 8, color: '#fff', padding: '0 16px', cursor: 'pointer', ...BEBAS, fontSize: 16, flexShrink: 0 }}>
              {'+ ' + t('common.add').toUpperCase()}
            </button>
          </div>
          {/* Filter pills — pan-x so Android doesn't trap vertical scrolls. */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', touchAction: 'pan-x' }}>
            {[
              ['all',       t('vault.filter.all')],
              ['for_sale',  t('vault.filter.forSale') || '💲 Na sprzedaż'],
              ['vinyl',     t('vault.filter.vinyl')],
              ['cd',        t('vault.filter.cd')],
              ['cassette',  t('vault.filter.cassette')],
              ['box_set',   t('vault.filter.boxSet')],
              ['limited',   t('vault.filter.limited')],
              ['no_price',  t('vault.filter.noPrice')],
            ].map(([id, label]) => (
              <button key={id} onClick={() => { setVaultFilter(id); setExpandedId(null); }}
                style={{ padding: '5px 11px', borderRadius: 20, whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 10, ...MONO, flexShrink: 0,
                  background: vaultFilter === id ? C.accent + '22' : C.bg3,
                  color: vaultFilter === id ? C.accent : C.dim,
                  border: '1px solid ' + (vaultFilter === id ? C.accent + '66' : C.border),
                }}>
                {label}
              </button>
            ))}
          </div>
          {/* Free plan: unlimited records */}
          {/* Vault Score */}
          {collection.length >= 3 && <VaultScore collection={collection} />}
          {/* Manual add modal */}
          {showAddManual && <ManualAddForm
            onAdd={async (item) => { if (onManualAdd) await onManualAdd(item); setShowAddManual(false); }}
            onClose={() => setShowAddManual(false)} />}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO }}>{t('vault.summary.records')} ({collection.length})</div>
            <select onChange={e => {
              const s = e.target.value;
              const sorted = [...collection].sort((a, b) => {
                if (s === 'artist')     return (a.artist || '').localeCompare(b.artist || '');
                if (s === 'price_asc')  return (Number(a.purchase_price) || 0) - (Number(b.purchase_price) || 0);
                if (s === 'price_desc') return (Number(b.purchase_price) || 0) - (Number(a.purchase_price) || 0);
                if (s === 'added')      return new Date(b.date_added || b.added_at || 0) - new Date(a.date_added || a.added_at || 0);
                return 0;
              });
              onUpdate(sorted);
            }} style={{ background: C.bg3, border: '1px solid ' + C.border, borderRadius: 6, color: C.muted, padding: '5px 8px', fontSize: 11, ...MONO, cursor: 'pointer', outline: 'none' }}>
              <option value="added">{t('vault.sort.added')}</option>
              <option value="artist">{t('vault.sort.artist')}</option>
              <option value="price_desc">{t('vault.sort.priceDesc')}</option>
              <option value="price_asc">{t('vault.sort.priceAsc')}</option>
            </select>
          </div>

          {collection.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button onClick={async () => {
                if (!(await mvConfirm(t('vault.bulk.removeDuplicatesConfirm')))) return;
                const seen = new Set(); const toDelete = [];
                [...collection].sort((a, b) => new Date(b.added_at) - new Date(a.added_at)).forEach(i => {
                  const key = (i.discogs_id || '') + '::' + i.artist + '::' + i.album;
                  if (seen.has(key)) toDelete.push(i.id); else seen.add(key);
                });
                if (toDelete.length === 0) return;
                await fetch('/api/collection/batch', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: toDelete }) });
                const fresh = await fetch('/api/collection').then(r => r.json());
                if (fresh.items) onUpdate(fresh.items);
              }} style={{ flex: 1, padding: '7px', background: '#1a0a00', border: '1px solid #92400e', borderRadius: 7, color: '#f97316', cursor: 'pointer', fontSize: 10, ...MONO }}>
                {t('vault.bulk.removeDuplicates')}
              </button>
              <button onClick={async () => {
                if (!(await mvConfirm(t('vault.bulk.deleteAllConfirm'), { kind: 'danger', confirmLabel: t('vault.bulk.deleteAll') }))) return;
                const ids = collection.map(i => i.id);
                await fetch('/api/collection/batch', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
                onUpdate([]);
              }} style={{ flex: 1, padding: '7px', background: '#1a0000', border: '1px solid #7f1d1d', borderRadius: 7, color: '#f87171', cursor: 'pointer', fontSize: 10, ...MONO }}>
                🗑 {t('vault.bulk.deleteAll')}
              </button>
            </div>
          )}

          {collection.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 24px' }}>
              {/* Illustration: empty vault */}
              <svg width="120" height="120" viewBox="0 0 120 120" style={{ marginBottom: 16 }}>
                <defs>
                  <linearGradient id="vaultGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2a0a0a"/><stop offset="100%" stopColor="#0a0a0a"/>
                  </linearGradient>
                </defs>
                <rect x="20" y="28" width="80" height="72" rx="6" fill="url(#vaultGrad)" stroke="#3a1010" strokeWidth="2"/>
                <rect x="30" y="38" width="60" height="6" rx="2" fill="#1a0505"/>
                <rect x="30" y="50" width="60" height="6" rx="2" fill="#1a0505"/>
                <rect x="30" y="62" width="60" height="6" rx="2" fill="#1a0505"/>
                <rect x="30" y="74" width="60" height="6" rx="2" fill="#1a0505"/>
                <circle cx="60" cy="92" r="4" fill="#dc2626"/>
                <path d="M52 20 L68 20 L68 28 L52 28 Z" fill="#2a0a0a" stroke="#3a1010" strokeWidth="1.5"/>
              </svg>
              <div style={{ ...BEBAS, fontSize: 22, color: C.text, letterSpacing: '0.04em', marginBottom: 6 }}>
                {t('empty.vault.title')}
              </div>
              <div style={{ fontSize: 12, color: C.muted, ...MONO, marginBottom: 24, lineHeight: 1.5 }}>
                {t('empty.vault.desc')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320, margin: '0 auto' }}>
                {!discogsConnected && onConnectDiscogs && (
                  <button onClick={onConnectDiscogs}
                    style={{ width: '100%', padding: '14px',
                      background: 'linear-gradient(135deg,#1a1a00,#2a2800)',
                      border: '1px solid #f5c842', borderRadius: 10,
                      color: '#f5c842', cursor: 'pointer',
                      ...BEBAS, fontSize: 15, letterSpacing: '0.08em',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <Icon name="external" size={18} color="#f5c842"/>
                    {t('empty.vault.connect').replace('🔗 ', '').replace('🔗', '')}
                  </button>
                )}
                {discogsConnected && (
                  <div style={{ fontSize: 10, color: '#4ade80', ...MONO, padding: '6px 0' }}>
                    ✓ Discogs connected — sync happens automatically
                  </div>
                )}
                <button onClick={() => setShowAddManual(true)}
                  style={{ width: '100%', padding: '14px',
                    background: 'linear-gradient(135deg,#dc2626,#991b1b)',
                    border: 'none', borderRadius: 10,
                    color: '#fff', cursor: 'pointer',
                    ...BEBAS, fontSize: 15, letterSpacing: '0.08em',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <Icon name="add" size={18} color="#fff"/>
                  {t('empty.vault.add').replace('＋ ', '').replace('＋', '')}
                </button>
                <button onClick={() => window.dispatchEvent(new CustomEvent('mv:open-scanner'))}
                  style={{ width: '100%', padding: '12px',
                    background: 'transparent',
                    border: '1px solid ' + C.border, borderRadius: 10,
                    color: C.muted, cursor: 'pointer',
                    ...MONO, fontSize: 12, letterSpacing: '0.08em',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Icon name="scan" size={14} color={C.muted}/>
                  {t('empty.vault.scan').replace('📷 ', '').replace('📷', '')}
                </button>
                <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 8, lineHeight: 1.6 }}>
                  {t('empty.vault.tip')}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(() => {
                const visibleItems = collection.filter(item => {
                  const q = vaultSearch.toLowerCase();
                  if (q && !item.artist?.toLowerCase().includes(q) && !item.album?.toLowerCase().includes(q)) return false;
                  if (vaultFilter === 'vinyl')    return (item.format || '').toLowerCase().includes('vinyl') || !item.format;
                  if (vaultFilter === 'cd')       return (item.format || '').toLowerCase().includes('cd');
                  if (vaultFilter === 'cassette') return (item.format || '').toLowerCase().includes('cassette');
                  if (vaultFilter === 'box_set')  return (item.format || '').toLowerCase().includes('box');
                  if (vaultFilter === 'limited')  return (item.format || '').toLowerCase().includes('limited');
                  if (vaultFilter === 'no_price') return !item.purchase_price;
                  // For-sale surface: when this filter is active the
                  // user is asking "show me what I'm currently selling".
                  // Mirrors the badge rendered on each card below.
                  if (vaultFilter === 'for_sale') return item.for_sale === true;
                  return true;
                });
                if (visibleItems.length === 0) return (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: C.dim, ...MONO, fontSize: 12 }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
                    No records match
                    <div style={{ marginTop: 12 }}>
                      <button onClick={() => { setVaultSearch(''); setVaultFilter('all'); }}
                        style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.accent, padding: '6px 14px', cursor: 'pointer', ...MONO, fontSize: 10 }}>
                        Clear filters
                      </button>
                    </div>
                  </div>
                );
                return visibleItems.map(item => {
                  const isExpanded = expandedId === item.id;
                  const paid = Number(item.purchase_price) || 0;
                  const now  = Number(item.median_price || item.current_price) || 0;
                  const gain = paid > 0 && now > 0 ? now - paid : null;
                  const gainPct = gain !== null ? Math.max(-999, Math.min(999, (gain / paid) * 100)) : null;
                  return (
                  <div key={item.id} style={{ background: C.bg2, border: '1px solid ' + (isExpanded ? C.accent + '44' : C.border), borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.2s' }}
                      onTouchCancel={e=>e.currentTarget.style.background=C.bg2}>
                    {/* ── Collapsed row — always visible ── */}
                    <div onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      style={{ display: 'flex', gap: 10, padding: '10px 12px', alignItems: 'center', cursor: 'pointer' }}>
                      {AlbumCover && <AlbumCover src={item.cover} artist={item.artist} size={44} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...BEBAS, fontSize: 15, color: C.text, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.artist}</div>
                        <div style={{ fontSize: 10, color: C.muted, ...MONO, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.album}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                          {item.grade && item.grade !== 'NM' && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: GRADE_COLOR[item.grade] + '22', color: GRADE_COLOR[item.grade], ...MONO }}>{item.grade}</span>}
                          {/* Detailed grading chips — Pro only, compact S/V/I labels */}
                          {premium && item.sleeve_grade && (
                            <span title={'Sleeve: ' + item.sleeve_grade} style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: GRADE_COLOR[item.sleeve_grade] + '22', color: GRADE_COLOR[item.sleeve_grade], ...MONO, border: '1px solid ' + GRADE_COLOR[item.sleeve_grade] + '44' }}>
                              S:{item.sleeve_grade}
                            </span>
                          )}
                          {premium && item.vinyl_grade && (
                            <span title={'Vinyl: ' + item.vinyl_grade} style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: GRADE_COLOR[item.vinyl_grade] + '22', color: GRADE_COLOR[item.vinyl_grade], ...MONO, border: '1px solid ' + GRADE_COLOR[item.vinyl_grade] + '44' }}>
                              V:{item.vinyl_grade}
                            </span>
                          )}
                          {premium && item.hype_sticker && (
                            <span title="Original hype sticker intact" style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#f5c84222', color: '#f5c842', ...MONO }}>
                              🏷️ HYPE
                            </span>
                          )}
                          {item.format && item.format !== 'Vinyl' && <span style={{ fontSize: 8, color: C.dim, ...MONO, padding: '1px 4px', background: C.bg3, borderRadius: 3 }}>{item.format}</span>}
                          {/* "💲 LISTED" badge — surfaces items the user
                              has marked for sale via ForSaleToggle.
                              Without this badge there's no UI surface
                              showing what's currently listed; the data
                              was being saved silently. */}
                          {item.for_sale && (
                            <span title={item.asking_price ? '$' + Number(item.asking_price).toFixed(2) : ''}
                              style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3,
                                background: '#1a3d1a', color: '#4ade80',
                                border: '1px solid #4ade8044', ...MONO,
                                letterSpacing: '0.05em' }}>
                              💲 {item.asking_price
                                  ? Number(item.asking_price).toFixed(0) + ' USD'
                                  : (t('forSale.listedShort') || 'LISTED')}
                            </span>
                          )}
                          {paid > 0 && <span style={{ fontSize: 9, color: '#f5c842', ...MONO }}>{formatPrice(paid, cur, fx)}</span>}
                          {/* "from X" market price — explicitly labelled
                              "od" (from) to make clear this is the LOWEST
                              currently-listed price across ALL variants on
                              Discogs, not the price of the specific variant
                              the user owns. Earlier "→X" with arrow + ▲/▼
                              direction implied "current value of your
                              record" which misled users into thinking
                              their gold limited edition was worth 42 zł
                              when it was actually selling at 508 zł.
                              Gain indicator only fires when paid is within
                              the same order of magnitude (paid/2 ≤ now ≤
                              paid×2) — otherwise the comparison is
                              meaningless and we hide ▲/▼ entirely. */}
                          {now > 0 && (() => {
                            const showGain = paid > 0
                              && now >= paid / 2
                              && now <= paid * 2;
                            const color = !showGain ? C.muted
                              : gain >= 0 ? '#4ade80' : '#f87171';
                            return (
                              <span style={{ fontSize: 9, color, ...MONO }}
                                title="Najniższa aktualna cena na rynku Discogs (różne warianty mogą mieć inne ceny — sprawdź listę wariantów w karcie)">
                                od {formatPrice(now, cur, fx)}
                                {showGain && (gain >= 0 ? ' ▲' : ' ▼')}
                              </span>
                            );
                          })()}
                          {now === 0 && paid > 0 && (
                            // Was an ⏳ hourglass — users read it as a live
                            // spinner ("keeps searching for the last record's
                            // price") even though no fetch is in flight.
                            // Plain dash + tooltip is unambiguous.
                            <span title={t('vault.refreshPrices.pending')}
                              style={{ fontSize: 9, color: '#666', ...MONO }}>—</span>
                          )}
                          {/* Rarity badge — uses Discogs num_for_sale */}
                          {(() => {
                            const r = rarityFromCount(item.num_for_sale);
                            // Hide for "Available" (1/5) — too common to be informative
                            if (!r || r.score <= 1) return null;
                            return <span title={r.description} style={{ fontSize: 8, color: r.color, ...MONO, padding: '1px 5px', background: r.color + '22', border: '1px solid ' + r.color + '55', borderRadius: 3, fontWeight: 600 }}>{r.label.toUpperCase()}</span>;
                          })()}
                          {/* Holding period badge — free for all, shown only when ≥ 30 days */}
                          {(() => { const hp = holdingPeriod(item.added_at); return hp ? <span title={'In your vault for ' + hp} style={{ fontSize: 8, color: C.dim, ...MONO, padding: '1px 4px', background: C.bg3, borderRadius: 3 }}>{hp}</span> : null; })()}
                          {/* Per-record price sparkline — Pro feature, last 30 days median */}
                          {premium && item.discogs_id && priceHistories[String(item.discogs_id)] && priceHistories[String(item.discogs_id)].length >= 2 && (
                            <span title="30-day price trend" style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 'auto' }}>
                              <Sparkline values={priceHistories[String(item.discogs_id)]} width={48} height={14} strokeWidth={1.4}/>
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                        onClick={e => e.stopPropagation()}>
                        {/* Listen logger — 1-tap on this play, long-press for full modal.
                            Click swallowed via wrapper above so we don't expand the card. */}
                        <ListenButton
                          item={item}
                          compact
                          premium={premium}
                          onUpgrade={onUpgrade}
                          onLogged={(updated) => {
                            // Patch one item in-place. Parent state holds the array.
                            const next = collection.map(c => c.id === updated.id ? { ...c, ...updated } : c);
                            onUpdate(next);
                          }}
                        />
                        {onToggleFollow && (
                          <button
                            onClick={e => { e.stopPropagation(); onToggleFollow(item.artist); }}
                            title={followedArtists.some(a => a.artist_name === item.artist) ? 'Unfollow' : 'Follow artist'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
                              color: followedArtists.some(a => a.artist_name === item.artist) ? C.accent : C.ultra,
                              padding: '8px 10px', lineHeight: 1, minWidth: 40, textAlign: 'center' }}>
                            {followedArtists.some(a => a.artist_name === item.artist) ? '🔔' : '🔕'}
                          </button>
                        )}
                        {/* Delete — always visible so long titles don't hide it */}
                        <button
                          onClick={e => { e.stopPropagation(); if (expandedId === item.id) setExpandedId(null); onRemove(item.id); }}
                          aria-label={t('collection.removeItem')}
                          title={t('collection.removeItem')}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18,
                            color: '#555', padding: '11px 12px', lineHeight: 1, minWidth: 44, minHeight: 44, textAlign: 'center' }}>
                          ×
                        </button>
                        {/* Expand chevron */}
                        <div style={{ fontSize: 18, color: C.dim, transition: 'transform 0.2s',
                          transform: isExpanded ? 'rotate(180deg)' : 'none',
                          padding: '8px 10px', minWidth: 40, textAlign: 'center' }}>⌄</div>
                      </div>
                    </div>

                    {/* ── Expanded detail ── */}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid ' + C.border, padding: '10px 12px' }}>
                        {/* Open full album modal (variants + photos + sell + market).
                            Without this CTA, collection users never reach the
                            VariantTracker / ForSaleToggle / PhotoUploader because
                            the row stays inline-expanded instead of opening the
                            sheet. discogs_id required — manually-added items
                            without it have nothing extra to show. */}
                        {item.discogs_id && onAlbumClick && (
                          <button
                            onClick={() => onAlbumClick({
                              ...item,
                              // VinylModal uses album.id; for Collection items
                              // pass the Discogs release id so VariantTracker
                              // resolves the master.
                              id:           item.discogs_id,
                              releaseDate:  item.year ? String(item.year) : null,
                            })}
                            style={{
                              width: '100%', marginBottom: 10, padding: '10px',
                              background: 'linear-gradient(135deg,#1a0a0a,#2a0a0a)',
                              border: '1px solid ' + C.accent + '66',
                              borderRadius: 8, color: C.accent, cursor: 'pointer',
                              ...MONO, fontSize: 11, letterSpacing: '0.06em',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            }}>
                            🔍 {t('collection.openAllVariants') || 'View all variants + market'}
                          </button>
                        )}
                        {/* Price + gain */}
                        {(paid > 0 || now > 0) && (
                          <div style={{ display: 'flex', gap: 12, marginBottom: 10, padding: '8px 10px', background: C.bg3, borderRadius: 8 }}>
                            {paid > 0 && <div><div style={{ fontSize: 8, color: C.dim, ...MONO, textTransform: 'uppercase', marginBottom: 2 }}>Paid</div><div style={{ ...BEBAS, fontSize: 18, color: '#f5c842' }}>{formatPrice(paid, cur, fx)}</div></div>}
                            {now > 0  && <div><div style={{ fontSize: 8, color: C.dim, ...MONO, textTransform: 'uppercase', marginBottom: 2 }}>Market</div><div style={{ ...BEBAS, fontSize: 18, color: '#4ade80' }}>{formatPrice(now, cur, fx)}</div></div>}
                            {gain !== null && <div><div style={{ fontSize: 8, color: C.dim, ...MONO, textTransform: 'uppercase', marginBottom: 2 }}>Gain</div><div style={{ ...BEBAS, fontSize: 18, color: gain >= 0 ? '#4ade80' : '#f87171' }}>{formatChange(gain, cur, fx)}<span style={{ fontSize: 11 }}> ({gainPct >= 0 ? '+' : ''}{gainPct?.toFixed(0)}%)</span></div></div>}
                          </div>
                        )}
                        {/* Grade */}
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 9, color: C.dim, ...MONO, marginRight: 2 }}>Grade:</span>
                          {VINYL_GRADES.map(g => (
                            <button key={g} onClick={async () => {
                              // Optimistic: update locally first, then PATCH
                              const optimistic = collection.map(i => i.id === item.id ? { ...i, grade: g } : i);
                              onUpdate(optimistic);
                              try {
                                const res = await fetch('/api/collection?id=' + item.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grade: g }) });
                                if (!res.ok) throw new Error('PATCH failed');
                              } catch {
                                const fresh = await fetch('/api/collection').then(r => r.json());
                                if (fresh.items) onUpdate(fresh.items);
                              }
                            }} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid ' + (item.grade === g ? GRADE_COLOR[g] : C.border), background: item.grade === g ? GRADE_COLOR[g] + '22' : C.bg3, color: item.grade === g ? GRADE_COLOR[g] : C.dim, ...MONO }}>{g}</button>
                          ))}
                        </div>

                        {/* Detailed grading — Pro feature. Collapsed by default, expands on click. */}
                        {premium ? (
                          <div style={{ marginBottom: 8 }}>
                            <button onClick={() => {
                              if (gradingExpandedId === item.id) { setGradingExpandedId(null); return; }
                              // Init draft from current values
                              setGradingDraft(d => ({ ...d, [item.id]: {
                                sleeve_grade:       item.sleeve_grade       || '',
                                vinyl_grade:        item.vinyl_grade        || '',
                                inner_sleeve_grade: item.inner_sleeve_grade || '',
                                hype_sticker:       !!item.hype_sticker,
                                playback_notes:     item.playback_notes     || '',
                              }}));
                              setGradingExpandedId(item.id);
                            }} style={{ background: 'none', border: '1px dashed ' + C.border, borderRadius: 6,
                              color: (item.sleeve_grade || item.vinyl_grade) ? '#f5c842' : C.dim,
                              padding: '5px 10px', cursor: 'pointer', ...MONO, fontSize: 10, width: '100%', textAlign: 'left' }}>
                              {(item.sleeve_grade || item.vinyl_grade || item.inner_sleeve_grade)
                                ? t('grading.editHint')
                                : t('grading.add') + ' ' + (gradingExpandedId === item.id ? '▴' : '▾')}
                            </button>

                            {gradingExpandedId === item.id && (() => {
                              const draft = gradingDraft[item.id] || {};
                              const updateDraft = (key, val) => setGradingDraft(d => ({ ...d, [item.id]: { ...d[item.id], [key]: val } }));
                              const GradeRow = ({ label, value, onChange, hint }) => (
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontSize: 9, color: C.muted, ...MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>
                                    {label}{hint && <span style={{ color: C.dim, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>· {hint}</span>}
                                  </div>
                                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                    <button onClick={() => onChange('')}
                                      style={{ fontSize: 9, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                                        border: '1px solid ' + (!value ? C.accent : C.border),
                                        background: !value ? C.accent + '22' : C.bg3,
                                        color: !value ? C.accent : C.dim, ...MONO }}>—</button>
                                    {VINYL_GRADES.map(g => (
                                      <button key={g} onClick={() => onChange(g)}
                                        style={{ fontSize: 9, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                                          border: '1px solid ' + (value === g ? GRADE_COLOR[g] : C.border),
                                          background: value === g ? GRADE_COLOR[g] + '22' : C.bg3,
                                          color: value === g ? GRADE_COLOR[g] : C.dim, ...MONO }}>{g}</button>
                                    ))}
                                  </div>
                                </div>
                              );
                              return (
                                <div style={{ background: C.bg3, border: '1px solid ' + C.border, borderRadius: 8, padding: 10, marginTop: 6 }}>
                                  <GradeRow label={t('grading.sleeveLabel')} hint={t('grading.sleeveHint')}
                                    value={draft.sleeve_grade || ''} onChange={v => updateDraft('sleeve_grade', v)}/>
                                  <GradeRow label={t('grading.vinylLabel')} hint={t('grading.vinylHint')}
                                    value={draft.vinyl_grade || ''} onChange={v => updateDraft('vinyl_grade', v)}/>
                                  <GradeRow label={t('grading.innerLabel')} hint={t('grading.innerHint')}
                                    value={draft.inner_sleeve_grade || ''} onChange={v => updateDraft('inner_sleeve_grade', v)}/>
                                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input type="checkbox" id={'hs-' + item.id}
                                      checked={!!draft.hype_sticker}
                                      onChange={e => updateDraft('hype_sticker', e.target.checked)}
                                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: C.accent }}/>
                                    <label htmlFor={'hs-' + item.id} style={{ fontSize: 11, color: C.text, ...MONO, cursor: 'pointer' }}>
                                      {t('grading.hypeLabel')}
                                    </label>
                                  </div>
                                  <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontSize: 9, color: C.muted, ...MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>
                                      {t('grading.notesLabel')} <span style={{ color: C.dim, textTransform: 'none', letterSpacing: 0 }}>· {t('grading.notesHint')}</span>
                                    </div>
                                    <textarea value={draft.playback_notes || ''}
                                      onChange={e => updateDraft('playback_notes', e.target.value)}
                                      placeholder={t('grading.notesPh')}
                                      rows={2}
                                      style={{ width: '100%', background: C.bg2, border: '1px solid ' + C.border,
                                        borderRadius: 6, color: C.text, padding: '7px 9px', fontSize: 12,
                                        ...MONO, outline: 'none', resize: 'vertical', boxSizing: 'border-box', minHeight: 50 }}/>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => setGradingExpandedId(null)}
                                      style={{ flex: 1, background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, padding: '8px', cursor: 'pointer', ...MONO, fontSize: 11 }}>
                                      {t('common.cancel')}
                                    </button>
                                    <button onClick={() => saveGrading(item.id)} disabled={gradingSaving}
                                      style={{ flex: 2, background: '#f5c842', border: 'none', borderRadius: 6, color: '#1a0800', padding: '8px', cursor: 'pointer', ...BEBAS, fontSize: 13, letterSpacing: '0.06em', opacity: gradingSaving ? 0.5 : 1 }}>
                                      {gradingSaving ? t('grading.saving') : t('grading.save')}
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <button onClick={() => window.dispatchEvent(new CustomEvent('mv:upgrade', { detail: { reason: 'DETAILED_GRADING' } }))}
                            style={{ background: 'none', border: '1px dashed ' + C.border, borderRadius: 6,
                              color: C.dim, padding: '5px 10px', cursor: 'pointer', ...MONO, fontSize: 10,
                              width: '100%', textAlign: 'left', marginBottom: 8 }}>
                            {t('grading.proCta')} · <span style={{ color: '#f5c842' }}>PRO</span>
                          </button>
                        )}
                        {/* Set price — inline input matching watchlist pattern (works on iOS) */}
                        {showAlertForm === item.id + '_price' ? (
                          // Wrapped as <form> + type="submit" so a single tap on
                          // OK or Enter on mobile keyboards both submit through
                          // the same code path. Without the form, mobile Safari
                          // would consume the first tap to dismiss the soft
                          // keyboard (input loses focus → blur fires) and the
                          // user had to tap OK twice.
                          (() => {
                            // Two anti-flakiness measures:
                            //   (a) Read the input value DIRECTLY from the DOM
                            //       on submit — mobile keyboards commit the
                            //       final keystroke asynchronously and the tap
                            //       on OK can fire before React state catches
                            //       up. DOM value is always current.
                            //   (b) DON'T refetch after PATCH. Supabase read-
                            //       replica lag can return the stale (pre-PATCH)
                            //       row even seconds after a successful write.
                            //       That caused the "save twice" bug: PATCH
                            //       succeeded, refetch read the stale replica,
                            //       UI flipped back to the OLD price, user
                            //       thought save failed and re-entered. Now we
                            //       trust the PATCH response (authoritative)
                            //       and merge that single row into local state.
                            const submitPrice = async (rawValue) => {
                              const n = parseFloat(String(rawValue ?? '').trim().replace(',','.'));
                              if (isNaN(n) || n < 0) {
                                setShowAlertForm(null); setPriceInputVal('');
                                return;
                              }
                              const prevPrice = item.purchase_price;
                              // Optimistic + close form immediately. If PATCH
                              // succeeds we just overwrite with the server row.
                              const optimistic = collection.map(c =>
                                c.id === item.id ? { ...c, purchase_price: n } : c);
                              onUpdate(optimistic);
                              setShowAlertForm(null); setPriceInputVal('');

                              try {
                                const r = await fetch('/api/collection?id=' + item.id, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ purchase_price: n }),
                                });
                                if (!r.ok) throw new Error('PATCH failed');
                                const body = await r.json().catch(() => ({}));
                                // Use the row returned by PATCH directly. The
                                // SAME request that wrote it returns it — no
                                // replica round-trip, no race. If for some
                                // reason the body lacks .item, fall back to
                                // the optimistic state (already applied above).
                                if (body && body.item) {
                                  const merged = collection.map(c =>
                                    c.id === item.id ? { ...c, ...body.item } : c);
                                  onUpdate(merged);
                                }
                                try { window.dispatchEvent(new Event('mv-collection-changed')); } catch {}
                              } catch {
                                const reverted = collection.map(c =>
                                  c.id === item.id ? { ...c, purchase_price: prevPrice } : c);
                                onUpdate(reverted);
                                toast.error(t('vault.priceModal.saveFailed'));
                              }
                            };
                            return (
                              <form onSubmit={e => {
                                  e.preventDefault();
                                  // Pull value straight from the <input> DOM
                                  // node — bypasses any stale React state on
                                  // mobile keyboards where the last keystroke
                                  // hasn't committed yet.
                                  const inp = e.currentTarget.querySelector('input[type=number]');
                                  submitPrice(inp ? inp.value : priceInputVal);
                                }}
                                style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                                <span style={{ ...BEBAS, fontSize: 18, color: C.muted }}>$</span>
                                <input type="number" inputMode="decimal" step="0.01"
                                  defaultValue={priceInputVal}
                                  onChange={e => setPriceInputVal(e.target.value)}
                                  placeholder={t('vault.priceModal.placeholder')} autoFocus
                                  style={{ flex: 1, background: C.bg3, border: '1px solid ' + C.border,
                                    borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 16,
                                    ...MONO, outline: 'none' }} />
                                <button type="submit"
                                  // Force-commit on tap-start so the iOS keyboard
                                  // doesn't swallow the final keystroke before
                                  // the touch event fires submit.
                                  onTouchEnd={e => {
                                    const form = e.currentTarget.closest('form');
                                    const inp = form?.querySelector('input[type=number]');
                                    if (inp) inp.blur();
                                  }}
                                  style={{ padding: '10px 18px', background: C.accent, border: 'none',
                                    borderRadius: 8, color: '#fff', cursor: 'pointer', ...BEBAS, fontSize: 16, flexShrink: 0 }}>
                                  {t('alert.ok')}
                                </button>
                                <button type="button"
                                  onClick={() => { setShowAlertForm(null); setPriceInputVal(''); }}
                                  style={{ padding: '8px 10px', background: 'none', border: '1px solid ' + C.border,
                                    borderRadius: 6, color: C.dim, cursor: 'pointer', fontSize: 14 }}>✕</button>
                              </form>
                            );
                          })()
                        ) : (
                          <button onClick={() => {
                            setPriceInputVal(item.purchase_price ? String(item.purchase_price) : '');
                            setShowAlertForm(item.id + '_price');
                          }}
                            style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 6,
                              color: item.purchase_price ? C.gold : C.dim,
                              padding: '8px 12px', cursor: 'pointer', ...MONO, fontSize: 11, marginBottom: 8, minHeight: 36 }}>
                            {item.purchase_price
                              ? t('vault.priceModal.editBtn', { n: formatPrice(Number(item.purchase_price), cur, fx) })
                              : t('vault.priceModal.setBtn')}
                          </button>
                        )}
                        {/* Alert + Delete */}
                        {(() => {
                          // Look up active alert for this item — keyed by
                          // collection_id first (covers manual additions
                          // without discogs_id), falling back to discogs_id.
                          const alertKey = activeAlerts[String(item.id)]
                            ? String(item.id)
                            : (item.discogs_id ? String(item.discogs_id) : null);
                          const myAlert = alertKey ? activeAlerts[alertKey] : null;
                          return (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {item.discogs_id && (showAlertForm === item.id ? (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <select value={alertType} onChange={e => setAlertType(e.target.value)} style={{ ...inputSt, padding: '5px 8px', fontSize: 11 }}>
                                <option value="PRICE_DROP">{t('alert.type.priceDrop')}</option>
                                <option value="PRICE_RISE">{t('alert.type.priceRise')}</option>
                                <option value="PERCENT_DROP">{t('alert.type.percentDrop')}</option>
                                <option value="PERCENT_RISE">{t('alert.type.percentRise')}</option>
                                <option value="LOW_STOCK">{t('alert.type.lowStock')}</option>
                              </select>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input type="number" value={targetPrice} onChange={e => setTargetPrice(e.target.value)}
                                  placeholder={
                                    alertType === 'PERCENT_DROP' || alertType === 'PERCENT_RISE' ? t('alert.placeholderPct')
                                    : alertType === 'LOW_STOCK' ? t('alert.placeholderCopies')
                                    : t('alert.placeholderPrice')
                                  }
                                  style={{ ...inputSt, padding: '6px 10px', fontSize: 14, flex: 1 }} />
                                <button onClick={() => createAlert(item)} disabled={saving} style={{ background: C.accent, border: 'none', borderRadius: 6, color: '#fff', padding: '7px 12px', cursor: 'pointer', ...BEBAS, fontSize: 14 }}>{saving ? '…' : t('alert.ok')}</button>
                                <button onClick={() => {
                                  setShowAlertForm(null);
                                  setAlertType('PRICE_DROP');
                                  setTargetPrice('');
                                  setEditingAlertId(null);
                                }} style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, padding: '7px 8px', cursor: 'pointer', fontSize: 11 }}>✕</button>
                              </div>
                            </div>
                          ) : myAlert ? (
                            // Item already has an alert — show "Active"
                            // badge with target price + edit + delete.
                            // The whole label is also clickable to open
                            // the form pre-populated for edit (matches
                            // the Vault → Watchlist UX where tapping
                            // the badge opens edit mode).
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6,
                              background: '#1a1500', border: '1px solid #5a4a00', borderRadius: 6,
                              color: '#f5c842', padding: '6px 10px', ...MONO, fontSize: 10 }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); startEditAlert(item, myAlert); }}
                                style={{ flex: 1, background: 'none', border: 'none',
                                  color: 'inherit', textAlign: 'left', padding: 0,
                                  cursor: 'pointer', font: 'inherit' }}>
                                🔔 {myAlert.type === 'PRICE_DROP'   ? t('alert.activePrice',   { n: myAlert.price })
                                  : myAlert.type === 'PERCENT_DROP' ? t('alert.activePercent', { n: myAlert.price })
                                  : myAlert.type === 'LOW_STOCK'    ? t('alert.activeStock',   { n: myAlert.price })
                                  : t('alert.activePrice', { n: myAlert.price })}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); checkAlertsNow(); }}
                                aria-label={t('alert.checkNow') || 'Check alerts now'}
                                title={t('alert.checkNow') || 'Check alerts now'}
                                style={{ background: 'none', border: 'none', color: '#4ade80',
                                  cursor: 'pointer', fontSize: 12, padding: '0 4px', lineHeight: 1 }}>▶</button>
                              <button
                                onClick={(e) => { e.stopPropagation(); startEditAlert(item, myAlert); }}
                                aria-label={t('alert.editTitle') || 'Edit alert'}
                                title={t('alert.editTitle') || 'Edit alert'}
                                style={{ background: 'none', border: 'none', color: '#f5c842',
                                  cursor: 'pointer', fontSize: 12, padding: '0 4px', lineHeight: 1 }}>✎</button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (await mvConfirm(t('alert.confirmRemove'), { kind: 'danger', confirmLabel: t('common.delete') })) {
                                    deleteAlert(alertKey, myAlert.id);
                                  }
                                }}
                                aria-label={t('alert.removeTitle')}
                                style={{ background: 'none', border: 'none', color: '#f87171',
                                  cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 }}>×</button>
                            </div>
                          ) : (
                            <button onClick={() => setShowAlertForm(item.id)} style={{ flex: 1, background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, padding: '6px 10px', cursor: 'pointer', ...MONO, fontSize: 10 }}>🔔 {t('alert.set')}</button>
                          ))}
                          <button onClick={() => { if (expandedId === item.id) setExpandedId(null); onRemove(item.id); }} style={{ background: 'none', border: '1px solid #7f1d1d', borderRadius: 6, color: '#f87171', padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>🗑</button>
                        </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

      {/* ═══ PRICE MODAL — rendered outside card list to avoid iOS re-render bug ═══ */}
      {priceModalItem && (
        <PriceModal
          item={priceModalItem}
          onClose={() => setPriceModalItem(null)}
          onSave={async (n) => {
            // Same anti-flakiness as the inline editor above: use the
            // PATCH response directly instead of refetching the full
            // collection. Refetch hit Supabase read-replicas with lag
            // and returned the pre-PATCH row, flipping the UI back to
            // the old price → user thought save failed → re-entered.
            try {
              const r = await fetch('/api/collection?id=' + priceModalItem.id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ purchase_price: n }),
              });
              if (!r.ok) throw new Error('PATCH failed');
              const body = await r.json().catch(() => ({}));
              if (body && body.item) {
                const merged = collection.map(c =>
                  c.id === priceModalItem.id ? { ...c, ...body.item } : c);
                onUpdate(merged);
              } else {
                // Fallback: optimistic patch on this one field.
                const merged = collection.map(c =>
                  c.id === priceModalItem.id ? { ...c, purchase_price: n } : c);
                onUpdate(merged);
              }
              try { window.dispatchEvent(new Event('mv-collection-changed')); } catch {}
            } catch {
              toast.error(t('vault.priceModal.saveFailed'));
            }
            setPriceModalItem(null);
          }}
        />
      )}
    </div>
  );
}
