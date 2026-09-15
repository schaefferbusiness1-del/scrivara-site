'use strict';

/* A chart-open failure must keep enough PHI-free evidence for the pull engine
 * to distinguish a transient Athena renderer failure from a true no-result.
 * This is a bridge contract only; synthetic codes and counts, no patient data. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');
const start = source.indexOf('/* lpf-1.0.0: keep the worker\'s PHI-free refusal evidence');
const end = source.indexOf('return;', start);
assert(start >= 0 && end > start, 'PHI-free chart-open failure bridge is missing');
const block = source.slice(start, end);

for (const field of ['findReason:', 'via:', 'candidates:', 'sessionLikelyExpired:', 'diag: safeDiag']) {
  assert(block.includes(field), 'chart-open failure bridge dropped ' + field);
}
assert(block.includes('.test(code) ? code :'), 'failure reason/route are not restricted to a closed vocabulary');
assert(block.includes("['scanned', 'scrollers', 'topScore', 'inputCount', 'numericFieldsRefused', 'apptIdMatches', 'rowDobKnown',") && block.includes("'navChangedFrames', 'eaSkipped', 'eaNoCand', 'eaCand', 'eaTimeout', 'eaMatches', 'eaRejVia', 'eaRejName', 'eaRejDob', 'eaRejEncish', 'eaRejDate'") /* navproof-diag-1.0.0 (3.0.136) */,
  'bounded structural counters are not explicitly whitelisted');
assert(!/Object\.assign\([^\n]*openedSafe|\.\.\.opened|chartPatient|chartDob|chartMrn|rowDob\s*:/.test(block),
  'failure evidence copied a patient identifier or the unbounded worker result');

const relay = new Function('opened', 'finishChart', 'mlsStr', 'openErr', block);
function run(opened) {
  let result;
  relay(opened, r => { result = r; }, (v, limit) => String(v || '').slice(0, limit), null);
  return result;
}
const precise = run({ reason: 'appointment-navigation-snapshot-unavailable', diag: { rowRebinds: 2, scheduleRegrounds: 1, scheduleDateVerified: true } });
assert.strictEqual(precise.reason, 'appointment-navigation-snapshot-unavailable', 'a long closed code was truncated');
assert.strictEqual(precise.diag.rowRebinds, 2);
assert.strictEqual(precise.diag.scheduleRegrounds, 1);
assert.strictEqual(precise.diag.scheduleDateVerified, true);
const noPhi = run({ reason: 'JaneSample-70001', findReason: 'JaneSample-70001', via: 'JaneSample-70001', diag: { rowRebinds: 500, scheduleRegrounds: -10, patientName: 'Jane Sample', mrn: '70001' } });
assert.strictEqual(noPhi.reason, 'open-failed');
assert.strictEqual(noPhi.findReason, '');
assert.strictEqual(noPhi.via, '');
assert.strictEqual(noPhi.diag.rowRebinds, 9);
assert.strictEqual(noPhi.diag.scheduleRegrounds, 0);
assert(!JSON.stringify(noPhi.diag).includes('Jane') && !JSON.stringify(noPhi.diag).includes('70001'));

console.log('PASS chart-open-failure-diagnostics-contract: closed reason/route codes and structural counts cross content.js; patient identifiers do not');
