'use client';
// ── WishlistsManager — owner-side gift wishlist UI ──────────────
//
// Lives inside WatchlistTab as an expandable section. Lets the user:
//   • create named wishlists (Christmas, name-day, "Someone asked")
//   • copy share links — opens to /wishlist/<token> public page
//   • toggle public/private
//   • delete (cascade deletes items)
//   • add items from current watchlist (one tap per row)
//
// The actual item-add flow lives in WatchlistTab — this component
// surfaces the list of wishlists + per-list controls. Item composition
// happens via the per-row "+" picker.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { toast, confirm as mvConfirm } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';

export default function WishlistsManager({ user, premium = false }) {
  // Free tier: 1 wishlist. Pro: unlimited. The gate lives client-side
  // here because the cost of creating an extra row in Supabase is tiny
  // — surfacing the limit visibly is more valuable than server enforcement.
  // Power users who bypass the UI gate by hand-crafting POST would still
  // get rate-limited by the regular auth + RLS path; this is product
  // gating, not security gating.
  const FREE_WISHLISTS = 1;
  const t = useT();
  const [lists, setLists]     = useState([]);
  const [open, setOpen]       = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // 'unknown' until first GET completes; 'ok' after a successful read;
  // 'missing' if the endpoint returns 503 because migration 037 hasn't
  // been applied yet. Drives the inline banner below the create form.
  const [migrationState, setMigrationState] = useState('unknown');

  const refresh = async () => {
    if (!user) return;
    try {
      const r = await fetch('/api/wishlists');
      const d = await r.json().catch(() => ({}));
      if (r.status === 503) {
        setMigrationState('missing');
        setLists([]);
        return;
      }
      if (!r.ok) {
        // Some other server error — keep state as-is, but surface to console
        // so we have a trail for debugging.
        // eslint-disable-next-line no-console
        console.warn('[wishlists] GET failed', r.status, d);
        return;
      }
      setMigrationState('ok');
      setLists(d?.wishlists || []);
      window.dispatchEvent(new CustomEvent('mv-wishlists-changed'));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[wishlists] GET threw', e);
    }
  };

  useEffect(() => {
    refresh();
    // Stay in sync if WatchlistTab itself mutates lists (e.g. user adds
    // an item via the per-row picker — count goes up).
    const handler = () => refresh();
    window.addEventListener('mv-wishlists-changed', handler);
    return () => window.removeEventListener('mv-wishlists-changed', handler);
  }, [user]);   // eslint-disable-line

  const create = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error(t('wishlists.nameRequired') || 'Wpisz nazwę listy');
      return;
    }
    // Free-tier hard stop. Existing list gets the slot; this only
    // blocks creating a SECOND one. We trigger the global paywall
    // event so the UpgradeModal pops with the right reason for
    // analytics segmentation.
    if (!premium && lists.length >= FREE_WISHLISTS) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mv:upgrade', { detail: { reason: 'MULTIPLE_WISHLISTS' } }));
      }
      return;
    }
    setCreating(true);
    try {
      const r = await fetch('/api/wishlists', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Migration not applied → 503 with a specific message. Surface
        // it loud and persistent so the user knows what to do.
        if (r.status === 503) {
          setMigrationState('missing');
          toast.error(d.error || 'Apply migration 037 in Supabase to enable wishlists', { duration: 8000 });
        } else {
          toast.error(d.error || (t('wishlists.createFailed') || 'Create failed'));
          // eslint-disable-next-line no-console
          console.error('[wishlists] POST failed', r.status, d);
        }
      } else {
        haptic.success();
        toast.success((t('wishlists.createSuccess', { name }) || ('Stworzono "' + name + '"')));
        setNewName('');
        refresh();
      }
    } catch (e) {
      toast.error(e.message);
      // eslint-disable-next-line no-console
      console.error('[wishlists] POST threw', e);
    }
    setCreating(false);
  };

  const copyLink = (wl) => {
    const url = window.location.origin + '/wishlist/' + wl.share_token;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      haptic.success();
      toast.success(t('wishlists.linkCopied') || 'Link copied — paste anywhere');
    } else {
      toast(url);
    }
  };

  const togglePublic = async (wl) => {
    try {
      const r = await fetch('/api/wishlists/' + wl.id, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_public: !wl.is_public }),
      });
      if (r.ok) refresh();
    } catch {}
  };

  const remove = async (wl) => {
    const ok = await mvConfirm(
      (t('wishlists.deleteConfirm', { name: wl.name }) || ('Delete "' + wl.name + '"?')),
      { confirmLabel: t('common.remove') || 'Delete' }
    );
    if (!ok) return;
    try {
      await fetch('/api/wishlists/' + wl.id, { method: 'DELETE' });
      refresh();
    } catch (e) { toast.error(e.message); }
  };

  if (!user) return null;

  return (
    <div style={{ marginBottom: 12, background: C.bg2, border: '1px solid ' + C.border,
      borderRadius: 10, overflow: 'hidden' }}>
      {/* Collapsible header — keeps the watchlist UI un-cluttered when
          the user isn't actively curating gift lists. */}
      <button onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '10px 14px',
          background: 'transparent', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: C.muted, cursor: 'pointer', ...MONO, fontSize: 11,
          letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
        <span>🎁 {t('wishlists.section') || 'Gift wishlists'} {lists.length > 0 ? '(' + lists.length + ')' : ''}</span>
        <span style={{ color: C.dim }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {/* Migration banner — clear blocker explanation when 037 hasn't
              been applied. Without this the create button silently 503s
              and the user just sees "nic się nie dzieje". */}
          {migrationState === 'missing' && (
            <div style={{
              background: '#3a1a06', border: '1px solid #f9731666',
              borderRadius: 8, padding: 10, marginBottom: 12,
              fontSize: 11, color: '#fbbf24', ...MONO, lineHeight: 1.5,
            }}>
              ⚠ {t('wishlists.migrationNeeded')
                || 'Funkcja wymaga migracji bazy. Otwórz Supabase → SQL Editor i zaaplikuj plik supabase/migrations/037_shared_wishlists.sql'}
            </div>
          )}

          {/* Existing lists */}
          {lists.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {lists.map(wl => (
                <div key={wl.id}
                  style={{ background: C.bg3, border: '1px solid ' + C.border,
                    borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...BEBAS, fontSize: 14, color: C.text, letterSpacing: '0.04em',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {wl.name}
                      </div>
                      <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 2 }}>
                        {wl.item_count || 0} {wl.item_count === 1 ? (t('wishlists.album') || 'album') : (t('wishlists.albums') || 'albums')}
                        {' · '}
                        {wl.is_public ? (t('wishlists.public') || 'public') : (t('wishlists.private') || 'private')}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => copyLink(wl)}
                      style={{
                        flex: 1, minWidth: 100,
                        background: '#1a3d1a', border: '1px solid #4ade80',
                        borderRadius: 6, color: '#4ade80',
                        padding: '6px 10px', cursor: 'pointer',
                        ...MONO, fontSize: 10, letterSpacing: '0.05em',
                      }}>
                      🔗 {t('wishlists.copyLink') || 'Copy link'}
                    </button>
                    <button onClick={() => togglePublic(wl)}
                      style={{
                        background: 'transparent', border: '1px solid ' + C.border,
                        borderRadius: 6, color: C.dim,
                        padding: '6px 10px', cursor: 'pointer',
                        ...MONO, fontSize: 10,
                      }}>
                      {wl.is_public
                        ? (t('wishlists.makePrivate') || '🔒 Private')
                        : (t('wishlists.makePublic')  || '🌍 Public')}
                    </button>
                    <button onClick={() => remove(wl)}
                      style={{
                        background: 'transparent', border: '1px solid ' + C.border,
                        borderRadius: 6, color: C.dim,
                        padding: '6px 10px', cursor: 'pointer',
                        ...MONO, fontSize: 10,
                      }}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create new */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create(); }}
              placeholder={t('wishlists.namePlaceholder') || 'Christmas 2026, Birthday list…'}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 6,
                background: C.bg3, border: '1px solid ' + C.border,
                color: C.text, ...MONO, fontSize: 11, outline: 'none',
              }}/>
            <button onClick={create} disabled={creating || !newName.trim()}
              style={{
                background: '#dc2626', border: 'none', borderRadius: 6,
                color: '#fff', padding: '8px 14px',
                cursor: creating || !newName.trim() ? 'default' : 'pointer',
                ...BEBAS, fontSize: 13, letterSpacing: '0.06em',
                opacity: creating || !newName.trim() ? 0.5 : 1,
              }}>
              {t('wishlists.create') || 'CREATE'}
            </button>
          </div>
          <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 6, lineHeight: 1.5 }}>
            {t('wishlists.hint') || 'Create a named list, copy the share link, send to whoever asks "what do you want for your birthday?"'}
          </div>
        </div>
      )}
    </div>
  );
}
