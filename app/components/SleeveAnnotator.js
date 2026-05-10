'use client';
// ── SleeveAnnotator — markup sleeve defects on a photo ─────────
//
// Modal overlay over a single photo. Lets the Pro user mark defects:
//   • Circle  — ring wear, stains, scuffs (drag radius)
//   • Arrow   — point at a specific spot (drag from anchor)
//   • Text    — short label drop ("crease 2cm")
//
// All coords are stored as 0..1 normalised against the photo's natural
// dimensions, so the same annotation renders correctly at any display
// size. Save POSTs to /api/photos/annotate which replaces the photo's
// annotations array atomically.
//
// Read-only mode (showOnly={true}) renders annotations without the
// toolbar — used by PhotoGallery / VinylModal when just VIEWING the
// photo, not editing.
//
// Why no library: react-konva and friends pull in 200KB+. We need
// three primitives — a plain canvas + pointer handlers is ~5KB total.

import { useEffect, useRef, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { toast } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';

const TOOLS = [
  { id: 'circle', icon: '◯', i18n: 'annotator.tool.circle' },
  { id: 'arrow',  icon: '↗', i18n: 'annotator.tool.arrow'  },
  { id: 'text',   icon: 'T', i18n: 'annotator.tool.text'   },
];

const COLORS = ['#dc2626', '#f97316', '#facc15', '#4ade80', '#60a5fa', '#ffffff'];

export default function SleeveAnnotator({
  photo,                  // { url, path, annotations? }
  collectionItemId,
  onClose,
  onSaved,                // (updatedPhoto) → void
}) {
  const t = useT();
  const imgRef    = useRef(null);
  const wrapRef   = useRef(null);
  const [bounds, setBounds] = useState({ w: 0, h: 0 });   // rendered image size
  const [tool,   setTool]   = useState('circle');
  const [color,  setColor]  = useState('#dc2626');
  const [annos,  setAnnos]  = useState(photo?.annotations || []);
  const [drag,   setDrag]   = useState(null);             // in-progress shape
  const [saving, setSaving] = useState(false);
  const [textPrompt, setTextPrompt] = useState(null);     // { x, y } pending label

  // Resize listener — recompute bounds whenever the image renders /
  // viewport changes / orientation flips. Coords stored normalised so
  // re-measurement is cheap and doesn't move existing marks.
  useEffect(() => {
    const measure = () => {
      const el = imgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBounds({ w: r.width, h: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Convert pointer event → normalised 0..1 coords inside the image.
  const ptr = (e) => {
    const el = imgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = (e.touches?.[0]?.clientX ?? e.clientX);
    const cy = (e.touches?.[0]?.clientY ?? e.clientY);
    return {
      x: Math.max(0, Math.min(1, (cx - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (cy - r.top)  / r.height)),
    };
  };

  const onDown = (e) => {
    if (textPrompt) return;   // mid-text-entry — don't start a new shape
    const p = ptr(e);
    if (!p) return;
    if (tool === 'text') {
      // Pop the inline text input at the tap location. The actual
      // annotation isn't added until the user submits a label.
      setTextPrompt({ x: p.x, y: p.y });
      return;
    }
    setDrag({ tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };
  const onMove = (e) => {
    if (!drag) return;
    const p = ptr(e); if (!p) return;
    setDrag(d => d ? { ...d, x2: p.x, y2: p.y } : d);
    e.preventDefault?.();
  };
  const onUp = () => {
    if (!drag) return;
    const { tool: ty, x1, y1, x2, y2 } = drag;
    if (ty === 'circle') {
      const r = Math.max(0.01, Math.hypot(x2 - x1, y2 - y1));
      setAnnos(a => [...a, { type: 'circle', x: x1, y: y1, r, color }]);
    } else if (ty === 'arrow') {
      // Drop tiny accidental drags — anything under 2% of the image
      // diagonal is probably a misclick, not an arrow.
      if (Math.hypot(x2 - x1, y2 - y1) > 0.02) {
        setAnnos(a => [...a, { type: 'arrow', x: x1, y: y1, x2, y2, color }]);
      }
    }
    setDrag(null);
    haptic.tap();
  };

  const commitText = (text) => {
    if (!textPrompt) return;
    const trimmed = String(text || '').trim().slice(0, 40);
    if (trimmed) {
      setAnnos(a => [...a, { type: 'text', x: textPrompt.x, y: textPrompt.y, text: trimmed, color }]);
      haptic.tap();
    }
    setTextPrompt(null);
  };

  const undo = () => setAnnos(a => a.slice(0, -1));
  const clearAll = () => setAnnos([]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/photos/annotate', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          collection_item_id: collectionItemId,
          path:               photo.path,
          annotations:        annos,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (r.status === 402) {
          // Pro gate — bubble up to the global upgrade trigger so the
          // user sees the paywall, not just a toast.
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('mv:upgrade', { detail: { reason: 'ANNOTATIONS' } }));
          }
          return;
        }
        toast.error(d.error || 'Save failed');
        return;
      }
      haptic.success();
      toast.success(t('annotator.saved') || 'Notatki zapisane');
      onSaved?.(d.photo);
      onClose?.();
    } catch (e) {
      toast.error(e.message);
    }
    setSaving(false);
  };

  // ── Render ─────────────────────────────────────────────────
  // Layout: full-screen overlay with the photo in the centre, toolbar
  // pinned to bottom for thumb reach.
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', background: 'rgba(0,0,0,0.6)',
        borderBottom: '1px solid ' + C.border,
      }}>
        <button onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer',
            fontSize: 22, padding: 4 }}>
          ×
        </button>
        <div style={{ ...BEBAS, fontSize: 14, color: C.text, letterSpacing: '0.06em' }}>
          {t('annotator.title') || 'OZNACZ DEFEKTY'}
        </div>
        <button onClick={save} disabled={saving}
          style={{
            background: '#dc2626', border: 'none', borderRadius: 6,
            color: '#fff', padding: '6px 14px',
            cursor: saving ? 'wait' : 'pointer',
            ...BEBAS, fontSize: 13, letterSpacing: '0.06em',
            opacity: saving ? 0.6 : 1,
          }}>
          {saving ? '⏳' : (t('common.save') || 'Zapisz')}
        </button>
      </div>

      {/* Canvas zone */}
      <div ref={wrapRef}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 12, overflow: 'hidden', position: 'relative',
          touchAction: 'none',   // disable pinch-zoom / scroll while drawing
        }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}>
        <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '100%' }}>
          <img ref={imgRef} src={photo?.url} alt="sleeve"
            onLoad={() => {
              const el = imgRef.current;
              if (!el) return;
              const r = el.getBoundingClientRect();
              setBounds({ w: r.width, h: r.height });
            }}
            draggable={false}
            style={{
              display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 200px)',
              userSelect: 'none', pointerEvents: 'none',
            }}/>

          {/* SVG overlay — pointer-events:none so taps fall through to
              the wrap div which handles drawing. */}
          {bounds.w > 0 && (
            <svg style={{
              position: 'absolute', inset: 0,
              width: bounds.w, height: bounds.h,
              pointerEvents: 'none',
            }} viewBox={'0 0 ' + bounds.w + ' ' + bounds.h}>
              {annos.map((a, i) => <AnnotationShape key={i} a={a} w={bounds.w} h={bounds.h}/>)}
              {drag && (
                <DragPreview drag={drag} w={bounds.w} h={bounds.h} color={color}/>
              )}
            </svg>
          )}

          {/* Inline text-prompt — positioned absolutely at the tapped
              spot. Submitting commits the annotation. */}
          {textPrompt && (
            <div style={{
              position: 'absolute',
              left: (textPrompt.x * bounds.w) + 'px',
              top:  (textPrompt.y * bounds.h) + 'px',
              transform: 'translate(-50%, -100%)',
              background: 'rgba(0,0,0,0.85)', border: '1px solid ' + C.accent,
              borderRadius: 6, padding: 6, display: 'flex', gap: 4,
            }}>
              <input autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') commitText(e.currentTarget.value);
                  if (e.key === 'Escape') setTextPrompt(null);
                }}
                placeholder={t('annotator.textPlaceholder') || 'np. crease 2cm'}
                style={{
                  background: 'transparent', border: 'none',
                  color: C.text, ...MONO, fontSize: 13, outline: 'none',
                  width: 160,
                }}/>
            </div>
          )}
        </div>
      </div>

      {/* Bottom toolbar */}
      <div style={{
        padding: '10px 12px', background: 'rgba(0,0,0,0.7)',
        borderTop: '1px solid ' + C.border,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {/* Tool buttons + actions */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {TOOLS.map(tt => (
              <button key={tt.id} onClick={() => setTool(tt.id)}
                title={t(tt.i18n) || tt.id}
                style={{
                  minWidth: 44, minHeight: 44, borderRadius: 8,
                  background: tool === tt.id ? C.accent + '22' : C.bg3,
                  border: '1px solid ' + (tool === tt.id ? C.accent : C.border),
                  color:   tool === tt.id ? C.accent : C.dim,
                  cursor: 'pointer', fontSize: 18, ...BEBAS,
                }}>
                {tt.icon}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={undo} disabled={annos.length === 0}
              style={{
                minWidth: 44, minHeight: 44, borderRadius: 8,
                background: 'transparent', border: '1px solid ' + C.border,
                color: annos.length === 0 ? C.dim : C.muted,
                cursor: annos.length === 0 ? 'default' : 'pointer',
                fontSize: 14, ...MONO, opacity: annos.length === 0 ? 0.4 : 1,
              }}>
              ↶
            </button>
            <button onClick={clearAll} disabled={annos.length === 0}
              style={{
                minWidth: 44, minHeight: 44, borderRadius: 8,
                background: 'transparent', border: '1px solid ' + C.border,
                color: annos.length === 0 ? C.dim : '#f87171',
                cursor: annos.length === 0 ? 'default' : 'pointer',
                fontSize: 14, ...MONO, opacity: annos.length === 0 ? 0.4 : 1,
              }}>
              ✕
            </button>
          </div>
        </div>
        {/* Color picker */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: c,
                border: '2px solid ' + (color === c ? '#fff' : 'transparent'),
                cursor: 'pointer',
              }}/>
          ))}
          <span style={{ fontSize: 10, color: C.dim, ...MONO, marginLeft: 'auto' }}>
            {annos.length} {annos.length === 1 ? (t('annotator.mark') || 'znacznik') : (t('annotator.marks') || 'znaczników')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Shape renderers ─────────────────────────────────────────────
// Both runtime annotations and in-progress drag preview render via
// the same primitives. Coordinates arrive normalised (0..1) — we
// multiply by current image bounds to convert to pixels.

function AnnotationShape({ a, w, h }) {
  const stroke = a.color || '#dc2626';
  if (a.type === 'circle') {
    return (
      <circle cx={a.x * w} cy={a.y * h} r={a.r * Math.min(w, h)}
        fill="none" stroke={stroke} strokeWidth={3}/>
    );
  }
  if (a.type === 'arrow') {
    return <Arrow x1={a.x * w} y1={a.y * h} x2={a.x2 * w} y2={a.y2 * h} stroke={stroke}/>;
  }
  if (a.type === 'text') {
    // Box-on-text so the label stays readable over busy artwork.
    const tx = a.x * w;
    const ty = a.y * h;
    return (
      <g>
        <rect x={tx - 4} y={ty - 14} rx={3}
          width={Math.max(40, a.text.length * 7 + 8)} height={18}
          fill="rgba(0,0,0,0.75)" stroke={stroke} strokeWidth={1}/>
        <text x={tx} y={ty}
          fill={stroke} fontSize={12} fontFamily="monospace"
          dominantBaseline="middle">
          {a.text}
        </text>
      </g>
    );
  }
  return null;
}

function DragPreview({ drag, w, h, color }) {
  const x1 = drag.x1 * w, y1 = drag.y1 * h;
  const x2 = drag.x2 * w, y2 = drag.y2 * h;
  if (drag.tool === 'circle') {
    const r = Math.hypot(x2 - x1, y2 - y1);
    return <circle cx={x1} cy={y1} r={r} fill="none" stroke={color} strokeWidth={3} strokeDasharray="4 4"/>;
  }
  if (drag.tool === 'arrow') {
    return <Arrow x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} dashed/>;
  }
  return null;
}

function Arrow({ x1, y1, x2, y2, stroke, dashed }) {
  // Compute head — 12px back along the line, 6px out perpendicular.
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len, uy = dy / len;
  const head = 12;
  const hx = x2 - ux * head, hy = y2 - uy * head;
  const px = -uy, py = ux;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={3}
        strokeDasharray={dashed ? '4 4' : undefined}/>
      <polygon
        points={`${x2},${y2} ${hx + px * 6},${hy + py * 6} ${hx - px * 6},${hy - py * 6}`}
        fill={stroke}/>
    </g>
  );
}

// ── Read-only viewer ───────────────────────────────────────────
// Exported so PhotoUploader / VinylModal can render annotations on
// top of a photo thumbnail without spinning up the full editor.
export function AnnotationOverlay({ annotations, width, height }) {
  if (!annotations || annotations.length === 0) return null;
  if (!width || !height) return null;
  return (
    <svg style={{ position: 'absolute', inset: 0, width, height, pointerEvents: 'none' }}
      viewBox={'0 0 ' + width + ' ' + height}>
      {annotations.map((a, i) => <AnnotationShape key={i} a={a} w={width} h={height}/>)}
    </svg>
  );
}
