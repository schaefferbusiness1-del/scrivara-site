'use strict';

/*
 * FIRST-LOGIN FULL-VISIT-NOTES CHOICE
 * ===================================
 * A new hosted account must finish the server-owned legal/setup hand-off before
 * it is asked whether a bulk pull should include full encounter bodies.  This
 * suite is intentionally PHI-free: source checks pin the startup ordering and
 * the runtime half executes the shipped preference resolver against synthetic
 * account storage.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = [
  '1pScribeFlow.html',
  path.join('1p', 'index.html')
].map(name => ({ name, source: fs.readFileSync(path.join(ROOT, name), 'utf8') }));
const CONNECT = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');

let assertions = 0;
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function eq(actual, expected, message) { assert.deepStrictEqual(actual, expected, message); assertions += 1; }

function balancedFunction(source, marker, label) {
  const at = source.indexOf(marker);
  ok(at >= 0, label + ': function marker is present');
  const open = source.indexOf('{', at);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1] || '';
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i += 1; continue; }
    if (ch === '/' && next === '*') { block = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(label + ': function is not balanced');
}

function resolverSource() {
  const start = CONNECT.indexOf('(function () {\n  if (window.__mlsVisitNotesPref) return;');
  const endMarker = '  window.__mlsVisitNotesPref = api;\n})();';
  const end = CONNECT.indexOf(endMarker, start);
  ok(start >= 0 && end > start, 'canonical resolver bounds are present');
  return CONNECT.slice(start, end + endMarker.length);
}

function makeResolver(answer, options) {
  options = options || {};
  const data = new Map(Object.entries(options.seed || {}));
  const writes = [];
  const namespace = options.namespace || 'sf_u::new-doctor@example.test::';
  const storage = {
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
    setItem(key, value) { writes.push([String(key), String(value)]); data.set(String(key), String(value)); },
    removeItem(key) { data.delete(String(key)); }
  };
  let promptCalls = 0;
  const win = {
    uns: key => namespace + key,
    addEventListener() {},
    dispatchEvent() { return true; },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    _mlsVisitNotesChoice() { promptCalls += 1; return answer; }
  };
  const context = vm.createContext({
    window: win,
    localStorage: storage,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    CustomEvent: win.CustomEvent,
    console
  });
  vm.runInContext(resolverSource(), context, { filename: 'mls-connect:visit-notes-resolver' });
  return { api: win.__mlsVisitNotesPref, data, writes, promptCalls: () => promptCalls };
}

function startupContract() {
  SHELLS.forEach(({ name, source }) => {
    const startup = balancedFunction(source, 'function startSession(email)', name + ' startSession');
    const gate = startup.indexOf('const _gateCheck=');
    const setup = startup.indexOf('agAccountSetupSurface');
    const reveal = startup.indexOf('sfHideGateLoading');
    const completion = startup.indexOf('const _sessionCompletion=');
    const choice = startup.indexOf('sfQueueFirstVisitNotesChoice(');
    ok(gate >= 0, name + ': hosted first-login startup owns a legal gate decision');
    ok(setup > gate, name + ': setup surface is evaluated after the legal gate decision');
    ok(reveal > setup, name + ': legal/setup hand-off settles before the startup reveal');
    ok(completion > reveal, name + ': startup completion promise follows the legal/setup reveal');
    ok(choice > completion, name + ': full-visit-notes choice is queued only after startup completion is owned');
    eq((startup.match(/sfQueueFirstVisitNotesChoice\(/g) || []).length, 2,
      name + ': startup has one initial choice call and one controlled late-bundle retry call');
    ok(startup.includes('retryFirstVisitChoice') && startup.includes('sfVisitNotesFirstChoicePending=true'),
      name + ': a synchronous late-bundle race remains pending and retries under the same account owner');
    ok(startup.slice(completion, choice).includes('_sessionReady') &&
       startup.slice(completion, choice).includes('_bundleReadyPromise'),
       name + ': choice coordinator receives the settled startup promise');

    const coordinator = balancedFunction(source, 'function sfQueueFirstVisitNotesChoice(', name + ' choice coordinator');
    eq((coordinator.match(/pref\.ensureChosenForBulkPull\(/g) || []).length, 1,
      name + ': coordinator delegates persistence to the one preference resolver');
    ok(coordinator.includes("document.getElementById('setupModal')") && coordinator.includes('setupOwns'),
      name + ': choice waits while the first-login setup modal owns the screen');
    ok(coordinator.includes('return valid()?answer:null'),
      name + ': an account/session switch turns an old dialog answer into cancellation');

    const cancel = balancedFunction(source, 'function sfCancelSessionPrompts(', name + ' prompt cancellation');
    ok(cancel.includes('sfVisitNotesFirstChoiceRun++') && cancel.includes('sfVisitNotesFirstChoicePending=false'),
      name + ': session boundary invalidates the first-login choice runner');
    ok(cancel.includes('oldAsk.finish(oldAsk.cancelValue)'),
      name + ': session boundary resolves any old-account ask dialog as cancelled');
  });

  SHELLS.forEach(({ name, source }) => {
    const dialog = balancedFunction(source, 'function _mlsVisitNotesChoice()', name + ' choice dialog');
    ok(dialog.includes('Include full visit notes'), name + ': choice dialog offers Full visit notes');
    ok(dialog.includes('Use faster schedule-only pulls'), name + ': choice dialog offers schedule-only Faster pull');
    ok(dialog.includes('Choose later — Athena pulls stay blocked'), name + ': dialog explains that cancellation keeps pulls blocked');
    ok(dialog.includes('full.onclick=function(){ finish(true); }') &&
       dialog.includes('fast.onclick=function(){ finish(false); }') &&
       dialog.includes('cancel.onclick=function(){ finish(null); }'),
      name + ': dialog has explicit Full, Faster, and cancel outcomes');
    ok(dialog.includes('cancelValue:null'), name + ': Escape/backdrop preserve the unset fail-closed state');
  });
}

async function runtimeCases() {
  /* Synthetic post-setup admission: this is the one caller that may launch a
     bulk pull. The resolver is the shipped code; only the Athena pull itself is
     a stub, so cancellation can prove that no bulk work starts. */
  async function firstLoginAfterSetup(answer) {
    const h = makeResolver(answer);
    const pulls = [];
    const first = await h.api.ensureChosenForBulkPull();
    if (first.ok === true) pulls.push({ pullVisitBodies: first.on });
    return { h, first, pulls };
  }

  let r = await firstLoginAfterSetup(null);
  eq(r.h.promptCalls(), 1, 'cancellation opens exactly one first-login choice');
  eq(r.first.reason, 'choice-cancelled', 'cancellation is an explicit refusal');
  eq(r.h.api.read().state, 'unset', 'cancellation leaves the preference unset');
  eq(r.pulls.length, 0, 'cancellation prevents the bulk pull from starting');

  r = await firstLoginAfterSetup(true);
  eq(r.h.promptCalls(), 1, 'ON choice prompts once');
  eq(r.first.on, true, 'ON choice is returned as true');
  eq(r.h.api.read().state, 'on', 'ON choice persists in the account namespace');
  eq(r.pulls, [{ pullVisitBodies: true }], 'ON choice admits one full-notes bulk pull');
  const onAgain = await r.h.api.ensureChosenForBulkPull();
  eq(onAgain.reason, 'already-chosen', 'persisted ON choice does not prompt again');
  eq(r.h.promptCalls(), 1, 'persisted ON choice remains one-prompt');

  r = await firstLoginAfterSetup(false);
  eq(r.h.promptCalls(), 1, 'OFF choice prompts once');
  eq(r.first.on, false, 'OFF choice is returned as false');
  eq(r.h.api.read().state, 'off', 'OFF choice persists in the account namespace');
  eq(r.pulls, [{ pullVisitBodies: false }], 'OFF choice admits one faster chart-history pull');
  const offAgain = await r.h.api.ensureChosenForBulkPull();
  eq(offAgain.reason, 'already-chosen', 'persisted OFF choice does not prompt again');
  eq(r.h.promptCalls(), 1, 'persisted OFF choice remains one-prompt');

  /* Two startup/bulk listeners settling together must share one dialog Promise. */
  let calls = 0;
  const shared = makeResolver(false);
  shared.api.ensureChosenForBulkPull = (() => {
    const original = shared.api.ensureChosenForBulkPull;
    return function () {
      calls += 1;
      return original.call(shared.api);
    };
  })();
  const answers = await Promise.all([
    shared.api.ensureChosenForBulkPull(),
    shared.api.ensureChosenForBulkPull()
  ]);
  eq(calls, 2, 'two callers may enter the resolver but share one in-flight prompt');
  eq(answers[0].on, false, 'shared first caller receives OFF');
  eq(answers[1].on, false, 'shared second caller receives OFF');
  eq(shared.promptCalls(), 1, 'shared callers opened exactly one UI prompt');
}

function makeCoordinatorHarness(options) {
  options = options || {};
  const source = balancedFunction(SHELLS[0].source,
    'function sfQueueFirstVisitNotesChoice(', 'runtime choice coordinator');
  const state = {
    valid: true,
    hidden: !!options.hidden,
    resumed: 0,
    warnings: [],
    ensureCalls: 0,
    choiceError: options.choiceError || null,
    answer: Object.prototype.hasOwnProperty.call(options, 'answer') ? options.answer : null,
    pref: options.pref || null
  };
  let nextTimer = 1;
  const timers = [];
  function setTimer(fn, ms) {
    const timer = { id: nextTimer++, fn, ms, cancelled: false };
    timers.push(timer);
    return timer.id;
  }
  function clearTimer(id) {
    const timer = timers.find(item => item.id === id);
    if (timer) timer.cancelled = true;
  }
  const elements = {
    appScreen: { style: { display: 'block' } },
    agreementsGate: { style: { display: 'none' } },
    invitePasswordModal: { style: { display: 'none' }, classList: { contains() { return false; } } },
    setupModal: { style: { display: 'none' } }
  };
  const document = {
    documentElement: { classList: { contains() { return false; } } },
    get hidden() { return state.hidden; },
    getElementById(id) { return elements[id] || null; }
  };
  const win = {};
  Object.defineProperty(win, '__mlsVisitNotesPref', {
    configurable: true,
    get() { return state.pref; },
    set(value) { state.pref = value; }
  });
  const context = vm.createContext({
    window: win,
    document,
    Promise,
    Date,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    getComputedStyle(el) { return { display: el && el.style && el.style.display || 'none' }; },
    backendMode() { return false; },
    agAccountSetupSurface() { return false; },
    sfSessionLegalState: 'verified',
    sfVisitNotesFirstChoiceRun: 0,
    sfVisitNotesFirstChoiceTimer: 0,
    sfVisitNotesFirstChoicePending: false,
    sfSessionPromptValid() { return state.valid; },
    sfResumePostLoginPrompts() { state.resumed += 1; },
    _mlsAskActive: false,
    _mlsVisitNotesChoice() { return state.choiceError ? Promise.reject(state.choiceError) : Promise.resolve(state.answer); },
    toast(message, kind) { state.warnings.push({ message: String(message), kind: String(kind || '') }); },
    console
  });
  vm.runInContext(source, context, { filename: 'first-login-choice-coordinator' });

  async function flush() {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  }
  async function start() {
    context.sfQueueFirstVisitNotesChoice(1, 'account-a', Promise.resolve());
    await flush();
  }
  async function runNext() {
    let timer = null;
    while (timers.length && !timer) {
      const candidate = timers.shift();
      if (!candidate.cancelled) timer = candidate;
    }
    if (!timer) return false;
    timer.fn();
    await flush();
    return true;
  }
  async function run(count) {
    for (let i = 0; i < count; i += 1) {
      if (!await runNext()) break;
    }
  }
  return { context, state, timers, start, run, runNext, flush };
}

async function coordinatorRuntimeCases() {
  let h = makeCoordinatorHarness();
  await h.start();
  await h.run(170);
  eq(h.context.sfVisitNotesFirstChoicePending, true,
    'missing late bundle remains visibly/prompt-pending after the old retry limit');
  eq(h.state.resumed, 0,
    'missing late bundle never resumes post-login prompts without an explicit choice');
  ok(h.state.warnings.length >= 1,
    'missing late bundle produces an actionable warning instead of silently disappearing');
  eq(h.state.warnings.length, 1,
    'late-bundle retry warning is emitted once per unresolved coordinator episode');
  h.state.pref = {
    read() { return { settled: true, state: 'unset' }; },
    ensureChosenForBulkPull() {
      h.state.ensureCalls += 1;
      return Promise.resolve({ ok: false, reason: 'choice-cancelled' });
    }
  };
  await h.runNext();
  eq(h.state.ensureCalls, 1, 'a late preference bundle is admitted without a page restart');
  eq(h.context.sfVisitNotesFirstChoicePending, false,
    'explicit Choose later settles only the UI coordinator');
  eq(h.state.resumed, 1,
    'explicit Choose later may resume other onboarding while pull admission stays unset');

  h = makeCoordinatorHarness({
    pref: {
      read() { return { settled: true, state: 'unset' }; },
      ensureChosenForBulkPull() { return Promise.reject(new Error('synthetic resolver failure')); }
    }
  });
  await h.start();
  eq(h.context.sfVisitNotesFirstChoicePending, true,
    'resolver rejection keeps the choice coordinator pending');
  eq(h.state.resumed, 0, 'resolver rejection never resumes post-login prompts');
  ok(h.state.warnings.length >= 1, 'resolver rejection gives an actionable blocked warning');
  h.state.pref = {
    read() { return { settled: true, state: 'off' }; },
    ensureChosenForBulkPull() { throw new Error('persisted choice must not prompt'); }
  };
  await h.runNext();
  eq(h.context.sfVisitNotesFirstChoicePending, false,
    'a later persisted choice settles the previously rejected coordinator');
  eq(h.state.resumed, 1, 'a later persisted choice resumes post-login prompts exactly once');

  h = makeCoordinatorHarness({
    pref: {
      read() { return { settled: true, state: 'unset' }; },
      ensureChosenForBulkPull() { throw new Error('synthetic synchronous resolver failure'); }
    }
  });
  await h.start();
  eq(h.context.sfVisitNotesFirstChoicePending, true,
    'a synchronous resolver throw remains pending instead of wedging without a timer');
  eq(h.state.resumed, 0, 'a synchronous resolver throw does not resume post-login prompts');
  eq(h.state.warnings.length, 1, 'a synchronous resolver throw produces one actionable warning');
  ok(h.timers.some(timer => !timer.cancelled), 'a synchronous resolver throw schedules a retry');

  h = makeCoordinatorHarness({
    choiceError: new Error('synthetic dialog render failure')
  });
  h.state.pref = {
    read() { return { settled: true, state: 'unset' }; },
    ensureChosenForBulkPull(opts) {
      return Promise.resolve().then(() => opts.choose()).then(
        answer => ({ ok: false, reason: answer == null ? 'choice-cancelled' : 'unexpected-answer' }),
        () => ({ ok: false, reason: 'choice-dialog-failed' })
      );
    }
  };
  await h.start();
  eq(h.context.sfVisitNotesFirstChoicePending, true,
    'dialog render/rejection failure is not misclassified as explicit Choose later');
  eq(h.state.resumed, 0, 'dialog failure never resumes post-login prompts');
  eq(h.state.warnings.length, 1, 'dialog failure produces one actionable warning');

  h = makeCoordinatorHarness({
    hidden: true,
    pref: {
      read() { return { settled: true, state: 'off' }; },
      ensureChosenForBulkPull() { throw new Error('hidden tab must not prompt'); }
    }
  });
  await h.start();
  await h.run(200);
  eq(h.context.sfVisitNotesFirstChoicePending, true,
    'hidden-tab throttling never exhausts or drops the required choice');
  eq(h.state.resumed, 0, 'hidden tab does not resume downstream prompts');
  eq(h.state.warnings.length, 0, 'hidden tab does not emit retry-warning spam');
  h.state.hidden = false;
  await h.runNext();
  eq(h.context.sfVisitNotesFirstChoicePending, false,
    'the persisted choice is recognized once the tab becomes visible');
  eq(h.state.resumed, 1, 'visibility restoration resumes exactly once');

  h = makeCoordinatorHarness();
  await h.start();
  h.state.valid = false;
  await h.runNext();
  eq(h.context.sfVisitNotesFirstChoicePending, false,
    'an account/session switch retires only the old coordinator');
  eq(h.state.resumed, 0, 'an old-account coordinator never resumes the new session');
}

(async () => {
  startupContract();
  await runtimeCases();
  await coordinatorRuntimeCases();
  console.log('PASS first-login-full-visit-notes-choice-contract: ' + assertions + ' assertions');
})().catch(error => {
  console.error('FAIL first-login-full-visit-notes-choice-contract:', error && error.stack || error);
  process.exitCode = 1;
});
