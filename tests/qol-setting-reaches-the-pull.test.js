/* qol-1.1 control: THE VIEW MUST NOT OUTRANK THE RECORD.
   2026-08-10: the owner unchecked visit notes and the pull ignored him. Three
   stacked causes, each pinned here:
   (a) the relay job payload snapshotted the #mlsDsVisitBodies DOM node — a
       checkbox the calm shell HIDES and that can paint stale — and that value
       outranked the runner's stored preference via the N4 override;
   (b) a SECOND Settings row ("Save every individual Athena visit") duplicated
       the setting under different words, wrote a DEAD un-namespaced key the
       day-pull never read, and its "off by default" copy was false;
   (c) nothing re-synced the strip checkbox when the preference changed in
       another tab.
   Non-vacuity is executed: the OLD payload capture (verbatim from b1005) runs
   as BEFORE and takes the stale DOM value; the CURRENT code takes the stored
   tri-state. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const mc = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

/* ---- fixtures ------------------------------------------------------------ */
const { makeResolver } = require('./lib-visit-notes-resolver.js');
function fakeEnv(stored, checkedDom) {
  const store = Object.assign({}, stored);
  const env = {
    window: { uns: s => 'sf_u::doc@x::' + s },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      _dump: () => store,
    },
    document: { getElementById: id => (id === 'mlsDsVisitBodies' ? { checked: checkedDom } : null) },
  };
  /* qol-2.0: sites resolve through the ONE resolver — install the REAL one */
  env.window.__mlsVisitNotesPref = makeResolver(env.window.uns, env.localStorage);
  return env;
}

/* ---- (a) payload resolution: extract the CURRENT capture block ----------- */
const capStart = mc.indexOf('/* qol-1.1a: THE VIEW OUTRANKED THE RECORD');
assert.ok(capStart > 0, 'qol-1.1a payload block missing');
const capTry = mc.lastIndexOf('try {', capStart);
const capEnd = mc.indexOf('} catch (e) {}', capStart);
assert.ok(capTry > 0 && capEnd > capStart, 'payload block bounds');
const capSrc = mc.slice(capTry, capEnd + '} catch (e) {}'.length);

function runCapture(src, env) {
  const jobPayload = {};
  new Function('window', 'localStorage', 'document', 'jobPayload', src)(env.window, env.localStorage, env.document, jobPayload);
  return jobPayload.pullVisitBodies;
}

/* owner's exact state: stored OFF with the explicit marker, stale DOM says ON */
const ownerEnv = fakeEnv({ 'sf_u::doc@x::pullVisitBodies': '0', 'sf_u::doc@x::pullVisitBodiesSet': '1' }, true);
assert.strictEqual(runCapture(capSrc, ownerEnv), false,
  'CURRENT payload must carry the STORED choice (off), not the stale checked DOM');

/* unchosen account: falls back to the DOM view (previous behaviour preserved) */
assert.strictEqual(runCapture(capSrc, fakeEnv({}, true)), true, 'unchosen account still defers to the visible control');

/* BEFORE (b1005 verbatim): the DOM outranks the record — must reproduce the bug */
const OLD_CAP = "try {\n        var _bt = document.getElementById('mlsDsVisitBodies');\n        if (_bt && typeof _bt.checked === 'boolean') jobPayload.pullVisitBodies = !!_bt.checked;\n      } catch (e) {}";
assert.strictEqual(runCapture(OLD_CAP, fakeEnv({ 'sf_u::doc@x::pullVisitBodies': '0', 'sf_u::doc@x::pullVisitBodiesSet': '1' }, true)), true,
  'non-vacuity: the OLD capture must take the stale DOM value over the stored choice');

/* the dedupe key resolves the same way (a lying key coalesces ON onto OFF jobs) */
assert.ok(/\|b' \+ \(function \(\) \{\s*try \{\s*var vr3 =/.test(mc.replace(/\r\n/g, '\n')), 'dedupe key resolves the stored tri-state through the resolver');

/* ---- (b) ONE control: the duplicate row is gone, the key is unified ------ */
assert.ok(mc.indexOf("id=\"mlsSaveEveryVisitTgl\"") < 0, 'the duplicate Settings checkbox is no longer created');
assert.ok(mc.indexOf("$('mlsSaveEveryVisitRow')") > 0 && mc.indexOf('removeChild(old)') > 0,
  'long-lived tabs actively remove the stale duplicate row');

/* extract the unified enabled()/setEnabled() (qol-2.0: they delegate to the
   resolver; the migration lives IN the resolver and is executed here) */
const enStart = mc.indexOf('function enabled() { /* qol-2.0');
const enEnd = mc.indexOf('function toast(m, k)', enStart);
assert.ok(enStart > 0 && enEnd > enStart, 'unified enabled/setEnabled missing');
const enSrc = mc.slice(enStart, enEnd);
function makePref(env) {
  const fns = {};
  new Function('window', 'localStorage', 'out', enSrc + '\nout.enabled = enabled; out.setEnabled = setEnabled;')(env.window, env.localStorage, fns);
  return fns;
}
/* tri-state wins over legacy */
let env = fakeEnv({ 'sf_u::doc@x::pullVisitBodies': '0', 'sf_u::doc@x::pullVisitBodiesSet': '1', 'mls_save_every_athena_visit': '1' }, true);
assert.strictEqual(makePref(env).enabled(), false, 'explicit tri-state OFF governs the every-visit leg');
/* legacy migrates per-account, then retires (now inside the resolver) */
env = fakeEnv({ 'mls_save_every_athena_visit': '0' }, true);
assert.strictEqual(makePref(env).enabled(), false, 'legacy 0 honored');
assert.strictEqual(env.localStorage.getItem('sf_u::doc@x::pullVisitBodies'), '0', 'legacy value adopted into the account namespace');
assert.strictEqual(env.localStorage.getItem('sf_u::doc@x::pullVisitBodiesSet'), '1', 'adoption is an explicit choice');
assert.strictEqual(env.localStorage.getItem('mls_save_every_athena_visit'), null, 'the un-namespaced key is retired');
/* setEnabled writes through the resolver, read-back confirmed */
env = fakeEnv({}, true);
assert.strictEqual(makePref(env).setEnabled(false), true, 'setEnabled returns the read-back confirmation');
assert.strictEqual(env.localStorage.getItem('sf_u::doc@x::visitNotesModeV2'), 'off', 'setEnabled writes the canonical key');
assert.strictEqual(env.localStorage.getItem('sf_u::doc@x::pullVisitBodies'), '0', 'setEnabled keeps the legacy pair coherent');
assert.strictEqual(env.localStorage.getItem('sf_u::doc@x::pullVisitBodiesSet'), '1', 'setEnabled records the choice');

/* ---- (c) the strip checkbox re-syncs on cross-tab preference change ------ */
assert.ok(/addEventListener\('storage', function \(ev\)/.test(mc) && /r\.isPrefKey\(ev\.key\)/.test(mc) && mc.indexOf('the strip checkbox is a VIEW') > 0,
  'the strip checkbox repaints from the resolved preference on cross-tab change');

console.log('qol-setting-reaches-the-pull: OK (stored choice outranks the view; old capture reproduces the bug; one control, per-account migration, cross-tab repaint)');
