const CACHE_NAME = 'sitetactix-cache-v139';









const ASSETS = [
  '/logo.svg',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // Force active service worker immediately
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Clearing old service worker cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Only the app's own files. Google (Drive, Sheets, Firestore, fonts) and /api calls go straight
  // to the network: the browser handles them better, and routing them through here broke fonts.
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Never serve a cached HTML shell. Old HTML can reference chunks from a
  // previous deployment and leave the app blank after a release.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Offline and not saved: a normal network error instead of a crash
  e.respondWith(
    fetch(e.request).catch(async () => (await caches.match(e.request)) || Response.error())
  );
});
