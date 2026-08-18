'use strict';

/* notes-idle-1.0.0 — THE LEFTOVER VISIT NOTES FILL IN QUIETLY
 *
 * OWNER, 2026-08-18: "I want it to just do histories like it's doing and then
 * when it's done and says done, secretly in the background it is going to get
 * the day visit notes. But if the person goes to do something it will PAUSE the
 * visit notes and then restart and get them all in background when idle."
 * Re-scoped the same day, after the inline leg was measured working: "wait it
 * worked so make sure not to jump me to athena but if u have a fix that's fast
 * no need for background pulls."
 *
 * So the pull's own day-note leg is UNCHANGED and this suite must not move it.
 * What is proven here is the LEFTOVER path: the rows the pass and dnbf-1.0.0's
 * immediate round could not read now land in one persistent, idle-gated queue.
 *
 * Everything below EXECUTES the real 1p importer inside a vm with a drivable
 * clock, a fake bridge and a fake reader. Synthetic names/DOB/MRN only; no
 * network, no extension, no PHI.
 *
 * WHAT IS *NOT* PROVEN HERE, said out loud: node cannot reproduce Chrome's
 * intensive throttling, so "a Worker timer escapes the clamp" is not measurable
 * in this file. What IS measured is that the clock the engine builds is the
 * WORKER path (timerKind() === 'worker'), that it keeps ticking with
 * document.hidden true, and that visibility is not consulted by the gate at
 * all — which is the whole of what this code controls. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const importer = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const b121 = fs.readFileSync(path.join(root, '1p-feat_mls_b121_pack.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];

const DAY = '2026-08-14';
const ROWS = 5;
/* the synthetic identities. Every one of these strings must be absent from
   every byte the engine persists or renders. */
const NAMES = ['Quillon Ashgrove', 'Marisela Fenwick', 'Tobias Underhay', 'Perpetua Vandersloot', 'Ignatius Blackmoor'];

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ======================================================== 0  STATIC SHAPE == */
{
  const a = importer.indexOf('/* ===== notes-idle-1.0.0 (the LEFTOVER visit notes fill in quietly) =');
  const b = importer.indexOf('/* ===== end notes-idle-1.0.0 ===== */');
  ok(a > 0 && b > a, 'the notes-idle-1.0.0 block is missing or unclosed in the 1p importer');
  const block = importer.slice(a, b);

  /* rAF never fires in a hidden tab; this engine is FOR the hidden tab. */
  ok(!/requestAnimationFrame/.test(block), 'notes-idle uses requestAnimationFrame — it never fires in a hidden tab');
  /* it must not claim or release the Athena lease; it asks, it never takes. */
  ok(!/\.claim\(|\.release\(/.test(block), 'notes-idle claims or releases the Athena lease — it must only ASK whether Athena is free');
  /* THE OWNER'S RE-SCOPE, AS A BYTE CHECK: it never brings athenaOne forward. */
  for (const forbidden of ['tabs.update', 'chrome.tabs', 'window.focus', '.focus()', 'mlsAppActivate', 'activateTab', 'bringToFront']) {
    eq(block.indexOf(forbidden), -1,
      'notes-idle contains "' + forbidden + '" — it must never activate, focus or navigate the athenaOne tab');
  }
  /* the only two things it is allowed to post */
  const posts = block.match(/postMessage\(\s*\{[^}]*type:\s*"([^"]+)"/g) || [];
  eq(posts.length, 0, 'notes-idle posts a bridge message of its own — it must reuse p1PresenceProbe and the ordinary reader');

  /* the pull's own inline day-note leg is UNTOUCHED by this change */
  ok(/var DN_PASS_MS_PER_ROW = 10000;/.test(importer), 'dnp2-1.0.0 pass budget was altered — the inline leg must stay exactly as it was');
  ok(/function tnBoundedRead\(vp, p, day, opts\)/.test(importer), 'the inline bounded day-note read was removed');
  ok(/function runDeferredTodayNoteRound\(\)/.test(importer), 'dnbf-1.0.0 immediate deferred round was removed');
}

/* the one-engine handshake, BOTH directions */
{
  ok(/window\.__mlsNotesIdle\s*&&\s*typeof window\.__mlsNotesIdle\.reading === 'function'/.test(b121),
    "b121's anyPullRunning() does not consult notes-idle — the one-engine rule would be one-sided");
  ok(/visits-backfill-running/.test(importer),
    'notes-idle does not refuse while the b121 visits backfill is running');
  ok(/API\.isDrafting = function \(\) \{ return RUN\.on === true; \};/.test(connect),
    'draft-all does not publish its running flag, so notes-idle cannot refuse during a draft run');
}

/* the shells: the pinned tray line and the Settings receipt, in BOTH twins */
for (const shell of SHELLS) {
  const src = fs.readFileSync(path.join(root, shell), 'utf8');
  ok(src.indexOf('function pin(key, msg, type)') > 0, shell + ': quietnotify has no pin() — the tray line cannot update in place');
  ok(/pin: pin,\s*\n\s*unpin: unpin,/.test(src), shell + ': pin/unpin are not exported on __mlsQuietNotify');
  ok(src.indexOf('id="mlsNotesIdleRow"') > 0, shell + ': the Settings receipt row is missing');
  ok(src.indexOf('onclick="mlsNotesIdleReadNow()"') > 0, shell + ': the "Read now" control is missing');
  ok(src.indexOf('onclick="mlsNotesIdleStop()"') > 0, shell + ': the "Stop" control is missing');
  ok(src.indexOf('window.__mlsNotesIdleRender') > 0, shell + ': the receipt renderer is missing');
  /* the receipt row lives INSIDE the one Advanced integrations disclosure */
  const dz = src.indexOf('<details id="advIntegrations"');
  const dzEnd = src.indexOf('</details>', dz);
  const rowAt = src.indexOf('id="mlsNotesIdleRow"');
  ok(dz > 0 && rowAt > dz && rowAt < dzEnd, shell + ': the receipt row is not inside the Advanced integrations disclosure');
  /* and it does not nest a second <details>, which that suite forbids */
  eq(src.slice(dz + 1, dzEnd).indexOf('<details'), -1, shell + ': a second <details> was nested inside the disclosure');
}

/* ==================================================== 1  THE DONE WORDING == */
/* The real bytes, sliced out of the importer and EXECUTED against a synthetic
   receipt — so "the DONE line stopped saying could not be read" is a
   measurement of the shipped string builder, not a grep. */
const doneWording = (function () {
  const a = importer.indexOf('            var __tnNote = "";');
  const b = importer.indexOf('            } catch (eTnNote) {}', a);
  assert.ok(a > 0 && b > a, 'could not slice the DONE day-note line out of the 1p importer');
  const body = importer.slice(a, b + '            } catch (eTnNote) {}'.length);
  const codeA = importer.indexOf('  function tnReasonCode(reason) {');
  const codeB = importer.indexOf('  function tnIsNoTabReason(');
  assert.ok(codeA > 0 && codeB > codeA, 'could not slice tnReasonCode out of the 1p importer');
  const mapper = importer.slice(importer.indexOf('  var TN_NO_TAB_REASON = '), codeB);
  return new Function('historyReceipt', mapper + '\n' + body + '\nreturn __tnNote;');
})();

function testDoneWording() {
  /* three rows the catch-up will retry, one row with nothing to read */
  const mixed = doneWording({ patients: [
    { name: NAMES[0], patientId: 'pt-1', todayNote: false, todayNoteReason: 'day-note-pass-budget-exhausted' },
    { name: NAMES[1], patientId: 'pt-2', todayNote: false, todayNoteReason: 'pulled-day-note-deadline-exceeded' },
    { name: NAMES[2], patientId: 'pt-3', todayNote: false, todayNoteReason: 'pull-in-flight: another Athena read' },
    { name: NAMES[3], patientId: 'pt-4', todayNote: false, todayNoteReason: 'Athena returned an encounter index without verified full detail' },
    { name: NAMES[4], patientId: 'pt-5', todayNote: true }
  ] });
  eq(mixed.indexOf('could not be read'), -1,
    'the DONE line still says "could not be read" for rows the idle catch-up is going to retry:\n' + mixed);
  ok(/3 visit notes will fill in quietly when you're idle/.test(mixed),
    'the DONE line does not say what happens next for the three queued rows:\n' + mixed);
  ok(/1 appointment had no visit note in Athena for that day\./.test(mixed),
    'the DONE line does not state the one row that has nothing to read:\n' + mixed);
  ok(/Integrations . Advanced integrations/.test(mixed),
    'the DONE line does not point at the receipt:\n' + mixed);
  for (const n of NAMES) {
    eq(mixed.indexOf(n), -1, 'the DONE line names a patient ("' + n + '") — it must be counts only');
    eq(mixed.indexOf(n.split(' ')[0]), -1, 'the DONE line carries a first name ("' + n.split(' ')[0] + '")');
  }

  /* a day where every note was read says nothing at all */
  eq(doneWording({ patients: [{ name: NAMES[0], patientId: 'pt-1', todayNote: true }] }), '',
    'a fully-read day still appends a day-note sentence');

  /* singular/plural, because a doctor reads it */
  const one = doneWording({ patients: [{ name: NAMES[0], patientId: 'pt-1', todayNote: false, todayNoteReason: 'pulled-day-note-deadline-exceeded' }] });
  ok(/1 visit note will fill in quietly/.test(one), 'the singular form is wrong: ' + one);

  /* NON-VACUITY: the old shape would have failed the first assertion */
  const old = ' The pulled day\'s note could not be read for Quillon (deadline)';
  ok(old.indexOf('could not be read') > 0, 'the non-vacuity control is broken');
}

/* ======================================================= 2  THE RUNTIME ==== */
function makeHarness(options) {
  options = options || {};
  const store = options.store || new Map();
  const listeners = new Set();
  const docListeners = [];
  const elements = new Map();
  const timers = [];
  const posted = [];
  const toasts = [];
  const pins = [];
  const noteCalls = [];
  let timerSeq = 0;

  /* THE DRIVABLE CLOCK. The idle threshold is 20 s and the backoff ladder runs
     to 10 minutes; a suite that waited for either would be a suite nobody runs. */
  const RealDate = Date;
  const clock = { t: RealDate.now() };
  function FakeDate(...a) { return a.length === 0 ? new RealDate(clock.t) : new RealDate(...a); }
  FakeDate.now = () => clock.t;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  FakeDate.prototype = RealDate.prototype;

  const patients = NAMES.map((n, i) => ({
    id: 'pt-' + (i + 1), name: n,
    dob: '0' + (i + 1) + '/11/1971', mrn: 'SYN-MRN-' + (i + 1), visits: []
  }));

  const flags = Object.assign({
    leaseBusy: false, daySwitchBusy: false, historyPullRunning: false,
    backfillRunning: false, recording: false, drafting: false, reviewOpen: false,
    lockHeld: false, presenceOpen: true, hidden: false
  }, options.flags || {});

  function fakeElement(tag, id) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(), id: id || '', style: {}, children: [],
      parentNode: null, textContent: '', classList: { contains: () => false },
      setAttribute(n, v) { this[n] = String(v); if (n === 'id') { this.id = String(v); elements.set(this.id, this); } },
      appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); if (c.id) elements.set(c.id, c); } return c; },
      remove() { if (this.id) elements.delete(this.id); }
    };
    Object.defineProperty(node, 'innerHTML', {
      get() { return this._innerHTML || ''; },
      set(v) { this._innerHTML = String(v || ''); }
    });
    if (node.id) elements.set(node.id, node);
    return node;
  }
  const body = fakeElement('body'), head = fakeElement('head');

  /* THE WORKER FAKE. It is deliberately INERT unless a test asks for
     `workerTicks`, so every other test drives the engine one explicit tick at a
     time and its read counts are exact rather than racing a background clock.
     The one test that needs a live clock (hidden-tab) turns it on, and then it
     runs on the HOST's real timers - which is the property being asserted: the
     engine's clock is not the vm's main-thread setInterval, stubbed to a no-op
     right below, so a fallback to it would show up as zero ticks. */
  const workers = [];
  function FakeWorker(url) {
    this.url = url; this.onmessage = null; this._iv = null; this.ms = 0;
    const self = this;
    this.postMessage = function (ms) {
      self.ms = Number(ms) || 0;
      if (options.workerTicks !== true) return;
      /* cadence is asserted separately off _notesIdleConfig().tickMs; here the
         only question is whether the Worker path ticks at all. */
      self._iv = setInterval(function () { if (self.onmessage) self.onmessage({ data: 1 }); }, 5);
      if (self._iv && self._iv.unref) self._iv.unref();
    };
    this.terminate = function () { if (self._iv) { clearInterval(self._iv); self._iv = null; } };
    workers.push(this);
  }

  const rt = {
    console, Promise, Math, JSON, Intl, Object, Array, String, Number,
    Boolean, RegExp, Error, TypeError, encodeURIComponent, decodeURIComponent, queueMicrotask,
    Date: FakeDate,
    setTimeout(fn, ms) { const t = { id: ++timerSeq, fn, ms: Number(ms) || 0, canceled: false }; timers.push(t); return t.id; },
    clearTimeout(id) { const t = timers.find(x => x.id === id); if (t) t.canceled = true; },
    /* the MAIN-THREAD interval is a no-op on purpose: if the engine ever falls
       back to it, nothing ticks and the tests that expect ticks fail loudly. */
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
      get hidden() { return flags.hidden === true; },
      get visibilityState() { return flags.hidden ? 'hidden' : 'visible'; },
      getElementById(id) {
        if (String(id) === 'captureBtn') return flags.recording ? { classList: { contains: c => c === 'recording' } } : null;
        if (String(id) === 'mlsAthenaUnifiedConfirm') return flags.reviewOpen ? fakeElement('div', 'mlsAthenaUnifiedConfirm') : null;
        return elements.get(String(id)) || null;
      },
      createElement: t => fakeElement(t),
      addEventListener: (t, fn, o) => { docListeners.push({ type: String(t), fn, opts: o }); },
      removeEventListener: () => {},
      body, head, documentElement: head
    },
    navigator: { locks: { query: () => Promise.resolve({ held: flags.lockHeld ? [{ name: 'mls-managed-athena-pull' }] : [], pending: [] }) } },
    URL: { createObjectURL: () => 'blob:notes-idle', revokeObjectURL: () => {} },
    Blob: function Blob(parts, opts) { this.parts = parts; this.opts = opts; },
    Worker: FakeWorker,
    _calMode: 'day', _calRefDate: DAY, _calSelDay: '', _calAppts: [], _calProviders: [], _calMe: null,
    backendMode: () => false, bkToken: () => '', bkBase: () => 'https://local.invalid',
    uns: options.uns || (key => 'notes-idle-test::' + key),
    _acctTodayKey: () => DAY,
    _normDate: v => String(v || '').slice(0, 10),
    _normTime: v => String(v || ''),
    getPatients: () => patients,
    upsertPatient: p => { const at = patients.findIndex(x => x.id === p.id); if (at >= 0) patients[at] = p; else patients.push(p); },
    loadCalendar: () => Promise.resolve(),
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    __mlsBgSleep: () => Promise.resolve(),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    toast: (m, t) => { toasts.push({ m: String(m), t: String(t || '') }); },
    __mlsQuietNotify: {
      pin: (k, text) => { pins.push({ k: String(k), text: String(text) }); return true; },
      unpin: k => { pins.push({ k: String(k), text: null }); return true; }
    },
    __mlsVisitNotesPref: { read: () => ({ state: 'off', on: false, settled: true }), write: () => true, isPrefKey: () => false },
    __mlsP1AthenaReadLease: {
      version: 'fake-lease', busy: () => flags.leaseBusy,
      claim: () => '', owns: () => false, touch: () => {}, release: () => {}, ready: () => true,
      state: () => ({ kind: '', draining: false, webHeld: false, deadlineAt: 0 })
    },
    __mlsDaySwitch: { isBusy: () => flags.daySwitchBusy === true },
    __mlsDayHistoryPull: { state: { running: false } },
    __mlsVisitsBackfill: { state: { running: false, inFlight: false } },
    __mlsTplPrepFix: { isDrafting: () => flags.drafting === true },
    __mlsVisitSavePref: {
      runForPatient(p, _onStatus, opts) {
        noteCalls.push({ patientId: p && p.id, onlyDate: opts && opts.onlyDate, at: clock.t });
        if (typeof options.read === 'function') return options.read(p, opts, noteCalls.length);
        return Promise.resolve({ ok: true, visits: 1 });
      }
    },
    _athenaHistoryTargetSnapshot: () => null,
    _assistReadChart: () => Promise.resolve({ ok: true })
  };
  rt.__mlsDayHistoryPull.state.running = false;
  Object.defineProperty(rt.__mlsDayHistoryPull.state, 'running', { get: () => flags.historyPullRunning === true, configurable: true });
  Object.defineProperty(rt.__mlsVisitsBackfill.state, 'running', { get: () => flags.backfillRunning === true, configurable: true });
  rt.window = rt;
  rt.addEventListener = (_t, fn) => listeners.add(fn);
  rt.removeEventListener = (_t, fn) => listeners.delete(fn);
  rt.dispatchEvent = () => true;
  rt.postMessage = msg => {
    posted.push(msg && msg.type);
    if (msg && msg.type === 'mlsPing') queueMicrotask(() => {
      const ev = { data: { source: 'mls-ext', type: 'mlsPong', id: msg.id || '', resp: { ok: true, version: '3.0.63' } } };
      Array.from(listeners).forEach(fn => fn(ev));
    });
    if (msg && msg.type === 'mlsAthenaPresence') queueMicrotask(() => {
      const ev = { data: { source: 'mls-ext', type: 'mlsAthenaPresenceResult',
        resp: flags.presenceOpen ? { athenaOpen: true, reason: 'presence-verified' } : { athenaOpen: false, reason: 'no-athena-tab' } } };
      Array.from(listeners).forEach(fn => fn(ev));
    });
  };

  vm.runInNewContext(importer, rt, { filename: '1p-feat_mls_schedimport_exact.js', timeout: 5000 });

  return {
    rt, api: rt.__mlsSI, patients, noteCalls, toasts, pins, posted, docListeners, store, flags, workers,
    clock, advance(ms) { clock.t += Number(ms) || 0; },
    timerKind: () => rt.__mlsSI._notesIdle().timerKind
  };
}

async function flush(turns = 40) { while (turns-- > 0) { await Promise.resolve(); await new Promise(r => setImmediate(r)); } }

function seed(h, n, code) {
  let added = 0;
  for (let i = 0; i < (n == null ? ROWS : n); i++) {
    if (h.api._notesIdleEnqueue('pt-' + (i + 1), DAY, code || 'deadline')) added++;
  }
  return added;
}
/* the doctor has been away long enough for the gate to open */
function goIdle(h) { h.advance(h.api._notesIdleConfig().idleMs + 1000); }

/* ---- (b) the queue is persistent ---------------------------------------- */
async function testPersistsAcrossReload() {
  const store = new Map();
  const h1 = makeHarness({ store });
  eq(seed(h1, 3), 3, 'the three synthetic leftovers were not queued');
  const key = 'notes-idle-test::p1NotesIdleQueueV1';
  const raw = store.get(key);
  ok(raw, 'the leftover queue was never persisted to localStorage');
  const parsed = JSON.parse(raw);
  eq(parsed.v, 1, 'the persisted queue has no version');
  eq(parsed.rows.length, 3, 'the persisted queue does not hold the three rows');

  /* a RELOAD: a brand new context over the same storage */
  const h2 = makeHarness({ store });
  const r2 = h2.api._notesIdle();
  eq(r2.rows.length, 3, 'the queue did not survive a reload');
  eq(r2.total, 3, 'the receipt lost the reloaded rows');
  eq(r2.queued, 3, 'the reloaded rows are not still waiting');
  ok(r2.rows.every(x => x.day === DAY), 'a reloaded row lost its day');

  /* DE-DUPLICATION: the same patient/day cannot be queued twice */
  eq(h2.api._notesIdleEnqueue('pt-1', DAY, 'deadline'), false, 'the same patient/day was queued a second time');
  eq(h2.api._notesIdle().rows.length, 3, 'a duplicate enqueue grew the queue');
}

/* ---- (c) the idle gate, and pause/resume -------------------------------- */
async function testIdleGatePauseResume() {
  const h = makeHarness();
  seed(h, 2);
  /* the page just "loaded", so the engine treats the doctor as active */
  eq(h.api._notesIdleGate(false).reason, 'user-active', 'a freshly-loaded page was treated as idle');
  eq(h.api._notesIdle().state, 'idle', 'the engine started in the wrong state');

  goIdle(h);
  eq(h.api._notesIdleGate(false).open, true, 'the gate did not open after the idle threshold');

  /* ANY user activity pauses it, on the very next tick */
  h.api._notesIdleActivity();
  eq(h.api._notesIdleGate(false).reason, 'user-active', 'activity did not close the gate');
  await h.api._notesIdleTick();
  eq(h.api._notesIdle().state, 'paused', 'activity did not move the engine to paused within one tick');
  eq(h.noteCalls.length, 0, 'a read started while the doctor was using the machine');
  ok(/paused while you work/.test(h.api._notesIdleLine()), 'the tray line does not say it is paused: ' + h.api._notesIdleLine());

  /* ...and it resumes by itself once the doctor has been quiet again */
  goIdle(h);
  await h.api._notesIdleTick();
  await flush();
  eq(h.noteCalls.length, 1, 'the engine did not resume after the doctor went idle again');
  eq(h.api._notesIdle().state, 'waiting', 'a resumed engine did not return to waiting');

  /* the threshold is a NAMED CONSTANT, and it is the owner's 20 s */
  eq(h.api._notesIdleConfig().idleMs, 20000, 'the idle threshold is not 20 s');
  /* the activity events are the six the brief named, and they are registered */
  const want = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'input'];
  /* Array.from: the config array is built in the vm's realm, so its prototype
     is not this realm's Array and deepStrictEqual would fail on identity. */
  eq(Array.from(h.api._notesIdleConfig().activityEvents).join(','), want.join(','), 'the activity event list drifted');
  for (const t of want) {
    ok(h.docListeners.some(l => l.type === t && l.opts && l.opts.capture === true && l.opts.passive === true),
      'the "' + t + '" activity listener is not registered capture+passive');
  }
}

/* ---- (d) it never starts while another owner is on Athena --------------- */
async function testRefusesWhileBusy() {
  const cases = [
    ['leaseBusy', 'pull-running'],
    ['daySwitchBusy', 'day-switch-busy'],
    ['historyPullRunning', 'history-pull-running'],
    ['backfillRunning', 'visits-backfill-running'],
    ['recording', 'recording'],
    ['drafting', 'opnote-drafting'],
    ['reviewOpen', 'athena-review-open']
  ];
  for (const [flag, reason] of cases) {
    const h = makeHarness({ flags: { [flag]: true } });
    seed(h, 2);
    goIdle(h);
    eq(h.api._notesIdleGate(false).reason, reason, 'the gate did not refuse for ' + flag);
    await h.api._notesIdleTick();
    await flush();
    eq(h.noteCalls.length, 0, 'a read started while ' + flag + ' was on');
    eq(h.api._notesIdle().state, 'waiting', 'a refused engine reported the wrong state for ' + flag);
    /* and "Read now" does NOT waive it: a person asking is not permission to
       open a chart underneath a pull, a recording or a review sheet. */
    await h.api.notesIdleReadNow();
    await flush();
    eq(h.noteCalls.length, 0, '"Read now" drove Athena while ' + flag + ' was on');
  }

  /* the cross-tab Web Lock: invisible to every synchronous signal above */
  const hl = makeHarness({ flags: { lockHeld: true } });
  seed(hl, 2);
  goIdle(hl);
  eq(hl.api._notesIdleGate(false).open, true, 'the synchronous gate should not see another tab’s Web Lock');
  await hl.api._notesIdleTick();
  await flush();
  eq(hl.noteCalls.length, 0, 'a read started while another tab held mls-managed-athena-pull');
  eq(hl.api._notesIdle().gateReason, 'web-lock-held', 'the Web Lock refusal was not named');
  eq(hl.api._notesIdleConfig().lockName, 'mls-managed-athena-pull', 'the wrong lock is being queried');

  /* athenaOne absent: a refusal that costs the row NOTHING */
  const hp = makeHarness({ flags: { presenceOpen: false } });
  seed(hp, 1);
  goIdle(hp);
  await hp.api._notesIdleTick();
  await flush();
  eq(hp.noteCalls.length, 0, 'a read was attempted with athenaOne proven absent');
  eq(hp.api._notesIdle().gateReason, 'athena-absent', 'the absent-athena refusal was not named');
  eq(hp.api._notesIdle().rows[0].attempts, 0, 'an absent athenaOne spent one of the row’s three attempts');
}

/* ---- (e) exactly one read at a time ------------------------------------- */
async function testOneReadAtATime() {
  let release = null;
  const h = makeHarness({ read: () => new Promise(r => { release = r; }) });
  seed(h, ROWS);
  goIdle(h);
  /* NOT awaited: a tick's promise settles with the READ it started, and this
     read is deliberately left hanging. The Worker caller never awaits either. */
  const firstTick = h.api._notesIdleTick();
  await flush(6);
  eq(h.noteCalls.length, 1, 'the first tick did not start exactly one read');
  eq(h.api._notesIdle().reading, true, 'the engine does not report itself as reading');
  /* while it is reading, the OTHER engine must see it */
  eq(h.rt.__mlsNotesIdle.reading(), true, 'the one-engine handshake does not report the in-flight read');
  for (let i = 0; i < 5; i++) { await h.api._notesIdleTick(); await flush(4); }
  eq(h.noteCalls.length, 1, 'more reads started while one was already in flight');
  eq(h.api._notesIdleGate(false).reason, 'reading', 'the gate does not name the in-flight read');
  release({ ok: true, visits: 1 });
  await firstTick;
  await flush();
  eq(h.rt.__mlsNotesIdle.reading(), false, 'the engine still reports reading after the read settled');
  h.api._notesIdleTick();   /* again not awaited - it starts the NEXT hanging read */
  await flush();
  eq(h.noteCalls.length, 2, 'the next read did not start after the first settled');
  eq(h.noteCalls[1].patientId, 'pt-2', 'the queue did not move on to the next row');
}

/* ---- (f) the closed codes, the ladder, and the attempt cap -------------- */
async function testCodesLadderAndCap() {
  /* no-encounter STOPS the row: there is nothing in Athena to fetch. */
  const hn = makeHarness({ read: () => Promise.resolve({ ok: false, reason: 'Athena returned an encounter index without verified full detail' }) });
  seed(hn, 1);
  goIdle(hn);
  await hn.api._notesIdleTick();
  await flush();
  let r = hn.api._notesIdle();
  eq(r.rows[0].state, 'no-note', 'a no-encounter answer did not stop the row');
  eq(r.rows[0].code, 'no-encounter', 'the no-encounter code was not recorded');
  eq(r.noNote, 1, 'the receipt does not count the no-note row');
  const callsAfter = hn.noteCalls.length;
  for (let i = 0; i < 4; i++) { goIdle(hn); await hn.api._notesIdleTick(); await flush(4); }
  eq(hn.noteCalls.length, callsAfter, 'a stopped no-encounter row was retried');
  eq(hn.api._notesIdlePlain('no-encounter'), 'no visit note in Athena for that day', 'the plain-words mapping for no-encounter drifted');

  /* a DEADLINE retries, on the ladder, and gives up after three attempts. */
  const hd = makeHarness({ read: () => Promise.resolve({ ok: false, reason: 'pulled-day-note-deadline-exceeded' }) });
  seed(hd, 1);
  const ladder = Array.from(hd.api._notesIdleConfig().backoffMs);
  eq(ladder.join(','), '30000,120000,600000', 'the backoff ladder drifted from 30 s / 2 min / 10 min');
  eq(hd.api._notesIdleConfig().maxAttempts, 3, 'the attempt cap is not 3');

  for (let attempt = 1; attempt <= 3; attempt++) {
    goIdle(hd);
    await hd.api._notesIdleTick();
    await flush();
    r = hd.api._notesIdle();
    eq(r.rows[0].attempts, attempt, 'attempt ' + attempt + ' was not recorded');
    eq(hd.noteCalls.length, attempt, 'attempt ' + attempt + ' did not run exactly one read');
    eq(r.lastCode, 'deadline', 'the deadline refusal was not mapped to the deadline code');
    if (attempt < 3) {
      eq(r.rows[0].state, 'queued', 'a retryable row was not re-queued after attempt ' + attempt);
      eq(r.rows[0].nextAt - hd.clock.t, ladder[attempt - 1],
        'the backoff after attempt ' + attempt + ' is not ' + ladder[attempt - 1] + ' ms');
      /* the ladder is REAL: an immediate tick must not read again */
      await hd.api._notesIdleTick();
      await flush(4);
      eq(hd.noteCalls.length, attempt, 'the backoff was not respected after attempt ' + attempt);
      hd.advance(ladder[attempt - 1] + 1000);
    }
  }
  r = hd.api._notesIdle();
  eq(r.rows[0].state, 'gave-up', 'the row did not give up after three attempts');
  eq(r.gaveUp, 1, 'the receipt does not count the given-up row');
  goIdle(hd);
  await hd.api._notesIdleTick();
  await flush();
  eq(hd.noteCalls.length, 3, 'a given-up row was read a fourth time');
  eq(hd.api._notesIdlePlain('deadline'), 'Athena was slow; will retry when idle', 'the plain-words mapping for deadline drifted');
  eq(hd.api._notesIdlePlain('safety-stop'), 'Athena showed the visit but not its full note; nothing stored', 'the plain-words mapping for safety-stop drifted');
  /* an unknown code can never leak a reader message into a doctor surface */
  eq(hd.api._notesIdlePlain('wrong-chart: Jane Q. Doe'), 'athenaOne did not return the note', 'an unmapped code leaked through the plain-words mapping');

  /* ONLY a FINISHED attempt may say "could not be read" */
  ok(/could not be read/.test(hd.api._notesIdleFinalLine(DAY)),
    'the finished line does not report the row that genuinely could not be read: ' + hd.api._notesIdleFinalLine(DAY));
  ok(/Athena was slow/.test(hd.api._notesIdleFinalLine(DAY)),
    'the finished line does not carry the plain-words code');
}

/* ---- (g) a row is dropped once the day's note is on file ---------------- */
async function testDropsWhenAlreadyOnFile() {
  const h = makeHarness();
  seed(h, 1);
  /* somebody else filed the day's encounter while the row waited */
  h.patients[0].visits.push({ date: DAY, type: 'Office visit', text: 'synthetic' });
  eq(h.api._notesIdleNoteOnFile('pt-1', DAY), true, 'a dated visit for the day is not recognised as on file');
  goIdle(h);
  await h.api._notesIdleTick();
  await flush();
  eq(h.noteCalls.length, 0, 'a row whose note was already on file was read again');
  eq(h.api._notesIdle().rows[0].state, 'read', 'the on-file row was not dropped');
  eq(h.api._notesIdle().rows[0].code, 'already-on-file', 'the drop reason was not recorded');

  /* the pull's OWN chart-summary row proves nothing about the note */
  const h2 = makeHarness();
  h2.patients[1].visits.push({ date: DAY, type: 'Chart summary', text: 'synthetic' });
  eq(h2.api._notesIdleNoteOnFile('pt-2', DAY), false,
    "the pull's own {type:'Chart summary'} row was mistaken for the day's visit note — that would silently drop a row that was never read");

  /* and the day LEDGER is the other proof */
  const h3 = makeHarness();
  h3.store.set('notes-idle-test::schedImportIndexV1::' + DAY,
    JSON.stringify({ v: 1, rows: {}, history: { todayNoteReadAt: { 'pt-3': Date.now() } } }));
  eq(h3.api._notesIdleNoteOnFile('pt-3', DAY), true, 'the day ledger receipt is not accepted as proof the note was read');
  eq(h3.api._notesIdleEnqueue('pt-3', DAY, 'deadline'), false, 'a row whose note the ledger already records was queued anyway');
}

/* ---- (h) nothing the doctor or the disk ever sees carries a name -------- */
async function testNoPhiAnywhere() {
  const h = makeHarness({ read: (p, o, n) => Promise.resolve(n === 1 ? { ok: true, visits: 1 } : { ok: false, reason: 'Athena returned an encounter index without verified full detail' }) });
  seed(h, ROWS);
  for (let i = 0; i < 10; i++) { goIdle(h); await h.api._notesIdleTick(); await flush(6); }

  const surfaces = [
    JSON.stringify(h.api._notesIdle()),
    h.api._notesIdleLine(),
    h.api._notesIdleFinalLine(DAY),
    String(h.store.get('notes-idle-test::p1NotesIdleQueueV1') || ''),
    h.pins.map(p => String(p.text)).join(' | '),
    h.toasts.map(t => t.m).join(' | ')
  ].join('\n');
  for (const n of NAMES) {
    eq(surfaces.indexOf(n), -1, 'a patient name ("' + n + '") reached a notes-idle surface or the disk');
    eq(surfaces.indexOf(n.split(' ')[0]), -1, 'a patient first name ("' + n.split(' ')[0] + '") reached a notes-idle surface');
  }
  for (const p of h.patients) {
    eq(surfaces.indexOf(p.dob), -1, 'a DOB reached a notes-idle surface');
    eq(surfaces.indexOf(p.mrn), -1, 'an MRN reached a notes-idle surface');
  }

  /* the tray gets a PINNED line, not forty appended ones */
  ok(h.pins.length > 0, 'the tray never received the progress line');
  ok(h.pins.every(p => p.k === 'notes-idle'), 'the tray line is not owned by one key');
  /* exactly ONE toast for the whole day, and only when it finished */
  eq(h.toasts.length, 1, 'the catch-up interrupted the doctor ' + h.toasts.length + ' times — the budget is one line at the end');
  ok(/^Visit notes for Aug 14: /.test(h.toasts[0].m), 'the final line is not the owner’s wording: ' + h.toasts[0].m);
  ok(/1 read/.test(h.toasts[0].m) && /4 had no note in Athena/.test(h.toasts[0].m),
    'the final line does not report the honest census: ' + h.toasts[0].m);
}

/* ---- (i) the clock is a Worker, and a hidden tab is still idle ---------- */
async function testWorkerClockTicksWhileHidden() {
  const h = makeHarness({ workerTicks: true, flags: { hidden: true } });
  /* the importer builds its own deadline-scheduler Worker at load, so count
     only the ones the catch-up creates once there is work to do. */
  const before = h.workers.length;
  seed(h, 2);
  eq(h.timerKind(), 'worker', 'the engine did not build a Worker clock (it fell back to a main-thread timer)');
  eq(h.api._notesIdleConfig().tickMs, 3000, 'the tick cadence left the 2-5 s band');
  eq(h.workers.length - before, 1, 'the catch-up created ' + (h.workers.length - before) + ' Worker clocks, not one');
  eq(h.workers[h.workers.length - 1].ms, 3000, 'the Worker was not asked for the configured cadence');

  goIdle(h);
  const ticks0 = h.api._notesIdle().ticks;
  await new Promise(r => setTimeout(r, 90));   /* the HOST clock: let the Worker fire */
  await flush();
  const r = h.api._notesIdle();
  ok(r.ticks > ticks0, 'the Worker clock did not tick while document.hidden was true (' + ticks0 + ' -> ' + r.ticks + ')');
  ok(h.noteCalls.length > 0, 'a hidden tab was treated as not-idle — the brief says a hidden tab is still idle');
  /* visibility is not part of the gate, at all */
  eq(importer.slice(importer.indexOf('function niGate('), importer.indexOf('function niWebLockHeld(')).indexOf('visibilityState'), -1,
    'the idle gate consults visibilityState — a hidden tab must still be idle');
  h.workers.forEach(w => w.terminate());
}

/* ---- (a) the pull hands its leftovers over, and only its leftovers ------ */
async function testPullFeedsTheQueue() {
  const h = makeHarness();
  const receipt = {
    day: DAY,
    patients: [
      { patientId: 'pt-1', name: NAMES[0], todayNote: true },
      { patientId: 'pt-2', name: NAMES[1], todayNote: 'already-read' },
      { patientId: 'pt-3', name: NAMES[2], todayNote: 'not-yet' },
      { patientId: 'pt-4', name: NAMES[3], todayNote: false, todayNoteReason: 'pulled-day-note-deadline-exceeded' },
      { patientId: 'pt-5', name: NAMES[4], todayNote: false, todayNoteReason: 'pull-in-flight', todayNoteDeferred: true }
    ]
  };
  eq(h.api._notesIdleSyncFromReceipt(receipt, DAY), 1,
    'the pull handed the wrong number of leftovers to the idle queue');
  const r = h.api._notesIdle();
  eq(r.rows.length, 1, 'the idle queue took a row it should not own');
  eq(r.rows[0].patientId, 'pt-4', 'the wrong row was handed over');
  ok(r.rows.every(x => x.patientId !== 'pt-5'),
    'a row the immediate deferred round still owns was ALSO queued here — that is the third queue this design forbids');

  /* once dnbf finishes with pt-5, the same feed picks it up */
  receipt.patients[4].todayNoteDeferred = false;
  eq(h.api._notesIdleSyncFromReceipt(receipt, DAY), 1, 'the finished deferred row never reached the idle queue');
  eq(h.api._notesIdle().rows.length, 2, 'the finished deferred row was not queued');

  /* and a row the deferred round RECOVERED is dropped rather than re-read */
  receipt.patients[3].todayNote = true;
  h.api._notesIdleSyncFromReceipt(receipt, DAY);
  const rows = h.api._notesIdle().rows;
  eq(rows.filter(x => x.patientId === 'pt-4')[0].state, 'read', 'a recovered row was left in the queue');
  eq(rows.filter(x => x.patientId === 'pt-4')[0].code, 'read-in-pull', 'the recovery was not recorded as such');

  /* STOP means stop: a stopped pull hands nothing over and drives nothing */
  const hs = makeHarness();
  hs.rt.__mlsPullStopRequested = true;
  eq(hs.api._notesIdleSyncFromReceipt(receipt, DAY), 0, 'a stopped pull still fed the idle queue');
  const hs2 = makeHarness();
  seed(hs2, 2);
  hs2.api.stopPull();
  goIdle(hs2);
  await hs2.api._notesIdleTick();
  await flush();
  eq(hs2.noteCalls.length, 0, 'the idle catch-up kept driving Athena after the doctor pressed Stop');
  eq(hs2.api._notesIdle().state, 'stopped', 'Stop did not stop the catch-up');
  eq(hs2.timerKind(), 'none', 'Stop left the background clock running');
  /* ...and Resume brings it back */
  hs2.api.notesIdleResume();
  goIdle(hs2);
  await hs2.api._notesIdleTick();
  await flush();
  eq(hs2.noteCalls.length, 1, 'Resume did not restart the catch-up');
}

/* ---- (k) the queue is per ACCOUNT, and survives a re-login -------------- */
async function testPerAccountAndRelogin() {
  const store = new Map();
  let email = '';                                   /* signed OUT at load */
  const h = makeHarness({ store, uns: k => 'notes-idle-test::' + (email || '_') + '::' + k });
  /* the module loaded before anyone signed in; it must not cache that answer */
  eq(h.api._notesIdle().rows.length, 0, 'the anonymous namespace started with rows');
  email = 'doctor-a@example.invalid';
  seed(h, 2);
  ok(store.has('notes-idle-test::doctor-a@example.invalid::p1NotesIdleQueueV1'),
    'the queue was written to the anonymous namespace instead of the signed-in account');
  eq(h.api._notesIdle().rows.length, 2, 'the signed-in account did not get its rows');

  /* a DIFFERENT doctor signs in on this device: he must see nothing of A's */
  email = 'doctor-b@example.invalid';
  eq(h.api._notesIdle().rows.length, 0, "a second account inherited the first account's leftover queue");
  eq(h.timerKind(), 'none', 'the background clock kept running across an account change');

  /* and A signing back in gets his own queue back, from disk */
  email = 'doctor-a@example.invalid';
  const back = h.api._notesIdle();
  eq(back.rows.length, 2, 'the queue did not survive a re-login');
  eq(back.queued, 2, 'the restored rows are not still waiting');
}

/* ---- (l) an absent athenaOne is not probed every three seconds ---------- */
async function testAbsentAthenaBacksOff() {
  const h = makeHarness({ flags: { presenceOpen: false } });
  seed(h, 1);
  goIdle(h);
  await h.api._notesIdleTick();
  await flush();
  const probes = h.posted.filter(t => t === 'mlsAthenaPresence').length;
  eq(probes, 1, 'the first tick did not probe presence exactly once');
  eq(h.api._notesIdle().rows[0].attempts, 0, 'an absent athenaOne spent an attempt');
  ok(h.api._notesIdle().rows[0].nextAt > h.clock.t, 'an absent athenaOne left the row due immediately - it would be probed every tick');
  for (let i = 0; i < 5; i++) { await h.api._notesIdleTick(); await flush(4); }
  eq(h.posted.filter(t => t === 'mlsAthenaPresence').length, probes,
    'a closed athenaOne was probed on every tick instead of waiting out one rung of the ladder');
}

/* ---- (m) a fresh pull revives a row that had given up ------------------- */
async function testFreshPullRevivesGaveUp() {
  const h = makeHarness({ read: () => Promise.resolve({ ok: false, reason: 'pulled-day-note-deadline-exceeded' }) });
  seed(h, 1);
  const ladder = Array.from(h.api._notesIdleConfig().backoffMs);
  for (let a = 1; a <= 3; a++) { goIdle(h); await h.api._notesIdleTick(); await flush(); if (a < 3) h.advance(ladder[a - 1] + 1000); }
  eq(h.api._notesIdle().rows[0].state, 'gave-up', 'the row did not give up');
  /* the doctor pulls again and it refuses again: fresh evidence, fresh ladder */
  eq(h.api._notesIdleEnqueue('pt-1', DAY, 'deadline'), true, 'a fresh pull did not revive the given-up row');
  const r = h.api._notesIdle();
  eq(r.rows[0].state, 'queued', 'the revived row is not queued');
  eq(r.rows[0].attempts, 0, 'the revived row kept its spent attempts');
  goIdle(h);
  await h.api._notesIdleTick();
  await flush();
  eq(h.noteCalls.length, 4, 'the revived row was not read');
}

/* ---- (n) a day of pure "no note in Athena" does not toast --------------- */
async function testNoToastForABookkeepingDay() {
  const h = makeHarness();
  h.api._notesIdleEnqueue('pt-1', DAY, 'no-encounter');
  h.api._notesIdleEnqueue('pt-2', DAY, 'no-encounter');
  goIdle(h);
  await h.api._notesIdleTick();
  await flush();
  eq(h.noteCalls.length, 0, 'a no-encounter row was read');
  eq(h.toasts.length, 0,
    'a day where nothing was ever attempted still interrupted the doctor - the DONE line already said it in plain words');
  eq(h.api._notesIdle().noNote, 2, 'the receipt does not count the two no-note rows');
}

/* ---- (j) it never jumps the doctor to athenaOne ------------------------- */
async function testNeverActivatesAthena() {
  const h = makeHarness();
  seed(h, 3);
  for (let i = 0; i < 6; i++) { goIdle(h); await h.api._notesIdleTick(); await flush(6); }
  ok(h.noteCalls.length >= 3, 'the fixture did not actually drain the queue (' + h.noteCalls.length + ' reads)');
  const kinds = Array.from(new Set(h.posted.filter(Boolean)));
  for (const k of kinds) {
    ok(k === 'mlsAthenaPresence' || k === 'mlsPing' || k === 'mlsExtHealth',
      'the catch-up posted "' + k + '" — the only verbs it may use are the presence probe and the ordinary reader');
  }
  ok(h.noteCalls.every(c => c.onlyDate === DAY), 'a catch-up read drifted off the day it was queued for');
}

/* the last stage entered, so a hang names itself instead of timing out blind */
let stage = 'start';
async function main() {
  const steps = [
    ['done-wording', testDoneWording],
    ['persists-across-reload', testPersistsAcrossReload],
    ['idle-gate-pause-resume', testIdleGatePauseResume],
    ['refuses-while-busy', testRefusesWhileBusy],
    ['one-read-at-a-time', testOneReadAtATime],
    ['codes-ladder-and-cap', testCodesLadderAndCap],
    ['drops-when-already-on-file', testDropsWhenAlreadyOnFile],
    ['no-phi-anywhere', testNoPhiAnywhere],
    ['worker-clock-while-hidden', testWorkerClockTicksWhileHidden],
    ['pull-feeds-the-queue', testPullFeedsTheQueue],
    ['per-account-and-relogin', testPerAccountAndRelogin],
    ['absent-athena-backs-off', testAbsentAthenaBacksOff],
    ['fresh-pull-revives-gave-up', testFreshPullRevivesGaveUp],
    ['no-toast-for-a-bookkeeping-day', testNoToastForABookkeepingDay],
    ['never-activates-athena', testNeverActivatesAthena]
  ];
  for (const [name, fn] of steps) { stage = name; await fn(); }
  console.log('PASS 1p-notes-idle-catchup: ' + checks + ' checks - the pull\'s own day-note leg is untouched; the rows it could not read land in ONE persistent per-account queue that survives reload, de-duplicates, and drops a row the moment the day\'s note is on file; the catch-up runs one read at a time and ONLY when the doctor has been idle 20 s and no pull, Web Lock, recording, draft-all, Athena review, deferred round or b121 backfill owns Athena; any input pauses it within one tick and it resumes by itself; no-encounter stops a row while a deadline retries on 30 s / 2 min / 10 min and gives up after three; the clock is a Worker timer that keeps ticking with document.hidden true; nothing is ever activated, focused or navigated; and no name, DOB or MRN reaches the DONE line, the tray, the receipt or the disk');
}

const watchdog = setTimeout(() => {
  console.error(new Error('1p-notes-idle-catchup runtime test did not finish; last stage: ' + stage));
  process.exit(1);
}, 20000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
