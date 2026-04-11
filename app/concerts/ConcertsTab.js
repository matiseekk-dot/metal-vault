'use client';
import { useState, useEffect, useRef } from 'react';

const C = {
  bg:'#0a0a0a', bg2:'#141414', bg3:'#1e1e1e',
  border:'#2a2a2a', accent:'#dc2626', accent2:'#991b1b',
  text:'#f0f0f0', muted:'#888', dim:'#555',
};
const MONO  = { fontFamily:"'Space Mono',monospace" };
const BEBAS = { fontFamily:"'Bebas Neue',sans-serif" };

const VENUES = [
  {id:1,name:"Spodek",city:"Katowice",cat:"Arena"},{id:2,name:"Tauron Arena",city:"Kraków",cat:"Arena"},
  {id:3,name:"Atlas Arena",city:"Łódź",cat:"Arena"},{id:4,name:"PGE Narodowy",city:"Warszawa",cat:"Arena"},
  {id:5,name:"Torwar",city:"Warszawa",cat:"Hala"},{id:6,name:"Hala Stulecia",city:"Wrocław",cat:"Hala"},
  {id:7,name:"Progresja",city:"Warszawa",cat:"Klub"},{id:8,name:"Stodoła",city:"Warszawa",cat:"Klub"},
  {id:9,name:"Proxima",city:"Warszawa",cat:"Klub"},{id:10,name:"Klub Studio",city:"Kraków",cat:"Klub"},
  {id:11,name:"Kwadrat",city:"Kraków",cat:"Klub"},{id:12,name:"B90",city:"Gdańsk",cat:"Klub"},
  {id:13,name:"PolandRock",city:"Kostrzyn",cat:"Festival"},{id:14,name:"Opener",city:"Gdynia",cat:"Festival"},
  {id:15,name:"Mystic Festival",city:"Gdańsk",cat:"Festival"},{id:16,name:"OFF Festival",city:"Katowice",cat:"Festival"},
];
const CAT_COLOR = {Arena:"#4cc8e8",Hala:"#a78bfa",Klub:"#e84c4c",Festival:"#f5c842",Other:"#aaa"};
const GENRES = ["Metal","Rock","Black Metal","Death Metal","Doom Metal","Thrash Metal","Heavy Metal","Prog Metal","Metalcore","Sludge","Grindcore","Post-Metal","Other"];
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

const inputSt = {
  width:'100%',background:C.bg3,border:`1px solid ${C.border}`,borderRadius:8,
  color:C.text,padding:'11px 12px',fontSize:16,...MONO,outline:'none',boxSizing:'border-box',
};

export default function ConcertsTab() {
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
  const inputRef = useRef();

  useEffect(()=>{
    setConcerts(loadLS(LS_KEY,[]));
    const sv=loadLS(LS_VENUES,null);
    if(sv)setVenues(sv);
  },[]);

  const save = (c,v=venues) => { setConcerts(c); saveLS(LS_KEY,c); if(v!==venues){setVenues(v);saveLS(LS_VENUES,v);} };

  const resetForm = () => { setForm({band:'',venueId:null,year:String(new Date().getFullYear()),genre:'Metal',rating:0,price:'',note:''});setEditId(null);setSugg([]);setError(''); };

  const handleBand = v => {
    setForm(f=>({...f,band:v}));
    const bands=[...new Set(concerts.map(c=>c.band))];
    setSugg(v.length>0?bands.filter(b=>b.toLowerCase().startsWith(v.toLowerCase())&&b.toLowerCase()!==v.toLowerCase()):[]);
  };

  const submit = () => {
    if(!form.band.trim()){setError('Enter band name');return;}
    const entry = {...form,band:form.band.trim(),id:editId||Date.now()};
    const updated = editId ? concerts.map(c=>c.id===editId?entry:c) : [entry,...concerts];
    save(updated);resetForm();setShowForm(false);
  };

  const del    = id => save(concerts.filter(c=>c.id!==id));
  const edit   = c  => { setForm({band:c.band,venueId:c.venueId||null,year:c.year||'',genre:c.genre||'Metal',rating:c.rating||0,price:c.price||'',note:c.note||''});setEditId(c.id);setShowForm(true);setSugg([]);setTimeout(()=>inputRef.current?.focus(),80); };
  const copy   = c  => { setForm({band:'',venueId:c.venueId,year:c.year||'',genre:c.genre,rating:0,price:c.price||'',note:''});setShowForm(true);setSugg([]);setTimeout(()=>inputRef.current?.focus(),80); };

  const addVenue = () => {
    if(!newVenue.trim())return;
    const v={id:Date.now(),name:newVenue.trim(),city:'',cat:'Other'};
    const nv=[...venues,v]; setVenues(nv); saveLS(LS_VENUES,nv);
    setForm(f=>({...f,venueId:v.id})); setNewVenue(''); setShowVenueAdd(false);
  };

  // Stats
  const bandMap = {};
  concerts.forEach(c=>{bandMap[c.band]=(bandMap[c.band]||[]);bandMap[c.band].push(c);});
  const totalSpent = concerts.reduce((s,c)=>s+(Number(c.price)||0),0);
  const mostSeen   = Object.entries(bandMap).sort((a,b)=>b[1].length-a[1].length)[0];

  const filtered = concerts.filter(c=>{
    const q=search.toLowerCase();
    const v=venues.find(vn=>vn.id===c.venueId);
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

  const venue = venues.find(v=>v.id===form.venueId);

  return(
    <div style={{padding:'0 0 16px'}}>
      {/* Stats strip */}
      <div style={{display:'flex',borderBottom:`1px solid ${C.border}`,background:C.bg2}}>
        {[
          {icon:'🎸',val:concerts.length,label:'shows'},
          {icon:'🏆',val:Object.keys(bandMap).length,label:'bands'},
          {icon:'🎟',val:totalSpent>0?`${totalSpent.toFixed(0)}zł`:'—',label:'spent'},
        ].map(s=>(
          <div key={s.label} style={{flex:1,textAlign:'center',padding:'10px 4px'}}>
            <div style={{fontSize:11,...MONO,color:C.dim}}>{s.icon}</div>
            <div style={{...BEBAS,fontSize:20,color:C.accent,lineHeight:1}}>{s.val}</div>
            <div style={{fontSize:9,color:C.dim,...MONO,letterSpacing:'0.1em',textTransform:'uppercase'}}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{padding:'12px 16px 0'}}>
        {/* Subtabs */}
        <div style={{display:'flex',marginBottom:12,borderBottom:`1px solid ${C.border}`}}>
          {[['list','📋 List'],['ranking','🏆 Ranking']].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)}
              style={{padding:'8px 16px',background:'none',border:'none',cursor:'pointer',
                borderBottom:tab===k?`2px solid ${C.accent}`:'2px solid transparent',
                color:tab===k?C.text:C.dim,...MONO,fontSize:11,marginBottom:-1}}>
              {l}
            </button>
          ))}
        </div>

        {/* Add button */}
        <button onClick={()=>{if(showForm)resetForm();setShowForm(f=>!f);}}
          style={{width:'100%',padding:'12px',
            background:showForm?C.bg3:`linear-gradient(135deg,${C.accent},${C.accent2})`,
            border:showForm?`1px solid ${C.border}`:'none',
            borderRadius:10,color:showForm?C.muted:'#fff',cursor:'pointer',
            ...BEBAS,fontSize:17,letterSpacing:'0.1em',marginBottom:12}}>
          {showForm?(editId?'↑ CANCEL EDIT':'↑ CANCEL'):(editId?'✏ EDITING':'+ ADD CONCERT')}
        </button>

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
              <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>Venue</label>
              <select value={form.venueId||''} onChange={e=>setForm(f=>({...f,venueId:e.target.value?Number(e.target.value):null}))}
                style={{...inputSt,cursor:'pointer'}}>
                <option value="">— Select venue —</option>
                {['Arena','Hala','Klub','Festival','Other'].map(cat=>{
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
                  + Add new venue
                </button>
              ):(
                <div style={{display:'flex',gap:6,marginTop:6}}>
                  <input value={newVenue} onChange={e=>setNewVenue(e.target.value)} placeholder="Venue name"
                    onKeyDown={e=>e.key==='Enter'&&addVenue()}
                    style={{...inputSt,flex:1,padding:'8px 10px'}}/>
                  <button onClick={addVenue} style={{background:C.accent,border:'none',borderRadius:8,color:'#fff',padding:'0 14px',cursor:'pointer',...BEBAS,fontSize:15}}>ADD</button>
                </div>
              )}
            </div>

            {/* Year + Genre */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>Year</label>
                <input type="number" min="1950" max="2099" value={form.year} onChange={e=>setForm(f=>({...f,year:e.target.value}))} style={inputSt}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>Genre</label>
                <select value={form.genre} onChange={e=>setForm(f=>({...f,genre:e.target.value}))} style={{...inputSt,cursor:'pointer'}}>
                  {GENRES.map(g=><option key={g}>{g}</option>)}
                </select>
              </div>
            </div>

            {/* Rating + Price */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:6}}>Rating</label>
                <Stars value={form.rating} onChange={v=>setForm(f=>({...f,rating:v}))}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>Ticket price (zł)</label>
                <input type="number" min="0" value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} placeholder="e.g. 150" style={inputSt}/>
              </div>
            </div>

            {/* Note */}
            <div>
              <label style={{display:'block',fontSize:9,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>Note</label>
              <textarea value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}
                placeholder="How was it?" rows={2} style={{...inputSt,resize:'vertical',fontStyle:'italic'}}/>
            </div>

            {error&&<div style={{color:C.accent,fontSize:12,...MONO}}>{error}</div>}

            <button onClick={submit} style={{padding:'13px',background:`linear-gradient(135deg,${C.accent},${C.accent2})`,border:'none',borderRadius:8,color:'#fff',cursor:'pointer',...BEBAS,fontSize:17,letterSpacing:'0.1em'}}>
              {editId?'SAVE CHANGES':'SAVE CONCERT'}
            </button>
          </div>
        )}

        {/* Search + Sort */}
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
            style={{...inputSt,flex:1,padding:'9px 12px'}}/>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,
              padding:'0 10px',fontSize:13,...MONO,cursor:'pointer',outline:'none'}}>
            <option value="year_desc">Year ↓</option>
            <option value="year_asc">Year ↑</option>
            <option value="band">Band A–Z</option>
            <option value="rating">Rating ↓</option>
          </select>
        </div>

        {/* List tab */}
        {tab==='list'&&(
          filtered.length===0
            ?<div style={{textAlign:'center',padding:'50px 0',color:C.dim,...MONO}}>
               <div style={{fontSize:44,marginBottom:10}}>🎸</div>
               <div style={{...BEBAS,fontSize:18,color:'#333'}}>{concerts.length===0?'Add your first concert!':'No results'}</div>
             </div>
            :<div style={{display:'flex',flexDirection:'column',gap:8}}>
               {filtered.map(c=>{
                 const v=venues.find(vn=>vn.id===c.venueId);
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
                           {c.price>0&&<span style={{fontSize:11,color:'#f5c842',...MONO}}>🎟{Number(c.price).toFixed(0)}zł</span>}
                         </div>
                         {c.note&&<p style={{margin:'7px 0 0',fontSize:12,color:C.muted,fontFamily:'Georgia,serif',fontStyle:'italic',lineHeight:1.5}}>"{c.note}"</p>}
                         <div style={{marginTop:6}}><Stars value={c.rating||0}/></div>
                         <div style={{display:'flex',gap:6,marginTop:8}}>
                           <button onClick={()=>edit(c)} style={{flex:1,padding:'6px',background:C.bg3,border:`1px solid ${C.border}`,borderRadius:7,color:C.muted,cursor:'pointer',fontSize:11,...MONO}}>✏ Edit</button>
                           <button onClick={()=>copy(c)} style={{flex:1,padding:'6px',background:C.bg3,border:`1px solid ${C.border}`,borderRadius:7,color:C.muted,cursor:'pointer',fontSize:11,...MONO}}>⧉ Copy</button>
                         </div>
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
