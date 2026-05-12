'use client';
import { useState, useEffect, useRef } from 'react';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';
import { toast, confirm as mvConfirm } from '@/app/components/Toast';
import { useT, useLocale } from '@/lib/i18n';
import { useCurrency, useFx, formatPrice } from '@/lib/currency';
import { haptic } from '@/lib/haptics';


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

// Currencies for ticket price. Concert prices are intrinsically local
// (Wacken sold in EUR, Polish clubs in PLN, US arenas in USD) so we
// store the currency alongside the number rather than auto-converting.
// Future improvement: auto-default to user locale via lib/currency.
const PRICE_CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CZK', 'CHF', 'SEK', 'NOK', 'DKK'];
// Storage convention: "150 PLN" in the existing free-text price column
// (avoids a schema migration). Parsers below split on the last space.
function parsePrice(s) {
  if (s == null) return { amount: '', currency: 'PLN' };
  const str = String(s).trim();
  if (!str) return { amount: '', currency: 'PLN' };
  const m = str.match(/^(.+?)\s+([A-Z]{3})$/);
  if (m) return { amount: m[1].trim(), currency: m[2] };
  return { amount: str, currency: 'PLN' };
}
function formatPriceStored(amount, currency) {
  const a = String(amount || '').trim();
  if (!a) return '';
  return a + ' ' + (currency || 'PLN');
}
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
          aria-label={t('common.close')}
          style={{ background: 'none', border: 'none', color: C.dim,
            cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '8px 10px',
            minWidth: 44, minHeight: 44 }}>×</button>
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

export default function ConcertsTab({ followedArtists = [], collection = [] } = {}) {
  const t = useT();
  const cur = useCurrency();
  const fx  = useFx();
  const [concerts,setConcerts] = useState([]);
  const [venues,setVenues]     = useState(VENUES);
  const [tab,setTab]           = useState('list'); // list | festivals | ranking
  const [showForm,setShowForm] = useState(false);
  const [editId,setEditId]     = useState(null);
  const [search,setSearch]     = useState('');
  const [sortBy,setSortBy]     = useState('year_desc');
  const [form,setForm]         = useState({band:'',venueId:null,year:String(new Date().getFullYear()),genre:'Metal',rating:0,price:'',note:'',is_planned:false,tickets_bought:false,planned_date:''});
  // Festival mode — captures one venue+year and many bands in a single
  // pass so the user doesn't add Wacken 2024 twelve times by hand.
  // `bands` is a multi-line string; on submit we split + trim + filter
  // and insert one user_concerts row per line, all sharing the same
  // venue_id + year so the aggregator below can re-group them into a
  // single expandable "festival" card on the list.
  const [showFestForm,setShowFestForm] = useState(false);
  const [festForm,setFestForm] = useState({
    venueId: null, year: String(new Date().getFullYear()),
    bands: '', genre: 'Metal', rating: 0, price: '', note: '',
  });
  const [festSaving,setFestSaving] = useState(false);
  // Editing context — when set, submitFest does additive merge
  // (don't duplicate existing band rows) instead of pure insert.
  const [editingFest,setEditingFest] = useState(null);
  // Inline custom-venue add inside the festival form. Mirrors the
  // pattern in the regular concert form but defaults cat to 'Festival'
  // so a typed venue lands in the right opt-group for future selects.
  const [festNewVenue,setFestNewVenue] = useState('');
  const [festNewVenueCity,setFestNewVenueCity] = useState('');
  const [showFestVenueAdd,setShowFestVenueAdd] = useState(false);
  // Ranking-tab artist photos. Lazy-fetched per band when the user
  // opens the Ranking tab; cached in state for the session.
  // null = pending fetch, '' = no image found, string = URL.
  const [bandPhotos,setBandPhotos] = useState({});
  // Search filter for the quick-add chips below the bands textarea.
  // Power users following 200+ bands need to narrow down — 30-chip
  // hardcoded cap was claustrophobic and looked like "stale data" when
  // the suggestions didn't include obvious choices.
  const [bandChipSearch,setBandChipSearch] = useState('');
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

  // ── Ranking-tab band photos ────────────────────────────────────
  // When the Ranking tab opens we eagerly fetch artist images for
  // every unique band on the list (capped at 60 to stay polite). The
  // /api/artists/image endpoint walks Spotify → Deezer → Wikipedia
  // and caches server-side, so subsequent visits are near-instant.
  // We dispatch in small parallel chunks; one slow lookup mustn't
  // block the rest of the column from filling in.
  useEffect(() => {
    if (tab !== 'ranking' || concerts.length === 0) return;
    const wanted = [...new Set(concerts.map(c => (c.band || '').trim()).filter(Boolean))]
      .slice(0, 60)
      .filter(name => bandPhotos[name.toLowerCase()] === undefined);
    if (wanted.length === 0) return;

    let cancelled = false;
    (async () => {
      // 6 in flight at a time — bigger pool than serial, smaller than
      // unbounded so we don't open 60 sockets to our own backend.
      const queue = [...wanted];
      const workers = Array.from({ length: 6 }, async () => {
        while (queue.length > 0) {
          const name = queue.shift();
          if (!name || cancelled) return;
          try {
            const r = await fetch('/api/artists/image?name=' + encodeURIComponent(name));
            if (!r.ok) {
              setBandPhotos(p => ({ ...p, [name.toLowerCase()]: '' }));
              continue;
            }
            const d = await r.json();
            const img = d?.image || d?.thumb || '';
            setBandPhotos(p => ({ ...p, [name.toLowerCase()]: img }));
          } catch {
            setBandPhotos(p => ({ ...p, [name.toLowerCase()]: '' }));
          }
        }
      });
      await Promise.all(workers);
    })();
    return () => { cancelled = true; };
  }, [tab, concerts.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pending-sync queue ──
  // Audit caught the "save+sync rolls forward forever on failure"
  // bug — fire-and-forget meant a 500 from the server was lost and
  // local state diverged from the DB permanently. We now persist
  // failed ops in localStorage and replay them on mount.
  const PENDING_KEY = 'mv_concerts_pending';
  const queuePending = (op) => {
    try {
      const q = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      q.push({ ...op, queuedAt: Date.now() });
      // Bound to last 100 ops so a misbehaving server can't fill storage
      localStorage.setItem(PENDING_KEY, JSON.stringify(q.slice(-100)));
    } catch {}
  };
  const flushPending = async () => {
    let q = [];
    try { q = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return; }
    if (!q.length) return;
    const stillFailing = [];
    for (const op of q) {
      try {
        const res = op.kind === 'delete'
          ? await fetch('/api/user-concerts?id=' + encodeURIComponent(op.id), { method: 'DELETE' })
          : await fetch('/api/user-concerts', {
              method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(op.item),
            });
        if (!res.ok && res.status !== 401) stillFailing.push(op);
      } catch { stillFailing.push(op); }
    }
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(stillFailing)); } catch {}
  };
  // Replay pending syncs on mount. Eslint-disabled deps because we
  // intentionally only run once.
  useEffect(() => { flushPending(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Optimistic-with-retry server persistence. Failure → queue for
  // replay on next mount + toast user. 401 means anonymous; LS-only
  // is the design, not a failure.
  const syncConcert = async (item) => {
    try {
      const res = await fetch('/api/user-concerts', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(item),
      });
      if (res.status === 401 || res.ok) return;
      queuePending({ kind:'upsert', item });
      toast.error(t('concerts.syncFailedRetry'));
    } catch {
      queuePending({ kind:'upsert', item });
    }
  };
  const syncDeleteConcert = async (id) => {
    try {
      const res = await fetch('/api/user-concerts?id=' + encodeURIComponent(id), { method:'DELETE' });
      if (res.status === 401 || res.ok) return;
      queuePending({ kind:'delete', id });
    } catch {
      queuePending({ kind:'delete', id });
    }
  };
  const syncVenue = (v) => {
    fetch('/api/user-venues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
    }).catch(() => {});
  };

  const resetForm = () => { setForm({band:'',venueId:null,year:String(new Date().getFullYear()),genre:'Metal',rating:0,price:'',note:'',is_planned:false,tickets_bought:false,planned_date:''});setEditId(null);setSugg([]);setError(''); };

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

  const resetFest = () => {
    setFestForm({
      venueId: null, year: String(new Date().getFullYear()),
      bands: '', genre: 'Metal', rating: 0, price: '', note: '',
    });
    setShowFestForm(false);
    setEditingFest(null);
    setError('');
  };

  // Batch-insert flow for festivals. The bands textarea accepts EITHER
  // newline-separated OR comma-separated band names; we normalise both
  // before splitting so "Mayhem, Marduk\nUlver" all work. Duplicate
  // names within the same submit get deduped (case-insensitive) so a
  // mis-paste doesn't trigger 5 identical rows.
  const submitFest = async () => {
    if (!festForm.venueId) { setError(t('concerts.error.venueRequired') || 'Wybierz miejsce'); return; }
    const raw = String(festForm.bands || '').replace(/,/g, '\n');
    const seen = new Set();
    const bands = raw.split('\n').map(s => s.trim())
      .filter(s => {
        if (!s) return false;
        const k = s.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    if (bands.length === 0) {
      setError(t('concerts.error.atLeastOneBand') || 'Wpisz przynajmniej jeden zespół');
      return;
    }

    setFestSaving(true);
    // Edit mode: three-way diff against the original lineup.
    //   • bands in NEW only        → INSERT
    //   • bands in OLD only        → DELETE (writes exclusion tombstone)
    //   • bands in BOTH            → PATCH shared metadata
    // Without the DELETE half, removing bands from the textarea did
    // nothing (the import re-added them on next 📻 click). With it,
    // the user can prune a festival down to "bands I actually saw"
    // and have it stick.
    const isEdit = !!editingFest;
    const existingLower = new Set(editingFest?.originalBands || []);
    const newBands = bands.filter(b => !existingLower.has(b.toLowerCase()));
    // Bands the user removed from the textarea. Find the matching
    // original concert ids so we can fire syncDeleteConcert on each
    // (which records an exclude_key in user_concert_excludes server-
    // side, so a subsequent LFM re-import doesn't bring the band back).
    const newBandsLower = new Set(bands.map(b => String(b || '').toLowerCase().trim()));
    const removedConcertIds = [];
    if (isEdit) {
      for (const c of concerts) {
        if (!editingFest.originalIds.includes(c.id)) continue;
        const bk = String(c.band || '').toLowerCase().trim();
        if (!newBandsLower.has(bk)) removedConcertIds.push(c.id);
      }
    }

    // Price model: festival ticket = single number for the whole event,
    // not per band. To avoid summing N×price in the header (which made
    // a 12-band Wacken festival display as "9 600 PLN" instead of
    // "800 PLN"), we store the price on EXACTLY ONE row per festival
    // — the first inserted band — and leave the rest with price=''.
    // The aggregator below already reads from items[0].price for the
    // header. Future edits via the modal also follow this single-row
    // pattern (see patch block further down).
    const festPrice = festForm.price || '';
    const entries = newBands.map((band, idx) => ({
      band,
      venueId: festForm.venueId,
      year:    festForm.year,
      genre:   festForm.genre || 'Metal',
      rating:  festForm.rating || 0,
      // Only the FIRST new row carries the festival price; rest get ''.
      // When editing an existing festival, the patch block below
      // handles its own price-only-on-first logic.
      price:   (!isEdit && idx === 0) ? festPrice : '',
      note:    festForm.note || '',
      id:      crypto.randomUUID(),
    }));

    // Patch existing rows if we're editing. Genre/rating/note/year/
    // venue apply to EVERY row; price applies to ONLY THE FIRST row
    // (the rest get '' so the festival header doesn't sum N×price).
    // This keeps "I bought a 12-band Wacken pass for 800 PLN" reading
    // as 800 PLN instead of 9 600 PLN.
    let updated = [...concerts];
    if (isEdit && editingFest.originalIds.length > 0) {
      const firstId = editingFest.originalIds[0];
      const sharedPatch = {
        genre:  festForm.genre || 'Metal',
        rating: festForm.rating || 0,
        note:   festForm.note || '',
        year:   festForm.year || '',
        venueId: festForm.venueId,
      };
      updated = updated.map(c => {
        if (!editingFest.originalIds.includes(c.id)) return c;
        return {
          ...c,
          ...sharedPatch,
          // Single-source price — first row holds the festival ticket;
          // every other lineup row clears.
          price: c.id === firstId ? (festPrice || '') : '',
        };
      });
      for (const c of updated) {
        if (editingFest.originalIds.includes(c.id)) syncConcert(c);
      }
    }
    // Apply removals locally + sync to server (each delete writes a
    // tombstone via /api/user-concerts so re-import respects the pruning).
    if (removedConcertIds.length > 0) {
      const idSet = new Set(removedConcertIds);
      updated = updated.filter(c => !idSet.has(c.id));
    }
    save([...entries, ...updated]);
    await Promise.all([
      ...entries.map(e => syncConcert(e)),
      ...removedConcertIds.map(id => syncDeleteConcert(id)),
    ]);
    setFestSaving(false);
    haptic.success?.();
    if (isEdit) {
      const addedN   = newBands.length;
      const removedN = removedConcertIds.length;
      const parts = [];
      if (addedN > 0)   parts.push('+' + addedN);
      if (removedN > 0) parts.push('−' + removedN);
      toast.success(
        parts.length > 0
          ? ((t('concerts.festUpdatedDiff', { diff: parts.join(' / ') })
              || 'Zaktualizowano festiwal') + ' (' + parts.join(' / ') + ' zespołów)')
          : (t('concerts.festUpdated') || 'Zaktualizowano festiwal')
      );
    } else {
      toast.success(
        (t('concerts.festAdded', { n: bands.length })
          || ('Dodano ' + bands.length + ' zespołów do festiwalu'))
      );
    }
    resetFest();
  };

  const del    = id => { save(concerts.filter(c=>c.id!==id)); syncDeleteConcert(id); };
  const edit   = c  => { setForm({band:c.band,venueId:c.venueId||null,year:c.year||'',genre:c.genre||'Metal',rating:c.rating||0,price:c.price||'',note:c.note||'',is_planned:!!c.is_planned,tickets_bought:!!c.tickets_bought,planned_date:c.planned_date||''});setEditId(c.id);setShowForm(true);setSugg([]);setTimeout(()=>inputRef.current?.focus(),80); };
  const copy   = c  => { setForm({band:'',venueId:c.venueId,year:c.year||'',genre:c.genre,rating:0,price:c.price||'',note:''});setShowForm(true);setSugg([]);setTimeout(()=>inputRef.current?.focus(),80); };

  const addVenue = () => {
    if(!newVenue.trim())return;
    const v={id:crypto.randomUUID(),name:newVenue.trim(),city:'',cat:'Other'};
    const nv=[...venues,v]; setVenues(nv); saveLS(LS_VENUES,nv);
    setForm(f=>({...f,venueId:v.id})); setNewVenue(''); setShowVenueAdd(false);
    syncVenue(v);
  };

  // Festival-specific custom venue add. Pre-tagged cat='Festival' so
  // the new venue lands in the right opt-group everywhere it's
  // referenced from. Also accepts a city since festivals are
  // location-tagged (Wacken / Clisson / Dessel etc) more often than
  // clubs.
  const addFestVenue = () => {
    const name = festNewVenue.trim();
    if (!name) return;
    const v = {
      id:   crypto.randomUUID(),
      name,
      city: festNewVenueCity.trim(),
      cat:  'Festival',
    };
    const nv = [...venues, v];
    setVenues(nv);
    saveLS(LS_VENUES, nv);
    setFestForm(f => ({ ...f, venueId: v.id }));
    setFestNewVenue('');
    setFestNewVenueCity('');
    setShowFestVenueAdd(false);
    syncVenue(v);
  };

  // Stats
  const bandMap = {};
  concerts.forEach(c=>{bandMap[c.band]=(bandMap[c.band]||[]);bandMap[c.band].push(c);});
  // Cross-currency total: normalise every row to USD via fx rates,
  // then formatPrice() renders the sum in the user's chosen display
  // currency. Without this step, a PLN row got summed AS IF it were
  // USD ("150 PLN" treated like "$150") which inflated the lifetime
  // total by ~4× for Polish users. The fx hook returns rate=null
  // until the first fetch completes — in that window we still sum
  // raw amounts so the chip isn't blank.
  const totalSpentUsd = concerts.reduce((s, c) => {
    const { amount, currency } = parsePrice(c.price);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return s;
    if (currency === 'USD') return s + n;
    const rate = fx?.rates?.[currency];
    if (!rate || !Number.isFinite(rate)) return s + n;  // fx not loaded yet
    return s + (n / rate);    // local → USD
  }, 0);
  // Legacy name kept so the stats strip render below doesn't need
  // a separate edit.
  const totalSpent = totalSpentUsd;

  // Band → live appearances count. Includes EVERY user_concerts row
  // for that band — solo gigs and festival appearances both count
  // (each band line in a festival is its own row by design).
  // Lower-cased key so "Mayhem" and "MAYHEM" merge into one.
  const bandSeenCount = (() => {
    const m = {};
    for (const c of concerts) {
      // Only count rows the user actually saw. attended defaults to
      // true (migration 040), so legacy rows that pre-date the flag
      // — and every freshly-imported row — still count. Rows the user
      // explicitly toggled to attended=false (skipped at a multi-act
      // festival) are excluded so the badge reflects reality, not
      // the festival lineup's row count.
      if (c.attended === false) continue;
      const k = (c.band || '').toLowerCase().trim();
      if (!k) continue;
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  })();
  const mostSeen   = Object.entries(bandMap).sort((a,b)=>b[1].length-a[1].length)[0];

  // Compare venue ids as strings — built-ins use numeric ids, user-added
  // venues use crypto.randomUUID() strings, and the <select> option value
  // is always serialized to string. String() coercion makes the lookup
  // type-agnostic.
  const findVenue = (id) => venues.find(v => String(v.id) === String(id));

  // Split concerts into "upcoming" (is_planned=true with a date still
  // ahead) and "history" (everything else, including past planned
  // events that have rolled past their date). History list keeps the
  // user-chosen sort; upcoming list always sorts by planned_date ASC
  // (next show on top).
  const todayIso = new Date().toISOString().slice(0, 10);
  const isUpcoming = (c) =>
    c.is_planned && c.planned_date && c.planned_date >= todayIso;

  const allFiltered = concerts.filter(c=>{
    const q=search.toLowerCase();
    const v=findVenue(c.venueId);
    return c.band.toLowerCase().includes(q)||(v?.name||'').toLowerCase().includes(q);
  });

  const upcoming = allFiltered
    .filter(isUpcoming)
    .sort((a, b) => String(a.planned_date).localeCompare(String(b.planned_date)));

  const filtered = allFiltered
    .filter(c => !isUpcoming(c))
    .sort((a,b)=>{
      if(sortBy==='year_desc')return (b.year||'0').localeCompare(a.year||'0');
      if(sortBy==='year_asc') return (a.year||'0').localeCompare(b.year||'0');
      if(sortBy==='band')     return a.band.localeCompare(b.band);
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
          {[
            ['list',      '📋 ' + (t('concerts.tab.list')      || 'Koncerty')],
            ['ranking',   '🏆 ' + (t('concerts.tab.ranking')   || 'Ranking')],
          ].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)}
              style={{padding:'8px 16px',background:'none',border:'none',cursor:'pointer',
                borderBottom:tab===k?`2px solid ${C.accent}`:'2px solid transparent',
                color:tab===k?C.text:C.dim,...MONO,fontSize:11,marginBottom:-1}}>
              {l}
            </button>
          ))}
        </div>

        {/* Add + Export/Import row */}
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          <button onClick={()=>{if(showForm)resetForm();setShowForm(f=>!f);}}
            style={{flex:1,minWidth:120,padding:'12px',
              background:showForm?C.bg3:`linear-gradient(135deg,${C.accent},${C.accent2})`,
              border:showForm?`1px solid ${C.border}`:'none',
              borderRadius:10,color:showForm?C.muted:'#fff',cursor:'pointer',
              ...BEBAS,fontSize:17,letterSpacing:'0.1em'}}>
            {showForm?(editId?t('concerts.cancelEdit'):t('concerts.cancel')):(editId?t('concerts.editing'):t('concerts.add'))}
          </button>
          {/* Festival mode — opens a separate modal that captures one
              venue+year and many bands in one shot. Visually distinct
              (gold gradient → festival color) so users don't confuse
              it with the regular per-band concert add. */}
          <button onClick={() => { setShowFestForm(s => !s); if (showForm) resetForm(); }}
            style={{flex:1,minWidth:120,padding:'12px',
              background: showFestForm ? C.bg3 : 'linear-gradient(135deg,#f5c842,#c08e1e)',
              border: showFestForm ? `1px solid ${C.border}` : 'none',
              borderRadius:10, color: showFestForm ? C.muted : '#1a0f00', cursor:'pointer',
              ...BEBAS, fontSize:15, letterSpacing:'0.08em'}}>
            🎪 {showFestForm ? (t('concerts.festCancel') || 'Anuluj festiwal') : (t('concerts.festAdd') || 'Festiwal')}
          </button>
          {/* Planned concert mode — re-uses the regular form but
              flips is_planned=true on entry so the date + tickets-
              bought controls become visible. Visual: blue gradient so
              the user knows they're in "I'm going" mode rather than
              "I was at" mode. */}
          <button onClick={() => {
              if (showForm && form.is_planned) { resetForm(); setShowForm(false); return; }
              resetForm();
              setForm(f => ({ ...f, is_planned: true, year: '' }));
              setShowForm(true);
              if (showFestForm) resetFest();
            }}
            style={{flex:1,minWidth:120,padding:'12px',
              background: (showForm && form.is_planned) ? C.bg3 : 'linear-gradient(135deg,#3b82f6,#1e40af)',
              border: (showForm && form.is_planned) ? `1px solid ${C.border}` : 'none',
              borderRadius:10, color: (showForm && form.is_planned) ? C.muted : '#fff', cursor:'pointer',
              ...BEBAS, fontSize:15, letterSpacing:'0.08em'}}>
            📅 {(showForm && form.is_planned)
                  ? (t('concerts.plannedCancel') || 'Anuluj')
                  : (t('concerts.plannedAdd') || 'Idę na koncert')}
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
          {/* Last.fm historical import — pulls the user's attended gigs
              from their public Last.fm /user/{name}/events page and
              inserts each as a user_concerts row. Idempotent by
              (band+year+venue), so a re-tap on an existing import only
              brings in NEW events. */}
          <button onClick={async () => {
            const ok = await mvConfirm(
              t('concerts.importLastfmConfirm')
                || 'Zaimportować historyczne koncerty z twojego profilu Last.fm? To może potrwać chwilę przy długiej historii.',
              { confirmLabel: t('concerts.importLastfmGo') || 'Importuj' }
            );
            if (!ok) return;
            toast(t('concerts.importLastfmStart') || 'Skanuję Last.fm…');
            try {
              const r = await fetch('/api/concerts/import-lastfm', { method: 'POST' });
              // Vercel returns its generic HTML error page on 504/500
              // (function timeout or uncaught crash). Trying to JSON.parse
              // that HTML produces a confusing "Unexpected token 'A'" toast
              // ("An error occurred…"). Detect and surface a clearer
              // message that hints at the actual cause + recovery path.
              const ct = r.headers.get('content-type') || '';
              if (!ct.includes('application/json')) {
                const txt = await r.text().catch(() => '');
                const truncated = String(txt).slice(0, 80);
                toast.error('Import przerwany (Vercel timeout / błąd). Spróbuj ponownie — częściowe dane mogły już się zapisać, dedup nie pozwoli na duplikaty. ' + (truncated ? '[' + truncated + '…]' : ''),
                  { duration: 10000 });
                return;
              }
              const d = await r.json().catch(() => ({}));
              // Always log the full diag, even on imported=0 / errors.
              // When the user reports "still empty", this is the only
              // way for me to see year_stats / last_status / htmlProbe
              // without a round-trip.
              try { console.log('[LFM import diag]', d); } catch {}
              if (!r.ok) {
                toast.error(d.error || 'Import failed');
                return;
              }
              if (d.imported > 0) {
                haptic.success?.();
                // Diag logged unconditionally above — no need to repeat.
                // Toast mentions festival promotion too — if the import
                // upgraded existing 'Other'-tagged venues to Festival
                // based on Last.fm URL/title heuristics, the user sees
                // their old imports rearrange into the gold festival
                // cards on this run.
                const festNote = (d.venues_upgraded || 0) > 0
                  ? ' · ' + d.venues_upgraded + ' ' + (t('concerts.importLastfmFestUpgrade') || 'venue(s) reclassified as festivals')
                  : '';
                const upcomingNote = (d.promoted_upcoming || 0) > 0
                  ? ' · ' + d.promoted_upcoming + ' ' + (t('concerts.importLastfmUpcomingPromoted') || 'flagged as upcoming')
                  : '';
                // Year-coverage hint — compute min/max year actually
                // imported. If the range looks wrong (e.g. min=2018 but
                // the user has 2010 events) that's an immediate red
                // flag that detectYears missed older tabs.
                let yearNote = '';
                try {
                  const ys = Object.keys(d.diag?.year_stats || {})
                    .filter(y => /^\d{4}$/.test(y))
                    .map(Number)
                    .sort((a, b) => a - b);
                  if (ys.length > 0) {
                    yearNote = ' · lata ' + ys[0] + '–' + ys[ys.length - 1];
                  }
                } catch {}
                toast.success(
                  (t('concerts.importLastfmDone', { n: d.imported, s: d.skipped })
                    || ('Zaimportowano ' + d.imported + ' koncertów (pominięto ' + d.skipped + ' duplikatów)'))
                  + festNote + upcomingNote + yearNote,
                  { duration: 8000 }
                );
                // Force a re-fetch of user concerts so the new rows
                // surface in the list without a full page reload.
                try {
                  const r2 = await fetch('/api/user-concerts');
                  if (r2.ok) {
                    const j = await r2.json();
                    if (j.concerts) save(j.concerts);
                    if (j.venues) {
                      const sv = [...VENUES, ...j.venues];
                      setVenues(sv);
                      saveLS(LS_VENUES, sv);
                    }
                  }
                } catch {}
              } else {
                // Distinguish "Last.fm has 0 events on your profile" from
                // "everything already imported". The diag block tells us
                // which one. Without this the user sees an ambiguous
                // "nothing new" and doesn't know if the scrape worked.
                const scanned = d.scanned || 0;
                if (scanned === 0) {
                  toast.error(
                    (t('concerts.importLastfmZeroScanned')
                      || 'Last.fm nie pokazał żadnych koncertów na twoim profilu — możliwe że dane historyczne zostały usunięte w 2018 (gdy LFM wyłączył eventy).'),
                    { duration: 9000 }
                  );
                } else {
                  toast(
                    (t('concerts.importLastfmAllSkipped', { n: scanned })
                      || ('Wszystkie ' + scanned + ' koncertów z LFM już masz w bazie.'))
                  );
                }
              }
            } catch (e) { toast.error(e.message); }
          }}
            title={t('concerts.importLastfmTitle') || 'Importuj historię koncertów z Last.fm'}
            style={{flexShrink:0, background: '#1a0d0d', border: '1px solid #d5100744',
              borderRadius: 10, color: '#d51007', padding: '12px 14px',
              cursor: 'pointer', ...MONO, fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap'}}>
            📻 Last.fm
          </button>
          {/* Clear + re-import — wipes all rows marked
              "Imported from Last.fm" so the next 📻 click can repopulate
              from scratch. Necessary because the importer's dedup means
              earlier truncated lineups (festivals with only 9 bands
              before the paginated walker landed) survive subsequent
              imports — the existing rows match and the new 100+ rows
              get inserted alongside, but festival aggregation may end
              up wrong. Clean slate fixes that. */}
          <button onClick={async () => {
            const ok = await mvConfirm(
              t('concerts.clearLastfmConfirm')
                || 'Usunąć wszystkie koncerty zaimportowane z Last.fm i pobrać od nowa? Twoje ręcznie dodane wpisy zostaną zachowane.',
              { kind: 'danger', confirmLabel: t('concerts.clearLastfmGo') || 'Wyczyść i pobierz' }
            );
            if (!ok) return;
            toast(t('concerts.clearLastfmRunning') || 'Czyszczę…');
            try {
              const rd = await fetch('/api/concerts/clear-lastfm', { method: 'POST' });
              const dd = await rd.json();
              if (!rd.ok) { toast.error(dd.error || 'Clear failed'); return; }
              // Re-fetch local state immediately so the user sees the
              // wipe happen, then chain into the import.
              try {
                const r2 = await fetch('/api/user-concerts');
                if (r2.ok) {
                  const j = await r2.json();
                  if (j.concerts) save(j.concerts);
                  if (j.venues) {
                    const sv = [...VENUES, ...j.venues];
                    setVenues(sv);
                    saveLS(LS_VENUES, sv);
                  }
                }
              } catch {}
              toast.success(
                (t('concerts.clearLastfmDone', { n: dd.deleted || 0 })
                  || ('Usunięto ' + (dd.deleted || 0) + ' wpisów — zaczynam ponowny import')),
                { duration: 4000 }
              );
              // Chain to import — same flow as the 📻 button but
              // without a second confirm dialog.
              try {
                const ri = await fetch('/api/concerts/import-lastfm', { method: 'POST' });
                const cti = ri.headers.get('content-type') || '';
                if (!cti.includes('application/json')) {
                  const txt = await ri.text().catch(() => '');
                  toast.error('Import przerwany (Vercel timeout). Spróbuj 📻 jeszcze raz — partial dane się zapisały, dedup pozwoli dokleić resztę. ' + (String(txt).slice(0, 80)),
                    { duration: 10000 });
                  return;
                }
                const di = await ri.json().catch(() => ({}));
                if (!ri.ok) { toast.error(di.error || 'Import failed'); return; }
                const festNote = (di.venues_upgraded || 0) > 0
                  ? ' · ' + di.venues_upgraded + ' fest'
                  : '';
                const att = di.lineups_attempted || 0;
                const exp = di.lineups_expanded  || 0;
                const lineupNote = att > 0
                  ? ' · ' + exp + '/' + att + ' lineupów'
                  : '';
                const dedupNote = (di.pre_dedup_killed || 0) > 0
                  ? ' · usunięto ' + di.pre_dedup_killed + ' duplikatów'
                  : '';
                if (di.diag) { try { console.log('[LFM clear+reimport diag]', di.diag); } catch {} }
                let yearNote2 = '';
                try {
                  const ys = Object.keys(di.diag?.year_stats || {})
                    .filter(y => /^\d{4}$/.test(y)).map(Number).sort((a, b) => a - b);
                  if (ys.length > 0) yearNote2 = ' · lata ' + ys[0] + '–' + ys[ys.length - 1];
                } catch {}
                toast.success(
                  (t('concerts.importLastfmDone', { n: di.imported, s: di.skipped })
                    || ('Zaimportowano ' + di.imported + ' (pominięto ' + di.skipped + ')'))
                  + festNote + lineupNote + dedupNote + yearNote2,
                  { duration: 9000 }
                );
                // Pull fresh local state.
                const r3 = await fetch('/api/user-concerts');
                if (r3.ok) {
                  const j = await r3.json();
                  if (j.concerts) save(j.concerts);
                  if (j.venues) {
                    const sv = [...VENUES, ...j.venues];
                    setVenues(sv);
                    saveLS(LS_VENUES, sv);
                  }
                }
                haptic.success?.();
              } catch (e) { toast.error(e.message); }
            } catch (e) { toast.error(e.message); }
          }}
            title={t('concerts.clearLastfmTitle') || 'Wyczyść i pobierz od nowa z Last.fm'}
            style={{flexShrink:0, background: '#1a0d0d', border: '1px solid #d5100744',
              borderRadius: 10, color: '#f87171', padding: '12px 12px',
              cursor: 'pointer', ...MONO, fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap'}}>
            🔄 Wyczyść
          </button>
          {/* Scal duplikaty — manually merge duplicate LFM-imported
              rows without re-running the full import. Useful for the
              "Bölzer ×2" / "Behemoth ×2" leftovers from earlier
              broken imports where the unicode-aware dedup didn't yet
              ship. Idempotent: runs the same merge logic the importer
              now applies on every run. Attended flags are OR-ed across
              the group so user marks don't get lost in the merge. */}
          <button onClick={async () => {
            toast(t('concerts.dedupRunning') || 'Scalanie duplikatów…');
            try {
              const r = await fetch('/api/concerts/dedup-now', { method: 'POST' });
              const ct = r.headers.get('content-type') || '';
              if (!ct.includes('application/json')) {
                toast.error('Dedup endpoint zwrócił nie-JSON (timeout?)');
                return;
              }
              const d = await r.json().catch(() => ({}));
              if (!r.ok) { toast.error(d.error || 'Dedup failed'); return; }
              if ((d.deleted || 0) === 0) {
                toast(t('concerts.dedupNothing') || 'Brak duplikatów — wszystko już czyste');
              } else {
                toast.success(
                  (t('concerts.dedupDone', { n: d.deleted })
                    || ('Scalono ' + d.deleted + ' duplikatów'))
                  + (d.updated_attended ? ' · zachowano ' + d.updated_attended + ' oznaczeń ✓' : ''),
                  { duration: 7000 }
                );
              }
              // Pull fresh state so the UI reflects the merge.
              try {
                const r2 = await fetch('/api/user-concerts');
                if (r2.ok) {
                  const j = await r2.json();
                  if (j.concerts) save(j.concerts);
                }
              } catch {}
            } catch (e) { toast.error(e.message); }
          }}
            title={t('concerts.dedupTitle') || 'Scal duplikaty zaimportowane z Last.fm'}
            style={{flexShrink:0, background: '#0d1f0d', border: '1px solid #4ade8044',
              borderRadius: 10, color: '#4ade80', padding: '12px 12px',
              cursor: 'pointer', ...MONO, fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap'}}>
            🧹 {t('concerts.dedupBtn') || 'Scal'}
          </button>
          {/* Force pull from server — pulls latest user_concerts +
              user_venues from the database without the import flow.
              Useful when the same user added concerts on another
              device (phone) and wants to see them on web. Sync is
              already automatic on mount but a manual refresh button
              is a clearer mental model than "reload the page". */}
          <button onClick={async () => {
            toast(t('concerts.syncRefresh') || 'Pobieram z serwera…');
            try {
              const r = await fetch('/api/user-concerts');
              if (!r.ok) { toast.error('Sync failed'); return; }
              const j = await r.json();
              if (j.concerts) save(j.concerts);
              if (j.venues) {
                const sv = [...VENUES, ...j.venues];
                setVenues(sv);
                saveLS(LS_VENUES, sv);
              }
              toast.success(
                (t('concerts.syncRefreshDone', { n: (j.concerts || []).length })
                  || ('Zsynchronizowano: ' + (j.concerts || []).length + ' wpisów'))
              );
            } catch (e) { toast.error(e.message); }
          }}
            title={t('concerts.syncRefreshTitle') || 'Pobierz najnowszy stan z serwera (sync z innymi urządzeniami)'}
            style={{flexShrink:0, background: C.bg3, border: '1px solid ' + C.border,
              borderRadius: 10, color: C.muted, padding: '12px 12px',
              cursor: 'pointer', ...MONO, fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap'}}>
            ↻
          </button>
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

            {/* Planned-mode banner — shown only when form.is_planned is
                true. Reminds the user they're scheduling, not logging
                history, and gives them a quick toggle back. */}
            {form.is_planned && (
              <div style={{background:'#0d1f3a', border:'1px solid #3b82f666',
                borderRadius:8, padding:'8px 10px',
                fontSize:11, color:'#93c5fd', ...MONO, lineHeight:1.4}}>
                📅 {t('concerts.plannedBanner')
                     || 'Tryb: idę na koncert (jeszcze nie odbył się). Po dacie zostaje w historii.'}
              </div>
            )}

            {/* Year (history) OR Date (planned) + Genre.
                The planned-date field replaces the year input when in
                planned mode — datetime-local input keeps both day and
                time so the upcoming list can sort precisely. On the
                day of the show we automatically demote the planned
                row to history by the cron (future work). */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>
                  {form.is_planned ? (t('concerts.form.plannedDate') || 'Data koncertu')
                                   : t('concerts.form.year')}
                </label>
                {form.is_planned ? (
                  <input type="date" value={form.planned_date || ''}
                    onChange={e => setForm(f => ({ ...f,
                      planned_date: e.target.value,
                      year:         e.target.value ? e.target.value.slice(0, 4) : f.year,
                    }))}
                    style={inputSt}/>
                ) : (
                  <input type="number" inputMode="numeric" min="1950" max="2099"
                    value={form.year} onChange={e=>setForm(f=>({...f,year:e.target.value}))}
                    style={inputSt}/>
                )}
              </div>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>{t('concerts.form.genre')}</label>
                <select value={form.genre} onChange={e=>setForm(f=>({...f,genre:e.target.value}))} style={{...inputSt,cursor:'pointer'}}>
                  {GENRES.map(g=><option key={g}>{g}</option>)}
                </select>
              </div>
            </div>

            {/* Tickets-bought toggle — only in planned mode. Separate
                checkbox row so it's not buried in another grid. */}
            {form.is_planned && (
              <label style={{display:'flex', alignItems:'center', gap:10, cursor:'pointer',
                padding:'8px 10px', background:C.bg3, border:'1px solid ' + C.border, borderRadius:8}}>
                <input type="checkbox" checked={!!form.tickets_bought}
                  onChange={e => setForm(f => ({ ...f, tickets_bought: e.target.checked }))}
                  style={{width:18, height:18, cursor:'pointer'}}/>
                <span style={{fontSize:12, color:form.tickets_bought ? '#4ade80' : C.muted, ...MONO}}>
                  {form.tickets_bought
                    ? '🎟 ' + (t('concerts.ticketsBought') || 'Bilet kupiony')
                    : '❓ ' + (t('concerts.ticketsNot')   || 'Bilet jeszcze nie kupiony')}
                </span>
              </label>
            )}

            {/* Price (rating field deliberately omitted — user feedback:
                "ratings add nothing to the journal, the band+venue+year
                are the data points that matter"). */}
            <div>
              <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>{t('concerts.form.price')}</label>
              {/* Price + currency split. Stored as "150 PLN" in the
                  text column so we don't need a schema change. */}
              {(() => {
                const { amount, currency } = parsePrice(form.price);
                return (
                  <div style={{display:'flex', gap:4}}>
                    <input type="number" inputMode="decimal" min="0"
                      value={amount}
                      onChange={e => setForm(f => ({ ...f, price: formatPriceStored(e.target.value, currency) }))}
                      placeholder={t('concerts.form.pricePlaceholder')}
                      style={{...inputSt, flex:1}}/>
                    <select value={currency}
                      onChange={e => setForm(f => ({ ...f, price: formatPriceStored(amount, e.target.value) }))}
                      style={{...inputSt, width:74, cursor:'pointer'}}>
                      {PRICE_CURRENCIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                );
              })()}
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

        {/* ── Festival multi-band form ─────────────────────────────
            Captures a single venue + year and a free-text list of
            bands the user saw. On submit we batch-insert N user_concerts
            rows (one per band) sharing the venue_id/year so the list
            aggregator below re-groups them as a single festival card. */}
        {showFestForm && (
          <div style={{background: '#1a1408', border: '1px solid #f5c84266',
            borderRadius:12, padding:16, marginBottom:14,
            display:'flex', flexDirection:'column', gap:10}}>
            <div style={{...BEBAS, fontSize:16, color:'#f5c842', letterSpacing:'0.06em'}}>
              🎪 {editingFest
                  ? (t('concerts.festEditTitle') || 'Edytuj festiwal')
                  : (t('concerts.festTitle') || 'Festiwal — dodaj wszystkie zespoły')}
            </div>
            <div style={{fontSize:11, color:C.dim, ...MONO, lineHeight:1.5}}>
              {t('concerts.festHint')
                || 'Wybierz festiwal, rok i wpisz wszystkie zespoły, które tam widziałeś. Każdy zespół zostanie zapisany jako osobna pozycja, ale na liście pokażą się razem.'}
            </div>

            {/* Venue selector — filter to known festivals on top.
                User can still pick any venue but the list groups
                cat='Festival' first for fast pickup. */}
            <div>
              <label style={{fontSize:10, color:C.dim, ...MONO, letterSpacing:'0.06em',
                textTransform:'uppercase', display:'block', marginBottom:4}}>
                {t('concerts.form.venue') || 'Miejsce'}
              </label>
              <select
                value={festForm.venueId == null ? '' : String(festForm.venueId)}
                onChange={e => setFestForm(f => ({ ...f, venueId: e.target.value || null }))}
                style={{...inputSt, width:'100%', cursor:'pointer'}}>
                <option value="">{t('concerts.form.venueChoose') || '— wybierz festiwal —'}</option>
                <optgroup label={t('concerts.festVenueGroup') || 'Festiwale'}>
                  {venues.filter(v => v.cat === 'Festival').map(v => (
                    <option key={v.id} value={String(v.id)}>{v.name} — {v.city}</option>
                  ))}
                </optgroup>
                <optgroup label={t('concerts.festOtherGroup') || 'Inne miejsca'}>
                  {venues.filter(v => v.cat !== 'Festival').map(v => (
                    <option key={v.id} value={String(v.id)}>{v.name}{v.city ? ' — ' + v.city : ''}</option>
                  ))}
                </optgroup>
              </select>
              {/* "+ Custom festival" — typeable fallback when the user's
                  fest isn't in the canonical list (regional / one-off /
                  obscure DIY). New venue gets cat='Festival' so it
                  appears in the right opt-group next time. */}
              <div style={{marginTop: 6}}>
                {!showFestVenueAdd ? (
                  <button type="button" onClick={() => setShowFestVenueAdd(true)}
                    style={{background: 'transparent', border: '1px dashed ' + C.border,
                      borderRadius: 6, color: '#f5c842', padding: '6px 10px',
                      cursor: 'pointer', ...MONO, fontSize: 11, width: '100%'}}>
                    + {t('concerts.festAddCustomVenue') || 'Dodaj własny festiwal'}
                  </button>
                ) : (
                  <div style={{display: 'flex', gap: 6, marginTop: 4}}>
                    <input value={festNewVenue}
                      onChange={e => setFestNewVenue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addFestVenue()}
                      placeholder={t('concerts.festVenuePlaceholder') || 'Nazwa festiwalu'}
                      autoFocus
                      style={{...inputSt, flex: 2, padding: '8px 10px'}}/>
                    <input value={festNewVenueCity}
                      onChange={e => setFestNewVenueCity(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addFestVenue()}
                      placeholder={t('concerts.cityPlaceholder') || 'Miasto'}
                      style={{...inputSt, flex: 1, padding: '8px 10px'}}/>
                    <button type="button" onClick={addFestVenue}
                      style={{background: '#f5c842', border: 'none', borderRadius: 8,
                        color: '#1a0f00', padding: '0 14px', cursor: 'pointer',
                        ...BEBAS, fontSize: 14, letterSpacing: '0.05em'}}>
                      {(t('concerts.form.add') || 'Dodaj').toUpperCase()}
                    </button>
                    <button type="button" onClick={() => {
                        setShowFestVenueAdd(false);
                        setFestNewVenue('');
                        setFestNewVenueCity('');
                      }}
                      style={{background: 'transparent', border: '1px solid ' + C.border,
                        borderRadius: 8, color: C.dim, padding: '0 10px',
                        cursor: 'pointer', ...MONO, fontSize: 11}}>
                      ×
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Year + genre */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
              <div>
                <label style={{fontSize:10, color:C.dim, ...MONO, letterSpacing:'0.06em',
                  textTransform:'uppercase', display:'block', marginBottom:4}}>
                  {t('concerts.form.year') || 'Rok'}
                </label>
                <input type="number" inputMode="numeric" min="1950" max="2099"
                  value={festForm.year}
                  onChange={e => setFestForm(f => ({ ...f, year: e.target.value }))}
                  style={inputSt}/>
              </div>
              <div>
                <label style={{fontSize:10, color:C.dim, ...MONO, letterSpacing:'0.06em',
                  textTransform:'uppercase', display:'block', marginBottom:4}}>
                  {t('concerts.form.genre') || 'Gatunek'}
                </label>
                <select value={festForm.genre}
                  onChange={e => setFestForm(f => ({ ...f, genre: e.target.value }))}
                  style={{...inputSt, cursor:'pointer'}}>
                  {GENRES.map(g => <option key={g}>{g}</option>)}
                </select>
              </div>
            </div>

            {/* Bands list — newline OR comma separated. The submit handler
                normalises both. */}
            <div>
              <label style={{fontSize:10, color:C.dim, ...MONO, letterSpacing:'0.06em',
                textTransform:'uppercase', display:'block', marginBottom:4}}>
                {t('concerts.festBandsLabel') || 'Zespoły (po jednym w linii lub przecinkami)'}
              </label>
              <textarea
                value={festForm.bands}
                onChange={e => setFestForm(f => ({ ...f, bands: e.target.value }))}
                placeholder={t('concerts.festBandsPlaceholder')
                  || 'Mayhem\nMarduk\nBatushka\n...'}
                rows={8}
                style={{...inputSt, width:'100%', resize:'vertical',
                  fontFamily:'monospace', fontSize:13, padding:'10px'}}/>
              {/* Live count so user sees how many bands they're adding. */}
              <div style={{fontSize:10, color:C.dim, ...MONO, marginTop:4}}>
                {(() => {
                  const n = String(festForm.bands || '').replace(/,/g, '\n').split('\n')
                    .map(s => s.trim()).filter(Boolean).length;
                  return n + ' ' + (n === 1 ? (t('concerts.bandCount.one') || 'zespół')
                                            : (t('concerts.bandCount.many') || 'zespołów'));
                })()}
              </div>

              {/* Quick-add chips — sourced from followedArtists +
                  collection, then collection-only entries that aren't
                  followed yet (catches the case where user owns a vinyl
                  but never tapped follow). Search filter narrows the
                  pool for users with hundreds of bands. Vertical scroll
                  capped at 180px so the modal stays manageable. */}
              {(() => {
                const pool = new Map();   // lowerKey → display name
                for (const a of (followedArtists || [])) {
                  const n = typeof a === 'string' ? a : a?.artist_name;
                  if (n) pool.set(n.toLowerCase(), n);
                }
                for (const c of (collection || [])) {
                  if (c?.artist) pool.set(c.artist.toLowerCase(), c.artist);
                }
                if (pool.size === 0) return null;
                const inTextarea = new Set(
                  String(festForm.bands || '').replace(/,/g, '\n').split('\n')
                    .map(s => s.trim().toLowerCase()).filter(Boolean)
                );
                const q = bandChipSearch.toLowerCase().trim();
                const suggestions = [...pool.values()]
                  .filter(n => !inTextarea.has(n.toLowerCase()))
                  .filter(n => !q || n.toLowerCase().includes(q))
                  .sort((a, b) => a.localeCompare(b));
                if (suggestions.length === 0 && !q) return null;
                return (
                  <div style={{marginTop: 8}}>
                    <div style={{display:'flex', alignItems:'center', gap:8,
                      marginBottom: 6, flexWrap:'wrap'}}>
                      <span style={{fontSize: 9, color: C.dim, ...MONO,
                        letterSpacing: '0.08em', textTransform: 'uppercase'}}>
                        {t('concerts.festSuggestions') || 'Z twoich obserwowanych / kolekcji — stuknij by dodać'}
                      </span>
                      <span style={{fontSize: 9, color: C.dim, ...MONO, marginLeft:'auto'}}>
                        {suggestions.length} / {pool.size}
                      </span>
                    </div>
                    {/* Search input — filters the pool live. Power users
                        with hundreds of bands can narrow to "may" → only
                        Mayhem / Maybe-something / Mayfair appear. */}
                    <input value={bandChipSearch}
                      onChange={e => setBandChipSearch(e.target.value)}
                      placeholder={t('concerts.festBandSearch') || 'Filtruj zespoły…'}
                      style={{...inputSt, width:'100%', padding:'6px 10px',
                        fontSize:12, marginBottom:6}}/>
                    {suggestions.length === 0 ? (
                      <div style={{fontSize: 11, color: C.dim, ...MONO, padding:'8px 0'}}>
                        {t('concerts.festNoMatch') || 'Brak dopasowań — wpisz nazwę ręcznie w polu wyżej'}
                      </div>
                    ) : (
                      <div style={{display: 'flex', gap: 4, flexWrap: 'wrap',
                        maxHeight: 180, overflowY: 'auto',
                        padding: 4, background: 'rgba(0,0,0,0.2)', borderRadius: 6,
                        // Native iOS / Android scroll without horizontal swipe
                        // hijack — bands list is purely vertical.
                        WebkitOverflowScrolling: 'touch'}}>
                        {suggestions.map(name => (
                          <button key={name}
                            type="button"
                            onClick={() => setFestForm(f => ({
                              ...f,
                              bands: (f.bands ? f.bands.trim() + '\n' : '') + name,
                            }))}
                            style={{
                              background: C.bg3, border: '1px solid ' + C.border,
                              borderRadius: 14, padding: '3px 9px',
                              color: C.text, cursor: 'pointer',
                              fontSize: 11, ...MONO, whiteSpace: 'nowrap',
                            }}>
                            + {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Shared festival metadata — price only (rating removed
                per user feedback). */}
            <div>
              <div>
                <label style={{fontSize:10, color:C.dim, ...MONO, letterSpacing:'0.06em',
                  textTransform:'uppercase', display:'block', marginBottom:4}}>
                  {t('concerts.form.price') || 'Cena biletu'}
                </label>
                {(() => {
                  const { amount, currency } = parsePrice(festForm.price);
                  return (
                    <div style={{display:'flex', gap:4}}>
                      <input type="number" inputMode="decimal" min="0"
                        value={amount}
                        onChange={e => setFestForm(f => ({ ...f, price: formatPriceStored(e.target.value, currency) }))}
                        placeholder="0"
                        style={{...inputSt, flex:1}}/>
                      <select value={currency}
                        onChange={e => setFestForm(f => ({ ...f, price: formatPriceStored(amount, e.target.value) }))}
                        style={{...inputSt, width:74, cursor:'pointer'}}>
                        {PRICE_CURRENCIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  );
                })()}
              </div>
            </div>

            <textarea value={festForm.note}
              onChange={e => setFestForm(f => ({ ...f, note: e.target.value }))}
              placeholder={t('concerts.form.notePlaceholder') || 'Notatka (opcjonalna)'}
              rows={2}
              style={{...inputSt, resize:'vertical'}}/>

            {error && (
              <div style={{fontSize:11, color:'#f87171', ...MONO}}>{error}</div>
            )}

            <button onClick={submitFest} disabled={festSaving}
              style={{padding:'13px',
                background: festSaving ? C.bg3 : 'linear-gradient(135deg,#f5c842,#c08e1e)',
                border:'none', borderRadius:8,
                color: festSaving ? C.dim : '#1a0f00', cursor: festSaving ? 'wait' : 'pointer',
                ...BEBAS, fontSize:17, letterSpacing:'0.1em',
                opacity: festSaving ? 0.6 : 1}}>
              {festSaving ? '⏳'
                : (editingFest
                    ? (t('concerts.festSaveEdit') || 'ZAPISZ ZMIANY')
                    : (t('concerts.festSave')     || 'ZAPISZ FESTIWAL'))}
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
          </select>
        </div>

        {/* Upcoming planned concerts — separate section above the
            history list. Always visible when there are any (regardless
            of which sub-tab we're on, because "what's coming up" is
            different action class than "what I attended"). Sorted by
            planned_date ascending. Each row shows the date + tickets-
            bought status + venue + edit/delete. */}
        {tab === 'list' && upcoming.length > 0 && (
          <div style={{marginBottom: 16}}>
            <div style={{fontSize: 10, color: '#60a5fa', ...MONO,
              letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8}}>
              📅 {t('concerts.upcoming') || 'Nadchodzące'} ({upcoming.length})
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
              {upcoming.map(c => {
                const v = findVenue(c.venueId);
                const daysUntil = c.planned_date
                  ? Math.ceil((new Date(c.planned_date) - new Date()) / 86400000)
                  : null;
                return (
                  <div key={c.id} style={{background: '#0d1f3a',
                    border: '1px solid #3b82f644', borderLeft: '4px solid #3b82f6',
                    borderRadius: 10, padding: '12px 14px',
                    display: 'flex', alignItems: 'center', gap: 10}}>
                    <div style={{flex: 1, minWidth: 0}}>
                      <div style={{...BEBAS, fontSize: 18, color: C.text,
                        letterSpacing: '0.04em', lineHeight: 1.1}}>
                        {c.band}
                      </div>
                      <div style={{display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap'}}>
                        <span style={{fontSize: 11, color: C.dim, ...MONO}}>
                          📅 {c.planned_date}
                          {daysUntil != null && daysUntil >= 0 && (
                            <span style={{marginLeft: 4, color: daysUntil <= 7 ? '#f5c842' : C.dim}}>
                              {daysUntil === 0 ? ' · ' + (t('concerts.today') || 'DZIŚ')
                                : daysUntil === 1 ? ' · ' + (t('concerts.tomorrow') || 'JUTRO')
                                : ' · za ' + daysUntil + 'd'}
                            </span>
                          )}
                        </span>
                        {v && <span style={{fontSize: 11, color: C.dim, ...MONO}}>
                          📍 {v.name}{v.city ? ' · ' + v.city : ''}
                        </span>}
                        <span style={{fontSize: 11, ...MONO,
                          color: c.tickets_bought ? '#4ade80' : '#f5c842'}}>
                          {c.tickets_bought
                            ? '🎟 ' + (t('concerts.ticketsBought') || 'Bilet kupiony')
                            : '❓ ' + (t('concerts.ticketsNot')   || 'Bilet jeszcze nie kupiony')}
                        </span>
                      </div>
                    </div>
                    {/* Quick toggle for ticket status — saves a full
                        edit-form round trip when the user just bought
                        their ticket and wants to flip the badge. */}
                    <button onClick={() => {
                      const updated = { ...c, tickets_bought: !c.tickets_bought };
                      save(concerts.map(x => x.id === c.id ? updated : x));
                      syncConcert(updated);
                    }}
                      title={c.tickets_bought
                        ? (t('concerts.markUnbought') || 'Zaznacz jako bez biletu')
                        : (t('concerts.markBought')   || 'Zaznacz że bilet kupiony')}
                      style={{background: c.tickets_bought ? '#1a3d1a' : '#3a2906',
                        border: '1px solid ' + (c.tickets_bought ? '#4ade8088' : '#f5c84288'),
                        borderRadius: 6,
                        color: c.tickets_bought ? '#4ade80' : '#f5c842',
                        padding: '6px 10px', cursor: 'pointer',
                        fontSize: 12, ...MONO}}>
                      {c.tickets_bought ? '✓' : '🎟'}
                    </button>
                    <button onClick={() => edit(c)}
                      style={{background: 'none', border: '1px solid ' + C.border,
                        borderRadius: 6, color: C.dim, cursor: 'pointer',
                        padding: '6px 10px', fontSize: 12, ...MONO}}>
                      ✏
                    </button>
                    <button onClick={async () => {
                      if (await mvConfirm(t('concerts.deleteConfirm', { band: c.band }),
                          { kind: 'danger', confirmLabel: t('common.delete') })) {
                        del(c.id);
                      }
                    }}
                      style={{background: 'none', border: '1px solid #7f1d1d',
                        borderRadius: 6, color: '#f87171', cursor: 'pointer',
                        padding: '6px 10px', fontSize: 12, ...MONO}}>
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Koncerty tab — single concerts AND festival aggregates
            interleaved. Festival rows (venue.cat === 'Festival') auto-
            group into a gold expandable card with the full lineup;
            stand-alone concerts render as plain rows. Ranking tab
            (below) is the OTHER tab and counts every appearance. */}
        {tab==='list' && (
          filtered.length===0
            ?<div style={{textAlign:'center',padding:'50px 0',color:C.dim,...MONO}}>
               <div style={{fontSize:44,marginBottom:10}}>🎸</div>
               <div style={{...BEBAS,fontSize:18,color:'#333'}}>{concerts.length===0 ? t('concerts.empty.cta') : t('common.noResults')}</div>
             </div>
            :<div style={{display:'flex',flexDirection:'column',gap:8}}>
               {(() => {
                 // Build display list. Tab semantics:
                 //   • 'list'      → ONLY non-festival concerts (no aggregated cards)
                 //   • 'festivals' → ONLY festival aggregates
                 // Ranking has its own block below and counts everything.
                 // Single combined list: festival aggregates AND
                 // single-band concerts interleaved. The first concert
                 // of a festival group sets the group's display position
                 // so the user's sortBy choice still applies.
                 //
                 // After building items, we GROUP BY YEAR for navigation
                 // — power users with 200+ concerts across 18 years need
                 // year separators to scan visually. Within each year
                 // the items keep their `filtered` sort order.
                 const items = [];
                 // Festival grouping key: venue+DATE when we have the
                 // exact date (LFM imports), venue+year as fallback
                 // for legacy rows. Splitting by date stops a busy
                 // club's whole year being merged into one festival
                 // card (Mega Club hosting 6 distinct gigs got
                 // wrongly collapsed before this).
                 const groupKey = (c) => {
                   const v = findVenue(c.venueId);
                   if (!v || v.cat !== 'Festival') return null;
                   const dateKey = c.planned_date || c.year;
                   if (!dateKey) return null;
                   return c.venueId + '::' + dateKey;
                 };
                 const groupMap = new Map();
                 for (const c of filtered) {
                   const k = groupKey(c);
                   if (!k) {
                     items.push({ type: 'single', concert: c });
                     continue;
                   }
                   const existing = groupMap.get(k);
                   if (existing) { existing.items.push(c); continue; }
                   const fresh = { type: 'festival', key: k, venue: findVenue(c.venueId),
                     year: c.year, date: c.planned_date || null, items: [c] };
                   groupMap.set(k, fresh);
                   items.push(fresh);
                 }
                 // Group items by year. Year is taken from the festival
                 // wrapper or the single concert. Items with no year fall
                 // into an 'Unknown' bucket rendered last.
                 const itemYear = (it) => {
                   if (it.type === 'festival') return String(it.year || '');
                   return String(it.concert?.year || '');
                 };
                 const yearBuckets = new Map();   // year(string) → items[]
                 for (const it of items) {
                   const y = itemYear(it) || '——';
                   if (!yearBuckets.has(y)) yearBuckets.set(y, []);
                   yearBuckets.get(y).push(it);
                 }
                 // Sort years DESC (most recent first). The 'Unknown' bucket
                 // labelled '——' sorts last because it's not numeric.
                 const sortedYears = [...yearBuckets.keys()].sort((a, b) => {
                   const na = Number(a) || -Infinity;
                   const nb = Number(b) || -Infinity;
                   return nb - na;
                 });
                 const renderItem = (it) => {
                   if (it.type === 'festival') {
                     const v = it.venue;
                     const col = '#f5c842';
                     const isOpen = !!setlistOpen['fest:' + it.key];
                     // Headliner heuristic: first band in the lineup.
                     // LFM-imported cell lineup preserves Last.fm's order
                     // (headline-first); manual entries also tend to put
                     // the headliner first. We show this as ⭐ in BOTH
                     // the collapsed meta line AND on the top row of the
                     // expanded list, so the user knows the main act
                     // without expanding.
                     const headliner = it.items[0]?.band || '';
                     const supportCount = Math.max(0, it.items.length - 1);
                     // Festival ticket price is stored on a SINGLE row,
                     // not multiplied across the lineup. We find the
                     // first row that actually has a price (skips empty
                     // rows in case the user only filled one in the
                     // middle of the lineup). Falls back to 0 = hidden.
                     const pricedRow = it.items.find(c => Number(parsePrice(c.price).amount) > 0);
                     const totalPrice  = pricedRow ? Number(parsePrice(pricedRow.price).amount) : 0;
                     const festCurrency = pricedRow ? parsePrice(pricedRow.price).currency : 'PLN';
                     return (
                       <div key={it.key} style={{background: '#1a1408',
                         border: '1px solid ' + col + '44', borderLeft: '4px solid ' + col,
                         borderRadius: 10, padding: '12px 14px'}}>
                         <div style={{display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer'}}
                           onClick={() => setSetlistOpen(s => ({ ...s, ['fest:' + it.key]: !isOpen }))}>
                           <div style={{flex: 1, minWidth: 0}}>
                             <div style={{...BEBAS, fontSize: 20, color: col, letterSpacing: '0.04em', lineHeight: 1.1}}>
                               🎪 {v?.name || (t('concerts.unknownVenue') || 'Festiwal')}
                             </div>
                             {/* Headliner pill — the marquee band visible
                                 without expanding. Renders as e.g.
                                 "⭐ Behemoth · +47 supportu" so the user
                                 knows who's playing at a glance. */}
                             {headliner && (
                               <div style={{marginTop: 4, display: 'flex', alignItems: 'center',
                                 gap: 6, flexWrap: 'wrap'}}>
                                 <span style={{...MONO, fontSize: 13, color: '#fde68a',
                                   letterSpacing: '0.04em'}}>
                                   ⭐ {headliner}
                                 </span>
                                 {supportCount > 0 && (
                                   <span style={{fontSize: 10, ...MONO, color: C.dim, opacity: 0.85}}>
                                     · +{supportCount} {supportCount === 1
                                       ? (t('concerts.supportOne') || 'support')
                                       : (t('concerts.supportMany') || 'supportów')}
                                   </span>
                                 )}
                               </div>
                             )}
                             <div style={{display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap',
                               alignItems: 'center'}}>
                               <span style={{fontSize: 11, color: C.dim, ...MONO}}>
                                 📅 {it.date || it.year}
                               </span>
                               {(() => {
                                 // Show "🎸 X/Y widziane" when any band is
                                 // marked attended=false; otherwise the
                                 // simpler "🎸 N zespołów" stays. The X/Y
                                 // form is greener to draw attention to
                                 // partial-attendance festivals.
                                 const total    = it.items.length;
                                 const attended = it.items.filter(c => c.attended !== false).length;
                                 if (attended < total) {
                                   return (
                                     <span style={{fontSize: 11, color: '#4ade80', ...MONO}}>
                                       🎸 {attended}/{total} widziane
                                     </span>
                                   );
                                 }
                                 return (
                                   <span style={{fontSize: 11, color: C.dim, ...MONO}}>
                                     🎸 {total} {total === 1
                                           ? (t('concerts.bandCount.one') || 'zespół')
                                           : (t('concerts.bandCount.many') || 'zespołów')}
                                   </span>
                                 );
                               })()}
                               {totalPrice > 0 && (
                                 <span style={{fontSize: 11, color: '#f5c842', ...MONO}}>
                                   🎟 {totalPrice.toFixed(0)} {festCurrency}
                                 </span>
                               )}
                               {/* rating removed — user feedback */}
                             </div>
                           </div>
                           {/* Festival-level edit/delete. Edit opens the
                               festival modal pre-filled with the existing
                               lineup so the user can add missing bands or
                               correct typos. Delete nukes EVERY band-row
                               that shares this venue+year. */}
                           <button onClick={(e) => {
                               e.stopPropagation();
                               // Pre-fill — pull metadata from first item
                               // (genre/rating/price/note are shared at
                               // festival save time).
                               const first = it.items[0];
                               setFestForm({
                                 venueId: first.venueId,
                                 year:    first.year || '',
                                 bands:   it.items.map(c => c.band).join('\n'),
                                 genre:   first.genre || 'Metal',
                                 rating:  first.rating || 0,
                                 price:   first.price || '',
                                 note:    first.note || '',
                               });
                               // Stash the original ids so submit can
                               // diff and only insert NEW bands instead
                               // of duplicating the lineup.
                               setEditingFest({
                                 key: it.key,
                                 originalIds: it.items.map(c => c.id),
                                 originalBands: it.items.map(c => c.band.toLowerCase()),
                               });
                               setShowFestForm(true);
                               window.scrollTo({ top: 0, behavior: 'smooth' });
                             }}
                             style={{background: 'none', border: '1px solid ' + col + '44',
                               borderRadius: 6, color: col, cursor: 'pointer',
                               padding: '6px 10px', fontSize: 12, ...MONO, marginLeft: 6}}>
                             ✏
                           </button>
                           <button onClick={async (e) => {
                               e.stopPropagation();
                               const ok = await mvConfirm(
                                 (t('concerts.delFestConfirm', { name: v?.name || '', year: it.year })
                                   || ('Usunąć cały festiwal "' + (v?.name || '') + ' ' + it.year + '" (' + it.items.length + ' zespołów)?')),
                                 { kind: 'danger', confirmLabel: t('common.delete') }
                               );
                               if (!ok) return;
                               // Bulk-delete: take a snapshot of ids,
                               // strip them from local state in one go,
                               // fire individual syncDelete calls for
                               // each (the syncs queue on failure).
                               const ids = it.items.map(c => c.id);
                               save(concerts.filter(c => !ids.includes(c.id)));
                               for (const id of ids) syncDeleteConcert(id);
                             }}
                             style={{background: 'none', border: '1px solid #7f1d1d',
                               borderRadius: 6, color: '#f87171', cursor: 'pointer',
                               padding: '6px 10px', fontSize: 12, ...MONO, marginLeft: 4}}>
                             🗑
                           </button>
                           <span style={{...MONO, fontSize: 14, color: C.dim, marginLeft: 6}}>{isOpen ? '▲' : '▼'}</span>
                         </div>
                         {isOpen && (
                           <div style={{marginTop: 12, paddingTop: 10,
                             borderTop: '1px solid ' + col + '33',
                             display: 'flex', flexDirection: 'column', gap: 6}}>
                             {it.items.map((c, idx) => {
                               const seenN = bandSeenCount[(c.band || '').toLowerCase().trim()] || 1;
                               const isHead = idx === 0;
                               // Default to true on legacy rows that pre-date
                               // migration 040 (column has DEFAULT true so DB
                               // is consistent, but client-side LS may not
                               // have the field at all).
                               const attended = c.attended !== false;
                               // Toggle handler — optimistic + persist.
                               // Stop event bubbling so the row click (if
                               // any) doesn't fire too.
                               const toggleAttended = async (e) => {
                                 e.stopPropagation();
                                 const next = !attended;
                                 const updated = { ...c, attended: next };
                                 save(concerts.map(cc => cc.id === c.id ? updated : cc));
                                 try { await syncConcert(updated); } catch {}
                               };
                               return (
                               <div key={c.id} style={{display: 'flex', alignItems: 'center', gap: 8,
                                 padding: '6px 8px',
                                 background: isHead
                                   ? (attended ? 'rgba(245,200,66,0.10)' : 'rgba(80,80,80,0.15)')
                                   : (attended ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.15)'),
                                 border: isHead && attended ? '1px solid ' + col + '55' : '1px solid transparent',
                                 borderRadius: 6,
                                 opacity: attended ? 1 : 0.45,
                                 // Visual cue that the user wasn't there — strike-
                                 // through on the band name handled below; the
                                 // wider row dim is the at-a-glance signal.
                                 transition: 'opacity 0.15s'}}>
                                 {isHead && (
                                   <span style={{fontSize: 14, lineHeight: 1}} title="Headliner">⭐</span>
                                 )}
                                 <span style={{flex: 1, fontSize: 13,
                                   color: isHead && attended ? '#fde68a' : C.text, ...MONO,
                                   fontWeight: isHead ? 600 : 400,
                                   textDecoration: attended ? 'none' : 'line-through',
                                   textDecorationColor: '#666'}}>{c.band}</span>
                                 {/* Attended toggle — bigger touch target,
                                     visually distinct from the edit/delete
                                     glyphs so users find it. Green ✓ when
                                     marked seen, dimmed ✗ when not. Tap to
                                     flip. */}
                                 <button onClick={toggleAttended}
                                   title={attended ? 'Widziałem — kliknij żeby odznaczyć' : 'Nie widziałem — kliknij żeby zaznaczyć'}
                                   style={{background: 'none',
                                     border: '1px solid ' + (attended ? '#4ade8055' : C.border),
                                     borderRadius: 6,
                                     color: attended ? '#4ade80' : '#666',
                                     cursor: 'pointer', fontSize: 13, lineHeight: 1,
                                     padding: '4px 8px', minWidth: 30,
                                     ...MONO}}>
                                   {attended ? '✓' : '✗'}
                                 </button>
                                 {seenN >= 2 && (
                                   <span style={{fontSize: 9, ...MONO, padding: '1px 6px', borderRadius: 10,
                                     background: '#1a3d1a', color: '#4ade80'}}>
                                     {seenN}×
                                   </span>
                                 )}
                                 <button onClick={(e) => { e.stopPropagation(); edit(c); }}
                                   style={{background: 'none', border: 'none', color: C.dim,
                                     cursor: 'pointer', fontSize: 14, padding: '4px 8px'}}>✏</button>
                                 <button onClick={async (e) => {
                                   e.stopPropagation();
                                   if (await mvConfirm(t('concerts.deleteConfirm', { band: c.band }),
                                       { kind: 'danger', confirmLabel: t('common.delete') })) {
                                     del(c.id);
                                   }
                                 }}
                                   style={{background: 'none', border: 'none', color: '#666',
                                     cursor: 'pointer', fontSize: 16, padding: '4px 8px'}}>×</button>
                               </div>
                               );
                             })}
                           </div>
                         )}
                       </div>
                     );
                   }
                   // ── single concert (existing path) ──
                   const c = it.concert;
                   const v = findVenue(c.venueId);
                   const col = v ? CAT_COLOR[v.cat] || '#aaa' : '#555';
                   return (
                   <div key={c.id} style={{background:C.bg2,border:`1px solid ${C.border}`,
                     borderLeft:`4px solid ${col}`,borderRadius:10,padding:'13px 14px'}}>
                     <div style={{display:'flex',justifyContent:'space-between',gap:10}}>
                       <div style={{flex:1,minWidth:0}}>
                         <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
                           <span style={{...BEBAS,fontSize:20,letterSpacing:'0.05em',color:C.text,lineHeight:1}}>{c.band}</span>
                           <span style={{fontSize:9,...MONO,padding:'2px 7px',borderRadius:20,
                             background:`${col}22`,color:col,border:`1px solid ${col}44`}}>{c.genre}</span>
                           {/* Seen-count badge — includes festival
                               appearances (each festival lineup row
                               counts) so "Mayhem ×5" reflects total
                               lifetime live encounters across both
                               headlining gigs and festival sets. Only
                               renders when ≥2 to avoid pointless 1× noise. */}
                           {(() => {
                             const n = bandSeenCount[(c.band || '').toLowerCase().trim()] || 1;
                             if (n < 2) return null;
                             return (
                               <span style={{fontSize: 9, ...MONO, padding: '2px 7px', borderRadius: 20,
                                 background: '#1a3d1a', color: '#4ade80', border: '1px solid #4ade8044'}}>
                                 {n}× {t('concerts.seenLabel') || 'widziane'}
                               </span>
                             );
                           })()}
                         </div>
                         <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
                           {v&&<span style={{fontSize:11,color:C.dim,...MONO}}>📍{v.name}{v.city?` · ${v.city}`:''}</span>}
                           {c.year&&<span style={{fontSize:11,color:C.dim,...MONO}}>📅{c.year}</span>}
                           {(() => {
                             const { amount, currency } = parsePrice(c.price);
                             const n = Number(amount);
                             if (!(n > 0)) return null;
                             return <span style={{fontSize:11,color:'#f5c842',...MONO}}>🎟{n.toFixed(0)} {currency}</span>;
                           })()}
                         </div>
                         {c.note&&<p style={{margin:'7px 0 0',fontSize:12,color:C.muted,fontFamily:'Georgia,serif',fontStyle:'italic',lineHeight:1.5}}>"{c.note}"</p>}
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
                       <button onClick={async () => {
                         // Bug from audit: delete fired without confirmation;
                         // a stray tap nuked the row. Now goes through
                         // mvConfirm with danger styling + delete label.
                         if (await mvConfirm(t('concerts.deleteConfirm', { band: c.band }), { kind: 'danger', confirmLabel: t('common.delete') })) {
                           del(c.id);
                         }
                       }}
                         aria-label={t('common.delete')}
                         style={{background:'none',border:'none',color:'#666',cursor:'pointer',fontSize:22,padding:'10px 12px',minWidth:44,minHeight:44,flexShrink:0}}
                         onMouseEnter={e=>e.currentTarget.style.color=C.accent}
                         onMouseLeave={e=>e.currentTarget.style.color='#666'}>×</button>
                     </div>
                   </div>
                 );
                 };   // end renderItem
                 // Final render: year sections. Each year gets a sticky
                 // monospace header above its items so the user can
                 // visually scan "what year was that gig?" without
                 // squinting at row metadata.
                 return sortedYears.map(y => (
                   <div key={'year-' + y} style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                     <div style={{
                       ...MONO, fontSize: 11, color: '#7c8aa6',
                       letterSpacing: '0.22em', textTransform: 'uppercase',
                       padding: '12px 4px 4px',
                       borderBottom: '1px solid ' + C.border,
                     }}>
                       {y === '——' ? (t('concerts.yearUnknown') || 'BEZ DATY') : y}
                       <span style={{marginLeft: 8, color: C.dim, opacity: 0.6}}>
                         · {yearBuckets.get(y).length}
                       </span>
                     </div>
                     {yearBuckets.get(y).map(renderItem)}
                   </div>
                 ));
               })()}
             </div>
        )}

        {/* Ranking tab */}
        {tab==='ranking'&&(
          ranked.length===0
            ?<div style={{textAlign:'center',padding:'50px 0',color:C.dim,...MONO}}><div style={{fontSize:44}}>🏆</div></div>
            :<div style={{display:'flex',flexDirection:'column',gap:8}}>
               {ranked.map(([band,cs],i)=>{
                 const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':null;
                 const photo = bandPhotos[band.toLowerCase()];
                 // Circular avatar with letter fallback — identical to
                 // the BandsTab ArtistPhoto component. Inlined so we
                 // don't drag in a separate file just for ranking.
                 const photoView = photo
                   ? <img src={photo} alt={band} loading="lazy"
                       onError={(e) => { e.currentTarget.style.display = 'none'; }}
                       style={{width: 44, height: 44, borderRadius: '50%',
                         objectFit: 'cover', flexShrink: 0,
                         border: '1px solid ' + C.accent + '33'}}/>
                   : <div style={{width: 44, height: 44, borderRadius: '50%',
                       flexShrink: 0,
                       background: 'linear-gradient(135deg,#1a0a0a,#0a0a0a)',
                       border: '1px solid ' + C.accent + '33',
                       display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                       <span style={{...BEBAS, fontSize: 20, color: C.accent}}>
                         {(band || '?')[0].toUpperCase()}
                       </span>
                     </div>;
                 return(
                   <div key={band} style={{background:C.bg2,border:`1px solid ${C.border}`,
                     borderLeft:`4px solid ${C.accent}`,borderRadius:10,padding:'13px 14px',
                     display:'flex',alignItems:'center',gap:12}}>
                     <div style={{width:28,textAlign:'center',flexShrink:0}}>
                       {medal?<span style={{fontSize:20}}>{medal}</span>:<span style={{...BEBAS,fontSize:18,color:'#444'}}>#{i+1}</span>}
                     </div>
                     {photoView}
                     <div style={{flex:1,minWidth:0}}>
                       <div style={{...BEBAS,fontSize:19,color:C.text,lineHeight:1}}>{band}</div>
                       <div style={{display:'flex',gap:12,marginTop:3}}>
                         <span style={{fontSize:11,color:C.dim,...MONO}}>{cs.length}× live</span>
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
