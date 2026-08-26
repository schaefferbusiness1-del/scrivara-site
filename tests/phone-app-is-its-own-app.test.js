'use strict';

/* THE PHONE APP IS ITS OWN APP  (feat_mls_phone_ui.js, ph3-1.0.0)
 * =============================================================================
 * Owner, 2026-08-07: "completely change the PHONE app UI from scratch ... make
 * sure a desktop is never called a phone."
 * Owner, 2026-08-09: "the phone app is suppost to do all these thigns and be
 * easy to use and it just sucks. Learn what it support to do remark from
 * scratch confirm everyhting works uplaod live."
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
 * WHAT CHANGED AT ph3, AND WHY THIS FILE MOVED WITH IT
 * -----------------------------------------------------------------------------
 * ph2 spent the bottom of the screen — the only band a thumb reaches without
 * re-gripping — on THREE TABS, one of which (Visit) was usually a signpost back
 * to the first and one of which (Setup) was 161 words of prose. ph3 deletes the
 * tab bar outright: there are TWO screens ('day' is home, 'visit' is pushed with
 * Back in the header), the account/device controls are one sheet, and the bottom
 * band holds ONE contextual verb. Every three-tab assertion below has been
 * re-expressed against that model rather than deleted — the intent ("there are N
 * destinations and they really move") is pinned as "there are two screens, the
 * ONE header control changes meaning between them, and the bar is not a
 * destination at all".
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

/* Graded against comment-stripped source wherever a source assertion is made.
   The module header explains WHY each of these choices was made, and that prose
   necessarily contains the identifiers being counted — matching raw source would
   have the assertion grade a comment, which is the mistake the capture-survival
   suite already made once. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* ===========================================================================
 * HARNESS
 * =========================================================================*/
function makeHarness(opts) {
  opts = opts || {};
  const byId = new Map();
  /* ONE list for both kinds of timer, because the module's own trap is that a
     handle of 0 is falsy: the first handle this harness ever hands out is 0, on
     purpose, so a `if (t)` clear would be caught rather than accommodated. */
  const timers = [];
  const calls = {
    pullDay: 0, startVisitFor: [], record: 0, stopRecording: 0, generate: 0,
    sendReview: 0, cancelActive: 0, toasts: [], shifted: null, setDay: [],
    showView: [], logout: 0, logoutArgs: null, openSettings: 0, phoneHomeEnsure: 0
  };

  function makeNode(tag) {
    const n = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '', type: '', textContent: '', value: '', disabled: false, hidden: false,
      scrollTop: 0,
      style: {
        cssText: '', display: '',
        setProperty(k, v) { this['_' + k] = String(v); },
        removeProperty(k) { delete this['_' + k]; }
      },
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
      get className() { return n._className || ''; },
      set className(v) { n._className = String(v == null ? '' : v); },
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
      select() {},
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
  /* The Easy shell's own body. It exists before this module loads on the real
     page, and the module's MutationObserver is scoped to it — so it has to exist
     here too, or the observer silently never arms and every "an engine repaint
     arrives" assertion below would grade nothing. */
  const engineHost = makeNode('div');
  engineHost.id = 'mlsEz3Body';
  body.appendChild(engineHost);

  const document = {
    readyState: 'complete',
    visibilityState: opts.hidden ? 'hidden' : 'visible',
    activeElement: null,
    body, head, documentElement: head,
    createElement: makeNode,
    getElementById(id) { return byId.get(id) || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    execCommand() { return true; },
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
      ensure() { calls.phoneHomeEnsure++; }
    }, opts.phoneHome || {}),
    __mlsDeviceRole: {
      role: () => opts.role || null,
      name: () => opts.deviceName || 'iOS · Safari',
      deviceNoun: () => opts.deviceNoun || 'iPhone',
      layoutPref: () => opts.layoutPref || '',
      setLayoutPref(v) { calls.layoutPref = v; }
    },
    __mlsEasyV32: {
      remote: {
        snapshot: () => snapshot,
        startVisitFor(id, o) { calls.startVisitFor.push({ id, opts: o }); return opts.openFails ? false : true; },
        record() { calls.record++; return opts.recordFails ? false : true; },
        stopRecording() { calls.stopRecording++; return true; },
        generate() { calls.generate++; return true; },
        requestSendReview() { calls.sendReview++; return true; }
      }
    },
    __mlsDaySwitch: {
      /* `_day` lets a test drive the STRIP away from the ENGINE. They are two
         different variables in the product (DS.day vs S.visitDay) and a
         harness that keeps them equal by construction cannot see the defect
         that lives between them. */
      _day: null,
      currentDay() { return this._day || snapshot.day; },
      setDay(k) { calls.setDay.push(k); },
      shiftDay(n) { calls.shifted = n; },
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
    /* The host app's own globals. They are CALLED, never reimplemented, so each
       one records HOW it was called — logout()'s argument is a patient-safety
       fact, not a detail (see section 9). */
    logout(a) { calls.logout++; calls.logoutArgs = Array.prototype.slice.call(arguments); calls.logoutArg = a; },
    openSettings() { calls.openSettings++; },
    showView(v) { calls.showView.push(v); },
    matchMedia: () => ({ matches: false }),
    addEventListener(t, fn) { (win._h = win._h || {})[t] = (win._h[t] || []).concat(fn); },
    removeEventListener() {},
    navigator: {
      userAgent: opts.ua || IPHONE_UA,
      maxTouchPoints: opts.touch === false ? 0 : 5,
      clipboard: { writeText() { return Promise.resolve(); } }
    },
    location: { search: opts.search || '', reload() { calls.reload = (calls.reload || 0) + 1; } },
    open() {},
    /* A fetch that NEVER SETTLES. Every network answer in this suite is set
       explicitly on api._presence / S.ck by the test that needs it, so no
       microtask can land a second render between two assertions and no promise
       rejection can escape after the last one. Presence and check-in CONTENT
       are the sibling suites' subject; this file is the structure. */
    fetch: opts.fetch || function () { return new Promise(function () {}); }
  };
  win.window = win;
  win.document = document;
  win.navigator = win.navigator;
  if (opts.host) Object.keys(opts.host).forEach(k => { win[k] = opts.host[k]; });
  win.MutationObserver = function (cb) {
    this.observe = function (target, o) { win._mo = cb; win._moHost = target; win._moOpts = o; };
    this.disconnect = function () { win._mo = null; };
  };
  win.setTimeout = function (fn, ms) { const id = timers.length; timers.push({ kind: 'timeout', fn, ms, id, live: true }); return id; };
  win.clearTimeout = function (id) { if (timers[id]) timers[id].live = false; };
  win.setInterval = function (fn, ms) { const id = timers.length; timers.push({ kind: 'interval', fn, ms, id, live: true }); return id; };
  win.clearInterval = function (id) { if (timers[id]) timers[id].live = false; };
  win.sessionStorage = { _m: Object.assign({}, opts.session), getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
  win.localStorage = { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); } };
  win.Event = function (t) { this.type = t; };
  win.console = console;
  win.Date = Date; win.Math = Math; win.JSON = JSON; win.String = String; win.Number = Number;
  win.Object = Object; win.Array = Array; win.Promise = Promise; win.Error = Error;
  win.isNaN = isNaN; win.parseInt = parseInt;
  win.URLSearchParams = URLSearchParams;

  vm.createContext(win);
  vm.runInContext(source, win, { filename: 'feat_mls_phone_ui.js' });

  return {
    win, document, body, head, byId, calls, timers, snapshot,
    api: () => win.__mlsPhoneUI,
    /* Read from the TREE, never from the id index. After revert() the node
       still exists as an object, so a helper answering from the index would let
       a leaked frame pass as removed — the assertion would grade nothing. */
    frame: () => body.children.filter(c => c.id === 'mlsPh3')[0] || null,
    /* The sheet is a child of the FRAME, so it is read from the frame's tree
       for the same reason. */
    sheet() { const f = this.frame(); return f ? (f.children.filter(c => c.id === 'mlsPh3Sheet')[0] || null) : null; },
    screen: () => (byId.get('mlsPh3Body') || { _html: '' })._html,
    action: () => (byId.get('mlsPh3Act') || { _html: '' })._html,
    note: () => byId.get('mlsPh3Note') || null,
    noteText: () => ((byId.get('mlsPh3NoteTxt') || {}).textContent || ''),
    nav: () => byId.get('mlsPh3Nav') || null,
    css: () => ((byId.get('mlsPh3Css') || {}).textContent || ''),
    /* Every string a phone would actually be shown, in one place: the static
       frame shell, the scroller, the action bar and the sheet. */
    markup() {
      const f = this.frame(), s = this.sheet();
      return (f ? f._html : '') + this.screen() + this.action() + (s ? s._html : '');
    },
    /* Deliver a click the way the browser would: one delegated listener on the
       frame, an event whose target is walked up to the nearest [data-act].
       The act must actually BE on the screen first — a suite that can tap a
       control the doctor cannot see is grading its own imagination. */
    tap(act, attrs, allowMissing) {
      const f = this.frame();
      assert(f, 'cannot tap ' + act + ': the frame is not mounted');
      if (!allowMissing) {
        assert(this.markup().indexOf('data-act="' + act + '"') >= 0,
          'cannot tap "' + act + '": no control with that data-act is on the screen right now');
      }
      const el = {
        disabled: false,
        getAttribute: (k) => (k === 'data-act' ? act : ((attrs || {})[k] || null)),
        parentNode: f
      };
      f.fire('click', { target: el });
      return el;
    },
    type(id, value) {
      const f = this.frame();
      assert(f, 'cannot type into ' + id + ': the frame is not mounted');
      f.fire('input', { target: { id, value } });
    },
    /* Every data-act the ACTION BAR is offering, in order. */
    barActs() {
      const out = []; const re = /data-act="([a-z0-9-]+)"/g; let m;
      const html = this.action();
      while ((m = re.exec(html))) out.push(m[1]);
      return out;
    },
    liveTimeouts() { return timers.filter(t => t.live && t.kind === 'timeout'); },
    liveIntervals() { return timers.filter(t => t.live && t.kind === 'interval'); },
    /* Fire every live TIMEOUT, round after round, until nothing re-arms or the
       bound is hit. "Settled" has to mean this and not "fired once": the module
       re-checks for the engine on a bounded retry, so a single round would grade
       a screen that is still booting rather than one that has been left alone. */
    settle(maxRounds) {
      let n = maxRounds == null ? 300 : maxRounds;
      while (n-- > 0) {
        const due = timers.filter(t => t.live && t.kind === 'timeout');
        if (!due.length) break;
        due.forEach(t => { t.live = false; t.fn(); });
      }
      return this;
    },
    fireEvery(ms) {
      const due = timers.filter(t => t.live && t.ms === ms);
      due.forEach(t => { if (t.kind === 'timeout') t.live = false; t.fn(); });
      return due.length;
    },
    /* An engine repaint, delivered through the module's own MutationObserver
       callback — i.e. an UNFORCED render, the kind that arrives while the doctor
       is mid-word. */
    enginePaint() { assert(win._mo, 'the engine observer is not armed'); win._mo(); },
    show(vis) { document.visibilityState = vis; document._fire('visibilitychange'); }
  };
}

function visitAt(phase, extra, harnessOpts) {
  const h = makeHarness(Object.assign({
    wantPhone: true,
    snapshot: Object.assign(
      { phase, active: { id: 'a2', name: 'Priya Raman', time: '9:00 AM', dob: '1979-04-12' } },
      extra || {})
  }, harnessOpts || {}));
  h.api().go('visit');
  return h;
}

/* ===========================================================================
 * 1. IT NEVER TAKES A SCREEN THAT IS NOT A PHONE'S
 * =========================================================================*/
{
  const h = makeHarness({ ua: MAC_UA, touch: false, wantPhone: false });
  assert(!h.frame(), 'THE ONE THAT MATTERS: the phone shell mounted on a MacBook');
  assert(!h.body.classList.contains('mls-ph3'), 'a desktop must never carry the phone body class');
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
  assert(h.body.classList.contains('mls-ph3'), 'the phone body class must be set on mount');
  /* ph3 renamed the frame AND the body class. Both names are load-bearing: the
     stylesheet's whole hide list is written `body.mls-ph3 #x`, so a frame that
     mounted while the body still said mls-ph2 would draw the phone app with the
     desktop's dock, FAB and version banner floating on top of it. */
  assert.strictEqual(h.frame().id, 'mlsPh3', 'the frame element id must be mlsPh3');
  assert(!h.body.classList.contains('mls-ph2'), 'the retired ph2 body class must not be set as well');
  assert.strictEqual(h.api().version, 'ph3-1.0.0', 'the module must publish its own version');
  assert.strictEqual(h.frame().getAttribute('data-ph3'), h.api().version,
    'the frame must be stamped with the version that drew it — a screenshot of a phone in a clinic ' +
    'is otherwise unattributable to a build');
  assert(connect.indexOf('window.__mlsPhoneUI ' + h.api().version) > 0,
    'the loader in mls-connect.js must name the SAME version the module publishes; when those two ' +
    'drift, the file that ships and the file the loader documents are different files');
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
  const li = connect.indexOf('data-mls-asset="feat_mls_phone_ui.js"');
  assert(li > 0, 'the phone module must still be loaded from mls-connect.js');
  const loader = connect.slice(Math.max(0, li - 1200), li + 800);
  assert(/if\(!want\)return;/.test(loader),
    'the loader must return before creating the script element when the device is not a phone');
  assert(!/innerWidth/.test(loader), 'the loader must not classify by window width either');
}

/* ===========================================================================
 * 2. WHAT IT OWNS: A PHONE APP THAT DOES NOT OWN THE WHOLE SCREEN IS NOT ONE
 * ---------------------------------------------------------------------------
 * This is the measured reason ph3 exists. #mlsR46VerBanner renders at z-index
 * 2147483100, 230x332, in the MIDDLE of the screen, and elementFromPoint proved
 * it swallowed the pull button and THE FIRST PATIENT OF THE DAY. Its own advice
 * — install the extension — cannot be followed on a phone. It carried a phone
 * guard (`body.mls-phone`) that the phone app's own arrival switched off.
 * =========================================================================*/
{
  const h = makeHarness({ wantPhone: true });
  const css = h.css();
  assert(css, 'the phone stylesheet must be installed on mount');
  assert(h.head.children.some(c => c.id === 'mlsPh3Css'),
    'and it must actually be in the document, not merely constructed');
  assert(css.indexOf('body.mls-ph3 #mlsR46VerBanner, body.mls-ph3 #mlsA2hsCard{display:none!important}') >= 0,
    'THE MEASURED DEFECT: the 230x332 version banner and the add-to-home card must be hidden by the ' +
    'module that took their `body.mls-phone` guard away. They covered the pull button and the first ' +
    'patient of the day.');
  assert(/body\.mls-ph3 #_backupBadge\{bottom:/.test(css),
    'the backup-FAILURE badge must be LIFTED clear of the action bar, never hidden: it is the only ' +
    'surface that reports the doctor\'s notes are not saved');
  assert(css.indexOf('#_backupBadge{display:none') < 0,
    'and it must not appear in the hide list under any spelling');
  assert(!/mlsPh2|mls-ph2/.test(code),
    'no ph2 element id or body class may survive in shipped code — a stylesheet written for mls-ph3 ' +
    'and a frame built as mlsPh2 is a phone app with the desktop chrome still on top of it');
}

/* ===========================================================================
 * 3. TWO SCREENS AND ONE SHEET — AND NO TAB BAR AT ALL
 * ---------------------------------------------------------------------------
 * Replaces "THREE DESTINATIONS, AND THE TABS REALLY MOVE". The intent is
 * unchanged: prove the destinations exist and that switching really switches.
 * The model is different: 'day' is home, 'visit' is pushed on top of it, and the
 * third ph2 destination (Setup — a 161-word manual) is now a sheet.
 * =========================================================================*/
assert(!/data-tab/.test(source),
  'THE TAB BAR IS GONE: not one data-tab may remain. ph2 spent the one band a thumb reaches without ' +
  're-gripping on three tabs, two of which were a signpost and a settings manual.');
{
  const h = makeHarness({ wantPhone: true });
  const st = h.api().state();
  assert.deepStrictEqual(Object.keys(st).sort(), ['menu', 'mounted', 'screen', 'tab'],
    'state() must publish exactly screen/tab/mounted/menu');
  assert.strictEqual(st.screen, 'day', 'the phone opens on the day, which is home');
  assert.strictEqual(st.tab, st.screen,
    'tab must ALIAS screen. mls-connect.js reads state() to decide whether the old hide layer stands ' +
    'down; renaming the field without an alias would silently restore 28 hide rules underneath an ' +
    'opaque frame');
  assert.strictEqual(st.mounted, true, 'and it must report itself mounted');
  assert.strictEqual(st.menu, false, 'the sheet is closed until it is asked for');

  h.api().go('visit');
  assert.strictEqual(h.api().state().screen, 'visit', 'go() must push the visit screen');
  h.api().go('nonsense');
  assert.strictEqual(h.api().state().screen, 'day',
    'an unknown destination must fall back to the day, not blank the app');
}
{
  /* THE ONE LEFT-HAND CONTROL. A phone header with two navigational controls is
     a header the doctor has to read before pressing, so there is exactly one and
     it changes meaning by screen. Executed through the real listener. */
  const h = makeHarness({ wantPhone: true, snapshot: { today: [{ id: 'a1', name: 'Marcus Bell', time: '8:30 AM' }] } });
  const nav = h.nav();
  assert(nav, 'the header must carry #mlsPh3Nav');
  assert.strictEqual(nav.getAttribute('aria-label'), 'Menu', 'on the day the one control is the menu');
  assert.strictEqual(nav.getAttribute('aria-haspopup'), 'dialog', 'and it announces the sheet it opens');

  h.tap('open', { 'data-id': 'a1' });
  assert.strictEqual(h.api().state().screen, 'visit', 'opening a patient pushes the visit screen');
  assert.strictEqual(nav.getAttribute('aria-label'), 'Back to the day',
    'THE SAME control must become Back on a visit — a pushed screen with no way back is the dead end ' +
    'ph2\'s Visit tab already was');
  assert.strictEqual(nav.getAttribute('aria-haspopup'), null,
    'and it must stop claiming to open a dialog, because on this screen it does not');
  assert(/Day/.test(nav.innerHTML), 'Back must say where back GOES, not just point');

  nav.fire('click');
  assert.strictEqual(h.api().state().screen, 'day', 'pressing it on a visit must really return to the day');
  nav.fire('click');
  assert.strictEqual(h.api().state().menu, true, 'and pressing it on the day must really open the sheet');
}
{
  /* THE SHEET IS THE OLD SETUP TAB. Everything that used to be a destination is
     here, and it hangs off the FRAME rather than the scroller so an engine
     repaint cannot blow it away under the doctor's thumb. */
  const h = makeHarness({ wantPhone: true });
  h.api().menu(true);
  const sheet = h.sheet();
  assert(sheet, 'the menu sheet must be a child of the FRAME');
  assert.strictEqual(sheet.parentNode.id, 'mlsPh3',
    'not of the scrolling body — a repaint replaces every child of the scroller, which would delete an ' +
    'open sheet mid-press');
  for (const act of ['refresh', 'settings', 'device', 'fullapp', 'signout']) {
    assert(sheet.innerHTML.indexOf('data-act="' + act + '"') >= 0,
      'the sheet must carry the ' + act + ' control that used to live on the Setup tab');
  }
  const before = h.screen();
  h.api().render();
  assert.strictEqual(h.api().state().menu, true, 'a forced repaint must not close the open sheet');
  assert(h.sheet().innerHTML.length > 0, 'and must not empty it');
  assert(before.length > 0 && h.screen().length > 0, 'the body still repaints normally underneath');

  h.tap('menu-close');
  assert.strictEqual(h.api().state().menu, false, 'the scrim must really close the sheet');
  assert(!h.sheet() || !h.sheet().innerHTML, 'and the sheet must be emptied, not merely hidden');
}
{
  /* The published action vocabulary IS the contract between this suite, the
     module and every sibling suite. Pinning the whole set catches a control that
     is added without a test and a control that is renamed out from under one. */
  const acts = new Set();
  let m;
  const re = /data-act="([a-z0-9-]+)"/g;
  while ((m = re.exec(source))) acts.add(m[1]);
  const re2 = /act === '([a-z0-9-]+)'/g;
  while ((m = re2.exec(source))) acts.add(m[1]);
  assert.deepStrictEqual([...acts].sort(), [
    'back', 'checkins', 'ck-open', 'copy-note', 'day-go', 'day-next', 'day-prev', 'day-today', 'device',
    'find-clear', 'fullapp', 'generate', 'install', 'menu-close', 'note-x', 'open',
    'pull-start', 'pull-stop', 'record', 'refresh', 'send', 'settings', 'signout', 'stop'
  ], 'the phone app offers exactly these 24 actions; every one is handled by the ONE delegated handler');
}

/* ===========================================================================
 * 3b. THE DAY ON THE LABEL IS THE DAY THE ROWS CAME FROM
 * ---------------------------------------------------------------------------
 * Owner, 2026-08-09: "make sure the days line up like there are no patiens
 * today but there are some tommarow make sure that whole calander thing is
 * correct".
 *
 * There are TWO day states in this product: __mlsDaySwitch's DS.day (the strip)
 * and the Easy engine's S.visitDay (what snapshot().today is built from). ph3
 * takes its ROWS from the engine, so a label taken from the strip can print one
 * date over another date's patients. These assert that the label follows the
 * rows, and that a disagreement is pushed back through setDay() -- the one call
 * allowed to move both.
 * =========================================================================*/
{
  const h = makeHarness({ wantPhone: true });
  h.snapshot.day = '2026-08-11';
  h.win.__mlsDaySwitch._day = '2026-08-07';
  h.api().render();
  const title = (h.byId.get('mlsPh3Title') || {}).textContent || '';
  assert(!/Aug 7|Friday/.test(String(title) + h.screen()),
    'the header showed the STRIP day while the list was built from the ENGINE day');
  assert(h.calls.setDay.length > 0,
    'a disagreement between the two day states must be reconciled through setDay(), not printed');
  assert.strictEqual(h.calls.setDay[h.calls.setDay.length - 1], '2026-08-07',
    'the strip is what the doctor last chose, so the strip day is what gets pushed into the engine');
}
{
  /* Reconciliation must be idempotent: a repaint loop that keeps calling
     setDay() would fight the engine once a second for the whole session. */
  const h = makeHarness({ wantPhone: true });
  h.snapshot.day = '2026-08-11';
  h.win.__mlsDaySwitch._day = '2026-08-07';
  h.api().render(); h.api().render(); h.api().render();
  assert.strictEqual(h.calls.setDay.length, 1,
    'the same disagreement was reconciled ' + h.calls.setDay.length + ' times — that is a fight, not a fix');
}

/* ===========================================================================
 * 4. THE BOTTOM OF THE SCREEN IS THE ACTION, NOT THE NAVIGATION
 * ---------------------------------------------------------------------------
 * The assertion this suite gained at ph3. A phone's bottom band is the only part
 * of an 812px screen a thumb reaches without re-gripping. ph2 spent it on three
 * tabs; ph3 spends it on the single thing this screen is for right now, named
 * for what it will do. Both halves are graded: what the bar HOLDS, and what it
 * REACHES when pressed.
 * =========================================================================*/
{
  const cases = [
    { what: 'an empty day', h: () => makeHarness({ wantPhone: true }), acts: ['pull-start'] },
    {
      what: 'a loaded day', acts: ['pull-start'],
      h: () => makeHarness({ wantPhone: true, snapshot: { today: [{ id: 'a1', name: 'Marcus Bell', time: '8:30 AM' }] } })
    },
    { what: 'a running pull', h: () => makeHarness({ wantPhone: true, activeJob: { id: 'j1' } }), acts: ['pull-stop'] },
    { what: 'an idle visit', h: () => visitAt('idle'), acts: ['record'] },
    { what: 'a live recording', h: () => visitAt('rec', { recSecs: 257 }), acts: ['stop'] },
    { what: 'a stopped recording', h: () => visitAt('stopped'), acts: ['generate', 'record'] },
    { what: 'a running generation', h: () => visitAt('gen'), acts: [] },
    { what: 'a finished note', h: () => visitAt('note'), acts: ['send', 'copy-note'] }
  ];
  for (const c of cases) {
    const h = c.h();
    assert.deepStrictEqual(h.barActs(), c.acts,
      'the action bar on ' + c.what + ' must offer exactly [' + c.acts.join(', ') + '], not [' +
      h.barActs().join(', ') + ']');
    assert(!/data-tab/.test(h.action()),
      'the bar must never carry a destination on ' + c.what + ' — it is an ACTION bar');
    for (const nav of ['open', 'ck-open', 'day-prev', 'day-next', 'day-today', 'settings', 'signout']) {
      assert(h.action().indexOf('data-act="' + nav + '"') < 0,
        'the bar must not hold "' + nav + '" on ' + c.what + ': navigation and account controls belong to ' +
        'the header, the list and the sheet, never to the thumb band the primary verb owns');
    }
    if (c.acts.length) {
      assert(/id="mlsPh3Go"/.test(h.action()),
        'the primary control must live in the action bar on ' + c.what);
      assert(!/id="mlsPh3Go"/.test(h.screen()),
        'and never in the scroller on ' + c.what + ' — ph2 put "Start recording" in the page flow above the ' +
        'quick history and the transcript, so the one thing the doctor came for scrolled away');
    }
  }
}
{
  /* The day's OWN navigation stays where it belongs: in the body, above the
     list, not in the band the verb owns. */
  const h = makeHarness({ wantPhone: true });
  assert(/data-act="day-prev"/.test(h.screen()) && /data-act="day-next"/.test(h.screen()),
    'moving between days is navigation and lives in the body strip');
  assert(h.action().indexOf('day-') < 0, 'and not in the action bar');
}
{
  /* AND IT REACHES THE ENGINE. A bar that draws the right verb and calls the
     wrong function is worse than one that draws the wrong verb. */
  const idle = visitAt('idle');
  assert.deepStrictEqual(idle.barActs(), ['record']);
  idle.tap('record');
  assert.strictEqual(idle.calls.record, 1, 'the idle bar\'s verb must reach remote.record()');
  assert.strictEqual(idle.calls.stopRecording, 0, 'and nothing else');

  const rec = visitAt('rec', { recSecs: 12 });
  assert.deepStrictEqual(rec.barActs(), ['stop']);
  rec.tap('stop');
  assert.strictEqual(rec.calls.stopRecording, 1, 'the recording bar\'s verb must reach remote.stopRecording()');
  assert.strictEqual(rec.calls.record, 0, 'and must not re-arm the microphone');

  const stopped = visitAt('stopped');
  stopped.tap('generate');
  assert.strictEqual(stopped.calls.generate, 1, 'the stopped bar\'s primary must reach remote.generate()');

  const note = visitAt('note');
  note.byId.set('noteBox', Object.assign(note.document.createElement('textarea'), { value: 'ASSESSMENT: knee.' }));
  note.tap('send');
  assert.strictEqual(note.calls.sendReview, 1, 'the finished-note bar must reach remote.requestSendReview()');
}

/* ===========================================================================
 * 5. THE PULL SAYS WHAT IS TRUE, AND PRESSES THE SHARED ENGINE
 * =========================================================================*/
{
  /* Empty day: ONE empty state, not two. ph2 printed "No patients loaded for
     today yet" and "Nothing scheduled here yet" one under the other — two
     different claims about the same fact, stacked. */
  const h = makeHarness({ wantPhone: true });
  assert(/Nobody on this day yet/.test(h.screen()), 'an empty day must say so plainly, once');
  assert(!/No patients loaded for today yet/.test(h.screen()),
    'and must not stack a second sentence making the same claim');
  assert(/Get today&rsquo;s patients/.test(h.action()),
    'the button must name the OUTCOME — "pull" is vocabulary a phone user has never been taught');
  assert(/A walk-in who is not on the schedule has to be started on the office computer/.test(h.screen()),
    'THE HONEST SENTENCE: ph2 said a walk-in could be recorded "from the Visit tab". There is no ' +
    'unbound-recording path in the engine\'s remote whitelist at all, so the phone must name the ' +
    'machine where it CAN be done');

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
      { id: 'a1', name: 'Marcus Bell', time: '8:30 AM' },
      { id: 'a2', name: 'Priya Raman', time: '9:00 AM' }
    ] }
  });
  assert(/2 patients today/.test(h.screen()), 'a loaded day must lead with the count');
  assert(/class="ph3-secondary" data-act="pull-start"/.test(h.action()),
    'with the day already loaded, re-checking athenaOne must not be the loudest control on screen');
  assert(/Marcus Bell/.test(h.screen()) && /Priya Raman/.test(h.screen()), 'every patient must be listed');
}
{
  /* The row that is BEING RECORDED is marked, so a doctor who backs out to the
     day cannot start a second visit on top of a live one without seeing it. */
  const h = makeHarness({
    wantPhone: true,
    snapshot: {
      phase: 'rec',
      active: { id: 'a2', name: 'Priya Raman' },
      today: [{ id: 'a1', name: 'Marcus Bell', time: '8:30 AM' }, { id: 'a2', name: 'Priya Raman', time: '9:00 AM' }]
    }
  });
  const s = h.screen();
  assert(/ph3-row ph3-live/.test(s), 'the row the engine is recording must be marked in the list');
  assert(/>Recording</.test(s), 'and it must say so in words, not only in colour');
  assert((s.match(/ph3-live/g) || []).length === 1, 'exactly one row — the engine holds one lock');
}
{
  /* A blocked relay is knowable BEFORE the press, so it is said before it —
     and at ph3 it is said IN THE ACTION BAR, directly above the button it is
     about, rather than in a card the doctor may have scrolled past. */
  const h = makeHarness({ wantPhone: true });
  h.api()._presence = { online: true, ext: true, officeName: 'Front desk PC', officeAth: 'no-tab' };
  h.api().render();
  assert(/athenaOne is signed out on Front desk PC/.test(h.action()),
    'a known blocker must be named on the action bar, not discovered after a failed pull');
  assert(h.barActs().indexOf('pull-start') >= 0,
    'and the button must still be offered: a blocker is a warning with a fix, not a dead control');
}
{
  /* The engine's own sentence survives verbatim, underneath our headline. */
  const h = makeHarness({ wantPhone: true });
  h.byId.set('mlsDsStatus', Object.assign(h.document.createElement('div'), {
    textContent: 'Front desk PC: Reading verified history 3 of 7…'
  }));
  h.api()._presence = { online: true, ext: true, officeName: 'Front desk PC', officeAth: 'ok' };
  h.api().render();
  assert(/Reading verified history 3 of 7/.test(h.action()),
    'the engine status sentence must be shown WORD FOR WORD under the headline — a plain-language ' +
    'summary that replaces the truth is the silent-refusal failure this product already knows');
}
{
  /* Stop really cancels the relayed job. */
  const h = makeHarness({ wantPhone: true, activeJob: { id: 'j1' } });
  assert(/Getting your patients/.test(h.action()), 'a running pull must be visible as running');
  h.tap('pull-stop');
  assert.strictEqual(h.calls.cancelActive, 1, 'Stop must cancel the real relay job, not just repaint');
}

/* ===========================================================================
 * 6. OPENING A PATIENT NEVER OPENS A MICROPHONE
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
  assert.strictEqual(h.api().state().screen, 'visit', 'opening a patient must land on their visit');
  assert.deepStrictEqual(h.calls.showView, ['visit'],
    'and the desktop view underneath must be moved to the same patient, so leaving phone mode — or a ' +
    'modal opening over this frame — does not reveal a different patient behind it');
}
{
  /* A refused open must not leave the doctor on an empty visit screen. */
  const h = makeHarness({
    wantPhone: true, openFails: true,
    snapshot: { today: [{ id: 'a2', name: 'Priya Raman', time: '9:00 AM' }] }
  });
  h.tap('open', { 'data-id': 'a2' });
  assert.strictEqual(h.api().state().screen, 'day', 'a refused open must stay on the day');
  assert(/could not open that patient/.test(h.noteText()),
    'and must say why, on the sticky line, rather than doing nothing visible');
}

/* ===========================================================================
 * 7. THE VISIT SCREEN IS THE ENGINE'S PHASE, ONE PRIMARY AT A TIME
 * =========================================================================*/
{
  const idle = visitAt('idle');
  assert(/Start recording/.test(idle.action()), 'an idle visit offers recording');
  assert(!/Write the note/.test(idle.action()), 'and offers nothing else as a primary');

  const rec = visitAt('rec', { recSecs: 257 });
  assert(/Stop recording/.test(rec.action()), 'a live visit offers Stop');
  assert(/ph3-stop/.test(rec.action()), 'and it is the one shape in this app that is not green');
  assert(/<span id="mlsPh3Timer">4:17<\/span>/.test(rec.action()),
    'THE CLOCK IS ITS OWN NODE. ph2 put recSecs in the repaint signature, so the whole visit body was ' +
    'rebuilt once a second and a doctor reading the quick history mid-visit was thrown back to the top ' +
    'every second. At ph3 the seconds are a text write into #mlsPh3Timer.');

  const stopped = visitAt('stopped');
  assert(/Write the note/.test(stopped.action()) && /Resume/.test(stopped.action()),
    'AUDIT B3: a stopped recording must offer both a way on and a way back — this was the dead end');

  const gen = visitAt('gen');
  assert(/Writing the note/.test(gen.action()) && /disabled/.test(gen.action()),
    'a running generation must be visible and un-pressable, not offered a second time');

  const note = visitAt('note');
  assert(/Send for review/.test(note.action()) && /Copy/.test(note.action()),
    'a finished note must be sendable and copyable from the phone');
}
assert(!/recSecs/.test(code.slice(code.indexOf('function signature()'), code.indexOf('function signature()') + 700)),
  'the repaint signature must NOT contain recSecs: that one field is what rebuilt the whole visit body ' +
  'once a second and reset the scroller under the doctor');
{
  /* THE ENGINE'S BOOLEANS MEAN "DISPATCHED", NOT "DONE". record() returns true
     once it has clicked the host capture button. A phone whose microphone
     permission was refused sits at 'idle' afterwards with the engine reporting
     success — which is exactly the owner's complaint: press the button, nothing
     happens, nothing is said. */
  const h = visitAt('idle');
  h.tap('record');
  assert.strictEqual(h.calls.record, 1, 'the press must reach the engine');
  assert.strictEqual(h.noteText(), '',
    'and nothing may be claimed on the same tick — the phone must not cry wolf before the engine has ' +
    'had a moment to arrive at the phase');

  const armed = h.timers.filter(t => t.live && t.kind === 'timeout' && t.ms === 1500);
  assert.strictEqual(armed.length, 1,
    'exactly one phase confirmation must be armed, at 1500ms');
  h.fireEvery(1500);
  assert(/did not start recording/.test(h.noteText()),
    'THE PHASE NEVER ARRIVED, SO IT MUST BE SAID: the engine still reports idle 1.5s later and the ' +
    'phone has to name the most common cause rather than sit under a button that did nothing');
  assert(/microphone/.test(h.noteText()),
    'and it must name the concrete thing to check, not point at a message that is not there');
}
{
  /* ONE PERSISTENT REFUSAL. The physical-phone failure rendered the same
     patient mismatch as a toast, a sticky banner and an inline card. The phone
     banner is the sole owner: it survives repaints and remains dismissible. */
  const h = visitAt('idle', {}, { recordFails: true });
  h.tap('record');
  const errorToasts = h.calls.toasts.filter(t => t && t.k === 'err');
  assert.strictEqual(errorToasts.length, 0, 'a phone refusal must not duplicate its persistent banner in a transient toast');
  assert(h.noteText().length > 0, 'the refusal must land on the sticky in-frame line');
  const noteEl = h.note();
  assert(/ph3-show/.test(noteEl.className), 'the sticky line must actually be shown');
  assert(/ph3-bad/.test(noteEl.className), 'and be styled as a refusal, not as a hint');

  h.api().render();
  assert(h.noteText().length > 0,
    'THE STICKY LINE SURVIVES A REPAINT. It lives in the frame, not in the body that gets rewritten — ' +
    'ph2 cleared its arrival banner WHILE BUILDING the body string, so the next repaint erased it, and ' +
    'repaints are continuous while anything is live.');

  h.tap('note-x');
  assert.strictEqual(h.noteText(), '', 'and the doctor can dismiss it');
  assert.strictEqual(h.note().className, '', 'which really hides it');
}
{
  /* A refusal must arrive with its reason: the ENGINE's sentence when it has
     one, on the screen the control lives on. */
  const h = visitAt('idle', { warn: 'This row is missing its exact Athena appointment ID.' });
  assert(/missing its exact Athena appointment ID/.test(h.screen()),
    'the engine refusal sentence must reach the phone — a dead button with no reason beside it is ' +
    'exactly what the old hide list produced');
}
assert(/warn: S\.lastWarn \|\| ''/.test(connect),
  'the engine snapshot must carry lastWarn, or the phone has no way to show why a control refused');
{
  /* If the engine drops the lock while the visit screen is up, say so and put
     the way back where the thumb already is. */
  const h = makeHarness({ wantPhone: true });
  h.api().go('visit');
  assert(/No patient is open/.test(h.screen()), 'a visit with no lock must say the lock is gone');
  assert.deepStrictEqual(h.barActs(), ['back'], 'and the bar becomes the way back, not a dead verb');
  h.tap('back');
  assert.strictEqual(h.api().state().screen, 'day', 'which really returns to the day');
}

/* ===========================================================================
 * 8. THE TRANSCRIPT: THE GUARD IS ON THE REBUILD, NEVER ON THE MERGE
 * ---------------------------------------------------------------------------
 * ph2 wrote the phone textarea's ENTIRE value over #transcript on every
 * keystroke while a caret guard stopped the engine's live appends from ever
 * reaching the phone. So the moment a finger touched the box the phone's copy
 * froze, and the next keystroke overwrote whatever the recognizer had added in
 * the meantime — the doctor's words, silently deleted, mid-recording.
 * =========================================================================*/
{
  const h = visitAt('rec');
  h.byId.set('transcript', Object.assign(h.document.createElement('textarea'), { value: 'the knee catches on stairs' }));
  h.api().render();
  assert(/the knee catches on stairs/.test(h.screen()), 'AUDIT B2: the transcript must be visible on the phone');
  assert(/<textarea id="mlsPh3Tx" class="ph3-ta"/.test(h.screen()), 'and it must be editable, not a read-only copy');
  assert(/<textarea id="mlsPh3Note2" class="ph3-ta" readonly/.test(visitAt('note').screen()),
    'the generated NOTE, by contrast, is read-only on the phone: signing and sending happen on the ' +
    'office computer, so an edit here would be a change with nowhere to go');
}
{
  /* An edit reaches the canonical element the rest of the app reads. There is
     no second transcript. */
  const h = visitAt('stopped');
  const real = Object.assign(h.document.createElement('textarea'), { value: 'old' });
  let dispatched = 0;
  real.dispatchEvent = () => { dispatched++; return true; };
  h.byId.set('transcript', real);
  h.type('mlsPh3Tx', 'corrected text');
  assert.strictEqual(real.value, 'corrected text', 'a phone edit must write the canonical #transcript');
  assert.strictEqual(dispatched, 1, 'and must fire the input event every other module listens for');
}
{
  /* THE ONE THAT COST WORDS. Caret in the box, engine still appending. */
  const h = visitAt('rec');
  const real = Object.assign(h.document.createElement('textarea'), { value: 'the knee' });
  h.byId.set('transcript', real);
  h.api().render();

  const ours = h.byId.get('mlsPh3Tx');
  assert.strictEqual(ours.value, 'the knee', 'the phone starts mirroring the engine');

  /* The doctor puts the caret in the box and corrects a word. */
  h.document.activeElement = ours;
  ours.value = 'the knee catches';
  h.type('mlsPh3Tx', 'the knee catches');
  assert.strictEqual(real.value, 'the knee catches', 'the correction reaches the engine copy');

  /* The recognizer appends while the finger is still in the box, and the engine
     repaints — an UNFORCED render, delivered through the module's own observer. */
  real.value = 'the knee catches on stairs';
  const bodyBefore = h.screen();
  h.enginePaint();

  assert.strictEqual(h.screen(), bodyBefore,
    'THE REBUILD IS SKIPPED while the caret is in one of our fields: replacing every child of the ' +
    'scroller destroys the element being typed into and takes the caret with it');
  assert.strictEqual(ours.value, 'the knee catches on stairs',
    'THE MERGE STILL RUNS: the doctor\'s correction is kept AND the engine\'s new tail is appended. ' +
    'ph2 guarded the whole render on the caret, so live appends stopped reaching the phone entirely ' +
    'and the next keystroke wrote the stale phone copy back over them.');
  assert.strictEqual(real.value, 'the knee catches on stairs',
    'and the merged value goes back to the engine, so there is still exactly one transcript');
}

/* ===========================================================================
 * 9. A DESKTOP IS NEVER CALLED A PHONE  (the sheet is where Setup went)
 * =========================================================================*/
{
  const mac = makeHarness({ wantPhone: true, ua: MAC_UA, role: 'phone', deviceNoun: 'Mac', deviceName: 'MacBook Pro' });
  mac.api().menu(true);
  const s = mac.markup();
  assert(/This Mac/.test(s), 'a Mac in the simple layout must be called a Mac');
  assert(/Sign out of this Mac/.test(s), 'including the sentence that clears its stored patient data');
  /* Precisely the self-referential forms. "Open this on your phone" is CORRECT
     copy on a computer — it is about a phone the reader also owns. The defect is
     a sentence that calls the machine you are reading it on a phone. */
  for (const wrong of ['this phone', 'This phone', 'Phone mode', 'your phone’s', "your phone's"]) {
    assert(s.indexOf(wrong) < 0,
      'a Mac was called a phone ("' + wrong + '") on its own screen:\n' + s.slice(0, 400));
  }
  assert(!/Phone \/ remote/.test(s),
    'the role label must name what the role DOES — "Phone / remote" is a hardware claim on a MacBook that holds it');

  const iphone = makeHarness({ wantPhone: true, deviceNoun: 'iPhone' });
  iphone.api().menu(true);
  assert(/This iPhone/.test(iphone.markup()), 'and an iPhone is still called an iPhone');
}
{
  /* SIGN OUT TAKES NO ARGUMENT. logout(true) is the idle-timeout path and SKIPS
     the "N notes on this device have not been backed up" stop — and signing out
     purges the local clinical state those notes live in. Executed through the
     real sheet control, because that is the only place it can be pressed now. */
  const h = makeHarness({ wantPhone: true });
  h.api().menu(true);
  h.tap('signout');
  assert.strictEqual(h.calls.logout, 1, 'the sheet must reach the host app\'s own logout()');
  assert.strictEqual(h.calls.logoutArgs.length, 0,
    'WITH NO ARGUMENT: logout(true) is the idle-timeout path and skips the unsaved-notes stop, and ' +
    'sign-out purges the local state those notes live in. Called with: ' + JSON.stringify(h.calls.logoutArgs));
  assert.strictEqual(h.api().state().menu, false, 'and the sheet closes behind it');
}
/* The word has ONE owner, and the fallback in this module makes the same
   promise the canonical one does. */
assert(/api\.deviceNoun = deviceNoun;/.test(connect),
  '__mlsDeviceRole must publish deviceNoun() — every surface asks it rather than guessing');
assert(/api\.deviceNoun = deviceNoun;/.test(code),
  'and the phone app must republish it, so a sibling module reading the phone\'s own noun gets the ' +
  'same word the sentences on screen are built from');
assert(/case 'macOS': return 'Mac';/.test(connect) && /case 'Windows': return 'Windows PC';/.test(connect),
  'the canonical noun must name desktops as desktops');
assert(!/'📱 Phone mode'/.test(connect),
  'the fixed "Phone mode" label is back — it printed on every relaying laptop and tablet');

/* ===========================================================================
 * 10. IT COSTS A POCKETED PHONE NOTHING
 * ---------------------------------------------------------------------------
 * ph2 carried NO interval at all and this suite banned the identifier outright.
 * ph3 has exactly one — the 45s check-in watch that the owner asked for, so a
 * finished intake summary reaches the doctor while he is looking at the day —
 * and the budget is stated more strictly than "zero", not more loosely:
 *
 *   at most ONE live interval, and it must be the 45s check-in watch;
 *   the repaint ticker is a setTimeout that exists only while something is
 *   genuinely live AND the tab is visible;
 *   a hidden tab holds ZERO timers of either kind, even mid-recording;
 *   a settled idle visible phone holds the watch and nothing else.
 * =========================================================================*/
assert.strictEqual((code.match(/setInterval\(/g) || []).length, 1,
  'EXACTLY ONE setInterval call site in shipped code. Every other repeating thing on this phone is a ' +
  'setTimeout loop that has to re-earn its next tick.');
assert.strictEqual((code.match(/clearInterval\(/g) || []).length, 1,
  'and exactly one place that clears it');
assert(/observe\(host, \{ childList: true, subtree: true/.test(source) && /\$\('mlsEz3Body'\)/.test(source),
  'the observer must be scoped to the visit body, never to the document');
{
  /* Executed, not only read: a document-wide observer on a page this size fires
     on every unrelated repaint the app makes, which on a phone is a battery
     cost the doctor pays for nothing. */
  const h = makeHarness({ wantPhone: true });
  assert(h.win._moHost, 'the engine observer must actually be armed on mount');
  assert.strictEqual(h.win._moHost.id, 'mlsEz3Body', 'and scoped to the Easy shell body');
  assert.notStrictEqual(h.win._moHost, h.document, 'never to the document');
}
{
  const idle = makeHarness({ wantPhone: true });

  /* THE FIRST HANDLE THIS HARNESS EVER HANDS OUT IS 0, on purpose. A timer
     handle of 0 is FALSY: a module that clears with `if (t)` leaves the old
     timer running forever while a second one is armed beside it. Browsers rarely
     hand out 0, which is exactly why that class of bug ships. */
  const watch = idle.liveIntervals();
  assert.strictEqual(watch.length, 1, 'a mounted visible phone arms exactly one interval');
  assert.strictEqual(watch[0].id, 0, 'and this harness gave it the falsy handle 0');
  assert.strictEqual(watch[0].ms, 45000,
    'the one interval must be the 45s check-in watch. Naming the period is a stronger statement than ' +
    '"one timer", which a module that also left a 1s ticker running would satisfy.');
  assert(watch[0].ms >= 30000,
    'the watch period must stay in seconds-tens: this runs on battery, in a pocket, between rooms');
  assert.strictEqual(typeof idle.api()._ckPoll, 'function',
    '_ckPoll must be the re-check itself, so a sibling suite (and Refresh) can ask for one WITHOUT ' +
    'waiting out the period or arming a second watch');

  idle.settle();
  assert.deepStrictEqual(idle.liveTimeouts().map(t => t.ms), [],
    'A SETTLED IDLE VISIBLE PHONE HOLDS NO TIMEOUTS AT ALL. Held: ' +
    idle.liveTimeouts().map(t => t.ms + 'ms').join(', '));
  assert.strictEqual(idle.liveIntervals().length, 1, 'and still exactly the one watch');

  /* Now prove the falsy-0 clear really happens, both halves. */
  idle.show('hidden');
  assert.strictEqual(idle.liveIntervals().length, 0,
    'HIDING MUST CLEAR HANDLE 0. A truthiness test would silently skip this clear and the watch would ' +
    'keep polling in a pocket.');
  idle.show('visible');
  assert.strictEqual(idle.liveIntervals().length, 1,
    'and coming back arms ONE watch, not a second one beside a survivor');
}
{
  const running = makeHarness({ wantPhone: true, snapshot: { phase: 'rec' } });
  running.settle(2);
  assert(running.liveTimeouts().some(t => t.ms === 1000),
    'a live recording must keep the screen ticking, at 1s');

  /* Settle past the bounded engine-arrival retry, so what is left is only what
     the recording itself is costing. */
  running.settle(120);
  assert.strictEqual(running.liveTimeouts().length, 1,
    'a live recording costs exactly ONE timeout once the app has finished booting. Held: ' +
    running.liveTimeouts().map(t => t.ms + 'ms').join(', '));
  assert.strictEqual(running.liveTimeouts()[0].ms, 1000, 'and it is the 1s repaint ticker');

  running.fireEvery(1000);
  assert.strictEqual(running.liveTimeouts().length, 1,
    'which re-arms itself ONCE — never a second one started beside a handle that read as falsy');

  /* And it stops the moment the recording does. The ticker exists to move a
     clock; a clock with nothing to count is a repaint every second in a pocket. */
  running.snapshot.phase = 'stopped';
  running.fireEvery(1000);
  assert.strictEqual(running.liveTimeouts().length, 0,
    'the ticker must NOT re-arm once nothing is live any more');
  assert.strictEqual(running.liveIntervals().length, 1,
    'while the check-in watch — the one thing that is allowed to outlive a visit — keeps going');
}
{
  const hidden = makeHarness({ wantPhone: true, snapshot: { phase: 'rec' }, hidden: true });
  hidden.settle();
  assert.strictEqual(hidden.liveTimeouts().length, 0,
    'THE POCKET RULE: a hidden tab must schedule nothing, even mid-recording. A hidden tab\'s timers ' +
    'are frozen, not throttled, so one armed here cannot fire — it only releases a burst of stale ' +
    'checks on resume, which the visibility handler already covers sooner. Held: ' +
    hidden.liveTimeouts().map(t => t.ms + 'ms').join(', '));
  assert.strictEqual(hidden.liveIntervals().length, 0,
    'and the check-in watch must REFUSE TO ARM while hidden, rather than arming and checking ' +
    'visibility when it fires');
}
{
  const hiddenIdle = makeHarness({ wantPhone: true, hidden: true });
  hiddenIdle.settle();
  assert.strictEqual(hiddenIdle.liveTimeouts().length + hiddenIdle.liveIntervals().length, 0,
    'an idle phone with the screen off costs exactly nothing');
}

/* ===========================================================================
 * 11. IT LETS GO CLEANLY
 * =========================================================================*/
{
  const h = makeHarness({ wantPhone: true, snapshot: { phase: 'rec' } });
  h.settle(2);
  assert(h.liveTimeouts().length + h.liveIntervals().length > 0, 'something is running before revert');

  assert.strictEqual(h.api().revert(), true, 'revert() must report that it ran');
  assert(!h.frame(), 'revert() must remove the frame');
  assert(!h.body.classList.contains('mls-ph3'), 'revert() must drop the body class');
  assert(!h.head.children.some(c => c.id === 'mlsPh3Css'), 'revert() must take its stylesheet with it');
  assert.strictEqual(h.liveTimeouts().length, 0, 'revert() must leave no timeout running');
  assert.strictEqual(h.liveIntervals().length, 0,
    'revert() must stop the check-in watch too — an interval that survives a revert polls the backend ' +
    'from a screen this module no longer owns');
  assert.strictEqual(h.win._mo, null, 'and must disconnect the engine observer');

  /* THE HAND-BACK IS A CONTRACT, NOT A COURTESY. mls-connect.js keeps the old
     phone hide layer installed and stands it down while this module owns the
     screen; newUiOwns() decides that from exactly these three published facts.
     After revert() all three must read "not owning", or the doctor is left on a
     screen that no layer is driving. */
  assert.strictEqual(h.api().installed, false, 'revert() must report itself uninstalled');
  assert.strictEqual(h.api().state().mounted, false, 'and unmounted');
  assert.strictEqual(typeof h.api().owns, 'function', 'and owns() must still be answerable');
  assert(/ui && ui\.installed && typeof ui\.owns === 'function' && ui\.owns\(\)/.test(connect) &&
    /ui\.state && ui\.state\(\)\.mounted/.test(connect),
    'newUiOwns() must keep reading installed + owns() + state().mounted — those three fields are the ' +
    'entire handshake, and this suite pins the module\'s side of it');
}
/* And the layer it replaced stands down while it is mounted, rather than
   running 28 hide rules underneath an opaque frame. */
assert(/function newUiOwns\(\)/.test(connect) && /if \(newUiOwns\(\)\) \{/.test(connect),
  '__mlsPhoneHome must stand down while the new phone app owns the screen');

console.log('PASS the phone app is its own app (ph3-1.0.0): it never mounts on a desktop (Mac + ' +
  'signed-out + delegated ownership all executed), it hides the MEASURED 230x332 version banner that ' +
  'ate the pull button and the first patient, there is NO tab bar — two screens, one sheet and one ' +
  'header control that really changes meaning, the bottom band is an ACTION bar whose verb is ' +
  'phase-appropriate in all 8 states and reaches the right engine entry point, the pull routes through ' +
  'the SHARED day-switch engine and keeps the engine sentence verbatim, a blocker is named on the bar ' +
  'before the press, opening a patient passes record:false and moves the desktop view with it, a phase ' +
  'that never arrives is SAID both ways, the transcript merges instead of overwriting while the caret ' +
  'is in it, a Mac is called a Mac, sign-out takes NO argument, the timer budget is one 45s interval ' +
  'cleared through a falsy handle 0 and zero timers hidden or settled-idle, and revert() lets go of ' +
  'the frame, the stylesheet, both clocks and the observer');
