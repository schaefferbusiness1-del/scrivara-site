'use strict';
/*
 * AVATAR — DOCTOR SIDE (av-1.0.0)
 * -----------------------------------------------------------------------------
 * The doctor-side module of the patient-facing check-in interviewer. Claims
 * proved here, executed in a VM where it matters:
 *
 * - No permanent polling: no setInterval anywhere; the badge refresh is
 *   event-driven with a 2-minute floor between refocus fetches.
 * - Chart linking fails CLOSED: zero or two matching charts resolve to null
 *   (the import/open buttons disable rather than guess).
 * - Importing the summary is IDEMPOTENT: the provenance stamp guards a second
 *   import of the same check-in, and the append preserves the existing summary.
 * - Loader: exactly one cache-tagged loader in mls-connect.js, idle-deferred.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_avatar.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

assert(source.includes("var VERSION = 'av-1.1.0'"), 'version token moved without updating this contract');
/* av-1.1.0: a failed config GET must render the error notice, never an
   editable empty form (one Save from that state wiped the real questions). */
assert(source.includes('nothing is shown so nothing can be overwritten'), 'the setup fail-closed guard was removed');
assert(!source.includes('setInterval('), 'no permanent polling in the Avatar module');
assert(!source.includes('MutationObserver'), 'no document-wide observers in the Avatar module');
assert(source.includes("REFRESH_MIN_MS = 120000"), 'the refocus refresh floor was removed');
assert(/visibilitychange/.test(source), 'the tab-refocus refresh path was removed');
assert(!/postMessage|mlsApp(Read|Write|Pull)|runPull|pullSchedule/.test(source), 'the Avatar module must have no bridge/Athena path');

const marker = "feat_mls_avatar.js?v=20260805av110";
assert(connect.indexOf(marker) >= 0, 'mls-connect.js is missing the av110 loader');
assert.strictEqual(connect.split(marker).length - 1, 1, 'duplicate Avatar loaders');
const loaderLine = connect.slice(connect.indexOf(marker) - 400, connect.indexOf(marker) + 100);
assert(/requestIdleCallback/.test(loaderLine), 'the Avatar loader must stay idle-deferred');

/* ---- VM runtime ---- */
function build(patients) {
  const fetchCalls = [];
  const timers = [];
  const window = {
    addEventListener() {}, removeEventListener() {},
    getPatients: () => patients,
    upsertPatient: null, // set per test
    toast() {},
    bkToken: () => 'tok',
    bkBase: () => 'https://backend.test',
    fetch: null
  };
  const elementStub = () => ({
    id: '', className: '', textContent: '', innerHTML: '', style: {}, type: '', title: '',
    children: [], disabled: false,
    appendChild() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {} }
  });
  const document = {
    readyState: 'complete',
    hidden: false,
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    createElement: elementStub,
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { appendChild() {} }
  };
  const context = {
    window, document, console,
    fetch: (url, opts) => { fetchCalls.push({ url, opts }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, checkins: [] }) }); },
    setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, 0); },
    clearTimeout,
    Date, Math, JSON, Promise, Array, Object, String, Number, Buffer
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'feat_mls_avatar.js' });
  return { window, fetchCalls, timers };
}

const P1 = { id: 'ext-9', name: 'Exact Patient', summary: 'Existing history.' };

(async function main() {
  // fail-closed chart resolution
  {
    const { window } = build([P1, { id: 'other', name: 'Other' }]);
    assert.strictEqual(window.__mlsAvatar.version, 'av-1.1.0');
    assert.strictEqual(window.__mlsAvatar.exactPatient('ext-9').name, 'Exact Patient');
    assert.strictEqual(window.__mlsAvatar.exactPatient('missing'), null, 'unknown id resolves to null');
    const dup = build([{ id: 'dup-1', name: 'A' }, { id: 'dup-1', name: 'B' }]).window;
    assert.strictEqual(dup.__mlsAvatar.exactPatient('dup-1'), null, 'two matches fail closed');
  }

  // idempotent import with provenance stamp — success is only claimed after
  // the STORE proves it (verify-read-back), and the store object is never
  // mutated before the save.
  {
    const patient = { id: 'ext-9', name: 'Exact Patient', summary: 'Existing history.' };
    const { window } = build([patient]);
    const saved = [];
    // a REAL upsert applies the row into the store (that is what the app's does)
    window.upsertPatient = (p) => { saved.push(JSON.parse(JSON.stringify(p))); patient.summary = p.summary; };
    const checkin = { id: 5, patient_external_id: 'ext-9', ready_at: '2026-08-05 15:00:00', summary: 'Patient reports knee pain 4/10.' };
    const btn1 = { disabled: false, textContent: '' };
    window.__mlsAvatar.importSummary(checkin, btn1);
    assert.strictEqual(saved.length, 1, 'first import saves once');
    assert(saved[0].summary.startsWith('Existing history.'), 'the existing summary is preserved');
    assert(/\[Avatar check-in #5 — completed .*\]/.test(saved[0].summary), 'the stamp is present and unique per check-in');
    assert(/knee pain 4\/10/.test(saved[0].summary));
    assert.match(btn1.textContent, /Added to chart/);
    const btn2 = { disabled: false, textContent: '' };
    window.__mlsAvatar.importSummary(checkin, btn2);
    assert.strictEqual(saved.length, 1, 'second import is refused by the stamp guard');
    assert.strictEqual(btn2.disabled, true);
    assert.match(btn2.textContent, /Already in chart/);
  }

  // a DEAD save must never claim success and must not poison the store object:
  // the 1.0.0 defect stamped the memoized patient BEFORE saving, so a failed
  // upsert reported "Already in chart" forever while nothing was persisted.
  {
    const patient = { id: 'ext-9', name: 'Exact Patient', summary: 'Existing history.' };
    const { window } = build([patient]);
    window.upsertPatient = () => {}; // swallows the write — persists nothing
    const checkin = { id: 6, patient_external_id: 'ext-9', ready_at: '2026-08-05 15:10:00', summary: 'Patient reports numbness.' };
    const btn = { disabled: false, textContent: '' };
    window.__mlsAvatar.importSummary(checkin, btn);
    assert.match(btn.textContent, /Could not save/, 'a dead save must report failure, never success');
    assert.strictEqual(btn.disabled, false, 'the button stays usable for a retry');
    assert.strictEqual(patient.summary, 'Existing history.', 'the store object is never mutated before a confirmed save');
    const btn3 = { disabled: false, textContent: '' };
    window.__mlsAvatar.importSummary(checkin, btn3);
    assert.match(btn3.textContent, /Could not save/, 'a retry is NOT lied to with "Already in chart"');
  }

  console.log('PASS Avatar doctor side: no polling, fail-closed chart match, idempotent stamped import, one idle-deferred loader');
})().catch(e => { console.error(e); process.exit(1); });
