'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_redesign.js'), 'utf8');

function between(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing source slice ${start}`);
  return text.slice(a, b);
}

assert(source.includes('var VERSION = "3.2.4"'), 'redesign runtime version did not advance');
const slice = between(source, 'function syncClinicalSurfaceState(){', 'function ensurePayReportMenuItem(){');

const documentListeners = Object.create(null);
const windowListeners = Object.create(null);
const classes = new Set();
const note = { value: '', textContent: '' };
let activeId = 'patient-1';
let idReads = 0;
let recordReads = 0;

const document = {
  body: {
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        if (force) classes.add(name); else classes.delete(name);
        return !!force;
      }
    }
  },
  getElementById(id) {
    return ['mls-note', 'noteBox', 'ez3flNote', 'ez3Note'].includes(id) ? note : null;
  },
  addEventListener(type, fn) { documentListeners[type] = fn; }
};

const window = {
  getActivePtId() { idReads += 1; return activeId; },
  activePatient() { recordReads += 1; return { id: activeId, name: 'Synthetic' }; },
  addEventListener(type, fn) { windowListeners[type] = fn; }
};

const context = {
  window,
  document,
  String,
  _surfaceInputHandler: null,
  _surfacePatientHandler: null,
  _surfaceStorageHandler: null
};
vm.createContext(context);
vm.runInContext(`function $(id){return document.getElementById(id);}\n${slice}`, context,
  { filename: 'feat_mls_redesign.surface-slice.js' });
context.installClinicalSurfaceState();

assert.strictEqual(typeof windowListeners.storage, 'function', 'storage owner was not installed');
assert.strictEqual(typeof windowListeners['mls:active-patient-changed'], 'function', 'active-patient owner was not installed');
assert.strictEqual(typeof documentListeners.input, 'function', 'note-input owner was not installed');

for (let i = 0; i < 500; i += 1) {
  windowListeners.storage({ key: `acct::patients` });
  windowListeners.storage({ key: `acct::activePt` });
}
assert.strictEqual(recordReads, 0, 'cross-tab storage bursts decoded/read the full patient roster');
assert.strictEqual(idReads, 1000, 'storage bursts did not use the O(1) active-id owner exactly once');
assert(classes.has('mls-has-active-patient'), 'active-patient body state was not preserved');
assert(!classes.has('mls-no-active-patient'), 'active-patient body state inverted');

const readsBeforeNotes = idReads;
for (let i = 0; i < 500; i += 1) windowListeners.storage({ key: 'acct::notes' });
assert.strictEqual(idReads, readsBeforeNotes, 'remote notes writes still trigger unrelated patient-state work');
assert.strictEqual(recordReads, 0, 'remote notes writes reached activePatient()');

note.value = 'Draft text';
documentListeners.input({ target: { id: 'noteBox' } });
assert(classes.has('mls-has-note-draft'), 'note draft class no longer follows the active-id owner');
assert.strictEqual(recordReads, 0, 'typing in the note editor decoded/read the full roster');

activeId = '';
windowListeners['mls:active-patient-changed']();
assert(!classes.has('mls-has-active-patient'), 'clearing the active id left the active class behind');
assert(classes.has('mls-no-active-patient'), 'clearing the active id did not set the empty class');
assert(!classes.has('mls-has-note-draft'), 'an unbound draft retained the patient-draft class');

delete window.getActivePtId;
window.activePatient = function activePatientFallback() {
  recordReads += 1;
  return { id: 'legacy-patient', name: 'Legacy Host' };
};
windowListeners['mls:active-patient-changed']();
assert.strictEqual(recordReads, 1, 'older hosts lost the activePatient compatibility fallback');
assert(classes.has('mls-has-active-patient'), 'compatibility fallback did not preserve body state');

console.log('PASS redesign clinical surface: 1,000 cross-tab roster/id writes and 500 note writes perform zero full-roster reads while body classes remain exact');
