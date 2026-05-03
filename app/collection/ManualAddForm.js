'use client';
// ── ManualAddForm — bottom-sheet modal for typing a record by hand ──
// Extracted from CollectionTab.js to keep that file under 1000 LoC.
// Rendered from CollectionTab when the user taps "Add manually".

import { useState } from 'react';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';
import Icon from '@/app/components/Icon';
import { useBackButton } from '@/lib/hooks/useBackButton';

export default function ManualAddForm({ onAdd, onClose }) {
  useBackButton(true, onClose);
  const [form, setForm] = useState({ artist: '', album: '', format: 'Vinyl', label: '', year: '', purchase_price: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.artist.trim() || !form.album.trim()) { setError('Artist and album are required'); return; }
    setSaving(true);
    await onAdd({
      artist: form.artist.trim(), album: form.album.trim(),
      format: form.format || 'Vinyl', label: form.label.trim() || null,
      year:   form.year ? parseInt(form.year) : null,
      purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
      cover: null, discogs_id: null,
    });
    setSaving(false);
  };

  const lbl = { display: 'block', fontSize: 9, color: C.dim, ...MONO, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 };
  const fld = { ...inputSt, padding: '9px 12px', marginBottom: 10 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 250, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.bg2, borderRadius: '16px 16px 0 0', padding: '16px', maxHeight: '90vh', overflow: 'auto', paddingBottom: 'env(safe-area-inset-bottom,24px)' }}>
        <div style={{ width: 40, height: 4, background: C.border2, borderRadius: 2, margin: '0 auto 16px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ ...BEBAS, fontSize: 22, color: C.text, letterSpacing: '0.06em' }}>ADD RECORD MANUALLY</div>
          {/* Quick switch to barcode scanner */}
          <button onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent('mv:open-scanner'));
          }} style={{ background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 8,
            color: '#f87171', padding: '6px 12px', cursor: 'pointer', ...MONO, fontSize: 10,
            letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="scan" size={12} color="#f87171"/> SCAN BARCODE
          </button>
        </div>
        <label style={lbl}>Artist *</label>
        <input value={form.artist} onChange={e => set('artist', e.target.value)} placeholder="e.g. Metallica" style={fld} autoFocus />
        <label style={lbl}>Album *</label>
        <input value={form.album} onChange={e => set('album', e.target.value)} placeholder="e.g. Master of Puppets" style={fld} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={lbl}>Format</label>
            <select value={form.format} onChange={e => set('format', e.target.value)} style={{ ...fld, cursor: 'pointer', marginBottom: 0 }}>
              {['Vinyl','CD','Cassette','Box Set','Digital','Other'].map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Year</label>
            <input type="number" value={form.year} onChange={e => set('year', e.target.value)} placeholder="e.g. 1986" style={{ ...fld, marginBottom: 0 }} />
          </div>
        </div>
        <label style={lbl}>Label</label>
        <input value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Elektra Records" style={fld} />
        <label style={lbl}>Purchase price ($)</label>
        <input type="number" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)} placeholder="0.00" style={fld} />
        {error && <div style={{ color: '#f87171', fontSize: 11, ...MONO, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', background: 'none', border: '1px solid ' + C.border, borderRadius: 10, color: C.dim, cursor: 'pointer', ...MONO, fontSize: 12 }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            style={{ flex: 2, padding: '12px', background: 'linear-gradient(135deg,' + C.accent + ',' + C.accent2 + ')', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', ...BEBAS, fontSize: 18, letterSpacing: '0.06em' }}>
            {saving ? 'SAVING…' : 'SAVE RECORD'}
          </button>
        </div>
      </div>
    </div>
  );
}
