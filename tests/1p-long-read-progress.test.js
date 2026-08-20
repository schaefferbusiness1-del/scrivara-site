'use strict';

/* pulsee-1.0.0 — a long read must show it is alive.
 *
 * Owner 2026-08-19, watching a live pull: "if Maria's chart is running and this
 * is no indicator that is so bad."
 *
 * Measured on r23: pressing Pull from Athena paints ONE line ("Reading every
 * encounter from athenaOne… (read-only)") and leaves it for five-plus minutes.
 * Between the emit that writes it and the next one sit the encounter opens, two
 * hydration sleeps, and a 48-pass enumerate grind at 3.5s per pass. Nothing
 * distinguishes working from wedged.
 *
 * The counts were never missing. The extension emits mlsAppVisitsProgress with
 * n and total; content.js relays both; feat_visits hands the whole event to its
 * callback — and feat_athena_autopull keeps only the message string. Separately
 * feat_visits_counter_guard rewrites every counter-bearing MESSAGE to one
 * neutral sentence while leaving n/total untouched. The page had the numbers
 * twice over and discarded them both times.
 *
 * This suite executes the shipped block and proves:
 *   - the count is read from the EVENT (n/total), never from the message, so
 *     the counter guard cannot blank it;
 *   - elapsed and time-since-progress are computed from timestamps, not from
 *     counted ticks (a throttled background tab must not inflate them);
 *   - a 60s silence produces an honest stall verdict, and progress clears it;
 *   - Stop ABANDONS honestly — it says athenaOne's read may still finish, and
 *     it must NOT set __mlsPullStopRequested, which belongs to the day engines;
 *   - the block emits nothing: no progress event may be re-dispatched (the
 *     absolute-deadline contract forbids one escaping after settlement).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const twin = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- ships in both twins, and sends nothing ---- */
const S_AT = shell.indexOf('<!-- ===== pulsee-1.0.0');
const E_AT = shell.indexOf('<!-- ===== end pulsee-1.0.0');
{
  ok(S_AT > 0 && E_AT > S_AT, 'pulsee must ship in 1pScribeFlow.html');
  ok(twin.indexOf('pulsee-1.0.0') > 0, 'pulsee must ship in 1p/index.html');
  const block = shell.slice(S_AT, E_AT);
  ok(!/postMessage\s*\(/.test(block), 'the ticker must never post a message');
  ok(!/dispatchEvent\s*\(/.test(block), 'the ticker must never re-dispatch a progress event');
  ok(!/__mlsPullStopRequested/.test(block.replace(/__mlsPullStopRequested — that flag[\s\S]*?schedule pull\./, '')),
    'Stop must not set the day engines\' stop flag');
  ok(/d\.n\b/.test(block) && /d\.total\b/.test(block), 'the count must be read off the event');
}

function blockSource() {
  const seg = shell.slice(S_AT, E_AT);
  return seg.slice(seg.indexOf('<script>') + '<script>'.length, seg.lastIndexOf('</script>'));
}
const SRC = blockSource();

function elementStub(id) {
  /* pullsee-1.1 renders through a persistent child text node; like a real DOM,
     textContent must COMPOSE from own text plus children (and setting it must
     clear them). The stub previously kept a flat string, which read "" the
     moment the block moved to create-once rendering. */
  let ownText = '';
  const el = {
    id: id || '', style: {}, children: [], _on: {}, tagName: 'DIV',
    get textContent() {
      return ownText + el.children.map((c) => (c && (c.nodeValue != null ? c.nodeValue : c.textContent)) || '').join('');
    },
    set textContent(v) { ownText = String(v == null ? '' : v); el.children.length = 0; },
    parentNode: null, previousSibling: null, nextSibling: null,
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(t, fn) { (el._on[t] = el._on[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    insertBefore(c) { el.children.push(c); c.parentNode = el; return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    click() { (el._on.click || []).forEach(fn => fn({})); },
    querySelector() { return null; }, querySelectorAll: () => []
  };
  return el;
}

function harness() {
  const nodes = new Map();
  const timers = [];
  let now = 1700000000000;
  const status = elementStub('pullChartStatus');
  const host = elementStub('host');
  host.appendChild(status);
  nodes.set('pullChartStatus', status);
  const msgHandlers = [];
  const posted = [];

  const document = {
    readyState: 'complete',
    addEventListener() {}, removeEventListener() {},
    getElementById: id => nodes.has(id) ? nodes.get(id) : null,
    /* pullsee-1.1 renders through a persistent text node - give the stub the
       same primitive a real document has. */
    createTextNode: (t) => { const n = { nodeValue: String(t == null ? '' : t) }; return n; },
    createElement: () => {
      const el = elementStub('');
      /* the block assigns .id after creation; register it so byId finds it */
      let realId = '';
      Object.defineProperty(el, 'id', {
        get() { return realId; },
        set(v) { realId = String(v); nodes.set(realId, el); }
      });
      return el;
    },
    body: elementStub('body'), documentElement: elementStub('html')
  };
  /* insertBefore on the real parent must set previousSibling for the block's
     "is the ticker already next to the status line?" check */
  host.insertBefore = function (c) { host.children.push(c); c.parentNode = host; c.previousSibling = status; return c; };

  const window = {
    document,
    addEventListener(t, fn) { if (t === 'message') msgHandlers.push(fn); },
    removeEventListener(t, fn) { const i = msgHandlers.indexOf(fn); if (i >= 0) msgHandlers.splice(i, 1); },
    postMessage(m) { posted.push(m); }
  };
  window.window = window;

  const sandbox = {
    window, document,
    setInterval: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearInterval: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    setTimeout: fn => { fn(); return 1; }, clearTimeout: () => {},
    Date: { now: () => now },
    console
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx, { filename: 'pulsee-1.0.0' });
  return {
    ctx, api: window.__mlsPullSee, posted, timers, status, nodes,
    deliver: d => msgHandlers.slice().forEach(fn => fn({ data: d })),
    advance: ms => { now += ms; },
    ticker: () => nodes.get('mlsPullTicker') || null,
    now: () => now
  };
}

const progress = (n, total, message) => ({ type: 'mlsAppVisitsProgress', n, total, message: message || '🔍 Reading your visits from athenaOne…' });

/* ---- 1. a count appears, read from the event not the message ---- */
{
  const h = harness();
  ok(h.api && h.api.installed, 'the ticker must install');
  ok(h.api.state() === null, 'no run before any progress');
  h.deliver(progress(2, 17));
  const st = h.api.state();
  ok(st && st.total === 17 && st.n === 2, 'n and total must come off the event');
  const t = h.ticker();
  ok(t && /Reading encounter 3 of 17/.test(t.textContent),
    'the ticker must show the live count (got "' + (t && t.textContent) + '")');
  ok(t.style.display === 'block', 'the ticker must be visible during a read');
  /* the counter guard's neutral sentence must not blank the count */
  h.deliver(progress(5, 17, '🔍 Reading your visits from athenaOne…'));
  ok(/Reading encounter 6 of 17/.test(h.ticker().textContent),
    'a neutralised message must not blank the count');
  ok(h.posted.length === 0, 'the ticker must send nothing');
}

/* ---- 2. no total yet: honest about indexing, never a fake number ---- */
{
  const h = harness();
  h.deliver({ type: 'mlsAppVisitsProgress', message: 'indexing' });
  const t = h.ticker();
  ok(/no count yet/.test(t.textContent), 'with no total the ticker must say there is no count yet');
  ok(!/of 0\b|NaN|undefined/.test(t.textContent), 'it must never render a fabricated total');
}

/* ---- 3. elapsed comes from timestamps, not from tick counts ---- */
{
  const h = harness();
  h.deliver(progress(0, 4));
  h.advance(95000);            /* 1m 35s of wall clock, ZERO timer callbacks */
  h.api._test.paint();
  ok(/1m 35s elapsed/.test(h.ticker().textContent),
    'elapsed must be computed from the clock, so a throttled tab cannot deflate it (got "' + h.ticker().textContent + '")');
}

/* ---- 4. the 60s stall verdict, and progress clearing it ---- */
{
  const h = harness();
  h.deliver(progress(1, 9));
  h.advance(59000);
  h.api._test.paint();
  ok(!/no new progress/.test(h.ticker().textContent), 'no stall verdict before the threshold');
  ok(h.ticker().style.color !== '#9f2d2d', 'a healthy read must not paint as stalled');
  h.advance(2000);             /* 61s since last progress */
  h.api._test.paint();
  const stalled = h.ticker().textContent;
  ok(/no new progress for 1m 1s/.test(stalled), 'a 60s silence must produce a stall verdict (got "' + stalled + '")');
  ok(/athenaOne may be stuck/.test(stalled), 'the verdict must name the likely cause');
  ok(/Nothing has been written either way/.test(stalled), 'the verdict must reassure that nothing was written');
  ok(h.ticker().style.color === '#9f2d2d', 'a stalled read must paint as a problem');
  /* real progress clears it */
  h.deliver(progress(2, 9));
  ok(!/no new progress/.test(h.ticker().textContent), 'fresh progress must clear the stall verdict');
  ok(h.ticker().style.color === '#52675c', 'a recovered read must stop painting as stalled');
}

/* ---- 5. Stop abandons honestly ---- */
{
  const h = harness();
  h.deliver(progress(3, 12));
  const t = h.ticker();
  const stopBtn = t.children.filter(c => c.id === 'mlsPullStopRead')[0];
  ok(stopBtn, 'a running read must offer a stop control');
  ok(stopBtn.textContent === 'Stop waiting on this read', 'the stop must say what it really does');
  const seqBefore = h.api.state().seq;
  stopBtn.click();
  ok(h.api.state() === null, 'stopping must end the run');
  const said = h.ticker().textContent;
  ok(/You stopped waiting on this read/.test(said), 'the stop must be acknowledged');
  ok(/may still finish on its own/.test(said),
    'it must admit it cannot cancel athenaOne’s read — there is no cancel verb on this bridge');
  ok(/nothing was written to Athena/i.test(said), 'it must say nothing was written');
  ok(h.ctx.window.__mlsPullStopRequested === undefined,
    'Stop must NOT set the day engines\' stop flag and halt an unrelated schedule pull');
  /* a late progress event from the abandoned read must not resurrect the old run */
  h.deliver(progress(4, 12));
  ok(h.api.state().seq > seqBefore, 'any later run must own a NEW sequence token');
}

/* ---- 6. settlement hides the ticker; the timer is released ---- */
{
  const h = harness();
  h.deliver(progress(1, 3));
  ok(h.timers.filter(t => !t.cleared).length === 1, 'exactly one ticking timer while running');
  h.deliver({ type: 'mlsAppAllVisitsResult', ok: true, visits: [] });
  ok(h.api.state() === null, 'the result must settle the run');
  ok(h.ticker().style.display === 'none', 'a settled read must hide the ticker');
  ok(h.timers.every(t => t.cleared), 'the ticking timer must be released on settle');
}

/* ---- 7. revert ---- */
{
  const h = harness();
  h.deliver(progress(1, 3));
  ok(h.api.revert() === true, 'the block must revert');
  ok(h.timers.every(t => t.cleared), 'revert must release the timer');
  h.deliver(progress(2, 3));
  ok(h.api.state() === null, 'a reverted ticker must stop tracking');
}

console.log('PASS 1p long-read progress: ' + checks + ' checks — the VERB-A read now shows a live encounter count read off the event (not the message the counter guard neutralises), elapsed and idle time computed from the clock rather than tick counts, an honest stall verdict after 60s that fresh progress clears, and a Stop that abandons with a sequence token while admitting it cannot cancel athenaOne’s own read and never touching the day engines\' stop flag');
