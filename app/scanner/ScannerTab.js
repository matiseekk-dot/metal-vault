'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';


function PriceTag({ label, value, color = C.accent }) {
  if (!value) return null;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ ...BEBAS, fontSize: 26, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: C.dim, ...MONO, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function ResultCard({ release, onAddToCollection, onAddToWatchlist, inCollection, inWatchlist }) {
  const [added, setAdded] = useState('');

  return (
    <div style={{
      background: C.bg2, border: `1px solid ${C.border}`,
      borderRadius: 12, overflow: 'hidden',
      boxShadow: '0 4px 24px #00000066',
    }}>
      {/* Cover + info */}
      <div style={{ display: 'flex', gap: 14, padding: '16px 16px 12px' }}>
        <div style={{
          width: 72, height: 72, borderRadius: 8, flexShrink: 0,
          overflow: 'hidden', border: `1px solid ${C.border}`,
          background: `linear-gradient(135deg, #1a0000, #0a0a0a)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {release.thumb
            ? <img src={release.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ ...BEBAS, fontSize: 28, color: '#ffffff22' }}>?</span>
          }
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...BEBAS, fontSize: 20, color: C.text, lineHeight: 1.1, marginBottom: 4 }}>
            {release.title}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {release.label  && <span style={{ fontSize: 11, color: C.dim, ...MONO }}>🏷 {release.label}</span>}
            {release.year   && <span style={{ fontSize: 11, color: C.dim, ...MONO }}>📅 {release.year}</span>}
            {release.format && <span style={{ fontSize: 11, color: C.dim, ...MONO }}>{release.format}</span>}
            {release.catno  && <span style={{ fontSize: 11, color: C.dim, ...MONO }}>{release.catno}</span>}
          </div>
        </div>
      </div>

      {/* Price stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: C.border, margin: '0 16px', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { label: 'Lowest',  value: release.lowestPrice ? '$'+release.lowestPrice.toFixed(0) : '—', color: '#4ade80' },
          { label: 'For sale', value: release.numForSale || '—', color: C.muted },
          { label: 'Have',    value: release.community?.have || '—', color: C.dim },
        ].map(s => (
          <div key={s.label} style={{ background: C.bg3, padding: '10px 6px', textAlign: 'center' }}>
            <div style={{ ...BEBAS, fontSize: 20, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 8, color: C.dim, ...MONO, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Community */}
      {release.community && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, padding: '10px 16px' }}>
          <span style={{ fontSize: 11, color: C.dim, ...MONO }}>👥 {release.community.have} have</span>
          <span style={{ fontSize: 11, color: C.dim, ...MONO }}>❤️ {release.community.want} want</span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 16px 16px' }}>
        <a href={release.discogsUrl} target="_blank" rel="noopener noreferrer"
          style={{
            display: 'block', padding: '10px', background: C.bg3,
            border: `1px solid ${C.border}`, borderRadius: 8,
            fontSize: 12, color: C.muted, ...MONO, textDecoration: 'none', textAlign: 'center',
          }}>
          🔗 View on Discogs
        </a>
        {!inWatchlist && (
          <button onClick={() => { onAddToWatchlist(release); setAdded('watch'); }}
            style={{
              padding: '10px', background: added === 'watch' ? '#2a2200' : 'none',
              border: `1px solid ${added === 'watch' ? '#92400e' : C.border}`,
              borderRadius: 8, color: '#f5c842', cursor: 'pointer', fontSize: 12, ...MONO,
            }}>
            {added === 'watch' ? '★ Added to Watchlist' : '☆ Add to Watchlist'}
          </button>
        )}
        {!inCollection && (
          <button onClick={() => { onAddToCollection(release); setAdded('coll'); }}
            style={{
              padding: '10px', background: added === 'coll' ? '#001a00' : 'none',
              border: `1px solid ${added === 'coll' ? '#166534' : C.border}`,
              borderRadius: 8, color: '#4ade80', cursor: 'pointer', fontSize: 12, ...MONO,
            }}>
            {added === 'coll' ? '✓ Added to Collection' : '+ Add to Collection'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ScannerTab({ onAddToCollection, onAddToWatchlist, collection, watchlist }) {
  const videoRef    = useRef(null);
  const streamRef   = useRef(null);
  const readerRef   = useRef(null);

  const [scanning,   setScanning]   = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [status,     setStatus]     = useState('');
  const [result,     setResult]     = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [scanCount,  setScanCount]  = useState(0);
  const [lastScan,   setLastScan]   = useState('');

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (readerRef.current) {
      try { readerRef.current.reset(); } catch {}
      readerRef.current = null;
    }
    setScanning(false);
    setStatus('');
  }, []);

  // Lookup barcode
  const lookup = useCallback(async (code) => {
    if (!code || code === lastScan) return;
    setLastScan(code);
    setLoading(true);
    setError('');
    setResult(null);
    setStatus(`Found: ${code}`);

    try {
      const r = await fetch(`/api/barcode?barcode=${encodeURIComponent(code)}`);
      const d = await r.json();
      if (d.error) { setError(d.error); }
      else if (!d.found) { setError(`No Discogs results for barcode: ${code}`); }
      else { setResult(d); setScanCount(n => n + 1); }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [lastScan]);

  // Start camera scanner
  const startCamera = useCallback(async () => {
    setError(''); setResult(null); setLastScan('');
    setStatus('Starting camera…');

    try {
      // Dynamically import ZXing to avoid SSR issues
      const { BrowserMultiFormatReader } = await import('@zxing/browser');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      setScanning(true);
      setStatus('Point camera at barcode…');

      // Start continuous decoding
      reader.decodeFromStream(stream, videoRef.current, (result, error) => {
        if (result) {
          const code = result.getText();
          setStatus(`Scanned: ${code}`);
          lookup(code);
        }
      });

    } catch (e) {
      if (e.name === 'NotAllowedError') {
        setError('Camera access denied. Allow camera in browser settings.');
      } else if (e.name === 'NotFoundError') {
        setError('No camera found. Use manual entry below.');
      } else {
        setError(`Camera error: ${e.message}`);
      }
      setScanning(false);
      setStatus('');
    }
  }, [lookup]);

  // Cleanup on unmount
  useEffect(() => () => stopCamera(), [stopCamera]);

  const inCollection = result?.best ? collection.some(c => c.discogs_id === result.best.id) : false;
  const inWatchlist  = result?.best ? watchlist.some(w => w.album_id === String(result.best.id)) : false;

  return (
    <div style={{ padding: '0 0 16px' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 0', marginBottom: 16 }}>
        <div style={{ ...BEBAS, fontSize: 28, color: C.text, letterSpacing: '0.06em', lineHeight: 1 }}>
          BARCODE SCANNER
        </div>
        <div style={{ fontSize: 10, color: C.accent, ...MONO, letterSpacing: '0.2em', marginTop: 2 }}>
          SCAN VINYL → GET DISCOGS PRICE
        </div>
        {scanCount > 0 && (
          <div style={{ fontSize: 10, color: '#4ade80', ...MONO, marginTop: 4 }}>
            ✓ {scanCount} scanned this session
          </div>
        )}
      </div>

      {/* Camera viewfinder */}
      <div style={{
        position: 'relative', margin: '0 16px 16px',
        borderRadius: 12, overflow: 'hidden',
        background: '#000',
        aspectRatio: '4/3',
        border: `2px solid ${scanning ? C.accent : C.border}`,
        transition: 'border-color 0.3s',
      }}>
        <video
          ref={videoRef}
          playsInline muted
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            display: scanning ? 'block' : 'none',
          }}
        />

        {/* Scanning overlay */}
        {scanning && (
          <>
            {/* Corner brackets */}
            {[
              { top: 16, left: 16, borderTop: `3px solid ${C.accent}`, borderLeft: `3px solid ${C.accent}` },
              { top: 16, right: 16, borderTop: `3px solid ${C.accent}`, borderRight: `3px solid ${C.accent}` },
              { bottom: 16, left: 16, borderBottom: `3px solid ${C.accent}`, borderLeft: `3px solid ${C.accent}` },
              { bottom: 16, right: 16, borderBottom: `3px solid ${C.accent}`, borderRight: `3px solid ${C.accent}` },
            ].map((style, i) => (
              <div key={i} style={{ position: 'absolute', width: 32, height: 32, ...style }} />
            ))}
            {/* Scan line */}
            <div style={{
              position: 'absolute', left: '10%', right: '10%', height: 2,
              background: `linear-gradient(90deg, transparent, ${C.accent}, transparent)`,
              animation: 'scanline 2s ease-in-out infinite',
              top: '50%',
            }} />
          </>
        )}

        {/* Idle state */}
        {!scanning && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
            background: C.bg2,
          }}>
            <div style={{ fontSize: 56 }}>📷</div>
            <div style={{ ...BEBAS, fontSize: 18, color: C.muted, letterSpacing: '0.06em' }}>
              TAP TO SCAN
            </div>
            <div style={{ fontSize: 11, color: C.dim, ...MONO, textAlign: 'center', padding: '0 24px' }}>
              Point at barcode on vinyl sleeve or CD
            </div>
          </div>
        )}
      </div>

      {/* CSS animation for scan line */}
      <style>{`
        @keyframes scanline {
          0%, 100% { top: 20%; opacity: 0.8; }
          50% { top: 80%; opacity: 1; }
        }
      `}</style>

      {/* Camera button */}
      <div style={{ padding: '0 16px', marginBottom: 16 }}>
        {!scanning ? (
          <button onClick={startCamera}
            style={{
              width: '100%', padding: '14px',
              background: `linear-gradient(135deg, ${C.accent}, ${C.accent2})`,
              border: 'none', borderRadius: 10, color: '#fff',
              ...BEBAS, fontSize: 18, letterSpacing: '0.1em', cursor: 'pointer',
            }}>
            📷 START CAMERA
          </button>
        ) : (
          <button onClick={stopCamera}
            style={{
              width: '100%', padding: '14px',
              background: C.bg3, border: `1px solid ${C.border}`,
              borderRadius: 10, color: C.muted,
              ...BEBAS, fontSize: 18, letterSpacing: '0.1em', cursor: 'pointer',
            }}>
            ⏹ STOP CAMERA
          </button>
        )}
      </div>

      {/* Status */}
      {status && (
        <div style={{ padding: '0 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#f5c842', ...MONO, textAlign: 'center' }}>
            {status}
          </div>
        </div>
      )}

      {/* Manual entry */}
      <div style={{ padding: '0 16px', marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: C.dim, ...MONO, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 6 }}>
          Or enter barcode manually
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup(manualCode)}
            placeholder="e.g. 0602498388358"
            style={{
              flex: 1, background: C.bg3, border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.text, padding: '11px 12px',
              fontSize: 16, ...MONO, outline: 'none',
            }}
          />
          <button onClick={() => lookup(manualCode)}
            style={{
              padding: '11px 16px', background: C.accent, border: 'none',
              borderRadius: 8, color: '#fff', cursor: 'pointer',
              ...BEBAS, fontSize: 16, letterSpacing: '0.06em',
            }}>
            GO
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '24px', color: C.dim, ...MONO, fontSize: 12 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⟳</div>
          Looking up on Discogs…
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ margin: '0 16px', background: '#1a0000', border: `1px solid ${C.accent}44`, borderRadius: 8, padding: '12px 14px', color: '#f87171', fontSize: 12, ...MONO }}>
          ⚠ {error}
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div style={{ padding: '0 16px' }}>
          {result.results.length > 1 && (
            <div style={{ fontSize: 10, color: C.dim, ...MONO, letterSpacing: '0.1em', marginBottom: 10 }}>
              {result.results.length} RESULTS FOUND
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.results.slice(0, 3).map(r => (
              <ResultCard
                key={r.id}
                release={r}
                onAddToCollection={onAddToCollection}
                onAddToWatchlist={onAddToWatchlist}
                inCollection={collection.some(c => c.discogs_id === r.id)}
                inWatchlist={watchlist.some(w => w.album_id === String(r.id))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
