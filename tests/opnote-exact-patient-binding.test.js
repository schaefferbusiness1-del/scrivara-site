'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const prepAsset = fs.readFileSync(path.join(root, 'feat_mls_opnote_prep.js'), 'utf8');
const proAsset = fs.readFileSync(path.join(root, 'mls-opnote-pro.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing source marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}

const identity = between(app, 'function _ptAge', 'function _opNewRow');
const appts = between(app, 'function _opApptsForDay', 'function openOpPrep(dayKey)');
const openPatient = between(app, 'function openOpPrepForPatient', 'function closeOpPrep');
const generate = between(app, 'async function opPrepGenerateOne', '/* Save (or update)');
const genAi = between(app, 'async function _genOpNote', '/* Fill the [[key]] placeholders');
const autosave = between(app, 'function opPrepAutosaveDraft', 'async function opPrepGenerateAll');
const save = between(app, 'function opPrepSave', 'function openTemplates');

assert(appts.includes('patientId:String(a.patient_external_id||a._mlsTargetPatientId||a.patientId||\'\')'), 'schedule op-note rows omit the immutable patient id');
assert(openPatient.includes('_opDobKey(a.dob)===_opDobKey(p.dob)'), 'chart op-note reason can still match a same-name/different-DOB appointment');
/* b717: the builder call gained the auto-name date key; the pin still requires
   the immutable patient id in the SAME call, now alongside that key. The final
   zero is the deterministic single-patient row ordinal. */
assert(openPatient.includes('p.id, null, _acctTodayKey(), 0) ]'), 'patient-chart op-note row omits its immutable patient id, date key, or deterministic ordinal');
assert(generate.includes('_opPatientCtx(row.appt.name,row.appt.dob,row.patientId)'), 'generation still resolves patient context by display name only');
assert(generate.includes('if(!ctx.patientId)'), 'generation does not fail closed when exact identity is unavailable');
assert(genAi.includes('_opResolvePatient(name,ctx.dob,ctx.patientId)'), '_genOpNote does not independently re-verify immutable patient ownership');
assert(genAi.includes('mlsOpNotePatientId:String(exactPatient.id)'), '_genOpNote does not carry immutable patient id to the aiCallRaw wrapper');
assert(prepAsset.includes('return function (name, dob, patientId, apptArg)'), 'op-note prep enhancement drops the immutable patient id argument or appointment scope');
assert(prepAsset.includes("trim(base.patientId) !== suppliedId"), 'op-note prep enhancement does not reject identity loss/mutation');
assert(proAsset.includes('mlsOpNotePatientId: String(exactPatient.id)'), 'professional op-note enhancement drops immutable patient id before aiCallRaw');
assert(proAsset.includes("e.code === 'MLS_OPNOTE_IDENTITY'"), 'professional op-note enhancement swallows identity failures');
assert(autosave.includes('_opResolvePatient(row.appt.name,row.appt.dob,row.patientId)'), 'draft autosave is not exact-patient bound');
assert(save.includes('_opResolvePatient(row.appt.name,row.appt.dob,row.patientId)'), 'final op-note save is not exact-patient bound');
assert(!autosave.includes("source:'athena-schedule'"), 'autosave can silently manufacture a patient from an ambiguous name');
assert(!save.includes("source:'athena-schedule'"), 'final save can silently manufacture a patient from an ambiguous name');

const patients = [
  { id: 'same-a', name: 'Alex Same', dob: '01/02/1970', sex: 'F', mrn: '111' },
  { id: 'same-b', name: 'Alex Same', dob: '1980-03-04', sex: 'M', mrn: '222' }
];
const context = {
  Date, Math, String, Number, Array, RegExp,
  getPatients() { return patients.map(p => ({ ...p })); }
};
context.window = context;
vm.runInNewContext(identity, context, { filename: 'opnote-exact-identity.js' });

assert.strictEqual(context._opResolvePatient('Alex Same', '', ''), null, 'name-only op-note target was accepted');
assert.strictEqual(context._opResolvePatient('Alex Same', '03/04/1980', '').id, 'same-b', 'unique exact name+DOB did not resolve across DOB formats');
assert.strictEqual(context._opResolvePatient('Alex Same', '03/04/1980', 'same-a'), null, 'immutable id accepted the other same-name patient DOB');
assert.strictEqual(context._opResolvePatient('Wrong Name', '01/02/1970', 'same-a'), null, 'immutable id accepted a mismatched supplied name');
assert.strictEqual(context._opResolvePatient('Alex Same', '01/02/1970', 'same-a').id, 'same-a', 'valid immutable patient binding was refused');
assert.strictEqual(context._opPatientCtx('Alex Same', '03/04/1980', 'same-b').patientId, 'same-b', 'op-note context lost exact patient ownership');

patients.push({ id: 'same-c', name: 'Alex Same', dob: '03/04/1980' });
assert.strictEqual(context._opResolvePatient('Alex Same', '03/04/1980', ''), null, 'ambiguous exact name+DOB target was accepted without patient id');

console.log('PASS op-note exact patient binding: generation, autosave, and save reject name-only/ambiguous ownership');
