'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'review-finder.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'mls_reviews_scrape_app.js'), 'utf8');

assert(/name=["']referrer["'][^>]+no-referrer/i.test(page), 'review finder must not send referrers to review sites');
assert(/name=["']robots["'][^>]+noindex/i.test(page), 'review finder must not be indexed');
assert(/Content-Security-Policy/i.test(page) && /connect-src[^;]+scrivara-backend\.onrender\.com/i.test(page), 'review finder needs an exact backend CSP');

assert(!/setTimeout\s*\(\s*function\s*\(\)\s*\{\s*try\s*\{\s*window\.__repScan\s*\(/s.test(page), 'loading the page must not start a reputation scan');
assert(!/window\.save\s*=\s*function[\s\S]{0,300}?__repScan\s*\(/.test(page), 'saving profile fields must not start a reputation scan');
assert(/Network scans are explicit only/.test(page), 'explicit-only scan boundary marker is missing');

assert(/function\s+safeReviewUrl\s*\(/.test(page) && /function\s+safeReviewUrl\s*\(/.test(app), 'both renderers must validate outbound URLs');
for (const source of [page, app]) {
  assert(/protocol\s*!==\s*['"]https:/.test(source), 'outbound URL validation must require HTTPS');
  assert(/u\.username\s*\|\|\s*u\.password/.test(source), 'outbound URL validation must reject credential-bearing URLs');
  assert(/REVIEW_HOSTS/.test(source), 'outbound URL validation must use an exact review-host allowlist');
}
assert(!/href=["']\s*\+\s*h\(L\.url\)|href=["']\s*\+\s*esc\(L\.url\)/.test(page + app), 'backend listing URLs must not enter href without validation');
assert(!/href=["']\s*\+\s*h\(m\.url\)|href=["']\s*\+\s*esc\(r\.sourceUrl\)/.test(page + app), 'manual/review citation URLs must not enter href without validation');
assert(!/onclick=["']copyText\([^"']*picks\.join/.test(page), 'pasted review text must never be interpolated into an inline handler');
assert(/qCopyAll[\s\S]{0,300}?addEventListener\s*\(\s*['"]click/.test(page), 'quote copying must use a bound event handler');

assert(/\/api\/reviews\/find["']\s*,\s*\{\s*method:\s*["']POST["']/s.test(page), 'profile data must use the POST review endpoint');
for (const source of [page, app]) {
  assert(/cache:\s*['"]no-store['"]/.test(source), 'review requests must bypass caches');
  assert(/referrerPolicy:\s*['"]no-referrer['"]/.test(source), 'review requests must suppress referrers');
}

/* The scraper's cache key is a correctness boundary, not a naming detail.
 * v1.4.1 moved it from mlsRFScrapeCache to mlsRFScrapeCache2 specifically to
 * abandon v1.4.0 payloads, which can carry a verified:true left behind by a
 * confirm-then-undo and would keep counting an unconfirmed listing toward the
 * headline. The writer moved and five reading surfaces did not, so they read a
 * key nothing writes - and on any browser still holding one, exactly the stale
 * format the rename existed to quarantine. Readers must name the live key, and
 * must not "fall back" to the retired one, which would re-admit those payloads.
 * clinical-state-purge.js is the sole exception: it must keep naming both so a
 * browser holding the retired key still gets it cleared. */
{
  const root = path.resolve(__dirname, '..');
  const retired = /mlsRFScrapeCache(?!2)/;
  const offenders = [];
  for (const file of fs.readdirSync(root)) {
    if (!/\.(?:js|html)$/.test(file) || file === 'clinical-state-purge.js') continue;
    if (retired.test(fs.readFileSync(path.join(root, file), 'utf8'))) offenders.push(file);
  }
  assert.deepStrictEqual(offenders, [], `these surfaces name the retired review-scrape cache key: ${offenders.join(', ')}`);

  const writer = fs.readFileSync(path.join(root, 'mls_reviews_scrape_app.js'), 'utf8');
  assert(/CACHE_KEY\s*=\s*'mlsRFScrapeCache2'/.test(writer), 'the scraper must still own the live cache key this guard is anchored to');
  const purge = fs.readFileSync(path.join(root, 'clinical-state-purge.js'), 'utf8');
  assert(/'mlsRFScrapeCache'/.test(purge) && /'mlsRFScrapeCache2'/.test(purge), 'the purge list must clear both the live and the retired key');
}

console.log('PASS review finder security boundary: explicit scans, POST/no-store, safe HTTPS review links, inert pasted text, single live scrape-cache key');
