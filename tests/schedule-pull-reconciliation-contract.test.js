/* pp-1.x (3.0.40) PULL RECONCILIATION CONTRACT.
 *
 * The 2026-08-02 adversarial audit CONFIRMED (high confidence) that the
 * day-pull's completeness verdict compared CARDINALITIES, not row identities:
 *   - parsedCount is the MERGED dom+text row count while expectedCount is the
 *     DOM-only candidate count, and the text lane is explicitly additive - so
 *     a phantom text row could ship as a NEW patient under complete:true AND
 *     numerically substitute for a dropped DOM row (the exact 3.0.36 live
 *     deficit shape: expected 7 / parsed 6 from a filterSource-dropped row);
 *   - the doc-wide filled-row census (diag.legacyFilledRows) was measured but
 *     never reconciled against the rows actually walked, so a filled row under
 *     a renamed wrapper vanished with receipt complete:true;
 *   - athena's guaranteed DOUBLE RENDER was thrown away at the id-dedupe:
 *     conflicting duplicate copies kept the first-seen name silently.
 *
 * pp-1.1 counts text-only rows in the merge diag and fails a legacy-exact day
 * that carries any; pp-1.2 joins unwalked census rows to candidate accounting
 * as 'unwalked-row'; pp-1.3 demotes copy-name conflicts to 'copy-name-conflict'
 * instead of importing a coin-flip name; pp-1.4 names the 22k text-lane
 * truncation in the receipt. Synthetic names only. */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const candidateChain = ['3.0.40', '3.0.38', '3.0.37', '3.0.36', '3.0.35', '3.0.34', '3.0.33', '3.0.32'].map(v => path.join(root, 'extension-candidates', v, 'background.js'));
const bgPath = candidateChain.find(p => fs.existsSync(p)) || path.join(root, 'background.js');
const background = fs.readFileSync(bgPath, 'utf8');

let n = 0;
function ok(name) { n++; console.log('ok ' + n + ' - ' + name); }

/* ---- 1. source markers ---- */
for (const marker of [
  "if (a.__lane === 'text') textOnlyRows.push(",
  'textOnlyRowCount: textOnlyRows.length,',
  'var __legacyTextOnlyRows = ',
  '__coverageComplete && __legacyTextOnlyRows === 0 && (__authoritativeEmpty ||',
  'textLaneTruncated: !!(pick && pick.tTruncated),',
  'tTruncated: TF.length > 22000',
  '_legacyIteratedNodesL=[]',
  '_legacyIteratedNodesL.push(row);if(_legacySlotL(raw))',
  "kind:'unwalked-row'",
  'out.diag.unwalkedRows=_legacyUnwalkedL;',
  'prior._copyNameConflict=(prior._copyNameConflict||0)+1',
  "kind:'copy-name-conflict'",
]) {
  assert.ok(background.indexOf(marker) !== -1, 'pp marker present: ' + marker);
}
ok('all pp-1.1/1.2/1.3/1.4 markers present');

/* the unnamed-count marker the older contracts pin must be intact */
assert.ok(background.indexOf('__parsedCount > 0 && __parsedCount >= __expectedCount && __unnamedCount === 0') !== -1,
  'the base completeness clause is untouched');
ok('base completeness clause untouched');

/* ---- 2. completeness equation replay ---- */
{
  const eqStart = background.indexOf('var __legacyTextOnlyRows = ');
  const eqEnd = background.indexOf('__nonClinicalAccounted));', eqStart) + '__nonClinicalAccounted));'.length;
  assert.ok(eqStart > 0 && eqEnd > eqStart, 'equation extraction');
  const complete = new Function(
    '__coverageComplete', '__authoritativeEmpty', '__parsedCount', '__expectedCount',
    '__unnamedCount', '__nonClinicalAccounted', '__legacyExactCount', '__pd',
    background.slice(eqStart, eqEnd) + '\nreturn __complete;');

  /* a legacy day with one text-only row fails even at perfect counts */
  assert.strictEqual(complete(true, false, 7, 7, 0, false, true, { textOnlyRowCount: 1 }), false,
    'a text-only row must fail a legacy-exact day (mask/phantom refusal)');
  /* clean legacy day passes */
  assert.strictEqual(complete(true, false, 7, 7, 0, false, true, { textOnlyRowCount: 0 }), true,
    'clean legacy day still completes');
  /* virtualized (non-legacy) schedules keep their additive text lane */
  assert.strictEqual(complete(true, false, 8, 7, 0, false, false, { textOnlyRowCount: 1 }), true,
    'non-legacy surfaces keep additive text rows (virtualized schedules)');
  /* the exact live masking shape: DOM dropped one (6 real), text added one phantom -> 7 == 7 */
  assert.strictEqual(complete(true, false, 7, 7, 0, false, true, { textOnlyRowCount: 1 }), false,
    'the 3.0.36 masking shape (phantom balancing a dropped row) now refuses');
  ok('completeness equation: text-only rows fail legacy days, spare virtualized lanes');
}

/* ---- 3. merge diag counts text-only rows (functional) ---- */
{
  const bs = background.indexOf('var mlsProv = (function () {');
  const be = background.indexOf('/* A schedule surface must be proven', bs);
  assert.ok(bs >= 0 && be > bs, 'mlsProv extraction');
  const prov = vm.runInNewContext(background.slice(bs, be) + '\nmlsProv;', Object.create(null), { timeout: 5000 });
  const source = rows => ({ appts: rows.map(r => Object.assign({}, r)), providers: ['Matthew Schaeffer, MD'], diag: {} });

  const withText = prov.merge(
    source([{ time: '8:00 AM', name: 'Good, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 'm1' }]),
    source([{ time: '9:00 AM', name: 'Ghost, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 'm2' }]));
  assert.strictEqual(withText.providerDiag.textOnlyRowCount, 1,
    'an additive text row is counted: ' + JSON.stringify(withText.providerDiag.textOnlyRows));
  assert.strictEqual(withText.providerDiag.textOnlyRows[0].name, 'Ghost, Row');

  const domOnly = prov.merge(
    source([{ time: '8:00 AM', name: 'Good, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 'm1' }]),
    source([]));
  assert.strictEqual(domOnly.providerDiag.textOnlyRowCount, 0, 'dom-only merge counts zero');

  /* a text row that MERGES into its dom twin is not text-only */
  const twin = prov.merge(
    source([{ time: '8:00 AM', name: 'Good, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 'm1' }]),
    source([{ time: '8:00 AM', name: 'Good, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 'm1' }]));
  assert.strictEqual(twin.providerDiag.textOnlyRowCount, 0, 'a merged twin is lane both, not text-only');
  ok('merge diag: additive text rows counted, twins and dom-only exempt');
}

/* ---- 4. copy-name-conflict demotion keeps the receipt honest ---- */
{
  /* the demotion filter must push into candidate accounting BEFORE out.appts is built */
  const demoteIdx = background.indexOf("kind:'copy-name-conflict'");
  const apptsIdx = background.indexOf('out.appts=_legacyRowsFinalL.map(function(a){return{time:a.time,');
  assert.ok(demoteIdx > 0 && apptsIdx > demoteIdx, 'demotion precedes the export mapping');
  /* and the conflict mark compares NORMALIZED names of duplicate copies */
  const markIdx = background.indexOf('var _pnConf=_legacyNormL(prior.name');
  assert.ok(markIdx > 0, 'conflict mark normalizes both names');
  ok('copy-name-conflict: marked at the id-dedupe, demoted before export');
}

console.log('# schedule-pull-reconciliation-contract: ' + n + ' checks passed');
