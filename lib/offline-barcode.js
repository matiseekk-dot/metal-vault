// ── Offline barcode lookup ────────────────────────────────────
// Three-tier lookup chain (fastest first):
//   1) Local IDB cache (own collection + watchlist barcodes synced ahead of time)
//   2) Service Worker cache of /api/barcode (previous lookups, stale OK offline)
//   3) Live /api/barcode fetch (online only)
//
// IDB store schema:
//   barcodes: { barcode (string, key), kind ('collection'|'watchlist'),
//               artist, album, cover, format, item_id, last_synced }

const DB_NAME    = 'mv-offline';
const DB_VERSION = 1;
const STORE      = 'barcodes';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'barcode' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// Persist all barcodes from collection + watchlist locally.
// Call this after a successful Discogs sync — gives "scan offline" coverage.
export async function syncBarcodesToIdb({ collection = [], watchlist = [] } = {}) {
  let db;
  try { db = await openDb(); } catch { return { saved: 0, skipped: 'no_idb' }; }

  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const now = Date.now();
  let saved = 0;

  for (const item of collection) {
    const codes = extractBarcodes(item);
    for (const bc of codes) {
      store.put({
        barcode:     bc,
        kind:        'collection',
        artist:      item.artist,
        album:       item.album,
        cover:       item.cover || null,
        format:      item.format || null,
        item_id:     item.id || item.discogs_id || null,
        last_synced: now,
      });
      saved++;
    }
  }
  for (const item of watchlist) {
    const codes = extractBarcodes(item);
    for (const bc of codes) {
      // Don't overwrite a 'collection' record with 'watchlist' (collection wins)
      const existing = await new Promise(res => {
        const r = store.get(bc);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => res(null);
      });
      if (existing && existing.kind === 'collection') continue;

      store.put({
        barcode:     bc,
        kind:        'watchlist',
        artist:      item.artist,
        album:       item.album,
        cover:       item.cover || null,
        format:      item.format || null,
        item_id:     item.album_id || item.id || null,
        last_synced: now,
      });
      saved++;
    }
  }

  return new Promise(resolve => {
    tx.oncomplete = () => resolve({ saved });
    tx.onerror    = () => resolve({ saved, error: tx.error?.message });
  });
}

// Extract barcode candidates from a collection/watchlist item.
// Items may carry barcode in `barcode` field (after Discogs enrichment) or in
// `identifiers` array. We accept both EAN-13 and UPC formats.
function extractBarcodes(item) {
  const out = [];
  if (item.barcode) out.push(String(item.barcode).replace(/\D/g, ''));
  if (Array.isArray(item.identifiers)) {
    for (const i of item.identifiers) {
      if (i?.type?.toLowerCase().includes('barcode') && i.value) {
        out.push(String(i.value).replace(/\D/g, ''));
      }
    }
  }
  return out.filter(b => b.length >= 8);  // sanity: real barcodes are 8+ digits
}

// Local lookup — returns null if not found locally.
export async function lookupBarcodeLocal(barcode) {
  if (!barcode) return null;
  const cleaned = String(barcode).replace(/\D/g, '');
  let db;
  try { db = await openDb(); } catch { return null; }

  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(cleaned);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => resolve(null);
  });
}

// Save a "scan saved for later" entry — used when offline + not in local cache.
// Stored separately so user can review in ProfileTab and resync online.
const PENDING_KEY = 'mv_pending_scans';

export function queuePendingScan(barcode) {
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    if (existing.some(s => s.barcode === barcode)) return;  // dedupe
    existing.push({ barcode, scannedAt: new Date().toISOString() });
    localStorage.setItem(PENDING_KEY, JSON.stringify(existing.slice(-50)));  // cap at 50
  } catch {}
}

export function getPendingScans() {
  if (typeof localStorage === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
}

export function clearPendingScans() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(PENDING_KEY); } catch {}
}
