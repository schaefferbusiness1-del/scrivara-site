'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '1p-feat_mls_schedimport_exact.js'), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const DAY = '2026-08-17';

function makeNode(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(), style: {}, children: [], parentNode: null,
    classList: { contains: () => false, add() {}, remove() {} },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    remove() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

function harness() {
  const listeners = new Map();
  const posted = [];
  const storage = new Map();
  const fetches = [];
  const posts = [];
  const patients = [{ id: 'patient-b', name: 'Current Patient', dob: '01/02/1970', mrn: 'MRN-B', visits: [] }];
  const upserts = [];
  let account = 'doctor-a@example.test';
  let epoch = 10;
  let token = 'token-a';
  let deferredCalendar = null;

  function add(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  }
  function remove(type, fn) { if (listeners.has(type)) listeners.get(type).delete(fn); }
  function emit(type, event) { for (const fn of Array.from(listeners.get(type) || [])) fn(event); }
  function contextTimer(fn, ms) { const id = setTimeout(fn, ms); if (id && id.unref) id.unref(); return id; }

  const head = makeNode('head');
  const body = makeNode('body');
  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp, Error,
    encodeURIComponent, decodeURIComponent, isFinite, queueMicrotask,
    setTimeout: contextTimer, clearTimeout, setInterval: contextTimer, clearInterval,
    location: { pathname: '/ScribeFlow-staging.html', origin: 'https://mlsscribe.com' },
    navigator: {},
    document: {
      readyState: 'complete', head, body, documentElement: head,
      createElement: makeNode, querySelectorAll: () => [], querySelector: () => null,
      getElementById: () => null, addEventListener() {}, removeEventListener() {}
    },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(String(key), String(value)),
      removeItem: key => storage.delete(String(key))
    },
    backendMode: () => true,
    bkToken: () => token,
    bkBase: () => 'https://backend.invalid',
    getSessionEmail: () => account,
    uns: suffix => `sf_u::${account}::${suffix}`,
    _normDate: value => String(value || '').slice(0, 10),
    _normTime: value => {
      const m = String(value || '').match(/(\d{1,2}):(\d{2})/);
      return m ? `${String(Number(m[1])).padStart(2, '0')}:${m[2]}` : '';
    },
    _acctWallToUtcIso: (day, time) => `${day}T${time}:00.000Z`,
    getPatients: () => patients,
    upsertPatient: patient => { upserts.push(JSON.parse(JSON.stringify(patient))); const i = patients.findIndex(p => p.id === patient.id); if (i >= 0) patients[i] = patient; else patients.push(patient); return true; },
    loadCalendar: async () => ({ applied: true }),
    _calAppts: [],
    renderHistory() {}, renderProfile() {}, loadPatients() {}, renderCalendar() {}, renderCalCheckin() {},
    addEventListener: add,
    removeEventListener: remove,
    postMessage(message, targetOrigin) { posted.push({ message: JSON.parse(JSON.stringify(message)), targetOrigin }); },
    dispatchEvent(event) { emit(event.type, event); },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function Event(type) { this.type = type; },
    fetch: async (url, init = {}) => {
      const auth = init.headers && (init.headers.Authorization || init.headers.authorization) || '';
      fetches.push({ url: String(url), method: init.method || 'GET', auth });
      if (/\/api\/me$/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
      if (/\/api\/appointments$/.test(String(url)) && !init.method) {
        if (deferredCalendar) return deferredCalendar.promise;
        return { ok: true, status: 200, json: async () => ({ appointments: [] }) };
      }
      if (/\/api\/appointments$/.test(String(url)) && init.method === 'POST') {
        posts.push({ body: JSON.parse(init.body), auth, account });
        return { ok: true, status: 200, json: async () => ({ id: `appt-${posts.length}` }) };
      }
      if (/extension-version\.json/.test(String(url))) return { ok: true, json: async () => ({ version: 'test' }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };
  Object.defineProperties(rt, {
    __mlsSessionAccount: { get: () => account, set: v => { account = String(v || '').toLowerCase(); }, configurable: true },
    __mlsSessionEpoch: { get: () => epoch, set: v => { epoch = Number(v) || 0; }, configurable: true }
  });
  rt.window = rt;
  vm.createContext(rt);
  vm.runInContext(source, rt, { filename: '1p-feat_mls_schedimport_exact.js' });

  return {
    rt, posted, storage, fetches, posts, patients, upserts,
    setIdentity(nextAccount, nextEpoch, nextToken) { account = nextAccount; epoch = nextEpoch; token = nextToken; },
    boundary(detail) { emit('mls:session-boundary', { type: 'mls:session-boundary', detail: detail || {} }); },
    message(data, overrides = {}) {
      emit('message', Object.assign({ data, source: rt, origin: rt.location.origin }, overrides));
    },
    deferCalendar() {
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      deferredCalendar = { promise, resolve };
      return deferredCalendar;
    },
    clearDeferred() { deferredCalendar = null; },
    listenerCount(type) { return (listeners.get(type) || new Set()).size; }
  };
}

async function waitForPost(h, type, after = 0) {
  for (let i = 0; i < 100; i++) {
    const found = h.posted.slice(after).find(entry => entry.message.type === type);
    if (found) return found;
    await sleep(2);
  }
  throw new Error(`timed out waiting for ${type}; posted=${JSON.stringify(h.posted.map(x => x.message.type))}`);
}

function reply(h, sent, type, resp, overrides) {
  const id = sent.message.requestId;
  const value = Object.assign({}, resp, { requestId: id, id });
  h.message({ source: 'mls-ext', type, requestId: id, id, resp: value }, overrides);
}

(async () => {
  const h = harness();
  const api = h.rt.__mlsSI;
  assert(api && api.installed, 'P1 importer did not boot');

  // Strict source/origin and exact nonblank IDs on correlated bridge replies.
  const pull = api.pull({ date: DAY, provider: 'all', includeHistory: false });
  const ping = await waitForPost(h, 'mlsPing');
  reply(h, ping, 'mlsPong', { ok: true, version: 'test' }, { source: {} });
  reply(h, ping, 'mlsPong', { ok: true, version: 'test' }, { origin: 'https://evil.invalid' });
  h.message({ source: 'mls-ext', type: 'mlsPong', requestId: 'wrong', resp: { ok: true, requestId: 'wrong' } });
  await sleep(5);
  assert.strictEqual(h.posted.some(x => x.message.type === 'mlsAppGotoDate'), false, 'spoofed/mismatched pong advanced the pull');
  console.log('DEBUG before valid pong', ping.message, h.listenerCount('message'), api._sessionSecurity());
  reply(h, ping, 'mlsPong', { ok: true, version: 'test' });
  await sleep(10); console.log('DEBUG after valid pong', h.posted.map(x => x.message.type), api._sessionSecurity());

  const goto = await waitForPost(h, 'mlsAppGotoDate');
  h.message({ source: 'mls-ext', type: 'mlsAppGotoDateResult', resp: { ok: true, schedDate: DAY } });
  h.message({ source: 'mls-ext', type: 'mlsAppGotoDateResult', requestId: 'wrong', resp: { ok: true, schedDate: DAY, requestId: 'wrong' } });
  reply(h, goto, 'mlsAppGotoDateResult', { ok: true, schedDate: DAY }, { origin: 'https://evil.invalid' });
  await sleep(5);
  assert.strictEqual(h.posted.some(x => x.message.type === 'mlsAppPullSchedule'), false, 'blank/mismatched/spoofed goto advanced the pull');
  reply(h, goto, 'mlsAppGotoDateResult', { ok: true, schedDate: DAY });

  const schedule = await waitForPost(h, 'mlsAppPullSchedule');
  h.message({ source: 'mls-ext', type: 'mlsAppScheduleResult', resp: { ok: true, appts: [] } });
  h.message({ source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: 'wrong', resp: { ok: true, requestId: 'wrong', appts: [] } });
  reply(h, schedule, 'mlsAppScheduleResult', { ok: true, appts: [] }, { source: {} });
  await sleep(5);
  assert.strictEqual(api._lastResp(), null, 'uncorrelated/spoofed schedule entered passive global capture');

  h.rt.__schedRaw = { text: 'synthetic named schedule' };
  h.rt.__mlsDayHistoryPull = { state: { rows: [{ name: 'Synthetic Person' }] } };
  h.setIdentity('doctor-a@example.test', 11, 'token-a-new'); // same email, new login
  h.boundary({ previousAccount: 'doctor-a@example.test', nextAccount: 'doctor-a@example.test', epoch: 11 });
  const cancelled = await pull;
  assert.strictEqual(cancelled.reason, 'session-changed', 'same-email re-login did not cancel old pull');
  assert.strictEqual(h.rt.__schedRaw, undefined, 'boundary retained named raw schedule');
  assert.strictEqual(h.rt.__mlsDayHistoryPull, undefined, 'boundary retained named day-history rows');
  assert.strictEqual(h.rt.__mlsSchedulePullLease, undefined, 'boundary did not release the old run-owned lease');
  assert.strictEqual(h.listenerCount('message'), 0, 'boundary leaked active/passive message listeners');
  assert.deepStrictEqual(api._sessionSecurity(), { generation: 2, active: false, pendingOwners: 0 }, 'boundary did not clear owner registry');
  reply(h, schedule, 'mlsAppScheduleResult', { ok: true, appts: [{ name: 'Late Person' }] });
  await sleep(5);
  assert.strictEqual(api._lastResp(), null, 'late exact response repopulated old PHI');

  // Cross-account await: old Athena rows may not use the new token/store.
  h.setIdentity('doctor-a@example.test', 12, 'token-a-2');
  h.boundary({ nextAccount: 'doctor-a@example.test', epoch: 12 });
  const gate = h.deferCalendar();
  const oldImport = api.importAppts([{ name: 'Current Patient', dob: '01/02/1970', mrn: 'MRN-B', date: DAY, time: '09:00', provider: 'Provider A' }], { date: DAY });
  for (let i = 0; i < 50 && !h.fetches.some(x => /\/api\/appointments$/.test(x.url)); i++) await sleep(2);
  const beforePosts = h.posts.length, beforeUpserts = h.upserts.length;
  h.setIdentity('doctor-b@example.test', 13, 'token-b');
  h.boundary({ previousAccount: 'doctor-a@example.test', nextAccount: 'doctor-b@example.test', epoch: 13 });
  gate.resolve({ ok: true, status: 200, json: async () => ({ appointments: [] }) });
  const oldResult = await oldImport;
  assert.strictEqual(oldResult.reason, 'session-changed', 'account switch did not quarantine an awaited calendar read');
  assert.strictEqual(h.posts.length, beforePosts, 'old rows were POSTed with the new account');
  assert.strictEqual(h.upserts.length, beforeUpserts, 'old rows mutated the new patient store');
  assert.strictEqual(Array.from(h.storage.keys()).some(k => k.startsWith('sf_u::doctor-b@example.test::schedImport')), false, 'old rows entered the new sf_u namespace');
  h.clearDeferred();

  // A fully current import still works and uses only its frozen current token.
  const success = await api.importAppts([{ name: 'Current Patient', dob: '01/02/1970', mrn: 'MRN-B', date: DAY, time: '09:00', provider: 'Provider B' }], { date: DAY });
  assert.strictEqual(success.created, 1, 'current-session import did not succeed');
  assert.strictEqual(h.posts.length, beforePosts + 1, 'current import did not create exactly one appointment');
  assert.strictEqual(h.posts[h.posts.length - 1].auth, 'Bearer token-b', 'current import did not use its frozen token');
  assert.strictEqual(h.posts[h.posts.length - 1].account, 'doctor-b@example.test', 'current import crossed account scope');
  assert.strictEqual(api.isBusy(), false, 'current import left the importer locked');

  // Proven Athena sign-out gets exact actionable language; generic errors do not.
  await sleep(275); // leave the intentionally short uncorrelated-pong quarantine
  const statuses = [];
  const signedOutPull = api.pull({ date: DAY, provider: 'all', includeHistory: false, onStatus: message => statuses.push(String(message)) });
  const ping2 = await waitForPost(h, 'mlsPing', h.posted.indexOf(schedule) + 1);
  reply(h, ping2, 'mlsPong', { ok: true, version: 'test' });
  const goto2 = await waitForPost(h, 'mlsAppGotoDate', h.posted.indexOf(ping2) + 1);
  reply(h, goto2, 'mlsAppGotoDateResult', { ok: true, schedDate: DAY });
  const schedule2 = await waitForPost(h, 'mlsAppPullSchedule', h.posted.indexOf(goto2) + 1);
  reply(h, schedule2, 'mlsAppScheduleResult', { ok: false, reason: 'no-athena-tab', error: 'not found' });
  const signedOut = await signedOutPull;
  assert.strictEqual(signedOut.athenaSigninRequired, true, 'proven Athena sign-out was not classified');
  assert(statuses.includes('Athena sign-in required. Sign in to athenaOne, then select Retry.'), 'proven Athena sign-out did not show exact Retry instruction');
  assert.strictEqual(api.isBusy(), false, 'terminal current response did not release locks');

  // Static ownership seams supplement the runtime adversarial cases above.
  assert(source.includes('owner.account === now.account && owner.epoch === now.epoch && owner.token === now.token'), 'owner check omits exact account/epoch/token');
  assert(source.includes('event.source === window && event.origin === expectedOrigin'), 'bridge omits exact source/origin');
  assert(source.includes('else if (!gotId || gotId !== requestId) return;'), 'correlated bridge accepts blank/mismatched IDs');
  assert(source.includes('delete window.__schedRaw') && source.includes('delete window.__mlsDayHistoryPull'), 'boundary does not purge ephemeral PHI');

  console.log('PASS P1 schedule importer session security: same-email/logout/account-switch awaits, spoofed origin/source, blank/mismatch/late IDs, cancellation purge, owned lease release, current import, and proven Athena sign-out');
})().catch(error => { console.error(error); process.exitCode = 1; });
