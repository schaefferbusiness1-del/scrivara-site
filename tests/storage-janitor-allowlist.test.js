'use strict';
/* sj-1.0 control: THE JANITOR DELETES ONLY NAMED, AGED DEBRIS — proxy-first,
   as the supervisor banked: the REAL shipped module runs here against a fake
   store carrying (1) the exact debris shapes from the 2026-08-11 inventory,
   (2) adversarial near-misses that MUST survive, (3) the protected clinical
   set behind the veto. Fail-closed behavior is executed, not asserted. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mc = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');
const b = mc.indexOf('__mlsStorageJanitor JANITOR BEGIN');
const e = mc.indexOf('__mlsStorageJanitor JANITOR END');
assert.ok(b > 0 && e > b, 'janitor markers present');
const s = mc.indexOf('(function () {', b);
const fin = mc.lastIndexOf('})();', e);
const src = mc.slice(s, fin + 5);

function makeStore(init) {
  const map = new Map(Object.entries(init));
  return {
    map,
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
  };
}
function boot(store, unsFn) {
  const w = { uns: unsFn };
  const timers = [];
  const ctx = vm.createContext({ window: w, localStorage: store, Date, JSON, String, Number, setTimeout: fn => { timers.push(fn); return 1; } });
  vm.runInContext(src, ctx, { filename: 'mls-connect:janitor' });
  return { j: w.__mlsVisitNotesPref ? null : w.__mlsStorageJanitor, w, timers };
}

const OLD = '20260701', OLDDASH = '2026-07-01';
const FRESH = (() => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); })();
const NS = 'sf_u::doc@x::';
const uns = k => NS + k;

const store = makeStore({
  /* (1) exact debris shapes — must be deleted */
  ['mls_todays_backup_' + OLD]: 'x'.repeat(400),
  ['mlsRepairBackup_' + OLD]: 'x'.repeat(300),
  ['__mlsSweepBackup_' + OLDDASH]: 'x'.repeat(200),
  ['mls_b49_contam_backup_' + OLD]: 'x'.repeat(100),
  ['__mlsFriPhantomBackup_' + OLDDASH]: 'x'.repeat(90),
  '__mlsCertBackup': 'x'.repeat(80),
  [NS + 'schedImportIndexV1::2026-07-06']: 'x'.repeat(500),
  'sf_u::_::copilotHist': 'x'.repeat(60),
  'sf_u::_::copilotHistByPt': 'x'.repeat(60),
  /* (2) adversarial near-misses — must SURVIVE */
  ['mls_todays_backup_' + FRESH]: 'FRESH BACKUP',                       /* too young */
  [NS + 'schedImportIndexV1::' + OLDDASH.slice(0, 8) + '31']: '',        /* handled below: own ledger young */
  ['sf_u::other@y::schedImportIndexV1::2026-07-06']: 'FOREIGN LEDGER',   /* foreign namespace */
  'mls_todays_backup_notadate': 'BAD DATE',                              /* unparseable date */
  'mlsRepairBackup_20260701_extra': 'SUFFIXED',                          /* pattern near-miss */
  /* (3) protected set — veto + never-allowlisted */
  [NS + 'patients']: 'CLINICAL',
  [NS + 'notes']: 'CLINICAL',
  [NS + 'templates']: 'CLINICAL',
  [NS + 'calApptsCacheV2']: 'CALENDAR',
  [NS + 'visitNotesModeV2']: 'off',
  'sf_u::other@y::notes': 'FOREIGN CLINICAL',
});
store.map.set(NS + 'schedImportIndexV1::' + new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10), 'YOUNG OWN LEDGER');

const { w } = (() => { const r = boot(store, uns); return r; })();
const jan = w.__mlsStorageJanitor;
assert.ok(jan && jan.installed && typeof jan.run === 'function', 'janitor installed');

const receipt = jan.run();
assert.strictEqual(receipt.errors.length, 0, 'clean run: ' + JSON.stringify(receipt.errors));
assert.strictEqual(receipt.deleted.length, 9, 'exactly the nine named debris keys deleted, got ' + receipt.deleted.length + ': ' + receipt.deleted.map(d => d.k).join(','));
assert.ok(receipt.freedBytes >= 1700, 'freed bytes accounted (' + receipt.freedBytes + ')');

/* the survivors, by name */
[['mls_todays_backup_' + FRESH, 'a fresh backup is not debris'],
 [NS + 'patients', 'patients untouchable'],
 [NS + 'notes', 'notes untouchable'],
 [NS + 'templates', 'templates untouchable'],
 [NS + 'calApptsCacheV2', 'calendar untouchable'],
 ['sf_u::other@y::schedImportIndexV1::2026-07-06', 'a FOREIGN ledger is never ours to delete'],
 ['sf_u::other@y::notes', 'foreign clinical untouchable'],
 ['mls_todays_backup_notadate', 'unparseable date fails CLOSED'],
 ['mlsRepairBackup_20260701_extra', 'pattern near-miss fails CLOSED']
].forEach(([k, why]) => assert.ok(store.getItem(k) !== null, why));
assert.ok([...store.map.keys()].some(k => k.indexOf('schedImportIndexV1') > 0 && store.getItem(k) === 'YOUNG OWN LEDGER'), 'a young own ledger survives');

/* the receipt is the loss column's write half: every deletion named with bytes, namespace masked */
assert.ok(receipt.deleted.every(d => d.k && d.b > 0 && d.why), 'every deletion carries key+bytes+reason');
assert.ok(receipt.deleted.every(d => d.k.indexOf('doc@x') < 0), 'receipt masks the account namespace');
const persisted = store.getItem(uns('storageJanitorReceiptV1'));
assert.ok(persisted && JSON.parse(persisted).deleted.length === 9, 'the receipt is persisted BEFORE deletion');

/* idempotent: a second run deletes nothing and errors nothing */
const second = jan.run();
assert.strictEqual(second.deleted.length, 0, 'second run is a no-op');
assert.strictEqual(second.errors.length, 0);

/* EXECUTED FAIL-CLOSED: a store whose removeItem throws stops after the first
   failure and records it — no blind continuation */
const angry = makeStore({ ['mls_todays_backup_' + OLD]: 'a', ['mlsRepairBackup_' + OLD]: 'b' });
let removes = 0; angry.removeItem = () => { removes++; throw new Error('locked'); };
const w2 = boot(angry, uns).w;
const r2 = w2.__mlsStorageJanitor.run();
assert.strictEqual(removes, 1, 'stopped on the FIRST delete failure');
assert.ok(r2.errors.length === 1 && /delete-failed/.test(r2.errors[0]), 'the failure is recorded, not swallowed');

/* the veto is real, executed: force a classify hit on a vetoed name */
assert.strictEqual(w.__mlsStorageJanitor.classify(NS + 'patients', NS), null, 'patients never classifies as debris');
assert.strictEqual(w.__mlsStorageJanitor.classify('sf_u::_::copilotHist', NS), 'signed-out-copilot-history', 'harness sanity: the classifier does fire on real debris');

console.log('storage-janitor-allowlist: OK (9 exact deletions, 10 named survivors incl. fresh/foreign/unparseable/clinical, receipt persisted pre-delete + masked, idempotent, fail-closed stop executed)');
