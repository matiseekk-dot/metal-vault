'use client';
// ── MarketComparison — read-only price comparison across marketplaces ──
// Display-only: shows lowest active listings on Discogs / eBay / Allegro,
// each with a click-out link to the source. Never recommends transactions.
//
// eBay compliance: this is "Public Display" per eBay API License — we
// surface eBay listings to drive traffic TO eBay, not to model prices
// or facilitate seller arbitrage.
//
// Affiliate: eBay Partner Network commission is automatic when we use
// the itemAffiliateWebUrl returned by the API (set EBAY_EPN_CAMPAIGN_ID).

import { useState, useEffect } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import Icon from '@/app/components/Icon';

export default function MarketComparison({ artist, album, format, discogsLowest }) {
  const [ebay,     setEbay]    = useState({ loading: true, listings: [] });
  const [concert,  setConcert] = useState({ loading: true, next: null });
  // Allegro is intentionally a manual deep-link search — we don't have API
  // access for solo devs. User clicks → lands on Allegro search page.

  useEffect(() => {
    let cancelled = false;
    if (!artist || !album) return;

    (async () => {
      try {
        const url = '/api/listings/ebay'
          + '?artist=' + encodeURIComponent(artist)
          + '&album='  + encodeURIComponent(album)
          + (format ? '&format=' + encodeURIComponent(format) : '');
        const r = await fetch(url);
        const d = await r.json();
        if (!cancelled) setEbay({ loading: false, listings: d.listings || [] });
      } catch {
        if (!cancelled) setEbay({ loading: false, listings: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [artist, album, format]);

  // Bandsintown: closest upcoming concert for this artist (single-artist mode)
  useEffect(() => {
    let cancelled = false;
    if (!artist) return;
    (async () => {
      try {
        const r = await fetch('/api/concerts?artist=' + encodeURIComponent(artist));
        const d = await r.json();
        const events = d.events || [];
        // Pick closest upcoming
        const now = Date.now();
        const upcoming = events
          .filter(e => new Date(e.datetime).getTime() > now)
          .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
        if (!cancelled) setConcert({ loading: false, next: upcoming[0] || null });
      } catch {
        if (!cancelled) setConcert({ loading: false, next: null });
      }
    })();
    return () => { cancelled = true; };
  }, [artist]);

  // Allegro deep-link — user opens Allegro search results, not a specific listing
  const allegroSearchUrl = 'https://allegro.pl/listing?string='
    + encodeURIComponent((artist + ' ' + album + ' winyl').trim());

  const ebayLowest = ebay.listings.length > 0
    ? Math.min(...ebay.listings.map(l => l.price))
    : null;

  // Don't render the section at all if nothing meaningful to show
  // (eBay didn't return + no Discogs price — it's just noise)
  if (!discogsLowest && ebayLowest === null && !ebay.loading) {
    return null;
  }

  return (
    <div style={{ padding: '14px 16px 0' }}>
      <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em',
        textTransform: 'uppercase', ...MONO, marginBottom: 10,
        display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="dollar" size={11} color={C.accent}/>
        Available now · price comparison
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Discogs row — always shown if we have a price */}
        {discogsLowest != null && (
          <Row
            label="Discogs"
            sublabel="Median market"
            price={discogsLowest}
            currency="USD"
            color="#629aa9"
            iconName="record"
            href={null}  // Discogs link already exists separately in modal
            inline
          />
        )}

        {/* eBay row — async, may show loading or fallback */}
        {ebay.loading ? (
          <Row
            label="eBay"
            sublabel="Searching…"
            loading
            color="#86b817"
            iconName="external"
          />
        ) : ebayLowest != null ? (
          <Row
            label="eBay"
            sublabel={ebay.listings.length + ' active listing' + (ebay.listings.length !== 1 ? 's' : '')}
            price={ebayLowest}
            currency={ebay.listings[0].currency || 'USD'}
            color="#86b817"
            iconName="external"
            href={ebay.listings[0].url}
            condition={ebay.listings[0].condition}
          />
        ) : null}

        {/* Allegro row — link-only, no live price (no API access) */}
        <Row
          label="Allegro"
          sublabel="Search Polish marketplace"
          color="#ff5a00"
          iconName="external"
          href={allegroSearchUrl}
          searchOnly
        />

        {/* Bandsintown — closest upcoming concert for this artist */}
        {concert.next && (
          <a href={concert.next.ticketsUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              background: '#0d1f1a', border: '1px solid #1a3d3a',
              borderRadius: 8, textDecoration: 'none', cursor: 'pointer',
            }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: '#00b89622', border: '1px solid #00b89644',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon name="music" size={14} color="#00b896"/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...BEBAS, fontSize: 13, color: C.text, letterSpacing: '0.04em', lineHeight: 1.1 }}>
                Live on tour
              </div>
              <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {concert.next.city || concert.next.venue} · {new Date(concert.next.datetime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>
            </div>
            <div style={{ ...BEBAS, fontSize: 11, color: '#00b896', letterSpacing: '0.08em' }}>
              TICKETS →
            </div>
          </a>
        )}
      </div>

      <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 10,
        lineHeight: 1.5, fontStyle: 'italic' }}>
        Prices shown for reference only. Click through to view current listings on each marketplace.
      </div>
    </div>
  );
}

// ── Row primitive ──
function Row({ label, sublabel, price, currency, color, iconName, href, loading, searchOnly, condition, inline }) {
  const Wrapper = href ? 'a' : 'div';
  const wrapperProps = href ? {
    href, target: '_blank', rel: 'noopener noreferrer',
    onClick: e => e.stopPropagation(),
  } : {};

  return (
    <Wrapper
      {...wrapperProps}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px',
        background: C.bg3, border: '1px solid ' + C.border,
        borderRadius: 8, textDecoration: 'none',
        cursor: href ? 'pointer' : 'default',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: color + '22', border: '1px solid ' + color + '44',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon name={iconName} size={14} color={color}/>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...BEBAS, fontSize: 13, color: C.text, letterSpacing: '0.04em', lineHeight: 1.1 }}>
          {label}
        </div>
        <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 2 }}>
          {loading ? 'Loading…' : sublabel}
        </div>
      </div>

      {price != null && !loading && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ ...BEBAS, fontSize: 17, color: color, lineHeight: 1 }}>
            {currency === 'USD' ? '$' : ''}{price.toFixed(0)}{currency === 'PLN' ? ' zł' : ''}
          </div>
          <div style={{ fontSize: 8, color: C.dim, ...MONO }}>
            {inline ? 'lowest' : 'from'}{condition ? ' · ' + condition.toLowerCase() : ''}
          </div>
        </div>
      )}

      {searchOnly && !loading && (
        <div style={{ ...BEBAS, fontSize: 11, color: color, letterSpacing: '0.08em' }}>
          SEARCH →
        </div>
      )}

      {href && price != null && (
        <Icon name="external" size={12} color={C.dim} style={{ marginLeft: 4, flexShrink: 0 }}/>
      )}
    </Wrapper>
  );
}
