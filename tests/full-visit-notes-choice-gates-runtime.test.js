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
const SCHED = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');

/* Mirror of the day engine's own `safe(fn, d)` (1p-feat_mls_schedimport_exact.js:214).
   The default is returned ONLY on a throw - a closure that returns undefined
   yields undefined, which is exactly how the shipped gates read. */
function engineSafe(fn, d) { try { return fn(); } catch (e) { return d; } }

/* The one resolver's read() shape, as every choice gate consumes it.
   state: 'on' | 'off' | 'unset'; settled marks a real account namespace. */
function choiceStub(state, settled) {
  return { read: function () { return { state: state, on: state === 'on', settled: settled !== false }; } };
}

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

/* dayfacts-1.0.1: runForPatient is THE door every pulled-day encounter note
 * goes through - the inline fold-in and the tail pass both reach it via
 * tnBoundedRead, and the idle backfill reaches it via niReadOnce.  Under the
 * superseding DAY contract a SETTLED OFF account is day-facts mode, and its
 * exact-day scoped read is MANDATORY, not merely tolerated.  This harness
 * COUNTS the reads and inspects the opts that reach the reader, so a door that
 * silently stopped opening (or one that swung too wide) both fail here. */
function runForPatientHarness() {
  const run = balancedFunction(CONNECT, 'api.runForPatient = function (p, onStatus, runOpts)', 'single-patient runner');
  const reads = [];
  const win = {
    __mlsVisitNotesPref: null,
    __mlsCopyVisits: {
      run(onStatus, patient, opts) { reads.push({ patient: patient, opts: opts || null }); return Promise.resolve(0); }
    }
  };
  const ctx = vm.createContext({
    api: { running: false, current: null },
    /* the shipped enabled(): ONLY an explicit stored ON opens unscoped bodies */
    enabled: function () {
      try {
        const vnp = win.__mlsVisitNotesPref;
        const c = vnp && typeof vnp.read === 'function' ? vnp.read() : null;
        return !!(c && c.state === 'on' && c.on === true);
      } catch (e) { return false; }
    },
    window: win, Promise, Error, String, RegExp
  });
  vm.runInContext(run + '\nthis.__runForPatient = api.runForPatient;', ctx);
  return {
    reads,
    setChoice(state, settled) { win.__mlsVisitNotesPref = choiceStub(state, settled); },
    clearChoice() { win.__mlsVisitNotesPref = null; },
    run(runOpts) { return ctx.__runForPatient({ id: 'p1', name: 'Synthetic Patient' }, null, runOpts); }
  };
}

async function dayFactsAdmissionCases() {
  const h = runForPatientHarness();
  const DAY = '2026-08-22';

  /* --- settled OFF = day-facts mode ------------------------------------- */
  h.setChoice('off', true);
  const unscopedOff = await h.run({});
  assert.strictEqual(unscopedOff.ok, true, 'day-facts unscoped read did not return an explicit result');
  assert.strictEqual(unscopedOff.skipped, 'preference-off',
    'day-facts mode must still refuse UNSCOPED historical bodies with preference-off');
  assert.strictEqual(h.reads.length, 0, 'day-facts mode opened an unscoped historical body read');

  const scopedOff = await h.run({ onlyDate: DAY });
  assert.strictEqual(scopedOff.ok, true, 'the mandatory pulled-day note read was refused in day-facts mode');
  assert.strictEqual(scopedOff.skipped, undefined,
    'the pulled-day (onlyDate) note is MANDATORY under the day contract - day-facts must not skip it');
  assert.strictEqual(scopedOff.visits, 0, 'pulled-day note read lost the reader result');
  assert.strictEqual(h.reads.length, 1, 'day-facts mode did not run exactly one pulled-day note read');
  assert.strictEqual(h.reads[0].opts && h.reads[0].opts.onlyDate, DAY,
    'the onlyDate scope did not reach the visit-note reader - an unscoped reader returns EVERY body');

  /* The door is a DATE door, not an "any truthy onlyDate" door: a malformed
     scope must fail closed rather than widen day-facts into a full crawl. */
  const malformed = ['2026-8-2', 'today', '2026-08-22T09:00', '', '2026-08-2', true];
  for (const bad of malformed) {
    const before = h.reads.length;
    const r = await h.run({ onlyDate: bad });
    assert.strictEqual(r.skipped, 'preference-off',
      'a malformed onlyDate (' + JSON.stringify(bad) + ') widened the day-facts door into an unscoped read');
    assert.strictEqual(h.reads.length, before,
      'a malformed onlyDate (' + JSON.stringify(bad) + ') reached the visit-note reader');
  }

  /* --- unchosen / unsettled stays fail-closed --------------------------- */
  /* NOTE: {state:'on', settled:false} is deliberately absent - see the KNOWN
     ENGINE GAP block at the foot of this file.  The shipped enabled() ignores
     `settled`, so that shape opens the UNSCOPED door and is not fail-closed
     today.  It is reported, not asserted. */
  const closed = [
    ['off', false, 'an UNSETTLED account namespace'],
    ['unset', true, 'an account that never made the choice']
  ];
  for (const [state, settled, label] of closed) {
    h.setChoice(state, settled);
    const before = h.reads.length;
    const scoped = await h.run({ onlyDate: DAY });
    assert.strictEqual(scoped.ok, true, label + ': refusal was not an explicit result');
    assert.strictEqual(scoped.skipped, 'preference-unchosen',
      label + ' had a chart opened for the pulled-day note - first-use admission owns asking');
    assert.strictEqual(h.reads.length, before, label + ': the visit-note reader ran anyway');
  }
  h.clearChoice();
  const noResolver = await h.run({ onlyDate: DAY });
  assert.strictEqual(noResolver.skipped, 'preference-unchosen',
    'a missing resolver did not fail closed at the pulled-day door');

  /* --- explicit ON is the only unscoped door ---------------------------- */
  h.setChoice('on', true);
  const before = h.reads.length;
  const onScoped = await h.run({ onlyDate: DAY });
  assert.strictEqual(onScoped.skipped, undefined, 'ON refused the pulled-day note read');
  assert.strictEqual(h.reads.length, before + 1, 'ON did not run the pulled-day note read exactly once');
  const onUnscoped = await h.run({ singlePull: true });
  assert.strictEqual(onUnscoped.ok, true, 'single-patient request did not run with Full Notes ON');
  assert.strictEqual(onUnscoped.visits, 0, 'single-patient ON request changed the reader result');
  assert.strictEqual(h.reads.length, before + 2, 'ON did not run the unscoped read exactly once');
  assert.strictEqual(h.reads[h.reads.length - 1].opts.singlePull, true,
    'single-patient option did not reach the visit-note reader');
}

async function singlePatientCases() {
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

  /* spv-1.2: an OFF single pull is an intentional SCOPE choice, not a failed
     history read.  It must stay green, must NOT paint the red "no visit notes"
     warning, and must NOT start a backfill the same preference cannot finish. */
  spvCtx.window.__mlsSinglePullVisits = null;
  spvCtx.api.runForPatient = () => Promise.resolve({ ok: true, skipped: 'preference-off' });
  const offReceipt = await spvCtx.__spv(patient, patient);
  assert.strictEqual(offReceipt.ok, true, 'an intentionally scoped OFF single pull was reported as a failure');
  assert.strictEqual(offReceipt.added, 0, 'OFF single pull invented an added visit');
  assert.strictEqual(offReceipt.queued, false, 'OFF single pull queued a retry its own preference cannot complete');
  assert.strictEqual(queued, 1, 'OFF single pull enqueued a backfill run');
  assert(!/NO prior visit notes came back/i.test(offReceipt.message),
    'OFF single pull painted the red missing-history warning over a deliberate scope choice');

  /* An UNCHOSEN account reaches the same leg with a different skip token.  It
     must not be silently laundered into the OFF scope message - the honest
     partial receipt is the correct outcome until the choice is made. */
  spvCtx.window.__mlsSinglePullVisits = null;
  spvCtx.api.runForPatient = () => Promise.resolve({ ok: true, skipped: 'preference-unchosen', reason: 'preference-unchosen' });
  const unchosenReceipt = await spvCtx.__spv(patient, patient);
  assert.strictEqual(unchosenReceipt.ok, false, 'an unchosen single pull claimed a successful visit leg');
  assert.notStrictEqual(unchosenReceipt.reason, 'visit-notes-off',
    'an unchosen account was reported as an explicit OFF scope choice');
}

/* ===== dayfacts-1.0.1 — the pulled-day note is MANDATORY in BOTH modes =====
 * The superseding DAY contract revoked schedule-only OFF.  A settled-OFF day
 * pull now opens every exact scheduled row's chart, saves its facts, and
 * attempts exactly the pulled-day encounter note through the onlyDate lane.
 * These pins are adversarial in the direction that matters: they fail if a
 * lane is re-fused OFF, if the onlyDate scope is dropped (an unscoped reader
 * returns EVERY body), or if the revoked "visit-notes-off" schedule-only
 * vocabulary comes back. */
function dayFactsEngineLaneCases() {
  /* Both lanes must be live, and neither may be re-disabled anywhere. */
  assert(/var pulledDayNoteLaneEnabled = true;/.test(SCHED),
    'the inline day-facts fold-in lane is no longer enabled');
  assert(/var pulledDayNoteTailEnabled = true;/.test(SCHED),
    'the tn/onlyDate tail pass is no longer enabled');
  assert(!/pulledDayNoteLaneEnabled\s*=\s*false/.test(SCHED),
    'the inline day-facts fold-in lane is re-fused OFF somewhere');
  assert(!/pulledDayNoteTailEnabled\s*=\s*false/.test(SCHED),
    'the tn/onlyDate tail pass is re-fused OFF somewhere');

  /* Both lanes select precisely the OFF (visitsSkipped) rows - ON rows get
     their bodies from the full traversal instead. */
  assert(/if \(pulledDayNoteLaneEnabled && !stopAfterTimeout && pullVisitBodies !== true && one\.visitsSkipped === true && rd && !inlineDayNoteFuse\)/.test(SCHED),
    'the inline fold-in no longer runs for day-facts (pullVisitBodies !== true) rows');
  assert(/if \(pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped\)/.test(SCHED),
    'the tail pass no longer runs for day-facts (pullVisitBodies !== true) rows');

  /* Every pulled-day read is exact-day scoped through runForPatient. */
  assert(SCHED.includes('vp.runForPatient(p, function () {}, { onlyDate: String(day) })'),
    'the bounded pulled-day read no longer scopes runForPatient with onlyDate');
  assert(SCHED.includes('vp.runForPatient(p, function () {}, { onlyDate: String(row.d) })'),
    'the idle-notes backfill read no longer scopes runForPatient with onlyDate');

  /* The revoked schedule-only vocabulary must not decide anything again. */
  const batch = blockBetween(SCHED,
    '    var chartFactsRequired = true;', '      receipt.todayNoteReasonCodes = {};', 'day-facts batch receipt');
  assert(/visitNotesMode: visitNotesRequested \? "full" : "day-facts"/.test(batch),
    'the batch receipt no longer reports day-facts as the OFF mode');
  assert(/chartFactsRequired: chartFactsRequired/.test(batch) && /allVisitBodiesRequested: allVisitBodiesRequested/.test(batch),
    'the batch receipt lost the mandatory-floor / checkbox split');
  assert(/insuranceAttempted: 0/.test(batch) && /insuranceReason: "reader-not-shipped"/.test(batch),
    'the batch receipt no longer declares insurance honestly as not-yet-attempted');
  assert(/receipt\.reason = "visit-notes-unchosen"/.test(batch) && /receipt\.visitNotesMode = "blocked-unchosen"/.test(batch),
    'the blocked-unchosen door lost its reason/mode vocabulary');
  assert(/receipt\.todayNoteNotRequested = receipt\.notRequestedRows/.test(batch),
    'the blocked-unchosen door is no longer the source of todayNoteNotRequested');

  /* 'full-notes-off' was the retry lane's wholesale OFF refusal reason. */
  assert(!/["']full-notes-off["']/.test(SCHED),
    'the retry lane still carries the revoked full-notes-off refusal reason');
  assert(/retryBodiesRequested/.test(SCHED),
    'the OFF retry lane lost the frozen per-receipt mode scoping');

  /* The Calendar door must not AND the checkbox back into includeHistory. */
  assert(/var includeHistory = opts\.includeHistory !== false; \/\* dayfacts-1\.0\.1: the Calendar door/.test(SCHED),
    'the Calendar door re-coupled the Full-visit-notes checkbox into includeHistory');

  /* One envelope vocabulary at every level: OFF is 'day-facts', never
     'not-requested'. */
  const modes = SCHED.match(/visitNotesMode: [^,\n]+/g) || [];
  assert(modes.length >= 4, 'the visitNotesMode envelope disappeared from the day engine');
  modes.forEach(function (m) {
    assert(!/["']not-requested["']/.test(m),
      'an OFF pull can still report visitNotesMode "not-requested": ' + m.trim());
  });
  ['fullNotesOff ? "day-facts"', 'monthFullNotesOff ? "day-facts"'].forEach(function (needle) {
    assert(SCHED.includes(needle), 'OFF no longer maps to day-facts at every envelope level: ' + needle);
  });
}

/* tnAggregate is the day's ONE today-note census.  Its checkbox short-circuit
 * ("OFF is a deliberate scope choice, not an unread note") is revoked: the real
 * per-row tally must run identically in both modes, and todayNoteNotRequested
 * may only be non-zero through the blocked-unchosen door. */
function todayNoteCensusCases() {
  const agg = balancedFunction(SCHED, 'function tnAggregate()', 'today-note census');
  function census(visitNotesRequested) {
    const receipt = {
      visitNotesRequested: visitNotesRequested,
      visitNotesMode: visitNotesRequested ? 'full' : 'day-facts',
      todayNoteNotRequested: 99, /* a stale value the census must overwrite */
      patients: [
        { patientId: 'a', todayNote: true },
        { patientId: 'b', todayNote: 'already-read' },
        { patientId: 'c', todayNote: false, todayNoteReason: 'pull-in-flight', todayNoteDeferred: true },
        { patientId: 'd', todayNote: false, todayNoteReason: 'scoped-read-unverified' },
        { patientId: 'e', todayNote: 'not-yet' },
        { patientId: 'f', todayNote: 'future-day' },
        { patientId: 'g', todayNote: null }
      ]
    };
    const ctx = vm.createContext({
      receipt: receipt,
      tnReasonCode: r => 'code:' + String(r || 'unknown'),
      String, Math, Number, Object
    });
    vm.runInContext(agg + '\nthis.__agg = tnAggregate;', ctx, { filename: 'today-note-census' });
    return { summary: ctx.__agg(), receipt: receipt };
  }

  const off = census(false), on = census(true);
  assert.strictEqual(off.receipt.todayNoteNotRequested, 0,
    'day-facts rows are still reported as "note not requested" - the checkbox short-circuit is back');
  assert.strictEqual(off.summary.read, 2, 'day-facts census did not count the rows whose pulled-day note WAS read');
  assert.strictEqual(off.summary.failed, 2, 'day-facts census did not count the unread pulled-day notes');
  assert.strictEqual(off.summary.queued, 1, 'day-facts census did not separate the deferred row from the failures');
  assert.strictEqual(off.summary.unreadFinal, 1, 'day-facts census miscounted the finally-unread notes');
  assert.strictEqual(off.summary.notYet, 1, 'day-facts census turned a not-yet slot into a failure');
  assert.strictEqual(off.summary.future, 1, 'day-facts census turned a future day into a failure');
  assert.strictEqual(off.summary.alreadyRead, 1, 'day-facts census lost the already-read row');
  assert.strictEqual(off.receipt.todayNoteReasons['pull-in-flight'], 1, 'day-facts census dropped a per-row reason');
  assert.strictEqual(off.receipt.todayNoteReasons['scoped-read-unverified'], 1, 'day-facts census dropped a per-row reason');
  assert.deepStrictEqual(
    { r: off.summary.read, f: off.summary.failed, q: off.summary.queued, n: off.summary.notYet, u: off.summary.unreadFinal },
    { r: on.summary.read, f: on.summary.failed, q: on.summary.queued, n: on.summary.notYet, u: on.summary.unreadFinal },
    'the today-note census still tallies day-facts rows differently from full-notes rows');
  assert.strictEqual(on.receipt.todayNoteNotRequested, 0, 'a full-notes census invented not-requested rows');
}

/* The idle-notes backfill drains PULLED-DAY notes, which are mandatory in both
 * settled modes.  Only an account that never made the choice may close it. */
function notesIdleGateCases() {
  const gate = balancedFunction(SCHED, 'function niGate(force)', 'idle-notes gate');
  function gateCtx(pref, over) {
    const base = {
      niLoad() {}, _ni: { stopped: false, reading: false, rows: [{ s: 'queued' }], lastActivityAt: 0 },
      safe: engineSafe, isFn: v => typeof v === 'function',
      window: { __mlsVisitNotesPref: pref },
      niNextRow: () => ({ s: 'queued' }), niIdleMs: () => 10 * 60 * 1000, NI_IDLE_MS: 20000,
      pullRunning: false, tnAthenaFree: () => true,
      document: { getElementById: () => null },
      _tnDefer: { running: false, queue: [] }, resumeBusyElsewhere: () => false,
      Date, Number, String
    };
    Object.assign(base, over || {});
    const ctx = vm.createContext(base);
    vm.runInContext(gate + '\nthis.__gate = niGate;', ctx, { filename: 'idle-notes-gate' });
    return ctx;
  }

  const offGate = gateCtx(choiceStub('off', true)).__gate(false);
  assert.strictEqual(offGate.open, true,
    'the idle-notes backfill is still closed for a settled-OFF account - day-facts notes would never drain (reason: ' + offGate.reason + ')');
  assert.strictEqual(gateCtx(choiceStub('on', true)).__gate(false).open, true,
    'the idle-notes backfill is closed for a settled-ON account');

  [[choiceStub('unset', true), 'an account that never chose'],
   [choiceStub('off', false), 'an UNSETTLED namespace holding OFF'],
   [choiceStub('on', false), 'an UNSETTLED namespace holding ON'],
   [null, 'a missing resolver'],
   [{ read() { throw new Error('resolver exploded'); } }, 'a throwing resolver']
  ].forEach(function (pair) {
    const g = gateCtx(pair[0]).__gate(true);
    assert.strictEqual(g.open, false, pair[1] + ' opened the idle-notes backfill');
    assert.strictEqual(g.reason, 'visit-notes-unchosen',
      pair[1] + ' was refused with the wrong vocabulary: ' + g.reason);
  });

  /* `force` (the Read now button) waives idleness and backoff, NOTHING else. */
  assert.strictEqual(gateCtx(choiceStub('unset', true)).__gate(true).reason, 'visit-notes-unchosen',
    'the Read now button forced past the unchosen-preference refusal');
  assert.strictEqual(gateCtx(choiceStub('off', true), { _ni: { stopped: true, reading: false, rows: [], lastActivityAt: 0 } }).__gate(true).reason, 'stopped',
    'a stopped idle lane was re-opened by the day-facts admission');
  assert.strictEqual(gateCtx(choiceStub('off', true), { pullRunning: true }).__gate(true).reason, 'pull-running',
    'day-facts admission let the idle lane drive Athena while a pull was running');
  assert.strictEqual(gateCtx(choiceStub('off', true), { _ni: { stopped: false, reading: true, rows: [], lastActivityAt: 0 } }).__gate(true).reason, 'reading',
    'day-facts admission let a second idle read start while one was in flight');
}

/* dayfacts-1.0.1 in 1p-mls-connect.js: OFF is no longer an "intentionally
 * skipped history", and the legacy full-crawl helper refuses HISTORICAL bodies
 * only - it may never claim that OFF opens no charts. */
function connectDayFactsVocabularyCases() {
  const mapper = blockBetween(CONNECT,
    '      var historyIntentionallySkipped = hr.skipped === true ||', '      var recon = pullReconLine(r);', 'day completion mapper');
  assert(!/visitNotesRequested/.test(mapper.split('var histLine')[0]),
    'the day-completion mapper still treats visitNotesRequested === false as an intentionally-skipped history');
  /* the shipped string escapes its apostrophe as ’ in source */
  assert(CONNECT.includes('Historical visit notes were skipped by choice (Full visit notes is off); chart facts and each day\\u2019s own note were read.'),
    'the OFF day-completion message no longer reports the chart-facts and own-day-note work that did happen');
  assert(/pulled-day note/.test(CONNECT), 'the day-completion message lost its unread pulled-day note account');

  const legacy = blockBetween(CONNECT,
    '        /* dayfacts-1.0.1: this legacy helper does exactly one thing - the FULL',
    '        return (function run(list, isRetry) {', 'legacy full-crawl helper');
  assert(/reason: 'historical-bodies-not-requested'/.test(legacy),
    'the legacy full-crawl helper no longer scopes its refusal to HISTORICAL bodies');
  assert(!/visit-notes-off/.test(legacy),
    'the legacy full-crawl helper still carries the revoked visit-notes-off vocabulary');
  assert(!/no patient charts were opened/i.test(legacy),
    'the legacy full-crawl helper still claims OFF opens no charts - the guarded day-facts pull opens every one');
  assert(/did not crawl historical encounter bodies/.test(legacy),
    'the legacy full-crawl refusal no longer states what it actually declined');
}

/* vnoff-1.0.0: the retired hero body in ScribeFlow's pullScheduleViaAssist is
 * the ONLY path on a build with no guarded engine.  It used to crawl every
 * chart's history unconditionally — an explicitly admitted OFF choice still
 * opened patient charts on that one path.  The admission gate freezes the
 * choice into opts.__pullVisitBodies; the legacy body must honor it, and a
 * missing flag must fail closed to schedule-only. */
function legacyHeroCase() {
  const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
  const hero = balancedFunction(SHELL, 'function pullScheduleViaAssist(btn, opts)', 'legacy hero');
  assert(hero.includes('next.__pullVisitBodies=choice.on===true'),
    'the admission gate no longer freezes the confirmed choice for the legacy body');
  const calls = hero.split('_pullAllHistories(appts)').length - 1;
  assert.strictEqual(calls, 1, 'legacy hero grew a second history-crawl call site');
  const importAt = hero.indexOf('_importPulledSchedule(appts)');
  const gateAt = hero.indexOf('if(opts.__pullVisitBodies===true){');
  const crawlAt = hero.indexOf('_pullAllHistories(appts)');
  assert(importAt >= 0 && gateAt > importAt && crawlAt > gateAt,
    'legacy hero crawls histories regardless of the admitted OFF choice (the __pullVisitBodies===true gate is missing or does not guard the crawl)');
  assert(/through the legacy reader — this fallback cannot read chart facts or day notes/.test(hero),
    'legacy hero OFF completion states its own limitation honestly (dayfacts-1.0.1: the fallback cannot do the mandatory floor, and must say so instead of describing OFF as chartless)');
}

/* ===== KNOWN ENGINE GAP (reported, deliberately NOT asserted here) =========
 * dayfacts-1.0.1 opened niGate for a settled-OFF account, but the two feeds
 * that fill the retry queues it drains are still hard-gated on the checkbox:
 *   1p-feat_mls_schedimport_exact.js:5873  tnDeferRow      -> receipt.visitNotesRequested !== true -> return false
 *   1p-feat_mls_schedimport_exact.js:7064  niSyncFromReceipt -> receipt.visitNotesRequested !== true -> return 0
 * Those are the ONLY call sites that enqueue into _tnDefer and _ni, so in
 * day-facts mode (receipt.visitNotesRequested === false) a pulled-day note that
 * failed with a deferrable reason is stranded outside BOTH queues - the exact
 * nih-1.0.0 defect class, now reintroduced for the whole OFF mode.  Asserting
 * the intended behaviour here would be a red suite against unshipped bytes, so
 * it goes back as a finding instead.  Delete this block and add the pins the
 * moment those two guards learn about day-facts. */

(async () => {
  await resolverCases();
  staticGateCases();
  legacyHeroCase();
  slowYearChoiceCase();
  receiptCases();
  await dayFactsAdmissionCases();
  dayFactsEngineLaneCases();
  todayNoteCensusCases();
  notesIdleGateCases();
  connectDayFactsVocabularyCases();
  await singlePatientCases();
  console.log('PASS full-visit-notes-choice-gates-runtime: resolver first-use cases, day/calendar/legacy/year gates, legacy-hero OFF stays schedule-only, local+relay receipts, day-facts onlyDate admission (counted), today-note census in both modes, idle-notes gate vocabulary, connect day-facts wording, and single-patient honest partial');
})().catch(error => {
  console.error('FAIL full-visit-notes-choice-gates-runtime:', error && error.stack || error);
  process.exitCode = 1;
});
