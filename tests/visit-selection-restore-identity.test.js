'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_task3_frontsync.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
assert(source.includes("var VERSION = 't3-1.1.2'"), 'Visit identity owner version was not advanced');
// t3-1.0.7: a leading "PROVIDER " label on an imported row must not mint a
// second roster chip beside the real provider (same person, prefixed string).
assert(source.includes("replace(/^provider\\s+(?=\\S)/i, '')"), 'provider-label prefix must be stripped from provider names');
assert(source.includes('label: humanize(x.provider)'), 'roster chip labels must use the cleaned provider name');
assert(connect.includes('A+"?v=20260808t3112perf1"'), 'Visit identity owner loader is not explicitly cache-busted');
const start = source.indexOf('/* __T3_PICK_IDENTITY_START__');
const end = source.indexOf('/* __T3_PICK_IDENTITY_END__', start);
assert(start >= 0 && end > start, 'production Visit restore identity resolver is missing');

const context = {
  nameKey(value) { return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function pickClean', start), end) + '\nthis.resolveSavedPick = resolveSavedPick; this.resolveStoredPick = resolveStoredPick; this.pickRefs = pickRefs; this.pickRowsCompatible = pickRowsCompatible; this.pickRowsSameIdentity = pickRowsSameIdentity; this.pickRowIdentitySig = pickRowIdentitySig;', context);
const resolve = context.resolveSavedPick;
const resolveStored = context.resolveStoredPick;

const margaret = { name: 'Margaret Bollinger', dob: '1968-04-22', patient_external_id: 'LOCAL-M', athenaPatientId: 'ATH-M', mrn: 'MRN-M' };
const wrongDob = { name: 'Margaret Bollinger', dob: '1974-09-03', patient_external_id: 'LOCAL-X', athenaPatientId: 'ATH-X', mrn: 'MRN-X' };

assert.strictEqual(resolve({ name: margaret.name, dob: margaret.dob }, [wrongDob]), null,
  'a vanished appointment restored a same-name patient with the wrong DOB');
assert.strictEqual(resolve({ name: margaret.name }, [margaret]), null,
  'name-only persisted selection was accepted');
assert.strictEqual(resolve({ name: margaret.name, dob: margaret.dob }, [margaret, { name: margaret.name, dob: '04/22/1968' }]), null,
  'duplicate name+DOB fallback did not fail closed');
assert.strictEqual(resolve({ name: margaret.name, dob: margaret.dob }, [wrongDob, margaret]), margaret,
  'unique exact name+DOB did not restore the right schedule patient');

assert.strictEqual(resolve({ name: margaret.name, refs: { local: 'LOCAL-M', athena: 'ATH-OLD' } }, [
  { name: margaret.name, dob: margaret.dob, patient_external_id: 'LOCAL-M', athenaPatientId: 'ATH-NEW' }
]), null, 'a matching local ID overrode a contradictory Athena namespace');
assert.strictEqual(resolve({ name: margaret.name, refs: { local: 'LOCAL-M' } }, [
  { name: margaret.name, dob: margaret.dob, mrn: 'LOCAL-M' }
]), null, 'equal text in a different identifier namespace was treated as identity');
assert.strictEqual(resolve({ name: 'Alice', patientId: 'COLLIDE' }, [
  { name: 'Bob', athenaPatientId: 'COLLIDE' }
]), null, 'local patientId text matched an Athena source identifier namespace');
assert.strictEqual(resolve({ name: margaret.name, refs: { local: 'LOCAL-M' } }, [margaret]), margaret,
  'same-namespace stable local ID did not restore the exact patient');

assert.strictEqual(resolve({ name: margaret.name, refs: { local: 'LOCAL-M' } }, [
  margaret,
  { name: margaret.name, dob: margaret.dob, patient_external_id: 'LOCAL-M', athenaPatientId: 'ATH-OTHER' }
]), null, 'conflicting duplicate rows under one local ID did not fail closed');
assert.strictEqual(resolve({ name: margaret.name, refs: { local: 'LOCAL-M' } }, [
  { name: margaret.name, dob: margaret.dob, patient_external_id: 'LOCAL-M', _mlsTargetPatientId: 'LOCAL-X' }
]), null, 'contradictory aliases inside one local namespace were collapsed by precedence');

const storedMargaret = { id: 'LOCAL-M', name: margaret.name, dob: margaret.dob, mrn: 'MRN-M' };
assert.strictEqual(resolveStored(margaret, [storedMargaret]), storedMargaret,
  'resolved schedule identity did not bind to the exact stored chart');
assert.strictEqual(resolveStored({ name: margaret.name, dob: margaret.dob }, [storedMargaret]), storedMargaret,
  'unique exact name+DOB did not resolve a stored chart');
assert.strictEqual(resolveStored({ name: margaret.name }, [storedMargaret]), null,
  'name-only schedule identity resolved a stored chart');
assert.strictEqual(resolveStored(margaret, [{ ...storedMargaret, patientId: 'LOCAL-X' }]), null,
  'contradictory aliases inside a stored chart were collapsed by precedence');

const noRefA = { name: margaret.name, dob: margaret.dob };
const noRefB = { name: margaret.name, dob: '04/22/1968' };
assert.strictEqual(context.pickRowsSameIdentity(noRefA, noRefB), false,
  'demographic compatibility without a stable reference was treated as positive identity proof');
assert.strictEqual(context.pickRowsSameIdentity(margaret, {
  name: margaret.name, dob: '04/22/1968', patient_external_id: 'LOCAL-M'
}), true, 'matching same-namespace stable IDs did not prove duplicate-row identity');

const hydrationBase = { id: 'appt-1', name: margaret.name, time: '10:00 AM' };
const hydrationWithDob = { ...hydrationBase, dob: margaret.dob };
const hydrationWithId = { ...hydrationWithDob, patient_external_id: 'LOCAL-M' };
assert.notStrictEqual(context.pickRowIdentitySig(hydrationBase), context.pickRowIdentitySig(hydrationWithDob),
  'DOB hydration does not invalidate the Visit projection signature');
assert.notStrictEqual(context.pickRowIdentitySig(hydrationWithDob), context.pickRowIdentitySig(hydrationWithId),
  'stable-ID hydration does not invalidate the Visit projection signature');

const canonicalStart = source.indexOf('function canonicalList(date)');
const canonicalEnd = source.indexOf('var pickSig', canonicalStart);
const canonical = source.slice(canonicalStart, canonicalEnd);
for (const field of ['patient_external_id', '_mlsTargetPatientId', 'patientId', 'athenaPatientId', 'mrn']) {
  assert(canonical.includes(field), `canonical Visit projection strips stable field ${field}`);
}
const normalizeStart = source.indexOf('normalize: function ()');
const normalizeEnd = source.indexOf('if (removed.length)', normalizeStart);
const normalize = source.slice(normalizeStart, normalizeEnd);
assert((normalize.match(/pickRowsSameIdentity\(/g) || []).length >= 2,
  'calendar normalizer can collapse same-name/time rows without positive stable identity proof');
assert(source.includes("a.map(pickRowIdentitySig).join('|')") && source.includes('list.map(pickRowIdentitySig)'),
  'calendar or Visit projection signature omits in-place identity hydration');

const restoreStart = source.indexOf('function restorePick()');
const restoreEnd = source.indexOf('/* ==================== 6.', restoreStart);
const restoreSource = source.slice(restoreStart, restoreEnd);
assert(restoreSource.includes('window.selectPatient(chart.id)'), 'restore repaints hero fields without selecting the canonical active chart');
assert(restoreSource.indexOf('window.selectPatient(chart.id)') < restoreSource.indexOf('nm.value ='), 'hero fields can repaint before canonical patient selection succeeds');

const heroStart = app.indexOf('function _heroPickPatient(i)');
const heroEnd = app.indexOf('function toggleCapture()', heroStart);
const hero = app.slice(heroStart, heroEnd);
assert(hero.includes("localAliases(a,false)") && hero.includes('if(scheduleIds.length>1) return fail()'),
  'native hero picker collapses contradictory local aliases');
assert(hero.includes('if(localId){') && hero.includes('}else if(dobKey(dob)){') && !hero.includes('if(!rec&&dobKey(dob))'),
  'native hero picker can fall back by demographics after a stable local ID failed');
assert(hero.indexOf('setActivePtId(rec.id)') < hero.indexOf('window._heroSelIdx=i'),
  'native hero picker repaints the Visit patient before canonical selection succeeds');

function runNativeHero(scheduleRow, patientRows) {
  const selected = [];
  const fields = {
    heroPtName: { value: '' },
    heroPtDob: { value: '' },
    heroRecBtn: { scrollIntoView() {} }
  };
  const nativeContext = {
    window: { _heroTodayList: [scheduleRow] },
    document: { getElementById(id) { return fields[id] || null; } },
    getPatients() { return patientRows; },
    upsertPatient(patient) { if (!patientRows.includes(patient)) patientRows.push(patient); },
    setActivePtId(id) { selected.push(id); },
    _heroSyncName() {}, _renderTodayPatients() {}, renderProfile() {}, renderPatientBar() {},
    renderPatients() {}, updateNavCounts() {}, toast() {}
  };
  vm.createContext(nativeContext);
  vm.runInContext(hero + '\nthis.pickHero = _heroPickPatient;', nativeContext);
  return { result: nativeContext.pickHero(0), selected, fields };
}

let nativeRun = runNativeHero(
  { name: 'Alice Exact', dob: '1980-01-01', patient_external_id: 'STALE-ID' },
  [{ id: 'DIFFERENT-ID', name: 'Alice Exact', dob: '1980-01-01' }]
);
assert.strictEqual(nativeRun.result, false, 'native picker used name+DOB after its stable local ID failed');
assert.deepStrictEqual(nativeRun.selected, [], 'native picker activated the wrong chart after a stale stable ID');

nativeRun = runNativeHero(
  { name: 'Alice Exact', dob: '1980-01-01', patient_external_id: 'LOCAL-M', _mlsTargetPatientId: 'LOCAL-X' },
  [{ id: 'LOCAL-M', name: 'Alice Exact', dob: '1980-01-01' }]
);
assert.strictEqual(nativeRun.result, false, 'native picker accepted contradictory schedule aliases');
assert.deepStrictEqual(nativeRun.selected, [], 'contradictory schedule aliases changed the active chart');

nativeRun = runNativeHero(
  { name: 'Alice Exact', dob: '1980-01-01', patient_external_id: 'LOCAL-M' },
  [{ id: 'LOCAL-M', patientId: 'LOCAL-X', name: 'Alice Exact', dob: '1980-01-01' }]
);
assert.strictEqual(nativeRun.result, false, 'native picker accepted contradictory stored-chart aliases');

nativeRun = runNativeHero(
  { name: 'Alice Exact', dob: '1980-01-01' },
  [{ id: 'LOCAL-M', name: 'Alice Exact', dob: '1980-01-01' }]
);
assert.strictEqual(nativeRun.result, true, 'native picker rejected a unique exact name+DOB fallback');
assert.deepStrictEqual(nativeRun.selected, ['LOCAL-M'], 'unique exact fallback did not select the canonical chart');

nativeRun = runNativeHero(
  { name: 'Alice Exact', dob: '1980-01-01' },
  [{ id: 'LOCAL-M', name: 'Alice Exact', dob: '1980-01-01' }, { id: 'LOCAL-X', name: 'Alice Exact', dob: '1980-01-01' }]
);
assert.strictEqual(nativeRun.result, false, 'native picker accepted duplicate exact demographics');
assert.deepStrictEqual(nativeRun.selected, [], 'ambiguous demographic fallback changed the active chart');

console.log('PASS Visit selection restore: stable namespaces or unique name+DOB only; stale, duplicate, and contradictory patients fail closed');
