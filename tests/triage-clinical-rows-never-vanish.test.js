'use strict';

/* 2026-07-28 — clean-sections v1.3.0: THE DENY-LIST OBEYS THE FOLD LAW.
 *
 * Reproduced by running the production module: three deny-list rules silently
 * deleted real diagnoses (no keep, no fold): the audit-label rule's bare
 * [:\-] separator matched the hyphen in "End-stage renal disease (N18.6)";
 * the sync-status rule's bare \b matched "Pulled hamstring"; the unanchored
 * staff-line rule matched "Referred to PT for pain at knee". Additionally
 * "Gout (M10.9)" was demoted to the fold because the ICD code's digits
 * diluted lettersRatio below looksName's 0.55 threshold.
 *
 * The law: a chart list may never silently lose a row it did not understand.
 * A code-bearing row is never furniture. An uncoded soft-rule hit that reads
 * like prose lands in the visible fold. Unambiguous furniture still drops.
 * Runs the REAL module — no re-implementation. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_b121_pack.js'), 'utf8');
const startMark = 'MODULE 7 - CHART-SECTION CLEANER';
const si = src.indexOf(startMark);
assert(si >= 0, 'module 7 marker missing');
const modStart = src.lastIndexOf('(function () {', src.indexOf('use strict', si));
const endMark = 'window.__mlsCleanSections_revert = api.revert;';
const modEnd = src.indexOf('})();', src.indexOf(endMark, si)) + '})();'.length;
assert(modStart > 0 && modEnd > modStart, 'module 7 bounds not found');

const sandbox = {
  window: { addEventListener() {}, removeEventListener() {} },
  document: { addEventListener() {}, removeEventListener() {}, getElementById() { return null; } },
  console: { log() {}, warn() {} },
  URL: { createObjectURL() { throw new Error('no blobs in tests'); }, revokeObjectURL() {} },
  Blob: function () {},
  Date: Date
};
vm.createContext(sandbox);
vm.runInContext(src.slice(modStart, modEnd), sandbox, { filename: 'feat_mls_b121_pack.js:module7' });
const api = sandbox.window.__mlsCleanSections;
assert(api, 'module 7 did not install');
assert.strictEqual(api.version, '1.3.0', 'expected clean-sections v1.3.0');

/* The module's own selfTest is the broadest control — it must pass. */
const st = api.selfTest();
assert.strictEqual(st.pass, true, 'module selfTest failed: ' + JSON.stringify({
  rescuePass: st.rescuePass, problems: st.problems
}));

function verdict(row) {
  const t = api.triageProblems(row);
  if (t.keep.length) return 'keep';
  if (t.unsorted.length) return 'unsorted';
  return 'DROPPED';
}

/* Positive controls: the instrument must be able to see both outcomes. */
assert.strictEqual(verdict('11 problems'), 'DROPPED', 'count-line furniture must drop');
assert.strictEqual(verdict('Cervical spondylosis'), 'keep', 'plain dx must keep');

/* The three live-proven silent deletions — now kept. */
assert.strictEqual(verdict('End-stage renal disease (N18.6)'), 'keep', 'coded ESRD must keep');
assert.strictEqual(verdict('End-stage renal disease'), 'keep', 'uncoded ESRD must keep');
assert.strictEqual(verdict('Pulled hamstring'), 'keep', 'free-text dx must not be sync chrome');
assert.strictEqual(verdict('Gout (M10.9)'), 'keep', 'short coded dx must not be demoted by its own code');

/* Ambiguity is VISIBLE, never vanished. */
assert.strictEqual(verdict('Marked obesity'), 'unsorted', 'verb-collision prose folds');
assert.strictEqual(verdict('Onset of atrial fibrillation'), 'unsorted', 'onset-lead prose folds');
assert.strictEqual(verdict('Referred to PT for pain at knee'), 'unsorted', 'plan text folds');

/* True furniture still drops — the fix must not turn the cleaner off. */
for (const chrome of ['Onset Date: 03/05/2024', 'Pulled from Athena 07/28/2026',
  'View problems from other sources', 'Loading...', 'Historical (0)',
  'Robert McCafferty, PA-C for EST20 at POSM CL West Chester', '3 medications']) {
  assert.strictEqual(verdict(chrome), 'DROPPED', 'furniture must still drop: ' + chrome);
}

/* CONSERVATION: across a realistic mixed list, every ICD-coded row and every
 * plain-prose diagnosis survives into keep ∪ fold. A 12-row problem list must
 * come back 12-strong — the live store measured lists off by exactly one. */
const list12 = [
  'Essential hypertension (I10)',
  'Type 2 diabetes mellitus without complications (E11.9)',
  'End-stage renal disease (N18.6)',
  'Hyperlipidemia',
  'Obstructive sleep apnea (G47.33)',
  'Atrial fibrillation (I48.91)',
  'Osteoarthritis of knee (M17.9)',
  'Low back pain (M54.50)',
  'Cervical spondylosis',
  'Gout (M10.9)',
  'Anemia, unspecified (D64.9)',
  'Vitamin D deficiency (E55.9)'
];
const t12 = api.triageProblems(list12.join('\n'));
assert.strictEqual(t12.keep.length + t12.unsorted.length, 12,
  'a 12-row clinical list must be conserved, got keep=' + t12.keep.length + ' fold=' + t12.unsorted.length);
assert.strictEqual(t12.keep.length, 12, 'all 12 are unambiguous diagnoses and must KEEP');

/* Meds behaviour is byte-identical territory: the b685 grid scenario from the
 * module selfTest already ran above (st.pass), but pin the two invariants that
 * the problems-side changes must not disturb. */
const gridT = api.triageMeds(['Name', 'check now', 'calcium', 'Deborah Hendricks'].join('\n'));
assert(gridT.keep.indexOf('calcium') >= 0, 'meds: real med keeps');
assert(gridT.keep.indexOf('Name') < 0 && gridT.keep.indexOf('check now') < 0, 'meds: grid chrome never a med');
assert(gridT.unsorted.indexOf('Deborah Hendricks') >= 0, 'meds: a person folds, not deleted');

console.log('triage-clinical-rows-never-vanish: PASS');
