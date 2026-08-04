'use strict';

/* wf2-2.0.0 (owner directive 2026-07-20): when a write probe refuses because
 * the exact patient/encounter is not open in Athena, MLS must reach the
 * destination on its own — drive the extension's proven SearchOpen verb with
 * the frozen identity + appointment id + schedule date, then re-run the SAME
 * action once from the top (fresh probe). Contract pinned here:
 *   - trigger ONLY on probe reasons context-unverified / context-mismatch;
 *   - exactly ONE auto-open attempt (the retry carries __autoOpened);
 *   - the SearchOpen message carries name, dob, mrn, appointmentId, and the
 *     YYYY-MM-DD schedule date;
 *   - a failed open surfaces honestly and changes nothing;
 *   - identity/token/tab failures never auto-open;
 *   - a verified re-probe proceeds to the normal one-click confirm (the human
 *     review step is untouched).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');

function makeHarness() {
  const posted = [];
  const listeners = [];
  const toasts = [];
  const store = new Map();
  const elementStub = () => ({
    style: {}, dataset: {}, setAttribute: () => {}, getAttribute: () => null, removeAttribute: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, appendChild: () => {}, remove: () => {},
    querySelector: () => elementStub(), querySelectorAll: () => [], classList: { add: () => {}, remove: () => {}, contains: () => false },
    textContent: '', innerHTML: '', nodeType: 1
  });
  const document = {
    readyState: 'complete',
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null,
    createElement: elementStub,
    body: elementStub(), head: elementStub(), documentElement: elementStub()
  };
  const window = {
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage: (msg) => posted.push(msg),
    location: { origin: 'https://mlsscribe.com', search: '', href: 'https://mlsscribe.com/ScribeFlow.html' },
    document,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    uns: n => 'acct:' + n,
    toast: (m, k) => toasts.push({ m: String(m), k: String(k || '') }),
    _calAppts: []
  };
  window.window = window;
  const context = vm.createContext({
    window, document,
    localStorage: window.localStorage,
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: () => 1, clearTimeout: () => {},
    MutationObserver: function () { return { observe: () => {}, disconnect: () => {} }; },
    console
  });
  vm.runInContext(src, context, { filename: 'feat_mls_writeflow.js' });
  const wf = context.window.__mlsWriteFlow;
  assert(wf && wf.installed && wf.version === 'wf3-1.0.0', 'writeflow failed to install as wf3-1.0.0');
  const tick = () => new Promise(r => setImmediate(r));
  async function settle(n) { for (let i = 0; i < (n || 6); i++) await tick(); }
  function deliver(data) { listeners.slice().forEach(fn => { try { fn({ data }); } catch (e) {} }); }
  return { wf, posted, deliver, settle, toasts };
}

const OPTS = {
  patient: { patientId: 'mr85n5sdkd6o', name: 'Adam J Schaeffer', dob: '03/24/2006', mrn: '7833832' },
  sections: [{ key: 'note', text: 'Reviewed test note body for the auto-open contract.' }],
  expectedContext: { visitDate: '2026-06-20', provider: 'Michael Schaeffer', appointmentId: '52585999' }
};

async function run(scenario) {
  const h = makeHarness();
  const done = h.wf.startAthenaAction('write_note', Object.assign({}, OPTS, scenario.opts || {}));
  await h.settle();
  const probe1 = h.posted.find(m => m.type === 'mlsAppAthenaActionV2');
  assert(probe1 && probe1.mode === 'probe', scenario.name + ': first probe missing');
  h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probe1.requestId, resp: scenario.probe1 });
  await h.settle();
  return { h, probe1, done };
}

(async () => {
// 1. context-unverified → exactly one SearchOpen with the frozen identity,
//    then a successful open → a SECOND fresh probe; a verified re-probe stops
//    at the confirm stage (no execute without the human click).
{
  const { h, probe1 } = await (async () => {
    const r = await run({ name: 'happy', probe1: { ok: false, blocked: true, reason: 'context-unverified' } });
    const open = r.h.posted.find(m => m.type === 'mlsAppSearchOpenPatient');
    assert(open, 'happy: auto-open message missing');
    assert.strictEqual(open.name, 'Adam J Schaeffer', 'happy: open lost the name');
    assert.strictEqual(open.dob, '03/24/2006', 'happy: open lost the dob');
    assert.strictEqual(open.mrn, '7833832', 'happy: open lost the mrn');
    assert.strictEqual(open.appointmentId, '52585999', 'happy: open lost the appointment id');
    assert.strictEqual(open.scheduleDate, '2026-06-20', 'happy: open lost the YYYY-MM-DD schedule date');
    r.h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: open.requestId, resp: { ok: true, complete: true, requestId: open.requestId } });
    await r.h.settle();
    const probes = r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2');
    assert.strictEqual(probes.length, 2, 'happy: expected exactly a second fresh probe, got ' + probes.length);
    assert.notStrictEqual(probes[1].requestId, probes[0].requestId, 'happy: the re-probe must be fresh');
    r.h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probes[1].requestId, resp: { ok: true, mode: 'probe', action: 'write_note', readOnly: true, actionToken: 'tok-1', context: { patientName: 'Adam J Schaeffer' } } });
    await r.h.settle();
    const executes = r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute');
    assert.strictEqual(executes.length, 0, 'happy: execute must wait for the human confirm click');
    return r;
  })();
  const opens = h.posted.filter(m => m.type === 'mlsAppSearchOpenPatient');
  assert.strictEqual(opens.length, 1, 'happy: exactly one auto-open attempt allowed');
}

// 2. The retry never auto-opens again: a second context-unverified surfaces honestly.
{
  const r = await run({ name: 'loop-guard', probe1: { ok: false, blocked: true, reason: 'context-unverified' } });
  const open = r.h.posted.find(m => m.type === 'mlsAppSearchOpenPatient');
  r.h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: open.requestId, resp: { ok: true, requestId: open.requestId } });
  await r.h.settle();
  const probes = r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2');
  r.h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probes[1].requestId, resp: { ok: false, blocked: true, reason: 'context-unverified', error: 'Could not identify one exact patient encounter frame.' } });
  await r.h.settle();
  assert.strictEqual(r.h.posted.filter(m => m.type === 'mlsAppSearchOpenPatient').length, 1, 'loop-guard: a failed re-probe must not open again');
  assert(r.h.toasts.some(t => /could not identify|not open|encounter/i.test(t.m)), 'loop-guard: the final failure must surface honestly');
}

// 3. A failed open surfaces honestly and never re-probes.
{
  const r = await run({ name: 'open-fails', probe1: { ok: false, blocked: true, reason: 'context-mismatch' } });
  const open = r.h.posted.find(m => m.type === 'mlsAppSearchOpenPatient');
  assert(open, 'open-fails: mismatch must also try the auto-open');
  r.h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: open.requestId, resp: { ok: false, reason: 'open-failed', error: 'No matching search result.', requestId: open.requestId } });
  await r.h.settle();
  assert.strictEqual(r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2').length, 1, 'open-fails: no re-probe after a failed open');
  assert(r.h.toasts.some(t => /could not open Adam J Schaeffer in Athena on its own/i.test(t.m)), 'open-fails: honest failure text missing');
}

// 4. Non-openable refusals (token/tab/identity) never auto-open.
for (const reason of ['token-sender-mismatch', 'no-athena-tab', 'patient-mismatch', 'athena-tab-mismatch']) {
  const r = await run({ name: reason, probe1: { ok: false, blocked: true, reason } });
  assert.strictEqual(r.h.posted.filter(m => m.type === 'mlsAppSearchOpenPatient').length, 0, reason + ': must not auto-open');
}

// 5. opts.autoOpen === false disables the behavior entirely.
{
  const r = await run({ name: 'opt-out', probe1: { ok: false, blocked: true, reason: 'context-unverified' }, opts: { autoOpen: false } });
  assert.strictEqual(r.h.posted.filter(m => m.type === 'mlsAppSearchOpenPatient').length, 0, 'opt-out: autoOpen:false must disable the auto-open');
}

console.log('PASS writeflow auto-open: unopened destinations are reached via one SearchOpen with the frozen identity + schedule date, re-probed exactly once, honest on failure, never on identity/token refusals, and the human confirm click is untouched');
})().catch((err) => { console.error(err); process.exit(1); });
