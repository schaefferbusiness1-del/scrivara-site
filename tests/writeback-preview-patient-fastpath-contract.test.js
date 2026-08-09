'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_writeback_safety.js'), 'utf8');
assert(source.includes("var VERSION = 'wbs-1.2.0'"), 'writeback safety fast-path version is missing');
assert(!/setInterval\s*\(/.test(source), 'writeback preview regained its four-second permanent poll');
assert(source.includes('renderPreview(panel, true);   /* re-evaluate FRESH at click time */'),
  'write click no longer forces a fresh fail-closed patient check');
assert(source.includes("panel.addEventListener('input', function () { renderPreview(panel, false);"),
  'ordinary panel input no longer uses the cached presentation snapshot');

const start = source.indexOf('var previewPatientId = null');
const end = source.indexOf('function esc(', start);
assert(start >= 0 && end > start, 'writeback patient snapshot helper is missing');
let rosterReads = 0, activeId = 'p-1';
const context = {
  S(value) { return value == null ? '' : String(value); },
  activePt() { rosterReads++; return { id: activeId, name: 'Synthetic Patient', dob: '2000-01-01', mrn: 'TEST-1' }; },
  window: {
    getActivePtId() { return activeId; },
    activePatient() { throw new Error('extracted helper must use the injected activePt owner'); }
  }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nthis.previewPatient=previewPatient;', context);
assert.strictEqual(context.previewPatient(true).id, 'p-1');
for (let i = 0; i < 1000; i++) assert.strictEqual(context.previewPatient(false).id, 'p-1');
assert.strictEqual(rosterReads, 1, '1,000 writeback inputs repeatedly read the roster');
activeId = 'p-2';
assert.strictEqual(context.previewPatient(false), null, 'unexpected patient switch reused stale identity on input');
assert.strictEqual(rosterReads, 1, 'unexpected patient switch decoded the roster from the input event');
assert.strictEqual(context.previewPatient(true).id, 'p-2', 'fresh write-click lookup did not adopt the current patient');
assert.strictEqual(rosterReads, 2, 'fresh write-click lookup performed duplicate patient reads');

console.log('PASS writeback patient fast path: 1,000 inputs use one snapshot while every write click re-verifies fresh identity');
