'use strict';
/* Import and the EMR backup say what was kept apart (sweepfix-1.0.0, 2026-09-23).
   The server no longer overwrites a chart that belongs to someone else: such a
   record becomes its own chart (`separate`) or, when only a name identifies it,
   is not written (`unplaced`). The app counted only `patients`, so those records
   silently went missing from the message. Runs the real functions. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const mirror = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
function fnBlock(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert(at >= 0, name + ' not found');
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1);
}
for (const n of ['_chartWriteNotes', '_emrSyncFmtResult']) assert.strictEqual(fnBlock(mirror, n), fnBlock(html, n), n + ' matches in 1p/index.html');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fnBlock(html, '_chartWriteNotes') + '\n' + fnBlock(html, '_emrSyncFmtResult'), ctx);
const plain = ctx._emrSyncFmtResult({ ok: true, patients: 3, visits: 5 });
assert.strictEqual(plain, '✓ Last backup: 3 patients, 5 visit records.', 'nothing added when nothing was kept apart');
const both = ctx._emrSyncFmtResult({ ok: true, patients: 3, visits: 5, separate: 1, unplaced: 2 });
assert.match(both, /1 kept as a separate chart \(/);
assert.match(both, /2 not saved \(only a name identified them; add a date of birth or MRN\)/);
assert.match(ctx._chartWriteNotes({ separate: 2 }), /^ 2 kept as separate charts \(/);
assert.strictEqual(ctx._chartWriteNotes({}), '');
const imp = fnBlock(html, 'importPatients');
assert.match(imp, /_chartWriteNotes\(d\)/, 'the import result names what was kept apart');
console.log('PASS import says what was kept apart: the import and the EMR backup messages name records kept as separate charts and records not saved, and say nothing extra when there are none');
