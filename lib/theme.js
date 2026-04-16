// ── Metal Vault — Shared Design Tokens ──────────────────────────
// Single source of truth for colours, fonts, and common styles.
// Import wherever needed — zero duplication, zero desync.

export const C = {
  bg:      '#0a0a0a',
  bg2:     '#141414',
  bg3:     '#1e1e1e',
  bg4:     '#252525',
  border:  '#2a2a2a',
  border2: '#333',
  accent:  '#dc2626',
  accent2: '#991b1b',
  text:    '#f0f0f0',
  muted:   '#888',
  dim:     '#555',
  ultra:   '#333',
  green:   '#4ade80',
  gold:    '#f5c842',
  red:     '#f87171',
  blue:    '#60a5fa',
};

export const MONO  = { fontFamily: "'Space Mono',monospace" };
export const BEBAS = { fontFamily: "'Bebas Neue',sans-serif" };

export const BADGE_STYLES = {
  VINYL:    { bg: '#0d1a2e', color: '#60a5fa', border: '#1e40af', icon: '💿' },
  LIMITED:  { bg: '#2a1800', color: '#f5c842', border: '#92400e', icon: '💎' },
  PREORDER: { bg: '#0d2a0d', color: '#4ade80', border: '#166534', icon: '⏳' },
  NEW:      { bg: '#2a0000', color: '#f87171', border: '#7f1d1d', icon: '🔥' },
};

export const GENRE_COLOR = (g = '') => {
  const s = g.toLowerCase();
  if (s.includes('death'))  return '#8b0000';
  if (s.includes('black'))  return '#1a1a1a';
  if (s.includes('doom'))   return '#2a1a0a';
  if (s.includes('thrash')) return '#2a1500';
  if (s.includes('prog'))   return '#1a2a3a';
  if (s.includes('sludge')) return '#1a1a0a';
  if (s.includes('grind'))  return '#0d2a0d';
  return '#1a0000';
};

export const VINYL_GRADES = ['M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'];

export const GRADE_COLOR = {
  M: '#4ade80', NM: '#4ade80', 'VG+': '#f5c842', VG: '#f5c842',
  'G+': '#f97316', G: '#f87171', F: '#f87171', P: '#888',
};

/** Standard text input style — use spread: `style={{ ...inputSt }}` */
export const inputSt = {
  width: '100%',
  background: '#1e1e1e',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  color: '#f0f0f0',
  padding: '11px 14px',
  fontSize: 16,
  fontFamily: "'Space Mono',monospace",
  outline: 'none',
};
