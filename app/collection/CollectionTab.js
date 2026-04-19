// ── CollectionTab ────────────────────────────────────────────────
// Extracted from app/page.js — contains:
//   CollectionTab (main), WatchlistTab, PortfolioChart
// Shared UI primitives (AlbumCover, Badge) stay in page.js because
// the feed also uses them; pass them in as props or import separately.

'use client';
import { useState } from 'react';
import { C, MONO, BEBAS, VINYL_GRADES, GRADE_COLOR, inputSt } from '@/lib/theme';
import dynamic from 'next/dynamic';
const BandsTab = dynamic(() => import('@/app/artists/BandsTab'), { ssr: false });

// ── PortfolioChart ────────────────────────────────────────────────
function PortfolioChart({ snapshots }) {
  if (!snapshots || snapshots.length < 2) return (
    <div style={{ textAlign: 'center', padding: '30px 0', color: C.dim, ...MONO, fontSize: 11 }}>
      No historical data — add records to your collection
    </div>
  );
  const vals = snapshots.map(s => Number(s.total_value) || 0);
  const maxV = Math.max(...vals, 1);
  const minV = Math.min(...vals, 0);
  const range = maxV - minV || 1;
  const W = 300, H = 100, PL = 36, PR = 8, PT = 8, PB = 20;
  const pts = snapshots.map((s, i) => {
    const x = PL + (i / (snapshots.length - 1)) * (W - PL - PR);
    const y = PT + ((maxV - (Number(s.total_value) || 0)) / range) * (H - PT - PB);
    return `${x},${y}`;
  }).join(' ');
  const area = `${PL},${H - PB} ${pts} ${W - PR},${H - PB}`;
  return (
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
      <polygon points={area} fill="url(#cg)" />
      <polyline points={pts} fill="none" stroke={C.accent} strokeWidth="1.5" />
      {snapshots.map((s, i) => {
        const [x, y] = pts.split(' ')[i].split(',').map(Number);
        return <circle key={i} cx={x} cy={y} r="2.5" fill={C.accent} />;
      })}
    </svg>
  );
}

// ── WatchlistTab ──────────────────────────────────────────────────
export function WatchlistTab({ watchlist, onRemove, onAlbumClick, user, AlbumCover }) {
  const [sort, setSort]           = useState('added');
  const [alertItem, setAlertItem] = useState(null);
  const [alertPrice, setAlertPrice]   = useState('');
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertDone, setAlertDone]     = useState({});

  const sorted = [...watchlist].sort((a, b) => {
    if (sort === 'artist') return (a.artist || '').localeCompare(b.artist || '');
    if (sort === 'year')   return (b.release_date || '0').localeCompare(a.release_date || '0');
    return 0;
  });

  const saveAlert = async (album) => {
    if (!alertPrice || isNaN(alertPrice) || !user) return;
    setAlertSaving(true);
    await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discogs_id:  album.album_id || album.id,
        artist:      album.artist,
        album:       album.album,
        target_price: parseFloat(alertPrice),
      }),
    });
    setAlertDone(d => ({ ...d, [album.album_id || album.id]: parseFloat(alertPrice) }));
    setAlertSaving(false); setAlertItem(null); setAlertPrice('');
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
        No watched albums yet.<br />
        <span style={{ color: C.accent }}>Click ☆</span> on any album.
        {!user && <><br /><span style={{ fontSize: 11, color: C.dim }}>Sign in to sync across devices.</span></>}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.dim, ...MONO, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          {watchlist.length} {watchlist.length === 1 ? 'album' : 'albums'}
          {user && <span style={{ color: '#4ade80' }}> · synced ✓</span>}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)}
          style={{ background: C.bg3, border: '1px solid ' + C.border, borderRadius: 6, color: C.muted, padding: '5px 8px', fontSize: 11, ...MONO, cursor: 'pointer', outline: 'none' }}>
          <option value="added">Added order</option>
          <option value="artist">Artist A–Z</option>
          <option value="year">Year</option>
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map(album => {
          const id = String(album.album_id || album.id);
          const hasAlert = alertDone[id];
          return (
            <div key={id} style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
                <div onClick={() => onAlbumClick(album)}
                  style={{ display: 'flex', gap: 12, flex: 1, alignItems: 'center', cursor: 'pointer' }}>
                  {AlbumCover && <AlbumCover src={album.cover} artist={album.artist} size={52} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...BEBAS, fontSize: 17, color: C.text, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.artist}</div>
                    <div style={{ fontSize: 11, color: C.muted, ...MONO, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.album}</div>
                    <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 3 }}>{formatDate(album.release_date || album.releaseDate)}</div>
                    {hasAlert && <div style={{ fontSize: 10, color: '#f5c842', ...MONO, marginTop: 2 }}>🔔 Alert: ≤${hasAlert}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, alignItems: 'flex-end' }}>
                  {hasAlert && <div style={{ fontSize: 10, color: '#f5c842', ...MONO }}>🔔 ≤${hasAlert}</div>}
                  <button onClick={() => onRemove(id)}
                    style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 18, padding: '2px' }}
                    onMouseEnter={e => e.currentTarget.style.color = C.accent}
                    onMouseLeave={e => e.currentTarget.style.color = '#444'}>×</button>
                </div>
              </div>
              <button onClick={() => { setAlertItem(alertItem === id ? null : id); setAlertPrice(''); }}
                style={{ width: '100%', padding: '8px 14px', background: alertItem === id ? '#1a0a00' : 'transparent', border: 'none', borderTop: '1px solid ' + C.border, color: alertItem === id ? '#f5c842' : hasAlert ? '#f5c842' : '#555', cursor: 'pointer', fontSize: 11, ...MONO, display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.05em', textAlign: 'left' }}>
                🔔 {hasAlert ? 'Alert active: ≤$' + hasAlert + ' · edit' : 'Set price alert'}
              </button>
              {alertItem === id && (
                <div style={{ borderTop: '1px solid ' + C.border, padding: '10px 14px', background: '#1a0a00', borderRadius: '0 0 10px 10px' }}>
                  <div style={{ fontSize: 10, color: '#f5c842', ...MONO, marginBottom: 6 }}>🔔 Alert when price drops below</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ ...BEBAS, fontSize: 18, color: C.muted }}>$</span>
                    <input type="number" value={alertPrice} onChange={e => setAlertPrice(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveAlert(album)}
                      placeholder="e.g. 25" autoFocus
                      style={{ flex: 1, background: C.bg3, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 16, ...MONO, outline: 'none' }} />
                    <button onClick={() => saveAlert(album)} disabled={alertSaving || !user}
                      style={{ padding: '10px 18px', background: !user || alertSaving ? C.bg3 : C.accent, border: 'none', borderRadius: 8, color: '#fff', cursor: !user ? 'default' : 'pointer', ...BEBAS, fontSize: 17, flexShrink: 0 }}>
                      {alertSaving ? '…' : 'OK'}
                    </button>
                    <button onClick={() => { setAlertItem(null); setAlertPrice(''); }}
                      style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, padding: '7px 10px', cursor: 'pointer', ...MONO, fontSize: 10, flexShrink: 0 }}>✕</button>
                  </div>
                  {!user && <div style={{ fontSize: 10, color: '#f87171', ...MONO, marginTop: 4 }}>Sign in to set alerts</div>}
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
          🤘 Perfect vault! Every record is fully documented.
        </div>
      )}
    </div>
  );
}

// ── ManualAddForm ─────────────────────────────────────────────
function ManualAddForm({ onAdd, onClose }) {
  const [form, setForm] = useState({ artist: '', album: '', format: 'Vinyl', label: '', year: '', purchase_price: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.artist.trim() || !form.album.trim()) { setError('Artist and album are required'); return; }
    setSaving(true);
    await onAdd({
      artist: form.artist.trim(), album: form.album.trim(),
      format: form.format || 'Vinyl', label: form.label.trim() || null,
      year:   form.year ? parseInt(form.year) : null,
      purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
      cover: null, discogs_id: null,
    });
    setSaving(false);
  };

  const lbl = { display: 'block', fontSize: 9, color: C.dim, ...MONO, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 };
  const fld = { ...inputSt, padding: '9px 12px', marginBottom: 10 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 250, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.bg2, borderRadius: '16px 16px 0 0', padding: '16px', maxHeight: '90vh', overflow: 'auto', paddingBottom: 'env(safe-area-inset-bottom,24px)' }}>
        <div style={{ width: 40, height: 4, background: C.border2, borderRadius: 2, margin: '0 auto 16px' }} />
        <div style={{ ...BEBAS, fontSize: 22, color: C.text, letterSpacing: '0.06em', marginBottom: 16 }}>ADD RECORD MANUALLY</div>
        <label style={lbl}>Artist *</label>
        <input value={form.artist} onChange={e => set('artist', e.target.value)} placeholder="e.g. Metallica" style={fld} autoFocus />
        <label style={lbl}>Album *</label>
        <input value={form.album} onChange={e => set('album', e.target.value)} placeholder="e.g. Master of Puppets" style={fld} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={lbl}>Format</label>
            <select value={form.format} onChange={e => set('format', e.target.value)} style={{ ...fld, cursor: 'pointer', marginBottom: 0 }}>
              {['Vinyl','CD','Cassette','Box Set','Digital','Other'].map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Year</label>
            <input type="number" value={form.year} onChange={e => set('year', e.target.value)} placeholder="e.g. 1986" style={{ ...fld, marginBottom: 0 }} />
          </div>
        </div>
        <label style={lbl}>Label</label>
        <input value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Elektra Records" style={fld} />
        <label style={lbl}>Purchase price ($)</label>
        <input type="number" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)} placeholder="0.00" style={fld} />
        {error && <div style={{ color: '#f87171', fontSize: 11, ...MONO, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', background: 'none', border: '1px solid ' + C.border, borderRadius: 10, color: C.dim, cursor: 'pointer', ...MONO, fontSize: 12 }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            style={{ flex: 2, padding: '12px', background: 'linear-gradient(135deg,' + C.accent + ',' + C.accent2 + ')', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', ...BEBAS, fontSize: 18, letterSpacing: '0.06em' }}>
            {saving ? 'SAVING…' : 'SAVE RECORD'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CollectionTab({
  user, collection, watchlist = [], onRemoveWatch, onRemove, onUpdate,
  portfolio, onAlbumClick, onAddToWatchlist, AlbumCover, onManualAdd,
  premium, onUpgrade, onRefreshPrices,
}) {
  const [view, setView]                   = useState('vinyl');
  const [vaultSearch,    setVaultSearch]   = useState('');
  const [vaultFilter,    setVaultFilter]   = useState('all');
  const [showAddManual,  setShowAddManual] = useState(false);
  const [refreshing,     setRefreshing]    = useState(false);
  const [refreshResult,  setRefreshResult] = useState(null);
  const [expandedId,     setExpandedId]    = useState(null);
  const [showAlertForm, setShowAlertForm] = useState(null);
  const [targetPrice, setTargetPrice]     = useState('');
  const [saving, setSaving]               = useState(false);
  if (!onUpdate) onUpdate = () => {};

  const createAlert = async (item) => {
    if (!targetPrice || isNaN(targetPrice)) return;
    setSaving(true);
    await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discogs_id:   item.discogs_id,
        collection_id: item.id,
        artist:       item.artist,
        album:        item.album,
        target_price: parseFloat(targetPrice),
      }),
    });
    setSaving(false); setShowAlertForm(null); setTargetPrice('');
  };

  if (!user) return (
    <div style={{ textAlign: 'center', padding: '60px 24px', color: C.dim, ...MONO }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>Sign in to manage your collection</div>
    </div>
  );

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
        return (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + C.border }}>
            <div style={{ background: 'linear-gradient(135deg,#1a0800,#2a0a00,#1a0800)', border: '1px solid ' + C.accent, borderRadius: 14, padding: '16px', marginBottom: 10, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', right: -8, top: -8, fontSize: 70, ...BEBAS, opacity: 0.04, userSelect: 'none' }}>$</div>
              <div style={{ fontSize: 9, color: C.accent, ...MONO, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>💰 Collection Value</div>
              <div style={{ ...BEBAS, fontSize: 44, color: C.text, lineHeight: 1, marginBottom: 6 }}>{totalVal > 0 ? '$' + totalVal.toFixed(0) : '—'}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {paid > 0 && totalVal > 0 && (
                  <span style={{ fontSize: 14, color: gainColor, ...MONO, fontWeight: 'bold' }}>
                    {gain >= 0 ? '▲ +$' : '▼ -$'}{Math.abs(gain).toFixed(0)}
                    <span style={{ fontSize: 10, opacity: 0.8, marginLeft: 4 }}>({gain >= 0 ? '+' : ''}{gainPct.toFixed(1)}%)</span>
                  </span>
                )}
                {paid > 0 && <span style={{ fontSize: 10, color: C.dim, ...MONO }}>paid ${paid.toFixed(0)}</span>}
              </div>
              <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 5 }}>
                {priceTracked > 0
                  ? 'Based on Discogs median · ' + priceTracked + '/' + collection.length + ' tracked'
                  : refreshResult
                    ? '✓ ' + refreshResult
                    : '⏳ No prices yet'}
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
                    ↺ Fetch prices now ({collection.length - priceTracked} pending)
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
                { l: 'Records', v: summary?.itemCount ?? collection.length, c: C.accent },
                { l: 'Paid',    v: paid > 0 ? '$' + paid.toFixed(0) : '—',  c: C.muted },
                { l: 'Gain',    v: gain !== 0 ? (gain > 0 ? '+$' : '-$') + Math.abs(gain).toFixed(0) : '—', c: gainColor },
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
          <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 10 }}>Collection value over time</div>
          <PortfolioChart snapshots={portfolio.snapshots} />
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid ' + C.border, padding: '0 16px', flexShrink: 0 }}>
        {[['vinyl', `💿 Vinyl (${collection.length})`], ['watchlist', `★ Watchlist (${watchlist.length})`], ['bands', '🎸 Bands']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            style={{ padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: view === k ? '2px solid ' + C.accent : '2px solid transparent', color: view === k ? C.text : C.dim, ...MONO, fontSize: 11, marginBottom: -1 }}>
            {l}
          </button>
        ))}
      </div>

      {view === 'watchlist' && <WatchlistTab watchlist={watchlist} user={user} onRemove={onRemoveWatch} onAlbumClick={onAlbumClick} AlbumCover={AlbumCover} />}
      {view === 'bands'     && <BandsTab collection={collection} watchlist={watchlist} onAddToWatchlist={onAddToWatchlist || (() => {})} />}

      {view === 'vinyl' && (
        <div style={{ padding: '16px' }}>
          {/* Search + Add */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={vaultSearch} onChange={e => { setVaultSearch(e.target.value); setExpandedId(null); }}
              placeholder="Search artist, album…"
              style={{ ...inputSt, flex: 1, padding: '9px 12px', fontSize: 14 }} />
            <button onClick={() => setShowAddManual(true)}
              style={{ background: C.accent, border: 'none', borderRadius: 8, color: '#fff', padding: '0 16px', cursor: 'pointer', ...BEBAS, fontSize: 16, flexShrink: 0 }}>
              + ADD
            </button>
          </div>
          {/* Filter pills */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
            {[['all','⚡ All'],['vinyl','💿 Vinyl'],['cd','💽 CD'],['limited','💎 Limited'],['no_price','💳 No price']].map(([id, label]) => (
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
            <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO }}>My records ({collection.length})</div>
            <select onChange={e => {
              const s = e.target.value;
              const sorted = [...collection].sort((a, b) => {
                if (s === 'artist')     return (a.artist || '').localeCompare(b.artist || '');
                if (s === 'price_asc')  return (Number(a.purchase_price) || 0) - (Number(b.purchase_price) || 0);
                if (s === 'price_desc') return (Number(b.purchase_price) || 0) - (Number(a.purchase_price) || 0);
                if (s === 'added')      return new Date(b.added_at || 0) - new Date(a.added_at || 0);
                return 0;
              });
              onUpdate(sorted);
            }} style={{ background: C.bg3, border: '1px solid ' + C.border, borderRadius: 6, color: C.muted, padding: '5px 8px', fontSize: 11, ...MONO, cursor: 'pointer', outline: 'none' }}>
              <option value="added">Added order</option>
              <option value="artist">Artist A–Z</option>
              <option value="price_desc">Price ↓</option>
              <option value="price_asc">Price ↑</option>
            </select>
          </div>

          {collection.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button onClick={async () => {
                if (!window.confirm('Remove duplicate entries? (keeps newest)')) return;
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
                🗑 Remove duplicates
              </button>
              <button onClick={async () => {
                if (!window.confirm('Delete ALL records from collection? This cannot be undone.')) return;
                const ids = collection.map(i => i.id);
                await fetch('/api/collection/batch', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
                onUpdate([]);
              }} style={{ flex: 1, padding: '7px', background: '#1a0000', border: '1px solid #7f1d1d', borderRadius: 7, color: '#f87171', cursor: 'pointer', fontSize: 10, ...MONO }}>
                🗑 Clear all
              </button>
            </div>
          )}

          {collection.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: C.dim, ...MONO, fontSize: 12 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>
              Collection is empty — tap + ADD or sync with Discogs
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(() => {
                const visibleItems = collection.filter(item => {
                  const q = vaultSearch.toLowerCase();
                  if (q && !item.artist?.toLowerCase().includes(q) && !item.album?.toLowerCase().includes(q)) return false;
                  if (vaultFilter === 'vinyl')    return (item.format || '').toLowerCase().includes('vinyl') || !item.format;
                  if (vaultFilter === 'cd')       return (item.format || '').toLowerCase().includes('cd');
                  if (vaultFilter === 'limited')  return (item.format || '').toLowerCase().includes('limited');
                  if (vaultFilter === 'no_price') return !item.purchase_price;
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
                          {item.format && item.format !== 'Vinyl' && <span style={{ fontSize: 8, color: C.dim, ...MONO, padding: '1px 4px', background: C.bg3, borderRadius: 3 }}>{item.format}</span>}
                          {paid > 0 && <span style={{ fontSize: 9, color: '#f5c842', ...MONO }}>${paid.toFixed(0)}</span>}
                          {now > 0  && <span style={{ fontSize: 9, color: gain >= 0 ? '#4ade80' : '#f87171', ...MONO }}>→${now.toFixed(0)}{gain !== null ? (gain >= 0 ? ' ▲' : ' ▼') : ''}</span>}
                          {now === 0 && paid > 0 && <span style={{ fontSize: 8, color: '#444', ...MONO }}>⏳</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 14, color: C.dim, flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>⌄</div>
                    </div>

                    {/* ── Expanded detail ── */}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid ' + C.border, padding: '10px 12px' }}>
                        {/* Price + gain */}
                        {(paid > 0 || now > 0) && (
                          <div style={{ display: 'flex', gap: 12, marginBottom: 10, padding: '8px 10px', background: C.bg3, borderRadius: 8 }}>
                            {paid > 0 && <div><div style={{ fontSize: 8, color: C.dim, ...MONO, textTransform: 'uppercase', marginBottom: 2 }}>Paid</div><div style={{ ...BEBAS, fontSize: 18, color: '#f5c842' }}>${paid.toFixed(0)}</div></div>}
                            {now > 0  && <div><div style={{ fontSize: 8, color: C.dim, ...MONO, textTransform: 'uppercase', marginBottom: 2 }}>Market</div><div style={{ ...BEBAS, fontSize: 18, color: '#4ade80' }}>${now.toFixed(0)}</div></div>}
                            {gain !== null && <div><div style={{ fontSize: 8, color: C.dim, ...MONO, textTransform: 'uppercase', marginBottom: 2 }}>Gain</div><div style={{ ...BEBAS, fontSize: 18, color: gain >= 0 ? '#4ade80' : '#f87171' }}>{gain >= 0 ? '+' : ''}${gain.toFixed(0)}<span style={{ fontSize: 11 }}> ({gainPct >= 0 ? '+' : ''}{gainPct?.toFixed(0)}%)</span></div></div>}
                          </div>
                        )}
                        {/* Grade */}
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 9, color: C.dim, ...MONO, marginRight: 2 }}>Grade:</span>
                          {VINYL_GRADES.map(g => (
                            <button key={g} onClick={async () => {
                              await fetch('/api/collection?id=' + item.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grade: g }) });
                              const fresh = await fetch('/api/collection').then(r => r.json());
                              if (fresh.items) onUpdate(fresh.items);
                            }} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid ' + (item.grade === g ? GRADE_COLOR[g] : C.border), background: item.grade === g ? GRADE_COLOR[g] + '22' : C.bg3, color: item.grade === g ? GRADE_COLOR[g] : C.dim, ...MONO }}>{g}</button>
                          ))}
                        </div>
                        {/* Set price */}
                        {showAlertForm === item.id + '_price' ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                            <input type="number" defaultValue={item.purchase_price || ''} id={'pp_' + item.id} placeholder="Paid ($)" style={{ flex: 1, background: C.bg3, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 14, ...MONO, outline: 'none' }} />
                            <button onClick={async () => {
                              const val = document.getElementById('pp_' + item.id)?.value;
                              if (!val) return;
                              await fetch('/api/collection?id=' + item.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purchase_price: parseFloat(val) }) });
                              const fresh = await fetch('/api/collection').then(r => r.json());
                              if (fresh.items) onUpdate(fresh.items);
                              setShowAlertForm(null);
                            }} style={{ background: C.accent, border: 'none', borderRadius: 6, color: '#fff', padding: '7px 12px', cursor: 'pointer', ...BEBAS, fontSize: 14 }}>OK</button>
                            <button onClick={() => setShowAlertForm(null)} style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, padding: '7px 8px', cursor: 'pointer', fontSize: 11 }}>✕</button>
                          </div>
                        ) : !item.purchase_price && (
                          <button onClick={() => setShowAlertForm(item.id + '_price')} style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, padding: '5px 10px', cursor: 'pointer', ...MONO, fontSize: 10, marginBottom: 8 }}>+ Set purchase price</button>
                        )}
                        {/* Alert + Delete */}
                        <div style={{ display: 'flex', gap: 6 }}>
                          {item.discogs_id && (showAlertForm === item.id ? (
                            <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input type="number" value={targetPrice} onChange={e => setTargetPrice(e.target.value)} placeholder="Alert ≤ $" style={{ ...inputSt, padding: '6px 10px', fontSize: 14, flex: 1 }} />
                              <button onClick={() => createAlert(item)} disabled={saving} style={{ background: C.accent, border: 'none', borderRadius: 6, color: '#fff', padding: '7px 12px', cursor: 'pointer', ...BEBAS, fontSize: 14 }}>{saving ? '…' : 'OK'}</button>
                              <button onClick={() => setShowAlertForm(null)} style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, padding: '7px 8px', cursor: 'pointer', fontSize: 11 }}>✕</button>
                            </div>
                          ) : (
                            <button onClick={() => setShowAlertForm(item.id)} style={{ flex: 1, background: 'none', border: '1px solid ' + C.border, borderRadius: 6, color: C.dim, padding: '6px 10px', cursor: 'pointer', ...MONO, fontSize: 10 }}>🔔 Set price alert</button>
                          ))}
                          <button onClick={() => { if (expandedId === item.id) setExpandedId(null); onRemove(item.id); }} style={{ background: 'none', border: '1px solid #7f1d1d', borderRadius: 6, color: '#f87171', padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>🗑</button>
                        </div>
                      </div>
                    )}
                  </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
