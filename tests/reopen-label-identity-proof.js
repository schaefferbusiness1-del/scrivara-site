'use strict';

/* label-1.0.0 - THE PATIENT LABEL IS NOT IDENTITY.
 *
 * OWNER RULING, 2026-09-02, verbatim: "make sure patients are always linked -
 * whatever patient is at the top bar header is the patient for the day" and
 * "whoever I have up needs to be consistent everywhere".
 *
 * MEASURED on his tab at b1208 (2026-09-02 13:4x, test patient only): the
 * saved note's athena sidecar (1,645 chars, provenance 'generated') carried
 * patientLabel "Tina McMillan" in its source fingerprint - the up-now patient's
 * name at generation time - while its activePatientId, patient id/name/DOB/MRN,
 * visit and every clinical field (transcript, context, visitComment,
 * standardNote) were the test patient's own, and the RECORD's patientLabel was
 * the test patient's name. Both comparators refused on that one free-text
 * field: _mlsSavedAthenaFingerprintMatchesRecord required
 * state.patientLabel === n.patientLabel, and _mlsAthenaFingerprintMatchesCurrent
 * required whole-string equality with the live fingerprint. The reopen went
 * 'stale', the sheet showed zero rows and demanded "Generate the five local
 * draft fields first" for a note whose payload was already valid.
 *
 * THE FIX, pinned here against the SHIPPED functions of both twins (lifted,
 * never reimplemented): #patientLabel is a free-text input and is compared by
 * neither door; activePatientId, patient.patientId/name/dob/mrn, every visit
 * field and every clinical field stay byte-compared. A fingerprint that
 * differs in ANY of those still refuses, exactly as before.
 *
 * Run:  node tests/reopen-label-identity-proof.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }
function read(file) { return fs.readFileSync(path.join(ROOT, file), 'latin1'); }

const CANON_TEXT = [
  'HPI:', 'Pain improved after the injection.',
  '', 'ROS:', 'Denies weakness or bowel/bladder change.',
  '', 'EXAM:', 'Strength is five out of five.',
  '', 'ASSESSMENT:', 'Lumbar radicular pain, improving.',
  '', 'PLAN:', 'Continue home exercise and follow up in four weeks.'
].join('\n');
const DAY = '2026-08-31', PROVIDER = 'Matthew Schaeffer, MD', APPOINTMENT = '56021013', ENCOUNTER = '99001', ENCOUNTER_URL = 'https://athena.example/encounter/99001';

function canonicalBlock(source) {
  const start = source.indexOf('function _mlsAthenaNoteQualityError(');
  const end = source.indexOf('\n\n/* =========================================================\n   GENERATE NOTE', start);
  ok(start >= 0 && end > start, 'the canonical Athena state block moved or was removed');
  return source.slice(start, end);
}

/* The same shell harness shape tests/sheet-rows-and-reopen-proof.js uses: a
   sandbox with the DOM inputs the fingerprint reads, the app binding, and the
   lifted functions of the block itself. */
function shellHarness(block, file, activeId) {
  const values = { transcript: 'source transcript', contextBox: 'source context', visitComment: '', patientLabel: 'Test Patient', noteBox: CANON_TEXT };
  const binding = {
    patient: { patientId: 'p-1', name: 'Test Patient', dob: '2006-03-24', mrn: '7833832' },
    visitContext: { visitDate: DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL }
  };
  const sandbox = {
    window: { __mlsWriteFlow: { parseGeneratedSoapSections: () => ({ ok: false, sections: [] }) } },
    document: {
      getElementById: (id) => Object.prototype.hasOwnProperty.call(values, id) ? {
        get value() { return values[id]; },
        set value(v) { values[id] = String(v); }
      } : null
    },
    getActivePtId: () => activeId || 'p-1',
    currentVisitAthenaBinding: binding,
    currentSoap: CANON_TEXT, currentInsurance: '', currentFormat: 'soap',
    currentNoteProvenance: 'generated_soap',
    currentAthenaNote: '', currentAthenaNoteProvenance: 'none', currentAthenaNoteSourceFingerprint: ''
  };
  vm.createContext(sandbox);
  vm.runInContext(block + '\n' + [
    'this.__api={',
    '  set:_mlsSetAthenaNote,',
    '  restore:_mlsRestoreAthenaState,',
    '  reopen:_mlsReopenRestoreSavedAthenaSidecar,',
    '  fingerprint:_mlsAthenaSourceFingerprint,',
    '  matchesCurrent:_mlsAthenaFingerprintMatchesCurrent,',
    '  write:_mlsAthenaCanonicalForWrite,',
    '  saved:_mlsSavedAthenaCanonicalForWrite,',
    '  matchesRecord:_mlsSavedAthenaFingerprintMatchesRecord',
    '};'
  ].join('\n'), sandbox, { filename: file });
  return { sandbox, values, binding, api: sandbox.__api };
}

/* A record as History saved it: the label the RECORD carries is the header
   patient's name; the fingerprint is whatever the label input held when the
   sidecar was generated. */
function recordFor(h, fingerprint) {
  const s = h.sandbox, v = h.values;
  return {
    id: 'label-1', patient: h.binding.patient.name, patientLabel: h.binding.patient.name, patientId: 'p-1',
    patientDob: h.binding.patient.dob, patientMrn: h.binding.patient.mrn,
    transcript: v.transcript, context: v.contextBox, visitComment: v.visitComment,
    soap: s.currentSoap, noteProvenance: s.currentNoteProvenance,
    athenaNote: s.currentAthenaNote, athenaNoteProvenance: s.currentAthenaNoteProvenance,
    athenaNoteSourceFingerprint: fingerprint,
    visitDate: h.binding.visitContext.visitDate, provider: h.binding.visitContext.provider,
    appointmentId: h.binding.visitContext.appointmentId, encounterId: h.binding.visitContext.encounterId,
    encounterUrl: h.binding.visitContext.encounterUrl, coding: null, orders: []
  };
}
function withLabel(fingerprint, label) { const o = JSON.parse(fingerprint); o.patientLabel = label; return JSON.stringify(o); }
function withField(fingerprint, mutate) { const o = JSON.parse(fingerprint); mutate(o); return JSON.stringify(o); }

function runShell(block, file, expectFixed) {
  /* 1. Generate the sidecar while the label input shows ANOTHER patient's name
        (the measured shape: the up-now patient's label under the test
        patient's id). */
  const h = shellHarness(block, file);
  const s = h.sandbox, v = h.values, api = h.api;
  v.patientLabel = 'Other Upnow Patient';
  api.set(CANON_TEXT, 'generated');
  const generatedFp = s.currentAthenaNoteSourceFingerprint;
  ok(generatedFp.length > 0 && JSON.parse(generatedFp).patientLabel === 'Other Upnow Patient', file + ': the fixture did not capture the drifted label');
  ok(JSON.parse(generatedFp).activePatientId === 'p-1' && JSON.parse(generatedFp).patient.mrn === '7833832', file + ': the fixture identity is not the test patient');

  /* 2. History saves the record with the HEADER patient's name as its label. */
  const record = recordFor(h, generatedFp);
  ok(record.patientLabel !== JSON.parse(generatedFp).patientLabel, file + ': the record/fingerprint label drift control is invalid');

  /* 3. The reopen: loadRecordIntoEditor fills #patientLabel from the record. */
  v.patientLabel = record.patient;
  s.currentAthenaNote = ''; s.currentAthenaNoteProvenance = 'none'; s.currentAthenaNoteSourceFingerprint = '';
  api.restore(record);
  const restored = s.currentAthenaNoteProvenance === 'generated' && s.currentAthenaNote === record.athenaNote;
  const recordAccepted = api.matchesRecord(record.athenaNoteSourceFingerprint, record) === true;
  const reopened = api.reopen(record) === true;
  const writable = api.write() && api.write().ok === true;
  if (expectFixed) {
    eq(recordAccepted, true, file + ': THE MEASURED DEFECT - a record whose fingerprint differs only in patientLabel is still refused by the record comparator');
    eq(restored || reopened, true, file + ': the reopen still discards a sidecar over a label-only difference');
    eq(s.currentAthenaNoteProvenance, 'generated', file + ': the reopened sidecar did not keep its generated provenance');
    eq(s.currentAthenaNote, record.athenaNote, file + ': the reopened sidecar text is not the saved payload');
    eq(writable, true, file + ': the reopened review is still not write-ready - a regenerate is still being demanded');
    eq(api.matchesCurrent(withLabel(api.fingerprint(), 'Yet Another Label')), true, file + ': a label-only difference must match the live fingerprint');
  } else {
    /* negative control: the pre-fix bytes reproduce the measured defect */
    return { recordAccepted, restored, reopened, writable };
  }

  /* 4. IDENTITY STILL REFUSES - every non-label field is byte-compared. */
  const live = api.fingerprint();
  const identityDrifts = {
    activePatientId: (o) => { o.activePatientId = 'p-2'; },
    'patient.patientId': (o) => { o.patient.patientId = 'p-2'; },
    'patient.name': (o) => { o.patient.name = 'Someone Else'; },
    'patient.dob': (o) => { o.patient.dob = '1980-01-01'; },
    'patient.mrn': (o) => { o.patient.mrn = '1111111'; },
    'visit.visitDate': (o) => { o.visit.visitDate = '2026-09-01'; },
    'visit.appointmentId': (o) => { o.visit.appointmentId = '1'; },
    'visit.encounterId': (o) => { o.visit.encounterId = '2'; },
    'visit.encounterUrl': (o) => { o.visit.encounterUrl = 'https://athena.example/other'; },
    'visit.provider': (o) => { o.visit.provider = 'Other Provider, MD'; },
    transcript: (o) => { o.transcript = 'a different transcript'; },
    context: (o) => { o.context = 'different context'; },
    visitComment: (o) => { o.visitComment = 'a comment'; },
    standardNote: (o) => { o.standardNote = CANON_TEXT + '\nEdited.'; },
    version: (o) => { o.v = 1; }
  };
  Object.keys(identityDrifts).forEach(function (name) {
    const drifted = withField(live, identityDrifts[name]);
    eq(api.matchesCurrent(drifted), false, file + ': a fingerprint differing in ' + name + ' must NOT match the live state');
    const driftedAndLabel = withLabel(drifted, 'Other Upnow Patient');
    eq(api.matchesCurrent(driftedAndLabel), false, file + ': a label difference must not mask a ' + name + ' difference');
    const rec = recordFor(h, driftedAndLabel);
    eq(api.matchesRecord(driftedAndLabel, rec), false, file + ': the record comparator must refuse a fingerprint differing in ' + name);
  });
  eq(api.matchesCurrent(''), false, file + ': an empty fingerprint never matches');
  eq(api.matchesCurrent('not json'), false, file + ': a malformed fingerprint never matches');
  eq(api.matchesCurrent(live), true, file + ': the exact live fingerprint still matches');

  /* 5. The record comparator still needs the record to carry a string label
        (a record shape check, not an identity check). */
  const noLabel = recordFor(h, live); delete noLabel.patientLabel;
  eq(api.matchesRecord(live, noLabel), false, file + ': a record without a patientLabel field is still refused (shape, not identity)');
  const idMismatch = recordFor(h, live); idMismatch.patientId = 'p-9';
  eq(api.matchesRecord(live, idMismatch), false, file + ': a record whose own patientId differs from the fingerprint is refused');
}

SHELLS.forEach(function (file) {
  const source = read(file);
  const block = canonicalBlock(source);
  /* 0. source pins: the fix is present exactly once, the old spelling is gone */
  eq((block.match(/function _mlsAthenaLabelOnlyDrift\(/g) || []).length, 1, file + ': _mlsAthenaLabelOnlyDrift must be defined exactly once');
  eq(block.indexOf('state.patientLabel===n.patientLabel'), -1, file + ': the record comparator must not compare the label');
  ok(block.indexOf('label-1.0.0') >= 0, file + ': the change is not named in the source');
  runShell(block, file, true);

  /* 6. NEGATIVE CONTROL - rebuild the pre-fix bytes in-process and prove they
        reproduce the measured defect (the record refused, the sidecar gone). */
  const preFix = block
    .replace(/function _mlsAthenaFingerprintMatchesCurrent\(expected\)\{[\s\S]*?\n\}\nfunction _mlsAthenaLabelOnlyDrift\(a,b\)\{[\s\S]*?\n\}/,
      "function _mlsAthenaFingerprintMatchesCurrent(expected){return !!String(expected||'')&&String(expected)===_mlsAthenaSourceFingerprint();}")
    .replace("typeof n.patientLabel==='string'&&/* label-1.0.0: the label is not identity; the id, name, DOB and MRN below are */state.activePatientId",
      "typeof n.patientLabel==='string'&&state.patientLabel===n.patientLabel&&state.activePatientId");
  ok(preFix !== block && preFix.indexOf('_mlsAthenaLabelOnlyDrift') < 0 && preFix.indexOf('state.patientLabel===n.patientLabel') >= 0,
    file + ': the negative control did not rebuild the pre-fix bytes');
  const before = runShell(preFix, file + ' (pre-fix)', false);
  eq(before.recordAccepted, false, file + ': the pre-fix record comparator should have refused the label-only drift (control invalid)');
  eq(before.reopened, false, file + ': the pre-fix reopen should have failed on the label-only drift (control invalid)');
  eq(before.writable, false, file + ': the pre-fix review should have demanded a regenerate (control invalid)');
});

console.log('PASS reopen-label-identity-proof: ' + checks + ' checks - #patientLabel is a free-text input and is compared by neither sidecar door; activePatientId, patient id/name/DOB/MRN, every visit field and every clinical field stay byte-compared, and the pre-fix bytes reproduce the measured stale reopen');
