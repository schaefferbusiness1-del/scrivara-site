'use strict';
/* =============================================================================
 * 1p-pull-harness.js  -  shared FAKE-EXTENSION runtime for the /1p pull suites
 *
 * NOT a test file: it exports a harness factory. (tests/run-all.js only rejects
 * unregistered *.test.js files; this is a plain module, required by the suites
 * that need it - the same pattern tests/patch-daynote-foldin.js uses.)
 *
 * It boots the REAL 1p importer (1p-feat_mls_schedimport_exact.js) in a vm with
 * a synthetic window: no network, no extension, no browser, and SYNTHETIC
 * names/DOB/MRN only - never PHI. Every fake is a lever the suites drive:
 *   - chartResult(row, i)      what _assistReadChart resolves/rejects with
 *   - noteResult(patientId, onlyDate)  what the day-note reader answers
 *   - noteDelayMs              how long a day-note read takes (measured cost)
 *   - today                    the account day key (fd-1.0.0 lever)
 *   - leaseBusy                the Athena read lease
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const IMPORTER = path.join(ROOT, '1p-feat_mls_schedimport_exact.js');

function makeHarness(options) {
  options = options || {};
  const day = options.day || '2026-08-17';
  const rowCount = options.rows == null ? 15 : options.rows;
  /* options.store lets a SECOND harness boot over the first one's localStorage,
     which is the only way to drive a same-day RE-PULL through the real engine:
     the day ledger (and therefore dnrs-1.0.0's already-read skip) lives there.
     Absent, every harness gets its own empty store exactly as before. */
  const store = options.store || new Map();
  const listeners = new Set();
  const elements = new Map();
  const timers = [];
  const intervals = [];
  let timerSeq = 0;
  let leaseBusy = options.leaseBusy === true;
  /* the fake clock sits at NOON EASTERN on the account day under test, so
     accountDayFromInstant(now) === the account today the fixture declares.
     A clock in a different year silently defeats every same-day gate. */
  let now = options.startAt || (Date.parse(String(options.today || day) + "T16:00:00Z"));
  const AUTO_FIRE_MAX_MS = options.autoFireMaxMs == null ? 30000 : options.autoFireMaxMs;

  const noteCalls = [];
  const chartCalls = [];
  const statusLines = [];
  let callSeq = 0;               /* shared monotonic order for chart + note reads */

  /* the owner's shape: SCHEDULE-BORN rows - name + DOB only, no MRN, no
     snapshot, no visits. Synthetic identities. */
  /* options.patients carries the STORE across a re-pull the same way
     options.store carries the ledger: the second pull must see the records the
     first one wrote, or "already verified today" can never be true. */
  const patients = options.patients || Array.from({ length: rowCount }, (_, i) => ({
    id: 'syn-' + String(i + 1).padStart(2, '0'),
    name: 'Synthetic Row ' + String(i + 1).padStart(2, '0'),
    dob: '0' + ((i % 9) + 1) + '/1' + (i % 10) + '/197' + (i % 10),
    mrn: options.scheduleBorn === false ? ('SYN-' + String(i + 1).padStart(3, '0')) : '',
    visits: []
  }));
  const rows = patients.map((p, i) => ({
    _mlsTargetPatientId: p.id, patient_external_id: p.id,
    _mlsTargetDob: p.dob, _mlsTargetMrn: p.mrn,
    name: p.name, dob: p.dob, mrn: p.mrn, athenaId: p.mrn,
    appointmentId: 'appt-' + day + '-' + (i + 1),
    date: day, scheduleDate: day,
    /* tny-1.0.0 lever: the appointment's own start time. Absent by default so
       every pre-existing fixture keeps its exact behaviour. */
    time: options.rowTime ? String(options.rowTime(i) || '') : '',
    reason: 'Synthetic pull harness'
  }));

  function fakeElement(tag, id) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(), id: id || '', style: {}, children: [],
      parentNode: null, onclick: null, textContent: '', disabled: false,
      classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
      setAttribute(n, v) { this[n] = String(v); if (n === 'id') { this.id = String(v); elements.set(this.id, this); } },
      getAttribute(n) { return this[n] == null ? null : String(this[n]); },
      appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); if (c.id) elements.set(c.id, c); } return c; },
      insertBefore(c) { return this.appendChild(c); },
      querySelector: () => null, querySelectorAll: () => [],
      remove() { if (this.id) elements.delete(this.id); if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
    };
    Object.defineProperty(node, 'firstElementChild', { get() { return this.children[0] || null; } });
    Object.defineProperty(node, 'innerHTML', {
      get() { return this._innerHTML || ''; },
      set(v) { this._innerHTML = String(v || ''); for (const m of this._innerHTML.matchAll(/\bid="([^"]+)"/g)) this.appendChild(fakeElement('div', m[1])); }
    });
    if (node.id) elements.set(node.id, node);
    return node;
  }
  const body = fakeElement('body'), head = fakeElement('head');

  const clock = { now: () => now, advance: ms => { now += Number(ms) || 0; } };
  function FakeDate(...args) {
    if (!(this instanceof FakeDate)) return new Date(now).toString();
    return args.length ? new Date(...args) : new Date(now);
  }
  FakeDate.now = () => now;
  FakeDate.parse = Date.parse;
  FakeDate.UTC = Date.UTC;
  FakeDate.prototype = Date.prototype;

  const rt = {
    console, Promise, Math, JSON, Intl, Object, Array, String, Number, Boolean,
    RegExp, Error, TypeError, Set, Map, encodeURIComponent, decodeURIComponent, queueMicrotask,
    Date: FakeDate,
    /* SHORT timers (settle waits, the deferred-round ladder) auto-fire on the
       host's macrotask queue so the engine's own `await new Promise(r =>
       arm(now+1800, r))` settle waits cannot hang a suite. LONG timers (every
       absolute deadline: 45 s day-note bound, 90-180 s chart/visits ceilings)
       are held, so a deadline can only fire when a suite fires it on purpose -
       a harness that trips its own deadlines proves nothing. */
    setTimeout(fn, ms) {
      const t = { id: ++timerSeq, fn, ms: Number(ms) || 0, canceled: false, fired: false };
      timers.push(t);
      if (t.ms <= AUTO_FIRE_MAX_MS) {
        setImmediate(() => { if (t.canceled || t.fired) return; t.fired = true; now += t.ms; try { t.fn(); } catch (e) {} });
      }
      return t.id;
    },
    clearTimeout(id) { const t = timers.find(x => x.id === id); if (t) t.canceled = true; },
    /* p1-resume-honesty-1.0.0: intervals are RECORDED, never auto-fired. The
       old resume driver armed a 1 s countdown that started a pull by itself,
       so a suite has to be able to fire that countdown on purpose to prove it
       is gone. Behaviour for existing fixtures is unchanged: nothing fires
       unless a suite calls fireIntervals(). */
    setInterval(fn, ms) { const iv = { id: ++timerSeq, fn, ms: Number(ms) || 0, live: true }; intervals.push(iv); return iv.id; },
    clearInterval(id) { const iv = intervals.find(x => x.id === id); if (iv) iv.live = false; },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    location: { pathname: '/1pScribeFlow.html', origin: 'https://local.invalid' },
    navigator: { userAgent: 'harness' },
    localStorage: {
      getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)); },
      removeItem: k => { store.delete(String(k)); }
    },
    document: {
      readyState: 'complete', visibilityState: 'visible',
      querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => elements.get(String(id)) || null,
      createElement: t => fakeElement(t), addEventListener: () => {}, removeEventListener: () => {},
      body, head, documentElement: head
    },
    _calMode: 'day', _calRefDate: day, _calSelDay: '', _calAppts: [], _calProviders: [], _calMe: null,
    backendMode: () => false, bkToken: () => '', bkBase: () => 'https://local.invalid',
    uns: key => 'p1-harness::' + key,
    _normDate: v => String(v || '').slice(0, 10),
    _normTime: v => String(v || ''),
    _acctTodayKey: () => String(options.today || day),
    getPatients: () => patients,
    upsertPatient: p => { const at = patients.findIndex(x => x.id === p.id); if (at >= 0) patients[at] = p; else patients.push(p); },
    savePatients: () => true,
    loadCalendar: () => Promise.resolve(),
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    __mlsBgSleep: () => Promise.resolve(),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    __mlsVisitNotesPref: { read: () => ({ state: 'off', on: false, settled: true }), write: () => true, isPrefKey: () => false },
    __mlsP1AthenaReadLease: {
      version: 'harness-lease', busy: () => leaseBusy,
      claim: () => 'harness-token', owns: () => true, touch: () => {}, release: () => {}, ready: () => true,
      state: () => ({ kind: leaseBusy ? 'p1-si-managed' : '', draining: leaseBusy, webHeld: false, deadlineAt: 0 })
    },
    __mlsVisitSavePref: {
      runForPatient(p, _onStatus, opts) {
        /* `seq` is a MONOTONIC call counter shared with the chart reads. The
           fake clock only advances when a timer fires, so `at` cannot order
           two calls inside one turn - and "did this note read happen in the
           same visit as its chart open, or in a second pass?" is exactly an
           ORDERING question. */
        const call = { patientId: p && p.id, onlyDate: opts && opts.onlyDate, at: now, seq: ++callSeq };
        noteCalls.push(call);
        /* noteDelayMs may be a FUNCTION of the call number, so a suite can
           reproduce a slow-athena night where each read costs 40-60 s rather
           than one flat figure. A number behaves exactly as before. */
        const delay = typeof options.noteDelayMs === 'function'
          ? Number(options.noteDelayMs(noteCalls.length, p && p.id) || 0)
          : Number(options.noteDelayMs || 0);
        call.costMs = delay;
        if (delay) now += delay;                       /* measured per-row cost */
        const answer = options.noteResult
          ? options.noteResult(p && p.id, opts && opts.onlyDate, noteCalls.length)
          : { ok: true, visits: 1 };
        if (answer && answer.__never) return new Promise(() => {}); /* never answers */
        if (answer && answer.__throw) return Promise.reject(new Error(String(answer.__throw)));
        return Promise.resolve(answer);
      }
    },
    _athenaHistoryTargetSnapshot(ref) {
      const p = patients.find(x => String(x.id) === String(ref && ref.patientId));
      if (!p) return null;
      return Object.freeze({
        patientId: p.id, name: p.name, dob: p.dob, mrn: p.mrn,
        appointmentId: String((ref && ref.appointmentId) || ''),
        scheduleDate: String((ref && ref.scheduleDate) || '')
      });
    },
    _assistReadChart(target, _say, opts) {
      chartCalls.push({ patientId: target && target.patientId, requestId: opts && opts.requestId, at: now, seq: ++callSeq });
      const r = options.chartResult ? options.chartResult(target, chartCalls.length) : null;
      if (r && r.__never) return new Promise(() => {});
      if (r && r.__throw) {
        const err = new Error(String(r.__throw));
        if (r.mlsFind) err.mlsFind = r.mlsFind;
        return Promise.reject(err);
      }
      const text = 'Synthetic chart for ' + target.patientId;
      const rd = {
        ok: true, chartName: target.name, chartDob: target.dob, chartMrn: target.mrn,
        text: text, sections: {}
      };
      /* OPT-IN: a coverage receipt shaped exactly the way verifiedChartCoverage
         demands. Without it (the default) saveOrganizedHistory refuses at
         chart-coverage-unproven, which is what every pre-existing fixture
         relies on - so this option, and nothing else, opens the parse/save
         lane the cap-1.0.0 suites need. */
      if (options.chartCoverage === true) {
        const rid = String((opts && opts.requestId) || '');
        rd.requestId = rid;
        rd.coverageReceipt = {
          kind: 'athena-chart-coverage', complete: true, readerVersion: '2.9.19-chart-r3',
          identityObserved: true, requestId: rid, capturedAt: now,
          expectedClinicalFrames: 3, readClinicalFrames: 3, boundClinicalFrames: 3,
          unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0,
          omittedForCap: 0, truncated: false, textChars: text.length
        };
      }
      return Promise.resolve(rd);
    }
  };
  /* ---------------------------------------------------------------------
     OPT-IN SHELL SEAMS for the cap-1.0.0 lane. Every one of these is off by
     default, so a fixture that does not ask for them behaves exactly as it
     did before. Synthetic identities only.
     --------------------------------------------------------------------- */
  const digits = v => String(v == null ? '' : v).replace(/[^0-9]/g, '');
  const parseCalls = [];
  const saveCalls = [];
  const cardCoverage = new Map();          /* patientId -> the six-card receipt */
  if (options.identityEcho === true || options.chartCoverage === true) {
    /* the REAL gate's shape: name must match and DOB or MRN must be echoed. */
    rt._athenaHistoryProofMatches = (target, observed) => {
      if (!target || !target.patientId) return false;
      const p = patients.find(x => String(x.id) === String(target.patientId));
      if (!p) return false;
      const seenName = String((observed && (observed.chartName || observed.name)) || '').trim();
      const seenDob = digits((observed && (observed.chartDob || observed.dob)) || '');
      const seenMrn = digits((observed && (observed.chartMrn || observed.mrn)) || '');
      if (seenName && seenName !== String(target.name || '')) return false;
      if (seenDob && digits(target.dob) && seenDob !== digits(target.dob)) return false;
      if (seenMrn && digits(target.mrn) && seenMrn !== digits(target.mrn)) return false;
      return !!((seenDob && digits(target.dob) && seenDob === digits(target.dob)) ||
        (seenMrn && digits(target.mrn) && seenMrn === digits(target.mrn)));
    };
    rt._athenaHistoryVerifiedRef = (target, observed) => {
      if (!rt._athenaHistoryProofMatches(target, observed)) return null;
      return Object.freeze({
        patientId: target.patientId, name: target.name, dob: target.dob, mrn: target.mrn,
        verifiedName: String((observed && observed.chartName) || ''),
        verifiedDob: String((observed && observed.chartDob) || ''),
        verifiedMrn: String((observed && observed.chartMrn) || '')
      });
    };
  }
  if (options.parseResult) {
    /* the BACKEND AI seam. Return a chart object, or {__throw, __ai} to
       reproduce a backend refusal exactly as aiCallRaw now shapes it. */
    rt._parsePatientChart = (text, o) => {
      parseCalls.push({ chars: String(text || '').length, requestId: o && o.requestId, at: now });
      const r = options.parseResult(String(text || ''), parseCalls.length);
      if (r && r.__throw) {
        const err = new Error(String(r.__throw));
        if (r.__ai) err.mlsAi = r.__ai;
        return Promise.reject(err);
      }
      return Promise.resolve(r);
    };
    rt._athenaChartProfileCoverage = chart => (chart && chart.__coverageComplete !== false ? { complete: true } : null);
    rt._athenaChartSnapshotFromChart = chart => (chart ? { problems: chart.problems || '', meds: chart.meds || '', summary: chart.summary || '' } : null);
    rt._athenaChartSnapshotProof = snap => (snap ? [snap.problems, snap.meds, snap.summary].join('|') : '');
    rt._patientHistoryCardCoverage = pid => cardCoverage.get(String(pid)) || null;
    rt._savePatientChart = (saveRef, _row, chart) => {
      if (!saveRef || !saveRef.patientId || !saveRef.requestId || !chart) return false;
      const p = patients.find(x => String(x.id) === String(saveRef.patientId));
      if (!p) return false;
      saveCalls.push({ patientId: p.id, requestId: saveRef.requestId, at: now });
      p.problems = chart.problems || '';
      p.meds = chart.meds || '';
      p.summary = chart.summary || '';
      p.athenaChartSnapshot = rt._athenaChartSnapshotFromChart(chart);
      cardCoverage.set(String(p.id), {
        complete: true, exactIdentityVerified: true, capturedAt: now,
        saveRequestId: String(saveRef.requestId),
        cards: { problems: { populated: true }, meds: { populated: true }, allergies: { populated: true }, vitals: { populated: true }, history: { populated: true } }
      });
      return true;
    };
  }
  rt.window = rt;
  rt.addEventListener = (_t, fn) => listeners.add(fn);
  rt.removeEventListener = (_t, fn) => listeners.delete(fn);
  rt.dispatchEvent = () => true;
  const presenceCalls = [];
  rt.postMessage = msg => {
    if (msg && msg.type === 'mlsPing') queueMicrotask(() => {
      const ev = { data: { source: 'mls-ext', type: 'mlsPong', id: msg.id || '', version: options.extVersion || '3.0.62', resp: { ok: true, version: options.extVersion || '3.0.62' } } };
      Array.from(listeners).forEach(fn => fn(ev));
    });
    /* ===== dnbf-1.0.0 seam =====
       The lease-free presence verb, answered EXACTLY as content.js relays it:
       type mlsAthenaPresenceResult, resp with NO requestId (which is why it
       cannot ride bridge()). makeMonthHarness has carried this seam since
       p1-athena-presence-1.0.0; the day harness needs it too, because the
       BACKFILL is where the false "open your signed-in athenaOne" was
       measured. Absent options.presenceResult it answers presence-verified -
       athena is there - which is the pre-existing world for older fixtures.
       Returning null means "never answers": the probe must time out on its
       own, which is a case the backfill has to survive. */
    if (msg && msg.type === 'mlsAthenaPresence') queueMicrotask(() => {
      presenceCalls.push({ at: now });
      const answer = options.presenceResult
        ? options.presenceResult(presenceCalls.length)
        : { ok: true, athenaOpen: true, certain: true, reason: 'presence-verified' };
      if (answer === null) return;
      const ev = { data: { source: 'mls-ext', type: 'mlsAthenaPresenceResult', resp: JSON.parse(JSON.stringify(answer)) } };
      Array.from(listeners).forEach(fn => fn(ev));
    });
  };

  /* options.importerPath boots a DIFFERENT copy of the importer in the same
     world - the only way to run a causal control against origin/main's engine
     with an identical fixture. */
  vm.runInNewContext(fs.readFileSync(options.importerPath || IMPORTER, 'utf8'), rt,
    { filename: String(options.importerPath || '1p-feat_mls_schedimport_exact.js'), timeout: 20000 });

  function runDueTimers(max) {
    let ran = 0;
    for (let guard = 0; guard < (max == null ? 200 : max); guard++) {
      const t = timers.find(x => !x.canceled && !x.fired);
      if (!t) break;
      t.fired = true; ran++;
      try { t.fn(); } catch (e) {}
    }
    return ran;
  }

  /* fire every armed interval `times` times, in arming order. Returns how
     many callbacks ran, so "the countdown is gone" is a NUMBER. */
  function fireIntervals(times) {
    let ran = 0;
    for (let n = 0; n < (times == null ? 1 : times); n++) {
      intervals.slice().forEach(iv => { if (iv.live) { ran++; try { iv.fn(); } catch (e) {} } });
    }
    return ran;
  }

  return {
    rt, api: rt.__mlsSI, rows, patients, day,
    noteCalls, chartCalls, statusLines, presenceCalls, clock, timers, intervals, fireIntervals, runDueTimers, store,
    parseCalls, saveCalls, cardCoverage,
    /* the live progress state the pull panel reads (window.__mlsDayHistoryPull) */
    ppState: () => (rt.__mlsDayHistoryPull && rt.__mlsDayHistoryPull.state) || null,
    setLeaseBusy(v) { leaseBusy = !!v; },
    onStatus: (m) => { statusLines.push(String(m || '')); }
  };
}

async function flush(turns = 80) {
  while (turns-- > 0) { await Promise.resolve(); await new Promise(r => setImmediate(r)); }
}

/* ===== p1-month-harness-1.0.0 (a whole synthetic MONTH, real engine) =====
 * makeHarness() above drives _runHistoryBatch directly: it has no extension
 * bridge, so it can never reach pull()/pullMonth(). The RANGE lane's contract
 * (1p-feat_mls_rangejobs.js -> __mlsSI.pullMonth -> onDayCheckpoint/shouldStop)
 * only exists across that seam, so proving it needs a harness that answers the
 * bridge: goto-date, schedule read, chart read, visits read, and a fake
 * backend that stores appointments by id.
 *
 * Everything below is ADDITIVE. makeHarness is untouched, so the three suites
 * that already depend on it keep their exact behaviour.
 *
 * Still: no network, no extension, no Athena, no PHI - synthetic names/DOB/MRN
 * only, and a FROZEN clock so "today" cannot drift with the wall calendar.
 * ========================================================================== */
function makeMonthHarness(options) {
  options = options || {};
  const account = options.account || 'doctor-syn@example.invalid';
  /* NOON EASTERN on the declared account day. A frozen clock keeps every
     freshness/deadline comparison inside the engine deterministic. */
  const today = options.today || '2026-03-15';
  let nowValue = options.now == null ? Date.parse(today + 'T16:00:00Z') : options.now;

  const store = options.store || new Map();
  const world = options.world || { backendRows: [], savedBodies: [], patients: [], seq: 0 };
  if (!Array.isArray(world.backendRows)) world.backendRows = [];
  if (!Array.isArray(world.savedBodies)) world.savedBodies = [];
  if (!Array.isArray(world.patients)) world.patients = [];
  if (typeof world.seq !== 'number') world.seq = 0;

  const listeners = new Map();
  const posted = [];
  const gotoDates = [];
  const presenceCalls = [];      /* p1-athena-presence-1.0.0 */
  const healthCalls = [];        /* p1-onetab-nav-1.0.0 (athena tab count)    */
  const scheduleReads = [];
  const chartCalls = [];
  const noteCalls = [];
  const statusLines = [];
  const historyRefs = [];
  const rowDays = new Map();          /* date -> [row, ...]                   */
  const incompleteDays = new Set();   /* date -> schedule receipt not complete */
  const scheduleErrorDays = new Set();/* date -> the read itself refuses       */
  const chartFail = new Set();        /* 'date|patientId' -> chart read throws */
  const heldLocks = new Set();
  let loginExpired = false;
  let currentDay = '';

  const provider = {
    stableKey: 'backend:7', id: '7', raw: 'Synthetic_Alpha_MD',
    name: 'Synthetic Alpha, MD', rosterVerified: true
  };
  const roster = [provider];
  let rosterReceipt = { complete: true, partial: false, reason: 'complete', observedCount: 1, reachedEnd: true, restored: true };

  const poolSize = options.poolSize == null ? 24 : options.poolSize;
  if (!world.patients.length) {
    for (let i = 1; i <= poolSize; i++) {
      world.patients.push({
        id: 'syn-' + String(i).padStart(2, '0'),
        name: 'Synthetic Row ' + String(i).padStart(2, '0'),
        dob: '0' + ((i % 9) + 1) + '/1' + (i % 10) + '/197' + (i % 10),
        mrn: 'SYN-' + String(i).padStart(3, '0'),
        athenaId: 'SYN-' + String(i).padStart(3, '0'),
        visits: []
      });
    }
  }
  const patients = world.patients;
  const byId = id => patients.find(p => String(p.id) === String(id)) || null;

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowValue])); }
    static now() { return nowValue; }
  }
  function hostTimer(fn, ms) {
    const t = setTimeout(fn, ms);
    if (t && typeof t.unref === 'function') t.unref();   /* a held 180 s engine
      deadline must never keep the suite's process alive */
    return t;
  }

  function resolveProvider(ref) {
    let raw = ref;
    if (raw && typeof raw === 'object') raw = raw.stableKey || raw.id || raw.raw || raw.name || '';
    raw = String(raw || '');
    if (raw.indexOf('pv:') === 0) raw = decodeURIComponent(raw.slice(3));
    const hits = roster.filter(p => p.stableKey === raw || p.id === raw ||
      p.raw.toLowerCase() === raw.toLowerCase() || p.name.toLowerCase() === raw.toLowerCase());
    return hits.length === 1 ? clone(hits[0]) : null;
  }
  function normTime(value) {
    const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (!m) return '';
    let hour = Number(m[1]);
    if (m[3] && /PM/i.test(m[3]) && hour < 12) hour += 12;
    if (m[3] && /AM/i.test(m[3]) && hour === 12) hour = 0;
    return String(hour).padStart(2, '0') + ':' + m[2];
  }
  function emit(type, resp, id) {
    const event = { data: { source: 'mls-ext', type, id: id || '', resp } };
    Array.from(listeners.get('message') || []).forEach(fn => fn(event));
  }
  function scheduleResponse(day, requestId) {
    scheduleReads.push(day);
    /* Two DIFFERENT unreadable days, exactly as the extension reports them:
       a signed-out athenaOne carries the bounded session probe verdict
       (sessionLikelyExpired), a grid that simply never answered does not. */
    if (loginExpired) {
      return { id: requestId, ok: false, schedDate: day, appts: [], text: '',
        error: 'MLS could not find a signed-in athenaOne tab.', sessionLikelyExpired: true };
    }
    if (scheduleErrorDays.has(day)) {
      return { id: requestId, ok: false, schedDate: day, appts: [], text: '',
        error: 'The athenaOne schedule grid did not answer.' };
    }
    if (incompleteDays.has(day)) {
      return { id: requestId, ok: true, schedDate: day, text: 'partial schedule', appts: [],
        receipt: { complete: false, authoritativeEmpty: false, parsedCount: 0, candidateCount: 1, expectedCount: 1 } };
    }
    const appts = rowDays.has(day) ? clone(rowDays.get(day)) : [];
    return {
      id: requestId, ok: true, schedDate: day,
      text: appts.length ? 'Verified Day schedule ' + day : '',
      appts,
      providers: [provider.name],
      providerRoster: clone(roster),
      providerRosterReceipt: clone(rosterReceipt),
      providerDiag: { providerNames: [provider.name] },
      receipt: {
        complete: true, authoritativeEmpty: appts.length === 0, requestId: requestId,
        parsedCount: appts.length, candidateCount: appts.length, expectedCount: appts.length,
        liveSessionProven: true, scheduleVerified: true
      }
    };
  }

  const rt = {
    console, Promise, Math, JSON, Intl, Object, Array, String, Number, Boolean,
    RegExp, Error, TypeError, Set, Map, isFinite, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent, queueMicrotask,
    Date: FakeDate,
    setTimeout: hostTimer, clearTimeout,
    setInterval: () => 1, clearInterval: () => {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    location: { pathname: '/1pScribeFlow.html', origin: 'https://local.invalid' },
    navigator: {
      userAgent: 'harness',
      locks: {
        request(name, lockOptions, callback) {
          const ifAvailable = !!(lockOptions && lockOptions.ifAvailable);
          if (heldLocks.has(name)) return Promise.resolve().then(() => callback(ifAvailable ? null : null));
          heldLocks.add(name);
          return Promise.resolve()
            .then(() => callback({ name }))
            .then(value => { heldLocks.delete(name); return value; },
                  error => { heldLocks.delete(name); throw error; });
        }
      }
    },
    __MLS_P1_PREVIEW: { enabled: true, route: '/1p/', build: 'synthetic-p1-build' },
    __MLS_AV: 'synthetic-p1-build',
    __mlsSessionAccount: account,
    session: { email: account },
    localStorage: {
      getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => {
        if (options.quotaThrows && options.quotaThrows(String(k), String(v))) {
          const e = new Error('full'); e.name = 'QuotaExceededError'; throw e;
        }
        store.set(String(k), String(v));
      },
      removeItem: k => { store.delete(String(k)); },
      key: i => Array.from(store.keys())[i] || null,
      get length() { return store.size; }
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      readyState: 'complete', visibilityState: 'visible', hidden: false,
      querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
      createElement: () => ({ id: '', style: {}, setAttribute() {}, appendChild() {}, textContent: '' }),
      addEventListener: () => {}, removeEventListener: () => {},
      body: null, head: { appendChild: () => {} }, documentElement: { appendChild: () => {} }
    },
    _calMode: 'day', _calRefDate: today, _calSelDay: '', _calAppts: [], _calProviders: roster, _calMe: null,
    __mlsProviderRoster: {
      list: () => clone(roster), resolve: resolveProvider,
      beginOperation: op => { rt.__armedRosterOperation = Object.assign({}, op); return rt.__armedRosterOperation; },
      getReceipt: () => Object.assign(clone(rosterReceipt), rt.__armedRosterOperation ? {
        targetDate: rt.__armedRosterOperation.targetDate, requestId: rt.__armedRosterOperation.requestId,
        providerMode: rt.__armedRosterOperation.providerMode,
        requestedProviderId: rt.__armedRosterOperation.requestedProviderId,
        requestedProviderStableKey: rt.__armedRosterOperation.requestedProviderStableKey
      } : {})
    },
    backendMode: () => true, bkToken: () => 'synthetic-token', bkBase: () => 'https://local.invalid',
    uns: key => 'sf_u::' + account + '::' + key,
    _normDate: v => String(v || '').slice(0, 10),
    _normTime: normTime,
    _acctTodayKey: () => today,
    _apptKey: (n, d, t) => String(n || '').trim().toLowerCase() + '|' + d + '|' + normTime(t),
    _acctWallToUtcIso: (d, t) => d + 'T' + t + ':00.000Z',
    getPatients: () => patients,
    upsertPatient: next => {
      const at = patients.findIndex(p => String(p.id) === String(next.id));
      if (at >= 0) patients[at] = next; else patients.push(next);
    },
    savePatients: () => true,
    loadCalendar: () => { rt._calAppts = world.backendRows.map(clone); return Promise.resolve(); },
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    dispatchEvent: () => true,
    __mlsBgSleep: () => Promise.resolve(),
    __mlsVisitNotesPref: { read: () => ({ state: 'off', on: false, settled: true }), write: () => true, isPrefKey: () => false },
    __mlsVisitSavePref: {
      runForPatient(p, _onStatus, opts) {
        noteCalls.push({ patientId: p && p.id, onlyDate: opts && opts.onlyDate, at: nowValue });
        return Promise.resolve({ ok: true, visits: 1 });
      }
    },
    __mlsP1AthenaReadLease: {
      version: 'harness-lease', busy: () => false,
      claim: () => 'harness-token', owns: () => true, touch: () => {}, release: () => {}, ready: () => true,
      state: () => ({ kind: '', draining: false, webHeld: false, deadlineAt: 0 })
    },
    _athenaHistoryTargetSnapshot: ref => {
      historyRefs.push(clone(ref));
      const p = byId(ref && ref.patientId);
      if (!p) return null;
      return Object.freeze({
        patientId: p.id, name: p.name, dob: p.dob, mrn: p.mrn,
        appointmentId: String((ref && ref.appointmentId) || ''),
        scheduleDate: String((ref && ref.scheduleDate) || '')
      });
    },
    _hasImportedHistory: t => !!byId(t && t.patientId),
    _athenaHistoryProofMatches: (t, observed) => {
      const p = byId(t && t.patientId);
      return !!(p && observed.chartName === p.name && observed.chartDob === p.dob && observed.chartMrn === p.mrn);
    },
    _assistReadChart: (target, _say, opts) => {
      chartCalls.push({ patientId: target && target.patientId, day: currentDay, at: nowValue });
      if (chartFail.has(currentDay + '|' + String(target && target.patientId))) {
        return Promise.reject(new Error('athenaOne patient search found no matching patient.'));
      }
      const p = byId(target && target.patientId);
      const requestId = String((opts && opts.requestId) || ('chart-' + chartCalls.length));
      const text = 'Verified chart problems medications allergies and clinical history';
      return Promise.resolve({
        text, requestId, chartName: p.name, chartDob: p.dob, chartMrn: p.mrn,
        coverageReceipt: {
          kind: 'athena-chart-coverage', complete: true, readerVersion: '2.9.19-chart-r3',
          identityObserved: true, truncated: false, requestId, capturedAt: nowValue,
          expectedClinicalFrames: 1, readClinicalFrames: 1, boundClinicalFrames: 1,
          unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0, textChars: text.length
        }
      });
    },
    _parsePatientChart: () => Promise.resolve({
      problems: 'Verified problem', meds: 'Verified med', allergies: 'Verified allergy', summary: 'Verified summary',
      vitals: { bp: '120/80' }, history: { pmh: 'Verified PMH' },
      coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
    }),
    _athenaChartProfileCoverage: () => ({ complete: true }),
    _athenaChartSnapshotFromChart: c => ({
      problems: String(c.problems || ''), meds: String(c.meds || ''), allergies: String(c.allergies || ''),
      summary: String(c.summary || ''), vitals: Object.assign({}, c.vitals || {}), history: Object.assign({}, c.history || {}), visits: []
    }),
    _athenaChartSnapshotProof: s => JSON.stringify(s || {}),
    _athenaHistoryVerifiedRef: t => Object.freeze({
      patientId: t.patientId, name: t.name, dob: t.dob, mrn: t.mrn,
      verifiedName: t.name, verifiedDob: t.dob, verifiedMrn: t.mrn
    }),
    _savePatientChart: (ref, _row, chart) => {
      const p = byId(ref && ref.patientId);
      if (!p) return false;
      p.athenaChartSnapshot = rt._athenaChartSnapshotFromChart(chart);
      p.problems = chart.problems; p.summary = chart.summary;
      p.athenaProfileCoverage = {
        complete: true, exactIdentityVerified: true, patientId: p.id,
        capturedAt: new FakeDate().toISOString(), saveRequestId: String((ref && ref.requestId) || ''),
        cards: {
          problems: { populated: true }, meds: { populated: true }, allergies: { populated: true },
          summary: { populated: true }, vitals: { populated: true }, history: { populated: true }
        }
      };
      return true;
    },
    /* the engine calls this with a bare patientId STRING, never an object */
    _patientHistoryCardCoverage: t => {
      const key = (t && typeof t === 'object') ? (t.patientId || t.id) : t;
      const p = byId(key);
      return (p && p.athenaProfileCoverage) || null;
    },
    __mlsVisitModel: {
      addVisit: (id, raw) => {
        const p = byId(id);
        if (p && !p.visits.some(v => v.sourceVisitKey === raw.sourceVisitKey)) p.visits.push(raw);
        return raw;
      },
      getVisits: id => (byId(id) || { visits: [] }).visits,
      reconcileVerifiedAthenaVisits: () => ({ complete: true, removed: 0, retained: 0 }),
      organizePatientHistory: () => ({ ok: true, complete: true, verifiedVisits: 1 })
    },
    __mlsCopyVisits: {
      _saveVisits: (p, _identity, visits) => {
        const target = byId(p && (p.id || p));
        let added = 0;
        if (!target) return 0;
        visits.forEach(v => {
          if (!target.visits.some(old => old.sourceVisitKey === v.sourceVisitKey)) {
            target.visits.push(Object.assign({}, v, {
              source: 'athena-schedule-history', identityVerified: true, identityBinding: target.id,
              indexOnly: false, fullDetail: true, bodyComplete: true
            }));
            added++;
          }
        });
        return added;
      },
      _visitIdentityAgrees: () => true
    },
    fetch: async (url, init) => {
      if (!init || !init.method) {
        return { ok: true, status: 200, json: async () => ({ appointments: world.backendRows.map(clone) }) };
      }
      const body = JSON.parse(init.body || '{}');
      const update = String(url).match(/\/api\/appointments\/([^/]+)\/update$/);
      if (update) {
        const id = decodeURIComponent(update[1]);
        const row = world.backendRows.find(one => String(one.id) === id);
        if (row) Object.assign(row, body);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const id = 'syn-backend-' + (++world.seq);
      world.savedBodies.push(clone(body));
      world.backendRows.push(Object.assign({ id }, clone(body)));
      return { ok: true, status: 200, json: async () => ({ ok: true, id }) };
    }
  };
  rt.window = rt;
  rt.addEventListener = (type, fn) => {
    const key = String(type);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
  };
  rt.removeEventListener = (type, fn) => {
    const set = listeners.get(String(type));
    if (set) set.delete(fn);
  };
  rt.postMessage = msg => {
    posted.push(clone(msg));
    if (msg.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true, version: options.extVersion || '3.0.62' }, msg.id || ''));
    /* ===== p1-athena-presence-1.0.0 seam =====
       The lease-free presence verb, answered EXACTLY as content.js relays it:
       type mlsAthenaPresenceResult, resp with NO requestId. Absent
       options.presenceResult it answers presence-verified (an athena that is
       there), which is the pre-existing world for every older fixture.
       Returning null from the hook means "never answers" - the probe must then
       fall through on its own timeout. */
    if (msg.type === 'mlsAthenaPresence') queueMicrotask(() => {
      presenceCalls.push({ at: nowValue });
      const answer = options.presenceResult
        ? options.presenceResult(presenceCalls.length)
        : { ok: true, athenaOpen: true, certain: true, reason: 'presence-verified' };
      if (answer === null) return;
      Array.from(listeners.get('message') || []).forEach(fn => fn({ data: { source: 'mls-ext', type: 'mlsAthenaPresenceResult', resp: clone(answer) } }));
    });
    /* the PHI-free athena tab count (background.js mlsExtHealthRequest) */
    if (msg.type === 'mlsExtHealth') queueMicrotask(() => {
      healthCalls.push({ at: nowValue });
      const tabs = options.athenaTabs == null ? 1 : Number(options.athenaTabs);
      emit('mlsExtHealthResult', { ok: true, requestId: msg.id, athena: { tabs: tabs, discarded: 0 } }, msg.id);
    });
    if (msg.type === 'mlsAppGotoDate') queueMicrotask(() => {
      gotoDates.push(msg.date);
      /* options.gotoResult(day, attemptNumber) overrides the answer so a suite
         can reproduce a no-athena-tab / empty-week-strip goto exactly. */
      const override = options.gotoResult ? options.gotoResult(msg.date, gotoDates.length) : null;
      if (!override) {
        currentDay = msg.date;
        emit('mlsAppGotoDateResult', { id: msg.id, requestId: msg.id, ok: true, schedDate: msg.date }, msg.id);
        return;
      }
      if (override.ok !== false) currentDay = msg.date;
      emit('mlsAppGotoDateResult', Object.assign({ id: msg.id, requestId: msg.id }, clone(override)), msg.id);
    });
    if (msg.type === 'mlsAppPullSchedule') queueMicrotask(() => {
      const base = scheduleResponse(currentDay, msg.id);
      const override = options.scheduleResult ? options.scheduleResult(base, currentDay, scheduleReads.length) : null;
      emit('mlsAppScheduleResult', override ? Object.assign({ id: msg.id, requestId: msg.id }, clone(override)) : base, msg.id);
    });
    if (msg.type === 'mlsAppReadAllVisits') queueMicrotask(() => {
      Array.from(listeners.get('message') || []).forEach(fn => fn({ data: {
        source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: msg.id, requestId: msg.requestId, ok: true,
        visits: [{ date: '2025-12-01', type: 'Office visit', raw: 'Synthetic prior visit with substantive clinical detail.', fullDetail: true, sourceVisitKey: 'row:syn-prior-1' }],
        receipt: { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, stableKeysComplete: true, expected: 1, parsed: 1, cap: 500, readerVersion: '2.9.22-visits-r4-two-stage' },
        readerVersion: '2.9.22-visits-r4-two-stage'
      } }));
    });
  };

  vm.createContext(rt);
  vm.runInContext(fs.readFileSync(options.importerPath || IMPORTER, 'utf8'), rt,
    { filename: String(options.importerPath || '1p-feat_mls_schedimport_exact.js'), timeout: 20000 });

  const api = {
    rt, api: rt.__mlsSI, store, world, patients, provider, today, account,
    posted, gotoDates, scheduleReads, chartCalls, noteCalls, statusLines, historyRefs,
    presenceCalls, healthCalls,
    rowDays, incompleteDays, scheduleErrorDays, chartFail,
    onStatus: (m, k) => { statusLines.push(String(m || '')); void k; },
    runInContext(source, filename) { return vm.runInContext(source, rt, { filename: filename || 'inline', timeout: 20000 }); },
    installRangeJobs() {
      vm.runInContext(fs.readFileSync(path.join(ROOT, '1p-feat_mls_rangejobs.js'), 'utf8'), rt,
        { filename: '1p-feat_mls_rangejobs.js', timeout: 20000 });
      return rt.__mlsP1RangeJobs;
    },
    /* one synthetic clinic day: `count` rows drawn from the shared pool */
    seedDay(date, count) {
      const rows = [];
      for (let i = 0; i < count; i++) {
        const p = patients[i % patients.length];
        rows.push({
          name: p.name, dob: p.dob, mrn: p.mrn,
          athenaPatientId: 'athena-' + p.id, patient_external_id: p.id,
          athenaAppointmentId: 'athena-appt-' + date + '-' + p.id,
          athenaProviderId: provider.id, date: date,
          time: (8 + i) + ':00 AM', reason: 'Synthetic pull harness', provider: provider.raw
        });
      }
      rowDays.set(date, rows);
      return rows;
    },
    setLoginExpired(v) { loginExpired = !!v; },
    /* a job that settled must have handed back every Web Lock it took */
    locksHeld() { return Array.from(heldLocks); },
    monthOwnerKey() { return 'sf_u::' + account + '::p1MonthPullOwnerV1'; },
    setNow(v) { nowValue = v; },
    now() { return nowValue; },
    dispatch(type, detail) {
      Array.from(listeners.get(String(type)) || []).forEach(fn => fn({ type: String(type), detail: detail || {} }));
    },
    manifestKey() { return 'sf_u::' + account + '::p1RangeJobV1'; },
    manifest() {
      const raw = store.get(api.manifestKey());
      return raw ? JSON.parse(raw) : null;
    },
    /* the store census the owner's proof asks for: distinct backend rows */
    census() {
      const ids = new Set(world.backendRows.map(r => String(r.id)));
      const appts = new Set(world.backendRows.map(r => String(r.athena_appointment_id || '') + '|' + String(r.date || r.start_at || '')));
      return { rows: world.backendRows.length, uniqueIds: ids.size, uniqueAppointments: appts.size,
        patientsWithContent: patients.filter(p => p.summary || p.problems).length };
    }
  };
  return api;
}
/* ===== end p1-month-harness-1.0.0 ===== */

module.exports = { makeHarness, makeMonthHarness, flush, ROOT, IMPORTER };
