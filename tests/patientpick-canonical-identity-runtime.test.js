'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_patientpick.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
assert(source.includes('var VERSION = "pick-1.7.0"'), 'patient picker performance/identity version was not advanced');
assert(connect.includes('feat_mls_patientpick.js?v=20260811pick170'), 'patient picker performance/identity fix is not cache-busted');

const start = source.indexOf('/* __MLSPK_IDENTITY_START__ */');
const end = source.indexOf('/* __MLSPK_IDENTITY_END__ */', start);
assert(start >= 0 && end > start, 'production patient-picker identity resolver is missing');

const context = { patients: [] };
context.getPatients = () => context.patients;
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nthis.buildIndex = buildIndex; this.matchAppt = matchAppt;', context);

function resolve(appointment, patients) {
  context.patients = patients;
  return context.matchAppt(appointment, context.buildIndex());
}

const canonical = { id: 'LOCAL-1', name: 'Alex Same', dob: '1980-01-02' };
const other = { id: 'LOCAL-2', name: 'Alex Same', dob: '1980-01-02' };

assert.strictEqual(resolve(
  { patient_external_id: 'LOCAL-1', name: 'Wrong Display Name', dob: '12/31/1999' },
  [canonical]
), canonical, 'appointment patient_external_id did not resolve the canonical patient.id');

const legacyCollision = { id: 'LOCAL-2', external_id: 'LOCAL-1', name: 'Legacy Collision', dob: '1970-05-06' };
assert.strictEqual(resolve(
  { patient_external_id: 'LOCAL-1', name: 'Legacy Collision', dob: legacyCollision.dob },
  [canonical, legacyCollision]
), canonical, 'legacy external_id collision overrode the canonical patient.id');

assert.strictEqual(resolve(
  { patient_external_id: 'LOCAL-1', name: canonical.name, dob: canonical.dob },
  [canonical, { ...canonical, name: 'Conflicting duplicate chart' }]
), null, 'duplicate canonical chart ids did not fail closed');

assert.strictEqual(resolve(
  { patient_external_id: 'STALE-ID', name: canonical.name, dob: canonical.dob },
  [canonical]
), null, 'unresolved stable id fell through to demographic matching');

assert.strictEqual(resolve(
  { patient_external_id: 'LOCAL-1', _mlsTargetPatientId: 'LOCAL-2', name: canonical.name, dob: canonical.dob },
  [canonical, other]
), null, 'contradictory appointment-local ids selected a chart');

assert.strictEqual(resolve(
  { name: canonical.name, dob: '01/02/1980' },
  [canonical]
), canonical, 'unique normalized name+DOB fallback did not resolve');

assert.strictEqual(resolve(
  { name: canonical.name, dob: canonical.dob },
  [canonical, other]
), null, 'duplicate name+DOB fallback did not fail closed');

assert.strictEqual(resolve(
  { name: canonical.name, dob: '1999-09-09' },
  [canonical]
), null, 'supplied mismatched DOB fell through to name-only matching');

assert.strictEqual(resolve(
  { name: canonical.name },
  [canonical]
), canonical, 'unique name-only fallback was rejected when no stronger identity was supplied');

assert.strictEqual(resolve(
  { name: canonical.name },
  [canonical, { id: 'LOCAL-3', name: canonical.name, dob: '1990-03-04' }]
), null, 'ambiguous name-only fallback selected an arbitrary chart');

assert.strictEqual(resolve(
  { name: 'Missing Id', dob: '1975-04-03' },
  [{ name: 'Missing Id', dob: '1975-04-03' }]
), null, 'a record without a canonical local chart id was selectable');

console.log('PASS patient picker canonical identity: patient.id first; stale IDs, mismatched DOBs, and duplicate fallbacks fail closed');
