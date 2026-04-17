'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';
import { loadLS, saveLS } from '@/lib/localStorage';
import { useCollection } from '@/lib/hooks/useCollection';
import { AlbumCard, VinylModal, StatsBar, BottomNav } from '@/app/components/ui';
import { CollectionTab, WatchlistTab } from '@/app/collection/CollectionTab';
import ProfileTab from '@/app/profile/ProfileTab';
import dynamic from 'next/dynamic';

const ScannerTab    = dynamic(() => import('@/app/scanner/ScannerTab'),    { ssr: false });
const DiscogsImport = dynamic(() => import('@/app/import/DiscogsImport'),  { ssr: false });
const SearchTab     = dynamic(() => import('@/app/search/SearchTab'),       { ssr: false });
const StatsTab      = dynamic(() => import('@/app/stats/StatsTab'),         { ssr: false });
const ConcertsTab   = dynamic(() => import('@/app/concerts/ConcertsTab'),   { ssr: false });
const CalendarTab   = dynamic(() => import('@/app/calendar/CalendarTab'),   { ssr: false });

const FILTERS = [
  { id:'all',      label:'⚡ All'       },
  { id:'new',      label:'🔥 New'       },
  { id:'preorder', label:'⏳ Pre-order' },
  { id:'limited',  label:'💎 Limited'  },
  { id:'vinyl',    label:'💿 Has Vinyl' },
];
const ALL_GENRES = ['Heavy Metal','Death Metal','Black Metal','Thrash Metal','Doom Metal',
  'Progressive Metal','Power Metal','Metalcore','Groove Metal','Nu-Metal',
  'Symphonic Metal','Sludge Metal','Industrial Metal','Folk Metal','Post-Metal'];

export default function MetalVault() {
  const supabase = createClient();

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
  const [pushLoading,     setPushLoading]     = useState(false);
  const [shareToken,      setShareToken]      = useState(null);
  const [discogsConnected,setDiscogsConnected]= useState(false);
  const [discogsError,    setDiscogsError]    = useState(null);
  const [selected,        setSelected]        = useState(null);

  // Collection hook — all collection/watchlist/vinyl state & actions
  const col = useCollection(user);

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      if (session?.user) { col.loadUserData(session.user); loadProfile(session.user); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user || null);
      if (session?.user) { col.loadUserData(session.user); loadProfile(session.user); }
      else col.resetUserData();
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line

  async function loadProfile(u) {
    const { data } = await supabase.from('profiles').select('*').eq('id', u.id).single();
    if (data) setProfile(data);
  }

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
    fetch('/api/releases')
      .then(r => r.json())
      .then(d => { setReleases(d.releases||[]); setSource(d.source||''); setFeedLoading(false); })
      .catch(e => { setFeedError(e.message); setFeedLoading(false); });
  }, []);

  const openAlbum = (album) => { setSelected(album); col.setVinylError(''); col.fetchVinyl(album); };

  const runSync = () => {
    setSyncStatus('syncing'); setSyncResult(null);
    fetch('/api/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:'both' }) })
      .then(r => r.json())
      .then(async d => {
        setSyncResult(d); setSyncStatus('done');
        const [coll, wl] = await Promise.all([
          fetch('/api/collection').then(r => r.json()),
          fetch('/api/watchlist').then(r => r.json()),
        ]);
        if (coll.items) col.setCollection(coll.items);
        if (wl.items)   col.setWatchlist(wl.items);
      })
      .catch(() => setSyncStatus('error'));
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

  const signOut = async () => {
    await supabase.auth.signOut(); setUser(null); col.resetUserData(); setProfile(null);
  };

  const today = new Date();
  const filtered = releases
    .filter(r => {
      const rd = new Date(r.releaseDate);
      const isPreorder = (rd > today) || r.preorder === true;
      const isNew = (today-rd)/864e5 < 45 && !isPreorder;
      const vinyl = col.vinylCache[r.id];
      if (filter==='new')      return isNew;
      if (filter==='preorder') return isPreorder||r.preorder;
      if (filter==='limited')  return vinyl?.hasLimited===true||r.limited===true;
      if (filter==='vinyl')    return vinyl?.hasVinyl===true;
      return true;
    })
    .filter(r => !search || r.artist.toLowerCase().includes(search.toLowerCase()) || r.album.toLowerCase().includes(search.toLowerCase()))
    .filter(r => genreInterests.length===0 || (r.genres||[]).some(g => genreInterests.includes(g)))
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

      <div style={{ background:C.bg, borderBottom:'1px solid '+C.border, padding:'14px 16px 12px', position:'sticky', top:0, zIndex:50 }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
          <div>
            <div style={{ ...BEBAS, fontSize:30, letterSpacing:'0.08em', color:C.text, lineHeight:1 }}>METAL VAULT</div>
            <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.2em', textTransform:'uppercase' }}>
              {tab==='feed'?'RELEASES':tab==='collection'?'COLLECTION':tab==='profile'?'PROFILE':tab.toUpperCase()}
            </div>
          </div>
          {user && <div style={{ fontSize:10, color:'#4ade80', ...MONO }}>✓ {user.email?.split('@')[0]}</div>}
        </div>
        {source==='mock' && <div style={{ fontSize:9, color:'#555', ...MONO, marginTop:2 }}>⚠ Demo mode — configure SPOTIFY_CLIENT_ID</div>}
      </div>

      <div style={{ paddingBottom:100 }}>
        {tab==='feed' && (
          <>
            {!feedLoading && releases.length>0 && <StatsBar releases={releases}/>}
            <div style={{ display:'flex', gap:6, padding:'10px 16px', overflow:'auto', borderBottom:'1px solid '+C.border }}>
              {FILTERS.map(f => (
                <button key={f.id} onClick={()=>setFilter(f.id)} style={{ padding:'6px 12px', borderRadius:20, whiteSpace:'nowrap', background:filter===f.id?C.accent+'22':C.bg3, color:filter===f.id?C.accent:C.dim, border:'1px solid '+(filter===f.id?C.accent+'66':C.border), cursor:'pointer', fontSize:11, ...MONO }}>
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
            {feedError   && <div style={{ margin:'16px', background:'#1a0000', border:'1px solid '+C.accent+'44', borderRadius:8, padding:'12px 14px', color:'#f87171', fontSize:12, ...MONO }}>⚠ {feedError}</div>}
            {!feedLoading && !feedError && (
              <div style={{ display:'flex', flexDirection:'column', gap:8, padding:'10px 16px 16px' }}>
                {filtered.map(album=>(
                  <AlbumCard key={album.id} album={album} isWatched={isWatched(album.id)} onWatchToggle={col.toggleWatch} onClick={()=>openAlbum(album)} vinylData={col.vinylCache[album.id]||null} isFollowed={isFollowed(album.artist)} onFollowToggle={col.toggleFollow} user={user}/>
                ))}
              </div>
            )}
          </>
        )}

        {tab==='watchlist' && (
          <WatchlistTab watchlist={col.watchlist}
            onRemove={async(id)=>{ if(user)await fetch('/api/watchlist?album_id='+id,{method:'DELETE'}); col.setWatchlist(w=>w.filter(x=>(x.album_id||x.id)!==id)); }}
            onAlbumClick={openAlbum} user={user}/>
        )}

        {tab==='collection' && (
          <CollectionTab user={user} collection={col.collection} watchlist={col.watchlist}
            onRemoveWatch={async(id)=>{ if(user)await fetch('/api/watchlist?album_id='+id,{method:'DELETE'}); col.setWatchlist(w=>w.filter(x=>(x.album_id||x.id)!==id)); }}
            onAddToWatchlist={async(artist,album)=>{ const item={artist,album:album.title,album_id:album.id,cover:album.cover}; col.setWatchlist(w=>[...w,{...item,id:album.id}]); if(user)await fetch('/api/watchlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)}); }}
            onAlbumClick={openAlbum} onRemove={col.removeFromCollection} onUpdate={col.setCollection} portfolio={col.portfolio}/>
        )}

        {tab==='search'   && <SearchTab onWatch={col.toggleWatch} onAddCollection={item=>col.addToCollection(item)} watchlist={col.watchlist} collection={col.collection}/>}
        {tab==='calendar' && <CalendarTab releases={releases} followedArtists={col.followedArtists}/>}
        {tab==='concerts' && <ConcertsTab/>}
        {tab==='stats'    && <StatsTab collection={col.collection} watchlist={col.watchlist} collectionSummary={col.collectionSummary}/>}

        {tab==='profile' && discogsError && (
          <div style={{margin:'12px 16px',padding:'14px',background:'#2a0000',border:'1px solid #7f1d1d',borderRadius:10,color:'#f87171',fontSize:12,fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>
            <div style={{fontSize:10,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8,color:'#fca5a5'}}>⚠ Discogs connection failed</div>
            <div style={{wordBreak:'break-word',color:'#fee2e2'}}>{discogsError}</div>
            <button onClick={()=>setDiscogsError(null)} style={{marginTop:10,background:'none',border:'1px solid #7f1d1d',borderRadius:6,color:'#f87171',padding:'6px 12px',cursor:'pointer',fontSize:10,fontFamily:"'Space Mono',monospace"}}>Dismiss</button>
          </div>
        )}
        {tab==='profile' && (
          user ? (
            <ProfileTab user={user} profile={profile} followedArtists={col.followedArtists}
              onSignOut={signOut} onUpdateProfile={setProfile} onShowImport={()=>setShowImportModal(true)}
              pushEnabled={pushEnabled} pushLoading={pushLoading} onTogglePush={togglePush}
              discogsConnected={discogsConnected} onConnectDiscogs={connectDiscogs}
              onSyncDiscogs={runSync} syncStatus={syncStatus} syncResult={syncResult}
              shareToken={shareToken} onGetShareToken={getShareToken}/>
          ) : (
            <div style={{ textAlign:'center', padding:'80px 24px' }}>
              <div style={{ ...BEBAS, fontSize:40, color:C.text, marginBottom:8, lineHeight:1 }}>METAL VAULT</div>
              <div style={{ fontSize:12, color:C.dim, ...MONO, marginBottom:32, lineHeight:1.7 }}>Sign in to sync your watchlist,<br/>manage your collection and get price alerts.</div>
              <button onClick={()=>window.location.href='/login'} style={{ background:'linear-gradient(135deg,'+C.accent+','+C.accent2+')', border:'none', borderRadius:12, color:'#fff', padding:'15px 32px', ...BEBAS, fontSize:22, letterSpacing:'0.1em', cursor:'pointer' }}>SIGN IN</button>
            </div>
          )
        )}
      </div>

      <BottomNav tab={tab} onChange={setTab} user={user}/>

      {(tab==='feed'||tab==='search'||tab==='collection') && (
        <button onClick={()=>setShowScanner(true)} style={{ position:'fixed', bottom:80, right:16, zIndex:90, width:56, height:56, borderRadius:16, background:'linear-gradient(135deg,#dc2626,#991b1b)', border:'none', color:'#fff', cursor:'pointer', fontSize:24, boxShadow:'0 4px 24px rgba(220,38,38,0.5)', display:'flex', alignItems:'center', justifyContent:'center' }}>📷</button>
      )}

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
          loading={col.vinylLoading} error={col.vinylError}/>
      )}
    </div>
  );
}
