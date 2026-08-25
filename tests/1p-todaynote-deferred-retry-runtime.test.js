'use strict';

/* p1-todaynote-deferred-retry-3.0.0   (was 2.0.0; rewritten for dayfacts-1.0.1)
 *
 * WHAT EXPIRED. 2.0.0 pinned "Full Notes OFF is schedule-only": it asserted the
 * notes-idle lane refused EVERY settled-OFF account with gateReason
 * "visit-notes-off" and never opened a chart. dayfacts-1.0.1 revoked that
 * contract at the source. A settled OFF account is now DAY-FACTS mode, and its
 * pulled-day (onlyDate-scoped) note is MANDATORY work rather than an opt-in
 * extra; the ONLY account this lane still refuses is one that has never made
 * the choice at all, and it says so as "visit-notes-unchosen". The old static
 * pin (/visit-notes-off/) was the assertion that fired.
 *
 * WHAT THIS SUITE PINS NOW - positively, and with the teeth kept:
 *   1. unchosen is the ONLY preference refusal left. It spends no retry budget,
 *      preserves the queued row, and STOPS the idle timer instead of ticking
 *      forever. A provisional unsettled "on" is refused too. A settled account
 *      is the control that proves the pin discriminates rather than always
 *      reading "closed".
 *   2. a settled OFF account DRAINS its pulled-day note through the same exact
 *      patient/day binding - the day-facts floor. This is the inverse of what
 *      2.0.0 asserted, so it cannot pass by accident against the old engine.
 *   3. the revoked "visit-notes-off" vocabulary never returns to the lane, in
 *      ANY of the three derived twins (a half-derived twin is the live risk).
 *   4. Full Notes ON still retries ONE exact patient/day over the bounded
 *      ladder, gives up at NI_MAX_ATTEMPTS instead of spinning, short-circuits
 *      a terminal no-encounter, and never persists names, DOBs, MRNs or reader
 *      text.
 *   5. a busy Athena lease is a GATE in BOTH modes - it never consumes an
 *      attempt and never spins - because OFF now reads too.
 *   6. niSyncFromReceipt (the feed into this queue) adopts a DAY-FACTS
 *      receipt's unread rows: its OFF-mode early return is gone. It still drops
 *      rows the pull already read and skips rows _tnDefer still owns, and the
 *      durable queue stays PHI-free even when the receipt carries demographics.
 *   7. the UNSCOPED door (__mlsVisitSavePref.enabled(), mls-connect) is no
 *      softer than this day-scoped one: both refuse a provisional unsettled
 *      "on". That function is EXECUTED here, not grepped.
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

/* dayfacts-1.0.1 landed in the 1p fork and was re-derived into both twins.
   Every vocabulary pin below is checked in all three, because a twin that kept
   the revoked refusal ships an engine that silently skips mandatory notes. */
const IMPORTER_TWINS = [
  '1p-feat_mls_schedimport_exact.js',
  'cloned-feat_mls_schedimport_exact.js',
  'feat_mls_schedimport_exact.js'
];
const CONNECT_TWINS = ['1p-mls-connect.js', 'cloned-mls-connect.js', 'mls-connect.js'];

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function niBlockOf(source) {
  const a = source.indexOf('/* ===== notes-idle-1.0.0');
  const b = source.indexOf('/* ===== end notes-idle-1.0.0');
  return (a >= 0 && b > a) ? source.slice(a, b) : '';
}

/* ---------------------------------------------------------------- static */
{
  const ni = niBlockOf(importer);
  ok(ni.length > 1000, 'the notes-idle lane is missing from the importer');
  ok(ni.includes('function niEnqueue'), 'the notes-idle queue owner is missing');
  ok(ni.includes('function niReadNow'), 'the explicit one-row retry seam is missing');
  ok(ni.includes('function niTick'), 'the bounded idle tick seam is missing');

  /* dayfacts-1.0.1 vocabulary: unchosen refuses, settled OFF does not. */
  ok(/visit-notes-unchosen/.test(ni),
    'the notes-idle lane has no unchosen-account gate (dayfacts-1.0.1 vocabulary)');
  eq((ni.match(/visit-notes-off/g) || []).length, 0,
    'the revoked schedule-only refusal "visit-notes-off" is back in the notes-idle lane - a settled OFF account owes its pulled-day note');
  ok(/choice\.settled === true/.test(ni),
    'the notes-idle preference gate no longer requires a SETTLED choice');

  ok(/NI_MAX_ATTEMPTS/.test(ni) && /NI_BACKOFF_MS/.test(ni),
    'the notes-idle lane has no bounded retry ladder');
  ok(/patientId: r\.p, day: r\.d/.test(ni),
    'the test-visible notes-idle receipt does not expose only opaque patient/day bindings');

  /* the FEED must be preference-blind: dayfacts-1.0.1 removed niSyncFromReceipt's
     OFF-mode early return, and it must not come back under another name. The
     Stop guard is the one refusal that stays. */
  const feedFrom = ni.indexOf('function niSyncFromReceipt');
  const feedTo = ni.indexOf('function niIdleMs');
  ok(feedFrom >= 0 && feedTo > feedFrom, 'the notes-idle receipt feed is missing');
  const feed = ni.slice(feedFrom, feedTo);
  ok(!/visitNotesRequested|__mlsVisitNotesPref|_pullBodiesOverride/.test(feed),
    'niSyncFromReceipt reads the Full Notes preference again - the day-facts feed must be preference-blind');
  ok(/__mlsPullStopRequested/.test(feed),
    'niSyncFromReceipt lost its Stop guard - a stopped day would re-drive Athena');

  /* the immediate deferred round serves BOTH modes now: its guard may not carry
     a Full Notes / checkbox term. */
  const guardAt = importer.indexOf('function tnDeferRow(entry, day, force) {');
  ok(guardAt >= 0, 'tnDeferRow (the immediate deferred round) is missing');
  const guardLine = importer.slice(importer.indexOf('\n', guardAt) + 1,
    importer.indexOf('\n', importer.indexOf('\n', guardAt) + 1));
  ok(/if \(!entry \|\| !day \|\| sweepDepth\) return false;/.test(guardLine),
    'tnDeferRow\'s guard changed shape: ' + guardLine.trim().slice(0, 120));
  ok(!/visitNotes|checkbox|fullNotes|bodies/i.test(guardLine),
    'tnDeferRow refuses on a Full Notes term again - a deferrable day-facts note refusal must queue for the deferred round');

  /* twin parity - the vocabulary, in every derived copy. */
  IMPORTER_TWINS.forEach(function (file) {
    const twin = niBlockOf(fs.readFileSync(path.join(root, file), 'utf8'));
    ok(twin.length > 1000, file + ' has no notes-idle lane');
    ok(/visit-notes-unchosen/.test(twin), file + ' never re-derived the dayfacts-1.0.1 unchosen gate');
    eq((twin.match(/visit-notes-off/g) || []).length, 0,
      file + ' still carries the revoked "visit-notes-off" refusal - this twin skips mandatory day-facts notes');
  });
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

  /* the account's Full Notes choice. `notesChoice` states it exactly (that is
     how an UNSETTLED account is expressed); `fullNotesOn` is the shorthand for
     the two SETTLED shapes. */
  const notesChoice = options.notesChoice || (options.fullNotesOn === true
    ? { state: 'on', on: true, settled: true }
    : { state: 'off', on: false, settled: true });

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
      read: () => ({ state: notesChoice.state, on: notesChoice.on, settled: notesChoice.settled }),
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

/* the durable queue and every test-visible receipt must stay free of the
   fixture's demographics and of reader text. */
function assertPhiFree(raw, where) {
  ok(raw, 'no durable queue state was written (' + where + ')');
  ok(!/Synthetic Patient|01\/02\/1970|SYN-MRN-01|Athena|chart|text/i.test(raw),
    'the durable queue state contains patient demographics or reader text (' + where + ')');
}

/* ---- 1. unchosen is the ONLY preference refusal ----------------------- */
async function testUnchosenIsTheOnlyPreferenceRefusal() {
  /* both UNSETTLED shapes: never answered, and a provisional "on" that was
     never admitted. dayfacts-1.0.1 refuses both by the same name. */
  const shapes = [
    { label: 'never answered', choice: { state: 'unset', on: false, settled: false } },
    { label: 'provisional unsettled on', choice: { state: 'on', on: true, settled: false } }
  ];
  for (const shape of shapes) {
    const h = makeHarness({ notesChoice: shape.choice, leaseBusy: false });
    ok(h.api._notesIdleEnqueue(PATIENT, DAY, 'pull-in-flight'),
      'unchosen fixture (' + shape.label + ') did not accept a synthetic queued row');

    const gate = h.api._notesIdleGate(true);
    eq(gate.open, false, 'an unchosen account (' + shape.label + ') opened the notes-idle gate');
    eq(gate.reason, 'visit-notes-unchosen',
      'an unchosen account (' + shape.label + ') did not name the unchosen boundary');

    const result = await h.api.notesIdleReadNow();
    await flush();
    eq(result, null, 'an unchosen account (' + shape.label + ') returned a body-read result instead of pausing');
    eq(h.noteCalls.length, 0, 'an unchosen account (' + shape.label + ') drove a visit-body read');

    const receipt = h.api._notesIdle();
    eq(receipt.gateReason, 'visit-notes-unchosen',
      'the receipt for an unchosen account (' + shape.label + ') did not name the unchosen boundary');
    eq(receipt.state, 'paused', 'an unchosen account (' + shape.label + ') did not PAUSE');
    eq(receipt.queued, 1,
      'an unchosen account (' + shape.label + ') discarded queued work instead of preserving it for an explicit choice');
    eq(receipt.rows[0].attempts, 0,
      'an unchosen account (' + shape.label + ') consumed retry budget without reading');
    /* niRunOne must stop the clock on this branch, not tick forever. */
    eq(receipt.timerKind, 'none',
      'an unchosen account (' + shape.label + ') left the idle timer armed - it would tick forever behind a closed gate');
  }

  /* the control: the same fixture with a SETTLED choice is NOT refused, so the
     assertions above discriminate rather than always reading "closed". */
  for (const on of [true, false]) {
    const settled = makeHarness({ fullNotesOn: on, leaseBusy: false });
    ok(settled.api._notesIdleEnqueue(PATIENT, DAY, 'pull-in-flight'), 'settled control fixture did not enqueue');
    const g = settled.api._notesIdleGate(true);
    eq(g.open, true, 'a SETTLED account (Full Notes ' + (on ? 'ON' : 'OFF') + ') was refused by the preference gate');
    eq(g.reason, '', 'a SETTLED account (Full Notes ' + (on ? 'ON' : 'OFF') + ') carried a refusal reason');
  }
}

/* ---- 2. settled OFF drains the pulled-day note (the day-facts floor) --- */
async function testSettledOffDrainsThePulledDayNote() {
  const h = makeHarness({ fullNotesOn: false, leaseBusy: false });
  ok(h.api._notesIdleEnqueue(PATIENT, DAY, 'pull-in-flight'), 'OFF fixture did not enqueue the exact patient/day');

  const result = await h.api.notesIdleReadNow();
  await flush();
  ok(result && result.ok === true,
    'Full Notes OFF refused its pulled-day note - dayfacts-1.0.1 makes that read mandatory, not optional');
  eq(h.noteCalls.length, 1, 'the OFF day-facts read did not run exactly once');
  eq(h.noteCalls[0].patientId, PATIENT, 'the OFF day-facts read drifted to another patient');
  eq(h.noteCalls[0].onlyDate, DAY,
    'the OFF day-facts read lost its onlyDate scope - OFF mode may read the PULLED DAY only, never whole histories');

  const receipt = h.api._notesIdle();
  eq(receipt.read, 1, 'the OFF day-facts note was not marked read');
  eq(receipt.queued, 0, 'the OFF row remained queued after a successful read');
  ok(receipt.gateReason !== 'visit-notes-off',
    'the revoked schedule-only refusal is still reachable at runtime');
  assertPhiFree(h.persisted(), 'settled OFF');
}

/* ---- 3. ON retries the exact patient/day after a transient refusal ----- */
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
  ok(h.api._notesIdle().rows[0].nextAt > Date.now(),
    'the refused row was not pushed out onto the backoff ladder');

  const second = await h.api.notesIdleReadNow(); /* explicit force bypasses backoff for this deterministic test */
  await flush();
  eq(second.ok, true, 'the bounded ON retry did not recover the body read');
  eq(h.noteCalls.length, 2, 'the ON retry performed more than one follow-up attempt');
  ok(h.noteCalls.every(c => c.patientId === PATIENT && c.onlyDate === DAY),
    'the deferred retry changed patient or day scope');
  eq(h.api._notesIdle().read, 1, 'the recovered body was not marked read');
  eq(h.api._notesIdle().queued, 0, 'the recovered row remained queued');

  const raw = h.persisted();
  assertPhiFree(raw, 'Full Notes ON');
  const saved = JSON.parse(raw);
  ok(Array.isArray(saved.rows) && saved.rows.length === 1, 'the durable queue shape changed unexpectedly');
  ok(Object.keys(saved.rows[0]).every(k => ['p', 'd', 'a', 'c', 's', 'n'].includes(k)),
    'the durable queue row gained a non-PHI contract field');
}

/* ---- 4. the ladder is BOUNDED, and a terminal code short-circuits ------ */
async function testLadderGivesUpAndTerminalShortCircuits() {
  const cfg = makeHarness({ fullNotesOn: true, leaseBusy: false }).api._notesIdleConfig();
  eq(cfg.maxAttempts, 3, 'the notes-idle attempt ceiling moved - re-derive this bound before trusting the pins below');
  eq(cfg.backoffMs.length, 3, 'the notes-idle backoff ladder no longer has one rung per attempt');

  /* every attempt refuses transiently: the row must GIVE UP at the ceiling and
     then stop asking Athena, even under an explicit force. */
  const refusals = [];
  for (let i = 0; i < cfg.maxAttempts + 3; i++) refusals.push({ ok: false, reason: PULL_IN_FLIGHT });
  const h = makeHarness({ fullNotesOn: true, leaseBusy: false, outcomes: refusals });
  ok(h.api._notesIdleEnqueue(PATIENT, DAY, 'pull-in-flight'), 'ladder fixture did not enqueue');
  for (let i = 0; i < cfg.maxAttempts + 3; i++) { await h.api.notesIdleReadNow(); await flush(); }
  eq(h.noteCalls.length, cfg.maxAttempts,
    'the exhausted row kept driving Athena past its attempt ceiling');
  eq(h.api._notesIdle().rows[0].state, 'gave-up', 'the exhausted row did not settle as gave-up');
  eq(h.api._notesIdle().gaveUp, 1, 'the receipt does not report the exhausted row honestly');
  eq(h.api._notesIdle().queued, 0, 'an exhausted row is still advertised as queued work');

  /* a TERMINAL refusal (there is genuinely no encounter for that date) must not
     buy the whole ladder - one attempt settles it. */
  ok(cfg.terminalCodes.indexOf('no-encounter') >= 0, 'no-encounter is no longer a terminal notes-idle code');
  const t = makeHarness({ fullNotesOn: false, leaseBusy: false, outcomes: [
    { ok: false, reason: 'no-encounter-for-date' },
    { ok: true, visits: 1 }
  ] });
  ok(t.api._notesIdleEnqueue(PATIENT, DAY, 'pull-in-flight'), 'terminal fixture did not enqueue');
  for (let i = 0; i < 3; i++) { await t.api.notesIdleReadNow(); await flush(); }
  eq(t.noteCalls.length, 1, 'a terminal no-encounter refusal was retried instead of settling');
  eq(t.api._notesIdle().rows[0].state, 'no-note', 'a terminal no-encounter row did not settle as no-note');
  eq(t.api._notesIdle().rows[0].code, 'no-encounter', 'the terminal row lost its honest reason code');
}

/* ---- 5. a busy lease is a gate, not an attempt/retry spin - in BOTH modes */
async function testBusyLeaseDoesNotSpin() {
  for (const on of [true, false]) {
    const mode = on ? 'Full Notes ON' : 'day-facts (OFF)';
    const h = makeHarness({ fullNotesOn: on, leaseBusy: true });
    ok(h.api._notesIdleEnqueue(PATIENT, DAY, 'pull-in-flight'), 'busy fixture did not enqueue (' + mode + ')');
    for (let i = 0; i < 20; i++) {
      const result = await h.api.notesIdleReadNow();
      eq(result, null, 'a held lease started a body read on busy iteration ' + i + ' (' + mode + ')');
    }
    await flush();
    eq(h.noteCalls.length, 0, 'a held lease caused a visit-body attempt (' + mode + ')');
    eq(h.api._notesIdle().queued, 1, 'a held lease discarded deferred work (' + mode + ')');
    eq(h.api._notesIdle().rows[0].attempts, 0, 'a held lease consumed retry budget without reading (' + mode + ')');
    eq(h.api._notesIdle().gateReason, 'pull-running', 'busy lease was not surfaced as pull-running (' + mode + ')');

    h.setLeaseBusy(false);
    const recovered = await h.api.notesIdleReadNow();
    await flush();
    ok(recovered && recovered.ok === true, 'the queued body did not run after the lease released (' + mode + ')');
    eq(h.noteCalls.length, 1, 'lease release caused more than one body attempt (' + mode + ')');
    eq(h.api._notesIdle().queued, 0, 'the queue did not drain after lease release (' + mode + ')');
  }
}

/* ---- 6. a DAY-FACTS receipt feeds the idle backfill -------------------- */
async function testDayFactsReceiptFeedsTheIdleBackfill() {
  /* the receipt a settled-OFF pull now writes: requested === false, mode
     "day-facts", and a real per-row day-note stage. The pre-1.0.1 feed returned
     0 on exactly this receipt and the notes were lost forever. */
  const receipt = {
    day: DAY,
    visitNotesRequested: false,
    visitNotes: { mode: 'day-facts', requested: false, chartFacts: true },
    patients: [
      /* retryable and unread -> adopt */
      { patientId: PATIENT, name: 'Synthetic Patient', dob: '01/02/1970', mrn: 'SYN-MRN-01',
        todayNote: false, todayNoteReason: 'pull-in-flight' },
      /* already read in the pull -> never queue */
      { patientId: 'pt-2', name: 'Synthetic Patient', todayNote: true },
      /* still the immediate deferred round's row -> not ours yet */
      { patientId: 'pt-3', todayNote: false, todayNoteDeferred: true, todayNoteReason: 'pull-in-flight' },
      /* the day has not reached this appointment -> nothing is owed */
      { patientId: 'pt-4', todayNote: 'not-yet' }
    ]
  };

  const h = makeHarness({ fullNotesOn: false, leaseBusy: false });
  const added = h.api._notesIdleSyncFromReceipt(receipt, DAY);
  eq(added, 1,
    'a day-facts receipt did not feed the idle backfill - niSyncFromReceipt\'s OFF-mode early return is back');

  const after = h.api._notesIdle();
  eq(after.total, 1, 'the day-facts feed adopted rows it does not own');
  eq(after.queued, 1, 'the adopted day-facts row is not queued work');
  eq(after.rows[0].patientId, PATIENT, 'the day-facts feed adopted the wrong row');
  eq(after.rows[0].day, DAY, 'the adopted row lost its day binding');
  eq(after.rows[0].attempts, 0, 'the feed spent an attempt before the row ever ran');
  eq(after.rows[0].code, 'pull-in-flight', 'the adopted row lost the pull\'s honest reason code');
  assertPhiFree(h.persisted(), 'day-facts receipt feed');

  /* and it actually drains, exactly once, on the pulled day only. */
  const drained = await h.api.notesIdleReadNow();
  await flush();
  ok(drained && drained.ok === true, 'the adopted day-facts row did not drain');
  eq(h.noteCalls.length, 1, 'the adopted row drove more than one read');
  eq(h.noteCalls[0].patientId, PATIENT, 'the adopted row drained the wrong patient');
  eq(h.noteCalls[0].onlyDate, DAY, 'the adopted row drained without its onlyDate scope');
  assertPhiFree(h.persisted(), 'day-facts receipt drain');

  /* Stop still outranks the feed: a stopped day may never re-drive Athena. */
  const stopped = makeHarness({ fullNotesOn: false, leaseBusy: false });
  stopped.rt.__mlsPullStopRequested = true;
  eq(stopped.api._notesIdleSyncFromReceipt(receipt, DAY), 0,
    'a day-facts receipt fed the idle backfill after Stop was pressed');
  eq(stopped.api._notesIdle().total, 0, 'Stop did not keep the idle queue empty');
}

/* ---- 7. the UNSCOPED door is no softer than the day-scoped one --------- */
function testUnscopedDoorIsNoSofter() {
  const SIGNATURE = 'function enabled() { /* qol-2.0 ONE RESOLVER';
  const shapes = [
    { label: 'settled ON', choice: { state: 'on', on: true, settled: true }, expect: true },
    { label: 'provisional unsettled on', choice: { state: 'on', on: true, settled: false }, expect: false },
    { label: 'settled OFF', choice: { state: 'off', on: false, settled: true }, expect: false },
    { label: 'never answered', choice: { state: 'unset', on: false, settled: false }, expect: false },
    { label: 'no preference module', choice: null, expect: false }
  ];

  CONNECT_TWINS.forEach(function (file) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const at = source.indexOf(SIGNATURE);
    ok(at >= 0, file + ' no longer carries the ONE RESOLVER __mlsVisitSavePref.enabled()');
    const line = source.slice(at, source.indexOf('\n', at));
    ok(/settled === true/.test(line),
      file + '\'s enabled() no longer requires a SETTLED choice - the unscoped door is softer than the day-scoped one');

    /* EXECUTE it - a grep cannot tell a guard from a comment. */
    shapes.forEach(function (shape) {
      const sandbox = {
        window: shape.choice ? { __mlsVisitNotesPref: { read: () => shape.choice } } : {},
        __out: null
      };
      vm.runInNewContext(line + '\n__out = enabled();', sandbox, { filename: file, timeout: 2000 });
      eq(sandbox.__out, shape.expect,
        file + ': enabled() answered wrong for ' + shape.label);
    });
  });
}

async function main() {
  await testUnchosenIsTheOnlyPreferenceRefusal();
  await testSettledOffDrainsThePulledDayNote();
  await testOnRetriesBoundedAndRecovers();
  await testLadderGivesUpAndTerminalShortCircuits();
  await testBusyLeaseDoesNotSpin();
  await testDayFactsReceiptFeedsTheIdleBackfill();
  testUnscopedDoorIsNoSofter();
  console.log('PASS 1p-todaynote-deferred-retry: ' + checks + ' checks - only an UNCHOSEN account pauses this lane (and it spends no retry budget and stops its own timer); settled OFF drains its pulled-day note through the exact patient/day binding; the revoked "visit-notes-off" refusal is gone from all three twins; ON retries once, gives up at the ceiling and short-circuits a terminal no-encounter; a busy lease gates both modes without spinning; a day-facts receipt feeds the idle backfill while Stop still outranks it; durable queue state is PHI-free; the unscoped enabled() door refuses a provisional unsettled "on" in every twin');
}

const watchdog = setTimeout(() => {
  console.error(new Error('1p-todaynote-deferred-retry runtime test did not finish'));
  process.exit(1);
}, 20000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
