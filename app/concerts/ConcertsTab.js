'use client';
import { useState, useEffect, useRef } from 'react';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';
import { toast } from '@/app/components/Toast';
import { useT, useLocale } from '@/lib/i18n';
import { useCurrency, useFx, formatPrice } from '@/lib/currency';


const VENUES = [
  // Arenas
  {id:1,name:"Madison Square Garden",city:"New York",cat:"Arena"},
  {id:2,name:"O2 Arena",city:"London",cat:"Arena"},
  {id:3,name:"Accor Arena",city:"Paris",cat:"Arena"},
  {id:4,name:"Mercedes-Benz Arena",city:"Berlin",cat:"Arena"},
  {id:5,name:"Ziggo Dome",city:"Amsterdam",cat:"Arena"},
  {id:6,name:"Rod Laver Arena",city:"Melbourne",cat:"Arena"},
  // Clubs
  {id:7,name:"House of Blues",city:"Los Angeles",cat:"Club"},
  {id:8,name:"The Fillmore",city:"San Francisco",cat:"Club"},
  {id:9,name:"Roundhouse",city:"London",cat:"Club"},
  {id:10,name:"Melkweg",city:"Amsterdam",cat:"Club"},
  {id:11,name:"Bataclan",city:"Paris",cat:"Club"},
  {id:12,name:"Paradiso",city:"Amsterdam",cat:"Club"},
  {id:13,name:"Brixton Academy",city:"London",cat:"Club"},
  // Festivals
  {id:14,name:"Download Festival",city:"Donington",cat:"Festival"},
  {id:15,name:"Wacken Open Air",city:"Wacken",cat:"Festival"},
  {id:16,name:"Hellfest",city:"Clisson",cat:"Festival"},
  {id:17,name:"Graspop",city:"Dessel",cat:"Festival"},
  {id:18,name:"Rock am Ring",city:"Nürburg",cat:"Festival"},
  {id:19,name:"Mystic Festival",city:"Gdansk",cat:"Festival"},
  {id:20,name:"Summer Breeze",city:"Dinkelsbühl",cat:"Festival"},
];
const CAT_COLOR = {Arena:"#4cc8e8",Hall:"#a78bfa",Klub:"#e84c4c",Festival:"#f5c842",Other:"#aaa"};
const GENRES = ["Metal","Rock","Black Metal","Death Metal","Doom Metal","Thrash Metal","Heavy Metal","Progressive Metal","Metalcore","Sludge Metal","Grindcore","Post-Metal","Folk Metal","Symphonic Metal","Industrial Metal","Nu-Metal","Punk","Hardcore","Other"];
const LS_KEY = 'mv_concerts_v1';
const LS_VENUES = 'mv_venues_v1';

function loadLS(k,fb){try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch{return fb;}}
function saveLS(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

function Stars({value,onChange}){
  const [hover,setHover]=useState(0);
  return(
    <div style={{display:'flex',gap:3}}>
      {[1,2,3,4,5].map(s=>(
        <span key={s} onMouseEnter={()=>onChange&&setHover(s)} onMouseLeave={()=>onChange&&setHover(0)}
          onClick={()=>onChange&&onChange(s)}
          style={{fontSize:22,cursor:onChange?'pointer':'default',color:s<=(hover||value)?'#f5c842':'#333',userSelect:'none'}}>★</span>
      ))}
    </div>
  );
}



// ── AttendancePrompts — "Did you go to X?" banner ─────────────────
// Shows pending events from concert_attendance_prompts. User can confirm
// (auto-fills concert form via callback) or dismiss. Prompts come from
// daily snapshot of followed artists' past Bandsintown events.
function AttendancePrompts({ onAttendConfirm }) {
  const t = useT();
  const locale = useLocale();
  const [prompts, setPrompts] = useState([]);
  const [hidden,  setHidden]  = useState(false);

  useEffect(() => {
    // Pass active locale so the server can apply a country whitelist —
    // a Polish user shouldn't get prompts for shows in Texas.
    fetch('/api/concerts/attendance?locale=' + encodeURIComponent(locale))
      .then(r => r.json())
      .then(d => setPrompts(d.prompts || []))
      .catch(() => setPrompts([]));
  }, [locale]);

  const respond = async (eventId, status, prompt) => {
    setPrompts(p => p.filter(x => x.event_id !== eventId));
    try {
      await fetch('/api/concerts/attendance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, status }),
      });
    } catch {}
    if (status === 'attended' && onAttendConfirm) onAttendConfirm(prompt);
  };

  if (hidden || prompts.length === 0) return null;

  return (
    <div style={{
      margin: '10px 16px', background: '#0d1a0d',
      border: '1px solid #1a4d1a', borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: '#4ade80', ...MONO,
          letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          {t(prompts.length === 1 ? 'concerts.attendedTitle.one' : 'concerts.attendedTitle.many', { n: prompts.length })}
        </div>
        <button onClick={() => setHidden(true)}
          style={{ background: 'none', border: 'none', color: C.dim,
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {prompts.slice(0, 3).map(p => (
        <div key={p.event_id} style={{
          background: C.bg3, borderRadius: 8, padding: '10px 12px',
          marginBottom: 6,
        }}>
          <div style={{ fontSize: 12, color: C.text, ...MONO, marginBottom: 2 }}>
            <span style={{ ...BEBAS, fontSize: 14, letterSpacing: '0.04em' }}>{p.artist}</span>
          </div>
          <div style={{ fontSize: 10, color: C.dim, ...MONO, marginBottom: 8 }}>
            {[p.venue, p.city].filter(Boolean).join(' · ')} · {p.event_date}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => respond(p.event_id, 'attended', p)}
              style={{ flex: 1, padding: '7px',
                background: '#0a3d0a', border: '1px solid #1a6d1a',
                borderRadius: 6, color: '#4ade80', cursor: 'pointer',
                ...MONO, fontSize: 11, letterSpacing: '0.04em' }}>
              ✓ {t('concerts.attended.yes')}
            </button>
            <button onClick={() => respond(p.event_id, 'dismissed', p)}
              style={{ flex: 1, padding: '7px',
                background: 'transparent', border: '1px solid ' + C.border,
                borderRadius: 6, color: C.dim, cursor: 'pointer',
                ...MONO, fontSize: 11 }}>
              {t('concerts.attended.no')}
            </button>
          </div>
        </div>
      ))}
      {prompts.length > 3 && (
        <div style={{ fontSize: 9, color: C.dim, ...MONO, textAlign: 'center', marginTop: 4 }}>
          {t('concerts.attended.more', { n: prompts.length - 3 })}
        </div>
      )}
    </div>
  );
}


// ── SetlistViewer — fetch + display setlist for a concert ──
// Lazily loads setlist.fm data when user expands a concert in the list.
// Caches per concert ID via state — no re-fetch on collapse/expand.
function SetlistViewer({ artist, year, city, onClose }) {
  const [data, setData] = useState({ loading: true, setlists: [] });

  useEffect(() => {
    const params = new URLSearchParams({ artist });
    if (year) params.set('year', year);
    if (city) params.set('city', city);
    fetch('/api/setlist?' + params.toString())
      .then(r => r.json())
      .then(d => setData({ loading: false, setlists: d.setlists || [], skipped: d.skipped }))
      .catch(() => setData({ loading: false, setlists: [] }));
  }, [artist, year, city]);

  if (data.loading) {
    return (
      <div style={{ padding: '12px', textAlign: 'center', color: C.dim, ...MONO, fontSize: 11 }}>
        Searching setlist.fm…
      </div>
    );
  }

  if (data.skipped === 'not_configured') {
    return (
      <div style={{ padding: '12px', color: C.dim, ...MONO, fontSize: 10, lineHeight: 1.5 }}>
        Setlist lookup not configured. Set SETLISTFM_API_KEY to enable.
      </div>
    );
  }

  if (data.setlists.length === 0) {
    return (
      <div style={{ padding: '12px', color: C.dim, ...MONO, fontSize: 11, textAlign: 'center' }}>
        No setlist found for this show.
        <a href={'https://www.setlist.fm/search?query=' + encodeURIComponent(artist + (year ? ' ' + year : ''))}
          target="_blank" rel="noopener noreferrer"
          style={{ display: 'block', marginTop: 6, color: C.accent, fontSize: 10 }}>
          Search setlist.fm →
        </a>
      </div>
    );
  }

  // Show first match — usually most relevant when filtered by year+city
  const sl = data.setlists[0];
  return (
    <div style={{ padding: '10px 12px', background: C.bg3, borderRadius: 6 }}>
      <div style={{ fontSize: 9, color: C.accent, ...MONO, letterSpacing: '0.15em',
        textTransform: 'uppercase', marginBottom: 6 }}>
        Setlist · {sl.eventDate}{sl.tour ? ' · ' + sl.tour : ''}
      </div>
      <ol style={{ margin: 0, paddingLeft: 22, color: C.text, fontSize: 11, ...MONO, lineHeight: 1.6 }}>
        {sl.songs.map((song, i) => <li key={i}>{song}</li>)}
      </ol>
      {data.setlists.length > 1 && (
        <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 6 }}>
          {data.setlists.length} setlists found · showing first match
        </div>
      )}
      <a href={sl.url} target="_blank" rel="noopener noreferrer"
        style={{ display: 'inline-block', marginTop: 8, fontSize: 10, color: C.accent, ...MONO }}>
        View on setlist.fm →
      </a>
    </div>
  );
}

export default function ConcertsTab() {
  const t = useT();
  const cur = useCurrency();
  const fx  = useFx();
  const [concerts,setConcerts] = useState([]);
  const [venues,setVenues]     = useState(VENUES);
  const [tab,setTab]           = useState('list'); // list | ranking
  const [showForm,setShowForm] = useState(false);
  const [editId,setEditId]     = useState(null);
  const [search,setSearch]     = useState('');
  const [sortBy,setSortBy]     = useState('year_desc');
  const [form,setForm]         = useState({band:'',venueId:null,year:String(new Date().getFullYear()),genre:'Metal',rating:0,price:'',note:''});
  const [suggestions,setSugg]  = useState([]);
  const [error,setError]       = useState('');
  const [newVenue,setNewVenue] = useState('');
  const [showVenueAdd,setShowVenueAdd] = useState(false);
  const [setlistOpen,setSetlistOpen] = useState({});  // concert.id → bool
  const inputRef = useRef();

  // Load + sync flow:
  //   1. Hydrate from localStorage immediately (instant UI on every device)
  //   2. In the background, GET /api/user-concerts (401 = anonymous; stay
  //      local-only). On success, push any local-only items UP to the
  //      server (one-shot migration of pre-sync localStorage data) and
  //      then merge server data DOWN into state.
  // Built-in venues (numeric ids) never travel — they live in code.
  useEffect(() => {
    const localConcerts = loadLS(LS_KEY, []);
    setConcerts(localConcerts);
    const sv = loadLS(LS_VENUES, null);
    if (sv) setVenues(sv);

    (async () => {
      let r;
      try { r = await fetch('/api/user-concerts'); } catch { return; }
      if (r.status === 401 || !r.ok) return;          // anon or transient — keep local
      let server;
      try { server = await r.json(); } catch { return; }

      const serverConcerts = server.concerts || [];
      const serverVenues   = server.venues   || [];

      const serverConcertIds = new Set(serverConcerts.map(c => c.id));
      const localOnlyConcerts = localConcerts.filter(c => c.id && !serverConcertIds.has(c.id));

      const localVenuesAll = sv || venues;
      const userAddedLocal = localVenuesAll.filter(v => typeof v.id === 'string');
      const serverVenueIds = new Set(serverVenues.map(v => v.id));
      const localOnlyVenues = userAddedLocal.filter(v => !serverVenueIds.has(v.id));

      if (localOnlyConcerts.length) {
        try {
          await fetch('/api/user-concerts', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ concerts: localOnlyConcerts }),
          });
        } catch {}
      }
      if (localOnlyVenues.length) {
        try {
          await fetch('/api/user-venues', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ venues: localOnlyVenues }),
          });
        } catch {}
      }

      // Merge: server is the source of truth + items we just pushed up.
      const mergedConcerts = [...serverConcerts, ...localOnlyConcerts];
      const mergedVenues   = [
        ...VENUES,                               // built-ins (numeric ids)
        ...serverVenues,
        ...localOnlyVenues.filter(lv => !serverVenueIds.has(lv.id)),
      ];

      // Dedupe by id, keeping the first occurrence (server wins over local-only).
      const seenC = new Set();
      const finalConcerts = mergedConcerts.filter(c => seenC.has(c.id) ? false : (seenC.add(c.id), true));
      const seenV = new Set();
      const finalVenues   = mergedVenues.filter(v => seenV.has(v.id) ? false : (seenV.add(v.id), true));

      setConcerts(finalConcerts);
      setVenues(finalVenues);
      saveLS(LS_KEY,    finalConcerts);
      saveLS(LS_VENUES, finalVenues);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Local-only writer used as the optimistic step before server sync.
  const save = (c, v = venues) => {
    setConcerts(c); saveLS(LS_KEY, c);
    if (v !== venues) { setVenues(v); saveLS(LS_VENUES, v); }
  };

  // Fire-and-forget server-side persistence. Failures don't roll back —
  // user keeps the local change; a toast lets them know to retry.
  const syncConcert = (item) => {
    fetch('/api/user-concerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    }).then(async r => {
      if (r.status === 401 || r.ok) return;
      const d = await r.json().catch(() => ({}));
      toast.error('Saved locally — sync failed (' + (d.error || r.status) + ')');
    }).catch(() => {});
  };
  const syncDeleteConcert = (id) => {
    fetch('/api/user-concerts?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
  };
  const syncVenue = (v) => {
    fetch('/api/user-venues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
    }).catch(() => {});
  };

  const resetForm = () => { setForm({band:'',venueId:null,year:String(new Date().getFullYear()),genre:'Metal',rating:0,price:'',note:''});setEditId(null);setSugg([]);setError(''); };

  const handleBand = v => {
    setForm(f=>({...f,band:v}));
    const bands=[...new Set(concerts.map(c=>c.band))];
    setSugg(v.length>0?bands.filter(b=>b.toLowerCase().startsWith(v.toLowerCase())&&b.toLowerCase()!==v.toLowerCase()):[]);
  };

  const submit = () => {
    if(!form.band.trim()){setError(t('concerts.error.bandRequired'));return;}
    const entry = {...form,band:form.band.trim(),id:editId||crypto.randomUUID()};
    const updated = editId ? concerts.map(c=>c.id===editId?entry:c) : [entry,...concerts];
    save(updated);
    syncConcert(entry);
    resetForm();setShowForm(false);
  };

  const del    = id => { save(concerts.filter(c=>c.id!==id)); syncDeleteConcert(id); };
  const edit   = c  => { setForm({band:c.band,venueId:c.venueId||null,year:c.year||'',genre:c.genre||'Metal',rating:c.rating||0,price:c.price||'',note:c.note||''});setEditId(c.id);setShowForm(true);setSugg([]);setTimeout(()=>inputRef.current?.focus(),80); };
  const copy   = c  => { setForm({band:'',venueId:c.venueId,year:c.year||'',genre:c.genre,rating:0,price:c.price||'',note:''});setShowForm(true);setSugg([]);setTimeout(()=>inputRef.current?.focus(),80); };

  const addVenue = () => {
    if(!newVenue.trim())return;
    const v={id:crypto.randomUUID(),name:newVenue.trim(),city:'',cat:'Other'};
    const nv=[...venues,v]; setVenues(nv); saveLS(LS_VENUES,nv);
    setForm(f=>({...f,venueId:v.id})); setNewVenue(''); setShowVenueAdd(false);
    syncVenue(v);
  };

  // Stats
  const bandMap = {};
  concerts.forEach(c=>{bandMap[c.band]=(bandMap[c.band]||[]);bandMap[c.band].push(c);});
  const totalSpent = concerts.reduce((s,c)=>s+(Number(c.price)||0),0);
  const mostSeen   = Object.entries(bandMap).sort((a,b)=>b[1].length-a[1].length)[0];

  // Compare venue ids as strings — built-ins use numeric ids, user-added
  // venues use crypto.randomUUID() strings, and the <select> option value
  // is always serialized to string. String() coercion makes the lookup
  // type-agnostic.
  const findVenue = (id) => venues.find(v => String(v.id) === String(id));

  const filtered = concerts.filter(c=>{
    const q=search.toLowerCase();
    const v=findVenue(c.venueId);
    return c.band.toLowerCase().includes(q)||(v?.name||'').toLowerCase().includes(q);
  }).sort((a,b)=>{
    if(sortBy==='year_desc')return (b.year||'0').localeCompare(a.year||'0');
    if(sortBy==='year_asc') return (a.year||'0').localeCompare(b.year||'0');
    if(sortBy==='band')     return a.band.localeCompare(b.band);
    if(sortBy==='rating')   return (b.rating||0)-(a.rating||0);
    return 0;
  });

  const ranked = Object.entries(bandMap)
    .filter(([b])=>b.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>b[1].length-a[1].length||(a[0].localeCompare(b[0])));

  const venue = findVenue(form.venueId);

  return(
    <div style={{padding:'0 0 16px'}}>
      {/* Stats strip */}
      <div style={{display:'flex',borderBottom:`1px solid ${C.border}`,background:C.bg2}}>
        {[
          {icon:'🎸',val:concerts.length,label:t('concerts.stats.shows')},
          {icon:'🏆',val:Object.keys(bandMap).length,label:t('concerts.stats.bands')},
          {icon:'🎟',val:totalSpent>0 ? formatPrice(totalSpent, cur, fx) : '—',label:t('concerts.stats.spent')},
        ].map(s=>(
          <div key={s.label} style={{flex:1,textAlign:'center',padding:'10px 4px'}}>
            <div style={{fontSize:11,...MONO,color:C.dim}}>{s.icon}</div>
            <div style={{...BEBAS,fontSize:20,color:C.accent,lineHeight:1}}>{s.val}</div>
            <div style={{fontSize:9,color:C.dim,...MONO,letterSpacing:'0.1em',textTransform:'uppercase'}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Attendance prompts — "Did you go to that show?" */}
      <AttendancePrompts onAttendConfirm={(prompt) => {
        // ── Auto-add concert to My Shows ──
        // Bandsintown gave us artist + venue + city + date. We auto-create
        // the venue (if not yet in user's venues list) and save the concert
        // immediately with rating=0/price=null. User gets a toast offering
        // to edit (add rating, price). This avoids the "Yes" → form → save
        // double-click frustration for users with many prompts.
        const year = (prompt.event_date || '').split('-')[0];

        // Find or create venue (case-insensitive match on name+city)
        let venueId = null;
        let updatedVenues = venues;
        if (prompt.venue) {
          const existing = venues.find(v =>
            v.name.toLowerCase() === prompt.venue.toLowerCase() &&
            (v.city || '').toLowerCase() === (prompt.city || '').toLowerCase()
          );
          if (existing) {
            venueId = existing.id;
          } else {
            const newVenue = {
              id: crypto.randomUUID(),
              name: prompt.venue,
              city: prompt.city || '',
              cat: 'Other',
            };
            updatedVenues = [...venues, newVenue];
            venueId = newVenue.id;
          }
        }

        // Build concert record
        const concert = {
          id: crypto.randomUUID(),
          band: prompt.artist,
          venueId,
          year: year || String(new Date().getFullYear()),
          genre: 'Metal',
          rating: 0,
          price: '',
          note: '',
        };

        // Save (this updates state + localStorage)
        save([concert, ...concerts], updatedVenues);

        // Show edit form so user can immediately add rating/price if they want
        setForm(concert);
        setEditId(concert.id);
        setShowForm(true);
      }}/>

      <div style={{padding:'12px 16px 0'}}>
        {/* Subtabs */}
        <div style={{display:'flex',marginBottom:12,borderBottom:`1px solid ${C.border}`}}>
          {[['list','📋 ' + t('concerts.tab.list')],['ranking','🏆 ' + t('concerts.tab.ranking')]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)}
              style={{padding:'8px 16px',background:'none',border:'none',cursor:'pointer',
                borderBottom:tab===k?`2px solid ${C.accent}`:'2px solid transparent',
                color:tab===k?C.text:C.dim,...MONO,fontSize:11,marginBottom:-1}}>
              {l}
            </button>
          ))}
        </div>

        {/* Add + Export/Import row */}
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <button onClick={()=>{if(showForm)resetForm();setShowForm(f=>!f);}}
            style={{flex:1,padding:'12px',
              background:showForm?C.bg3:`linear-gradient(135deg,${C.accent},${C.accent2})`,
              border:showForm?`1px solid ${C.border}`:'none',
              borderRadius:10,color:showForm?C.muted:'#fff',cursor:'pointer',
              ...BEBAS,fontSize:17,letterSpacing:'0.1em'}}>
            {showForm?(editId?t('concerts.cancelEdit'):t('concerts.cancel')):(editId?t('concerts.editing'):t('concerts.add'))}
          </button>
          {concerts.length > 0 && (
            <button onClick={()=>{
              const headers = ['Band','Year','Genre','Rating','Price','Venue','Note'];
              const rows = concerts.map(c => {
                const v = findVenue(c.venueId);
                return [c.band,c.year||'',c.genre||'',c.rating||'',c.price||'',v?v.name:'',c.note||'']
                  .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
              });
              const csv = [headers.join(','),...rows].join('\n');
              const a = document.createElement('a');
              a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
              a.download = 'metal-vault-concerts.csv';
              a.click();
            }}
            title="Export concerts to CSV"
            style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:10,color:C.muted,
              padding:'0 14px',cursor:'pointer',...MONO,fontSize:12,flexShrink:0}}>
              ↓ CSV
            </button>
          )}
          <label title="Import concerts from CSV" style={{flexShrink:0,cursor:'pointer'}}>
            <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:10,color:C.muted,
              padding:'12px 14px',...MONO,fontSize:12,lineHeight:1}}>
              ↑ CSV
            </div>
            <input type="file" accept=".csv" style={{display:'none'}} onChange={e=>{
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => {
                try {
                  const lines = ev.target.result.replace(/\r\n/g,'\n').split('\n').filter(l=>l.trim());
                  if (lines.length < 2) return;
                  const hdrs = lines[0].split(',').map(h=>h.replace(/"/g,'').toLowerCase().trim());
                  const bandIdx  = hdrs.indexOf('band');
                  const yearIdx  = hdrs.indexOf('year');
                  const genreIdx = hdrs.indexOf('genre');
                  const rateIdx  = hdrs.indexOf('rating');
                  const priceIdx = hdrs.indexOf('price');
                  const noteIdx  = hdrs.indexOf('note');
                  const venueIdx = hdrs.indexOf('venue');
                  if (bandIdx === -1) { toast.error('CSV must have a "Band" column'); return; }
                  const imported = [];
                  for (const line of lines.slice(1)) {
                    const cols = line.split(',').map(c=>c.replace(/^"|"$/g,'').trim());
                    const band = cols[bandIdx];
                    if (!band) continue;
                    imported.push({
                      id: crypto.randomUUID(),
                      band,
                      year:   yearIdx  >= 0 ? cols[yearIdx]  || '' : '',
                      genre:  genreIdx >= 0 ? cols[genreIdx] || 'Metal' : 'Metal',
                      rating: rateIdx  >= 0 ? Number(cols[rateIdx]) || 0 : 0,
                      price:  priceIdx >= 0 ? cols[priceIdx] || '' : '',
                      note:   noteIdx  >= 0 ? cols[noteIdx]  || '' : '',
                      venueId: null,
                    });
                  }
                  if (!imported.length) { toast.error(t('concerts.import.noValidRows')); return; }
                  const merged = [...concerts];
                  const existing = new Set(concerts.map(c=>(c.band+c.year).toLowerCase()));
                  let added = 0;
                  for (const c of imported) {
                    if (!existing.has((c.band+c.year).toLowerCase())) {
                      merged.unshift(c); added++;
                    }
                  }
                  save(merged);
                  toast.success(`Imported ${added} concerts (${imported.length - added} duplicates skipped)`);
                } catch(err) { toast.error('Import failed: ' + err.message); }
              };
              reader.readAsText(file);
              e.target.value = '';
            }}/>
          </label>
        </div>

        {/* Form */}
        {showForm&&(
          <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:14,display:'flex',flexDirection:'column',gap:10}}>
            {/* Band */}
            <div style={{position:'relative'}}>
              <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>Band / Artist *</label>
              <input ref={inputRef} value={form.band} onChange={e=>handleBand(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter')submit();if(e.key==='Escape')setSugg([]);}}
                placeholder="e.g. Metallica" style={inputSt} autoComplete="off"/>
              {suggestions.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#1e1e1e',
                  border:`1px solid ${C.border}`,borderRadius:'0 0 8px 8px',zIndex:10,overflow:'hidden'}}>
                  {suggestions.slice(0,5).map(s=>(
                    <div key={s} onClick={()=>{setForm(f=>({...f,band:s}));setSugg([]);}}
                      style={{padding:'10px 12px',cursor:'pointer',fontSize:14,...MONO,color:C.muted,display:'flex',alignItems:'center',gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background='#2a2a2a'}
                      onMouseLeave={e=>e.currentTarget.style.background='none'}>
                      <span style={{color:C.accent,fontSize:10}}>↺</span>{s}
                      <span style={{fontSize:10,color:C.dim,marginLeft:'auto'}}>{bandMap[s]?.length}× seen</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Venue */}
            <div>
              <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>{t('concerts.form.venue')}</label>
              {/* Keep value as string — built-in venues use numeric ids
                  but user-added venues use crypto.randomUUID() strings.
                  Number(uuidString) returns NaN, breaking lookup. The
                  venues.find(v => v.id === ...) call works for both
                  shapes because <option value> is always stringified. */}
              <select value={form.venueId==null?'':String(form.venueId)} onChange={e=>setForm(f=>({...f,venueId:e.target.value||null}))}
                style={{...inputSt,cursor:'pointer'}}>
                <option value="">{t('concerts.form.selectVenue')}</option>
                {['Arena','Club','Festival','Hall','Other'].map(cat=>{
                  const vs=venues.filter(v=>v.cat===cat);
                  return vs.length>0?(
                    <optgroup key={cat} label={cat}>
                      {vs.map(v=><option key={v.id} value={v.id}>{v.name}{v.city?` — ${v.city}`:''}</option>)}
                    </optgroup>
                  ):null;
                })}
              </select>
              {!showVenueAdd?(
                <button onClick={()=>setShowVenueAdd(true)}
                  style={{fontSize:10,color:C.accent,...MONO,background:'none',border:'none',cursor:'pointer',marginTop:4,padding:0}}>
                  + {t('concerts.form.addVenue')}
                </button>
              ):(
                <div style={{display:'flex',gap:6,marginTop:6}}>
                  <input value={newVenue} onChange={e=>setNewVenue(e.target.value)} placeholder={t('concerts.form.venueName')}
                    onKeyDown={e=>e.key==='Enter'&&addVenue()}
                    style={{...inputSt,flex:1,padding:'8px 10px'}}/>
                  <button onClick={addVenue} style={{background:C.accent,border:'none',borderRadius:8,color:'#fff',padding:'0 14px',cursor:'pointer',...BEBAS,fontSize:15}}>{t('concerts.form.add').toUpperCase()}</button>
                </div>
              )}
            </div>

            {/* Year + Genre */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>{t('concerts.form.year')}</label>
                <input type="number" inputMode="numeric" min="1950" max="2099" value={form.year} onChange={e=>setForm(f=>({...f,year:e.target.value}))} style={inputSt}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>{t('concerts.form.genre')}</label>
                <select value={form.genre} onChange={e=>setForm(f=>({...f,genre:e.target.value}))} style={{...inputSt,cursor:'pointer'}}>
                  {GENRES.map(g=><option key={g}>{g}</option>)}
                </select>
              </div>
            </div>

            {/* Rating + Price */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:6}}>{t('concerts.form.rating')}</label>
                <Stars value={form.rating} onChange={v=>setForm(f=>({...f,rating:v}))}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>{t('concerts.form.price')}</label>
                <input type="number" inputMode="decimal" min="0" value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} placeholder={t('concerts.form.pricePlaceholder')} style={inputSt}/>
              </div>
            </div>

            {/* Note */}
            <div>
              <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>{t('concerts.form.note')}</label>
              <textarea value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}
                placeholder={t('concerts.form.notePlaceholder')} rows={2} style={{...inputSt,resize:'vertical',fontStyle:'italic'}}/>
            </div>

            {error&&<div style={{color:C.accent,fontSize:12,...MONO}}>{error}</div>}

            <button onClick={submit} style={{padding:'13px',background:`linear-gradient(135deg,${C.accent},${C.accent2})`,border:'none',borderRadius:8,color:'#fff',cursor:'pointer',...BEBAS,fontSize:17,letterSpacing:'0.1em'}}>
              {editId ? t('concerts.form.saveChanges') : t('concerts.form.save')}
            </button>
          </div>
        )}

        {/* Search + Sort */}
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('common.search') + '…'}
            style={{...inputSt,flex:1,padding:'9px 12px'}}/>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,
              padding:'0 10px',fontSize:13,...MONO,cursor:'pointer',outline:'none'}}>
            <option value="year_desc">{t('concerts.sort.yearDesc')}</option>
            <option value="year_asc">{t('concerts.sort.yearAsc')}</option>
            <option value="band">{t('concerts.sort.band')}</option>
            <option value="rating">{t('concerts.sort.rating')}</option>
          </select>
        </div>

        {/* List tab */}
        {tab==='list'&&(
          filtered.length===0
            ?<div style={{textAlign:'center',padding:'50px 0',color:C.dim,...MONO}}>
               <div style={{fontSize:44,marginBottom:10}}>🎸</div>
               <div style={{...BEBAS,fontSize:18,color:'#333'}}>{concerts.length===0 ? t('concerts.empty.cta') : t('common.noResults')}</div>
             </div>
            :<div style={{display:'flex',flexDirection:'column',gap:8}}>
               {filtered.map(c=>{
                 const v=findVenue(c.venueId);
                 const col=v?CAT_COLOR[v.cat]||'#aaa':'#555';
                 return(
                   <div key={c.id} style={{background:C.bg2,border:`1px solid ${C.border}`,
                     borderLeft:`4px solid ${col}`,borderRadius:10,padding:'13px 14px'}}>
                     <div style={{display:'flex',justifyContent:'space-between',gap:10}}>
                       <div style={{flex:1,minWidth:0}}>
                         <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
                           <span style={{...BEBAS,fontSize:20,letterSpacing:'0.05em',color:C.text,lineHeight:1}}>{c.band}</span>
                           <span style={{fontSize:9,...MONO,padding:'2px 7px',borderRadius:20,
                             background:`${col}22`,color:col,border:`1px solid ${col}44`}}>{c.genre}</span>
                         </div>
                         <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
                           {v&&<span style={{fontSize:11,color:C.dim,...MONO}}>📍{v.name}{v.city?` · ${v.city}`:''}</span>}
                           {c.year&&<span style={{fontSize:11,color:C.dim,...MONO}}>📅{c.year}</span>}
                           {c.price>0&&<span style={{fontSize:11,color:'#f5c842',...MONO}}>🎟{Number(c.price).toFixed(0)}</span>}
                         </div>
                         {c.note&&<p style={{margin:'7px 0 0',fontSize:12,color:C.muted,fontFamily:'Georgia,serif',fontStyle:'italic',lineHeight:1.5}}>"{c.note}"</p>}
                         <div style={{marginTop:6}}><Stars value={c.rating||0}/></div>
                         <div style={{display:'flex',gap:6,marginTop:8}}>
                           <button onClick={()=>edit(c)} style={{flex:1,padding:'6px',background:C.bg3,border:`1px solid ${C.border}`,borderRadius:7,color:C.muted,cursor:'pointer',fontSize:11,...MONO}}>✏ Edit</button>
                           <button onClick={()=>copy(c)} style={{flex:1,padding:'6px',background:C.bg3,border:`1px solid ${C.border}`,borderRadius:7,color:C.muted,cursor:'pointer',fontSize:11,...MONO}}>⧉ Copy</button>
                           <button onClick={()=>setSetlistOpen(s=>({...s,[c.id]:!s[c.id]}))} style={{flex:1,padding:'6px',background:setlistOpen[c.id]?C.accent+'22':C.bg3,border:`1px solid ${setlistOpen[c.id]?C.accent+'66':C.border}`,borderRadius:7,color:setlistOpen[c.id]?C.accent:C.muted,cursor:'pointer',fontSize:11,...MONO}}>♪ Setlist</button>
                         </div>
                         {setlistOpen[c.id] && (
                           <div style={{marginTop:8}}>
                             <SetlistViewer
                               artist={c.band}
                               year={c.year}
                               city={(venues.find(vn=>vn.id===c.venueId) || {}).city}
                             />
                           </div>
                         )}
                       </div>
                       <button onClick={()=>del(c.id)} style={{background:'none',border:'none',color:'#333',cursor:'pointer',fontSize:20,padding:'2px 4px',flexShrink:0}}
                         onMouseEnter={e=>e.currentTarget.style.color=C.accent}
                         onMouseLeave={e=>e.currentTarget.style.color='#333'}>×</button>
                     </div>
                   </div>
                 );
               })}
             </div>
        )}

        {/* Ranking tab */}
        {tab==='ranking'&&(
          ranked.length===0
            ?<div style={{textAlign:'center',padding:'50px 0',color:C.dim,...MONO}}><div style={{fontSize:44}}>🏆</div></div>
            :<div style={{display:'flex',flexDirection:'column',gap:8}}>
               {ranked.map(([band,cs],i)=>{
                 const col = CAT_COLOR[cs[0]?.genre] || C.accent;
                 const avg = cs.filter(c=>c.rating).length
                   ? (cs.filter(c=>c.rating).reduce((s,c)=>s+c.rating,0)/cs.filter(c=>c.rating).length).toFixed(1)
                   : null;
                 const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':null;
                 return(
                   <div key={band} style={{background:C.bg2,border:`1px solid ${C.border}`,
                     borderLeft:`4px solid ${C.accent}`,borderRadius:10,padding:'13px 14px',
                     display:'flex',alignItems:'center',gap:12}}>
                     <div style={{width:28,textAlign:'center',flexShrink:0}}>
                       {medal?<span style={{fontSize:20}}>{medal}</span>:<span style={{...BEBAS,fontSize:18,color:'#444'}}>#{i+1}</span>}
                     </div>
                     <div style={{flex:1,minWidth:0}}>
                       <div style={{...BEBAS,fontSize:19,color:C.text,lineHeight:1}}>{band}</div>
                       <div style={{display:'flex',gap:12,marginTop:3}}>
                         <span style={{fontSize:11,color:C.dim,...MONO}}>{cs.length}× live</span>
                         {avg&&<span style={{fontSize:11,color:'#f5c842',...MONO}}>★ {avg} avg</span>}
                       </div>
                     </div>
                   </div>
                 );
               })}
             </div>
        )}
      </div>
    </div>
  );
}
