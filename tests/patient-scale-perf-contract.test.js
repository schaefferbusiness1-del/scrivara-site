/* patient-scale-perf-contract.test.js — b375
 *
 * Pins the patient-scale performance pass:
 *  1. Base getPatients() memoizes on RAW string identity (multi-MB LZ decode +
 *     JSON.parse runs once per stored change, not per call) and savePatients()
 *     invalidates the memo before writing.
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

/* ---------- 1. base getPatients memo ---------- */
assert(app.includes('var __mlsPtsMemo=null;'), 'getPatients raw-identity memo was removed');
assert(app.includes('if(__mlsPtsMemo&&__mlsPtsMemo.raw===raw)return __mlsPtsMemo.arr.slice();'),
  'getPatients no longer serves memoized parses on identical raw strings');
assert(app.includes("__mlsPtsMemo=null; /* never serve a pre-write parse after a write */"),
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

/* ---------- veil floor (also pinned by boot-loading-visual-contract) ---------- */
assert(app.includes('const SF_GATE_MIN_MS=1800'), 'veil minimum floor regressed');

console.log('PASS patient-scale perf contract: memoized base reads, indexed patientNotes, debounced searches, bounded history, VER fast path (runtime-proven), batched self-retiring sanitize sweep');
