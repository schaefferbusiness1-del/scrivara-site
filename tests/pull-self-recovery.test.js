'use strict';

/*
 * psr-1.0.0 - THE PULL RECOVERS athenaOne ONCE, BY ITSELF.
 *
 * MEASURED LIVE 2026-08-31. A day pull settled
 *   { ok:false, complete:false, reason:'nav-failed',
 *     error:'athena date navigation: the calendar view could not be reached
 *            automatically' }
 * because the athenaOne tab was a wedged near-blank renderer. The machinery
 * was correct and honest; it simply could not FIX the tab. The cure was
 * manual (drive the athena tab to the app root, clear athena's Continue
 * interstitial, press Pull again) after which the identical pull ran 34/34.
 *
 * The app-side cure is ONE mlsAppGoHome - the only verb reachable without a
 * trusted user gesture that makes the shipped extension run its own
 * rec-1.0.0 tab recovery - followed by a bounded wait and ONE re-run.
 *
 * This suite EXECUTES the real extracted blocks (never a re-description):
 *   A. the psr-1.0.0 module from 1p-mls-connect.js, over a stubbed bridge;
 *   B. the calendar-hero pull lane from the same file, wired to the REAL psr
 *      module through the REAL default postMessage bridge, in a fake DOM;
 *   C. the Visit day strip, pinned structurally over its own extracted
 *      region (it runs the same executed module B proves).
 *
 * It fails if the recovery ever loops more than once, if it drives a
 * cancelled / busy / signed-out session, if the retry changes the pull's
 * parameters, if the first failure stops being retained in the receipt, or
 * if the "Starting..." placeholder outlives the engine that owns it.
 *
 * NOT registered in tests/run-all.js (stage-only lane).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connectSource = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

/* ------------------------------------------------------------ extraction */
const PSR_START = '/* ===== psr-1.0.0 - the pull recovers athenaOne once';
const PSR_END = '/* ===== end psr-1.0.0 =====';
const psrStart = connectSource.indexOf(PSR_START);
assert(psrStart > 0, 'the psr-1.0.0 module could not be located in 1p-mls-connect.js');
const psrEnd = connectSource.indexOf(PSR_END, psrStart);
assert(psrEnd > psrStart, 'the psr-1.0.0 module end marker could not be located');
const psrSource = connectSource.slice(psrStart, psrEnd);
assert(/\}\)\(\);\s*$/.test(psrSource.trimEnd()), 'the extracted psr module does not end in a closed IIFE');

const HERO_START = '/* ============================================================\n * p1-cal-hero-pull-contract';
const heroStart = connectSource.indexOf(HERO_START);
assert(heroStart > 0, 'the calendar hero pull lane could not be located');
let heroEnd = connectSource.indexOf('\n/* ===== ', heroStart + HERO_START.length);
if (heroEnd < 0) heroEnd = connectSource.length;
const heroSource = connectSource.slice(heroStart, heroEnd);
assert(/\}\)\(\);\s*$/.test(heroSource.trimEnd()), 'the extracted hero lane does not end in a closed IIFE');

let passes = 0;
function pass(line) { passes++; console.log('PASS ' + passes + ': ' + line); }
function fail(e) { console.error('FAIL:', (e && e.stack) || e); process.exitCode = 1; }

/* =======================================================================
 * A. THE MODULE, OVER A STUBBED BRIDGE
 * ===================================================================== */

function psrContext(opts) {
  opts = opts || {};
  const timers = [];
  const ctx = {
    console, Promise, JSON, Date, Math, String, Number, Boolean, RegExp, Error, Array, Object,
    setTimeout: (fn, ms) => { timers.push({ fn, ms, fired: false }); return timers.length - 1; },
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
    backendMode: () => (opts.backendMode !== false),
    bkToken: () => (opts.token === undefined ? 'tok' : opts.token)
  };
  ctx.window = ctx;
  ctx.__mlsBgSleep = (ms) => { ctx.__slept = (ctx.__slept || []).concat([ms]); return Promise.resolve(); };
  vm.createContext(ctx);
  vm.runInContext(psrSource, ctx, { filename: 'psr-1.0.0.js', timeout: 4000 });
  assert(ctx.__mlsPullSelfRecovery && ctx.__mlsPullSelfRecovery.installed === true, 'the psr module did not install');
  ctx.__timers = timers;
  return ctx;
}

/* A bridge stub that records the exact verb order and answers from a table. */
function bridgeStub(table) {
  const calls = [];
  const fn = (type, respType, ms) => {
    calls.push({ type, respType, ms });
    const answer = Object.prototype.hasOwnProperty.call(table, type) ? table[type] : undefined;
    if (typeof answer === 'function') return Promise.resolve(answer());
    return Promise.resolve(answer === undefined ? null : answer);
  };
  fn.calls = calls;
  fn.verbs = () => calls.map((c) => c.type);
  return fn;
}
const HEALTHY = { ok: true, athena: { tabs: 1, discarded: 0 }, ka: { lastTick: 2000, signedOutAt: 0 } };
const NAV_FAIL = {
  ok: false, complete: false, reason: 'nav-failed',
  error: 'athena date navigation: the calendar view could not be reached automatically'
};

function a1_eligibility() {
  const ctx = psrContext();
  const psr = ctx.__mlsPullSelfRecovery;
  const CTX = { day: '2026-08-31', lane: 'test' };

  assert.strictEqual(psr.eligible(NAV_FAIL, CTX).ok, true, 'a nav-failed refusal must be recoverable');
  assert.strictEqual(psr.eligible({ ok: false, reason: 'calendar-unreachable' }, CTX).ok, true,
    'calendar-unreachable is the same class and must be recoverable');

  /* the class is CLOSED: a wrong-day landing is athena answering from a real
     screen, which a tab recovery cannot cure and which has its own handling. */
  assert.strictEqual(psr.eligible({ ok: false, reason: 'wrong-day' }, CTX).code, 'not-nav-class',
    'wrong-day must NOT enter the recovery class');
  ['no-read', 'schedule-incomplete', 'signin', 'provider-roster-incomplete', 'history-partial'].forEach((r) => {
    assert.strictEqual(psr.eligible({ ok: false, reason: r }, CTX).code, 'not-nav-class', r + ' must not enter the recovery class');
  });
  assert.strictEqual(psr.eligible({ ok: true, complete: true }, CTX).code, 'pull-succeeded', 'a successful pull is never recovered');
  assert.strictEqual(psr.eligible(null, CTX).code, 'no-result', 'a missing result is never recovered');
  pass('the recovery class is CLOSED: nav-failed and calendar-unreachable only - wrong-day, no-read, roster and history refusals are refused');
}

function a2_neverWhenCancelledBusyOrSignedOut() {
  /* the doctor cancelled - by the global stop flag, by the engine's own
     reason, and by the history receipt's stop stamp. */
  let ctx = psrContext();
  ctx.__mlsPullStopRequested = true;
  assert.strictEqual(ctx.__mlsPullSelfRecovery.eligible(NAV_FAIL, { day: 'd' }).code, 'stopped-by-user',
    'a stopped pull must never be auto-recovered');
  ctx = psrContext();
  assert.strictEqual(ctx.__mlsPullSelfRecovery.eligible({ ok: false, reason: 'stopped-by-user' }, { day: 'd' }).code, 'not-nav-class',
    'a stop is not even in the recovery class');
  ctx = psrContext();
  assert.strictEqual(
    ctx.__mlsPullSelfRecovery.eligible({ ok: false, reason: 'nav-failed', historyReceipt: { stoppedByUser: true } }, { day: 'd' }).code,
    'stopped-by-user', 'a receipt that records the doctor stopping must veto the recovery');

  /* busy: the cross-tab shield, the shared schedule lease, and both busy
     refusal shapes the engine itself produces. */
  ctx = psrContext();
  ctx.__mlsPullShieldForeign = () => true;
  assert.strictEqual(ctx.__mlsPullSelfRecovery.eligible(NAV_FAIL, { day: 'd' }).code, 'foreign-pull',
    'another tab or device pulling must veto the recovery');
  ctx = psrContext();
  ctx.__mlsSchedulePullLease = { id: 'other', kind: 'si-pull', at: Date.now() };
  assert.strictEqual(ctx.__mlsPullSelfRecovery.eligible(NAV_FAIL, { day: 'd' }).code, 'pull-lease-held',
    'a live schedule lease must veto the recovery');
  ctx = psrContext();
  ctx.__mlsSchedulePullLease = { id: 'other', at: Date.now() - 200000 };
  assert.strictEqual(ctx.__mlsPullSelfRecovery.eligible(NAV_FAIL, { day: 'd' }).ok, true,
    'an EXPIRED lease (>180s) is not an owner and must not veto');
  ctx = psrContext();
  assert.strictEqual(ctx.__mlsPullSelfRecovery.eligible({ ok: false, reason: 'nav-failed', busyInFlight: true }, { day: 'd' }).code,
    'busy-in-flight', 'a refusal to START is not the verdict of this pull and must never be recovered');

  /* signed out of MLS */
  ctx = psrContext({ token: '' });
  assert.strictEqual(ctx.__mlsPullSelfRecovery.eligible(NAV_FAIL, { day: 'd' }).code, 'mls-signed-out');
  ctx = psrContext({ backendMode: false });
  assert.strictEqual(ctx.__mlsPullSelfRecovery.eligible(NAV_FAIL, { day: 'd' }).code, 'mls-signed-out');
  pass('cancelled, busy (shield / lease / in-flight) and signed-out sessions are never auto-recovered');
}

function a3_oneCycleOnly() {
  const ctx = psrContext();
  const psr = ctx.__mlsPullSelfRecovery;
  const bridge = bridgeStub({ mlsExtHealth: HEALTHY, mlsAppGoHome: { ok: true, clicked: true } });
  assert.strictEqual(psr.eligible(NAV_FAIL, { day: '2026-08-31' }).ok, true);
  return psr.run({ day: '2026-08-31', bridge: bridge, sleep: () => Promise.resolve() }).then((rr) => {
    assert.strictEqual(rr.ok, true, 'a healthy recovery must admit the retry');
    /* the budget is spent by the ATTEMPT: a second nav-failed on the same day
       can never start a second cycle. */
    assert.strictEqual(psr.eligible(NAV_FAIL, { day: '2026-08-31' }).code, 'recovery-already-used',
      'the SAME day must never buy a second automatic recovery');
    assert.strictEqual(psr.eligible(NAV_FAIL, { day: '2026-09-01' }).ok, true,
      'a DIFFERENT day keeps its own budget');
    /* a manual press is a new intent and buys a fresh one */
    psr.reset('2026-08-31');
    assert.strictEqual(psr.eligible(NAV_FAIL, { day: '2026-08-31' }).ok, true,
      'reset() (a manual press) must restore the budget');
    pass('exactly ONE recovery cycle per day; a manual press buys a fresh one');
  });
}

function a4_runDrivesTheRightVerbsInTheRightOrder() {
  const ctx = psrContext();
  const psr = ctx.__mlsPullSelfRecovery;
  const bridge = bridgeStub({ mlsExtHealth: HEALTHY, mlsAppGoHome: { ok: false, clicked: false, diag: [] } });
  const slept = [];
  return psr.run({ day: 'd', bridge: bridge, sleep: (ms) => { slept.push(ms); return Promise.resolve(); } }).then((rr) => {
    assert.deepStrictEqual(bridge.verbs(), ['mlsExtHealth', 'mlsAppGoHome'],
      'the recovery must PROVE athena is present and signed in BEFORE it drives anything');
    assert.strictEqual(bridge.calls[1].respType, 'mlsAppGoHomeResult', 'the beat must await the answer from the extension');
    assert.strictEqual(bridge.calls[1].ms, psr.beatMs, 'the beat must be deadline-ceilinged');
    assert.deepStrictEqual(slept, [psr.settleMs], 'exactly one bounded settle wait, of the declared length');
    /* a goHome that answers ok:false is still a recovery that RAN: the shipped
       handler reaches mlsRecoverAthenaTab on exactly that shape (a timed-out
       or frameless injection - the wedged renderer). */
    assert.strictEqual(rr.ok, true, 'an answered beat admits the one retry even when the Home click itself did not land');
    assert.strictEqual(rr.recovery.ran, true);
    assert.strictEqual(rr.recovery.answered, true);
    assert.strictEqual(rr.recovery.via, 'mlsAppGoHome');
    assert.strictEqual(rr.recovery.waitedMs, psr.settleMs);
    assert.strictEqual(rr.message, psr.messages.retrying, 'the doctor is told the pull is being retried automatically');
    assert(/attempt 2 of 2/.test(rr.message), 'the narration must name which attempt this is');
    pass('the cycle is health-probe -> ONE mlsAppGoHome -> ONE bounded wait -> retry, narrated');
  });
}

function a5_signedOutAthenaIsNeverDriven() {
  const cases = [
    { name: 'athena signed out (the stamp from the extension)',
      health: { ok: true, athena: { tabs: 1 }, ka: { lastTick: 1000, signedOutAt: 9000 } }, expect: 'athena-signed-out' },
    { name: 'no athenaOne tab at all',
      health: { ok: true, athena: { tabs: 0 }, ka: { lastTick: 9000, signedOutAt: 0 } }, expect: 'no-athena-tab' },
    { name: 'the extension did not answer the health probe',
      health: null, expect: 'health-unreachable' },
    { name: 'a health reply that does not say ok',
      health: { athena: { tabs: 3 } }, expect: 'health-unreachable' }
  ];
  return cases.reduce((chain, c) => chain.then(() => {
    const ctx = psrContext();
    const psr = ctx.__mlsPullSelfRecovery;
    const bridge = bridgeStub({ mlsExtHealth: c.health, mlsAppGoHome: { ok: true, clicked: true } });
    return psr.run({ day: 'd', bridge: bridge, sleep: () => Promise.resolve() }).then((rr) => {
      assert.strictEqual(rr.ok, false, c.name + ': must refuse');
      assert.strictEqual(rr.recovery.reason, c.expect, c.name + ': must name itself');
      assert.strictEqual(rr.recovery.ran, false, c.name + ': nothing may be driven');
      assert.deepStrictEqual(bridge.verbs(), ['mlsExtHealth'], c.name + ': mlsAppGoHome must never be sent');
      assert(rr.message, c.name + ': a refusal must carry a sentence for the doctor');
    });
  }), Promise.resolve()).then(() => {
    /* the signed-out sentence is the EXISTING honest one, not a new one */
    const ctx = psrContext();
    assert.strictEqual(ctx.__mlsPullSelfRecovery.messages.athenaSignedOut,
      'Athena sign-in required. Sign in to athenaOne, then select Retry.',
      'a signed-out session must surface the existing honest message');
    assert.strictEqual(ctx.__mlsPullSelfRecovery.messages.mlsSignedOut, 'Sign in to import the schedule.');
    pass('a signed-out or absent athenaOne is NEVER driven - the existing honest message is surfaced instead');
  });
}

function a6_refusalsAfterTheBeat() {
  const ctx = psrContext();
  const psr = ctx.__mlsPullSelfRecovery;
  /* 1. the beat itself never answered */
  const b1 = bridgeStub({ mlsExtHealth: HEALTHY, mlsAppGoHome: null });
  return psr.run({ day: 'd1', bridge: b1, sleep: () => Promise.resolve() }).then((rr) => {
    assert.strictEqual(rr.ok, false, 'an unanswered recovery must not admit a retry');
    assert.strictEqual(rr.recovery.reason, 'recovery-unanswered');
    /* 2. another athena navigation owns the tab */
    const b2 = bridgeStub({ mlsExtHealth: HEALTHY, mlsAppGoHome: { ok: false, reason: 'athena-navigation-busy' } });
    return psr.run({ day: 'd2', bridge: b2, sleep: () => Promise.resolve() });
  }).then((rr) => {
    assert.strictEqual(rr.ok, false, 'a busy athena navigation must not admit a retry');
    assert.strictEqual(rr.recovery.reason, 'athena-navigation-busy');
    /* 3. the beat named a sign-out the health probe could not see */
    const b3 = bridgeStub({ mlsExtHealth: HEALTHY, mlsAppGoHome: { ok: false, error: 'No signed-in athenaOne tab found.' } });
    return psr.run({ day: 'd3', bridge: b3, sleep: () => Promise.resolve() });
  }).then((rr) => {
    assert.strictEqual(rr.ok, false);
    assert.strictEqual(rr.recovery.reason, 'athena-signed-out', 'the sign-out answer from the beat outranks a stale health receipt');
    /* 4. the doctor pressed Stop WHILE we were recovering */
    const ctx4 = psrContext();
    const b4 = bridgeStub({ mlsExtHealth: HEALTHY, mlsAppGoHome: { ok: true, clicked: true } });
    return ctx4.__mlsPullSelfRecovery.run({
      day: 'd4', bridge: b4,
      sleep: () => { ctx4.__mlsPullStopRequested = true; return Promise.resolve(); }
    }).then((rr4) => {
      assert.strictEqual(rr4.ok, false, 'a Stop during the recovery wait must cancel the retry');
      assert.strictEqual(rr4.recovery.reason, 'stopped-by-user');
    });
  }).then(() => {
    /* 5. another pull claimed athena WHILE we were recovering */
    const ctx5 = psrContext();
    const b5 = bridgeStub({ mlsExtHealth: HEALTHY, mlsAppGoHome: { ok: true, clicked: true } });
    return ctx5.__mlsPullSelfRecovery.run({
      day: 'd5', bridge: b5,
      sleep: () => { ctx5.__mlsPullShieldForeign = () => true; return Promise.resolve(); }
    }).then((rr5) => {
      assert.strictEqual(rr5.ok, false, 'a foreign pull started during the wait must cancel the retry');
      assert.strictEqual(rr5.recovery.reason, 'foreign-pull');
    });
  }).then(() => {
    pass('every post-beat refusal (unanswered, athena busy, sign-out, Stop, foreign pull) cancels the retry and names itself');
  });
}

function a7_receiptHonesty() {
  const ctx = psrContext();
  const psr = ctx.__mlsPullSelfRecovery;
  const first = { ok: false, complete: false, reason: 'nav-failed', error: 'the calendar view could not be reached automatically' };
  const rec = { via: 'mlsAppGoHome', ran: true, answered: true, ok: false, clicked: false, reason: '', health: 'athena-present', waitedMs: 6000, at: 123 };

  const good = psr.stampAttempts(first, { ok: true, complete: true, reason: 'complete' }, rec);
  assert.strictEqual(good.ok, true, 'a successful retry keeps its own verdict');
  assert.strictEqual(good.attempts.length, 2, 'both attempts must ride the receipt');
  assert.strictEqual(good.attempts[0].ok, false, 'attempt 1 must be retained AS A FAILURE');
  assert.strictEqual(good.attempts[0].reason, 'nav-failed', 'attempt 1 must keep its own reason');
  assert.strictEqual(good.attempts[1].ok, true);
  assert.strictEqual(good.selfRecovery.ran, true);
  assert.strictEqual(good.selfRecovery.via, 'mlsAppGoHome');
  assert.strictEqual(good.selfRecovery.waitedMs, 6000);

  const bad = psr.stampAttempts(first, { ok: false, complete: false, reason: 'nav-failed' }, rec);
  assert.strictEqual(bad.ok, false, 'a second failure is NEVER upgraded');
  assert.strictEqual(bad.attempts.length, 2);
  assert(/recovered automatically and the pull was retried once/.test(psr.terminalNote(rec)),
    'the terminal sentence must say what was tried');

  /* a REFUSED recovery means only ONE pull attempt ever happened */
  const refusedRec = { via: 'mlsAppGoHome', ran: false, answered: false, reason: 'athena-signed-out', health: 'athena-signed-out', waitedMs: 0, at: 1 };
  const refused = psr.stampRefusal({ ok: false, complete: false, reason: 'nav-failed' }, refusedRec);
  assert.strictEqual(refused.attempts.length, 1, 'a refused recovery must never claim a second attempt');
  assert.strictEqual(refused.selfRecovery.ran, false);
  assert.strictEqual(refused.selfRecovery.retried, false);
  assert(/not attempted \(athena-signed-out\)/.test(psr.terminalNote(refusedRec)),
    'a recovery that never ran must say so, and why');

  /* PHI-free by construction: booleans, closed codes, numbers and the
     PHI-free refusal text from the engine - nothing else. */
  const keys = Object.keys(good.selfRecovery).sort();
  assert.deepStrictEqual(keys,
    ['answered', 'at', 'clicked', 'health', 'ok', 'ran', 'reason', 'via', 'version', 'waitedMs'].sort(),
    'the selfRecovery record is a CLOSED shape');
  pass('the receipt keeps BOTH attempts, never upgrades a second failure, and a refused recovery never claims a retry');
}

/* =======================================================================
 * B. THE LANE, END TO END, THROUGH THE REAL BRIDGE
 * ===================================================================== */

let idRegistry, clickCaptureHandlers, scheduled, toasts, msgListeners, posted, dayPullCalls, extAnswers, heroCtx;

function makeEl(tag) {
  let _id = '';
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    disabled: false, style: {}, children: [], parentNode: null, textContent: '', _attrs: {},
    get id() { return _id; },
    set id(v) { if (_id && idRegistry[_id] === el) delete idRegistry[_id]; _id = String(v || ''); if (_id) idRegistry[_id] = el; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      if (c.parentNode) { const p = c.parentNode.children.indexOf(c); if (p >= 0) c.parentNode.children.splice(p, 1); }
      c.parentNode = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (ref && idx >= 0) this.children.splice(idx, 0, c); else this.children.push(c);
      return c;
    },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    get firstElementChild() { return this.children[0] || null; },
    get nextSibling() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return this.parentNode.children[i + 1] || null; },
    get previousSibling() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return i > 0 ? this.parentNode.children[i - 1] : null; },
    set innerHTML(v) {
      this._html = String(v);
      /* the bar paints its fill through innerHTML; give it one real child */
      if (/^<div/.test(this._html)) { this.children = []; this.appendChild(makeEl('div')); }
    },
    get innerHTML() { return this._html || ''; },
    querySelector() { return null; },
    closest(sel) { let n = this; const want = String(sel).replace(/^#/, ''); while (n) { if (n.id === want) return n; n = n.parentNode || null; } return null; }
  };
  return el;
}

function heroContext(opts) {
  opts = opts || {};
  idRegistry = {}; clickCaptureHandlers = []; scheduled = []; toasts = [];
  msgListeners = []; posted = []; dayPullCalls = [];
  extAnswers = Object.assign({
    mlsExtHealth: HEALTHY,
    mlsAppGoHome: { ok: true, clicked: true, diag: [] }
  }, opts.extAnswers || {});
  const results = (opts.results || []).slice();
  const body = makeEl('body');

  const fakeDocument = {
    readyState: 'complete', body: body, head: makeEl('head'), documentElement: makeEl('html'),
    getElementById: (id) => idRegistry[id] || null,
    createElement: (tag) => makeEl(tag),
    addEventListener: (type, fn, capture) => { if (type === 'click' && capture === true) clickCaptureHandlers.push(fn); },
    removeEventListener: () => {},
    execCommand: () => true
  };
  const ctx = {
    console, Promise, JSON, Date, Math, String, Number, Boolean, RegExp, Error, Array, Object,
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/Indianapolis' }) }) },
    navigator: { userAgent: 'test-agent' },
    document: fakeDocument,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout: (fn, ms) => { scheduled.push({ fn, ms, fired: false }); return scheduled.length - 1; },
    clearTimeout: () => {},
    uns: (s) => 'psr-test::' + s,
    toast: (msg, kind) => { toasts.push({ msg: String(msg || ''), kind: kind }); },
    loadCalendar: () => {},
    _acctTodayKey: () => '2026-08-31',
    _calRefDate: '2026-08-31',
    backendMode: () => (opts.backendMode !== false),
    bkToken: () => (opts.token === undefined ? 'tok' : opts.token),
    __mlsBgSleep: (ms) => { ctx.__slept = (ctx.__slept || []).concat([ms]); return Promise.resolve(); },
    __mlsProviderRoster: { resolve: () => null },
    __mlsVisitNotesPref: { ensureChosenForBulkPull: () => Promise.resolve({ ok: true, chosen: false, on: true, reason: 'already-chosen' }) },
    __mlsSI: {
      installed: true,
      dayPull: (o) => {
        dayPullCalls.push(o);
        const r = results.length ? results.shift() : { ok: true, complete: true };
        return Promise.resolve(typeof r === 'function' ? r(o) : r);
      }
    },
    __mlsDaySwitch: {
      classifyPullResult: (r, day) => (r && r.ok === true
        ? { ok: true, message: day + ' is ready - all 34 appointments are in MLS.' }
        : { ok: false, message: 'Athena could not be opened to the requested day. Keep the signed-in Athena tab open and try again.' })
    }
  };
  /* the REAL default bridge the psr module uses: window.postMessage out,
     a 'message' event with {source:'mls-ext', type:<verb>Result} back. */
  ctx.addEventListener = (type, fn) => { if (type === 'message') msgListeners.push(fn); };
  ctx.removeEventListener = (type, fn) => { msgListeners = msgListeners.filter((h) => h !== fn); };
  ctx.postMessage = (d) => {
    posted.push(d);
    const answer = extAnswers[d && d.type];
    if (answer === undefined) return;                 /* silence: the timeout owns it */
    Promise.resolve().then(() => {
      msgListeners.slice().forEach((h) => h({ data: { source: 'mls-ext', type: String(d.type) + 'Result', resp: answer } }));
    });
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(psrSource, ctx, { filename: 'psr-1.0.0.js', timeout: 4000 });
  vm.runInContext(heroSource, ctx, { filename: 'p1-cal-hero-pull-contract.js', timeout: 4000 });
  heroCtx = ctx;
  return ctx;
}

function makeHero() {
  const hero = makeEl('button');
  hero.id = 'mlsCvNxt_calendar';
  const parent = makeEl('div');
  parent.appendChild(hero);
  return hero;
}
function click(hero) {
  assert.strictEqual(clickCaptureHandlers.length, 1, 'exactly one capture-phase click handler must be installed');
  clickCaptureHandlers[0]({ target: hero, stopPropagation() {}, preventDefault() {} });
}
async function flush(times) { for (let i = 0; i < (times || 12); i++) await Promise.resolve(); }
function status() { return idRegistry['mlsCvHeroStatus']; }
function bar() { return idRegistry['mlsCvHeroBar']; }
function barText() { const b = bar(); return b && b.firstElementChild ? String(b.firstElementChild.textContent || '') : ''; }
function goHomePosts() { return posted.filter((p) => p && p.type === 'mlsAppGoHome'); }

function b1_navFailedRecoversAndSucceeds() {
  return (async () => {
    heroContext({ results: [NAV_FAIL, { ok: true, complete: true, scheduleReceipt: { parsedCount: 34 } }] });
    const hero = makeHero();
    click(hero);
    await flush(40);
    assert.strictEqual(scheduled.filter((s) => s.ms === 4000 || s.ms === 9000).length, 0,
      'the BLIND 4s/9s settle ladder must not be used for a wedged tab - the recovery replaces it');
    assert.strictEqual(goHomePosts().length, 1, 'exactly ONE mlsAppGoHome recovery beat');
    assert.strictEqual(posted.filter((p) => p && p.type === 'mlsExtHealth').length, 1,
      'the signed-in re-check runs before the tab is driven');
    assert.deepStrictEqual(heroCtx.__slept, [6000], 'one bounded, hidden-tab-safe wait');
    assert.strictEqual(dayPullCalls.length, 2, 'exactly one automatic retry');
    assert.strictEqual(dayPullCalls[1].date, dayPullCalls[0].date, 'the retry must pull the SAME day');
    assert.strictEqual(dayPullCalls[1].pullVisitBodies, dayPullCalls[0].pullVisitBodies, 'the retry must keep the SAME visit-notes choice');
    assert.strictEqual(dayPullCalls[1].includeHistory, dayPullCalls[0].includeHistory, 'the retry must keep the SAME history scope');
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(dayPullCalls[1], 'provider'),
      Object.prototype.hasOwnProperty.call(dayPullCalls[0], 'provider'),
      'the retry must keep the SAME provider scope');

    const st = status();
    assert(/is ready/.test(st.textContent), 'the recovered pull must paint its real success verdict: ' + st.textContent);
    assert.strictEqual(bar().style.display, 'none', 'the bar converges with the run');
    pass('a nav-failed pull recovers athenaOne once, retries with identical parameters, and lands its real verdict');
  })();
}

function b2_receiptCarriesBothAttempts() {
  return (async () => {
    let seen = null;
    const ctx = heroContext({
      results: [NAV_FAIL, { ok: true, complete: true }]
    });
    ctx.__mlsDaySwitch.classifyPullResult = (r, day) => {
      seen = r;
      return r && r.ok === true ? { ok: true, message: day + ' is ready - all 34 appointments are in MLS.' } : { ok: false, message: 'refused' };
    };
    const hero = makeHero();
    click(hero);
    await flush(40);
    assert(seen, 'the verdict must be classified from a real result');
    assert(Array.isArray(seen.attempts) && seen.attempts.length === 2, 'the receipt must carry BOTH attempts');
    assert.strictEqual(seen.attempts[0].ok, false, 'the first failure must be retained');
    assert.strictEqual(seen.attempts[0].reason, 'nav-failed');
    assert.strictEqual(seen.attempts[1].ok, true);
    assert.strictEqual(seen.selfRecovery.ran, true, 'the receipt must record that the recovery ran');
    assert.strictEqual(seen.selfRecovery.via, 'mlsAppGoHome');
    assert.strictEqual(seen.ok, true, 'the honest verdict of the run that actually succeeded');
    pass('a success on the retry stamps ok WITH both attempts and the recovery record on the receipt');
  })();
}

function b3_secondFailureIsTerminalAndHonest() {
  return (async () => {
    heroContext({ results: [NAV_FAIL, NAV_FAIL, NAV_FAIL] });
    const hero = makeHero();
    click(hero);
    await flush(40);
    assert.strictEqual(dayPullCalls.length, 2, 'NEVER more than one automatic retry for this class');
    assert.strictEqual(goHomePosts().length, 1, 'NEVER more than one recovery beat');
    assert.strictEqual(scheduled.filter((s) => s.ms === 4000 || s.ms === 9000).length, 0,
      'the blind ladder must stay consumed - no third lap');
    const text = status().textContent;
    assert(/Athena could not be opened to the requested day/.test(text),
      'the honest message from the engine must survive: ' + text);
    assert(/recovered automatically and the pull was retried once/.test(text),
      'the terminal message must say what was tried: ' + text);
    assert.strictEqual(hero.disabled, false, 'the button must come back');
    assert(toasts.some((t) => t.kind === 'err'), 'a terminal failure is still reported as a failure');
    assert.strictEqual(bar().style.display, 'none',
      'the progress bar must converge with the run - it may not sit at "Starting…" beside a failed verdict');
    pass('a second failure stays TERMINAL and honest - the message from the engine plus what was tried, and no third lap');
  })();
}

function b4_neverWhenCancelledBusyOrSignedOut() {
  return (async () => {
    /* cancelled */
    let ctx = heroContext({ results: [NAV_FAIL, { ok: true, complete: true }] });
    ctx.__mlsPullStopRequested = true;
    let hero = makeHero();
    click(hero);
    await flush(30);
    assert.strictEqual(goHomePosts().length, 0, 'a cancelled pull must never drive athenaOne');
    assert.strictEqual(dayPullCalls.length, 1, 'a cancelled pull must never be auto-retried by the recovery lane');

    /* busy: another tab owns the shield */
    ctx = heroContext({ results: [NAV_FAIL, { ok: true, complete: true }] });
    ctx.__mlsPullShieldForeign = () => true;
    hero = makeHero();
    click(hero);
    await flush(30);
    assert.strictEqual(goHomePosts().length, 0, 'a foreign pull must never be interrupted by our recovery');

    /* signed out of MLS */
    ctx = heroContext({ results: [NAV_FAIL, { ok: true, complete: true }], token: '' });
    hero = makeHero();
    click(hero);
    await flush(30);
    assert.strictEqual(goHomePosts().length, 0, 'a signed-out session must never be driven');

    /* signed out of athenaOne: the health probe answers, the beat never runs */
    ctx = heroContext({
      results: [NAV_FAIL, { ok: true, complete: true }],
      extAnswers: { mlsExtHealth: { ok: true, athena: { tabs: 1 }, ka: { lastTick: 10, signedOutAt: 9999 } } }
    });
    hero = makeHero();
    click(hero);
    await flush(30);
    assert.strictEqual(posted.filter((p) => p && p.type === 'mlsExtHealth').length, 1, 'the sign-in state IS re-checked');
    assert.strictEqual(goHomePosts().length, 0, 'a signed-out athenaOne must never be driven');
    assert.strictEqual(dayPullCalls.length, 1, 'and nothing is retried over it');
    assert(/Sign in to athenaOne/.test(status().textContent),
      'the existing honest signed-out message must be surfaced: ' + status().textContent);
    pass('cancelled / busy / signed-out (MLS or athenaOne) never drive a recovery and never auto-retry');
  })();
}

function b5_stalePlaceholderConvergesWhenTheEngineStops() {
  return (async () => {
    let settleResult;
    const pending = new Promise((r) => { settleResult = r; });
    heroContext({ results: [() => pending] });
    const hero = makeHero();
    click(hero);
    await flush();
    /* live: the placeholder is mounted and the run owns it */
    assert.strictEqual(bar().style.display, 'block', 'a running pull paints its bar');
    assert.strictEqual(barText(), 'Starting…', 'the placeholder mounts on the first paint');
    assert.strictEqual(heroCtx.__mlsCalPullDay, '2026-08-31', 'the run publishes its own liveness marker');

    /* silent for minutes: the placeholder AGES rather than claiming it just began */
    const opts = dayPullCalls[0];
    opts.onStatus('Opening 2026-08-31 in athenaOne...');   /* starts the run clock */
    assert.strictEqual(barText(), 'Starting…', 'the placeholder is still honest at t=0');
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 200000;
      opts.onStatus('Athena is still switching days - re-checking in a moment...');
      assert(/^Waiting on athenaOne · \d+m \d+s$/.test(barText()),
        'a long silent leg must not keep saying "Starting…": ' + barText());
    } finally { Date.now = realNow; }

    /* The engine stops: the strip must converge to the settled outcome. A
       TERMINAL refusal is used so this slice measures the paint alone - the
       recovery cycle has its own slices above, and b3 proves the bar
       converges at the end of a full nav-failed cycle too. */
    settleResult({ ok: false, complete: false, reason: 'unverified-day', error: 'wedged' });
    await flush(40);
    assert.strictEqual(heroCtx.__mlsCalPullDay, '', 'the liveness marker is cleared at the one true end');
    assert.strictEqual(bar().style.display, 'none',
      'the "Starting…" bar must NOT outlive the engine that owns it (measured live 2026-08-31: it sat there for minutes)');
    assert(/Athena could not be opened/.test(status().textContent), 'the settled verdict is on screen');

    /* and a late status from the dead engine cannot re-mount it */
    opts.onStatus('a late tick from an engine that already died');
    assert.strictEqual(bar().style.display, 'none', 'a dead engine may not re-mount the placeholder');
    pass('the "Starting…" paint is bound to the liveness of the engine: it ages while silent, converges when the engine stops, and cannot be re-minted');
  })();
}

/* =======================================================================
 * C. THE VISIT DAY STRIP IS WIRED TO THE SAME ONE CYCLE
 *
 * The day strip (__mlsDaySwitch) is a 2,500-line module with the whole app
 * under it, so it is pinned STRUCTURALLY over its own extracted region -
 * the technique its own convergence suites use - rather than re-described.
 * Both lanes call the SAME executed module proved above.
 * ===================================================================== */
function c1_dayStripWiring() {
  const dsStart = connectSource.indexOf('__mlsDaySwitch ds-2.0.2');
  assert(dsStart > 0, 'the Visit day-strip module could not be located');
  const dsEnd = connectSource.indexOf('function removeDoctorDayControls', dsStart);
  assert(dsEnd > dsStart, 'the day-strip region could not be bounded');
  const ds = connectSource.slice(dsStart, dsEnd);

  const admit = ds.indexOf("psrDsRun.eligible(result, { day: day, lane: 'day-strip'");
  const navVeto = ds.indexOf('if (__navVetoed) {');
  const ladder = ds.indexOf('if (transientRefusal && (DS.autoRePull | 0) < 2');
  assert(navVeto > 0 && admit > navVeto, 'the landed-day nav veto must still be answered BEFORE the recovery is considered');
  assert(ladder > admit, 'the recovery must be offered BEFORE the blind settle ladder, not after three identical laps');
  assert(ds.indexOf('DS.autoRePull = 2;', admit) > admit && ds.indexOf('DS.autoRePull = 2;', admit) < ladder,
    'the blind budget must be CONSUMED by the recovery so this class can never take a second automatic retry');
  assert(ds.indexOf('dsRosterRetryBlocked(day, sessionSerial)', admit) > admit,
    'the recovery restart must honour the same cross-tab / lease guard every other automatic restart honours');
  assert(/DS\.__psrFirst = null; DS\.__psrRec = null; DS\.__psrNote = ''; DS\.__psrPending = false;/.test(ds),
    'a manual press must clear the whole recovery state');
  assert(ds.indexOf('dsPsrReset.reset(DS.day)') > 0, 'a manual press must buy a fresh recovery budget');
  assert(ds.indexOf('psrDsStamp.stampAttempts(DS.__psrFirst, result, DS.__psrRec)') > 0,
    'the retry receipt must carry both attempts in this lane too');
  assert(ds.indexOf('psrDsRun.stampRefusal(result, DS.__psrRec)') > 0,
    'a refused recovery must never claim a second attempt in this lane either');
  /* the liveness bound on the strip's own placeholder */
  assert(/if \(!\(DS\.pulling \|\| DS\.__autoRetrying \|\| DS\.retrying\)\) \{/.test(ds),
    'the day-strip progress bar must be bound to the liveness of the engine');
  /* and the terminal painters keep their exact proven call shape */
  assert(ds.indexOf('done(outcome.ok, outcome.message + cvNote') > 0,
    'the convergence terminal must keep its pinned call shape (the note folds into outcome.message)');
  pass('the Visit day strip runs the SAME single recovery cycle, after the nav veto, before the blind ladder, under the same guards');
}

/* ------------------------------------------------------------------ run */
Promise.resolve()
  .then(a1_eligibility)
  .then(a2_neverWhenCancelledBusyOrSignedOut)
  .then(a3_oneCycleOnly)
  .then(a4_runDrivesTheRightVerbsInTheRightOrder)
  .then(a5_signedOutAthenaIsNeverDriven)
  .then(a6_refusalsAfterTheBeat)
  .then(a7_receiptHonesty)
  .then(b1_navFailedRecoversAndSucceeds)
  .then(b2_receiptCarriesBothAttempts)
  .then(b3_secondFailureIsTerminalAndHonest)
  .then(b4_neverWhenCancelledBusyOrSignedOut)
  .then(b5_stalePlaceholderConvergesWhenTheEngineStops)
  .then(c1_dayStripWiring)
  .then(() => {
    assert.strictEqual(passes, 13, 'every slice must have run - ' + passes + ' of 13 did');
    console.log('PASS pull-self-recovery: one recovery, one retry, honest either way');
  })
  .catch(fail);
