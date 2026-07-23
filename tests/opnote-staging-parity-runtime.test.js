'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const connector = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');
const prep = fs.readFileSync(path.join(root, 'feat_mls_opnote_prep.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing source marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}

async function testFrozenPrefs() {
  const source = between(staging, 'const PREF_SYNC_KEYS=', 'let twofaLastRecoveryCodes=');
  const storage = new Map();
  let token = 'token-a';
  let resolveJson;
  const context = {
    console, Promise, JSON, Object, String,
    session: { email: 'doctor-a@example.test' },
    backendMode() { return true; }, bkToken() { return token; }, bkBase() { return 'https://example.test'; },
    localStorage: {
      getItem(k) { return storage.has(k) ? storage.get(k) : null; },
      setItem(k, v) { storage.set(k, String(v)); }
    },
    uns(k) { return `sf_u::${context.session ? context.session.email : '_'}::${k}`; },
    fetch() { return Promise.resolve({ ok: true, json() { return new Promise(resolve => { resolveJson = resolve; }); } }); },
    applyAppearance() {}, applyFeatureToggles() {}, applyLegalUI() {}, renderCustomWidgets() {}, _syncSpecialtyPresetTemplates() {}
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'staging-prefs.js' });

  const pending = context.loadPrefsFromServer();
  for (let i = 0; i < 12 && typeof resolveJson !== 'function'; i++) await Promise.resolve();
  assert.strictEqual(typeof resolveJson, 'function', 'preference test never reached the deferred JSON response');
  context.session = { email: 'doctor-b@example.test' }; token = 'token-b';
  resolveJson({ prefs: { practiceName: 'Account A Practice', opFieldDefaultsV1: '{"schema":1}' } });
  await pending;
  assert.strictEqual(storage.size, 0, 'a stale account-A preference response wrote after switching to account B');

  context.session = { email: 'doctor-a@example.test' }; token = 'token-a';
  context.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ prefs: { practiceName: 'Account A Practice' } }) });
  await context.loadPrefsFromServer();
  assert.strictEqual(storage.get('sf_u::doctor-a@example.test::practiceName'), 'Account A Practice');
  assert.strictEqual(storage.has('sf_u::doctor-b@example.test::practiceName'), false);
}

function testStagingContext() {
  const source = between(staging, 'function _ptAge', 'function _opDayKey');
  const patients = [
    { id: 'p-a', name: 'Duplicate Patient', dob: '1980-01-02', sex: 'F' },
    { id: 'p-b', name: 'Duplicate Patient', dob: '1980-01-02', sex: 'M' }
  ];
  const context = {
    Date, Math, Object, String, Array, RegExp,
    getPatients() { return patients; },
    getProviderName() { return 'Alex Morgan'; }, getProviderCred() { return 'MD'; },
    getNpi() { return '1234567890'; }, getPracticeName() { return 'Riverside Pain Group'; },
    getClinicAddress() { return '10 Practice Lane'; }, getClinicPhone() { return '555-0100'; },
    __mlsOpNoteFill: { installed: true, getDefault(k) { return k === 'facility_name' ? 'Riverside ASC' : ''; } },
    _opRankTemplates() { return []; }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'staging-opnote-context.js' });

  const scheduled = context._opPatientCtx('Duplicate Patient', '1980-01-02', 'p-b', {
    patientId: 'p-b', location: 'Independent Surgery Center'
  });
  assert.strictEqual(scheduled.patientId, 'p-b');
  assert.strictEqual(scheduled.provider, 'Alex Morgan, MD');
  assert.strictEqual(scheduled.providerNpi, '1234567890');
  assert.strictEqual(scheduled.practice, 'Riverside Pain Group');
  assert.strictEqual(scheduled.facility, 'Independent Surgery Center');
  assert.strictEqual(scheduled.practiceAddress, '10 Practice Lane');
  assert.strictEqual(scheduled.facilityAddress, undefined, 'practice address was relabeled as the appointment facility address');
  assert.strictEqual(context._opPatientCtx('Duplicate Patient', '1980-01-02', 'p-a', {}).facility, 'Riverside ASC');
  const row = context._opNewRow('Duplicate Patient', 'Procedure', '1980-01-02', 'July 17', 'p-b', 'Independent Surgery Center');
  assert.strictEqual(row.appt.patientId, 'p-b');
  assert.strictEqual(row.appt.location, 'Independent Surgery Center');
}

function testPrepIdentityAndAddressScope() {
  const patients = [
    { id: 'p-a', name: 'Duplicate Patient', dob: '01/02/1980' },
    { id: 'p-b', name: 'Duplicate Patient', dob: '01/02/1980' }
  ];
  const document = {
    getElementById() { return null; }, querySelectorAll() { return []; },
    createElement() { return { style: {}, appendChild() {} }; },
    head: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const context = {
    console, Date, Math, JSON, Object, String, Array, RegExp, Promise, document,
    setInterval() { return 1; }, clearInterval() {},
    getPatients() { return patients; },
    getProviderName() { return 'Alex Morgan'; }, getProviderCred() { return 'MD'; }, getNpi() { return '1234567890'; },
    getPracticeName() { return 'Riverside Pain Group'; }, getClinicAddress() { return '10 Practice Lane'; },
    getTemplateById(id) { return id === 'tpl' ? { id } : null; },
    __mlsOpNoteFill: { installed: true, getDefault(k) { return k === 'facility_name' ? 'Riverside ASC' : ''; } },
    _opPatientCtx(name, dob, patientId) { const p = patients.find(x => x.id === patientId); return p ? { patientId: p.id, name: p.name, dob: p.dob } : {}; },
    _opNewRow(name, reason, dob, dateStr, patientId) { return { patientId, appt: { name, dob }, proc: reason, dateStr }; }
  };
  context.window = context;
  vm.runInNewContext(prep, context, { filename: 'feat_mls_opnote_prep.js' });
  const api = context.__mlsOpNotePrep;
  assert(api && api.version === 'opnp-1.7.0');

  assert.strictEqual(api.resolvePatient({ name: 'Duplicate Patient', dob: '01/02/1980', patientId: 'p-b' }).patient.id, 'p-b');
  const missingExact = api.resolvePatient({ name: 'Duplicate Patient', dob: '01/02/1980', patientId: 'gone' });
  assert.strictEqual(missingExact.patient, null, 'a missing immutable id fell through to ambiguous name+DOB');
  assert.strictEqual(missingExact.status, 'ambiguous');
  const ready = api.readiness({ patientId: 'p-b', dateStr: 'July 17', proc: 'Procedure', tplId: 'tpl', appt: { name: 'Duplicate Patient', dob: '01/02/1980' } });
  assert.strictEqual(ready.identity.patient.id, 'p-b', 'readiness ignored row.patientId');

  const enriched = api.enrichCtx('Duplicate Patient', {}, { patientId: 'p-b', location: 'Independent Surgery Center' });
  assert.strictEqual(enriched.facility, 'Independent Surgery Center');
  assert.strictEqual(enriched.practiceAddress, '10 Practice Lane');
  assert.strictEqual(enriched.facilityAddress, undefined, 'appointment facility borrowed the practice clinic address');
  const frozenScope = api.enrichCtx('Duplicate Patient', {
    patientId: 'p-b', provider: 'Different Schedule Doctor', providerNpi: '1234567890',
    facility: 'Scheduled ASC'
  }, null);
  assert.strictEqual(frozenScope.provider, 'Different Schedule Doctor', 'generation enrichment overwrote the appointment provider with Settings');
  assert.strictEqual(frozenScope.providerNpi, undefined, 'a different appointment provider inherited the signed-in provider NPI');
  assert.strictEqual(frozenScope.facility, 'Scheduled ASC', 'generation enrichment overwrote the appointment facility with the account default');
  assert.strictEqual(frozenScope.facilityAddress, undefined, 'a scheduled facility inherited the configured facility address');
  const block = api.attestBlock(api.providerFacilityCtx());
  assert(block.includes('Facility: Riverside ASC'));
  assert(block.includes('Practice: Riverside Pain Group'));
  assert(block.includes('Practice address: 10 Practice Lane'));

  context._opPrep = [{ patientId: 'p-b', appt: { patientId: 'p-b', name: 'Duplicate Patient', dob: '01/02/1980' } }];
  context.__opnpActiveIdx = 0;
  assert.strictEqual(context._opPatientCtx('Duplicate Patient', '01/02/1980', '').patientId, 'p-b', 'prep wrapper ignored active row/appt patientId');
}

async function main() {
  const prepAt = connector.indexOf('feat_mls_opnote_prep.js?v=20260723opnp170');
  const integrityAt = connector.indexOf('feat_mls_opnote_integrity.js?v=20260723oni2121');
  const fillAt = connector.indexOf('feat_mls_opnote_fill.js?v=20260723onf291');
  assert(prepAt >= 0 && prepAt < fillAt && fillAt < integrityAt, 'staging op-note assets are not loaded prep → canonical fill → final integrity owner');
  assert(connector.includes('window.__mlsCanonicalOpNoteFillRequested'), 'legacy fill fallback is not suppressed when canonical Fields is requested');
  assert(staging.includes('row.missing&&row.missing.length&&!_opCanonicalFillOwns()'), 'legacy one-at-a-time blank walker still renders beside canonical Fields');
  assert(staging.includes('appear together in one <b>Fields</b> box'), 'staging op-note intro still describes the retired one-at-a-time workflow');
  assert(staging.includes("ctx.templateId=String(row.tplId||'')"), 'staging generation does not freeze the explicitly selected template id');
  await testFrozenPrefs();
  testStagingContext();
  testPrepIdentityAndAddressScope();
  console.log('PASS staging op-note parity: account-frozen prefs, one Fields owner, exact row/template identity, and facility/address separation');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
