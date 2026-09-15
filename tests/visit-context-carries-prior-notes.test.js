'use strict';
/* priorvisits-1.0.0 (2026-09-15) - THE VISIT NOTE SEES THE PATIENT'S PRIOR NOTES.
 *
 * Owner (GOAL 2026-09-12): "op notes and ordinary notes both need to see
 * patient history and prior visits." buildPatientContext() carried problems,
 * medications, allergies, the pulled chart summary and pasted context - and
 * not one prior note. This executes the shipped function, sliced out of BOTH
 * twins, against a synthetic chart. No patient text.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let checks = 0;
function ok(c, m) { checks++; assert.ok(c, m); }

for (const file of ['1pScribeFlow.html', '1p/index.html']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const start = src.indexOf('function buildPatientContext(){');
  assert(start > 0, file + ': buildPatientContext not found');
  const end = src.indexOf('\n}\n', start);
  const fn = src.slice(start, end + 3);
  ok(fn.includes("priorvisits-1.0.0"), file + ': the prior-notes block is present');
  const notes = [
    { id: 'n1', patientId: 'p1', soap: 'HPI: old visit one.\nPLAN: rest.', updated: 1000, isDraft: false },
    { id: 'n2', patientId: 'p1', soap: 'HPI: old visit two.\nPLAN: ice.', updated: 3000, isDraft: false },
    { id: 'n3', patientId: 'p1', text: 'Procedure: left L4-5 injection performed.', kind: 'opnote', updated: 5000, isDraft: false },
    { id: 'n4', patientId: 'p1', soap: 'HPI: newest visit.\nPLAN: PT.', updated: 7000, isDraft: false },
    { id: 'n5', patientId: 'p1', soap: 'HPI: a draft that must not ride.', updated: 9000, isDraft: true },
    { id: 'n6', patientId: 'p1', soap: '   ', updated: 9500, isDraft: false },
  ];
  const ctx = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    activePatient() { return { id: 'p1', name: 'Test Patient', sex: 'F', dob: '1980-01-01', problems: 'low back pain', meds: 'none', allergies: 'NKDA', summary: 'summary text' }; },
    patientNotes(id) { return id === 'p1' ? notes : []; },
    getContext() { return ''; },
    _mlsGenerationFieldText(v) { return String(v || ''); },
  };
  ctx.window = ctx;
  vm.runInNewContext(fn + '\nglobalThis.__out = buildPatientContext();', ctx, { filename: file });
  const out = ctx.__out;
  ok(out.includes('Prior notes (most recent first; BACKGROUND ONLY'), file + ': the block is labelled background only');
  const idxNewest = out.indexOf('newest visit'), idxOp = out.indexOf('left L4-5 injection'), idxTwo = out.indexOf('old visit two'), idxOne = out.indexOf('old visit one');
  ok(idxNewest > 0 && idxOp > idxNewest && idxTwo > idxOp, file + ': newest first, then the op note, then the older visit');
  ok(idxOne < 0, file + ': only the three most recent finished notes ride');
  ok(!out.includes('a draft that must not ride'), file + ': drafts never ride');
  ok(out.includes('prior operative note'), file + ': an op note is labelled as such');
  ok(out.indexOf('Prior notes') > out.indexOf('summary text'), file + ': the prior notes follow the chart summary');
  /* bounded: a 5,000-character note is cut to 900 */
  const big = { id: 'n7', patientId: 'p1', soap: 'HPI: ' + 'x'.repeat(5000), updated: 8000, isDraft: false };
  notes.push(big);
  vm.runInNewContext('globalThis.__out2 = buildPatientContext();', ctx, { filename: file + '#2' });
  const runLen = (ctx.__out2.match(/x+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
  ok(runLen <= 900 && runLen > 800, file + ': each prior note is bounded to 900 characters (got ' + runLen + ')');
  notes.pop();
  /* no patient: nothing breaks, nothing rides */
  ctx.activePatient = () => null;
  vm.runInNewContext('globalThis.__out3 = buildPatientContext();', ctx, { filename: file + '#3' });
  ok(!ctx.__out3.includes('Prior notes'), file + ': no active patient, no block');
}
console.log('PASS visit context carries prior notes: the three most recent finished notes ride the BACKGROUND_ONLY block, newest first, bounded, drafts excluded, in both twins (' + checks + ' checks)');
