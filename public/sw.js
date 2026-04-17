// ── Metal Vault Service Worker ────────────────────────────────
// Caches app shell + API responses for full offline support.
// Vinyl Fair mode: collection + watchlist work without internet.

const CACHE_APP  = 'mv-app-v3';
const CACHE_DATA = 'mv-data-v3';
const CACHE_IMG  = 'mv-img-v3';

// App shell — cache on install
const APP_SHELL = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

// API routes to cache (stale-while-revalidate)
const CACHE_API = [
  '/api/collection',
  '/api/watchlist',
  '/api/portfolio',
  '/api/releases',
  '/api/artists',
];

// ── Install: cache app shell ───────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ─────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_APP && k !== CACHE_DATA && k !== CACHE_IMG)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch strategy ─────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Skip non-same-origin
  if (url.origin !== self.location.origin) {
    // Cache album cover images from Discogs/Spotify
    if (url.hostname.includes('discogs.com') || url.hostname.includes('scdn.co')) {
      e.respondWith(cacheFirst(e.request, CACHE_IMG, 7 * 24 * 60 * 60)); // 7 days
    }
    return;
  }

  // API routes: stale-while-revalidate for data routes
  if (url.pathname.startsWith('/api/')) {
    const isCacheable = CACHE_API.some(p => url.pathname.startsWith(p));
    if (isCacheable) {
      e.respondWith(staleWhileRevalidate(e.request, CACHE_DATA));
    }
    return; // Other API routes: network only
  }

  // App shell: cache first, fallback to network
  e.respondWith(cacheFirst(e.request, CACHE_APP));
});

// ── Cache strategies ──────────────────────────────────────────

// Cache first — serve from cache if available, fallback to network
async function cacheFirst(request, cacheName, maxAgeSeconds) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Check max age if specified
    if (maxAgeSeconds) {
      const dateHeader = cached.headers.get('date');
      if (dateHeader) {
        const ageMs = Date.now() - new Date(dateHeader).getTime();
        if (ageMs > maxAgeSeconds * 1000) {
          // Expired — fetch fresh in background
          fetch(request).then(res => { if (res.ok) cache.put(request, res.clone()); }).catch(() => {});
        }
      }
    }
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// Stale-while-revalidate — serve cached immediately, update cache in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Fetch fresh in background always
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  // Return cached immediately, or wait for network if nothing cached
  return cached || fetchPromise || new Response(
    JSON.stringify({ error: 'Offline', offline: true }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

// ── Push notifications ─────────────────────────────────────────
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch { data = { title: 'Metal Vault', body: e.data?.text() }; }

  e.waitUntil(self.registration.showNotification(data.title || 'Metal Vault', {
    body:     data.body    || '',
    icon:     data.icon    || '/icons/icon-192.png',
    badge:    data.badge   || '/icons/icon-192.png',
    vibrate:  [200, 100, 200],
    data:     { url: data.url || '/' },
    tag:      data.tag     || 'metal-vault',
    renotify: true,
    actions:  [
      { action: 'view',    title: '👁 View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url); return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Background sync message ────────────────────────────────────
// Clients can send { type: 'SKIP_WAITING' } to force SW update
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
