/**
 * Service Worker — offline caching for PWA
 */
const CACHE_NAME = 'cashio-v1';

// Files to cache for offline use
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './manifest.json',
  './js/store.js',
  './js/utils.js',
  './js/app.js',
  './js/services/stock-price.js',
  './js/components/modal.js',
  './js/components/charts.js',
  './js/components/notion-sync.js',
  './js/pages/dashboard.js',
  './js/pages/transactions.js',
  './js/pages/events.js',
  './js/pages/banks.js',
  './js/pages/subscriptions.js',
  './js/pages/tw-stocks.js',
  './js/pages/us-stocks.js',
  './js/pages/settings.js',
];

// External CDN resources
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// ── Install: pre-cache static assets ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache local assets (ignore CDN failures — they'll be fetched live when online)
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ─────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache, fallback to network ──────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and chrome-extension requests
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // Exchange rate API: network-first (needs live data), no cache
  if (url.hostname === 'api.exchangerate-api.com') {
    event.respondWith(fetch(request).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // All other requests: cache-first strategy
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // Cache successful responses for local assets
        if (response.ok && (url.origin === self.location.origin || CDN_ASSETS.some(a => request.url.startsWith(a.split('/').slice(0, 3).join('/'))))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: serve index.html for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
