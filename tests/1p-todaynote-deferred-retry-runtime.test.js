'use strict';

/* p1-todaynote-deferred-retry-1.0.0
 *
 * Owner report 2026-08-16 (day 2026-08-21, ext 3.0.61): schedule 6/6, roster
 * complete, history 6/6 processed - and todayNoteFailures:6, every one
 * "pull-in-flight: another Athena read or schedule pull is active. Nothing
 * started." The today-note reads were launched while the day pull still held
 * the Athena lease. p1-lease-loan-1.0.0 removed the cause; the fuse was still
 * too narrow, so all six were attempt-once and terminal.
 *
 * This executes the REAL 1p importer's history batch against a FAKE lease that
 * is busy during the batch and free afterwards. Synthetic names/DOB/MRN only;
 * no network, no extension, no PHI. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const importer = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');

const DAY = '2026-08-21';
const PULL_IN_FLIGHT = 'pull-in-flight: another Athena read or schedule pull is active. Nothing started.';
const ROWS = 6;

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ---------------------------------------------------------------- static */
{
  const a = importer.indexOf('/* ===== p1-todaynote-deferred-retry-1.0.0 =====');
  const b = importer.indexOf('/* ===== end p1-todaynote-deferred-retry-1.0.0 ===== */');
  ok(a >= 0 && b > a, 'the p1-todaynote-deferred-retry-1.0.0 block is missing or unclosed');
  const block = importer.slice(a, b);
  ok(/setTimeout\(/.test(block) && !/requestAnimationFrame/.test(block),
    'the deferred round is not setTimeout-based (rAF never fires in a hidden tab)');
  ok(/TN_DEFER_LEASE_WAITS/.test(block), 'the deferred round has no bounded wait budget');
  ok(!/claim\(|release\(/.test(block), 'the deferred round touches lease claim/release - it must not');
}

/* ---------------------------------------------------------------- runtime */
function makeHarness(options) {
  options = options || {};
  const store = new Map();
  const listeners = new Set();
  const elements = new Map();
  const timers = [];
  let timerSeq = 0;
  let leaseBusy = true;
  const noteCalls = [];

  const patients = Array.from({ length: ROWS }, (_, i) => ({
    id: 'pt-' + (i + 1),
    name: 'Synthetic Row ' + String(i + 1).padStart(2, '0'),
    dob: '01/0' + (i + 1) + '/1970',
    mrn: 'SYN-MRN-' + String(i + 1).padStart(2, '0'),
    visits: []
  }));
  const rows = patients.map((p, i) => ({
    _mlsTargetPatientId: p.id, patient_external_id: p.id,
    name: p.name, dob: p.dob, mrn: p.mrn,
    athenaAppointmentId: 'appt-' + DAY + '-' + (i + 1),
    appointmentId: 'appt-' + DAY + '-' + (i + 1),
    date: DAY, scheduleDate: DAY,
    start_local: '08:0' + i, time: '08:0' + i, reason: 'Deferred note test'
  }));

  function fakeElement(tag, id) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(), id: id || '', style: {}, children: [],
      parentNode: null, onclick: null, textContent: '',
      setAttribute(n, v) { this[n] = String(v); if (n === 'id') { this.id = String(v); elements.set(this.id, this); } },
      appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); if (c.id) elements.set(c.id, c); } return c; },
      remove() { if (this.id) elements.delete(this.id); if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
    };
    Object.defineProperty(node, 'innerHTML', {
      get() { return this._innerHTML || ''; },
      set(v) { this._innerHTML = String(v || ''); for (const m of this._innerHTML.matchAll(/\bid="([^"]+)"/g)) this.appendChild(fakeElement('button', m[1])); }
    });
    if (node.id) elements.set(node.id, node);
    return node;
  }
  const body = fakeElement('body'), head = fakeElement('head');

  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number,
    Boolean, RegExp, Error, TypeError, encodeURIComponent, decodeURIComponent, queueMicrotask,
    /* a controllable clock so the bounded deferred ladder is measurable */
    setTimeout(fn, ms) { const t = { id: ++timerSeq, fn, ms: Number(ms) || 0, canceled: false }; timers.push(t); return t.id; },
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
    _normDate: v => String(v || '').slice(0, 10),
    _normTime: v => String(v || ''),
    getPatients: () => patients,
    upsertPatient: p => { const at = patients.findIndex(x => x.id === p.id); if (at >= 0) patients[at] = p; else patients.push(p); },
    loadCalendar: () => Promise.resolve(),
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    __mlsBgSleep: () => Promise.resolve(),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    /* the visits preference: OFF, which is the lane the today-note pass serves */
    __mlsVisitNotesPref: { read: () => ({ state: 'off', on: false, settled: true }), write: () => true, isPrefKey: () => false },
    /* the single-owner Athena read lease, faked: BUSY during the batch */
    __mlsP1AthenaReadLease: {
      version: 'fake-lease', busy: () => leaseBusy,
      claim: () => '', owns: () => false, touch: () => {}, release: () => {}, ready: () => true,
      state: () => ({ kind: leaseBusy ? 'p1-si-managed' : '', draining: leaseBusy, webHeld: false, deadlineAt: 0 })
    },
    /* the today-note reader: refuses with pull-in-flight while the lease is
       held, succeeds once it is free - exactly the live shape. */
    __mlsVisitSavePref: {
      runForPatient(p, _onStatus, opts) {
        noteCalls.push({ patientId: p && p.id, onlyDate: opts && opts.onlyDate, leaseBusy });
        if (leaseBusy) return Promise.resolve({ ok: false, reason: PULL_IN_FLIGHT });
        if (options.deferredAlsoFails) return Promise.resolve({ ok: false, reason: 'scoped-read-unverified' });
        return Promise.resolve({ ok: true, visits: 1 });
      }
    },
    _athenaHistoryTargetSnapshot(ref) {
      const p = patients.find(x => String(x.id) === String(ref && ref.patientId));
      if (!p) return null;
      return Object.freeze({ patientId: p.id, name: p.name, dob: p.dob, mrn: p.mrn,
        appointmentId: String((ref && ref.appointmentId) || ''), scheduleDate: String((ref && ref.scheduleDate) || '') });
    },
    _assistReadChart(target) {
      return Promise.resolve({ ok: true, chartName: target.name, chartDob: target.dob, chartMrn: target.mrn,
        text: 'Synthetic chart for ' + target.name, sections: {} });
    }
  };
  rt.window = rt;
  rt.addEventListener = (_t, fn) => listeners.add(fn);
  rt.removeEventListener = (_t, fn) => listeners.delete(fn);
  rt.dispatchEvent = () => true;
  rt.postMessage = msg => {
    if (msg && msg.type === 'mlsPing') queueMicrotask(() => {
      const ev = { data: { source: 'mls-ext', type: 'mlsPong', id: msg.id || '', resp: { ok: true, version: '3.0.61' } } };
      Array.from(listeners).forEach(fn => fn(ev));
    });
  };

  vm.runInNewContext(importer, rt, { filename: '1p-feat_mls_schedimport_exact.js', timeout: 5000 });

  function pendingTimers() { return timers.filter(t => !t.canceled && !t.fired); }
  function runDueTimers(max) {
    let ran = 0;
    for (let guard = 0; guard < (max == null ? 50 : max); guard++) {
      const t = timers.find(x => !x.canceled && !x.fired);
      if (!t) break;
      t.fired = true; ran++;
      try { t.fn(); } catch (e) {}
    }
    return ran;
  }
  return { rt, api: rt.__mlsSI, rows, patients, noteCalls, pendingTimers, runDueTimers,
    setLeaseBusy(v) { leaseBusy = !!v; }, timers };
}

async function flush(turns = 60) { while (turns-- > 0) { await Promise.resolve(); await new Promise(r => setImmediate(r)); } }

/* ---- 1. six pull-in-flight refusals are DEFERRED, then recovered --------- */
async function testDeferredRoundRecoversTheDay() {
  const h = makeHarness();
  const receipt = await h.api._runHistoryBatch(h.rows, [], () => {});
  ok(receipt && Array.isArray(receipt.patients) && receipt.patients.length === ROWS,
    'the history batch did not reach all ' + ROWS + ' synthetic rows (got ' +
    ((receipt && receipt.patients && receipt.patients.length) || 0) + ')');
  const refused = receipt.patients.filter(p => p && p.todayNote === false);
  eq(refused.length, ROWS, 'the fixture did not reproduce six refused today-note reads');
  ok(refused.every(p => /pull-in-flight/.test(String(p.todayNoteReason || ''))),
    'the refusals were not the pull-in-flight class the owner reported');
  eq(receipt.todayNoteFailures, ROWS, 'the receipt did not aggregate the six refusals');

  /* every refused row is QUEUED, not terminal */
  const q0 = h.api._todayNoteDeferred();
  eq(q0.queued, ROWS, 'a pull-in-flight refusal was still treated as terminal instead of deferred');
  ok(receipt.todayNoteDeferred && receipt.todayNoteDeferred.queued === ROWS,
    'the receipt does not state how many rows were deferred');

  /* the lease is released when the pull ends; drive the round */
  h.setLeaseBusy(false);
  const before = h.noteCalls.length;
  await h.api._runDeferredTodayNotes();
  await flush();

  eq(h.noteCalls.length - before, ROWS, 'the deferred round did not re-run exactly the six deferred rows');
  ok(h.noteCalls.slice(before).every(c => c.onlyDate === DAY),
    'a deferred re-run drifted off the pulled day');
  eq(receipt.patients.filter(p => p && p.todayNote === true).length, ROWS,
    'the deferred round did not recover every today-note read');
  eq(receipt.todayNoteFailures, 0,
    'a fully recovered day still reports today-note failures');
  eq(Object.keys(receipt.todayNoteReasons || {}).length, 0,
    'a fully recovered day still carries today-note failure reasons');
  eq(receipt.todayNoteDeferred.recovered, ROWS, 'the deferred receipt did not count the recovery');
  eq(receipt.todayNoteDeferred.remaining, 0, 'the deferred receipt still reports remaining failures');
  eq(h.api._todayNoteDeferred().queued, 0, 'the deferred queue was not drained');

  /* the persisted day ledger moved with it */
  const ledgerRaw = h.rt.localStorage.getItem('p1-defer-test::schedImportIndexV1::' + DAY);
  ok(ledgerRaw, 'the day ledger was never written');
  const ledger = JSON.parse(ledgerRaw);
  ok(ledger.history, 'the day ledger holds no history verdict');
  eq(Number(ledger.history.todayNoteFailures), 0,
    'the persisted day ledger still records the six today-note failures after full recovery');
  eq(Object.keys(ledger.history.todayNoteRefused || {}).length, 0,
    'the persisted day ledger still names refused patients after full recovery');
  eq(Number(ledger.history.todayNoteDeferred && ledger.history.todayNoteDeferred.recovered), ROWS,
    'the persisted day ledger does not record what the deferred round recovered');
}

/* ---- 2. exactly ONE deferred attempt per row ---------------------------- */
async function testAttemptOncePerRow() {
  const h = makeHarness({ deferredAlsoFails: true });
  const receipt = await h.api._runHistoryBatch(h.rows, [], () => {});
  eq(h.api._todayNoteDeferred().queued, ROWS, 'the failing-deferral fixture did not queue');
  h.setLeaseBusy(false);
  const before = h.noteCalls.length;
  await h.api._runDeferredTodayNotes();
  await flush();
  eq(h.noteCalls.length - before, ROWS, 'the deferred round did not run once per row');
  eq(h.api._todayNoteDeferred().queued, 0, 'a failed deferred attempt was re-queued for another round');
  await h.api._runDeferredTodayNotes();
  await flush();
  eq(h.noteCalls.length - before, ROWS, 'a second deferred round re-read rows that already had their one attempt');
  eq(receipt.todayNoteFailures, ROWS, 'a deferred attempt that failed was reported as a recovery');
  ok(Object.keys(receipt.todayNoteReasons || {}).indexOf('scoped-read-unverified') >= 0,
    'the deferred failure reason did not replace the pull-in-flight placeholder');
}

/* ---- 3. a lease that never frees is bounded, never a busy loop ---------- */
async function testNeverFreeLeaseIsBounded() {
  const h = makeHarness();
  const receipt = await h.api._runHistoryBatch(h.rows, [], () => {});
  eq(h.api._todayNoteDeferred().queued, ROWS, 'the never-free fixture did not queue');
  /* lease stays BUSY. Drive the round repeatedly; it must re-arm a bounded
     number of times and then drop the queue instead of spinning. */
  let rounds = 0;
  for (let i = 0; i < 20 && h.api._todayNoteDeferred().queued > 0; i++) {
    rounds++;
    await h.api._runDeferredTodayNotes();
    await flush(4);
  }
  eq(h.api._todayNoteDeferred().queued, 0, 'the deferred queue never drained against a permanently held lease');
  ok(rounds <= 7, 'the bounded wait took ' + rounds + ' rounds - the budget is 5 re-arms plus the drop');
  eq(h.noteCalls.filter(c => c.leaseBusy === false).length, 0,
    'a deferred read ran while the Athena lease was still held');
  eq(receipt.todayNoteFailures, ROWS, 'a dropped queue must still report its failures honestly');
  eq(receipt.todayNoteDeferred.reason, 'lease-still-held',
    'the receipt does not name why the deferred round could not run');
}

/* ---- 4. only pull-in-flight defers; other reasons stay terminal --------- */
async function testOnlyPullInFlightDefers() {
  const h = makeHarness();
  h.rt.__mlsVisitSavePref.runForPatient = () => Promise.resolve({ ok: false, reason: 'identity-mismatch' });
  const receipt = await h.api._runHistoryBatch(h.rows, [], () => {});
  eq(receipt.todayNoteFailures, ROWS, 'the identity-mismatch fixture did not fail');
  eq(h.api._todayNoteDeferred().queued, 0,
    'a non-pull-in-flight refusal was queued for a deferred retry - the class must stay narrow');
}

async function main() {
  await testDeferredRoundRecoversTheDay();
  await testAttemptOncePerRow();
  await testNeverFreeLeaseIsBounded();
  await testOnlyPullInFlightDefers();
  console.log('PASS 1p-todaynote-deferred-retry: ' + checks + ' checks - a pull-in-flight today-note refusal is a DEFERRED class that gets exactly one re-run after the pull releases the Athena lease; a fully recovered day reports zero today-note failures in the receipt AND in the persisted day ledger; a permanently held lease drops the queue after a bounded ladder without ever reading under a live lease; and no other refusal class defers');
}

const watchdog = setTimeout(() => {
  console.error(new Error('1p-todaynote-deferred-retry runtime test did not finish'));
  process.exit(1);
}, 30000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
