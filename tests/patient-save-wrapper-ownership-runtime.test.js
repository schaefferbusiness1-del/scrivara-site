'use strict';

/*
 * The patient save chokepoint has four independently re-arming owners:
 * SaveShield, the wipe guard, VisitFix, and b121 (whose cleaner and DOB join
 * are two intentional wrappers). A foreign wrapper at the head used to hide
 * the owners below it. Their 500ms/3s/4s heartbeats then built a new layer on
 * every tick, so one startup hydration traversed the full roster many times.
 *
 * Execute the current shipped modules in every load order, advance every rearm
 * through 30.5 seconds, fire b121's storage/visibility re-arm hooks, and prove
 * that each intentional wrapper exists exactly once and one save reaches the
 * base once.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
function readSource(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'); }
const shieldSource = readSource('feat_mls_saveshield.js');
const visitFixSource = readSource('feat_mls_visitfix.js');
const b121Source = readSource('feat_mls_b121_pack.js');
const connectSource = readSource('mls-connect.js');

function boundedSlice(source, startNeedle, endNeedle, label) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(start >= 0 && end > start, label + ' source boundaries were not found');
  return source.slice(start, end + endNeedle.length);
}

const wipeHeader = connectSource.indexOf('window.__mlsWipeGuard.allowOnce()');
const wipeStart = connectSource.indexOf('(function () {', wipeHeader);
const wipeEndMarker = 'window.__mlsWipeGuard = G;\n})();';
const wipeEnd = connectSource.indexOf(wipeEndMarker, wipeStart);
assert(wipeHeader >= 0 && wipeStart > wipeHeader && wipeEnd > wipeStart, 'wipe-guard source boundaries were not found');
const wipeSource = connectSource.slice(wipeStart, wipeEnd + wipeEndMarker.length);

const cleanSource = boundedSlice(
  b121Source,
  '(function () {\n  \'use strict\';\n  try { if (window.__mlsCleanSections',
  'tick(); /* wrappers now; roster scan only after session-ready/quiet admission */\n})();',
  'b121 clean-sections wrapper'
);
const dobSource = boundedSlice(
  b121Source,
  ';(function () {\n  \'use strict\';\n  if (window.__mlsDobEverywhere) return;',
  "return 'reverted (already-backfilled rows keep their dob; server writes are not undone)';\n  }\n})();",
  'b121 DOB wrapper'
);

for (const [label, source, marker] of [
  ['SaveShield', shieldSource, 'w.__mlsOrig = orig'],
  ['wipe guard', wipeSource, 'guarded.__mlsOrig = orig'],
  ['VisitFix', visitFixSource, 'w.__vfxOrig = orig; w.__mlsOrig = orig'],
  ['b121 cleaner', cleanSource, 'w.__mlsCleanSecSaveOrig = f; w.__mlsOrig = f'],
  ['b121 DOB', dobSource, 'w.__mlsDobOrig=f;w.__mlsOrig=f']
]) assert(source.includes(marker), label + ' no longer publishes an interoperable origin link');

class Scheduler {
  constructor() { this.now = 0; this.nextId = 0; this.tasks = new Map(); }
  timeout(fn, ms) { return this.add(fn, ms, 0); }
  interval(fn, ms) { return this.add(fn, ms, Math.max(1, Number(ms) || 1)); }
  add(fn, ms, interval) {
    const id = ++this.nextId;
    this.tasks.set(id, { id, fn, at: this.now + Math.max(0, Number(ms) || 0), interval });
    return id;
  }
  clear(id) { this.tasks.delete(id); }
  runUntil(limit) {
    for (;;) {
      let next = null;
      for (const task of this.tasks.values()) {
        if (task.at > limit) continue;
        if (!next || task.at < next.at || (task.at === next.at && task.id < next.id)) next = task;
      }
      if (!next) break;
      this.now = next.at;
      if (next.interval) next.at += next.interval;
      else this.tasks.delete(next.id);
      next.fn();
    }
    this.now = limit;
  }
}

function makeWorld() {
  const scheduler = new Scheduler();
  const data = new Map([['acct::patients', JSON.stringify([{ id: 'p-1', name: 'Patient One', updated: 1000, visits: [] }])]]);
  const listeners = new Map();
  let baseCalls = 0;

  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [scheduler.now])); }
    static now() { return scheduler.now; }
  }

  const localStorage = {
    getItem(key) { key = String(key); return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(String(key), String(value)); },
    removeItem(key) { data.delete(String(key)); },
    key(index) { return Array.from(data.keys())[index] || null; },
    get length() { return data.size; }
  };
  const document = {
    readyState: 'loading', hidden: false, body: {}, head: {}, documentElement: {},
    addEventListener(type, fn) { if (!listeners.has('d:' + type)) listeners.set('d:' + type, []); listeners.get('d:' + type).push(fn); },
    removeEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {}, remove() {} }; }
  };
  const world = {
    console: { log() {}, warn() {}, error() {} },
    Date: FakeDate, JSON, Object, Array, String, Number, Math, Map, Set, Promise, isFinite,
    localStorage, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document, navigator: { scheduling: { isInputPending() { return false; } } },
    setTimeout: (fn, ms) => scheduler.timeout(fn, ms), clearTimeout: id => scheduler.clear(id),
    setInterval: (fn, ms) => scheduler.interval(fn, ms), clearInterval: id => scheduler.clear(id),
    addEventListener(type, fn) { if (!listeners.has('w:' + type)) listeners.set('w:' + type, []); listeners.get('w:' + type).push(fn); },
    removeEventListener() {},
    uns(suffix) { return 'acct::' + suffix; }, bkToken() { return 'token'; }, bkBase() { return 'https://invalid.test'; },
    getSessionEmail() { return 'owner@example.test'; }, toast() {}, syncPatientToServer() {},
    fetch() { return Promise.resolve({ ok: true }); }, _calAppts: [], loadCalendar() { return true; },
    getPatients() { try { return JSON.parse(localStorage.getItem('acct::patients')) || []; } catch (e) { return []; } },
    upsertPatient(patient) { return { ok: true, patient }; },
    savePatients: null,
    __mlsPtsBatchByKey: Object.create(null),
    __mlsVisitModel: { addVisit() { return null; }, deriveFromLegacy() { return []; } },
    __mlsSessionReady: new Promise(() => {})
  };
  const base = function basePatientSave(rows) {
    baseCalls++;
    localStorage.setItem('acct::patients', JSON.stringify(rows));
    return { ok: true };
  };
  base.__patientSaveBase = true;
  world.savePatients = base;
  world.window = world;
  world.__mlsMaintenancePersist = {
    capture() { return { key: 'acct::patients', account: 'owner@example.test', token: 'token', raw: localStorage.getItem('acct::patients') }; },
    scan(options) {
      const rows = world.getPatients();
      if (options && typeof options.onEmpty === 'function') options.onEmpty({ saved: false, empty: true }, rows);
      return Promise.resolve({ saved: false, empty: true, rows });
    }
  };

  return {
    scheduler, world, base, baseCalls: () => baseCalls,
    dispatchDocument(type, event) { for (const fn of listeners.get('d:' + type) || []) fn(event || { type }); },
    dispatchWindow(type, event) { for (const fn of listeners.get('w:' + type) || []) fn(event || { type }); },
    context: vm.createContext(world)
  };
}

const MODULES = {
  shield: [shieldSource], wipe: [wipeSource], visitfix: [visitFixSource], b121: [cleanSource, dobSource]
};

function canonicalChain(head, expectedBase, label) {
  const functions = [], seen = new Set();
  let fn = head;
  while (typeof fn === 'function') {
    assert(!seen.has(fn), 'canonical __mlsOrig cycle in order ' + label);
    seen.add(fn); functions.push(fn);
    if (fn === expectedBase) break;
    assert.strictEqual(typeof fn.__mlsOrig, 'function', 'wrapper hid its canonical origin in order ' + label);
    fn = fn.__mlsOrig;
  }
  assert.strictEqual(functions[functions.length - 1], expectedBase, 'canonical chain did not reach the captured base in order ' + label);
  return functions;
}

function executeOrder(order) {
  const env = makeWorld();
  for (const owner of order) {
    for (const source of MODULES[owner]) vm.runInContext(source, env.context, { filename: owner + '.wrapper-owner.js' });
  }
  env.scheduler.runUntil(30500);
  for (let i = 0; i < 3; i++) {
    env.dispatchDocument('visibilitychange', { type: 'visibilitychange' });
    env.dispatchWindow('storage', { type: 'storage', key: 'acct::patients' });
  }

  const label = order.join(' -> ');
  const functions = canonicalChain(env.world.savePatients, env.base, label);
  const counts = {
    shield: functions.filter(fn => fn.__mlsSvs && typeof fn.__mlsOrig === 'function').length,
    wipe: functions.filter(fn => fn.__mlsWipeGuarded && typeof fn.__mlsWipeGuardOrig === 'function').length,
    visitfix: functions.filter(fn => fn.__vfxWrapped && typeof fn.__vfxOrig === 'function').length,
    clean: functions.filter(fn => fn.__mlsCleanSecSaveWrap && typeof fn.__mlsCleanSecSaveOrig === 'function').length,
    dob: functions.filter(fn => fn.__mlsDobWrap && typeof fn.__mlsDobOrig === 'function').length,
    base: functions.filter(fn => fn.__patientSaveBase).length
  };
  assert.deepStrictEqual(counts, { shield: 1, wipe: 1, visitfix: 1, clean: 1, dob: 1, base: 1 },
    'wrapper ownership duplicated after rearm in order ' + label + ': ' + JSON.stringify(counts));
  assert.strictEqual(functions.length, 6, 'canonical chain did not contain exactly five wrappers plus the base in order ' + label);

  const before = env.baseCalls();
  const row = { id: 'p-1', name: 'Patient One', updated: 1000, visits: [] };
  env.world.savePatients([row]);
  assert.strictEqual(env.baseCalls(), before + 1,
    'one save did not reach the base exactly once in order ' + label);
  return counts;
}

function permutations(values) {
  if (values.length < 2) return [values.slice()];
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const rest = values.slice(0, i).concat(values.slice(i + 1));
    for (const suffix of permutations(rest)) out.push([values[i]].concat(suffix));
  }
  return out;
}

const orders = permutations(['wipe', 'visitfix', 'b121', 'shield']);
assert.strictEqual(orders.length, 24, 'four wrapper owners must produce 24 load orders');
for (const order of orders) executeOrder(order);

console.log('PASS patient save wrapper ownership: all 24 load orders stay single-owner through 30.5s plus storage/visibility re-arms, and one save delegates once');
