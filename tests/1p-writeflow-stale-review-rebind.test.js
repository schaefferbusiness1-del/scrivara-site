'use strict';

/* srr-1.0.0 — a stale unbound review rebinds itself when the pull lands.
 *
 * Live incident 2026-08-18: the owner opened an Athena review BEFORE the
 * day's schedule pull; every write row painted CANNOT SEND ("no appointment
 * id is bound to this encounter") and the sheet stayed that way after the
 * pull succeeded — blocked rows never probe, so no code path re-resolved
 * until a human pressed "Check Athena again". A fresh manifest for the same
 * patient bound immediately (14/14 measured).
 *
 * This suite drives the REAL fork in a VM: opens a review with an empty day
 * ledger (unbound), proves the srr poller armed; seeds the ledger the way a
 * successful pull does; fires the poller tick; and proves the sheet rebuilt
 * through the reopen path with the id bound — plus the negative: a review
 * that opens BOUND never arms the poller.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- source pins ---- */
ok(/state\.reopenOpts = reopenOptions\(opts, manifest\);\s*\n\s*srrArmIfUnbound\(state\); \/\* srr-1\.0\.0 \*\//.test(src),
  'srrArmIfUnbound must arm right after reopenOpts is built');
ok(/ticks > 60\) \{ clearInterval\(timer\); return; \}/.test(src), 'the poller must cap at 60 ticks (5 minutes)');
const tickBody = src.slice(src.indexOf('/* srr-1.0.0'), src.indexOf('function renderUnifiedOrderSummary'));
ok(tickBody.indexOf('clearInterval(timer);') < tickBody.indexOf('openUnifiedConfirmation(state.reopenOpts)'),
  'the poller must disarm BEFORE reopening — one reopen, ever');
ok(/no bridge, no Athena, no network/.test(tickBody), 'the poller documents its local-only contract');

/* ---- VM harness (same shape as the resolution suite) ---- */
const DAY = '2026-08-18';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-srr-pid', patientId: 'syn-srr-pid', name: 'Synthetic Patient Srr', dob: '01/02/1980', mrn: '100002' };
const CAL_ROW = {
  id: 'cal-row-srr', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z', status: 'booked'
};

function makeContext() {
  const store = new Map();
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    _store: store
  };
  const byId = new Map();
  function resolveId(sel) {
    const key = String(sel || '').replace(/^#/, '');
    if (!byId.has(key)) byId.set(key, elementStub());
    return byId.get(key);
  }
  function elementStub() {
    const el = {
      style: {}, dataset: {}, attrs: {}, children: [],
      setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return el.attrs[k] != null ? el.attrs[k] : null; }, removeAttribute(k) { delete el.attrs[k]; },
      addEventListener() {}, removeEventListener() {}, appendChild(c) { el.children.push(c); return c; }, insertBefore(c) { el.children.push(c); return c; }, remove() {}, focus() {}, click() {}, select() {},
      querySelector(sel) { return String(sel || '').charAt(0) === '#' ? resolveId(sel) : null; }, querySelectorAll: () => [], closest: () => null,
      classList: { add() {}, remove() {}, contains() { return false; } },
      textContent: '', innerHTML: '', value: '', disabled: false
    };
    return el;
  }
  const document = {
    readyState: 'complete', activeElement: null,
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return String(sel || '').charAt(0) === '#' ? resolveId(sel) : null; }, querySelectorAll: () => [],
    getElementById(id) { return resolveId(id); },
    createElement: elementStub,
    body: elementStub(), head: elementStub(), documentElement: elementStub(),
    execCommand() { return false; }
  };
  const toasts = [];
  const intervals = [];
  const window = {
    _calAppts: [CAL_ROW],
    uns: n => `acct:${n}`,
    addEventListener() {}, removeEventListener() {},
    document, localStorage,
    location: { origin: 'https://mlsscribe.com' },
    postMessage() {},
    toast: (msg) => { toasts.push(String(msg)); }
  };
  window.window = window;
  const ctx = vm.createContext({
    window, document, localStorage,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: (id) => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout: () => 1, clearTimeout: () => {},
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    console
  });
  return { ctx, window, toasts, intervals, localStorage };
}

function srrPollers(intervals) {
  return intervals.filter(i => i.ms === 5000 && /rebinding this review/.test(String(i.fn)));
}

/* ---- 1. unbound open arms the poller; the tick without a ledger does nothing ---- */
{
  const h = makeContext();
  vm.runInContext(src, h.ctx, { filename: '1p-feat_mls_writeflow.js' });
  const wf = h.window.__mlsWriteFlow;
  ok(wf && wf.installed, 'writeflow installed in the VM');
  try { wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: 'probe body' }] }); } catch (e) {
    assert.fail('openUnifiedConfirmation threw in the harness: ' + (e && e.message));
  }
  const pollers = srrPollers(h.intervals);
  ok(pollers.length === 1, 'an UNBOUND review must arm exactly one srr poller (got ' + pollers.length + ')');
  pollers[0].fn();
  ok(!pollers[0].cleared, 'a tick with no resolvable id must keep polling');
  ok(!h.toasts.some(t => /rebinding/.test(t)), 'no rebind claim before the ledger can resolve');

  /* ---- 2. seed the ledger the way a pull does, fire the tick: rebind ---- */
  h.localStorage.setItem('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {
    'appointment-id:70000042': { state: 'done', patientId: PATIENT.patientId, backendAppointmentId: CAL_ROW.id, appt_date: DAY }
  } }));
  pollers[0].fn();
  ok(pollers[0].cleared === true, 'the poller must disarm on the tick that rebinds');
  ok(h.toasts.some(t => /rebinding this review/.test(t)), 'the rebind must be announced');
  const after = srrPollers(h.intervals);
  ok(after.length === 1, 'the rebuilt (now bound) review must NOT arm a second poller (got ' + after.length + ')');
}

/* ---- 3. a review that opens BOUND never arms the poller ---- */
{
  const h = makeContext();
  h.localStorage.setItem('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {
    'appointment-id:70000042': { state: 'done', patientId: PATIENT.patientId, backendAppointmentId: CAL_ROW.id, appt_date: DAY }
  } }));
  vm.runInContext(src, h.ctx, { filename: '1p-feat_mls_writeflow.js' });
  const wf = h.window.__mlsWriteFlow;
  try { wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: 'probe body' }] }); } catch (e) {
    assert.fail('bound open threw: ' + (e && e.message));
  }
  ok(srrPollers(h.intervals).length === 0, 'a BOUND review must not arm the poller');
}

console.log('PASS 1p writeflow stale-review rebind: ' + checks + ' checks — unbound sheets poll the local resolver, rebind once through the reopen path when the pull lands, and bound sheets never poll');
