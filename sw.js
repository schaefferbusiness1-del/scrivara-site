/* MLS service worker — enables install (PWA) + offline shell.
   Strategy: NETWORK-FIRST for same-origin requests so users always get the
   latest deployed app when online (avoids stale-version problems); falls back
   to cache only when offline. The API backend (onrender.com) is never cached. */
const CACHE = 'mls-v1';
const SHELL = [
  'ScribeFlow.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // Never intercept the API backend — always go straight to network.
  if (url.hostname.indexOf('onrender.com') > -1) return;
  // Only handle same-origin (the app + its assets).
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('ScribeFlow.html')))
  );
});
