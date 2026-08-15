/* Focused p1-only proof for month ownership, local metadata durability,
 * account-wall dates, and the PHI-free range checkpoint seam. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('1p-feat_mls_schedimport_exact.js', 'utf8');

function runBlock(block, context, api) {
  vm.runInNewContext(block + (api ? `\nthis.__api = ${api};` : ''), context, { filename: '1p-pull-proof' });
  return context.__api;
}

function baseContext(store, overrides) {
  const hooks = { beforeGet: null, beforeSet: null, beforeRemove: null };
  const storage = {
    get length() { return store.size; },
    key(index) { return Array.from(store.keys())[index] || null; },
    getItem(key) { if (hooks.beforeGet) hooks.beforeGet(String(key)); return store.has(String(key)) ? store.get(String(key)) : null; },
    setItem(key, value) { key = String(key); value = String(value); if (hooks.beforeSet) hooks.beforeSet(key, value); store.set(key, value); },
    removeItem(key) { key = String(key); if (hooks.beforeRemove) hooks.beforeRemove(key); store.delete(key); }
  };
  const ctx = Object.assign({
    console, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp, Promise,
    isFinite, parseInt, parseFloat,
    window: null,
    localStorage: storage,
    navigator: null,
    __scopePrefix: 'p1-proof::acct-a::',
    __mlsSessionAccount: 'acct-a',
    __mlsSessionEpoch: 1,
    __intervals: [],
    __beforeTimeout: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {}
  }, overrides || {});
  ctx.window = ctx;
  ctx.uns = key => `${ctx.__scopePrefix}${key}`;
  ctx.setInterval = fn => { ctx.__intervals.push(fn); return fn; };
  ctx.clearInterval = fn => { const i = ctx.__intervals.indexOf(fn); if (i >= 0) ctx.__intervals.splice(i, 1); };
  ctx.setTimeout = fn => { if (ctx.__beforeTimeout) { const hook = ctx.__beforeTimeout; ctx.__beforeTimeout = null; hook(); } fn(); return 1; };
  ctx.clearTimeout = () => {};
  ctx.__storageHooks = hooks;
  return ctx;
}

function quotaError() { const error = new Error('full'); error.name = 'QuotaExceededError'; return error; }

/* All visible routes must converge on the same private owner and checkpoint. */
assert(/function p1ClaimMonthOwner\(\)/.test(source), 'p1 month owner claim is missing');
assert(/__p1MonthOwnerToken: monthOwner\.token/.test(source), 'month days do not carry the private owner token');
assert(/monthPullRunning && !__monthOwned/.test(source), 'direct pulls do not refuse a running month');
assert(/var monthForeign = p1MonthForeignOwner\(\)/.test(source), 'day pulls do not inspect the month owner');
assert(/mls-p1-month-owner/.test(source) && /monthLockRelease = attemptRelease/.test(source), 'successful Web Lock ownership does not publish its own release resolver');
assert(/monthOwnerClaimPending/.test(source), 'same-tab owner claim arbitration is missing');
assert(/opts\.onDayCheckpoint/.test(source), 'month pull does not accept the range checkpoint callback');
assert((source.match(/p1MonthDayCheckpoint\(onDayCheckpoint/g) || []).length >= 5, 'not every terminal day path emits a checkpoint');
assert(/monthPullVisitBodies = \(typeof opts\.pullVisitBodies === "boolean"\)/.test(source) && /pullVisitBodies: monthPullVisitBodies/.test(source), 'month pull does not freeze and forward the boolean full-note choice');
const pullMonthSource = source.slice(source.indexOf('function pullMonth'), source.indexOf('function pullCalendarSelection'));
assert(pullMonthSource.indexOf('window.__mlsPullStopRequested = false') < pullMonthSource.indexOf('p1ClaimMonthOwner()'), 'month stop flag resets after the async owner claim begins');
assert(!/p1ClaimMonthOwner\(\)[\s\S]*window\.__mlsPullStopRequested = false/.test(pullMonthSource), 'owner continuation can erase a pause/cancel received during claim');

/* Account-wall dates: EST midnight, DST boundaries, and year rollover. */
const dateStart = source.indexOf('function accountDayFromInstant');
const dateEnd = source.indexOf('function normDate', dateStart);
let ctx = baseContext(new Map());
const accountDay = runBlock('var EST_TZ = "America/New_York"; function isFn(f){return typeof f === "function";}\n' + source.slice(dateStart, dateEnd), ctx, 'accountDayFromInstant');
assert.strictEqual(accountDay('2026-01-01T04:59:59.000Z'), '2025-12-31', 'UTC instant crossed the New York year boundary');
assert.strictEqual(accountDay('2026-01-01T05:00:00.000Z'), '2026-01-01', 'UTC instant did not enter the New York date');
assert.strictEqual(accountDay('2026-03-08T04:59:59.000Z'), '2026-03-07', 'spring-forward eve used the wrong account date');
assert.strictEqual(accountDay('2026-03-08T07:00:00.000Z'), '2026-03-08', 'spring-forward instant used the wrong account date');
assert.strictEqual(accountDay('2026-11-01T03:59:59.000Z'), '2026-10-31', 'fall-back eve used the wrong account date');
assert.strictEqual(accountDay('2026-11-01T06:00:00.000Z'), '2026-11-01', 'fall-back instant used the wrong account date');
assert.strictEqual(accountDay('not-a-date'), '', 'invalid instant must fail closed');

const metaStart = source.indexOf('var p1MetadataFailureSerial');
const metaEnd = source.indexOf('function indexKey', metaStart);
function metadataHarness() {
  const store = new Map(), context = baseContext(store);
  const api = runBlock('function safe(fn,d){try{return fn();}catch(e){return d;}}\nfunction isFn(f){return typeof f === "function";}\nvar lastPullResult = null;\n' + source.slice(metaStart, metaEnd), context, '{set:p1VerifiedMetadataSet,remove:p1VerifiedMetadataRemove,failure:p1MetadataFailure}');
  return { store, context, api };
}

/* A successful unrelated/no-growth write must not erase a failed growth. */
let meta = metadataHarness(), failLarge = true;
meta.context.__storageHooks.beforeSet = (key) => { if (failLarge && key === 'large-index') { failLarge = false; throw quotaError(); } };
let failed = meta.api.set('large-index', 'x'.repeat(40));
assert.strictEqual(failed.ok, false, 'quota throw was reported as durable');
assert.strictEqual(failed.reason, 'storage-full', 'quota throw did not retain storage-full');
assert(!/large-index|\bfull\b/i.test(JSON.stringify(failed.receipt).replace(/storage-full/g, '')), 'public metadata receipt leaked a raw key or exception');
assert.strictEqual(meta.api.set('owner-heartbeat', 'ok').ok, true, 'unrelated healthy metadata write failed');
assert.strictEqual(meta.api.failure().reason, 'storage-full', 'unrelated heartbeat cleared a storage-full latch');
assert.strictEqual(meta.api.set('large-index', 'short').ok, true, 'same-key smaller probe should write but not prove capacity');
assert.strictEqual(meta.api.failure().reason, 'storage-full', 'smaller same-key write falsely proved recovery');
assert.strictEqual(meta.api.set('large-index', 'y'.repeat(40)).ok, true, 'same-key equal-size recovery proof failed');
assert.strictEqual(meta.api.failure(), null, 'equal-size same-key proof did not clear the resolved failure');

/* Remove failures recover only through a verified remove of that same key. */
meta = metadataHarness();
meta.store.set('remove-me', '1');
let failRemove = true;
meta.context.__storageHooks.beforeRemove = key => { if (failRemove && key === 'remove-me') { failRemove = false; throw new Error('denied'); } };
assert.strictEqual(meta.api.remove('remove-me').ok, false, 'remove exception was reported as successful');
assert.strictEqual(meta.api.set('other', '1').ok, true, 'unrelated set failed');
assert(meta.api.failure(), 'unrelated set cleared a failed remove');
assert.strictEqual(meta.api.remove('remove-me').ok, true, 'same-key remove recovery failed');
assert.strictEqual(meta.api.failure(), null, 'verified same-key remove did not clear its failure');

/* Ledger claims/completion still fail closed under thrown writes. */
const ledgerStart = source.indexOf('function indexKey');
const ledgerEnd = source.indexOf('/* ---- authoritative Athena day/provider snapshots', ledgerStart);
let store = new Map();
ctx = baseContext(store);
let ledger = runBlock('function safe(fn,d){try{return fn();}catch(e){return d;}}\nfunction isFn(f){return typeof f === "function";}\n' + source.slice(metaStart, metaEnd) + '\nvar IMPORT_INDEX_SUFFIX="schedImportIndexV1", IMPORT_DAYS_SUFFIX="schedImportDaysV1", PENDING_TTL=300000, knownDays={}, inFlight={};\n' + source.slice(ledgerStart, ledgerEnd), ctx, '{claim:claim,done:markDone,read:readIndex}');
ctx.__storageHooks.beforeSet = () => { throw quotaError(); };
assert.strictEqual(ledger.claim('identity', { date: '2026-03-08' }), '', 'ledger claim proceeded after a thrown write');
store = new Map(); ctx = baseContext(store);
ledger = runBlock('function safe(fn,d){try{return fn();}catch(e){return d;}}\nfunction isFn(f){return typeof f === "function";}\n' + source.slice(metaStart, metaEnd) + '\nvar IMPORT_INDEX_SUFFIX="schedImportIndexV1", IMPORT_DAYS_SUFFIX="schedImportDaysV1", PENDING_TTL=300000, knownDays={}, inFlight={};\n' + source.slice(ledgerStart, ledgerEnd), ctx, '{claim:claim,done:markDone}');
assert(ledger.claim('identity', { date: '2026-03-08' }), 'healthy ledger claim did not acquire');
ctx.__storageHooks.beforeSet = () => { throw quotaError(); };
assert.strictEqual(ledger.done('identity', { date: '2026-03-08', backendAppointmentId: 'backend-1' }).ok, false, 'markDone hid a thrown write');

const monthStart = source.indexOf('var monthPullRunning = false');
const monthEnd = source.indexOf('function monthDateKeys', monthStart);
function monthHarness(options) {
  const monthStore = new Map(), context = baseContext(monthStore, options && options.context);
  if (options && options.locks) context.navigator = { locks: options.locks };
  const api = runBlock('function safe(fn,d){try{return fn();}catch(e){return d;}}\nfunction isFn(f){return typeof f === "function";}\n' + source.slice(metaStart, metaEnd) + '\nvar pullRunning=false,lastPullResult=null; function foreignPullLease(){return null;} function claimSiLease(){window.__siLease=true;} function releaseSiLease(){window.__siLease=false;} function honestPullOutcome(v){return v;}\n' + source.slice(monthStart, monthEnd), context, '{claim:p1ClaimMonthOwner,foreign:p1MonthForeignOwner,release:p1ReleaseMonthOwner,still:p1MonthOwnerStillHeld,scope:p1MonthOwnerScope,running:function(){return monthPullRunning;},reset:function(){monthPullRunning=false;}}');
  return { store: monthStore, context, api };
}
function ownerKeyOf(harness) { return Array.from(harness.store.keys()).find(key => key.endsWith('p1MonthPullOwnerV1')); }
async function microtasks() { await Promise.resolve(); await Promise.resolve(); }

(async function () {
  /* Fallback lifecycle uses two settled observations and exact cleanup. */
  let month = monthHarness();
  let claimed = await month.api.claim();
  assert.strictEqual(claimed.ok, true, 'fallback month owner did not acquire');
  assert.strictEqual(month.api.running(), true, 'fallback owner did not set busy state');
  assert.strictEqual((await month.api.claim()).ok, false, 'same-tab overlap claimed concurrently');
  let release = month.api.release();
  assert.strictEqual(release.ok, true, 'healthy fallback owner did not release truthfully');
  assert.strictEqual(month.store.size, 0, 'healthy owner or heartbeat metadata remained after release');

  /* Web Lock refusal cannot clobber the active attempt's release resolver. */
  let lockHeld = false, lockRequests = 0;
  const locks = { request(_name, opts, callback) {
    lockRequests++;
    if (opts.ifAvailable && lockHeld) return Promise.resolve(callback(null));
    lockHeld = true;
    return Promise.resolve(callback({ name: 'mls-p1-month-owner' })).then(() => { lockHeld = false; });
  } };
  month = monthHarness({ locks });
  claimed = await month.api.claim();
  assert.strictEqual(claimed.ok, true, 'Web Lock owner did not acquire');
  assert.strictEqual((await month.api.claim()).ok, false, 'second Web Lock attempt was not refused');
  assert.strictEqual(lockRequests, 1, 'refused same-tab attempt reached and endangered the browser lock');
  release = month.api.release(); month.api.reset(); await microtasks();
  assert.strictEqual(release.ok, true, 'Web Lock owner release receipt failed');
  assert.strictEqual(lockHeld, false, 'active Web Lock remained held after release');
  assert.strictEqual((await month.api.claim()).ok, true, 'Web Lock could not be reacquired after cleanup');
  assert.strictEqual(lockRequests, 2, 'reacquire did not use the browser lock exactly once');
  month.api.release(); month.api.reset(); await microtasks();

  /* If activation loses its final metadata proof after the browser lock was
     acquired, the candidate must be removed before that lock is released. */
  let transientLockHeld = false;
  const transientLocks = { request(_name, _opts, callback) {
    transientLockHeld = true;
    return Promise.resolve(callback({ name: 'mls-p1-month-owner' })).then(() => { transientLockHeld = false; });
  } };
  month = monthHarness({ locks: transientLocks });
  const transientOwnerKey = 'p1-proof::acct-a::p1MonthPullOwnerV1';
  let transientOwnerReads = 0;
  month.context.__storageHooks.beforeGet = key => {
    if (key === transientOwnerKey && ++transientOwnerReads === 4) throw new Error('transient activation read failure');
  };
  claimed = await month.api.claim();
  assert.strictEqual(claimed.ok, false, 'activation metadata failure reported a live month owner');
  await microtasks();
  assert.strictEqual(transientLockHeld, false, 'failed activation retained the browser lock');
  assert(!Array.from(month.store.keys()).some(key => key === transientOwnerKey || key.startsWith(`${transientOwnerKey}::heartbeat::`)),
    'failed activation stranded its owner or token heartbeat');

  /* A competing fallback claimant appearing during settle wins; no navigation owner activates. */
  month = monthHarness();
  const replacement = 'p1-month-replacement1';
  month.context.__beforeTimeout = () => {
    const ownerKey = ownerKeyOf(month), now = Date.now(), heartbeatKey = `${ownerKey}::heartbeat::${replacement}`;
    month.store.set(heartbeatKey, JSON.stringify({ v: 1, id: replacement, at: now }));
    month.store.set(ownerKey, JSON.stringify({ v: 2, id: replacement, at: now, heartbeat: 1 }));
  };
  claimed = await month.api.claim();
  assert.strictEqual(claimed.ok, false, 'fallback arbitration activated after losing its settled owner');
  assert.strictEqual(month.api.running(), false, 'failed arbitration left the month busy state active');
  assert.strictEqual(JSON.parse(month.store.get(ownerKeyOf(month))).id, replacement, 'failed claimant overwrote the settled replacement');

  /* A stale heartbeat can write only its token key, never the replacement pointer. */
  month = monthHarness();
  claimed = await month.api.claim(); assert.strictEqual(claimed.ok, true);
  const ownerKey = ownerKeyOf(month), oldToken = JSON.parse(month.store.get(ownerKey)).id;
  const oldHeartbeatKey = `${ownerKey}::heartbeat::${oldToken}`;
  let injected = false;
  month.context.__storageHooks.beforeSet = key => {
    if (!injected && key === oldHeartbeatKey) {
      injected = true; const now = Date.now(), replacementHeartbeat = `${ownerKey}::heartbeat::${replacement}`;
      month.store.set(replacementHeartbeat, JSON.stringify({ v: 1, id: replacement, at: now }));
      month.store.set(ownerKey, JSON.stringify({ v: 2, id: replacement, at: now, heartbeat: 1 }));
    }
  };
  month.context.__intervals[0]();
  assert.strictEqual(JSON.parse(month.store.get(ownerKey)).id, replacement, 'stale heartbeat overwrote a replacement in the check/write gap');
  assert.strictEqual(month.api.still(), false, 'stale owner still considered itself exclusive');
  release = month.api.release();
  assert.strictEqual(release.ok, false, 'lost owner reported a clean release');
  assert.strictEqual(JSON.parse(month.store.get(ownerKey)).id, replacement, 'lost-owner release deleted the replacement');

  /* Raw/placeholder namespaces fail closed; an account switch never retargets cleanup. */
  month = monthHarness(); month.context.uns = key => key;
  claimed = await month.api.claim();
  assert.strictEqual(claimed.reason, 'account-scope-unverified', 'raw owner key was accepted as account scoped');
  assert.strictEqual(month.store.size, 0, 'unscoped owner wrote metadata');
  month = monthHarness(); month.context.uns = key => `sf_u::_::${key}`;
  assert.strictEqual((await month.api.claim()).reason, 'account-scope-unverified', 'signed-out placeholder acquired a month');
  month = monthHarness(); claimed = await month.api.claim(); assert.strictEqual(claimed.ok, true);
  const accountAOwner = ownerKeyOf(month); month.store.set('p1-proof::acct-b::sentinel', 'keep');
  month.context.__scopePrefix = 'p1-proof::acct-b::'; month.context.__mlsSessionAccount = 'acct-b'; month.context.__mlsSessionEpoch = 2;
  month.context.__intervals[0]();
  assert.strictEqual(month.api.still(), false, 'owner survived an account namespace switch');
  release = month.api.release();
  assert.strictEqual(release.ownerLost, true, 'account switch was not reflected in release proof');
  assert.strictEqual(month.store.has(accountAOwner), false, 'frozen account-A owner key was stranded');
  assert.strictEqual(month.store.get('p1-proof::acct-b::sentinel'), 'keep', 'release touched the new account namespace');

  /* Owner removal and owner-read failures are explicit, sanitized, and never green. */
  month = monthHarness(); claimed = await month.api.claim(); assert.strictEqual(claimed.ok, true);
  const removalOwner = ownerKeyOf(month);
  month.context.__storageHooks.beforeRemove = key => { if (key === removalOwner) throw new Error('remove denied for private key'); };
  release = month.api.release();
  assert.strictEqual(release.ok, false, 'owner remove failure was reported as released');
  assert.strictEqual(month.store.has(removalOwner), true, 'remove-failure proof did not retain the actual owner record');
  assert(!/acct-a|p1MonthPullOwner|denied/i.test(JSON.stringify(release.metadataReceipt || {})), 'cleanup receipt leaked account/key/exception detail');
  month = monthHarness(); claimed = await month.api.claim(); assert.strictEqual(claimed.ok, true);
  const readOwner = ownerKeyOf(month);
  month.context.__storageHooks.beforeGet = key => { if (key === readOwner) throw new Error('read denied'); };
  release = month.api.release();
  assert.strictEqual(release.ok, false, 'owner read failure was reported as released');
  assert.strictEqual(month.store.has(readOwner), true, 'read-failure cleanup guessed and deleted owner state');

  /* The range checkpoint contains exactly four PHI-free fields and is non-breaking. */
  const checkpointStart = source.indexOf('function p1MonthDayCheckpoint');
  const checkpointEnd = source.indexOf('/* One exact month route', checkpointStart);
  ctx = baseContext(new Map());
  const checkpoint = runBlock('function safe(fn,d){try{return fn();}catch(e){return d;}} function isFn(f){return typeof f === "function";}\n' + source.slice(checkpointStart, checkpointEnd), ctx, 'p1MonthDayCheckpoint');
  let delivered = null;
  const returned = checkpoint(value => { delivered = value; throw new Error('caller failure'); }, '2026-03-08', { ok: true, complete: true, reason: 'complete', patientName: 'Never Expose', error: 'secret' });
  assert.deepStrictEqual(Object.keys(returned).sort(), ['complete', 'date', 'ok', 'reason'], 'checkpoint exposed fields outside its PHI-free contract');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(delivered)), { date: '2026-03-08', ok: true, complete: true, reason: 'complete' }, 'checkpoint content was not minimal and exact');
  assert.strictEqual(checkpoint(null, 'bad-date', { reason: 'Patient Name' }).reason, 'unclassified', 'unsafe checkpoint reason was not collapsed');

  console.log('PASS p1 pull/storage runtime: Web Lock lifecycle, settled fallback ownership, token heartbeats, frozen account scope, sticky capacity failures, truthful cleanup, DST dates, and PHI-free day checkpoints');
})().catch(error => { console.error(error); process.exitCode = 1; });
