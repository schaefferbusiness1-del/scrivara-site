/* MLS service worker — enables install (PWA) + offline shell.
   Strategy: NETWORK-FIRST for same-origin requests so users always get the
   latest deployed app when online (avoids stale-version problems); falls back
   to cache only when offline. The API backend (onrender.com) is never cached.

   v2 (2026-06-08): self-healing update. The cache name is bumped so the
   activate handler deletes every older cache — this purges any bad responses
   (e.g. a 404 page cached while a deploy was mid-flight). We now ALSO refuse to
   cache anything that isn't a real 200 OK, so an error page can never be stored
   and replayed. Changing this file's bytes makes browsers fetch, install, and
   (via skipWaiting + clients.claim) immediately activate this new worker, so
   existing visitors self-heal on their next load with no manual cache clearing. */
const CACHE = 'mls-v2';
const SHELL = [
  'ScribeFlow.html',
  'index.html',
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
        // Cache ONLY genuine, complete 200 OK responses — never 404s, redirects,
        // or opaque/error responses, so a bad page can't be stored and replayed.
        if (res && res.ok && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('ScribeFlow.html')))
  );
});
