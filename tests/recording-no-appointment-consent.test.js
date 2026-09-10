'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', '1p-mls-connect.js'), 'utf8');
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'could not isolate canonical no-appointment start path');
  return source.slice(a, b);
}

const patientFn = between('function lockAndStartPatient(p, opts) {', '\n  /* =======================================================================');
const calls = [];
let selected = null;
let recording = false;
let acceptSelection = true;
const context = {
  S: {},
  isRecording() { return recording; },
  blockSwitchWhileRecording() { calls.push('blocked'); },
  setEasyMode() { calls.push('doctor'); },
  isFn(v) { return typeof v === 'function'; },
  window: { selectPatient(id) { calls.push(['select', id]); if (acceptSelection) selected = { id, name: 'Synthetic Patient' }; } },
  activeName() { return selected ? selected.name : 'Different Patient'; },
  canonicalActivePatient() { return selected; },
  nameMatch(a, b) { return a === b; },
  setTimeout(fn) { fn(); },
  captureBtn() { return { click() { calls.push('capture'); } }; },
  render() { calls.push('render'); }
};
vm.createContext(context);
vm.runInContext(patientFn, context, { filename: '1p-mls-connect.js#lockAndStartPatient' });

const p = { id: 'synthetic-patient-1', name: 'Synthetic Patient', dob: '1970-01-01' };
context.lockAndStartPatient(p, { record: true });
assert(calls.some(x => Array.isArray(x) && x[0] === 'select' && x[1] === p.id), 'hero did not select the named patient');
assert.strictEqual(calls.filter(x => x === 'capture').length, 1, 'one no-appointment Start Recording press did not issue one capture request');

calls.length = 0;
selected = null;
context.lockAndStartPatient(p);
assert.strictEqual(calls.filter(x => x === 'capture').length, 0, 'ordinary patient selection unexpectedly starts recording');

calls.length = 0;
selected = { id: 'different-patient', name: p.name };
acceptSelection = false;
context.lockAndStartPatient(p, { record: true });
assert.strictEqual(calls.filter(x => x === 'capture').length, 0,
  'same-name patient with a different canonical ID passed the recording identity gate');
assert(/Nothing was started/.test(context.S.lastWarn || ''), 'refused exact-patient selection left no visible refusal');

calls.length = 0;
recording = true;
context.S.appt = { _pt: true, _patientId: 'different-patient' };
context.lockAndStartPatient(p, { record: true });
assert.deepStrictEqual(calls, ['blocked'], 'an active recording allowed a patient switch or issued another capture request');

const hero = between("on('ez3ActiveGo', function () {", "\n    on('ez3Choose'");
assert(hero.includes('lockAndStartPatient(p, { record: true });'), 'the no-appointment hero still opens Visit without requesting recording');
assert(source.includes("document.querySelectorAll('.ez3fl-recfail')"), 'a new attempt does not synchronously hide the prior failure row');
assert(/if \(_recArmed && consentAskOpen\(\)\)[\s\S]{0,260}_recPending[\s\S]{0,260}Waiting on the consent dialog/.test(source),
  'an Easy/hero start does not adopt and visibly describe the pending consent request');

console.log('PASS recording no-appointment consent journey: one hero press selects the exact patient, requests capture once, and pending consent replaces stale failure UI');
