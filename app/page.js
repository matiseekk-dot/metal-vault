'use client';
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';
import { loadLS, saveLS } from '@/lib/localStorage';
import { useCollection } from '@/lib/hooks/useCollection';
import { AlbumCard, VinylModal, StatsBar, BottomNav, AlbumCover } from '@/app/components/ui';
import { CollectionTab, WatchlistTab } from '@/app/collection/CollectionTab';
import ErrorBoundary from '@/app/components/ErrorBoundary';
import OnboardingScreen from '@/app/components/OnboardingScreen';
import { initPayments, startPurchase, openSubscriptionManagement, restorePurchases } from '@/lib/payments';
import Icon from '@/app/components/Icon';
import UpgradeModal from '@/app/components/UpgradeModal';
import ArtistInfoModal from '@/app/components/ArtistInfoModal';
import { useCurrency, useFx, formatPrice, formatChange } from '@/lib/currency';
import WhatsNew from '@/app/components/WhatsNew';
import DemoBanner from '@/app/components/DemoBanner';
import RepressBanner from '@/app/components/RepressBanner';
import ThisDayModal from '@/app/components/ThisDayModal';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { toast, confirm } from '@/app/components/Toast';
import { useT } from '@/lib/i18n';
import {
  identify as analyticsIdentify,
  reset    as analyticsReset,
  track,
  trackPurchaseCompleted,
} from '@/lib/analytics';
import VaultTab from '@/app/vault/VaultTab';
import WhensOnTab from '@/app/whens-on/WhensOnTab';
import ProfileTab from '@/app/profile/ProfileTab';
import nextDynamic from 'next/dynamic';
export const dynamic = 'force-dynamic';

// Why VaultTab/WhensOnTab/ProfileTab are STATIC imports (not next/dynamic):
// They each statically import their own children — VaultTab pulls in
// CollectionTab, SearchTab, StatsTab, BandsTab, ConcertsTab, CalendarTab.
// We tried dynamic-importing these parents to shave ~200kB off the initial
// bundle but it caused a tree-shake collision: Webpack ended up with two
// copies of the same module graph (one through page.js's dynamic import,
// one through VaultTab's static imports), the prod build threw
// "VaultTab is not defined" runtime errors, and Calendar/Stats/Live/Dziennik
// stopped rendering for the user. The bundle-size win is not worth a
// broken app — keep them static. If we want lazy-loading later, the right
// place to do it is INSIDE VaultTab/WhensOnTab (per-sub-tab dynamic imports
// of CollectionTab, StatsTab, etc.), not at the page.js level.
//
// ScannerTab + DiscogsImport stay dynamic because they're behind explicit
// modal triggers (not tab navigation), so there's no parent-child static
// import chain to collide with. Scanner pulls @zxing/browser (~80kB only
// needed when the user scans); DiscogsImport hits an admin-only flow.
const ScannerTab    = nextDynamic(() => import('@/app/scanner/ScannerTab'),   { ssr: false });
const DiscogsImport = nextDynamic(() => import('@/app/import/DiscogsImport'), { ssr: false });

// Filter ids stay stable for URL/state — labels resolve via t() in render.
// Filter chips for the Feed/Premiery tab. Order matters — the most
// commonly used filters are first. `thisWeek` is a tighter window than
// `preorder` (which can stretch 6+ months). `boxset` and `reissue` are
// metal-specific filters users explicitly asked for.
const FILTER_IDS = ['all', 'thisWeek', 'preorder', 'new', 'limited', 'vinyl', 'boxset', 'reissue', 'mine'];
const ALL_GENRES = ['Heavy Metal','Death Metal','Black Metal','Thrash Metal','Doom Metal',
  'Progressive Metal','Power Metal','Metalcore','Groove Metal','Nu-Metal',
  'Symphonic Metal','Sludge Metal','Industrial Metal','Folk Metal','Post-Metal'];

export default function MetalVault() {
  const supabase = useRef(createClient()).current;
  const t = useT();
  const cur = useCurrency();
  const fx  = useFx();

  // Auth
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);

  // Feed
  const [releases,    setReleases]    = useState([]);
  const [source,      setSource]      = useState('');
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError,   setFeedError]   = useState('');

  // UI — initial tab. SSR-safe: always start on 'vault' so the server-
  // rendered HTML matches the first client render exactly (otherwise
  // React throws hydration error #418 — server renders Vault content,
  // client immediately tries to render Calendar content because
  // localStorage said so). The tab-restore from URL/localStorage runs
  // in a useEffect on mount instead.
  const [tab, setTab] = useState('vault');
  // SSR vs CSR render parity is too costly to maintain across this app's
  // ~30 stateful client components, so we mount-guard the entire root
  // (see render path below). `mounted` flips on first useEffect tick,
  // forcing a second render with the full UI. SSR'd HTML is a minimal
  // METAL VAULT splash that's identical in both environments → no
  // hydration mismatch can ever fire.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const valid = ['feed','vault','calendar','profile'];
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (valid.includes(fromUrl)) { setTab(fromUrl); return; }
    try {
      const last = localStorage.getItem('mv_last_tab');
      if (valid.includes(last)) setTab(last);
    } catch {}
  }, []);
  const [filter,          setFilter]          = useState('all');
  const [sort,            setSort]            = useState('date_desc');
  const [search,          setSearch]          = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showScanner,     setShowScanner]     = useState(false);
  const [syncStatus,      setSyncStatus]      = useState(null);
  const [syncResult,      setSyncResult]      = useState(null);
  // Genre interests — must start with the same value server-side AND
  // client-side on first render, otherwise React #418 hydration error.
  // The lazy initializer `() => loadLS(...)` is called on BOTH sides:
  // server gets [] (no localStorage), client gets the stored array
  // → state differs on the very first render → DOM mismatch → throw.
  // Load the persisted value in useEffect after mount instead.
  const [genreInterests,  setGenreInterests]  = useState([]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = loadLS('mv_genre_interests', null);
      if (Array.isArray(v) && v.length > 0) setGenreInterests(v);
    } catch {}
  }, []);
  const [showGenrePicker, setShowGenrePicker] = useState(false);
  const [pushEnabled,     setPushEnabled]     = useState(false);
  const [streak,          setStreak]          = useState(0);
  const [pushLoading,     setPushLoading]     = useState(false);
  const [shareToken,      setShareToken]      = useState(null);
  const [discogsConnected,setDiscogsConnected]= useState(false);
  const [discogsError,    setDiscogsError]    = useState(null);
  const [selected,        setSelected]        = useState(null);
  const [showOnboarding,  setShowOnboarding]  = useState(false);
  const [feedRetryCount,  setFeedRetryCount]  = useState(0);
  const [feedTab,         setFeedTab]         = useState('all'); // 'all' default — user switches to Following manually
  const [premium,         setPremium]         = useState(null); // null=loading, false=free, true=pro
  const [showUpgrade,     setShowUpgrade]     = useState(false);
  const [upgradeReason,   setUpgradeReason]   = useState('');

  // Collection hook — all collection/watchlist/vinyl state & actions
  const col = useCollection(user);

  // Hardware back button on Android: close the topmost overlay instead of
  // exiting the app. VinylModal / UpgradeModal / OnboardingScreen handle
  // this internally — these two stay inline so we wire the hook here.
  useBackButton(showScanner,     () => setShowScanner(false));
  useBackButton(showImportModal, () => setShowImportModal(false));

  // Auth listener — drives all per-user data loading.
  //
  // De-dupe rule: only call loadUserData / loadProfile / loadPremium when
  // the *user identity* actually changed. Supabase fires onAuthStateChange
  // with INITIAL_SESSION on subscribe, then TOKEN_REFRESHED periodically
  // (and on tab visibility change in some browsers). The previous version
  // also called getSession() and ran the full data load on every fire,
  // which produced 6-8 redundant /api/collection + /api/portfolio +
  // /api/artists + /api/watchlist hits per session — measurable lag,
  // wasted Supabase quota, and middleware rate-limit pressure.
  //
  // Now: getSession() is gone (Supabase emits INITIAL_SESSION which gives
  // us the same data), and we track the last loaded user.id so a
  // TOKEN_REFRESHED event with the same user is a no-op for data
  // fetching. Sign-out still resets, sign-in to a different account
  // still reloads.
  const lastUserIdRef = useRef(null);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id || null;
      setUser(session?.user || null);

      // No user → reset and remember.
      if (!nextUserId) {
        col.resetUserData();
        lastUserIdRef.current = null;
        analyticsReset();
        return;
      }

      // Initialize payments SDK once user is known. No-op for non-TWA browsers.
      initPayments(nextUserId).catch(() => {});

      // Tie analytics events to this user from now on.
      analyticsIdentify(nextUserId, { email: session.user.email });

      // Skip the heavy data load if it's the same user we already loaded.
      // TOKEN_REFRESHED, USER_UPDATED, and tab-focus re-fires hit this
      // path with an unchanged user.id; we don't need to re-pull
      // collection / portfolio / watchlist for those.
      if (nextUserId === lastUserIdRef.current) return;
      lastUserIdRef.current = nextUserId;

      col.loadUserData(session.user);
      loadProfile(session.user);
      loadPremium();

      // Onboarding: fire only on a real first-time SIGNED_IN within the
      // first 5 minutes of account creation. Guarded by mv_onboarding_done.
      if (event === 'SIGNED_IN') {
        try {
          const seen = localStorage.getItem('mv_onboarding_done');
          const isNewUser = !seen && session.user.created_at &&
            (Date.now() - new Date(session.user.created_at).getTime()) < 5 * 60 * 1000;
          if (isNewUser) setShowOnboarding(true);
        } catch {}
      }
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line

  async function loadProfile(u) {
    const { data } = await supabase.from('profiles').select('*').eq('id', u.id).single();
    if (data) setProfile(data);
    try {
      const r = await fetch('/api/discogs/connection-status');
      const d = await r.json();
      if (d.connected) setDiscogsConnected(true);
    } catch {}
  }

  async function loadPremium() {
    try {
      const r = await fetch('/api/stripe/status');
      const d = await r.json();
      setPremium(d.premium || false);
      // If came back from successful checkout
      const params = new URLSearchParams(window.location.search);
      if (params.get('premium') === 'success') {
        setPremium(true);
        window.history.replaceState({}, '', '/');
        setTab('profile');
        // Track conversion — provider & plan unknown here (Stripe redirected
        // back without metadata), webhook reconciliation happens server-side.
        trackPurchaseCompleted(null, 'stripe');
      }
    } catch { setPremium(false); }
  }

  // Listen for upgrade trigger from hooks
  useEffect(() => {
    const handler = e => triggerUpgrade(e.detail?.reason || '');
    window.addEventListener('mv:upgrade', handler);
    return () => window.removeEventListener('mv:upgrade', handler);
  }, []); // eslint-disable-line

  // Refetch watchlist when ♥ toggle in discography modifies it
  useEffect(() => {
    const refetch = async () => {
      if (!user) return;
      try {
        const r = await fetch('/api/watchlist');
        const d = await r.json();
        if (d.items) col.setWatchlist(d.items);
      } catch {}
    };
    window.addEventListener('mv-watchlist-changed', refetch);
    return () => window.removeEventListener('mv-watchlist-changed', refetch);
  }, [user]); // eslint-disable-line

  // Open scanner from anywhere (e.g., ManualAddForm "Scan barcode" button)
  useEffect(() => {
    const handler = () => setShowScanner(true);
    window.addEventListener('mv:open-scanner', handler);
    return () => window.removeEventListener('mv:open-scanner', handler);
  }, []);

  // Permission-on-context — push notifications.
  //
  // Onboarding no longer asks for push (was rejected ~30% of the time
  // upfront and once denied the only fix is teaching the user to flip
  // browser site settings). Instead, we wait until the user does
  // something that's only useful with push — currently: creates their
  // first price alert. CollectionTab fires `mv:request-push` after
  // success, we ask once via a friendly confirm dialog, and we record
  // `mv_push_prompt_seen` regardless of answer so we never re-prompt
  // for the same flow.
  //
  // Fired-once guard is on the dispatch side too, but a duplicate
  // listener tick is cheap and the LS flag set here covers any other
  // future trigger we wire (e.g. follow-artist).
  useEffect(() => {
    const handler = async () => {
      if (pushEnabled) return;
      try {
        if (localStorage.getItem('mv_push_prompt_seen') === '1') return;
        localStorage.setItem('mv_push_prompt_seen', '1');
      } catch {}
      const ok = await confirm(
        t('push.contextPrompt.title') ||
        'Want a push notification when this alert fires? You can always toggle this in Profile.',
        { confirmLabel: t('push.contextPrompt.enable') || 'Enable', cancelLabel: t('push.contextPrompt.later') || 'Later' }
      );
      if (ok) await togglePush();
    };
    window.addEventListener('mv:request-push', handler);
    return () => window.removeEventListener('mv:request-push', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushEnabled]);

  // Daily streak — ping server once per session (idempotent), display current count
  useEffect(() => {
    if (!user) { setStreak(0); return; }
    const today = new Date().toISOString().split('T')[0];
    const lastPinged = typeof localStorage !== 'undefined' ? localStorage.getItem('mv_streak_pinged') : null;
    const run = async () => {
      try {
        if (lastPinged === today) {
          // Already pinged today — just fetch display value
          const r = await fetch('/api/streak');
          const d = await r.json();
          if (typeof d.current_streak === 'number') setStreak(d.current_streak);
        } else {
          // First open of the day — POST increments, returns new streak
          const r = await fetch('/api/streak', { method: 'POST' });
          const d = await r.json();
          if (typeof d.current_streak === 'number') setStreak(d.current_streak);
          try { localStorage.setItem('mv_streak_pinged', today); } catch {}
        }
      } catch {}
    };
    run();
  }, [user]);

  // Push status + OAuth return params
  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready
        .then(reg => reg.pushManager.getSubscription())
        .then(sub => setPushEnabled(!!sub)).catch(() => {});
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('discogs_connected')) {
      setDiscogsConnected(true);
      window.history.replaceState({}, '', '/');
      try { localStorage.setItem('mv_pending_sync', '1'); } catch {}
    }
    const err = params.get('discogs_error');
    if (err) {
      setDiscogsError(decodeURIComponent(err));
      setTab('profile');
      window.history.replaceState({}, '', '/');
    }
    if (!user) col.setWatchlist(loadLS('mv_watchlist_v2', []));
  }, []); // eslint-disable-line

  // Auto-sync after OAuth callback
  useEffect(() => {
    if (!user) return;
    try {
      if (localStorage.getItem('mv_pending_sync') === '1') {
        localStorage.removeItem('mv_pending_sync');
        setDiscogsConnected(true);
        runSync();
      }
    } catch {}
  }, [user]); // eslint-disable-line

  // Feed — progressive render
  // Discogs is the primary source (has cover images), MusicBrainz is a
  // secondary fallback for releases Discogs misses. We render Discogs as
  // soon as it arrives (typically <300ms warm) and merge MB results in
  // when they show up. Promise.all was the previous approach but it
  // gated the entire feed on the slowest of the two — a cold-cache MB
  // call (~1-2s) made the whole feed feel sluggish.
  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true); setFeedError('');
    // Pass followed artists so Discogs API can include their upcoming releases.
    // SORT ALPHABETICALLY so the MB per-request cache-budget (8 niecached per
    // call) consumes artists in a deterministic order. Across multiple refreshes
    // the same artists get warmed first → predictable for users, lets cron
    // pre-warm work alongside live traffic.
    const artists = col.followedArtists
      .map(a => a.artist_name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const discogsUrl = artists.length > 0
      ? '/api/releases?artists=' + encodeURIComponent(artists.join(','))
      : '/api/releases';

    // Helper: dedupe by (artist::album), preserving order.
    const dedupe = (lists) => {
      const seen = new Set();
      const out = [];
      for (const list of lists) {
        for (const r of list) {
          const k = ((r.artist || '') + '::' + (r.album || '')).toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(r);
        }
      }
      // Sort by release date descending (most recent first; future dates
      // sort to the top because their timestamp is largest).
      out.sort((a, b) => {
        const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return db - da;
      });
      return out;
    };

    let dRel = [];
    let maRel = [];

    // Cache-bust: Service Worker has historically served stale /api/releases
    // copies after deploys (saw the "Anthrax LP in MB but missing from feed"
    // case). Append millisecond timestamp + cache:'no-store' to force network.
    const cb = '_t=' + Date.now();
    const discogsUrlCb = discogsUrl + (discogsUrl.includes('?') ? '&' : '?') + cb;

    // Fire both in parallel, but render whichever arrives first.
    const discogsP = fetch(discogsUrlCb, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { releases: [] })
      .catch(() => ({ releases: [] }))
      .then(d => {
        if (cancelled) return;
        dRel = d.releases || [];
        setReleases(dedupe([dRel, maRel]));
        setSource(d.source || 'discogs');
        // Hide the loader as soon as Discogs returns — that's the
        // primary source and what the user came here to see.
        setFeedLoading(false);
      });

    // MB merge also takes followed artists so per-artist queries fire
    // (catches LPs not yet tagged `metal` in MB — Anthrax August LP case).
    const maUrl = artists.length > 0
      ? '/api/releases/metal-archives?artists=' + encodeURIComponent(artists.join(','))
      : '/api/releases/metal-archives';
    const maUrlCb = maUrl + (maUrl.includes('?') ? '&' : '?') + cb;
    const maP = fetch(maUrlCb, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { items: [] })
      .catch(() => ({ items: [] }))
      .then(ma => {
        if (cancelled) return;
        maRel = (ma.items || []).map(i => ({
          id:           i.id,
          source:       'metal_archives',
          artist:       i.artist,
          album:        i.album,
          cover:        i.cover,
          releaseDate:  i.releaseDate,
          genre:        i.genre,
          // Forward MB's rich tag list — UI filter falls back to these
          // for narrow subgenre selections.
          genres:       i.genres || [i.genre || 'Metal'],
          styles:       i.styles || [i.genre || 'Metal'],
          preorder:     i.preorder,
          limited:      false,
          type:         i.type,
          discogs_url:  i.albumUrl,
        }));
        setReleases(dedupe([dRel, maRel]));
      });

    // Safety net: if BOTH end up rejecting at the network layer (offline,
    // DNS fail), we still need to clear the spinner. .catch on each
    // already turns rejections into empty results, so this is mostly to
    // surface a friendly error if Discogs returns a non-empty error.
    Promise.allSettled([discogsP, maP]).then(() => {
      if (!cancelled) setFeedLoading(false);
    });

    return () => { cancelled = true; };
    // Re-fetch only when the *count* of followed artists changes; the
    // followedArtists array itself gets a new reference on every collection
    // mutation, which would cause unnecessary feed reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedRetryCount, col.followedArtists.length]);

  const openAlbum = (album) => { setSelected(album); col.setVinylError(''); col.fetchVinyl(album); };

  const runSync = async () => {
    setSyncStatus('syncing'); setSyncResult(null);
    try {
      const r = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'both' }),
      });
      const d = await r.json();
      // Handle API-level errors (400/503 etc.) that still return JSON
      if (!r.ok || d.error) {
        setSyncResult({ _error: d.error || 'Sync failed' });
        setSyncStatus('error');
        return;
      }
      setSyncResult(d); setSyncStatus('done');
      setDiscogsConnected(true);
      await col.loadUserData(user);
      // Switch to Vault tab so user sees their records immediately
      if (d.added > 0 || d.updated > 0) setTab('collection');
      // Auto-fetch prices in background after sync (non-blocking)
      if ((d.added || 0) > 0) {
        fetch('/api/collection/refresh-prices', { method: 'POST' })
          .then(r => r.json())
          .then(async result => {
            if (result.updated > 0) await col.loadUserData(user);
          })
          .catch(() => {});
      }
    } catch {
      setSyncStatus('error');
    }
  };

  const togglePush = async () => {
    if (!user) { toast.error(t('auth.signInFirst')); return; }
    setPushLoading(true);
    try {
      if (pushEnabled) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await sub.unsubscribe(); await fetch('/api/push/subscribe',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})}); }
        setPushEnabled(false);
      } else {
        const reg = await navigator.serviceWorker.ready;
        const { publicKey } = await fetch('/api/push/subscribe').then(r => r.json());
        if (!publicKey) { toast.error('Notifications are temporarily unavailable. Please try again later.'); setPushLoading(false); return; }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { setPushLoading(false); return; }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:publicKey });
        await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub})});
        setPushEnabled(true);
      }
    } catch(e) {
      if (typeof window !== 'undefined' && window.Sentry) window.Sentry.captureException(e);
      toast.error('Could not update notification settings');
    }
    setPushLoading(false);
  };

  const connectDiscogs = async () => {
    const r = await fetch('/api/discogs/oauth'); const d = await r.json();
    if (d.authorizeUrl) { window.location.href = d.authorizeUrl; }
    else if (d.helpUrl) {
      const ok = await confirm((d.error || 'Discogs needs to be configured.') + '\n\nOpen Discogs developers page?');
      if (ok) window.open(d.helpUrl, '_blank');
    }
    else toast.error(d.error || 'Failed to connect Discogs');
  };

  const getShareToken = async () => {
    if (!user) return;
    let r = await fetch('/api/share'); let d = await r.json();
    if (!d.token) { r = await fetch('/api/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'My Collection'})}); d = await r.json(); }
    if (d.token) setShareToken(d.token);
  };

  const startCheckout = async (plan = 'monthly') => {
    // Routes to RevenueCat (Play Store TWA) or Stripe (web) based on platform.
    const result = await startPurchase(plan);
    if (!result.success && result.error !== 'cancelled') {
      toast.error(result.error || 'Checkout failed');
    }
    // Success: webhook updates profile, refreshProfile() re-fetches premium state.
    if (result.success) {
      toast.success('Welcome to Metal Vault Pro 🤘');
      await refreshProfile?.();
    }
  };

  const openPortal = async () => {
    // Web: Stripe Customer Portal. Play Store: native Google Play subscriptions.
    const result = await openSubscriptionManagement();
    if (!result.success) toast.error(result.error || t('payments.openSubFail'));
  };

  const triggerUpgrade = (reason = '') => {
    setUpgradeReason(reason);
    setShowUpgrade(true);
    track('paywall_viewed', { reason: reason || 'manual' });
  };

  const signOut = async () => {
    await supabase.auth.signOut(); setUser(null); col.resetUserData(); setProfile(null);
  };

  const today = new Date();
  const followedNames = new Set(col.followedArtists.map(a => a.artist_name?.toLowerCase()));

  const filtered = releases
    .filter(r => {
      // Following tab: only artists the user follows
      if (feedTab === 'following' && followedNames.size > 0) {
        if (!followedNames.has(r.artist?.toLowerCase())) return false;
      }
      const rd = new Date(r.releaseDate);
      const isPreorder = (rd > today) || r.preorder === true;
      const isNew = (today-rd)/864e5 < 180 && !isPreorder;  // 6 months = new
      const vinyl = col.vinylCache[r.id];
      // ±7 days window (same week, either direction). Catches both
      // "out yesterday" and "drops on Friday" without showing 6 months
      // of preorders the user already scrolled past.
      const daysAway = (rd - today) / 864e5;
      const isThisWeek = daysAway >= -7 && daysAway <= 7;
      // Mine = artist already in user's collection. Lets users see
      // upcoming releases from bands they own without having to also
      // be following them.
      const collectionArtists = new Set(col.collection.map(c => (c.artist||'').toLowerCase()));
      const isMine = collectionArtists.has((r.artist||'').toLowerCase());
      if (filter==='thisWeek') return isThisWeek;
      if (filter==='new')      return isNew;
      if (filter==='preorder') return isPreorder||r.preorder;
      if (filter==='limited')  return vinyl?.hasLimited===true||r.limited===true;
      if (filter==='vinyl')    return vinyl?.hasVinyl===true;
      if (filter==='boxset')   return r.boxset===true;
      if (filter==='reissue')  return r.reissue===true;
      if (filter==='mine')     return isMine;
      return true;
    })
    .filter(r => !search || r.artist.toLowerCase().includes(search.toLowerCase()) || r.album.toLowerCase().includes(search.toLowerCase()))
    .filter(r => {
      // No genre filter active → everything passes.
      if (genreInterests.length === 0) return true;

      // Universal pass-through #1: bare "Metal" is the umbrella tag. The
      // entire app is metal-only, so anything tagged generically "Metal"
      // (without a subgenre) gets shown regardless of subgenre filter.
      // Otherwise fresh MB announcements — which arrive without subgenre
      // tags — would silently disappear for every user with any subgenre
      // selected. Better to over-surface umbrella items than hide
      // legitimate releases waiting for community tagging.
      const allTags = [
        r.genre,
        ...(r.genres || []),
        ...(r.styles || []),
      ].filter(Boolean).map(g => String(g).toLowerCase());
      if (allTags.includes('metal')) return true;

      // Universal pass-through #2: user follows the artist. Explicit
      // follow is a stronger signal than the genre filter.
      if (col.followedArtists.some(a =>
        (a.artist_name || '').toLowerCase() === (r.artist || '').toLowerCase()
      )) return true;

      // Normal genre matching — any tag intersects user's selection.
      const selectedLower = genreInterests.map(g => g.toLowerCase());
      return allTags.some(t => selectedLower.includes(t));
    })
    .sort((a,b) => {
      if (sort==='date_desc') return new Date(b.releaseDate)-new Date(a.releaseDate);
      if (sort==='date_asc')  return new Date(a.releaseDate)-new Date(b.releaseDate);
      if (sort==='artist')    return a.artist.localeCompare(b.artist);
      return 0;
    });

  const isWatched  = id   => col.watchlist.some(w => (w.id||w.album_id) === id);
  const isInCollection = id => col.collection.some(c => String(c.discogs_id) === String(id) || c.album_id === id);
  const isFollowed = name => col.followedArtists.some(a => a.artist_name === name);

  // Mount-guard at the page root. The app is a heavily-stateful PWA
  // with ~30 nested 'use client' components, async data loaders, and
  // localStorage-derived UI everywhere. Maintaining strict SSR/CSR
  // render parity across all of that for a SEO-irrelevant signed-in
  // surface is not worth the engineering cost. SSR a minimal black
  // skeleton; let the client take over after hydration. Eliminates
  // every possible React #418 source in one move.
  if (!mounted) {
    return (
      <div style={{ minHeight:'100vh', background:C.bg, maxWidth:600, margin:'0 auto',
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ ...BEBAS, fontSize:24, letterSpacing:'0.1em', color:C.text, opacity:0.4 }}>
          METAL VAULT
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, maxWidth:600, margin:'0 auto' }}>

      <div style={{ background:C.bg, borderBottom:'1px solid '+C.border, padding:'12px 16px 10px', position:'sticky', top:0, zIndex:50 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
            <div style={{ ...BEBAS, fontSize:28, letterSpacing:'0.08em', color:C.text, lineHeight:1 }}>METAL VAULT</div>
            <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.2em', textTransform:'uppercase' }}>
              {tab==='feed'?t('header.feed'):tab==='vault'?t('header.vault'):tab==='calendar'?t('header.calendar'):tab==='profile'?t('header.profile'):tab.toUpperCase()}
            </div>
          </div>
          {/* Live collection value + streak — the #1 reason to open the app */}
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {/* Streak badge — visible as soon as >= 2 days (day 1 is noise) */}
            {user && streak >= 2 && (
              <div title={streak + '-day streak'} style={{
                display:'flex', alignItems:'center', gap:4,
                background:'#1a0a00', border:'1px solid #7f1d1d', borderRadius:14,
                padding:'3px 9px',
              }}>
                <Icon name="fire" size={12} color="#f87171"/>
                <span style={{ ...BEBAS, fontSize:13, color:'#f5c842', lineHeight:1, letterSpacing:'0.02em' }}>{streak}</span>
              </div>
            )}
          {(() => {
            // For signed-in users we use the server-provided summary;
            // for demo guests we compute the same totals client-side
            // from the LS-backed collection so the header still shows
            // a meaningful value chip. Without this, demo users got
            // an empty header and the value-prop wasn't visible
            // until they tapped Vault.
            const signedTotal = col.collectionSummary?.totalCurrent;
            const signedGain  = col.collectionSummary?.gain;
            const demoTotal = (col.collection || []).reduce(
              (s, i) => s + (Number(i.median_price || i.current_price || i.purchase_price) || 0), 0);
            const demoPaid  = (col.collection || []).reduce(
              (s, i) => s + (Number(i.purchase_price) || 0), 0);
            const total = user ? signedTotal : demoTotal;
            const gain  = user ? signedGain  : (demoTotal - demoPaid);
            const showChip = total > 0;
            if (!showChip) return null;
            return (
              <button onClick={()=>setTab('stats')} style={{ background:'none', border:'none', cursor:'pointer', textAlign:'right', padding:0 }}>
                <div style={{ ...BEBAS, fontSize:22, color:C.gold, lineHeight:1, letterSpacing:'0.04em' }}>
                  {formatPrice(total, cur, fx)}
                </div>
                {gain !== 0 && (
                  <div style={{ fontSize:9, color: gain >= 0 ? '#4ade80' : '#f87171', ...MONO, textAlign:'right' }}>
                    {formatChange(gain, cur, fx)}
                  </div>
                )}
              </button>
            );
          })()}
          {user && (col.collectionSummary?.totalCurrent ?? 0) === 0 ? (
            <div style={{ fontSize:10, color:'#4ade80', ...MONO }}>✓ {user.email?.split('@')[0]}</div>
          ) : null}
          </div>
        </div>
        {source==='mock' && <div style={{ fontSize:9, color:'#555', ...MONO, marginTop:2 }}>{t('header.demoMode')}</div>}
      </div>

      {/* Sticky strip below the header reminding the guest they're
          looking at sample data + offering a one-tap path to sign in.
          Hidden once the user authenticates (DemoBanner reads the
          mv_demo_active LS flag and gates on `user`). */}
      <DemoBanner user={user}/>
      <RepressBanner user={user}/>

      <div style={{ paddingBottom:100 }}>
        {tab==='feed' && (
          <ErrorBoundary name="Feed">
            {!feedLoading && releases.length>0 && <StatsBar releases={releases}/>}
            {/* Following / All tabs — only show Following if user is logged in */}
            <div style={{ display:'flex', borderBottom:'1px solid '+C.border }}>
              {[
                ...(user ? [{ id:'following', label: col.followedArtists.length > 0 ? `${t('feed.tab.following')} (${col.followedArtists.length})` : t('feed.tab.following') }] : []),
                { id:'all', label: t('feed.tab.all') },
              ].map(tab => (
                <button key={tab.id} onClick={()=>setFeedTab(tab.id)} style={{
                  flex:1, padding:'10px 0', background:'none', border:'none',
                  borderBottom: feedTab===tab.id ? '2px solid '+C.accent : '2px solid transparent',
                  color: feedTab===tab.id ? C.text : C.dim,
                  cursor:'pointer', fontSize:12, ...MONO,
                }}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div style={{ display:'flex', gap:6, padding:'8px 16px', overflow:'auto', borderBottom:'1px solid '+C.border }}>
              {FILTER_IDS.map(id => {
                const label = t('feed.filter.' + (id === 'preorder' ? 'upcoming' : id));
                return (
                <button key={id} onClick={()=>setFilter(id)} style={{ padding:'5px 10px', borderRadius:20, whiteSpace:'nowrap', background:filter===id?C.accent+'22':C.bg3, color:filter===id?C.accent:C.dim, border:'1px solid '+(filter===id?C.accent+'66':C.border), cursor:'pointer', fontSize:10, ...MONO }}>
                  {label}
                </button>
                );
              })}
            </div>
            <div style={{ padding:'10px 16px 0', display:'flex', gap:8 }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('feed.search')} style={{ ...inputSt, flex:1 }}/>
              <select value={sort} onChange={e=>setSort(e.target.value)} style={{ background:C.bg3, border:'1px solid '+C.border, borderRadius:8, color:C.muted, padding:'0 10px', fontSize:13, ...MONO, cursor:'pointer', outline:'none', flexShrink:0 }}>
                <option value="date_desc">{t('feed.sort.newest')}</option><option value="date_asc">{t('feed.sort.oldest')}</option><option value="artist">{t('feed.sort.artist')}</option>
              </select>
            </div>
            {!feedLoading && (
              <div style={{ padding:'4px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontSize:10, color:C.dim, ...MONO }}>{filtered.length} {t('feed.count')}{genreInterests.length>0?' · '+t('feed.genres'):''}</div>
                <button onClick={()=>setShowGenrePicker(p=>!p)} style={{ fontSize:10, color:genreInterests.length>0?C.accent:C.dim, ...MONO, background:'none', border:'none', cursor:'pointer', padding:'2px 4px' }}>
                  🎸 {genreInterests.length>0?genreInterests.length+' '+t('feed.genres'):t('feed.genres')}
                </button>
              </div>
            )}
            {showGenrePicker && (
              <div style={{ padding:'8px 16px 12px', borderBottom:'1px solid '+C.border, background:C.bg2 }}>
                <div style={{ fontSize:9, color:C.dim, ...MONO, letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:6 }}>Tap to filter by genre</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                  {ALL_GENRES.map(g => {
                    const active = genreInterests.includes(g);
                    return <button key={g} onClick={()=>{const next=active?genreInterests.filter(x=>x!==g):[...genreInterests,g];setGenreInterests(next);saveLS('mv_genre_interests',next);}} style={{fontSize:10,padding:'4px 9px',borderRadius:20,...MONO,cursor:'pointer',background:active?C.accent+'22':C.bg3,color:active?C.accent:C.dim,border:'1px solid '+(active?C.accent+'66':C.border)}}>{g}</button>;
                  })}
                  {genreInterests.length>0&&<button onClick={()=>{setGenreInterests([]);saveLS('mv_genre_interests',[]);}} style={{fontSize:10,padding:'4px 9px',borderRadius:20,...MONO,cursor:'pointer',background:'#1a0000',color:'#f87171',border:'1px solid #7f1d1d'}}>✕ Clear</button>}
                </div>
              </div>
            )}
            {feedLoading && <div style={{ textAlign:'center', padding:'80px 24px', color:C.dim, ...MONO }}><div style={{ fontSize:32, marginBottom:12 }}>⟳</div>Loading…</div>}
            {feedError   && (
              <div style={{ margin:'16px', background:'#1a0000', border:'1px solid '+C.accent+'44', borderRadius:10, padding:'16px' }}>
                <div style={{ color:'#f87171', fontSize:12, ...MONO, marginBottom:10 }}>
                  {navigator?.onLine === false ? '📡 No internet connection' : '⚠ ' + feedError}
                </div>
                <div style={{ fontSize:10, color:C.dim, ...MONO, marginBottom:12 }}>
                  {navigator?.onLine === false ? 'Connect to WiFi or mobile data and try again.' : 'Could not load releases from Discogs.'}
                </div>
                <button onClick={()=>setFeedRetryCount(n=>n+1)}
                  style={{ background:C.accent, border:'none', borderRadius:8, color:'#fff', padding:'9px 18px', cursor:'pointer', ...BEBAS, fontSize:15, letterSpacing:'0.08em' }}>
                  ↺ Retry
                </button>
              </div>
            )}
            {!feedLoading && !feedError && feedTab==='following' && followedNames.size===0 && (
              <div style={{ textAlign:'center', padding:'60px 24px', color:C.dim, ...MONO }}>
                <div style={{ fontSize:48, marginBottom:16 }}>🎸</div>
                <div style={{ fontSize:14, color:C.muted, marginBottom:8 }}>{t('feed.empty.title')}</div>
                <div style={{ fontSize:11, lineHeight:1.6 }}>
                  {t('feed.empty.desc')}
                </div>
                <button onClick={()=>setFeedTab('all')} style={{ marginTop:20, background:C.accent, border:'none', borderRadius:10, color:'#fff', padding:'10px 24px', cursor:'pointer', ...BEBAS, fontSize:16, letterSpacing:'0.08em' }}>
                  {t('feed.empty.cta')}
                </button>
              </div>
            )}
            {!feedLoading && !feedError && (feedTab!=='following' || followedNames.size>0) && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, padding:'10px 16px 16px' }}>
                {filtered.map(album=>(
                  <AlbumCard key={album.id} album={album} isWatched={isWatched(album.id)} onWatchToggle={col.toggleWatch} onClick={()=>openAlbum(album)} vinylData={col.vinylCache[album.id]||null} isFollowed={isFollowed(album.artist)} onFollowToggle={col.toggleFollow} user={user} isInCollection={isInCollection(album.id)} onQuickAdd={a => col.addToCollection({ id:a.id, discogs_id:a.id, artist:a.artist, album:a.album, cover:a.cover, year:(a.releaseDate||'').slice(0,4) })} onPreorder={a => col.addToCollection({ id:a.id, discogs_id:a.id, artist:a.artist, album:a.album, cover:a.cover, year:(a.releaseDate||'').slice(0,4), is_preordered:true })}/>
                ))}
              </div>
            )}
          </ErrorBoundary>
        )}

        {tab==='vault' && (
          <ErrorBoundary name="Vault"><VaultTab
            user={user}
            collection={col.collection}
            watchlist={col.watchlist}
            collectionSummary={col.collectionSummary}
            onRemoveWatch={async(id)=>{ if(user)await fetch('/api/watchlist?album_id='+id,{method:'DELETE'}); col.setWatchlist(w=>w.filter(x=>(x.album_id||x.id)!==id)); }}
            onAddToWatchlist={async(artist,album)=>{ const item={artist,album:album.title,album_id:album.id,cover:album.cover}; col.setWatchlist(w=>[...w,{...item,id:album.id}]); if(user)await fetch('/api/watchlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)}); }}
            onAlbumClick={openAlbum} onRemove={col.removeFromCollection} onUpdate={col.setCollection}
            portfolio={col.portfolio} AlbumCover={AlbumCover}
            onManualAdd={async(item)=>{ await col.addToCollection(item); }}
            premium={premium} onUpgrade={triggerUpgrade}
            onConnectDiscogs={connectDiscogs} discogsConnected={discogsConnected}
            followedArtists={col.followedArtists} onToggleFollow={col.toggleFollow}
            onBatchFollow={async (artists) => {
              const newArtists = artists.map(name => ({ artist_name: name, user_id: user?.id }));
              col.setFollowedArtists(a => [...a, ...newArtists.filter(n => !a.some(x => x.artist_name === n.artist_name))]);
            }}
            onRefreshPrices={async()=>{
              const r = await fetch('/api/collection/refresh-prices',{method:'POST'});
              const d = await r.json();
              if(d.updated>0) await col.loadUserData(user);
              return d.message;
            }}
          /></ErrorBoundary>
        )}

        {tab==='calendar' && (
          <ErrorBoundary name="When's On"><WhensOnTab
            user={user}
            releases={releases}
            followedArtists={col.followedArtists}
            collection={col.collection}
          /></ErrorBoundary>
        )}

        {tab==='profile' && discogsError && (
          <div style={{margin:'12px 16px',padding:'14px',background:'#2a0000',border:'1px solid #7f1d1d',borderRadius:10,color:'#f87171',fontSize:12,fontFamily:"var(--font-space-mono), monospace",lineHeight:1.6}}>
            <div style={{fontSize:10,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8,color:'#fca5a5'}}>⚠ Discogs connection failed</div>
            <div style={{wordBreak:'break-word',color:'#fee2e2'}}>{discogsError}</div>
            <button onClick={()=>setDiscogsError(null)} style={{marginTop:10,background:'none',border:'1px solid #7f1d1d',borderRadius:6,color:'#f87171',padding:'6px 12px',cursor:'pointer',fontSize:10,fontFamily:"var(--font-space-mono), monospace"}}>Dismiss</button>
          </div>
        )}
        {tab==='profile' && (
          user ? (
            <ErrorBoundary name="Profile"><ProfileTab user={user} profile={profile} followedArtists={col.followedArtists} collection={col.collection}
              onSignOut={signOut} onUpdateProfile={setProfile} onShowImport={()=>setShowImportModal(true)}
              pushEnabled={pushEnabled} pushLoading={pushLoading} onTogglePush={togglePush}
              discogsConnected={discogsConnected} onConnectDiscogs={connectDiscogs}
              onSyncDiscogs={runSync} syncStatus={syncStatus} syncResult={syncResult}
              shareToken={shareToken} onGetShareToken={getShareToken}
              premium={premium} onUpgrade={()=>triggerUpgrade()} onOpenPortal={openPortal}/></ErrorBoundary>
          ) : (
            <div style={{ textAlign:'center', padding:'80px 24px' }}>
              <div style={{ ...BEBAS, fontSize:40, color:C.text, marginBottom:8, lineHeight:1 }}>METAL VAULT</div>
              <div style={{ fontSize:12, color:C.dim, ...MONO, marginBottom:32, lineHeight:1.7 }}>{t('home.signedOut.desc')}</div>
              <button onClick={()=>window.location.href='/login'} style={{ background:'linear-gradient(135deg,'+C.accent+','+C.accent2+')', border:'none', borderRadius:12, color:'#fff', padding:'15px 32px', ...BEBAS, fontSize:22, letterSpacing:'0.1em', cursor:'pointer' }}>{t('home.signedOut.cta')}</button>
            </div>
          )
        )}
      </div>

      <BottomNav tab={tab} onChange={(t)=>{
          setTab(t);
          try { localStorage.setItem('mv_last_tab', t); } catch {}
        }} user={user} onScan={()=>setShowScanner(true)}/>

      {showUpgrade && (
        <UpgradeModal
          reason={upgradeReason}
          onClose={() => setShowUpgrade(false)}
          onCheckout={async (plan) => { setShowUpgrade(false); await startCheckout(plan); }}
        />
      )}

      {/* What's-new modal — fires once per app version, only after the
          user is signed in to avoid greeting first-time visitors. */}
      {user && <WhatsNew />}

      {/* Global artist info sheet — listens for mv:open-artist from
          anywhere (Search, Bands, related-artist clicks). Mounted always
          so events fire regardless of active tab. */}
      <ArtistInfoModal />

      {/* Daily "this day in metal" surfaced when user opens the app
          from the daily push (which appends ?day=YYYY-MM-DD to the
          URL). Renders nothing on a normal cold-start. */}
      <ThisDayModal user={user}/>


      {showOnboarding && (
        <OnboardingScreen
          onDone={() => {
            setShowOnboarding(false);
            try { localStorage.setItem('mv_onboarding_done', '1'); } catch {}
          }}
          onConnectDiscogs={async () => {
            setShowOnboarding(false);
            try { localStorage.setItem('mv_onboarding_done', '1'); } catch {}
            await connectDiscogs();
          }}
          isConnected={discogsConnected}
        />
      )}

      {/* Floating scan FAB removed — Scan is now the centered tab in BottomNav */}

      {showScanner && (
        <div style={{ position:'fixed', inset:0, background:'#000000cc', zIndex:200, display:'flex', flexDirection:'column', justifyContent:'flex-end' }} onClick={e=>e.target===e.currentTarget&&setShowScanner(false)}>
          <div style={{ background:C.bg2, borderRadius:'16px 16px 0 0', maxHeight:'92vh', overflow:'auto', paddingBottom:'env(safe-area-inset-bottom,24px)' }}>
            <div style={{ width:40, height:4, background:'#333', borderRadius:2, margin:'12px auto 0' }}/>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 16px 0' }}>
              <div style={{ ...BEBAS, fontSize:22, color:C.text, letterSpacing:'0.06em' }}>BARCODE SCANNER</div>
              <button onClick={()=>setShowScanner(false)}
                aria-label={t('common.close')}
                style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:24, padding:'10px 14px', minWidth:44, minHeight:44 }}>×</button>
            </div>
            <ScannerTab onAddToCollection={item=>col.addToCollection(item,()=>setShowScanner(false))} onAddToWatchlist={col.toggleWatch} collection={col.collection} watchlist={col.watchlist}/>
          </div>
        </div>
      )}

      {showImportModal && (
        <div style={{ position:'fixed', inset:0, background:'#000000cc', zIndex:200, display:'flex', flexDirection:'column', justifyContent:'flex-end' }} onClick={e=>e.target===e.currentTarget&&setShowImportModal(false)}>
          <div style={{ background:C.bg2, borderRadius:'16px 16px 0 0', maxHeight:'92vh', overflow:'auto', paddingBottom:'env(safe-area-inset-bottom,24px)' }}>
            <div style={{ width:40, height:4, background:'#333', borderRadius:2, margin:'12px auto 0' }}/>
            <DiscogsImport user={user} onImportCollection={col.batchImportCollection} onImportWatchlist={col.batchImportWatchlist}/>
          </div>
        </div>
      )}

      {selected && (
        <VinylModal album={selected}
          onClose={()=>{ setSelected(null); col.setVinylError(''); }}
          onWatchToggle={col.toggleWatch} isWatched={isWatched(selected.id)}
          onAddToCollection={item=>col.addToCollection(item,()=>setSelected(null))}
          vinylData={col.vinylCache[selected.id]||null}
          loading={col.vinylLoading} error={col.vinylError} premium={premium}
          collectionItem={col.collection.find(c => String(c.discogs_id) === String(selected.id) || c.album_id === selected.id) || null}
          onUpgrade={triggerUpgrade}
          onPhotosChange={(itemId, photos) => col.setCollection(prev => prev.map(c => c.id === itemId ? { ...c, user_photos: photos } : c))}
        />
      )}
    </div>
  );
}
