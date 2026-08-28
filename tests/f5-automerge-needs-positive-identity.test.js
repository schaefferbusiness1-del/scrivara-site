'use strict';

/* f5merge-1.0.0 (2026-08-28) — a silent WRONG-PERSON merge path.
 *
 * The F5 dedup gate wraps upsertPatient and is the LAST thing before a new
 * patient row is persisted, so its rule beats every stronger comparator upstream.
 * Its rule was:
 *
 *     var pd = normDob(p.dob), cd2 = normDob(cand.dob);
 *     if (pd && cd2 && pd !== cd2) {  keep separate  }
 *     else                          {  MERGE         }
 *
 * i.e. it merged unless BOTH dobs were present and DIFFERENT. Whenever either
 * side had no DOB it merged two records on NAME ALONE - no MRN veto, no
 * uniqueness check, taking the FIRST same-name candidate. MRN is missing on ~76%
 * of records here and schedule-imported rows routinely arrive with no DOB, so
 * this was live, not theoretical, and it is the weakest comparator in the repo.
 *
 * Owner ruling 2026-08-28: auto-merge ONLY on the same MRN, or the same name AND
 * DOB. Anything weaker is a suggestion, never a silent merge.
 *
 * This suite EXECUTES the real decision text lifted from the shipped file - not a
 * re-implementation - so a future edit that loosens the rule cannot pass it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }
function ok(v, m) { checks++; assert.ok(v, m); }

const root = path.resolve(__dirname, '..');
const LANES = ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'];

/* Lift the REAL decision block: everything the gate computes, plus the real
   branch condition. If either marker moves, this fails loudly rather than
   silently testing nothing. */
function liftDecision(src, lane) {
  const keyAt = src.indexOf('var __f5key = function (v)');
  assert.ok(keyAt >= 0, lane + ': the f5merge identity block is missing - auto-merge may be back to name-only');
  /* pd/cd2 are declared on the line above the identity block; lift from there so
     the DOB normalisation under test is the shipped one too. */
  const start = src.lastIndexOf('var pd = normDob(p.dob), cd2 = normDob(cand.dob);', keyAt);
  assert.ok(start >= 0 && start < keyAt, lane + ': the DOB normalisation preceding the gate moved');
  const condMark = 'if (__f5conflict || __f5same !== 1 || !__f5agrees) {';
  const cond = src.indexOf(condMark, start);
  assert.ok(cond >= 0, lane + ': the f5merge branch condition is missing or was rewritten');
  const body = src.slice(start, cond);
  ok(/var __f5conflict = /.test(body), lane + ': conflict test vanished from the gate');
  ok(/var __f5agrees = /.test(body), lane + ': positive-agreement test vanished from the gate');
  ok(/__f5same\+\+|__f5same \+\+/.test(body) || /__f5same/.test(body), lane + ': uniqueness count vanished');
  return new Function('p', 'cand', 'arr', 'key', 'normName', 'normDob',
    body + '\n return { merged: !(__f5conflict || __f5same !== 1 || !__f5agrees), conflict: __f5conflict, agrees: __f5agrees, same: __f5same };');
}

/* the gate's own helpers, lifted so the test uses the same normalisation */
function liftFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  const j = src.indexOf('{', i);
  let d = 0, e = -1;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  return src.slice(i, e);
}

for (const lane of LANES) {
  const file = path.join(root, lane);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'latin1');

  const decide = liftDecision(src, lane);
  const marker = src.indexOf('var SUFFIX = /^(jr|sr|ii|iii|iv|v)$/;');
  assert.ok(marker >= 0, lane + ': SUFFIX marker missing');
  const tail = src.slice(marker);
  /* normName closes over SUFFIX and normDob over isFn/window._normDate - lift the
     real SUFFIX literal too rather than substituting one, so a change to the
     suffix list is reflected here instead of silently diverging. */
  const suffixLine = (src.match(/var SUFFIX = \/\^\([^\n]*\/;/) || [])[0];
  assert.ok(suffixLine, lane + ': SUFFIX declaration not found');
  const helpers = new Function('isFn', 'window',
    suffixLine + '\nreturn [' + liftFn(tail, 'normName') + ',' + liftFn(tail, 'normDob') + '];'
  )(f => typeof f === 'function', {});
  const normName = helpers[0], normDob = helpers[1];

  const run = (p, cand, others) => {
    const arr = [cand].concat(others || []);
    return decide(p, cand, arr, normName(cand.name), normName, normDob);
  };

  /* ---- THE BUG: name matches, one side has no DOB. Must NOT merge. ---- */
  eq(run({ id: 'n1', name: 'John Smith' }, { id: 'c1', name: 'John Smith', dob: '1980-01-01' }).merged, false,
    lane + ': merged two records on NAME ALONE when the incoming DOB was empty - this is the ' +
    'silent wrong-person merge');
  eq(run({ id: 'n2', name: 'John Smith', dob: '1980-01-01' }, { id: 'c2', name: 'John Smith' }).merged, false,
    lane + ': merged on name alone when the EXISTING record had no DOB');
  eq(run({ id: 'n3', name: 'John Smith' }, { id: 'c3', name: 'John Smith' }).merged, false,
    lane + ': merged two records with NO identifying demographics at all');

  /* ---- ALLOWED: same name + same DOB ---- */
  eq(run({ id: 'n4', name: 'John Smith', dob: '1980-01-01' }, { id: 'c4', name: 'John Smith', dob: '1980-01-01' }).merged, true,
    lane + ': refused to merge on the owner-sanctioned name+DOB agreement');

  /* ---- ALLOWED: same MRN, even with no DOB anywhere ---- */
  eq(run({ id: 'n5', name: 'John Smith', mrn: '7833832' }, { id: 'c5', name: 'John Smith', mrn: '7833832' }).merged, true,
    lane + ': refused to merge on the owner-sanctioned MRN agreement');
  /* MRN formatting must not defeat agreement */
  eq(run({ id: 'n6', name: 'John Smith', mrn: ' 783-3832 ' }, { id: 'c6', name: 'John Smith', mrn: '7833832' }).merged, true,
    lane + ': punctuation/whitespace in an MRN defeated a genuine MRN agreement');

  /* ---- REFUSED: conflicts ---- */
  eq(run({ id: 'n7', name: 'John Smith', dob: '1980-01-01' }, { id: 'c7', name: 'John Smith', dob: '1975-05-05' }).merged, false,
    lane + ': merged two records with DIFFERENT dates of birth');
  eq(run({ id: 'n8', name: 'John Smith', mrn: '111', dob: '1980-01-01' }, { id: 'c8', name: 'John Smith', mrn: '222', dob: '1980-01-01' }).merged, false,
    lane + ': a matching DOB overrode a CONFLICTING MRN - two different charts were merged');

  /* ---- REFUSED: ambiguity. Demographics identify a chart only when they identify ONE. ---- */
  eq(run({ id: 'n9', name: 'John Smith', dob: '1980-01-01' },
          { id: 'c9', name: 'John Smith', dob: '1980-01-01' },
          [{ id: 'c9b', name: 'John Smith', dob: '1980-01-01' }]).merged, false,
    lane + ': merged into the FIRST of two same-name candidates - an ambiguous match must never ' +
    'auto-merge');

  /* the suggestion surface must exist so declined near-matches are not just lost */
  ok(/__mlsPtsMergeSuggestions/.test(src),
    lane + ': declined near-matches are recorded nowhere, so a one-click merge suggestion has no ' +
    'data source');
}

console.log('PASS f5-automerge-needs-positive-identity: ' + checks + ' checks - the silent gate now ' +
  'merges ONLY on positive DOB or MRN agreement with no conflict and exactly one candidate; ' +
  'name-alone, conflicting and ambiguous matches are refused and recorded as suggestions');
