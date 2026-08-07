'use strict';
/*
 * THE DEPLOY GUARD, TESTED AGAINST THE INVERSIONS THAT ACTUALLY HAPPENED.
 * -----------------------------------------------------------------------------
 * The QA lane measured every successful Pages run on 2026-08-06: 13 deploys,
 * 3 inversions (23%), each one serving an older tree while reporting SUCCESS.
 *   23:07:40  b904 deployed AFTER b905   (reverted two shipped fixes for 23 min)
 *   23:15:05  b905 deployed AFTER b906
 *   23:26:01  b908 deployed AFTER b909   (reverted an appControl guard after 51s)
 * app-version.json went BACKWARDS twice and nothing raised a flag.
 *
 * This suite replays those exact pairs. The three "must FAIL" cases below are the
 * negative control: if the guard is ever loosened into a no-op, they go green and
 * this file is the thing that notices.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { verdict, parseBuild } = require(path.join(root, 'scripts', 'assert-forward-deploy.js'));

/* ---- 1. the three real inversions must all be REFUSED -------------------- */
for (const [artifact, live, note] of [
  [904, 905, 'b904 deployed after b905 — reverted the draft and caret fixes for 23 minutes'],
  [905, 906, 'b905 deployed after b906'],
  [908, 909, 'b908 deployed after b909 — reverted another lane\'s appControl guard after 51 seconds']
]) {
  const v = verdict(artifact, live);
  assert.strictEqual(v.ok, false, 'INVERSION MUST BE REFUSED: ' + note);
  assert.strictEqual(v.code, 'inversion');
  assert(/REFUSING TO PUBLISH/.test(v.message), 'the refusal must say plainly that it is refusing');
  assert(v.message.includes('b' + artifact) && v.message.includes('b' + live),
    'the refusal must name BOTH numbers so the run explains itself without a log dive');
}

/* ---- 2. every genuine forward ship must PASS ------------------------------ */
for (const [artifact, live] of [[906, 905], [909, 908], [1000, 999], [912, 904]]) {
  const v = verdict(artifact, live);
  assert.strictEqual(v.ok, true, `a forward deploy (b${artifact} over b${live}) must never be blocked`);
  assert.strictEqual(v.code, 'forward');
}

/* ---- 3. THE EQUAL CASE PASSES. A re-run of the same build is legitimate and
   blocking it would break the "push an empty commit to retrigger" recovery this
   repo actually uses. -------------------------------------------------------- */
const same = verdict(907, 907);
assert.strictEqual(same.ok, true, 'a re-deploy of the SAME build must be allowed');
assert.strictEqual(same.code, 'same-build');

/* ---- 4. it fails OPEN when it cannot read, and says so -------------------- */
for (const [a, l, code] of [[null, 905, 'artifact-unreadable'], [905, null, 'live-unreadable'], [null, null, 'artifact-unreadable']]) {
  const v = verdict(a, l);
  assert.strictEqual(v.ok, true, 'an unreadable version must not block the pipeline');
  assert.strictEqual(v.code, code);
}

/* ---- 5. the number parser handles the real stamp shape ------------------- */
assert.strictEqual(parseBuild('{"build":"2026-07-25-b908"}'), 908, 'must read the real app-version.json shape');
assert.strictEqual(parseBuild('b1004'), 1004, 'must not cap at three digits');
assert.strictEqual(parseBuild('no build here'), null);
/* the date in the stamp must never be mistaken for the build */
assert.strictEqual(parseBuild('{"build":"2026-07-25-b908"}'), 908);

/* ---- 6. the guard is actually WIRED, in the deploy job, before the deploy -
   A perfect script that nothing calls is the "shipped but never served" class.
   It must run in the DEPLOY job: a build-time check passes and the inversion
   still happens afterwards, because a queued older run publishes later. ------ */
const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages-deploy.yml'), 'utf8');
assert(wf.includes('scripts/assert-forward-deploy.js'), 'the workflow must call the guard');
assert(/artifact_build:\s*\$\{\{\s*steps\.stamp\.outputs\.build\s*\}\}/.test(wf),
  'the build job must expose the artifact build number as an output');
const deployAt = wf.indexOf('  deploy:');
assert(deployAt > 0, 'the deploy job must exist');
const guardAt = wf.indexOf('scripts/assert-forward-deploy.js');
const publishAt = wf.indexOf('actions/deploy-pages@');
assert(guardAt > deployAt, 'the guard must run in the DEPLOY job, not the build job');
assert(guardAt < publishAt, 'the guard must run BEFORE the publish step');

console.log('PASS forward-deploy guard: 3 real inversions refused, 4 forward deploys allowed, ' +
  'same-build re-deploy allowed, unreadable versions fail open, and the guard is wired into the deploy job before publish.');
