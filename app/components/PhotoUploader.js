'use client';
// ── PhotoUploader — upload + manage photos for a collection item ──
//
// Flow: pick file → compress (client-side Canvas) → request signed URL from
// /api/photos/upload → PUT directly to Supabase Storage → confirm via
// /api/photos/confirm. Server side never proxies bytes (Vercel 4.5MB body limit).
//
// Free users: 1 photo per album. Pro: 6 photos per album.

import { useState, useRef } from 'react';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { confirm as mvConfirm } from '@/app/components/Toast';
import { C, MONO } from '@/lib/theme';
import Icon from '@/app/components/Icon';
import { compressImage } from '@/lib/photo-compress';

const FREE_LIMIT       = 0;     // Pro-only feature
const PRO_LIMIT        = 6;
const MAX_INPUT_MB     = 12;

// Convert base64 dataURL → Blob for direct PUT upload to Storage.
// (compressImage returns dataUrl; Storage signed URLs need Blob/binary.)
function dataURLtoBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function PhotoUploader({ collectionId, photos: initialPhotos = [], premium, onUpgrade, onPhotosChange }) {
  const [photos,    setPhotos]    = useState(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState(null);
  const [lightbox,  setLightbox]  = useState(null);
  const fileInput = useRef(null);

  const limit = premium ? PRO_LIMIT : FREE_LIMIT;
  const atLimit = photos.length >= limit;

  async function handleFiles(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > MAX_INPUT_MB * 1024 * 1024) {
      setError(`File too large (max ${MAX_INPUT_MB}MB before compression)`);
      return;
    }

    setError(null);
    setUploading(true);

    try {
      // 1) Compress
      const compressed = await compressImage(file);
      const blob = dataURLtoBlob(compressed.dataUrl);

      // 2) Request signed upload URL
      const signRes = await fetch('/api/photos/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection_item_id: collectionId,
          mime_type: compressed.mime,
        }),
      });
      const signData = await signRes.json();

      if (!signRes.ok) {
        if (signData.error === 'PHOTO_LIMIT_REACHED' && !premium && onUpgrade) {
          onUpgrade('PHOTO_LIMIT_REACHED');
        }
        throw new Error(signData.message || signData.error || 'Upload signing failed');
      }

      // 3) PUT to Supabase Storage
      const uploadRes = await fetch(signData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': compressed.mime },
        body: blob,
      });
      if (!uploadRes.ok) throw new Error('Storage upload failed: HTTP ' + uploadRes.status);

      // 4) Confirm — appends photo to collection.user_photos
      const confirmRes = await fetch('/api/photos/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection_item_id: collectionId,
          path: signData.path,
        }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || 'Confirm failed');

      // 5) Update local state + parent
      const newPhotos = [...photos, confirmData.photo];
      setPhotos(newPhotos);
      onPhotosChange?.(newPhotos);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(path) {
    if (!(await mvConfirm('Delete this photo?', { kind: 'danger', confirmLabel: 'Delete' }))) return;
    try {
      const r = await fetch('/api/photos/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection_item_id: collectionId, path }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Delete failed');
      const newPhotos = photos.filter(p => p.path !== path);
      setPhotos(newPhotos);
      onPhotosChange?.(newPhotos);
    } catch (e) {
      setError(e.message);
    }
  }

  // ── Free user: hero CTA instead of upload grid ──
  // Photo upload is Pro-only. Showing a teaser with concrete value prop is
  // more honest than a grid that immediately rejects on first click.
  if (!premium && photos.length === 0) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 10, color: C.accent, ...MONO,
          letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="camera" size={11} color={C.accent}/>
          Your photos · PRO
        </div>
        <button
          onClick={() => onUpgrade?.('PHOTO_LIMIT_REACHED')}
          style={{
            width: '100%', padding: '20px 16px',
            background: 'linear-gradient(180deg, #1a0a0a 0%, #0d0505 100%)',
            border: '1px solid ' + C.accent + '44',
            borderRadius: 10, cursor: 'pointer',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 10, textAlign: 'center',
          }}
        >
          <Icon name="camera" size={28} color={C.accent}/>
          <div style={{ fontSize: 12, color: C.text, ...MONO, fontWeight: 600 }}>
            Photograph your collection
          </div>
          <div style={{ fontSize: 10, color: C.dim, ...MONO, lineHeight: 1.5, maxWidth: 240 }}>
            Document sleeve condition, capture numbered variants, embed in insurance reports.
          </div>
          <div style={{
            marginTop: 4, padding: '6px 14px',
            background: C.accent + '22', border: '1px solid ' + C.accent + '66',
            borderRadius: 6, color: C.accent, fontSize: 10, ...MONO,
            letterSpacing: '0.05em',
          }}>
            UPGRADE TO PRO →
          </div>
        </button>
      </div>
    );
  }

  // ── Edge case: user was Pro, downgraded, but has uploaded photos already ──
  // Show them but disable upload. Don't auto-delete — that's destructive.

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: C.accent, ...MONO,
          letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Your photos
        </div>
        <div style={{ fontSize: 9, color: C.dim, ...MONO }}>
          {photos.length} / {limit}{!premium && ' · Free'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {photos.map((p, i) => (
          <div key={p.path} style={{
            position: 'relative', aspectRatio: '1',
            borderRadius: 6, overflow: 'hidden',
            background: C.bg3, border: '1px solid ' + C.border,
          }}>
            <img
              src={p.url}
              alt={p.label || `Photo ${i+1}`}
              onClick={() => setLightbox(p.url)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
              loading="lazy"
            />
            <button
              onClick={() => handleDelete(p.path)}
              aria-label="Delete photo"
              style={{
                position: 'absolute', top: 4, right: 4,
                width: 20, height: 20, borderRadius: '50%',
                background: 'rgba(0,0,0,0.7)', border: '1px solid #444',
                color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, lineHeight: 1, padding: 0,
              }}
            >×</button>
          </div>
        ))}

        {!atLimit && (
          <button
            onClick={() => !uploading && fileInput.current?.click()}
            disabled={uploading}
            style={{
              aspectRatio: '1', borderRadius: 6,
              border: '1px dashed ' + (uploading ? C.border : C.accent + '88'),
              background: 'transparent',
              cursor: uploading ? 'wait' : 'pointer',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
              color: uploading ? C.dim : C.accent,
              fontSize: 10, ...MONO, padding: 0,
            }}
          >
            {uploading ? (
              <>
                <div style={{
                  width: 16, height: 16, border: '2px solid ' + C.dim,
                  borderTopColor: C.accent, borderRadius: '50%',
                  animation: 'mvspin 0.8s linear infinite',
                }}/>
                <span>Uploading…</span>
              </>
            ) : (
              <>
                <Icon name="camera" size={20} color={C.accent}/>
                <span>Add photo</span>
              </>
            )}
          </button>
        )}
      </div>

      {atLimit && !premium && (
        <button
          onClick={() => onUpgrade?.('PHOTO_LIMIT_REACHED')}
          style={{
            marginTop: 8, padding: '8px 12px',
            background: '#1a0500', border: '1px solid ' + C.accent + '66',
            borderRadius: 6, color: C.accent, cursor: 'pointer',
            fontSize: 11, ...MONO, width: '100%',
          }}
        >
          Upgrade to Pro for {PRO_LIMIT - photos.length} more slots →
        </button>
      )}

      {error && (
        <div style={{
          marginTop: 8, padding: '8px 10px',
          background: '#1a0000', border: '1px solid #7f1d1d', borderRadius: 6,
          color: '#f87171', fontSize: 11, ...MONO,
        }}>
          {error}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFiles}
        style={{ display: 'none' }}
      />

      {lightbox && (
        <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />
      )}

      <style jsx>{`
        @keyframes mvspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function PhotoLightbox({ src, onClose }) {
  useBackButton(true, onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, cursor: 'pointer',
      }}
    >
      <img src={src} alt="Preview"
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}/>
      <button
        aria-label="Close"
        style={{
          position: 'absolute', top: 16, right: 16,
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(0,0,0,0.6)', border: '1px solid #444',
          color: '#fff', cursor: 'pointer',
          fontSize: 18, lineHeight: 1, padding: 0,
        }}
      >×</button>
    </div>
  );
}
