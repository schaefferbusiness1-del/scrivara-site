'use strict';

/* A good fix computed against a stale tree is how this project loses a day.
 *
 * Twice in one evening, under four concurrent lanes:
 *
 *   1. A lane woke after hours idle believing live was b612 when it was b645,
 *      about to publish an extension release. It re-fetched first and found
 *      itself 50 commits behind: "Good thing I checked rather than pushed; I
 *      would have reverted a day of work." Caught by a voluntary habit.
 *
 *   2. A lane regenerated `git diff origin/main -- mls-connect.js` from a
 *      b658-based tree while origin was already b659. The patch carried the
 *      REMOVAL of everything b659 added — including deleting window._calAppts,
 *      which would have reverted another lane's shipped fix. It then read the
 *      failing test as "main is broken" and nearly reported that upstream.
 *      Caught by testing the tip in an isolated worktree.
 *
 * Same shape both times, and neither was caught by a test: not a bad change, a
 * GOOD change subtracted from the wrong baseline. Nothing in 326 suites looked
 * at whether the tree the work was computed against still existed.
 *
 * The check is one line of git: if origin/main is not an ancestor of HEAD, this
 * tree does not contain everything currently published, so any diff taken
 * against it can carry deletions of work that already shipped.
 *
 * It fails rather than warns. An author asked to reason about whether staleness
 * matters this time will sometimes be wrong, and the cost of being wrong is a
 * reverted day. Rebase first; the gate is cheap and reverting is not.
 *
 * MID-DEVELOPMENT ESCAPE: set MLS_ALLOW_STALE=1. Running the suite on a
 * deliberately-behind tree is legitimate; PUSHING from one is not. The escape
 * exists so nobody deletes the check to get work done — a gate that blocks
 * ordinary work gets removed, and then it protects nothing. */

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/* A skip must be LOUD. A staleness gate that quietly no-ops converts
   "I checked" into a belief, which is worse than not having it. */
function cannotCheck(why) {
  const bar = '='.repeat(72);
  console.log('\n' + bar);
  console.log('  STALENESS GATE DID NOT RUN — THIS SUITE CHECKED NOTHING');
  console.log('  reason: ' + why);
  console.log('  Your tree may not contain everything currently published. Before pushing,');
  console.log('  run:  git fetch origin main && git merge-base --is-ancestor origin/main HEAD');
  console.log(bar + '\n');
  process.exit(0);
}

if (String(process.env.MLS_ALLOW_STALE || '') === '1') {
  console.log('PASS tree contains everything published: SKIPPED via MLS_ALLOW_STALE=1 — ' +
    'legitimate mid-development, but DO NOT PUSH from this tree without rebasing first');
  process.exit(0);
}

try { git(['rev-parse', '--git-dir']); } catch (e) { cannotCheck('not a git checkout'); }

/* Fetch is the point — a cached ref proves nothing about what is published now. */
try {
  execFileSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: root, stdio: 'ignore', timeout: 45000 });
} catch (e) {
  cannotCheck('could not reach origin (offline, or no network in this environment)');
}

let head, upstream;
try {
  head = git(['rev-parse', 'HEAD']);
  upstream = git(['rev-parse', 'origin/main']);
} catch (e) {
  cannotCheck('origin/main is not present (shallow clone?)');
}

let contained = true;
try { git(['merge-base', '--is-ancestor', upstream, head]); }
catch (e) { contained = false; }

let behind = '?', ahead = '?';
try {
  const counts = git(['rev-list', '--left-right', '--count', upstream + '...' + head]).split(/\s+/);
  behind = counts[0]; ahead = counts[1];
} catch (e) {}

assert.ok(contained,
  'THIS TREE DOES NOT CONTAIN EVERYTHING THAT IS PUBLISHED.\n\n' +
  '  origin/main  ' + upstream.slice(0, 7) + '\n' +
  '  HEAD         ' + head.slice(0, 7) + '\n' +
  '  behind ' + behind + ' commit(s), ahead ' + ahead + '\n\n' +
  'Any diff taken against this tree can carry the REMOVAL of work that already shipped — that is\n' +
  'how a lane nearly deleted window._calAppts tonight and reverted another lane\'s fix, and how a\n' +
  'woken lane nearly published from 50 commits behind. A good change subtracted from the wrong\n' +
  'baseline looks exactly like a good change.\n\n' +
  '  FIX:  git fetch origin main && git rebase origin/main\n\n' +
  'If you are deliberately mid-development on an older tree, set MLS_ALLOW_STALE=1 to run the suite\n' +
  '— but do NOT push from here without rebasing. And if a test fails only on your tree, suspect the\n' +
  'baseline before concluding "main is broken": that mistake was made tonight and nearly reported.');

console.log('PASS tree contains everything published: origin/main ' + upstream.slice(0, 7) +
  ' is an ancestor of HEAD (ahead ' + ahead + ', behind ' + behind + ')');
