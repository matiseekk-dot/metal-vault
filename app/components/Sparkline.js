'use client';
// ── Sparkline — minimal trend line (60×16, no axes, no labels) ──
// Designed for inline use inside collection cards. Color follows trend:
//   green if last > first, red if last < first, dim if flat or 1 point.
//
// Pass `values` array of numbers (any length ≥2). Component handles:
//   • degenerate input (0 or 1 point) → returns null silently
//   • flat lines → centered horizontal stroke
//   • normalization → scales Y to fit height regardless of magnitude

export default function Sparkline({ values, width = 56, height = 16, strokeWidth = 1.5 }) {
  if (!Array.isArray(values) || values.length < 2) return null;

  // Filter to numeric only, drop NaN/null
  const series = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min;
  const flat = range === 0;

  // Convert each point to SVG coords
  // X spreads evenly across width; Y is inverted (SVG 0 = top)
  const stepX = width / (series.length - 1);
  const padY = strokeWidth;  // breathing room so line doesn't clip

  const points = series.map((v, i) => {
    const x = i * stepX;
    let y;
    if (flat) {
      y = height / 2;
    } else {
      const norm = (v - min) / range;       // 0..1
      y = height - padY - norm * (height - 2 * padY);
    }
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');

  // Color logic
  const first = series[0];
  const last = series[series.length - 1];
  const trendUp   = last > first;
  const trendDown = last < first;
  const color = flat ? '#555'
              : trendUp   ? '#4ade80'   // green
              : trendDown ? '#f87171'   // red
              : '#888';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
