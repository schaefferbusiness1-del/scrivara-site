/* MLS service worker — production/offline shell and publication backstop.
 *
 * HTML is network-first. Exact ?v= JavaScript/CSS assets are immutable and
 * cache-first. API traffic is never intercepted. The publication allowlist in
 * _config.yml is the primary boundary; the lists below independently prevent a
 * retired route from being replayed by an older browser cache or opened as an
 * HTML navigation if a future static-site configuration regresses.
 */
const CACHE = 'mls-v205';

const SHELL = [
  '/ScribeFlow.html',
  '/clinical-state-purge.js?v=20260718csp1',
  '/public-preview-policy.js?v=b497',
  '/public-preview-runtime.js?v=20260802pv713',
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
  'app.html',
  'patient-portal.html',
  'phone-setup.html',
  'phone.html',
  'privacy.html',
  'review-finder.html',
  'scribeflow.html',
  'terms.html'
]);

const RETIRED_ASSET_PATHS = new Set([
  '/feat_mls_copilot_voice_v2.js','/feat_mls_voice_commands.js','/feat_mls_voice_ai.js','/feat_mls_voice_copilot.js','/feat_mls_voice_ai_micbridge.js',
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

/* THE ONE-LITERAL ALLOWLIST WAS A SELF-INFLICTED 410 AT EVERY RELEASE.
 * ---------------------------------------------------------------------------
 * This used to read `if (name === 'mls_assist_v<THIS RELEASE>.zip') return false;`
 * — a single hardcoded filename. A service worker keeps controlling a page until
 * every tab closes, and this one deliberately declines skipWaiting() (see the
 * install handler) because taking over a live clinical tab can force a reload.
 * So at EVERY extension release the worker already running in a doctor's browser
 * carried the PREVIOUS release's literal, classified the NEW package as retired,
 * and answered the download with 410 "not a public MLS page" — while curl and
 * every test saw a healthy 200 on the origin.
 *
 * Measured live by the QA lane on 2026-08-06 (owner's Chrome, build b903):
 *   /MLS_Assist_v3.0.55.zip -> 410      (the current release, blocked)
 *   /MLS_Assist_v3.0.44.zip -> 404      (passthrough — the stale worker's literal)
 *   getRegistration() -> active + waiting, and the worker did NOT roll across
 *   three successive production deploys.
 *
 * A version FLOOR removes the per-release edit that nobody can remember to make.
 * It stays fail-closed by default — the zip branch still returns true unless all
 * three conditions hold — and is ROOT-ONLY, so a released-looking name under
 * extension-candidates/ or any other directory can never pass on basename alone.
 * Raising the floor is optional tightening, never a correctness requirement.
 *
 * Deliberately NOT done here: reading extension-version.json at runtime (puts a
 * network fetch inside the fetch decision and must then choose a failure
 * direction), and a bare family regex (would re-open 60+ historical archives and
 * every candidate build). */
const RELEASED_PACKAGE_FLOOR = [3, 0, 54];
const RELEASE_PACKAGE_NAME = /^mls_assist_v(\d{1,6}(?:\.\d{1,6}){1,3})\.zip$/;

function packageVersionAtOrAboveFloor(version) {
  const parts = String(version).split('.').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return false;
  const width = Math.max(parts.length, RELEASED_PACKAGE_FLOOR.length);
  for (let index = 0; index < width; index += 1) {
    const found = parts[index] || 0;
    const floor = RELEASED_PACKAGE_FLOOR[index] || 0;
    if (found !== floor) return found > floor;
  }
  return true;
}

function isPublicReleasePackage(pathname) {
  const match = RELEASE_PACKAGE_NAME.exec(baseName(pathname));
  if (!match) return false;
  if (pathname !== '/' + match[0]) return false;   /* root only */
  return packageVersionAtOrAboveFloor(match[1]);
}

function isRetiredPath(urlLike) {
  const pathname = normalizedPath(urlLike);
  const name = baseName(pathname);
  if (isInternalDirectory(pathname)) return true;
  if (RETIRED_ASSET_PATHS.has(name)) return true;
  if (/\.html$/.test(name)) {
    return !PUBLIC_HTML_PATHS.has(name);
  }
  /* Owner directive 2026-07-20: the exact RELEASED package is public. Network
   * passthrough only — isSafeCacheUrl still refuses to cache any ZIP, and every
   * candidate/historical ZIP stays fail-closed. */
  if (/\.zip$/.test(name)) return !isPublicReleasePackage(pathname);
  if (/\.staging\.js$/.test(name) || /_append_[^/]*\.js$/.test(name)) return true;
  return name === 'bg_worker_block.js';
}

const STATIC_SHELL_PATHS = new Set(SHELL.map((entry) => normalizedPath(entry)));

/* These documents can receive capability/auth tokens in fragments (which a
 * service worker cannot see). Their navigations are therefore network-only
 * even when the visible request URL has no query string. */
const NETWORK_ONLY_HTML_PATHS = new Set([
  /* app.html renders a patient's chart. A cached copy of it is not a risk in
     itself (the page holds no data — every patient it shows arrives over the
     API at runtime), but a stale shell is: the app the doctor launches must be
     the one currently deployed, and this page is also the source the two store
     binaries are built from. Never serve it from a cache. */
  '/app.html',
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

/* ph-offline-1.0.0 (2026-07-25, phone lane): mode flags that carry NO
 * capability and may therefore still resolve to the cached shell offline.
 *
 * Why this exception exists at all: `?phone=1` is the exact URL the pairing QR
 * and the setup email hand to a phone (mls-connect.js PHONE_URL). Because every
 * query previously failed closed here, that one URL was a browser error page
 * offline while the BYTE-IDENTICAL /ScribeFlow.html sat in the cache — the one
 * address we tell phones to use was the one address that could not open.
 *
 * The exception is deliberately a whitelist of exact strings, not a relaxation:
 *   - it is secret-free. Contrast /appointment.html?token=, /booking.html?code=,
 *     /intake.html?invite=, /patient-portal.html?token= — all still fail closed,
 *     and ?demo=1 stays closed too (it selects a different data universe).
 *   - it changes nothing about behaviour: __mlsPhoneHome persists phone mode in
 *     sessionStorage, so the served shell resolves to the same UI.
 *   - it is READ-ONLY. isSafeCacheUrl still rejects every query, so the query
 *     URL is never written to the cache and purgeUnsafeCacheEntries still
 *     removes any that somehow appears.
 * ?phone=0 is included because it is the documented escape hatch back to the
 * full app; failing it closed offline is the same defect mirrored. */
const SAFE_SHELL_QUERIES = new Set(['?phone=1', '?phone=0']);

function offlineShellKey(url) {
  if (!url) return '';
  if (url.search && !SAFE_SHELL_QUERIES.has(url.search)) return '';
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
    /* Ask the CURRENT cache first. The previous form called caches.match()
     * across every cache and then wrote the hit back with cache.put() on EVERY
     * request - including the overwhelmingly common case where the entry it had
     * just read was already in CACHE. That is a disk-backed CacheStorage write
     * per asset per boot: measured 1.7ms each, ~350ms across the 205 assets this
     * app requests after login, on the single service-worker thread that every
     * other asset is queued behind.
     *
     * The promotion below is still the point of this branch, so it is kept
     * exactly - an entry found only in an older named cache is still copied into
     * CACHE before activation retires that cache, which is what preserves
     * immutable runtime assets offline. It just no longer re-writes entries that
     * are already where they belong. */
    const response = caches.open(CACHE).then((current) => current.match(req).then((currentHit) => {
      if (currentHit) return currentHit;
      return caches.match(req).then((cached) => {
        if (cached) {
          /* Hit in an older named cache: promote it once. */
          if (isSafeCacheUrl(url)) {
            const copy = cached.clone();
            cacheWrite = current.put(req, copy).catch(() => {});
          }
          return cached;
        }
        return fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.ok && networkResponse.status === 200 && networkResponse.type === 'basic' && isSafeCacheUrl(url)) {
            const copy = networkResponse.clone();
            cacheWrite = current.put(req, copy).catch(() => {});
          }
          return networkResponse;
        });
      });
    })).catch(() => caches.match(req).then((cached) => cached || Response.error()));
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
      /* ph-offline-1.0.0: a NAVIGATION whose only query is a secret-free mode
         flag (SAFE_SHELL_QUERIES) may still fall back to the cached shell, even
         though isSafeCacheUrl rejects it for caching purposes. Read-only: the
         query URL itself is never stored. */
      const shellKey = isNav ? offlineShellKey(url) : '';
      if (!isSafeCacheUrl(url)) {
        if (!shellKey) return Response.error();
        return caches.match(shellKey).then((shell) => shell || Response.error());
      }
      return caches.match(req).then((cached) => {
        if (cached) return cached;
        if (!isNav) return Response.error();
        return shellKey ? caches.match(shellKey).then((shell) => shell || Response.error()) : Response.error();
      });
    });
  e.respondWith(response);
  e.waitUntil(response.then(() => cacheWrite).catch(() => {}));
});
