'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';


const LS_KEY = 'mv_shopping_list';

function loadList() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)||'[]'); } catch { return []; }
}
function saveList(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch {}
}

// ── Price check result card ───────────────────────────────────
function PriceCard({ result, onAdd, shoppingList, collection }) {
  if (!result) return null;
  const inCollection = collection.some(i =>
    i.discogs_id === String(result.id) ||
    (i.artist?.toLowerCase()===result.artist?.toLowerCase() && i.album?.toLowerCase()===result.album?.toLowerCase())
  );
  const inList = shoppingList.some(i => i.discogs_id===String(result.id));
  const median = result.lowest_price || result.median_price || 0;

  return (
    <div style={{background:C.bg2,border:'1px solid '+(inCollection?'#1a3d1a':C.border),
      borderRadius:12,padding:14,marginTop:10}}>
      <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
        {result.cover&&<img src={result.cover} alt="" style={{width:56,height:56,borderRadius:6,objectFit:'cover',flexShrink:0}}/>}
        <div style={{flex:1,minWidth:0}}>
          <div style={{...BEBAS,fontSize:16,color:C.text,lineHeight:1.1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {result.artist}
          </div>
          <div style={{fontSize:11,color:C.muted,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {result.album}
          </div>
          <div style={{display:'flex',gap:8,marginTop:6,flexWrap:'wrap',alignItems:'center'}}>
            {median>0&&<span style={{...BEBAS,fontSize:20,color:C.gold}}>${median.toFixed(0)}</span>}
            {median>0&&<span style={{fontSize:9,color:C.dim,...MONO}}>median</span>}
            {result.format&&<span style={{fontSize:9,color:'#60a5fa',background:'#60a5fa22',borderRadius:4,padding:'1px 6px',...MONO}}>{result.format.split(',')[0]}</span>}
            {inCollection&&<span style={{fontSize:9,color:C.green,background:'#0d1f0d',borderRadius:4,padding:'1px 6px',...MONO}}>✓ Own it</span>}
          </div>
        </div>
      </div>
      {!inCollection&&(
        <div style={{display:'flex',gap:8,marginTop:10}}>
          <button onClick={()=>onAdd(result, 'want')}
            disabled={inList}
            style={{flex:1,padding:'10px',background:inList?C.bg3:C.accent,border:'none',
              borderRadius:8,color:'#fff',cursor:inList?'default':'pointer',...BEBAS,fontSize:15,letterSpacing:'0.05em'}}>
            {inList?'✓ On list':'+ Shopping List'}
          </button>
          <a href={`https://www.discogs.com/release/${result.id}`} target="_blank" rel="noopener noreferrer"
            style={{padding:'10px 14px',background:C.bg3,border:'1px solid '+C.border,
              borderRadius:8,color:C.muted,textDecoration:'none',fontSize:11,...MONO,display:'flex',alignItems:'center'}}>
            ↗
          </a>
        </div>
      )}
    </div>
  );
}

// ── Shopping list item ────────────────────────────────────────
function ShoppingItem({ item, onRemove, onBought, onSetMaxPrice }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(item.maxPrice||'');
  const priorityColors = { high:'#f87171', medium:'#f5c842', low:'#60a5fa' };

  return (
    <div style={{background:item.bought?'#0d1f0d':C.bg2,
      border:'1px solid '+(item.bought?'#1a3d1a':C.border),
      borderRadius:10,padding:'10px 12px',
      opacity:item.bought?0.7:1}}>
      <div style={{display:'flex',gap:10,alignItems:'center'}}>
        {/* Checkbox */}
        <button onClick={()=>onBought(item.id)}
          style={{width:24,height:24,borderRadius:6,flexShrink:0,
            background:item.bought?C.green:'none',
            border:'2px solid '+(item.bought?C.green:'#555'),
            cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:14,color:'#000'}}>
          {item.bought?'✓':''}
        </button>
        {/* Cover */}
        {item.cover&&<img src={item.cover} alt="" style={{width:38,height:38,borderRadius:4,objectFit:'cover',flexShrink:0}}/>}
        {/* Info */}
        <div style={{flex:1,minWidth:0}}>
          <div style={{...BEBAS,fontSize:14,color:item.bought?C.green:C.text,lineHeight:1.1,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
            textDecoration:item.bought?'line-through':'none'}}>
            {item.artist}
          </div>
          <div style={{fontSize:10,color:C.dim,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {item.album}
          </div>
          <div style={{display:'flex',gap:6,marginTop:3,alignItems:'center',flexWrap:'wrap'}}>
            {item.maxPrice>0&&(
              <span style={{fontSize:10,color:C.gold,...MONO}}>max ${item.maxPrice}</span>
            )}
            {item.priority&&(
              <span style={{fontSize:8,color:priorityColors[item.priority]||C.dim,
                background:priorityColors[item.priority]+'22',borderRadius:4,
                padding:'1px 5px',...MONO,textTransform:'uppercase'}}>
                {item.priority}
              </span>
            )}
          </div>
        </div>
        {/* Actions */}
        <div style={{display:'flex',gap:6,flexShrink:0}}>
          <button onClick={()=>setEditing(e=>!e)}
            style={{background:'none',border:'1px solid '+C.border,borderRadius:6,
              color:C.dim,padding:'4px 7px',cursor:'pointer',fontSize:11}}>
            $
          </button>
          <button onClick={()=>onRemove(item.id)}
            style={{background:'none',border:'none',color:'#444',cursor:'pointer',fontSize:16,padding:'0 2px'}}
            onMouseEnter={e=>e.currentTarget.style.color=C.accent}
            onMouseLeave={e=>e.currentTarget.style.color='#444'}>
            ×
          </button>
        </div>
      </div>
      {editing&&(
        <div style={{marginTop:8,display:'flex',gap:6,alignItems:'center'}}>
          <span style={{fontSize:11,color:C.dim,...MONO}}>Max $</span>
          <input type="number" value={price} onChange={e=>setPrice(e.target.value)}
            placeholder="e.g. 30"
            style={{flex:1,background:C.bg3,border:'1px solid '+C.border,borderRadius:6,
              color:C.text,padding:'5px 8px',fontSize:13,...MONO,outline:'none'}}/>
          <select value={item.priority||'medium'} onChange={e=>onSetMaxPrice(item.id, price, e.target.value)}
            style={{background:C.bg3,border:'1px solid '+C.border,borderRadius:6,
              color:C.text,padding:'5px 8px',fontSize:11,...MONO,outline:'none'}}>
            <option value="high">🔴 High</option>
            <option value="medium">🟡 Medium</option>
            <option value="low">🔵 Low</option>
          </select>
          <button onClick={()=>{onSetMaxPrice(item.id,price,item.priority);setEditing(false);}}
            style={{background:C.accent,border:'none',borderRadius:6,color:'#fff',
              padding:'5px 10px',cursor:'pointer',...BEBAS,fontSize:13}}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main RecordFairTab ────────────────────────────────────────
export default function RecordFairTab({ collection, onAddToCollection }) {
  const [mode, setMode]             = useState('search'); // 'search' | 'list'
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [searching, setSearching]   = useState(false);
  const [selected, setSelected]     = useState(null);
  const [priceResult, setPriceResult] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [shoppingList, setShoppingList] = useState([]);
  const [budget, setBudget]         = useState(() => {
    try { return localStorage.getItem('mv_fair_budget')||''; } catch { return ''; }
  });
  const [fairName, setFairName]     = useState(() => {
    try { return localStorage.getItem('mv_fair_name')||''; } catch { return ''; }
  });
  const searchRef = useRef(null);
  const debounce  = useRef(null);

  useEffect(() => { setShoppingList(loadList()); }, []);
  useEffect(() => { if (mode==='search') searchRef.current?.focus(); }, [mode]);

  const search = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await fetch(`/api/discogs?artist=${encodeURIComponent(q)}&album=`);
      const d = await r.json();
      setResults(d.variants?.slice(0,6) || []);
    } catch { setResults([]); }
    setSearching(false);
  }, []);

  const onQueryChange = (val) => {
    setQuery(val);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(val), 400);
  };

  const selectResult = async (item) => {
    setSelected(item);
    setPriceLoading(true); setPriceResult(null);
    try {
      const r = await fetch(`/api/discogs/price?release_id=${item.id}`);
      const d = await r.json();
      setPriceResult({ ...item, lowest_price: d.lowest_price||d.median_price||0, median_price: d.median_price||0 });
    } catch {
      setPriceResult(item);
    }
    setPriceLoading(false);
  };

  const addToList = (item, _type) => {
    const newItem = {
      id: Date.now(),
      discogs_id: String(item.id),
      artist: item.artist,
      album: item.album,
      cover: item.cover,
      maxPrice: 0,
      priority: 'medium',
      bought: false,
      addedAt: new Date().toISOString(),
    };
    const next = [...shoppingList, newItem];
    setShoppingList(next); saveList(next);
    setMode('list');
  };

  const removeItem = (id) => {
    const next = shoppingList.filter(i => i.id !== id);
    setShoppingList(next); saveList(next);
  };

  const toggleBought = (id) => {
    const next = shoppingList.map(i => i.id===id ? {...i, bought:!i.bought} : i);
    setShoppingList(next); saveList(next);
  };

  const setMaxPrice = (id, price, priority) => {
    const next = shoppingList.map(i => i.id===id
      ? {...i, maxPrice: parseFloat(price)||0, priority: priority||i.priority}
      : i
    );
    setShoppingList(next); saveList(next);
  };

  const spent = shoppingList.filter(i=>i.bought).reduce((s,i)=>s+(i.maxPrice||0),0);
  const budgetNum = parseFloat(budget)||0;
  const boughtCount = shoppingList.filter(i=>i.bought).length;

  return (
    <div style={{padding:'0 0 24px',minHeight:'100%'}}>

      {/* ── Header ── */}
      <div style={{background:'linear-gradient(135deg,#1a0000,#2a0500)',
        borderBottom:'1px solid '+C.accent+'44',padding:'14px 16px 12px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div>
            <div style={{...BEBAS,fontSize:22,color:C.accent,letterSpacing:'0.08em',lineHeight:1}}>
              🎪 RECORD FAIR
            </div>
            <input value={fairName} onChange={e=>{setFairName(e.target.value);try{localStorage.setItem('mv_fair_name',e.target.value);}catch{}}}
              placeholder="Fair name (optional)"
              style={{background:'none',border:'none',color:C.dim,fontSize:10,...MONO,outline:'none',
                marginTop:2,width:160,padding:0}}/>
          </div>
          {budgetNum>0&&(
            <div style={{textAlign:'right'}}>
              <div style={{...BEBAS,fontSize:20,color:budgetNum>0&&spent>budgetNum?C.red:C.gold,lineHeight:1}}>
                ${spent.toFixed(0)} / ${budgetNum}
              </div>
              <div style={{fontSize:9,color:C.dim,...MONO}}>budget used</div>
              {/* Budget bar */}
              <div style={{width:80,height:4,background:C.bg3,borderRadius:2,marginTop:4,overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:2,
                  background:spent/budgetNum>=1?C.red:spent/budgetNum>=0.7?C.gold:C.green,
                  width:Math.min(100,(spent/budgetNum*100))+'%',transition:'width 0.3s'}}/>
              </div>
            </div>
          )}
        </div>
        {/* Budget input */}
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontSize:11,color:C.dim,...MONO}}>Budget $</span>
          <input type="number" value={budget}
            onChange={e=>{setBudget(e.target.value);try{localStorage.setItem('mv_fair_budget',e.target.value);}catch{}}}
            placeholder="e.g. 200"
            style={{flex:1,background:C.bg3+'88',border:'1px solid '+C.border,borderRadius:6,
              color:C.text,padding:'5px 10px',fontSize:13,...MONO,outline:'none'}}/>
        </div>
      </div>

      {/* ── Mode switcher ── */}
      <div style={{display:'flex',borderBottom:'1px solid '+C.border}}>
        {[['search','🔍 Search'],['list',`📋 List (${shoppingList.length})`]].map(([id,label])=>(
          <button key={id} onClick={()=>setMode(id)}
            style={{flex:1,padding:'10px 8px',background:'none',border:'none',cursor:'pointer',
              ...MONO,fontSize:12,color:mode===id?C.text:C.dim,
              borderBottom:mode===id?'2px solid '+C.accent:'2px solid transparent'}}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Search mode ── */}
      {mode==='search'&&(
        <div style={{padding:'12px 16px'}}>
          <input ref={searchRef} type="text" value={query}
            onChange={e=>onQueryChange(e.target.value)}
            placeholder="Search artist, album, barcode…"
            style={{width:'100%',boxSizing:'border-box',
              background:C.bg2,border:'2px solid '+C.accent+'66',
              borderRadius:10,color:C.text,padding:'12px 14px',
              fontSize:16,...MONO,outline:'none'}}/>

          {searching&&<div style={{textAlign:'center',padding:'16px',color:C.dim,...MONO,fontSize:12}}>Searching…</div>}

          {results.length>0&&!selected&&(
            <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:10}}>
              {results.map(item=>(
                <button key={item.id} onClick={()=>selectResult(item)}
                  style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,
                    padding:'10px 12px',cursor:'pointer',textAlign:'left',
                    display:'flex',gap:10,alignItems:'center'}}>
                  {item.cover&&<img src={item.cover} alt="" style={{width:44,height:44,borderRadius:6,objectFit:'cover',flexShrink:0}}/>}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{...BEBAS,fontSize:15,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.artist}</div>
                    <div style={{fontSize:10,color:C.muted,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.album}</div>
                    {item.format&&<div style={{fontSize:9,color:'#60a5fa',...MONO,marginTop:2}}>{item.format.split(',').slice(0,2).join(', ')}</div>}
                  </div>
                  <span style={{fontSize:18,color:C.dim,flexShrink:0}}>›</span>
                </button>
              ))}
            </div>
          )}

          {selected&&(
            <div>
              <button onClick={()=>{setSelected(null);setPriceResult(null);}}
                style={{background:'none',border:'none',color:C.dim,cursor:'pointer',...MONO,
                  fontSize:11,padding:'8px 0',display:'flex',alignItems:'center',gap:4}}>
                ‹ Back
              </button>
              {priceLoading?(
                <div style={{textAlign:'center',padding:'20px',color:C.dim,...MONO,fontSize:12}}>
                  Checking price…
                </div>
              ):(
                <PriceCard result={priceResult||selected} onAdd={addToList}
                  shoppingList={shoppingList} collection={collection}/>
              )}
            </div>
          )}

          {!searching&&!selected&&query&&results.length===0&&(
            <div style={{textAlign:'center',padding:'24px',color:C.dim,...MONO,fontSize:12}}>
              No results for "{query}"
            </div>
          )}

          {!query&&(
            <div style={{textAlign:'center',padding:'32px 16px',color:C.dim,...MONO}}>
              <div style={{fontSize:32,marginBottom:8}}>🎵</div>
              <div style={{fontSize:12,lineHeight:1.7}}>
                Search any record to check price<br/>and add to your shopping list
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Shopping list mode ── */}
      {mode==='list'&&(
        <div style={{padding:'12px 16px'}}>
          {shoppingList.length===0?(
            <div style={{textAlign:'center',padding:'40px 0',color:C.dim,...MONO}}>
              <div style={{fontSize:32,marginBottom:8}}>📋</div>
              <div style={{fontSize:12,lineHeight:1.7}}>
                Shopping list is empty<br/>Search for records to add
              </div>
            </div>
          ):(
            <>
              {/* Summary */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                marginBottom:12,padding:'8px 12px',background:C.bg2,borderRadius:8,
                border:'1px solid '+C.border}}>
                <div style={{fontSize:11,...MONO,color:C.dim}}>
                  {boughtCount}/{shoppingList.length} found
                </div>
                {shoppingList.some(i=>i.bought)&&(
                  <button onClick={()=>{
                    const next=shoppingList.filter(i=>!i.bought);
                    setShoppingList(next);saveList(next);
                  }} style={{fontSize:10,color:C.red,background:'none',border:'none',
                    cursor:'pointer',...MONO,padding:0}}>
                    Clear bought
                  </button>
                )}
              </div>

              {/* Priority groups */}
              {['high','medium','low'].map(pri=>{
                const group=shoppingList.filter(i=>i.priority===pri&&!i.bought);
                if(!group.length)return null;
                const priColors={high:C.red,medium:C.gold,low:'#60a5fa'};
                const priLabels={high:'🔴 Must have',medium:'🟡 Want',low:'🔵 Maybe'};
                return(
                  <div key={pri} style={{marginBottom:12}}>
                    <div style={{fontSize:9,color:priColors[pri],...MONO,letterSpacing:'0.1em',
                      textTransform:'uppercase',marginBottom:6}}>
                      {priLabels[pri]}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:5}}>
                      {group.map(item=>(
                        <ShoppingItem key={item.id} item={item}
                          onRemove={removeItem} onBought={toggleBought} onSetMaxPrice={setMaxPrice}/>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Bought */}
              {shoppingList.filter(i=>i.bought).length>0&&(
                <div>
                  <div style={{fontSize:9,color:C.green,...MONO,letterSpacing:'0.1em',
                    textTransform:'uppercase',marginBottom:6}}>
                    ✓ Found ({boughtCount})
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:5}}>
                    {shoppingList.filter(i=>i.bought).map(item=>(
                      <ShoppingItem key={item.id} item={item}
                        onRemove={removeItem} onBought={toggleBought} onSetMaxPrice={setMaxPrice}/>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
