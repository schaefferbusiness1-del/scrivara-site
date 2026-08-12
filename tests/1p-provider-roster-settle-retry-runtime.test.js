'use strict';

/* The p1 Visit-day pull owns a deliberately narrow recovery for one live
 * refusal: Athena returned a complete 24/24 Day schedule, but the all-provider
 * roster receipt was legacy-unverified. The existing retry budget stays at
 * two automatic retries (three pulls total); the only addition is a guarded
 * _warmUpDay immediately before each of those retries.
 *
 * This suite executes the real __mlsDaySwitch slice from 1p-mls-connect.js.
 * It proves the exact receipt gate, ordering, frozen-day/session/cross-engine
 * cancellation, exclusive lock/lease ownership for every special warm-up,
 * canceled attempt-3 escalation cleanup, and that ordinary transient retries
 * do not acquire the new warm-up behavior. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const start = source.indexOf('/* ===== __mlsDaySwitch');
const end = source.indexOf('/* ===== __mlsStorageJanitor', start);
assert(start >= 0 && end > start, 'p1 DaySwitch module markers are missing');
const moduleSource = source.slice(start, end);

const DAY = '2026-08-12';
const OTHER_DAY = '2026-08-13';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function rosterRefusal(overrides) {
  const result = {
    ok: false,
    complete: false,
    reason: 'provider-roster-incomplete',
    retry: { providerRoster: true },
    scheduleReceipt: {
      complete: true,
      parsedCount: 24,
      expectedCount: 24
    },
    providerRosterReceipt: {
      complete: false,
      partial: true,
      reason: 'legacy-unverified',
      providerMode: 'all',
      targetDate: DAY,
      observedCount: 3
    }
  };
  overrides = overrides || {};
  Object.keys(overrides).forEach(key => {
    if (key === 'scheduleReceipt' || key === 'providerRosterReceipt' || key === 'retry') {
      result[key] = Object.assign({}, result[key], overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  });
  return result;
}

function verifiedResult() {
  return {
    ok: true,
    complete: true,
    reason: 'complete',
    scheduleReceipt: { complete: true, parsedCount: 24, expectedCount: 24 },
    historyReceipt: { requested: 0, processed: 0, complete: true, patients: [], retry: [] }
  };
}

function createHarness(options) {
  options = options || {};
  const nodes = Object.create(null);
  const attributesFor = new WeakMap();
  const windowListeners = Object.create(null);
  const timers = [];
  const intervals = [];
  const pulls = [];
  const warms = [];
  const warmResolvers = [];
  const lockRequests = [];
  const clipboardWrites = [];
  const order = [];
  const statuses = [];
  const results = (options.results || [verifiedResult()]).map(clone);
  let lastEngineResult = null;
  let foreign = false;
  let timerSeq = 0;

  function makeNode(tag) {
    const attrs = Object.create(null);
    const node = {
      tagName: String(tag || 'div').toUpperCase(),
      style: { removeProperty(name) { delete this[name]; } },
      children: [],
      parentNode: null,
      disabled: false,
      checked: false,
      textContent: '',
      onclick: null,
      onchange: null,
      firstChild: null,
      firstElementChild: null,
      classList: { contains() { return false; }, remove() {}, add() {} },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        this.firstChild = this.children[0] || null;
        this.firstElementChild = this.firstChild;
        return child;
      },
      insertBefore(child, before) {
        child.parentNode = this;
        const index = before ? this.children.indexOf(before) : -1;
        if (index >= 0) this.children.splice(index, 0, child);
        else this.children.push(child);
        this.firstChild = this.children[0] || null;
        this.firstElementChild = this.firstChild;
        return child;
      },
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.parentNode = null;
        this.firstChild = this.children[0] || null;
        this.firstElementChild = this.firstChild;
        return child;
      },
      remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
        if (this._id) delete nodes[this._id];
      },
      setAttribute(name, value) { attrs[String(name)] = String(value); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, String(name)) ? attrs[String(name)] : null; },
      removeAttribute(name) { delete attrs[String(name)]; },
      querySelector(selector) {
        if (selector && selector.charAt(0) === '#') return nodes[selector.slice(1)] || null;
        return null;
      }
    };
    attributesFor.set(node, attrs);
    Object.defineProperty(node, 'id', {
      get() { return this._id || ''; },
      set(value) {
        if (this._id) delete nodes[this._id];
        this._id = String(value || '');
        if (this._id) nodes[this._id] = this;
      }
    });
    Object.defineProperty(node, 'innerHTML', {
      get() { return this._innerHTML || ''; },
      set(value) {
        this._innerHTML = String(value || '');
        const re = /<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi;
        let match;
        while ((match = re.exec(this._innerHTML))) {
          const child = makeNode(match[1]);
          child.id = match[2];
          this.appendChild(child);
        }
        /* The progress painter needs one anonymous fill div. */
        if (!this.firstElementChild && /^\s*<div\b/i.test(this._innerHTML)) this.appendChild(makeNode('div'));
      }
    });
    return node;
  }

  const head = makeNode('head');
  const appBody = makeNode('div');
  appBody.id = 'mlsEz3Body';
  const document = {
    readyState: 'complete',
    visibilityState: 'visible',
    head,
    body: appBody,
    documentElement: head,
    activeElement: null,
    getElementById(id) { return nodes[id] || null; },
    createElement(tag) { return makeNode(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {}
  };

  function fakeSetTimeout(fn, ms) {
    const timer = { id: ++timerSeq, fn, ms: Number(ms) || 0, canceled: false };
    timers.push(timer);
    return timer.id;
  }
  function fakeClearTimeout(id) {
    const timer = timers.find(item => item.id === id);
    if (timer) timer.canceled = true;
  }
  function fakeSetInterval(fn, ms) {
    const interval = { id: ++timerSeq, fn, ms: Number(ms) || 0, canceled: false };
    intervals.push(interval);
    return interval.id;
  }
  function fakeClearInterval(id) {
    const interval = intervals.find(item => item.id === id);
    if (interval) interval.canceled = true;
  }

  const fakeNavigator = {
    userAgent: 'p1-provider-roster-retry-test',
    clipboard: {
      writeText(value) {
        clipboardWrites.push(String(value));
        return Promise.resolve();
      }
    }
  };
  if (options.navigatorLocks) {
    fakeNavigator.locks = {
      request(name, requestOptions, callback) {
        const request = {
          name,
          options: Object.assign({}, requestOptions || {}),
          callbackStarted: false,
          callbackFinished: false,
          lock: null
        };
        lockRequests.push(request);
        if (options.lockRequestThrows) throw new Error('synthetic navigator lock request failure');
        const lock = options.lockUnavailable ? null : { name };
        request.lock = lock;
        request.callbackStarted = true;
        let callbackResult;
        try {
          callbackResult = callback(lock);
        } catch (error) {
          request.callbackFinished = true;
          return Promise.reject(error);
        }
        return Promise.resolve(callbackResult).then(value => {
          request.callbackFinished = true;
          return value;
        }, error => {
          request.callbackFinished = true;
          throw error;
        });
      }
    };
  }

  const context = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Promise, Error,
    Boolean, Intl, encodeURIComponent, decodeURIComponent,
    document,
    navigator: fakeNavigator,
    location: { pathname: '/1pScribeFlow.html' },
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function Event(type, init) { this.type = type; this.detail = init && init.detail; },
    addEventListener(type, fn) {
      (windowListeners[type] = windowListeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = windowListeners[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent(event) {
      (windowListeners[event && event.type] || []).slice().forEach(fn => fn(event));
      return true;
    },
    _acctTodayKey() { return DAY; },
    _calAppts: [],
    toast() {},
    __mlsEasyV32: {
      state() { return { mode: 'doctor', screen: 'home' }; },
      remote: { setVisitDay() { return true; } }
    },
    __mlsVisitNotesPref: {
      read() { return { state: 'on', on: true, settled: true }; },
      write() { return true; },
      isPrefKey() { return false; }
    },
    __mlsPullShieldForeign() { return foreign; },
    __mlsPullShieldTick() {},
    __mlsSI: {
      dayPull(opts) {
        pulls.push({
          date: opts && opts.date,
          provider: opts && opts.provider,
          lease: context.__mlsSchedulePullLease || null
        });
        order.push('pull:' + pulls.length);
        const next = results.length ? results.shift() : verifiedResult();
        lastEngineResult = clone(next);
        return Promise.resolve(clone(lastEngineResult));
      },
      pull(opts) { return this.dayPull(opts); },
      _lastPullResult() { return clone(lastEngineResult); },
      _warmUpDay(date, onStatus) {
        warms.push({
          date,
          hasStatus: typeof onStatus === 'function',
          lease: context.__mlsSchedulePullLease || null
        });
        order.push('warm:' + date);
        if (options.pendingWarm) {
          return new Promise(resolve => warmResolvers.push(resolve));
        }
        if (options.warmReject) return Promise.reject(new Error('synthetic warm refusal'));
        if (typeof onStatus === 'function') onStatus('Synthetic provider roster settle check.');
        return Promise.resolve({
          warmed: true,
          navOk: true,
          readOk: true,
          rosterComplete: true,
          observedDay: date,
          reason: 'complete'
        });
      }
    }
  };
  context.window = context;
  if (options.leaseUnavailable) {
    Object.defineProperty(context, '__mlsSchedulePullLease', {
      configurable: false,
      enumerable: true,
      get() { return undefined; },
      set() { throw new Error('synthetic schedule lease write failure'); }
    });
  }
  vm.runInNewContext(moduleSource, context, {
    filename: '1p-day-switch-provider-roster-retry.js',
    timeout: 2000
  });

  async function flush() {
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    await Promise.resolve();
  }
  function pendingTimers() { return timers.filter(timer => !timer.canceled); }
  function runNextTimer() {
    const timer = timers.find(item => !item.canceled);
    assert(timer, 'expected an automatic retry timer');
    timer.canceled = true;
    timer.fn();
    return timer;
  }
  function emit(type, detail) {
    context.dispatchEvent({ type, detail: detail || {} });
  }

  return {
    context,
    api: context.__mlsDaySwitch,
    pulls,
    warms,
    warmResolvers,
    lockRequests,
    clipboardWrites,
    order,
    statuses,
    pendingTimers,
    runNextTimer,
    flush,
    emit,
    setForeign(value) { foreign = !!value; }
  };
}

async function startAndSettleFirst(h) {
  h.api.pullDay();
  await h.flush();
  assert.strictEqual(h.pulls.length, 1, 'the manual pull did not reach the real DaySwitch pull path');
}

async function testExactWarmAndBound() {
  const h = createHarness({ results: [rosterRefusal(), rosterRefusal(), rosterRefusal()] });
  await startAndSettleFirst(h);

  assert.strictEqual(h.warms.length, 0, 'the first pull must settle before the delayed roster warm-up');
  assert.deepStrictEqual(h.pendingTimers().map(timer => timer.ms), [4000],
    'the first automatic retry must retain the existing 4-second settle delay');

  h.runNextTimer();
  await h.flush();
  assert.strictEqual(h.pulls.length, 2, 'the first warmed retry did not restart the pull');
  assert.deepStrictEqual(h.order.slice(0, 3), ['pull:1', 'warm:' + DAY, 'pull:2'],
    'the exact all-provider refusal must warm the frozen day before retrying');
  assert.strictEqual(h.warms[0].date, DAY, 'the first warm-up did not use the frozen pull date');
  assert.strictEqual(h.warms[0].hasStatus, true, 'the warm-up lost the live DaySwitch status sink');
  assert.ok(h.warms[0].lease && String(h.warms[0].lease.id || ''),
    'the first special warm-up did not begin under its own schedule-pull lease');
  assert.strictEqual(h.context.__mlsSchedulePullLease, undefined,
    'the first special warm-up lease was not released before its pull restarted');
  assert.deepStrictEqual(h.pendingTimers().map(timer => timer.ms), [9000],
    'the second automatic retry must retain the existing 9-second settle delay');

  h.runNextTimer();
  await h.flush();
  assert.strictEqual(h.pulls.length, 3, 'the second warmed retry did not run');
  assert.deepStrictEqual(h.order, [
    'pull:1', 'warm:' + DAY, 'pull:2', 'warm:' + DAY, 'pull:3'
  ], 'each bounded retry must be preceded by exactly one roster warm-up');
  assert.deepStrictEqual(h.pulls.map(call => call.date), [DAY, DAY, DAY],
    'an automatic retry drifted away from the original selected day');
  assert.strictEqual(h.warms.length, 2, 'the three-pull budget must perform exactly two warm-ups');
  assert.ok(h.warms[1].lease && String(h.warms[1].lease.id || ''),
    'the second special warm-up did not begin under its own schedule-pull lease');
  assert.notStrictEqual(h.warms[1].lease.id, h.warms[0].lease.id,
    'separate special warm-ups reused a stale schedule-pull lease identity');
  assert.strictEqual(h.context.__mlsSchedulePullLease, undefined,
    'the second special warm-up lease was not released after settling');
  assert.strictEqual(h.pendingTimers().length, 0,
    'a persistent legacy-unverified refusal exceeded the maximum of three pulls');
}

async function testWarmLeaseLifetimeAndNavigatorLock() {
  const h = createHarness({
    results: [rosterRefusal(), verifiedResult()],
    pendingWarm: true,
    navigatorLocks: true
  });
  await startAndSettleFirst(h);
  h.runNextTimer();
  await h.flush();

  assert.strictEqual(h.lockRequests.length, 1,
    'the special roster warm-up did not request the browser-wide Athena pull lock');
  assert.strictEqual(h.lockRequests[0].name, 'mls-managed-athena-pull',
    'the special warm-up requested the wrong browser lock name');
  assert.strictEqual(h.lockRequests[0].options.mode, 'exclusive',
    'the special warm-up browser lock was not exclusive');
  assert.strictEqual(h.lockRequests[0].options.ifAvailable, true,
    'the special warm-up browser lock could wait behind or overlap another pull');
  assert.ok(h.lockRequests[0].lock, 'the lock-granted scenario did not hand the callback a lock');
  assert.strictEqual(h.lockRequests[0].callbackStarted, true,
    'the granted lock callback did not begin');
  assert.strictEqual(h.lockRequests[0].callbackFinished, false,
    'the browser lock was released before the pending roster warm-up settled');
  assert.strictEqual(h.warms.length, 1, 'the granted lock did not reach the special warm-up');

  const ownedLease = h.context.__mlsSchedulePullLease;
  assert.ok(ownedLease && String(ownedLease.id || ''),
    'the pending special warm-up did not publish its own schedule-pull lease');
  assert.strictEqual(h.warms[0].lease, ownedLease,
    'the schedule-pull lease changed between acquisition and _warmUpDay');
  assert.ok(Number.isFinite(Number(ownedLease.at)) && Date.now() - Number(ownedLease.at) < 5000,
    'the special warm-up lease did not carry a fresh timestamp');
  assert.strictEqual(h.pulls.length, 1,
    'the automatic retry started before the guarded warm-up settled');

  h.warmResolvers.shift()({
    warmed: true,
    navOk: true,
    readOk: true,
    rosterComplete: true,
    observedDay: DAY,
    reason: 'complete'
  });
  await h.flush();

  assert.strictEqual(h.lockRequests[0].callbackFinished, true,
    'the browser lock remained held after the special warm-up completed');
  assert.strictEqual(h.context.__mlsSchedulePullLease, undefined,
    'the owned schedule-pull lease remained after the special warm-up completed');
  assert.strictEqual(h.pulls.length, 2,
    'the retry did not restart after both guarded warm-up locks were released');
  assert.strictEqual(h.pulls[1].lease, null,
    'the retry inherited the special warm-up schedule lease');
}

async function testNeverSettlingWarmTimesOutAndRetries() {
  const h = createHarness({
    results: [rosterRefusal(), verifiedResult()],
    pendingWarm: true,
    navigatorLocks: true
  });
  await startAndSettleFirst(h);
  h.runNextTimer();
  await h.flush();

  assert.strictEqual(h.warms.length, 1,
    'the never-settling scenario did not enter the special warm-up');
  assert.ok(h.context.__mlsSchedulePullLease && h.context.__mlsSchedulePullLease.id,
    'the never-settling warm-up did not own the local schedule lease');
  assert.strictEqual(h.lockRequests.length, 1,
    'the never-settling warm-up did not own the managed Athena browser lock');
  assert.strictEqual(h.lockRequests[0].callbackFinished, false,
    'the managed Athena browser lock ended before the never-settling warm timed out');
  assert.strictEqual(h.pulls.length, 1,
    'the real retry started while its advisory warm-up was still pending');

  const timeout = h.pendingTimers().find(timer => timer.ms === 95000);
  assert.ok(timeout,
    'the p1 retry did not install its 95-second outer ceiling beyond the shared 60s navigation + 30s read ceilings');
  timeout.canceled = true;
  timeout.fn();
  await h.flush();

  assert.strictEqual(h.context.__mlsSchedulePullLease, undefined,
    'the timed-out warm-up stranded its owned local schedule lease');
  assert.strictEqual(h.lockRequests[0].callbackFinished, true,
    'the timed-out warm-up stranded the managed Athena browser lock');
  assert.strictEqual(h.pulls.length, 2,
    'the p1-owned warm-up timeout blocked the existing real automatic retry');
  assert.strictEqual(h.pulls[1].date, DAY,
    'the real retry after warm-up timeout drifted from the frozen selected day');
  assert.strictEqual(h.pulls[1].provider, undefined,
    'the attempt-2 retry after warm-up timeout unexpectedly escalated provider scope');
  assert.deepStrictEqual(h.order, ['pull:1', 'warm:' + DAY, 'pull:2'],
    'the timeout changed the existing warm-then-real-retry order');
  assert.strictEqual(h.pendingTimers().length, 0,
    'a successful real retry after the timeout escaped the existing bounded retry budget');
  const pullButton = h.context.document.getElementById('mlsDsPullBtn');
  assert.ok(pullButton && pullButton.disabled === false,
    'DaySwitch remained blocked after the timeout and real retry settled');

  const diagButton = h.context.document.getElementById('mlsDsDiagBtn');
  assert.ok(diagButton && typeof diagButton.onclick === 'function',
    'the PHI-free diagnostic control was unavailable after the timeout');
  diagButton.onclick();
  await h.flush();
  assert.ok(h.clipboardWrites.length > 0,
    'the timeout diagnostic report was not copyable');
  const report = JSON.parse(h.clipboardWrites[h.clipboardWrites.length - 1]);
  const receipt = report && report.result && report.result.providerRosterRetryReceipt;
  assert.deepStrictEqual(receipt, {
    attempt: 1,
    targetDate: DAY,
    warmed: false,
    navOk: false,
    readOk: false,
    rosterComplete: false,
    observedDay: '',
    reason: 'warmup-timeout'
  }, 'the timeout did not publish the expected bounded, reason-code-only retry receipt');
  assert.doesNotMatch(JSON.stringify(receipt), /patient|member|chart|dob|mrn|name|detail|message|error/i,
    'the warm-up timeout retry receipt exposed a PHI-capable field');
}

async function testWarmAcquisitionRefusals() {
  /* An already-owned same-page lease must cancel before the advisory warm can
     navigate Athena. It must also remain untouched by the canceled attempt. */
  const taken = createHarness({ results: [rosterRefusal(), verifiedResult()] });
  await startAndSettleFirst(taken);
  const foreignLease = { id: 'foreign-engine', at: Date.now() };
  taken.context.__mlsSchedulePullLease = foreignLease;
  taken.runNextTimer();
  await taken.flush();
  assert.strictEqual(taken.warms.length, 0, 'a taken schedule lease still allowed the special warm-up');
  assert.strictEqual(taken.pulls.length, 1, 'a taken schedule lease still allowed the automatic retry');
  assert.strictEqual(taken.context.__mlsSchedulePullLease, foreignLease,
    'the canceled special warm-up disturbed a foreign schedule lease');

  /* A browser that exposes LockManager must grant the exact non-waiting lock;
     a null ifAvailable callback is a refusal, not permission to warm anyway. */
  const unavailableLock = createHarness({
    results: [rosterRefusal(), verifiedResult()],
    navigatorLocks: true,
    lockUnavailable: true
  });
  await startAndSettleFirst(unavailableLock);
  unavailableLock.runNextTimer();
  await unavailableLock.flush();
  assert.strictEqual(unavailableLock.lockRequests.length, 1,
    'the unavailable-lock scenario never requested the managed Athena lock');
  assert.strictEqual(unavailableLock.lockRequests[0].name, 'mls-managed-athena-pull');
  assert.strictEqual(unavailableLock.lockRequests[0].options.mode, 'exclusive');
  assert.strictEqual(unavailableLock.lockRequests[0].options.ifAvailable, true);
  assert.strictEqual(unavailableLock.lockRequests[0].lock, null,
    'the unavailable-lock harness unexpectedly granted a lock');
  assert.strictEqual(unavailableLock.warms.length, 0,
    'the special warm-up ran without receiving the required browser lock');
  assert.strictEqual(unavailableLock.pulls.length, 1,
    'the automatic retry ran after its required browser lock was refused');
  assert.strictEqual(unavailableLock.context.__mlsSchedulePullLease, undefined,
    'a browser-lock refusal leaked the local schedule lease');

  /* Failure to publish and verify our own local lease is also fail-closed. */
  const unavailableLease = createHarness({
    results: [rosterRefusal(), verifiedResult()],
    leaseUnavailable: true
  });
  await startAndSettleFirst(unavailableLease);
  unavailableLease.runNextTimer();
  await unavailableLease.flush();
  assert.strictEqual(unavailableLease.warms.length, 0,
    'the special warm-up ran even though it could not acquire its own schedule lease');
  assert.strictEqual(unavailableLease.pulls.length, 1,
    'the automatic retry ran after local schedule lease acquisition failed');
}

async function testFrozenDateCancellation() {
  const h = createHarness({ results: [rosterRefusal(), verifiedResult()], pendingWarm: true });
  await startAndSettleFirst(h);
  h.runNextTimer();
  assert.strictEqual(h.warms.length, 1, 'the delayed retry did not begin its warm-up');
  assert.strictEqual(h.warms[0].date, DAY, 'the warm-up did not capture the original day');

  /* Exercise the real Easy-to-DaySwitch event seam while the advisory warm is
     pending. The retry must not follow the user onto the newly selected day. */
  h.emit('mls:easy-visit-day-changed', { day: OTHER_DAY });
  assert.strictEqual(h.api.currentDay(), OTHER_DAY, 'the selected-day change did not reach DaySwitch');
  h.warmResolvers.shift()({ warmed: true, navOk: true, readOk: true, rosterComplete: true, observedDay: DAY });
  await h.flush();
  assert.strictEqual(h.pulls.length, 1, 'a frozen-day retry ran after the selected day changed');
  assert.strictEqual(h.pendingTimers().length, 0, 'a canceled frozen-day retry scheduled more work');
}

async function testCrossEngineAndSessionCancellation() {
  /* A foreign-tab shield appearing during the settle delay cancels before the
     new warm-up can navigate or read Athena. */
  const foreign = createHarness({ results: [rosterRefusal(), verifiedResult()] });
  await startAndSettleFirst(foreign);
  foreign.setForeign(true);
  foreign.runNextTimer();
  await foreign.flush();
  assert.strictEqual(foreign.warms.length, 0, 'a foreign pull did not stop the roster warm-up');
  assert.strictEqual(foreign.pulls.length, 1, 'a retry overlapped the foreign pull shield');

  /* A same-page schedule lease can appear while the advisory read is in
     flight. The second guard, after the promise settles, must still cancel. */
  const lease = createHarness({ results: [rosterRefusal(), verifiedResult()], pendingWarm: true });
  await startAndSettleFirst(lease);
  lease.runNextTimer();
  assert.strictEqual(lease.warms.length, 1, 'the lease scenario did not reach the warm-up boundary');
  assert.ok(lease.context.__mlsSchedulePullLease && lease.context.__mlsSchedulePullLease.id,
    'the pending warm-up did not own a schedule lease before the overlap simulation');
  const replacementLease = { id: 'foreign-engine', at: Date.now() };
  lease.context.__mlsSchedulePullLease = replacementLease;
  lease.warmResolvers.shift()({ warmed: true, navOk: true, readOk: true, rosterComplete: true, observedDay: DAY });
  await lease.flush();
  assert.strictEqual(lease.pulls.length, 1, 'a retry overlapped a live schedule-pull lease');
  assert.strictEqual(lease.context.__mlsSchedulePullLease, replacementLease,
    'release of the lost warm-up lease deleted a newer foreign lease');

  /* A login/session boundary invalidates the captured serial even when the
     selected date happens to remain Today. */
  const session = createHarness({ results: [rosterRefusal(), verifiedResult()] });
  await startAndSettleFirst(session);
  session.api.resetSession();
  session.runNextTimer();
  await session.flush();
  assert.strictEqual(session.warms.length, 0, 'a stale-session retry still warmed Athena');
  assert.strictEqual(session.pulls.length, 1, 'a stale-session retry restarted the pull');
}

async function testExactClassifierAndOrdinaryRetries() {
  const cases = [
    ['ordinary schedule-incomplete retry', rosterRefusal({
      reason: 'schedule-incomplete',
      retry: { providerRoster: false, schedule: true },
      scheduleReceipt: { complete: false }
    })],
    ['schedule receipt is not complete', rosterRefusal({ scheduleReceipt: { complete: false } })],
    ['roster receipt is already complete', rosterRefusal({ providerRosterReceipt: { complete: true } })],
    ['roster receipt is not partial', rosterRefusal({ providerRosterReceipt: { partial: false } })],
    ['roster reason is not legacy-unverified', rosterRefusal({ providerRosterReceipt: { reason: 'scroll-budget' } })],
    ['provider mode is selected', rosterRefusal({ providerRosterReceipt: { providerMode: 'selected' } })],
    ['roster receipt belongs to another day', rosterRefusal({ providerRosterReceipt: { targetDate: OTHER_DAY } })],
    ['top-level refusal is not provider-roster-incomplete', rosterRefusal({ reason: 'provider-incomplete' })]
  ];

  for (const [label, firstResult] of cases) {
    const h = createHarness({ results: [firstResult, verifiedResult()] });
    await startAndSettleFirst(h);
    assert.strictEqual(h.pendingTimers().length, 1, label + ': existing bounded retry was lost');
    h.runNextTimer();
    await h.flush();
    assert.strictEqual(h.pulls.length, 2, label + ': existing retry did not run');
    assert.strictEqual(h.warms.length, 0, label + ': received the special all-provider roster warm-up');
    assert.deepStrictEqual(h.order, ['pull:1', 'pull:2'], label + ': ordinary retry ordering changed');
  }
}

function scheduleIncompleteRefusal() {
  return rosterRefusal({
    reason: 'schedule-incomplete',
    retry: { providerRoster: false, schedule: true },
    scheduleReceipt: { complete: false }
  });
}

async function reachAttemptThreeTimer(h) {
  await startAndSettleFirst(h);
  assert.deepStrictEqual(h.pendingTimers().map(timer => timer.ms), [4000],
    'schedule-incomplete did not schedule automatic attempt 2');
  h.runNextTimer();
  await h.flush();
  assert.strictEqual(h.pulls.length, 2, 'schedule-incomplete automatic attempt 2 did not run');
  assert.deepStrictEqual(h.pendingTimers().map(timer => timer.ms), [9000],
    'the second schedule-incomplete refusal did not schedule escalated attempt 3');
}

async function testCanceledAttemptThreeClearsEscalation() {
  /* First prove the control: an uncanceled third attempt still uses the
     long-standing whole-grid escalation. */
  const control = createHarness({
    results: [scheduleIncompleteRefusal(), scheduleIncompleteRefusal(), verifiedResult()]
  });
  await reachAttemptThreeTimer(control);
  control.runNextTimer();
  await control.flush();
  assert.strictEqual(control.pulls.length, 3, 'the uncanceled third attempt did not run');
  assert.strictEqual(control.pulls[2].provider, 'all',
    'the uncanceled third attempt lost its deliberate whole-grid escalation');

  async function assertManualDoesNotInherit(label, prepareCancellation, restoreAfterCancellation) {
    const h = createHarness({
      results: [scheduleIncompleteRefusal(), scheduleIncompleteRefusal(), verifiedResult()]
    });
    await reachAttemptThreeTimer(h);
    prepareCancellation(h);
    h.runNextTimer();
    await h.flush();
    assert.strictEqual(h.pulls.length, 2, label + ': the canceled automatic attempt still pulled');
    if (restoreAfterCancellation) restoreAfterCancellation(h);
    h.api.pullDay();
    await h.flush();
    assert.strictEqual(h.pulls.length, 3, label + ': the next manual pull did not run');
    assert.notStrictEqual(h.pulls[2].provider, 'all',
      label + ': the next manual pull inherited canceled attempt-3 provider escalation');
  }

  await assertManualDoesNotInherit(
    'foreign pull cancellation',
    h => h.setForeign(true),
    h => h.setForeign(false)
  );
  await assertManualDoesNotInherit(
    'selected-day cancellation',
    h => h.emit('mls:easy-visit-day-changed', { day: OTHER_DAY })
  );
  await assertManualDoesNotInherit(
    'session-boundary cancellation',
    h => h.api.resetSession()
  );
}

async function main() {
  await testExactWarmAndBound();
  await testWarmLeaseLifetimeAndNavigatorLock();
  await testNeverSettlingWarmTimesOutAndRetries();
  await testWarmAcquisitionRefusals();
  await testFrozenDateCancellation();
  await testCrossEngineAndSessionCancellation();
  await testExactClassifierAndOrdinaryRetries();
  await testCanceledAttemptThreeClearsEscalation();
  console.log('PASS p1 provider-roster settle retry: exact 24/24 legacy-unverified all-provider receipts warm the frozen day under exclusive browser/local ownership before at most two retries; never-settling warms time out PHI-free and release both guards; cancellation clears attempt-3 escalation; all other retry classes keep their original no-special-warm path');
}

const watchdog = setTimeout(() => {
  console.error(new Error('p1 provider-roster settle retry runtime test did not finish'));
  process.exit(1);
}, 15000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
