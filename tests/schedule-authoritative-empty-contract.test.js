'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const listeners = new Set();
const posted = [];
const statuses = [];
const store = new Map();
const day = '2026-07-22';

const context = {
  console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
  encodeURIComponent, decodeURIComponent, queueMicrotask, setTimeout, clearTimeout,
  setInterval: () => 1, clearInterval: () => {},
  location: { pathname: '/ScribeFlow-staging.html', origin: 'https://mlsscribe.com' },
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  },
  document: {
    readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
    getElementById: () => null, addEventListener: () => {}, removeEventListener: () => {},
    body: {}, head: { appendChild: () => {} }, documentElement: { appendChild: () => {} }
  },
  backendMode: () => true, bkToken: () => 'test-token', bkBase: () => 'https://local.invalid',
  uns: key => `authoritative-empty-test::${key}`,
  _normDate: value => String(value || '').slice(0, 10),
  _calAppts: [],
  addEventListener: (_type, fn) => listeners.add(fn),
  removeEventListener: (_type, fn) => listeners.delete(fn),
  dispatchEvent: () => {},
  fetch: async () => { throw new Error('contradictory empty receipt reached the calendar backend'); }
};
context.window = context;

function emit(type, resp, id) {
  const event = { data: { source: 'mls-ext', type, id: id || '', resp } };
  Array.from(listeners).forEach(fn => fn(event));
}

context.postMessage = message => {
  posted.push(message);
  if (message.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true }, ''));
  if (message.type === 'mlsAppGotoDate') queueMicrotask(() => emit('mlsAppGotoDateResult', {
    id: message.id, requestId: message.id, ok: true, schedDate: day
  }, message.id));
  if (message.type === 'mlsAppPullSchedule') queueMicrotask(() => emit('mlsAppScheduleResult', {
    id: message.id, requestId: message.id, ok: true, schedDate: day, text: '', appts: [],
    receipt: {
      complete: true, authoritativeEmpty: true,
      expectedCount: 0, candidateCount: 1, parsedCount: 0,
      declaredCount: 0, domValidRows: 0, textValidRows: 0, mergedRows: 0
    },
    providerDiag: { domValidRows: 0, textValidRows: 0, mergedRows: 0 }
  }, message.id));
};

vm.runInNewContext(source, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
const api = context.__mlsSI;
assert(api && typeof api._authoritativeEmptyContract === 'function');

function base() {
  return {
    receipt: {
      complete: true, authoritativeEmpty: true,
      expectedCount: 0, candidateCount: 0, parsedCount: 0,
      declaredCount: 0, unnamedCount: 0, domValidRows: 0, textValidRows: 0, mergedRows: 0
    },
    appts: [],
    diag: { canonicalCount: 0, reconciledCount: 0 },
    providerDiag: { domValidRows: 0, textValidRows: 0, mergedRows: 0 }
  };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

assert.strictEqual(api._authoritativeEmptyContract(base()).ok, true, 'an internally exact empty receipt was rejected');

const contradictions = [
  ['receipt.expectedCount', value => { value.receipt.expectedCount = 1; }],
  ['receipt.candidateCount', value => { value.receipt.candidateCount = 1; }],
  ['receipt.parsedCount', value => { value.receipt.parsedCount = 1; }],
  ['receipt.mergedRows', value => { value.receipt.mergedRows = 1; }],
  ['diag.canonicalCount', value => { value.diag.canonicalCount = 1; }],
  ['diag.reconciledCount', value => { value.diag.reconciledCount = 1; }],
  ['providerDiag.domValidRows', value => { value.providerDiag.domValidRows = 1; }],
  ['returnedAppointments.length', value => { value.appts.push({ name: 'Contradictory Patient' }); }]
];
contradictions.forEach(([field, mutate]) => {
  const value = clone(base());
  mutate(value);
  const receipt = api._authoritativeEmptyContract(value);
  assert.strictEqual(receipt.ok, false, `${field} did not fail the empty-day contract`);
  assert.strictEqual(receipt.reason, 'authoritative-empty-contradiction');
  assert.strictEqual(receipt.field, field);
});
const missingCandidate = base();
delete missingCandidate.receipt.candidateCount;
assert.strictEqual(api._authoritativeEmptyContract(missingCandidate).ok, false, 'missing required candidateCount was treated as zero');
const badCalendarCount = api._authoritativeEmptyContract({
  scheduleReceipt: base().receipt, returnedAppointments: [], resolvedAppointments: [],
  calendarReceipt: { attempted: 1 }
});
assert.strictEqual(badCalendarCount.ok, false, 'nonzero calendar reconciliation count was accepted for an empty day');
assert.strictEqual(badCalendarCount.field, 'calendarReceipt.attempted');
const badResolvedCount = api._authoritativeEmptyContract({
  scheduleReceipt: base().receipt, returnedAppointments: [],
  resolvedAppointments: [{ sourceIdentity: 'impossible', backendAppointmentId: 'impossible' }]
});
assert.strictEqual(badResolvedCount.ok, false, 'resolved appointment mapping was accepted for an empty day');
assert.strictEqual(badResolvedCount.field, 'resolvedAppointments.length');
assert(source.includes('r.receipt.authoritativeEmpty && calendarReceipt.snapshotPublished'), 'empty-day success status is not gated on the published exact snapshot');

const badPublish = api._publishAuthoritativeSnapshot({
  date: '2026-07-23',
  scheduleReceipt: Object.assign({}, base().receipt, { candidateCount: 1 }),
  returnedAppointments: [],
  calendarReceipt: {
    complete: true, attempted: 0, accounted: 0, mapped: 0,
    uniqueSources: 0, uniqueBackend: 0, unresolvedMappings: 0,
    created: 0, repaired: 0, skipped: 0, failed: 0, wrongDay: 0, invalidDate: 0
  },
  resolvedAppointments: []
});
assert.strictEqual(badPublish.published, false, 'contradictory empty receipt published an authoritative snapshot');
assert.strictEqual(badPublish.reason, 'authoritative-empty-contradiction');
assert.strictEqual(api.authoritativeStatusForDay('2026-07-23').available, false, 'contradictory empty snapshot became available to schedule UI');

(async () => {
  const result = await api.pull({
    date: day, includeHistory: false,
    onStatus: (message, kind) => statuses.push({ message: String(message || ''), kind: String(kind || '') })
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.complete, false);
  assert.strictEqual(result.reason, 'authoritative-empty-contradiction');
  assert.strictEqual(result.emptyContract.field, 'receipt.candidateCount');
  assert.strictEqual(result.retry.schedule, true);
  assert.strictEqual(api.authoritativeStatusForDay(day).available, false, 'failed pull published an empty-day snapshot');
  assert.strictEqual(api._lastResp(), null, 'contradictory schedule response became the fallback read source');
  assert.strictEqual(posted.filter(message => message.type === 'mlsAppPullSchedule').length, 1);
  assert.strictEqual(statuses.some(status => status.kind === 'ok'), false, 'contradictory empty pull emitted a success status');
  assert.strictEqual(statuses.some(status => /verified.*no appointments/i.test(status.message)), false, 'contradictory empty pull was labelled as Athena-verified');
  assert(statuses.some(status => status.kind === 'err' && /disagreed with its schedule rows/i.test(status.message)), 'fail-closed empty receipt did not explain the retry');
  console.log('PASS authoritative-empty receipts require exact zero evidence and never publish or label contradictory success');
})().catch(error => { console.error(error); process.exit(1); });
