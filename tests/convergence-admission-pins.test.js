'use strict';
/* cva-1.0.0 regression (Codex reply 27): the convergence lane's admission is
   monotonic and fingerprinted. Reproduces the live 6/6 -> 5/5 shape: a cohort
   whose capped reads ended in identical named omissions must NOT buy a second
   convergence round; a changed reason (progress) or a new entry may. The
   helpers are extracted from the SHIPPED 1p bytes and executed. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), '1p-mls-connect.js'), 'utf8');
const start = src.indexOf('function cvRetryFingerprint(item)');
const end = src.indexOf('function dsAutoConvergeBodies', start);
assert.ok(start > 0 && end > start, 'the cva-1.0.0 admission helpers are gone');
const helpers = new Function(src.slice(start, end) + '\nreturn { cvRetryFingerprint, cvAdmitRound };')();

const cohort = (reason) => [
  { patientId: 'p1', frozenMrn: '101', reason },
  { patientId: 'p2', frozenMrn: '102', reason },
  { patientId: 'p3', frozenMrn: '103', reason },
  { patientId: 'p4', frozenMrn: '104', reason },
  { patientId: 'p5', frozenMrn: '105', reason }
];

/* round 0: five fresh omissions admit */
const seen = {};
let gate = helpers.cvAdmitRound(cohort('visit-bodies-incomplete'), seen, 0);
assert.strictEqual(gate.admit, true, 'round 0 with fresh omissions must admit: ' + gate.why);
cohort('visit-bodies-incomplete').forEach(it => { seen[helpers.cvRetryFingerprint(it)] = 1; });

/* the live burn: the SAME five unchanged omissions must NOT buy round 1 */
gate = helpers.cvAdmitRound(cohort('visit-bodies-incomplete'), seen, 1);
assert.strictEqual(gate.admit, false, 'unchanged omissions bought a second round');
assert.strictEqual(gate.why, 'no-fresh-omissions', 'the refusal must name the monotonic gate: ' + gate.why);

/* progress: one entry whose reason CHANGED re-admits */
const progressed = cohort('visit-bodies-incomplete');
progressed[2] = { patientId: 'p3', frozenMrn: '103', reason: 'athena-tab-sleeping' };
gate = helpers.cvAdmitRound(progressed, seen, 1);
assert.strictEqual(gate.admit, true, 'a changed reason (progress) must re-admit: ' + gate.why);

/* the round cap still binds even with fresh entries */
gate = helpers.cvAdmitRound([{ patientId: 'p9', frozenMrn: '999', reason: 'x' }], {}, 2);
assert.strictEqual(gate.admit, false, 'the 2-round cap was lost');
assert.strictEqual(gate.why, 'round-cap');

/* empty set settles immediately */
gate = helpers.cvAdmitRound([], {}, 0);
assert.strictEqual(gate.admit, false);
assert.strictEqual(gate.why, 'empty');

/* wiring pins: the gate guards again() and fingerprints are marked at round start */
assert.ok(src.includes('var cvGate = cvAdmitRound(items, cvSeenFp, rounds);'), 'the admission gate left again()');
assert.ok(src.includes("if (!cvGate.admit) { settle(); return; }"), 'the gate no longer settles on refusal');
assert.ok(src.includes('items.forEach(function (it) { cvSeenFp[cvRetryFingerprint(it)] = 1; });'), 'round-start fingerprint marking is gone');
assert.ok(src.indexOf('cvSeenFp = {}') > 0, 'the per-invocation seen map is gone (epoch fencing broke)');

console.log('PASS convergence admission pins: unchanged omissions never buy a second round, progress re-admits, the round cap and epoch-scoped seen map hold (executed from shipped 1p bytes)');
