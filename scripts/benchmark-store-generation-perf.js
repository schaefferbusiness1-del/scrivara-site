'use strict';

/* Node/VM A/B for the exact-key generation lane.
 *
 * The control is not a cheaper handwritten approximation: it executes the
 * same production consumers with verFor removed, which exercises their exact
 * legacy api.ver() fallback. Timed work excludes source parsing/VM setup.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const helperStart = app.indexOf('var __mlsNotesIdx={ver:-1,map:null};');
const helperEnd = app.indexOf('/* ---------- SERVER SYNC (hosted mode only) ----------', helperStart);
const chartModule = connect.indexOf('MLS Scribe - PULLED-CHART STRUCTURING');
const chartStart = connect.indexOf('  function sweep() {', chartModule);
const chartEnd = connect.indexOf('\n\n  /* ---------- install', chartStart);
const scrubModule = connect.indexOf('CONTINUOUS SUMMARY SCRUB');
const scrubStart = connect.indexOf('  function scrub() {', scrubModule);
const scrubEnd = connect.indexOf('\n\n  var iv = null;', scrubStart);
const cacheEndMarker = 'window.__mlsStoreCache = api;\n})();';
const cacheEnd = connect.indexOf(cacheEndMarker);
const embeddedCache = connect.slice(0, cacheEnd + cacheEndMarker.length);
assert(helperStart > 0 && helperEnd > helperStart, 'notes/history helpers missing');
assert(chartStart > chartModule && chartEnd > chartStart, 'chart sweep missing');
assert(scrubStart > scrubModule && scrubEnd > scrubStart, 'continuous scrub missing');
assert(cacheEnd > 0, 'embedded production store cache missing');

function patientsFixture() {
  return Array.from({ length: 800 }, (_, i) => ({
    id: 'p' + i,
    name: 'Patient ' + String(i).padStart(4, '0'),
    dob: '01/01/1980',
    mrn: 'M' + String(i).padStart(5, '0'),
    summary: 'Stable synthetic clinical summary ' + 'x'.repeat(100),
    _mlsStructuredV1: 1
  }));
}
function notesFixture() {
  return Array.from({ length: 2250 }, (_, i) => ({
    id: 'n' + i,
    patientId: 'p' + (i % 800),
    patient: 'Patient ' + String(i % 800).padStart(4, '0'),
    cc: 'Follow up ' + (i % 17),
    text: 'Synthetic clinical body ' + i + ' ' + 'detail medication assessment plan '.repeat(16),
    created: 1754000000000 + i,
    updated: 1754000000000 + i
  }));
}

function runScenario(scoped) {
  const patients = patientsFixture();
  const notes = notesFixture();
  const counts = { notesMaps: 0, histories: 0, visitRanks: 0, patientReads: 0, chartRows: 0, scrubRows: 0 };
  const sanitizer = { strip(value) { return value; }, hasCode() { counts.scrubRows++; return false; } };
  const accountPrefix = 'sf_u::benchmark-account::';
  const patientRaw = JSON.stringify(patients);
  const noteRaw = JSON.stringify(notes);
  const backing = Object.assign(Object.create(null), {
    [accountPrefix + 'patients']: patientRaw,
    [accountPrefix + 'notes']: noteRaw
  });
  let localStorage;
  const storageProto = {
    getItem(key) {
      if (this !== localStorage) throw new TypeError('Illegal Storage receiver');
      const resolved = String(key);
      return Object.prototype.hasOwnProperty.call(backing, resolved) ? backing[resolved] : null;
    },
    setItem(key, value) {
      if (this !== localStorage) throw new TypeError('Illegal Storage receiver');
      backing[String(key)] = String(value);
    },
    removeItem(key) {
      if (this !== localStorage) throw new TypeError('Illegal Storage receiver');
      delete backing[String(key)];
    },
    clear() {
      if (this !== localStorage) throw new TypeError('Illegal Storage receiver');
      Object.keys(backing).forEach(key => delete backing[key]);
    }
  };
  localStorage = Object.create(storageProto);
  const listeners = Object.create(null);
  const window = {
    localStorage,
    __mlsSummarySanitize: sanitizer,
    __mlsContinuousScrub: { version: '1.0.0', cleaned: 0 },
    uns(suffix) { return accountPrefix + suffix; },
    getPatients() { counts.patientReads++; return patients.slice(); },
    getNotes() { return notes.slice(); },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter(candidate => candidate !== fn);
    }
  };
  const context = {
    window,
    document: { hidden: false },
    getNotes() { return window.getNotes(); },
    getPatients() { return window.getPatients(); },
    uns(suffix) { return window.uns(suffix); },
    localStorage,
    __mlsPtsBatchByKey: Object.create(null),
    __mlsPtsMemo: { key: window.uns('patients'), raw: patientRaw },
    STATS: { structured: 0, savesWrapped: 0, sweepPasses: 0 },
    API: { summaryMode: 'digest' },
    needsWork() { counts.chartRows++; return false; },
    sweepPatient() { throw new Error('clean benchmark patient reached sweepPatient'); },
    persistSweep() { throw new Error('clean benchmark roster reached persistence'); },
    isFn(fn) { return typeof fn === 'function'; },
    setTimeout, clearTimeout, Date, Map, Object, Number, String, Array, isFinite,
    console: { log() {} }
  };
  vm.createContext(context);
  /* Both legs install the real production cache. The control then hides only
     verFor from consumers, exercising their actual legacy global fallback;
     the candidate pays the real length-prefixed stamp construction cost. */
  vm.runInContext(embeddedCache, context, { filename: 'embedded-store-cache.js' });
  const productionCache = window.__mlsStoreCache;
  assert(productionCache && typeof productionCache.verFor === 'function', 'production verFor did not install');
  if (!scoped) window.__mlsStoreCache = { ver() { return productionCache.ver(); } };
  vm.runInContext(app.slice(helperStart, helperEnd) + `
    this.perfApi={
      patientNotes:patientNotes,
      noteMap:function(){return __mlsNotesIdx.map;},
      roster:__mlsPtRosterData,
      visits:__mlsPtVisitRows,
      history:__mlsHistoryData,
      search:__mlsHistorySearchBase
    };`, context, { filename: scoped ? 'scoped-notes-history.js' : 'global-notes-history.js' });
  vm.runInContext(connect.slice(chartStart, chartEnd) + '\nthis.runChartSweep=sweep;', context,
    { filename: scoped ? 'scoped-chart.js' : 'global-chart.js' });
  vm.runInContext(connect.slice(scrubStart, scrubEnd) + '\nthis.runContinuousScrub=scrub;', context,
    { filename: scoped ? 'scoped-scrub.js' : 'global-scrub.js' });

  const api = context.perfApi;
  const roster = api.roster(patients);
  api.patientNotes('p0');
  let priorMap = api.noteMap();
  let priorVisits = api.visits(roster);
  let priorHistory = api.history(notes);
  for (let i = 0; i < 200; i++) api.search(priorHistory, priorHistory.ordered[i]);
  context.runChartSweep();
  context.runContinuousScrub();
  const warmTimerCounts = {
    patientReads: counts.patientReads,
    chartRows: counts.chartRows,
    scrubRows: counts.scrubRows
  };

  const started = process.hrtime.bigint();
  for (let iteration = 0; iteration < 100; iteration++) {
    /* Represents a write to an unrelated preference/status key: legacy VER
       changes, but none of the exact patients/notes/templates stamps do. */
    localStorage.setItem(window.uns('ui-status'), String(iteration));
    api.patientNotes('p0');
    const map = api.noteMap();
    if (map !== priorMap) { counts.notesMaps++; priorMap = map; }
    const visits = api.visits(roster);
    if (visits !== priorVisits) { counts.visitRanks++; priorVisits = visits; }
    const history = api.history(notes);
    if (history !== priorHistory) { counts.histories++; priorHistory = history; }
    for (let i = 0; i < 200; i++) api.search(history, history.ordered[i]);
    context.runChartSweep();
    context.runContinuousScrub();
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  counts.patientReads -= warmTimerCounts.patientReads;
  counts.chartRows -= warmTimerCounts.chartRows;
  counts.scrubRows -= warmTimerCounts.scrubRows;
  return { mode: scoped ? 'exact-key candidate' : 'global-VER reverted control', elapsedMs, counts };
}

const control = runScenario(false);
const candidate = runScenario(true);
assert.deepStrictEqual(candidate.counts,
  { notesMaps: 0, histories: 0, visitRanks: 0, patientReads: 0, chartRows: 0, scrubRows: 0 },
  'candidate rebuilt/scanned after unrelated writes');
assert.deepStrictEqual(control.counts,
  { notesMaps: 100, histories: 100, visitRanks: 100, patientReads: 200, chartRows: 80000, scrubRows: 80000 },
  'global fallback control did not reproduce the former invalidation tax');
const avoidedMs = control.elapsedMs - candidate.elapsedMs;
assert(avoidedMs >= 10,
  'exact-key lane did not eliminate the required realistic >=10ms in this 100-write clinic-scale run: ' + avoidedMs.toFixed(2) + 'ms');

console.log(JSON.stringify({
  corpus: { patients: 800, notes: 2250, unrelatedWrites: 100, historyRowsSearchedPerWrite: 200 },
  control,
  candidate,
  avoidedMs: Number(avoidedMs.toFixed(2)),
  speedup: Number((control.elapsedMs / Math.max(candidate.elapsedMs, 0.001)).toFixed(2))
}, null, 2));
