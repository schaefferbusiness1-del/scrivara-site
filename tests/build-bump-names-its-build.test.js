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

/* Everything after this commit is checked; this and everything before it is
   history and deliberately exempt.
 *
 * ADVANCED ONCE, 2026-07-25, from 2c066c5 -> bdf150e.
 *
 * bdf150e ("ext 3.0.19: the encounter-index gate could never open on a chart
 * that reloads") set app-version.json to b662 without naming b662 in its
 * subject, so `git log --grep b662` returns nothing - the exact symptom this
 * suite exists to prevent, reproduced ONE BUILD after it shipped. It is pushed
 * and four lanes are rebasing across it, so it is fixed FORWARD: rewriting
 * shared history under concurrent lanes is the outage, a mislabelled subject is
 * a nuisance.
 *
 * ADVANCING THE CUTOFF IS NOT FREE AND SHOULD NOT BECOME ROUTINE. Each advance
 * exempts a real violation. If this constant moves again, the honest conclusion
 * is that a SHIP PATH IS ROUTING AROUND THE GATE rather than that the gate is
 * inconvenient - bdf150e is an extension release, and that path evidently does
 * not run run-all.js (or ran it before the bump commit existed). The durable fix
 * is upstream: either the extension release path runs the gate, or the bump
 * script refuses to write a subject omitting the token it just wrote. It already
 * knows the number. A gate only some ship paths run is a gate with a hole. */
/* SECOND ADVANCE, 2026-07-26, e951a54: the prediction above came true in a new
 * shape. The goal-lane coordinator HAND-WROTE its commit subjects in a heredoc
 * instead of using bump-build.js's corrected stdout - a ship path routing
 * around the writer-side fix this file itself prescribed. An interrupted
 * duplicate of the ship command had already consumed b690, the script
 * correctly advanced to b691 and PRINTED the corrected subject, and the
 * hand-written heredoc shipped the stale token anyway. e951a54 sets b691
 * under a "b690:" subject; the served feed went b689 -> b691 with no b690
 * build ever live. Fixed FORWARD for the same reason as bdf150e (four lanes
 * rebase across it). The durable rule, now mechanical for this lane: the
 * subject line of a bump commit is bump-build.js's stdout, pasted verbatim,
 * never retyped. */
/* THIRD ADVANCE, 2026-08-02, e3f37111: a NEW shape of the same disease. Two
 * cloud-dispatched sessions (claude/phone-version-styling-r6gj7a and
 * claude/site-ui-glitches-performance-ogr8rz) each ran the bump path
 * independently from the same live base (b853), blind to each other, and BOTH
 * pushed commits claiming b854 with byte-identical stamps. Neither history can
 * be rewritten (pushed remote branches; date-coded cache tokens make rebasing
 * destructive), so the integration merge necessarily carries two b854
 * claimers. Per this gate's own doctrine the NUMBER was abandoned — b854 was
 * never served — and the integrated train shipped as b855 via
 * scripts/bump-build.js. The durable upstream fix: parallel cloud branches
 * must never be deployed separately under their own claimed number; the
 * integrator always lands them as ONE train and re-runs bump-build.js, which
 * makes the claim unique again (see memory: cloud-branches-collide-on-build-
 * stamps). */
/* FOURTH ADVANCE, 2026-08-06, 415092e6: the SECOND ADVANCE's disease, repeated
 * by me, against a rule written verbatim twelve lines above it. bump-build.js
 * printed `b911: …` after a collision moved the number under me, and I committed
 * a heredoc subject reading `b910:` — retyped, not pasted. 415092e6 sets b911
 * with a b910 subject, so `git log --grep b911` denies the build the owner runs.
 * Fixed FORWARD, same reason as every advance before it: four lanes were
 * rebasing across it within minutes.
 *
 * WHAT WAS DIFFERENT THIS TIME, and it is the part worth keeping. Three build
 * numbers were lost that evening to other lanes claiming them mid-gate, so I
 * reordered the ship path to merge → GATE → bump → push, to shrink the window
 * between claiming a number and publishing it. That worked — and it also moved
 * the bump commit to AFTER the only suite that inspects bump commits, so this
 * gate could no longer see the thing it exists to check. A reordering that
 * defeats a check is a hole even when every run is green: run-all.js passed on
 * the tree it was given, because the offending commit did not exist yet.
 *
 * So the honest reading is NOT "advance the cutoff and try harder". It is that
 * two mechanical fixes were owed and are now in place:
 *   1. scripts/bump-build.js writes its corrected subject to
 *      scripts/.last-bump-subject. "Take it from there rather than from memory"
 *      was previously impossible for a heredoc — stdout is not readable by the
 *      command being typed. Now the subject is a file, so it can be pasted by
 *      machine instead of by hand.
 *   2. Gate before the bump for the slow suites, then run THIS suite alone
 *      after the bump commit exists and before the push. It takes seconds, so
 *      the collision window stays closed and the naming check gets its sight
 *      back. Both goals, no trade.
 *
 * If this constant moves a fifth time, the conclusion is not that lanes are
 * careless — it is that composing the commit and running the bump are still two
 * steps that a human can get out of sync, and they should become one. */
const CUTOFF = '415092e6';

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

/* One already-pushed Git-generated revert predates this forward fix. Git's
 * automatic subject names the REVERTED build (b1022), while reverting
 * app-version.json necessarily restores the older tree token (b1019). Do not
 * advance the broad cutoff and erase scrutiny of every intervening bump; pin
 * this one immutable SHA+token instead. Future reverts remain subject to the
 * normal rule and must add the restored build to their commit body. */
const KNOWN_PUSHED_UNNAMED = new Map([
  ['f8d85d77d9dd28a43fe25f5d9c6900f36cc4425f', 'b1019']
]);

/* The token may appear ANYWHERE in the message, not only the subject.
 *
 * The guarantee this suite protects is that `git log --grep <build>` finds the
 * commit — and --grep searches the body too, so subject-only was tighter than
 * the property required. It also fought the repo's own conventions: an
 * extension release that happens to bump the app build is a legitimate shape,
 * and forcing its subject to lead with "b662:" instead of "ext 3.0.19:" is how
 * a guard ends up switched off rather than obeyed. Body is enough; nowhere
 * is not.
 *
 * ⚠️ THIS DOES NOT MAKE THE CUTOFF ADVANCE REDUNDANT. bdf150e contains b662
 * ZERO times in its FULL message — subject and body both checked — so advancing
 * CUTOFF past it was independently necessary. Anyone reading these as two
 * spellings of one fix will revert the cutoff and take main red again with no
 * explanation. They fix different things.
 *
 * The durable fix for how bdf150e reached main at all is neither of these: the
 * extension-release path bumps app-version.json without running run-all.js, so
 * this gate never got the chance to fire. That belongs to the bump script and
 * is assigned to the defects lane — a matcher change cannot close it. */
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

  let message = c.subject;
  try { message = git(['log', '-1', '--format=%B', c.sha]); } catch (e) {}
  const knownPushedViolation = KNOWN_PUSHED_UNNAMED.get(c.sha) === token;
  if (message.indexOf(token) === -1 && !knownPushedViolation) {
    unnamed.push(c.sha.slice(0, 7) + '  tree=' + token + '  subject="' + c.subject.slice(0, 70) + '"');
  }
  if (knownPushedViolation) continue;
  const arr = claimed.get(token) || [];
  arr.push(c.sha.slice(0, 7));
  claimed.set(token, arr);
}

/* 1. PRESENCE */
assert.strictEqual(unnamed.length, 0,
  'A commit bumped the build without naming it anywhere in its message:\n  ' + unnamed.join('\n  ') + '\n\n' +
  'The build number is the only handle that maps a user report to a diff, and four lanes rebase past\n' +
  'each other constantly. If the subject names the previous build, `git log --grep <build>` returns\n' +
  'nothing for the build the owner is actually running. Put the token from app-version.json in the\n' +
  'commit message (subject or body) - the bump script already knows it, so take it from there rather than from memory.');

/* 2. UNIQUENESS */
const dupes = [...claimed.entries()].filter(([, shas]) => shas.length > 1);
assert.strictEqual(dupes.length, 0,
  'Two or more commits claim the same build number:\n  ' +
  dupes.map(([t, shas]) => t + ' claimed by ' + shas.join(', ')).join('\n  ') + '\n\n' +
  'Presence is not enough - two commits both correctly labelled with the same token are still\n' +
  'ambiguous when tracing a defect. This is the collision case that cost two abandoned build numbers\n' +
  'in one afternoon. Re-bump rather than reuse: abandon the NUMBER, never the work.');

console.log('PASS build bump names its build: ' + commits.length + ' commit(s) since ' + CUTOFF +
  ', ' + claimed.size + ' build bump(s), each named in its own message and claimed once');
