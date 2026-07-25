'use strict';

/* ScribeFlow-staging.html must carry the SAME release stamp as production.
 *
 * The staging shell sets its own `window.__MLS_AV` and loads its bundle from
 * it — `s.src = 'mls-connect.staging.js?v=' + window.__MLS_AV` — so one token
 * governs the whole staging surface. When the build bump touches production and
 * misses staging, staging keeps requesting the URL it requested last time, and a
 * service worker serving versioned assets cache-first hands back the OLD staging
 * bundle. Whoever is testing there then exercises code that is not what shipped,
 * and can "verify" a fix that is not in the file they are looking at. That is
 * the same class of failure as the frozen `?v=` token that cost six builds
 * (tests/calm-shell-cache-bust.test.js), just on the surface nobody watches.
 *
 * It has now drifted three separate times and been corrected by hand each time:
 *   b586  production b586, staging b585
 *   b587  production b587, staging b585
 *   b598  production b598, staging b595
 * Nothing caught any of them, because every existing suite that reads
 * ScribeFlow-staging.html checks feature parity, not the stamp.
 *
 * SCOPE, stated so nobody over-reads this: staging is NOT published. Both
 * ScribeFlow-staging.html and mls-connect.staging.js return 404 on
 * mlsscribe.com, and the publication boundary classifies the page as retired.
 * So this is a correctness guard for the dev surface and for repo hygiene — not
 * a live defect, and not a reason to bump a build on its own.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function stampOf(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const m = /window\.__MLS_AV\s*=\s*'(b\d+)'/.exec(src);
  assert(m, file + ' no longer declares a window.__MLS_AV release stamp');
  return m[1];
}

const production = stampOf('ScribeFlow.html');
const staging = stampOf('ScribeFlow-staging.html');

assert.strictEqual(staging, production,
  'ScribeFlow-staging.html is stamped ' + staging + ' while production is ' + production + '.\n' +
  'The staging loader builds its bundle URL from this token, so staging will keep serving the\n' +
  'bundle cached under ' + staging + ' and anyone testing there is exercising stale code.\n' +
  'Bump staging with production — read its OWN current token rather than assuming it equals\n' +
  "production's, because it does not always.");

/* the loader must actually derive the bundle URL from that stamp - if it ever
   hardcodes a token instead, equality above stops meaning anything */
const stagingSrc = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
assert(/mls-connect\.staging\.js\?v='\s*\+\s*window\.__MLS_AV/.test(stagingSrc),
  'the staging loader no longer derives its bundle URL from window.__MLS_AV, so pinning the ' +
  'stamp no longer pins what staging actually loads');

console.log('PASS staging stamp follows production: ScribeFlow-staging.html is stamped ' + staging + ', matching production');
