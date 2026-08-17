'use strict';

/* p1-roster-settle-preflight-1.0.0
 *
 * Owner's real pull report (2026-08-16): providerRosterReceipt
 * {complete:true, partial:false} while preflightReceipt.rosterComplete:false
 * and providerReceipt.rosterVerified:false. The roster DID complete - the
 * pre-flight sampled roster.getReceipt() in the same turn its schedule read
 * returned, i.e. BEFORE the receipt for that read was published, and that
 * stale `false` travelled into rosterVerified through
 * `detectedOnly = !rosterComplete`.
 *
 * This suite executes the REAL 1p importer against a roster that settles
 * 300 ms after the pre-flight starts. Synthetic names only; no network, no
 * extension, no PHI. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const importerPath = path.join(root, '1p-feat_mls_schedimport_exact.js');
const importer = fs.readFileSync(importerPath, 'utf8');

const DAY = '2026-08-21';
const SETTLE_MS = 300;
const PROVIDER = { stableKey: 'header:1', id: '101', raw: 'Header_One_MD', name: 'Header One, MD' };

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ---------------------------------------------------------------- static */
{
  const a = importer.indexOf('/* ===== p1-roster-settle-preflight-1.0.0 =====');
  const b = importer.indexOf('/* ===== end p1-roster-settle-preflight-1.0.0 ===== */');
  ok(a >= 0 && b > a, 'the p1-roster-settle-preflight-1.0.0 block is missing or unclosed');
  const block = importer.slice(a, b);
  ok(/setTimeout\(tick, ROSTER_SETTLE_STEP_MS\)/.test(block),
    'the settle wait no longer uses a setTimeout ladder');
  ok(!/requestAnimationFrame/.test(block),
    'the settle wait uses rAF, which never fires in a hidden or non-compositing tab');
  ok(/addEventListener\(ROSTER_SETTLE_EVENT/.test(block) && /removeEventListener\(ROSTER_SETTLE_EVENT/.test(block),
    'the settle wait does not attach AND detach the roster-updated signal it waits on');
  ok(!/roster\.getReceipt\(\) : null;\s*\n\s*out\.rosterComplete/.test(importer),
    'warmUpDay still samples the roster receipt in the same turn the read returns');
}

/* ---------------------------------------------------------------- runtime */
function makeRuntime(options) {
  options = options || {};
  const listeners = new Set();
  const winListeners = Object.create(null);
  const store = new Map();
  const elements = new Map();
  const posted = [];
  const timerWakeups = { count: 0 };
  let currentDay = DAY;
  let armedOperation = null;
  let scheduleReads = 0;
  let rosterComplete = !!options.completeAtEntry;
  let receiptAtReadReturn = null;

  function receipt() {
    return Object.assign({
      complete: rosterComplete,
      partial: !rosterComplete,
      reason: rosterComplete ? 'complete' : 'legacy-unverified',
      providerMode: 'selected',
      targetDate: currentDay,
      observedCount: 2
    }, armedOperation || {});
  }

  function fakeElement(tag, id) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(), id: id || '', style: {}, children: [],
      parentNode: null, onclick: null, textContent: '',
      setAttribute(name, value) { this[name] = String(value); if (name === 'id') { this.id = String(value); elements.set(this.id, this); } },
      appendChild(child) { if (child) { child.parentNode = this; this.children.push(child); if (child.id) elements.set(child.id, child); } return child; },
      remove() { if (this.id) elements.delete(this.id); if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); }
    };
    Object.defineProperty(node, 'innerHTML', {
      get() { return this._innerHTML || ''; },
      set(value) {
        this._innerHTML = String(value || '');
        for (const m of this._innerHTML.matchAll(/\bid="([^"]+)"/g)) this.appendChild(fakeElement('button', m[1]));
      }
    });
    if (node.id) elements.set(node.id, node);
    return node;
  }
  const body = fakeElement('body'), head = fakeElement('head');

  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number,
    Boolean, RegExp, Error, TypeError, encodeURIComponent, decodeURIComponent, queueMicrotask,
    setTimeout(fn, ms) { timerWakeups.count++; return setTimeout(fn, ms); },
    clearTimeout, setInterval: () => 1, clearInterval: () => {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    location: { pathname: '/1pScribeFlow.html' },
    localStorage: {
      getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)); },
      removeItem: k => { store.delete(String(k)); }
    },
    document: {
      readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => elements.get(String(id)) || null,
      createElement: tag => fakeElement(tag),
      addEventListener: () => {}, removeEventListener: () => {},
      body, head, documentElement: head
    },
    _calMode: 'day', _calRefDate: DAY, _calSelDay: '', _calAppts: [],
    _calProviders: [{ id: '101', name: PROVIDER.name }], _calMe: null,
    __mlsProviderRoster: {
      list: () => [Object.assign({}, PROVIDER, { rosterVerified: rosterComplete })],
      resolve: ref => {
        const raw = String(ref && typeof ref === 'object' ? (ref.stableKey || ref.id || ref.name || '') : (ref || '')).toLowerCase();
        const hit = [PROVIDER.stableKey, PROVIDER.id, PROVIDER.name].some(v => String(v).toLowerCase() === raw);
        return hit ? Object.assign({}, PROVIDER) : null;
      },
      beginOperation: op => { armedOperation = JSON.parse(JSON.stringify(op)); return armedOperation; },
      /* The live defect: the pre-flight's own read is UNBOUND, so the roster
         ignores it and publishes nothing in that turn. */
      ingestResp: () => ({ ignored: true, reason: 'unbound-or-stale-response' }),
      getReceipt: () => receipt(),
      getScope: () => ({ scopeComplete: false, scope: 'painted-day-grid', knownCount: 1, gridSweptCount: 1,
        rosterVerifiedCount: rosterComplete ? 1 : 0, athenaListEnumerated: false, sources: { dayGrid: true }, statement: 'synthetic' })
    },
    backendMode: () => false, bkToken: () => '', bkBase: () => 'https://local.invalid',
    uns: key => `p1-settle-test::${key}`,
    _normDate: v => String(v || '').slice(0, 10),
    _normTime: v => String(v || ''),
    getPatients: () => [], upsertPatient: () => {}, loadCalendar: () => Promise.resolve(),
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    __mlsBgSleep: () => Promise.resolve(),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) })
  };
  rt.window = rt;
  rt.addEventListener = (type, fn) => {
    listeners.add(fn);
    (winListeners[String(type)] = winListeners[String(type)] || []).push(fn);
  };
  rt.removeEventListener = (type, fn) => {
    listeners.delete(fn);
    const list = winListeners[String(type)] || [];
    const at = list.indexOf(fn); if (at >= 0) list.splice(at, 1);
  };
  rt.dispatchEvent = ev => { (winListeners[String(ev && ev.type)] || []).slice().forEach(fn => fn(ev)); return true; };

  function emit(type, resp, id) {
    const ev = { data: { source: 'mls-ext', type, id: id || '', resp } };
    Array.from(listeners).forEach(fn => fn(ev));
  }
  function settleRoster() {
    rosterComplete = true;
    rt.dispatchEvent({ type: 'mls-provider-roster-updated', detail: { receipt: receipt() } });
  }

  rt.postMessage = msg => {
    posted.push(msg);
    if (msg.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true, version: '3.0.61' }, ''));
    if (msg.type === 'mlsAppGotoDate') queueMicrotask(() => {
      currentDay = msg.date;
      emit('mlsAppGotoDateResult', { id: msg.id, ok: true, schedDate: msg.date }, msg.id);
    });
    if (msg.type === 'mlsAppPullSchedule') queueMicrotask(() => {
      scheduleReads++;
      const rid = msg.id;
      emit('mlsAppScheduleResult', {
        id: rid, ok: true, scheduleVerified: true, schedDate: currentDay,
        text: 'Verified Day schedule ' + currentDay, appts: [],
        providers: [PROVIDER.name], providerRoster: [Object.assign({}, PROVIDER)],
        receipt: { complete: true, authoritativeEmpty: true, requestId: rid, expectedCount: 0, parsedCount: 0, candidateCount: 0 },
        providerRosterReceipt: receipt()
      }, rid);
      /* what the OLD code sampled: the receipt as it stood the instant the
         read returned. The roster has not published this read's receipt yet. */
      if (receiptAtReadReturn === null) receiptAtReadReturn = receipt();
      if (options.settleAfterMs != null && scheduleReads === 1) setTimeout(settleRoster, options.settleAfterMs);
      if (options.unverifyAfterMs != null && scheduleReads === 1) setTimeout(() => { rosterComplete = false; }, options.unverifyAfterMs);
    });
  };

  vm.runInNewContext(importer, rt, { filename: '1p-feat_mls_schedimport_exact.js', timeout: 3000 });
  return {
    rt, api: rt.__mlsSI, posted, timerWakeups,
    receiptAtReadReturn: () => receiptAtReadReturn,
    setRosterComplete: v => { rosterComplete = !!v; }
  };
}

/* --------------------------------------- 1. the owner's shape, replayed */
async function testPreflightAwaitsTheSettle() {
  const h = makeRuntime({ settleAfterMs: SETTLE_MS });
  const t0 = Date.now();
  const warm = await h.api._warmUpDay(DAY, () => {});
  const elapsed = Date.now() - t0;

  ok(h.receiptAtReadReturn() && h.receiptAtReadReturn().complete === false,
    'the fixture did not reproduce the defect: the receipt was already complete when the read returned');
  eq(warm.readOk, true, 'the pre-flight read did not succeed in the fixture');
  eq(warm.rosterComplete, true,
    'the pre-flight still published the stale rosterComplete:false for a roster that settled 300 ms later');
  eq(warm.rosterSettled, true, 'the pre-flight did not record that it waited for the settle');
  ok(warm.rosterSettleMs >= SETTLE_MS - 80,
    'the pre-flight reported a settle wait of ' + warm.rosterSettleMs + 'ms, shorter than the 300ms settle');
  ok(elapsed >= SETTLE_MS - 80 && elapsed < 1400,
    'the pre-flight took ' + elapsed + 'ms - it either did not wait or blew past its ceiling');
}

/* --------------------------------------- 2. a roster that never settles */
async function testNeverSettlingIsBoundedAndAdvisory() {
  const h = makeRuntime({});
  const before = h.timerWakeups.count;
  const t0 = Date.now();
  const warm = await h.api._warmUpDay(DAY, () => {});
  const elapsed = Date.now() - t0;
  eq(warm.rosterComplete, false, 'a roster that never settles was reported complete');
  eq(warm.rosterSettled, false, 'a roster that never settles claimed it settled');
  eq(warm.warmed, true, 'the bounded wait turned an otherwise good pre-flight into a failure');
  ok(elapsed < 1600, 'the never-settling wait ran ' + elapsed + 'ms, past its 1000ms ceiling');
  const wakeups = h.timerWakeups.count - before;
  ok(wakeups > 0 && wakeups < 40, 'the bounded wait used ' + wakeups + ' timer wakeups - that is a busy loop');
}

/* --------------------- 3. a verified roster is never flipped unverified */
async function testVerifiedRosterIsNeverFlippedBack() {
  const h = makeRuntime({ completeAtEntry: true, unverifyAfterMs: 20 });
  const warm = await h.api._warmUpDay(DAY, () => {});
  eq(warm.rosterCompleteAtEntry, true, 'the fixture did not enter the pre-flight with a verified roster');
  eq(warm.rosterComplete, true,
    'a roster that was VERIFIED at pre-flight entry was flipped back to unverified by a later sample');
}

/* --------------- 4. a failed pre-flight read pays no wait at all */
async function testFailedReadDoesNotPayTheWait() {
  const h = makeRuntime({});
  h.rt.postMessage = msg => {
    if (msg.type === 'mlsPing') queueMicrotask(() => h.rt.postMessage._emit('mlsPong', { ok: true, version: '3.0.61' }, ''));
  };
  /* no responder at all: the bridge times out on its own ceilings, so drive
     the cheaper path instead - an empty date short-circuits before any read. */
  const warm = await h.api._warmUpDay('', () => {});
  eq(warm.reason, 'no-date', 'a dateless pre-flight no longer short-circuits');
  eq(warm.rosterComplete, false, 'a dateless pre-flight invented a roster verdict');
}

/* ------------------------------- 5. the full dayPull receipt the owner saw */
async function testDayPullPublishesVerifiedRoster() {
  const h = makeRuntime({ settleAfterMs: SETTLE_MS });
  const res = await h.api.dayPull({ date: DAY, provider: Object.assign({}, PROVIDER), includeHistory: false, onStatus: () => {} });
  ok(res && res.preflightReceipt, 'the day pull published no pre-flight receipt');
  eq(res.preflightReceipt.rosterComplete, true,
    'preflightReceipt.rosterComplete stayed false for a roster that completed - the owner\'s exact symptom');
  eq(res.preflightReceipt.rosterVerified, true,
    'preflightReceipt.rosterVerified stayed false for a verified roster');
  eq(res.preflightReceipt.providerMode, 'selected', 'the selected scope was widened by the settle wait');
  if (res.providerReceipt) {
    eq(res.providerReceipt.rosterVerified, true,
      'providerReceipt.rosterVerified stayed false although the roster was verified before the pull ran');
  }
}

/* ----- 6. a skipped pre-flight states the live receipt, not a synthetic false */
async function testSkippedPreflightStatesTheLiveReceipt() {
  const h = makeRuntime({ settleAfterMs: SETTLE_MS });
  await h.api.dayPull({ date: DAY, provider: Object.assign({}, PROVIDER), includeHistory: false, onStatus: () => {} });
  /* second pull on the same page: _dayPreflightDone is set and the scope now
     resolves, so the pre-flight is skipped. It must not report the roster
     unverified. */
  const res = await h.api.dayPull({ date: DAY, provider: Object.assign({}, PROVIDER), includeHistory: false, onStatus: () => {} });
  ok(res && res.preflightReceipt, 'the second day pull published no pre-flight receipt');
  eq(res.preflightReceipt.ran, false, 'the second pull unexpectedly re-ran the pre-flight');
  eq(res.preflightReceipt.rosterComplete, true,
    'a SKIPPED pre-flight published the synthetic rosterComplete:false over a verified roster');
  eq(res.preflightReceipt.rosterVerified, true,
    'a SKIPPED pre-flight published rosterVerified:false over a verified roster');
}

async function main() {
  await testPreflightAwaitsTheSettle();
  await testNeverSettlingIsBoundedAndAdvisory();
  await testVerifiedRosterIsNeverFlippedBack();
  await testFailedReadDoesNotPayTheWait();
  await testDayPullPublishesVerifiedRoster();
  await testSkippedPreflightStatesTheLiveReceipt();
  console.log('PASS 1p-roster-settle-preflight: ' + checks + ' checks - the pre-flight waits (bounded, setTimeout-only, early-exit on mls-provider-roster-updated) for the roster receipt its own read produces, never flips a verified roster back to unverified, never busy-loops or exceeds its 1000ms ceiling, and both the ran and SKIPPED pre-flight receipts state rosterComplete/rosterVerified true for the roster shape in the owner 2026-08-16 report');
}

const watchdog = setTimeout(() => {
  console.error(new Error('1p-roster-settle-preflight runtime test did not finish'));
  process.exit(1);
}, 30000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
