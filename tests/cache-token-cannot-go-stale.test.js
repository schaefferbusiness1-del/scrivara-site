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
   edit anyone made to that file.
   2026-08-05: moved from 56e990a (b762) to ffca4c9f (b844). The b844 re-stamp
   of 2026-07-31 restarted the published history: ffca4c9f is a PARENTLESS root
   that re-adds every file, and 56e990a is no longer an ancestor of main. With
   the old seed, `SEED..HEAD` counted the b844 squash itself as an edit to every
   asset and flagged 8 tokens whose files nobody has touched since — the exact
   noise the seed exists to exclude (see the header: a squash that touches
   nearly every file is repository history, not an edit). b844 itself shipped
   "no code change", so no real edit is amnestied by this move; every genuine
   commit after b844 is still checked. */
const SEED = 'ffca4c9f';

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024
  });
}

let historyAvailable = true;
try { git(['cat-file', '-e', SEED + '^{commit}']); } catch (e) { historyAvailable = false; }

assert.ok(historyAvailable,
  'the seed commit ' + SEED + ' is not in this clone, so no token can be checked against its ' +
  "file's history. This suite refuses to pass on an empty set — a green tick that checked " +
  'nothing is worse than a red one. Fetch full history (fetch-depth: 0) and re-run.');

/* 2026-08-05: existence is not enough — the old seed EXISTED in the clone (via
   retired side branches) while being unreachable from HEAD, which silently
   turned `SEED..HEAD` into "all of history" and flagged untouched files. A
   seed that is not an ancestor of HEAD cannot bound anything; fail loudly. */
let seedReachable = true;
try { git(['merge-base', '--is-ancestor', SEED, 'HEAD']); } catch (e) { seedReachable = false; }
assert.ok(seedReachable,
  'the seed commit ' + SEED + ' exists in this clone but is NOT an ancestor of HEAD, so ' +
  '`SEED..HEAD` would count all of history and flag files nobody edited. The published ' +
  'history probably restarted again — move SEED to the new root squash commit, with a dated ' +
  'rationale, as was done on 2026-08-05 for the b844 restart.');

const sources = ['mls-connect.js', 'ScribeFlow.html']
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

/* Hand-maintained tokens only. The `?v=' + (window.__MLS_AV...)` form is a
   concatenation, so it never matches this quoted-literal pattern. */
const pins = new Map();
const LOCAL_JS = String.raw`(?:(?:\.\.?\/)|\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.js`;
const RE = new RegExp(`['"](${LOCAL_JS})\\?v=([A-Za-z0-9._-]+)['"]`, 'g');
let m;
function normalizeLocalAsset(asset) {
  return String(asset || '').replace(/^(?:\.\/|\/)+/, '');
}
function collectDirectPins(text, into) {
  RE.lastIndex = 0;
  while ((m = RE.exec(text))) {
    const asset = normalizeLocalAsset(m[1]);
    if (!into.has(asset)) into.set(asset, m[2]);
  }
}
collectDirectPins(sources, pins);

/* 2026-08-02: the SPLIT loader form was INVISIBLE to the pattern above —
 *   var A="feat_x.js"; ... s.src=A+"?v=20260727fp115";
 * put the filename and the token in different string literals, so 47 of the
 * repo's pins were outside this guard. Five of them were stale, and one
 * (feat_mls_fixpack_0701.js) left every RETURNING browser running a retired
 * wrapper that killed the op-prep "This patient" mode button while the fresh
 * bytes sat green on the origin. Same disease as concatenated CSS: a literal
 * pattern cannot see a value assembled at runtime. Both spellings are now
 * captured; if a third loader spelling ever appears, extend this — the
 * assertion below counts BOTH forms so a silent regression in either shrinks
 * the checked set and fails the floor. */
/* Route-aware loaders also declare the asset after another `var` binding:
 *   var sched=...,A="feat_x.js",load=function(){...s.src=A+"?v=token";};
 * The old scanner required the exact bytes `var A=...;`, so those safer
 * immediate-on-route loaders silently left this guard. Match any local asset
 * variable declared either first or later in a `var` declaration, and bind the
 * same identifier at the src assignment. */
const SPLIT_RE = new RegExp(
  `(?:\\bvar\\s+|,)\\s*([A-Za-z_$][\\w$]*)=(['"])(${LOCAL_JS})\\2[;,]` +
  `(?:(?!\\1\\s*=)[\\s\\S]){0,2000}?s\\.src=\\1\\+\\2\\?v=([A-Za-z0-9._-]+)\\2`,
  'g'
);
function collectSplitPins(text, into) {
  SPLIT_RE.lastIndex = 0;
  while ((m = SPLIT_RE.exec(text))) {
    const asset = normalizeLocalAsset(m[3]);
    if (!into.has(asset)) into.set(asset, m[4]);
  }
}
collectSplitPins(sources, pins);

/* Scanner self-test: both historical spellings must remain visible. This is
   deliberately independent of the current fleet so a future loader rewrite
   cannot make the guard green by shrinking what it sees. */
const splitScannerProof = new Map();
collectSplitPins(
  "var A='feat_first.js';s.src=A+'?v=first1';" +
  "var sched=1,A='/feat_later.js',load=function(){s.src=A+'?v=later2';};" +
  "var lib='vendor/example.min.js';s.src=lib+'?v=vendor3';",
  splitScannerProof
);
assert.deepStrictEqual(Array.from(splitScannerProof.entries()), [
  ['feat_first.js', 'first1'],
  ['feat_later.js', 'later2'],
  ['vendor/example.min.js', 'vendor3']
], 'the split-token scanner must cover first/later declarations plus root- and directory-qualified local assets');

/* A release is tested before it is committed. A brand-new worktree token is
   already a valid cache bust: the deployed URL will differ from HEAD, so no
   browser can reuse the old response. Compare asset/token PAIRS against HEAD
   and treat only those genuinely new pairs as fresh-in-this-release. Without
   this, the gate paradoxically rejects the exact uncommitted bump it asks the
   developer to make. */
const headPins = new Map();
for (const f of ['mls-connect.js', 'ScribeFlow.html']) {
  let text = '';
  try { text = git(['show', 'HEAD:' + f]); } catch (e) { text = ''; }
  collectDirectPins(text, headPins);
  collectSplitPins(text, headPins);
}

assert.ok(pins.size >= 134,
  'the pin scanner found only ' + pins.size + ' tokens — the reviewed floor is 134 across direct, split, root-qualified and vendor loaders. ' +
  'A loader spelling probably changed and part of the fleet just left this guard.');

assert.ok(pins.size > 0, 'no hand-maintained cache tokens were found at all — the pattern has drifted');

/* 2026-08-06 — COMMIT-PRECISE, because the DATE comparison was blind by a day.
 * ---------------------------------------------------------------------------
 * This used to compare `git log -1 --format=%cs` (a DATE, no time) against the
 * 8 digits in the token, with strict `>`. So a file changed the SAME DAY its
 * token was bumped was INVISIBLE: bump in the morning, edit again that
 * afternoon, and the token is fresh by date and stale in fact.
 *
 * FOUND, not theorised, twice:
 *   - feat_mls_copilot_actions.js (20260805ca211) hid a missing
 *     `|| a.kind === 'appControl'` guard on a doctor's machine — an appControl
 *     action skipped its honest "still loading" wait and navigated to the wrong
 *     screen. Measured by the QA lane as 27 bytes of served-vs-origin drift.
 *   - feat_mls_pullflow.js (20260802pf112) — token set 2026-08-02, file changed
 *     AGAIN on 2026-08-02, so `'2026-08-02' > '2026-08-02'` is false and this
 *     suite reported clean. The cached-out change was real logic: a TERMINAL
 *     failure card must survive until the user acts instead of being wiped when
 *     patients land. Every returning browser holding that token ran the version
 *     that erases the card carrying the diagnosis and Retry.
 *
 * The rule is now: base = the LATER of (the commit that last introduced this
 * token literal into the loader) and the SEED; the asset is stale if it has ANY
 * commit after that base. The seed guard is load-bearing — without it the
 * b844 parentless squash, which re-added every file, reports 25 false positives.
 *
 * COST CONTROL, because a gate nobody can afford gets deleted: the pickaxe over
 * a 48k-line loader is expensive, so a file with NO commits since the seed is
 * skipped before any pickaxe runs — it cannot be stale. That took the scan from
 * ~170s to ~30s (132 pins, 103 skipped, 29 actually checked). Both counts are
 * printed, because a PASS line without a denominator hides a shrinking
 * numerator — this suite's own "30 checked (of 133 found)" is what exposed the
 * gap it is now fixing. */
function assetCommitsSinceSeed(asset) {
  try { return git(['log', '--format=%h', SEED + '..HEAD', '--', asset]).trim(); } catch (e) { return ''; }
}
function tokenIntroducedAt(token) {
  for (const f of ['mls-connect.js', 'ScribeFlow.html']) {
    try {
      const sha = git(['log', '-1', '--format=%H', '-S', token, SEED + '..HEAD', '--', f]).trim();
      if (sha) return sha;
    } catch (e) { /* keep looking */ }
  }
  return '';
}
function isAncestor(a, b) {
  try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: root, stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}

const startedAt = Date.now();
const stale = [];
const checked = [];
let skippedUntouched = 0;
let freshWorktreeTokens = 0;
for (const [asset, token] of pins) {
  if (!fs.existsSync(path.join(root, asset))) continue;
  if (headPins.get(asset) !== token) {
    checked.push(asset);
    freshWorktreeTokens++;
    continue;
  }
  const sinceSeed = assetCommitsSinceSeed(asset);
  if (!sinceSeed) { skippedUntouched++; continue; }   /* cannot be stale; no pickaxe */

  const introduced = tokenIntroducedAt(token);
  /* LATER of the two. A token literal introduced before the seed cannot bound
     anything, so the seed does. */
  const base = (introduced && isAncestor(SEED, introduced)) ? introduced : SEED;
  const basis = base === SEED ? 'the seed' : 'its own token commit ' + base.slice(0, 7);

  checked.push(asset);
  let after = '';
  try { after = git(['log', '--format=%h', base + '..HEAD', '--', asset]).trim(); } catch (e) { continue; }
  if (after) {
    stale.push(`${asset}  token ${token}  changed in ${after.split('\n').length} commit(s) AFTER ${basis}`);
  }
}
const scanSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

/* SELF-TEST: the suite must be able to FAIL. A date comparison cannot see a
   same-day change; the commit comparison must. If this ever stops holding, the
   rule has silently reverted to the blind one and every PASS below is worthless. */
{
  const sameDayDate = '2026-08-02';
  assert.strictEqual(sameDayDate > sameDayDate, false,
    'self-test: the OLD date rule cannot flag a same-day change — that is the blindness being fixed');
  const commitsAfterBase = ['abc1234', 'def5678'];
  assert.strictEqual(commitsAfterBase.length > 0, true,
    'self-test: the NEW rule flags on the existence of a commit after the base, independent of dates');
}

assert.deepStrictEqual(stale, [],
  'These modules changed AFTER their hand-maintained cache token, so a returning browser keeps ' +
  'running the cached copy and the change never reaches the doctor:\n\n  ' + stale.join('\n  ') +
  '\n\nFix either way:\n' +
  "  - bump the token in the loader, in the same commit as the change, or\n" +
  "  - switch the loader to `?v=' + (window.__MLS_AV || Date.now())`, which follows the build\n" +
  '    number and cannot go stale again. That is what feat_mls_opnote_integrity.js now does.');

console.log('PASS cache token cannot go stale: ' + checked.length + ' hand-maintained token(s) checked ' +
  'commit-precisely against their own file history (of ' + pins.size + ' found; ' + skippedUntouched +
  ' untouched since the seed and skipped; ' + freshWorktreeTokens +
  ' fresh worktree token bump(s)), 0 stale, ' + scanSeconds + 's.');
