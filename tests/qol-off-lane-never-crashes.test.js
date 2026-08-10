/* qol-1.5 control: THE OFF LANE'S DAY-NOTE PASS CAN NEVER KILL THE DAY VERDICT.
   The pass read the UNDECLARED todayNoteExtOk (and called an undefined
   safeAsync) at function-body level outside any try/catch: the first
   visits-skipped patient threw ReferenceError, finalizeVerdict() and the sweep
   never ran, and the progress panel span forever. Found by the supervising
   session's 11-agent audit, 2026-08-10; consistent with the day's store
   forensics once presence was separated from provenance. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'latin1');

/* the identifiers are declared before first use */
const declIdx = si.indexOf('var todayNoteExtOk = null;');
const helperIdx = si.indexOf('var safeAsync = async function (fn, fb)');
const useIdx = si.indexOf('if (todayNoteExtOk === null)');
assert.ok(declIdx > 0, 'todayNoteExtOk is declared');
assert.ok(helperIdx > 0, 'safeAsync is defined');
assert.ok(declIdx < useIdx && helperIdx < useIdx, 'declarations precede first use');

/* the whole pass is fenced so the day verdict is reachable on every path */
const fenceIdx = si.indexOf('} catch (eTodayNotePass) {');
const finalizeIdx = si.indexOf('finalizeVerdict();', fenceIdx);
assert.ok(fenceIdx > useIdx, 'the pass is wrapped in a try/catch');
assert.ok(finalizeIdx > fenceIdx && finalizeIdx - fenceIdx < 400, 'finalizeVerdict() runs immediately after the fence — reachable even on a throw');
assert.ok(si.indexOf('receipt.todayNotePassError') > 0, 'a fenced failure is recorded, not swallowed');

/* executed non-vacuity: the OLD shape (undeclared read) throws ReferenceError */
const oldShape = new Function('return (async function () { if (someUndeclaredIdentifier === null) { return 1; } return 2; })()');
let threw = null;
const p = oldShape().then(() => { threw = false; }, e => { threw = e instanceof ReferenceError; });
const newShape = new Function('return (async function () { var someDeclaredIdentifier = null; if (someDeclaredIdentifier === null) { return 1; } return 2; })()');
const p2 = newShape().then(v => assert.strictEqual(v, 1, 'declared shape runs'));

Promise.all([p, p2]).then(() => {
  assert.strictEqual(threw, true, 'non-vacuity: reading an undeclared identifier throws ReferenceError — the crash the fence exists for');
  console.log('qol-off-lane-never-crashes: OK (identifiers declared, pass fenced, verdict always reachable; old shape throws by name)');
}).catch(e => { console.error(e); process.exit(1); });
