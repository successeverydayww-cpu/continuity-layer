const CACHE = 'continuity-app-v7';
const ASSETS = [
  '/continuity-layer/app.html',
  '/continuity-layer/manifest-app.json',
  '/continuity-layer/icon-192.png',
  '/continuity-layer/icon-512.png',
  '/continuity-layer/icon-maskable-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // never cache API calls
  if (e.request.method !== 'GET') return;
  if (url.pathname.includes('/functions/')) return;
  // NETWORK-FIRST: every visit fetches the live version; cache only backs up offline
  e.respondWith(
    fetch(e.request).then(r => {
      const cp = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp));
      return r;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/continuity-layer/app.html')))
  );
});
