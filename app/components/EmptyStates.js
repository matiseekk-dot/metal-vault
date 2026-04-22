// ── Empty state illustrations ─────────────────────────────────
// Custom SVG, no external deps. Used wherever a tab/view has no content.
'use client';
import { C, MONO, BEBAS } from '@/lib/theme';

// ── Illustration primitives ──
export function IllustrationEmptyVault({ size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id="vgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a0a0a"/><stop offset="100%" stopColor="#0a0a0a"/>
        </linearGradient>
      </defs>
      <rect x="20" y="28" width="80" height="72" rx="6" fill="url(#vgrad)" stroke="#3a1010" strokeWidth="2"/>
      <rect x="30" y="38" width="60" height="6" rx="2" fill="#1a0505"/>
      <rect x="30" y="50" width="60" height="6" rx="2" fill="#1a0505"/>
      <rect x="30" y="62" width="60" height="6" rx="2" fill="#1a0505"/>
      <rect x="30" y="74" width="60" height="6" rx="2" fill="#1a0505"/>
      <circle cx="60" cy="92" r="4" fill="#dc2626"/>
      <path d="M52 20 L68 20 L68 28 L52 28 Z" fill="#2a0a0a" stroke="#3a1010" strokeWidth="1.5"/>
    </svg>
  );
}

// No alerts / watchlist illustration — spinning vinyl with radiating waves
export function IllustrationNoAlerts({ size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="44" fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="1.5"/>
      <circle cx="60" cy="60" r="36" fill="none" stroke="#1a1a1a" strokeWidth="0.5"/>
      <circle cx="60" cy="60" r="28" fill="none" stroke="#1a1a1a" strokeWidth="0.5"/>
      <circle cx="60" cy="60" r="20" fill="none" stroke="#1a1a1a" strokeWidth="0.5"/>
      <circle cx="60" cy="60" r="12" fill="#dc2626"/>
      <circle cx="60" cy="60" r="2.5" fill="#0a0a0a"/>
      {/* Radiating signal arcs */}
      <path d="M92 28 A 28 28 0 0 1 104 48" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
      <path d="M96 16 A 44 44 0 0 1 112 40" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" opacity="0.3"/>
    </svg>
  );
}

// No search results illustration — magnifying glass over empty grid
export function IllustrationNoResults({ size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      {/* Grid hint */}
      <rect x="16" y="16" width="24" height="24" fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="1"/>
      <rect x="44" y="16" width="24" height="24" fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="1"/>
      <rect x="16" y="44" width="24" height="24" fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="1"/>
      <rect x="44" y="44" width="24" height="24" fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="1"/>
      {/* Magnifying glass overlay */}
      <circle cx="80" cy="76" r="20" fill="#1a0a0a" stroke="#dc2626" strokeWidth="3"/>
      <line x1="94" y1="90" x2="106" y2="102" stroke="#dc2626" strokeWidth="4" strokeLinecap="round"/>
      <circle cx="80" cy="76" r="14" fill="none" stroke="#7f1d1d" strokeWidth="1" opacity="0.6"/>
      {/* Question mark inside glass */}
      <text x="80" y="82" textAnchor="middle" fill="#dc2626" fontSize="16" fontWeight="bold" fontFamily="monospace">?</text>
    </svg>
  );
}

// Generic empty state wrapper with illustration + text + CTA
export default function EmptyState({ illustration, title, description, ctaLabel, onCta, secondaryLabel, onSecondary }) {
  const Illust = {
    vault:    IllustrationEmptyVault,
    alerts:   IllustrationNoAlerts,
    results:  IllustrationNoResults,
  }[illustration] || IllustrationEmptyVault;

  return (
    <div style={{ textAlign: 'center', padding: '32px 24px' }}>
      <div style={{ marginBottom: 16 }}><Illust/></div>
      <div style={{ ...BEBAS, fontSize: 22, color: C.text, letterSpacing: '0.04em', marginBottom: 6 }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 12, color: C.muted, ...MONO, marginBottom: 20, lineHeight: 1.5, maxWidth: 320, margin: '0 auto 20px' }}>
          {description}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320, margin: '0 auto' }}>
        {ctaLabel && onCta && (
          <button onClick={onCta}
            style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg,#dc2626,#991b1b)',
              border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer',
              ...BEBAS, fontSize: 14, letterSpacing: '0.08em' }}>
            {ctaLabel}
          </button>
        )}
        {secondaryLabel && onSecondary && (
          <button onClick={onSecondary}
            style={{ width: '100%', padding: '10px', background: 'transparent',
              border: '1px solid ' + C.border, borderRadius: 10, color: C.muted, cursor: 'pointer',
              ...MONO, fontSize: 11 }}>
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
