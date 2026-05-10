'use client';
// ── ForSaleToggle — list a collection item for sale ─────────────
//
// Pro-tier feature. Renders inside VinylModal next to the photo
// uploader for items the user actually owns. Three states:
//
//   1. Not for sale → button "List for sale (Pro)" — gated
//   2. For sale → shows asking price + note + "Open on Discogs"
//      and "Remove from sale" buttons
//   3. Not premium → small CTA pointing at upgrade modal
//
// The "Open on Discogs" CTA opens
//   https://www.discogs.com/sell/release/<release_id>?ev=lc&...
// in a new tab, pre-filling the seller's listing form. v1 stops
// here. v2 will use the Discogs Marketplace API to push the
// listing programmatically (requires OAuth scope marketplace=write
// which we don't request yet).
//
// Why we don't auto-list: even if we had write scope, generating a
// listing from the metadata we have would skip the seller-required
// "condition assessment" interaction step. Users typically want to
// re-confirm the grade themselves before publishing.

import { useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';
import { toast, confirm as mvConfirm } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';
import { trackPaywallView } from '@/lib/analytics';

export default function ForSaleToggle({ item, premium, onUpgrade, onUpdated }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [price, setPrice]     = useState(item?.asking_price?.toString() || item?.median_price?.toString() || '');
  const [note,  setNote]      = useState(item?.for_sale_note || '');
  const [busy,  setBusy]      = useState(false);

  if (!item?.id) return null;

  const isForSale = item.for_sale === true;

  // ── Free user: pitch ────────────────────────────────────────
  if (!premium && !isForSale) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 10, color: C.accent, ...MONO,
          letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>
          {t('forSale.heading.pro')}
        </div>
        <button
          onClick={() => { trackPaywallView('FOR_SALE'); onUpgrade?.('FOR_SALE'); }}
          style={{
            width: '100%', padding: '14px',
            background: 'linear-gradient(135deg, #1a0a00, #2a1000)',
            border: '1px solid ' + C.accent + '66',
            borderRadius: 10, cursor: 'pointer',
            color: C.text, ...MONO, fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
          <span style={{ flex: 1, textAlign: 'left' }}>{t('forSale.proPitch')}</span>
          <span style={{ color: C.accent, ...BEBAS, letterSpacing: '0.06em' }}>UPGRADE →</span>
        </button>
      </div>
    );
  }

  const save = async () => {
    // Accept both comma and dot decimals (PL/DE users type "11,03",
    // US users type "11.03"). Number() doesn't parse comma, parseFloat
    // stops at the comma — easier to normalise upfront.
    const normalised = String(price).replace(/\s/g, '').replace(',', '.');
    const p = Number(normalised);
    if (!Number.isFinite(p) || p <= 0) {
      toast.error(t('forSale.invalidPrice'));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/collection?id=' + item.id, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          for_sale:      true,
          asking_price:  p,
          for_sale_note: note?.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Save failed');
      haptic.success();
      // Tell the user where to find the listing afterwards — without
      // this they wonder where the record "went" since the listing
      // doesn't move it out of the collection (it just flags it).
      toast.success(
        (t('forSale.listedWithLocation')
          || 'Wystawione na sprzedaż — Vault → Kolekcja → filtr "💲 Na sprzedaż"'),
        { duration: 6000 }
      );
      onUpdated?.(d.item);
      setEditing(false);
    } catch (e) {
      toast.error(e.message);
    }
    setBusy(false);
  };

  const remove = async () => {
    const ok = await mvConfirm(t('forSale.removeConfirm'), {
      confirmLabel: t('common.remove'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch('/api/collection?id=' + item.id, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          for_sale:      false,
          asking_price:  null,
          for_sale_note: null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Remove failed');
      haptic.tap();
      toast.success(t('forSale.removed'));
      onUpdated?.(d.item);
    } catch (e) {
      toast.error(e.message);
    }
    setBusy(false);
  };

  const openDiscogsListing = () => {
    if (!item.discogs_id) {
      toast.error(t('forSale.noDiscogs'));
      return;
    }
    // Discogs "list for sale" deep-link. Pre-fills the release ID and
    // jumps straight into the listing form. Note: requires the user
    // to be logged into discogs.com in the same browser session.
    const url = 'https://www.discogs.com/sell/release/' + item.discogs_id;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // ── Premium + already for sale ─────────────────────────────
  if (isForSale && !editing) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 10, color: '#4ade80', ...MONO,
          letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="tag" size={11} color="#4ade80"/>
          {t('forSale.headingActive')}
        </div>
        <div style={{ background: '#0a1a0a', border: '1px solid #1a3d1a', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: item.for_sale_note ? 8 : 0 }}>
            <div style={{ fontSize: 10, color: C.dim, ...MONO, letterSpacing: '0.1em' }}>
              {t('forSale.askingPrice')}
            </div>
            <div style={{ ...BEBAS, fontSize: 22, color: '#4ade80', lineHeight: 1 }}>
              ${Number(item.asking_price).toFixed(2)}
            </div>
          </div>
          {item.for_sale_note && (
            <div style={{ fontSize: 11, color: C.muted, ...MONO, lineHeight: 1.4 }}>
              {item.for_sale_note}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={openDiscogsListing} disabled={!item.discogs_id || busy}
              style={{
                flex: 1, padding: '10px',
                background: item.discogs_id ? '#1a3d1a' : C.bg3,
                border: '1px solid ' + (item.discogs_id ? '#4ade80' : C.border),
                borderRadius: 8,
                color: item.discogs_id ? '#4ade80' : C.dim,
                cursor: item.discogs_id ? 'pointer' : 'not-allowed',
                fontSize: 11, ...MONO,
                opacity: busy ? 0.6 : 1,
              }}>
              ↗ {t('forSale.openDiscogs')}
            </button>
            <button onClick={() => setEditing(true)} disabled={busy}
              style={{
                padding: '10px 14px',
                background: 'transparent',
                border: '1px solid ' + C.border, borderRadius: 8,
                color: C.dim, cursor: 'pointer',
                fontSize: 11, ...MONO,
              }}>
              ✎
            </button>
            <button onClick={remove} disabled={busy}
              style={{
                padding: '10px 14px',
                background: 'transparent',
                border: '1px solid #7f1d1d', borderRadius: 8,
                color: '#f87171', cursor: 'pointer',
                fontSize: 11, ...MONO,
              }}>
              ×
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Premium + not yet for sale OR editing — form ────────────
  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 10, color: C.accent, ...MONO,
        letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="tag" size={11} color={C.accent}/>
        {editing ? t('forSale.editTitle') : t('forSale.heading')}
      </div>
      <div style={{ background: C.bg3, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: C.dim, ...MONO, marginBottom: 4 }}>
            {t('forSale.askingPrice')}
          </div>
          <input
            // text + inputmode=decimal so iOS / Android both show
            // numeric keypad WITH a decimal separator key. type=number
            // strips the comma in PL keyboard layouts before our handler
            // sees it ("11,03" → "11" silently), so we use text + a
            // permissive pattern instead.
            type="text" inputMode="decimal" pattern="[0-9.,]*"
            value={price}
            onChange={e => setPrice(e.target.value.replace(/[^0-9.,]/g, ''))}
            placeholder={item?.median_price ? `Median ~$${Number(item.median_price).toFixed(0)}` : '0.00'}
            style={{
              width: '100%', background: C.bg, border: '1px solid ' + C.border,
              borderRadius: 8, color: C.text, padding: '10px 12px', fontSize: 16,
              ...MONO, outline: 'none',
            }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: C.dim, ...MONO, marginBottom: 4 }}>
            {t('forSale.note')}
          </div>
          <textarea
            value={note} onChange={e => setNote(e.target.value.slice(0, 500))}
            placeholder={t('forSale.notePlaceholder')}
            rows={2}
            style={{
              width: '100%', background: C.bg, border: '1px solid ' + C.border,
              borderRadius: 8, color: C.text, padding: '10px 12px', fontSize: 14,
              ...MONO, outline: 'none', resize: 'vertical', minHeight: 60,
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} disabled={busy}
            style={{
              flex: 1, padding: '12px',
              background: 'linear-gradient(135deg,#dc2626,#991b1b)',
              border: 'none', borderRadius: 8,
              color: '#fff', cursor: 'pointer',
              ...BEBAS, fontSize: 14, letterSpacing: '0.06em',
              opacity: busy ? 0.6 : 1,
            }}>
            {busy ? '⏳' : (editing ? t('common.save') : t('forSale.cta'))}
          </button>
          {editing && (
            <button onClick={() => setEditing(false)} disabled={busy}
              style={{
                padding: '12px 16px',
                background: 'transparent',
                border: '1px solid ' + C.border, borderRadius: 8,
                color: C.dim, cursor: 'pointer',
                ...MONO, fontSize: 11,
              }}>
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
