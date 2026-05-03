// ── gen-feature-graphic.mjs ───────────────────────────────────────
// Renders Play Console's required feature graphic at 1024x500. This is
// the banner shown at the top of the Play Store listing. Treat the
// output as a starting point — for an actual launch you'll want a
// designer to produce a polished version. The auto-generated one is
// good enough to occupy the slot in Play Console without leaving an
// empty placeholder.
//
// Output: launch-marketing/assets/feature-1024x500.png
//
// Run:
//   node scripts/gen-feature-graphic.mjs

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR  = join(__dirname, '..', 'launch-marketing', 'assets');
mkdirSync(OUT_DIR, { recursive: true });
const OUT_PATH = join(OUT_DIR, 'feature-1024x500.png');

// Brand palette (matches lib/theme.js + manifest theme_color)
const BG     = '#0a0a0a';
const BG2    = '#141414';
const ACCENT = '#dc2626';
const GOLD   = '#f5c842';
const TEXT   = '#f0f0f0';
const MUTED  = '#888';

const W = 1024;
const H = 500;

// Big SVG — Bebas Neue / Space Mono are next/font in the app, but inline
// SVG falls back to system fonts. Use generic 'sans-serif' / 'monospace'
// so sharp's text renderer doesn't choke. The visual impact is similar.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="78%" cy="50%" r="40%">
      <stop offset="0%"  stop-color="${ACCENT}" stop-opacity="0.18"/>
      <stop offset="60%" stop-color="${ACCENT}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="${BG}"    stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="vinylShine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#2a2a2a"/>
      <stop offset="50%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#1a1a1a"/>
    </linearGradient>
    <radialGradient id="vinylRings" cx="50%" cy="50%" r="50%">
      <stop offset="35%" stop-color="#0a0a0a" stop-opacity="0"/>
      <stop offset="36%" stop-color="#222"    stop-opacity="0.55"/>
      <stop offset="37%" stop-color="#0a0a0a" stop-opacity="0"/>
      <stop offset="55%" stop-color="#0a0a0a" stop-opacity="0"/>
      <stop offset="56%" stop-color="#222"    stop-opacity="0.4"/>
      <stop offset="57%" stop-color="#0a0a0a" stop-opacity="0"/>
      <stop offset="78%" stop-color="#0a0a0a" stop-opacity="0"/>
      <stop offset="79%" stop-color="#222"    stop-opacity="0.6"/>
      <stop offset="80%" stop-color="#0a0a0a" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- Subtle grid texture (concrete vibe) -->
  <g opacity="0.04" stroke="${TEXT}" stroke-width="1">
    ${Array.from({length:13},(_,i)=>`<line x1="0" y1="${i*40}" x2="${W}" y2="${i*40}"/>`).join('')}
    ${Array.from({length:27},(_,i)=>`<line x1="${i*40}" y1="0" x2="${i*40}" y2="${H}"/>`).join('')}
  </g>

  <!-- Vinyl record on the right -->
  <g transform="translate(820, 250)">
    <!-- Vinyl outer disc -->
    <circle cx="0" cy="0" r="180" fill="url(#vinylShine)" stroke="#1a1a1a" stroke-width="1"/>
    <circle cx="0" cy="0" r="180" fill="url(#vinylRings)"/>
    <!-- Highlight glint -->
    <ellipse cx="-40" cy="-100" rx="60" ry="14" fill="${TEXT}" opacity="0.06" transform="rotate(-25 -40 -100)"/>
    <!-- Center label -->
    <circle cx="0" cy="0" r="60" fill="${ACCENT}"/>
    <circle cx="0" cy="0" r="60" fill="none" stroke="#7f1d1d" stroke-width="1"/>
    <!-- Spindle hole -->
    <circle cx="0" cy="0" r="6" fill="${BG}"/>
    <!-- Label text -->
    <text x="0" y="-12" text-anchor="middle" font-family="sans-serif" font-weight="800"
          font-size="14" fill="${TEXT}" letter-spacing="3">METAL</text>
    <text x="0" y="22" text-anchor="middle" font-family="sans-serif" font-weight="800"
          font-size="14" fill="${TEXT}" letter-spacing="3">VAULT</text>
  </g>

  <!-- Left: brand block -->
  <g transform="translate(60, 120)">
    <!-- Tag -->
    <text x="0" y="0" font-family="monospace" font-size="14" fill="${ACCENT}"
          letter-spacing="6">VINYL COLLECTOR TOOL</text>

    <!-- Wordmark -->
    <text x="0" y="80" font-family="sans-serif" font-weight="900"
          font-size="92" fill="${TEXT}" letter-spacing="2">METAL VAULT</text>

    <!-- Tagline -->
    <text x="0" y="150" font-family="sans-serif" font-weight="600" font-size="32"
          fill="${GOLD}" letter-spacing="0">Track. Value. Document.</text>

    <!-- Sub-tagline -->
    <text x="0" y="210" font-family="monospace" font-size="16" fill="${MUTED}">
      Discogs sync · Barcode scan · Insurance-ready PDFs
    </text>

    <!-- Free tier CTA -->
    <g transform="translate(0, 250)">
      <rect width="200" height="50" rx="10" fill="${ACCENT}"/>
      <text x="100" y="33" text-anchor="middle" font-family="sans-serif" font-weight="800"
            font-size="20" fill="${TEXT}" letter-spacing="2">START FREE</text>
    </g>
  </g>

  <!-- Bottom-right: 14-day trial badge -->
  <g transform="translate(${W - 60}, ${H - 40})">
    <text text-anchor="end" font-family="monospace" font-size="12"
          fill="${MUTED}" letter-spacing="2">14-DAY PRO TRIAL · CANCEL ANYTIME</text>
  </g>
</svg>`;

(async () => {
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(OUT_PATH);
  const meta = await sharp(OUT_PATH).metadata();
  console.log('[gen-feature-graphic] wrote', OUT_PATH, '(' + meta.width + 'x' + meta.height + ')');
})().catch(err => {
  console.error('[gen-feature-graphic] failed:', err.message);
  process.exit(1);
});
