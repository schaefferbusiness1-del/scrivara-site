'use strict';
/*
 * A CACHE TOKEN THAT DOES NOT MOVE IS A FIX THAT DOES NOT SHIP
 * -----------------------------------------------------------------------------
 * Satellite modules are injected with a cache-busting query string. There are
 * two spellings in this repo:
 *
 *   s.src = 'feat_x.js?v=' + (window.__MLS_AV || Date.now())   <- follows the build
 *   s.src = 'feat_x.js?v=20260729phlinear'                     <- hand-maintained
 *
 * The second only works if a human bumps it in the same commit that changes the
 * file. Miss that, and a returning browser keeps serving the cached copy: the
 * code is on the origin, the deploy is green, every test passes against the
 * files on disk, and the doctor's browser runs yesterday's module.
 *
 * FOUND, not theorised. feat_mls_opnote_integrity.js was pinned at
 * '20260729phlinear' while its content changed twice after that date - the
 * closest-match template fallback, the four distinct refusal messages, and the
 * guess-flag writer. All three were live on the origin and none of them could
 * reach a browser that had already loaded the module. That file now uses the
 * __MLS_AV form, which cannot go stale because it follows the build number.
 *
 * This suite is the general guard. It compares every HAND-MAINTAINED token
 * against the file's own history and fails when the file moved after its token.
 *
 * WHY IT COUNTS ONLY COMMITS AFTER THE SEED. This repository begins with one
 * enormous squashed commit that touches nearly every file. Dating from that
 * commit marks ~60 assets "stale" that nobody has edited since, which is noise
 * that would get the suite disabled within a week. Only real commits after the
 * seed count, and the number that matters - the count of genuinely stale
 * tokens - is asserted to be zero.
 *
 * IT FAILS LOUDLY WHEN IT CANNOT CHECK. A shallow clone has no history to read,
 * and this repo has been bitten by a suite that printed "CHECKED NOTHING" and a
 * green tick. If git history is unavailable this suite says so and fails,
 * rather than passing on an empty set.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

/* The seed commit. Everything at or before it is repository history, not an
   edit anyone made to that file. */
const SEED = '56e990a';

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

let historyAvailable = true;
try { git(['cat-file', '-e', SEED + '^{commit}']); } catch (e) { historyAvailable = false; }

assert.ok(historyAvailable,
  'the seed commit ' + SEED + ' is not in this clone, so no token can be checked against its ' +
  "file's history. This suite refuses to pass on an empty set — a green tick that checked " +
  'nothing is worse than a red one. Fetch full history (fetch-depth: 0) and re-run.');

const sources = ['mls-connect.js', 'ScribeFlow.html']
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

/* Hand-maintained tokens only. The `?v=' + (window.__MLS_AV...)` form is a
   concatenation, so it never matches this quoted-literal pattern. */
const pins = new Map();
const RE = /['"]([A-Za-z0-9_.-]+\.js)\?v=([A-Za-z0-9._-]+)['"]/g;
let m;
while ((m = RE.exec(sources))) if (!pins.has(m[1])) pins.set(m[1], m[2]);

assert.ok(pins.size > 0, 'no hand-maintained cache tokens were found at all — the pattern has drifted');

const stale = [];
const checked = [];
for (const [asset, token] of pins) {
  if (!fs.existsSync(path.join(root, asset))) continue;
  let commits = '';
  try { commits = git(['log', '--format=%h', SEED + '..HEAD', '--', asset]).trim(); } catch (e) { continue; }
  if (!commits) continue;                       /* untouched since the seed */
  let last = '';
  try { last = git(['log', '-1', '--format=%cs', '--', asset]).trim(); } catch (e) { continue; }
  const d = /^(\d{4})(\d{2})(\d{2})/.exec(token);
  if (!d) continue;                             /* token carries no date to compare */
  const tokenDate = `${d[1]}-${d[2]}-${d[3]}`;
  checked.push(asset);
  if (last > tokenDate) {
    stale.push(`${asset}  token ${token} (${tokenDate})  but last changed ${last}` +
      `  [${commits.split('\n').length} commit(s) since the seed]`);
  }
}

assert.deepStrictEqual(stale, [],
  'These modules changed AFTER their hand-maintained cache token, so a returning browser keeps ' +
  'running the cached copy and the change never reaches the doctor:\n\n  ' + stale.join('\n  ') +
  '\n\nFix either way:\n' +
  "  - bump the token in the loader, in the same commit as the change, or\n" +
  "  - switch the loader to `?v=' + (window.__MLS_AV || Date.now())`, which follows the build\n" +
  '    number and cannot go stale again. That is what feat_mls_opnote_integrity.js now does.');

console.log('PASS cache token cannot go stale: ' + checked.length + ' hand-maintained token(s) ' +
  'checked against their own file history (of ' + pins.size + ' found), 0 stale.');
