'use strict';
/* wdr-1.0.0 control: THE TWO READ RELAYS FORCE-FINISH WHEN THE WORKER NEVER
 * ANSWERS - AND NEVER MANUFACTURE SUCCESS.
 *
 * content.js's mlsAppPullSchedule and mlsAppGotoDate relays force-finish at
 * their immutable deadline, but mlsAppReadChart and mlsAppReadVisits relied
 * entirely on the worker's callback: a wedged/killed MV3 service worker left
 * the app's promise pending forever - the live "endless saving / stuck
 * progress" class. wdr-1.0.0 adds a relay backstop to both: chart fires 5s
 * after the chart deadlineAt (the worker's own at-deadline refusal is more
 * informative and must win the race), visits fires at the caller deadline or
 * a generous 300s chain default (the worker bounds every leg itself - 90s
 * exec cap plus its wdog force-finish - so the backstop must never undercut
 * a legitimate long recovery chain).
 *
 * This suite executes the REAL shipped handler blocks (extracted from
 * content.js by balanced braces) with fake timers and a silent worker.
 * OLD BYTES FAIL CASES 1/4/5 BY NAME: no reply ever arrives. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function extractIfBlock(marker) {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, marker + ' present in content.js');
  assert.strictEqual(src.indexOf(marker, at + 1), -1, marker + ' unique');
  const open = src.indexOf('{', at + marker.length - 1);
  let depth = 0, mode = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && src[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && src[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced ' + marker);
}

const chartBlock = extractIfBlock("if (d.type === 'mlsAppReadChart') {");
const visitsBlock = extractIfBlock("if (d.type === 'mlsAppReadVisits') {");

/* shape pins - a refactor that drops the backstop or renames the reasons
 * fails here by name */
assert.ok(chartBlock.includes('chart-relay-deadline-exceeded'), 'chart relay backstop reason present');
assert.ok(visitsBlock.includes('visits-relay-deadline-exceeded'), 'visits relay backstop reason present');
assert.ok(chartBlock.includes('chartDeadlineAt + 5000'), 'chart backstop yields the race to the worker\'s own at-deadline refusal');

function makeHarness(block, opts) {
  opts = opts || {};
  const replies = [];
  const timers = { seq: 0, live: new Map() };
  const sent = [];
  const relay = [];
  const fakeSetTimeout = (fn, ms) => { const id = ++timers.seq; timers.live.set(id, { fn, ms }); return id; };
  const fakeClearTimeout = id => { timers.live.delete(id); };
  const chrome = { runtime: { lastError: undefined, sendMessage: (msg, cb) => { if (opts.sendThrows) throw new Error('synthetic sync send failure'); sent.push({ msg, cb }); } } };
  const mlsRelayRetry = (msg, cb) => { if (opts.relayThrows) throw new Error('synthetic sync relay failure'); relay.push({ msg, cb }); };
  const mlsStr = (s, n) => String(s == null ? '' : s).slice(0, n);
  const reply = payload => { replies.push(payload); };
  const run = new Function('d', 'reply', 'mlsStr', 'mlsRelayRetry', 'chrome', 'setTimeout', 'clearTimeout', 'Date', 'Object', 'Number', 'Array', 'isFinite', 'Math', block);
  return {
    replies, timers, sent, relay, chrome,
    dispatch: d => run(d, reply, mlsStr, mlsRelayRetry, chrome, fakeSetTimeout, fakeClearTimeout, Date, Object, Number, Array, isFinite, Math),
    fireAllTimers: () => { for (const [id, t] of Array.from(timers.live.entries())) { timers.live.delete(id); t.fn(); } },
    liveTimerCount: () => timers.live.size
  };
}

let n = 0;
const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

/* ---- 1. CHART: worker never answers (no patient -> direct send) ---- */
{
  const h = makeHarness(chartBlock);
  h.dispatch({ type: 'mlsAppReadChart', requestId: 'r1', deadlineAt: Date.now() + 1000 });
  assert.strictEqual(h.sent.length, 1, 'chart request dispatched to the worker');
  assert.strictEqual(h.replies.length, 0, 'no premature reply');
  assert.strictEqual(h.liveTimerCount(), 1, 'backstop armed');
  h.fireAllTimers();
  assert.strictEqual(h.replies.length, 1, 'exactly one forced terminal reply');
  assert.strictEqual(h.replies[0].resp.ok, false, 'forced terminal is a refusal');
  assert.strictEqual(h.replies[0].resp.reason, 'chart-relay-deadline-exceeded', 'refusal names the relay deadline');
  ok('chart: silent worker forces one named terminal refusal');
}

/* ---- 2. CHART: late worker reply after the backstop is DROPPED ---- */
{
  const h = makeHarness(chartBlock);
  h.dispatch({ type: 'mlsAppReadChart', requestId: 'r2', deadlineAt: Date.now() + 1000 });
  h.fireAllTimers();
  h.sent[0].cb({ ok: true, sections: 40 });
  assert.strictEqual(h.replies.length, 1, 'late worker success did not produce a second reply');
  assert.strictEqual(h.replies[0].resp.ok, false, 'the forced refusal stands - success is never manufactured after the deadline');
  ok('chart: late reply dropped by the finished flag');
}

/* ---- 3. CHART: normal reply clears the backstop ---- */
{
  const h = makeHarness(chartBlock);
  h.dispatch({ type: 'mlsAppReadChart', requestId: 'r3', deadlineAt: Date.now() + 1000 });
  h.sent[0].cb({ ok: true, sections: 40 });
  assert.strictEqual(h.replies.length, 1, 'one reply on the normal path');
  assert.strictEqual(h.replies[0].resp.ok, true, 'worker result passed through untouched');
  assert.strictEqual(h.liveTimerCount(), 0, 'backstop timer cleared on the normal terminal');
  h.fireAllTimers();
  assert.strictEqual(h.replies.length, 1, 'a stale timer cannot double-reply');
  ok('chart: normal terminal clears the backstop, no double reply');
}

/* ---- 4. CHART: the search-open leg hangs (patient path) ---- */
{
  const h = makeHarness(chartBlock);
  h.dispatch({ type: 'mlsAppReadChart', requestId: 'r4', patient: 'Synthetic Patient', deadlineAt: Date.now() + 1000 });
  assert.strictEqual(h.relay.length, 1, 'search-open leg dispatched');
  assert.strictEqual(h.sent.length, 0, 'chart read not yet dispatched');
  h.fireAllTimers();
  assert.strictEqual(h.replies.length, 1, 'hung opener leg still reaches one forced terminal');
  assert.strictEqual(h.replies[0].resp.reason, 'chart-relay-deadline-exceeded', 'opener hang names the relay deadline');
  ok('chart: a hung search-open leg is covered by the same backstop');
}

/* ---- 5. VISITS: worker never answers ---- */
{
  const h = makeHarness(visitsBlock);
  h.dispatch({ type: 'mlsAppReadVisits', patient: 'Synthetic Patient', dob: '01/01/1980' });
  assert.strictEqual(h.sent.length, 1, 'visits request dispatched');
  assert.strictEqual(h.liveTimerCount(), 1, 'backstop armed');
  const armed = Array.from(h.timers.live.values())[0].ms;
  assert.ok(armed > 240000 && armed <= 300000, 'default chain deadline is generous (~300s), never undercutting the worker\'s own 90s+wdog legs (got ' + armed + 'ms)');
  h.fireAllTimers();
  assert.strictEqual(h.replies.length, 1, 'exactly one forced terminal reply');
  assert.strictEqual(h.replies[0].resp.reason, 'visits-relay-deadline-exceeded', 'refusal names the relay deadline');
  assert.strictEqual(h.replies[0].resp.ok, false, 'forced terminal is a refusal');
  ok('visits: silent worker forces one named terminal refusal after the generous chain deadline');
}

/* ---- 6. VISITS: caller-supplied deadline is honored ---- */
{
  const h = makeHarness(visitsBlock);
  const dl = Date.now() + 42000;
  h.dispatch({ type: 'mlsAppReadVisits', patient: 'Synthetic Patient', deadlineAt: dl });
  const armed = Array.from(h.timers.live.values())[0].ms;
  assert.ok(Math.abs(armed - 42000) < 250, 'caller deadlineAt drives the backstop (got ' + armed + 'ms)');
  ok('visits: caller-supplied deadlineAt honored');
}

/* ---- 7. VISITS: normal reply clears the backstop; late reply dropped ---- */
{
  const h = makeHarness(visitsBlock);
  h.dispatch({ type: 'mlsAppReadVisits', patient: 'Synthetic Patient' });
  h.sent[0].cb({ ok: true, visits: [] });
  assert.strictEqual(h.replies.length, 1, 'one reply on the normal path');
  assert.strictEqual(h.replies[0].resp.ok, true, 'worker result passed through untouched');
  assert.strictEqual(h.liveTimerCount(), 0, 'backstop cleared');

  const h2 = makeHarness(visitsBlock);
  h2.dispatch({ type: 'mlsAppReadVisits', patient: 'Synthetic Patient' });
  h2.fireAllTimers();
  h2.sent[0].cb({ ok: true, visits: [] });
  assert.strictEqual(h2.replies.length, 1, 'late visits reply dropped');
  assert.strictEqual(h2.replies[0].resp.ok, false, 'the forced refusal stands');
  ok('visits: normal terminal clears the backstop; late reply dropped');
}

/* ---- 8. VISITS: the recovery chain still terminates through ONE funnel ---- */
{
  const h = makeHarness(visitsBlock);
  h.dispatch({ type: 'mlsAppReadVisits', patient: 'Synthetic Patient' });
  /* first read refuses wrong-chart -> opener leg -> opener hangs -> backstop */
  h.sent[0].cb({ ok: false, reason: 'wrong-chart' });
  assert.strictEqual(h.relay.length, 1, 'recovery opener dispatched');
  assert.strictEqual(h.replies.length, 0, 'no reply while the recovery chain is live');
  h.fireAllTimers();
  assert.strictEqual(h.replies.length, 1, 'hung recovery chain still reaches one forced terminal');
  assert.strictEqual(h.replies[0].resp.reason, 'visits-relay-deadline-exceeded', 'recovery hang names the relay deadline');
  ok('visits: a hung recovery chain is covered by the same single-funnel backstop');
}

/* ---- 9-11. wdr-1.0.1 (review blocker): a SYNCHRONOUS throw after the timer
 * armed must route through the same funnel - one reply, zero live timers ---- */
assert.ok(chartBlock.includes("typeof finishChart === 'function'"), 'chart outer catch routes through the funnel');
assert.ok(visitsBlock.includes("typeof finishVisits === 'function'"), 'visits outer catch routes through the funnel');
{
  const h = makeHarness(chartBlock, { relayThrows: true });
  h.dispatch({ type: 'mlsAppReadChart', requestId: 'r9', patient: 'Synthetic Patient', deadlineAt: Date.now() + 1000 });
  assert.strictEqual(h.replies.length, 1, 'sync opener throw produced exactly one terminal');
  assert.strictEqual(h.replies[0].resp.ok, false, 'terminal is a refusal');
  assert.strictEqual(h.liveTimerCount(), 0, 'the armed backstop was cleared by the funnel - no second reply can fire');
  h.fireAllTimers();
  assert.strictEqual(h.replies.length, 1, 'no stale timer double-reply after a sync throw');
  ok('chart: sync opener throw -> one funneled terminal, backstop cleared');
}
{
  const h = makeHarness(chartBlock, { sendThrows: true });
  h.dispatch({ type: 'mlsAppReadChart', requestId: 'r10', deadlineAt: Date.now() + 1000 });
  assert.strictEqual(h.replies.length, 1, 'sync send throw produced exactly one terminal');
  assert.strictEqual(h.liveTimerCount(), 0, 'backstop cleared');
  ok('chart: sync send throw -> one funneled terminal');
}
{
  const h = makeHarness(visitsBlock, { sendThrows: true });
  h.dispatch({ type: 'mlsAppReadVisits', patient: 'Synthetic Patient' });
  assert.strictEqual(h.replies.length, 1, 'visits sync throw produced exactly one terminal');
  assert.strictEqual(h.replies[0].resp.reason, 'extension-error', 'named refusal retained');
  assert.strictEqual(h.liveTimerCount(), 0, 'backstop cleared');
  h.fireAllTimers();
  assert.strictEqual(h.replies.length, 1, 'no stale timer double-reply');
  ok('visits: sync send throw -> one funneled terminal, backstop cleared');
}

console.log('PASS content read-relay watchdog: chart+visits relays force one named terminal refusal on a silent worker, clear on normal terminals, drop late replies, honor caller deadlines, route sync throws through the same funnel, and never manufacture success (' + n + ' cases)');
