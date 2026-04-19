// ── Metal Vault Service Worker ────────────────────────────────
// Auto-updates on every new deploy — no manual cache clearing needed.

const VERSION    = 'mv-v10';  // bump this on every deploy
const CACHE_APP  = VERSION + '-app';
const CACHE_DATA = VERSION + '-data';
const CACHE_IMG  = VERSION + '-img';

const APP_SHELL = ['/', '/manifest.json', '/icons/icon-192.png'];

const CACHE_API = [
  '/api/collection',
  '/api/watchlist',
  '/api/portfolio',
  '/api/releases',
  '/api/artists',
];

// ── Install ───────────────────────────────────────────────────
self.addEventListener('install', e => {
  // Skip waiting immediately — don't wait for old SW to die
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_APP).then(c => c.addAll(APP_SHELL)).catch(() => {})
  );
});

// ── Activate — delete ALL old caches ─────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_APP && k !== CACHE_DATA && k !== CACHE_IMG)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
      .then(() => {
        // Tell all open tabs to reload with fresh code
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
        });
      })
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // External: cache Discogs/Spotify images for 7 days
  if (url.hostname.includes('discogs.com') || url.hostname.includes('scdn.co')) {
    e.respondWith(cacheFirst(e.request, CACHE_IMG, 7 * 24 * 60 * 60));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // API data: stale-while-revalidate
  if (url.pathname.startsWith('/api/')) {
    const cacheable = CACHE_API.some(p => url.pathname.startsWith(p));
    if (cacheable) e.respondWith(staleWhileRevalidate(e.request, CACHE_DATA));
    return;
  }

  // App shell: network first, fallback to cache (always gets latest code)
  e.respondWith(networkFirst(e.request, CACHE_APP));
});

// Network first — tries network, falls back to cache
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// Cache first — serve cached, refresh in background
async function cacheFirst(request, cacheName, maxAgeSeconds) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    if (maxAgeSeconds) {
      const date = cached.headers.get('date');
      if (date && (Date.now() - new Date(date).getTime()) > maxAgeSeconds * 1000) {
        fetch(request).then(r => { if (r.ok) cache.put(request, r.clone()); }).catch(() => {});
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

// Stale-while-revalidate — instant cached response, update in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(r => {
    if (r.ok) cache.put(request, r.clone());
    return r;
  }).catch(() => null);
  return cached || fetchPromise || new Response(
    JSON.stringify({ offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

// ── Push notifications ─────────────────────────────────────────
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch { data = { title: 'Metal Vault', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Metal Vault', {
    body: data.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200], data: { url: data.url || '/' },
    tag: data.tag || 'metal-vault', renotify: true,
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url); return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Messages ──────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
