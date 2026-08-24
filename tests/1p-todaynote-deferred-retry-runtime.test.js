'use strict';

/* p1-todaynote-deferred-retry-2.0.0
 *
 * The old fixture drove the low-level history batch and expected its retired
 * OFF-mode date-scoped reader to run. Full Notes OFF is now schedule-only, and
 * Full Notes ON uses the all-visits body reader instead. This suite exercises
 * the live exported notes-idle/deferred-body lane instead: it is explicitly
 * gated by the Full Notes preference, keeps the patient/day binding, retries a
 * transient body refusal with the bounded queue ladder, and never persists
 * names, DOBs, MRNs, or reader text.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const importer = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');

const DAY = '2026-08-21';
const PATIENT = 'pt-1';
const PULL_IN_FLIGHT = 'pull-in-flight: another Athena read or schedule pull is active. Nothing started.';

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ---------------------------------------------------------------- static */
{
  const ni = importer.slice(importer.indexOf('/* ===== notes-idle-1.0.0'), importer.indexOf('/* ===== end notes-idle-1.0.0'));
  ok(ni.includes('function niEnqueue'), 'the notes-idle queue owner is missing');
  ok(ni.includes('function niReadNow'), 'the explicit one-row retry seam is missing');
  ok(ni.includes('function niTick'), 'the bounded idle tick seam is missing');
  ok(/visit-notes-off/.test(ni), 'the notes-idle lane has no Full Notes OFF gate');
  ok(/NI_MAX_ATTEMPTS/.test(ni) && /NI_BACKOFF_MS/.test(ni),
    'the notes-idle lane has no bounded retry ladder');
  ok(/patientId: r\.p, day: r\.d/.test(ni),
    'the test-visible notes-idle receipt does not expose only opaque patient/day bindings');
}

function makeHarness(options) {
  options = options || {};
  const store = new Map();
  const listeners = new Set();
  const elements = new Map();
  const timers = [];
  let timerSeq = 0;
  let leaseBusy = options.leaseBusy !== false;
  let outcomeAt = 0;
  const noteCalls = [];

  const patients = [{
    id: PATIENT,
    name: 'Synthetic Patient',
    dob: '01/02/1970',
    mrn: 'SYN-MRN-01',
    visits: []
  }];

  function fakeElement(tag, id) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(), id: id || '', style: {}, children: [],
      parentNode: null, onclick: null, textContent: '', classList: { contains: () => false },
      setAttribute(n, v) { this[n] = String(v); if (n === 'id') { this.id = String(v); elements.set(this.id, this); } },
      appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); if (c.id) elements.set(c.id, c); } return c; },
      remove() { if (this.id) elements.delete(this.id); if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
    };
    Object.defineProperty(node, 'innerHTML', {
      get() { return this._innerHTML || ''; },
      set(v) { this._innerHTML = String(v || ''); }
    });
    if (node.id) elements.set(node.id, node);
    return node;
  }
  const body = fakeElement('body'), head = fakeElement('head');

  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number,
    Boolean, RegExp, Error, TypeError, encodeURIComponent, decodeURIComponent, queueMicrotask,
    setTimeout(fn, ms) { const t = { id: ++timerSeq, fn, ms: Number(ms) || 0, canceled: false, fired: false }; timers.push(t); return t.id; },
    clearTimeout(id) { const t = timers.find(x => x.id === id); if (t) t.canceled = true; },
    setInterval: () => 1, clearInterval: () => {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    location: { pathname: '/1pScribeFlow.html' },
    localStorage: {
      getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)); },
      removeItem: k => { store.delete(String(k)); }
    },
    document: {
      readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => elements.get(String(id)) || null,
      createElement: t => fakeElement(t), addEventListener: () => {}, removeEventListener: () => {},
      body, head, documentElement: head
    },
    _calMode: 'day', _calRefDate: DAY, _calSelDay: '', _calAppts: [], _calProviders: [], _calMe: null,
    backendMode: () => false, bkToken: () => '', bkBase: () => 'https://local.invalid',
    uns: key => 'p1-defer-test::' + key,
    _acctTodayKey: () => DAY,
    _normDate: v => String(v || '').slice(0, 10),
    _normTime: v => String(v || ''),
    getPatients: () => patients,
    upsertPatient: p => { const at = patients.findIndex(x => x.id === p.id); if (at >= 0) patients[at] = p; else patients.push(p); },
    loadCalendar: () => Promise.resolve(),
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    __mlsBgSleep: () => Promise.resolve(),
    __mlsVisitNotesPref: {
      read: () => options.fullNotesOn === true
        ? { state: 'on', on: true, settled: true }
        : { state: 'off', on: false, settled: true },
      write: () => true, isPrefKey: () => false
    },
    __mlsP1AthenaReadLease: {
      version: 'fake-lease', busy: () => leaseBusy,
      claim: () => '', owns: () => false, touch: () => {}, release: () => {}, ready: () => true,
      state: () => ({ kind: leaseBusy ? 'p1-si-managed' : '', draining: leaseBusy, webHeld: false, deadlineAt: 0 })
    },
    __mlsVisitSavePref: {
      runForPatient(p, _onStatus, opts) {
        noteCalls.push({ patientId: p && p.id, onlyDate: opts && opts.onlyDate, leaseBusy });
        const outcomes = Array.isArray(options.outcomes) ? options.outcomes : [];
        const result = outcomes[outcomeAt++] || { ok: true, visits: 1 };
        return Promise.resolve(result);
      }
    },
    _athenaHistoryTargetSnapshot: () => null,
    _assistReadChart: () => Promise.resolve({ ok: true })
  };
  rt.window = rt;
  rt.addEventListener = (_type, fn) => listeners.add(fn);
  rt.removeEventListener = (_type, fn) => listeners.delete(fn);
  rt.dispatchEvent = () => true;
  rt.postMessage = msg => {
    if (!msg) return;
    queueMicrotask(() => {
      let ev = null;
      if (msg.type === 'mlsPing') {
        ev = { data: { source: 'mls-ext', type: 'mlsPong', id: msg.id || '', resp: { ok: true, version: '3.0.61' } } };
      } else if (msg.type === 'mlsAthenaPresence') {
        ev = { data: { source: 'mls-ext', type: 'mlsAthenaPresenceResult', resp: { athenaOpen: true, reason: 'presence-verified' } } };
      }
      if (ev) Array.from(listeners).forEach(fn => fn(ev));
    });
  };

  vm.runInNewContext(importer, rt, { filename: '1p-feat_mls_schedimport_exact.js', timeout: 5000 });
  return {
    rt, api: rt.__mlsSI, noteCalls,
    setLeaseBusy(v) { leaseBusy = !!v; },
    persisted() { return rt.localStorage.getItem('p1-defer-test::p1NotesIdleQueueV1'); }
  };
}

async function flush(turns = 20) {
  while (turns-- > 0) { await Promise.resolve(); await new Promise(r => setImmediate(r)); }
}

/* ---- 1. Full Notes OFF is schedule-only ------------------------------- */
async function testOffDoesNotReadBodies() {
  const h = makeHarness({ fullNotesOn: false });
  ok(h.api._notesIdleEnqueue(PATIENT, DAY, 'pull-in-flight'), 'OFF fixture did not accept a synthetic queued row');
  const result = await h.api.notesIdleReadNow();
  await flush();
  eq(h.noteCalls.length, 0, 'Full Notes OFF drove a visit-body read');
  eq(result, null, 'OFF gate returned a body-read result instead of pausing');
  const receipt = h.api._notesIdle();
  eq(receipt.gateReason, 'visit-notes-off', 'OFF gate did not name the schedule-only boundary');
  eq(receipt.queued, 1, 'OFF gate discarded queued work instead of preserving it for an explicit ON choice');
}

/* ---- 2. ON retries the exact patient/day after a transient refusal ----- */
async function testOnRetriesBoundedAndRecovers() {
  const h = makeHarness({ fullNotesOn: true, leaseBusy: false, outcomes: [
    { ok: false, reason: PULL_IN_FLIGHT },
    { ok: true, visits: 1 }
  ] });
  ok(h.api._notesIdleEnqueue(PATIENT, DAY, 'pull-in-flight'), 'ON fixture did not enqueue the exact patient/day');

  const first = await h.api.notesIdleReadNow();
  await flush();
  eq(first.ok, false, 'the transient first body refusal was not surfaced');
  eq(h.noteCalls.length, 1, 'the first ON body attempt did not run exactly once');
  eq(h.noteCalls[0].patientId, PATIENT, 'the first body attempt drifted to another patient');
  eq(h.noteCalls[0].onlyDate, DAY, 'the first body attempt lost its exact day binding');
  eq(h.api._notesIdle().queued, 1, 'a transient body refusal was not retained for bounded retry');
  eq(h.api._notesIdle().rows[0].attempts, 1, 'the first refusal did not consume exactly one attempt');

  const second = await h.api.notesIdleReadNow(); /* explicit force bypasses backoff for this deterministic test */
  await flush();
  eq(second.ok, true, 'the bounded ON retry did not recover the body read');
  eq(h.noteCalls.length, 2, 'the ON retry performed more than one follow-up attempt');
  ok(h.noteCalls.every(c => c.patientId === PATIENT && c.onlyDate === DAY),
    'the deferred retry changed patient or day scope');
  eq(h.api._notesIdle().read, 1, 'the recovered body was not marked read');
  eq(h.api._notesIdle().queued, 0, 'the recovered row remained queued');

  const raw = h.persisted();
  ok(raw, 'the ON queue state was not durably written');
  ok(!/Synthetic Patient|01\/02\/1970|SYN-MRN-01|Athena|chart|text/i.test(raw),
    'the durable/test-visible queue state contains patient demographics or reader text');
  const saved = JSON.parse(raw);
  ok(Array.isArray(saved.rows) && saved.rows.length === 1, 'the durable queue shape changed unexpectedly');
  ok(Object.keys(saved.rows[0]).every(k => ['p', 'd', 'a', 'c', 's', 'n'].includes(k)),
    'the durable queue row gained a non-PHI contract field');
}

/* ---- 3. lease busy is a gate, not an attempt/retry spin --------------- */
async function testBusyLeaseDoesNotSpin() {
  const h = makeHarness({ fullNotesOn: true, leaseBusy: true });
  ok(h.api._notesIdleEnqueue(PATIENT, DAY, 'pull-in-flight'), 'busy fixture did not enqueue the exact patient/day');
  for (let i = 0; i < 20; i++) {
    const result = await h.api.notesIdleReadNow();
    eq(result, null, 'a held lease started a body read on busy iteration ' + i);
  }
  await flush();
  eq(h.noteCalls.length, 0, 'a held lease caused a visit-body attempt');
  eq(h.api._notesIdle().queued, 1, 'a held lease discarded deferred work');
  eq(h.api._notesIdle().rows[0].attempts, 0, 'a held lease consumed retry budget without reading');
  eq(h.api._notesIdle().gateReason, 'pull-running', 'busy lease was not surfaced as pull-running');

  h.setLeaseBusy(false);
  const recovered = await h.api.notesIdleReadNow();
  await flush();
  eq(recovered.ok, true, 'the queued body did not run after the lease released');
  eq(h.noteCalls.length, 1, 'lease release caused more than one body attempt');
  eq(h.api._notesIdle().queued, 0, 'the queue did not drain after lease release');
}

async function main() {
  await testOffDoesNotReadBodies();
  await testOnRetriesBoundedAndRecovers();
  await testBusyLeaseDoesNotSpin();
  console.log('PASS 1p-todaynote-deferred-retry: ' + checks + ' checks - Full Notes OFF is schedule-only; explicit ON retries one exact patient/day through the bounded notes-idle body lane; busy leases never consume retry budget or spin; durable queue state is PHI-free');
}

const watchdog = setTimeout(() => {
  console.error(new Error('1p-todaynote-deferred-retry runtime test did not finish'));
  process.exit(1);
}, 10000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
