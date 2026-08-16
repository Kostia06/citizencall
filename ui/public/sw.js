// CitizenCall service worker — deliberately minimal. Its jobs: make the app
// installable, and serve Vite's content-hashed /assets/* cache-first (they
// are immutable by name). EVERYTHING dynamic — /api, /auth, /oauth, the HTML
// shell — goes straight to the network: caching those would break SSE runs,
// auth freshness, and deploys.
const CACHE = 'citizencall-assets-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const cacheable =
    event.request.method === 'GET' && url.origin === self.location.origin && url.pathname.startsWith('/assets/');
  if (!cacheable) return; // fall through to the network untouched

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })
  );
});
