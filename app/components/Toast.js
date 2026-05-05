'use client';
// ── Toast / Confirm — replacement for native alert() and confirm() ──
//
// Why: native alert/confirm look jarring inside a Play Store TWA, block
// the JS thread, can't be styled, and on Android 13+ are sometimes
// suppressed entirely. We show a tiny in-app banner instead.
//
// Usage (anywhere in a client component):
//
//   import { toast, confirm } from '@/app/components/Toast';
//   toast('Saved');
//   toast.error('Failed to save');
//   const ok = await confirm('Delete this record?');
//
// The provider lives in app/layout.js — must be mounted once near the
// root for toast() / confirm() to work.

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { useBackButton } from '@/lib/hooks/useBackButton';

// ── Public API — module-level singletons backed by a CustomEvent bus.
// We use events instead of a React context so non-component code (e.g.
// fetch error handlers in lib/) can also call toast() without prop
// drilling. The provider listens and renders.

let _id = 0;
const nextId = () => ++_id;

function emitToast(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('mv:toast', { detail }));
}

export function toast(message, opts = {}) {
  emitToast({ id: nextId(), message, kind: 'info', ttlMs: 3500, ...opts });
}
toast.error   = (m, o={}) => emitToast({ id: nextId(), message: m, kind: 'error',   ttlMs: 5000, ...o });
toast.success = (m, o={}) => emitToast({ id: nextId(), message: m, kind: 'success', ttlMs: 3000, ...o });

export function confirm(message, opts = {}) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const id = nextId();
    const onDecide = (e) => {
      if (e.detail?.id !== id) return;
      window.removeEventListener('mv:confirm:decide', onDecide);
      resolve(!!e.detail.ok);
    };
    window.addEventListener('mv:confirm:decide', onDecide);
    window.dispatchEvent(new CustomEvent('mv:confirm', {
      detail: {
        id,
        message,
        confirmLabel: opts.confirmLabel || t('toast.confirm.ok'),
        cancelLabel:  opts.cancelLabel  || t('toast.confirm.cancel'),
        kind:         opts.kind         || 'info',
      },
    }));
  });
}

// ── Provider component — mount once in layout ──────────────────────
export default function ToastProvider() {
  const [toasts, setToasts] = useState([]);
  const [pending, setPending] = useState(null); // active confirm dialog

  useEffect(() => {
    const onToast = (e) => {
      const { id, message, kind, ttlMs } = e.detail;
      setToasts(prev => [...prev, { id, message, kind }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ttlMs);
    };
    const onConfirm = (e) => setPending(e.detail);
    window.addEventListener('mv:toast',   onToast);
    window.addEventListener('mv:confirm', onConfirm);
    return () => {
      window.removeEventListener('mv:toast',   onToast);
      window.removeEventListener('mv:confirm', onConfirm);
    };
  }, []);

  const decide = (ok) => {
    if (!pending) return;
    window.dispatchEvent(new CustomEvent('mv:confirm:decide', {
      detail: { id: pending.id, ok },
    }));
    setPending(null);
  };

  return (
    <>
      {/* Toast stack — bottom-center, just above the BottomNav */}
      <div style={toastStackStyle} aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} style={{ ...toastItemStyle, ...kindStyle(t.kind) }} role="status">
            {t.message}
          </div>
        ))}
      </div>

      {/* Confirm dialog */}
      {pending && (
        <ConfirmDialog
          pending={pending}
          onCancel={() => decide(false)}
          onConfirm={() => decide(true)}
        />
      )}
    </>
  );
}

// ── ConfirmDialog — dedicated component so we can hook Android back ──
// Mounted only while a confirm is pending. useBackButton intercepts the
// hardware back button on TWA so the dialog dismisses instead of the
// app exiting (default android behaviour). aria-modal + aria-labelledby
// give screen readers the right context — previously absent.
function ConfirmDialog({ pending, onCancel, onConfirm }) {
  useBackButton(true, onCancel);
  return (
    <div style={confirmBackdrop} onClick={onCancel}>
      <div style={confirmCardStyle} onClick={e => e.stopPropagation()}
        role="alertdialog" aria-modal="true" aria-labelledby="mv-confirm-msg">
        <div id="mv-confirm-msg"
          style={{ fontSize: 14, color: '#f0f0f0', lineHeight: 1.5, marginBottom: 18 }}>
          {pending.message}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={btnSecondaryStyle} autoFocus>
            {pending.cancelLabel}
          </button>
          <button onClick={onConfirm}
            style={pending.kind === 'danger' ? btnDangerStyle : btnPrimaryStyle}>
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Styles — kept inline so this file has no global CSS dependency ──
const toastStackStyle = {
  position: 'fixed',
  left: 0, right: 0, bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  padding: '0 16px',
  pointerEvents: 'none',
  zIndex: 5000,
};
const toastItemStyle = {
  pointerEvents: 'auto',
  maxWidth: 480,
  minWidth: 200,
  padding: '11px 16px',
  borderRadius: 10,
  fontFamily: "var(--font-space-mono), monospace",
  fontSize: 12,
  lineHeight: 1.4,
  textAlign: 'center',
  boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
  animation: 'mv-toast-in 180ms ease-out',
};
function kindStyle(kind) {
  if (kind === 'error')   return { background: '#1a0000', color: '#fca5a5', border: '1px solid #7f1d1d' };
  if (kind === 'success') return { background: '#001a05', color: '#86efac', border: '1px solid #14532d' };
  return                          { background: '#141414', color: '#f0f0f0', border: '1px solid #2a2a2a' };
}
const confirmBackdrop = {
  position: 'fixed', inset: 0, zIndex: 6000,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
};
const confirmCardStyle = {
  background: '#141414',
  border: '1px solid #2a2a2a',
  borderRadius: 14,
  padding: '18px 18px 16px',
  maxWidth: 380,
  width: '100%',
};
const btnPrimaryStyle = {
  flex: 1,
  padding: '10px 14px',
  background: '#dc2626',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  fontFamily: "var(--font-bebas-neue), sans-serif",
  fontSize: 16,
  letterSpacing: '0.06em',
  cursor: 'pointer',
};
const btnDangerStyle = {
  ...btnPrimaryStyle,
  background: '#7f1d1d',
};
const btnSecondaryStyle = {
  flex: 1,
  padding: '10px 14px',
  background: 'transparent',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  color: '#888',
  fontFamily: "var(--font-space-mono), monospace",
  fontSize: 12,
  cursor: 'pointer',
};
