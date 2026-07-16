/* MLS service worker — enables install (PWA) + offline shell.
   Strategy: network-first for HTML/unversioned requests; exact versioned app
   assets are immutable and cache-first. The API backend is never cached.

   v2 (2026-06-08): self-healing update. The cache name is bumped so the
   activate handler deletes every older cache — this purges any bad responses
   (e.g. a 404 page cached while a deploy was mid-flight). We now ALSO refuse to
   cache anything that isn't a real 200 OK, so an error page can never be stored
   and replayed. Changing this file's bytes makes browsers fetch, install, and
   (via skipWaiting + clients.claim) immediately activate this new worker, so
   existing visitors self-heal on their next load with no manual cache clearing. */
const CACHE = 'mls-v5';
const SHELL = [
  'ScribeFlow.html',
  'index.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  /* BUGFIX 2026-06-30: skipWaiting() removed — it force-activated new service workers on already-open tabs, firing controllerchange -> location.reload() and bouncing users to the home/Visit screen mid-visit. New version now applies on the next natural load (network-first already serves the latest app online). Revert: self.skipWaiting(); */
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => Promise.resolve()/* BUGFIX 2026-06-30: was self.clients.claim() — claiming already-open tabs is what fired controllerchange -> location.reload(), kicking users to the home screen. Revert: self.clients.claim() */)
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
  // For HTML page loads, bypass the browser's ~10-min HTTP cache so a freshly
  // deployed version is never hidden behind a stale cached page.
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') > -1;
  /* Versioned JS/CSS URLs are immutable: every deploy changes ?v=. Serve an
     already-cached exact version immediately instead of revalidating roughly
     200 feature assets after the CDN's short max-age. HTML stays network-first
     so a new build key is discovered normally. */
  const isVersionedAsset = !isNav && url.searchParams.has('v') && /\.(?:js|css|woff2?)$/i.test(url.pathname);
  if (isVersionedAsset) {
    let cacheWrite = Promise.resolve();
    const response =
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res && res.ok && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          cacheWrite = caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })).catch(() => caches.match(req).then((m) => m || Response.error()));
    e.respondWith(response);
    e.waitUntil(response.then(() => cacheWrite).catch(() => {}));
    return;
  }
  const fetchReq = isNav ? new Request(req.url, { cache: 'reload', credentials: 'same-origin' }) : req;
  let cacheWrite = Promise.resolve();
  const response =
    fetch(fetchReq)
      .then((res) => {
        // Cache ONLY genuine, complete 200 OK responses — never 404s, redirects,
        // or opaque/error responses, so a bad page can't be stored and replayed.
        if (res && res.ok && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          cacheWrite = caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('ScribeFlow.html')));
  e.respondWith(response);
  e.waitUntil(response.then(() => cacheWrite).catch(() => {}));
});
