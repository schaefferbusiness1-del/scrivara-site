'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');
const prepSource = fs.readFileSync(path.join(root, 'feat_mls_opnote_prep.js'), 'utf8');

let account = '_';
const storage = new Map();
const recentByAccount = {
  'doctor-a@example.test': { 'equipment model': ['OEC Elite', 'OEC 9900'] },
  'doctor-b@example.test': {}
};
const settings = {
  provider: 'Alex Morgan', credentials: 'MD', npi: '1234567890', practice: 'Riverside Pain Institute'
};
const patients = [{
  id: 'p-safe', name: 'Taylor Example', dob: '1982-04-03', bmi: 31,
  problems: 'Verified lumbar radiculopathy', summary: '',
  visits: [{
    source: 'athena', identityVerified: true, identityBinding: 'p-wrong', patientId: 'p-wrong',
    raw: 'Wrong Bound Diagnosis - Onset: 01/01/2020', plan: 'WRONG PLAN'
  }, {
    source: 'athena', identityVerified: true, identityBinding: 'p-safe', patientId: 'p-safe',
    raw: 'Verified lumbar radiculopathy - Onset: 01/01/2021', plan: 'SAFE PLAN'
  }]
}, {
  id: 'p-other', name: 'Jordan Sample', dob: '1975-02-01', problems: '', visits: []
}];

let templates = [];
const document = {
  readyState: 'loading',
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; }
};
const context = {
  console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
  document,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  Event: function Event(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); },
  setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
  getComputedStyle() { return { display: 'none' }; },
  uns(suffix) { return `sf_u::${account}::${suffix}`; },
  getProviderName() { return settings.provider; },
  getProviderCred() { return settings.credentials; },
  getNpi() { return settings.npi; },
  getPracticeName() { return settings.practice; },
  getPatients() { return patients; },
  getTemplates() { return templates; },
  getTemplateById(id) { return templates.find(t => t.id === id) || null; },
  getOpFieldVals(key) { return ((recentByAccount[account] || {})[key] || []).slice(); },
  addOpFieldVal(key, value) {
    const map = recentByAccount[account] || (recentByAccount[account] = {});
    map[key] = [String(value)].concat(map[key] || []).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);
  },
  __mlsOpNoteIntegrity: {
    _verifiedHistoryVisits(patient) {
      return (patient.visits || []).filter(v => v.identityVerified === true && String(v.identityBinding || v.patientId) === String(patient.id));
    }
  },
  _opPrep: []
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'feat_mls_opnote_fill.js' });

const api = context.__mlsOpNoteFill;
assert(api && api.installed, 'op-note fill module did not install');
assert.strictEqual(api.version, 'onf-2.10.0');

const rowSafe = {
  patientId: 'p-safe', tplId: '', proc: 'Left L5 TFESI', dateStr: 'July 17, 2026',
  appt: { patientId: 'p-safe', name: 'Taylor Example', dob: '1982-04-03', mrn: '70001' }
};

// Never read or write clinician memory before the signed-in account resolves.
const beforeUnsigned = storage.size;
assert.strictEqual(api._setDefault('equipment model', 'OEC Elite'), false);
assert.strictEqual(api._saveFillMemValue(rowSafe, 'equipment model', 'OEC Elite'), false);
assert.strictEqual(storage.size, beforeUnsigned, 'signed-out shared namespace received clinician or patient memory');
assert.deepStrictEqual(Array.from(api._priorValues('equipment model')), [], 'signed-out recent history was exposed');

// Recent answers are visible first, but are not silently applied or promoted.
account = 'doctor-a@example.test';
let resolved = api._resolveInitialField('equipment model', rowSafe, {});
assert.strictEqual(resolved.value, '', 'recent answer silently changed the note');
assert.strictEqual(resolved.kind, 'blank', 'recent answer was silently treated as a selected value');
assert.deepStrictEqual(Array.from(api._priorValues('equipment model')), ['OEC Elite', 'OEC 9900']);
assert.strictEqual(api._buildOptions('equipment model', '', rowSafe)[0], 'OEC Elite', 'most recent answer is not the first suggestion');
assert.strictEqual(api._applyVals('Equipment: [[equipment_model]]', { 'equipment model': resolved.value }), 'Equipment: [[equipment_model]]');

// Explicit pinning is account-scoped and fills both placeholder syntaxes.
assert.strictEqual(api._setDefault('equipment model', 'OEC Elite'), true);
assert.strictEqual(api.getDefault('equipment_model'), 'OEC Elite');
resolved = api._resolveInitialField('equipment model', rowSafe, {});
assert.strictEqual(resolved.value, 'OEC Elite');
assert.strictEqual(resolved.kind, 'default');
assert.strictEqual(api._applyVals('A [FILL: equipment model] B [[equipment_model]]', { 'equipment model': resolved.value }), 'A OEC Elite B OEC Elite');
account = 'doctor-b@example.test';
assert.strictEqual(api.getDefault('equipment model'), '', 'account A default leaked to account B');
assert.deepStrictEqual(Array.from(api._priorValues('equipment model')), [], 'account A recent answer leaked to account B');
account = 'doctor-a@example.test';
assert.strictEqual(api.getDefault('equipment model'), 'OEC Elite', 'account A default was not retained');

// Patient memory is account + immutable-patient-id scoped.
assert.strictEqual(api._saveFillMemValue(rowSafe, 'equipment model', 'OEC 9800'), true);
assert.strictEqual(api._loadFillMem(rowSafe)['equipment model'], 'OEC 9800');
account = 'doctor-b@example.test';
assert.strictEqual(JSON.stringify(api._loadFillMem(rowSafe)), '{}', 'patient memory crossed signed-in accounts');
account = 'doctor-a@example.test';
assert.strictEqual(api._patientKey(rowSafe), 'pid:p-safe');

// Canonical Settings facts win; practice and facility never impersonate one another.
assert.strictEqual(api._knownValue('Practice name', rowSafe), 'Riverside Pain Institute');
assert.strictEqual(api._knownValue('Provider NPI', rowSafe), '1234567890');
assert.strictEqual(api._knownValue('Operating provider', rowSafe), 'Alex Morgan, MD');
assert.strictEqual(api._knownValue('Facility name', rowSafe), '', 'practice name was incorrectly inserted as facility');

// Patient, clinical, date/time and generated fields can never become cross-patient defaults.
[
  'Patient name', 'DOB', 'MRN', 'Patient age', 'Sex', 'Date', 'Date of procedure',
  'Diagnosis', 'Indication', 'History of present illness', 'Medication', 'Allergies',
  'Procedure', 'Anatomy', 'Laterality', 'Findings', 'Implant lot number', 'Needle gauge',
  'Steroid dose', 'after "needle" before "was"'
].forEach(label => {
  assert.strictEqual(api._defaultEligible(label), false, `${label} was eligible for an unsafe account default`);
  assert.strictEqual(api._setDefault(label, 'unsafe'), false, `${label} was saved as an unsafe account default`);
});
['Practice name', 'Facility name', 'Provider credentials', 'Provider NPI', 'Equipment model'].forEach(label => {
  assert.strictEqual(api._defaultEligible(label), true, `${label} should be eligible as a stable operational constant`);
});

// Immutable id + verified visit binding owns every chart-derived suggestion.
assert.strictEqual(api._chartPatient(rowSafe).id, 'p-safe');
assert.strictEqual(api._chartPatient({ patientId: 'p-other', appt: { name: 'Taylor Example', dob: '1982-04-03' } }), null,
  'name/DOB overrode a conflicting immutable patient id');
const historyText = api._patientHistText(rowSafe);
assert(historyText.includes('SAFE PLAN') && !historyText.includes('WRONG PLAN'), 'wrong-bound visit entered fill suggestions');

// Higher-precedence template and exact-patient facts beat an account default.
templates = [{ id: 'tpl-prep', name: 'Procedure', text: 'Skin prep: Betadine' }];
const rowTemplate = {
  patientId: 'p-other', tplId: 'tpl-prep', proc: 'Procedure',
  appt: { patientId: 'p-other', name: 'Jordan Sample', dob: '1975-02-01' }
};
assert.strictEqual(api._setDefault('skin prep', 'Chlorhexidine'), false, 'clinical prep choice became a cross-patient default');
resolved = api._resolveInitialField('skin prep', rowTemplate, {});
assert.strictEqual(resolved.value, 'Betadine');
assert.strictEqual(resolved.kind, 'template');
assert.strictEqual(api._setDefault('diagnosis', 'UNSAFE DEFAULT'), false);
resolved = api._resolveInitialField('diagnosis', rowSafe, {});
assert.strictEqual(resolved.value, 'Verified lumbar radiculopathy');
/* pin updated 2026-07-22: a diagnosis lifted from the problem list is an
   unconfirmed SUGGESTION for this encounter, never a confirmed chart fill. */
assert.strictEqual(resolved.kind, 'suggested');

// One explicit pin applies to all open matching drafts, but not protected rows.
api._clearDefault('equipment model');
storage.delete(context.uns('opFillPatientMemV2::pid:p-other'));
const rowOpen = {
  patientId: 'p-other', tplId: '', proc: 'Procedure', _onfRaw: 'Equipment: [[equipment_model]]', _onfVals: {},
  appt: { patientId: 'p-other', name: 'Jordan Sample', dob: '1975-02-01' }
};
const box = { id: 'opPrepNote_0', value: rowOpen._onfRaw, dispatchEvent() {} };
context._opPrep = [rowOpen];
assert.strictEqual(api._setDefault('equipment model', 'OEC 9900'), true);
assert.strictEqual(api._applyDefaultToBoxes('equipment model', 'OEC 9900', [box], false), 1);
assert.strictEqual(box.value, 'Equipment: OEC 9900');

// Mixed token syntax produces one canonical field; the duplicate profile UI is gone.
assert.deepStrictEqual(Array.from(api._fillTokens('[FILL: Practice Name]\n[[practice_name]]')), ['Practice Name']);
assert(!source.includes('mlsOnfProfBtn') && !source.includes('mlsOnfProfForm') && !/localStorage\.getItem\(['"]mls_provider_profile/.test(source),
  'a duplicate/unscoped Practice profile UI remains');
assert(source.includes('className = \'onf-fillbox\''), 'the canonical Fields box is missing');
assert(!source.includes('_opBlanksHtml') && !source.includes('opPrepBlankNext'), 'the retired one-at-a-time blank walker returned');

// The Fields enhancer must not alter a selected template's heading structure
// after the integrity layer has already validated the generated document.
const exactTemplateRow = {
  patientId: 'p-safe', tplId: 'tpl-exact', dateStr: 'July 17, 2026',
  appt: { patientId: 'p-safe', name: 'Taylor Example', dob: '1982-04-03', mrn: '70001' }
};
const exactTemplateBox = {
  id: 'opPrepNote_0', value: 'PREOPERATIVE DIAGNOSIS: Lumbar radiculopathy\nPROCEDURE: Injection',
  dispatchEvent() { throw new Error('selected-template header guard dispatched an edit'); }
};
context._opPrep = [exactTemplateRow];
api._ensureHeader(exactTemplateBox);
assert.strictEqual(exactTemplateBox.value, 'PREOPERATIVE DIAGNOSIS: Lumbar radiculopathy\nPROCEDURE: Injection',
  'Fields enhancer prepended a non-template patient heading after fidelity validation');

// Equal-length edits invalidate the tick signature and are adopted into raw+values.
assert.notStrictEqual(api._sigOf({ value: 'Status: Stable' }), api._sigOf({ value: 'Status: Normal' }),
  'equal-length clinician edits were invisible to the tick gate');
const editedRow = {
  _onfRaw: 'Facility: [FILL: facility name]\nStatus: Stable',
  _onfVals: { 'facility name': 'North Center' },
  _onfLastRender: 'Facility: North Center\nStatus: Stable',
  _onfDefaultKeys: { 'facility name': true }
};
const editedText = 'Facility: North Center\nStatus: Normal';
assert.strictEqual(api._adoptRenderedEdits(editedRow, editedText), true);
assert(editedRow._onfRaw.includes('[FILL: facility name]'), 'ordinary prose edit destroyed the Fields workflow');
assert(editedRow._onfRaw.includes('Status: Normal'), 'ordinary prose edit was not adopted into the raw template');
editedRow._onfVals['facility name'] = 'South Center';
assert.strictEqual(api._applyVals(editedRow._onfRaw, editedRow._onfVals), 'Facility: South Center\nStatus: Normal',
  'a later field change silently reverted clinician prose');

// Editing a rendered field directly reconciles the control value when unambiguous.
editedRow._onfVals['facility name'] = 'North Center';
editedRow._onfLastRender = api._applyVals(editedRow._onfRaw, editedRow._onfVals);
assert.strictEqual(api._adoptRenderedEdits(editedRow, editedRow._onfLastRender.replace('North Center', 'South Center')), true);
assert.strictEqual(editedRow._onfVals['facility name'], 'South Center');
assert(editedRow._onfRaw.includes('[FILL: facility name]'), 'direct field edit removed an unambiguous live field');

// Duplicate boxes for the same textarea collapse to one canonical owner.
let duplicateRemoved = 0;
function fakeFillBox(owner) {
  return {
    owner,
    classList: { contains(name) { return name === 'onf-fillbox'; } },
    getAttribute(name) { return name === 'data-onf-for' ? this.owner : ''; },
    setAttribute(name, value) { if (name === 'data-onf-for') this.owner = value; },
    parentNode: { removeChild() { duplicateRemoved++; } }
  };
}
const firstFillBox = fakeFillBox('noteBox');
const duplicateFillBox = fakeFillBox('noteBox');
context.document.querySelectorAll = selector => selector === '.onf-fillbox' ? [firstFillBox, duplicateFillBox] : [];
assert.strictEqual(api._existingFillBox({ id: 'noteBox', previousElementSibling: firstFillBox }), firstFillBox);
assert.strictEqual(duplicateRemoved, 1, 'duplicate Fields box was not removed');
context.document.querySelectorAll = () => [];

// Prep uses the same canonical Settings facts and keeps practice/facility separate.
assert(!prepSource.includes("localStorage.getItem('mls_provider_profile')"), 'op-note prep still reads the unscoped profile');
assert(prepSource.includes("practice: pick('getPracticeName')") && prepSource.includes("facility: pick('getFacilityName')"),
  'op-note prep does not keep canonical practice and facility facts separate');

assert.strictEqual(api._clearDefault('equipment model'), true);
assert.strictEqual(api.getDefault('equipment model'), '');

console.log('PASS op-note field defaults: account isolation, explicit pinning, canonical Settings, exact-patient history, and one Fields workflow');
