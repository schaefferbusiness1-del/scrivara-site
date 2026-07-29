/* patient-scale-perf-contract.test.js — b375
 *
 * Pins the patient-scale performance pass:
 *  1. Base getPatients() memoizes the account-scoped legacy raw value; repeated
 *     reads do not decode/parse again. The retired worker-journal protocol must
 *     not reappear.
 *  2. patientNotes() is an indexed lookup (Map keyed per store version), not a
 *     full-store filter per call — with a working fallback filter.
 *  3. ptSearch/histSearch keystrokes are debounced through __mlsDebRender.
 *  4. renderHistory is bounded by HIST_CAP like renderPatients' PT_CAP.
 *  5. The EMBEDDED store cache (mls-connect.js byte-0 copy — the one that
 *     actually runs in production) carries the VER fast path: unchanged VER
 *     serves hits without getItem or the 2MB string compare.
 *  6. The summary-sanitize sweep batches its local write (one savePatients per
 *     pass, not one per patient) and self-retires after 5 clean passes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8');

/* ---------- 1. base logical-store memo ---------- */
assert(app.includes('var __mlsPtsMemo=null;'), 'getPatients raw-identity memo was removed');
/* PIN WIDENED AT b672, DELIBERATELY: pts-rowguard-2.0.0 stamps every array
   getPatients() returns with its read generation (__mlsPtsStampRead — a
   non-enumerable property, never persisted, no extra parse). The memo hit
   path itself is unchanged: same key+raw identity check, same .slice(), no
   decode. What this pin protects — repeated reads never re-decode — still
   holds and is still asserted. */
assert(app.includes('if(__mlsPtsMemo&&__mlsPtsMemo.key===key&&__mlsPtsMemo.raw===raw)return __mlsPtsStampRead(__mlsPtsMemo.arr.slice());'),
  'getPatients no longer memoizes the exact legacy raw identity');
assert(app.includes('var arr=JSON.parse(_mlsPtsDecode(raw))||[];'),
  'getPatients no longer reads the rollback-compatible legacy store');
assert(!app.includes('__mlsPtsReadState'), 'retired worker-journal state machine returned');
assert(app.includes("if(__mlsPtsMemo&&__mlsPtsMemo.key===__key)__mlsPtsMemo=null; /* never serve a pre-write parse after a write */"),
  'savePatients no longer invalidates the read memo before writing');

/* ---------- 2. patientNotes index ---------- */
assert(app.includes('var __mlsNotesIdx={ver:-1,map:null};'), 'patientNotes index was removed');
assert(app.includes('__mlsNotesIdx.map.get(id)'), 'patientNotes is no longer an indexed lookup');
assert(app.includes('return getNotes().filter(function(n){return n.patientId===id;});'),
  'patientNotes lost its fallback full filter');

/* runtime: extract patientNotes + index var and exercise semantics */
{
  const start = app.indexOf('var __mlsNotesIdx={ver:-1,map:null};');
  let end = app.indexOf('window.__mlsDebRender=(function(){', start);
  if (end > start) end = app.lastIndexOf('/*', end);
  assert(start > 0 && end > start, 'could not extract patientNotes source');
  const src = app.slice(start, end);
  let notesReads = 0;
  let verN = 7;
  const sandbox = {
    window: { __mlsStoreCache: { ver: () => verN } },
    getNotes: () => { notesReads++; return [
      { id: 'n1', patientId: 'p1' }, { id: 'n2', patientId: 'p2' },
      { id: 'n3', patientId: 'p1' }, { id: 'n4', patientId: 5 }
    ]; }
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.patientNotes = patientNotes;', sandbox);
  const pn = sandbox.patientNotes;
  assert.strictEqual(JSON.stringify(pn('p1').map(n => n.id)), '["n1","n3"]', 'indexed lookup returns wrong notes');
  assert.strictEqual(pn('p2').length, 1, 'indexed lookup misses p2');
  assert.strictEqual(pn('missing').length, 0, 'unknown patient must return []');
  assert.strictEqual(pn('5').length, 0, 'string "5" must NOT match numeric id 5 (strict-equality semantics)');
  assert.strictEqual(pn(5).length, 1, 'numeric id 5 must match');
  const before = notesReads;
  pn('p1'); pn('p2'); pn('p1');
  assert.strictEqual(notesReads, before, 'same-version lookups must not re-read the notes store');
  verN++; pn('p1');
  assert.strictEqual(notesReads, before + 1, 'a version bump must rebuild the index exactly once');
  const a = pn('p1'), b = pn('p1');
  assert(a !== b, 'patientNotes must return fresh arrays');
}

/* ---------- 3. debounced searches ---------- */
assert(app.includes('window.__mlsDebRender=(function(){'), 'shared search debounce was removed');
assert(app.includes('oninput="__mlsDebRender(\'pt\',renderPatients)"'), 'ptSearch keystrokes are no longer debounced');
assert(app.includes('oninput="__mlsDebRender(\'hist\',renderHistory)"'), 'histSearch keystrokes are no longer debounced');

/* ---------- 4. history cap ---------- */
assert(app.includes('const HIST_CAP=200;'), 'renderHistory lost its row cap');
assert(app.includes("ordered=ordered.slice(0,HIST_CAP)"), 'renderHistory no longer slices to the cap');
assert(app.includes('most recent of '), 'capped history lost its user-facing note');

/* ---------- 5. embedded store-cache VER fast path ---------- */
assert(connect.includes("version: 'sc-1.2.0', enabled: true, early: true"), 'embedded store cache is not sc-1.2.0');
assert(connect.includes('api.ver = function () { return VER.n; };'), 'store-cache no longer exposes ver()');
assert(connect.includes('cache.val && cache.key === k && cache.ver === VER.n'), 'VER fast path (skip getItem) was lost');
assert(connect.includes("w.__mlsScVer = 1;"), 'Storage.prototype VER hook was lost');
assert(!connect.includes('__mlsPatientStoreHasPending'), 'retired worker-journal cache branch returned');

/* runtime: extract the embedded cache IIFE and prove the fast path skips getItem */
{
  const end = connect.indexOf("window.__mlsStoreCache = api;\n})();");
  assert(end > 0, 'could not find embedded cache IIFE end');
  const src = connect.slice(0, end + "window.__mlsStoreCache = api;\n})();".length);
  let getItemCalls = 0;
  const backing = { 'u::patients': JSON.stringify([{ id: 'a' }, { id: 'b' }]) };
  const storageProto = {
    getItem(k) { getItemCalls++; return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null; },
    setItem(k, v) { backing[k] = String(v); },
    removeItem(k) { delete backing[k]; },
    clear() { for (const k of Object.keys(backing)) delete backing[k]; }
  };
  const localStorage = Object.create(storageProto);
  const listeners = {};
  const win = {
    localStorage,
    uns: (s) => 'u::' + s,
    getPatients: () => { return JSON.parse(storageProto.getItem('u::patients')) || []; },
    getNotes: () => [],
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: () => {}
  };
  const sandbox = { window: win, localStorage, Date };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert(win.__mlsStoreCache && win.__mlsStoreCache.version === 'sc-1.2.0', 'embedded cache did not install in vm');
  assert.strictEqual(typeof win.__mlsStoreCache.ver, 'function', 'ver() missing at runtime');
  const first = win.getPatients();
  assert.strictEqual(first.length, 2, 'wrapped getPatients wrong result');
  const callsAfterFirst = getItemCalls;
  win.getPatients(); win.getPatients(); win.getPatients();
  assert.strictEqual(getItemCalls, callsAfterFirst, 'VER fast path must serve hits WITHOUT getItem');
  /* a write through the (wrapped) prototype must invalidate */
  localStorage.setItem('u::patients', JSON.stringify([{ id: 'a' }]));
  const after = win.getPatients();
  assert.strictEqual(after.length, 1, 'setItem did not invalidate the VER fast path');
  assert(getItemCalls > callsAfterFirst, 'post-write read must consult storage again');
}

/* ---------- 6. sanitize sweep batches + self-retires ---------- */
assert(connect.includes('ONE local write for the whole pass'), 'sanitize batching comment/anchor lost');
assert(connect.includes('try { if (typeof window.savePatients === \'function\') window.savePatients(ps); } catch (e) {}'),
  'sanitize sweep no longer batches its local write');
assert(!/if \(c && c !== s\) \{ p\.summary = c; fixed\+\+; try \{ if \(typeof window\.upsertPatient/.test(connect),
  'per-patient upsertPatient write returned to the sanitize sweep');
assert(connect.includes('window.__mlsSanitizeV2.retired = true;'), 'sanitize sweep no longer self-retires');
assert(connect.includes('cleanRuns >= 5'), 'sanitize self-retire threshold changed unexpectedly');

/* ---------- 6c. chart structuring persists one outer batch ---------- */
const chartStart = connect.indexOf("try { if (window.__mlsChartStructure && window.__mlsChartStructure.version === '1.1.0') return; }");
const chartEnd = connect.indexOf('window.__mlsChartStructure_revert = function ()', chartStart);
assert(chartStart >= 0 && chartEnd > chartStart, 'Chart Structure slice is missing');
const chartStructure = connect.slice(chartStart, chartEnd);
assert(!chartStructure.includes('if (changed) upsert(p);'),
  'automatic chart structuring returned to one full-store upsert per patient');
assert.strictEqual((chartStructure.match(/sweepPatient\(ps\[i\], true\)/g) || []).length, 2,
  'automatic and manual Chart Structure callers must both defer row persistence');
assert.strictEqual((chartStructure.match(/persistSweep\(ps, dirty\);/g) || []).length, 2,
  'automatic and manual Chart Structure callers must both persist one outer batch');
assert.strictEqual((chartStructure.match(/else ps\[i\]\._mlsStructuredV1 = priorStructured;/g) || []).length, 2,
  'a shared outer save must restore unchanged rows before persisting the batch');
assert.strictEqual((chartStructure.match(/window\.savePatients\(ps\)/g) || []).length, 1,
  'Chart Structure must have exactly one normal-path batch save');
const chartSweepStart = chartStructure.indexOf('function sweep() {');
const chartVersionStamp = chartStructure.indexOf('STATS.lastSweepVer = vNow;', chartSweepStart);
const chartBusyReturn = chartStructure.indexOf('if (pulling) return;', chartSweepStart);
assert(chartBusyReturn >= 0 && chartBusyReturn < chartVersionStamp,
  'Chart Structure must not stamp a pull-busy store version as clean');

const persistStart = chartStructure.indexOf('function persistSweep(ps, dirty) {');
const persistEnd = chartStructure.indexOf('\n  function sweep() {', persistStart);
assert(persistStart >= 0 && persistEnd > persistStart, 'Chart Structure batch helper is missing');
const persistCtx = { saveCalls: 0, syncCalls: 0, upsertCalls: 0, window: {}, Date };
persistCtx.window.savePatients = function (rows) { persistCtx.saveCalls++; persistCtx.savedRows = rows; };
persistCtx.window.syncPatientToServer = function () { persistCtx.syncCalls++; };
vm.createContext(persistCtx);
vm.runInContext(
  "var isFn=function(f){return typeof f==='function';};" +
  'var upsert=function(){upsertCalls++;};' +
  chartStructure.slice(persistStart, persistEnd) +
  ';this.persistSweep=persistSweep;',
  persistCtx, { filename: 'chart-structure-batch.js' });
const chartDirty = Array.from({ length: 8 }, function (_, i) {
  return { id: 'synthetic-' + i, problems: 'Synthetic problem', meds: 'Synthetic medication',
    proof: { sentinel: i }, visits: [{ date: '2026-07-01', raw: 'Synthetic visit' }] };
});
persistCtx.persistSweep(chartDirty, chartDirty.slice());
assert.strictEqual(persistCtx.saveCalls, 1, 'eight chart repairs must produce one local save');
assert.strictEqual(persistCtx.upsertCalls, 0, 'normal batch path must produce zero per-row upserts');
assert.strictEqual(persistCtx.syncCalls, 8, 'every dirty chart row must retain its server mirror');
chartDirty.forEach(function (p, i) {
  assert(Number(p.updated) > 0 && p.proof.sentinel === i && p.visits.length === 1 && p.problems && p.meds,
    'batch persistence changed a clinical/proof field or failed to stamp updated');
});

/* ---------- 6b. every automatic summary scrub batches its store write ---------- */
const continuousStart = connect.indexOf('CONTINUOUS SUMMARY SCRUB');
const continuousEnd = connect.indexOf('var iv = null; try { iv = setInterval(scrub, 2500);', continuousStart);
assert(continuousStart >= 0 && continuousEnd > continuousStart, 'Continuous Scrub slice is missing');
const continuousScrub = connect.slice(continuousStart, continuousEnd);
assert(continuousScrub.includes('fallbackOk = typeof window.upsertPatient') &&
  continuousScrub.includes('window.upsertPatient(dirty[u])'),
  'Continuous Scrub lacks a per-row fallback after a failed batch save');
assert.strictEqual((continuousScrub.match(/savePatients\(ps\)/g) || []).length, 1,
  'Continuous Scrub must make exactly one local batch save');
assert(continuousScrub.includes('ps[i] = next') && continuousScrub.includes('dirty.push(next)') &&
  continuousScrub.includes('syncPatientToServer(dirty[d])') &&
  continuousScrub.includes('next.updated = Date.now()'),
  'Continuous Scrub lost isolated dirty-row collection, timestamping, or server mirrors');

const baseSanitizeStart = connect.indexOf("try { if (window.__mlsSummarySanitize) return; }");
const baseSanitizeEnd = connect.indexOf('window.__mlsSummarySanitize_revert', baseSanitizeStart);
assert(baseSanitizeStart >= 0 && baseSanitizeEnd > baseSanitizeStart, 'base sanitizer slice is missing');
const baseSanitize = connect.slice(baseSanitizeStart, baseSanitizeEnd);
assert(baseSanitize.includes('fallbackOk = typeof window.upsertPatient') &&
  baseSanitize.includes('window.upsertPatient(dirty[u])'),
  'base startup scrub lacks a per-row fallback after a failed batch save');
assert.strictEqual((baseSanitize.match(/savePatients\(ps\)/g) || []).length, 1,
  'base startup scrub must make exactly one local batch save');
assert(baseSanitize.includes('ps[i] = next') && baseSanitize.includes('dirty.push(next)') &&
  baseSanitize.includes('syncPatientToServer(dirty[d])') &&
  baseSanitize.includes('next.updated = Date.now()'),
  'base startup scrub lost isolated dirty-row collection, timestamping, or server mirrors');

/* 2026-07-29: dirty rows are cloned before persistence so failed writers
 * cannot make the shared store cache appear clean. Successful per-row fallback
 * completes normally; total failure must retry on the next heartbeat. */
const continuousFnStart = continuousScrub.indexOf('  function scrub() {');
const continuousFnEnd = continuousScrub.length;
assert(continuousFnStart >= 0 && continuousFnEnd > continuousFnStart,
  'Continuous Scrub function could not be extracted');
const continuousFn = continuousScrub.slice(continuousFnStart, continuousFnEnd);
function runContinuousPersistence(mode, passes) {
  const rows = new Array(8).fill(0).map(function (_, i) {
    return { id: 'synthetic-continuous-' + i, summary: 'x'.repeat(90) };
  });
  const counts = { save: 0, upsert: 0, sync: 0, render: 0 };
  const syntheticWindow = {
    __mlsContinuousScrub: { cleaned: 0 },
    __mlsStoreCache: { ver() { return 7; } },
    __mlsSummarySanitize: { hasCode() { return true; }, strip() { return 'clean synthetic summary'; } },
    getPatients() { return rows.slice(); },
    upsertPatient() {
      counts.upsert++;
      if (mode === 'allThrow') throw new Error('synthetic upsert refusal');
    },
    syncPatientToServer() { counts.sync++; },
    renderProfile() { counts.render++; }
  };
  if (mode !== 'absent') {
    syntheticWindow.savePatients = function () {
      counts.save++;
      if (mode === 'throw' || mode === 'allThrow') throw new Error('synthetic save refusal');
    };
  }
  const ctx = {
    window: syntheticWindow,
    document: { hidden: false },
    Date,
    Number,
    console: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(continuousFn + '\nthis.runContinuousScrub=scrub;', ctx,
    { filename: 'continuous-summary-scrub.js' });
  for (let pass = 0; pass < (passes || 1); pass++) ctx.runContinuousScrub();
  return {
    counts,
    state: syntheticWindow.__mlsContinuousScrub,
    sourceDirty: rows.filter(function (row) { return row.summary === 'x'.repeat(90); }).length
  };
}
const continuousSaved = runContinuousPersistence('save');
assert.deepStrictEqual(continuousSaved.counts, { save: 1, upsert: 0, sync: 8, render: 1 },
  'Continuous Scrub successful batch did not save, mirror, and finish once');
assert.strictEqual(continuousSaved.state.cleaned, 8,
  'Continuous Scrub successful batch did not record eight cleaned rows');
['throw', 'absent'].forEach(function (mode) {
  const result = runContinuousPersistence(mode);
  assert.deepStrictEqual(result.counts,
    { save: mode === 'throw' ? 1 : 0, upsert: 8, sync: 0, render: 1 },
    'Continuous Scrub ' + mode + ' batch path did not complete through fallback');
  assert.strictEqual(result.state.cleaned, 8,
    'Continuous Scrub ' + mode + ' successful fallback lost completion diagnostics');
});
const continuousFailed = runContinuousPersistence('allThrow', 2);
assert.deepStrictEqual(continuousFailed.counts, { save: 2, upsert: 16, sync: 0, render: 0 },
  'Continuous Scrub total failure did not retry every writer on heartbeat two');
assert.strictEqual(continuousFailed.state.cleaned, 0,
  'Continuous Scrub total failure falsely recorded cleaned rows');
assert.strictEqual(continuousFailed.state.lastScrubVer, null,
  'Continuous Scrub total failure retained its optimistic version stamp');
assert.strictEqual(continuousFailed.sourceDirty, 8,
  'Continuous Scrub total failure mutated the shared source rows');

const baseFnStart = baseSanitize.indexOf('  function scrubExisting() {');
const baseFnEnd = baseSanitize.indexOf('\n\n  function tick()', baseFnStart);
assert(baseFnStart >= 0 && baseFnEnd > baseFnStart,
  'base startup scrub function could not be extracted');
const baseFn = baseSanitize.slice(baseFnStart, baseFnEnd);
function runBasePersistence(mode, passes) {
  const rows = new Array(8).fill(0).map(function (_, i) {
    return { id: 'synthetic-base-' + i, summary: 'x'.repeat(90) };
  });
  const counts = { save: 0, upsert: 0, sync: 0, render: 0 };
  const syntheticWindow = {
    getPatients() { return rows.slice(); },
    upsertPatient() {
      counts.upsert++;
      if (mode === 'allThrow') throw new Error('synthetic upsert refusal');
    },
    syncPatientToServer() { counts.sync++; },
    renderProfile() { counts.render++; }
  };
  if (mode !== 'absent') {
    syntheticWindow.savePatients = function () {
      counts.save++;
      if (mode === 'throw' || mode === 'allThrow') throw new Error('synthetic save refusal');
    };
  }
  const ctx = {
    window: syntheticWindow,
    Date,
    Number,
    console: { log() {} },
    hasCode() { return true; },
    stripChartCode() { return 'clean synthetic summary'; }
  };
  vm.createContext(ctx);
  vm.runInContext('var scrubbed=false;\n' + baseFn +
    '\nthis.runBaseScrub=scrubExisting;this.wasScrubbed=function(){return scrubbed;};', ctx,
    { filename: 'base-summary-scrub.js' });
  for (let pass = 0; pass < (passes || 1); pass++) ctx.runBaseScrub();
  return {
    counts,
    scrubbed: ctx.wasScrubbed(),
    sourceDirty: rows.filter(function (row) { return row.summary === 'x'.repeat(90); }).length
  };
}
const baseSaved = runBasePersistence('save');
assert.deepStrictEqual(baseSaved.counts, { save: 1, upsert: 0, sync: 8, render: 1 },
  'base startup scrub successful batch did not save, mirror, and finish once');
assert.strictEqual(baseSaved.scrubbed, true, 'base startup scrub successful batch did not retire');
['throw', 'absent'].forEach(function (mode) {
  const result = runBasePersistence(mode);
  assert.deepStrictEqual(result.counts,
    { save: mode === 'throw' ? 1 : 0, upsert: 8, sync: 0, render: 1 },
    'base startup scrub ' + mode + ' batch path did not complete through fallback');
  assert.strictEqual(result.scrubbed, true,
    'base startup scrub ' + mode + ' successful fallback did not retire');
});
const baseFailed = runBasePersistence('allThrow', 2);
assert.deepStrictEqual(baseFailed.counts, { save: 2, upsert: 16, sync: 0, render: 0 },
  'base startup scrub total failure did not retry every writer on heartbeat two');
assert.strictEqual(baseFailed.scrubbed, false,
  'base startup scrub total failure retired');
assert.strictEqual(baseFailed.sourceDirty, 8,
  'base startup scrub total failure mutated the shared source rows');

/* ---------- veil floor (also pinned by boot-loading-visual-contract) ---------- */
assert(app.includes('const SF_GATE_MIN_MS=300'), 'veil anti-flash floor regressed (owner-directed near-instant first load, 2026-07-20)');

console.log('PASS patient-scale perf contract: memoized base reads, indexed patientNotes, debounced searches, bounded history, VER fast path (runtime-proven), batched self-retiring sanitize sweep');
