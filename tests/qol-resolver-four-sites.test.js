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

/* The ONE RESOLVER's read() answers {state,on,settled}: tri-state PLUS the
   sbp-1.0 `settled` flag (during boot uns() builds a placeholder namespace and
   the answer is provisional). dayfacts-1.0.1 made __mlsVisitSavePref.enabled()
   honour that flag, so a stub that omits it no longer speaks the contract —
   it is a settled answer that is being flipped here, nothing weaker. */
const stub = on => ({ read: () => ({ state: on ? 'on' : 'off', on: on, settled: true }), write: () => true, isPrefKey: () => false });
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
  const block = extractUnique(si, 'var pullVisitBodies = safe(function () {', '}, false);', 'si reader');
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

/* ---- site 3: the fourth reader (history batch) — resolver drives it;
        ON runs the unscoped full-visit reader and OFF opens no note body ---- */
{
  const block = extractUnique(mc, 'var fullLeg = Promise.resolve();', '} catch (eV) {}', 'fourth reader');
  assert(!/onlyDate/.test(block), 'site 3: the OFF branch still opens the pulled-day note body');
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
  assert.strictEqual(offCalls.length, 0, 'site 3: resolver OFF still opened a visit-note body');
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

  /* dayfacts-1.0.1 POSITIVE PIN: the unscoped door is no softer than the
     day-scoped one. enabled() admits ONLY a coherent, SETTLED 'on'. The three
     refusals below are the real shapes that used to open every visit body:
       - a provisional 'on' read off the boot placeholder namespace,
       - a read from an older bundle that carries no `settled` at all,
       - an incoherent pair (the "checkbox says ON while the pull runs OFF"
         the owner saw live at b1016/b1022).
     Storage is poisoned ON throughout, so a site that fell back to the raw
     keys would answer true and fail here by name. */
  function runChoice(choice) {
    const ctx = vm.createContext({
      window: { __mlsVisitNotesPref: { read: () => choice, write: () => true, isPrefKey: () => false } },
      localStorage: poisonedStorage(false), /* raw pullVisitBodies/visitNotesModeV2 both say ON */
      document: { getElementById: () => null },
      api: {}
    });
    vm.runInContext(block + '\nthis.__e = enabled;', ctx);
    return ctx.__e();
  }
  assert.strictEqual(runChoice({ state: 'on', on: true, settled: true }), true,
    'site 4 (vp.enabled): a coherent SETTLED on is the one shape that admits');
  assert.strictEqual(runChoice({ state: 'on', on: true, settled: false }), false,
    'site 4 (vp.enabled): a PROVISIONAL on (settled:false) must NOT open the unscoped every-visit leg');
  assert.strictEqual(runChoice({ state: 'on', on: true }), false,
    'site 4 (vp.enabled): a read with no settled flag at all is not an admission');
  assert.strictEqual(runChoice({ state: 'off', on: true, settled: true }), false,
    'site 4 (vp.enabled): incoherent pair (state off / on true) must refuse');
  assert.strictEqual(runChoice({ state: 'on', on: false, settled: true }), false,
    'site 4 (vp.enabled): incoherent pair (state on / on false) must refuse');
  assert.strictEqual(runChoice({ state: 'unset', on: false, settled: true }), false,
    'site 4 (vp.enabled): explicit-first-use unset resolves OFF');
  assert.strictEqual(runChoice(null), false,
    'site 4 (vp.enabled): no answer from the resolver is OFF, never a raw-key fallback');
}

/* ---- sites 5+6 (relay payload + dedupe identity) are executed in
        qol-setting-reaches-the-pull with the REAL resolver; assert here only
        that both consult it, so this file names every site ---- */
assert(/_vr = \(window\.__mlsVisitNotesPref/.test(mc), 'site 5 (relay payload) consults the resolver');
assert(/vr3 = \(window\.__mlsVisitNotesPref/.test(mc), 'site 6 (dedupe identity) consults the resolver');

console.log('qol-resolver-four-sites: OK (4 sites executed and flipped by the resolver against poisoned storage; OFF opens no note body; enabled() admits only a coherent SETTLED on (dayfacts-1.0.1); payload+dedupe consult pinned)');
