'use strict';

/* 2026-07-28 — VISIT BODIES DEFAULT ON, by execution not by source-grep.
 *
 * Live store measurement: 47 of 51 snapshot patients carried ONLY index-only
 * visit stubs — encounter bodies were never read — because both visit-body
 * preferences sat at their code-authored OFF defaults while the toggle that
 * could change them never rendered (the b760 finding). A pull without
 * encounter bodies is not "complete available history" (owner bar 2026-07-28:
 * first-pull completeness, no silent omissions).
 *
 * Law: absence of a recorded HUMAN choice means ON, at every reader:
 *   1. feat_mls_schedimport_exact.js  pullVisitBodies (batch reader)
 *   2. mls-connect.js                 __mlsVisitSavePref.enabled()
 *   3. ScribeFlow.html                pullVisitBodiesPref() (Settings truth)
 * An explicit stored choice (the pullVisitBodiesSet marker / a stored value
 * for the vp key, which only a human click ever writes) is respected. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function extract(src, startMarker, endMarker, label) {
  const s = src.indexOf(startMarker);
  assert(s >= 0, label + ': start marker missing: ' + startMarker);
  const e = src.indexOf(endMarker, s + startMarker.length);
  assert(e > s, label + ': end marker missing: ' + endMarker);
  return src.slice(s, e + endMarker.length);
}

function makeStorage(map) {
  return { getItem: k => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
           setItem: (k, v) => { map[k] = String(v); }, removeItem: k => { delete map[k]; } };
}

/* ---- 1. the schedimport batch reader, executed ---- */
{
  const src = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
  const block = extract(src, 'var pullVisitBodies = safe(function () {', '}, true);', 'schedimport reader');
  function evalReader(storageMap, override) {
    const ctx = vm.createContext({
      safe: (fn, fb) => { try { return fn(); } catch (e) { return fb; } },
      _pullBodiesOverride: override,
      window: { uns: k => 'acct::' + k },
      localStorage: makeStorage(storageMap)
    });
    vm.runInContext(block + '\nthis.__pv = pullVisitBodies;', ctx, { filename: 'schedimport:pullVisitBodies' });
    return ctx.__pv;
  }
  assert.strictEqual(evalReader({}), true, 'schedimport: no keys -> bodies ON');
  assert.strictEqual(evalReader({ 'acct::pullVisitBodies': '0' }), true,
    'schedimport: legacy code-authored 0 without the marker is ignored -> ON');
  assert.strictEqual(evalReader({ 'acct::pullVisitBodies': '0', 'acct::pullVisitBodiesSet': '1' }), false,
    'schedimport: an explicit human OFF is respected');
  assert.strictEqual(evalReader({ 'acct::pullVisitBodies': '1', 'acct::pullVisitBodiesSet': '1' }), true,
    'schedimport: an explicit human ON is respected');
  assert.strictEqual(evalReader({}, false), false, 'schedimport: an explicit per-pull override still outranks everything');
  assert.strictEqual(evalReader({ 'acct::pullVisitBodies': '1', 'acct::pullVisitBodiesSet': '1' }, false), false,
    'schedimport: phone-relay override wins over stored ON');
}

/* ---- 2. __mlsVisitSavePref.enabled(), executed ---- */
{
  const src = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  const iife = extract(src, "var KEY = 'mls_save_every_athena_visit';", 'api.enabled = enabled;', 'vp enabled');
  function evalEnabled(storageMap) {
    const ctx = vm.createContext({
      localStorage: makeStorage(storageMap),
      window: {},
      document: { getElementById: () => null },
      api: {}
    });
    vm.runInContext(iife + '\nthis.__enabled = enabled;', ctx, { filename: 'mls-connect:vpEnabled' });
    return ctx.__enabled();
  }
  assert.strictEqual(evalEnabled({}), true, 'vp: absent key -> bodies ON');
  assert.strictEqual(evalEnabled({ 'mls_save_every_athena_visit': '0' }), false,
    'vp: a stored 0 is only ever human-written -> OFF respected');
  assert.strictEqual(evalEnabled({ 'mls_save_every_athena_visit': '1' }), true, 'vp: stored 1 -> ON');
}

/* ---- 3. the ScribeFlow Settings truth, executed ---- */
{
  const src = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
  const fnRaw = extract(src, 'function pullVisitBodiesPref(){', '\nfunction renderPullVisitBodiesSetting', 'settings pref');
  const fn = fnRaw.slice(0, fnRaw.lastIndexOf('\nfunction renderPullVisitBodiesSetting'));
  function evalPref(storageMap) {
    const ctx = vm.createContext({
      uns: k => 'acct::' + k,
      localStorage: makeStorage(storageMap)
    });
    vm.runInContext(fn + '\nthis.__pref = pullVisitBodiesPref;', ctx, { filename: 'ScribeFlow:pullVisitBodiesPref' });
    return ctx.__pref();
  }
  assert.strictEqual(evalPref({}), true, 'settings: no keys -> checked (ON)');
  assert.strictEqual(evalPref({ 'acct::pullVisitBodies': '0' }), true, 'settings: legacy 0 ignored -> ON');
  assert.strictEqual(evalPref({ 'acct::pullVisitBodies': '0', 'acct::pullVisitBodiesSet': '1' }), false,
    'settings: explicit human OFF respected');

  /* the two writers both stamp the human-choice marker */
  const settingsWriter = extract(src, "cb.addEventListener('change',function(){", '});', 'settings writer');
  assert(settingsWriter.includes("pullVisitBodiesSet'),'1'"), 'Settings checkbox must record the human-choice marker');
  const connectSrc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  const stripWriter = extract(connectSrc, "tgl.onchange = function () {", '};', 'day-strip writer');
  assert(stripWriter.includes('setKey'), 'day-strip toggle must record the human-choice marker');
}

console.log('pull-visit-bodies-default-on: PASS');
