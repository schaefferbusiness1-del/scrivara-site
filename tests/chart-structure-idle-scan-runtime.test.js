#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const MAX_ROWS_PER_IDLE_TURN = 8;
const sourceRefArg = process.argv.find(arg => arg.indexOf('--source-ref=') === 0);
const sourceRef = sourceRefArg ? sourceRefArg.slice('--source-ref='.length) : '';
const connect = sourceRef
  ? childProcess.execFileSync('git', ['show', sourceRef + ':mls-connect.js'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  : fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const marker = connect.indexOf(startMarker);
  const start = connect.indexOf('(function () {', marker);
  const end = connect.indexOf(endMarker, start);
  assert(marker >= 0 && start >= 0 && end > start, 'production source section not found: ' + startMarker);
  return connect.slice(start, end);
}

const queueSource = sourceBetween(
  'MLS Scribe - INPUT-AWARE PATIENT MAINTENANCE PERSISTENCE',
  '/* =============================================================================\n * MLS Scribe - PULLED-CHART STRUCTURING'
);
const chartMarker = connect.indexOf('MLS Scribe - PULLED-CHART STRUCTURING');
const chartStart = connect.indexOf('(function () {', chartMarker);
const nextModule = connect.indexOf('/* The old Visit-tab Pay Report', chartStart);
const chartClose = connect.lastIndexOf('})();', nextModule);
assert(chartMarker >= 0 && chartStart >= 0 && nextModule > chartStart && chartClose > chartStart,
  'Chart Structure production module not found');
const chartSource = connect.slice(chartStart, chartClose + '})();'.length);
const sweepStart = chartSource.indexOf('function sweep()');
const sweepEnd = chartSource.indexOf('/* ---------- install', sweepStart);
const automaticSweepSource = chartSource.slice(sweepStart, sweepEnd);
const chunkMatch = automaticSweepSource.match(/chunkSize\s*:\s*(\d+)/);
const configuredChunkSize = chunkMatch ? Number(chunkMatch[1]) : MAX_ROWS_PER_IDLE_TURN;

function makeEventTarget() {
  const listeners = Object.create(null);
  return {
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter(item => item !== fn);
    },
    dispatch(type, event) {
      for (const fn of (listeners[type] || []).slice()) fn(event || { type });
    }
  };
}

function makeHarness() {
  const account = 'chart-scan@example.test';
  const token = 'chart-scan-token';
  const patientKey = 'sf_u::' + account + '::patients';
  const store = new Map([[patientKey, 'roster-generation-a']]);
  const deferred = [];
  const intervals = [];
  const timeouts = [];
  const saves = [];
  const windowEvents = makeEventTarget();
  const documentEvents = makeEventTarget();
  let timerId = 0;
  let storeVersion = 1;
  let inputPending = true;
  let rosterReads = 0;
  let rowChecks = 0;
  let summaryReads = 0;
  let profileRenders = 0;
  let visitRenders = 0;

  const rawChart = [
    'History of Present Illness:',
    'Patient reports persistent low back pain with right leg numbness, sleep disruption, and difficulty walking. '.repeat(5),
    'Problems:',
    'Lumbar radiculopathy',
    'Lumbar spondylosis',
    'Medications:',
    'Gabapentin 300 mg nightly',
    'Meloxicam 7.5 mg daily',
    'Allergies:',
    'NKDA'
  ].join('\n');
  assert(rawChart.length > 400, 'fixture stopped representing a full chart dump');
  const stableLargeSummary = ('Routine follow-up narrative without imported chart section labels. ' +
    'The patient is stable and this text must remain untouched. ').repeat(40).slice(0, 4400);
  const dirtyIndexes = [0, 777, 1570];
  const rosterPayloadChars = rawChart.length * dirtyIndexes.length + stableLargeSummary.length * (1571 - dirtyIndexes.length);
  assert(rosterPayloadChars >= 6.5 * 1024 * 1024, 'fixture stopped representing the 6.5 MB live roster');

  function trackedPatient(index, dirty) {
    let summary = dirty ? rawChart : stableLargeSummary;
    const patient = {
      id: 'patient-' + index,
      name: 'Patient ' + index,
      problems: '',
      meds: '',
      allergies: '',
      insurance: {},
      visits: [],
      updated: 1
    };
    Object.defineProperty(patient, 'summary', {
      configurable: true,
      enumerable: true,
      get() { summaryReads++; return summary; },
      set(value) { summary = value; }
    });
    Object.defineProperty(patient, '_mlsStructuredV1', {
      configurable: true,
      enumerable: true,
      get() { rowChecks++; return 0; }
    });
    return patient;
  }

  const originalRoster = Array.from({ length: 1571 }, (_, index) => trackedPatient(index, dirtyIndexes.includes(index)));
  const originalDirty = originalRoster[0];
  let roster = originalRoster;

  const localStorage = {
    getItem(key) { key = String(key); return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(String(key), String(value)); },
    removeItem(key) { store.delete(String(key)); }
  };
  const document = {
    hidden: false,
    addEventListener: documentEvents.addEventListener,
    removeEventListener: documentEvents.removeEventListener
  };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    localStorage,
    sessionStorage: { getItem(key) { return key === 'sf_session' ? account : null; } },
    navigator: { scheduling: { isInputPending() { return inputPending; } } },
    document,
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
    setInterval(fn, ms) {
      const timer = { id: ++timerId, fn, ms, canceled: false };
      intervals.push(timer);
      return timer.id;
    },
    clearInterval(id) { const timer = intervals.find(item => item.id === id); if (timer) timer.canceled = true; },
    setTimeout(fn, ms) {
      const timer = { id: ++timerId, fn, ms, canceled: false };
      timeouts.push(timer);
      return timer.id;
    },
    clearTimeout(id) { const timer = timeouts.find(item => item.id === id); if (timer) timer.canceled = true; },
    uns(suffix) { return 'sf_u::' + account + '::' + suffix; },
    bkToken() { return token; },
    getSessionEmail() { return account; },
    __mlsSessionReady: Promise.resolve(true),
    __mlsDeferAsset(fn, opts) {
      deferred.push({ fn, opts });
      return deferred.length;
    },
    __mlsStoreCache: {
      verFor(key) { assert.strictEqual(key, patientKey, 'Chart Structure checked the wrong store generation'); return storeVersion; },
      ver() { return storeVersion; }
    },
    getPatients() { rosterReads++; return roster; },
    _savePatientChart() { return true; },
    renderProfile() { profileRenders++; },
    __mlsVisitUI: { render() { visitRenders++; } },
    upsertPatient() { throw new Error('automatic Chart Structure repair bypassed cooperative persistence'); },
    syncPatientToServer() { return Promise.resolve({ ok: true }); }
  };
  context.window = context;
  document.dispatch = documentEvents.dispatch;
  context.savePatients = function savePatients(rows, key, opts) {
    assert(opts && opts.cooperative === true, 'Chart Structure used a blocking patient save');
    assert.strictEqual(key, patientKey, 'Chart Structure persisted to the wrong account key');
    assert.strictEqual(opts.isCurrent(), true, 'a stale Chart Structure generation reached savePatients');
    saves.push({ rows, key, opts, expectedRaw: opts.expectedRaw });
    roster = rows;
    storeVersion++;
    store.set(patientKey, 'roster-own-save-' + saves.length);
    return Promise.resolve({ saved: true, rows });
  };

  vm.createContext(context);
  vm.runInContext(queueSource, context, { filename: 'maintenance-persistence-queue.js' });
  vm.runInContext(chartSource, context, { filename: 'chart-structure.js' });

  return {
    context,
    patientKey,
    originalDirty,
    rawChart,
    deferred,
    intervals,
    timeouts,
    saves,
    get rosterReads() { return rosterReads; },
    get rowChecks() { return rowChecks; },
    get summaryReads() { return summaryReads; },
    get profileRenders() { return profileRenders; },
    get visitRenders() { return visitRenders; },
    get storeVersion() { return storeVersion; },
    setInputPending(value) { inputPending = !!value; },
    fireWindow(type, event) { windowEvents.dispatch(type, event); },
    replaceGeneration(raw) {
      storeVersion++;
      store.set(patientKey, raw);
    }
  };
}

async function turns() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function runDeferred(h) {
  assert(h.deferred.length, 'missing deferred Chart Structure callback');
  const task = h.deferred.shift();
  assert(task.opts && task.opts.timeout === 5000 && task.opts.priority === 4,
    'Chart Structure work escaped the genuine low-priority idle lane');
  const rowsBefore = h.context.__mlsMaintenancePersist.stats().scanRows;
  task.fn();
  await turns();
  const rowsAfter = h.context.__mlsMaintenancePersist.stats().scanRows;
  assert(rowsAfter - rowsBefore <= MAX_ROWS_PER_IDLE_TURN,
    'one deferred Chart Structure turn processed ' + (rowsAfter - rowsBefore) + ' splitSections rows');
  return rowsAfter - rowsBefore;
}

async function drainDeferred(h, limit = 5000) {
  let count = 0;
  while (h.deferred.length) {
    if (++count > limit) throw new Error('Chart Structure idle queue did not settle');
    await runDeferred(h);
  }
  return count;
}

(async function run() {
  const h = makeHarness();
  const startup = h.timeouts.find(timer => timer.ms === 1500 && !timer.canceled);
  assert(startup, 'Chart Structure startup repair trigger is missing');
  const legacyTicks = h.intervals.filter(timer => timer.ms === 3000 && !timer.canceled);

  startup.fn();
  for (let pass = 0; pass < 40; pass++) {
    for (const timer of legacyTicks) timer.fn();
    h.fireWindow('pageshow', { type: 'pageshow' });
  }

  assert.strictEqual(h.summaryReads, 0,
    'startup/timer callbacks synchronously fed the 6.5 MB roster through splitSections');
  assert.strictEqual(h.rowChecks, 0, 'startup/timer callbacks synchronously inspected the 1,571-row roster');
  assert.strictEqual(h.rosterReads, 0,
    'startup/timer callbacks synchronously read the 1,571-row roster');
  assert.strictEqual(h.saves.length, 0, 'startup/timer callbacks synchronously persisted a repair');
  assert.strictEqual(legacyTicks.length, 0, 'the retired three-second Chart Structure roster timer is still installed');

  await turns();
  assert.strictEqual(h.deferred.length, 1, 'repeated automatic triggers did not coalesce into one idle scan');
  assert.strictEqual(h.context.__mlsMaintenancePersist.stats().scanQueued, 0,
    'repeated automatic triggers queued duplicate roster scans');
  assert.strictEqual(h.context.__mlsMaintenancePersist.stats().scanRunning, true,
    'the coalesced automatic scan was not owned by the maintenance queue');

  await runDeferred(h);
  assert.strictEqual(h.rosterReads, 0, 'input-pending idle work read the patient roster');
  assert.strictEqual(h.rowChecks, 0, 'input-pending idle work inspected a patient row');
  assert.strictEqual(h.saves.length, 0, 'input-pending idle work persisted a patient repair');

  h.setInputPending(false);
  const firstPassTurns = await drainDeferred(h);
  assert(firstPassTurns >= Math.ceil(1571 / configuredChunkSize) + 1,
    'the 1,571-row Chart Structure scan was not split across bounded idle turns');
  assert.strictEqual(h.rosterReads, 1, 'one exact roster generation was read more than once');
  assert.strictEqual(h.context.__mlsMaintenancePersist.stats().scans, 1, 'startup armed more than one roster scan');
  assert.strictEqual(h.context.__mlsMaintenancePersist.stats().scanRows, 1571, 'the bounded scan skipped or repeated rows');
  assert.strictEqual(h.saves.length, 1, 'dirty charts across multiple chunks were not repaired in one cooperative save');
  assert.strictEqual(h.saves[0].expectedRaw, 'roster-generation-a', 'repair lost its exact raw-generation fence');
  assert.notStrictEqual(h.saves[0].rows[0], h.originalDirty, 'automatic repair mutated the live patient object in place');
  assert.strictEqual(h.originalDirty.summary, h.rawChart, 'automatic repair changed the source object before persistence');
  assert.strictEqual(h.originalDirty.problems, '', 'automatic repair leaked structured fields into the source object');
  assert(/lumbar radiculopathy/i.test(h.saves[0].rows[0].problems), 'repair lost Problems extraction');
  assert(/gabapentin/i.test(h.saves[0].rows[0].meds), 'repair lost Medications extraction');
  assert(/NKDA/i.test(h.saves[0].rows[0].allergies), 'repair lost Allergies extraction');
  assert(/Pulled from Athena/i.test(h.saves[0].rows[0].summary), 'repair lost the pulled-chart summary stamp');
  assert(h.saves[0].rows[0]._mlsStructuredV1, 'repair lost its idempotence marker');
  assert(h.saves[0].rows[777]._mlsStructuredV1 && h.saves[0].rows[1570]._mlsStructuredV1,
    'repair lost dirty patients from the middle or final idle chunk');
  assert.strictEqual(h.profileRenders, 1, 'durable repair did not refresh the active patient profile once');
  assert.strictEqual(h.visitRenders, 1, 'durable repair did not refresh the Visits surface once');

  for (let pass = 0; pass < 40; pass++) h.fireWindow('pageshow', { type: 'pageshow' });
  await turns();
  assert.strictEqual(h.rosterReads, 1, 'same-generation signals rescanned the 1,571-row roster');
  assert.strictEqual(h.deferred.length, 0, 'same-generation signals scheduled redundant idle work');

  h.replaceGeneration('roster-generation-b');
  h.fireWindow('storage', { type: 'storage', key: h.patientKey, storageArea: h.context.localStorage });
  await turns();
  await runDeferred(h);
  assert.strictEqual(h.rosterReads, 2, 'new patient generation did not begin one fresh scan');
  const beforeStaleRows = h.context.__mlsMaintenancePersist.stats().scanRows;

  h.replaceGeneration('roster-generation-c');
  h.fireWindow('storage', { type: 'storage', key: h.patientKey, storageArea: h.context.localStorage });
  await runDeferred(h);
  await turns();
  assert.strictEqual(h.saves.length, 1, 'a stale mid-scan generation reached persistence');
  assert.strictEqual(h.context.__mlsMaintenancePersist.stats().scanRows, beforeStaleRows,
    'a stale generation inspected another row after the exact raw fence changed');

  await drainDeferred(h);
  const finalStats = h.context.__mlsMaintenancePersist.stats();
  assert.strictEqual(h.rosterReads, 3, 'the newest exact generation was not scanned exactly once');
  assert.strictEqual(finalStats.scans, 3, 'generation changes lost or duplicated an automatic scan');
  assert.strictEqual(finalStats.scanRows, 1571 + configuredChunkSize + 1571,
    'bounded scan accounting crossed an exact-generation boundary');
  assert.strictEqual(h.saves.length, 1, 'already-repaired patients were persisted again');
  assert.strictEqual(h.context.__mlsChartStructure.stats.sweepPasses, 2,
    'only completed exact-generation scans should count as sweep passes');

  assert(automaticSweepSource.includes('queue.scan({'), 'automatic Chart Structure repair left the shared scan owner');
  assert(chunkMatch && Number(chunkMatch[1]) > 0 && Number(chunkMatch[1]) <= MAX_ROWS_PER_IDLE_TURN,
    'splitSections work is not bounded to at most eight patients per idle turn');
  assert(!/\bgetPatients\s*\(/.test(automaticSweepSource), 'automatic sweep regained a synchronous roster read');
  assert(!/setInterval\s*\(\s*sweep\s*,\s*3000\s*\)/.test(chartSource), 'three-second whole-roster sweep returned');

  console.log('PASS Chart Structure idle scan: no three-second roster timer, 1,571 rows stay input-aware/bounded per idle turn, exact-generation scans coalesce and fail closed, and repair semantics persist');
})().catch(error => { console.error(error); process.exit(1); });
