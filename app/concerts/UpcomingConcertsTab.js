'use client';
// ── UpcomingConcertsTab — live Bandsintown data for followed artists ──
// Pulls events for user's followed_artists, optional location filter,
// shows next 90 days by default with "Show all" expansion.

import { useState, useEffect } from 'react';
import { useT, useLocale, tn } from '@/lib/i18n';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';
import Icon from '@/app/components/Icon';

const RADIUS_OPTIONS = [
  { id: 'all',  label: 'Worldwide',    km: null },
  { id: '500',  label: '500 km',       km: 500  },
  { id: '300',  label: '300 km',       km: 300  },
  { id: '100',  label: '100 km',       km: 100  },
];

// Locale-aware date formatter. Was hardcoded en-GB → "5 May 2026"
// regardless of user choice. Now follows getLocale() so PL renders
// "5 maj 2026" / DE renders "5. Mai 2026" via CLDR.
function formatEventDate(iso, locale) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function daysUntil(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return Math.ceil((d - new Date()) / 86400000);
}

export default function UpcomingConcertsTab({ user, followedArtists = [] }) {
  const t = useT();
  const locale = useLocale();
  const [events,    setEvents]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [radiusId,  setRadiusId]  = useState('all');
  const [coords,    setCoords]    = useState(null);
  const [expanded,  setExpanded]  = useState(false);
  const [meta,      setMeta]      = useState({ artistsTotal: 0 });

  // Try to get user location (only if a non-worldwide filter is selected)
  useEffect(() => {
    const opt = RADIUS_OPTIONS.find(o => o.id === radiusId);
    if (!opt?.km) { setCoords(null); return; }
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setCoords(null),
      { timeout: 5000, maximumAge: 600_000 }
    );
  }, [radiusId]);

  // Fetch events
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    if (followedArtists.length === 0) { setLoading(false); return; }

    setLoading(true);
    setError(null);

    const opt = RADIUS_OPTIONS.find(o => o.id === radiusId);
    const params = new URLSearchParams();
    if (opt?.km && coords) {
      params.set('lat', String(coords.lat));
      params.set('lng', String(coords.lng));
      params.set('radius_km', String(opt.km));
    }

    fetch('/api/concerts?' + params.toString())
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setEvents([]); }
        else { setEvents(d.events || []); setMeta({ artistsTotal: d.artistsTotal || 0 }); }
      })
      .catch(e => { setError(e.message); setEvents([]); })
      .finally(() => setLoading(false));
  }, [user, followedArtists.length, radiusId, coords]);

  // Filter to next 90 days unless expanded
  const visible = expanded
    ? events
    : events.filter(e => {
        const d = daysUntil(e.datetime);
        return d != null && d >= 0 && d <= 90;
      });

  // ── Empty states ──
  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 24px' }}>
        <Icon name="user" size={36} color={C.dim}/>
        <div style={{ fontSize: 14, color: C.muted, ...MONO, marginTop: 12 }}>
          {t('upcoming.empty.desc')}
        </div>
      </div>
    );
  }

  if (followedArtists.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '50px 24px' }}>
        <Icon name="music" size={36} color={C.dim}/>
        <div style={{ ...BEBAS, fontSize: 18, color: C.text, letterSpacing: '0.04em', marginTop: 14 }}>
          No followed artists yet
        </div>
        <div style={{ fontSize: 12, color: C.muted, ...MONO, marginTop: 6, lineHeight: 1.5, maxWidth: 280, margin: '6px auto 0' }}>
          Follow artists from album cards in the Feed to see their upcoming concerts here.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Radius filter pills */}
      <div style={{ display: 'flex', gap: 6, padding: '12px 16px 8px', overflow: 'auto' }}>
        {RADIUS_OPTIONS.map(o => {
          const active = radiusId === o.id;
          return (
            <button key={o.id} onClick={() => setRadiusId(o.id)}
              style={{
                padding: '6px 12px', borderRadius: 20,
                background: active ? C.accent + '22' : C.bg3,
                border: '1px solid ' + (active ? C.accent + '66' : C.border),
                color: active ? C.accent : C.dim,
                cursor: 'pointer', fontSize: 11, ...MONO, whiteSpace: 'nowrap',
              }}>
              {o.label}
            </button>
          );
        })}
      </div>

      {/* Geolocation hint when filter active but no coords */}
      {radiusId !== 'all' && !coords && !loading && (
        <div style={{
          margin: '0 16px 8px', padding: '8px 12px',
          background: '#1a1500', border: '1px solid #5a4a00', borderRadius: 8,
          fontSize: 11, color: '#fbbf24', ...MONO, lineHeight: 1.5,
        }}>
          Location permission needed to filter by distance — showing worldwide for now.
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: C.dim, ...MONO, fontSize: 12 }}>
          <div style={{ ...BEBAS, fontSize: 14, marginBottom: 4 }}>Searching tour dates…</div>
          <div style={{ fontSize: 10 }}>Querying {tn(followedArtists.length, 'plural.artists')}</div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{
          margin: '0 16px', padding: '12px 14px',
          background: '#1a0000', border: '1px solid #7f1d1d', borderRadius: 8,
          color: '#f87171', fontSize: 12, ...MONO,
        }}>
          {error.includes('no_app_id')
            ? 'Concert lookup not configured (TICKETMASTER_API_KEY missing).'
            : 'Could not load concerts: ' + error}
        </div>
      )}

      {/* Empty result */}
      {!loading && !error && events.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 24px', color: C.dim, ...MONO, fontSize: 12 }}>
          <div style={{ ...BEBAS, fontSize: 16, color: C.muted, letterSpacing: '0.04em', marginBottom: 6 }}>
            No upcoming dates
          </div>
          None of your {meta.artistsTotal || followedArtists.length} followed artists have announced shows yet.
        </div>
      )}

      {/* Result count + expand toggle */}
      {!loading && events.length > 0 && (
        <div style={{
          padding: '4px 16px 10px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 10, color: C.dim, ...MONO }}>
            {tn(visible.length, 'plural.shows')}
            {!expanded && events.length > visible.length && ' · next 90 days'}
          </div>
          {events.length > visible.length && (
            <button onClick={() => setExpanded(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: C.accent, fontSize: 10, ...MONO,
              }}>
              SHOW ALL {events.length} →
            </button>
          )}
          {expanded && (
            <button onClick={() => setExpanded(false)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: C.dim, fontSize: 10, ...MONO,
              }}>
              ← UPCOMING ONLY
            </button>
          )}
        </div>
      )}

      {/* Event list */}
      {!loading && visible.length > 0 && (
        <div style={{ padding: '0 16px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map(ev => (
            <EventCard key={ev.id + '_' + ev.artist} ev={ev} locale={locale}/>
          ))}
        </div>
      )}

      {/* Missing bands — followed artists with no Ticketmaster events.
          Niche metal bands often aren't in Ticketmaster's database (they
          favor mainstream tours). For these we offer a deep-link to
          Bandsintown which has stronger underground/indie coverage. */}
      {!loading && !error && followedArtists.length > 0 && (() => {
        // followedArtists may be either string[] or { artist_name }[] depending on caller.
        // Normalize to plain string array first to avoid .toLowerCase on objects.
        const normalizedNames = followedArtists
          .map(a => typeof a === 'string' ? a : a?.artist_name)
          .filter(Boolean);

        const bandsWithEvents = new Set(events.map(ev => (ev.artist || '').toLowerCase()));
        const missing = normalizedNames
          .filter(name => !bandsWithEvents.has(name.toLowerCase()))
          .sort((a, b) => a.localeCompare(b));

        if (missing.length === 0) return null;

        return (
          <div style={{
            margin: '0 16px 24px', padding: '14px 16px',
            background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12,
          }}>
            <div style={{
              fontSize: 10, color: C.muted, ...MONO, letterSpacing: '0.12em',
              textTransform: 'uppercase', marginBottom: 4,
            }}>
              <Icon name="info" size={11} color={C.muted}/> {tn(missing.length, 'plural.bandsWithoutTm')}
            </div>
            <div style={{ fontSize: 11, color: C.dim, ...MONO, marginBottom: 10, lineHeight: 1.5 }}>
              These bands aren&apos;t in Ticketmaster&apos;s database. Check Bandsintown — they often have indie/underground coverage.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {missing.map(name => (
                <a key={name}
                  href={'https://www.bandsintown.com/a/' + encodeURIComponent(name)}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    fontSize: 11, ...MONO,
                    padding: '6px 10px', borderRadius: 6,
                    background: C.bg3, border: '1px solid ' + C.border,
                    color: C.text, textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    transition: 'all 150ms',
                  }}>
                  <span style={{ color: C.muted, fontSize: 10 }}>🎫</span>
                  {name}
                </a>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function EventCard({ ev, locale }) {
  const days = daysUntil(ev.datetime);
  const isSoon  = days != null && days <= 14;
  const isToday = days === 0;

  // Guard the href — if Ticketmaster returned a junk/empty URL despite
  // the buildTicketsUrl fallback chain, render the card as a non-clickable
  // div instead of an <a> with `href=""` (which would reload the SPA and
  // 404 against /vault/<currentPath>).
  const safeUrl = (ev.ticketsUrl && /^https?:\/\//.test(ev.ticketsUrl)) ? ev.ticketsUrl : null;
  const Wrapper = safeUrl ? 'a' : 'div';
  const wrapperProps = safeUrl
    ? { href: safeUrl, target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <Wrapper {...wrapperProps}
      style={{
        background: C.bg2, border: '1px solid ' + C.border, borderRadius: 10,
        padding: '12px 14px', textDecoration: 'none',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
      {/* Top row: artist + date badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...BEBAS, fontSize: 16, color: C.text, letterSpacing: '0.04em', lineHeight: 1.1 }}>
            {ev.artist}
          </div>
          <div style={{ fontSize: 11, color: C.muted, ...MONO, marginTop: 3 }}>
            {ev.venue}
          </div>
        </div>
        <div style={{
          textAlign: 'right', flexShrink: 0,
          background: isSoon ? '#1a0500' : C.bg3,
          border: '1px solid ' + (isSoon ? C.accent + '66' : C.border),
          borderRadius: 8, padding: '6px 10px',
          minWidth: 80,
        }}>
          <div style={{ ...BEBAS, fontSize: 14, color: isSoon ? C.accent : C.text, lineHeight: 1, letterSpacing: '0.02em' }}>
            {formatEventDate(ev.datetime, locale)}
          </div>
          {days != null && days >= 0 && (
            <div style={{ fontSize: 9, color: isSoon ? C.accent : C.dim, ...MONO, marginTop: 2 }}>
              {isToday ? 'TODAY' : days === 1 ? 'TOMORROW' : 'IN ' + days + 'D'}
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: location + lineup hint */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.dim, ...MONO, minWidth: 0 }}>
          <Icon name="location" size={10} color={C.dim}/>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[ev.city, ev.region, ev.country].filter(Boolean).join(', ')}
          </span>
        </div>
        {ev.ticketsUrl && (
          <div style={{ fontSize: 9, color: C.accent, ...MONO, letterSpacing: '0.1em', flexShrink: 0 }}>
            TICKETS →
          </div>
        )}
      </div>

      {/* Lineup if more than 1 act */}
      {ev.lineup && ev.lineup.length > 1 && (
        <div style={{ fontSize: 9, color: C.dim, ...MONO, lineHeight: 1.4 }}>
          With: {ev.lineup.filter(a => a !== ev.artist).slice(0, 4).join(' · ')}
          {ev.lineup.length > 5 ? ' · +' + (ev.lineup.length - 5) : ''}
        </div>
      )}
    </Wrapper>
  );
}
