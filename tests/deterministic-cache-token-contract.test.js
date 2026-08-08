'use strict';

/* A versioned asset URL must carry the RELEASE token, never a per-load one.
 *
 * feat_autosave.js loaded two modules as `"...js?v=" + Date.now()`. That URL is
 * unique on every boot, so those two files were:
 *   - never a cache hit — re-downloaded on every single load, forever;
 *   - unreachable on an offline or flaky boot, because a service worker serving
 *     versioned URLs cache-first can never match a URL it has not seen before.
 * One of the two is feat_mls_record_backup.js — the recording safety net, the
 * module that exists precisely for when things go wrong. Measured live at b581:
 *   /feat_mls_record_backup.js?v=1784986325415   -> decodes to that page load.
 *
 * The established pattern, used by every other production satellite loader, is
 * `?v=' + (window.__MLS_AV || Date.now())`: deterministic per release, with
 * Date.now() only as a fallback if the release token is somehow absent.
 *
 * tests/immutable-satellite-loader-cache-contract.test.js cannot catch this — it
 * is an allowlist of 25 named assets, so any loader it does not name is
 * invisible to it. This is the general invariant. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/* Matches a script-src assignment whose cache token is ONLY Date.now(). The
   correct form puts `(window.__MLS_AV || ` between the "?v=" and the call, so it
   cannot match. Requiring `.src =` on the line keeps prose out: mls-connect.js
   carries a historical comment describing the old "?v='+Date.now()" scheme. */
const BARE = /\.src\s*=[^;]*\?v=["']?\s*\+\s*Date\.now\(\)/;

/* Positive control — the detector must actually detect. Without this, a scan
   that silently stopped matching would pass by finding nothing. */
assert(BARE.test('s.src = "/feat_mls_record_backup.js?v=" + Date.now();'),
  'the bare-token detector no longer detects the defect it exists for');
assert(BARE.test("s.src=A+'?v='+Date.now();"),
  'the detector misses the minified loader form');
assert(!BARE.test("s.src=A+'?v='+(window.__MLS_AV||Date.now());"),
  'the detector falsely flags the correct release-token pattern');
assert(!BARE.test(" *   RC1  48 loader sites cache-busted with ?v='+Date.now() => 52 JS files"),
  'the detector flags prose describing the old scheme');

function offendersIn(name) {
  const lines = fs.readFileSync(path.join(root, name), 'utf8').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (BARE.test(lines[i])) out.push(name + ':' + (i + 1));
  }
  return out;
}

/* mls-connect.staging.js is the staging bundle: it is loaded by
   ScribeFlow-staging.html and by nothing on the production page. It still
   carries 32 of these loaders. They are real debt, but they are not on the
   clinician's path, and rewriting 32 loader sites in the staging bundle is not
   something to fold into an unrelated production fix. This is a ratchet: the
   count may fall, never rise. When it reaches 0, delete the exemption. */
const STAGING = { 'mls-connect.staging.js': 32 };

const production = fs.readdirSync(root)
  .filter((name) => /\.(js|html)$/i.test(name))
  .filter((name) => !Object.prototype.hasOwnProperty.call(STAGING, name))
  .filter((name) => !/^ScribeFlow_test\.html$/i.test(name));

const bad = [];
for (const name of production) bad.push(...offendersIn(name));

assert.deepStrictEqual(bad, [],
  'these production loaders build a new asset URL on every page load, so the file is never a\n' +
  'cache hit and is missing entirely on an offline boot. Use (window.__MLS_AV || Date.now()):\n  ' +
  bad.join('\n  '));

for (const [name, ceiling] of Object.entries(STAGING)) {
  const n = offendersIn(name).length;
  assert(n <= ceiling,
    name + ' grew from ' + ceiling + ' to ' + n + ' per-load cache tokens; the ratchet only turns down');
}

/* the two that were actually wrong, asserted by name so a revert is loud */
const autosave = fs.readFileSync(path.join(root, 'feat_autosave.js'), 'utf8');
for (const asset of ['feat_mls_record_backup.js', 'feat_mls_uxpack1.js']) {
  assert(autosave.includes('"/' + asset + '?v=" + (window.__MLS_AV || Date.now())'),
    asset + ' no longer loads under the deterministic release token');
}

console.log('PASS deterministic cache tokens: ' + production.length +
  ' production assets carry the release token, none builds a per-load URL (staging ratchet <= 32)');
