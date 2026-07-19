'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
function block(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const start = src.indexOf('/* ---- module: feat_athena_sync.js ---- */');
  const end = src.indexOf('/* ---- module: feat_activity_feed.js ---- */', start);
  assert(start >= 0 && end > start, `${file} is missing the Athena sync module`);
  return src.slice(start, end);
}

const prod = block('mls-connect.js');
const staging = block('mls-connect.staging.js');
for (const [name, src] of [['production', prod], ['staging', staging]]) {
  assert(src.includes('Active-patient Athena status'), `${name} lacks the active-patient status surface`);
  assert(src.includes('athena-active-patient-verification'), `${name} lacks the exact verification receipt`);
  assert(src.includes("mode:'probe',action:'write_note'"), `${name} Verify now is not a typed read-only probe`);
  assert(src.includes("noAutomaticChaining!=='no-automatic-chaining'"), `${name} accepts a probe without the no-chain receipt`);
  assert(src.includes('15*60*1000'), `${name} does not age verification into stale state`);
  assert(src.includes('Visit context changed — verify again'), `${name} does not invalidate on visit-context change`);
  assert(src.includes("if(!renderTimer)renderTimer=setInterval(render,4000)"), `${name} does not bound the passive refresh interval`);
  assert(src.includes('if(present&&html===lastChipHtml)'), `${name} can rebuild the unchanged status chip every refresh`);
  assert(src.includes("typeof window.getSessionEmail==='function'") && src.includes("typeof session!=='undefined'") && src.includes('window.bkUser'), `${name} does not derive sync ownership from an authoritative signed-in account`);
  assert(src.includes("dir:'review'") && src.includes("dir:'local'"), `${name} still classifies read-only review or clipboard clicks as Athena sends`);
  assert(src.includes("if(ACTIONS[i].dir==='review'||ACTIONS[i].dir==='local')return"), `${name} still records read-only review openings as uncertain mutations`);
  assert(src.includes("if(!e||e.dir!=='push')return"), `${name} send badge still counts pulls, reviews, or local clipboard actions`);
  assert(!src.includes('document.body.innerText'), `${name} can confuse a patient/body email with the signed-in sync-log owner`);
  for (const forbidden of [
    'mlsAppPullSchedule', 'mlsAppGotoDate', 'mlsAppReadChart', 'mlsAppReadVisits',
    'mlsAppSearchOpenPatient', 'mlsAppFocusMlsTab', 'location.reload', '.focus()'
  ]) assert(!src.includes(forbidden), `${name} status module contains forbidden automatic action ${forbidden}`);
}

function runtime(source) {
  const listeners = Object.create(null);
  const storage = new Map();
  const posted = [];
  let chip = null;
  let slotWrites = 0;
  let intervalCalls = 0;
  let probeIdentity = 'Exact Patient';
  const patient = {
    id: 'patient-exact-7', name: 'Exact Patient', dob: '01/02/1980', mrn: 'MRN-7788',
    athenaProfileCoverage: {
      complete: true, exactIdentityVerified: true, patientId: 'patient-exact-7', capturedAt: new Date().toISOString(),
      cards: { problems: { status: 'documented' }, medications: { status: 'documented' } }
    },
    visits: [{
      id: 'visit-1', identityVerified: true, identityBinding: 'patient-exact-7',
      fullDetail: true, bodyComplete: true, indexOnly: false, captured: new Date().toISOString()
    }]
  };
  const binding = {
    id: 'visit-binding-1', patient: { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn },
    visitContext: {
      visitDate: '2026-07-14', provider: 'Exact Doctor, MD', appointmentId: '9900714',
      encounterId: '44001', encounterUrl: 'https://athenanet.athenahealth.com/encounter/44001'
    }
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  function emit(data) { for (const fn of [...(listeners.message || [])]) fn({ data }); }
  const document = {
    readyState: 'complete',
    body: { innerText: 'Patient contact: wrong.patient@example.net', appendChild() {} },
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    addEventListener(type, fn) { (listeners[`document:${type}`] || (listeners[`document:${type}`] = [])).push(fn); },
    removeEventListener() {},
    createElement() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }; },
    getElementById() { return null; },
    querySelector(selector) { return selector === '#mlsCardSlot .mls-sync' ? chip : null; }
  };
  const window = {
    document, localStorage,
    getSessionEmail: () => 'Doctor@Example.COM',
    getActivePtId: () => patient.id,
    findPatient: id => String(id) === patient.id ? patient : null,
    activePatient: () => patient,
    _calAppts: [{ id: 'appt-1', patient_external_id: patient.id, updated_at: new Date().toISOString() }],
    currentVisitAthenaBinding: binding,
    __mlsExtReportedVersion: '',
    __mlsCard: {
      setSyncSlot(html) {
        slotWrites++;
        chip = { style: {}, __b: 0, addEventListener() {}, innerHTML: html };
      }
    },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(x => x !== fn); },
    postMessage(message) {
      posted.push(JSON.parse(JSON.stringify(message)));
      if (message.type === 'mlsPing') {
        setTimeout(() => emit({ source: 'mls-ext', type: 'mlsPong', version: '2.9.22' }), 0);
      } else if (message.type === 'mlsAppAthenaActionV2') {
        const context = {
          patientName: probeIdentity, dob: '1/2/1980', mrn: '7788', encounterId: '44001',
          encounterUrl: 'https://athenanet.athenahealth.com/encounter/44001', visitDate: '7/14/2026',
          provider: 'Exact Doctor, MD', contextHash: 'ctx-hash-exact'
        };
        setTimeout(() => emit({
          source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: message.requestId,
          resp: { ok: true, mode: 'probe', action: 'write_note', readOnly: true, noAutomaticChaining: 'no-automatic-chaining', context }
        }), 0);
      }
    }
  };
  window.window = window;
  const context = vm.createContext({
    window, document, localStorage, currentVisitAthenaBinding: binding,
    console, Date, Math, Promise, Object, Array, String, Number, RegExp, JSON,
    setTimeout, clearTimeout,
    setInterval(fn, ms) { intervalCalls++; return { fn, ms }; },
    clearInterval() {}
  });
  vm.runInContext(source, context, { filename: 'feat_athena_sync.js' });
  return {
    api: window.__mlsSync, patient, binding, posted, storage, emit, context,
    setProbeIdentity(v) { probeIdentity = v; },
    get slotWrites() { return slotWrites; },
    get intervalCalls() { return intervalCalls; },
    get messageListeners() { return (listeners.message || []).length; },
    click(target) { for (const fn of [...(listeners['document:click'] || [])]) fn({ target }); }
  };
}

(async () => {
  const rt = runtime(prod);
  assert.strictEqual(rt.posted.length, 0, 'startup sent an extension request');
  assert.strictEqual(rt.intervalCalls, 1, 'status installed more than one passive interval');
  assert.strictEqual(rt.messageListeners, 1, 'status installed more than one permanent window listener');
  const initialSlotWrites = rt.slotWrites;
  rt.api.render();
  rt.api.render();
  assert.strictEqual(rt.slotWrites, initialSlotWrites, 'unchanged passive renders rebuilt the status chip/card');

  let status = rt.api.patientStatus();
  assert.strictEqual(status.patient.patientId, rt.patient.id, 'active status lost the immutable local patient ID');
  assert.strictEqual(status.schedule.linked, true, 'exact-ID schedule linkage was not detected');
  assert.strictEqual(status.chart.verified, true, 'exact six-card chart receipt was not detected');
  assert.strictEqual(status.history.verified, true, 'body-complete exact visit history was not detected');

  const reviewButton = { getAttribute(name) { return name === 'onclick' ? 'pushEntireVisitToAthena(this)' : null; }, parentElement: null };
  for (let i = 0; i < 3; i++) rt.click(reviewButton);
  assert.strictEqual(rt.api.getLog().length, 0, 'reopening the read-only Athena review created sync-log noise');
  assert.strictEqual(rt.api.patientStatus().sends.total, 0, 'read-only Athena review openings accumulated as failed/uncertain sends');
  const pullButton = { getAttribute(name) { return name === 'onclick' ? 'pullPatientFromAthena()' : null; }, parentElement: null };
  rt.click(pullButton);
  assert.strictEqual(rt.api.getLog().length, 1, 'passive chart-pull observation unexpectedly disappeared');
  assert.strictEqual(rt.api.patientStatus().sends.total, 0, 'a read-only chart pull polluted the mutation send badge');

  rt.setProbeIdentity('Different Patient');
  assert.strictEqual(await rt.api.verifyNow(), false, 'wrong-patient probe was accepted');
  assert.strictEqual(rt.api.patientStatus().verifyFresh, false, 'wrong-patient probe created a fresh receipt');

  rt.setProbeIdentity('Exact Patient');
  assert.strictEqual(await rt.api.verifyNow(), true, 'exact read-only probe did not verify');
  status = rt.api.patientStatus();
  assert.strictEqual(status.verifyFresh, true, 'exact probe receipt was not fresh');
  assert.strictEqual(status.verify.patientId, rt.patient.id, 'probe receipt lost immutable local patient ID');
  assert.strictEqual(status.verify.readOnly, true, 'probe receipt was not marked read-only');
  assert(!('actionToken' in status.verify), 'one-use mutation token leaked into passive status storage');

  const probe = rt.posted.find(m => m.type === 'mlsAppAthenaActionV2');
  assert(probe, 'Verify now did not send the typed probe');
  assert.deepStrictEqual(
    { mode: probe.mode, patientId: probe.expectedPatient.patientId, name: probe.expectedPatient.name, dob: probe.expectedPatient.dob, mrn: probe.expectedPatient.mrn },
    { mode: 'probe', patientId: rt.patient.id, name: rt.patient.name, dob: rt.patient.dob, mrn: rt.patient.mrn },
    'Verify now did not freeze the complete exact-patient identity'
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(probe.expectedContext)),
    {
      visitDate: '7/14/2026', provider: 'exact doctor md', appointmentId: '9900714',
      encounterId: '44001', encounterUrl: 'https://athenanet.athenahealth.com/encounter/44001'
    },
    'Verify now did not bind the read-only probe to the exact local visit'
  );
  assert(rt.posted.every(m => !['mlsAppPullSchedule','mlsAppGotoDate','mlsAppReadChart','mlsAppReadVisits','mlsAppSearchOpenPatient','mlsAppFocusMlsTab'].includes(m.type)), 'Verify now performed navigation, a pull, or focus action');

  const staleReceipt = Object.assign({}, status.verify, { verifiedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() });
  const staleState = rt.api._verifyFreshness(status.patient, staleReceipt);
  assert.strictEqual(staleState.fresh, false, 'aged verification remained green indefinitely');
  assert(/stale/i.test(staleState.reason), 'aged verification did not ask for a fresh check');

  rt.context.currentVisitAthenaBinding = Object.assign({}, rt.binding, { id: 'visit-binding-2' });
  rt.context.window.currentVisitAthenaBinding = rt.context.currentVisitAthenaBinding;
  status = rt.api.patientStatus();
  assert.strictEqual(status.verifyFresh, false, 'visit-context change did not invalidate verification');
  assert(/Visit context changed/.test(status.verifyReason), 'context invalidation reason was not visible');

  rt.emit({
    source: 'mls-app', type: 'mlsAppAthenaActionV2', mode: 'execute', action: 'write_note', requestId: 'typed-write-1',
    expectedPatient: { patientId: rt.patient.id, name: rt.patient.name, dob: rt.patient.dob, mrn: rt.patient.mrn }
  });
  assert.strictEqual(rt.api.patientStatus().sends.pending, 1, 'typed execute did not appear as pending before its receipt');
  rt.emit({
    source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: 'typed-write-1',
    resp: { ok: true, written: true, verified: true, draftVerified: true }
  });
  assert.strictEqual(rt.api.patientStatus().sends.verified, 1, 'verified typed result did not replace the pending row');

  rt.api.mark({ patientId: rt.patient.id, patient: rt.patient.name, dir: 'push', status: 'pending', label: 'Pending write', requestId: 'manual-pending' });
  rt.api.mark({ patientId: rt.patient.id, patient: rt.patient.name, dir: 'push', status: 'failed', label: 'Failed write', requestId: 'manual-failed' });
  rt.api.mark({ patientId: rt.patient.id, patient: rt.patient.name, dir: 'push', status: 'uncertain', label: 'Unknown write', requestId: 'manual-uncertain' });
  rt.api.mark({ patientId: 'other-patient', patient: 'Other Patient', dir: 'push', status: 'verified', label: 'Other receipt', requestId: 'other' });
  status = rt.api.patientStatus();
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(status.sends)),
    { verified: 1, pending: 1, failed: 1, uncertain: 1, total: 4 },
    'send status mixed patients or hid pending/failed/uncertain outcomes'
  );
  assert.strictEqual(rt.api._classifyResult('write_note', { ok: true, written: true, verified: true, draftVerified: true }), 'verified');
  assert.strictEqual(rt.api._classifyResult('write_note', { ok: false, attempted: false }), 'failed');
  assert.strictEqual(rt.api._classifyResult('write_note', { ok: false, attempted: true }), 'uncertain');

  const productionKeys = [...rt.storage.keys()];
  assert(productionKeys.includes('sf_u::doctor@example.com::mlsSyncLog'), 'production did not normalize/persist under the authoritative session account');
  assert(productionKeys.every(key => !key.includes('wrong.patient@example.net')), 'production persisted sync data under the patient/body email');

  const stagingRt = runtime(staging);
  stagingRt.emit({
    source: 'mls-app', type: 'mlsAppAthenaActionV2', mode: 'execute', action: 'write_note', requestId: 'staging-typed-write-1',
    expectedPatient: { patientId: stagingRt.patient.id, name: stagingRt.patient.name, dob: stagingRt.patient.dob, mrn: stagingRt.patient.mrn }
  });
  assert.strictEqual(stagingRt.api.patientStatus().sends.pending, 1, 'staging did not persist the typed pending action for the signed-in account');
  const stagingKeys = [...stagingRt.storage.keys()];
  assert.deepStrictEqual(stagingKeys, ['sf_u::doctor@example.com::mlsSyncLog'], 'staging did not isolate/normalize sync storage to the authoritative session account');
  assert(stagingKeys.every(key => !key.includes('wrong.patient@example.net')), 'staging persisted sync data under the patient/body email');

  console.log('PASS active-patient Athena status: exact ID freshness/receipts, account-isolated production/staging logs, stale/context invalidation, passive no-flicker lifecycle, explicit read-only Verify now, and honest send outcomes');
})().catch(err => { console.error(err); process.exit(1); });
