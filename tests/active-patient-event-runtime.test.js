'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function eventTarget(target) {
  const listeners = Object.create(null);
  target.addEventListener = function (name, fn) {
    (listeners[name] || (listeners[name] = [])).push(fn);
  };
  target.removeEventListener = function (name, fn) {
    listeners[name] = (listeners[name] || []).filter(item => item !== fn);
  };
  target.emit = function (name, event) {
    (listeners[name] || []).slice().forEach(fn => fn(event || { type: name }));
  };
  target.listenerCount = name => (listeners[name] || []).length;
  return target;
}

function timers() {
  let nextId = 0;
  let intervalCreates = 0;
  const pending = new Map();
  const intervals = new Map();
  return {
    setTimeout(fn) { const id = ++nextId; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
    setInterval(fn, delay) {
      const id = ++nextId;
      intervalCreates++;
      intervals.set(id, { fn, delay: Number(delay) || 0 });
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    runOne() {
      const entry = pending.entries().next();
      if (entry.done) return false;
      const [id, fn] = entry.value;
      pending.delete(id);
      fn();
      return true;
    },
    runInterval() {
      const entry = intervals.values().next();
      if (entry.done) return false;
      entry.value.fn();
      return true;
    },
    get intervalCreates() { return intervalCreates; },
    get intervalCount() { return intervals.size; },
    get intervalDelay() {
      const entry = intervals.values().next();
      return entry.done ? null : entry.value.delay;
    },
    get pendingCount() { return pending.size; }
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

function testActivePatientFieldSync() {
  const clock = timers();
  let account = 'doctor-a@example.test';
  let activeId = 'p-0';
  let patientReads = 0;
  const patients = Array.from({ length: 100000 }, (_, index) => ({
    id: `p-${index}`,
    name: `Synthetic Patient ${String(index).padStart(6, '0')}`
  }));
  const fields = {
    heroPtName: { id: 'heroPtName', value: patients[0].name, events: [], dispatchEvent(ev) { this.events.push(ev.type); } },
    patientLabel: { id: 'patientLabel', value: patients[0].name, events: [], dispatchEvent(ev) { this.events.push(ev.type); } }
  };
  const document = eventTarget({
    activeElement: null,
    getElementById(id) { return fields[id] || null; }
  });
  const localStorage = memoryStorage();
  const window = eventTarget({
    document,
    localStorage,
    uns(key) { return `sf_u::${account}::${key}`; },
    getActivePtId() { return activeId; },
    activePatient() {
      patientReads++;
      for (let i = 0; i < patients.length; i++) if (patients[i].id === activeId) return patients[i];
      return null;
    }
  });
  window.window = window;
  const context = vm.createContext({
    window, document, localStorage, console,
    Event: function Event(type) { this.type = type; },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval
  });

  vm.runInContext(read('feat_mls_active_patient_sync.js'), context, { filename: 'feat_mls_active_patient_sync.js' });
  assert(window.__mlsActivePtSync && window.__mlsActivePtSync.version === 'aps-1.2.2', 'reviewed active-patient runtime did not install');
  assert.strictEqual(clock.intervalCreates, 1, 'active-patient sync must install exactly one compatibility backstop');
  assert.strictEqual(clock.intervalDelay, 15000, 'active-patient rename backstop is not the reviewed 15-second cadence');
  assert.strictEqual(patientReads, 0, 'active-patient sync decoded the roster while installing');
  assert.strictEqual(window.listenerCount('mls:active-patient-changed'), 1, 'canonical patient event is not wired exactly once');
  assert.strictEqual(window.listenerCount('mls:patient-record-updated'), 1, 'exact patient-record event is not wired exactly once');
  assert.strictEqual(document.listenerCount('focusout'), 1, 'focused-field recovery listener is not wired exactly once');

  activeId = 'p-99999';
  window.emit('mls:active-patient-changed', { detail: { previousId: 'p-0', patientId: activeId } });
  assert.strictEqual(clock.pendingCount, 1, 'patient selection did not queue one post-switch reconciliation');
  fields.heroPtName.value = '';
  fields.patientLabel.value = '';
  assert.strictEqual(fields.heroPtName.value, '', 'patient fields changed before downstream newVisit finished');
  clock.runOne();
  assert.strictEqual(fields.heroPtName.value, patients[99999].name, 'hero patient name did not recover after downstream reset');
  assert.strictEqual(fields.patientLabel.value, patients[99999].name, 'visit patient label did not recover after downstream reset');
  assert.deepStrictEqual(fields.heroPtName.events, ['input', 'change'], 'field sync changed its input/change contract');
  assert.strictEqual(patientReads, 1, 'one patient selection caused duplicate full-roster reads');

  window.emit('storage', { key: 'unrelated', storageArea: localStorage });
  assert.strictEqual(patientReads, 1, 'unrelated storage traffic triggered a patient-store scan');
  activeId = 'p-50000';
  window.emit('storage', { key: window.uns('activePt'), storageArea: localStorage });
  assert.strictEqual(fields.heroPtName.value, '', 'remote patient switch left the previous patient name visible while refresh waited');
  assert.strictEqual(fields.patientLabel.value, '', 'remote patient switch left the previous visit label visible while refresh waited');
  assert.strictEqual(patientReads, 1, 'remote patient switch decoded the roster in the storage callback');
  clock.runOne();
  assert.strictEqual(fields.patientLabel.value, patients[50000].name, 'exact cross-tab active-patient storage change was missed');

  activeId = 'p-2';
  window.emit('mls:active-patient-changed', { detail: { patientId: activeId } });
  activeId = 'p-3';
  window.emit('mls:active-patient-changed', { detail: { patientId: activeId } });
  activeId = 'p-4';
  window.emit('mls:active-patient-changed', { detail: { patientId: activeId } });
  assert.strictEqual(clock.pendingCount, 1, 'rapid switches did not coalesce to one task');
  clock.runOne();
  assert.strictEqual(fields.patientLabel.value, patients[4].name, 'rapid switches did not land on the final patient');

  activeId = 'p-5';
  document.activeElement = fields.patientLabel;
  window.emit('mls:active-patient-changed', { detail: { patientId: activeId } });
  clock.runOne();
  assert.strictEqual(fields.heroPtName.value, patients[5].name, 'focused label blocked the other patient field');
  assert.strictEqual(fields.patientLabel.value, patients[4].name, 'active typing was overwritten during a switch');
  document.activeElement = null;
  document.emit('focusout', { target: fields.patientLabel });
  clock.runOne();
  assert.strictEqual(fields.patientLabel.value, patients[5].name, 'focused patient label did not reconcile on focusout');

  const readsBeforeRecordUpdate = patientReads;
  const writesBeforeRecordUpdate = fields.heroPtName.events.length + fields.patientLabel.events.length;
  window.emit('mls:patient-record-updated', { detail: { patientId: 'p-6', patientStoreKey: window.uns('patients') } });
  assert.strictEqual(clock.pendingCount, 0, 'unrelated patient edit queued active-patient work');
  assert.strictEqual(patientReads, readsBeforeRecordUpdate, 'unrelated patient edit scanned the roster');
  assert.strictEqual(fields.heroPtName.events.length + fields.patientLabel.events.length, writesBeforeRecordUpdate, 'unrelated patient edit wrote Visit identity');

  patients[5].name = 'Renamed Synthetic Patient';
  window.emit('mls:patient-record-updated', { detail: { patientId: 'p-5', patientStoreKey: window.uns('patients') } });
  assert.strictEqual(clock.pendingCount, 1, 'same-ID rename did not queue immediate post-save reconciliation');
  clock.runOne();
  assert.strictEqual(fields.heroPtName.value, patients[5].name, 'same-ID rename waited for the compatibility backstop');
  assert.strictEqual(fields.patientLabel.value, patients[5].name, 'same-ID rename left the Visit label stale');
  assert.strictEqual(patientReads, readsBeforeRecordUpdate + 1, 'same-ID rename performed duplicate roster scans');

  const readsBeforeSettledBackstop = patientReads;
  for (let i = 0; i < 1000; i++) clock.runInterval();
  assert.strictEqual(patientReads, readsBeforeSettledBackstop,
    'a settled 15-second compatibility tick decoded the full roster');

  patients[5].name = 'Backstop Repair Compatibility';
  fields.heroPtName.value = '';
  clock.runInterval();
  assert.strictEqual(fields.heroPtName.value, patients[5].name, 'slow backstop missed a structurally stale patient field');
  assert.strictEqual(fields.patientLabel.value, patients[5].name, 'structural backstop left the paired patient label stale');
  assert.strictEqual(patientReads, readsBeforeSettledBackstop + 1,
    'one structurally stale backstop performed duplicate roster reads');

  activeId = '';
  window.emit('mls:active-patient-changed', { detail: { previousId: 'p-5', patientId: '' } });
  clock.runOne();
  const readsBeforeEmptyBackstop = patientReads;
  for (let i = 0; i < 1000; i++) clock.runInterval();
  assert.strictEqual(patientReads, readsBeforeEmptyBackstop,
    'no-selected-patient backstop decoded the full roster');

  activeId = 'missing-patient';
  window.emit('mls:active-patient-changed', { detail: { patientId: activeId } });
  clock.runOne();
  const readsAfterMissingLookup = patientReads;
  for (let i = 0; i < 1000; i++) clock.runInterval();
  assert.strictEqual(patientReads, readsAfterMissingLookup,
    'known-missing active record was re-read on every compatibility tick');

  account = 'doctor-b@example.test';
  activeId = 'p-1';
  window.emit('mls:session-boundary', { detail: { nextAccount: account } });
  assert.strictEqual(clock.pendingCount, 1, 'account switch did not coalesce to one bounded reconciliation');
  clock.runOne();
  assert.strictEqual(fields.patientLabel.value, patients[1].name, 'next account did not reconcile its active patient');

  const readsBeforeRevert = patientReads;
  window.__mlsActivePtSync.revert();
  assert.strictEqual(window.listenerCount('mls:active-patient-changed'), 0, 'active-patient listener leaked after revert');
  assert.strictEqual(window.listenerCount('mls:patient-record-updated'), 0, 'patient-record listener leaked after revert');
  assert.strictEqual(window.listenerCount('storage'), 0, 'storage listener leaked after revert');
  assert.strictEqual(window.listenerCount('mls:session-boundary'), 0, 'session listener leaked after revert');
  assert.strictEqual(document.listenerCount('focusout'), 0, 'focusout listener leaked after revert');
  assert.strictEqual(clock.intervalCount, 0, 'rename backstop leaked after revert');
  assert.strictEqual(clock.pendingCount, 0, 'bounded account reconciliation leaked after revert');
  activeId = 'p-2';
  window.emit('mls:active-patient-changed', { detail: { patientId: activeId } });
  assert.strictEqual(patientReads, readsBeforeRevert, 'reverted field sync still read the roster');
}

function testPatientUpsertEventContract() {
  const app = read('ScribeFlow.html');
  const start = app.indexOf('function upsertPatient(p){');
  const end = app.indexOf('\n/* Remove every patient', start);
  assert(start >= 0 && end > start, 'production patient upsert is missing');
  const source = app.slice(start, end);

  function harness(failSave) {
    const patients = [{ id: 'p-rename', name: 'Before', visits: [] }];
    const events = [];
    const window = {
      dispatchEvent(event) { events.push(event); }
    };
    window.window = window;
    const context = vm.createContext({
      window, console,
      CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
      Event: function Event(type) { this.type = type; },
      uns(key) { return `sf_u::doctor-a@example.test::${key}`; },
      __mlsPtsBatchByKey: Object.create(null),
      __mlsPtsForeignBatch() { return null; },
      getPatients() { return patients; },
      __mlsAthenaProofGuard() {},
      __mlsAthenaCarryAttested() {},
      savePatients() { if (failSave) throw new Error('persistence refused'); },
      backendMode() { return false; },
      bkToken() { return ''; },
      syncPatientToServer() {}
    });
    vm.runInContext(`${source};this.upsertPatient=upsertPatient;`, context, { filename: 'production-patient-upsert.js' });
    return { context, events };
  }

  const ok = harness(false);
  ok.context.upsertPatient({ id: 'p-rename', name: 'After', visits: [] });
  assert.strictEqual(ok.events.length, 1, 'successful patient upsert did not emit one exact record event');
  assert.strictEqual(ok.events[0].type, 'mls:patient-record-updated', 'patient upsert emitted the wrong event');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(ok.events[0].detail)),
    { patientId: 'p-rename', patientStoreKey: 'sf_u::doctor-a@example.test::patients' },
    'patient-record event lost exact patient/account ownership'
  );

  const refused = harness(true);
  assert.throws(
    () => refused.context.upsertPatient({ id: 'p-rename', name: 'Not persisted', visits: [] }),
    /persistence refused/,
    'patient persistence refusal was swallowed'
  );
  assert.strictEqual(refused.events.length, 0, 'failed patient save falsely emitted a record-updated event');
}

function testConversationIsolationEvents() {
  const clock = timers();
  const localStorage = memoryStorage();
  let account = 'doctor-a@example.test';
  let activeId = 'a-1';
  const patients = {
    'a-1': { id: 'a-1', name: 'Account A One', dob: '01/01/1980' },
    'a-2': { id: 'a-2', name: 'Account A Two', dob: '02/02/1980' },
    'b-1': { id: 'b-1', name: 'Account B One', dob: '03/03/1980' }
  };
  let renders = 0;
  const document = eventTarget({
    readyState: 'complete',
    querySelector() { return null; },
    getElementById() { return null; },
    createElement() { throw new Error('identity chip must stay dormant without its thread'); }
  });
  const location = { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' };
  const window = eventTarget({
    document, location, localStorage,
    __mlsSessionAccount: account,
    _copilotHistory: [{ role: 'user', text: 'Account A opening turn' }],
    uns(key) { return `sf_u::${account}::${key}`; },
    getActivePtId() { return activeId; },
    activePatient() { return patients[activeId] || null; },
    findPatient(id) { return patients[id] || null; },
    _copilotSaveHist() {},
    _copilotRenderThread() { renders++; },
    _copilotRenderChips() {}
  });
  window.window = window;
  const context = vm.createContext({
    window, document, location, localStorage, console,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval
  });

  vm.runInContext(read('feat_mls_patient_context_safety.js'), context, { filename: 'feat_mls_patient_context_safety.js' });
  const api = window.__mlsPtCtxSafety;
  assert(api && api.installed && api.version === 'pcs-1.2.1', 'event-driven context safety did not install');
  assert.strictEqual(clock.intervalCreates, 0, 'conversation isolation installed a permanent interval');
  assert.strictEqual(api.owner(), 'a-1', 'boot did not adopt the exact active patient');

  activeId = 'a-2';
  window.emit('mls:active-patient-changed', { detail: { previousId: 'a-1', patientId: activeId } });
  assert.strictEqual(api.owner(), 'a-2', 'patient selection did not isolate the conversation synchronously');
  assert.deepStrictEqual(window._copilotHistory, [], 'incoming patient inherited the outgoing conversation');
  activeId = 'a-1';
  window.emit('mls:active-patient-changed', { detail: { previousId: 'a-2', patientId: activeId } });
  assert.strictEqual(window._copilotHistory[0].text, 'Account A opening turn', 'returning patient did not restore its isolated conversation');

  window._copilotHistory.push({ role: 'pending' });
  activeId = 'a-2';
  window.emit('mls:active-patient-changed', { detail: { previousId: 'a-1', patientId: activeId } });
  assert.strictEqual(api.owner(), 'a-1', 'in-flight answer was moved into the incoming patient');
  assert.strictEqual(clock.pendingCount, 1, 'in-flight switch did not arm one bounded settle retry');
  window._copilotHistory = window._copilotHistory.filter(message => message.role !== 'pending');
  clock.runOne();
  assert.strictEqual(api.owner(), 'a-2', 'conversation did not switch when the in-flight answer settled');
  assert.strictEqual(clock.pendingCount, 0, 'settled conversation left a retry timer behind');

  const bBuckets = { 'pt:b-1': { ownerId: 'b-1', msgs: [{ role: 'user', text: 'Account B private turn' }] } };
  localStorage.setItem('sf_u::doctor-b@example.test::copilotHistByPt', JSON.stringify(bBuckets));
  localStorage.setItem('sf_u::doctor-b@example.test::copilotConvoOwner', 'b-1');
  window._copilotHistory.push({ role: 'user', text: 'Account A late private turn' });
  account = 'doctor-b@example.test';
  activeId = 'b-1';
  window.__mlsSessionAccount = account;
  window.emit('mls:session-boundary', { detail: { previousAccount: 'doctor-a@example.test', nextAccount: account } });
  assert.strictEqual(api.owner(), 'b-1', 'account switch did not adopt Account B conversation owner');
  assert.deepStrictEqual(window._copilotHistory.map(item => item.text), ['Account B private turn'], 'Account A conversation crossed the account boundary');
  assert(api._diag().storageKey.includes('doctor-b@example.test'), 'conversation storage keys stayed pinned to Account A');
  assert(!JSON.stringify(window._copilotHistory).includes('Account A'), 'Account A text remained in Account B memory');

  window.__mlsSessionAccount = '';
  window.emit('mls:session-boundary', { detail: { previousAccount: account, nextAccount: '' } });
  assert.strictEqual(api.owner(), null, 'logout retained an active conversation owner');
  assert.deepStrictEqual(window._copilotHistory, [], 'logout retained conversation text');
  assert.strictEqual(api._diag().storageKey, '', 'logout retained an account storage key');

  const rendersBeforeRevert = renders;
  api.revert();
  assert.strictEqual(window.listenerCount('mls:active-patient-changed'), 0, 'context patient listener leaked after revert');
  assert.strictEqual(window.listenerCount('storage'), 0, 'context storage listener leaked after revert');
  assert.strictEqual(window.listenerCount('mls:session-boundary'), 0, 'context session listener leaked after revert');
  assert.strictEqual(document.listenerCount('focusin'), 0, 'context focus guard leaked after revert');
  assert.strictEqual(clock.pendingCount, 0, 'context settle retry leaked after revert');
  window.emit('mls:active-patient-changed', { detail: { patientId: 'b-1' } });
  assert.strictEqual(renders, rendersBeforeRevert, 'reverted context safety still rendered');
}

function testStagingSetterEventContract() {
  const stagingApp = read('ScribeFlow-staging.html');
  const start = stagingApp.indexOf('function setActivePtId(id){');
  const end = stagingApp.indexOf('\nfunction activePatient()', start);
  assert(start >= 0 && end > start, 'staging active-patient setter is missing');
  const source = stagingApp.slice(start, end);
  let stored = 'stage-a';
  const events = [];
  const localStorage = {
    setItem(key, value) { assert.strictEqual(key, 'stage::activePt'); stored = String(value); },
    removeItem(key) { assert.strictEqual(key, 'stage::activePt'); stored = ''; }
  };
  const context = {
    localStorage,
    uns(key) { return `stage::${key}`; },
    getActivePtId() { return stored; },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
    Event: function Event(type) { this.type = type; },
    window: {
      dispatchEvent(event) { events.push({ event, storedAtDispatch: stored }); }
    }
  };
  vm.runInNewContext(`${source};this.setActivePtId=setActivePtId;`, context, { filename: 'staging-active-patient-setter.js' });
  context.setActivePtId('stage-a');
  assert.strictEqual(events.length, 0, 'staging emitted a switch event for the unchanged ID');
  context.setActivePtId('stage-b');
  assert.strictEqual(events.length, 1, 'staging missed a same-tab patient switch event');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(events[0].event.detail)),
    { previousId: 'stage-a', patientId: 'stage-b' },
    'staging switch event identity changed'
  );
  assert.strictEqual(events[0].storedAtDispatch, 'stage-b', 'staging dispatched before adopting the patient');
  context.setActivePtId('');
  assert.strictEqual(events.length, 2, 'staging missed the clear-patient event');
  assert.strictEqual(events[1].storedAtDispatch, '', 'staging dispatched before clearing the patient');
}

const activeSyncSource = read('feat_mls_active_patient_sync.js');
const contextSource = read('feat_mls_patient_context_safety.js');
const connect = read('mls-connect.js');
const staging = read('mls-connect.staging.js');
assert(activeSyncSource.includes('backstopTimer = setInterval(tick, 15000)'), 'active-patient structural backstop changed');
assert(activeSyncSource.includes('lastName = lastActiveId ? seedNameFromFields() : null'),
  'active-patient sync can decode the roster while installing again');
assert(activeSyncSource.includes('id === lastActiveId &&') && activeSyncSource.includes('(!lastName && lastRecordMissing)'),
  'settled or known-missing backstop can decode the full roster again');
const recordListenerSource = activeSyncSource.slice(activeSyncSource.indexOf('recordListener = function'), activeSyncSource.indexOf('storageListener = function'));
const storageListenerStart = activeSyncSource.indexOf('storageListener = function');
const storageListenerSource = activeSyncSource.slice(storageListenerStart, activeSyncSource.indexOf('focusoutListener = function', storageListenerStart));
assert(recordListenerSource.includes('queueSync()'), 'exact same-tab patient edits lost their immediate label repair');
assert(storageListenerSource.includes('queueStorageSync()') && activeSyncSource.includes('window.requestIdleCallback(run)'),
  'cross-tab active-patient changes can cold-decode the roster in the input lane');
assert(storageListenerSource.includes('invalidateStorageIdentity()'),
  'cross-tab active-patient changes can leave the prior patient label visible while idle work waits');
assert(activeSyncSource.includes("if (!id) {") && activeSyncSource.includes('(!lastName && lastRecordMissing)'),
  'empty or known-missing active records can cold-decode the roster on every backstop');
assert(!activeSyncSource.includes('setInterval(tick, 400)'), 'active-patient field sync regained high-frequency polling');
assert(!/setInterval\s*\(/.test(contextSource), 'conversation isolation regained polling');
assert(
  connect.includes("var A='feat_mls_active_patient_sync.js'") &&
    connect.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"),
  'production active-patient event runtime is not keyed to the current build'
);
assert(
  staging.includes("var A='feat_mls_active_patient_sync.js'") &&
    staging.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"),
  'staging active-patient event runtime is not keyed to the current build'
);
assert(
  connect.includes("s.src='feat_mls_patient_context_safety.js?v='+(window.__MLS_AV||Date.now())"),
  'context-safety event runtime is not keyed to the current build'
);
assert(!connect.includes('20260805aps110') && !connect.includes('20260805pcs110'), 'obsolete event-runtime loader token returned');

testActivePatientFieldSync();
testPatientUpsertEventContract();
testConversationIsolationEvents();
testStagingSetterEventContract();
console.log('PASS active-patient event runtime: post-switch and same-ID rename sync, unrelated-edit fast path, successful-upsert event ownership, 15s backstop, staging parity, cleanup, and account isolation');
