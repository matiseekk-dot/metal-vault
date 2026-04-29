'use client';
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';
import { loadLS, saveLS } from '@/lib/localStorage';
import { useCollection } from '@/lib/hooks/useCollection';
import { AlbumCard, VinylModal, StatsBar, BottomNav, AlbumCover } from '@/app/components/ui';
import { CollectionTab, WatchlistTab } from '@/app/collection/CollectionTab';
import ProfileTab from '@/app/profile/ProfileTab';
import ErrorBoundary from '@/app/components/ErrorBoundary';
import OnboardingScreen from '@/app/components/OnboardingScreen';
import Icon from '@/app/components/Icon';
import UpgradeModal from '@/app/components/UpgradeModal';
import nextDynamic from 'next/dynamic';
export const dynamic = 'force-dynamic';

const ScannerTab    = nextDynamic(() => import('@/app/scanner/ScannerTab'),    { ssr: false });
const DiscogsImport = nextDynamic(() => import('@/app/import/DiscogsImport'),  { ssr: false });
const SearchTab     = nextDynamic(() => import('@/app/search/SearchTab'),       { ssr: false });
const StatsTab      = nextDynamic(() => import('@/app/stats/StatsTab'),         { ssr: false });
const ConcertsTab   = nextDynamic(() => import('@/app/concerts/ConcertsTab'),   { ssr: false });
const CalendarTab   = nextDynamic(() => import('@/app/calendar/CalendarTab'),   { ssr: false });

const FILTERS = [
  { id:'all',      label:'🔥 All'       },
  { id:'preorder', label:'⏳ Upcoming'  },
  { id:'new',      label:'🆕 Released'  },
  { id:'limited',  label:'💎 Limited'   },
  { id:'vinyl',    label:'💿 Has Vinyl' },
];
const ALL_GENRES = ['Heavy Metal','Death Metal','Black Metal','Thrash Metal','Doom Metal',
  'Progressive Metal','Power Metal','Metalcore','Groove Metal','Nu-Metal',
  'Symphonic Metal','Sludge Metal','Industrial Metal','Folk Metal','Post-Metal'];

export default function MetalVault() {
  const supabase = useRef(createClient()).current;

  // Auth
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);

  // Feed
  const [releases,    setReleases]    = useState([]);
  const [source,      setSource]      = useState('');
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError,   setFeedError]   = useState('');

  // UI
  const [tab,             setTab]             = useState('feed');
  const [filter,          setFilter]          = useState('all');
  const [sort,            setSort]            = useState('date_desc');
  const [search,          setSearch]          = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showScanner,     setShowScanner]     = useState(false);
  const [syncStatus,      setSyncStatus]      = useState(null);
  const [syncResult,      setSyncResult]      = useState(null);
  const [genreInterests,  setGenreInterests]  = useState(() => loadLS('mv_genre_interests', []));
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

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      if (session?.user) { col.loadUserData(session.user); loadProfile(session.user); loadPremium(); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      if (session?.user) {
        col.loadUserData(session.user);
        loadProfile(session.user);
        loadPremium();
        // Show onboarding only for real first-time sign-ins
        // TOKEN_REFRESHED also triggers SIGNED_IN — guard with seen flag
        if (event === 'SIGNED_IN') {
          try {
            const seen = localStorage.getItem('mv_onboarding_done');
            // Only show if never seen AND this isn't a tab re-focus token refresh
            // (token refresh happens silently — check if session was just created)
            const isNewUser = !seen && session?.user?.created_at &&
              (Date.now() - new Date(session.user.created_at).getTime()) < 5 * 60 * 1000; // within 5 mins
            if (isNewUser) setShowOnboarding(true);
          } catch {}
        }
      }
      else col.resetUserData();
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

  // Feed
  useEffect(() => {
    setFeedLoading(true); setFeedError('');
    // Pass followed artists so Discogs API can include their upcoming releases
    const artists = col.followedArtists.map(a => a.artist_name).filter(Boolean);
    const discogsUrl = artists.length > 0
      ? '/api/releases?artists=' + encodeURIComponent(artists.join(','))
      : '/api/releases';

    // Fetch Discogs + Metal Archives in parallel; merge + dedupe by (artist+album)
    Promise.all([
      fetch(discogsUrl).then(r => r.ok ? r.json() : { releases: [] }).catch(() => ({ releases: [] })),
      fetch('/api/releases/metal-archives').then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
    ]).then(([discogs, ma]) => {
      const dRel = discogs.releases || [];
      const maRel = (ma.items || []).map(i => ({
        id:           i.id,
        source:       'metal_archives',
        artist:       i.artist,
        album:        i.album,
        cover:        i.cover,
        releaseDate:  i.releaseDate,
        genre:        i.genre,
        preorder:     i.preorder,
        limited:      false,
        type:         i.type,
        discogs_url:  i.albumUrl,
      }));

      // Dedupe: prefer Discogs (has cover images). Key = lowercase "artist::album"
      const seen = new Set();
      const merged = [];
      for (const r of dRel) {
        const k = ((r.artist || '') + '::' + (r.album || '')).toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(r);
      }
      for (const r of maRel) {
        const k = ((r.artist || '') + '::' + (r.album || '')).toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(r);
      }

      // Sort by release date ascending (soonest first for upcoming)
      merged.sort((a, b) => {
        const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return db - da;
      });

      setReleases(merged);
      setSource(discogs.source || 'mixed');
      setFeedLoading(false);
    }).catch(e => { setFeedError(e.message); setFeedLoading(false); });
  }, [feedRetryCount, col.followedArtists.length]); // re-fetch when user follows/unfollows

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
    if (!user) { alert('Sign in first'); return; }
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
        if (!publicKey) { alert('Push not configured — add VAPID keys to Vercel'); setPushLoading(false); return; }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { setPushLoading(false); return; }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:publicKey });
        await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub})});
        setPushEnabled(true);
      }
    } catch(e) { console.error('Push error',e); }
    setPushLoading(false);
  };

  const connectDiscogs = async () => {
    const r = await fetch('/api/discogs/oauth'); const d = await r.json();
    if (d.authorizeUrl) { window.location.href = d.authorizeUrl; }
    else if (d.helpUrl) { if (window.confirm(d.error+'\n\nOpen Discogs developers page?')) window.open(d.helpUrl,'_blank'); }
    else alert(d.error||'Failed to connect Discogs');
  };

  const getShareToken = async () => {
    if (!user) return;
    let r = await fetch('/api/share'); let d = await r.json();
    if (!d.token) { r = await fetch('/api/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'My Collection'})}); d = await r.json(); }
    if (d.token) setShareToken(d.token);
  };

  const startCheckout = async (plan = 'monthly') => {
    try {
      const r = await fetch('/api/stripe/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const d = await r.json();
      if (d.url) window.location.href = d.url;
      else alert(d.error || 'Failed to open checkout');
    } catch { alert('Checkout failed'); }
  };

  const openPortal = async () => {
    try {
      const r = await fetch('/api/stripe/portal', { method: 'POST' });
      const d = await r.json();
      if (d.url) window.location.href = d.url;
    } catch {}
  };

  const triggerUpgrade = (reason = '') => {
    setUpgradeReason(reason);
    setShowUpgrade(true);
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
      if (filter==='new')      return isNew;
      if (filter==='preorder') return isPreorder||r.preorder;
      if (filter==='limited')  return vinyl?.hasLimited===true||r.limited===true;
      if (filter==='vinyl')    return vinyl?.hasVinyl===true;
      return true;
    })
    .filter(r => !search || r.artist.toLowerCase().includes(search.toLowerCase()) || r.album.toLowerCase().includes(search.toLowerCase()))
    .filter(r => genreInterests.length===0
      || genreInterests.includes(r.genre)
      || (r.genres||[]).some(g => genreInterests.includes(g))
      || (r.styles||[]).some(s => genreInterests.includes(s)))
    .sort((a,b) => {
      if (sort==='date_desc') return new Date(b.releaseDate)-new Date(a.releaseDate);
      if (sort==='date_asc')  return new Date(a.releaseDate)-new Date(b.releaseDate);
      if (sort==='artist')    return a.artist.localeCompare(b.artist);
      return 0;
    });

  const isWatched  = id   => col.watchlist.some(w => (w.id||w.album_id) === id);
  const isFollowed = name => col.followedArtists.some(a => a.artist_name === name);

  return (
    <div style={{ minHeight:'100vh', background:C.bg, maxWidth:600, margin:'0 auto' }}>

      <div style={{ background:C.bg, borderBottom:'1px solid '+C.border, padding:'12px 16px 10px', position:'sticky', top:0, zIndex:50 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
            <div style={{ ...BEBAS, fontSize:28, letterSpacing:'0.08em', color:C.text, lineHeight:1 }}>METAL VAULT</div>
            <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.2em', textTransform:'uppercase' }}>
              {tab==='feed'?'RELEASES':tab==='vault'?'VAULT':tab==='calendar'?"WHEN'S ON":tab==='profile'?'PROFILE':tab.toUpperCase()}
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
          {user && col.collectionSummary && col.collectionSummary.totalCurrent > 0 ? (
            <button onClick={()=>setTab('stats')} style={{ background:'none', border:'none', cursor:'pointer', textAlign:'right', padding:0 }}>
              <div style={{ ...BEBAS, fontSize:22, color:C.gold, lineHeight:1, letterSpacing:'0.04em' }}>
                ${col.collectionSummary.totalCurrent.toFixed(0)}
              </div>
              {col.collectionSummary.gain !== 0 && (
                <div style={{ fontSize:9, color: col.collectionSummary.gain >= 0 ? '#4ade80' : '#f87171', ...MONO, textAlign:'right' }}>
                  {col.collectionSummary.gain >= 0 ? '+' : ''}${col.collectionSummary.gain.toFixed(0)}
                </div>
              )}
            </button>
          ) : user ? (
            <div style={{ fontSize:10, color:'#4ade80', ...MONO }}>✓ {user.email?.split('@')[0]}</div>
          ) : null}
          </div>
        </div>
        {source==='mock' && <div style={{ fontSize:9, color:'#555', ...MONO, marginTop:2 }}>⚠ Demo mode — add Discogs API keys</div>}
      </div>

      <div style={{ paddingBottom:100 }}>
        {tab==='feed' && (
          <>
            {!feedLoading && releases.length>0 && <StatsBar releases={releases}/>}
            {/* Following / All tabs — only show Following if user is logged in */}
            <div style={{ display:'flex', borderBottom:'1px solid '+C.border }}>
              {[
                ...(user ? [{ id:'following', label: col.followedArtists.length > 0 ? `🔔 Following (${col.followedArtists.length})` : '🔔 Following' }] : []),
                { id:'all', label: '🔥 All Metal' },
              ].map(t => (
                <button key={t.id} onClick={()=>setFeedTab(t.id)} style={{
                  flex:1, padding:'10px 0', background:'none', border:'none',
                  borderBottom: feedTab===t.id ? '2px solid '+C.accent : '2px solid transparent',
                  color: feedTab===t.id ? C.text : C.dim,
                  cursor:'pointer', fontSize:12, ...MONO,
                }}>
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ display:'flex', gap:6, padding:'8px 16px', overflow:'auto', borderBottom:'1px solid '+C.border }}>
              {FILTERS.map(f => (
                <button key={f.id} onClick={()=>setFilter(f.id)} style={{ padding:'5px 10px', borderRadius:20, whiteSpace:'nowrap', background:filter===f.id?C.accent+'22':C.bg3, color:filter===f.id?C.accent:C.dim, border:'1px solid '+(filter===f.id?C.accent+'66':C.border), cursor:'pointer', fontSize:10, ...MONO }}>
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ padding:'10px 16px 0', display:'flex', gap:8 }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search artist, album…" style={{ ...inputSt, flex:1 }}/>
              <select value={sort} onChange={e=>setSort(e.target.value)} style={{ background:C.bg3, border:'1px solid '+C.border, borderRadius:8, color:C.muted, padding:'0 10px', fontSize:13, ...MONO, cursor:'pointer', outline:'none', flexShrink:0 }}>
                <option value="date_desc">Newest</option><option value="date_asc">Oldest</option><option value="artist">A–Z</option>
              </select>
            </div>
            {!feedLoading && (
              <div style={{ padding:'4px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontSize:10, color:C.dim, ...MONO }}>{filtered.length} release{filtered.length!==1?'s':''}{genreInterests.length>0?' · filtered':''}</div>
                <button onClick={()=>setShowGenrePicker(p=>!p)} style={{ fontSize:10, color:genreInterests.length>0?C.accent:C.dim, ...MONO, background:'none', border:'none', cursor:'pointer', padding:'2px 4px' }}>
                  🎸 {genreInterests.length>0?genreInterests.length+' genres':'genres'}
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
                <div style={{ fontSize:14, color:C.muted, marginBottom:8 }}>No followed artists yet</div>
                <div style={{ fontSize:11, lineHeight:1.6 }}>
                  Follow artists from album cards in the feed<br/>to see their upcoming releases here.
                </div>
                <button onClick={()=>setFeedTab('all')} style={{ marginTop:20, background:C.accent, border:'none', borderRadius:10, color:'#fff', padding:'10px 24px', cursor:'pointer', ...BEBAS, fontSize:16, letterSpacing:'0.08em' }}>
                  Browse All Metal →
                </button>
              </div>
            )}
            {!feedLoading && !feedError && (feedTab!=='following' || followedNames.size>0) && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, padding:'10px 16px 16px' }}>
                {filtered.map(album=>(
                  <AlbumCard key={album.id} album={album} isWatched={isWatched(album.id)} onWatchToggle={col.toggleWatch} onClick={()=>openAlbum(album)} vinylData={col.vinylCache[album.id]||null} isFollowed={isFollowed(album.artist)} onFollowToggle={col.toggleFollow} user={user}/>
                ))}
              </div>
            )}
          </>
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
            releases={releases}
            followedArtists={col.followedArtists}
          /></ErrorBoundary>
        )}

        {tab==='profile' && discogsError && (
          <div style={{margin:'12px 16px',padding:'14px',background:'#2a0000',border:'1px solid #7f1d1d',borderRadius:10,color:'#f87171',fontSize:12,fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>
            <div style={{fontSize:10,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8,color:'#fca5a5'}}>⚠ Discogs connection failed</div>
            <div style={{wordBreak:'break-word',color:'#fee2e2'}}>{discogsError}</div>
            <button onClick={()=>setDiscogsError(null)} style={{marginTop:10,background:'none',border:'1px solid #7f1d1d',borderRadius:6,color:'#f87171',padding:'6px 12px',cursor:'pointer',fontSize:10,fontFamily:"'Space Mono',monospace"}}>Dismiss</button>
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
              <div style={{ fontSize:12, color:C.dim, ...MONO, marginBottom:32, lineHeight:1.7 }}>Sign in to sync your watchlist,<br/>manage your collection and get price alerts.</div>
              <button onClick={()=>window.location.href='/login'} style={{ background:'linear-gradient(135deg,'+C.accent+','+C.accent2+')', border:'none', borderRadius:12, color:'#fff', padding:'15px 32px', ...BEBAS, fontSize:22, letterSpacing:'0.1em', cursor:'pointer' }}>SIGN IN</button>
            </div>
          )
        )}
      </div>

      <BottomNav tab={tab} onChange={setTab} user={user} onScan={()=>setShowScanner(true)}/>

      {showUpgrade && (
        <UpgradeModal
          reason={upgradeReason}
          onClose={() => setShowUpgrade(false)}
          onCheckout={async (plan) => { setShowUpgrade(false); await startCheckout(plan); }}
        />
      )}

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
          onTogglePush={togglePush}
          pushEnabled={pushEnabled}
          pushLoading={pushLoading}
        />
      )}

      {/* Floating scan FAB removed — Scan is now the centered tab in BottomNav */}

      {showScanner && (
        <div style={{ position:'fixed', inset:0, background:'#000000cc', zIndex:200, display:'flex', flexDirection:'column', justifyContent:'flex-end' }} onClick={e=>e.target===e.currentTarget&&setShowScanner(false)}>
          <div style={{ background:C.bg2, borderRadius:'16px 16px 0 0', maxHeight:'92vh', overflow:'auto', paddingBottom:'env(safe-area-inset-bottom,24px)' }}>
            <div style={{ width:40, height:4, background:'#333', borderRadius:2, margin:'12px auto 0' }}/>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 16px 0' }}>
              <div style={{ ...BEBAS, fontSize:22, color:C.text, letterSpacing:'0.06em' }}>BARCODE SCANNER</div>
              <button onClick={()=>setShowScanner(false)} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:24, padding:'0 4px' }}>×</button>
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
          loading={col.vinylLoading} error={col.vinylError} premium={premium}/>
      )}
    </div>
  );
}
