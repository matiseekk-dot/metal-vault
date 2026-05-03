'use client';
// ── PriceModal — fullscreen prompt for purchase price entry ──
// Extracted from CollectionTab.js. Rendered at CollectionTab root level
// so card-grid re-renders don't unmount the input mid-typing.

import { useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { useT } from '@/lib/i18n';

export default function PriceModal({ item, onClose, onSave }) {
  useBackButton(true, onClose);
  const t = useT();
  const [val, setVal] = useState(item.purchase_price ? String(item.purchase_price) : '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    const n = parseFloat(String(val).trim().replace(',', '.'));
    if (isNaN(n) || n < 0) return;
    setSaving(true);
    try { await onSave(n); } catch {}
    setSaving(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '20vh', padding: '20vh 20px 20px',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 400, background: C.bg2,
        border: '2px solid ' + C.accent, borderRadius: 14, padding: 20,
      }}>
        <div style={{ ...BEBAS, fontSize: 18, color: C.text, marginBottom: 4, letterSpacing: '0.05em' }}>
          {t('vault.priceModal.title')}
        </div>
        <div style={{ fontSize: 11, color: C.dim, ...MONO, marginBottom: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.artist} — {item.album}
        </div>
        <input
          type="number"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          placeholder={t('vault.priceModal.placeholder')}
          autoFocus
          style={{ width: '100%', background: C.bg3, border: '1px solid ' + C.border,
            borderRadius: 6, color: C.text, padding: '10px 12px', fontSize: 16,
            ...MONO, outline: 'none', boxSizing: 'border-box', marginBottom: 14 }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose}
            style={{ flex: 1, background: 'none', border: '1px solid ' + C.border,
              borderRadius: 8, color: C.dim, padding: '10px', cursor: 'pointer',
              ...MONO, fontSize: 12 }}>
            {t('common.cancel')}
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 2, background: C.accent, border: 'none', borderRadius: 8,
              color: '#fff', padding: '10px', cursor: 'pointer',
              ...BEBAS, fontSize: 16, letterSpacing: '0.06em', opacity: saving ? 0.6 : 1 }}>
            {saving ? t('common.saving').replace(/[a-z]+…/, m => m.toUpperCase()) : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
