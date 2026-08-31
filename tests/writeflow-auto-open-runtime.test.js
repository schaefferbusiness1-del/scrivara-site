'use strict';

/* wf2-2.0.0 (owner directive 2026-07-20): when a write probe refuses because
 * the exact patient/encounter is not open in Athena, MLS must reach the
 * destination on its own, then re-run the SAME action once from the top (fresh
 * probe).
 *
 * re-pinned to rowfirst-1.0.0 (b1133): exact-id row click first, day-drive is
 * the fallback. The ladder used to be "drive the Day view, prove the observed
 * day, THEN click the row". Measured live 2026-08-31, the Day-view drive's own
 * recovery ladder can DESTROY a perfectly painted schedule, after which the row
 * hunt honestly finds nothing. So SearchOpen (the exact-appointment-id row
 * click, which carries every identity gate itself — the landing surface must
 * re-prove name, DOB and the frozen date, and the probe re-proves the banner)
 * now runs FIRST against whatever athenaOne already paints, and mlsAppGotoDate
 * is the cure for a row-not-painted refusal, not the gatekeeper.
 *
 * Contract pinned here:
 *   - trigger ONLY on probe reasons context-unverified / context-mismatch;
 *   - the exact-id row click is the FIRST rung, before any Day-view drive;
 *   - a row-not-painted refusal falls back to the Day-view drive on the frozen
 *     day, and only then retries the row click;
 *   - exactly ONE ladder run (the retry carries __autoOpened) — never a third
 *     SearchOpen;
 *   - every SearchOpen message carries name, dob, mrn, appointmentId, and the
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
  /* pin moved wf3-1.0.0 -> wf3-1.1.0 deliberately: mdx-2.0.0 presence port
     (probe asks the extension to front athenaOne; timeout names the cure).
     The auto-open behavior this suite pins is unchanged. */
  assert(wf && wf.installed && wf.version === 'wf3-1.1.0', 'writeflow failed to install as wf3-1.1.0');
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

/* The row-first rung's refusal when the exact appointment row is simply not on
   the grid athenaOne has painted — the ONLY thing that may summon the Day-view
   drive under rowfirst-1.0.0. */
const ROW_NOT_PAINTED = { ok: false, opened: false, reason: 'appointment-id-not-found',
  error: 'The exact Athena appointment row is not on the schedule athenaOne has painted.' };

function opensOf(h) { return h.posted.filter(m => m.type === 'mlsAppSearchOpenPatient'); }
function lastOpen(h) { return opensOf(h).pop(); }
function navsOf(h) { return h.posted.filter(m => m.type === 'mlsAppGotoDate'); }

function assertFrozenIdentity(open, label) {
  assert.strictEqual(open.name, 'Adam J Schaeffer', label + ': open lost the name');
  assert.strictEqual(open.dob, '03/24/2006', label + ': open lost the dob');
  assert.strictEqual(open.mrn, '7833832', label + ': open lost the mrn');
  assert.strictEqual(open.appointmentId, '52585999', label + ': open lost the appointment id');
  assert.strictEqual(open.scheduleDate, '2026-06-20', label + ': open lost the YYYY-MM-DD schedule date');
}

async function run(scenario) {
  const h = makeHarness();
  const done = h.wf.startAthenaAction('write_note', Object.assign({}, OPTS, scenario.opts || {}));
  await h.settle();
  const probe1 = h.posted.find(m => m.type === 'mlsAppAthenaActionV2');
  assert(probe1 && probe1.mode === 'probe', scenario.name + ': first probe missing');
  h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probe1.requestId, resp: scenario.probe1 });
  await h.settle();
  const openable = ['context-unverified', 'context-mismatch'].includes(String(scenario.probe1 && scenario.probe1.reason || '')) &&
    !(scenario.opts && scenario.opts.autoOpen === false);
  let nav = null, rowFirst = null;
  if (openable) {
    /* re-pinned to rowfirst-1.0.0 (b1133): exact-id row click first, day-drive is the fallback. */
    rowFirst = opensOf(h)[0];
    assert(rowFirst, scenario.name + ': the exact-appointment row click was never attempted');
    assert.strictEqual(navsOf(h).length, 0,
      scenario.name + ': the Day-view drive ran BEFORE the exact-id row click on the schedule athenaOne already paints');
    assertFrozenIdentity(rowFirst, scenario.name + ' row-first');

    /* A row-first success is the whole point of rowfirst-1.0.0: the ladder ends
       there and the Day-view drive — which can destroy a painted schedule — is
       never run at all. Scenarios that want the fallback rung leave
       rowFirstResult unset and get the row-not-painted refusal. */
    if (scenario.rowFirstResult) {
      h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: rowFirst.requestId,
        resp: Object.assign({ requestId: rowFirst.requestId }, scenario.rowFirstResult) });
      await h.settle();
      return { h, probe1, done, nav: null, rowFirst };
    }
    h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: rowFirst.requestId,
      resp: Object.assign({ requestId: rowFirst.requestId }, ROW_NOT_PAINTED) });
    await h.settle();

    nav = navsOf(h)[0];
    assert(nav, scenario.name + ': a row-not-painted refusal did not fall back to the exact-day navigation');
    assert.strictEqual(nav.date, OPTS.expectedContext.visitDate, scenario.name + ': navigation lost the frozen visit day');
    assert.strictEqual(opensOf(h).length, 1,
      scenario.name + ': the row click was retried before Athena answered the Day-view drive');
    if (scenario.leaveNavPending !== true) {
      const navResult = Object.prototype.hasOwnProperty.call(scenario, 'navResult')
        ? scenario.navResult
        : { ok: true, supported: true, schedDate: OPTS.expectedContext.visitDate };
      h.deliver({ source: 'mls-ext', type: 'mlsAppGotoDateResult', requestId: nav.requestId, resp: navResult });
      await h.settle();
    }
  }
  return { h, probe1, done, nav, rowFirst };
}

(async () => {
// 0. re-pinned to rowfirst-1.0.0 (b1133): exact-id row click first, day-drive is
//    the fallback. When the exact appointment row IS on the schedule athenaOne
//    already paints, the ladder ends at that click: mlsAppGotoDate is never
//    posted at all (the drive's own recovery can destroy a painted schedule),
//    and the fresh re-probe follows directly.
{
  const r = await run({
    name: 'row-first-wins',
    probe1: { ok: false, blocked: true, reason: 'context-unverified' },
    rowFirstResult: { ok: true, complete: true }
  });
  assert.strictEqual(navsOf(r.h).length, 0,
    'row-first-wins: the exact-id row click proved the open, but the Day-view drive ran anyway');
  assert.strictEqual(opensOf(r.h).length, 1, 'row-first-wins: more than one row click for one ladder run');
  const probes = r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2');
  assert.strictEqual(probes.length, 2, 'row-first-wins: a proven row-first open did not re-probe fresh, got ' + probes.length);
  assert.notStrictEqual(probes[1].requestId, probes[0].requestId, 'row-first-wins: the re-probe must be fresh');
  r.h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probes[1].requestId, resp: { ok: true, mode: 'probe', action: 'write_note', readOnly: true, actionToken: 'tok-0', context: { patientName: 'Adam J Schaeffer' } } });
  await r.h.settle();
  assert.strictEqual(r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute').length, 0,
    'row-first-wins: execute must wait for the human confirm click');
}

// 1. context-unverified → row click → (row not painted) → exact-day navigation →
//    the row click retried with the frozen identity, then a successful open → a
//    SECOND fresh probe; a verified re-probe stops at confirmation (no execute
//    without human click).
{
  const { h } = await (async () => {
    const r = await run({ name: 'happy', probe1: { ok: false, blocked: true, reason: 'context-unverified' } });
    const open = lastOpen(r.h);
    assert(open, 'happy: auto-open message missing');
    assert.notStrictEqual(open.requestId, r.rowFirst.requestId, 'happy: the post-nav row click is not a fresh attempt');
    assertFrozenIdentity(open, 'happy fall-through');
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
  /* re-pinned to rowfirst-1.0.0 (b1133): exact-id row click first, day-drive is
     the fallback. ONE ladder run is now the row-first click plus its single
     post-nav retry — never a third. */
  assert.strictEqual(opensOf(h).length, 2, 'happy: exactly one ladder run (row-first click + one post-nav retry) allowed');
  assert.strictEqual(navsOf(h).length, 1, 'happy: the fallback Day-view drive ran more than once');
}

// 2. The retry never runs the ladder again: a second context-unverified surfaces honestly.
{
  const r = await run({ name: 'loop-guard', probe1: { ok: false, blocked: true, reason: 'context-unverified' } });
  const open = lastOpen(r.h);
  r.h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: open.requestId, resp: { ok: true, requestId: open.requestId } });
  await r.h.settle();
  const probes = r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2');
  r.h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probes[1].requestId, resp: { ok: false, blocked: true, reason: 'context-unverified', error: 'Could not identify one exact patient encounter frame.' } });
  await r.h.settle();
  /* re-pinned to rowfirst-1.0.0 (b1133): exact-id row click first, day-drive is
     the fallback — so the loop-proof counts BOTH ladder verbs. */
  assert.strictEqual(opensOf(r.h).length, 2, 'loop-guard: a failed re-probe must not run the open ladder again');
  assert.strictEqual(navsOf(r.h).length, 1, 'loop-guard: a failed re-probe must not drive the Day view again');
  assert(r.h.toasts.some(t => /could not identify|not open|encounter/i.test(t.m)), 'loop-guard: the final failure must surface honestly');
}

// 3. A failed open surfaces honestly and never re-probes.
{
  const r = await run({ name: 'open-fails', probe1: { ok: false, blocked: true, reason: 'context-mismatch' } });
  const open = lastOpen(r.h);
  assert(open, 'open-fails: mismatch must also try the auto-open');
  r.h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: open.requestId, resp: { ok: false, reason: 'open-failed', error: 'No matching search result.', requestId: open.requestId } });
  await r.h.settle();
  assert.strictEqual(r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2').length, 1, 'open-fails: no re-probe after a failed open');
  assert.strictEqual(opensOf(r.h).length, 2, 'open-fails: the ladder ran past its one row-first click + one post-nav retry');
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

// 6. dayfall-1.0.0 (b1128, measured live 2026-08-31): the exact-day drive is a
//    navigation AID, not an identity gate. Only a POSITIVELY different painted
//    day refuses; an unproven goto (timeout / "calendar could not be reached"
//    with no observed day) falls through to the appointment-id row click,
//    whose landing surface and probe still re-prove identity and date.
// 6a. A navigation that POSITIVELY reports a different day still refuses.
//     re-pinned to rowfirst-1.0.0 (b1133): exact-id row click first, day-drive is
//     the fallback — the day-identity gate is UNCHANGED and still absolute, it
//     now guards the RETRY of the row click rather than its first attempt.
{
  const navResult = { ok: true, supported: true, schedDate: '2026-06-19' };
  const r = await run({ name: 'nav-wrong-day', probe1: { ok: false, blocked: true, reason: 'context-unverified' }, navResult });
  assert.strictEqual(opensOf(r.h).length, 1,
    'a positively different painted day retried SearchOpen instead of refusing');
  assert.strictEqual(r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2').length, 1,
    'a positively different painted day caused a re-probe');
  assert(r.h.toasts.some(t => /could not open|exact encounter day|did not prove|different encounter day/i.test(t.m)),
    'the wrong-day refusal did not surface honestly');
}
// 6b. An UNPROVEN navigation result falls through to exactly one MORE SearchOpen
//     with the frozen identity, and a successful open still re-probes fresh.
for (const navResult of [
  { ok: true, supported: true },
  { ok: false, supported: true, reason: 'nav-failed' }
]) {
  const r = await run({ name: 'nav-unproven-' + JSON.stringify(navResult), probe1: { ok: false, blocked: true, reason: 'context-unverified' }, navResult });
  const opens = opensOf(r.h);
  /* re-pinned to rowfirst-1.0.0 (b1133): exact-id row click first, day-drive is
     the fallback — so one ladder run is the row-first click plus this retry. */
  assert.strictEqual(opens.length, 2,
    'an unproven navigation must fall through to exactly one more SearchOpen: ' + JSON.stringify(navResult));
  assert.notStrictEqual(opens[1].requestId, opens[0].requestId, 'the fall-through open reused the row-first request');
  assertFrozenIdentity(opens[1], 'fall-through');
  r.h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: opens[1].requestId, resp: { ok: true, complete: true, requestId: opens[1].requestId } });
  await r.h.settle();
  assert.strictEqual(r.h.posted.filter(m => m.type === 'mlsAppAthenaActionV2').length, 2,
    'fall-through open did not re-probe fresh: ' + JSON.stringify(navResult));
}

// 7. The public direct lane is also fail-closed when no exact visit is bound.
//    The extension worker may retain a read-only diagnostic capability, but the
//    product never asks it to adopt whichever same-patient encounter is open.
{
  const h = makeHarness();
  const result = await h.wf.startAthenaAction('write_note', {
    patient: OPTS.patient, sections: OPTS.sections,
    expectedContext: { visitDate: '', provider: '', appointmentId: '', encounterId: '', encounterUrl: '' }
  });
  await h.settle();
  assert.strictEqual(result && result.error, 'exact-encounter-context-missing',
    'the public current lane did not refuse an unbound visit');
  assert.strictEqual(h.posted.filter(m => /^(?:mlsAppAthenaActionV2|mlsAppGotoDate|mlsAppSearchOpenPatient)$/.test(m.type)).length, 0,
    'the public current unbound lane contacted Athena');
  assert(h.toasts.some(t => /re-pull|bind|will not guess/i.test(t.m)),
    'the public current unbound refusal did not explain the exact bind cure');
}

console.log('PASS writeflow auto-open (rowfirst-1.0.0): the exact-appointment-id row click is the FIRST rung and ends the ladder when it proves the open, a row-not-painted refusal falls back to the exact-day navigation which is still refused by a positively different painted day, direct unbound reviews stay blocked, one fresh re-probe follows a verified open, failures stay honest, and the human confirm click is untouched');
})().catch((err) => { console.error(err); process.exit(1); });
