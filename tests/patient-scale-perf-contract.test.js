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
 *  6. The summary-sanitize sweep batches its dirty rows through one cooperative
 *     maintenance save (never savePatients/upsertPatient per row) and retires.
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

/* ---------- 1b. exact-generation active-patient lookup ---------- */
{
  const start = app.indexOf('/* roster-find-1.0.0:');
  const end = app.indexOf('/* px-3.0:', start);
  assert(start > 0 && end > start, 'active-patient lookup index source is missing');
  const src = app.slice(start, end);
  let account = 'account-a';
  let gen = 1;
  let roster = Array.from({ length: 100000 }, (_, i) => ({ id: `p-${i}`, marker: i }));
  roster.splice(20, 0, { id: 'duplicate-id', marker: 'first' }, { id: 'duplicate-id', marker: 'second' });
  roster.push({ id: 7, marker: 'numeric' });
  let activeId = 'p-99999';
  let legacyReads = 0;
  const store = { isReady: () => true, getRoster: () => roster, genRead: () => gen };
  const sandbox = {
    window: { __mlsPtsStore: store },
    uns: suffix => `${account}::${suffix}`,
    __mlsPtsBatchByKey: Object.create(null),
    getActivePtId: () => activeId,
    getPatients() { legacyReads++; return roster.slice(); },
    Map, Array, Number, Object
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.lookupApi={active:activePatient,find:findPatient};', sandbox);
  const api = sandbox.lookupApi;

  const started = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) assert.strictEqual(api.active().marker, 99999, 'large-roster active lookup returned the wrong row');
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert(elapsedMs < 100, `1,000 cached 100k-row active lookups took ${elapsedMs.toFixed(1)}ms`);
  assert.strictEqual(legacyReads, 0, 'IDB active lookups cloned the public roster');
  assert.strictEqual(api.find('duplicate-id').marker, 'first', 'lookup index changed Array.find first-duplicate semantics');
  assert.strictEqual(api.find('7'), null, 'lookup index weakened strict numeric/string id matching');
  assert.strictEqual(api.find(7).marker, 'numeric', 'lookup index lost numeric id matching');
  assert.strictEqual(api.find('p-3'), roster[3], 'lookup index changed returned object-reference semantics');

  const replacement = { id: 'replacement', marker: 'generation-2' };
  roster = [replacement]; gen++;
  assert.strictEqual(api.find('replacement'), replacement, 'store generation change retained a stale lookup');
  assert.strictEqual(api.find('p-99999'), null, 'store generation change retained a removed patient');

  account = 'account-b';
  roster = [{ id: 'replacement', marker: 'other-account' }]; gen = 1;
  assert.strictEqual(api.find('replacement').marker, 'other-account', 'account boundary reused another account lookup');

  const batchKey = 'account-b::patients';
  const batch = sandbox.__mlsPtsBatchByKey[batchKey] = {
    depth: 1, totalChanges: 4, externalWrites: 0,
    arr: [{ id: 'batch-a', marker: 'batch-a' }]
  };
  assert.strictEqual(api.find('batch-a'), batch.arr[0], 'active batch did not own lookup results');
  batch.arr = [{ id: 'batch-b', marker: 'changed' }]; batch.totalChanges++;
  assert.strictEqual(api.find('batch-b'), batch.arr[0], 'batch change generation retained a stale lookup');
  batch.arr = [{ id: 'batch-c', marker: 'external' }]; batch.externalWrites++;
  assert.strictEqual(api.find('batch-c'), batch.arr[0], 'batch external-write generation retained a stale lookup');

  delete sandbox.__mlsPtsBatchByKey[batchKey];
  sandbox.window.__mlsPtsStore = { isReady: () => false };
  roster = [{ id: 'legacy', marker: 'fallback' }];
  assert.strictEqual(api.find('legacy').marker, 'fallback', 'legacy fallback lost current find semantics');
  assert.strictEqual(legacyReads, 1, 'legacy fallback did not use the public roster exactly once');
}

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

/* ---------- 2b. patient/history derived-data caches ---------- */
assert(app.includes('var __mlsPtRosterCache='), 'patient roster derived-data cache is missing');
assert(app.includes('var ranked=sortMode===\'visits\'?__mlsPtVisitRows(roster):roster.nameRows;'),
  'Patients no longer filters a cached stable ranking');
assert(app.includes('const noteSummary=__mlsPatientNoteSummary(p.id);'),
  'patient cards returned to allocating/sorting a note list per row');
assert(app.includes('var __mlsHistoryPerfCache='), 'History derived-data cache is missing');
assert(app.includes("__mlsHistorySearchBase(histData,n)"),
  'History search returned to rebuilding every normalized note document per keystroke');
assert(app.includes('var ds=__mlsHistoryDateSearch(d);'),
  'History search returned to constructing locale formatters for every note');

{
  const start = app.indexOf('var __mlsNotesIdx={ver:-1,map:null};');
  const end = app.indexOf('/* ---------- SERVER SYNC (hosted mode only) ----------', start);
  assert(start > 0 && end > start, 'could not extract patient/history cache helpers');
  const src = app.slice(start, end);
  let version = 11;
  let notesReads = 0;
  let textReads = 0;
  const newest = { id: 'n-new', patientId: 'p2', patient: 'Patient Two', cc: 'Follow up', updated: Date.parse('2026-08-03T12:00:00Z') };
  Object.defineProperty(newest, 'text', { configurable: true, enumerable: true, get() { textReads++; return 'needle content'; } });
  /* dupnote-2.0.0 narrowed "duplicate" from displayName+cc+day to
     patientId+day+cc+BODY (ScribeFlow.html:14325-14332) - a same-patient,
     same-day, same-cc pair is only a duplicate when its body is a
     byte-identical re-save, never merely because the chief complaint and
     day line up. n-old/n-mid share patientId/day/cc and now carry the same
     text, so together they still exercise the duplicate path for real,
     under the current rule instead of the retired one. */
  let notes = [
    { id: 'n-old', patientId: 'p1', patient: 'Patient One', cc: 'Visit', updated: Date.parse('2026-08-02T10:00:00Z'), text: 'same visit note body' },
    { id: 'n-mid', patientId: 'p1', patient: 'Patient One', cc: 'Visit', updated: Date.parse('2026-08-02T12:00:00Z'), text: 'same visit note body' },
    newest
  ];
  let patientRaw = 'patients-v1';
  const sandbox = {
    window: { __mlsStoreCache: { ver() { return version; } } },
    getNotes() { notesReads++; return notes.slice(); },
    uns(s) { return 'u::' + s; },
    localStorage: { getItem() { return patientRaw; } },
    __mlsPtsBatchByKey: Object.create(null),
    __mlsPtsMemo: { key: 'u::patients', raw: patientRaw },
    setTimeout, clearTimeout, Date, Map, Object, Number, String, Array, isNaN
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.cacheApi={roster:__mlsPtRosterData,visits:__mlsPtVisitRows,summary:__mlsPatientNoteSummary,history:__mlsHistoryData,search:__mlsHistorySearchBase,dateSearch:__mlsHistoryDateSearch};', sandbox);
  const api = sandbox.cacheApi;
  const patients = [{ id: 'p2', name: 'Zulu', dob: '02/02/1980', mrn: '2' }, { id: 'p1', name: 'Alpha', dob: '01/01/1980', mrn: '1' }];

  const roster1 = api.roster(patients);
  const roster2 = api.roster(patients.slice());
  assert.strictEqual(roster2, roster1, 'unchanged patient store rebuilt its derived roster');
  assert.deepStrictEqual(Array.from(roster1.nameRows, row => row.patient.id), ['p1', 'p2'], 'cached A-Z order is wrong');
  assert.strictEqual(roster1.rows.find(row => row.patient.id === 'p1').search, 'alpha 01/01/1980 1', 'normalized patient search key is wrong');

  const visitRows1 = api.visits(roster1);
  const readsAfterVisitIndex = notesReads;
  const visitRows2 = api.visits(roster1);
  assert.strictEqual(visitRows2, visitRows1, 'unchanged note store re-sorted the visit ranking');
  assert.strictEqual(notesReads, readsAfterVisitIndex, 'unchanged note store was re-read for the visit ranking');
  assert.deepStrictEqual(Array.from(visitRows1, row => row.patient.id), ['p1', 'p2'], 'visit-count ranking is wrong');
  assert.strictEqual(api.summary('p1').last.id, 'n-mid', 'patient note summary did not keep the newest updated note');

  const history1 = api.history(notes);
  const history2 = api.history(notes.slice());
  assert.strictEqual(history2, history1, 'unchanged note store rebuilt History derived data');
  assert.deepStrictEqual(Array.from(history1.ordered, note => note.id), ['n-new', 'n-mid', 'n-old'], 'cached History chronology is wrong');
  const search1 = api.search(history1, newest);
  const readsAfterSearch = textReads;
  const search2 = api.search(history1, newest);
  assert.strictEqual(search2, search1, 'cached History search document changed');
  assert.strictEqual(textReads, readsAfterSearch, 'repeated History keystroke rebuilt the full normalized note body');
  assert(search1.includes('needle content') && search1.includes('follow up'), 'History search cache lost searchable fields');
  [
    new Date('2026-01-02T03:04:05Z'),
    new Date('2026-08-04T12:00:00Z'),
    new Date('2026-12-31T23:59:59Z')
  ].forEach(date => {
    const former = (date.toLocaleDateString() + ' ' + date.toLocaleString([], { month: 'long' })).toLowerCase();
    assert.strictEqual(api.dateSearch(date), former,
      'shared History date formatters changed the searchable date/month words');
  });

  patientRaw = 'patients-v2';
  sandbox.__mlsPtsMemo.raw = patientRaw;
  const roster3 = api.roster(patients);
  assert.notStrictEqual(roster3, roster1, 'patient-store change did not invalidate the roster cache');

  /* An open managed pull has two independent array-replacement clocks.
     upsertPatient advances totalChanges, while a direct savePatients call
     replaces batch.arr and advances externalWrites only. The derived roster
     must observe both or a background hydration/bulk save can leave stale
     patient lookup rows for the remainder of the batch. */
  const batchKey = 'u::patients';
  const batch = sandbox.__mlsPtsBatchByKey[batchKey] = {
    depth: 1, totalChanges: 7, externalWrites: 0,
    arr: [{ id: 'batch-old', name: 'Old Patient' }]
  };
  const batchRoster1 = api.roster(batch.arr.slice());
  assert(batchRoster1.byId.has('batch-old'), 'managed-batch fixture did not warm the old roster');
  batch.arr = [{ id: 'batch-new', name: 'New Patient' }];
  batch.externalWrites++;
  const batchRoster2 = api.roster(batch.arr.slice());
  assert.notStrictEqual(batchRoster2, batchRoster1,
    'direct savePatients replacement did not invalidate the managed-batch roster cache');
  assert(!batchRoster2.byId.has('batch-old') && batchRoster2.byId.has('batch-new'),
    'managed-batch external replacement retained stale patient lookup rows');

  version++;
  notes = notes.concat({ id: 'n-latest', patientId: 'p2', patient: 'Patient Two', cc: 'Latest', updated: Date.parse('2026-08-04T12:00:00Z'), text: 'latest' });
  const visitRows3 = api.visits(roster3);
  assert.notStrictEqual(visitRows3, visitRows1, 'note-store change did not invalidate the visit ranking');
  assert.strictEqual(api.summary('p2').count, 2, 'note-store invalidation retained a stale patient count');
  const history3 = api.history(notes);
  assert.notStrictEqual(history3, history1, 'note-store change did not invalidate History derived data');
  assert.strictEqual(history3.ordered[0].id, 'n-latest', 'History invalidation retained stale chronology');
  assert.strictEqual(history3.duplicates.length, 1, 'duplicate-note cache changed duplicate semantics');
  assert.strictEqual(history3.duplicates[0].id, 'n-old', 'duplicate-note cache kept the wrong duplicate');
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
assert(connect.includes("version: 'sc-1.4.0', enabled: true, early: true"), 'embedded store cache is not sc-1.4.0');
assert(connect.includes('api.ver = function () { return keyTrackingReady ? VER.n : NaN; };'),
  'store-cache legacy generation does not fail closed when hooks are incomplete');
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
  assert(win.__mlsStoreCache && win.__mlsStoreCache.version === 'sc-1.4.0', 'embedded cache did not install in vm');
  assert.strictEqual(typeof win.__mlsStoreCache.ver, 'function', 'ver() missing at runtime');
  const first = win.getPatients();
  assert.strictEqual(first.length, 2, 'wrapped getPatients wrong result');
  const callsAfterFirst = getItemCalls;
  win.getPatients(); win.getPatients(); win.getPatients();
  /* standing review #2 (BLOCKER): a cached patients parse strips the rowguard
     __mlsReadGen generation stamp and bypasses the open-batch branch in the
     base getPatients — so the PATIENTS pair now DELEGATES to the original on
     every read. The base app's own __mlsPtsMemo (b377) makes the cache
     redundant for this key. Reads must consult storage every time. */
  assert(getItemCalls > callsAfterFirst, 'patients reads must delegate to the original (rowguard stamp), never serve a cached parse');
  localStorage.setItem('u::patients', JSON.stringify([{ id: 'a' }]));
  const after = win.getPatients();
  assert.strictEqual(after.length, 1, 'delegated read must see the new write');
}

/* ---------- 6. sanitize sweep batches + self-retires ---------- */
assert(connect.includes('ONE local write for the whole pass'), 'sanitize batching comment/anchor lost');
const sanitizeV2Start = connect.indexOf('SUMMARY SANITIZER v2 + RETROACTIVE SCRUB');
const sanitizeV2End = connect.indexOf('window.__mlsSanitizeV2_revert', sanitizeV2Start);
assert(sanitizeV2Start >= 0 && sanitizeV2End > sanitizeV2Start, 'sanitize-v2 runtime slice is missing');
const sanitizeV2 = connect.slice(sanitizeV2Start, sanitizeV2End);
assert(sanitizeV2.includes('queue.enqueue(ps, dirty, {') && sanitizeV2.includes("fields: ['summary', 'updated']"),
  'sanitize sweep no longer submits one exact cooperative dirty-row batch');
assert(!sanitizeV2.includes('window.savePatients(ps)') && !sanitizeV2.includes('window.upsertPatient('),
  'sanitize sweep returned to renderer-thread whole-roster/per-row persistence');
assert(!/if \(c && c !== s\) \{ p\.summary = c; fixed\+\+; try \{ if \(typeof window\.upsertPatient/.test(connect),
  'per-patient upsertPatient write returned to the sanitize sweep');
assert(connect.includes('window.__mlsSanitizeV2.retired = true;'), 'sanitize sweep no longer self-retires');
assert(connect.includes('cleanRuns >= 5'), 'sanitize self-retire threshold changed unexpectedly');

/* ---------- 6c. chart structuring persists one outer batch ---------- */
const chartModuleStart = connect.indexOf('MLS Scribe - PULLED-CHART STRUCTURING');
const chartStart = connect.indexOf("if (window.__mlsChartStructure && window.__mlsChartStructure.version === '1.2.0') return;", chartModuleStart);
const chartEnd = connect.indexOf('window.__mlsChartStructure_revert = function ()', chartStart);
assert(chartStart >= 0 && chartEnd > chartStart, 'Chart Structure slice is missing');
const chartStructure = connect.slice(chartStart, chartEnd);
assert(!chartStructure.includes('if (changed) upsert(p);'),
  'automatic chart structuring returned to one full-store upsert per patient');
assert.strictEqual((chartStructure.match(/sweepPatient\(candidate, true\)/g) || []).length, 2,
  'automatic and manual Chart Structure callers must both defer row persistence');
assert.strictEqual((chartStructure.match(/persistSweep\(ps, dirty, persistScope/g) || []).length, 1,
  'manual Chart Structure repair must submit one cooperative outer batch');
assert.strictEqual((chartStructure.match(/var candidate = copyPatientForSweep\(/g) || []).length, 2,
  'automatic and manual Chart Structure repairs must stay copy-on-write');
assert(!chartStructure.includes('window.savePatients(ps)'),
  'Chart Structure automatic persistence returned to a renderer-thread roster save');
const chartVisitsStart = chartStructure.indexOf('function addStructuredVisits(p, visits) {');
const chartVisitsEnd = chartStructure.indexOf('\n  /* ---------- compose the new summary', chartVisitsStart);
const chartVisits = chartStructure.slice(chartVisitsStart, chartVisitsEnd);
assert(chartVisits.includes('_patientRef: p') && !chartVisits.includes('getPatients()'),
  'Chart Structure visit repair escaped its copy-on-write row and regained a roster re-read');
assert(chartStructure.includes('var receipt = queue.scan({') && chartStructure.includes('chunkSize: 8'),
  'automatic Chart Structure repair is not routed through bounded yielded maintenance slices');
assert(!chartStructure.includes('setInterval(sweep, 3000)') &&
  chartStructure.includes("bindAutoSweep(window, 'mls:patient-record-updated'") &&
  chartStructure.includes("detail.key !== 'patients:hydrate'") &&
  chartStructure.includes("bindAutoSweep(window, 'storage'"),
  'Chart Structure automatic repair regained the three-second roster scan or lost exact event admission');
const chartSweepStart = chartStructure.indexOf('function sweep() {');
const chartScanStart = chartStructure.indexOf('var receipt = queue.scan({', chartSweepStart);
const chartHiddenReturn = chartStructure.indexOf('if (document.hidden)', chartSweepStart);
const chartBusyReturn = chartStructure.indexOf('if (pullOwnsRoster())', chartSweepStart);
assert(chartHiddenReturn >= 0 && chartHiddenReturn < chartScanStart && chartBusyReturn >= 0 && chartBusyReturn < chartScanStart,
  'Chart Structure must not admit a pull-busy or hidden-roster maintenance scan');

const persistStart = chartStructure.indexOf('function persistSweep(ps, dirty, scope, onSaved) {');
const persistEnd = chartStructure.indexOf('\n  var autoSweepRunning =', persistStart);
assert(persistStart >= 0 && persistEnd > persistStart, 'Chart Structure batch helper is missing');
const persistSource = chartStructure.slice(persistStart, persistEnd);
assert(!persistSource.includes('upsertPatient') && !persistSource.includes('savePatients'),
  'Chart Structure cooperative batch helper regained a direct persistence fallback');
const persistCtx = { enqueueCalls: 0, completionCalls: 0, window: {}, Date, Promise };
persistCtx.window.__mlsMaintenancePersist = { enqueue(rows, dirty, opts) {
  persistCtx.enqueueCalls++; persistCtx.savedRows = rows; persistCtx.dirtyRows = dirty; persistCtx.persistOptions = opts;
  if (opts && typeof opts.onSaved === 'function') opts.onSaved();
  return Promise.resolve({ saved: true, rows });
} };
vm.createContext(persistCtx);
vm.runInContext(
  "var isFn=function(f){return typeof f==='function';};var sweepPersistPending=false;var STATS={lastSweepVer:0};" +
  persistSource +
  ';this.persistSweep=persistSweep;',
  persistCtx, { filename: 'chart-structure-batch.js' });
const chartDirty = Array.from({ length: 8 }, function (_, i) {
  return { id: 'synthetic-' + i, problems: 'Synthetic problem', meds: 'Synthetic medication',
    proof: { sentinel: i }, visits: [{ date: '2026-07-01', raw: 'Synthetic visit' }] };
});
persistCtx.persistSweep(chartDirty, chartDirty.slice(), { key: 'u::patients' }, function () { persistCtx.completionCalls++; });
assert.strictEqual(persistCtx.enqueueCalls, 1, 'eight chart repairs must produce one cooperative enqueue');
assert.strictEqual(persistCtx.completionCalls, 1, 'chart repair completion did not wait for the durable queue receipt');
assert.strictEqual(persistCtx.dirtyRows.length, 8, 'cooperative chart batch lost a dirty patient mirror intent');
assert(persistCtx.persistOptions.fields.includes('visits') && persistCtx.persistOptions.fields.includes('problems'),
  'cooperative chart batch lost its clinical field allowlist');
chartDirty.forEach(function (p, i) {
  assert(Number(p.updated) > 0 && p.proof.sentinel === i && p.visits.length === 1 && p.problems && p.meds,
    'batch persistence changed a clinical/proof field or failed to stamp updated');
});

/* ---------- 6b. every automatic summary scrub batches its store write ---------- */
const continuousStart = connect.indexOf('CONTINUOUS SUMMARY SCRUB');
const continuousEnd = connect.indexOf('var iv = null; try { iv = setInterval(scrub, 2500);', continuousStart);
assert(continuousStart >= 0 && continuousEnd > continuousStart, 'Continuous Scrub slice is missing');
const continuousScrub = connect.slice(continuousStart, continuousEnd);
assert(continuousScrub.includes('queue.enqueue(ps, dirty, {') &&
  continuousScrub.includes("fields: ['summary', 'updated']"),
  'Continuous Scrub no longer submits one exact cooperative dirty-row batch');
assert(!continuousScrub.includes('savePatients(ps)') && !continuousScrub.includes('window.upsertPatient('),
  'Continuous Scrub returned to renderer-thread roster/per-row persistence');
assert(continuousScrub.includes('ps[i] = next') && continuousScrub.includes('dirty.push(next)') &&
  continuousScrub.includes('next.updated = Date.now()'),
  'Continuous Scrub lost isolated dirty-row collection or timestamping');
assert(continuousScrub.includes('onSaved: function ()') && continuousScrub.includes('onFailed: function ()') &&
  continuousScrub.includes('st8.lastScrubVer = null'),
  'Continuous Scrub no longer completes/retries from the cooperative durability receipt');

const baseSanitizeStart = connect.indexOf("try { if (window.__mlsSummarySanitize) return; }");
const baseSanitizeEnd = connect.indexOf('window.__mlsSummarySanitize_revert', baseSanitizeStart);
assert(baseSanitizeStart >= 0 && baseSanitizeEnd > baseSanitizeStart, 'base sanitizer slice is missing');
const baseSanitize = connect.slice(baseSanitizeStart, baseSanitizeEnd);
assert(baseSanitize.includes('queue.enqueue(ps, dirty, {') &&
  baseSanitize.includes("fields: ['summary', 'updated']"),
  'base startup scrub no longer submits one exact cooperative dirty-row batch');
assert(!baseSanitize.includes('savePatients(ps)') && !baseSanitize.includes('window.upsertPatient('),
  'base startup scrub returned to renderer-thread roster/per-row persistence');
assert(baseSanitize.includes('ps[i] = next') && baseSanitize.includes('dirty.push(next)') &&
  baseSanitize.includes('next.updated = Date.now()'),
  'base startup scrub lost isolated dirty-row collection or timestamping');
assert(baseSanitize.includes('onSaved: function ()') && baseSanitize.includes('scrubbed = true') &&
  baseSanitize.includes('onFailed: function () { scrubPersistPending = false; }'),
  'base startup scrub no longer retires/retries from the cooperative durability receipt');

/* Executable generation/account/input/failure/coalescing coverage for the shared
 * queue now lives in maintenance-persistence-queue-runtime.test.js; the two
 * boot scrub owners are exercised at production roster scale by their focused
 * maintenance runtime suites. Keep this file as the cross-module static gate. */

/* ---------- veil floor (also pinned by boot-loading-visual-contract) ---------- */
assert(app.includes('const SF_GATE_MIN_MS=300'), 'veil anti-flash floor regressed (owner-directed near-instant first load, 2026-07-20)');

console.log('PASS patient-scale perf contract: memoized base reads, indexed patientNotes, debounced searches, bounded history, VER fast path (runtime-proven), batched self-retiring sanitize sweep');
