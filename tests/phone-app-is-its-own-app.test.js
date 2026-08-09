'use strict';

/* THE PHONE APP IS ITS OWN APP  (feat_mls_phone_ui.js, ph2-1.0.0)
 * =============================================================================
 * Owner, 2026-08-07: "completely change the PHONE app UI from scratch ... make
 * sure a desktop is never called a phone."
 *
 * WHAT THIS SUITE IS FOR. The module it guards is a replacement UI for one
 * class of device, which means two failure modes matter more than anything it
 * draws:
 *
 *   1. It covers the screen. If it EVER mounts on a machine it should not own,
 *      the doctor loses the desktop app behind an opaque frame. Every gate is
 *      executed here against real user agents, not asserted from source.
 *   2. It drives a clinical engine it does not own. If it reaches around the
 *      engine's published entry points, it has quietly forked the context lock,
 *      the identity check and the phase machine — three guarantees this product
 *      spent months getting right. So the tests below prove WHICH function each
 *      control calls, not merely that the control exists.
 *
 * jsdom-free hand-rolled DOM (repo convention). innerHTML is not parsed by a
 * real engine here, so the harness registers the ids it sees assigned — which
 * is enough to run the module's real mount, render, action and teardown paths
 * end to end, and to read back the exact markup a phone would be shown.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_phone_ui.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/* ===========================================================================
 * HARNESS
 * =========================================================================*/
function makeHarness(opts) {
  opts = opts || {};
  const byId = new Map();
  const timers = [];
  const calls = { pullDay: 0, startVisitFor: [], record: 0, stopRecording: 0, generate: 0, cancelActive: 0, toasts: [] };

  function makeNode(tag) {
    const n = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '', type: '', textContent: '', value: '', disabled: false,
      style: { cssText: '', display: '' },
      children: [], parentNode: null, isConnected: true,
      _handlers: {}, _html: '',
      classList: {
        _set: new Set(),
        add(c) { n.classList._set.add(c); },
        remove(c) { n.classList._set.delete(c); },
        contains(c) { return n.classList._set.has(c); },
        toggle(c, f) { const want = f === undefined ? !n.classList._set.has(c) : !!f; if (want) n.classList._set.add(c); else n.classList._set.delete(c); return want; }
      },
      get innerHTML() { return n._html; },
      set innerHTML(v) { n._html = String(v == null ? '' : v); registerIds(n._html); },
      setAttribute(k, v) { n['attr_' + k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(n, 'attr_' + k) ? n['attr_' + k] : null; },
      removeAttribute(k) { delete n['attr_' + k]; },
      addEventListener(t, fn) { (n._handlers[t] = n._handlers[t] || []).push(fn); },
      removeEventListener(t, fn) { n._handlers[t] = (n._handlers[t] || []).filter(f => f !== fn); },
      dispatchEvent() { return true; },
      appendChild(c) { n.children.push(c); c.parentNode = n; if (c.id) byId.set(c.id, c); return c; },
      insertBefore(c) { n.children.unshift(c); c.parentNode = n; if (c.id) byId.set(c.id, c); return c; },
      removeChild(c) { n.children = n.children.filter(x => x !== c); c.parentNode = null; c.isConnected = false; return c; },
      remove() { if (n.parentNode) n.parentNode.removeChild(n); n.isConnected = false; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      closest() { return null; },
      scrollIntoView() {},
      focus() {},
      fire(type, ev) { (n._handlers[type] || []).forEach(fn => fn(ev)); }
    };
    return n;
  }
  /* The module builds its frame with innerHTML, then resolves the pieces by id.
     A stub DOM parses nothing, so the ids it declares are registered here. */
  function registerIds(html) {
    const re = /id="([A-Za-z0-9_-]+)"/g;
    let m;
    while ((m = re.exec(html))) if (!byId.has(m[1])) byId.set(m[1], makeNode('div'));
  }

  const body = makeNode('body');
  body.id = 'body';
  const head = makeNode('head');

  const document = {
    readyState: 'complete',
    visibilityState: opts.hidden ? 'hidden' : 'visible',
    activeElement: null,
    body, head, documentElement: head,
    createElement: makeNode,
    getElementById(id) { return byId.get(id) || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(t, fn) { (document._h = document._h || {})[t] = (document._h[t] || []).concat(fn); },
    removeEventListener() {},
    _fire(t, ev) { ((document._h || {})[t] || []).forEach(fn => fn(ev)); }
  };

  /* Engine doubles. Each records WHICH published entry point was reached — the
     point of this suite is that the phone drives these and nothing else. */
  const snapshot = Object.assign({
    day: '2026-08-07', phase: 'idle', active: null, recSecs: 0, warn: '',
    today: [], guards: { on: true, blocked: 0 }
  }, opts.snapshot || {});

  const win = {
    __mlsPhoneHome: opts.phoneHome === null ? undefined : Object.assign({
      wantPhone: () => !!opts.wantPhone,
      ensure() {}
    }, opts.phoneHome || {}),
    __mlsDeviceRole: {
      role: () => opts.role || null,
      name: () => opts.deviceName || 'iOS · Safari',
      deviceNoun: () => opts.deviceNoun || 'iPhone'
    },
    __mlsEasyV32: {
      remote: {
        snapshot: () => snapshot,
        startVisitFor(id, o) { calls.startVisitFor.push({ id, opts: o }); return true; },
        record() { calls.record++; return true; },
        stopRecording() { calls.stopRecording++; return true; },
        generate() { calls.generate++; return true; },
        requestSendReview() { return true; }
      }
    },
    __mlsDaySwitch: {
      currentDay: () => snapshot.day,
      setDay() {}, shiftDay(n) { calls.shifted = n; },
      rowsFor: () => snapshot.today,
      pullDay() { calls.pullDay++; }
    },
    __mlsRelayLink: {
      shouldRelay: () => opts.relay !== false,
      extPresent: () => !!opts.ext,
      activeJob: () => opts.activeJob || null,
      cancelActive() { calls.cancelActive++; return Promise.resolve(true); }
    },
    backendMode: () => opts.authed !== false,
    bkToken: () => (opts.authed === false ? '' : 'tok'),
    bkBase: () => 'https://backend.example',
    toast(m, k) { calls.toasts.push({ m: String(m), k }); },
    _acctTodayKey: () => '2026-08-07',
    matchMedia: () => ({ matches: false }),
    addEventListener(t, fn) { (win._h = win._h || {})[t] = (win._h[t] || []).concat(fn); },
    removeEventListener() {},
    navigator: { userAgent: opts.ua || IPHONE_UA, maxTouchPoints: opts.touch === false ? 0 : 5, clipboard: { writeText() {} } },
    location: { search: opts.search || '' },
    open() {},
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(opts.presence || null) })
  };
  win.window = win;
  win.document = document;
  win.navigator = win.navigator;
  win.MutationObserver = function (cb) {
    this.observe = function () { win._mo = cb; };
    this.disconnect = function () { win._mo = null; };
  };
  win.setTimeout = function (fn, ms) { const id = timers.length; timers.push({ fn, ms, id, live: true }); return id; };
  win.clearTimeout = function (id) { if (timers[id]) timers[id].live = false; };
  win.sessionStorage = { _m: Object.assign({}, opts.session), getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
  win.localStorage = { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); } };
  win.Event = function (t) { this.type = t; };
  win.console = console;
  win.Date = Date; win.Math = Math; win.JSON = JSON; win.String = String; win.Number = Number;
  win.Object = Object; win.Array = Array; win.Promise = Promise; win.Error = Error;
  win.URLSearchParams = URLSearchParams;

  vm.createContext(win);
  vm.runInContext(source, win, { filename: 'feat_mls_phone_ui.js' });

  return {
    win, document, body, byId, calls, timers, snapshot,
    api: () => win.__mlsPhoneUI,
    /* Read from the TREE, never from the id index. After revert() the node
       still exists as an object, so a helper answering from the index would let
       a leaked frame pass as removed — the assertion would grade nothing. */
    frame: () => body.children.filter(c => c.id === 'mlsPh2')[0] || null,
    screen: () => (byId.get('mlsPh2Body') || { _html: '' })._html,
    /* Deliver a click the way the browser would: one delegated listener on the
       frame, an event whose target resolves the nearest [data-act]. */
    tap(act, attrs) {
      const f = this.frame();
      assert(f, 'cannot tap ' + act + ': the frame is not mounted');
      const el = { getAttribute: (k) => (k === 'data-act' ? act : (attrs || {})[k] || null) };
      f.fire('click', { target: { closest: (sel) => (sel === '[data-act]' ? el : null) } });
    },
    liveTimers() { return timers.filter(t => t.live).length; }
  };
}

/* ===========================================================================
 * 1. IT NEVER TAKES A SCREEN THAT IS NOT A PHONE'S
 * =========================================================================*/
{
  const h = makeHarness({ ua: MAC_UA, touch: false, wantPhone: false });
  assert(!h.frame(), 'THE ONE THAT MATTERS: the phone shell mounted on a MacBook');
  assert(!h.body.classList.contains('mls-ph2'), 'a desktop must never carry the phone body class');
  assert.strictEqual(h.api().owns(), false, 'owns() must be false on a desktop');
}
{
  /* Signed OUT on a real phone: the app owns the screen with its own login
     surface, and covering it would hide the only way in. */
  const h = makeHarness({ wantPhone: true, authed: false });
  assert(!h.frame(), 'the shell must not cover the sign-in screen');
}
{
  const h = makeHarness({ wantPhone: true });
  assert(h.frame(), 'a real iPhone must get the phone app');
  assert(h.body.classList.contains('mls-ph2'), 'the phone body class must be set on mount');
}

/* Ownership is DELEGATED, never re-decided. Two definitions of "this is a
   phone" is how the two surfaces end up disagreeing about which UI is right. */
{
  const h = makeHarness({ wantPhone: false, ua: IPHONE_UA });
  assert(!h.frame(),
    'wantPhone() said no on a handheld and the module mounted anyway — it is deciding for itself');
}
assert(/ph\.wantPhone\(\)/.test(source),
  'owns() must consult __mlsPhoneHome.wantPhone(), the definition device-role-contract already pins');
assert(!/innerWidth/.test(source),
  'window width must never appear in this module — that is the bug that made narrow laptops phones');

/* The loader must not even REQUEST the file on a desktop. */
{
  const loader = connect.slice(connect.indexOf("want=/iPhone|iPod|Android") - 900, connect.indexOf('feat_mls_phone_ui.js') + 400);
  assert(/if\(!want\)return;/.test(loader),
    'the loader must return before creating the script element when the device is not a phone');
  assert(!/innerWidth/.test(loader), 'the loader must not classify by window width either');
}

/* ===========================================================================
 * 2. THREE DESTINATIONS, AND THE TABS REALLY MOVE
 * =========================================================================*/
{
  const h = makeHarness({ wantPhone: true });
  const tabs = (h.frame()._html.match(/data-tab="([a-z]+)"/g) || []);
  assert.deepStrictEqual(tabs, ['data-tab="today"', 'data-tab="visit"', 'data-tab="setup"'],
    'the phone must offer exactly three destinations, in this order');

  assert.strictEqual(h.api().state().tab, 'today', 'the phone opens on the day');
  h.api().go('setup');
  assert.strictEqual(h.api().state().tab, 'setup', 'go() must switch screens');
  assert(/This iPhone/.test(h.screen()), 'the setup screen must render after the switch');
  h.api().go('nonsense');
  assert.strictEqual(h.api().state().tab, 'today', 'an unknown destination must fall back to the day, not blank the app');
}

/* ===========================================================================
 * 3. THE PULL SAYS WHAT IS TRUE, AND PRESSES THE SHARED ENGINE
 * =========================================================================*/
{
  /* Empty day. */
  const h = makeHarness({ wantPhone: true });
  assert(/No patients loaded for today yet/.test(h.screen()),
    'an empty day must say so plainly');
  assert(/Get today's patients/.test(h.screen()),
    'the button must name the OUTCOME — "pull" is vocabulary a phone user has never been taught');

  h.tap('pull-start');
  assert.strictEqual(h.calls.pullDay, 1,
    'the phone pull must route through __mlsDaySwitch.pullDay — the same call the desktop button ' +
    'makes, so the cross-tab shield, the session serial and the receipt check all still apply');
}
{
  /* Loaded day: the count is the headline, and refreshing is demoted. */
  const h = makeHarness({
    wantPhone: true,
    snapshot: { today: [
      { id: 'a1', name: 'Marcus Bell', time: '8:30 AM', seen: true },
      { id: 'a2', name: 'Priya Raman', time: '9:00 AM' }
    ] }
  });
  const s = h.screen();
  assert(/2 patients ready for today/.test(s), 'a loaded day must lead with the count');
  assert(/ph2-secondary" data-act="pull-start"/.test(s),
    'with the day already loaded, re-checking Athena must not be the loudest control on screen');
  assert(/Marcus Bell/.test(s) && /Priya Raman/.test(s), 'every patient must be listed');
  assert(/ph2-seen/.test(s), 'an already-seen patient must be marked');
}
{
  /* A blocked relay is knowable BEFORE the press, so it is said before it. */
  const h = makeHarness({ wantPhone: true });
  h.api()._presence = { online: true, ext: true, officeName: 'Front desk PC', officeAth: 'no-tab' };
  h.api().render();
  assert(/athenaOne is signed out on Front desk PC/.test(h.screen()),
    'a known blocker must be named on the day screen, not discovered after a failed pull');
  assert(/What to do/.test(h.screen()), 'a blocker must come with a route to the fix');
}
{
  /* The engine's own sentence survives verbatim. */
  const h = makeHarness({ wantPhone: true });
  h.byId.set('mlsDsStatus', Object.assign(h.document.createElement('div'), {
    textContent: 'Front desk PC: Reading verified history 3 of 7…'
  }));
  h.api().render();
  assert(/Reading verified history 3 of 7/.test(h.screen()),
    'the engine status sentence must be shown WORD FOR WORD under the headline — a plain-language ' +
    'summary that replaces the truth is the silent-refusal failure this product already knows');
}
{
  /* Stop really cancels the relayed job. */
  const h = makeHarness({ wantPhone: true, activeJob: { id: 'j1' } });
  assert(/Getting your patients/.test(h.screen()), 'a running pull must be visible as running');
  h.tap('pull-stop');
  assert.strictEqual(h.calls.cancelActive, 1, 'Stop must cancel the real relay job, not just repaint');
}

/* ===========================================================================
 * 4. OPENING A PATIENT NEVER OPENS A MICROPHONE
 * =========================================================================*/
{
  const h = makeHarness({ wantPhone: true, snapshot: { today: [{ id: 'a2', name: 'Priya Raman', time: '9:00 AM' }] } });
  h.tap('open', { 'data-id': 'a2' });
  assert.strictEqual(h.calls.startVisitFor.length, 1, 'tapping a patient must open that patient');
  assert.strictEqual(h.calls.startVisitFor[0].id, 'a2', 'it must open the row that was tapped');
  assert.strictEqual(h.calls.startVisitFor[0].opts.record, false,
    'THE LOAD-BEARING ONE: a tap can be a mis-tap. A microphone that starts on one is a recording ' +
    'nobody chose to make, in a room with a patient in it.');
  assert.strictEqual(h.calls.record, 0, 'no recording may start from the patient list');
  assert.strictEqual(h.api().state().tab, 'visit', 'opening a patient must land on their visit');
}

/* ===========================================================================
 * 5. THE VISIT SCREEN IS THE ENGINE'S PHASE, ONE PRIMARY AT A TIME
 * =========================================================================*/
function visitAt(phase, extra) {
  const h = makeHarness({
    wantPhone: true,
    snapshot: Object.assign({ phase, active: { id: 'a2', name: 'Priya Raman', time: '9:00 AM', dob: '1979-04-12' } }, extra || {})
  });
  h.api().go('visit');
  return h;
}
{
  const idle = visitAt('idle').screen();
  assert(/Start recording/.test(idle), 'an idle visit offers recording');
  assert(!/Write the note/.test(idle), 'and offers nothing else as a primary');

  const rec = visitAt('rec', { recSecs: 257 }).screen();
  assert(/Stop recording/.test(rec), 'a live visit offers Stop');
  assert(/04:17/.test(rec), 'a live visit shows how long it has been recording');

  const stopped = visitAt('stopped').screen();
  assert(/Write the note/.test(stopped) && /Keep recording/.test(stopped),
    'AUDIT B3: a stopped recording must offer both a way on and a way back — this was the dead end');

  const gen = visitAt('gen').screen();
  assert(/Writing the note/.test(gen) && /disabled/.test(gen),
    'a running generation must be visible and un-pressable, not offered a second time');

  const note = visitAt('note').screen();
  assert(/Send for review/.test(note) && /Copy the note/.test(note),
    'a finished note must be sendable and copyable from the phone');
}
{
  /* AUDIT B2: the transcript. It was killed in three places at once on the old
     phone, so there was no transcript anywhere on the device. */
  const h = visitAt('rec');
  h.byId.set('transcript', Object.assign(h.document.createElement('textarea'), { value: 'the knee catches on stairs' }));
  h.api().render();
  const s = h.screen();
  assert(/the knee catches on stairs/.test(s), 'AUDIT B2: the transcript must be visible on the phone');
  assert(/<textarea class="ph2-tx"/.test(s), 'and it must be editable, not a read-only copy');
}
{
  /* An edit reaches the canonical element the rest of the app reads. There is
     no second transcript. */
  const h = visitAt('stopped');
  const real = Object.assign(h.document.createElement('textarea'), { value: 'old' });
  let dispatched = 0;
  real.dispatchEvent = () => { dispatched++; return true; };
  h.byId.set('transcript', real);
  h.frame().fire('input', { target: { id: 'mlsPh2Tx', value: 'corrected text' } });
  assert.strictEqual(real.value, 'corrected text', 'a phone edit must write the canonical #transcript');
  assert.strictEqual(dispatched, 1, 'and must fire the input event every other module listens for');
}
{
  /* A refusal must arrive with its reason. */
  const h = visitAt('idle', { warn: 'This row is missing its exact Athena appointment ID.' });
  assert(/missing its exact Athena appointment ID/.test(h.screen()),
    'the engine refusal sentence must reach the phone — a dead button with no reason beside it is ' +
    'exactly what the old hide list produced');
}
assert(/warn: S\.lastWarn \|\| ''/.test(connect),
  'the engine snapshot must carry lastWarn, or the phone has no way to show why a control refused');

/* ===========================================================================
 * 6. A DESKTOP IS NEVER CALLED A PHONE
 * =========================================================================*/
{
  const mac = makeHarness({ wantPhone: true, ua: MAC_UA, role: 'phone', deviceNoun: 'Mac', deviceName: 'MacBook Pro' });
  mac.api().go('setup');
  const s = mac.screen();
  assert(/This Mac/.test(s), 'a Mac in the simple layout must be called a Mac');
  /* Precisely the self-referential forms. "Open this on your phone" is CORRECT
     copy on a computer — it is about a phone the reader also owns. The defect is
     a sentence that calls the machine you are reading it on a phone. */
  for (const wrong of ['this phone', 'This phone', 'Phone mode', 'your phone’s', "your phone's"]) {
    assert(s.indexOf(wrong) < 0,
      'a Mac was called a phone ("' + wrong + '") on its own Setup screen:\n' + s.slice(0, 400));
  }
  assert(!/Phone \/ remote/.test(s),
    'the role label must name what the role DOES — "Phone / remote" is a hardware claim on a MacBook that holds it');

  const iphone = makeHarness({ wantPhone: true, deviceNoun: 'iPhone' });
  iphone.api().go('setup');
  assert(/This iPhone/.test(iphone.screen()), 'and an iPhone is still called an iPhone');
}
/* The word has ONE owner, and the fallback in this module makes the same
   promise the canonical one does. */
assert(/api\.deviceNoun = deviceNoun;/.test(connect),
  '__mlsDeviceRole must publish deviceNoun() — every surface asks it rather than guessing');
assert(/case 'macOS': return 'Mac';/.test(connect) && /case 'Windows': return 'Windows PC';/.test(connect),
  'the canonical noun must name desktops as desktops');
assert(!/'📱 Phone mode'/.test(connect),
  'the fixed "Phone mode" label is back — it printed on every relaying laptop and tablet');

/* ===========================================================================
 * 7. IT COSTS A POCKETED PHONE NOTHING, AND IT LETS GO CLEANLY
 * =========================================================================*/
/* Graded against comment-stripped source. The module header explains WHY it
   carries no interval, and that prose necessarily contains the identifier being
   banned — matching it would have this assertion grade a comment, which is the
   same mistake the capture-survival suite already made once. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
assert(!/setInterval/.test(code),
  'no setInterval in the phone app: an interval keeps firing in a pocket. The ticker is a ' +
  'setTimeout loop gated on live() AND document visibility.');
assert(/observe\(host, \{ childList: true, subtree: true/.test(source) && /\$\('mlsEz3Body'\)/.test(source),
  'the observer must be scoped to the visit body, never to the document');
/* 2026-08-08 (ph2-1.1.0): "an idle mounted phone must schedule nothing" was
   tightened rather than relaxed when the avatar check-in watch landed.
   The owner asked for the finished-intake summary to reach this app, and a
   summary that arrives while the doctor is looking at Today has to be noticed
   somehow. So ONE timer is now permitted on an idle VISIBLE screen, and this
   names which one and at what period — a stronger statement than "0", which
   would have been satisfied by a module that also stopped ticking a recording.
   The hidden case is unchanged and now genuinely enforced: the watch refuses to
   ARM while hidden, rather than arming and checking visibility on fire. */
{
  const idle = makeHarness({ wantPhone: true });
  const running = makeHarness({ wantPhone: true, snapshot: { phase: 'rec' } });
  const hidden = makeHarness({ wantPhone: true, snapshot: { phase: 'rec' }, hidden: true });
  const fired = (h) => { h.timers.filter(t => t.live).forEach(t => { t.live = false; t.fn(); }); return h.liveTimers(); };

  assert.strictEqual(fired(running) > 0, true, 'a live recording must keep the screen ticking');

  assert.strictEqual(fired(hidden), 0,
    'THE POCKET RULE: a hidden tab must schedule nothing, even mid-recording. A hidden tab\'s timers ' +
    'are frozen, not throttled, so one armed here cannot fire — it only releases a burst of stale ' +
    'checks on resume, which onVisible() already covers sooner.');

  /* Settled: fire everything once, so the mount-time 250ms tick has run and
     declined to re-arm. What is still live after that is what this screen holds
     for as long as it is left alone. */
  const idleLive = (fired(idle), idle.timers.filter(t => t.live));
  assert.strictEqual(idleLive.length, 1,
    'a SETTLED idle visible phone may hold exactly one timer — the check-in watch — and nothing else. ' +
    'Held: ' + idleLive.map(t => t.ms + 'ms').join(', '));
  assert.strictEqual(idleLive[0].ms, idle.api()._ckPoll,
    'and it must be the 45s check-in watch, not the 1s screen ticker left running on an idle screen');
  assert(idle.api()._ckPoll >= 30000,
    'the watch period must stay in seconds-tens: this runs on battery, in a pocket, between rooms');
}
{
  const h = makeHarness({ wantPhone: true });
  let handedBack = 0;
  h.win.__mlsPhoneHome.ensure = () => { handedBack++; };
  h.api().revert();
  assert(!h.frame(), 'revert() must remove the frame');
  assert(!h.body.classList.contains('mls-ph2'), 'revert() must drop the body class');
  assert.strictEqual(handedBack, 1, 'revert() must hand the screen back to the layer it replaced');
  assert(!h.win.__mlsPhoneUI, 'revert() must release the namespace so a reload can reinstall');
}
/* And the layer it replaced stands down while it is mounted, rather than
   running 28 hide rules underneath an opaque frame. */
assert(/function newUiOwns\(\)/.test(connect) && /if \(newUiOwns\(\)\) \{/.test(connect),
  '__mlsPhoneHome must stand down while the new phone app owns the screen');

console.log('PASS the phone app is its own app: it never mounts on a desktop (Mac + signed-out + ' +
  'delegated ownership all executed), 3 destinations that switch, the pull routes through the SHARED ' +
  'day-switch engine and keeps the engine sentence verbatim, a known blocker is named before the press, ' +
  'opening a patient passes record:false, all 5 visit phases offer one primary, the transcript is back ' +
  'and writes the canonical #transcript, a Mac is called a Mac, zero intervals and zero timers when ' +
  'hidden or idle, and revert() hands the screen back');
