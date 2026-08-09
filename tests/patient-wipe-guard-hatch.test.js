'use strict';

/* Wipe-guard v1.1.0: the guard's self-heal re-wraps savePatients whenever a
 * later module lands an unmarked wrapper on top, which STACKS multiple guard
 * layers in one chain. All layers share the singleton G, so the v1.0.0 boolean
 * hatch was consumed by the outermost layer and the stale inner layer still
 * blocked — window.__mlsWipeGuard.allowOnce() could never authorize a wipe in
 * a booted session (live-reproduced 2026-07-20: 20 stored, allowOnce, save([])
 * -> blocked:2, storage untouched). v1.1.0 holds _allowDepth open across the
 * authorized save so every inner layer of that ONE save passes, and the very
 * next save([]) is blocked again.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const start = connect.indexOf('* MLS Scribe — patient-list WIPE GUARD');
assert(start > 0, 'wipe-guard module header missing');
const open = connect.indexOf('(function () {', start);
const endMarker = 'window.__mlsWipeGuard = G;\n})();';
const end = connect.indexOf(endMarker, open);
assert(open > start && end > open, 'wipe-guard module boundaries missing');
const source = connect.slice(open, end + endMarker.length);
assert(source.includes("version: '1.2.0'"), 'wipe guard must be v1.2.0');
assert(source.includes('_allowDepth'), 'wipe guard must carry the stacked-layer allow depth');
assert(source.includes('chainHasWipeGuard'), 'wipe guard must detect an existing owner below another wrapper');

function makeEnv() {
  const stored = new Map();
  const localStorage = {
    getItem: k => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => stored.set(k, String(v)),
    removeItem: k => stored.delete(k)
  };
  let baseWrites = 0;
  const window = {
    uns: n => 'acct:' + n,
    localStorage,
    toast: () => {},
    getPatients: function () {
      try { return JSON.parse(localStorage.getItem(window.uns('patients'))) || []; } catch (e) { return []; }
    },
    savePatients: function basePatientsSave(arr) {
      baseWrites++;
      localStorage.setItem(window.uns('patients'), JSON.stringify(arr));
    }
  };
  window.window = window;
  const timers = [];
  const context = vm.createContext({
    window, localStorage,
    console: { error: () => {}, warn: () => {}, log: () => {} },
    setInterval: fn => { timers.push(fn); return timers.length; },
    clearInterval: () => {},
    Date
  });
  return { window, localStorage, context, timers, baseWrites: () => baseWrites };
}

// Seed 10 patients, install the guard, then simulate a later module re-wrapping
// savePatients WITHOUT forwarding the guard marker, and the heal re-installing
// on top — the exact production stacking.
const env = makeEnv();
const roster = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
env.window.savePatients(roster);
vm.runInContext(source, env.context, { filename: 'wipe-guard.js' });
assert(env.window.savePatients.__mlsWipeGuarded, 'guard did not install');

const guardedOnce = env.window.savePatients;
const laterWrapper = function (arr) { return guardedOnce.apply(this, arguments); }; // shared origin link, distinct owner marker
laterWrapper.__mlsOrig = guardedOnce;
env.window.savePatients = laterWrapper;
assert(env.timers.length === 1, 'guard heal interval missing');
env.timers[0]();
assert.strictEqual(env.window.savePatients, laterWrapper, 'heal duplicated a guard already present in the wrapper chain');

const G = env.window.__mlsWipeGuard;
const writesBefore = env.baseWrites();

// 1. Unauthorized wipe: blocked, storage untouched, no base write.
env.window.savePatients([]);
assert.strictEqual(G.blocked, 1, 'unauthorized wipe was not blocked');
assert.strictEqual(env.baseWrites(), writesBefore, 'blocked wipe still reached the base writer');
assert.strictEqual(JSON.parse(env.localStorage.getItem('acct:patients')).length, 10, 'blocked wipe emptied storage');

// 2. allowOnce authorizes ONE wipe through BOTH stacked layers.
G.allowOnce();
env.window.savePatients([]);
assert.strictEqual(G.blocked, 1, 'authorized wipe was blocked by a stale inner guard layer');
assert.strictEqual(env.baseWrites(), writesBefore + 1, 'authorized wipe did not reach the base writer exactly once');
assert.strictEqual(JSON.parse(env.localStorage.getItem('acct:patients')).length, 0, 'authorized wipe did not persist');
assert.strictEqual(G._allowDepth, 0, 'allow depth leaked after the authorized save');

// 3. The hatch is one-time: refill, next wipe blocks again.
env.window.savePatients(roster);
env.window.savePatients([]);
assert.strictEqual(G.blocked, 2, 'hatch was not consumed — a second wipe went unblocked');
assert.strictEqual(JSON.parse(env.localStorage.getItem('acct:patients')).length, 10, 'second wipe emptied storage');

console.log('PASS wipe-guard hatch: chain ownership prevents duplicate guards, allowOnce() authorizes exactly one wipe, and the hatch re-arms closed');
