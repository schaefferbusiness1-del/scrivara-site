'use strict';

/* PREVIEW ROUTE CANONICALIZER (pvc-1.0.0, b858) — proven by execution.
 *
 * The public-preview safety boundary matches location.search === '?preview=1'
 * EXACTLY, by design (fail-closed clinical isolation). Before this fix, a
 * preview link that arrived with any extra query parameter — utm tags, share
 * trackers, a stray cache-buster — silently fell through to the LOGIN WALL:
 * the exact prospect the sample day exists for saw a sign-in form instead.
 *
 * The fix canonicalizes instead of loosening: one location.replace to the
 * exact route, after which the boundary arms normally. This suite executes
 * the real extracted IIFE against stubbed locations and asserts every branch:
 * canonicalize when (and only when) a preview param arrives dirty, never
 * loop, never touch non-preview or non-app routes, and stand down when the
 * policy is already active. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* extract the real IIFE — never a re-implementation */
const start = app.indexOf('/* pvc-1.0.0:');
assert(start > 0, 'the pvc-1.0.0 canonicalizer is gone from ScribeFlow.html');
const openTag = app.lastIndexOf('<script>', start);
const closeTag = app.indexOf('</script>', start);
assert(openTag > 0 && closeTag > openTag, 'could not extract the pvc script block');
const src = app.slice(openTag + '<script>'.length, closeTag);

/* the canonicalizer must run AFTER the safety boundary, in its own block */
const boundaryAt = app.indexOf("u.search==='?preview=1'");
assert(boundaryAt > 0 && boundaryAt < start, 'pvc must sit after the exact-match boundary guard');

function run(href, policy) {
  const replaced = [];
  const ctx = {
    URL: URL,
    location: { href, replace: (u) => replaced.push(u) },
    window: {}
  };
  Object.defineProperty(ctx.location, 'search', { get() { return new URL(href).search; } });
  if (policy !== undefined) ctx.window.__MLS_PUBLIC_PREVIEW = policy;
  vm.runInNewContext(src, ctx, { filename: 'pvc-1.0.0.js' });
  return replaced;
}

const BASE = 'https://mlsscribe.com/ScribeFlow.html';

/* 1. the bug case: a utm-tagged preview link canonicalizes to the exact route */
assert.deepStrictEqual(run(BASE + '?preview=1&utm_source=share'), ['/ScribeFlow.html?preview=1'],
  'a preview link with extra params must canonicalize, not dead-end on the login wall');
assert.deepStrictEqual(run(BASE + '?utm_source=share&preview=1'), ['/ScribeFlow.html?preview=1'],
  'param order must not matter');

/* 2. no loop: the exact route is left alone */
assert.deepStrictEqual(run(BASE + '?preview=1'), [],
  'the exact route must never redirect (that would loop)');

/* 3. non-preview routes are untouched */
assert.deepStrictEqual(run(BASE), [], 'the bare app route must be untouched');
assert.deepStrictEqual(run(BASE + '?demo=1'), [], 'demo entry must be untouched');
assert.deepStrictEqual(run(BASE + '?preview=2&utm=x'), [], 'preview must equal exactly "1"');
assert.deepStrictEqual(run('https://mlsscribe.com/index.html?preview=1&utm=x'), [],
  'other pages must be untouched');

/* 4. an armed policy stands the canonicalizer down (no reload under a live preview) */
assert.deepStrictEqual(run(BASE + '?preview=1&x=1', { enabled: true }), [],
  'an already-armed preview must never be reloaded out from under the user');

/* 5. an inactive policy object does not stand it down */
assert.deepStrictEqual(run(BASE + '?preview=1&x=1', { enabled: false }), ['/ScribeFlow.html?preview=1'],
  'the inactive marker must not block canonicalization');

console.log('PASS preview route canonicalize: dirty preview links reach the sample day through the exact fail-closed route — no loosened boundary, no loop, no login wall');
