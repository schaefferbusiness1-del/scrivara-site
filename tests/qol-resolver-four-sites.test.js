'use strict';
/* qol-2.0 per-call-site non-vacuity: EACH decision site is EXECUTED twice —
   once with the resolver saying ON, once OFF — and its decision must flip.
   A site that ignores the resolver (the original defect: four inline readers,
   each free to disagree) fails here by name. The resolver itself is
   execution-proven in pull-visit-bodies-default-on; here it is a stub so a
   site's private storage read cannot sneak a matching answer. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

const stub = on => ({ read: () => ({ state: on ? 'on' : 'off', on: on }), write: () => true, isPrefKey: () => false });
/* poisoned storage: if a site reads raw keys instead of the resolver, it sees
   the OPPOSITE of what the stub says and the flip assertion catches it */
const poisonedStorage = on => ({ getItem: k => (/pullVisitBodies|visitNotesModeV2/.test(String(k)) ? (on ? '0' : '1') : null), setItem: () => {}, removeItem: () => {} });

function extractUnique(src, startMarker, endMarker, label) {
  const s = src.indexOf(startMarker);
  assert(s >= 0, label + ': start marker missing');
  assert.strictEqual(src.indexOf(startMarker, s + 1), -1, label + ': start marker not unique');
  const e = src.indexOf(endMarker, s + startMarker.length);
  assert(e > s, label + ': end marker missing');
  return src.slice(s, e + endMarker.length);
}

/* ---- site 1: si batch reader ---- */
{
  const block = extractUnique(si, 'var pullVisitBodies = safe(function () {', '}, true);', 'si reader');
  function run(on) {
    const ctx = vm.createContext({
      safe: (fn, fb) => { try { return fn(); } catch (e) { return fb; } },
      _pullBodiesOverride: null,
      window: { __mlsVisitNotesPref: stub(on) },
      localStorage: poisonedStorage(on)
    });
    vm.runInContext(block + '\nthis.__pv = pullVisitBodies;', ctx);
    return ctx.__pv;
  }
  assert.strictEqual(run(true), true, 'site 1 (si reader): resolver ON -> bodies ON');
  assert.strictEqual(run(false), false, 'site 1 (si reader): resolver OFF -> bodies OFF (a private storage read would have said ON)');
}

/* ---- site 2: the legacy-leg triOn gate ---- */
{
  const line = extractUnique(mc, 'var triOn = (function () {', '})(); /* qol-2.0 ONE RESOLVER */', 'triOn');
  function run(on) {
    const ctx = vm.createContext({ window: { __mlsVisitNotesPref: stub(on) }, localStorage: poisonedStorage(on) });
    vm.runInContext(line + '\nthis.__t = triOn;', ctx);
    return ctx.__t;
  }
  assert.strictEqual(run(true), true, 'site 2 (triOn): resolver ON -> full leg allowed');
  assert.strictEqual(run(false), false, 'site 2 (triOn): resolver OFF -> full leg blocked');
}

/* ---- site 3: the fourth reader (history batch) — resolver drives it AND
        OFF now runs the day-scoped read (the previously-missing day-note
        guarantee), executed with a capturing vp2 ---- */
{
  const block = extractUnique(mc, 'var fullLeg = Promise.resolve();', '} catch (eV) {}', 'fourth reader');
  assert(/onlyDate/.test(block), 'site 3: the OFF branch must exist and be day-scoped');
  function run(on) {
    const calls = [];
    const ctx = vm.createContext({
      window: {
        __mlsVisitNotesPref: stub(on),
        __mlsVisitSavePref: { runForPatient: function (p, cb, runOpts) { calls.push(runOpts || null); return Promise.resolve({ ok: true }); } }
      },
      localStorage: poisonedStorage(on),
      pSaved: { id: 'p1', name: 'T' },
      a: { date: '2026-07-07' },
      progressSay: () => {},
      Promise: Promise
    });
    vm.runInContext(block, ctx);
    return calls;
  }
  const onCalls = run(true);
  assert.strictEqual(onCalls.length, 1, 'site 3: resolver ON -> the full every-visit leg runs');
  assert.strictEqual(onCalls[0], null, 'site 3: the ON leg is NOT day-scoped');
  const offCalls = run(false);
  assert.strictEqual(offCalls.length, 1, 'site 3: resolver OFF -> the day-scoped read still runs (the pulled-day note is guaranteed)');
  /* field compare, not deepStrictEqual: the object was born inside the vm
     context and carries that context's Object.prototype */
  assert.strictEqual(offCalls[0] && offCalls[0].onlyDate, '2026-07-07', 'site 3: OFF is scoped to exactly the pulled day');
  assert.strictEqual(Object.keys(offCalls[0]).length, 1, 'site 3: the day scope is the ONLY option passed');
}

/* ---- site 4: __mlsVisitSavePref.enabled() ---- */
{
  const block = extractUnique(mc, 'function enabled() { /* qol-2.0', 'api.enabled = enabled;', 'vp enabled');
  function run(on) {
    const ctx = vm.createContext({
      window: { __mlsVisitNotesPref: stub(on) },
      localStorage: poisonedStorage(on),
      document: { getElementById: () => null },
      api: {}
    });
    vm.runInContext(block + '\nthis.__e = enabled; this.__s = setEnabled;', ctx);
    return ctx;
  }
  assert.strictEqual(run(true).__e(), true, 'site 4 (vp.enabled): resolver ON -> true');
  assert.strictEqual(run(false).__e(), false, 'site 4 (vp.enabled): resolver OFF -> false');
  /* setEnabled returns the resolver's read-back confirmation, not undefined */
  assert.strictEqual(run(true).__s(true), true, 'site 4 (vp.setEnabled): confirmed write returns true');
}

/* ---- sites 5+6 (relay payload + dedupe identity) are executed in
        qol-setting-reaches-the-pull with the REAL resolver; assert here only
        that both consult it, so this file names every site ---- */
assert(/_vr = \(window\.__mlsVisitNotesPref/.test(mc), 'site 5 (relay payload) consults the resolver');
assert(/vr3 = \(window\.__mlsVisitNotesPref/.test(mc), 'site 6 (dedupe identity) consults the resolver');

console.log('qol-resolver-four-sites: OK (4 sites executed and flipped by the resolver against poisoned storage; OFF day-note guarantee executed; payload+dedupe consult pinned)');
