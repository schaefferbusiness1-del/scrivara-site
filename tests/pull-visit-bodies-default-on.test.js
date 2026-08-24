'use strict';

/* 2026-07-28 / 2026-08-24 — VISIT BODIES CHOICE, by execution not by source-grep.
 *
 * Live store measurement: 47 of 51 snapshot patients carried ONLY index-only
 * visit stubs — encounter bodies were never read — because both visit-body
 * preferences sat at their code-authored OFF defaults while the toggle that
 * could change them never rendered (the b760 finding). A pull without
 * encounter bodies is not "complete available history" (owner bar 2026-07-28:
 * first-pull completeness, no silent omissions).
 *
 * Law now: Settings may paint the completeness-first ON default while the
 * account is unset, but no reader may open encounter bodies until public
 * admission records an explicit human choice. Every low-level reader fails
 * closed while unset; an operation-scoped explicit boolean remains frozen.
 * qol-2.0: every reader now delegates to the ONE resolver
 * (window.__mlsVisitNotesPref, mls-connect.js) — so the law is proven by
 * executing each shipped call site WITH the real shipped resolver:
 *   1. feat_mls_schedimport_exact.js  pullVisitBodies (batch reader)
 *   2. mls-connect.js                 __mlsVisitSavePref.enabled()
 *   3. ScribeFlow.html                pullVisitBodiesPref() (Settings truth)
 * An explicit stored choice (the pullVisitBodiesSet marker / the legacy vp
 * key, which only a human click ever wrote) is still respected — the
 * resolver adopts both legacy shapes. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeResolver } = require('./lib-visit-notes-resolver.js');

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
const UNS = k => 'acct::' + k;

/* ---- 1. the schedimport batch reader, executed through the REAL resolver ---- */
{
  const src = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
  const block = extract(src, 'var pullVisitBodies = safe(function () {', '}, false);', 'schedimport reader');
  assert(/__mlsVisitNotesPref/.test(block), 'the batch reader consults the ONE resolver (qol-2.0)');
  function evalReader(storageMap, override) {
    const storage = makeStorage(storageMap);
    const win = { uns: UNS, __mlsVisitNotesPref: makeResolver(UNS, storage) };
    const ctx = vm.createContext({
      safe: (fn, fb) => { try { return fn(); } catch (e) { return fb; } },
      _pullBodiesOverride: override,
      window: win,
      localStorage: storage
    });
    vm.runInContext(block + '\nthis.__pv = pullVisitBodies;', ctx, { filename: 'schedimport:pullVisitBodies' });
    return ctx.__pv;
  }
  assert.strictEqual(evalReader({}), false, 'schedimport: unset account must fail closed before public admission');
  assert.strictEqual(evalReader({ 'acct::pullVisitBodies': '0' }), false,
    'schedimport: legacy code-authored 0 without a settled choice must fail closed');
  assert.strictEqual(evalReader({ 'acct::pullVisitBodies': '0', 'acct::pullVisitBodiesSet': '1' }), false,
    'schedimport: an explicit human OFF is respected');
  assert.strictEqual(evalReader({ 'acct::pullVisitBodies': '1', 'acct::pullVisitBodiesSet': '1' }), true,
    'schedimport: an explicit human ON is respected');
  assert.strictEqual(evalReader({ 'acct::visitNotesModeV2': 'off' }), false,
    'schedimport: the canonical one-key OFF is respected');
  assert.strictEqual(evalReader({}, true), true, 'schedimport: an explicit frozen ON override outranks unset local state');
  assert.strictEqual(evalReader({}, false), false, 'schedimport: an explicit per-pull override still outranks everything');
  assert.strictEqual(evalReader({ 'acct::pullVisitBodies': '1', 'acct::pullVisitBodiesSet': '1' }, false), false,
    'schedimport: phone-relay override wins over stored ON');
}

/* ---- 2. __mlsVisitSavePref.enabled(), executed through the REAL resolver ---- */
{
  const src = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  const iife = extract(src, 'function enabled() { /* qol-2.0', 'api.enabled = enabled;', 'vp enabled');
  function evalEnabled(storageMap) {
    const storage = makeStorage(storageMap);
    const win = { __mlsVisitNotesPref: makeResolver(UNS, storage) };
    const ctx = vm.createContext({
      localStorage: storage,
      window: win,
      document: { getElementById: () => null },
      api: {}
    });
    vm.runInContext(iife + '\nthis.__enabled = enabled;', ctx, { filename: 'mls-connect:vpEnabled' });
    return ctx.__enabled();
  }
  assert.strictEqual(evalEnabled({}), false, 'vp: absent key -> reader remains closed until admission records a choice');
  assert.strictEqual(evalEnabled({ 'mls_save_every_athena_visit': '0' }), false,
    'vp: a stored 0 is only ever human-written -> OFF respected (resolver adopts the legacy global)');
  assert.strictEqual(evalEnabled({ 'mls_save_every_athena_visit': '1' }), true, 'vp: stored 1 -> ON');
}

/* ---- 3. the ScribeFlow Settings truth, executed through the REAL resolver ---- */
{
  const src = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
  const fnRaw = extract(src, 'function pullVisitBodiesPref(){', '\nfunction renderPullVisitBodiesSetting', 'settings pref');
  const fn = fnRaw.slice(0, fnRaw.lastIndexOf('\nfunction renderPullVisitBodiesSetting'));
  function evalPref(storageMap) {
    const storage = makeStorage(storageMap);
    const ctx = vm.createContext({
      window: { __mlsVisitNotesPref: makeResolver(UNS, storage) }
    });
    vm.runInContext(fn + '\nthis.__pref = pullVisitBodiesPref;', ctx, { filename: 'ScribeFlow:pullVisitBodiesPref' });
    return ctx.__pref();
  }
  assert.strictEqual(evalPref({}), true, 'settings: no keys -> checked (ON)');
  assert.strictEqual(evalPref({ 'acct::pullVisitBodies': '0' }), true, 'settings: legacy 0 ignored -> ON');
  assert.strictEqual(evalPref({ 'acct::pullVisitBodies': '0', 'acct::pullVisitBodiesSet': '1' }), false,
    'settings: explicit human OFF respected');

  /* the two writers go THROUGH the resolver, and the resolver records the
     human-choice marker — executed on the real shipped resolver */
  /* There are other checkbox listeners earlier in the shell. Isolate the
     named Settings owner before checking its writer, rather than accidentally
     extracting the shared-computer toggle. */
  const settingsOwnerAt = src.indexOf('function renderPullVisitBodiesSetting(){');
  const settingsOwnerEnd = src.indexOf('/* =========================================================', settingsOwnerAt);
  assert(settingsOwnerAt >= 0 && settingsOwnerEnd > settingsOwnerAt,
    'Settings visit-note owner could not be isolated');
  const settingsWriter = src.slice(settingsOwnerAt, settingsOwnerEnd);
  assert(settingsWriter.includes("cb.addEventListener('change',function(){") &&
    settingsWriter.includes('r.write(cb.checked===true)'),
    'Settings checkbox writes THROUGH the resolver');
  const connectSrc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  const stripWriter = extract(connectSrc, 'tgl.onchange = function () {', '};', 'day-strip writer');
  assert(stripWriter.includes('r.write(tgl.checked === true)'), 'day-strip toggle writes THROUGH the resolver');

  const map = {};
  const res = makeResolver(UNS, makeStorage(map));
  assert.strictEqual(res.write(false), true, 'resolver write(false) is read-back confirmed');
  assert.strictEqual(map['acct::visitNotesModeV2'], 'off', 'canonical key written');
  assert.strictEqual(map['acct::pullVisitBodiesSet'], '1', 'a human change records the human-choice marker (legacy pair kept coherent)');
  assert.strictEqual(map['acct::pullVisitBodies'], '0', 'legacy pair carries the value for older served bundles');
}

console.log('pull-visit-bodies-default-on: PASS');
