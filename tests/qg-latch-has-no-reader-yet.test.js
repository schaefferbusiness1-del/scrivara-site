'use strict';
/* qg-2.0 latch guard: __mlsPtsEditAtRiskUnknown IS WRITE-ONLY ON PURPOSE, AND
   THIS TEST IS THE MARK THAT KEEPS THAT SAFE (supervisor, 2026-08-11): a
   zero-reader flag is the todayNoteReason class wearing a friendly face —
   deliberate today, indistinguishable from dead or working code in three
   months. This suite fails THE DAY THE FIRST READER APPEARS, and its failure
   message carries the pre-registered rule. It equally fails if someone
   deletes the flag as "dead code" — it is load-bearing forward provision. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FLAG = '__mlsPtsEditAtRiskUnknown';
const SHIPPED = ['ScribeFlow.html', 'mls-connect.js', 'feat_mls_saveshield.js', 'feat_mls_visitfix.js',
  'feat_mls_b121_pack.js', 'feat_mls_store_cache.js', 'content.js', 'background.js'];

function scan(text) {
  const hits = [];
  let i = -1;
  while ((i = text.indexOf(FLAG, i + 1)) >= 0) {
    const tail = text.slice(i + FLAG.length, i + FLAG.length + 8);
    hits.push(/^\s*=\s*true/.test(tail) ? 'write' : 'read-or-clear');
  }
  return hits;
}

let writers = 0, readers = 0;
for (const rel of SHIPPED) {
  const text = fs.readFileSync(path.join(root, rel), 'latin1');
  for (const kind of scan(text)) { if (kind === 'write') writers++; else readers++; }
}

assert.strictEqual(writers, 1,
  FLAG + ' must have exactly ONE writer (the qg-2.0 splice). Found ' + writers + '. ' +
  'If you are DELETING it: stop — it is a load-bearing forward provision, not dead code; ' +
  'the at-risk-unknown signal is pre-registered for the sync-status surface (sj-2.0 design doc).');

assert.strictEqual(readers, 0,
  'A READER OF ' + FLAG + ' HAS APPEARED (' + readers + ' found). This suite fails ON PURPOSE to hand ' +
  'you the pre-registered rule before your first green run: the latch is GLOBAL and MONOTONIC but the ' +
  'condition it records is PER-EDIT — you MUST carry the at-risk state PER-OPERATION (edit-scoped), and ' +
  'you MUST NEVER add a clear to the global flag (another patient\'s success would erase an unrelated ' +
  'at-risk state and the quiet branch would cover a lost edit). Wire your per-op machinery, keep the ' +
  'global set-only, then MOVE THIS PIN DELIBERATELY: assert your reader\'s per-op shape here instead. ' +
  'See tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md ("qg-2.0 latch discipline").');

/* EXECUTED NON-VACUITY: the scanner flags a synthetic reader and a synthetic
   second writer — green proves the instrument fires in both directions */
const synthReader = 'if(window.' + FLAG + '){ showQuiet(); }';
assert.ok(scan(synthReader).some(k => k === 'read-or-clear'), 'non-vacuity: a reader is detected');
const synthClear = 'window.' + FLAG + '=false;';
assert.ok(scan(synthClear).some(k => k === 'read-or-clear'), 'non-vacuity: a clear (=false) is detected as a violation, not a write');
const synthWriter = 'window.' + FLAG + '=true;';
assert.ok(scan(synthWriter).every(k => k === 'write'), 'harness sanity: the one legitimate shape classifies as a write');

console.log('qg-latch-has-no-reader-yet: OK (1 writer, 0 readers/clears across 8 shipped files; scanner fires on synthetic reader AND on =false-as-clear; the first real reader inherits the per-op rule in this failure message)');
