'use client';
// ── SearchTab — multi-source search ────────────────────────────
// Calls our server-side /api/search proxy which aggregates:
//   • Discogs (authenticated — gives us covers + format + year)
//   • MusicBrainz (artists with type Group/Person)
//   • MusicBrainz members → bands (when search resolves a Person)
//
// Layout: three stacked sections (Albums / Artists / People). Each section
// renders only when it has hits. The People section expands to show all
// bands a member played in (lazy /api/artists/related call).
//
// Opening an artist (band or band-of-a-member) shows an inline ArtistModal
// loading /api/artists/related — bio + members + similar. Self-contained so
// the parent page.js doesn't need a "selected artist" state.
import { useState, useRef, useCallback, useEffect } from 'react';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';
import { useT, useLocale } from '@/lib/i18n';
import { useBackButton } from '@/lib/hooks/useBackButton';

// ── AlbumCover — placeholder + img with onError fallback ──────
function AlbumCover({ src, artist, size = 56 }) {
  const [err, setErr] = useState(false);
  if (!src || err) return (
    <div style={{ width:size, height:size, borderRadius:6, flexShrink:0,
      background:'linear-gradient(135deg,#1a0000,#0a0a0a)',
      display:'flex', alignItems:'center', justifyContent:'center',
      border:`1px solid ${C.border}` }}>
      <span style={{ ...BEBAS, fontSize:Math.round(size*0.45), color:'#ffffff33' }}>
        {(artist||'?')[0].toUpperCase()}
      </span>
    </div>
  );
  return (
    <div style={{ width:size, height:size, borderRadius:6, flexShrink:0,
      overflow:'hidden', border:`1px solid ${C.border}` }}>
      <img src={src} alt={artist} loading="lazy" onError={()=>setErr(true)}
        style={{ width:'100%', height:'100%', objectFit:'cover' }} />
    </div>
  );
}

// ── ResultCard — album row with expandable Discogs variants ──
function ResultCard({ item, onWatch, onAddCollection, isWatched, inCollection }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [vinylData, setVinylData] = useState(null);
  const [vinylLoading, setVinylLoading] = useState(false);

  const loadVinyl = async () => {
    if (vinylData || vinylLoading) { setExpanded(e=>!e); return; }
    setExpanded(true);
    setVinylLoading(true);
    try {
      const params = new URLSearchParams({ artist: item.artist, album: item.album });
      const r = await fetch(`/api/discogs?${params}`);
      const d = await r.json();
      setVinylData(d);
    } catch {}
    setVinylLoading(false);
  };

  return (
    <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden' }}>
      {/* Main row */}
      <div style={{ display:'flex', gap:12, padding:'12px 14px', alignItems:'flex-start' }}>
        <AlbumCover src={item.cover} artist={item.artist} size={56} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ ...BEBAS, fontSize:18, color:C.text, lineHeight:1,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {item.artist}
          </div>
          <div style={{ fontSize:12, color:C.muted, ...MONO, marginTop:2,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {item.album}
          </div>
          <div style={{ display:'flex', gap:8, marginTop:5, flexWrap:'wrap', alignItems:'center' }}>
            {item.year && <span style={{ fontSize:10, color:C.dim, ...MONO }}>{item.year}</span>}
            {item.format && <span style={{ fontSize:10, color:C.dim, ...MONO,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:140 }}>{item.format}</span>}
            {item.source === 'discogs' && (
              <span style={{ fontSize:9, padding:'1px 6px', borderRadius:10,
                background:'#1a1a2e', color:'#60a5fa', border:'1px solid #1e3a8a', ...MONO }}>
                Discogs
              </span>
            )}
            {item.coverFallback === 'caa' && (
              <span style={{ fontSize:9, padding:'1px 6px', borderRadius:10,
                background:'#0d1f1a', color:'#00b896', border:'1px solid #1a3d3a', ...MONO }}
                title="Cover sourced from Cover Art Archive">
                CAA
              </span>
            )}
          </div>
        </div>
        {/* Action buttons */}
        <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
          <button onClick={() => onWatch(item)}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:20,
              color:isWatched?'#f5c842':'#444', padding:'2px' }}
            title={isWatched?t('search.inWatchlist'):t('search.addToWatch')}>
            {isWatched ? '★' : '☆'}
          </button>
          <button onClick={loadVinyl}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:16,
              color:expanded?C.accent:'#444', padding:'2px' }}
            title={t('search.viewVinyl')}>
            💿
          </button>
        </div>
      </div>

      {/* Vinyl variants panel */}
      {expanded && (
        <div style={{ borderTop:`1px solid ${C.border}`, padding:'12px 14px' }}>
          {vinylLoading && (
            <div style={{ textAlign:'center', color:C.dim, ...MONO, fontSize:11, padding:'8px 0' }}>
              ⟳ {t('search.loadingVariants')}
            </div>
          )}
          {!vinylLoading && vinylData?.variants?.length === 0 && (
            <div style={{ color:C.dim, ...MONO, fontSize:11 }}>{t('search.noVariants')}</div>
          )}
          {!vinylLoading && vinylData?.variants?.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.15em',
                textTransform:'uppercase', marginBottom:4 }}>
                {t('search.variantCount', { n: vinylData.count })}
                {vinylData.hasLimited && ' · 💎 ' + t('search.limitedAvailable')}
              </div>
              {vinylData.variants.slice(0,4).map(v => (
                <div key={v.id} style={{ background:C.bg3, borderRadius:8, padding:'10px 12px',
                  display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, color:C.text, ...MONO,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {v.title}
                    </div>
                    <div style={{ display:'flex', gap:6, marginTop:4, flexWrap:'wrap' }}>
                      {v.format && <span style={{ fontSize:9, color:C.dim, ...MONO }}>{v.format}</span>}
                      {v.country && <span style={{ fontSize:9, color:C.dim, ...MONO }}>{v.country}</span>}
                      {v.isLimited && (
                        <span style={{ fontSize:9, padding:'1px 6px', borderRadius:8,
                          background:'#2a1800', color:'#f5c842', border:'1px solid #92400e', ...MONO }}>
                          💎 LIMITED
                        </span>
                      )}
                      {v.color && <span style={{ fontSize:9, color:'#aaa', ...MONO }}>🎨 {v.color}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    {v.lowestPrice && (
                      <div style={{ ...BEBAS, fontSize:18, color:'#4ade80', lineHeight:1 }}>
                        ${v.lowestPrice.toFixed(0)}
                      </div>
                    )}
                    <a href={v.discogsUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize:9, color:C.dim, ...MONO, textDecoration:'none' }}>
                      Discogs →
                    </a>
                  </div>
                </div>
              ))}
              {!inCollection && (
                <button onClick={() => onAddCollection({
                    discogs_id: vinylData.bestMatch?.id,
                    artist: item.artist, album: item.album,
                    cover: item.cover, format: vinylData.bestMatch?.format,
                  })}
                  style={{ padding:'9px', background:'#001a00', border:'1px solid #166534',
                    borderRadius:8, color:'#4ade80', cursor:'pointer', fontSize:12, ...MONO }}>
                  + {t('vinyl.addVaultBtn').replace(/^\+\s*/, '').replace('Vault', 'Collection')}
                </button>
              )}
              {inCollection && (
                <div style={{ fontSize:11, color:'#4ade80', ...MONO, textAlign:'center' }}>✓ {t('search.inCollection')}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ArtistCard — links to BandsTab via mv:open-artist event ──
// We don't navigate directly — the parent listens for this event and opens
// the artist page within the SPA shell. Avoids hard refreshes.
function ArtistCard({ item }) {
  const t = useT();
  const open = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mv:open-artist', {
        detail: { name: item.name, mbid: item.mbid },
      }));
    }
  };
  return (
    <div onClick={open}
      style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12,
        padding:'12px 14px', cursor:'pointer', display:'flex', gap:12, alignItems:'center' }}>
      <div style={{ width:44, height:44, borderRadius:'50%', flexShrink:0,
        background:'linear-gradient(135deg,#1a0a0a,#0a0a0a)',
        border:`1px solid ${C.border}`,
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <span style={{ ...BEBAS, fontSize:20, color:C.accent }}>
          {item.name[0]?.toUpperCase()}
        </span>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ ...BEBAS, fontSize:16, color:C.text, lineHeight:1.1,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {item.name}
        </div>
        <div style={{ display:'flex', gap:6, marginTop:3, flexWrap:'wrap' }}>
          {item.type && <span style={{ fontSize:9, color:C.dim, ...MONO }}>{item.type}</span>}
          {item.country && <span style={{ fontSize:9, color:C.dim, ...MONO }}>· {item.country}</span>}
          {item.lifeSpan?.begin && (
            <span style={{ fontSize:9, color:C.dim, ...MONO }}>
              · {item.lifeSpan.begin.split('-')[0]}{item.lifeSpan.ended && item.lifeSpan.end ? '–' + item.lifeSpan.end.split('-')[0] : '–'}
            </span>
          )}
        </div>
        {item.disambiguation && (
          <div style={{ fontSize:10, color:C.muted, ...MONO, marginTop:2,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {item.disambiguation}
          </div>
        )}
        {item.tags?.length > 0 && (
          <div style={{ display:'flex', gap:4, marginTop:4, flexWrap:'wrap' }}>
            {item.tags.slice(0, 3).map(tag => (
              <span key={tag} style={{ fontSize:9, padding:'1px 6px', borderRadius:10,
                background:C.bg3, color:C.muted, ...MONO }}>{tag}</span>
            ))}
          </div>
        )}
      </div>
      <div style={{ ...BEBAS, fontSize:11, color:C.accent, letterSpacing:'0.08em', flexShrink:0 }}>
        {t('search.openArtist')} →
      </div>
    </div>
  );
}

// ── MemberCard — person + their bands (eagerly inline, lazy on expand) ──
function MemberCard({ item }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [allBands, setAllBands] = useState(null);
  const [loading, setLoading]   = useState(false);

  const loadAllBands = async () => {
    if (allBands || loading) { setExpanded(e => !e); return; }
    setLoading(true);
    setExpanded(true);
    try {
      const r = await fetch(`/api/artists/related?name=${encodeURIComponent(item.name)}&mbid=${encodeURIComponent(item.mbid || '')}`);
      const d = await r.json();
      setAllBands(d.sideProjects || []);
    } catch {}
    setLoading(false);
  };

  const openArtist = (band) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mv:open-artist', {
        detail: { name: band.name, mbid: band.mbid },
      }));
    }
  };

  const bandsToShow = allBands || item.previewBands || [];

  return (
    <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden' }}>
      <div style={{ display:'flex', gap:12, padding:'12px 14px', alignItems:'flex-start' }}>
        <div style={{ width:44, height:44, borderRadius:'50%', flexShrink:0,
          background:'#1a0a0a', border:`1px solid ${C.accent}44`,
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ ...BEBAS, fontSize:20, color:C.gold }}>
            {item.name[0]?.toUpperCase()}
          </span>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ ...BEBAS, fontSize:16, color:C.text, lineHeight:1.1,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {item.name}
          </div>
          <div style={{ display:'flex', gap:6, marginTop:3, flexWrap:'wrap' }}>
            <span style={{ fontSize:9, padding:'1px 6px', borderRadius:10,
              background:'#1a0500', color:C.gold, border:`1px solid ${C.gold}44`, ...MONO,
              letterSpacing:'0.05em', textTransform:'uppercase' }}>
              {t('search.person')}
            </span>
            {item.country && <span style={{ fontSize:9, color:C.dim, ...MONO }}>{item.country}</span>}
            {item.bandCount != null && (
              <span style={{ fontSize:9, color:C.muted, ...MONO }}>
                · {t('search.bandCount', { n: item.bandCount })}
              </span>
            )}
          </div>
          {item.disambiguation && (
            <div style={{ fontSize:10, color:C.muted, ...MONO, marginTop:2 }}>
              {item.disambiguation}
            </div>
          )}
        </div>
        <button onClick={loadAllBands}
          style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6,
            color:C.accent, cursor:'pointer', padding:'5px 9px', fontSize:11, ...MONO,
            flexShrink:0, alignSelf:'center' }}>
          {expanded ? '▴' : '▾'}
        </button>
      </div>

      {/* Bands strip */}
      {bandsToShow.length > 0 && (
        <div style={{ borderTop:`1px solid ${C.border}`, padding:'10px 14px',
          background:C.bg3 }}>
          <div style={{ fontSize:9, color:C.dim, ...MONO, letterSpacing:'0.15em',
            textTransform:'uppercase', marginBottom:8 }}>
            {expanded ? t('search.allBands') : t('search.someBands')}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {bandsToShow.map(band => (
              <div key={band.mbid || band.name}
                onClick={() => openArtist(band)}
                style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px',
                  background:C.bg2, border:`1px solid ${C.border}`, borderRadius:7,
                  cursor:'pointer' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, color:C.text, ...MONO, fontWeight:600,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {band.name}
                  </div>
                  <div style={{ fontSize:9, color:C.dim, ...MONO, marginTop:1,
                    display:'flex', gap:6, flexWrap:'wrap' }}>
                    {band.roles?.length > 0 && (
                      <span style={{ color: band.active ? C.green : C.muted }}>
                        {band.roles.join(', ')}
                      </span>
                    )}
                    {band.begin && (
                      <span>· {band.begin.split('-')[0]}{band.end ? '–' + band.end.split('-')[0] : (band.active ? '–now' : '')}</span>
                    )}
                    {!band.active && (
                      <span style={{ color:C.muted }}>· {t('search.exMember')}</span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize:14, color:C.accent }}>›</span>
              </div>
            ))}
          </div>
          {loading && (
            <div style={{ textAlign:'center', color:C.dim, ...MONO, fontSize:10, padding:'6px 0' }}>
              ⟳ {t('common.loading')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ArtistModal — bio + members + sideProjects + similar ─────
// Loaded lazily when user opens an artist card. Calls /api/artists/related
// which aggregates MusicBrainz + Last.fm. Section visibility is data-driven —
// e.g. a Person has no `members`, a band has no `sideProjects`.
function ArtistModal({ artist, onClose }) {
  const t = useT();
  const locale = useLocale();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [showFullBio, setShowFullBio] = useState(false);
  useBackButton(true, onClose);

  useEffect(() => {
    if (!artist) return;
    setLoading(true); setData(null);
    const params = new URLSearchParams({
      name: artist.name,
      lang: locale,
      ...(artist.mbid ? { mbid: artist.mbid } : {}),
    });
    fetch(`/api/artists/related?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [artist, locale]);

  if (!artist) return null;

  const openOther = (other) => {
    // Replace current modal with a new artist — push, not stack.
    window.dispatchEvent(new CustomEvent('mv:open-artist', {
      detail: { name: other.name, mbid: other.mbid },
    }));
  };

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:200, background:'rgba(0,0,0,0.85)',
        display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:C.bg, width:'100%', maxWidth:480, maxHeight:'92vh',
          borderRadius:'16px 16px 0 0', overflowY:'auto', overflowX:'hidden',
          border:`1px solid ${C.border}`, paddingBottom:24 }}>

        {/* Sticky header */}
        <div style={{ position:'sticky', top:0, zIndex:1, background:C.bg,
          borderBottom:`1px solid ${C.border}`, padding:'14px 16px',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ ...BEBAS, fontSize:22, color:C.text, letterSpacing:'0.04em',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {data?.artist || artist.name}
            </div>
            <div style={{ display:'flex', gap:6, marginTop:2, flexWrap:'wrap' }}>
              {data?.type && <span style={{ fontSize:10, color:C.dim, ...MONO }}>{data.type}</span>}
              {data?.country && <span style={{ fontSize:10, color:C.dim, ...MONO }}>· {data.country}</span>}
              {data?.lifeSpan?.begin && (
                <span style={{ fontSize:10, color:C.dim, ...MONO }}>
                  · {data.lifeSpan.begin.split('-')[0]}{data.lifeSpan.ended && data.lifeSpan.end ? '–' + data.lifeSpan.end.split('-')[0] : '–'}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose}
            style={{ width:32, height:32, borderRadius:'50%', border:`1px solid ${C.border}`,
              background:'rgba(0,0,0,0.4)', color:'#fff', cursor:'pointer',
              fontSize:18, lineHeight:1, padding:0, flexShrink:0 }}>
            ×
          </button>
        </div>

        {loading && (
          <div style={{ textAlign:'center', padding:'40px 16px', color:C.dim, ...MONO, fontSize:11 }}>
            ⟳ {t('common.loading')}
          </div>
        )}

        {!loading && data && (
          <>
            {/* Tags */}
            {data.tags?.length > 0 && (
              <div style={{ padding:'10px 16px', display:'flex', flexWrap:'wrap', gap:5 }}>
                {data.tags.map(tag => (
                  <span key={tag} style={{ fontSize:10, padding:'2px 8px', borderRadius:11,
                    background:C.bg2, color:C.muted, border:`1px solid ${C.border}`,
                    ...MONO }}>{tag}</span>
                ))}
              </div>
            )}

            {/* Bio */}
            {data.bio?.summary && (
              <div style={{ padding:'4px 16px 12px' }}>
                <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
                  textTransform:'uppercase', marginBottom:6 }}>
                  {t('artist.bio')}
                </div>
                <div style={{ fontSize:12, color:C.text, lineHeight:1.6, ...MONO }}
                  // Server already sanitized — strip is in lastfm.js
                  >
                  {showFullBio ? data.bio.full : data.bio.summary}
                </div>
                {data.bio.full && data.bio.full !== data.bio.summary && (
                  <button onClick={() => setShowFullBio(b => !b)}
                    style={{ marginTop:6, background:'none', border:'none', color:C.accent,
                      cursor:'pointer', fontSize:10, ...MONO, padding:0 }}>
                    {showFullBio ? t('artist.bioLess') : t('artist.bioMore')}
                  </button>
                )}
              </div>
            )}

            {/* Stats */}
            {data.stats?.listeners > 0 && (
              <div style={{ padding:'0 16px 12px', display:'flex', gap:14 }}>
                <div>
                  <div style={{ fontSize:9, color:C.dim, ...MONO, letterSpacing:'0.1em',
                    textTransform:'uppercase' }}>
                    {t('artist.listeners')}
                  </div>
                  <div style={{ ...BEBAS, fontSize:18, color:C.text }}>
                    {data.stats.listeners.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:9, color:C.dim, ...MONO, letterSpacing:'0.1em',
                    textTransform:'uppercase' }}>
                    {t('artist.scrobbles')}
                  </div>
                  <div style={{ ...BEBAS, fontSize:18, color:C.text }}>
                    {(data.stats.playcount / 1000000).toFixed(1)}M
                  </div>
                </div>
              </div>
            )}

            {/* Members (if Group) */}
            {data.members?.length > 0 && (
              <ArtistSection title={t('artist.members')} items={data.members} onPick={openOther}/>
            )}
            {data.exMembers?.length > 0 && (
              <ArtistSection title={t('artist.exMembers')} items={data.exMembers} onPick={openOther}/>
            )}

            {/* Side projects (if Person) */}
            {data.sideProjects?.length > 0 && (
              <ArtistSection title={t('artist.bandsPlayedIn')} items={data.sideProjects} onPick={openOther}/>
            )}

            {/* Similar */}
            {data.similar?.length > 0 && (
              <ArtistSection title={t('artist.similar')} items={data.similar.map(s => ({
                ...s, type: null, mbid: s.mbid, similarMatch: s.match,
              }))} onPick={openOther}/>
            )}

            {/* External links */}
            {data.urls && Object.keys(data.urls).length > 0 && (
              <div style={{ padding:'10px 16px' }}>
                <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
                  textTransform:'uppercase', marginBottom:6 }}>
                  {t('artist.links')}
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {Object.entries(data.urls).slice(0, 6).map(([type, url]) => (
                    <a key={type} href={url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize:10, padding:'5px 10px', borderRadius:7,
                        background:C.bg2, border:`1px solid ${C.border}`,
                        color:C.muted, textDecoration:'none', ...MONO,
                        textTransform:'capitalize' }}>
                      {type.replace(/_/g, ' ')} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Attribution */}
            <div style={{ textAlign:'center', padding:'16px 16px 0',
              fontSize:8, color:C.dim, ...MONO, opacity:0.5 }}>
              {data.lastfmConfigured ? t('artist.poweredBy') : t('artist.poweredByMbOnly')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── ArtistSection — labeled list of related artists ───────────
function ArtistSection({ title, items, onPick }) {
  return (
    <div style={{ padding:'10px 16px 4px' }}>
      <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
        textTransform:'uppercase', marginBottom:6 }}>
        {title}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        {items.slice(0, 12).map(item => (
          <div key={item.mbid || item.name}
            onClick={() => onPick(item)}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 9px',
              background:C.bg2, border:`1px solid ${C.border}`, borderRadius:7,
              cursor:'pointer' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, color:C.text, ...MONO, fontWeight:600,
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {item.name}
              </div>
              <div style={{ fontSize:9, color:C.dim, ...MONO, marginTop:1,
                display:'flex', gap:6, flexWrap:'wrap' }}>
                {item.roles?.length > 0 && (
                  <span style={{ color: item.active ? C.green : C.muted }}>
                    {item.roles.join(', ')}
                  </span>
                )}
                {item.begin && (
                  <span>{item.roles?.length > 0 ? '· ' : ''}{item.begin.split('-')[0]}{item.end ? '–' + item.end.split('-')[0] : ''}</span>
                )}
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

// ── SectionHeader — small uppercase divider above each section ──
function SectionHeader({ label, count }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
      margin:'14px 16px 8px' }}>
      <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.18em',
        textTransform:'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize:9, color:C.dim, ...MONO }}>{count}</div>
    </div>
  );
}

export default function SearchTab({ onWatch, onAddCollection, watchlist, collection }) {
  const t = useT();
  const [query,    setQuery]    = useState('');
  const [albums,   setAlbums]   = useState([]);
  const [artists,  setArtists]  = useState([]);
  const [members,  setMembers]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [searched, setSearched] = useState(false);
  const [openArtist, setOpenArtist] = useState(null);   // ArtistModal target
  const timer = useRef(null);

  // Global event so any tab can open the artist modal — we listen here since
  // SearchTab owns the modal. Other tabs (BandsTab, MemberCard) just
  // dispatch the event with { name, mbid }.
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail;
      if (!d?.name) return;
      setOpenArtist({ name: d.name, mbid: d.mbid || null });
    };
    window.addEventListener('mv:open-artist', handler);
    return () => window.removeEventListener('mv:open-artist', handler);
  }, []);

  const search = useCallback(async (q) => {
    if (!q.trim()) {
      setAlbums([]); setArtists([]); setMembers([]); setSearched(false);
      return;
    }
    setLoading(true); setError(''); setSearched(true);
    try {
      // Server-side aggregator. type=auto → albums + artists + members in one call.
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=auto`);
      if (!res.ok) throw new Error(t('search.failed'));
      const d = await res.json();
      setAlbums(d.albums || []);
      setArtists(d.artists || []);
      setMembers(d.members || []);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [t]);

  const handleInput = (v) => {
    setQuery(v);
    clearTimeout(timer.current);
    if (v.length >= 2) {
      // Slightly longer debounce — server hits MB which is 1 req/sec.
      timer.current = setTimeout(() => search(v), 700);
    } else {
      setAlbums([]); setArtists([]); setMembers([]); setSearched(false);
    }
  };

  const isWatched    = (id) => watchlist.some(w => (w.album_id||w.id) === String(id));
  const inCollection = (id) => collection.some(c => c.discogs_id === id);

  const totalHits = albums.length + artists.length + members.length;

  return (
    <div style={{ padding:'0 0 16px' }}>
      {/* Header */}
      <div style={{ padding:'16px 16px 12px' }}>
        <div style={{ ...BEBAS, fontSize:28, color:C.text, letterSpacing:'0.06em', lineHeight:1 }}>
          {t('search.title').toUpperCase()}
        </div>
        <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.2em', marginTop:2 }}>
          {t('search.subtitle')}
        </div>
      </div>

      {/* Search input */}
      <div style={{ padding:'0 16px 12px' }}>
        <div style={{ position:'relative' }}>
          <input
            value={query}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search(query)}
            placeholder={t('search.placeholder')}
            style={inputSt}
            autoComplete="off"
            autoCapitalize="off"
          />
          {loading && (
            <div style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
              color:C.dim, fontSize:14 }}>⟳</div>
          )}
          {query && !loading && (
            <button onClick={() => { setQuery(''); setAlbums([]); setArtists([]); setMembers([]); setSearched(false); }}
              style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:18 }}>
              ×
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ margin:'0 16px 12px', background:'#1a0000', border:`1px solid ${C.accent}44`,
          borderRadius:8, padding:'10px 12px', color:'#f87171', fontSize:12, ...MONO }}>
          ⚠ {error}
        </div>
      )}

      {/* Empty state — pre-search hint listing what we search */}
      {!searched && !loading && (
        <div style={{ textAlign:'center', padding:'50px 24px', color:C.dim, ...MONO }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
          <div style={{ fontSize:13, lineHeight:1.7 }}>
            {t('search.placeholder')}<br/>
            <span style={{ fontSize:11, color:'#444' }}>
              {t('search.providers')}
            </span>
          </div>
        </div>
      )}

      {/* No results */}
      {searched && !loading && totalHits === 0 && !error && (
        <div style={{ textAlign:'center', padding:'40px 24px', color:C.dim, ...MONO }}>
          <div style={{ fontSize:32, marginBottom:10 }}>🤷</div>
          <div style={{ fontSize:12 }}>{t('search.empty')} — "{query}"</div>
        </div>
      )}

      {/* People (members) — shown FIRST when present, since it's the rarest hit
         and most surprising — user typed a name that turned out to be a person */}
      {members.length > 0 && (
        <>
          <SectionHeader label={t('search.peopleHeader')} count={members.length}/>
          <div style={{ padding:'0 16px', display:'flex', flexDirection:'column', gap:8 }}>
            {members.map(m => <MemberCard key={m.mbid} item={m}/>)}
          </div>
        </>
      )}

      {/* Artists / bands */}
      {artists.length > 0 && (
        <>
          <SectionHeader label={t('search.artistsHeader')} count={artists.length}/>
          <div style={{ padding:'0 16px', display:'flex', flexDirection:'column', gap:8 }}>
            {artists.map(a => <ArtistCard key={a.mbid} item={a}/>)}
          </div>
        </>
      )}

      {/* Albums */}
      {albums.length > 0 && (
        <>
          <SectionHeader label={t('search.albumsHeader')} count={albums.length}/>
          <div style={{ padding:'0 16px', display:'flex', flexDirection:'column', gap:8 }}>
            {albums.map(item => (
              <ResultCard
                key={item.id}
                item={item}
                onWatch={onWatch}
                onAddCollection={onAddCollection}
                isWatched={isWatched(item.id)}
                inCollection={inCollection(item.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Attribution footer when search was used */}
      {searched && !loading && totalHits > 0 && (
        <div style={{ padding:'14px 16px 0', textAlign:'center',
          fontSize:9, color:C.dim, ...MONO, opacity:0.6 }}>
          {t('search.poweredBy')}
        </div>
      )}

      {/* Artist info modal — bio + members + similar */}
      {openArtist && (
        <ArtistModal artist={openArtist} onClose={() => setOpenArtist(null)}/>
      )}
    </div>
  );
}
