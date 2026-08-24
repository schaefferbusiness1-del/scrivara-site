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
assert(block.includes("replace(/[^a-z0-9_-]/g, '')"), 'failure reason/route are not restricted to closed code tokens');
assert(block.includes("['scanned', 'scrollers', 'topScore', 'inputCount', 'numericFieldsRefused', 'apptIdMatches', 'rowDobKnown']"),
  'bounded structural counters are not explicitly whitelisted');
assert(!/Object\.assign\([^\n]*openedSafe|\.\.\.opened|chartPatient|chartDob|chartMrn|rowDob\s*:/.test(block),
  'failure evidence copied a patient identifier or the unbounded worker result');

console.log('PASS chart-open-failure-diagnostics-contract: closed reason/route codes and structural counts cross content.js; patient identifiers do not');
