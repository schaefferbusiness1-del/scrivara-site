'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const importer = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const start = html.indexOf('var __mlsLZ=');
const end = html.indexOf('/* Remove every patient MLS imported from Athena', start);
assert(start >= 0 && end > start, 'patient-store runtime block not found');

let account = 'alpha@example.test';
const store = new Map();
const timers = new Map();
const listeners = new Map();
let timerSeq = 0;
let serverMirrors = 0;
const localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
  get length() { return store.size; },
  key(index) { return Array.from(store.keys())[index] || null; }
};
const context = {
  console, localStorage, Date, JSON, Object, Array, String, Number, Math, Map, Set,
  uns: suffix => `sf_u::${account}::${suffix}`,
  backendMode: () => true,
  bkToken: () => 'synthetic-token',
  syncPatientToServer: () => { serverMirrors++; },
  toast: () => {},
  setTimeout(fn) { const id = ++timerSeq; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  Event: class { constructor(type) { this.type = type; } }
};
context.window = context;
context.addEventListener = (type, fn) => {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
};
context.dispatchEvent = event => {
  for (const fn of listeners.get(event.type) || []) fn(event);
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context, { filename: 'ScribeFlow.patient-store.js' });

const api = context.window.__mlsPatientStoreBatch;
assert(api && api.version === 'pts-batch-1.2.0', 'account-scoped patient batch API did not install');
assert(importer.includes('withPatientBatch("schedule-pull"'), 'managed schedule pull is not bracketed by the patient persistence batch');
assert(importer.includes('checkpointPatientBatch(opts.__patientStoreBatch, "schedule-import", true)'), 'schedule identities are not force-flushed before history navigation');
assert(importer.includes('withPatientBatch("history-retry"'), 'manual failed-history retry bypasses batched persistence');

// Keep the test deterministic and fast while counting the exact expensive
// codec/write choke point. The production codec itself has separate roundtrip
// coverage; this test proves a burst no longer invokes it once per patient.
let encodeCalls = 0;
context._mlsPtsEncode = json => { encodeCalls++; return json; };
let wrappedSaves = 0;
const baseSave = context.savePatients;
context.savePatients = function wrappedSavePatients() {
  wrappedSaves++;
  return baseSave.apply(context, arguments);
};

function keyFor(name) { return `sf_u::${name}::patients`; }
function read(name) { return JSON.parse(store.get(keyFor(name)) || '[]'); }

store.set(keyFor(account), JSON.stringify([{ id: 'seed-a', name: 'Synthetic seed' }]));
const token = api.begin({ maxChanges: 4, maxDelayMs: 15000 });
for (let i = 0; i < 10; i++) context.upsertPatient({ id: `a-${i}`, name: `Synthetic ${i}` });
assert.strictEqual(context.getPatients().length, 11, 'batched writes were not immediately visible in the owning tab');
assert.strictEqual(wrappedSaves, 2, 'ten-row burst did not coalesce at the four-change durability bound');
assert.strictEqual(encodeCalls, 2, 'full patient blob was encoded once per row instead of once per bounded batch');
assert.strictEqual(serverMirrors, 10, 'per-patient server durability mirror was bypassed by local batching');
const receipt = api.end(token, 'receipt');
assert.strictEqual(wrappedSaves, 3, 'terminal receipt did not flush the final two patient changes');
assert.strictEqual(encodeCalls, 3, 'terminal flush did not use the normal codec path exactly once');
assert.deepStrictEqual({ changes: receipt.changes, flushes: receipt.flushes }, { changes: 10, flushes: 3 });
assert.strictEqual(read(account).length, 11, 'terminal batch receipt returned before all patients were durable');

// A sparse batch is still crash-bounded by the max-delay timer.
const sparse = api.begin({ maxChanges: 4, maxDelayMs: 1000 });
context.upsertPatient({ id: 'sparse-a', name: 'Synthetic sparse' });
const pendingTimer = Array.from(timers.entries()).pop();
assert(pendingTimer, 'dirty sparse batch did not arm its durability timer');
timers.delete(pendingTimer[0]);
pendingTimer[1]();
assert(read(account).some(p => p.id === 'sparse-a'), 'max-delay checkpoint did not persist a sparse batch');
const savesAfterTimer = wrappedSaves;
api.end(sparse, 'receipt');
assert.strictEqual(wrappedSaves, savesAfterTimer, 'clean terminal receipt rewrote an unchanged full patient blob');

// The explicit schedule-import phase checkpoint is durable before histories.
const phase = api.begin({ maxChanges: 4, maxDelayMs: 15000 });
context.upsertPatient({ id: 'phase-a', name: 'Synthetic phase' });
api.checkpoint(phase, 'schedule-import', true);
assert(read(account).some(p => p.id === 'phase-a'), 'forced schedule-import checkpoint was not durable');
api.end(phase, 'receipt');

// Account switch: flush the captured old key, fence stale async writers, and
// never expose an Alpha patient in Beta's namespace.
store.set(keyFor('beta@example.test'), JSON.stringify([{ id: 'seed-b', name: 'Synthetic beta seed' }]));
const oldAccount = api.begin({ maxChanges: 4, maxDelayMs: 15000 });
context.upsertPatient({ id: 'alpha-before-switch', name: 'Synthetic alpha' });
account = 'beta@example.test';
context.dispatchEvent(new context.CustomEvent('mls:session-boundary', {
  detail: { previousAccount: 'alpha@example.test', nextAccount: 'beta@example.test' }
}));
assert(read('alpha@example.test').some(p => p.id === 'alpha-before-switch'), 'session boundary did not flush the captured old-account key');
assert(!read('beta@example.test').some(p => p.id === 'alpha-before-switch'), 'old-account patient leaked into the new account key');
assert.throws(() => context.upsertPatient({ id: 'stale-old-pull', name: 'Synthetic stale' }), err => err && err.code === 'MLS_PATIENT_BATCH_ACCOUNT_CHANGED');
const switchedReceipt = api.end(oldAccount, 'session-boundary');
assert.strictEqual(switchedReceipt.accountChanged, true, 'account invalidation was not recorded in the PHI-free batch receipt');
assert.strictEqual(switchedReceipt.boundaryDirectWrites, 1, 'old-account boundary flush ran wrappers that read the new account namespace');
const beta = api.begin({ maxChanges: 4, maxDelayMs: 15000 });
context.upsertPatient({ id: 'beta-safe', name: 'Synthetic beta' });
api.end(beta, 'receipt');
assert(read('beta@example.test').some(p => p.id === 'beta-safe'), 'new account could not persist after the old batch closed');
assert(!read('alpha@example.test').some(p => p.id === 'beta-safe'), 'new-account patient was written to the old account key');

console.log('PASS patient-store batching: bounded writes/timer/phase/end durability, wrapper+server preservation, and account-switch fencing');
