'use strict';

/* A patient switch may restore that patient's in-tab draft, but an explicit
 * New visit made after the switch is a newer intent and must keep the editor
 * empty. Execute the shipped OpenSwitchFix and visitowner source together so
 * the test covers their real timer ordering and option handoff.
 *
 * REPINNED 2026-09-11 (adhocid-1.0.0). This suite used to assert that a
 * switch-back restored currentNoteId from the stash ("noteId: 'note-B'"), and
 * that is the defect the owner measured: an ad-hoc visit - a patient opened by
 * search, no appointment - auto-saved itself onto a record created in July,
 * because the stashed noteId was written the last time he left that patient
 * with a History record loaded and restoreFor put it straight back. A restored
 * in-tab draft is UNSAVED WORK, not an open History record. Every clinical byte
 * still comes back exactly as before; what does not come back is the claim to
 * overwrite a stored row. The id is not discarded either - it arrives as
 * PROVENANCE (_mlsSetContinuedFromId -> rec.continuedFrom), which is what the
 * continuedFrom column of each expectation below pins. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const twin = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

function visitOwnerSource(src) {
  const marker = src.indexOf('<!-- ===== visitowner-1.0.0');
  const open = src.indexOf('<script>', marker);
  const close = src.indexOf('</script>', open);
  assert(marker >= 0 && open > marker && close > open, 'visitowner source block is missing');
  return src.slice(open + '<script>'.length, close);
}
const visitOwner = visitOwnerSource(shell);
assert.strictEqual(visitOwner, visitOwnerSource(twin), 'canonical visitowner blocks differ');

const switchMarker = connect.indexOf('__mlsOpenSwitchFix v1.1.0');
const switchGuard = connect.indexOf('if (window.__mlsOpenSwitchFix) { return; }', switchMarker);
const switchOpen = connect.lastIndexOf('(function () {', switchGuard);
const switchCloseAt = connect.indexOf('delete window.__mlsOpenSwitchFix_revert;', switchGuard);
const switchEnd = connect.indexOf('\n})();', switchCloseAt);
assert(switchMarker >= 0 && switchOpen >= 0 && switchEnd > switchCloseAt, 'OpenSwitchFix source block is missing');
const openSwitchFix = connect.slice(switchOpen, switchEnd + '\n})();'.length);
assert(openSwitchFix.includes('patientSwitchReset: true'), 'patient-switch reset is not explicitly distinguished from New visit');

class MemoryStorage {
  constructor() { this.data = Object.create(null); }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; }
  setItem(k, v) { this.data[k] = String(v); }
  removeItem(k) { delete this.data[k]; }
  key(i) { return Object.keys(this.data)[i] || null; }
  get length() { return Object.keys(this.data).length; }
}

const elements = Object.create(null);
function element(id) {
  if (!elements[id]) elements[id] = {
    id, value: '', textContent: '', innerHTML: '', children: [],
    style: { display: 'none' }, remove() { delete elements[id]; }
  };
  return elements[id];
}
['transcript', 'noteBox', 'patientLabel', 'contextBox', 'visitComment', 'signLine'].forEach(element);

const listeners = Object.create(null);
const timeouts = [];
const intervals = [];
const newVisitOptions = [];
const patients = {
  A: { id: 'A', name: 'Synthetic Alpha' },
  B: { id: 'B', name: 'Synthetic Bravo' },
  C: { id: 'C', name: 'Synthetic Charlie' }
};

const sandbox = {
  console,
  document: {
    getElementById(id) { return elements[id] || null; }
  },
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
  setTimeout(fn) { timeouts.push(fn); return timeouts.length; },
  clearTimeout() {},
  setInterval(fn) { intervals.push(fn); return intervals.length; },
  clearInterval() {},
  currentSoap: '', currentInsurance: '', currentFormat: 'soap', currentNoteId: null,
  currentNoteProvenance: 'typed', currentCoding: null, lastEMR: null, lastAIDraft: '',
  currentHandout: '', currentVisitAthenaBinding: null, currentVisitAthenaCompromised: false,
  currentAthenaNote: '', currentAthenaNoteProvenance: 'none', currentAthenaNoteSourceFingerprint: ''
};
sandbox.window = sandbox;
sandbox.addEventListener = function (name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); };
sandbox.removeEventListener = function (name, fn) {
  listeners[name] = (listeners[name] || []).filter((x) => x !== fn);
};
sandbox.dispatchEvent = function (ev) { (listeners[ev.type] || []).slice().forEach((fn) => fn(ev)); };
sandbox.uns = (key) => 'test::' + key;
sandbox._acctTodayKey = () => '2026-09-10';
sandbox.getPatients = () => Object.values(patients);
sandbox.findPatient = (id) => patients[id] || null;
sandbox.getActivePtId = () => sandbox.localStorage.getItem(sandbox.uns('activePt')) || '';
sandbox.activePatient = () => patients[sandbox.getActivePtId()] || null;
sandbox._athenaHandleActivePatientChange = function () {};
sandbox.setActivePtId = function (id) {
  const previous = sandbox.getActivePtId();
  const next = String(id || '');
  if (previous !== next) sandbox._athenaHandleActivePatientChange(previous, next);
  if (next) sandbox.localStorage.setItem(sandbox.uns('activePt'), next);
  else sandbox.localStorage.removeItem(sandbox.uns('activePt'));
  if (next) sandbox.sessionStorage.setItem(sandbox.uns('activePtChosen'), next);
  if (previous !== next) sandbox.dispatchEvent(new sandbox.CustomEvent('mls:active-patient-changed', { detail: { previousId: previous, patientId: next } }));
};
sandbox.selectPatient = (id) => { if (id) sandbox.setActivePtId(id); };
sandbox.newVisit = function (opts) {
  newVisitOptions.push(opts);
  element('transcript').value = '';
  element('noteBox').value = '';
  sandbox.currentSoap = '';
  sandbox.currentInsurance = '';
  sandbox.currentNoteId = null;
  /* the shipped newVisit() clears this on the line after currentNoteId */
  sandbox._mlsSetContinuedFromId('');
  sandbox.currentVisitAthenaBinding = null;
};
/* adhocid-1.0.0: the shell's provenance carrier, so a dropped id would show up
   here as an empty continuedFrom rather than passing unnoticed. */
sandbox.__continuedFrom = '';
sandbox._mlsSetContinuedFromId = function (id) { sandbox.__continuedFrom = String(id || ''); };
sandbox.prefillContextFromProfile = function () {};
sandbox.saveDraft = () => true;
sandbox.toast = function () {};
sandbox.showNote = (text) => { element('noteBox').value = String(text || ''); };
sandbox.syncFormatToggle = sandbox.renderCoding = sandbox.populateEMR = function () {};
sandbox._athenaSetVisitBinding = (b) => { sandbox.currentVisitAthenaBinding = b; return true; };
sandbox._athenaFreezeVisitBinding = (p, meta) => ({ patient: p, visitContext: meta.visitContext || null });

vm.createContext(sandbox);
vm.runInContext(openSwitchFix, sandbox, { filename: '1p-mls-connect.js#OpenSwitchFix' });
intervals.slice().forEach((fn) => fn && fn());
vm.runInContext(visitOwner, sandbox, { filename: '1pScribeFlow.html#visitowner' });

function flush() {
  while (timeouts.length) {
    const batch = timeouts.splice(0);
    batch.forEach((fn) => fn && fn());
  }
}
function putDraft(label) {
  element('transcript').value = label + ' source';
  element('noteBox').value = label + ' note';
  sandbox.currentSoap = label + ' note';
  sandbox.currentNoteId = 'note-' + label;
  sandbox.__continuedFrom = '';
  sandbox.currentVisitAthenaBinding = { patient: { patientId: sandbox.getActivePtId(), name: patients[sandbox.getActivePtId()].name }, source: 'saved-record', visitContext: { visitDate: '2026-09-10' } };
}
function state() {
  return {
    active: sandbox.getActivePtId(), transcript: element('transcript').value,
    note: element('noteBox').value, noteId: sandbox.currentNoteId,
    continuedFrom: sandbox.__continuedFrom,
    binding: sandbox.currentVisitAthenaBinding
  };
}

/* Establish B's resumable draft, then prove an ordinary switch back restores it. */
sandbox.setActivePtId('A'); flush();
sandbox.setActivePtId('B'); flush();
putDraft('B');
sandbox.setActivePtId('C'); flush();
sandbox.setActivePtId('B'); flush();
assert.strictEqual(newVisitOptions[newVisitOptions.length - 1].patientSwitchReset, true,
  'ordinary patient switch did not identify its internal editor reset');
assert.strictEqual(JSON.stringify(state()), JSON.stringify({
  active: 'B', transcript: 'B source', note: 'B note', noteId: null, continuedFrom: 'note-B',
  binding: { patient: { patientId: 'B', name: 'Synthetic Bravo' }, visitContext: { visitDate: '2026-09-10' } }
}), 'ordinary switch-back no longer restores the exact patient draft as UNSAVED work (every byte back, no claim on the stored History row, the old id kept as provenance)');

/* Live reproducer: switch to B queues restore; immediate explicit New visit is
 * newer intent and must keep every restored field null/empty. */
sandbox.setActivePtId('C'); flush();
sandbox.setActivePtId('B');
sandbox.localStorage.setItem(sandbox.uns('notes'), JSON.stringify([{ id: 'saved-history-B', patientId: 'B' }]));
sandbox.newVisit();
flush();
assert.strictEqual(JSON.stringify(state()), JSON.stringify({ active: 'B', transcript: '', note: '', noteId: null, continuedFrom: '', binding: null }),
  'queued same-patient restore overrode explicit New visit');
assert.strictEqual(sandbox.__mlsVisitOwner.stash().B, undefined,
  'explicit New visit left the active patient\'s ephemeral restore stash armed');
assert.strictEqual(sandbox.localStorage.getItem(sandbox.uns('notes')), JSON.stringify([{ id: 'saved-history-B', patientId: 'B' }]),
  'explicit New visit changed the canonical History store while retiring ephemeral restore state');

/* Rapid B -> C: the older queued B intent cannot land after C wins. */
putDraft('B2');
sandbox.setActivePtId('C'); flush();
putDraft('C');
sandbox.setActivePtId('A'); flush();
sandbox.setActivePtId('B');
sandbox.setActivePtId('C');
flush();
assert.strictEqual(JSON.stringify(state()), JSON.stringify({
  active: 'C', transcript: 'C source', note: 'C note', noteId: null, continuedFrom: 'note-C',
  binding: { patient: { patientId: 'C', name: 'Synthetic Charlie' }, visitContext: { visitDate: '2026-09-10' } }
}), 'rapid switch allowed an older patient restore to win');

console.log('PASS explicit New visit cancels queued same-patient restore; ordinary and rapid switch restoration remain owned, and a restored draft comes back as unsaved work - every clinical byte, no currentNoteId, the stashed id kept only as continuedFrom provenance');
