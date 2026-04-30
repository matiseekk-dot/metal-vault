'use client';
// ── PortfolioChangeCard — shows 30d/90d portfolio value change ──
// Async fetch /api/portfolio/change. Pro feature — Free user sees teaser CTA.
// Coverage badge: when price_history table doesn't have data for all items
// (typical for new users), show "based on N% of records" disclaimer.

import { useState, useEffect } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import Icon from '@/app/components/Icon';

function formatChange(amount) {
  const abs = Math.abs(amount);
  const sign = amount >= 0 ? '+' : '−';
  return sign + '$' + abs.toFixed(0);
}

function formatPct(pct) {
  const abs = Math.abs(pct);
  const sign = pct >= 0 ? '+' : '−';
  return sign + abs.toFixed(1) + '%';
}

export default function PortfolioChangeCard({ premium, onUpgrade }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!premium) return;  // skip fetch for free users
    fetch('/api/portfolio/change')
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(e => setError(e.message));
  }, [premium]);

  // Free user: hero CTA
  if (!premium) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #1a0a0a 0%, #0d0505 100%)',
        border: '1px solid ' + C.accent + '44',
        borderRadius: 12, padding: 16, marginBottom: 16,
      }}>
        <div style={{ fontSize: 10, color: C.accent, ...MONO,
          letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8 }}>
          <Icon name="barChart" size={11} color={C.accent}
            style={{ marginRight: 6, verticalAlign: 'middle' }}/>
          Portfolio Performance · PRO
        </div>
        <div style={{ fontSize: 12, color: C.text, ...MONO, lineHeight: 1.6, marginBottom: 12 }}>
          Track your collection's value over time. See 30-day and 90-day changes
          with historical price data from Discogs.
        </div>
        <button
          onClick={() => onUpgrade?.('PRICE_HISTORY')}
          style={{
            width: '100%', padding: '10px 16px',
            background: C.accent + '22',
            border: '1px solid ' + C.accent + '66',
            borderRadius: 8, color: C.accent, cursor: 'pointer',
            fontSize: 11, ...BEBAS, letterSpacing: '0.08em',
          }}
        >
          UNLOCK WITH PRO →
        </button>
      </div>
    );
  }

  // Loading state
  if (!data && !error) {
    return (
      <div style={{
        background: C.bg2, border: '1px solid ' + C.border,
        borderRadius: 12, padding: 16, marginBottom: 16,
        textAlign: 'center', color: C.dim, fontSize: 11, ...MONO,
      }}>
        Calculating portfolio change…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: '#1a0000', border: '1px solid #7f1d1d',
        borderRadius: 12, padding: 16, marginBottom: 16,
        color: '#f87171', fontSize: 11, ...MONO,
      }}>
        Could not load portfolio change: {error}
      </div>
    );
  }

  if (data.itemCount === 0) {
    return null;  // empty state already handled elsewhere
  }

  const noHistory = data.itemsWithHistory === 0;

  return (
    <div style={{
      background: C.bg2, border: '1px solid ' + C.border,
      borderRadius: 12, padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.accent, ...MONO,
          letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Portfolio Performance
        </div>
        {data.coverage < 100 && data.coverage > 0 && (
          <div style={{ fontSize: 9, color: C.dim, ...MONO }}>
            {data.coverage}% data coverage
          </div>
        )}
      </div>

      {noHistory ? (
        <div style={{ fontSize: 11, color: C.dim, ...MONO, lineHeight: 1.6, padding: '10px 0' }}>
          📊 No historical price data yet. Daily price snapshots are collected
          automatically — check back in a few days to see how your collection
          has changed.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            <ChangeBox
              label="30 days"
              change={data.change30d}
              percent={data.percentChange30d}
              fromValue={data.value30dAgo}
            />
            <ChangeBox
              label="90 days"
              change={data.change90d}
              percent={data.percentChange90d}
              fromValue={data.value90dAgo}
            />
          </div>

          <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 12,
            paddingTop: 10, borderTop: '1px solid ' + C.border, lineHeight: 1.5 }}>
            Current value: ${data.current.toFixed(0)} · {data.itemsWithHistory} of {data.itemCount} records have price history.
          </div>
        </>
      )}
    </div>
  );
}

function ChangeBox({ label, change, percent, fromValue }) {
  const positive = change >= 0;
  const color = positive ? '#4ade80' : '#f87171';

  return (
    <div style={{
      flex: 1, padding: '10px 12px',
      background: C.bg3, borderRadius: 8,
      border: '1px solid ' + C.border,
    }}>
      <div style={{ fontSize: 9, color: C.dim, ...MONO, letterSpacing: '0.1em',
        textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ ...BEBAS, fontSize: 22, color, lineHeight: 1, letterSpacing: '0.02em' }}>
        {formatChange(change)}
      </div>
      <div style={{ fontSize: 10, color, ...MONO, marginTop: 4 }}>
        {formatPct(percent)}
      </div>
      <div style={{ fontSize: 8, color: C.dim, ...MONO, marginTop: 4 }}>
        from ${fromValue.toFixed(0)}
      </div>
    </div>
  );
}
