'use strict';

/* Focused first-use gate/receipt coverage for the 1p lane.
 *
 * This suite is deliberately PHI-free.  It executes the shipped resolver,
 * exercises the four bulk entrypoint contracts, drives the local/relay
 * receipt seams, and proves that a single-patient request remains explicit
 * and honest when no visit note arrives.  Nothing here opens Athena or calls
 * a live backend.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONNECT = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
const RANGE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_rangejobs.js'), 'utf8');

function blockBetween(source, start, end, label) {
  const a = source.indexOf(start);
  assert(a >= 0, label + ': start marker missing');
  const b = source.indexOf(end, a + start.length);
  assert(b > a, label + ': end marker missing');
  return source.slice(a, b + end.length);
}

function balancedFunction(source, marker, label) {
  const a = source.indexOf(marker);
  assert(a >= 0, label + ': function marker missing');
  const open = source.indexOf('{', a);
  assert(open > a, label + ': opening brace missing');
  let depth = 0, quote = null, line = false, comment = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (comment) { if (c === '*' && n === '/') { comment = false; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { comment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(a, i + 1);
  }
  throw new Error(label + ': unbalanced function');
}

function resolverSource() {
  const a = CONNECT.indexOf('(function () {\n  if (window.__mlsVisitNotesPref) return;');
  const b = CONNECT.indexOf('  window.__mlsVisitNotesPref = api;\n})();', a);
  assert(a >= 0 && b > a, '1p resolver bounds missing');
  return CONNECT.slice(a, b + '  window.__mlsVisitNotesPref = api;\n})();'.length);
}

function resolverHarness(options) {
  options = options || {};
  const data = new Map(Object.entries(options.seed || {}));
  const writes = [];
  const namespace = options.namespace === undefined ? 'sf_u::doctor@example.test::' : options.namespace;
  const ls = {
    getItem(key) {
      if (options.readThrows) throw new Error('storage read failed');
      return data.has(String(key)) ? data.get(String(key)) : null;
    },
    setItem(key, value) {
      if (options.writeThrows) throw new Error('storage write failed');
      writes.push([String(key), String(value)]);
      data.set(String(key), String(value));
    },
    removeItem(key) { data.delete(String(key)); }
  };
  const events = [];
  const win = {
    uns: key => namespace === null ? '' : namespace + key,
    addEventListener() {},
    dispatchEvent(ev) { events.push(ev); return true; },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    _mlsVisitNotesChoice: options.choice
  };
  const ctx = vm.createContext({
    window: win, localStorage: ls, Date, Promise, setTimeout, clearTimeout,
    CustomEvent: win.CustomEvent, console
  });
  vm.runInContext(resolverSource(), ctx, { filename: '1p-mls-connect:visit-notes-resolver' });
  return { api: win.__mlsVisitNotesPref, data, writes, events, window: win };
}

async function resolverCases() {
  let h = resolverHarness({ choice: () => false });
  const initial = h.api.read();
  assert.strictEqual(initial.state, 'unset', 'unset preference did not retain unset state');
  assert.strictEqual(initial.on, false, 'unset preference is not safe OFF');
  assert.strictEqual(initial.settled, true, 'real namespace was not marked settled');
  let r = await h.api.ensureChosenForBulkPull();
  assert.strictEqual(r.ok, true, 'first-use OFF choice did not save');
  assert.strictEqual(r.chosen, true, 'first-use OFF choice was not marked chosen');
  assert.strictEqual(r.on, false, 'first-use OFF choice did not return off');
  assert.strictEqual(r.reason, 'choice-saved', 'first-use OFF choice did not report choice-saved');
  assert.strictEqual(h.api.read().state, 'off', 'saved OFF choice did not read back as off');
  assert.strictEqual(h.data.get('sf_u::doctor@example.test::visitNotesModeV2'), 'off', 'canonical OFF key missing');

  h = resolverHarness({ choice: () => true });
  r = await h.api.ensureChosenForBulkPull();
  assert.strictEqual(r.on, true, 'first-use ON choice did not return on=true');
  assert.strictEqual(h.api.read().state, 'on', 'saved ON choice did not read back as on');

  h = resolverHarness({ choice: () => null });
  r = await h.api.ensureChosenForBulkPull();
  assert.strictEqual(r.reason, 'choice-cancelled', 'cancel was not surfaced as choice-cancelled');
  assert.strictEqual(h.writes.length, 0, 'cancel wrote a preference');
  assert.strictEqual(h.api.read().state, 'unset', 'cancel changed the preference');

  h = resolverHarness({ choice: () => true, writeThrows: true });
  r = await h.api.ensureChosenForBulkPull();
  assert.strictEqual(r.reason, 'choice-write-failed', 'storage failure was not surfaced as choice-write-failed');
  assert.strictEqual(h.writes.length, 0, 'failed write reported a write');
  assert.strictEqual(h.api.read().state, 'unset', 'failed write changed the preference');

  let chooseCalls = 0, answer;
  let release;
  h = resolverHarness({ choice: () => { chooseCalls++; return new Promise(resolve => { release = resolve; }); } });
  const p1 = h.api.ensureChosenForBulkPull();
  const p2 = h.api.ensureChosenForBulkPull();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(h.api.choicePending(), true, 'concurrent first-use callers did not mark one prompt pending');
  release(false);
  [answer] = await Promise.all([p1, p2]);
  assert.strictEqual(chooseCalls, 1, 'concurrent callers opened more than one prompt');
  assert.strictEqual(answer.on, false, 'shared prompt answer was not delivered to caller');
  assert.strictEqual(h.api.read().state, 'off', 'shared prompt answer was not persisted');

  h = resolverHarness({ namespace: 'sf_u::_::' + 'visitNotesModeV2', choice: () => { throw new Error('must not prompt'); } });
  r = await h.api.ensureChosenForBulkPull({ settleTimeoutMs: 0 });
  assert.strictEqual(r.reason, 'account-namespace-not-settled', 'placeholder namespace did not fail closed');
  assert.strictEqual(h.writes.length, 0, 'unsettled namespace wrote a choice');

  h = resolverHarness({ namespace: 'sf_u::_::', seed: { mls_save_every_athena_visit: '1' }, choice: () => { throw new Error('must not prompt'); } });
  r = await h.api.ensureChosenForBulkPull({ settleTimeoutMs: 0 });
  assert.strictEqual(r.reason, 'account-namespace-not-settled', 'legacy global preference bypassed the unsettled account gate');
  assert.strictEqual(h.writes.length, 0, 'legacy global preference was migrated into placeholder storage');
  assert.strictEqual(h.data.get('mls_save_every_athena_visit'), '1', 'legacy global preference was removed before the account namespace settled');

  h = resolverHarness({ seed: { 'sf_u::doctor@example.test::visitNotesModeV2': 'off' }, choice: () => { throw new Error('must not prompt'); } });
  r = await h.api.ensureChosenForBulkPull();
  assert.strictEqual(r.ok, true, 'explicit stored choice did not bypass dialog');
  assert.strictEqual(r.chosen, false, 'explicit stored choice was treated as a new choice');
  assert.strictEqual(r.on, false, 'explicit stored OFF choice was not returned');
  assert.strictEqual(r.reason, 'already-chosen', 'explicit stored choice did not report already-chosen');
  assert.strictEqual(h.writes.length, 0, 'explicit stored choice was rewritten');
}

function staticGateCases() {
  const day = balancedFunction(CONNECT, 'function startPull(autoRetry)', 'day entrypoint');
  const cal = balancedFunction(CONNECT, 'function runHeroPull(el, isAutoRetry, choiceAdmitted)', 'calendar entrypoint');
  const month = balancedFunction(CONNECT, 'function startMonthPull(retryOnly, rosterRetried, choiceAdmitted, fullNotesChoice)', 'legacy month entrypoint');
  const dayLegacy = balancedFunction(CONNECT, 'function startDayPull(retryOnly, rosterRetried, choiceAdmitted, fullNotesChoice)', 'legacy day entrypoint');
  const year = balancedFunction(RANGE, 'function wireYearUi(root)', 'year entrypoint');

  assert(day.includes('prefApi.ensureChosenForBulkPull()'), 'day pull has no first-use choice gate');
  assert(day.indexOf('prefApi.ensureChosenForBulkPull()') < day.indexOf('window.__mlsRelayLink'), 'day gate runs after relay admission');
  assert(day.indexOf('prefApi.ensureChosenForBulkPull()') < day.indexOf('var si = window.__mlsSI'), 'day gate runs after local importer admission');
  assert(day.includes('DS.preferenceGatePending'), 'day gate lacks its own per-entrypoint latch');
  assert(cal.includes('pref.ensureChosenForBulkPull()'), 'calendar pull has no first-use choice gate');
  assert(cal.indexOf('pref.ensureChosenForBulkPull()') < cal.indexOf('var si = window.__mlsSI'), 'calendar gate runs after importer admission');
  assert(cal.includes('choicePending'), 'calendar gate lacks its own per-entrypoint latch');
  assert(month.includes('admitStaffVisitChoice'), 'legacy month bulk entrypoint bypasses choice admission');
  assert(dayLegacy.includes('admitStaffVisitChoice'), 'legacy day bulk entrypoint bypasses choice admission');
  assert(year.includes('pref.ensureChosenForBulkPull()'), 'year entrypoint bypasses choice admission');
  assert(year.indexOf('pref.ensureChosenForBulkPull()') < year.indexOf('installedApi.startYear'), 'year starts before choice admission resolves');

  const release = balancedFunction(RANGE, 'function releaseUiActionAfterAdmission(sequence, kind, attempt)', 'year admission latch');
  assert(release.includes('pref.choicePending() === true'), 'year admission latch can time out while the first-use dialog is still open');
  assert(release.indexOf('pref.choicePending() === true') < release.indexOf('attempt >= 40'), 'year choice hold runs after the one-second admission timeout');

  /* Automatic retries must carry the frozen answer and never ask again. */
  assert(/if \(!automaticRetry && !preferenceReady\)/.test(day), 'day automatic retry is not exempted from the first-use dialog');
  assert(/if \(retryOnly !== true && choiceAdmitted !== true\)/.test(month), 'legacy automatic retry is not exempted from the first-use dialog');
  assert(/if \(retryOnly !== true && choiceAdmitted !== true\)/.test(dayLegacy), 'legacy day retry is not exempted from the first-use dialog');
}

function slowYearChoiceCase() {
  const release = balancedFunction(RANGE, 'function releaseUiActionAfterAdmission(sequence, kind, attempt)', 'year admission release');
  const result = balancedFunction(RANGE, 'function uiActionResult(sequence, kind, result)', 'year action result');
  const run = balancedFunction(RANGE, 'function runUiAction(kind, invoke)', 'year action runner');
  const timers = [];
  let choicePending = true;
  const never = new Promise(() => {});
  const ctx = vm.createContext({
    uiAction: '', uiActionSequence: 0, uiNotice: '', uiAdmissionTimer: null,
    installedApi: { installed: true }, window: { __mlsVisitNotesPref: { choicePending: () => choicePending } },
    isFn: value => typeof value === 'function', state: () => null, queueUiRefresh() {},
    clearUiAdmissionTimer() { ctx.uiAdmissionTimer = null; },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, Promise
  });
  vm.runInContext(release + '\n' + result + '\n' + run +
    '\nthis.__runUiAction=runUiAction; this.__uiAction=function(){return uiAction;};', ctx,
    { filename: 'year-first-choice-admission-latch' });
  assert.strictEqual(ctx.__runUiAction('start', () => never), true, 'first year start was not admitted');
  assert.strictEqual(ctx.__runUiAction('start', () => { throw new Error('duplicate start ran'); }), false, 'immediate second year start bypassed the action latch');
  for (let i = 0; i < 60; i++) {
    const tick = timers.shift();
    assert(tick, 'year choice hold stopped polling while the dialog was still open');
    tick();
  }
  assert.strictEqual(ctx.__uiAction(), 'start', 'year action latch expired while the first-use dialog remained open');
  assert.strictEqual(ctx.__runUiAction('start', () => { throw new Error('late duplicate start ran'); }), false, 'late second click attached a duplicate start to the shared dialog');
  choicePending = false;
}

function receiptCases() {
  const own = balancedFunction(CONNECT, 'function ownAttemptResult(result, day, fallbackReason, fallbackError)', 'local receipt');
  const local = { lastAttemptResult: null, day: '2026-08-22' };
  const localCtx = vm.createContext({
    DS: local, String, Object,
    dsBuildTerminalReceipt(result, day) { return { target: day, status: result && result.ok ? 'complete' : 'failed' }; },
    dsPersistTerminalReceipt() { return { durable: false, reason: 'test-only' }; },
    dsTerminalReceiptKey() { return ''; }
  });
  vm.runInContext(own + '\nthis.__own = ownAttemptResult;', localCtx);
  const missing = localCtx.__own(null, '2026-08-22', 'no-receipt', 'engine returned nothing');
  assert.strictEqual(missing.ok, false, 'missing local receipt was marked successful');
  assert.strictEqual(missing.reason, 'no-receipt', 'missing local receipt lost its reason');
  assert.strictEqual(missing.target, '2026-08-22', 'local receipt lost its requested day');
  assert.strictEqual(local.lastAttemptResult, missing, 'local receipt was not retained on the active attempt');

  /* The range ledger is the durable local receipt: exercise the shipped
     write/read-back gate with a synthetic PHI-free manifest. */
  const persist = balancedFunction(RANGE, 'function writeManifestAt(key, manifest)', 'durable local receipt');
  const ledger = new Map();
  const persistCtx = vm.createContext({
    localStorage: {
      setItem(key, value) { ledger.set(String(key), String(value)); },
      getItem(key) { return ledger.has(String(key)) ? ledger.get(String(key)) : null; }
    },
    now: () => 1700000000000,
    safe: fn => fn(),
    summarize: () => ({ days: 1, complete: 0, empty: 0, withRows: 0, failed: 1, pending: 0, months: 1, completeMonths: 0, needsAttention: 0, attention: [] }),
    queueUiRefresh() {}, storageFailureReason: () => 'metadata-persist-failed',
    JSON, String, Object
  });
  vm.runInContext(persist + '\nthis.__persist = writeManifestAt;', persistCtx);
  const manifest = { v: 1, kind: 'month', target: '2026-08', status: 'waiting-retry', months: {} };
  const saved = persistCtx.__persist('sf_u::doctor@example.test::p1RangeJobV1', manifest);
  assert.strictEqual(saved.ok, true, 'durable local receipt did not verify its localStorage write');
  const rawLedger = ledger.get('sf_u::doctor@example.test::p1RangeJobV1');
  assert(rawLedger && JSON.parse(rawLedger).updatedAt === 1700000000000, 'durable local receipt did not persist its timestamped manifest');
  assert(JSON.parse(rawLedger).summary && JSON.parse(rawLedger).summary.failed === 1, 'durable local receipt did not persist derived status counts');

  const relay = blockBetween(CONNECT,
    'if (window.__mlsRelayLink && window.__mlsRelayLink.shouldRelay && window.__mlsRelayLink.shouldRelay()) {',
    '    var si = window.__mlsSI;', 'relay receipt branch');
  assert(relay.includes('onStatus: function (m)'), 'relay branch does not persist live status');
  assert(relay.includes('dsStatusLog(m)'), 'relay status is not retained in the local status log');
  assert(relay.includes('ownAttemptResult({ ok: ok === true'), 'relay completion does not create a local receipt');
  assert(relay.includes('pullVisitBodies: DS.pullVisitBodies'), 'relay payload does not carry the frozen full-notes choice');

  const statusLog = [], captured = {};
  const status = { style: {}, textContent: '', parentNode: { insertBefore() {} }, nextSibling: null };
  const button = { disabled: false, innerHTML: '', parentNode: { insertBefore() {} }, nextSibling: null };
  const doc = { getElementById(id) { return id === 'mlsDsStatus' ? status : (id === 'mlsDsPullBtn' ? button : null); }, createElement() { return { style: {}, firstElementChild: { style: {}, textContent: '' }, innerHTML: '' }; } };
  const DS = { sessionSerial: 0, pulling: false, pullStartedAt: 0, pullId: '', day: '2026-08-22', pullVisitBodies: false };
  const ctx = vm.createContext({
    window: { __mlsRelayLink: { shouldRelay: () => true, pullDay(day, opts) { captured.day = day; captured.opts = opts; } }, toast() {} },
    document: doc, DS, sessionSerial: 0, Date, String, Number, Math, JSON,
    $: id => doc.getElementById(id), dsNewPullId: () => 'pull-1', dsPullVerb: () => 'Pull this day',
    esc: x => String(x), dsStatusLog: m => statusLog.push(String(m || '')), dsSyncDiagBtn() {},
    renderList() {}, ownAttemptResult: (result, day) => { DS.lastAttemptResult = Object.assign({}, result, { target: day }); return DS.lastAttemptResult; },
    documentElement: doc
  });
  vm.runInContext('(function(){' + relay + '\n}).call(this);', ctx, { filename: 'relay-receipt-branch' });
  assert.strictEqual(captured.day, '2026-08-22', 'relay branch did not freeze the requested day');
  captured.opts.onStatus('History 1 of 2');
  captured.opts.onDone(false, 'office computer refused the pull');
  assert.strictEqual(statusLog.includes('History 1 of 2'), true, 'relay status did not persist locally');
  assert.strictEqual(DS.lastAttemptResult.reason, 'relay-failed', 'relay failure did not persist a durable local receipt');
  assert.strictEqual(DS.lastAttemptResult.target, '2026-08-22', 'relay receipt was not bound to the requested day');
}

async function singlePatientCases() {
  const run = balancedFunction(CONNECT, 'api.runForPatient = function (p, onStatus, runOpts)', 'single-patient runner');
  let readerCalls = 0;
  let readerOpts = null;
  const ctx = vm.createContext({
    api: { running: false, current: null },
    enabled: () => false,
    window: { __mlsCopyVisits: { run(onStatus, patient, opts) { readerCalls++; readerOpts = opts; return Promise.resolve(0); } } },
    Promise, Error, String
  });
  vm.runInContext(run + '\nthis.__runForPatient = api.runForPatient;', ctx);
  const skipped = await ctx.__runForPatient({ id: 'p1', name: 'Synthetic Patient' }, null, {});
  assert.strictEqual(skipped.ok, true, 'bulk patient read did not return an explicit refusal result');
  assert.strictEqual(skipped.skipped, 'preference-off', 'bulk patient read did not honor OFF');
  const singleOff = await ctx.__runForPatient({ id: 'p1', name: 'Synthetic Patient' }, null, { singlePull: true });
  assert.strictEqual(singleOff.ok, true, 'single-patient OFF result was not explicit');
  assert.strictEqual(singleOff.skipped, 'preference-off', 'single-patient request bypassed Full Notes OFF');
  assert.strictEqual(readerCalls, 0, 'single-patient request opened visit notes while Full Notes was OFF');

  ctx.enabled = () => true;
  const singleOn = await ctx.__runForPatient({ id: 'p1', name: 'Synthetic Patient' }, null, { singlePull: true });
  assert.strictEqual(singleOn.ok, true, 'single-patient request did not run with Full Notes ON');
  assert.strictEqual(singleOn.visits, 0, 'single-patient ON request changed the reader result');
  assert.strictEqual(readerCalls, 1, 'single-patient ON request did not run the visit-note reader exactly once');
  assert.strictEqual(readerOpts.singlePull, true, 'single-patient option did not reach the visit-note reader');

  const spv = blockBetween(CONNECT, '  function spvVisitCount(p) {', '  /* ===== end spv-1.0.0 ==================================================== */', 'single-patient receipt');
  let queued = 0;
  const patient = { id: 'p1', name: 'Synthetic Patient', visits: [] };
  const spvCtx = vm.createContext({
    window: {
      _hasImportedHistory: () => true,
      __mlsVisitsBackfill: { runOnce() { queued++; } },
      __mlsSinglePullVisits: null,
      toast() {}
    },
    api: { runForPatient: () => Promise.resolve({ ok: true, visits: 0 }) },
    $: () => null, Date, String, Promise, Math, Array, Object
  });
  vm.runInContext(spv + '\nthis.__spv = spvVisitLeg;', spvCtx, { filename: 'single-patient-receipt' });
  const receipt = await spvCtx.__spv(patient, patient);
  assert.strictEqual(receipt.ok, false, 'single-patient no-visit result claimed success');
  assert.strictEqual(receipt.added, 0, 'single-patient no-visit result invented an added visit');
  assert.strictEqual(receipt.queued, true, 'single-patient no-visit result failed to report its retry queue');
  assert.strictEqual(queued, 1, 'single-patient no-visit result did not enqueue one retry');
  assert(/NO prior visit notes came back/i.test(receipt.message), 'single-patient partial receipt was not honest about missing visits');
}

(async () => {
  await resolverCases();
  staticGateCases();
  slowYearChoiceCase();
  receiptCases();
  await singlePatientCases();
  console.log('PASS full-visit-notes-choice-gates-runtime: resolver first-use cases, day/calendar/legacy/year gates, local+relay receipts, and single-patient honest partial');
})().catch(error => {
  console.error('FAIL full-visit-notes-choice-gates-runtime:', error && error.stack || error);
  process.exitCode = 1;
});
