'use strict';

/*
 * DEFECT 3 (2026-08-16): calApptPeek() (the calendar's click-an-appointment
 * popup, 1pScribeFlow.html / 1p/index.html) offered Start visit / Pull chart
 * / Details but no way to draft that patient's op note. Added a fourth
 * action, calDraftOpNoteFor(id), that resolves the appointment to a local
 * patient via the existing _calResolveLocalPatient() and only then calls
 * the existing openOpPrepForPatient(patientId).
 *
 * The safety property under test: openOpPrepForPatient(pid) falls back to
 * activePatient() when pid is falsy (null/undefined) — so a naive
 * "openOpPrepForPatient(_calResolveLocalPatient(a))" would silently open an
 * op note for whatever patient happens to be active elsewhere in the app
 * when the appointment cannot be resolved. That is a wrong-patient op note,
 * a patient-safety failure. calDraftOpNoteFor must fail closed: an
 * unresolved appointment must show a plain toast and never call
 * openOpPrepForPatient at all.
 *
 * Part 1 proves the markup (both twin files) wires a 4th button to
 * calDraftOpNoteFor. Part 2 executes the REAL extracted functions
 * (calDraftOpNoteFor + the real _calResolveLocalPatient it depends on) in a
 * fake DOM to prove the fail-closed behavior end to end.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

/* ---------------------------------------------------------- Part 1: markup */
['1pScribeFlow.html', '1p/index.html'].forEach((file) => {
  const src = read(file);
  const peekStart = src.indexOf('function calApptPeek(id, ev){');
  assert(peekStart >= 0, `${file}: calApptPeek is missing`);
  const peekEnd = src.indexOf('\nfunction calOpenDay(key){', peekStart);
  assert(peekEnd > peekStart, `${file}: could not bound calApptPeek's body`);
  const peekBody = src.slice(peekStart, peekEnd);

  /* Pin moved 2026-08-19 with t9pullbutton's deliberate rename: the peek's
     pull action names its real verb ("Pull this patient's chart"). */
  assert(/Start visit/.test(peekBody) && /Pull this patient(?:'|&#39;)s chart/.test(peekBody) && /Details/.test(peekBody),
    `${file}: calApptPeek lost one of its original three actions`);
  assert(/calDraftOpNoteFor\(/.test(peekBody),
    `${file}: calApptPeek must wire a fourth action to calDraftOpNoteFor`);
  assert(/Draft op note/.test(peekBody),
    `${file}: the fourth action must be labelled for the doctor, not just wired`);

  assert(src.includes('function calDraftOpNoteFor(id){'), `${file}: calDraftOpNoteFor is not defined`);
});

/* ------------------------------------------------------- Part 2: behavior */
const shellSource = read('1pScribeFlow.html');
const fnStart = shellSource.indexOf('function calDraftOpNoteFor(id){');
assert(fnStart >= 0, 'calDraftOpNoteFor not found for extraction');
// _calResolveLocalPatient (and its two small helpers) sit later in the same
// file; bound the extraction there so the real dependency, not a re-description
// of it, is what gets executed.
const helpersEnd = shellSource.indexOf('\nfunction calStartVisit(id){', fnStart);
assert(helpersEnd > fnStart, 'could not bound the calDraftOpNoteFor -> _calResolveLocalPatient span');
const moduleSource = shellSource.slice(fnStart, helpersEnd);
assert(moduleSource.includes('function _calResolveLocalPatient(a){'),
  'extraction did not capture the real _calResolveLocalPatient dependency');

function run(scenario) {
  const toasts = [];
  const opened = [];
  const removedPeek = { count: 0 };
  const peekEl = { removed: false };
  const context = {
    console, String, Array, Object,
    window: {},
    toast: (msg, kind) => toasts.push({ msg, kind }),
    document: {
      getElementById: (id) => (id === 'calApptPeek' ? (peekEl.removed ? null : { remove: () => { peekEl.removed = true; removedPeek.count++; } }) : null)
    },
    getPatients: () => scenario.patients || [],
    findPatient: (extId) => (scenario.patients || []).find((p) => String(p.id) === String(extId)) || null,
    _calLabelOf: (a) => a.name || '',
    _calAppts: scenario.appts,
    openOpPrepForPatient: (pid) => opened.push(pid)
  };
  context.window._calAppts = scenario.appts;
  vm.createContext(context);
  vm.runInContext(moduleSource, context, { filename: 'calDraftOpNoteFor.js', timeout: 2000 });
  vm.runInContext(`calDraftOpNoteFor(${JSON.stringify(scenario.clickId)})`, context);
  return { toasts, opened, peekRemoved: peekEl.removed };
}

/* Scenario A: the appointment resolves to exactly one local chart (id + dob
   agree) -> openOpPrepForPatient must be called with that REAL patient id. */
{
  const appts = [{ id: 501, name: 'Jordan Diaz', dob: '1980-01-02', patient_external_id: 'athena-jordan' }];
  const patients = [{ id: 'local-jordan', name: 'Jordan Diaz', dob: '1980-01-02' }];
  const res = run({ appts, patients, clickId: 501 });
  assert.deepStrictEqual(res.opened, ['local-jordan'],
    'a cleanly resolved appointment must open the op-note room for that EXACT local patient id');
  assert.strictEqual(res.toasts.length, 0, 'a successful resolve must not show an error toast');
  assert.strictEqual(res.peekRemoved, true, 'the peek popup must close when the action is taken');
  console.log('PASS A: a resolvable appointment opens the op-note room for the exact matched patient');
}

/* Scenario B (the safety property): the appointment cannot be resolved to
   any local chart (name matches nobody) -> openOpPrepForPatient must NEVER
   be called. Calling it with a falsy pid would fall back to activePatient()
   and silently draft the WRONG patient's op note. */
{
  const appts = [{ id: 502, name: 'Unknown Patient', dob: '1990-05-05' }];
  const patients = [{ id: 'someone-else', name: 'Completely Different Person', dob: '1975-03-03' }];
  const res = run({ appts, patients, clickId: 502 });
  assert.deepStrictEqual(res.opened, [],
    'FAIL CLOSED: an unresolved appointment must never call openOpPrepForPatient — that call falls back to ' +
    'activePatient() on a falsy id, which would silently open the WRONG patient\'s op note (a patient-safety failure)');
  assert.strictEqual(res.toasts.length, 1, 'an unresolved appointment must show exactly one explanatory toast');
  assert.strictEqual(res.toasts[0].kind, 'err', 'the explanation must be shown as an error, not a quiet notice');
  assert(/Unknown Patient/.test(res.toasts[0].msg) && /no op note was opened/i.test(res.toasts[0].msg),
    'the toast must name the appointment and plainly say no op note was opened, not just fail silently');
  console.log('PASS B: an unresolvable appointment fails closed — toast only, openOpPrepForPatient is never called');
}

/* Scenario C: two different local patients share the exact same normalized
   name with no DOB on the appointment to disambiguate -> still ambiguous,
   must still fail closed (this is _calResolveLocalPatient's own existing
   guarantee; proven here at the call site that matters). */
{
  const appts = [{ id: 503, name: 'Sam Lee', dob: '' }];
  const patients = [{ id: 'sam-1', name: 'Sam Lee', dob: '1960-01-01' }, { id: 'sam-2', name: 'Sam Lee', dob: '1988-09-09' }];
  const res = run({ appts, patients, clickId: 503 });
  assert.deepStrictEqual(res.opened, [], 'an ambiguous (same-name, unresolved-DOB) appointment must also fail closed, never guess between two charts');
  assert.strictEqual(res.toasts.length, 1);
  console.log('PASS C: an ambiguous same-name match without a disambiguating DOB fails closed too');
}

console.log('PASS p1 calendar peek op-note action: markup wired in both twins, and the real resolver’s fail-closed guarantee holds at the call site');
