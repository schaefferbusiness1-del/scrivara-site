'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source anchor is missing');
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': expected source anchor is ambiguous');
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

const sourcePath = 'feat_nextup_connect.js';
const loaderPath = 'feat_mls_schedimport_exact.js';
const runtimeTestPath = path.join('tests', 'schedule-authoritative-reconciliation-runtime.test.js');
const cacheTestPath = path.join('tests', 'immutable-satellite-loader-cache-contract.test.js');

let source = read(sourcePath);
let loader = read(loaderPath);
let runtimeTest = read(runtimeTestPath);
let cacheTest = read(cacheTestPath);

source = replaceOnce(
  source,
  "  try { if (window.__mlsNextUp && window.__mlsNextUp.version === VERSION) return; } catch (e) { }\n",
  "  try { if (window.__mlsNextUp && window.__mlsNextUp.version === VERSION && window.__mlsNextUp.__installed !== false) return; } catch (e) { }\n",
  sourcePath + ' reinstall guard'
);

source = replaceOnce(
  source,
  "  var loading = false;\n  function ensureToday(force) {\n    safe(function () {\n      var status = authoritativeStatus(todayKey());\n",
  "  var loading = false, active = true;\n  function ensureToday(force) {\n    safe(function () {\n      if (!active) return;\n      var status = authoritativeStatus(todayKey());\n",
  sourcePath + ' active request guard'
);

source = replaceOnce(
  source,
  "        Promise.resolve(window.loadCalendar()).catch(function () { }).then(function () { loading = false; renderFromCalendar(); });\n",
  "        Promise.resolve(window.loadCalendar()).catch(function () { }).then(function () { loading = false; if (active) renderFromCalendar(); });\n",
  sourcePath + ' asynchronous render guard'
);

source = replaceOnce(
  source,
  `  var lastSignature = ' ';
  function tick() {
    installRendererGuard();
    var now = signature(); if (now !== lastSignature) { lastSignature = now; renderFromCalendar(); }
  }
  function start() {
    installRendererGuard(); ensureToday(false);
    setTimeout(function () { ensureToday(false); }, 1200);
    setTimeout(function () { ensureToday(false); }, 4000);
    setInterval(tick, 1500);
    safe(function () { window.addEventListener('mls-authoritative-schedule', function () { lastSignature = ' '; ensureToday(false); }); });
  }
  function revert() {
    safe(function () { if (window._renderTodayPatients === guardedRenderer && guardedRenderer.__orig) window._renderTodayPatients = guardedRenderer.__orig; });
    safe(function () { if (previousApi) window.__mlsNextUp = previousApi; else window.__mlsNextUp.__installed = false; });
  }
`,
  `  var lastSignature = ' ';
  var tickTimer = null, startTimers = [], started = false;
  function tick() {
    if (!active) return;
    installRendererGuard();
    var now = signature(); if (now !== lastSignature) { lastSignature = now; renderFromCalendar(); }
  }
  function onAuthoritativeSchedule() {
    if (!active) return;
    lastSignature = ' ';
    ensureToday(false);
  }
  function start() {
    if (!active || started) return;
    started = true;
    installRendererGuard(); ensureToday(false);
    startTimers.push(setTimeout(function () { ensureToday(false); }, 1200));
    startTimers.push(setTimeout(function () { ensureToday(false); }, 4000));
    tickTimer = setInterval(tick, 1500);
    safe(function () { window.addEventListener('mls-authoritative-schedule', onAuthoritativeSchedule); });
  }
  function revert() {
    active = false;
    safe(function () { document.removeEventListener('DOMContentLoaded', start); });
    safe(function () { if (tickTimer !== null) clearInterval(tickTimer); tickTimer = null; });
    safe(function () { startTimers.forEach(function (timer) { clearTimeout(timer); }); startTimers = []; });
    safe(function () { window.removeEventListener('mls-authoritative-schedule', onAuthoritativeSchedule); });
    safe(function () { if (window._renderTodayPatients === guardedRenderer && guardedRenderer.__orig) window._renderTodayPatients = guardedRenderer.__orig; });
    safe(function () { if (previousApi) window.__mlsNextUp = previousApi; else window.__mlsNextUp.__installed = false; });
  }
`,
  sourcePath + ' owned lifecycle block'
);

loader = replaceOnce(
  loader,
  '      s.src = "feat_nextup_connect.js?v=20260714auth1";\n',
  '      s.src = "feat_nextup_connect.js?v=20260729auth2";\n',
  loaderPath + ' immutable loader token'
);

runtimeTest = replaceOnce(
  runtimeTest,
  "  console.log('PASS authoritative day/provider reconciliation, stale-ledger recovery, repeat enrichment, manual preservation, empty-day safety, and top UI consumption');\n",
  `  /* 2026-07-29: the Next Up owner must release every callback on revert.
     Invoke saved callbacks after teardown too, modeling work already queued by
     the browser before clearInterval/removeEventListener took effect. */
  {
    let nextLifecycleTimer = 0;
    const lifecycleIntervals = new Map();
    const lifecycleTimeouts = new Map();
    const lifecycleWindowListeners = new Map();
    const lifecycleDocumentListeners = new Map();
    const lifecycleDay = '2026-07-29';

    function addLifecycleListener(registry, type, listener) {
      if (!registry.has(type)) registry.set(type, new Set());
      registry.get(type).add(listener);
    }
    function removeLifecycleListener(registry, type, listener) {
      if (registry.has(type)) registry.get(type).delete(listener);
    }
    function lifecycleListenerCount(registry, type) {
      return registry.has(type) ? registry.get(type).size : 0;
    }
    function liveLifecycleTimers(registry) {
      return Array.from(registry.values()).filter(timer => timer.active);
    }

    const lifecycleDocument = {
      readyState: 'complete',
      getElementById() { return null; },
      createElement() { return { setAttribute() {}, style: {}, parentNode: null }; },
      body: { appendChild() {} },
      documentElement: { appendChild() {} },
      addEventListener(type, listener) { addLifecycleListener(lifecycleDocumentListeners, type, listener); },
      removeEventListener(type, listener) { removeLifecycleListener(lifecycleDocumentListeners, type, listener); }
    };
    const lifecycleRows = Array.from({ length: 20 }, (_, index) => ({
      id: 'synthetic-nextup-' + index,
      name: 'Synthetic Next Up ' + index,
      dob: '2000-01-01',
      start_at: lifecycleDay + 'T10:00:00.000Z',
      appt_date: lifecycleDay
    }));
    const lifecycleRuntime = {
      console, Promise, Date, Math, JSON, Object, Array, String, Number, RegExp,
      document: lifecycleDocument,
      __mlsNextUpDebugDate: lifecycleDay,
      __mlsSI: {
        authoritativeRowsForDay() { return lifecycleRows; },
        authoritativeStatusForDay() { return { available: true, reason: 'complete', unclassifiedCount: 0 }; }
      },
      _apptHHMMTz() { return '10:00'; },
      _calLabelOf(row) { return row && row.name || ''; },
      getPatients() { return []; },
      _calAppts: [],
      _heroTodayList: [],
      _renderTodayPatients(rows) { lifecycleRuntime._heroTodayList = rows.slice(); },
      setTimeout(listener, ms) {
        const id = ++nextLifecycleTimer;
        lifecycleTimeouts.set(id, { listener, ms, active: true });
        return id;
      },
      clearTimeout(id) {
        if (lifecycleTimeouts.has(id)) lifecycleTimeouts.get(id).active = false;
      },
      setInterval(listener, ms) {
        const id = ++nextLifecycleTimer;
        lifecycleIntervals.set(id, { listener, ms, active: true });
        return id;
      },
      clearInterval(id) {
        if (lifecycleIntervals.has(id)) lifecycleIntervals.get(id).active = false;
      },
      addEventListener(type, listener) { addLifecycleListener(lifecycleWindowListeners, type, listener); },
      removeEventListener(type, listener) { removeLifecycleListener(lifecycleWindowListeners, type, listener); }
    };
    lifecycleRuntime.window = lifecycleRuntime;
    const originalLifecycleRenderer = lifecycleRuntime._renderTodayPatients;

    vm.runInNewContext(nextUpSource, lifecycleRuntime, { filename: 'feat_nextup_connect.js', timeout: 1000 });
    const firstLifecycleApi = lifecycleRuntime.__mlsNextUp;
    const firstInterval = liveLifecycleTimers(lifecycleIntervals)[0];
    const firstTimeout = liveLifecycleTimers(lifecycleTimeouts)[0];
    const firstScheduleListener = Array.from(lifecycleWindowListeners.get('mls-authoritative-schedule') || [])[0];
    assert.strictEqual(liveLifecycleTimers(lifecycleIntervals).length, 1, 'Next Up must own exactly one interval');
    assert.strictEqual(firstInterval.ms, 1500, 'Next Up interval cadence changed');
    assert.strictEqual(liveLifecycleTimers(lifecycleTimeouts).length, 2, 'Next Up must own both delayed boot checks');
    assert.strictEqual(lifecycleListenerCount(lifecycleWindowListeners, 'mls-authoritative-schedule'), 1, 'Next Up schedule listener is not singular');
    assert.notStrictEqual(lifecycleRuntime._renderTodayPatients, originalLifecycleRenderer, 'Next Up renderer guard did not install');

    firstLifecycleApi.revert();
    assert.strictEqual(liveLifecycleTimers(lifecycleIntervals).length, 0, 'Next Up revert leaked its interval');
    assert.strictEqual(liveLifecycleTimers(lifecycleTimeouts).length, 0, 'Next Up revert leaked delayed boot work');
    assert.strictEqual(lifecycleListenerCount(lifecycleWindowListeners, 'mls-authoritative-schedule'), 0, 'Next Up revert leaked its schedule listener');
    assert.strictEqual(lifecycleRuntime._renderTodayPatients, originalLifecycleRenderer, 'Next Up revert did not restore the renderer');
    firstInterval.listener();
    firstTimeout.listener();
    firstScheduleListener();
    assert.strictEqual(lifecycleRuntime._renderTodayPatients, originalLifecycleRenderer, 'queued Next Up work reinstalled the renderer after revert');

    vm.runInNewContext(nextUpSource, lifecycleRuntime, { filename: 'feat_nextup_connect.js', timeout: 1000 });
    const secondLifecycleApi = lifecycleRuntime.__mlsNextUp;
    assert.notStrictEqual(secondLifecycleApi, firstLifecycleApi, 'Next Up refused a clean reinstall after revert');
    assert.strictEqual(liveLifecycleTimers(lifecycleIntervals).length, 1, 'Next Up reinstall duplicated or omitted its interval');
    assert.strictEqual(liveLifecycleTimers(lifecycleTimeouts).length, 2, 'Next Up reinstall duplicated or omitted delayed work');
    assert.strictEqual(lifecycleListenerCount(lifecycleWindowListeners, 'mls-authoritative-schedule'), 1, 'Next Up reinstall duplicated or omitted its listener');
    secondLifecycleApi.revert();
    assert.strictEqual(liveLifecycleTimers(lifecycleIntervals).length, 0, 'second Next Up revert leaked its interval');
    assert.strictEqual(liveLifecycleTimers(lifecycleTimeouts).length, 0, 'second Next Up revert leaked delayed work');
    assert.strictEqual(lifecycleListenerCount(lifecycleWindowListeners, 'mls-authoritative-schedule'), 0, 'second Next Up revert leaked its listener');
    assert.strictEqual(lifecycleRuntime._renderTodayPatients, originalLifecycleRenderer, 'second Next Up revert did not restore the renderer');
  }

  console.log('PASS authoritative day/provider reconciliation, stale-ledger recovery, repeat enrichment, manual preservation, empty-day safety, top UI consumption, and flat Next Up lifecycle ownership');
`,
  runtimeTestPath + ' lifecycle proof'
);

cacheTest = replaceOnce(
  cacheTest,
  "const staging = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');\n",
  "const staging = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');\nconst scheduleImporter = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');\n",
  cacheTestPath + ' nested loader source'
);

cacheTest = replaceOnce(
  cacheTest,
  "assert(staging.includes(\"A='feat_mls_active_patient_sync.js'\") &&\n",
  `assert.strictEqual(scheduleImporter.split('20260729auth2').length - 1, 1,
  'Next Up must have exactly one nested immutable loader using 20260729auth2');
assert(!scheduleImporter.includes('20260714auth1'),
  'Next Up nested loader still exposes retired cache token 20260714auth1');

assert(staging.includes("A='feat_mls_active_patient_sync.js'") &&
`,
  cacheTestPath + ' nested loader token proof'
);

const outputs = new Map([
  [sourcePath, source],
  [loaderPath, loader],
  [runtimeTestPath, runtimeTest],
  [cacheTestPath, cacheTest]
]);

for (const [relativePath, text] of outputs) {
  fs.writeFileSync(path.join(root, relativePath), text, 'utf8');
}

console.log('Applied proposal 049: Next Up teardown owns its interval, delayed work, and schedule listener; immutable loader token advanced.');
