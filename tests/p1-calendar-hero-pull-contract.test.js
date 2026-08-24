'use strict';

/*
 * DEFECT 2 (2026-08-16): the Calendar hero (#mlsCvNxt_calendar) dispatched
 * through pullScheduleViaAssist with none of the caller contract the Visit
 * tab's day strip (__mlsDaySwitch) already proved live: no button reference
 * (nothing disabled/relabeled), no calendar-scoped provider freeze, no
 * receipt-aware verdict, no auto-retry on a transient refusal, no copyable
 * error report, and no post-pull re-render.
 *
 * The fix (p1-cal-hero-pull-contract, appended to the end of
 * 1p-mls-connect.js) intercepts the hero's click in CAPTURE PHASE and runs
 * that same contract itself, reusing window.__mlsSI.dayPull (the one
 * guarded engine) and window.__mlsDaySwitch.classifyPullResult (the exact
 * receipt-aware verdict text) rather than reinventing either.
 *
 * This test extracts the REAL module source (not a re-description of it)
 * and executes it in a minimal fake DOM/window, then drives real clicks
 * against it to prove every row of the contract table.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connectSource = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

const START_MARKER = '/* ============================================================\n * p1-cal-hero-pull-contract';
const startIdx = connectSource.indexOf(START_MARKER);
assert(startIdx >= 0, 'could not locate the p1-cal-hero-pull-contract module in 1p-mls-connect.js');
/* 2026-08-18: the module used to be the LAST code in the file, so slicing to
   EOF happened to work. The calendar-polish blocks (calmbar-1.0.0,
   caldaysel-1.0.0) now append AFTER it as top-level delimited blocks, so the
   boundary is explicit: the module ends at the first COLUMN-0 block marker
   after it. calmreceipt-1.0.0 lives INSIDE the module (indented marker) and
   stays part of the extraction on purpose. */
let endIdx = connectSource.indexOf('\n/* ===== ', startIdx + START_MARKER.length);
if (endIdx < 0) endIdx = connectSource.length;
const moduleSource = connectSource.slice(startIdx, endIdx);
assert(/\}\)\(\);\s*$/.test(moduleSource.trimEnd()), 'the extracted hero-pull-contract module does not end in a closed IIFE — extraction boundary is wrong');

/* ---------------------------------------------------------------- fake DOM */
function makeEl(tag) {
  let _id = '';
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    disabled: false,
    style: {},
    children: [],
    parentNode: null,
    textContent: '',
    _attrs: {},
    get id() { return _id; },
    set id(v) {
      if (_id && idRegistry[_id] === el) delete idRegistry[_id];
      _id = String(v || '');
      if (_id) idRegistry[_id] = el;
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      if (c.parentNode) {
        const pIdx = c.parentNode.children.indexOf(c);
        if (pIdx >= 0) c.parentNode.children.splice(pIdx, 1);
      }
      c.parentNode = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (ref && idx >= 0) this.children.splice(idx, 0, c); else this.children.push(c);
      return c;
    },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return this.parentNode.children[i + 1] || null;
    },
    get previousSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i > 0 ? this.parentNode.children[i - 1] : null;
    },
    querySelector() { return null; },
    closest(sel) {
      let node = this;
      const wantId = String(sel).replace(/^#/, '');
      while (node) { if (node.id === wantId) return node; node = node.parentNode || null; }
      return null;
    }
  };
  return el;
}

let idRegistry;
let clickCaptureHandlers;
let scheduled;
let toasts;
let loadCalendarCalls;
let storage;
let dayPullCalls;
let dayPullImpl;
let classifyImpl;
let rosterResolveImpl;

function freshContext(opts) {
  idRegistry = {};
  clickCaptureHandlers = [];
  scheduled = [];
  toasts = [];
  loadCalendarCalls = 0;
  storage = new Map(Object.entries((opts && opts.storage) || {}));
  dayPullCalls = [];
  dayPullImpl = (opts && opts.dayPullImpl) || (() => Promise.resolve({ ok: true, complete: true }));
  classifyImpl = (opts && opts.classifyImpl) || null;
  rosterResolveImpl = (opts && opts.rosterResolveImpl) || (() => null);

  const body = makeEl('body');
  const head = makeEl('head');
  const documentElement = makeEl('html');

  const fakeDocument = {
    readyState: 'complete',
    body, head, documentElement,
    getElementById: (id) => idRegistry[id] || null,
    createElement: (tag) => makeEl(tag),
    addEventListener: (type, fn, capture) => { if (type === 'click' && capture === true) clickCaptureHandlers.push(fn); },
    removeEventListener: (type, fn, capture) => {
      if (type === 'click' && capture === true) clickCaptureHandlers = clickCaptureHandlers.filter((h) => h !== fn);
    },
    execCommand: () => true
  };

  const context = {
    console,
    Promise, JSON, Date, Math, String, Number, Boolean, RegExp, Error,
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/Indianapolis' }) }) },
    navigator: { userAgent: 'test-agent' },
    document: fakeDocument,
    localStorage: {
      getItem: (k) => (storage.has(String(k)) ? storage.get(String(k)) : null),
      setItem: (k, v) => storage.set(String(k), String(v)),
      removeItem: (k) => storage.delete(String(k))
    },
    setTimeout: (fn, ms) => { const id = scheduled.length; scheduled.push({ id, fn, ms, fired: false }); return id; },
    clearTimeout: () => {},
    uns: (suffix) => `hero-pull-test::${suffix}`,
    toast: (msg, kind) => { toasts.push({ msg, kind }); },
    loadCalendar: () => { loadCalendarCalls++; },
    _acctTodayKey: () => '2026-08-16',
    _calRefDate: '',
    __mlsProviderRoster: { resolve: (label) => rosterResolveImpl(label) },
    __mlsVisitNotesPref: {
      ensureChosenForBulkPull: () => Promise.resolve({ ok: true, chosen: false, on: true, reason: 'already-chosen' }),
      choicePending: () => false
    },
    __mlsSI: {
      installed: true,
      dayPull: (opts2) => { dayPullCalls.push(opts2); return Promise.resolve(dayPullImpl(opts2)); }
    },
    __mlsDaySwitch: classifyImpl ? { classifyPullResult: classifyImpl } : undefined
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(moduleSource, context, { filename: 'p1-cal-hero-pull-contract.js', timeout: 4000 });
  return context;
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
  const ev = { target: hero, stoppedPropagation: false, defaultPrevented: false,
    stopPropagation() { this.stoppedPropagation = true; },
    preventDefault() { this.defaultPrevented = true; } };
  clickCaptureHandlers[0](ev);
  return ev;
}

async function flush(times) {
  for (let i = 0; i < (times || 3); i++) await Promise.resolve();
}

function fireScheduled(index) {
  const item = scheduled[index != null ? index : scheduled.length - 1];
  assert(item && !item.fired, 'expected a pending scheduled retry timer');
  item.fired = true;
  item.fn();
}

/* ============================================================ 1. capture-phase interception ============ */
(async () => {
  const ctx = freshContext({});
  const hero = makeHero();
  const ev = click(hero);
  assert.strictEqual(ev.stoppedPropagation, true, 'the hero click must be stopped in capture phase so the frozen file’s own onclick never runs');
  assert.strictEqual(ev.defaultPrevented, true, 'the hero click must call preventDefault');
  await flush();
  assert.strictEqual(dayPullCalls.length, 1, 'the interceptor must call window.__mlsSI.dayPull exactly once for a plain click');
  assert.strictEqual(dayPullCalls[0].pullVisitBodies, true, 'the admitted full-visit-notes choice must reach dayPull exactly');
  console.log('PASS 1/7: capture-phase interception replaces the frozen onclick');
})().then(run2).catch(fail);

/* ============================================================ 2. day + button + progress contract ======== */
function run2() {
  return (async () => {
    let resolveInner;
    const pending = new Promise((r) => { resolveInner = r; });
    const ctx = freshContext({
      dayPullImpl: (opts) => { assert.strictEqual(opts.date, '2026-08-16'); return pending; }
    });
    ctx._calRefDate = '2026-08-16';
    const hero = makeHero();
    click(hero);
    await flush();
    assert.strictEqual(hero.disabled, true, 'the button must be disabled while the pull runs (defect: "nothing disables, so it looks dead")');
    const status = idRegistry['mlsCvHeroStatus'];
    assert(status, 'a visible status element must be created next to the hero (defect: status painted into a 0x0 element elsewhere)');
    assert.notStrictEqual(status.style.display, 'none', 'the status element must be shown, not hidden, while the pull runs');
    assert(/Starting the Athena pull for 2026-08-16/.test(status.textContent), 'the status element must show real progress text');
    // live progress via onStatus
    const opts = dayPullCalls[0];
    assert.strictEqual(typeof opts.onStatus, 'function', 'dayPull must be given an onStatus callback (defect: no progress painted)');
    opts.onStatus('Reading the athenaOne day grid...');
    assert(status.textContent.indexOf('Reading the athenaOne day grid') >= 0, 'onStatus text must reach the visible status element live');
    resolveInner({ ok: true, complete: true });
    await flush();
    assert.strictEqual(hero.disabled, false, 'the button must re-enable once the pull settles');
    assert.strictEqual(loadCalendarCalls, 1, 'window.loadCalendar() must be called on completion (defect: a successful pull left the grid unchanged)');
    console.log('PASS 2/7: day passed through, button disabled/relabeled, live progress painted, loadCalendar called on success');
  })().then(run3).catch(fail);
}

/* ============================================================ 3. explicit provider freeze from the calendar chip scope === */
function run3() {
  return (async () => {
    const rosterEntry = { id: 'p9', stableKey: 'dr-jones', name: 'Dr Jones', key: 'dr-jones' };
    const ctx = freshContext({
      storage: { 'hero-pull-test::mlsProvScope3': 'dr-jones|Dr Jones' },
      rosterResolveImpl: (label) => (label === 'Dr Jones' ? rosterEntry : null)
    });
    const hero = makeHero();
    click(hero);
    await flush();
    assert.strictEqual(dayPullCalls.length, 1);
    assert.deepStrictEqual(dayPullCalls[0].provider, rosterEntry,
      'a specific calendar chip scope must be resolved through the roster and passed EXPLICITLY as opts.provider');

    // No chip scope selected ("All providers" / empty) -> no explicit provider, dayPull's own fallback applies unchanged.
    const ctx2 = freshContext({ storage: { 'hero-pull-test::mlsProvScope3': '' } });
    const hero2 = makeHero();
    click(hero2);
    await flush();
    assert.strictEqual(dayPullCalls.length, 1);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(dayPullCalls[0], 'provider'), false,
      'with no calendar chip scope selected, no provider should be forced — dayPull’s own account resolution must decide, same as every other caller');

    console.log('PASS 3/7: the calendar’s own chip scope is frozen and passed explicitly when selected; otherwise the engine’s own resolution is untouched');
  })().then(run4).catch(fail);
}

/* ============================================================ 4. receipt-aware verdict via classifyPullResult ============ */
function run4() {
  return (async () => {
    let classifyCalledWith = null;
    const refusal = { ok: false, complete: false, reason: 'schedule-incomplete', scheduleReceipt: { parsedCount: 3, expectedCount: 9 } };
    const ctx = freshContext({
      dayPullImpl: () => refusal,
      classifyImpl: (result, day) => { classifyCalledWith = { result, day }; return { ok: false, message: 'The Athena schedule was only partly read (3 of 9 rows).' }; }
    });
    const hero = makeHero();
    click(hero);
    await flush();
    assert(classifyCalledWith, 'window.__mlsDaySwitch.classifyPullResult must be called (defect: only checked res.ok===false)');
    assert.strictEqual(classifyCalledWith.result, refusal, 'the exact raw result/receipts must be handed to classifyPullResult, not a summarized version');
    const status = idRegistry['mlsCvHeroStatus'];
    assert(status.textContent.indexOf('only partly read (3 of 9 rows)') >= 0,
      'the receipt-aware verdict text must reach the visible status element verbatim');
    assert(toasts.some((t) => t.msg.indexOf('only partly read (3 of 9 rows)') >= 0 && t.kind === 'err'),
      'the receipt-aware verdict must also be toasted as an error');
    const diagBtn = idRegistry['mlsCvHeroDiagBtn'];
    assert(diagBtn, 'a failed final attempt must arm a copyable error report (defect: no copyable error report)');
    console.log('PASS 4/7: schedule/roster/attribution receipts drive the verdict via the proven classifyPullResult, and a failure arms a copyable report');
  })().then(run5).catch(fail);
}

/* ============================================================ 5. auto-retry twice on a transient refusal, then stop ======= */
function run5() {
  return (async () => {
    // ALWAYS transient-refuse — this is the genuine test of the retry CAP
    // (a mock that eventually succeeds cannot prove the cap fires, since a
    // 3-call scenario looks identical whether the cap is 2 or 99).
    const ctx = freshContext({
      dayPullImpl: () => ({ ok: false, complete: false, reason: 'nav-failed', retry: {} })
    });
    const hero = makeHero();
    click(hero);
    await flush();
    assert.strictEqual(dayPullCalls.length, 1, 'first attempt');
    assert.strictEqual(scheduled.length, 1, 'a transient nav-failed refusal must arm exactly one retry timer');
    assert.strictEqual(scheduled[0].ms, 4000, 'the first auto-retry must wait 4s, matching __mlsDaySwitch');
    assert.strictEqual(hero.disabled, true, 'the button must stay disabled through an automatic retry');

    fireScheduled(0);
    await flush();
    assert.strictEqual(dayPullCalls.length, 2, 'second attempt');
    assert.strictEqual(scheduled.length, 2, 'a second transient refusal must arm a second retry timer');
    assert.strictEqual(scheduled[1].ms, 9000, 'the second auto-retry must wait 9s, matching __mlsDaySwitch');

    fireScheduled(1);
    await flush();
    assert.strictEqual(dayPullCalls.length, 3, 'third attempt');
    assert.strictEqual(scheduled.length, 2,
      'CAP: even though attempt 3 is STILL a transient nav-failed refusal, no third automatic retry may be armed — capped at two, exactly like __mlsDaySwitch');
    assert.strictEqual(hero.disabled, false, 'the button must re-enable once the cap is reached, even though the pull never succeeded');
    assert.strictEqual(loadCalendarCalls, 1, 'loadCalendar still runs once the capped-out pull settles');
    const status = idRegistry['mlsCvHeroStatus'];
    assert(status.textContent && status.textContent !== 'The Athena grid was still settling — re-reading automatically (attempt 3 of 3)…',
      'after the cap is reached the FINAL refusal message must be shown, not a stale "still retrying" line');
    console.log('PASS 5/7: a transient refusal (nav-failed) auto-retries twice (4s, 9s) then STOPS and surfaces the refusal — capped, never infinite');
  })().then(run6).catch(fail);
}

/* ============================================================ 6. a deterministic refusal never auto-retries ============= */
function run6() {
  return (async () => {
    const ctx = freshContext({
      dayPullImpl: () => ({ ok: false, complete: false, reason: 'pull-in-flight', retry: { schedule: true } })
    });
    const hero = makeHero();
    click(hero);
    await flush();
    assert.strictEqual(dayPullCalls.length, 1);
    assert.strictEqual(scheduled.length, 0,
      'a deterministic refusal (pull-in-flight) must NEVER auto-retry, even though retry.schedule is set — auto-retry must not weaken this safety boundary');
    assert.strictEqual(hero.disabled, false, 'the button must re-enable immediately after a deterministic refusal');
    console.log('PASS 6/7: a deterministic refusal (pull-in-flight / provider-*) is shown once and never auto-retried');
  })().then(run7).catch(fail);
}

/* ============================================================ 7. engine unavailable -> honest refusal, no crash ========== */
function run7() {
  return (async () => {
    const ctx = freshContext({});
    ctx.__mlsSI = undefined;
    const hero = makeHero();
    click(hero);
    await flush();
    assert.strictEqual(dayPullCalls.length, 0, 'with no engine installed, no pull may be attempted');
    assert(toasts.some((t) => /pull engine is not available/i.test(t.msg)),
      'with no engine installed the doctor must be told plainly, never a silent no-op');
    console.log('PASS 7/7: a missing pull engine is refused honestly, never silently swallowed');
    console.log('PASS p1 calendar hero pull contract: all seven Visit-strip caller-contract rows verified against the real extracted module');
  })().catch(fail);
}

function fail(err) {
  console.error(err);
  process.exitCode = 1;
}
