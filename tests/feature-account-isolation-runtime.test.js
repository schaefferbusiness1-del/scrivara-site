'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const connectSource = read('mls-connect.js');
assert(connectSource.includes('feat_mls_status_center.js') && connectSource.includes('?v=20260802sc114'),
  'account-isolated Status Center is not loaded through a fresh immutable URL');
assert(!connectSource.includes('?v=20260718sc1e-b415'), 'retired non-isolated Status Center URL remains loadable');

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
    has(key) { return values.has(String(key)); }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function eventTarget(target) {
  const handlers = Object.create(null);
  target.addEventListener = function (name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); };
  target.removeEventListener = function (name, fn) {
    if (handlers[name]) handlers[name] = handlers[name].filter(item => item !== fn);
  };
  target.emit = function (name, event) { (handlers[name] || []).slice().forEach(fn => fn(event || {})); };
  return target;
}

function timerHarness() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout(fn) { const id = ++seq; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
    setInterval() { return ++seq; },
    clearInterval() {},
    runPending() {
      const work = Array.from(pending.values());
      pending.clear();
      work.forEach(fn => fn());
    },
    pendingCount() { return pending.size; }
  };
}

function testStatusCenterBoundary() {
  let account = 'doctor-a@example.test';
  const timers = timerHarness();
  const sessionStorage = storage();
  const localStorage = storage();
  const document = eventTarget({
    readyState: 'loading', visibilityState: 'visible',
    getElementById() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; }
  });
  class MutationObserver { observe() {} disconnect() {} }
  const context = eventTarget({
    console, Promise, Date, Math, JSON, Object, Array, String, Number, RegExp,
    document, MutationObserver, sessionStorage, localStorage,
    location: { origin: 'https://mlsscribe.com' },
    getSessionEmail() { return account; },
    postMessage() {}, fetch() { return Promise.resolve({ ok: true, status: 200 }); },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval
  });
  context.window = context;
  vm.runInNewContext(read('feat_mls_status_center.js'), context, { filename: 'feat_mls_status_center.js' });

  const api = context.__mlsStatusCenter;
  assert(api && api.installed && typeof api.resetSession === 'function', 'Status Center did not expose its account boundary');
  api.begin('Account A pull', 'Account A source');
  api.step('read', 'Reading Account A patient');
  api.setSource('reading', 'working', 'Account A patient');
  context.emit('message', { data: { source: 'mls-app', type: 'mlsAppReadChart', patient: 'Synthetic Patient A' } });
  const aState = api.getState();
  aState.task.date = 'Account A date';
  assert.strictEqual(aState.task.patient, 'Synthetic Patient A');
  sessionStorage.setItem('mlsStatusCenter_v1', 'Account A snapshot');
  const beforeLogoutEpoch = api._sessionEpoch();

  assert.strictEqual(api.resetSession('', { reason: 'logout' }), true);
  context.emit('mls:session-boundary', {}); // old-browser Event fallback has no detail and must not undo the direct reset
  account = '';
  context.emit('mls:session-boundary', { detail: { previousAccount: 'doctor-a@example.test', nextAccount: '', reason: 'logout', epoch: 41 } });
  assert.strictEqual(api._sessionEpoch(), beforeLogoutEpoch + 1, 'duplicate boundary delivery reset Status Center twice');
  assert.strictEqual(sessionStorage.has('mlsStatusCenter_v1'), false, 'logout retained the Status Center snapshot');
  timers.runPending();
  let state = api.getState();
  assert.strictEqual(state.task, null, 'Account A task survived logout');
  assert.deepStrictEqual(Array.from(state.steps), [], 'Account A steps survived logout');
  assert(!JSON.stringify(state.sources).includes('Account A'), 'Account A source text survived logout');

  account = 'doctor-b@example.test';
  context.emit('mls:session-boundary', { detail: { previousAccount: '', nextAccount: account, reason: 'start-session', epoch: 42 } });
  api.begin('Account B task', 'Account B source');
  state = api.getState();
  assert.strictEqual(state.task.patient, '', 'Account B inherited Account A patient');
  assert.strictEqual(state.task.date, '', 'Account B inherited Account A date');
  assert(!JSON.stringify(state).includes('Synthetic Patient A'), 'Account A patient leaked into Account B Status Center state');
}

function makeAssistantPane() {
  const classList = { remove() {}, toggle() {}, contains() { return false; } };
  const provider = { innerHTML: '', value: '' };
  const date = { value: '' };
  const list = { innerHTML: '', querySelectorAll() { return []; } };
  const listHead = { textContent: '' };
  const patientCount = { textContent: '' };
  const opCount = { textContent: '' };
  const pullStatus = { textContent: '', classList: { toggle() {} } };
  const thread = { innerHTML: '' };
  const textarea = { value: '' };
  const send = { disabled: false };
  const pane = {
    querySelector(selector) {
      return ({ '.as-date': date, '.as-prov': provider, '.as-stat-pt b': patientCount,
        '.as-stat-op b': opCount, '.as-list': list, '.as-listhd': listHead,
        '.as-pullstatus': pullStatus })[selector] || null;
    },
    querySelectorAll() { return []; }
  };
  const panel = {
    classList,
    querySelector(selector) {
      return ({ '.as-pane-schedule': pane, '.as-prov': provider, '.as-date': date,
        '.as-list': list, '.as-listhd': listHead, '.as-stat-pt b': patientCount,
        '.as-stat-op b': opCount, '.as-pullstatus': pullStatus, '.as-thread': thread,
        'textarea': textarea, '.as-send': send })[selector] || null;
    }
  };
  return { panel, provider };
}

async function testAssistantBoundary() {
  let account = 'doctor-a@example.test';
  const requests = [];
  const sessionStorage = storage();
  const localStorage = storage();
  const pane = makeAssistantPane();
  const document = eventTarget({
    readyState: 'loading',
    getElementById(id) { return id === 'mlsAsstPanel' ? pane.panel : null; },
    querySelector() { return null; }
  });
  class AbortController {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  }
  class MutationObserver { observe() {} disconnect() {} }
  const context = eventTarget({
    console, Promise, Date, Math, JSON, Object, Array, String, Number, RegExp,
    AbortController, MutationObserver, document, sessionStorage, localStorage,
    location: { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' },
    getSessionEmail() { return account; },
    getActivePtId() { return 'patient-42'; },
    activePatient() { return { id: 'patient-42', name: 'Synthetic Patient' }; },
    getPatients() { return []; },
    backendMode() { return true; }, bkToken() { return 'synthetic-token'; }, bkBase() { return 'https://example.test'; },
    copilotSnapshot() { return { account, patient: 'patient-42' }; },
    _calProviders: [{ id: 'a-1', name: 'Doctor Alpha' }], _calAppts: [],
    fetch(_url, init) { const d = deferred(); requests.push({ d, init, body: JSON.parse(init.body) }); return d.promise; },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, getComputedStyle() { return {}; }
  });
  context.window = context;
  vm.runInNewContext(read('feat_mls_assistant_exact.js'), context, { filename: 'feat_mls_assistant_exact.js' });

  const api = context.__mlsAsst;
  assert(api && api.installed && typeof api.resetSession === 'function', 'Assistant did not expose its account boundary');
  api.setDate('2099-12-31');
  api.setProvider('pv:legacy-name%3Adoctor%20alpha');
  api._renderSchedule();
  assert(pane.provider.innerHTML.includes('Doctor Alpha'), 'Account A provider roster did not render');
  const ownerA = api._ownerKey();
  const requestA = api.ask('Account A private question');
  assert.strictEqual(requests.length, 1);
  assert(requests[0].init.signal && requests[0].init.signal.aborted === false, 'Account A request has no abort owner');
  const beforeLogoutEpoch = api._accountEpoch();

  assert.strictEqual(api.resetSession('', { reason: 'logout' }), true);
  context.emit('mls:session-boundary', {}); // old-browser Event fallback has no detail and must not restore Account A
  account = '';
  context.emit('mls:session-boundary', { detail: { nextAccount: '', reason: 'logout', epoch: 51 } });
  assert.strictEqual(api._accountEpoch(), beforeLogoutEpoch + 1, 'duplicate boundary delivery reset Assistant twice');
  assert.strictEqual(requests[0].init.signal.aborted, true, 'logout did not abort Account A Assistant request');
  assert.strictEqual(pane.provider.innerHTML, '', 'logout retained Account A provider options in the DOM');

  account = 'doctor-b@example.test';
  context._calProviders = [{ id: 'b-1', name: 'Doctor Beta' }];
  context.emit('mls:session-boundary', { detail: { previousAccount: '', nextAccount: account, reason: 'start-session', epoch: 52 } });
  const ownerB = api._ownerKey();
  assert.notStrictEqual(ownerB, ownerA, 'same patient id shared one chat owner across accounts');
  const selectionB = JSON.parse(JSON.stringify(api._selection()));
  assert(/^\d{4}-\d{2}-\d{2}$/.test(selectionB.date) && selectionB.date !== '2099-12-31' && selectionB.provider === 'All doctors', 'Account B inherited Account A schedule selection');
  api._renderSchedule();
  assert(pane.provider.innerHTML.includes('Doctor Beta'), 'Account B provider roster was not rebuilt');
  assert(!pane.provider.innerHTML.includes('Doctor Alpha'), 'Account A provider remained in Account B selector');

  const requestB = api.ask('Account B question');
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[1].body.assistant_context.selected_provider, 'All doctors');
  requests[0].d.resolve({ json() { return Promise.resolve({ reply: 'Account A private answer' }); } });
  await requestA;
  assert(!api._history().some(message => /Account A/.test(message.text || '')), 'late Account A response landed in Account B chat');
  requests[1].d.resolve({ json() { return Promise.resolve({ reply: 'Account B answer' }); } });
  await requestB;
  const bText = api._history().map(message => message.text).join('|');
  assert(bText.includes('Account B question') && bText.includes('Account B answer'));
  assert(!bText.includes('Account A private'), 'Account A chat survived in Account B history');
}

(async () => {
  testStatusCenterBoundary();
  await testAssistantBoundary();
  console.log('PASS feature account isolation: Status Center and Assistant reset synchronously across A -> logout -> B, abort stale work, and rebuild account-owned state');
})().catch(error => { console.error(error); process.exit(1); });
