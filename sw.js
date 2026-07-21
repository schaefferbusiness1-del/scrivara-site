/* MLS service worker — production/offline shell and publication backstop.
 *
 * HTML is network-first. Exact ?v= JavaScript/CSS assets are immutable and
 * cache-first. API traffic is never intercepted. The publication allowlist in
 * _config.yml is the primary boundary; the lists below independently prevent a
 * retired route from being replayed by an older browser cache or opened as an
 * HTML navigation if a future static-site configuration regresses.
 */
const CACHE = 'mls-v58';

const SHELL = [
  '/ScribeFlow.html',
  '/clinical-state-purge.js?v=20260718csp1',
  '/public-preview-policy.js?v=b471',
  '/public-preview-runtime.js?v=b471',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

/* Exact public navigation inventory. Keep synchronized with _config.yml and
 * tests/public-publication-boundary.test.js. Names are lower-case here because
 * URL classification is case-insensitive; GitHub Pages remains case-sensitive. */
const PUBLIC_HTML_PATHS = new Set([
  '404.html',
  'appointment.html',
  'assist.html',
  'assist-privacy.html',
  'best-doctors-optout.html',
  'booking.html',
  'expert.html',
  'gbp-setup.html',
  'get-extension.html',
  'index.html',
  'intake.html',
  'lawyers.html',
  'patient-portal.html',
  'phone.html',
  'privacy.html',
  'review-finder.html',
  'scribeflow.html',
  'terms.html'
]);

const RETIRED_ASSET_PATHS = new Set([
  'feat_mls_best_doctors.js',
  'feat_mls_review_request.js',
  'legal-connect-ui.js',
  'legal-chart-fill-ui.js',
  'legal-tracker.js',
  'feat_mls_expert_top.js',
  'feat_mls_legal_exact.js',
  'feat_mls_legal_pay_setup.js',
  'feat_mls_legal_paywidget.js',
  'feat_mls_legalpack.js',
  'feat_mls_navfeat_keep.js',
  'feat_mls_staff_hub.js',
  'feat_mls_team_exact.js',
  'manifest.json',
  'background.js',
  'destination_teach_navigation_guard.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.js',
  'mls-popup.js',
  'mls-popup.css',
  'offscreen.html',
  'offscreen.js',
  'feat_codes_driver.js',
  'ext_reviews_reader.js',
  'write_safety_guard.js',
  'review_screen.js',
  'teach_destination_memory.js'
]);

/* Only these audited, provenance-pinned browser runtimes are publishable from
 * /vendor. Everything else under that directory remains package-only. */
const APPROVED_VENDOR_ASSET_PATHS = new Set([
  '/vendor/chart.umd-4.5.1.js',
  '/vendor/xlsx.full-0.20.3.min.js',
  '/vendor/pdf-6.1.200.min.mjs',
  '/vendor/pdf.worker-6.1.200.min.mjs',
  '/vendor/mammoth.browser-1.12.0.min.js',
  '/vendor/jspdf.umd-4.2.1.min.js'
]);

function normalizedPath(urlLike) {
  let pathname = '';
  try { pathname = new URL(String(urlLike || ''), self.location.origin).pathname || '/'; }
  catch (_) { return '/'; }
  try { pathname = decodeURIComponent(pathname); } catch (_) { /* keep encoded path */ }
  return pathname.replace(/\/{2,}/g, '/').toLowerCase();
}

function baseName(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function isInternalDirectory(pathname) {
  if (APPROVED_VENDOR_ASSET_PATHS.has(pathname)) return false;
  return /(?:^|\/)(?:tests|scripts|tmp|tools|_ws_tools|node_modules|vendor)(?:\/|$)/.test(pathname);
}

function isRetiredPath(urlLike) {
  const pathname = normalizedPath(urlLike);
  const name = baseName(pathname);
  if (isInternalDirectory(pathname)) return true;
  if (RETIRED_ASSET_PATHS.has(name)) return true;
  if (/\.html$/.test(name)) {
    return !PUBLIC_HTML_PATHS.has(name);
  }
  /* Owner directive 2026-07-20: the EXACT released 3.0.0 package is public.
   * Network passthrough only — isSafeCacheUrl still refuses to cache any ZIP,
   * and every other (candidate/historical) ZIP stays fail-closed below. */
  if (name === 'mls_assist_v3.0.0.zip') return false;
  if (/\.zip$/.test(name)) return true;
  if (/\.staging\.js$/.test(name) || /_append_[^/]*\.js$/.test(name)) return true;
  return name === 'bg_worker_block.js';
}

const STATIC_SHELL_PATHS = new Set(SHELL.map((entry) => normalizedPath(entry)));

/* These documents can receive capability/auth tokens in fragments (which a
 * service worker cannot see). Their navigations are therefore network-only
 * even when the visible request URL has no query string. */
const NETWORK_ONLY_HTML_PATHS = new Set([
  '/appointment.html',
  '/best-doctors-optout.html',
  '/booking.html',
  '/intake.html',
  '/patient-portal.html',
  '/phone.html',
]);

function isNetworkOnlyNavigation(urlLike) {
  const url = urlLike instanceof URL ? urlLike : parsedSameOriginUrl(urlLike);
  return !!(url && NETWORK_ONLY_HTML_PATHS.has(normalizedPath(url.href)));
}

function parsedSameOriginUrl(urlLike) {
  try {
    const url = new URL(String(urlLike || ''), self.location.origin);
    return url.origin === self.location.origin ? url : null;
  } catch (_) {
    return null;
  }
}

function isUnsafePhoneQuery(urlLike) {
  const url = urlLike instanceof URL ? urlLike : parsedSameOriginUrl(urlLike);
  return !!(url && normalizedPath(url.href) === '/phone.html' && url.search);
}

function isExactVersionedAsset(urlLike) {
  const url = urlLike instanceof URL ? urlLike : parsedSameOriginUrl(urlLike);
  if (!url || !/\.(?:m?js|css|woff2?)$/i.test(url.pathname)) return false;
  const keys = Array.from(url.searchParams.keys());
  if (keys.length !== 1 || keys[0] !== 'v') return false;
  return /^[A-Za-z0-9._-]{1,96}$/.test(url.searchParams.get('v') || '');
}

function isSafeCacheUrl(urlLike) {
  const url = urlLike instanceof URL ? urlLike : parsedSameOriginUrl(urlLike);
  if (!url || isRetiredPath(url.href)) return false;
  if (isExactVersionedAsset(url)) return true;
  if (url.search) return false;
  const pathname = normalizedPath(url.href);
  if (NETWORK_ONLY_HTML_PATHS.has(pathname)) return false;
  return pathname === '/' || STATIC_SHELL_PATHS.has(pathname);
}

function offlineShellKey(url) {
  if (!url || url.search) return '';
  const pathname = normalizedPath(url.href);
  if (pathname === '/') return '/index.html';
  if (pathname === '/index.html') return '/index.html';
  if (pathname === '/scribeflow.html') return '/ScribeFlow.html';
  return '';
}

function blockedResponse() {
  return new Response('This retired, package-only, or unsafe query route is not a public MLS page.', {
    status: 410,
    statusText: 'Gone',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function purgeUnsafeCacheEntries() {
  const names = await caches.keys();
  await Promise.all(names.map(async (cacheName) => {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    await Promise.all(requests.filter((request) => !isSafeCacheUrl(request.url)).map((request) => cache.delete(request)));
  }));
}

self.addEventListener('install', (event) => {
  /* Do not call skipWaiting(): taking over an active clinical tab can trigger
   * controllerchange reload behavior. The waiting worker still purges retired
   * entries from old caches immediately, without taking control of the tab. */
  event.waitUntil(Promise.all([
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})),
    purgeUnsafeCacheEntries().catch(() => {})
  ]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => purgeUnsafeCacheEntries().catch(() => {}))
    /* Do not call clients.claim(); activation waits for a natural page load. */
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  const accept = req.headers && req.headers.get ? (req.headers.get('accept') || '') : '';
  const isNav = req.mode === 'navigate' || accept.indexOf('text/html') > -1;

  /* The Jekyll build should make retired files unreachable. This independent
   * response prevents cache replay and also fails closed if publication config
   * is ever bypassed. Candidate extension source and every ZIP are retired. */
  if (isRetiredPath(url.href) || isUnsafePhoneQuery(url)) {
    e.respondWith(Promise.resolve(blockedResponse()));
    return;
  }

  const isVersionedAsset = !isNav && url.searchParams.has('v') && /\.(?:m?js|css|woff2?)$/i.test(url.pathname) && isExactVersionedAsset(url);
  if (isVersionedAsset) {
    let cacheWrite = Promise.resolve();
    const response = caches.match(req).then((cached) => {
      if (cached) {
        /* Promote a safe hit from an older named cache before activation
         * retires that cache, preserving immutable runtime assets offline. */
        if (isSafeCacheUrl(url)) {
          const copy = cached.clone();
          cacheWrite = caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return cached;
      }
      return fetch(req).then((networkResponse) => {
      if (networkResponse && networkResponse.ok && networkResponse.status === 200 && networkResponse.type === 'basic' && isSafeCacheUrl(url)) {
        const copy = networkResponse.clone();
        cacheWrite = caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return networkResponse;
      });
    }).catch(() => caches.match(req).then((cached) => cached || Response.error()));
    e.respondWith(response);
    e.waitUntil(response.then(() => cacheWrite).catch(() => {}));
    return;
  }

  /* Token-capable documents are network/no-store even when their capability is
   * in a fragment (fragments are invisible here). Other navigations reload so
   * a newly deployed shell is still discovered immediately. */
  const fetchReq = isNav
    ? new Request(req, { cache: (isNetworkOnlyNavigation(url) || !!url.search) ? 'no-store' : 'reload' })
    : req;
  let cacheWrite = Promise.resolve();
  const response = fetch(fetchReq)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok && networkResponse.status === 200 && networkResponse.type === 'basic' && isSafeCacheUrl(url)) {
        const copy = networkResponse.clone();
        cacheWrite = caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return networkResponse;
    })
    .catch(() => {
      if (!isSafeCacheUrl(url)) return Response.error();
      return caches.match(req).then((cached) => {
        if (cached) return cached;
        if (!isNav) return Response.error();
        const shellKey = offlineShellKey(url);
        return shellKey ? caches.match(shellKey).then((shell) => shell || Response.error()) : Response.error();
      });
    });
  e.respondWith(response);
  e.waitUntil(response.then(() => cacheWrite).catch(() => {}));
});
