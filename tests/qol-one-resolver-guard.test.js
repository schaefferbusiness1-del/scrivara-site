'use strict';
/* qol-2.0 guard: THE PREFERENCE HAS ONE RESOLVER — A FIFTH READER IS A BUG.
   2026-08-10: the owner unchecked "Full visit notes" and the pull ignored
   him because FOUR separate inline readers each re-derived the preference
   from raw storage keys, and they disagreed (one site also had no day-note
   fallback, so OFF silently dropped the pulled day's own note). The fix is
   structural: window.__mlsVisitNotesPref (mls-connect.js) is the ONLY code
   allowed to touch the storage keys; every decision site calls it. This
   guard fails the build the moment a fifth reader appears anywhere in the
   shipped surface. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

/* every raw form a reader could take */
const SENTINELS = [
  { name: 'uns(pullVisitBodies) call', re: /uns\(\s*["']pullVisitBodies["']\s*\)/g },
  { name: 'pullVisitBodiesSet key', re: /pullVisitBodiesSet/g },
  { name: 'visitNotesModeV2 canonical key', re: /visitNotesModeV2/g },
  { name: 'legacy global key', re: /mls_save_every_athena_visit/g },
];

const SHIPPED = [
  'mls-connect.js', 'feat_mls_schedimport_exact.js', 'ScribeFlow.html',
  'feat_mls_calm_shell.js', 'feat_mls_athena_follow.js', 'feat_mls_checker.js',
  'background.js', 'content.js',
];

/* the scanner — also exercised below on a synthetic violation, so a green
   run proves the instrument can actually fire */
function scan(rel, text) {
  const b = text.indexOf('__mlsVisitNotesPref RESOLVER BEGIN');
  const e = text.indexOf('__mlsVisitNotesPref RESOLVER END');
  const violations = [];
  for (const s of SENTINELS) {
    s.re.lastIndex = 0;
    let m;
    while ((m = s.re.exec(text)) !== null) {
      const inside = b >= 0 && e > b && m.index > b && m.index < e;
      if (!inside) violations.push(rel + ': ' + s.name + ' at offset ' + m.index);
    }
  }
  return violations;
}

let all = [];
for (const rel of SHIPPED) {
  const text = fs.readFileSync(path.join(root, rel), 'latin1');
  all = all.concat(scan(rel, text));
}
assert.deepStrictEqual(all, [], 'preference keys touched outside the resolver:\n' + all.join('\n'));

/* the resolver itself exists exactly once, in mls-connect.js */
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
assert.strictEqual(mc.split('__mlsVisitNotesPref RESOLVER BEGIN').length - 1, 1, 'exactly one resolver');

/* every known decision site calls it (positive presence, not just absence) */
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'latin1');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'latin1');
assert(si.split('__mlsVisitNotesPref').length - 1 >= 1, 'si batch reader calls the resolver');
assert(app.split('__mlsVisitNotesPref').length - 1 >= 2, 'ScribeFlow view + writer call the resolver');
assert(mc.split('__mlsVisitNotesPref').length - 1 >= 8,
  'mls-connect decision sites call the resolver (triOn, fourth reader, strip view/write/repaint, vp enabled/setEnabled, payload, dedupe)');

/* EXECUTED NON-VACUITY: a synthetic fifth reader must be flagged by name */
const fifth = "var v = localStorage.getItem(uns('pullVisitBodies')); var s = localStorage.getItem(uns('pullVisitBodiesSet'));";
const flagged = scan('synthetic-fifth-reader.js', fifth);
assert(flagged.length >= 2, 'non-vacuity: the scanner must flag a raw reader (' + flagged.length + ' hits)');

console.log('qol-one-resolver-guard: OK (' + SHIPPED.length + ' shipped files clean, resolver singular, all sites call it, scanner fires on a synthetic fifth reader)');
