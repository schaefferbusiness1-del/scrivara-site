'use strict';

/* THE THREE-LINED BUTTON, AND THE CONTROLS BEHIND IT  (feat_mls_phone_ui.js, ph2-1.1.0)
 * =============================================================================
 * Owner, 2026-08-08, verbatim: "the UI looks great but get rid of the Scrivara
 * stuff and make all the buttons and settings actually work ... also the top
 * right 3 lined button doesn't work."
 *
 * WHAT WAS ACTUALLY WRONG WITH IT. The ☰ was wired to go('setup') — it drew the
 * universal sign for "there is a menu here" and then selected a tab that was
 * already in the tab bar six millimetres below it. Pressed from the Setup tab,
 * where somebody hunting for account controls has usually already landed, it
 * changed nothing at all, which is indistinguishable from a dead control.
 *
 * AND THE MENU IT SHOULD HAVE BEEN WAS LOAD-BEARING. body.mls-ph2 hides
 * #appHeader, which is where the desktop keeps Sign out and Settings. So a
 * doctor could not sign this phone out of a PHI workspace, and could not open
 * Settings from it — while the Setup screen printed "Go to Settings →
 * Integrations" as an instruction. That is this repo's the-instruction-points-
 * nowhere class, aimed at a device that had no route to the place named.
 *
 * WHY THESE ASSERTIONS ARE EXECUTED, NOT GREPPED. Every control here is pressed
 * through the module's real delegated click handler, and each one is graded on
 * WHICH host function it reached — because the failure that matters is not a
 * missing button, it is a button that runs something subtly different from what
 * the desktop runs. Sign out is the sharpest case: logout(force) skips the
 * unsynced-note warning when force is true, and those notes exist only on the
 * device being signed out of.
 *
 * jsdom-free hand-rolled DOM (repo convention), same shape as
 * phone-app-is-its-own-app.test.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_phone_ui.js'), 'utf8');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function makeHarness(opts) {
  opts = opts || {};
  const byId = new Map();
  const timers = [];
  const calls = {
    pullDay: 0, startVisitFor: [], record: 0, stopRecording: 0, generate: 0,
    cancelActive: 0, toasts: [], openSettings: 0, logout: [], loadCalendar: [],
    loadPatients: 0, setDay: [], shifted: [], tabClicks: [], clipboard: []
  };

  function makeNode(tag) {
    const n = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '', type: '', textContent: '', value: '', disabled: false,
      style: { cssText: '', display: '', overflow: '', setProperty(k, v) { n.style['_' + k] = v; } },
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
      scrollIntoView() { n._scrolled = true; },
      select() {}, setSelectionRange() {}, focus() { document.activeElement = n; },
      fire(type, ev) { (n._handlers[type] || []).forEach(fn => fn(ev)); }
    };
    return n;
  }
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
    visibilityState: 'visible',
    activeElement: null,
    body, head, documentElement: head,
    createElement: makeNode,
    getElementById(id) { return byId.get(id) || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    execCommand: opts.execCommand || undefined,
    addEventListener(t, fn) { (document._h = document._h || {})[t] = (document._h[t] || []).concat(fn); },
    removeEventListener() {},
    _fire(t, ev) { ((document._h || {})[t] || []).forEach(fn => fn(ev)); }
  };

  const snapshot = Object.assign({
    day: '2026-08-07', phase: 'idle', active: null, recSecs: 0, warn: '',
    today: [], guards: { on: true, blocked: 0 }
  }, opts.snapshot || {});

  const win = {
    __mlsPhoneHome: { wantPhone: () => opts.wantPhone !== false, ensure() {} },
    __mlsDeviceRole: {
      role: () => opts.role || 'phone',
      name: () => 'iOS · Safari',
      deviceNoun: () => 'iPhone',
      setLayoutPref() { return true; }
    },
    __mlsEasyV32: {
      remote: {
        snapshot: () => snapshot,
        startVisitFor(id, o) { calls.startVisitFor.push({ id, opts: o }); return true; },
        record() { calls.record++; return true; },
        stopRecording() { calls.stopRecording++; return opts.stopReturns !== false; },
        generate() { calls.generate++; return true; },
        requestSendReview() { return true; }
      }
    },
    __mlsDaySwitch: {
      currentDay: () => snapshot.day,
      setDay(k) { calls.setDay.push(k); return true; },
      shiftDay(n) { calls.shifted.push(n); return true; },
      rowsFor: () => snapshot.today,
      pullDay() { calls.pullDay++; }
    },
    __mlsRelayLink: {
      shouldRelay: () => opts.relay !== false,
      extPresent: () => false,
      activeJob: () => opts.activeJob || null,
      cancelActive() { calls.cancelActive++; return Promise.resolve(true); }
    },
    backendMode: () => true,
    bkToken: () => 'tok',
    bkBase: () => 'https://backend.example',
    toast(m, k) { calls.toasts.push({ m: String(m), k }); },
    _acctTodayKey: () => opts.todayKey || '2026-08-07',
    matchMedia: () => ({ matches: false }),
    /* The host globals the phone must CALL rather than reimplement. */
    openSettings: opts.noHost ? undefined : function () { calls.openSettings++; },
    logout: opts.noHost ? undefined : function (force) { calls.logout.push(force); },
    loadCalendar: opts.noHost ? undefined : function (o) { calls.loadCalendar.push(o); },
    loadPatientsFromServer: opts.noHost ? undefined : function () { calls.loadPatients++; },
    getSessionEmail: () => 'dr@example.com',
    showView() {},
    addEventListener(t, fn) { (win._h = win._h || {})[t] = (win._h[t] || []).concat(fn); },
    removeEventListener() {},
    navigator: {
      userAgent: opts.ua || IPHONE_UA,
      maxTouchPoints: 5,
      clipboard: opts.noClipboard ? undefined : {
        writeText(t) { calls.clipboard.push(t); return opts.clipboardFails ? Promise.reject(new Error('denied')) : Promise.resolve(); }
      }
    },
    location: { search: '' },
    open() {},
    innerHeight: 800,
    visualViewport: { height: 800, offsetTop: 0, addEventListener(t, fn) { (this._h = this._h || {})[t] = fn; }, removeEventListener() {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(opts.presence || null) })
  };
  win.window = win;
  win.document = document;
  win.MutationObserver = function (cb) { this.observe = function () { win._mo = cb; }; this.disconnect = function () { win._mo = null; }; };
  win.setTimeout = function (fn, ms) { const id = timers.length; timers.push({ fn, ms, id, live: true }); return id; };
  win.clearTimeout = function (id) { if (timers[id]) timers[id].live = false; };
  win.sessionStorage = { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
  win.localStorage = { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); } };
  win.Event = function (t) { this.type = t; };
  win.console = console;
  win.Date = Date; win.Math = Math; win.JSON = JSON; win.String = String; win.Number = Number;
  win.Object = Object; win.Array = Array; win.Promise = Promise; win.Error = Error;

  vm.createContext(win);
  vm.runInContext(source, win, { filename: 'feat_mls_phone_ui.js' });

  return {
    win, document, body, byId, calls, timers, snapshot,
    api: () => win.__mlsPhoneUI,
    frame: () => body.children.filter(c => c.id === 'mlsPh2')[0] || null,
    /* Read the sheet from the TREE. After a close the node object still exists,
       so answering from the id index would let a leaked menu pass as dismissed
       and the assertion would grade nothing. */
    sheet() { const f = this.frame(); return f ? (f.children.filter(c => c.id === 'mlsPh2Sheet')[0] || null) : null; },
    menuHtml() { const s = this.sheet(); return s ? s._html : ''; },
    screen: () => (byId.get('mlsPh2Body') || { _html: '' })._html,
    list: () => (byId.get('mlsPh2List') || { _html: '' })._html,
    burger() {
      const b = byId.get('mlsPh2Help');
      assert(b, 'the header menu button does not exist');
      b.fire('click', {});
    },
    tap(act, attrs) {
      const f = this.frame();
      assert(f, 'cannot tap ' + act + ': the frame is not mounted');
      const el = { getAttribute: (k) => (k === 'data-act' ? act : (attrs || {})[k] || null) };
      f.fire('click', { target: { closest: (sel) => (sel === '[data-act]' ? el : null) } });
    },
    type(id, value) {
      const f = this.frame();
      f.fire('input', { target: { id, value } });
    },
    runTimers() { timers.filter(t => t.live).forEach(t => { t.live = false; t.fn(); }); }
  };
}

const patients = [
  { id: 'a1', name: 'Marcus Bell', time: '8:30 AM', provider: 'Dr Reed' },
  { id: 'a2', name: 'Priya Raman', time: '9:00 AM', provider: 'Dr Reed' },
  { id: 'a3', name: 'Tomas Alvarez', time: '9:30 AM', provider: 'Dr Okafor' },
  { id: 'a4', name: 'Nina Petrov', time: '10:00 AM', provider: 'Dr Reed' },
  { id: 'a5', name: 'Bell Hooks', time: '10:30 AM', provider: 'Dr Okafor' },
  { id: 'a6', name: 'Owen Marsh', time: '11:00 AM', provider: 'Dr Reed' }
];

/* ===========================================================================
 * 1. THE THREE-LINED BUTTON OPENS A MENU
 * =========================================================================*/
{
  const h = makeHarness({});
  assert(!h.sheet(), 'the menu must start closed');
  h.burger();
  assert(h.sheet(), 'THE ONE HE REPORTED: pressing ☰ must open a menu');
  assert.strictEqual(h.api().state().menu, true, 'the module must know its menu is open');
  assert.strictEqual(h.api().state().tab, 'today',
    'pressing ☰ must NOT silently switch tabs — that was the old behaviour, and it is why the ' +
    'control read as dead when it was pressed from the tab it navigated to');

  /* Pressed a second time it closes: a toggle, because a person who opens a
     menu by mistake reaches for the same control to undo it. */
  h.burger();
  assert(!h.sheet(), '☰ must toggle the menu shut');
}
{
  /* THE REGRESSION THAT NAMED THE BUG: from the Setup tab the old wiring
     produced no observable change whatsoever. */
  const h = makeHarness({});
  h.api().go('setup');
  const before = h.screen();
  h.burger();
  assert(h.sheet(), 'pressing ☰ from the Setup tab must still do something visible');
  assert.strictEqual(h.screen(), before, 'and it must not silently repaint the screen underneath');
}

/* The menu is dismissible by every route a modal owes its reader. */
{
  const h = makeHarness({});
  h.burger();
  h.tap('menu-close');
  assert(!h.sheet(), 'tapping the backdrop must close the menu');

  h.burger();
  assert(h.sheet(), 'reopened');
  h.document._fire('keydown', { key: 'Escape', preventDefault() {} });
  assert(!h.sheet(), 'Escape must close the menu — an external keyboard on an iPad is ordinary');

  h.burger();
  h.document._fire('keydown', { key: 'a', preventDefault() {} });
  assert(h.sheet(), 'an unrelated key must not close it');
}

/* ===========================================================================
 * 2. EVERY MENU ITEM REACHES THE HOST FUNCTION IT CLAIMS TO
 * =========================================================================*/
{
  const h = makeHarness({});
  h.burger();
  const m = h.menuHtml();
  for (const act of ['refresh', 'settings', 'device-settings', 'setup', 'signout']) {
    assert(m.indexOf('data-act="' + act + '"') >= 0, 'the menu is missing the "' + act + '" destination');
  }
  assert(/Signed in as dr@example\.com/.test(m), 'the menu must say whose account this is before offering to sign it out');
}
{
  /* SETTINGS. It exists on this device for the first time: body.mls-ph2 hides
     #appHeader, where the desktop keeps it. */
  const h = makeHarness({});
  h.burger();
  h.tap('settings');
  assert.strictEqual(h.calls.openSettings, 1, 'Settings must call the app\'s own openSettings()');
  assert(!h.sheet(), 'and the menu must get out of the way of the modal it just opened');
}
{
  /* SIGN OUT. logout(force) SKIPS the "N notes on this device have NOT been
     backed up" stop when force is true, and those notes exist nowhere else. */
  const h = makeHarness({});
  h.burger();
  h.tap('signout');
  assert.strictEqual(h.calls.logout.length, 1, 'Sign out must call the app\'s own logout()');
  assert.strictEqual(h.calls.logout[0], undefined,
    'THE LOAD-BEARING ONE: logout() must be called with no argument. logout(true) is the idle-timeout ' +
    'path — it skips the unsynced-note confirmation, and signing out purges local clinical state.');
}
{
  /* THIS DEVICE. The Setup screen names Integrations; this is the route there. */
  const h = makeHarness({});
  const bar = h.document.createElement('div');
  bar.id = 'settingsTabBar';
  const intTab = h.document.createElement('button');
  intTab.textContent = '🔗 Integrations';
  let clicked = 0;
  intTab.click = () => { clicked++; };
  bar.querySelectorAll = () => [Object.assign(h.document.createElement('button'), { textContent: 'Display' }), intTab];
  h.byId.set('settingsTabBar', bar);
  const seg = h.document.createElement('div');
  h.byId.set('mlsDrSeg', seg);

  h.burger();
  h.tap('device-settings');
  assert.strictEqual(h.calls.openSettings, 1, 'it must open Settings');
  h.runTimers();
  assert.strictEqual(clicked, 1, 'and land on the Integrations section rather than the top of a long form');
  assert(seg._scrolled, 'and bring the device controls themselves into view');
}
{
  /* REFRESH. It re-reads the two things a phone can be stale about. */
  const h = makeHarness({});
  h.burger();
  h.tap('refresh');
  assert.strictEqual(h.calls.loadCalendar.length, 1, 'Refresh must reload the calendar');
  assert.strictEqual(h.calls.loadCalendar[0] && h.calls.loadCalendar[0].fresh, true,
    'and it must be a FRESH read, not a cached repaint');
  assert.strictEqual(h.calls.loadPatients, 1, 'and reload the patient roster');
}
{
  /* A host that has not finished loading must produce a sentence, never a
     silent no-op. This whole module exists because a control that refuses
     without saying so is the defect. */
  const h = makeHarness({ noHost: true });
  h.burger();
  h.tap('settings');
  h.tap('signout');
  assert(h.calls.toasts.length >= 2, 'a control whose host function is missing must SAY so');
  assert(h.calls.toasts.every(t => t.k === 'err'), 'and say it as an error, not a neutral note');
}

/* ===========================================================================
 * 3. JUMP BACK TO TODAY
 * =========================================================================*/
{
  /* Off today: both the day row and the menu offer the way home. */
  const h = makeHarness({ snapshot: { day: '2026-08-04' }, todayKey: '2026-08-07' });
  assert(/data-act="today-jump"/.test(h.screen()),
    'standing on another day, the day row must offer a way back — walking back from Friday one tap ' +
    'at a time is not a way home');
  h.burger();
  assert(/data-act="today-jump"/.test(h.menuHtml()), 'and the menu must offer it too');
  h.tap('today-jump');
  assert.deepStrictEqual(h.calls.setDay, ['2026-08-07'], 'it must set the account-local today, not the device clock');
}
{
  /* On today it is not offered, because it would do nothing. */
  const h = makeHarness({ snapshot: { day: '2026-08-07' }, todayKey: '2026-08-07' });
  assert(!/data-act="today-jump"/.test(h.screen()), 'on today, a "jump to today" control is a control that does nothing');
}

/* ===========================================================================
 * 4. FIND A PATIENT — AND THE CARET SURVIVES IT
 * =========================================================================*/
{
  const h = makeHarness({ snapshot: { today: patients } });
  assert(/id="mlsPh2Find"/.test(h.screen()), 'a six-patient day must offer a search box');

  const bodyBefore = h.screen();
  h.type('mlsPh2Find', 'bell');
  assert.strictEqual(h.screen(), bodyBefore,
    'THE CARET RULE: a keystroke must repaint the LIST only. Rewriting the whole screen would destroy ' +
    'the input being typed into on every character.');
  const l = h.list();
  assert(/Marcus Bell/.test(l) && /Bell Hooks/.test(l), 'the filter must match anywhere in the name');
  assert(!/Priya Raman/.test(l), 'and must exclude what does not match');
  assert(/Showing 2 of 6/.test(l), 'the count must say what is hidden — a filtered list that looks like the whole day is a lie');

  h.type('mlsPh2Find', 'Okafor');
  assert(/Tomas Alvarez/.test(h.list()), 'the provider must be searchable too');

  h.type('mlsPh2Find', 'zzz');
  assert(/No one on this day matches/.test(h.list()), 'an empty result must say so, not render a blank pane');
}
{
  /* A short day does not get a box it does not need. */
  const h = makeHarness({ snapshot: { today: patients.slice(0, 3) } });
  assert(!/id="mlsPh2Find"/.test(h.screen()), 'three patients do not need a search box above them');
}
{
  /* Changing the day clears the filter, or the new day arrives pre-filtered by
     a query nobody typed for it and reads as empty. */
  const h = makeHarness({ snapshot: { today: patients } });
  h.type('mlsPh2Find', 'bell');
  assert(/Showing 2 of 6/.test(h.list()), 'precondition: the filter is applied');
  h.tap('day-next');
  /* Read the whole repainted screen, not the list stub: a day change is a FULL
     repaint, which is the thing being checked. */
  const after = h.screen();
  assert(!/value="bell"/.test(after), 'a new day must not inherit the previous day\'s search box contents');
  assert(!/Showing \d+ of/.test(after),
    'nor its filtered count — a day nobody searched, arriving pre-filtered, reads as an empty day');
  assert.deepStrictEqual(h.calls.shifted, [1], 'and the day must actually have moved');
}

/* ===========================================================================
 * 5. NAVIGATION WORKS WHILE THE TRANSCRIPT HAS FOCUS
 * -----------------------------------------------------------------------------
 * The old caret guard lived inside signature() and returned S.lastSig. Every
 * caller that wanted a forced repaint cleared S.lastSig first — so the guard
 * returned '', the comparison was '' === '', and render() returned having drawn
 * nothing. With a finger in the transcript, the tab bar was inert.
 * =========================================================================*/
{
  const h = makeHarness({ snapshot: { today: patients, phase: 'rec', active: { id: 'a2', name: 'Priya Raman' } } });
  h.api().go('visit');
  h.document.activeElement = { id: 'mlsPh2Tx' };
  h.api().go('setup');
  assert(/This iPhone/.test(h.screen()),
    'a tab press must win over the caret guard: the doctor asked for a different screen');
  assert.strictEqual(h.api().state().tab, 'setup', 'and the module must agree it is there');
}
{
  /* The guard still does its real job: an engine repaint must not move the
     caret out from under someone correcting a transcript. */
  const h = makeHarness({ snapshot: { today: patients, phase: 'rec', active: { id: 'a2', name: 'Priya Raman' } } });
  h.api().go('visit');
  const before = h.screen();
  h.document.activeElement = { id: 'mlsPh2Tx' };
  h.snapshot.recSecs = 99;              /* the ticker's own reason to repaint */
  h.win.__mlsPhoneUI.ensure();
  assert.strictEqual(h.screen(), before, 'an unforced repaint must never run under the caret');
}

/* ===========================================================================
 * 6. THE PULL CONTROLS DO NOT LIE ABOUT BEING AVAILABLE
 * =========================================================================*/
{
  /* A running pull: the engine refuses a day change while one is live, so an
     enabled arrow whose only possible outcome is an error toast is a control
     that claims to be available and is not. */
  const h = makeHarness({ activeJob: { id: 'j1' } });
  const s = h.screen();
  assert(/data-act="day-prev" aria-label="Previous day" disabled/.test(s),
    'the day arrows must be disabled while a pull is running: ' + s.slice(0, 300));
  assert(/data-act="day-next" aria-label="Next day" disabled/.test(s), 'both arrows');
}
{
  /* A phone registers a double-tap as two clicks far more often than a mouse
     does, and pulling() cannot see the second one until the engine has disabled
     its own button. Two engines over one store is what the cross-tab shield
     exists to refuse; do not hand it the case. */
  const h = makeHarness({});
  h.tap('pull-start');
  h.tap('pull-start');
  assert.strictEqual(h.calls.pullDay, 1, 'a double-tap on the pull button must start ONE pull');
}
{
  /* A day arrow with no engine behind it must say so rather than absorb the press. */
  const h = makeHarness({});
  delete h.win.__mlsDaySwitch;
  h.tap('day-next');
  assert(h.calls.toasts.some(t => t.k === 'err'), 'a day arrow that cannot act must say why');
}

/* ===========================================================================
 * 7. STOP REPORTS A DISAGREEMENT WITH THE ENGINE
 * =========================================================================*/
{
  /* stopRecording() returns false when the engine believes nothing is running.
     That disagreement is exactly what the doctor is looking at — a Stop button
     over a screen that says Recording — so it has to be said out loud. */
  const h = makeHarness({ stopReturns: false, snapshot: { phase: 'rec', active: { id: 'a2', name: 'Priya Raman' } } });
  h.api().go('visit');
  h.tap('stop');
  assert.strictEqual(h.calls.stopRecording, 1, 'Stop must still reach the engine');
  assert(h.calls.toasts.some(t => /no live recording to stop/i.test(t.m)),
    'and a refusal must reach the doctor instead of being swallowed');
}

/* ===========================================================================
 * 8. NO SCRIVARA
 * -----------------------------------------------------------------------------
 * Owner: "get rid of the Scrivara stuff." app.html and its store lane are a
 * different product and are untouched; what is asserted here is that THIS app
 * no longer advertises it, and no longer sends "the full setup guide" to that
 * app's install page. Both were the only two routes out of MLS on a phone, and
 * both left MLS.
 * =========================================================================*/
{
  const h = makeHarness({ snapshot: { today: patients } });
  const screens = [];
  for (const tab of ['today', 'visit', 'setup']) { h.api().go(tab); screens.push(h.screen()); }
  h.burger();
  screens.push(h.menuHtml());
  for (const s of screens) {
    assert(!/scrivara/i.test(s), 'a phone screen still names Scrivara:\n' + s.slice(0, 400));
    assert(!/app\.html/i.test(s), 'a phone screen still links the other app');
    assert(!/phone-setup\.html/i.test(s), 'a phone screen still links the other app\'s install guide');
  }
}
/* Graded on the CODE, not the prose: the header explains what was removed and
   why, and that explanation necessarily contains the name. */
{
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert(!/scrivara/i.test(code), 'the module still carries Scrivara in its executable source');
  assert(!/SMALL_APP_URL|data-act="small-app"|data-act="setup-guide"/.test(code),
    'the cross-app controls are back');
}

/* ===========================================================================
 * 9. SETTINGS IS REACHABLE BY LOOKING, NOT ONLY BEHIND A GLYPH
 * -----------------------------------------------------------------------------
 * The Setup screen printed "Go to Settings → Integrations" while offering no
 * route there from the device reading it. A menu alone would fix the reach and
 * leave the instruction still pointing past the reader, so the screen that is
 * ABOUT this device carries the buttons too.
 * =========================================================================*/
{
  const h = makeHarness({});
  h.api().go('setup');
  const s = h.screen();
  assert(/data-act="settings"/.test(s), 'the Setup screen must offer Settings');
  assert(/data-act="signout"/.test(s), 'and a way to sign this device out');
  assert(/data-act="device-settings"/.test(s), 'and a way to change what this device is set up as');
  h.tap('device-settings');
  assert.strictEqual(h.calls.openSettings, 1, 'and that control must actually open it');
}

/* ===========================================================================
 * 10. COPY CLAIMS ONLY WHAT IT DID
 * -----------------------------------------------------------------------------
 * navigator.clipboard.writeText returns a PROMISE. The old code toasted "Note
 * copied." on the same tick and swallowed the rejection, so a browser that
 * refused the write reported success — and the doctor pasted whatever was on
 * the clipboard before into a chart.
 * =========================================================================*/
async function copyChecks() {
  {
    const h = makeHarness({ snapshot: { phase: 'note', active: { id: 'a2', name: 'Priya Raman' } } });
    h.byId.set('noteBox', Object.assign(h.document.createElement('textarea'), { value: 'ASSESSMENT: right knee OA.' }));
    h.api().go('visit');
    h.tap('copy-note');
    await new Promise((r) => setTimeout(r, 0));
    const ok = h.calls.toasts.filter((t) => /copied/i.test(t.m));
    assert.strictEqual(ok.length, 1, 'a clipboard write that resolved must be reported');
    assert.strictEqual(ok[0].k, 'ok', 'and reported as a success');
    assert.deepStrictEqual(h.calls.clipboard, ['ASSESSMENT: right knee OA.'], 'and it must copy the note');
  }
  {
    /* THE ONE THAT MATTERS: a refused write must not say "copied". */
    const h = makeHarness({ clipboardFails: true, snapshot: { phase: 'note', active: { id: 'a2', name: 'Priya Raman' } } });
    h.byId.set('noteBox', Object.assign(h.document.createElement('textarea'), { value: 'ASSESSMENT: right knee OA.' }));
    h.api().go('visit');
    h.tap('copy-note');
    await new Promise((r) => setTimeout(r, 0));
    assert(!h.calls.toasts.some((t) => /^Note copied/.test(t.m)),
      'a clipboard write that was REFUSED reported success — the doctor pastes the previous clipboard into a chart');
    assert(h.calls.toasts.some((t) => t.k === 'err' && /press and hold/i.test(t.m)),
      'and the failure must come with the manual way to do it');
  }
  {
    /* An empty note is refused before the clipboard is touched at all. */
    const h = makeHarness({ snapshot: { phase: 'note', active: { id: 'a2', name: 'Priya Raman' } } });
    h.api().go('visit');
    h.tap('copy-note');
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(h.calls.clipboard.length, 0, 'there is nothing to copy, so nothing may be written');
    assert(h.calls.toasts.some((t) => /no note to copy/i.test(t.m)), 'and it must say why');
  }
}

copyChecks().then(function () {
  console.log('PASS the phone menu and its controls: ☰ opens a real menu (toggle, backdrop, Escape) instead of ' +
    're-selecting a tab; Settings and Sign out are reachable from a phone for the first time and reach the ' +
    "app's own openSettings()/logout() — logout with NO force, so the unsynced-note stop survives; This device " +
    'lands on Integrations; Refresh re-reads the calendar fresh; Jump-to-today appears only off today; find-a-' +
    'patient filters without repainting under the caret and clears on a day change; a tab press now wins over ' +
    'the caret guard while an unforced repaint still does not; the day arrows are disabled mid-pull and a ' +
    'double-tap starts ONE pull; Stop reports the engine disagreeing; copy tells the truth about the ' +
    'clipboard; and no phone screen names Scrivara');
}, function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
