'use strict';

/* A commit that bumps the build must SAY which build it is.
 *
 * At b659 the history looked like this:
 *
 *     git show origin/main:app-version.json  ->  {"build":"2026-07-25-b659"}
 *     2c066c5  b658: the phone reports what it can see after a relay pull   <- bumped to b659
 *     abb5a67  b658: the closed bubble was eating clicks, and it opened the wrong way
 *     git log --grep b659  ->  (no commits)
 *
 * Two commits named b658, both changed app-version.json, and ZERO commits named
 * the build the owner was actually running. The cost is not felt now. It is felt
 * the hour someone says "it broke around b659" and the log denies b659 exists.
 *
 * Four lanes ship through this repo and rebase around each other constantly, so
 * the build number is the only handle that maps a user report to a diff. This
 * makes mislabelling impossible at commit time rather than discoverable later.
 *
 * TWO CHECKS, because presence alone is not enough:
 *   1. PRESENCE   a commit that changed app-version.json names that build token
 *   2. UNIQUENESS no two commits claim the same token — two commits both
 *                 correctly labelled "b658:" would pass (1) and still be
 *                 ambiguous. This is the collision case that cost two abandoned
 *                 build numbers in a single afternoon.
 *
 * SCOPE: commits AFTER the cutoff below. The two mislabelled commits are already
 * pushed and four lanes are rebasing onto them; rewriting shared history to
 * satisfy a lint is an outage, while a mislabelled subject is a nuisance. So
 * this is fixed FORWARD - history is left exactly as it is, and everything from
 * here on is checked. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

/* Last commit of the pre-gate era. Everything after this is checked; this and
   everything before it is history and deliberately exempt. */
const CUTOFF = '2c066c5';

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/* A skip must be LOUD. A suite that exits 0 saying nothing is indistinguishable
   from a suite that passed - that is exactly how the e2e suite sat unrun for
   30+ builds. */
let range;
try {
  git(['rev-parse', '--git-dir']);
  git(['cat-file', '-e', CUTOFF + '^{commit}']);
  range = git(['log', '--format=%H|%s', CUTOFF + '..HEAD']);
} catch (e) {
  console.log('SKIPPED build-bump-names-its-build: not a git checkout, or the cutoff commit ' + CUTOFF +
    ' is absent (shallow clone?). THIS SUITE CHECKED NOTHING.');
  process.exit(0);
}

const commits = range ? range.split('\n').filter(Boolean).map(l => {
  const i = l.indexOf('|');
  return { sha: l.slice(0, i), subject: l.slice(i + 1) };
}) : [];

const TOKEN = /\bb(\d{3,4})\b/;
const claimed = new Map();   /* token -> [sha, ...] */
const unnamed = [];

for (const c of commits) {
  /* did this commit change the version file? */
  let touched = '';
  try { touched = git(['show', '--name-only', '--format=', c.sha]); } catch (e) { continue; }
  if (!/^app-version\.json$/m.test(touched)) continue;

  /* what build does the file say AT that commit? */
  let token = null;
  try {
    const raw = git(['show', c.sha + ':app-version.json']);
    const m = /"build"\s*:\s*"[\d-]+-(b\d{3,4})"/.exec(raw);
    if (m) token = m[1];
  } catch (e) {}
  if (!token) continue;

  if (c.subject.indexOf(token) === -1) unnamed.push(c.sha.slice(0, 7) + '  tree=' + token + '  subject="' + c.subject.slice(0, 70) + '"');
  const arr = claimed.get(token) || [];
  arr.push(c.sha.slice(0, 7));
  claimed.set(token, arr);
}

/* 1. PRESENCE */
assert.strictEqual(unnamed.length, 0,
  'A commit bumped the build without naming it in its subject:\n  ' + unnamed.join('\n  ') + '\n\n' +
  'The build number is the only handle that maps a user report to a diff, and four lanes rebase past\n' +
  'each other constantly. If the subject names the previous build, `git log --grep <build>` returns\n' +
  'nothing for the build the owner is actually running. Put the token from app-version.json in the\n' +
  'commit subject - the bump script already knows it, so take it from there rather than from memory.');

/* 2. UNIQUENESS */
const dupes = [...claimed.entries()].filter(([, shas]) => shas.length > 1);
assert.strictEqual(dupes.length, 0,
  'Two or more commits claim the same build number:\n  ' +
  dupes.map(([t, shas]) => t + ' claimed by ' + shas.join(', ')).join('\n  ') + '\n\n' +
  'Presence is not enough - two commits both correctly labelled with the same token are still\n' +
  'ambiguous when tracing a defect. This is the collision case that cost two abandoned build numbers\n' +
  'in one afternoon. Re-bump rather than reuse: abandon the NUMBER, never the work.');

console.log('PASS build bump names its build: ' + commits.length + ' commit(s) since ' + CUTOFF +
  ', ' + claimed.size + ' build bump(s), each named in its own subject and claimed once');
