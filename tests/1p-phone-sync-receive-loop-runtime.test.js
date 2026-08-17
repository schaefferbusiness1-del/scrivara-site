'use strict';
/* =============================================================================
 * p1-phone-sync-1.0.0 -- THE PHONE RECEIVE LOOP
 *
 * Owner, 2026-08-17: "the phone UI: add that to the cloned site too, it's
 * already on the real site and it's pretty good but has the error of like not
 * syncing, so fix that."
 *
 * This suite is BOTH halves of the job: it reproduces the shipped defect and
 * it proves the /1p fix. Nothing here touches the network and no identifier in
 * it belongs to a real person -- every name is a letter and a number.
 *
 * PART 1 -- THE DIAGNOSIS, measured against the SHIPPED files
 *   1A  ph3's onVisibility() -- the one handler that runs when a doctor
 *       unlocks a phone and looks -- contains no call that re-reads the
 *       schedule or the charts. Measured on the NAMED FUNCTION's own body,
 *       not by grepping a 2,500-line file.
 *   1B  ph3 has no periodic schedule read of any kind: no setInterval and no
 *       Worker anywhere in the module drives loadCalendar.
 *   1C  The relay's OFFICE half runs on a Worker timer (rl-2.0.1 N3) and the
 *       PHONE half is still a bare main-thread setInterval. The asymmetry is
 *       read out of both regions of mls-connect.js.
 *   1D  EXECUTED reproduction of the consequence: the real pollJob from
 *       mls-connect.js, driven through a suspended-page timeline. The pull
 *       completes on the server, the phone's interval never fires, and when
 *       the page comes back the in-RAM job has aged past its TTL -- so the
 *       phone tells the doctor the request EXPIRED while the appointments are
 *       sitting on the server. A success reported as a failure, with
 *       loadCalendar never called even once.
 *
 * PART 2 -- THE FIX, executed
 *   The p1-phone-sync-1.0.0 block is extracted from 1p-mls-connect.js and run
 *   in a vm against a hand-rolled DOM, a fake clock, fake timers and a fake
 *   Worker. Mount, cadence, hidden-tab survival, visibility catch-up, re-auth
 *   resume, wrong-account refusal, the caret guard, backoff, and a
 *   fault-injection matrix in which EVERY status must produce a sentence.
 *
 * PART 3 -- THE LANES
 *   /1p and /cloned both load the phone module, and the loader's relative URL
 *   is RESOLVED (with the URL API, not reasoned about) under each lane's own
 *   <base> to prove it reaches the file that exists.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

const PH3 = read('feat_mls_phone_ui.js');
const PROD = read('mls-connect.js');
const P1 = read('1p-mls-connect.js');
const CLONED = read('cloned-mls-connect.js');
const P1_SHELL = read('1pScribeFlow.html');
const P1_INDEX = read(path.join('1p', 'index.html'));
const CLONED_INDEX = read(path.join('cloned', 'index.html'));

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* Comment-stripped, because every claim below is about CODE. The modules in
   this repo carry long prose headers that necessarily name the identifiers
   being counted, and matching raw source would grade a comment. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* Pull one named function's whole body out of a source file by counting
   braces from its header. Used instead of a line-window so the assertion
   cannot drift when the file above or below it changes. */
function slurpFunction(src, header) {
  const at = src.indexOf(header);
  if (at < 0) return '';
  let i = src.indexOf('{', at);
  if (i < 0) return '';
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    const c = src[j];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(at, j + 1);
    }
  }
  return '';
}

/* ===========================================================================
 * PART 1A -- unlocking the phone does not resync it
 * =========================================================================*/
function testPh3VisibilityDoesNotResync() {
  const body = slurpFunction(stripComments(PH3), 'function onVisibility()');
  ok(body.length > 80, 'ph3 onVisibility() could not be located -- the diagnosis instrument is broken, not the claim');

  /* What it DOES do, so a future rewrite that keeps the name but changes the
     body cannot quietly satisfy this test. */
  ok(/ensure\(\)/.test(body), 'onVisibility no longer calls ensure() -- re-measure before trusting anything below');
  ok(/ckFetch\(\)/.test(body), 'onVisibility no longer re-fetches the check-ins');
  ok(/refreshPresence\(true\)/.test(body), 'onVisibility no longer re-reads presence');

  /* And what it does NOT do: read the schedule or the charts back off the
     server. This is the whole of "I unlocked my phone and my patients were
     not there". */
  for (const sink of ['loadCalendar', 'loadPatientsFromServer', '_calAppts']) {
    ok(body.indexOf(sink) < 0,
      'DIAGNOSIS INVALID: ph3 onVisibility() already touches ' + sink + ' -- the shipped file has changed');
  }
}

/* ===========================================================================
 * PART 1B -- ph3 has no periodic schedule read at all
 * =========================================================================*/
function testPh3HasNoScheduleLoop() {
  const code = stripComments(PH3);
  /* The module's ONE interval is the 45s check-in watch. Everything else is a
     setTimeout ticker for the recording clock. Neither reads the schedule. */
  const intervals = (code.match(/setInterval\(/g) || []).length;
  eq(intervals, 1, 'ph3 no longer has exactly one setInterval -- re-read the timer budget before trusting this suite');
  ok(/setInterval\(ckFetch,\s*CK_POLL_MS\)/.test(code), 'ph3 the one interval is no longer the check-in watch');
  ok(code.indexOf('new Worker') < 0, 'ph3 has gained a Worker -- re-measure the receive-loop claim');
  ok(code.indexOf('loadCalendar') >= 0, 'ph3 never mentions loadCalendar at all -- instrument check failed');

  /* loadCalendar appears in ph3 exactly once, and it is the MENU's manual
     Refresh -- a control a doctor has to go and find. */
  const hits = (code.match(/loadCalendar/g) || []).length;
  eq(hits, 1, 'ph3 now references loadCalendar ' + hits + ' times; the single manual-refresh claim is stale');
  const click = slurpFunction(code, 'function onClick(ev)');
  ok(click.indexOf('loadCalendar') >= 0, 'the one loadCalendar reference is no longer inside the click handler');
}

/* ===========================================================================
 * PART 1C -- the office half got the Worker; the phone half did not
 * =========================================================================*/
function testRelayPollerAsymmetry() {
  const code = stripComments(PROD);
  const poll = slurpFunction(code, 'function pollJob(id, date, officeWho, hooks)');
  ok(poll.length > 400, 'the relay pollJob could not be located in mls-connect.js');
  ok(/setInterval\(/.test(poll), 'pollJob no longer uses setInterval');
  ok(poll.indexOf('Worker') < 0,
    'DIAGNOSIS INVALID: the phone-side relay poller already uses a Worker');

  /* The office agent, in the same module, does. */
  ok(/relayWk\s*=\s*new Worker\(relayWkUrl\)/.test(code),
    'the office agent is no longer Worker-driven -- the asymmetry claim is stale');
}

/* ===========================================================================
 * PART 1D -- EXECUTED: a pull that succeeds is reported as an expiry
 * ---------------------------------------------------------------------------
 * The real pollJob, on a timeline a phone actually produces: press Pull, lock
 * the phone. A suspended page runs NO timers, so the interval simply does not
 * fire. The office computer finishes, the appointments land on the server, and
 * the relay's in-RAM job record ages out. The phone comes back, the interval
 * resumes, the job is gone, and the doctor is told to pull again.
 * =========================================================================*/
function runPollJob(opts) {
  const code = stripComments(PROD);
  const src = slurpFunction(code, 'function pollJob(id, date, officeWho, hooks)');
  ok(src.length > 400, 'pollJob source not extracted');

  const timers = [];
  let suspended = opts.startSuspended === true;
  const calls = { loadCalendar: 0, loadPatients: 0, fetches: [] };
  const fakeWindow = {
    loadCalendar() { calls.loadCalendar += 1; },
    loadPatientsFromServer() { calls.loadPatients += 1; },
    _calAppts: [],
    __mlsDaySwitch: null
  };
  const fakeSetInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const fakeClearInterval = (h) => { if (h) timers[h - 1] = null; };
  const fakeSetTimeout = (fn) => { setImmediateQueue.push(fn); return setImmediateQueue.length; };
  const setImmediateQueue = [];

  const factory = new vm.Script(
    '(function(writeActive, thisDev, base, H, fetch, window, setInterval, clearInterval, setTimeout){' +
    src + '\nreturn pollJob;})'
  ).runInNewContext({ Promise, Date, Math, String, Number, JSON, encodeURIComponent, Array });

  const pollJob = factory(
    () => {},
    () => 'this phone',
    () => 'https://example.invalid',
    () => ({}),
    (url) => { calls.fetches.push(url); return opts.fetch(url); },
    fakeWindow,
    fakeSetInterval,
    fakeClearInterval,
    fakeSetTimeout
  );

  const seen = { status: [], done: null };
  pollJob('job-1', '2026-08-18', 'your office computer', {
    onStatus: (m) => seen.status.push(m),
    onDone: (okFlag, msg) => { seen.done = { ok: okFlag, msg }; }
  });

  return {
    calls, seen, setImmediateQueue,
    tick: () => { if (suspended) return; const t = timers.find(Boolean); if (t) t.fn(); },
    resume: () => { suspended = false; },
    suspend: () => { suspended = true; }
  };
}

async function testPollJobLosesASuccessfulPull() {
  /* (a) The page stays awake: the job completes and the phone re-reads the
     calendar. This is the control -- without it, (b) proves nothing. */
  {
    const h = runPollJob({
      startSuspended: false,
      fetch: () => Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ job: { id: 'job-1', status: 'done', result: { ok: true, data: { pulled: '2026-08-18' } } } })
      })
    });
    h.tick();
    await new Promise((r) => setTimeout(r, 5));
    eq(h.calls.loadCalendar, 1, 'CONTROL FAILED: an awake phone did not re-read the calendar on a completed relay pull');
  }

  /* (b) The phone is locked for the whole run. No timer fires, so nothing is
     read back, and the job record has aged out by the time it wakes. */
  {
    const h = runPollJob({
      startSuspended: true,
      /* The server no longer has the job -- the relay queue is in RAM with a
         15-minute TTL by design (scrivara-backend src/routes/relay.js). The
         APPOINTMENTS, however, were written by the office computer and are
         still there. */
      fetch: () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })
    });
    h.tick(); h.tick(); h.tick();          /* suspended: nothing fires */
    eq(h.calls.fetches.length, 0, 'a suspended page still polled -- the reproduction is not modelling suspension');
    eq(h.calls.loadCalendar, 0, 'a suspended page re-read the calendar');

    h.resume();                            /* the doctor unlocks the phone */
    h.tick();
    await new Promise((r) => setTimeout(r, 5));

    eq(h.calls.loadCalendar, 0,
      'THE DEFECT IS GONE: the phone re-read the calendar after a 404 -- re-measure');
    ok(h.seen.done && h.seen.done.ok === false,
      'the phone did not report a failure after the job record expired');
    ok(/expired on the server/.test(h.seen.done.msg),
      'expected the expiry sentence, got: ' + h.seen.done.msg);
  }
}

/* ===========================================================================
 * PART 2 -- THE FIX, EXECUTED
 * =========================================================================*/
const BLOCK_START = '/* ===== p1-phone-sync-1.0.0 -- THE PHONE RECEIVE LOOP';
const BLOCK_END = '/* ===== end p1-phone-sync-1.0.0 ===== */';

function extractBlock(src, file) {
  const a = src.indexOf(BLOCK_START);
  const b = src.indexOf(BLOCK_END);
  ok(a >= 0 && b > a, file + ': the p1-phone-sync-1.0.0 block is missing or unclosed');
  return src.slice(a, b + BLOCK_END.length);
}

/* --------------------------------------------------------------------------
 * A hand-rolled DOM. innerHTML is not parsed by a real engine here, so the
 * harness REGISTERS the ids it sees assigned in markup -- which is enough to
 * run this module's real mount, paint, click, tick and teardown paths end to
 * end and read back the exact sentence a doctor would be shown.
 * ------------------------------------------------------------------------*/
function makeHarness(opts) {
  opts = opts || {};
  const byId = new Map();
  const timers = [];               /* ONE list: the first handle handed out is 0 */
  const docListeners = new Map();
  const calls = {
    loadCalendar: 0, loadPatients: 0, phoneRender: 0, dsRenderList: 0,
    calendarArgs: [], workerPosts: []
  };
  let clock = opts.now || 1000000;

  function makeNode(tag) {
    const n = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '', className: '', textContent: '', disabled: false,
      children: [], parentNode: null, listeners: {}, attrs: {},
      /* innerHTML is not parsed by a real engine here. The harness reads each
         opening tag and registers a node carrying ITS OWN attributes -- not
         just its id -- because this module's one control is found by a
         data-attribute during event delegation, and a harness that dropped
         attributes would make a dead button look alive. */
      set innerHTML(html) {
        this._html = String(html);
        this.children.length = 0;
        const tags = /<([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)/g;
        let m;
        while ((m = tags.exec(this._html))) {
          const child = makeNode(m[1]);
          const attrs = /([\w:-]+)="([^"]*)"/g;
          let a;
          while ((a = attrs.exec(m[2] || ''))) child.setAttribute(a[1], a[2]);
          if (child.attrs.class) child.className = child.attrs.class;
          child.parentNode = this;
          this.children.push(child);
        }
      },
      get innerHTML() { return this._html || ''; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { this.id = v; byId.set(v, this); } },
      getAttribute(k) { if (k === 'id') return this.id || null; return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      appendChild(c) { c.parentNode = this; this.children.push(c); if (c.id) byId.set(c.id, c); return c; },
      insertBefore(c, ref) {
        c.parentNode = this;
        const i = this.children.indexOf(ref);
        if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
        if (c.id) byId.set(c.id, c);
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        c.parentNode = null;
        if (c.id) byId.delete(c.id);
        return c;
      },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      removeEventListener(t, fn) {
        const l = this.listeners[t] || [];
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
      },
      fire(t, ev) { (this.listeners[t] || []).slice().forEach((fn) => fn(ev)); }
    };
    Object.defineProperty(n, 'id', {
      get() { return this._id || ''; },
      set(v) { this._id = v; if (v) byId.set(v, this); },
      configurable: true
    });
    /* Count every write, so "the heartbeat is quiet when nothing changed" is a
       measured property rather than a hope. className re-serialises and
       re-sets the attribute even for an identical value; textContent replaces
       the text node, which is a childList mutation every observer in the
       document then has to walk. */
    n.writes = 0;
    ['textContent', 'className'].forEach((prop) => {
      const store = '_' + prop;
      n[store] = '';
      Object.defineProperty(n, prop, {
        get() { return this[store]; },
        set(v) { this[store] = String(v == null ? '' : v); this.writes += 1; },
        configurable: true
      });
    });
    return n;
  }

  const body = makeNode('body');
  const head = makeNode('head');
  let bodyObserver = null;

  const document = {
    body, head, documentElement: head,
    visibilityState: opts.visibility || 'visible',
    activeElement: null,
    getElementById: (id) => byId.get(id) || null,
    createElement: (t) => makeNode(t),
    addEventListener: (t, fn) => { (docListeners.get(t) || docListeners.set(t, []).get(t)).push(fn); },
    removeEventListener: (t, fn) => {
      const l = docListeners.get(t) || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    }
  };
  /* Map#set returns the map, not the value -- spell the accessor out. */
  document.addEventListener = (t, fn) => {
    if (!docListeners.has(t)) docListeners.set(t, []);
    docListeners.get(t).push(fn);
  };

  class FakeWorker {
    constructor() { this.onmessage = null; this.terminated = false; harness.workers.push(this); }
    postMessage(m) { calls.workerPosts.push(m); }
    terminate() { this.terminated = true; }
  }

  const win = {
    __mlsSessionAccount: opts.account || 'a1@example.invalid',
    __mlsSessionEpoch: opts.epoch || 7,
    _calAppts: opts.appts || [],
    bkToken: () => harness.token,
    backendMode: () => harness.hosted,
    _acctTodayKey: () => harness.day,
    loadCalendar(args) {
      calls.loadCalendar += 1;
      calls.calendarArgs.push(args);
      return harness.calendar();
    },
    loadPatientsFromServer() { calls.loadPatients += 1; return Promise.resolve(true); },
    __mlsDeviceRole: { deviceNoun: () => harness.noun },
    __mlsDaySwitch: {
      currentDay: () => harness.day,
      rowsFor: (k) => (win._calAppts || []).filter((a) => a && a.appt_date === k),
      renderList: () => { calls.dsRenderList += 1; }
    },
    __mlsPhoneUI: { render: () => { calls.phoneRender += 1; } },
    __mlsRelayLink: { activeJob: () => harness.activeJob }
  };

  const sandbox = {
    window: win, document, navigator: { onLine: true, userAgent: 'harness' },
    Promise, Math, String, Number, JSON, Array, Object, Date,
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    Blob: function () {},
    Worker: FakeWorker,
    MutationObserver: function (cb) {
      this.observe = () => { bodyObserver = cb; };
      this.disconnect = () => { bodyObserver = null; };
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, kind: 'timeout', at: clock + (ms || 0) }); return timers.length - 1; },
    clearTimeout: (h) => { if (h != null && timers[h]) timers[h] = null; },
    setInterval: (fn, ms) => { timers.push({ fn, ms, kind: 'interval' }); return timers.length - 1; },
    clearInterval: (h) => { if (h != null && timers[h]) timers[h] = null; }
  };
  sandbox.window.window = sandbox.window;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  /* The module reads Date.now(); the harness owns the clock so cadence,
     backoff and the request watchdog can be measured instead of waited for. */
  ctx.__clock = () => clock;
  vm.runInContext('Date.now = function(){ return __clock(); };', ctx);

  const harness = {
    ctx, sandbox, win, document, body, byId, timers, calls,
    workers: [],
    token: opts.token === undefined ? 'tok-A' : opts.token,
    hosted: opts.hosted === undefined ? true : opts.hosted,
    day: opts.day || '2026-08-18',
    noun: opts.noun || 'phone',
    activeJob: opts.activeJob || null,
    calendar: opts.calendar || (() => Promise.resolve({ applied: true, authoritative: true, count: 0, error: '', discarded: '' })),
    now: () => clock,
    advance(ms) { clock += ms; },
    /* Fire every timeout whose deadline has passed. */
    fireDueTimeouts() {
      timers.forEach((t, i) => {
        if (t && t.kind === 'timeout' && t.at <= clock) { timers[i] = null; t.fn(); }
      });
    },
    fireWorker() { harness.workers.forEach((w) => { if (!w.terminated && w.onmessage) w.onmessage(); }); },
    fireDoc(type) { (docListeners.get(type) || []).slice().forEach((fn) => fn()); },
    mutateBody() { if (bodyObserver) bodyObserver(); },
    mountPhoneFrame() {
      const frame = makeNode('div');
      frame.id = 'mlsPh3';
      const note = makeNode('div'); note.id = 'mlsPh3Note';
      const inner = makeNode('div'); inner.id = 'mlsPh3Body';
      const act = makeNode('div'); act.id = 'mlsPh3Act';
      frame.appendChild(note); frame.appendChild(inner); frame.appendChild(act);
      body.appendChild(frame);
      harness.mutateBody();
      return frame;
    },
    unmountPhoneFrame() {
      const f = byId.get('mlsPh3');
      if (f) body.removeChild(f);
      /* a real removal takes every descendant id with it */
      ['mlsPh3Note', 'mlsPh3Body', 'mlsPh3Act', 'mlsP1Sync', 'mlsP1SyncTxt', 'mlsP1SyncNow'].forEach((id) => byId.delete(id));
      harness.mutateBody();
    },
    install(block) { vm.runInContext(block, ctx); return ctx.window.__mlsP1PhoneSync; },
    text() { const t = byId.get('mlsP1SyncTxt'); return t ? String(t.textContent || '') : null; },
    btn() { return byId.get('mlsP1SyncNow') || null; },
    bar() { return byId.get('mlsP1Sync') || null; }
  };
  return harness;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---- the block installs, and a DESKTOP pays nothing ---------------------- */
async function testDesktopPaysNothing() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({});
  const sync = h.install(block);
  ok(sync && sync.installed === true, 'the module did not install');
  eq(sync.version, 'p1-phone-sync-1.0.0', 'wrong version marker');
  eq(sync.timerKind(), 'none', 'a machine with no phone frame created a timer');
  eq(h.bar(), null, 'a machine with no phone frame drew a status bar');
  eq(h.calls.loadCalendar, 0, 'a machine with no phone frame synced');
}

/* ---- mount: the bar is a SIBLING of the scroller, so repaints cannot eat it */
async function testBarSurvivesRepaints() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({});
  const sync = h.install(block);
  h.mountPhoneFrame();
  eq(sync.timerKind(), 'worker', 'the receive loop is not Worker-driven');
  eq(h.calls.workerPosts[0], 5000, 'the worker heartbeat is not 5s');

  const bar = h.bar();
  ok(bar, 'no status bar was inserted into the phone frame');
  eq(bar.parentNode.id, 'mlsPh3', 'the bar is not a direct child of the phone frame');
  const kids = bar.parentNode.children.map((c) => c.id);
  ok(kids.indexOf('mlsP1Sync') < kids.indexOf('mlsPh3Body'),
    'the bar was not placed above the scroller: ' + kids.join(','));
  ok(kids.indexOf('mlsP1Sync') > kids.indexOf('mlsPh3Note'),
    'the bar was placed above the sticky refusal message');

  /* ph3's render() rewrites #mlsPh3Body and #mlsPh3Act wholesale. Simulate one
     and prove the bar is still there and still ours. */
  h.document.getElementById('mlsPh3Body').innerHTML = '<div id="ph3Rebuilt"></div>';
  h.document.getElementById('mlsPh3Act').innerHTML = '<div id="ph3ActRebuilt"></div>';
  ok(h.bar(), 'a ph3 repaint destroyed the status bar');
  eq(h.bar().parentNode.id, 'mlsPh3', 'the bar moved during a repaint');
}

/* ---- the heartbeat is quiet when nothing changed ------------------------ */
async function testHeartbeatIsQuiet() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({});
  const sync = h.install(block);
  h.mountPhoneFrame();
  h.advance(60000); h.fireWorker(); await flush();
  eq(sync.state().status, 'ok', 'setup sync failed');

  const nodes = ['mlsP1Sync', 'mlsP1SyncTxt', 'mlsP1SyncNow'].map((id) => h.document.getElementById(id));
  const before = nodes.reduce((n, el) => n + el.writes, 0);
  /* Five heartbeats inside one cadence, with the clock advancing by less than
     a second so even the relative-time string is unchanged. */
  for (let i = 0; i < 5; i += 1) { h.advance(100); h.fireWorker(); }
  await flush();
  const after = nodes.reduce((n, el) => n + el.writes, 0);
  eq(after, before, 'the heartbeat wrote to the DOM ' + (after - before) + ' times with nothing changed');
  eq(h.calls.loadCalendar, 1, 'the heartbeat synced inside its own cadence');

  /* ...and it is NOT inert: once the clock moves the line changes and it writes. */
  h.advance(65000); h.fireWorker();
  ok(nodes.reduce((n, el) => n + el.writes, 0) > after, 'the bar stopped updating altogether');

  /* NON-VACUITY. Strip the guard back out and the same five heartbeats write
     every time -- so the assertion above is measuring the guard, not the
     harness. If this replacement stops applying, the control is dead and says
     so rather than passing quietly. */
  const GUARDED = 'if (txt) { var t = line(); if (txt.textContent !== t) txt.textContent = t; }';
  const UNGUARDED = 'if (txt) { var t = line(); txt.textContent = t; }';
  ok(block.indexOf(GUARDED) > 0, 'the guarded write is no longer spelled as the control expects');
  const h2 = makeHarness({});
  h2.install(block.replace(GUARDED, UNGUARDED));
  h2.mountPhoneFrame();
  h2.advance(60000); h2.fireWorker(); await flush();
  const n2 = h2.document.getElementById('mlsP1SyncTxt');
  const b2 = n2.writes;
  for (let i = 0; i < 5; i += 1) { h2.advance(100); h2.fireWorker(); }
  /* Ten, not five: each heartbeat paints twice -- once from ensureBar() and
     once from the not-yet-due branch of tick(). Both are absorbed to zero by
     the guard, which is exactly the point. */
  eq(n2.writes - b2, 10, 'CONTROL FAILED: the unguarded shape did not write on every heartbeat');
}

/* ---- the happy path: a pull that lands on the server reaches the phone --- */
async function testReceivesNewAppointments() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({});
  const sync = h.install(block);
  h.mountPhoneFrame();

  /* first sync: an empty day */
  h.advance(60000);
  h.fireWorker();
  await flush();
  eq(sync.state().status, 'ok', 'the first sync did not settle ok: ' + sync.state().status);
  eq(sync.state().waiting, 0, 'an unchanged day reported new arrivals');
  ok(/connected/.test(h.text()) && /last sync/.test(h.text()), 'the calm line is wrong: ' + h.text());

  /* the OFFICE computer pulls; three rows appear on the server */
  h.calendar = () => {
    h.win._calAppts = [
      { appt_date: '2026-08-18', name: 'P1' },
      { appt_date: '2026-08-18', name: 'P2' },
      { appt_date: '2026-08-18', name: 'P3' }
    ];
    return Promise.resolve({ applied: true, authoritative: true, count: 3, error: '', discarded: '' });
  };
  h.advance(60000);
  h.fireWorker();
  await flush();

  eq(sync.state().status, 'ok', 'the receiving sync failed');
  eq(sync.state().waiting, 3, 'the phone did not notice the three appointments that arrived');
  eq(sync.state().glow, true, 'the Sync now button does not glow with a result waiting');
  eq(h.btn().className, 'p1s-now p1s-glow', 'the glow class is not applied: ' + h.btn().className);
  ok(/3 new appointments arrived/.test(h.text()), 'the arrival is not said: ' + h.text());
  eq(h.calls.loadPatients, 1, 'the charts for the new patients were not hydrated');
  /* Three: one per completed sync, plus one more when the charts for the newly
     arrived patients land -- the quick history on a visit screen is built from
     those, so a repaint that happened before they arrived would show a patient
     with no history and never correct itself. */
  eq(h.calls.phoneRender, 3, 'the phone list was not repainted after rows and charts arrived');
}

/* ---- hidden-tab survival, and the visibility catch-up -------------------- */
async function testHiddenTabAndCatchUp() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({});
  const sync = h.install(block);
  h.mountPhoneFrame();
  h.advance(60000); h.fireWorker(); await flush();
  eq(sync.state().status, 'ok', 'setup sync failed');
  const base = h.calls.loadCalendar;

  /* Off screen with nothing pending: a calm 5-minute cadence, and the loop is
     still alive -- a Worker's timers survive Chrome's intensive throttling. */
  h.document.visibilityState = 'hidden';
  h.fireDoc('visibilitychange');
  eq(sync.state().cadenceMs, 300000, 'the hidden idle cadence is not 5 minutes');
  h.advance(60000); h.fireWorker(); await flush();
  eq(h.calls.loadCalendar, base, 'a hidden idle phone synced before its cadence');
  h.advance(300000); h.fireWorker(); await flush();
  eq(h.calls.loadCalendar, base + 1, 'a hidden phone stopped syncing entirely');

  /* Off screen WITH a relay pull in flight: watch closely, not calmly. */
  h.activeJob = { id: 'j1', date: '2026-08-18' };
  eq(sync.state().cadenceMs, 60000, 'a hidden phone with a pull running is not watching more often');
  h.document.visibilityState = 'visible';
  eq(sync.state().cadenceMs, 5000, 'a visible phone with a pull running is not watching closely');
  h.activeJob = null;

  /* THE SUSPENDED CASE. iOS suspends a backgrounded page outright: no Worker
     message is delivered at all, so unlocking is often the FIRST tick since
     the screen went off. It must be a catch-up, not a wait. */
  h.document.visibilityState = 'hidden';
  h.fireDoc('visibilitychange');
  const before = h.calls.loadCalendar;
  h.advance(20 * 60 * 1000);               /* twenty minutes locked, no ticks */
  h.document.visibilityState = 'visible';
  h.fireDoc('visibilitychange');
  await flush();
  eq(h.calls.loadCalendar, before + 1, 'unlocking the phone did not resync it');
  eq(sync.state().status, 'ok', 'the catch-up sync did not settle ok');

  /* AND THE CATCH-UP DEFEATS A BACKOFF, which is the case that actually
     discriminates: after failures the cadence can be minutes long, and a
     doctor who picks the phone up and looks must not be served a stale list
     for the rest of a backoff they cannot see. Three failures put the cadence
     at 160s; the phone is away for five seconds; unlocking still syncs. */
  h.calendar = () => Promise.resolve({ error: 'appointments_http_500' });
  for (let i = 0; i < 3; i += 1) { h.advance(400000); h.fireWorker(); await flush(); }
  eq(sync.state().fails, 3, 'the failure run did not accrue');
  eq(sync.state().cadenceMs, 160000, 'the backoff is not where this case needs it');
  h.calendar = () => Promise.resolve({ applied: true, count: 0, error: '', discarded: '' });
  const before2 = h.calls.loadCalendar;
  h.document.visibilityState = 'hidden';
  h.fireDoc('visibilitychange');
  h.advance(5000);
  h.fireWorker(); await flush();
  eq(h.calls.loadCalendar, before2, 'the backoff was not being honoured -- the case proves nothing');
  h.document.visibilityState = 'visible';
  h.fireDoc('visibilitychange');
  await flush();
  eq(h.calls.loadCalendar, before2 + 1, 'unlocking the phone did not defeat the backoff');
  eq(sync.state().status, 'ok', 'the catch-up sync did not settle ok');
}

/* ---- re-auth after an idle logout ---------------------------------------- */
async function testReAuthResume() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({});
  const sync = h.install(block);
  h.mountPhoneFrame();
  h.advance(60000); h.fireWorker(); await flush();
  const base = h.calls.loadCalendar;

  /* The session goes bad BEFORE the token disappears -- which is the ordinary
     shape: the backend starts refusing, a backoff accrues, and only then does
     the idle timer clear the token. Without that run of failures the resume is
     untestable, because a signed-out stretch makes every sync overdue anyway
     and the loop would fire on the next tick regardless. */
  h.calendar = () => Promise.resolve({ error: 'appointments_http_500' });
  for (let i = 0; i < 3; i += 1) { h.advance(400000); h.fireWorker(); await flush(); }
  eq(sync.state().fails, 3, 'the failure run did not accrue');
  eq(sync.state().cadenceMs, 160000, 'the backoff is not where this case needs it');
  const base2 = h.calls.loadCalendar;

  h.token = '';                            /* idle logout empties the token */
  h.advance(1000); h.fireWorker(); await flush();
  eq(sync.state().status, 'expired', 'a signed-out phone did not say so: ' + sync.state().status);
  eq(h.calls.loadCalendar, base2, 'a signed-out phone kept fetching');
  ok(/Sign in again/.test(h.text()), 'the expiry line does not name the next move: ' + h.text());

  h.calendar = () => Promise.resolve({ applied: true, count: 0, error: '', discarded: '' });
  h.token = 'tok-A2';                      /* the doctor signs back in */
  h.advance(1000); h.fireWorker(); await flush();
  eq(h.calls.loadCalendar, base2 + 1,
    'syncing did not resume on the tick after re-auth -- it was still serving the pre-logout backoff');
  eq(sync.state().status, 'ok', 'the resumed sync did not settle ok');
  eq(sync.state().fails, 0, 'the pre-logout failure run survived the new session');
  ok(base > 0, 'setup sync never ran');
}

/* ---- the account boundary ------------------------------------------------ */
async function testWrongAccountRefusal() {
  const block = extractBlock(P1, '1p-mls-connect.js');

  /* (a) the ACCOUNT changes mid-flight */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    h.advance(60000); h.fireWorker(); await flush();
    const okAt = sync.state().lastOkAt;

    let settle = null;
    h.calendar = () => new Promise((r) => { settle = r; });
    h.advance(60000); h.fireWorker();
    eq(sync.state().status, 'syncing', 'the in-flight state is not shown');

    h.win.__mlsSessionAccount = 'b2@example.invalid';
    h.win._calAppts = [{ appt_date: '2026-08-18', name: 'OTHER1' }, { appt_date: '2026-08-18', name: 'OTHER2' }];
    settle({ applied: true, authoritative: true, count: 2, error: '', discarded: '' });
    await flush();

    eq(sync.state().status, 'account', 'a cross-account answer was accepted: ' + sync.state().status);
    eq(sync.state().waiting, 0, 'the other account rows were counted as arrivals');
    eq(sync.state().lastOkAt, okAt, 'the other account refreshed this account last-sync time');
    ok(/different account/.test(h.text()), 'the refusal is not said: ' + h.text());
  }

  /* (b) the TOKEN changes mid-flight without the account name changing */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    let settle = null;
    h.calendar = () => new Promise((r) => { settle = r; });
    h.advance(60000); h.fireWorker();
    h.token = 'tok-B';
    settle({ applied: true, count: 9, error: '', discarded: '' });
    await flush();
    eq(sync.state().status, 'account', 'a token swap mid-flight was accepted');
  }

  /* (c) a NEW account on the same device resets every number */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    h.advance(60000); h.fireWorker(); await flush();
    ok(sync.state().lastOkAt > 0, 'setup sync failed');
    h.win.__mlsSessionAccount = 'c3@example.invalid';
    h.win.__mlsSessionEpoch = 8;
    h.fireWorker();
    eq(sync.state().lastOkAt, 0, 'the previous doctor last-sync time survived an account change');
    eq(sync.state().syncs, 0, 'the previous doctor sync count survived an account change');
    eq(sync.state().account, 'c3@example.invalid#8', 'the state is not rebound to the new account');
  }
}

/* ---- the caret guard ----------------------------------------------------- */
async function testCaretIsNeverDestroyed() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({});
  const sync = h.install(block);
  h.mountPhoneFrame();

  h.document.activeElement = { id: 'mlsPh3Tx' };
  h.calendar = () => {
    h.win._calAppts = [{ appt_date: '2026-08-18', name: 'P1' }];
    return Promise.resolve({ applied: true, count: 1, error: '', discarded: '' });
  };
  h.advance(60000); h.fireWorker(); await flush();
  eq(sync.state().status, 'ok', 'the sync failed');
  eq(h.calls.phoneRender, 0,
    'a background sync forced a ph3 repaint while the caret was in the transcript');
  /* the bar itself still updated -- it lives outside the repainted region */
  ok(/1 new appointment arrived/.test(h.text()), 'the bar did not update: ' + h.text());

  h.document.activeElement = null;
  const before = h.calls.phoneRender;
  h.calendar = () => {
    h.win._calAppts = h.win._calAppts.concat([{ appt_date: '2026-08-18', name: 'P2' }]);
    return Promise.resolve({ applied: true, count: 2, error: '', discarded: '' });
  };
  h.advance(60000); h.fireWorker(); await flush();
  ok(h.calls.phoneRender > before, 'with the caret elsewhere the phone was not repainted');
}

/* ---- the fault matrix: EVERY class gets a sentence ----------------------- */
async function testFaultMatrix() {
  const block = extractBlock(P1, '1p-mls-connect.js');

  const cases = [
    { name: '401 / session expired', calendar: () => Promise.resolve({ error: 'session_expired' }), status: 'expired', says: /Sign in again/ },
    { name: 'hosted but no token', calendar: () => Promise.resolve({ error: 'calendar_unavailable' }), status: 'signedout', says: /Sign in/ },
    { name: '500 from the server', calendar: () => Promise.resolve({ error: 'appointments_http_500' }), status: 'server', says: /HTTP 500/ },
    { name: '503 from the server', calendar: () => Promise.resolve({ error: 'appointments_http_503' }), status: 'server', says: /HTTP 503/ },
    { name: 'unreadable answer', calendar: () => Promise.resolve({ error: 'appointments_invalid_json' }), status: 'server', says: /could not read/ },
    { name: 'network refused', calendar: () => Promise.resolve({ error: 'appointments_unavailable' }), status: 'network', says: /could not reach MLS/ },
    { name: 'thrown', calendar: () => Promise.reject(new Error('boom')), status: 'network', says: /could not reach MLS/ }
  ];

  for (const c of cases) {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    h.calendar = c.calendar;
    h.advance(60000); h.fireWorker(); await flush();
    eq(sync.state().status, c.status, c.name + ': wrong status (' + sync.state().status + ')');
    const line = h.text();
    ok(line && line.length > 12, c.name + ': the bar said nothing');
    ok(c.says.test(line), c.name + ': the sentence does not name the problem: ' + line);
    ok(/Retrying/.test(line) || /Sign in/.test(line), c.name + ': no next move in: ' + line);
  }

  /* offline: the ONLY reliable navigator.onLine answer, and it must not fetch */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    h.sandbox.navigator.onLine = false;
    h.advance(60000); h.fireWorker(); await flush();
    eq(sync.state().status, 'offline', 'a dead uplink was not reported');
    eq(h.calls.loadCalendar, 0, 'an offline phone still tried to fetch');
    ok(/offline/.test(h.text()), 'the offline line is wrong: ' + h.text());
    h.sandbox.navigator.onLine = true;
    h.fireWorker(); await flush();
    eq(sync.state().status, 'ok', 'the offline state did not clear on reconnect');
  }

  /* the request that never answers -- and then answers anyway, late */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    const pending = [];
    h.calendar = () => new Promise((r) => { pending.push(r); });

    h.advance(60000); h.fireWorker(); await flush();
    eq(sync.state().status, 'syncing', 'the in-flight state is wrong');
    eq(pending.length, 1, 'the first request did not start');
    h.advance(20000); h.fireDueTimeouts();
    eq(sync.state().status, 'timeout', 'a stalled request never timed out');
    ok(/has not answered in 20 seconds/.test(h.text()), 'the timeout line is wrong: ' + h.text());
    eq(sync.state().inflight, false, 'the loop stayed wedged after a timeout');

    /* NEWEST WINS. The timed-out request was never abandoned -- loadCalendar
       has no abort and pretending otherwise would be a lie about the network.
       So it can still answer while a NEWER request is in flight. Prove the
       stale answer neither writes the state nor releases the newer request's
       lane, because releasing it would let a third start beside it. */
    h.advance(400000); h.fireWorker(); await flush();
    eq(pending.length, 2, 'the newer request did not start');
    eq(sync.state().inflight, true, 'the newer request is not in flight');
    const runs = h.calls.loadCalendar;

    pending[0]({ applied: true, count: 99, error: '', discarded: '' });   /* the OLD one lands */
    await flush();
    eq(sync.state().inflight, true, 'a stale answer released the newer request lane');
    eq(sync.state().status, 'syncing', 'a stale answer overwrote the newer request state');
    eq(sync.state().syncs, 0, 'a stale answer was counted as a completed sync');

    pending[1]({ applied: true, count: 0, error: '', discarded: '' });
    await flush();
    eq(sync.state().status, 'ok', 'the newer request did not settle');
    eq(sync.state().syncs, 1, 'the newer request was not counted');
    eq(h.calls.loadCalendar, runs, 'an extra request started beside the newer one');
  }

  /* the engine has not loaded */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    delete h.win.loadCalendar;
    h.advance(60000); h.fireWorker(); await flush();
    eq(sync.state().status, 'engine', 'a missing engine was not reported');
    ok(/not finished loading/.test(h.text()), 'the engine line is wrong: ' + h.text());
  }

  /* superseded is NOT a failure: it must not arm the backoff */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    h.calendar = () => Promise.resolve({ applied: false, error: '', discarded: 'superseded' });
    h.advance(60000); h.fireWorker(); await flush();
    eq(sync.state().fails, 0, 'a superseded call was counted as a failure');
    eq(sync.state().status, 'never', 'a superseded call invented a verdict');
  }

  /* a local session reset inside loadCalendar is the account boundary again */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    h.calendar = () => Promise.resolve({ applied: false, error: '', discarded: 'session_changed' });
    h.advance(60000); h.fireWorker(); await flush();
    eq(sync.state().status, 'account', 'a session_changed discard was not treated as an account boundary');
  }

  /* NEVER A SILENT NOTHING: every status this module can hold has a sentence */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    const ALL = ['never', 'syncing', 'ok', 'offline', 'signedout', 'expired',
      'account', 'engine', 'server', 'network', 'timeout', 'local'];
    const seen = new Set();
    const src = extractBlock(P1, '1p-mls-connect.js');
    for (const s of ALL) {
      ok(src.indexOf("'" + s + "'") > 0, 'status ' + s + ' is not in the module at all');
      seen.add(s);
    }
    eq(seen.size, ALL.length, 'status list mismatch');
    /* and the sentence builder covers every one of them */
    const lineFn = slurpFunction(stripComments(src), 'function line()');
    for (const s of ALL) {
      if (s === 'ok' || s === 'syncing' || s === 'never') continue;
      ok(lineFn.indexOf("'" + s + "'") > 0, 'line() has no sentence for status ' + s);
    }
    ok(sync.line().length > 0, 'the initial line is empty');
  }
}

/* ---- backoff, and Sync now ----------------------------------------------- */
async function testBackoffAndManualSync() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({});
  const sync = h.install(block);
  h.mountPhoneFrame();
  h.calendar = () => Promise.resolve({ error: 'appointments_http_500' });

  const want = [40000, 80000, 160000, 300000, 300000];
  for (let i = 0; i < want.length; i += 1) {
    h.advance(400000); h.fireWorker(); await flush();
    eq(sync.state().fails, i + 1, 'failure ' + (i + 1) + ' was not counted');
    eq(sync.state().cadenceMs, want[i], 'backoff after ' + (i + 1) + ' failures is ' + sync.state().cadenceMs);
  }

  /* a person asking is not a retry */
  h.calendar = () => Promise.resolve({ applied: true, count: 0, error: '', discarded: '' });
  const before = h.calls.loadCalendar;
  h.btn().parentNode.fire('click', { target: h.btn(), preventDefault() {}, stopPropagation() {} });
  await flush();
  eq(h.calls.loadCalendar, before + 1, 'Sync now did not sync');
  eq(sync.state().fails, 0, 'Sync now did not clear the backoff');
  eq(sync.state().cadenceMs, 20000, 'the cadence did not return to normal after a manual sync');
  eq(sync.state().waiting, 0, 'Sync now did not clear the waiting badge');
}

/* ---- teardown: the falsy-handle trap, and revert ------------------------- */
async function testTeardown() {
  const block = extractBlock(P1, '1p-mls-connect.js');

  /* Worker construction refused (CSP): the fallback interval must be used AND
     must be clearable -- the first handle this harness hands out is 0. */
  {
    const h = makeHarness({});
    h.sandbox.Worker = function () { throw new Error('refused'); };
    const sync = h.install(block);
    h.mountPhoneFrame();
    eq(sync.timerKind(), 'interval', 'the Worker fallback did not engage');
    const live = () => h.timers.filter((t) => t && t.kind === 'interval').length;
    eq(live(), 1, 'the fallback did not arm exactly one interval');
    sync.revert();
    eq(live(), 0, 'revert() left the fallback interval running -- a handle of 0 is falsy');
  }

  /* the phone app unmounting takes the loop and the bar with it */
  {
    const h = makeHarness({});
    const sync = h.install(block);
    h.mountPhoneFrame();
    eq(sync.timerKind(), 'worker', 'the loop did not start');
    ok(h.bar(), 'the bar did not mount');
    h.unmountPhoneFrame();
    eq(sync.timerKind(), 'none', 'the loop kept running after the phone app unmounted');
    eq(h.bar(), null, 'the bar outlived the phone frame');
    /* and it comes back */
    h.mountPhoneFrame();
    eq(sync.timerKind(), 'worker', 'the loop did not restart when the phone app remounted');
    ok(h.bar(), 'the bar did not come back');

    sync.revert();
    eq(sync.installed, false, 'revert() left the module installed');
    eq(h.bar(), null, 'revert() left the bar on screen');
    eq(h.ctx.window.__mlsP1PhoneSync, undefined, 'revert() left the global behind');
  }
}

/* ---- a local (non-hosted) session must not be told it is broken ---------- */
async function testLocalSessionIsNotAFailure() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({ hosted: false });
  const sync = h.install(block);
  h.mountPhoneFrame();
  h.advance(60000); h.fireWorker(); await flush();
  eq(sync.state().status, 'local', 'a local session was given a network verdict');
  eq(h.calls.loadCalendar, 0, 'a local session tried to reach the backend');
  /* Not "signed out": telling a doctor to sign in when they already have, on a
     session with no server behind it, is an instruction that goes nowhere. */
  ok(!/Sign in/.test(h.text()), 'a local session was told to sign in: ' + h.text());
  ok(/sample session/.test(h.text()) && /no MLS server/.test(h.text()), 'the local line is wrong: ' + h.text());
  /* and Sync now refuses the same way rather than pretending */
  await sync.syncNow('manual');
  eq(h.calls.loadCalendar, 0, 'Sync now reached for a backend that is not there');
  eq(sync.state().status, 'local', 'Sync now changed the local verdict');
}

/* ---- the device noun is asked, never assumed ----------------------------- */
async function testDeviceNoun() {
  const block = extractBlock(P1, '1p-mls-connect.js');
  const h = makeHarness({ noun: 'Mac' });
  const sync = h.install(block);
  h.mountPhoneFrame();
  h.advance(60000); h.fireWorker(); await flush();
  ok(/^Mac connected/.test(h.text()), 'a Mac was called a phone: ' + h.text());
  h.noun = 'iPad';
  h.calendar = () => Promise.resolve({ error: 'appointments_unavailable' });
  h.advance(60000); h.fireWorker(); await flush();
  ok(/This iPad could not reach MLS/.test(h.text()), 'the failure line assumed a phone: ' + h.text());
  ok(sync.state().status === 'network', 'setup');
}

/* ---------------------------------------------------------------------------
 * THE CONTRACT WITH ph3, read out of ph3's own source.
 * This module hangs a bar inside another module's frame and restates that
 * module's caret guard. Both are handshakes across a file boundary, and a
 * handshake nobody asserts is a phantom the day the other side is rewritten:
 * a renamed frame id would leave this bar mounted nowhere, silently, with the
 * receive loop never starting and no error anywhere.
 * -------------------------------------------------------------------------*/
function testPh3ContractHolds() {
  const ph3 = stripComments(PH3);
  const mine = stripComments(extractBlock(P1, '1p-mls-connect.js'));

  const mount = slurpFunction(ph3, 'function mount()');
  ok(mount.length > 200, 'ph3 mount() could not be located');
  for (const id of ['mlsPh3', 'mlsPh3Note', 'mlsPh3Body', 'mlsPh3Act']) {
    ok(mount.indexOf(id) > 0, 'ph3 mount() no longer creates #' + id + ' -- the sync bar would mount nowhere');
  }
  /* The sync module names exactly two of them: the frame it lives in and the
     scroller it sits above. It deliberately does NOT name #mlsPh3Note --
     insertBefore(#mlsPh3Body) puts it after the sticky message without either
     module having to know the other's ordering. */
  for (const id of ['mlsPh3', 'mlsPh3Body']) {
    ok(mine.indexOf(id) > 0, 'the sync module no longer references #' + id);
  }

  /* render() must still rewrite ONLY the scroller and the action bar; the day
     it starts rewriting the frame, a sibling stops being a safe place. */
  const render = slurpFunction(ph3, 'function render(force)');
  ok(render.length > 200, 'ph3 render() could not be located');
  ok(/bodyEl\.innerHTML\s*=/.test(render), 'ph3 render() no longer rewrites its scroller -- re-check the placement');
  ok(/actEl\.innerHTML\s*=/.test(render), 'ph3 render() no longer rewrites its action bar');
  ok(!/frameEl\.innerHTML\s*=/.test(render), 'ph3 render() now rewrites the WHOLE FRAME: the sync bar would be erased on every repaint');

  /* the caret ids this module refuses to repaint over are ph3's own */
  const caret = slurpFunction(ph3, 'function caretIsOurs()');
  ok(caret.indexOf('mlsPh3Tx') > 0 && caret.indexOf('mlsPh3Find') > 0, 'ph3 caretIsOurs() no longer names those two fields');
  ok(mine.indexOf('mlsPh3Tx') > 0 && mine.indexOf('mlsPh3Find') > 0, 'the sync module no longer guards ph3 caret fields');

  /* and ph3's own render entry point really is force=true -- which is WHY the
     guard has to be restated on this side rather than delegated to ph3 */
  ok(/api\.render\s*=\s*function\s*\(\)\s*\{\s*S\.lastSig\s*=\s*'';\s*render\(true\);\s*\}/.test(ph3),
    'ph3 api.render() is no longer an unconditional forced repaint -- re-check whether the external caret guard is still needed');
}

/* ===========================================================================
 * PART 3 -- THE LANES
 * =========================================================================*/
function testEveryLaneLoadsThePhoneApp() {
  const LOADER = "s.src='feat_mls_phone_ui.js?v='+(window.__MLS_AV||Date.now())";
  for (const [name, src] of [['mls-connect.js', PROD], ['1p-mls-connect.js', P1], ['cloned-mls-connect.js', CLONED]]) {
    ok(src.indexOf(LOADER) > 0, name + ': does not load feat_mls_phone_ui.js');
    ok(src.indexOf("data-mls-asset','feat_mls_phone_ui.js'") > 0, name + ': the phone module is not asset-tagged');
    ok(/\[\?&\]phone=1/.test(src), name + ': the ?phone=1 entry point is gone');
  }
  ok(fs.existsSync(path.join(ROOT, 'feat_mls_phone_ui.js')), 'feat_mls_phone_ui.js is not on disk');

  /* RESOLVE the relative asset URL under each lane's own <base>, rather than
     reasoning about it. A lane whose <base> ate the leading slash would ship a
     phone app that 404s and a doctor would see the desktop workspace. */
  const cases = [
    ['/1pScribeFlow.html', null, '/feat_mls_phone_ui.js'],
    ['/1p/', '/1p', '/feat_mls_phone_ui.js'],
    ['/cloned/', '/cloned', '/feat_mls_phone_ui.js'],
    ['/ScribeFlow.html', null, '/feat_mls_phone_ui.js']
  ];
  for (const [page, base, want] of cases) {
    const origin = 'https://mlsscribe.com';
    const effective = base ? new URL(base, origin + page).href : origin + page;
    const resolved = new URL('feat_mls_phone_ui.js', effective);
    eq(resolved.pathname, want, page + ' (base ' + base + ') resolves the phone module to ' + resolved.pathname);
  }

  /* the <base> each lane actually declares */
  ok(/<base href="\/1p">/.test(P1_INDEX), '1p/index.html no longer declares <base href="/1p">');
  ok(/<base href="\/cloned">/.test(CLONED_INDEX), 'cloned/index.html no longer declares <base href="/cloned">');
  ok(P1_SHELL.indexOf('<base href=') < 0, '1pScribeFlow.html has gained a <base>; re-run the resolution table');
}

/* The receive loop must reach /cloned, and /cloned is DERIVED from /1p by
   scripts/derive-cloned-from-1p.js. So the question is not "did somebody copy
   it over" but "does the derivation carry it, byte for byte". Answered by
   running the real generator rather than by reading the file on disk -- the
   file on disk can be, and currently is, stale. */
function testDerivationCarriesTheBlock() {
  const derive = require(path.join(ROOT, 'scripts', 'derive-cloned-from-1p.js'));
  const built = derive.generate('');
  const bundle = built.files.filter((f) => f.name === derive.CONNECT_OUT)[0];
  ok(bundle, 'the derivation produced no ' + derive.CONNECT_OUT);

  const mine = extractBlock(P1, '1p-mls-connect.js');
  ok(bundle.text.indexOf(mine) >= 0,
    'the derived ' + derive.CONNECT_OUT + ' does not carry the p1-phone-sync block byte-for-byte');

  /* And the block itself names no lane, so the identity rewrite has nothing to
     do to it -- which is WHY it survives unchanged. */
  for (const needle of derive.FORBIDDEN) {
    ok(mine.indexOf(needle) < 0, 'the p1-phone-sync block contains the lane token ' + needle);
  }
  ok(mine.indexOf('__MLS_P1_PREVIEW') < 0, 'the block is gated on the /1p marker and would arm nothing in /cloned');

  /* Reported, never owned. If OTHER /1p bytes still name the lane, the
     derivation REFUSES and /cloned receives nothing at all -- including this.
     On this branch two shell comments do (they name the bundle by file name);
     origin/main 469607c9 already fixed it inside the derive script itself, so
     the cure is a rebase, not an edit here. Surfaced by name rather than left
     to hide behind a suite that only ever looks at cloned/*. */
  const survivors = derive.survivors(built.files);
  if (survivors.length) {
    console.log('  NOTE: /cloned cannot be re-derived from THIS branch; ' + survivors.length +
      ' lane token(s) survive (fixed on origin/main 469607c9 -- rebase, do not edit):\n    ' +
      survivors.join('\n    '));
  }
}

/* The /1p shells are twins and this lane did not touch them; prove it. */
function testShellsUntouched() {
  const canon = (v) => String(v)
    .replace("base-uri 'self'", "base-uri 'none'")
    .replace(/<!-- p1-live-1\.0\.0:[\s\S]*?<base href="\/1p">\r?\n/, '')
    .replace("route:'/1p/'", "route:'/1pScribeFlow.html'");
  eq(canon(P1_INDEX), P1_SHELL, 'the /1p twins have diverged');
}

/* ===========================================================================
 * RUN
 * =========================================================================*/
(async function main() {
  testPh3VisibilityDoesNotResync();
  testPh3HasNoScheduleLoop();
  testRelayPollerAsymmetry();
  await testPollJobLosesASuccessfulPull();

  await testDesktopPaysNothing();
  await testBarSurvivesRepaints();
  await testHeartbeatIsQuiet();
  await testReceivesNewAppointments();
  await testHiddenTabAndCatchUp();
  await testReAuthResume();
  await testWrongAccountRefusal();
  await testCaretIsNeverDestroyed();
  await testFaultMatrix();
  await testBackoffAndManualSync();
  await testTeardown();
  await testLocalSessionIsNotAFailure();
  await testDeviceNoun();

  testPh3ContractHolds();
  testEveryLaneLoadsThePhoneApp();
  testDerivationCarriesTheBlock();
  testShellsUntouched();

  console.log('PASS 1p-phone-sync-receive-loop-runtime (' + checks + ' checks)');
})().catch((e) => { console.error(e); process.exit(1); });
