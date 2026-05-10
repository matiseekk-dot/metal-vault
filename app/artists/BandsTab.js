'use client';
import { useState, useEffect, useCallback } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { confirm as mvConfirm } from '@/app/components/Toast';
import { useT, useLocale, tn } from '@/lib/i18n';


function norm(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function titleMatch(a, b) {
  const na = norm(a), nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ── ArtistPhoto — shared circular avatar with letter fallback ──
// Used by both ArtistAbout (this file) and inline lists. Kept local
// rather than imported from SearchTab to avoid coupling Vault → Search.
function ArtistPhoto({ src, name, size = 48, accent = C.accent }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div style={{ width:size, height:size, borderRadius:'50%', flexShrink:0,
        background:'linear-gradient(135deg,#1a0a0a,#0a0a0a)',
        border:`1px solid ${accent}33`,
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <span style={{ ...BEBAS, fontSize:Math.round(size*0.42), color:accent }}>
          {(name||'?')[0].toUpperCase()}
        </span>
      </div>
    );
  }
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', flexShrink:0,
      overflow:'hidden', border:`1px solid ${accent}33` }}>
      <img src={src} alt={name} loading="lazy" onError={() => setErr(true)}
        style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
    </div>
  );
}

// ── ArtistAbout — bio + members + similar, collapsible ────────
// Lazily fetches /api/artists/related on mount. Renders nothing while
// loading; pops in once data arrives. Keeps the discography flow
// uninterrupted — bio is decorative, not blocking.
function ArtistAbout({ artistName, locale }) {
  const t = useT();
  const [data, setData] = useState(null);
  // Default OPEN — bio + members + similar are the whole point of the
  // section. Users wanted them visible without an extra tap.
  const [open, setOpen] = useState(true);
  const [memberPhotos, setMemberPhotos] = useState({});
  const [similarPhotos, setSimilarPhotos] = useState({});
  const [bioFull, setBioFull] = useState(false);

  useEffect(() => {
    if (!artistName) return;
    let cancelled = false;
    // v=2 busts pre-Spotify-config cache entries.
    fetch(`/api/artists/related?name=${encodeURIComponent(artistName)}&lang=${encodeURIComponent(locale || 'en')}&v=2`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [artistName, locale]);

  // Batch-fetch photos for member + similar lists once data arrives.
  useEffect(() => {
    if (!data) return;
    const memberNames = [...(data.members||[]), ...(data.exMembers||[]), ...(data.sideProjects||[])]
      .map(m => m.name).filter(Boolean);
    if (memberNames.length > 0) {
      fetch('/api/artists/image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: memberNames }),
      }).then(r => r.json()).then(d => d?.images && setMemberPhotos(d.images)).catch(() => {});
    }
    const similarNames = (data.similar || []).map(s => s.name).filter(Boolean);
    if (similarNames.length > 0) {
      fetch('/api/artists/image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: similarNames }),
      }).then(r => r.json()).then(d => d?.images && setSimilarPhotos(d.images)).catch(() => {});
    }
  }, [data]);

  if (!data) return null;
  const hasContent = data.image || data.bio?.summary || data.members?.length > 0
    || data.exMembers?.length > 0 || data.sideProjects?.length > 0
    || data.similar?.length > 0 || data.tags?.length > 0;
  if (!hasContent) return null;

  const openOther = (name, mbid) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mv:open-artist', { detail: { name, mbid } }));
    }
  };

  return (
    <div style={{
      background: data.image
        ? `linear-gradient(180deg, rgba(10,10,10,0.6) 0%, ${C.bg2} 80%), url("${data.image}") center/cover`
        : C.bg2,
      border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px',
      marginBottom: 14, position:'relative', overflow:'hidden',
    }}>
      {/* Header strip — photo + meta */}
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:10 }}>
        <ArtistPhoto src={data.image || data.thumb} name={data.artist || artistName} size={56} accent={C.accent}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ ...BEBAS, fontSize:18, color:C.text, letterSpacing:'0.04em',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
            textShadow: data.image ? '0 1px 2px rgba(0,0,0,0.7)' : 'none' }}>
            {data.artist || artistName}
          </div>
          <div style={{ display:'flex', gap:6, marginTop:2, flexWrap:'wrap' }}>
            {data.type && <span style={{ fontSize:9, color:C.dim, ...MONO }}>{data.type}</span>}
            {data.country && <span style={{ fontSize:9, color:C.dim, ...MONO }}>· {data.country}</span>}
            {data.lifeSpan?.begin && (
              <span style={{ fontSize:9, color:C.dim, ...MONO }}>
                · {data.lifeSpan.begin.split('-')[0]}{data.lifeSpan.ended && data.lifeSpan.end ? '–' + data.lifeSpan.end.split('-')[0] : '–'}
              </span>
            )}
            {data.popularity != null && (
              <span style={{ fontSize:9, color:C.dim, ...MONO }}>· {data.popularity}/100</span>
            )}
          </div>
        </div>
        <button onClick={() => setOpen(o => !o)}
          style={{ background:'rgba(0,0,0,0.4)', border:`1px solid ${C.border}`, borderRadius:6,
            color:C.accent, cursor:'pointer', padding:'5px 9px', fontSize:11, ...MONO,
            flexShrink:0 }}>
          {open ? '▴' : '▾'}
        </button>
      </div>

      {/* Similar artists — ALWAYS visible (not collapsible). User
          asked for these to be more prominent. Horizontal scrollable
          strip with photo + name; ideal entry point to discover
          related bands without expanding the whole bio section. */}
      {data.similar?.length > 0 && (
        <SimilarStrip
          items={data.similar}
          photos={similarPhotos}
          onPick={openOther}
          title={t('artist.similar')}
        />
      )}

      {open && (
        <>
          {/* Tags */}
          {data.tags?.length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:10 }}>
              {data.tags.map(tag => (
                <span key={tag} style={{ fontSize:9, padding:'2px 7px', borderRadius:10,
                  background:C.bg3, color:C.muted, border:`1px solid ${C.border}`, ...MONO }}>{tag}</span>
              ))}
            </div>
          )}

          {/* Bio */}
          {data.bio?.summary && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
                textTransform:'uppercase', marginBottom:5 }}>{t('artist.bio')}</div>
              <div style={{ fontSize:11, color:C.text, lineHeight:1.6, ...MONO }}>
                {bioFull ? data.bio.full : data.bio.summary}
              </div>
              {data.bio.full && data.bio.full !== data.bio.summary && (
                <button onClick={() => setBioFull(b => !b)}
                  style={{ marginTop:5, background:'none', border:'none', color:C.accent,
                    cursor:'pointer', fontSize:10, ...MONO, padding:0 }}>
                  {bioFull ? t('artist.bioLess') : t('artist.bioMore')}
                </button>
              )}
            </div>
          )}

          {/* Members */}
          {data.members?.length > 0 && (
            <ArtistList title={t('artist.members')} items={data.members} photos={memberPhotos} onPick={openOther}/>
          )}
          {data.exMembers?.length > 0 && (
            <ArtistList title={t('artist.exMembers')} items={data.exMembers} photos={memberPhotos} onPick={openOther}/>
          )}
          {data.sideProjects?.length > 0 && (
            <ArtistList title={t('artist.bandsPlayedIn')} items={data.sideProjects} photos={memberPhotos} onPick={openOther}/>
          )}
        </>
      )}
    </div>
  );
}

// ── SimilarStrip — horizontal scrollable carousel of similar artists ─
// Always-visible row with photo cards. More prominent than ArtistList
// (which is a vertical compact list inside the collapsed bio section).
function SimilarStrip({ items, photos, onPick, title }) {
  return (
    <div style={{ marginTop:6, marginBottom:12 }}>
      <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
        textTransform:'uppercase', marginBottom:8 }}>
        {title} →
      </div>
      <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4,
        // Hide horizontal scrollbar but keep scroll snap for nicer touch UX.
        // pan-x stops Android Chromium from eating vertical drags here.
        scrollSnapType:'x mandatory', WebkitOverflowScrolling:'touch',
        touchAction: 'pan-x' }}>
        {items.slice(0, 12).map(item => {
          const photo = photos[item.name];
          return (
            <div key={item.mbid || item.name}
              onClick={() => onPick(item.name, item.mbid)}
              style={{
                flexShrink:0, width:78, cursor:'pointer',
                scrollSnapAlign:'start',
                display:'flex', flexDirection:'column', alignItems:'center', gap:5,
              }}>
              <div style={{
                width:64, height:64, borderRadius:'50%', overflow:'hidden',
                border:`1.5px solid ${C.border}`,
                background: photo ? 'transparent' : 'linear-gradient(135deg,#1a0a0a,#0a0a0a)',
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                {photo ? (
                  <img src={photo} alt={item.name} loading="lazy"
                    style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                ) : (
                  <span style={{ ...BEBAS, fontSize:24, color:C.muted }}>
                    {item.name[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{
                fontSize:10, color:C.text, ...MONO, textAlign:'center',
                width:'100%', overflow:'hidden', textOverflow:'ellipsis',
                whiteSpace:'nowrap', lineHeight:1.2,
              }}>
                {item.name}
              </div>
              {item.match != null && item.match > 0 && (
                <div style={{ fontSize:8, color:C.accent, ...MONO }}>
                  {Math.round(item.match * 100)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ArtistList — compact list for ArtistAbout sections ────────
function ArtistList({ title, items, photos, onPick }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
        textTransform:'uppercase', marginBottom:5 }}>{title}</div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {items.slice(0, 10).map(item => (
          <div key={item.mbid || item.name}
            onClick={() => onPick(item.name, item.mbid)}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 8px',
              background:C.bg3, border:`1px solid ${C.border}`, borderRadius:6,
              cursor:'pointer' }}>
            <ArtistPhoto src={photos[item.name]} name={item.name} size={26} accent={C.muted}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, color:C.text, ...MONO, fontWeight:600,
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {item.name}
              </div>
              <div style={{ fontSize:9, color:C.dim, ...MONO, display:'flex', gap:5, flexWrap:'wrap' }}>
                {item.roles?.length > 0 && (
                  <span style={{ color: item.active ? C.green : C.muted }}>{item.roles.join(', ')}</span>
                )}
                {item.begin && <span>{item.roles?.length ? '· ' : ''}{item.begin.split('-')[0]}{item.end ? '–' + item.end.split('-')[0] : ''}</span>}
                {item.similarMatch != null && item.similarMatch > 0 && (
                  <span style={{ color:C.accent }}>match {Math.round(item.similarMatch * 100)}%</span>
                )}
              </div>
            </div>
            <span style={{ fontSize:14, color:C.accent }}>›</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Completion bar ─────────────────────────────────────────────
function CompletionBar({ have, total, isComplete }) {
  const filled = Math.round((have / Math.max(total, 1)) * 12);
  const bar    = '█'.repeat(filled) + '░'.repeat(12 - filled);
  const color  = isComplete ? C.gold : have / total >= 0.7 ? C.green : have / total >= 0.4 ? '#60a5fa' : C.muted;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ ...MONO, fontSize:12, color, letterSpacing:1 }}>{bar}</span>
      <span style={{ ...MONO, fontSize:12, color, fontWeight: isComplete ? 'bold' : 'normal' }}>
        {have}/{total}
      </span>
    </div>
  );
}

// ── Single artist discography (expanded) ──────────────────────
function ArtistDiscography({ artistName, collection, watchlist, onAddToWatchlist, onComplete, isFollowed, onToggleFollow }) {
  const t = useT();
  const locale = useLocale();
  const LS_WANTED = 'mv_wanted_v1';
  const [wanted,    setWanted]    = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_WANTED) || '{}'); } catch { return {}; }
  });
  const [vinylOnly, setVinylOnly] = useState(true);

  const wantKey = useCallback(
    (title) => (artistName + '::' + title).toLowerCase(),
    [artistName],
  );
  const isWanted = useCallback(
    (title) => wanted[wantKey(title)] === true,
    [wanted, wantKey],
  );
  // Unified: ♥ click = toggle watchlist entry directly (no separate "wanted" concept).
  // Still keeps LS as optimistic cache for instant UI feedback while DB write is in flight.
  const toggleWanted = async (album) => {
    const k = wantKey(album.title);
    const wasWanted = wanted[k] === true;

    // Optimistic: update local state first
    setWanted(prev => {
      const next = { ...prev };
      if (wasWanted) { delete next[k]; } else { next[k] = true; }
      try {
        localStorage.setItem(LS_WANTED, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('mv-wanted-changed'));
      } catch {}
      return next;
    });

    // Persist to watchlist: add if new, remove if toggling off
    try {
      if (wasWanted) {
        // Already in watchlist — remove
        if (album.id) {
          await fetch('/api/watchlist?album_id=' + album.id, { method: 'DELETE' });
        }
      } else {
        // Add to watchlist. Pass format if discography data has it so
        // the variant chip in the watchlist row shows context (e.g.
        // "Album, Limited Edition"). User can refine later via inline
        // edit; we only seed with what we know.
        await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            album_id: album.id || (artistName + '::' + album.title).toLowerCase().replace(/[^a-z0-9]/g, '_'),
            artist:   artistName,
            album:    album.title,
            cover:    album.cover || null,
            year:     album.year || null,
            format:   album.format || null,
          }),
        });
        // Notify parent so watchlist count updates everywhere
        window.dispatchEvent(new CustomEvent('mv-watchlist-changed'));
      }
    } catch (e) {
      const { logWarn } = await import('@/lib/log');
      logWarn('Watchlist sync failed', e);
    }
  };
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null); setData(null);
    const url = '/api/artists/discography?artist=' + encodeURIComponent(artistName) + (vinylOnly ? '&vinyl=1' : '');
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [artistName, vinylOnly]);

  useEffect(() => { load(); }, [load]);

  // Notify parent complete/incomplete based on user intent.
  //
  // Earlier code revoked completion (onComplete(name, 0)) whenever
  // collection < full Discogs discography. That's wrong: the Discogs
  // catalogue includes singles, live albums, compilations, demo tapes
  // etc — far more than what most collectors consider "complete".
  // For Opeth a user with 18 studio LPs would get auto-revoked
  // because Discogs lists ~30 releases counting splits + comps.
  //
  // New rule: only let this expanded view affect completion in two
  // scenarios:
  //   (a) user hearted ≥1 album → "wanted" intent is explicit, target
  //       = hearts ∪ collection ∪ watchlist; revoke iff not all owned.
  //   (b) full discography is collected → mark complete unconditionally.
  // Otherwise leave completion alone — BandsTab's auto-mark useEffect
  // covers the "owns ≥1 record, zero pending watchlist" case below.
  useEffect(() => {
    if (!data?.albums?.length) return;
    const normCol = collection
      .filter(i => norm(i.artist) === norm(artistName))
      .map(i => norm(i.album));
    const wantedInDiscog = data.albums.filter(a => isWanted(a.title));
    const hasAnyWanted = wantedInDiscog.length > 0;

    if (hasAnyWanted) {
      const targetList = data.albums.filter(a =>
        isWanted(a.title) || normCol.some(c => titleMatch(c, a.normTitle))
      );
      const have = targetList.filter(a => normCol.some(c => titleMatch(c, a.normTitle))).length;
      const done = have === targetList.length && targetList.length > 0;
      onComplete(artistName, done ? 100 : 0);
      return;
    }

    // No hearts → only emit a positive signal when full discography is
    // collected. Don't emit 0 (would revoke completion set by the
    // BandsTab auto-mark which uses a more user-centric definition).
    const haveAll = data.albums.every(a => normCol.some(c => titleMatch(c, a.normTitle)));
    if (haveAll && data.albums.length > 0) onComplete(artistName, 100);
  }, [data, wanted, collection, artistName, isWanted, onComplete]);

  if (loading) return (
    <div style={{ padding:'16px', textAlign:'center', color:C.dim, ...MONO, fontSize:11 }}>
      {t('bands.loadingDiscography')}
    </div>
  );

  const errMsg     = error || data?.error || '';
  const isRateLimit = errMsg.includes('429') || errMsg.includes('rate limit');

  if (errMsg || data?.notFound || !data?.albums?.length) return (
    <div style={{ padding:'12px 16px' }}>
      {data?.notFound ? (
        <div style={{ color:C.dim, ...MONO, fontSize:11 }}>⚠️ Artist not found on Discogs</div>
      ) : isRateLimit ? (
        <div>
          <div style={{ color:C.gold, ...MONO, fontSize:11, marginBottom:8 }}>
            ⏳ Discogs is busy — try again in a moment
          </div>
          <button onClick={load}
            style={{ background:'#1a1a00', border:'1px solid '+C.gold, borderRadius:6,
              color:C.gold, padding:'6px 12px', cursor:'pointer', fontSize:11, ...MONO }}>
            ↺ {t('common.retry')}
          </button>
        </div>
      ) : (
        <div style={{ color:C.dim, ...MONO, fontSize:11 }}>⚠️ {errMsg || t('bands.empty.title')}</div>
      )}
    </div>
  );

  const normCollection = collection
    .filter(i => norm(i.artist) === norm(artistName))
    .map(i => norm(i.album));
  const watchlistTitles = (watchlist || [])
    .filter(i => norm(i.artist) === norm(artistName))
    .map(i => norm(i.album));

  const enriched = data.albums.map(album => ({
    ...album,
    inCollection: normCollection.some(c => titleMatch(c, album.normTitle)),
    inWatchlist:  watchlistTitles.some(w => titleMatch(w, album.normTitle)),
    wanted:       isWanted(album.title),
  }));

  const wantedAlbums = enriched.filter(a => isWanted(a.title) || a.inCollection || a.inWatchlist);
  const hasAnyWanted = wantedAlbums.length > 0;
  // If user has marked any ♥ wants, use those for completion. Otherwise use full discography.
  const targetAlbums = hasAnyWanted ? wantedAlbums : enriched;
  const haveCount    = targetAlbums.filter(a => a.inCollection).length;
  const isComplete   = haveCount === targetAlbums.length && targetAlbums.length > 0;
  const missing      = targetAlbums.filter(a => !a.inCollection);

  return (
    <div style={{ padding:'12px 16px 16px' }}>
      {/* About — bio + members + similar (collapsible). Decorative — fails open */}
      <ArtistAbout artistName={artistName} locale={locale}/>

      {/* Summary row */}
      <div style={{ marginBottom:14 }}>
        {data.source === 'musicbrainz' && (
          <div style={{
            fontSize: 10, color: '#60a5fa', ...MONO,
            background: '#0d1428', border: '1px solid #1e3a8a',
            borderRadius: 6, padding: '5px 9px', marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>ℹ {t('bands.fallbackNote')}</span>
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <div style={{ fontSize:10, color:C.dim, ...MONO }}>
            {tn(enriched.length, 'plural.releases')}
          </div>
          <button onClick={() => setVinylOnly(v => !v)}
            style={{ background: vinylOnly ? C.accent+'22' : C.bg3,
              border:'1px solid '+(vinylOnly ? C.accent+'66' : C.border),
              borderRadius:20, color: vinylOnly ? C.accent : C.dim,
              padding:'3px 10px', cursor:'pointer', fontSize:10, ...MONO }}>
            💿 Vinyl only {vinylOnly ? '✓' : ''}
          </button>
        </div>
        <CompletionBar have={haveCount} total={targetAlbums.length} isComplete={isComplete}/>
        {isComplete ? (
          <div style={{ fontSize:11, color:C.gold, ...MONO, marginTop:6, display:'flex', alignItems:'center', gap:6 }}>
            🏆 {hasAnyWanted ? 'All wanted albums collected!' : 'Full discography collected!'}
          </div>
        ) : (
          <div style={{ fontSize:10, color:C.dim, ...MONO, marginTop:4 }}>
            {tn(missing.length, 'plural.albumsMissing')}
            {hasAnyWanted && <span style={{ color:C.accent, marginLeft:4 }}>· wanted only</span>}
          </div>
        )}
      </div>

      {/* Album list */}
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        {enriched.map(album => {
          const statusColor = album.inCollection ? C.green : album.inWatchlist ? C.gold : C.dim;
          const statusIcon  = album.inCollection ? '✓' : album.inWatchlist ? '★' : '✗';
          return (
            <div key={album.id} style={{
              display:'flex', alignItems:'center', gap:10,
              padding:'8px 10px', borderRadius:8,
              background: album.inCollection ? '#0d1f0d' : album.inWatchlist ? '#1a1500' : album.wanted ? '#1a0a0a' : C.bg3,
              border:'1px solid ' + (album.inCollection ? '#1a3d1a' : album.inWatchlist ? '#3d3000' : album.wanted ? '#7f1d1d' : C.border),
            }}>
              {/* Cover */}
              <div style={{ width:36, height:36, borderRadius:4, flexShrink:0,
                background:C.bg2, overflow:'hidden', border:'1px solid '+C.border }}>
                {album.cover
                  ? <img src={album.cover} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                  : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>💿</div>
                }
              </div>
              {/* Title + year */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, color: album.inCollection ? C.text : C.muted,
                  ...MONO, fontWeight: album.inCollection ? 'bold' : 'normal',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {album.title}
                </div>
                <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                  <span style={{ fontSize:10, color:C.dim, ...MONO }}>{album.year}</span>
                  {album.format?.toLowerCase().includes('live') && (
                    <span style={{ fontSize:8, color:'#60a5fa', background:'#60a5fa22',
                      borderRadius:4, padding:'1px 5px', ...MONO, letterSpacing:'0.05em' }}>LIVE</span>
                  )}
                </div>
              </div>
              {/* Want ♥ + status */}
              <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                {/* ♥ Want toggle — marks album as personally wanted */}
                {!album.inCollection && (
                  <button onClick={() => toggleWanted(album)}
                    title={album.wanted ? t('bands.removeFromWanted') : t('bands.markAsWanted')}
                    style={{ background:'none', border:'none', cursor:'pointer',
                      fontSize:17, padding:'4px 6px', lineHeight:1,
                      color: album.wanted ? '#f87171' : '#333' }}>
                    {album.wanted ? '♥' : '♡'}
                  </button>
                )}
                <span style={{ fontSize:13, color:statusColor, ...MONO }}>{statusIcon}</span>
                {/* Secondary watchlist button removed — ♥ click handles this directly */}
                {!album.inCollection && !album.inWatchlist && !album.wanted && (
                  <button onClick={() => onAddToWatchlist(artistName, album)}
                    style={{ background:'#1a1a00', border:'1px solid '+C.gold, borderRadius:6,
                      color:C.gold, padding:'3px 8px', fontSize:10, cursor:'pointer', ...MONO,
                      whiteSpace:'nowrap' }}>
                    + {t('vinyl.addToWatchlist').replace(/^[☆★]\s*/, '')}
                  </button>
                )}
                {album.inWatchlist && !album.inCollection && (
                  <span style={{ fontSize:9, color:C.gold, ...MONO }}>watching</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop:10, textAlign:'right' }}>
        <a href={'https://www.discogs.com/artist/' + data.artistId}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize:9, color:C.dim, ...MONO, textDecoration:'none' }}>
          View on Discogs ↗
        </a>
      </div>
    </div>
  );
}

// ── Main BandsTab ──────────────────────────────────────────────
const LS_KEY = 'mv_complete_artists';

export default function BandsTab({ collection, watchlist, onAddToWatchlist, followedArtists = [], onToggleFollow, onBatchFollow }) {
  const t = useT();
  const [followingAll, setFollowingAll] = useState(false);
  const [manageMode,   setManageMode]   = useState(false);
  const [expanded,   setExpanded]   = useState(null);
  const [search,     setSearch]     = useState('');
  // Map: artistName → completion pct (loaded from localStorage)
  const [completion, setCompletion] = useState({});
  // Map: artistName → Spotify/Deezer thumb URL (lazy batch lookup)
  const [photos, setPhotos] = useState({});

  // Batch-fetch artist photos for everyone in the collection. Runs once
  // on mount + whenever the collection changes. Server-side route hits
  // Spotify first, falls back to Deezer — both are cached at the edge
  // so subsequent batches share entries.
  useEffect(() => {
    const allNames = [...new Set(collection.map(c => c.artist).filter(Boolean))];
    if (allNames.length === 0) return;
    let cancelled = false;
    // Chunk into batches of 12 (POST endpoint cap). Run sequentially so we
    // don't burst Spotify/Deezer; each batch is ~200ms typical.
    (async () => {
      for (let i = 0; i < allNames.length; i += 12) {
        if (cancelled) return;
        const chunk = allNames.slice(i, i + 12);
        try {
          const r = await fetch('/api/artists/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ names: chunk }),
          });
          const d = await r.json();
          if (!cancelled && d?.images) {
            setPhotos(prev => ({ ...prev, ...d.images }));
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [collection]);

  // Load saved completion from localStorage immediately (instant UI), then
  // reconcile with the server in the background so toggles made on other
  // devices show up. 401 = anonymous → stay LS-only. Any artists that exist
  // only in LS get pushed up so a re-install doesn't lose them.
  useEffect(() => {
    let local = {};
    try { local = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch {}
    setCompletion(local);

    (async () => {
      let r;
      try { r = await fetch('/api/artist-completion'); } catch { return; }
      if (r.status === 401 || !r.ok) return;
      let d;
      try { d = await r.json(); } catch { return; }
      const serverArtists = new Set(d.artists || []);
      const localArtists  = Object.keys(local).filter(a => local[a] >= 100);
      const localOnly     = localArtists.filter(a => !serverArtists.has(a));

      if (localOnly.length) {
        try {
          await fetch('/api/artist-completion', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artists: localOnly }),
          });
        } catch {}
      }

      // Merge: server artists ∪ localOnly (which we just pushed) → final state.
      const merged = {};
      for (const a of serverArtists) merged[a] = 100;
      for (const a of localOnly)     merged[a] = 100;
      setCompletion(merged);
      try { localStorage.setItem(LS_KEY, JSON.stringify(merged)); } catch {}
    })();
  }, []);

  // Fire-and-forget server sync for a single completion toggle.
  const pushCompletion = useCallback((artistName, completed) => {
    fetch('/api/artist-completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: artistName, completed: !!completed }),
    }).catch(() => {});
  }, []);

  // Called by ArtistDiscography with 100 (complete) or 0 (incomplete)
  const handleComplete = useCallback((artistName, pct = 100) => {
    setCompletion(prev => {
      const next = { ...prev };
      const wasCompleted = next[artistName] === 100;
      if (pct >= 100) next[artistName] = 100;
      else delete next[artistName];
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      if ((pct >= 100) !== wasCompleted) pushCompletion(artistName, pct >= 100);
      return next;
    });
  }, [pushCompletion]);

  // Group collection by artist
  const artistMap = {};
  collection.forEach(item => {
    const key = item.artist || 'Unknown';
    if (!artistMap[key]) artistMap[key] = [];
    artistMap[key].push(item);
  });

  // Auto-mark artists as complete when the user has acquired everything
  // they expressed interest in for that artist. "Expressed interest" =
  // local ♥ wants OR persistent watchlist entries.
  //
  // Why both? Wants live in localStorage and only exist for items the
  // user explicitly hearted. Watchlist lives in the database and is the
  // canonical "I want to buy this" list — when a user moves an item
  // from watchlist to collection, the wanted entry might be cleared but
  // the watchlist row reflects the same intent. Looking at both means
  // we mark complete in either flow.
  //
  // Only ADD to 100 here — never revoke. ArtistDiscography (when
  // expanded) is authoritative for REMOVING completion based on the
  // full Discogs discography.
  useEffect(() => {
    const check = () => {
      try {
        const wanted = JSON.parse(localStorage.getItem('mv_wanted_v1') || '{}');
        const wantedKeys = Object.keys(wanted);

        // Build artistMap locally to avoid stale closure
        const localArtistMap = {};
        collection.forEach(item => {
          const key = item.artist || 'Unknown';
          if (!localArtistMap[key]) localArtistMap[key] = [];
          localArtistMap[key].push(item);
        });

        // Build watchlist artist → titles index. Watchlist entries that
        // are already in collection still count toward "interest set"
        // — we want completion to fire when the user has acquired
        // everything they once wanted, regardless of whether they
        // remembered to delete the watchlist row afterwards.
        const watchByArtist = {};
        (watchlist || []).forEach(w => {
          const a = w.artist || w.band || '';
          const t = w.album || w.title || '';
          if (!a || !t) return;
          if (!watchByArtist[a]) watchByArtist[a] = [];
          watchByArtist[a].push(t);
        });

        setCompletion(prev => {
          const next = { ...prev };
          let changed = false;

          for (const artistName of Object.keys(localArtistMap)) {
            const ownedTitles = localArtistMap[artistName].map(i => norm(i.album || ''));
            // Gather targets from both sources (deduped on normalized title)
            const keyPrefix = artistName.toLowerCase() + '::';
            const wantedTitles = wantedKeys
              .filter(k => k.startsWith(keyPrefix))
              .map(k => norm(k.replace(keyPrefix, '')));
            const watchTitles = (watchByArtist[artistName] || []).map(norm);
            const interestSet = new Set([...wantedTitles, ...watchTitles].filter(Boolean));

            // Pending watchlist for this artist = items the user wants
            // but hasn't acquired yet. If this is empty AND user owns
            // at least one record, we treat the artist as "done" —
            // user explicitly didn't queue anything else, so there's
            // nothing left to want. This is what catches the Opeth
            // case (18 records, zero ♥ hearts, zero watchlist) that
            // earlier revision missed.
            const pendingWatch = watchTitles.filter(wt =>
              !ownedTitles.some(ot => titleMatch(ot, wt))
            );

            if (interestSet.size === 0) {
              if (pendingWatch.length === 0 && ownedTitles.length > 0 && next[artistName] !== 100) {
                next[artistName] = 100;
                changed = true;
              }
              continue;
            }

            const hasAll = [...interestSet].every(wt =>
              ownedTitles.some(ot => titleMatch(ot, wt))
            );

            if (hasAll && next[artistName] !== 100) {
              next[artistName] = 100;
              changed = true;
            }
          }

          if (!changed) return prev;
          try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
          for (const a of Object.keys(next)) {
            if (next[a] === 100 && prev[a] !== 100) pushCompletion(a, true);
          }
          return next;
        });
      } catch {}
    };

    // Run once on mount + when collection/watchlist change + on ♥ toggle
    check();
    window.addEventListener('mv-wanted-changed', check);
    window.addEventListener('mv-watchlist-changed', check);
    return () => {
      window.removeEventListener('mv-wanted-changed', check);
      window.removeEventListener('mv-watchlist-changed', check);
    };
  }, [collection, watchlist, pushCompletion]);

  // Sort by record count, descending. The COMPLETE badge / crown
  // visual marker stays on each row but it no longer pushes complete
  // artists to the top — most users prefer "biggest collections
  // first" as the primary mental order, with the badge as a secondary
  // signal you scan for. Earlier this code lifted complete artists
  // above everyone else which buried high-record-count incomplete
  // artists (Opeth at 18 records ranked below a 1-record COMPLETE).
  let artists = Object.entries(artistMap).sort((a, b) => b[1].length - a[1].length);

  if (search.trim()) {
    const q = search.toLowerCase();
    artists = artists.filter(([name]) => name.toLowerCase().includes(q));
  }

  const completeCount = Object.values(completion).filter(v => v === 100).length;

  if (collection.length === 0) return (
    <div style={{ textAlign:'center', padding:'40px 16px', color:C.dim, ...MONO }}>
      <div style={{ fontSize:40, marginBottom:12 }}>🎸</div>
      <div style={{ fontSize:13, lineHeight:1.7 }}>Add records to your collection<br/>to track band discographies</div>
    </div>
  );

  return (
    <div style={{ padding:'12px 0 24px' }}>

      {/* Header */}
      <div style={{ padding:'0 16px 10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div style={{ ...BEBAS, fontSize:20, color:C.text, letterSpacing:'0.06em' }}>
            {t('bands.title').toUpperCase()}
          </div>
          {onToggleFollow && (() => {
            const allNames     = Object.keys(artistMap);
            const notFollowed  = allNames.filter(n => !followedArtists.some(a => a.artist_name === n));
            const anyFollowed  = allNames.some(n => followedArtists.some(a => a.artist_name === n));
            return (
              <div style={{ display:'flex', gap:6 }}>
                {notFollowed.length > 0 && (
                  <button
                    onClick={async () => {
                      setFollowingAll(true);
                      try {
                        const r = await fetch('/api/artists/follow-all', { method: 'POST' });
                        const d = await r.json();
                        if (d.artists?.length && onBatchFollow) onBatchFollow(d.artists);
                      } catch {}
                      setFollowingAll(false);
                    }}
                    disabled={followingAll}
                    style={{ background:C.accent+'22', border:'1px solid '+C.accent+'66',
                      borderRadius:8, color:C.accent, padding:'6px 10px', cursor:'pointer',
                      ...MONO, fontSize:10, whiteSpace:'nowrap', opacity:followingAll?0.6:1 }}>
                    {followingAll ? '⏳…' : `🔔 All (${notFollowed.length})`}
                  </button>
                )}
                {anyFollowed && (
                  <button
                    onClick={() => setManageMode(m => !m)}
                    style={{ background: manageMode ? '#1a0000' : C.bg3,
                      border:'1px solid '+(manageMode ? C.accent : C.border),
                      borderRadius:8, color: manageMode ? C.accent : C.dim,
                      padding:'6px 10px', cursor:'pointer', ...MONO, fontSize:10, whiteSpace:'nowrap' }}>
                    {manageMode ? '✕ ' + t('common.close') : '✏ ' + t('common.edit')}
                  </button>
                )}
              </div>
            );
          })()}
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:2, flexWrap:'wrap' }}>
          <span style={{ fontSize:10, color:C.dim, ...MONO }}>
            {artists.length} artists · tap to check completion
          </span>
          {completeCount > 0 && (
            <span style={{ fontSize:10, color:C.gold, ...MONO,
              background:'#2a2000', borderRadius:6, padding:'2px 8px',
              border:'1px solid #3d3000' }}>
              🏆 {completeCount} {t('bands.complete').replace(/^✓\s*/, '').toLowerCase()}
            </span>
          )}
        </div>
      </div>

      {/* Manage following — shown when manageMode active */}
      {manageMode && onToggleFollow && (() => {
        const followedInCollection = followedArtists.filter(a =>
          Object.keys(artistMap).some(n => n === a.artist_name)
        );
        const followedOther = followedArtists.filter(a =>
          !Object.keys(artistMap).some(n => n === a.artist_name)
        );
        return (
          <div style={{ margin:'0 16px 10px', background:C.bg2, border:'1px solid '+C.border, borderRadius:10, padding:'10px 12px' }}>
            <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.15em', textTransform:'uppercase', marginBottom:8 }}>
              {t('bands.followedCount')} ({followedArtists.length})
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {[...followedInCollection, ...followedOther].map(a => (
                <button key={a.artist_name}
                  onClick={() => onToggleFollow(a.artist_name)}
                  style={{ background:'#1a0000', border:'1px solid '+C.accent+'44',
                    borderRadius:20, color:C.accent, padding:'5px 10px',
                    cursor:'pointer', fontSize:11, ...MONO,
                    display:'flex', alignItems:'center', gap:5 }}>
                  🔔 {a.artist_name}
                  <span style={{ fontSize:13, color:'#f87171', lineHeight:1 }}>×</span>
                </button>
              ))}
              {followedArtists.length === 0 && (
                <div style={{ fontSize:11, color:C.dim, ...MONO }}>No followed artists yet</div>
              )}
            </div>
            {followedArtists.length > 1 && (
              <button
                onClick={async () => {
                  if (!(await mvConfirm(t('bands.unfollowAllConfirm'), { kind: 'danger', confirmLabel: t('bands.unfollowAll') }))) return;
                  for (const a of followedArtists) await onToggleFollow(a.artist_name);
                  setManageMode(false);
                }}
                style={{ marginTop:10, background:'none', border:'1px solid #7f1d1d',
                  borderRadius:6, color:'#f87171', padding:'5px 12px',
                  cursor:'pointer', ...MONO, fontSize:10 }}>
                Unfollow all
              </button>
            )}
          </div>
        );
      })()}

      {/* Search */}
      <div style={{ padding:'0 16px 10px' }}>
        <input type="text" placeholder={t('common.search') + '…'} value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width:'100%', boxSizing:'border-box',
            background:C.bg3, border:'1px solid '+C.border,
            borderRadius:8, color:C.text, padding:'8px 12px',
            fontSize:14, ...MONO, outline:'none' }}/>
      </div>

      {/* Artist list */}
      <div style={{ display:'flex', flexDirection:'column' }}>
        {artists.map(([artistName, items]) => {
          const isOpen     = expanded === artistName;
          const isComplete = completion[artistName] === 100;
          const displayName = artistName.replace(/\s*\(\d+\)$/, '');

          return (
            <div key={artistName} style={{
              borderBottom: '1px solid ' + (isComplete ? '#3d3000' : C.border),
              background: isComplete
                ? (isOpen ? '#1a1200' : 'linear-gradient(90deg,#1a120088,transparent)')
                : (isOpen ? C.bg2 : 'transparent'),
            }}>
              <button onClick={() => setExpanded(e => e === artistName ? null : artistName)}
                style={{ width:'100%', background:'none', border:'none', cursor:'pointer',
                  padding:'11px 16px', display:'flex', alignItems:'center', gap:12, textAlign:'left' }}>

                {/* Avatar — Spotify/Deezer photo if available, with the
                    🏆 trophy overlaid in the corner when complete. Falls
                    back to letter circle while photos load or for artists
                    not found by either provider. */}
                <div style={{
                  position:'relative',
                  width:38, height:38, borderRadius:8, flexShrink:0,
                  overflow:'hidden',
                  background: isComplete
                    ? 'linear-gradient(135deg,#3d300088,#1a120088)'
                    : 'linear-gradient(135deg,'+C.accent+'33,'+C.bg3+')',
                  border:'1px solid ' + (isComplete ? C.gold : (isOpen ? C.accent : C.border)),
                  boxShadow: isComplete ? '0 0 12px #f5c84222' : 'none',
                }}>
                  {photos[artistName] ? (
                    <img src={photos[artistName]} alt={displayName} loading="lazy"
                      style={{ width:'100%', height:'100%', objectFit:'cover',
                        opacity: isComplete ? 0.7 : 1 }}/>
                  ) : (
                    <div style={{
                      width:'100%', height:'100%',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      ...BEBAS, fontSize:18,
                      color: isComplete ? C.gold : (isOpen ? C.accent : C.muted),
                    }}>
                      {displayName[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  {isComplete && (
                    <div style={{
                      position:'absolute', bottom:-2, right:-2,
                      width:18, height:18, borderRadius:'50%',
                      background:'#1a1200', border:'1.5px solid '+C.gold,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:10,
                    }}>🏆</div>
                  )}
                </div>

                {/* Name + info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ ...BEBAS, fontSize:16,
                      color: isComplete ? C.gold : (isOpen ? C.text : C.muted),
                      letterSpacing:'0.04em', lineHeight:1.2,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {displayName}
                    </div>
                    {isComplete && (
                      <span style={{ fontSize:9, color:C.gold, background:'#2a2000',
                        border:'1px solid #3d3000', borderRadius:4,
                        padding:'1px 6px', ...MONO, letterSpacing:'0.08em',
                        flexShrink:0 }}>
                        COMPLETE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:10, color:isComplete ? '#a08020' : C.dim, ...MONO, marginTop:1 }}>
                    {tn(items.length, 'plural.recordsInVault')}
                  </div>
                </div>

                {/* Follow button */}
                {onToggleFollow && (
                  <button
                    onClick={e => { e.stopPropagation(); onToggleFollow(artistName); }}
                    title={followedArtists.some(a => a.artist_name === artistName) ? 'Unfollow' : 'Follow — get notified of new releases'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 18, padding: '8px 6px', flexShrink: 0, lineHeight: 1,
                      color: followedArtists.some(a => a.artist_name === artistName) ? C.accent : C.ultra }}>
                    {followedArtists.some(a => a.artist_name === artistName) ? '🔔' : '🔕'}
                  </button>
                )}
                {/* Chevron */}
                <div style={{ fontSize:12, color: isComplete ? C.gold : C.dim,
                  transition:'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none',
                  flexShrink:0, padding:'8px 4px' }}>
                  ▶
                </div>
              </button>

              {/* Expanded discography */}
              {isOpen && (
                <ArtistDiscography
                  artistName={artistName}
                  collection={collection}
                  watchlist={watchlist}
                  onAddToWatchlist={onAddToWatchlist}
                  onComplete={handleComplete}
                  isFollowed={followedArtists.some(a => a.artist_name === artistName)}
                  onToggleFollow={onToggleFollow ? () => onToggleFollow(artistName) : null}
                />
              )}
            </div>
          );
        })}
      </div>

      {artists.length === 0 && search && (
        <div style={{ textAlign:'center', padding:'24px', color:C.dim, ...MONO, fontSize:12 }}>
          No artists matching "{search}"
        </div>
      )}
    </div>
  );
}
