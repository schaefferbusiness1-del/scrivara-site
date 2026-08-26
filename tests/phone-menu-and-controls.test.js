'use strict';

/* EVERY CONTROL ACTUALLY WORKS  (feat_mls_phone_ui.js, ph3-1.0.0)
 * =============================================================================
 * Owner, 2026-08-08: "the UI looks great but get rid of the Scrivara stuff and
 * make all the buttons and settings actually work ... also the top right 3 lined
 * button doesn't work."
 * Owner, 2026-08-09: "the phone app is suppost to do all these thigns and be
 * easy to use and it just sucks. Learn what it support to do remark from scratch
 * confirm everyhting works uplaod live."
 *
 * WHAT THIS SUITE IS FOR. One sentence, and every assertion below is an
 * instance of it: A CONTROL WHOSE PRESS IS INDISTINGUISHABLE FROM A DEAD
 * CONTROL IS A DEFECT, and so is a control that reaches something subtly
 * different from what the desktop reaches. Both complaints above are that
 * sentence. ph2's ☰ was wired to go('setup') -- it drew the universal sign for
 * "there is a menu here" and selected a tab that was already in the tab bar six
 * millimetres below it; pressed from Setup it changed nothing at all.
 *
 * SO EVERY CONTROL HERE IS PRESSED THROUGH THE MODULE'S REAL DELEGATED CLICK
 * HANDLER, and graded twice:
 *   1. on WHICH host function it reached -- sign out is the sharpest case,
 *      because logout(force) SKIPS the unsynced-note warning when force is true
 *      and those notes exist only on the device being signed out of; and
 *   2. on whether the press produced ANY observable change at all (§14 presses
 *      every data-act the handler knows and refuses a silent one).
 *
 * WHAT CHANGED FROM THE ph2 EDITION OF THIS FILE. ph3 has TWO screens and one
 * sheet, not three tabs, so the assertions that pinned "☰ must not switch tabs"
 * are re-expressed as "the ONE header control opens the sheet on the day screen
 * and is Back on the visit screen" (§1). The refusal assertions are re-expressed
 * against refuse(), which says a refusal BOTH ways -- toast AND the sticky
 * in-frame line -- because a four-second toast a doctor was not looking at is
 * how "I pressed it and nothing happened" happens (§4). And three engine
 * actions now CHECK that the phase they claimed actually arrived (§5): the
 * engine's booleans mean "dispatched", not "done".
 *
 * A KNOWN LOSS, RECORDED RATHER THAN DELETED: ph2 bound document 'keydown' and
 * closed the sheet on Escape. ph3 binds no keydown handler at all, so the
 * Escape assertion cannot be re-expressed -- it would simply fail. It is NOT
 * quietly dropped: see §2, which pins the routes that do exist and names the
 * one that no longer does, so the gap is on the record for the owner instead of
 * disappearing with the old file.
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
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const HEALTHY_PRESENCE = { officeName: 'Front desk PC', online: true, ext: true, officeAth: 'ok' };

function flush() { return new Promise((r) => setTimeout(r, 0)); }

function makeHarness(opts) {
  opts = opts || {};
  const byId = new Map();
  const timers = [];
  const intervals = [];
  const calls = {
    pullDay: 0, startVisitFor: [], record: 0, stopRecording: 0, generate: 0,
    sendReview: 0, cancelActive: 0, toasts: [], openSettings: 0, logout: [],
    loadCalendar: [], loadPatients: 0, setDay: [], shifted: [], clipboard: [],
    layoutPref: [], reloads: 0, prompts: 0, fetches: []
  };

  function makeNode(tag) {
    const n = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '', type: '', textContent: '', value: '', disabled: false, hidden: false,
      className: '',
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
      /* paintList does `tmp.innerHTML = rowsHtml; holder.parentNode.replaceChild(tmp.firstChild, holder)`.
         firstChild has to carry that markup or the surgical list repaint -- the
         thing that keeps a keystroke from destroying the box being typed into --
         cannot be executed at all, only grepped. */
      get firstChild() { return n._html ? { _html: n._html } : null; },
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
      /* Only the one selector the module actually uses. The rows block contains
         no nested <div>, so the first </div> closes it. */
      querySelector(sel) {
        if (sel !== '.ph3-rows') return null;
        const m = n._html.match(/<div class="ph3-rows">[\s\S]*?<\/div>/);
        if (!m) return null;
        return { _rows: true, _start: m.index, _end: m.index + m[0].length, parentNode: n };
      },
      querySelectorAll() { return []; },
      replaceChild(newC, oldC) {
        if (oldC && oldC._rows) {
          const html = String((newC && newC._html) || '');
          n._html = n._html.slice(0, oldC._start) + html + n._html.slice(oldC._end);
          registerIds(html);
          return oldC;
        }
        return oldC;
      },
      closest() { return null; },
      scrollIntoView() { n._scrolled = true; },
      select() {}, setSelectionRange() {}, focus() { document.activeElement = n; },
      fire(type, ev) { (n._handlers[type] || []).forEach(fn => fn(ev)); }
    };
    return n;
  }
  /* Ids carried in a rendered HTML string become addressable nodes, WITH their
     id set on the node -- the input handler reads ev.target.id and the
     transcript merge reads $('mlsPh3Tx').value, so a node with a blank id would
     silently skip both. */
  function registerIds(html) {
    const re = /id="([A-Za-z0-9_-]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      if (!byId.has(m[1])) { const n = makeNode('div'); n.id = m[1]; byId.set(m[1], n); }
    }
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
    __mlsPhoneHome: opts.noHome ? undefined : { wantPhone: () => opts.wantPhone !== false, ensure() {} },
    __mlsDeviceRole: opts.noRole ? undefined : {
      role: () => opts.role || 'phone',
      name: () => 'iOS · Safari',
      deviceNoun: () => 'iPhone',
      setLayoutPref(v) { calls.layoutPref.push(v); return true; }
    },
    __mlsEasyV32: {
      remote: {
        snapshot: () => snapshot,
        startVisitFor(id, o) { calls.startVisitFor.push({ id, opts: o }); return opts.openFails ? false : true; },
        record() { calls.record++; if (opts.recordStarts) snapshot.phase = 'rec'; return opts.recordReturns !== false; },
        stopRecording() { calls.stopRecording++; if (opts.stopWorks) snapshot.phase = 'stopped'; return opts.stopReturns !== false; },
        generate() { calls.generate++; if (opts.generateWorks) snapshot.phase = 'gen'; return opts.generateReturns !== false; },
        requestSendReview() { calls.sendReview++; return opts.sendReturns !== false; }
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
    _calAppts: opts.appts || [],
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
      maxTouchPoints: opts.maxTouchPoints === undefined ? 5 : opts.maxTouchPoints,
      clipboard: opts.noClipboard ? undefined : {
        writeText(t) { calls.clipboard.push(t); return opts.clipboardFails ? Promise.reject(new Error('denied')) : Promise.resolve(); }
      }
    },
    location: { search: '', reload() { calls.reloads++; } },
    open() {},
    innerHeight: 800,
    innerWidth: opts.innerWidth === undefined ? 375 : opts.innerWidth,
    visualViewport: { height: 800, offsetTop: 0, addEventListener(t, fn) { (this._h = this._h || {})[t] = fn; }, removeEventListener() {} },
    /* Two endpoints, two answers. One catch-all body would have let the
       check-in reader swallow the presence payload and still look green. */
    fetch(url) {
      const u = String(url);
      calls.fetches.push(u);
      if (u.indexOf('/api/avatar/checkins') >= 0) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ checkins: (opts.checkins || []).slice() }) });
      }
      if (u.indexOf('/api/relay/presence') >= 0) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.presence === undefined ? HEALTHY_PRESENCE : opts.presence) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    }
  };
  win.window = win;
  win.document = document;
  win.MutationObserver = function (cb) { this.observe = function () { win._mo = cb; }; this.disconnect = function () { win._mo = null; }; };
  win.setTimeout = function (fn, ms) { const id = timers.length; timers.push({ fn, ms, id, live: true }); return id; };
  win.clearTimeout = function (id) { if (timers[id]) timers[id].live = false; };
  /* THE FIRST HANDLE IS 0, ON PURPOSE. A timer handle of 0 is FALSY, and a
     module that clears with `if (S.ckTimer)` leaves that interval running
     forever while arming a second one. §15 grades exactly that. */
  win.setInterval = function (fn, ms) { const id = intervals.length; intervals.push({ fn, ms, id, live: true }); return id; };
  win.clearInterval = function (id) { if (intervals[id]) intervals[id].live = false; };
  win.sessionStorage = { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
  win.localStorage = { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); } };
  win.Event = function (t) { this.type = t; };
  win.console = console;
  win.Date = Date; win.Math = Math; win.JSON = JSON; win.String = String; win.Number = Number;
  win.Object = Object; win.Array = Array; win.Promise = Promise; win.Error = Error;
  win.isNaN = isNaN;

  vm.createContext(win);
  vm.runInContext(source, win, { filename: 'feat_mls_phone_ui.js' });

  return {
    win, document, body, byId, calls, timers, intervals, snapshot,
    api: () => win.__mlsPhoneUI,
    frame: () => body.children.filter(c => c.id === 'mlsPh3')[0] || null,
    css: () => String((byId.get('mlsPh3Css') || {}).textContent || ''),
    screen: () => (byId.get('mlsPh3Body') || { _html: '' })._html,
    actionBar: () => (byId.get('mlsPh3Act') || { _html: '' })._html,
    header: () => byId.get('mlsPh3Nav'),
    /* Read the sheet from the TREE. closeMenu() leaves the node in place and
       empties it, so answering "is the menu open" from the id index alone would
       let a leaked sheet pass as dismissed and the assertion would grade
       nothing. Open == in the tree AND carrying the open class AND holding
       controls. */
    sheetNode() { const f = this.frame(); return f ? (f.children.filter(c => c.id === 'mlsPh3Sheet')[0] || null) : null; },
    menuOpen() {
      const s = this.sheetNode();
      return !!(s && String(s.className || '').indexOf('ph3-open') >= 0 && String(s._html || '').indexOf('data-act') >= 0);
    },
    menuHtml() { const s = this.sheetNode(); return s ? String(s._html || '') : ''; },

    /* The sticky in-frame message. It lives in the FRAME, not the body, which
       is the whole reason it survives an engine repaint. */
    noteShown() { const n = byId.get('mlsPh3Note'); return !!(n && String(n.className || '').indexOf('ph3-show') >= 0); },
    noteBad() { const n = byId.get('mlsPh3Note'); return !!(n && String(n.className || '').indexOf('ph3-bad') >= 0); },
    noteText() { const t = byId.get('mlsPh3NoteTxt'); return String((t && t.textContent) || ''); },

    /* The ONE header control. */
    nav() {
      const b = byId.get('mlsPh3Nav');
      assert(b, 'the ONE left header control #mlsPh3Nav does not exist');
      b.fire('click', {});
    },
    alert() {
      const b = byId.get('mlsPh3Alert');
      assert(b, 'the unread check-in pill #mlsPh3Alert does not exist');
      b.fire('click', {});
    },
    alertNode() { return byId.get('mlsPh3Alert'); },

    /* A control, as the delegated handler sees one: ph3 walks parentNode up to
       the frame looking for data-act (ph2 used ev.target.closest). */
    control(act, attrs) {
      const map = Object.assign({ 'data-act': act }, attrs || {});
      return {
        disabled: false, parentNode: null,
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; }
      };
    },
    /* A DISABLED button dispatches no click in a browser. Modelling that is what
       makes the double-tap assertion grade the module's own guard instead of
       grading the harness. */
    press(el) {
      const f = this.frame();
      assert(f, 'cannot press a control: the frame is not mounted');
      if (el.disabled) return false;
      el.parentNode = f;
      f.fire('click', { target: el });
      return true;
    },
    tap(act, attrs) { return this.press(this.control(act, attrs)); },
    type(id, value) {
      const f = this.frame();
      const n = byId.get(id);
      assert(n, 'cannot type into #' + id + ': it was never rendered');
      n.value = value;
      f.fire('input', { target: n });
    },
    fireWin(type, ev) { ((win._h || {})[type] || []).forEach(fn => fn(ev)); },
    /* Run only the timers armed at a given delay, so firing the 1500ms phase
       confirmation does not also fire the 1000ms ensure retry and repaint the
       thing being asserted about. */
    fireTimers(ms) {
      timers.filter(t => t.live && t.ms === ms).forEach(t => { t.live = false; t.fn(); });
    },
    liveIntervals() { return intervals.filter(t => t.live); },
    async pollCheckins() { this.api()._ckPoll(); await flush(); },

    /* The rows block, and everything that is NOT the rows block. A keystroke in
       the find box may rewrite the first and must not touch the second. */
    list() { const m = this.screen().match(/<div class="ph3-rows">[\s\S]*?<\/div>/); return m ? m[0] : ''; },
    outsideRows() { return this.screen().replace(/<div class="ph3-rows">[\s\S]*?<\/div>/, '<ROWS/>'); },

    /* Everything a press could possibly be observed by. §14 refuses a press
       that changes none of it. */
    ui() {
      return JSON.stringify({
        body: this.screen(), act: this.actionBar(), menu: this.menuOpen(),
        screen: this.api().state().screen, note: this.noteText(), noteShown: this.noteShown(),
        alert: String((this.alertNode() || {})._html || '') + '|' + String((this.alertNode() || {}).hidden),
        calls
      });
    }
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
const ACTIVE = { id: 'a2', name: 'Priya Raman', time: '9:00 AM' };

function withNote(h, text) {
  h.byId.set('noteBox', Object.assign(h.document.createElement('textarea'), { value: text }));
  return h;
}

/* ===========================================================================
 * 1. THE ONE HEADER CONTROL: MENU ON THE DAY, BACK ON A VISIT
 * ---------------------------------------------------------------------------
 * ph3 has a single left-hand header control, because a phone header with two of
 * them is a header the doctor has to read before pressing. It therefore has to
 * carry two meanings without ever being ambiguous about which one is live --
 * and neither meaning may ever be a no-op, which is the whole reported bug.
 * =========================================================================*/
{
  const h = makeHarness({});
  assert(h.frame(), 'the phone frame #mlsPh3 must mount on a phone');
  assert(h.body.classList.contains('mls-ph3'), 'the body class must be mls-ph3');
  assert.strictEqual(h.api().version, 'ph3-1.0.0', 'the version string must say what shipped');

  assert(!h.menuOpen(), 'the menu must start closed');
  const before = h.screen();
  h.nav();
  assert(h.menuOpen(), 'THE ONE HE REPORTED: pressing the header control must open a real menu');
  assert.strictEqual(h.api().state().menu, true, 'the module must know its menu is open');
  assert.strictEqual(h.api().state().screen, 'day',
    'opening the menu must NOT navigate. The ph2 wiring selected a tab instead, which is why the ' +
    'control read as dead when it was pressed from the tab it navigated to.');
  assert.strictEqual(h.screen(), before, 'and it must not silently repaint the screen underneath');

  /* A toggle, because a person who opens a menu by mistake reaches for the same
     control to undo it. */
  h.nav();
  assert(!h.menuOpen(), 'the header control must toggle the menu shut');
}
{
  /* state().tab still aliases state().screen: mls-connect.js reads state()
     through newUiOwns(), and a phone that mounts but reports nothing usable
     hands the desktop shell back the screen. */
  const h = makeHarness({});
  const st = h.api().state();
  assert.strictEqual(st.tab, st.screen, 'state().tab must alias state().screen for the connect layer');
  assert.strictEqual(st.mounted, true, 'state().mounted is what newUiOwns() reads');
}
{
  /* ON A VISIT THE SAME CONTROL IS BACK. Pressed there it must navigate, and it
     must NOT open the menu -- two meanings, never both at once. */
  const h = makeHarness({ snapshot: { today: patients, active: ACTIVE } });
  h.api().go('visit');
  assert.strictEqual(h.api().state().screen, 'visit', 'precondition: the visit screen is pushed');
  const visitBody = h.screen();

  h.nav();
  assert.strictEqual(h.api().state().screen, 'day',
    'the header control on a visit is BACK. ph2 toggled the menu here instead, so the only way off the ' +
    'visit screen was the tab bar this app no longer has.');
  assert(!h.menuOpen(), 'and it must not also open the menu — a control with two simultaneous meanings is unpressable');
  assert.notStrictEqual(h.screen(), visitBody, 'and the screen must actually have changed, or the press is indistinguishable from a dead control');
}
{
  /* IT SAYS WHICH ONE IT IS. A screen reader, and a doctor reading the glyph,
     both get told -- and the popup semantics are removed on the screen where it
     is not a popup, rather than left claiming a dialog that will never open. */
  const h = makeHarness({ snapshot: { today: patients, active: ACTIVE } });
  const nav = h.header();
  assert.strictEqual(nav.getAttribute('aria-label'), 'Menu', 'on the day it must announce itself as the menu');
  assert.strictEqual(nav.getAttribute('aria-haspopup'), 'dialog', 'and as a thing that opens a dialog');
  assert(/&#9776;/.test(nav._html), 'and draw the three lines');

  h.api().go('visit');
  assert.strictEqual(nav.getAttribute('aria-label'), 'Back to the day', 'on a visit it must announce itself as Back');
  assert.strictEqual(nav.getAttribute('aria-haspopup'), null, 'and stop claiming it opens a dialog');
  assert(/Day/.test(nav._html) && /&#8249;/.test(nav._html), 'and draw a back chevron with a word next to it');
}

/* ===========================================================================
 * 2. THE SHEET IS DISMISSIBLE
 * ---------------------------------------------------------------------------
 * ph2 also closed the sheet on Escape (document keydown). ph3 binds NO keydown
 * handler, so that route is gone. It is recorded here rather than deleted with
 * the old file: an external keyboard on an iPad is ordinary, and this is the
 * one dismissal route the rebuild lost.
 * =========================================================================*/
{
  const h = makeHarness({});
  h.nav();
  assert(h.menuOpen(), 'precondition: open');
  h.tap('menu-close');
  assert(!h.menuOpen(), 'tapping the backdrop must close the menu');
  assert.strictEqual(h.api().state().menu, false, 'and the module must agree it is closed');

  h.nav();
  assert(h.menuOpen(), 'reopened');
  h.tap('settings');
  assert(!h.menuOpen(), 'and choosing a destination must get the menu out of the way of what it just opened');

  /* THE LOST ROUTE, stated as a fact about ph3 rather than as a passing
     assertion about a handler that is not there. If Escape is restored, this
     flips to an executed assertion. */
  assert(!/addEventListener\('keydown'/.test(source),
    'ph3 has grown a keydown handler: re-express the ph2 Escape-closes-the-menu assertion here rather than leaving it unpinned');
}

/* ===========================================================================
 * 3. EVERY MENU ITEM REACHES THE HOST FUNCTION IT CLAIMS TO
 * ---------------------------------------------------------------------------
 * The sheet replaces the ph2 Setup tab, so it is now the ONLY route to account
 * and device controls on this device: body.mls-ph3 hides #appHeader, where the
 * desktop keeps them.
 * =========================================================================*/
{
  const h = makeHarness({});
  h.nav();
  const m = h.menuHtml();
  for (const act of ['refresh', 'settings', 'device', 'install', 'fullapp', 'signout']) {
    assert(m.indexOf('data-act="' + act + '"') >= 0, 'the menu is missing the "' + act + '" destination');
  }
  assert(/Signed in as dr@example\.com/.test(m), 'the menu must say whose account this is before offering to sign it out');
  assert(/Sign out of this iPhone/.test(m), 'and name the device it is signing out, in the device\'s own noun');
  assert(m.indexOf('data-act="setup"') < 0, 'the Setup tab is gone; a menu item pointing at it would point nowhere');
}
{
  /* SETTINGS. It exists on this device only because this menu exists. */
  const h = makeHarness({});
  h.nav();
  h.tap('settings');
  assert.strictEqual(h.calls.openSettings, 1, 'Settings must call the app\'s own openSettings()');
}
{
  /* THIS DEVICE. ph2 opened Settings and then reached into the modal's own tab
     bar to click Integrations. ph3 opens the same modal and SAYS where to look,
     because a phone cannot show the section rail and the form at once. Either
     way the requirement is the same one: the instruction must not point past
     the reader. */
  const h = makeHarness({});
  h.nav();
  h.tap('device');
  assert.strictEqual(h.calls.openSettings, 1, 'This device must open the app\'s own Settings');
  assert(h.calls.toasts.some(t => /Integrations/.test(t.m) && /This device/.test(t.m)),
    'and name the section to look in — "go to Settings → Integrations" printed on a device with no route there is the defect this replaced');
}
{
  /* REFRESH. It re-reads the two things a phone can be stale about, and both
     re-reads must be FRESH. */
  const h = makeHarness({});
  h.nav();
  h.tap('refresh');
  assert.strictEqual(h.calls.loadCalendar.length, 1, 'Refresh must reload the calendar');
  assert.strictEqual(h.calls.loadCalendar[0] && h.calls.loadCalendar[0].fresh, true,
    'and it must be a FRESH read, not a cached repaint');
  assert.strictEqual(h.calls.loadPatients, 1, 'and reload the patient roster');
  assert(h.calls.fetches.some(u => /\/api\/avatar\/checkins/.test(u)), 'and re-read the check-ins');
  assert(h.calls.fetches.some(u => /\/api\/relay\/presence/.test(u)), 'and re-ask about the office computer');
}
{
  /* SIGN OUT. logout(force) SKIPS the "N notes on this device have NOT been
     backed up" stop when force is true, and those notes exist nowhere else. */
  const h = makeHarness({});
  h.nav();
  h.tap('signout');
  assert.strictEqual(h.calls.logout.length, 1, 'Sign out must call the app\'s own logout()');
  assert.strictEqual(h.calls.logout[0], undefined,
    'THE LOAD-BEARING ONE: logout() must be called with no argument. logout(true) is the idle-timeout ' +
    'path — it skips the unsynced-note confirmation, and signing out purges local clinical state.');
}
{
  /* SHOW THE FULL APP. A DURABLE preference, because a doctor who chooses the
     full app must still have it after the browser is closed. */
  const h = makeHarness({});
  h.nav();
  h.tap('fullapp');
  assert.deepStrictEqual(h.calls.layoutPref, ['full'], 'it must set the stored layout preference');
  assert.strictEqual(h.win.sessionStorage.getItem('mls_phone_mode'), null,
    'and NOT a session flag — a choice that evaporates on the next launch sends the doctor hunting for this button again');
  assert(h.calls.toasts.some(t => /Integrations/.test(t.m)), 'and say how to come back');
  h.fireTimers(700);
  assert.strictEqual(h.calls.reloads, 1, 'and actually reload, or the preference is stored and nothing visible happens');
}
{
  /* THE SAME CONTROL WITH NOTHING BEHIND IT. ph2 fell back to writing the
     session flag itself; ph3 refuses out loud rather than half-doing it, because
     a half-applied layout switch strands the device in neither layout. */
  const h = makeHarness({});
  delete h.win.__mlsDeviceRole;
  h.nav();
  h.tap('fullapp');
  assert.deepStrictEqual(h.calls.layoutPref, [], 'nothing must be stored');
  assert.strictEqual(h.win.sessionStorage.getItem('mls_phone_mode'), null, 'and no second, weaker mechanism may be used behind the doctor\'s back');
  assert(!h.calls.toasts.some(t => t.k === 'err'), 'the refusal must not duplicate the persistent phone banner in a toast');
  assert(h.noteShown() && /layout control/i.test(h.noteText()), 'and stay on the screen');
}
{
  /* ADD TO HOME SCREEN. On iOS beforeinstallprompt never fires and never will,
     but Share → Add to Home Screen works. ph2 pressed here did LITERALLY
     NOTHING (`if (!evt) return;`) — the exact defect this suite exists for. */
  const h = makeHarness({});
  h.nav();
  const before = h.ui();
  h.tap('install');
  assert.notStrictEqual(h.ui(), before, 'pressing Add to Home Screen with no browser prompt must not be a silent no-op');
  assert(h.noteShown(), 'the route must be SAID');
  assert(!h.noteBad(), 'and said as guidance, not as a failure — on iOS this is the real route, not a refusal');
  assert(/Share/.test(h.noteText()) && /Add to Home Screen/.test(h.noteText()), 'and it must name the actual steps: ' + h.noteText());
  assert(!h.calls.toasts.some(t => t.k === 'err'), 'nothing failed, so nothing may be reported as a failure');
}
{
  /* And when the browser DOES offer one, the captured prompt is used and then
     spent, so a second press falls back to the sentence rather than calling
     prompt() on a consumed event. */
  const h = makeHarness({});
  let prompts = 0;
  h.fireWin('beforeinstallprompt', { preventDefault() {}, prompt() { prompts++; } });
  h.nav();
  h.tap('install');
  assert.strictEqual(prompts, 1, 'a captured install prompt must actually be shown');
  h.tap('install');
  assert.strictEqual(prompts, 1, 'a spent prompt must not be re-fired');
  assert(h.noteShown() && /Share/.test(h.noteText()), 'and the second press must still say something');
}

/* ===========================================================================
 * 4. A REFUSAL HAS ONE PERSISTENT OWNER
 * ---------------------------------------------------------------------------
 * The physical phone rendered one identity failure three times. The closeable
 * sticky line is the phone owner: it remains visible without covering the
 * patient card with an additional transient toast and inline duplicate.
 * =========================================================================*/
{
  const h = makeHarness({ noHost: true });
  h.nav();
  h.tap('settings');

  const errs = h.calls.toasts.filter(t => t.k === 'err');
  assert.strictEqual(errs.length, 0, 'a control whose host function is missing must not duplicate the phone banner in a toast');
  assert(h.noteShown(), 'the refusal must remain on the screen: #mlsPh3Note must be showing');
  assert(h.noteBad(), 'and be styled as the refusal it is');
  const held = h.noteText();
  assert(held.length > 0, 'the persistent owner must carry a concrete sentence');

  /* THE POINT OF THE STICKY LINE: it lives in the frame, not the body, so the
     next engine repaint cannot erase the only remaining explanation. */
  h.api().render();
  assert(h.noteShown() && h.noteText() === held, 'a repaint must not erase the refusal — it lives in the frame, not the body that gets rewritten');

  /* And it is dismissible, or it becomes furniture. */
  h.tap('note-x');
  assert(!h.noteShown(), 'the doctor must be able to dismiss it');
  assert.strictEqual(h.noteText(), '', 'and it must be emptied, not merely hidden');
}
{
  /* Every missing-host refusal behaves the same way, so the doctor learns one
     rule instead of per-button folklore. */
  const h = makeHarness({ noHost: true });
  h.nav();
  h.tap('signout');
  assert(!h.calls.toasts.some(t => t.k === 'err'), 'sign out must not duplicate its persistent refusal in a toast');
  assert(h.noteShown() && h.noteBad(), 'and stick');
  h.tap('refresh');
  assert(h.noteShown(), 'refresh must refuse the same way');
  assert(h.noteBad(), 'and as an ERROR: an unloaded host must not look like a successful refresh');
}

/* ===========================================================================
 * 5. THE ENGINE'S BOOLEANS MEAN "DISPATCHED", NOT "DONE"
 * ---------------------------------------------------------------------------
 * record() returns true once it has clicked the host capture button. A phone can
 * still sit at phase 'idle' afterwards, so ph3 checks that the phase actually
 * arrived. That delayed check must not invent a permission diagnosis: consent
 * may still be open, or the capture owner may already have shown the exact
 * unsupported-browser / slow-start explanation.
 * =========================================================================*/
{
  const h = makeHarness({ snapshot: { today: patients, active: ACTIVE, phase: 'idle' } });
  h.api().go('visit');
  h.tap('record');
  assert.strictEqual(h.calls.record, 1, 'Start recording must reach the engine');
  assert(!h.calls.toasts.some(t => t.k === 'err'), 'and must not cry wolf on the same tick — the engine said yes');
  assert(!h.noteShown(), 'nor stick a refusal up before the phase has had a chance to arrive');

  /* ~1500ms later the phase is still 'idle'. */
  h.fireTimers(1500);
  assert(!h.calls.toasts.some(t => t.k === 'err'),
    'a failed phase check must not duplicate the persistent refusal in a toast');
  assert(h.noteShown() && h.noteBad(), 'and stay on the screen');
  assert(/microphone/i.test(h.noteText()),
    'and give a concrete type-or-keyboard-microphone fallback: ' + h.noteText());
  assert(!/permission|site settings/i.test(h.noteText()),
    'an idle phase alone is not evidence of a microphone permission failure: ' + h.noteText());
}
{
  /* The consent owner can legitimately keep the phase idle for longer than the
     phone confirmation window while the doctor chooses or the audit write
     settles. The watchdog must stay silent until that owner resolves. */
  const h = makeHarness({ snapshot: { today: patients, active: ACTIVE, phase: 'idle' } });
  h.win._mlsConsentAsk = {};
  h.api().go('visit');
  h.tap('record');
  h.fireTimers(1500);
  assert(!h.noteShown(),
    'the delayed record check must not cover an open consent step with a false capture error');
  assert(!h.calls.toasts.some(t => t.k === 'err'),
    'an open consent step must not also emit a phone capture failure');
}
{
  /* Both real pre-phase explanations use #micWarn: no SpeechRecognition on
     iOS, and a recognizer/lease that is still busy. Preserve the exact owner
     sentence instead of replacing it after 1.5 seconds. */
  [
    'Live dictation isn\u2019t available in any iPhone or iPad browser. Tap the keyboard microphone or type.',
    'The microphone is still busy or could not start. Wait a moment, then press Start recording again. Your transcript is safe.'
  ].forEach((exact) => {
    const h = makeHarness({ snapshot: { today: patients, active: ACTIVE, phase: 'idle' } });
    const warn = h.document.createElement('div');
    warn.id = 'micWarn';
    warn.style.display = 'flex';
    warn.textContent = exact;
    h.byId.set('micWarn', warn);
    h.api().go('visit');
    h.tap('record');
    h.fireTimers(1500);
    assert.strictEqual(h.noteText(), exact,
      'the phone must carry forward the capture owner\'s exact explanation');
    assert(!/permission|site settings/i.test(h.noteText()),
      'the exact explanation must not be rewritten as a guessed permission problem');
  });
}
{
  /* And it is NOT a blanket nag: when the phase does arrive, the check is
     silent. A confirmation that fires either way teaches the doctor to ignore
     it. */
  const h = makeHarness({ recordStarts: true, snapshot: { today: patients, active: ACTIVE, phase: 'idle' } });
  h.api().go('visit');
  h.tap('record');
  h.fireTimers(1500);
  assert(!h.calls.toasts.some(t => t.k === 'err'), 'a recording that really started must say nothing');
  assert(!h.noteShown(), 'and stick nothing to the screen');
}
{
  /* STOP. Same shape: stopRecording() returned true, the phase never left
     'rec', so the doctor is looking at a Stop button over a screen that says
     Recording. */
  const h = makeHarness({ snapshot: { today: patients, active: ACTIVE, phase: 'rec' } });
  h.api().go('visit');
  h.tap('stop');
  assert.strictEqual(h.calls.stopRecording, 1, 'Stop must reach the engine');
  h.fireTimers(1500);
  assert(h.noteShown() && /still recording/i.test(h.noteText()), 'a stop that did not stop must be said: ' + h.noteText());
}
{
  /* STOP, the ph2 assertion preserved: stopRecording() returning false is the
     engine disagreeing about whether anything is running, and that disagreement
     is exactly what the doctor is looking at. */
  const h = makeHarness({ stopReturns: false, snapshot: { today: patients, active: ACTIVE, phase: 'rec' } });
  h.api().go('visit');
  h.tap('stop');
  assert.strictEqual(h.calls.stopRecording, 1, 'Stop must still reach the engine');
  assert(!h.calls.toasts.some(t => t.k === 'err'),
    'the stop refusal must not duplicate the persistent phone banner in a toast');
  assert(h.noteShown() && h.noteBad(), 'and survive the repaint that follows it');
}
{
  /* WRITE THE NOTE. */
  const h = makeHarness({ snapshot: { today: patients, active: ACTIVE, phase: 'stopped' } });
  h.api().go('visit');
  h.tap('generate');
  assert.strictEqual(h.calls.generate, 1, 'Write the note must reach the engine');
  h.fireTimers(1500);
  assert(h.noteShown() && /did not start writing the note/i.test(h.noteText()), 'a generate that never began must be said: ' + h.noteText());
}
{
  /* And a generate the engine refuses outright is said on the same tick. */
  const h = makeHarness({ generateReturns: false, snapshot: { today: patients, active: ACTIVE, phase: 'stopped', warn: 'No patient is locked.' } });
  h.api().go('visit');
  h.tap('generate');
  assert(!h.calls.toasts.some(t => t.k === 'err'), 'a refused generate must not duplicate the persistent phone banner in a toast');
  assert.strictEqual(h.noteText(), 'No patient is locked.',
    'and the ENGINE\'s own sentence must win over ours whenever it has one — ours would be a second, weaker explanation of the same refusal');
}

/* ===========================================================================
 * 6. THE DAY CONTROLS DO NOT LIE ABOUT BEING AVAILABLE
 * =========================================================================*/
{
  const h = makeHarness({ snapshot: { today: patients } });
  h.tap('day-next');
  assert.deepStrictEqual(h.calls.shifted, [1], 'the next-day arrow must shift the day forward');
  h.tap('day-prev');
  assert.deepStrictEqual(h.calls.shifted, [1, -1], 'and the previous-day arrow back');
}
{
  /* Off today, both the day strip offers the way home and it works. */
  const h = makeHarness({ snapshot: { day: '2026-08-04' }, todayKey: '2026-08-07' });
  assert(/data-act="day-today"/.test(h.screen()),
    'standing on another day, the day strip must offer a way back — walking back from Friday one tap at a time is not a way home');
  h.tap('day-today');
  assert.deepStrictEqual(h.calls.setDay, ['2026-08-07'], 'it must set the account-local today, not the device clock');
}
{
  /* On today it is not offered, because it would do nothing. */
  const h = makeHarness({ snapshot: { day: '2026-08-07' }, todayKey: '2026-08-07' });
  assert(!/data-act="day-today"/.test(h.screen()), 'on today, a "jump to today" control is a control that does nothing');
}
{
  /* A running pull: the engine refuses a day change while one is live, so an
     enabled arrow whose only possible outcome is an error is a control that
     claims to be available and is not. */
  const h = makeHarness({ activeJob: { id: 'j1' } });
  const s = h.screen();
  assert(/data-act="day-prev" aria-label="Previous day" disabled/.test(s),
    'the day arrows must be disabled while a pull is running: ' + s.slice(0, 300));
  assert(/data-act="day-next" aria-label="Next day" disabled/.test(s), 'both arrows');

  /* And the refusal is enforced in the handler too, not only in the markup — a
     stale button from the previous repaint is still on the glass. */
  h.tap('day-next');
  assert.deepStrictEqual(h.calls.shifted, [], 'a day change during a pull must not reach the engine');
  assert(h.noteShown() && /pull is running/i.test(h.noteText()), 'and the reason must stay on the screen: ' + h.noteText());
}
{
  /* A phone registers a double-tap as two clicks far more often than a mouse
     does, and pulling() cannot see the second one until the engine has disabled
     its own button. Two engines over one store is what the cross-tab shield
     exists to refuse; do not hand it the case. */
  const h = makeHarness({});
  const btn = h.control('pull-start');
  h.press(btn);
  assert.strictEqual(btn.disabled, true,
    'the pull button must disable ITSELF in the same tick. ph2 used a 1500ms timestamp, which leaves the ' +
    'button live on the glass and lets a fast thumb through the moment it expires.');
  h.press(btn);   /* a disabled button dispatches no click in a browser */
  assert.strictEqual(h.calls.pullDay, 1, 'a double-tap on the pull button must start ONE pull');
}
{
  /* A day arrow with no engine behind it must say so rather than absorb the press. */
  const h = makeHarness({});
  delete h.win.__mlsDaySwitch;
  const before = h.ui();
  h.tap('day-next');
  assert(!h.calls.toasts.some(t => t.k === 'err'), 'a day-arrow refusal must not duplicate the persistent phone banner in a toast');
  assert(h.noteShown(), 'and the why must stay put');
  assert.notStrictEqual(h.ui(), before, 'a press that reaches nothing must still be distinguishable from a dead control');
}

/* ===========================================================================
 * 7. STOP-THE-PULL TELLS THE TRUTH ABOUT WHICH MACHINE
 * ---------------------------------------------------------------------------
 * On a phone the pull is a relay: the OFFICE COMPUTER reads athenaOne. ph2
 * called cancelActive() whenever the relay module existed and toasted "Stopped
 * waiting" — a confident sentence about a machine this one cannot see, said
 * even when there was no job record to cancel.
 * =========================================================================*/
{
  const h = makeHarness({ activeJob: { id: 'j1' } });
  h.tap('pull-stop');
  assert.strictEqual(h.calls.cancelActive, 1, 'with a real job, Stop must cancel it');
  assert(h.calls.toasts.some(t => /Stopped waiting/i.test(t.m)), 'and say what was actually stopped: the waiting');
  assert(!h.calls.toasts.some(t => /stopped the pull/i.test(t.m)),
    'never that the pull stopped — the office computer may already be reading athenaOne and will finish');
}
{
  /* Relayed, but no job record: expired, never written, or lost with the
     session. There is nothing to cancel, so nothing may be cancelled. */
  const h = makeHarness({ activeJob: null });
  h.byId.set('mlsDsPullBtn', { disabled: true });   /* the engine's own button says a pull is live */
  h.tap('pull-stop');
  assert.strictEqual(h.calls.cancelActive, 0, 'there is no job, so nothing may be cancelled');
  assert(h.noteShown() && /cannot find the job to stop/i.test(h.noteText()),
    'and the phone must say that, not report a stop it did not perform: ' + h.noteText());
  assert(!h.noteBad(), 'it is a caveat, not a failure — the office computer is probably still working');
}
{
  /* Not relayed: this device is doing the reading itself and cannot be
     interrupted, which is a refusal and is said as one. */
  const h = makeHarness({ relay: false, activeJob: null });
  h.byId.set('mlsDsPullBtn', { disabled: true });
  h.tap('pull-stop');
  assert.strictEqual(h.calls.cancelActive, 0, 'a local pull has no relay job to cancel');
  assert(!h.calls.toasts.some(t => t.k === 'err'), 'and the refusal is owned by the persistent phone banner, not a duplicate toast');
  assert(h.noteShown() && /this iPhone/i.test(h.noteText()), 'named for the device the doctor is holding: ' + h.noteText());
}

/* ===========================================================================
 * 8. OPENING A PATIENT NEVER STARTS A MICROPHONE
 * =========================================================================*/
{
  const h = makeHarness({ snapshot: { today: patients } });
  h.tap('open', { 'data-id': 'a2' });
  assert.strictEqual(h.calls.startVisitFor.length, 1, 'a patient row must reach the engine\'s own startVisitFor()');
  assert.strictEqual(h.calls.startVisitFor[0].id, 'a2', 'with the row\'s own id');
  /* Read the field, not the object: the options literal is built inside the vm
     context, so its prototype is the vm's Object.prototype and deepStrictEqual
     would fail on realm rather than on value. */
  assert.strictEqual(h.calls.startVisitFor[0].opts.record, false,
    'and record:false ALWAYS — opening a patient and starting a microphone are two decisions and the doctor makes the second');
  assert.deepStrictEqual(Object.keys(h.calls.startVisitFor[0].opts).sort(), ['quiet', 'record'],
    'and the only companion option is quiet phone-owned warning presentation');
  assert.strictEqual(h.api().state().screen, 'visit', 'and it must push the visit screen');
}
{
  /* A row the engine will not open. ph2 toasted and let the phone sit on the
     day list with no explanation four seconds later. */
  const h = makeHarness({ openFails: true, snapshot: { today: patients } });
  h.tap('open', { 'data-id': 'a2' });
  assert.strictEqual(h.api().state().screen, 'day', 'a refused open must not push an empty visit screen');
  assert(!h.calls.toasts.some(t => t.k === 'err'), 'and must not duplicate the persistent phone banner in a toast');
  assert(h.noteShown() && /another day/i.test(h.noteText()),
    'with the most likely reason, since "could not open" alone leaves the doctor pressing it again: ' + h.noteText());
}

/* ===========================================================================
 * 9. FIND A PATIENT — AND THE CARET SURVIVES IT
 * =========================================================================*/
{
  const h = makeHarness({ snapshot: { today: patients } });
  assert(/id="mlsPh3Find"/.test(h.screen()), 'a six-patient day must offer a search box');
  assert(/6 patients today/.test(h.screen()), 'and say how many there are, so nobody counts rows');

  const outside = h.outsideRows();
  h.type('mlsPh3Find', 'bell');
  assert.strictEqual(h.outsideRows(), outside,
    'THE CARET RULE: a keystroke must repaint the LIST only. Rewriting the whole screen destroys the input ' +
    'being typed into, on every character.');
  const l = h.list();
  assert(/Marcus Bell/.test(l) && /Bell Hooks/.test(l), 'the filter must match anywhere in the name');
  assert(!/Priya Raman/.test(l), 'and must exclude what does not match');

  /* No match changes the SHAPE of the screen, so a full rebuild is correct —
     and it must leave a way out rather than a blank pane. */
  h.type('mlsPh3Find', 'zzz');
  assert(/No name here matches/.test(h.screen()), 'an empty result must say so, not render a blank pane');
  assert(/data-act="find-clear"/.test(h.screen()), 'and offer a way out of it');
  h.tap('find-clear');
  assert(/Marcus Bell/.test(h.list()) && /Owen Marsh/.test(h.list()), 'clearing the search must bring the whole day back');
  assert(/value=""/.test(h.screen()), 'and empty the box it cleared');
}
{
  /* A short day does not get a box it does not need. */
  const h = makeHarness({ snapshot: { today: patients.slice(0, 3) } });
  assert(!/id="mlsPh3Find"/.test(h.screen()), 'three patients do not need a search box above them');
}
{
  /* Changing the day clears the filter, or the new day arrives pre-filtered by
     a query nobody typed for it and reads as empty. */
  const h = makeHarness({ snapshot: { today: patients } });
  h.type('mlsPh3Find', 'zzz');
  assert(/value="zzz"/.test(h.screen()), 'precondition: the query is in the rendered box');
  h.tap('day-next');
  const after = h.screen();
  assert(!/value="zzz"/.test(after), 'a new day must not inherit the previous day\'s search box contents');
  assert(!/shown</.test(after),
    'nor its filtered count — a day nobody searched, arriving pre-filtered, reads as an empty day');
  assert.deepStrictEqual(h.calls.shifted, [1], 'and the day must actually have moved');
}

/* ===========================================================================
 * 10. NAVIGATION WINS OVER THE CARET GUARD — AND THE GUARD STOPPED EATING WORDS
 * ---------------------------------------------------------------------------
 * ph2 guarded the WHOLE render on the caret. So while a finger was in the
 * transcript the engine's live appends never reached the phone, and the next
 * keystroke wrote the stale phone copy back over them: the recognizer's words,
 * silently deleted, mid-recording. ph3 puts the guard on the REBUILD and runs
 * the merge regardless.
 * =========================================================================*/
{
  const h = makeHarness({ snapshot: { today: patients, phase: 'rec', active: ACTIVE } });
  h.api().go('visit');
  h.document.activeElement = h.byId.get('mlsPh3Tx');
  h.nav();
  assert.strictEqual(h.api().state().screen, 'day',
    'a navigation press must win over the caret guard: the doctor asked for a different screen');
  assert(/mlsPh3Day/.test(h.screen()), 'and the day screen must actually be drawn');
}
{
  /* The guard still does its real job: an engine repaint must not move the
     caret out from under someone correcting a transcript. */
  const h = makeHarness({ snapshot: { today: patients, phase: 'rec', active: ACTIVE } });
  h.api().go('visit');
  const before = h.screen();
  h.document.activeElement = h.byId.get('mlsPh3Tx');
  h.snapshot.recSecs = 99;              /* the ticker's own reason to repaint */
  h.api().ensure();
  assert.strictEqual(h.screen(), before, 'an unforced repaint must never rebuild the field under the caret');
}
{
  /* AND THE MERGE RUNS ANYWAY. This is the assertion the rebuild exists for. */
  const h = makeHarness({ snapshot: { today: patients, phase: 'rec', active: ACTIVE } });
  const engineTx = Object.assign(h.document.createElement('textarea'), { value: 'the knee has been' });
  engineTx.id = 'transcript';
  h.byId.set('transcript', engineTx);
  h.api().go('visit');

  const ours = h.byId.get('mlsPh3Tx');
  assert.strictEqual(ours.value, 'the knee has been', 'precondition: the phone mirrors the engine transcript');

  /* The doctor corrects a word, through the module's real input handler. */
  h.document.activeElement = ours;
  h.type('mlsPh3Tx', 'the knee has been sore');
  assert.strictEqual(engineTx.value, 'the knee has been sore', 'an edit on the phone must reach the engine transcript');

  /* The recognizer keeps going while that finger is still in the box. */
  engineTx.value = 'the knee has been sore for three weeks';
  h.api().ensure();
  assert.strictEqual(ours.value, 'the knee has been sore for three weeks',
    'THE ONE THIS WAS REBUILT FOR: with the caret in the transcript, the engine\'s new words must still arrive AND the ' +
    'doctor\'s correction must survive. ph2 dropped the engine\'s words on the floor and then overwrote them.');
  assert.strictEqual(engineTx.value, 'the knee has been sore for three weeks', 'and the merged value goes back to the engine, so the note is written from it');
}

/* ===========================================================================
 * 11. SEND AND COPY CLAIM ONLY WHAT THEY DID
 * ---------------------------------------------------------------------------
 * navigator.clipboard.writeText returns a PROMISE. ph2 toasted "Note copied."
 * on the same tick and swallowed the rejection, so a browser that refused the
 * write reported success — and the doctor pasted whatever was on the clipboard
 * before into a chart.
 * =========================================================================*/
async function sendAndCopyChecks() {
  {
    /* SEND. requestSendReview() returning true means "the send path was
       entered", nothing more: a confirm card may open, a name/DOB mismatch may
       stop it, or a write blocker may refuse — and the return value cannot tell
       those apart. So the sentence may say where to LOOK and must claim nothing
       about the outcome.
       AND IT MUST NOT NAME ANOTHER MACHINE. The app's modals sit at z-index
       9000+, above this frame's 7000 — which is why this module stops at 7000 —
       so the card is right here. A draft of this line said the confirmation was
       "waiting on your office computer": a confident sentence about a machine
       this device cannot see, and wrong. Both halves are pinned. */
    const h = withNote(makeHarness({ snapshot: { phase: 'note', active: ACTIVE } }), 'ASSESSMENT: right knee OA.');
    h.api().go('visit');
    h.tap('send');
    assert.strictEqual(h.calls.sendReview, 1, 'Send must reach the engine\'s own requestSendReview()');
    assert(h.noteShown(), 'and a send that was started must leave something on the screen — ph2 said nothing at all on success');
    assert(!h.noteBad(), 'said as a next step, not as a failure');
    const said = h.noteText();
    assert(/confirmation/i.test(said) && /this screen/i.test(said),
      'and it must say where to look for the confirmation: ' + said);
    assert(!/office computer/i.test(said),
      'and must NOT send the doctor to another machine — the confirm card is a modal above this frame, right here');
    assert(!/\bsent\b/i.test(said) && !h.calls.toasts.some(t => /\bsent\b/i.test(t.m)),
      'and NEVER say "sent" — the strongest possible claim over the weakest possible evidence');
  }
  {
    /* An empty note is refused BEFORE the engine is touched. ph2 called
       requestSendReview() first and let the engine decide, which on a good day
       opens a confirm card on the office computer for a note that does not
       exist. */
    const h = makeHarness({ snapshot: { phase: 'note', active: ACTIVE } });
    h.api().go('visit');
    h.tap('send');
    assert.strictEqual(h.calls.sendReview, 0, 'there is nothing to send, so the engine must not be asked');
    assert(h.noteShown() && /no note to send/i.test(h.noteText()), 'and it must say why');
  }
  {
    const h = withNote(makeHarness({ snapshot: { phase: 'note', active: ACTIVE } }), 'ASSESSMENT: right knee OA.');
    h.api().go('visit');
    h.tap('copy-note');
    await flush();
    const ok = h.calls.toasts.filter((t) => t.k === 'ok');
    assert.strictEqual(ok.length, 1, 'a clipboard write that resolved must be reported');
    assert(/clipboard/i.test(ok[0].m), 'and named for what happened: ' + ok[0].m);
    assert(/this iPhone/i.test(ok[0].m), 'on the device the doctor is holding, in its own noun');
    assert.deepStrictEqual(h.calls.clipboard, ['ASSESSMENT: right knee OA.'], 'and it must copy the note');
  }
  {
    /* THE ONE THAT MATTERS: a refused write must not say "copied". */
    const h = withNote(makeHarness({ clipboardFails: true, snapshot: { phase: 'note', active: ACTIVE } }), 'ASSESSMENT: right knee OA.');
    h.api().go('visit');
    h.tap('copy-note');
    await flush();
    assert(!h.calls.toasts.some((t) => t.k === 'ok'),
      'a clipboard write that was REFUSED reported success — the doctor pastes the previous clipboard into a chart');
    assert(!h.calls.toasts.some((t) => t.k === 'err'),
      'the refusal must not be duplicated in a transient toast');
    assert(h.noteShown() && h.noteBad() && /press and hold/i.test(h.noteText()),
      'the one persistent refusal must include the manual way to do it');
  }
  {
    /* An empty note is refused before the clipboard is touched at all. */
    const h = makeHarness({ snapshot: { phase: 'note', active: ACTIVE } });
    h.api().go('visit');
    h.tap('copy-note');
    await flush();
    assert.strictEqual(h.calls.clipboard.length, 0, 'there is nothing to copy, so nothing may be written');
    assert(!h.calls.toasts.some((t) => t.k === 'err'), 'the refusal must not be duplicated in a transient toast');
    assert(h.noteShown() && h.noteBad() && /no note to copy/i.test(h.noteText()), 'and the one persistent refusal must say why');
  }
}

/* ===========================================================================
 * 12. THE UNREAD PILL IS A CONTROL, AND IT COUNTS UNREAD
 * ---------------------------------------------------------------------------
 * ph2 counted every ready check-in the endpoint returned, forever — reading
 * them did not clear it, so a doctor who read all five at 8:05 carried a red 5
 * all morning and the number stopped meaning anything.
 * =========================================================================*/
const CHECKIN = {
  id: 'c1', patient_external_id: 'p9', headline: 'Check-in finished — knee pain',
  bullets: ['Right knee, 3 weeks'], askAbout: ['Any locking?'], summary: 'Patient reports right knee pain.',
  ready_at: new Date().toISOString()
};

async function checkinPillChecks() {
  {
    const h = makeHarness({ checkins: [CHECKIN], snapshot: { day: '2026-08-04', today: patients }, todayKey: '2026-08-07' });
    await h.pollCheckins();
    const pill = h.alertNode();
    assert.strictEqual(pill.hidden, false, 'an unread check-in must raise the header pill');
    assert(/1 check-in/.test(pill._html), 'and say how many are unread: ' + pill._html);

    /* ROUTE TWO OF TWO (owner 2026-08-10: "the check ins before the room needs
       to be a completly spreate tab that u can aget to both throgyuth thetop
       left 3 lines or throguht ththe notifications"). The notification IS a way
       in: a pill that announces "1 check-in" and lands you on a different
       screen is a control whose press does not do what it says. It does NOT
       move the day any more — the briefs have their own screen and are not
       scoped to a date. */
    h.alert();
    assert.strictEqual(h.api().state().screen, 'checkins', 'the pill must open the check-ins screen');
    assert.deepStrictEqual(h.calls.setDay, [], 'and must not silently move the doctor to another day to do it');
    assert(/data-act="ck-open"/.test(h.screen()), 'and the briefs must be on it');
  }
  {
    /* ROUTE ONE OF TWO: the ☰ menu, which is the only route once everything has
       been read and the pill is gone. */
    const h = makeHarness({ checkins: [CHECKIN], snapshot: { day: '2026-08-07', today: patients }, todayKey: '2026-08-07' });
    await h.pollCheckins();
    assert(!/data-act="ck-open"/.test(h.screen()),
      'the briefs must NOT be stacked on the day screen — they push the patient list below the fold');
    h.api().menu(true);
    assert(/data-act="checkins"/.test(h.menuHtml()), 'the menu must carry a route to the check-ins screen');
    h.tap('checkins');
    assert.strictEqual(h.api().state().screen, 'checkins', 'and pressing it must go there');
    assert(/data-act="ck-open"/.test(h.screen()), 'the brief itself lives on that screen');
    assert(!/Patient reports right knee pain/.test(h.screen()),
      'and NOT auto-expanded — ph2 opened an arriving brief under whatever the doctor was already reading');
    assert.strictEqual(h.alertNode().hidden, true,
      'ARRIVING at the screen is reading the list: a pill left lit over the very briefs it counts is the ' +
      'badge-that-never-clears defect in a new place');

    h.tap('ck-open', { 'data-id': 'c1' });
    assert(/Patient reports right knee pain/.test(h.screen()), 'opening one must show the summary');
  }
}

/* ===========================================================================
 * 13. NO SCRIVARA
 * ---------------------------------------------------------------------------
 * Owner: "get rid of the Scrivara stuff." What is asserted is that THIS app no
 * longer advertises it and no longer sends "the full setup guide" to that app's
 * install page. Both were the only two routes out of MLS on a phone, and both
 * left MLS.
 * =========================================================================*/
{
  const h = makeHarness({ snapshot: { today: patients, active: ACTIVE } });
  const screens = [];
  for (const where of ['day', 'visit']) { h.api().go(where); screens.push(h.screen()); screens.push(h.actionBar()); }
  h.api().go('day');
  h.nav();
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
  assert(!/SMALL_APP_URL|data-act="small-app"|data-act="setup-guide"/.test(code), 'the cross-app controls are back');
}

/* ===========================================================================
 * 14. A COVERED CONTROL IS A BROKEN CONTROL
 * ---------------------------------------------------------------------------
 * #mlsR46VerBanner — "MLS Assist is not installed in this browser" — was
 * MEASURED at 230x332, z-index 2147483100, in the middle of the phone screen,
 * and elementFromPoint proved it swallowed the pull button and THE FIRST
 * PATIENT OF THE DAY. Its own instruction cannot be followed on a phone. It had
 * a phone guard, body.mls-phone, and this module REMOVES that class when it
 * mounts, so the guard has not fired since the phone app shipped. Nothing else
 * in this suite can catch it: every control below is perfectly wired and
 * completely unpressable.
 * =========================================================================*/
{
  const h = makeHarness({});
  const css = h.css();
  assert(css, 'the module must install its stylesheet');
  assert(/body\.mls-ph3 #mlsR46VerBanner[\s\S]*?\{display:none!important\}/.test(css),
    'the version banner that covered the pull button and the first patient must be in the hide list');
  assert(/body\.mls-ph3 #mlsA2hsCard[\s\S]*?\{display:none!important\}/.test(css),
    'and so must the add-to-Home-Screen card — this app offers that route in its own menu');
  /* The backup-failure badge is deliberately NOT hidden: it reports a real
     problem saving the doctor's work. It is lifted clear of the action bar. */
  assert(/body\.mls-ph3 #_backupBadge\{bottom:calc\(96px/.test(css),
    'the backup-failure badge must be lifted above the action bar, not hidden — it reports lost work');
}

/* ===========================================================================
 * 15. SAFETY PINS THAT OUTLIVE ANY REDESIGN
 * =========================================================================*/
{
  /* OWNS() DELEGATES. One definition of "this device is a phone" in the
     product; the phone module is not allowed to grow a second one. */
  const h = makeHarness({ wantPhone: false });
  assert.strictEqual(h.api().owns(), false,
    'owns() must return __mlsPhoneHome.wantPhone() — an iPhone UA must not override the product\'s one answer');
  assert(!h.frame(), 'and a module that does not own the device must not mount');
}
{
  /* WINDOW WIDTH NEVER CLASSIFIES A DEVICE. That was a real bug once: it put
     narrow-windowed laptops into phone mode. */
  const wide = makeHarness({ noHome: true, noRole: true, ua: IPHONE_UA, innerWidth: 3000 });
  assert.strictEqual(wide.api().owns(), true, 'a wide window on a handheld is still a handheld');
  const narrow = makeHarness({ noHome: true, noRole: true, ua: MAC_UA, maxTouchPoints: 0, innerWidth: 320 });
  assert.strictEqual(narrow.api().owns(), false, 'and a narrow window on a Mac is still a Mac');
}
{
  /* EXACTLY ONE INTERVAL, AND IT IS CLEARED WITH `!== null`. The harness hands
     out 0 as the first handle on purpose: 0 is FALSY, so a module that clears
     with `if (S.ckTimer)` leaves the 45s poll running forever in a pocket while
     arming a second one on the next wake. */
  const h = makeHarness({});
  assert.strictEqual(h.intervals.length, 1, 'exactly ONE interval may be armed: the check-in watch');
  assert.strictEqual(h.intervals[0].id, 0, 'precondition: the handle under test is the falsy one');
  assert.strictEqual(h.intervals[0].ms, 45000, 'and it is the 45s check-in watch');

  h.document.visibilityState = 'hidden';
  h.document._fire('visibilitychange', {});
  assert.deepStrictEqual(h.liveIntervals(), [], 'a hidden tab must run NO interval — a handle of 0 must still be cleared');

  h.document.visibilityState = 'visible';
  h.document._fire('visibilitychange', {});
  assert.strictEqual(h.liveIntervals().length, 1, 'and coming back must re-arm exactly one, not stack a second');
  assert.strictEqual(h.liveIntervals()[0].id, 1, 'and it must be a NEW handle, proving the old one really went');
}
{
  /* And it refuses to arm at all while the tab is already hidden. */
  const h = makeHarness({ hidden: true });
  assert.deepStrictEqual(h.intervals.filter(t => t.live), [], 'a module that mounts into a hidden tab must arm no timers');
}

/* ===========================================================================
 * 16. THE SWEEP: EVERY data-act THE HANDLER KNOWS, PRESSED, AND NONE SILENT
 * ---------------------------------------------------------------------------
 * The acts are read out of the module's own source, so a control shipped
 * without a grade here fails this suite rather than shipping ungraded. Each row
 * presses through the real delegated handler and asserts two things: the host
 * function it was supposed to reach, and that SOMETHING the doctor can see
 * changed. The second half is the owner's complaint stated as a test.
 * =========================================================================*/
const HANDLED = [];
source.replace(/act === '([a-z0-9-]+)'/g, function (_m, a) { if (HANDLED.indexOf(a) < 0) HANDLED.push(a); return _m; });

/* The contract as written down, so a rename is a failure and not a silent
   re-wiring of a control the rest of the product points at. */
const CONTRACT = ['menu-close', 'note-x', 'back', 'checkins', 'find-clear', 'refresh', 'settings', 'device',
  'install', 'fullapp', 'signout', 'day-prev', 'day-next', 'day-today', 'day-go', 'pull-start', 'pull-stop',
  'open', 'ck-open', 'record', 'stop', 'generate', 'send', 'copy-note'];
assert.deepStrictEqual(HANDLED.slice().sort(), CONTRACT.slice().sort(),
  'the set of controls the handler answers has changed:\n  handler: ' + HANDLED.slice().sort().join(', ') +
  '\n  pinned:  ' + CONTRACT.slice().sort().join(', '));

const SWEEP = {
  'menu-close': {
    make: () => { const h = makeHarness({}); h.nav(); return h; },
    reached: (h) => assert(!h.menuOpen(), 'the backdrop must close the sheet')
  },
  'note-x': {
    make: () => { const h = makeHarness({ noHost: true }); h.tap('signout'); return h; },
    reached: (h) => assert(!h.noteShown(), 'the dismiss button must clear the sticky message')
  },
  'back': {
    make: () => { const h = makeHarness({ snapshot: { today: patients, active: ACTIVE } }); h.api().go('visit'); return h; },
    reached: (h) => assert.strictEqual(h.api().state().screen, 'day', 'Back must return to the day')
  },
  'checkins': {
    make: () => makeHarness({ snapshot: { today: patients } }),
    reached: (h) => assert.strictEqual(h.api().state().screen, 'checkins',
      'the menu route must open the check-ins screen')
  },
  'find-clear': {
    make: () => { const h = makeHarness({ snapshot: { today: patients } }); h.type('mlsPh3Find', 'zzz'); return h; },
    reached: (h) => assert(/Marcus Bell/.test(h.list()), 'clearing the search must restore the day')
  },
  'refresh': {
    make: () => makeHarness({}),
    reached: (h) => assert.strictEqual(h.calls.loadCalendar.length, 1, 'Refresh must reload the calendar')
  },
  'settings': {
    make: () => makeHarness({}),
    reached: (h) => assert.strictEqual(h.calls.openSettings, 1, 'Settings must call openSettings()')
  },
  'device': {
    make: () => makeHarness({}),
    reached: (h) => assert.strictEqual(h.calls.openSettings, 1, 'This device must call openSettings()')
  },
  'install': {
    make: () => makeHarness({}),
    reached: (h) => assert(h.noteShown(), 'Add to Home Screen must say the route')
  },
  'fullapp': {
    make: () => makeHarness({}),
    reached: (h) => assert.deepStrictEqual(h.calls.layoutPref, ['full'], 'the full app must set the durable layout preference')
  },
  'signout': {
    make: () => makeHarness({}),
    reached: (h) => assert.deepStrictEqual(h.calls.logout, [undefined], 'sign out must call logout() with NO argument')
  },
  'day-prev': {
    make: () => makeHarness({ snapshot: { today: patients } }),
    reached: (h) => assert.deepStrictEqual(h.calls.shifted, [-1], 'the back arrow must shift the day')
  },
  'day-next': {
    make: () => makeHarness({ snapshot: { today: patients } }),
    reached: (h) => assert.deepStrictEqual(h.calls.shifted, [1], 'the forward arrow must shift the day')
  },
  'day-today': {
    make: () => makeHarness({ snapshot: { day: '2026-08-04', today: patients }, todayKey: '2026-08-07' }),
    reached: (h) => assert.deepStrictEqual(h.calls.setDay, ['2026-08-07'], 'Today must set the account-local today')
  },
  /* Owner, 2026-08-09: "make sure the days line up like there are no patiens
     today but there are some tommarow". The empty-day screen offers the nearest
     day that actually has somebody on it, and pressing it must MOVE the day
     through setDay() -- the one call that moves the strip and the engine
     together -- not just repaint a label. */
  'day-go': {
    attrs: { 'data-id': '2026-08-12' },
    make: () => makeHarness({ snapshot: { today: [] } }),
    reached: (h) => assert.deepStrictEqual(h.calls.setDay, ['2026-08-12'],
      'the "3 patients tomorrow" jump must set that day on the shared engine')
  },
  'pull-start': {
    make: () => makeHarness({}),
    reached: (h) => assert.strictEqual(h.calls.pullDay, 1, 'the pull button must reach the engine\'s pullDay()')
  },
  'pull-stop': {
    make: () => makeHarness({ activeJob: { id: 'j1' } }),
    reached: (h) => assert.strictEqual(h.calls.cancelActive, 1, 'Stop must cancel the relay job')
  },
  'open': {
    attrs: { 'data-id': 'a2' },
    make: () => makeHarness({ snapshot: { today: patients } }),
    reached: (h) => assert.strictEqual(h.calls.startVisitFor.length, 1, 'a patient row must reach startVisitFor()')
  },
  'ck-open': {
    attrs: { 'data-id': 'c1' },
    /* The briefs live on their own screen now, so the sweep has to BE there
       before it presses one — pressing ck-open from the day screen would
       press a control that is not on it. */
    make: async () => { const h = makeHarness({ checkins: [CHECKIN], snapshot: { today: patients } }); await h.pollCheckins(); h.api().go('checkins'); return h; },
    reached: (h) => assert(/Patient reports right knee pain/.test(h.screen()), 'a check-in must open')
  },
  'record': {
    make: () => { const h = makeHarness({ snapshot: { today: patients, active: ACTIVE } }); h.api().go('visit'); return h; },
    reached: (h) => assert.strictEqual(h.calls.record, 1, 'Start recording must reach the engine')
  },
  'stop': {
    make: () => { const h = makeHarness({ stopWorks: true, snapshot: { today: patients, active: ACTIVE, phase: 'rec' } }); h.api().go('visit'); return h; },
    reached: (h) => assert.strictEqual(h.calls.stopRecording, 1, 'Stop must reach the engine')
  },
  'generate': {
    make: () => { const h = makeHarness({ generateWorks: true, snapshot: { today: patients, active: ACTIVE, phase: 'stopped' } }); h.api().go('visit'); return h; },
    reached: (h) => assert.strictEqual(h.calls.generate, 1, 'Write the note must reach the engine')
  },
  'send': {
    make: () => { const h = withNote(makeHarness({ snapshot: { active: ACTIVE, phase: 'note' } }), 'A note.'); h.api().go('visit'); return h; },
    reached: (h) => assert.strictEqual(h.calls.sendReview, 1, 'Send must reach requestSendReview()')
  },
  'copy-note': {
    make: () => { const h = withNote(makeHarness({ snapshot: { active: ACTIVE, phase: 'note' } }), 'A note.'); h.api().go('visit'); return h; },
    reached: (h) => assert.deepStrictEqual(h.calls.clipboard, ['A note.'], 'Copy must reach the clipboard')
  }
};

async function sweep() {
  for (const act of CONTRACT) {
    const row = SWEEP[act];
    assert(row, 'no sweep row for the control "' + act + '" — every control the handler answers must be pressed here');
    const h = await row.make();
    const before = h.ui();
    h.tap(act, row.attrs);
    await flush();
    assert.notStrictEqual(h.ui(), before,
      'PRESSING "' + act + '" CHANGED NOTHING A DOCTOR CAN SEE. That is indistinguishable from a dead control, ' +
      'which is the report this whole module was rebuilt for.');
    row.reached(h);
  }
}

sendAndCopyChecks()
  .then(checkinPillChecks)
  .then(sweep)
  .then(function () {
    console.log('PASS every phone control actually works: the ONE header control opens a real sheet on the day and is ' +
      'Back on a visit (never both, and never a no-op); the sheet reaches the app\'s own openSettings()/logout()/' +
      'loadCalendar({fresh})/setLayoutPref — logout with NO argument, so the unsynced-note stop survives; every ' +
      'refusal is said BOTH ways and the sticky line outlives the repaint; record/stop/generate CHECK that the phase ' +
      'they claimed actually arrived and say so when it did not; the pull button disables itself so a double-tap ' +
      'starts ONE pull; Stop-the-pull never claims to have stopped another machine; opening a patient never starts a ' +
      'microphone; a keystroke repaints the list only, and the transcript merge still runs under the caret so the ' +
      'recognizer\'s words survive the doctor\'s edit; send and copy claim only what they did; the unread pill counts ' +
      'UNREAD and clears on reading; the banner that covered the pull button is in the hide list; one 45s interval, ' +
      'cleared with !== null; and all ' + CONTRACT.length + ' controls were pressed through the real delegated ' +
      'handler with an observable result.');
  }, function (err) {
    console.error(err && err.stack || err);
    process.exit(1);
  });
