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

console.log('PASS review finder security boundary: explicit scans, POST/no-store, safe HTTPS review links, inert pasted text');
