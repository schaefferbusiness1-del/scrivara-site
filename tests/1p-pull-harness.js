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
  const store = new Map();
  const listeners = new Set();
  const elements = new Map();
  const timers = [];
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

  /* the owner's shape: SCHEDULE-BORN rows - name + DOB only, no MRN, no
     snapshot, no visits. Synthetic identities. */
  const patients = Array.from({ length: rowCount }, (_, i) => ({
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
    setInterval: () => ++timerSeq, clearInterval: () => {},
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
        const call = { patientId: p && p.id, onlyDate: opts && opts.onlyDate, at: now };
        noteCalls.push(call);
        const delay = Number(options.noteDelayMs || 0);
        if (delay) now += delay;                       /* measured per-row cost */
        const answer = options.noteResult
          ? options.noteResult(p && p.id, opts && opts.onlyDate, noteCalls.length)
          : { ok: true, visits: 1 };
        if (answer && answer.__never) return new Promise(() => {}); /* never answers */
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
      chartCalls.push({ patientId: target && target.patientId, requestId: opts && opts.requestId, at: now });
      const r = options.chartResult ? options.chartResult(target, chartCalls.length) : null;
      if (r && r.__never) return new Promise(() => {});
      if (r && r.__throw) {
        const err = new Error(String(r.__throw));
        if (r.mlsFind) err.mlsFind = r.mlsFind;
        return Promise.reject(err);
      }
      return Promise.resolve({
        ok: true, chartName: target.name, chartDob: target.dob, chartMrn: target.mrn,
        text: 'Synthetic chart for ' + target.patientId, sections: {}
      });
    }
  };
  rt.window = rt;
  rt.addEventListener = (_t, fn) => listeners.add(fn);
  rt.removeEventListener = (_t, fn) => listeners.delete(fn);
  rt.dispatchEvent = () => true;
  rt.postMessage = msg => {
    if (msg && msg.type === 'mlsPing') queueMicrotask(() => {
      const ev = { data: { source: 'mls-ext', type: 'mlsPong', id: msg.id || '', version: options.extVersion || '3.0.62', resp: { ok: true, version: options.extVersion || '3.0.62' } } };
      Array.from(listeners).forEach(fn => fn(ev));
    });
  };

  vm.runInNewContext(fs.readFileSync(IMPORTER, 'utf8'), rt, { filename: '1p-feat_mls_schedimport_exact.js', timeout: 20000 });

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

  return {
    rt, api: rt.__mlsSI, rows, patients, day,
    noteCalls, chartCalls, statusLines, clock, timers, runDueTimers, store,
    setLeaseBusy(v) { leaseBusy = !!v; },
    onStatus: (m) => { statusLines.push(String(m || '')); }
  };
}

async function flush(turns = 80) {
  while (turns-- > 0) { await Promise.resolve(); await new Promise(r => setImmediate(r)); }
}

module.exports = { makeHarness, flush, ROOT, IMPORTER };
