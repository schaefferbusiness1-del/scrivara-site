'use strict';

/* Exact-key store generation contract.
 *
 * This is intentionally a VM test: it executes the production cache IIFEs and
 * the production derived-cache/sweep functions without launching a browser.
 * The synthetic corpus matches the clinic-scale performance contract (800
 * patients / 2,250 notes).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const standalone = fs.readFileSync(path.join(root, 'feat_mls_store_cache.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

const cacheEndMarker = 'window.__mlsStoreCache = api;\n})();';
const cacheEnd = connect.indexOf(cacheEndMarker);
assert(cacheEnd > 0, 'embedded store cache IIFE is missing');
const embedded = connect.slice(0, cacheEnd + cacheEndMarker.length);

function makeCacheHarness(source, initial, options) {
  const opts = options || {};
  let account = 'acct-a';
  const localBacking = Object.assign(Object.create(null), initial || {});
  const sessionBacking = Object.create(null);
  const listeners = Object.create(null);
  let getItemCalls = 0;
  let baseNotesReads = 0;
  const FAIL_WRITE = {};
  let localStorage;
  let sessionStorage;

  function backingFor(receiver) {
    if (receiver === localStorage) return localBacking;
    if (receiver === sessionStorage) return sessionBacking;
    throw new TypeError('Illegal Storage receiver');
  }
  const storageProto = {
    getItem(key) {
      const backing = backingFor(this);
      const resolved = String(key);
      if (this === localStorage) getItemCalls++;
      return Object.prototype.hasOwnProperty.call(backing, resolved) ? backing[resolved] : null;
    },
    setItem(key, value) {
      const backing = backingFor(this);
      const resolved = String(key);
      if (value === FAIL_WRITE) throw new Error('synthetic write refusal');
      backing[resolved] = String(value);
    },
    removeItem(key) {
      const backing = backingFor(this);
      delete backing[String(key)];
    },
    clear() {
      const backing = backingFor(this);
      Object.keys(backing).forEach(key => delete backing[key]);
    }
  };
  if (opts.lockRemoveItem) {
    Object.defineProperty(storageProto, 'removeItem', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: storageProto.removeItem
    });
  }
  localStorage = Object.create(storageProto);
  sessionStorage = Object.create(storageProto);
  const originalGetNotes = function () {
    baseNotesReads++;
    try { return JSON.parse(localStorage.getItem(win.uns('notes')) || '[]'); } catch (e) { return []; }
  };
  const win = {
    localStorage,
    sessionStorage,
    uns(suffix) { return 'sf_u::' + account + '::' + suffix; },
    getPatients() {
      try { return JSON.parse(localStorage.getItem(this.uns('patients')) || '[]'); } catch (e) { return []; }
    },
    getNotes: originalGetNotes,
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter(candidate => candidate !== fn);
    }
  };
  const context = { window: win, localStorage, sessionStorage, Date, console: { log() {} } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'store-cache-production.js' });
  assert(win.__mlsStoreCache, 'store cache did not install');

  return {
    window: win,
    context,
    api: win.__mlsStoreCache,
    localStorage,
    sessionStorage,
    localBacking,
    storageProto,
    FAIL_WRITE,
    originalGetNotes,
    get getItemCalls() { return getItemCalls; },
    get baseNotesReads() { return baseNotesReads; },
    setAccount(value) { account = String(value); },
    dispatchStorage(storageArea, key) {
      (listeners.storage || []).slice().forEach(fn => fn.call(win, { storageArea, key }));
    },
    dispatchGenerationEvent(event) {
      assert(listeners.storage && listeners.storage.length, 'generation storage listener is missing');
      listeners.storage[0].call(win, event);
    }
  };
}

function assertCacheGenerationApi(label, source, legacyAllStorageWrites) {
  const h = makeCacheHarness(source);
  const api = h.api;
  const notesA = h.window.uns('notes');
  const patientsA = h.window.uns('patients');
  const templatesA = h.window.uns('templates');
  assert.strictEqual(typeof api.ver, 'function', label + ': global ver() missing');
  assert.strictEqual(typeof api.verFor, 'function', label + ': scoped verFor() missing');
  assert.notStrictEqual(api.verFor(notesA), api.verFor('sf_u::acct-b::notes'),
    label + ': account-scoped zero generations aliased');
  assert.strictEqual(api.verFor({ toString() { throw new Error('must not coerce'); } }), null,
    label + ': verFor accepted/coerced a non-string key');

  const notes0 = api.verFor(notesA);
  const patients0 = api.verFor(patientsA);
  const templates0 = api.verFor(templatesA);
  const global0 = api.ver();
  for (let i = 0; i < 100; i++) h.localStorage.setItem(h.window.uns('ui-status'), String(i));
  assert.strictEqual(api.ver(), global0 + 200, label + ': global ver() lost localStorage write bumps');
  assert.strictEqual(api.verFor(notesA), notes0, label + ': unrelated writes changed notes generation');
  assert.strictEqual(api.verFor(patientsA), patients0, label + ': unrelated writes changed patients generation');
  assert.strictEqual(api.verFor(templatesA), templates0, label + ': unrelated writes changed templates generation');

  const beforeSessionWrite = api.ver();
  h.sessionStorage.setItem(notesA, 'session-only');
  const afterSessionWrite = beforeSessionWrite + (legacyAllStorageWrites ? 1 : 0);
  assert.strictEqual(api.ver(), afterSessionWrite,
    label + ': same-tab sessionStorage changed this copy\'s legacy VER behavior');
  const beforeSessionEventNotes = api.verFor(notesA);
  h.dispatchStorage(h.sessionStorage, notesA);
  assert.strictEqual(api.ver(), afterSessionWrite + 1,
    label + ': legacy global ver() no longer counts every received storage event');
  assert.strictEqual(api.verFor(notesA), beforeSessionEventNotes,
    label + ': sessionStorage event contaminated the localStorage key generation');

  const borrowedGlobal = api.ver();
  const borrowedNotes = api.verFor(notesA);
  assert.throws(() => h.storageProto.setItem.call({}, 'borrowed-key', 'borrowed-value'), /Illegal Storage receiver/,
    label + ': illegal borrowed receiver unexpectedly succeeded');
  assert.strictEqual(api.ver(), borrowedGlobal + (legacyAllStorageWrites ? 1 : 0),
    label + ': borrowed receiver changed this copy\'s legacy VER behavior');
  assert.strictEqual(api.verFor(notesA), borrowedNotes,
    label + ': borrowed receiver contaminated exact localStorage generations');

  const failedGlobal = api.ver();
  const failedNotes = api.verFor(notesA);
  assert.throws(() => h.localStorage.setItem(notesA, h.FAIL_WRITE), /synthetic write refusal/,
    label + ': synthetic failed write did not throw');
  assert.strictEqual(api.ver(), failedGlobal + 1, label + ': failed write lost conservative global invalidation');
  assert.notStrictEqual(api.verFor(notesA), failedNotes,
    label + ': failed exact-key write lost conservative scoped invalidation');

  const removeNotes0 = api.verFor(notesA);
  const removePatients0 = api.verFor(patientsA);
  h.localStorage.removeItem(notesA);
  assert.notStrictEqual(api.verFor(notesA), removeNotes0,
    label + ': exact-key remove did not invalidate notes');
  assert.strictEqual(api.verFor(patientsA), removePatients0,
    label + ': notes remove invalidated patients');

  let coercions = 0;
  const keyObject = { toString() { coercions++; return notesA; } };
  const beforeObjectPatients = api.verFor(patientsA);
  h.localStorage.setItem(keyObject, 'object-key-write');
  assert.strictEqual(coercions, 1, label + ': wrapper coerced an object key before native Storage');
  assert.notStrictEqual(api.verFor(patientsA), beforeObjectPatients,
    label + ': non-string key did not conservatively advance the all-key epoch');

  const beforePatientWriteNotes = api.verFor(notesA);
  const beforePatientWritePatients = api.verFor(patientsA);
  h.localStorage.setItem(patientsA, '[]');
  assert.strictEqual(api.verFor(notesA), beforePatientWriteNotes,
    label + ': patient write invalidated notes');
  assert.notStrictEqual(api.verFor(patientsA), beforePatientWritePatients,
    label + ': patient write did not invalidate patients');

  const composite0 = api.verFor([patientsA, templatesA]);
  h.localStorage.setItem(templatesA, '[]');
  assert.notStrictEqual(api.verFor([patientsA, templatesA]), composite0,
    label + ': template write did not invalidate composite generation');
  const afterTemplateNotes = api.verFor(notesA);
  const afterTemplatePatients = api.verFor(patientsA);
  h.localStorage.clear();
  assert.notStrictEqual(api.verFor(notesA), afterTemplateNotes, label + ': clear did not invalidate notes');
  assert.notStrictEqual(api.verFor(patientsA), afterTemplatePatients, label + ': clear did not invalidate patients');

  const crossNotes0 = api.verFor(notesA);
  const crossPatients0 = api.verFor(patientsA);
  h.dispatchStorage(h.localStorage, notesA);
  assert.notStrictEqual(api.verFor(notesA), crossNotes0, label + ': cross-tab notes event did not invalidate notes');
  assert.strictEqual(api.verFor(patientsA), crossPatients0,
    label + ': cross-tab notes event invalidated patients');
  const nullPatients0 = api.verFor(patientsA);
  h.dispatchStorage(h.localStorage, null);
  assert.notStrictEqual(api.verFor(patientsA), nullPatients0, label + ': key-null event did not invalidate all keys');

  let uncertainKeyReads = 0;
  const uncertainGlobal = api.ver();
  const uncertainNotes = api.verFor(notesA);
  const uncertainPatients = api.verFor(patientsA);
  const uncertainEvent = {};
  Object.defineProperty(uncertainEvent, 'storageArea', { get() { throw new Error('uncertain area'); } });
  Object.defineProperty(uncertainEvent, 'key', { get() { uncertainKeyReads++; return notesA; } });
  h.dispatchGenerationEvent(uncertainEvent);
  assert.strictEqual(api.ver(), uncertainGlobal + 1,
    label + ': uncertain event did not advance global VER exactly once');
  assert.strictEqual(uncertainKeyReads, 0, label + ': uncertain event inspected/scoped its key');
  assert.notStrictEqual(api.verFor(notesA), uncertainNotes,
    label + ': uncertain event did not conservatively invalidate notes');
  assert.notStrictEqual(api.verFor(patientsA), uncertainPatients,
    label + ': uncertain event did not conservatively invalidate patients');

  h.setAccount('acct-b');
  assert.notStrictEqual(api.verFor(h.window.uns('notes')), api.verFor(notesA),
    label + ': account switch reused the former full-key stamp');

  /* Preserve the public revert boundary: accessor wrappers/listeners are the
     only state it historically owned. The generation prototype hook remains
     outside that public rollback, exactly as before this optimization. */
  api.revert();
  assert.strictEqual(h.window.getNotes, h.originalGetNotes, label + ': revert did not restore getNotes');
  assert.strictEqual(h.window.__mlsStoreCache, undefined, label + ': revert did not remove the public API');
}

assertCacheGenerationApi('embedded', embedded, false);
assertCacheGenerationApi('standalone fallback', standalone, true);

/* Native Storage coerces object arguments after entering the wrapped method.
   A coercion hook can re-enter getNotes() while the old bytes are still stored;
   the successful-write bump must invalidate that old snapshot after native
   Storage returns. Cover key and value coercion independently for both cache
   copies so neither can regress to a stale warm read. */
function assertReentrantCoercionInvalidates(label, source, mode) {
  const notesKey = 'sf_u::acct-a::notes';
  const oldNotes = JSON.stringify([{ id: 'old-note', patientId: 'p1' }]);
  const newNotes = JSON.stringify([{ id: 'new-note', patientId: 'p1' }]);
  const h = makeCacheHarness(source, { [notesKey]: oldNotes });
  const readDerived = makeDerivedNoteReader(h, label + ' derived notes');
  assert.strictEqual(h.window.getNotes()[0].id, 'old-note',
    label + ': warm read fixture is wrong');
  assert.strictEqual(readDerived()[0].id, 'old-note',
    label + ': derived warm read fixture is wrong');

  let reentrantReads = 0;
  if (mode === 'value') {
    h.localStorage.setItem(notesKey, {
      toString() {
        reentrantReads++;
        assert.strictEqual(h.window.getNotes()[0].id, 'old-note',
          label + ': value coercion did not re-enter before native write');
        assert.strictEqual(readDerived()[0].id, 'old-note',
          label + ': value coercion derived read fixture is wrong');
        return newNotes;
      }
    });
  } else {
    h.localStorage.setItem({
      toString() {
        reentrantReads++;
        assert.strictEqual(h.window.getNotes()[0].id, 'old-note',
          label + ': key coercion did not re-enter before native write');
        assert.strictEqual(readDerived()[0].id, 'old-note',
          label + ': key coercion derived read fixture is wrong');
        return notesKey;
      }
    }, newNotes);
  }

  assert.strictEqual(reentrantReads, 1, label + ': native argument was coerced more than once');
  assert.strictEqual(h.localBacking[notesKey], newNotes, label + ': native write fixture failed');
  assert.strictEqual(h.window.getNotes()[0].id, 'new-note',
    label + ': re-entrant warm snapshot survived the completed write');
  assert.strictEqual(readDerived()[0].id, 'new-note',
    label + ': re-entrant exact-key derived snapshot survived the completed write');
}

[
  ['embedded', embedded],
  ['standalone fallback', standalone]
].forEach(([label, source]) => {
  assertReentrantCoercionInvalidates(label + ' value coercion', source, 'value');
  assertReentrantCoercionInvalidates(label + ' key coercion', source, 'key');
});

/* Pre-owned or partially assignable hooks make same-tab observation
   unprovable. Both public generations and the wrapped read fast path must fail
   closed: a real successful write/remove must be visible on the very next read
   instead of hiding behind a frozen fallback VER. */
function makeDerivedNoteReader(h, label) {
  const helperStart = app.indexOf('var __mlsNotesIdx={ver:-1,map:null};');
  const helperEnd = app.indexOf('/* ---------- SERVER SYNC (hosted mode only) ----------', helperStart);
  assert(helperStart > 0 && helperEnd > helperStart, label + ': notes helper extraction failed');
  const context = {
    window: h.window,
    getNotes() { return h.window.getNotes(); },
    getPatients() { return h.window.getPatients(); },
    uns(suffix) { return h.window.uns(suffix); },
    localStorage: h.localStorage,
    __mlsPtsBatchByKey: Object.create(null),
    __mlsPtsMemo: null,
    setTimeout, clearTimeout, Date, Map, Object, Number, String, Array, isFinite,
    console: { log() {} }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(helperStart, helperEnd) + '\nthis.readDerivedNotes=patientNotes;', context,
    { filename: label + '-incomplete-hook-derived-notes.js' });
  return function () { return context.readDerivedNotes('p1'); };
}

function assertIncompleteHooksFailClosed(label, source) {
  const notesKey = 'sf_u::acct-a::notes';
  const oldNotes = JSON.stringify([{ id: 'old-note', patientId: 'p1' }]);
  const newNotes = JSON.stringify([{ id: 'new-note', patientId: 'p1' }]);
  const markerSource = source.replace(
    "  try { if (window.__mlsStoreCache) return; } catch (e) { return; }",
    "  try { if (window.__mlsStoreCache) return; } catch (e) { return; }\n  Object.getPrototypeOf(window.localStorage).setItem.__mlsScVer = 1;"
  );
  assert.notStrictEqual(markerSource, source, label + ': pre-owned-hook control did not alter the source');
  const preOwned = makeCacheHarness(markerSource, { [notesKey]: oldNotes });
  assert.strictEqual(preOwned.api.verFor(notesKey), null,
    label + ': verFor did not fail closed when hooks were already owned');
  assert(Number.isNaN(preOwned.api.ver()),
    label + ': legacy ver() exposed a stable value when same-tab hooks were already owned');
  const readPreOwnedDerived = makeDerivedNoteReader(preOwned, label + '-pre-owned');
  assert.strictEqual(preOwned.window.getNotes()[0].id, 'old-note',
    label + ': pre-owned-hook warm read fixture is wrong');
  assert.strictEqual(readPreOwnedDerived()[0].id, 'old-note',
    label + ': pre-owned-hook derived warm read fixture is wrong');
  preOwned.localStorage.setItem(notesKey, newNotes);
  assert.strictEqual(preOwned.window.getNotes()[0].id, 'new-note',
    label + ': pre-owned-hook fallback served stale notes after a successful write');
  assert.strictEqual(readPreOwnedDerived()[0].id, 'new-note',
    label + ': pre-owned-hook derived cache stayed stale after a successful write');

  const partial = makeCacheHarness(source, { [notesKey]: oldNotes }, { lockRemoveItem: true });
  assert.strictEqual(partial.api.verFor(notesKey), null,
    label + ': verFor did not fail closed when one hook could not be assigned');
  assert(Number.isNaN(partial.api.ver()),
    label + ': legacy ver() exposed a stable value when one hook was missing');
  const readPartialDerived = makeDerivedNoteReader(partial, label + '-partial');
  assert.strictEqual(partial.window.getNotes()[0].id, 'old-note',
    label + ': partial-hook warm read fixture is wrong');
  assert.strictEqual(readPartialDerived()[0].id, 'old-note',
    label + ': partial-hook derived warm read fixture is wrong');
  partial.localStorage.removeItem(notesKey);
  assert.strictEqual(partial.window.getNotes().length, 0,
    label + ': partial-hook fallback served removed clinical notes from cache');
  assert.strictEqual(readPartialDerived().length, 0,
    label + ': partial-hook derived cache retained removed clinical notes');
}

assertIncompleteHooksFailClosed('embedded', embedded);
assertIncompleteHooksFailClosed('standalone fallback', standalone);

function makePatients(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: 'p' + i,
    name: 'Patient ' + String(i).padStart(4, '0'),
    dob: '01/01/1980',
    mrn: 'M' + String(i).padStart(5, '0'),
    summary: 'Stable clinical summary ' + 'x'.repeat(100),
    _mlsStructuredV1: 1
  }));
}
function makeNotes(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: 'n' + i,
    patientId: 'p' + (i % 800),
    patient: 'Patient ' + String(i % 800).padStart(4, '0'),
    cc: 'Synthetic follow up ' + (i % 13),
    text: 'Synthetic clinical note body ' + String(i).padStart(5, '0') + ' ' + 'detail '.repeat(24),
    created: 1754000000000 + i,
    updated: 1754000000000 + i
  }));
}

/* Notes/History: warm the production helpers over the requested corpus and
   prove 100 global-only writes preserve all derived object identities. */
{
  const patients = makePatients(800);
  const notes = makeNotes(2250);
  const patientKey = 'sf_u::acct-a::patients';
  const noteKey = 'sf_u::acct-a::notes';
  const h = makeCacheHarness(embedded, {
    [patientKey]: JSON.stringify(patients),
    [noteKey]: JSON.stringify(notes)
  });
  const helperStart = app.indexOf('var __mlsNotesIdx={ver:-1,map:null};');
  const helperEnd = app.indexOf('/* ---------- SERVER SYNC (hosted mode only) ----------', helperStart);
  assert(helperStart > 0 && helperEnd > helperStart, 'patient/history helpers are missing');
  const context = {
    window: h.window,
    getNotes() { return h.window.getNotes(); },
    uns(suffix) { return h.window.uns(suffix); },
    localStorage: h.localStorage,
    __mlsPtsBatchByKey: Object.create(null),
    __mlsPtsMemo: { key: patientKey, raw: h.localBacking[patientKey] },
    setTimeout, clearTimeout, Date, Map, Object, Number, String, Array, isFinite
  };
  vm.createContext(context);
  vm.runInContext(app.slice(helperStart, helperEnd) + `
    this.perfApi={
      patientNotes:patientNotes,
      noteMap:function(){return __mlsNotesIdx.map;},
      roster:__mlsPtRosterData,
      visits:__mlsPtVisitRows,
      history:__mlsHistoryData
    };`, context, { filename: 'notes-history-production.js' });
  const api = context.perfApi;
  const input = h.window.getNotes();
  const roster = api.roster(patients);
  const firstPatientNotes = api.patientNotes('p0');
  const noteMap0 = api.noteMap();
  const visits0 = api.visits(roster);
  const history0 = api.history(input);
  assert.strictEqual(firstPatientNotes.length, 3, 'synthetic note index count is wrong');
  for (let i = 0; i < 100; i++) h.localStorage.setItem(h.window.uns('ui-status'), String(i));
  assert.strictEqual(api.patientNotes('p0').length, 3, 'unrelated writes changed indexed notes');
  assert.strictEqual(api.noteMap(), noteMap0, 'unrelated writes rebuilt the notes Map');
  assert.strictEqual(api.visits(roster), visits0, 'unrelated writes rebuilt visit ranking');
  assert.strictEqual(api.history(input), history0, 'unrelated writes rebuilt History data');

  const changedNotes = notes.concat({
    id: 'n-new', patientId: 'p0', patient: 'Patient 0000', cc: 'New exact-key note',
    text: 'new exact-key body', created: 1755000000000, updated: 1755000000000
  });
  h.localStorage.setItem(noteKey, JSON.stringify(changedNotes));
  const changedInput = h.window.getNotes();
  assert.strictEqual(api.patientNotes('p0').length, 4, 'notes write did not rebuild the note index');
  const noteMap1 = api.noteMap();
  assert.notStrictEqual(noteMap1, noteMap0, 'notes write retained the former notes Map');
  const visits1 = api.visits(roster);
  const history1 = api.history(changedInput);
  assert.notStrictEqual(visits1, visits0, 'notes write did not rebuild visit ranking');
  assert.notStrictEqual(history1, history0, 'notes write did not rebuild History');
  assert.strictEqual(api.noteMap(), noteMap1, 'one notes write rebuilt the note index more than once');
  assert.strictEqual(api.visits(roster), visits1, 'one notes write rebuilt visit ranking more than once');
  assert.strictEqual(api.history(changedInput), history1, 'one notes write rebuilt History more than once');

  const crossHistory0 = history1;
  h.dispatchStorage(h.localStorage, noteKey);
  const crossHistory1 = api.history(changedInput);
  assert.notStrictEqual(crossHistory1, crossHistory0, 'cross-tab notes event did not invalidate History');
  assert.strictEqual(api.history(changedInput), crossHistory1,
    'one cross-tab notes event rebuilt History more than once');

  h.setAccount('acct-b');
  const notesB = [{ id: 'b1', patientId: 'p0', patient: 'Account B', cc: 'Isolated', text: 'B', updated: 1 }];
  h.localStorage.setItem(h.window.uns('notes'), JSON.stringify(notesB));
  const inputB = h.window.getNotes();
  const historyB = api.history(inputB);
  assert.notStrictEqual(historyB, crossHistory1, 'account switch reused account A History');
  assert.strictEqual(historyB.ordered[0].id, 'b1', 'account switch returned cross-account note data');
}

/* Chart Structure and Continuous Scrub: invoke the exact production timer
   bodies. A "tick" below means the scheduled callback ran; zero additional
   roster reads/row scans proves its expensive body was skipped. */
{
  const chartModule = connect.indexOf('MLS Scribe - PULLED-CHART STRUCTURING');
  const chartFnStart = connect.indexOf('  function sweep() {', chartModule);
  const chartFnEnd = connect.indexOf('\n\n  /* ---------- install', chartFnStart);
  const scrubModule = connect.indexOf('CONTINUOUS SUMMARY SCRUB');
  const scrubFnStart = connect.indexOf('  function scrub() {', scrubModule);
  const scrubFnEnd = connect.indexOf('\n\n  var iv = null;', scrubFnStart);
  assert(chartFnStart > chartModule && chartFnEnd > chartFnStart, 'chart sweep function is missing');
  assert(scrubFnStart > scrubModule && scrubFnEnd > scrubFnStart, 'continuous scrub function is missing');
  const scrubSource = connect.slice(scrubFnStart, scrubFnEnd);
  assert(scrubSource.indexOf("if (!S || typeof S.strip !== 'function' || typeof S.hasCode !== 'function') return;") <
    scrubSource.indexOf('st8.lastScrubVer = v8'),
    'Continuous Scrub stamps a generation before sanitizer availability is proven');

  const patients = makePatients(800);
  const patientKey = 'sf_u::acct-a::patients';
  const h = makeCacheHarness(embedded, { [patientKey]: JSON.stringify(patients) });
  const counts = { patientReads: 0, chartRows: 0, scrubRows: 0 };
  const sanitizer = { strip(value) { return value; }, hasCode() { counts.scrubRows++; return false; } };
  h.window.__mlsContinuousScrub = { version: '1.0.0', cleaned: 0 };
  h.window.__mlsSummarySanitize = sanitizer;
  /* Production installs the cooperative maintenance owner before these legacy
     sweeps. Keep the extraction harness on that real dependency boundary; a
     clean roster must scan once but can never enqueue persistence. */
  h.window.__mlsMaintenancePersist = {
    capture() { return { key: patientKey, account: 'acct-a', token: '', raw: h.localStorage.getItem(patientKey) }; },
    enqueue() { throw new Error('clean synthetic roster reached maintenance persistence'); }
  };
  h.window.getPatients = function () { counts.patientReads++; return patients.slice(); };
  const context = {
    window: h.window,
    document: { hidden: false },
    STATS: { structured: 0, savesWrapped: 0, sweepPasses: 0 },
    API: { summaryMode: 'digest' },
    sweepPersistPending: false,
    scrubPersistPending: false,
    getPatients() { return h.window.getPatients(); },
    needsWork() { counts.chartRows++; return false; },
    sweepPatient() { throw new Error('clean synthetic patient reached sweepPatient'); },
    persistSweep() { throw new Error('clean synthetic roster reached persistence'); },
    isFn(fn) { return typeof fn === 'function'; },
    Date, Number, console: { log() {} }
  };
  vm.createContext(context);
  vm.runInContext(connect.slice(chartFnStart, chartFnEnd) + '\nthis.runChartSweep=sweep;', context,
    { filename: 'chart-sweep-production.js' });
  vm.runInContext(connect.slice(scrubFnStart, scrubFnEnd) + '\nthis.runContinuousScrub=scrub;', context,
    { filename: 'continuous-scrub-production.js' });

  context.runChartSweep();
  context.runContinuousScrub();
  const warm = Object.assign({}, counts);
  assert.deepStrictEqual(warm, { patientReads: 2, chartRows: 800, scrubRows: 800 },
    'warm timer passes did not scan exactly one 800-patient roster each');
  for (let i = 0; i < 100; i++) {
    h.localStorage.setItem(h.window.uns('ui-status'), String(i));
    context.runChartSweep();
    context.runContinuousScrub();
  }
  assert.deepStrictEqual(counts, warm, '100 unrelated writes re-armed full-roster timer work');

  h.localStorage.setItem(patientKey, JSON.stringify(patients));
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 4, chartRows: 1600, scrubRows: 1600 },
    'one patient write did not re-arm each full-roster consumer exactly once');
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 4, chartRows: 1600, scrubRows: 1600 },
    'one patient write re-armed a consumer more than once');

  const replacement = { strip(value) { return value; }, hasCode() { counts.scrubRows++; return false; } };
  h.window.__mlsSummarySanitize = replacement;
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 6, chartRows: 2400, scrubRows: 2400 },
    'sanitizer object/function replacement did not re-arm dependent consumers once');
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 6, chartRows: 2400, scrubRows: 2400 },
    'stable sanitizer identities repeatedly re-armed consumers');

  replacement.strip = function (value) { return value; };
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 8, chartRows: 3200, scrubRows: 3200 },
    'same-object strip replacement did not re-arm both strip consumers once');
  replacement.hasCode = function () { counts.scrubRows++; return false; };
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 9, chartRows: 3200, scrubRows: 4000 },
    'same-object hasCode replacement did not re-arm only Continuous Scrub once');

  context.API.summaryMode = 'short';
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 10, chartRows: 4000, scrubRows: 4000 },
    'summaryMode failed to re-arm only Chart Structure');

  h.window.getPatients = function () { counts.patientReads++; return patients.slice(); };
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 12, chartRows: 4800, scrubRows: 4800 },
    'getPatients replacement did not re-arm each dependent consumer once');
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 12, chartRows: 4800, scrubRows: 4800 },
    'stable getPatients identity repeatedly re-armed consumers');

  h.dispatchStorage(h.localStorage, h.window.uns('notes'));
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 12, chartRows: 4800, scrubRows: 4800 },
    'cross-tab notes event re-armed patient-only consumers');
  h.dispatchStorage(h.localStorage, patientKey);
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 14, chartRows: 5600, scrubRows: 5600 },
    'cross-tab patient event did not re-arm each patient consumer once');

  h.localStorage.clear();
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 16, chartRows: 6400, scrubRows: 6400 },
    'clear did not re-arm each patient consumer once');

  h.setAccount('acct-b');
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 18, chartRows: 7200, scrubRows: 7200 },
    'account-key switch did not re-arm each patient consumer once');
}

/* Compatibility: every migrated production consumer must retain the former
   global-clock behavior when exact-key observation is unavailable. Cover both
   an older cache with no verFor method and a partial cache whose verFor fails
   closed to null. One unrelated legacy write must rebuild/scan once; a second
   read at the same global generation must reuse that result. */
function assertLegacyConsumerFallback(mode) {
  const patients = makePatients(12);
  const notes = makeNotes(30);
  const patientKey = 'sf_u::acct-a::patients';
  const noteKey = 'sf_u::acct-a::notes';
  const h = makeCacheHarness(embedded, {
    [patientKey]: JSON.stringify(patients),
    [noteKey]: JSON.stringify(notes)
  });
  if (mode === 'absent') delete h.window.__mlsStoreCache.verFor;
  else h.window.__mlsStoreCache.verFor = function () { return null; };

  const helperStart = app.indexOf('var __mlsNotesIdx={ver:-1,map:null};');
  const helperEnd = app.indexOf('/* ---------- SERVER SYNC (hosted mode only) ----------', helperStart);
  const chartModule = connect.indexOf('MLS Scribe - PULLED-CHART STRUCTURING');
  const chartFnStart = connect.indexOf('  function sweep() {', chartModule);
  const chartFnEnd = connect.indexOf('\n\n  /* ---------- install', chartFnStart);
  const scrubModule = connect.indexOf('CONTINUOUS SUMMARY SCRUB');
  const scrubFnStart = connect.indexOf('  function scrub() {', scrubModule);
  const scrubFnEnd = connect.indexOf('\n\n  var iv = null;', scrubFnStart);
  assert(helperStart > 0 && helperEnd > helperStart, mode + ': patient/history helpers are missing');
  assert(chartFnStart > chartModule && chartFnEnd > chartFnStart, mode + ': chart sweep is missing');
  assert(scrubFnStart > scrubModule && scrubFnEnd > scrubFnStart, mode + ': continuous scrub is missing');

  const counts = { patientReads: 0, chartRows: 0, scrubRows: 0 };
  const sanitizer = {
    strip(value) { return value; },
    hasCode() { counts.scrubRows++; return false; }
  };
  h.window.__mlsSummarySanitize = sanitizer;
  h.window.__mlsContinuousScrub = { version: '1.0.0', cleaned: 0 };
  h.window.__mlsMaintenancePersist = {
    capture() { return { key: patientKey, account: 'acct-a', token: '', raw: h.localStorage.getItem(patientKey) }; },
    enqueue() { throw new Error('clean fallback roster reached maintenance persistence'); }
  };
  h.window.getPatients = function () { counts.patientReads++; return patients.slice(); };
  const context = {
    window: h.window,
    document: { hidden: false },
    getNotes() { return h.window.getNotes(); },
    getPatients() { return h.window.getPatients(); },
    uns(suffix) { return h.window.uns(suffix); },
    localStorage: h.localStorage,
    __mlsPtsBatchByKey: Object.create(null),
    __mlsPtsMemo: { key: patientKey, raw: h.localBacking[patientKey] },
    STATS: { structured: 0, savesWrapped: 0, sweepPasses: 0 },
    API: { summaryMode: 'digest' },
    sweepPersistPending: false,
    scrubPersistPending: false,
    needsWork() { counts.chartRows++; return false; },
    sweepPatient() { throw new Error('clean fallback patient reached sweepPatient'); },
    persistSweep() { throw new Error('clean fallback roster reached persistence'); },
    isFn(fn) { return typeof fn === 'function'; },
    setTimeout, clearTimeout, Date, Map, Object, Number, String, Array, isFinite,
    console: { log() {} }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(helperStart, helperEnd) + `
    this.fallbackApi={
      patientNotes:patientNotes,
      noteMap:function(){return __mlsNotesIdx.map;},
      roster:__mlsPtRosterData,
      visits:__mlsPtVisitRows,
      history:__mlsHistoryData
    };`, context, { filename: mode + '-fallback-notes-history.js' });
  vm.runInContext(connect.slice(chartFnStart, chartFnEnd) + '\nthis.runChartSweep=sweep;', context,
    { filename: mode + '-fallback-chart.js' });
  vm.runInContext(connect.slice(scrubFnStart, scrubFnEnd) + '\nthis.runContinuousScrub=scrub;', context,
    { filename: mode + '-fallback-scrub.js' });

  const api = context.fallbackApi;
  const input = h.window.getNotes();
  const roster = api.roster(patients);
  api.patientNotes('p0');
  const map0 = api.noteMap();
  const visits0 = api.visits(roster);
  const history0 = api.history(input);
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 2, chartRows: 12, scrubRows: 12 },
    mode + ': fallback consumers did not complete one warm pass');

  h.localStorage.setItem(h.window.uns('ui-status'), mode);
  api.patientNotes('p0');
  const map1 = api.noteMap();
  const visits1 = api.visits(roster);
  const history1 = api.history(input);
  context.runChartSweep();
  context.runContinuousScrub();
  assert.notStrictEqual(map1, map0, mode + ': Notes Map ignored the legacy global write');
  assert.notStrictEqual(visits1, visits0, mode + ': visit ranking ignored the legacy global write');
  assert.notStrictEqual(history1, history0, mode + ': History ignored the legacy global write');
  assert.deepStrictEqual(counts, { patientReads: 4, chartRows: 24, scrubRows: 24 },
    mode + ': chart/scrub did not rescan exactly once after the legacy global write');

  api.patientNotes('p0');
  assert.strictEqual(api.noteMap(), map1, mode + ': Notes Map rebuilt twice at one global generation');
  assert.strictEqual(api.visits(roster), visits1, mode + ': visit ranking rebuilt twice at one global generation');
  assert.strictEqual(api.history(input), history1, mode + ': History rebuilt twice at one global generation');
  context.runChartSweep();
  context.runContinuousScrub();
  assert.deepStrictEqual(counts, { patientReads: 4, chartRows: 24, scrubRows: 24 },
    mode + ': chart/scrub rescanned twice at one global generation');
}

assertLegacyConsumerFallback('absent');
assertLegacyConsumerFallback('null');

console.log('PASS exact-key store generations: account/clear/failure safe, 100 unrelated writes cause zero derived/timer rebuilds');
