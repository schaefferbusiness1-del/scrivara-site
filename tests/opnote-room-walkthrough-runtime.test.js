'use strict';
/* =========================================================================
   THE OP-NOTE ROOM, WALKED END TO END BY EXECUTION
   -------------------------------------------------------------------------
   OWNER (2026-07-29): "test the eentre op notes thing making srue eferything
   still wroks".

   WHAT THIS IS. feat_mls_opnote_room.js is the whole op-note workroom: the
   patient rail, the template rail, the follow-mode control, the Prev/Next
   pager, arrow-key patient navigation, the Procedures/Templates tabs, the
   context receipt, the render wrap and a revert path. Its siblings check
   SHAPE (opnote-room-stage2/stage3/remake-contract read the source text) or
   ONE control (opnote-template-rail-is-clickable executes the rail). Nothing
   in the suite has ever pressed every control in the room and watched what
   changed. A control that renders and does nothing passes every text check
   in this repo - the template rail shipped exactly that way at b796.

   HOW IT CHECKS. It LOADS the real module with new Function(window, document,
   ...) over a stub DOM that is rich enough to be honest:
     - innerHTML is PARSED into persistent nodes, so a classList write made by
       markNav() on a rail item is still readable on the next assertion. A
       stub that hands back a freshly minted object per querySelectorAll makes
       every "the selection moved" assertion vacuous.
     - events BUBBLE (fire() walks parentNode calling on<type>), because every
       handler in this module is delegated onto a container. Calling
       rail.onclick() with a hand-built target proves the handler exists; it
       does not prove a real click on the button inside it can reach it.
     - window.addEventListener/removeEventListener are a real registry, so
       "revert detaches its handlers" is countable rather than asserted.

   The room is marked OPEN (#opPrepModal.show) BEFORE the module runs, so the
   rails are built by the module's own boot path (feat_mls_opnote_room.js:859)
   rather than by a test-only rebuild() call.

   NON-VACUITY. Nine behaviours were disabled one at a time in a SCRATCH copy
   of the module (never the shipped file) and the matching assertions were
   watched to fail: the nav binding, the rail binding, the arrow-key listener,
   the clamp in oprSelect, wireProcTab, the tplManual write on an
   already-applied template, the edited-draft arm, the mode read-back, and the
   onf tick in the render wrap. Counts recorded in the commit message.

   WHAT IT ALREADY CAUGHT. revert() detached rail.onclick and nav.onclick but
   never cleared rail.onkeydown (installed in buildTplRail), so a reverted
   module left a live key handler - and its whole closure - on #oprTplRail,
   a node it no longer owned. Fixed at feat_mls_opnote_room.js:941; the
   assertion below is what holds it.

   AND WHAT THE STUB TAUGHT. Three revert assertions failed first against a
   module that was correct: the stub's getElementById kept answering with
   detached nodes because its id map was never pruned on removeChild. The
   instrument lies first - deregister() at the top of this file is that fix.
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROOM_FILE = path.join(ROOT, 'feat_mls_opnote_room.js');
const ROOM_SRC = fs.readFileSync(ROOM_FILE, 'utf8');

let failures = 0;
const failed = [];
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++; failed.push(label);
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function head(t) { console.log('\n' + t); }

/* ========================================================================
   A STUB DOM THAT KEEPS ITS NODES
   ==================================================================== */
const VOIDTAG = { br: 1, hr: 1, img: 1, input: 1, meta: 1, link: 1 };

function makeDom() {
  const nodes = new Map();
  const events = [];

  function mk(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '', _html: '', _text: '', children: [], parentNode: null,
      style: {}, _attrs: {}, _listeners: {}, value: '',
      classList: {
        _s: new Set(),
        add(c) { if (c) this._s.add(c); },
        remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
        toggle(c, f) {
          if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
          else if (f) this._s.add(c); else this._s.delete(c);
        },
        get _list() { return Array.from(this._s); }
      },
      setAttribute(k, v) {
        this._attrs[k] = String(v);
        if (k === 'class') { this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); }
        if (k === 'id') { this.id = String(v); nodes.set(String(v), this); }
      },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
      removeAttribute(k) { delete this._attrs[k]; },
      appendChild(c) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this; this.children.push(c);
        if (c.id) nodes.set(c.id, c);
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        const i = ref ? this.children.indexOf(ref) : -1;
        this.children.splice(i < 0 ? this.children.length : i, 0, c);
        if (c.id) nodes.set(c.id, c);
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        c.parentNode = null;
        /* THE INSTRUMENT LIES FIRST. Without this, getElementById kept answering
           with detached nodes and three revert() assertions FAILED against a
           module that had removed them correctly - a stub bug that reads exactly
           like a product bug. A removed subtree is unreachable by id, so the id
           map has to be pruned (appendChild/insertBefore re-register). */
        deregister(c);
        return c;
      },
      querySelectorAll(sel) { const out = []; collect(this, sel, out); return out; },
      querySelector(sel) { const out = []; collect(this, sel, out, true); return out[0] || null; },
      closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parentNode; } return null; },
      matches(sel) { return matches(this, sel); },
      scrollIntoView() { this._scrolled = (this._scrolled || 0) + 1; },
      dispatchEvent(e) {
        events.push({ id: this.id, tag: this.tagName, type: e && e.type });
        const h = this._listeners[e && e.type];
        if (h) h.slice().forEach(f => { try { f(e); } catch (x) {} });
        return true;
      },
      addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
      removeEventListener(t, f) {
        const a = this._listeners[t] || [];
        const i = a.indexOf(f); if (i >= 0) a.splice(i, 1);
      },
      focus() { this._focused = true; }
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html; },
      set(v) { el._html = String(v); parseInto(el, el._html, mk); }
    });
    Object.defineProperty(el, 'textContent', {
      get() { return textOf(el); },
      set(v) { el.children.length = 0; el._html = ''; el._text = String(v); }
    });
    Object.defineProperty(el, 'parentElement', { get() { return el.parentNode; } });
    Object.defineProperty(el, 'nextSibling', {
      get() {
        if (!el.parentNode) return null;
        const i = el.parentNode.children.indexOf(el);
        return (i >= 0 && el.parentNode.children[i + 1]) ? el.parentNode.children[i + 1] : null;
      }
    });
    return el;
  }

  function deregister(n) {
    if (!n) return;
    if (n.id && nodes.get(n.id) === n) nodes.delete(n.id);
    for (const c of n.children) deregister(c);
  }

  function textOf(n) {
    if (!n) return '';
    if (n.tagName === '#TEXT') return n._text;
    let s = n._text || '';
    for (const c of n.children) s += textOf(c);
    return s;
  }

  /* ---- selector engine: .class  #id  [attr]  [attr="v"]  tag ---- */
  function matches(n, sel) {
    if (!n || !sel || n.tagName === '#TEXT') return false;
    sel = String(sel).trim();
    let m;
    if ((m = /^\.([-\w]+)$/.exec(sel))) return n.classList.contains(m[1]);
    if ((m = /^#([-\w]+)$/.exec(sel))) return n.id === m[1];
    if ((m = /^\[([-\w]+)\]$/.exec(sel))) return n.getAttribute(m[1]) !== null;
    if ((m = /^\[([-\w]+)="([^"]*)"\]$/.exec(sel))) return n.getAttribute(m[1]) === m[2];
    if ((m = /^([a-zA-Z][\w]*)$/.exec(sel))) return n.tagName === m[1].toUpperCase();
    throw new Error('stub selector engine cannot parse: ' + sel);
  }
  function collect(root, sel, out, firstOnly) {
    for (const c of root.children) {
      if (matches(c, sel)) { out.push(c); if (firstOnly) return; }
      collect(c, sel, out, firstOnly);
      if (firstOnly && out.length) return;
    }
  }

  /* ---- a small, honest HTML parser for the markup THIS module emits ---- */
  function parseInto(el, html, mkFn) {
    el.children.length = 0; el._text = '';
    const stack = [el];
    const tagRe = /<(\/?)([a-zA-Z][\w]*)((?:\s+[a-zA-Z][-\w]*(?:="[^"]*")?)*)\s*(\/?)>/g;
    let last = 0, m;
    function addText(parent, s) {
      if (!s) return;
      const t = mkFn('#text'); t._text = s; parent.appendChild(t);
    }
    while ((m = tagRe.exec(html))) {
      if (m.index > last) addText(stack[stack.length - 1], html.slice(last, m.index));
      last = tagRe.lastIndex;
      const closing = m[1] === '/', tag = m[2], attrs = m[3] || '', self = m[4] === '/';
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const node = mkFn(tag);
      const aRe = /([a-zA-Z][-\w]*)(?:="([^"]*)")?/g;
      let a;
      while ((a = aRe.exec(attrs))) {
        if (!a[1]) continue;
        node.setAttribute(a[1], a[2] === undefined ? '' : a[2]);
      }
      stack[stack.length - 1].appendChild(node);
      if (!self && !VOIDTAG[tag.toLowerCase()]) stack.push(node);
    }
    if (last < html.length) addText(stack[stack.length - 1], html.slice(last));
  }

  const doc = {
    _nodes: nodes, _events: events,
    createElement: mk,
    createTextNode(t) { const n = mk('#text'); n._text = String(t); return n; },
    getElementById(id) { return nodes.get(id) || null; },
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
    getAnimations() { return []; }
  };
  doc.body = mk('body'); doc.head = mk('head'); doc.documentElement = mk('html');
  doc.querySelectorAll = (s) => doc.body.querySelectorAll(s);
  doc.querySelector = (s) => doc.body.querySelector(s);
  doc._mk = mk;
  return doc;
}

/* Build the room's real node graph: the ids and the parent/child relations the
   module actually reads (feat_mls_opnote_room.js:561 needs #oprTplRail to be a
   child of #oprDayRail, :672 needs #oprReceipt to be a child of #oprEditor). */
function buildRoomDom(nRows) {
  const doc = makeDom();
  const mk = doc._mk;
  function div(id, parent) { const n = mk('div'); if (id) n.setAttribute('id', id); (parent || doc.body).appendChild(n); return n; }

  const modal = div('opPrepModal');
  modal.classList.add('modal-bg');
  const top = div('oprTop', modal);
  div('oprTabProcs', top); div('oprTabTpls', top);
  const panelProcs = div('oprPanelProcs', modal);
  const dayRail = div('oprDayRail', panelProcs);
  div('opPrepModeRow', dayRail); div('opPrepDayRow', dayRail);
  div('oprRowNav', dayRail);
  div('oprTplRail', dayRail);
  const editor = div('oprEditor', panelProcs);
  div('oprReceipt', editor);
  const list = div('opPrepList', editor);
  const genAll = mk('button'); genAll.setAttribute('id', 'opPrepGenAllBtn'); editor.appendChild(genAll);
  div('oprPanelTpls', modal);
  div('templatesModal');                      /* floating home, outside the room */
  div('opPrepStatus', modal);

  const cards = [];
  for (let i = 0; i < nRows; i++) {
    const card = mk('div'); list.appendChild(card);
    const prev = mk('div'); prev.setAttribute('id', 'opPrepPrev_' + i); card.appendChild(prev);
    const wrapSpan = mk('span'); wrapSpan.classList.add('mini'); card.appendChild(wrapSpan);
    const sel = mk('select'); sel.setAttribute('id', 'opPrepTpl_' + i); sel.value = ''; card.appendChild(sel);
    const ta = mk('textarea'); ta.setAttribute('id', 'opPrepNote_' + i); card.appendChild(ta);
    cards.push({ card, prev, sel, ta });
  }
  return { doc, cards, list, editor, dayRail, modal };
}

const TPLS = [
  { id: 'tpl-a', name: 'Left L4-L5 transforaminal epidural steroid injection', text: 'A'.repeat(800) },
  { id: 'tpl-b', name: 'Left L5-S1 transforaminal epidural steroid injection', text: 'B'.repeat(800) },
  { id: 'tpl-c', name: 'Right knee arthroscopy', text: 'C'.repeat(800) }
];

/* Three synthetic rows covering three different rail statuses. Names are
   invented ASCII initials - no real roster is touched by this file. */
function freshRows() {
  return [
    { appt: { name: 'AA BB' }, patientId: 'p-1', proc: 'esi l4', tplId: 'tpl-a', tplManual: false, gen: false, note: '', edited: false },
    { appt: { name: 'CC DD' }, patientId: 'p-2', proc: 'knee scope', tplId: '', tplManual: false, gen: false, note: '', edited: false },
    { appt: { name: 'EE FF' }, patientId: 'p-3', proc: 'esi l5', tplId: 'tpl-b', tplManual: false, gen: true, note: 'body [  ] and [  ]', edited: false }
  ];
}

/* ========================================================================
   RUN THE REAL MODULE
   ==================================================================== */
function runRoom(opts) {
  opts = opts || {};
  const rows = opts.rows || freshRows();
  const built = buildRoomDom(rows.length);
  const doc = built.doc;
  const toasts = [];
  const calls = { render: 0, onfTick: 0, badges: 0, openTemplates: 0, closeTemplates: 0, openOpPrep: 0, renderTplDetail: 0, renderTemplateList: 0 };
  const store = {};

  const winListeners = {};
  const win = {
    document: doc,
    _opPrep: rows,
    _tplUI: { selectedId: '', dirty: false },
    getTemplates: () => (opts.templates === undefined ? TPLS : opts.templates),
    opNoteBlankTokens: (s) => (String(s || '').match(/\[\s*\]/g) || []),
    toast: (m, k) => toasts.push({ m: String(m), k: String(k == null ? '' : k) }),
    uns: (s) => 'sf_u::t@t::' + s,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    opPrepRender: function () { calls.render++; return 'base-render'; },
    opPrepRenderBadges: function () { calls.badges++; },
    openTemplates: function () { calls.openTemplates++; doc.getElementById('templatesModal').classList.add('show'); },
    closeTemplates: function () { calls.closeTemplates++; doc.getElementById('templatesModal').classList.remove('show'); },
    openOpPrep: function () { calls.openOpPrep++; doc.getElementById('opPrepModal').classList.add('show'); },
    openOpPrepForPatient: function () {},
    openOpPrepSmart: function () { doc.getElementById('opPrepModal').classList.add('show'); },
    renderTemplateList: function () { calls.renderTemplateList++; },
    renderTplDetail: function () { calls.renderTplDetail++; },
    __mlsOpNoteFill: { installed: true, tick: function () { calls.onfTick++; }, _verifiedHistoryVisits: () => [{}, {}] },
    __mlsTplPrepFix: { healthOf: (t) => ({ cls: 'ready', label: 'ready to use' }) },
    confirm: () => { throw new Error('confirm() must never be called by the room'); },
    setTimeout: (f) => 0, clearTimeout: () => {},
    requestIdleCallback: (f) => { try { f(); } catch (e) {} },
    Event: function (t, o) { this.type = t; this.bubbles = !!(o && o.bubbles); },
    _winListeners: winListeners,
    addEventListener(t, f, c) { (winListeners[t] = winListeners[t] || []).push({ f: f, c: !!c }); },
    removeEventListener(t, f, c) {
      const a = winListeners[t] || [];
      for (let i = 0; i < a.length; i++) { if (a[i].f === f && a[i].c === !!c) { a.splice(i, 1); return; } }
    }
  };
  win.window = win; win.self = win;
  if (opts.resolvePatient !== false) win._opResolvePatient = () => ({ id: 'chart-1' });

  /* THE ROOM IS OPEN before the module lands - the module only builds rails
     when #opPrepModal carries .show (feat_mls_opnote_room.js:859). */
  if (opts.open !== false) doc.getElementById('opPrepModal').classList.add('show');

  const res = { doc, win, toasts, calls, rows, cards: built.cards, store, winListeners, err: null, err2: null };
  res.load = function () {
    try {
      new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout', 'Event', 'confirm', ROOM_SRC)(
        win, doc, win.localStorage, win.setTimeout, win.clearTimeout, win.Event, win.confirm);
      return null;
    } catch (e) { return String((e && e.message) || e); }
  };
  res.err = res.load();
  res.api = win.__mlsOpNoteRoom;
  return res;
}

/* Events BUBBLE. Every handler in this module is delegated onto a container,
   so a click on the button inside it must reach the container by walking
   parentNode - exactly what a browser does, and the only way to prove the
   delegation selector matches the node a doctor actually presses. */
function fire(node, type, extra) {
  const ev = Object.assign({
    type: type, target: node, defaultPrevented: false, _stop: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stop = true; },
    stopImmediatePropagation() { this._stop = true; }
  }, extra || {});
  let n = node;
  while (n) {
    const h = n['on' + type];
    if (typeof h === 'function') { h.call(n, ev); if (ev._stop) break; }
    n = n.parentNode;
  }
  return ev;
}
/* window-level keydown, capture listeners first, like the real dispatch order */
function fireWinKey(res, key, targetTag) {
  const t = { tagName: String(targetTag || 'BODY'), isContentEditable: false };
  const ev = {
    type: 'keydown', key: key, target: t, defaultPrevented: false, _stop: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stop = true; },
    stopImmediatePropagation() { this._stop = true; }
  };
  const all = (res.winListeners.keydown || []).slice().sort((a, b) => (b.c ? 1 : 0) - (a.c ? 1 : 0));
  for (const l of all) { l.f(ev); if (ev._stop) break; }
  return ev;
}

/* observable selection: the pager position line is the module's own answer to
   "which patient am I on" (feat_mls_opnote_room.js:678) */
function posText(res) {
  const p = res.doc.getElementById('oprPager');
  const s = p && p.querySelector('.opr-pos');
  return s ? s.textContent : '(no pager)';
}
function navOn(res) {
  const nav = res.doc.getElementById('oprRowNav');
  const items = nav ? nav.querySelectorAll('.opr-nav-item') : [];
  for (let i = 0; i < items.length; i++) if (items[i].classList.contains('on')) return +items[i].getAttribute('data-i');
  return -1;
}
function curCardIdx(res) {
  for (let i = 0; i < res.cards.length; i++) if (res.cards[i].card.classList.contains('opr-cur')) return i;
  return -1;
}
function navItem(res, i) { return res.doc.getElementById('oprRowNav').querySelector('[data-i="' + i + '"]'); }
function tplItem(res, id) { return res.doc.getElementById('oprTplRail').querySelector('[data-tpl-id="' + id + '"]'); }
function stText(node) { const s = node && node.querySelector('.opr-nav-st'); return s ? s.textContent : ''; }

/* ======================================================================
   1. THE MODULE LOADS AND THE RAILS BUILD ON ITS OWN BOOT PATH
   ================================================================== */
head('1. install + rails');
const R = runRoom();
ok(!R.err, 'the room module loads and runs against the stub DOM', R.err);
ok(!!R.api && R.api.installed === true, 'it exposes window.__mlsOpNoteRoom, installed',
  'api: ' + JSON.stringify(R.api && { v: R.api.version, i: R.api.installed }));
ok(!!R.doc.getElementById('oprSkin'),
  'the room skin stylesheet is installed (feat_mls_opnote_room.js:92)');

const nav = R.doc.getElementById('oprRowNav');
const navItems = nav.querySelectorAll('.opr-nav-item');
ok(navItems.length === 3,
  'PATIENT RAIL: one .opr-nav-item per row, built by the module boot (no test-only rebuild)',
  'found ' + navItems.length + ' items for 3 rows');
ok(/Patients — 3/.test(nav.innerHTML), 'the rail counts the patients in words');
const states = navItems.map(stText);
ok(states.every(s => s && s.length > 2),
  'every patient row carries a STATUS WORD, not only a coloured dot',
  'states: ' + JSON.stringify(states));
ok(states[0] === 'not drafted yet' && states[1] === 'needs a template' && /2 blanks to fill/.test(states[2]),
  'the three distinct row states are each named correctly (not drafted / needs a template / N blanks)',
  'states: ' + JSON.stringify(states));

const rail = R.doc.getElementById('oprTplRail');
const tplBtns = rail.querySelectorAll('.opr-tpl-item');
ok(tplBtns.length === 3, 'TEMPLATE RAIL: one button per template',
  'found ' + tplBtns.length + ' of 3');
ok(tplBtns.every(b => b.tagName === 'BUTTON'), 'each rail item is a real <button>');
ok(tplBtns.filter(b => b.getAttribute('aria-pressed') === 'true').length === 1,
  'exactly one template is marked in use for the selected row');
ok(rail.querySelectorAll('[data-tpl-edit]').length === 3,
  'each template offers an Edit affordance');

const modeBox = R.doc.getElementById('oprTplMode');
ok(!!modeBox, 'FOLLOW-MODE control exists (#oprTplMode, created by the module)');
const modeBtns = modeBox ? modeBox.querySelectorAll('[data-tplmode]') : [];
ok(modeBtns.length === 3, 'it offers exactly three options',
  'found ' + modeBtns.length);
ok(modeBtns.map(b => b.getAttribute('data-tplmode')).join(',') === 'strict,adapt,guide',
  'the three options are strict / adapt / guide',
  modeBtns.map(b => b.getAttribute('data-tplmode')).join(','));
ok(modeBtns.filter(b => b.getAttribute('aria-pressed') === 'true').length === 1,
  'exactly one mode reads as active');

const rec = R.doc.getElementById('oprReceipt');
ok(/^Context for AA/.test(rec.textContent) && /verified visit/.test(rec.textContent),
  'RECEIPT names the context that will ground the draft for the selected patient',
  'receipt: ' + rec.textContent);
ok(rec.style.display === '', 'and it is shown');

const pager = R.doc.getElementById('oprPager');
ok(!!pager, 'PAGER is built for a multi-row day');
ok(posText(R) === 'Patient 1 of 3', 'the pager says where he is', posText(R));
ok(R.doc.getElementById('opPrepList').classList.contains('opr-solo'),
  'all-day mode shows ONE card at a time (.opr-solo on #opPrepList)');

/* ======================================================================
   2. CLICKING A PATIENT IN THE RAIL SELECTS THAT ROW
   ================================================================== */
head('2. patient nav click');
fire(navItem(R, 2), 'click');
ok(navOn(R) === 2, 'clicking a .opr-nav-item marks THAT row current in the rail',
  'rail "on" index is ' + navOn(R));
ok(curCardIdx(R) === 2, '.opr-cur moves to that row card', 'opr-cur is on card ' + curCardIdx(R));
ok(posText(R) === 'Patient 3 of 3', 'and the pager position follows', posText(R));
ok(/^Context for EE/.test(R.doc.getElementById('oprReceipt').textContent),
  'the receipt re-targets to the newly selected patient',
  R.doc.getElementById('oprReceipt').textContent);
ok(R.cards[2].card._scrolled > 0, 'the selected card is scrolled into view');

fire(navItem(R, 0), 'click');
ok(navOn(R) === 0 && curCardIdx(R) === 0, 'clicking a different patient moves it back',
  'on=' + navOn(R) + ' cur=' + curCardIdx(R));
ok(R.doc.getElementById('opPrepList').querySelectorAll('.opr-cur').length === 1,
  'exactly ONE card is current at any moment (the old .opr-cur is removed)');

/* ======================================================================
   3. THE PAGER MOVES AND CLAMPS
   ================================================================== */
head('3. pager');
const nextBtn = () => R.doc.getElementById('oprPager').querySelector('[data-opr-nav="next"]');
const prevBtn = () => R.doc.getElementById('oprPager').querySelector('[data-opr-nav="prev"]');
ok(prevBtn().disabled === true, 'at the first patient Prev is disabled', 'disabled=' + prevBtn().disabled);
ok(nextBtn().disabled === false, 'and Next is live');
fire(nextBtn(), 'click');
ok(posText(R) === 'Patient 2 of 3' && navOn(R) === 1, 'Next advances one patient', posText(R));
fire(nextBtn(), 'click');
ok(posText(R) === 'Patient 3 of 3' && navOn(R) === 2, 'Next advances again', posText(R));
ok(nextBtn().disabled === true, 'at the last patient Next is disabled');
fire(nextBtn(), 'click');            /* forced past the end - a browser would not, we do */
ok(posText(R) === 'Patient 3 of 3', 'a forced Next at the end CLAMPS instead of running off', posText(R));
fire(prevBtn(), 'click'); fire(prevBtn(), 'click');
ok(posText(R) === 'Patient 1 of 3' && navOn(R) === 0, 'Prev walks back to the first patient', posText(R));
fire(prevBtn(), 'click');
ok(posText(R) === 'Patient 1 of 3' && curCardIdx(R) === 0,
  'a forced Prev at the start CLAMPS', posText(R));

/* ======================================================================
   4. ARROW KEYS MOVE THE SELECTION (and keep out of text fields)
   ================================================================== */
head('4. arrow-key navigation');
ok((R.winListeners.keydown || []).length === 2,
  'the module binds TWO window keydown handlers (Esc ownership + arrow nav)',
  'bound: ' + (R.winListeners.keydown || []).length);
const kd = fireWinKey(R, 'ArrowDown');
ok(posText(R) === 'Patient 2 of 3', 'ArrowDown moves to the next patient', posText(R));
ok(kd.defaultPrevented === true, 'and the key is consumed so the page does not also scroll');
fireWinKey(R, 'ArrowRight');
ok(posText(R) === 'Patient 3 of 3', 'ArrowRight moves forward too', posText(R));
fireWinKey(R, 'ArrowDown');
ok(posText(R) === 'Patient 3 of 3', 'at the end ArrowDown does nothing (no wrap, no crash)', posText(R));
fireWinKey(R, 'ArrowUp');
ok(posText(R) === 'Patient 2 of 3', 'ArrowUp moves back', posText(R));
fireWinKey(R, 'ArrowUp', 'TEXTAREA');
ok(posText(R) === 'Patient 2 of 3',
  'an arrow key inside a TEXTAREA is IGNORED - typing in a note never jumps patient',
  posText(R));
fireWinKey(R, 'ArrowUp', 'INPUT');
ok(posText(R) === 'Patient 2 of 3', 'same inside an INPUT (a Fields-box value)', posText(R));
fireWinKey(R, 'ArrowLeft');
ok(posText(R) === 'Patient 1 of 3', 'ArrowLeft moves back to the first patient', posText(R));

/* ======================================================================
   5. THE PROCEDURES TAB, THE TEMPLATES TAB, THE EDIT AFFORDANCE, AND ESC
   ================================================================== */
head('5. tabs / Edit / Esc');
const tabProcs = R.doc.getElementById('oprTabProcs');
ok(typeof tabProcs.onclick === 'function',
  'PROCEDURES TAB has a click handler after install (it was a dead control before b797)',
  'onclick is ' + typeof tabProcs.onclick);

/* drive the Edit affordance on a template - a real click on the inner span */
const editSpan = tplItem(R, 'tpl-b').querySelector('[data-tpl-edit]');
fire(editSpan, 'click');
ok(R.win._tplUI.selectedId === 'tpl-b',
  'clicking Edit on a rail item selects THAT template for editing',
  'selectedId=' + R.win._tplUI.selectedId);
ok(R.calls.openTemplates >= 1, 'and it opens the Templates surface');
ok(R.doc.getElementById('templatesModal').parentElement === R.doc.getElementById('oprPanelTpls'),
  'the Templates modal is embedded in the room panel rather than floating over it');
ok(R.doc.getElementById('oprPanelTpls').classList.contains('on'),
  'the Templates tab is fronted');
ok(R.doc.getElementById('oprPanelProcs').style.display === 'none',
  'and the Procedures panel is hidden while it is open');

/* Esc on the Templates tab must close TEMPLATES and keep the room */
const escEv = fireWinKey(R, 'Escape');
ok(!R.doc.getElementById('templatesModal').classList.contains('show'),
  'ESC on the Templates tab closes Templates');
ok(R.doc.getElementById('opPrepModal').classList.contains('show'),
  'and the ROOM survives that Esc (the room-closing handler is stopped)');
ok(escEv._stop === true, 'the event is stopped so the pinned room-closer never sees it');
ok(R.doc.getElementById('oprPanelProcs').style.display === '',
  'closing Templates returns to Procedures');

/* now the Procedures tab itself, from the Templates tab */
fire(editSpan, 'click');                      /* back onto Templates */
ok(R.doc.getElementById('oprPanelTpls').classList.contains('on'), 'reopened Templates');
fire(tabProcs, 'click');
ok(!R.doc.getElementById('oprPanelTpls').classList.contains('on') &&
   R.doc.getElementById('oprPanelProcs').style.display === '',
  'PRESSING PROCEDURES RETURNS TO THE PROCEDURE LIST',
  'panelTpls.on=' + R.doc.getElementById('oprPanelTpls').classList.contains('on'));
ok(!R.doc.getElementById('templatesModal').classList.contains('show'),
  'and it closes the Templates modal on the way out');
ok(tabProcs.getAttribute('aria-selected') === 'true' &&
   R.doc.getElementById('oprTabTpls').getAttribute('aria-selected') === 'false',
  'the tabs report their state to a screen reader');

/* the Edit affordance answers the keyboard */
const R5 = runRoom();
const kEdit = fire(R5.doc.getElementById('oprTplRail').querySelector('[data-tpl-edit]'), 'keydown', { key: 'Enter' });
ok(R5.win._tplUI.selectedId === 'tpl-a' && kEdit.defaultPrevented === true,
  'Enter on the Edit affordance opens that template (it is a span[role=button][tabindex=0])',
  'selectedId=' + R5.win._tplUI.selectedId);

/* ======================================================================
   6. THE TEMPLATE RAIL APPLIES TEMPLATES
   ================================================================== */
head('6. template rail');
const R6 = runRoom();
fire(tplItem(R6, 'tpl-c'), 'click');
ok(R6.rows[0].tplId === 'tpl-c',
  'clicking a template APPLIES it to the row on screen',
  'row.tplId=' + R6.rows[0].tplId);
ok(R6.rows[0].tplManual === true, 'and records it as the doctor pick, not an auto-match');
ok(R6.cards[0].sel.value === 'tpl-c',
  'it drives the EXISTING select#opPrepTpl_0 rather than a second write path',
  'select value=' + R6.cards[0].sel.value);
ok(R6.doc._events.some(e => e.id === 'opPrepTpl_0' && e.type === 'change'),
  'a real change event is dispatched so every satellite on that select still runs');
ok(R6.toasts.some(t => /Template set to/.test(t.m)), 'the doctor is told what happened');
ok(tplItem(R6, 'tpl-c').getAttribute('aria-pressed') === 'true' &&
   /in use for this procedure/.test(tplItem(R6, 'tpl-c').textContent),
  'the rail redraws with the new template marked in use, in words');

/* the already-applied template: confirming it must still record the pick */
const R6b = runRoom();
fire(tplItem(R6b, 'tpl-a'), 'click');       /* tpl-a is already row 0's template */
ok(R6b.rows[0].tplManual === true,
  'CONFIRMING THE ALREADY-APPLIED TEMPLATE RECORDS A MANUAL PICK (the b796 blocker)',
  'tplManual=' + R6b.rows[0].tplManual + ' - without it the auto-matcher can still reroute the row');
ok(R6b.rows[0].tplId === 'tpl-a', 'and the template is unchanged');
ok(R6b.toasts.some(t => /locked in/.test(t.m)), 'and he is told it is locked in');

/* an edited draft is a two-step switch */
const editedRows = freshRows();
editedRows[0].gen = true; editedRows[0].edited = true; editedRows[0].note = 'his own words';
const R6c = runRoom({ rows: editedRows });
fire(tplItem(R6c, 'tpl-c'), 'click');
ok(R6c.rows[0].tplId === 'tpl-a', 'AN EDITED DRAFT IS NOT SWITCHED ON THE FIRST CLICK',
  'tplId=' + R6c.rows[0].tplId);
ok(/click again to switch/.test(R6c.doc.getElementById('oprTplRail').textContent),
  'the rail says in place that a second click will switch');
ok(R6c.toasts.some(t => /Click that template again/.test(t.m)), 'and says why nothing happened');
fire(tplItem(R6c, 'tpl-c'), 'click');
ok(R6c.rows[0].tplId === 'tpl-c', 'THE SECOND CLICK SWITCHES IT (a confirmation, not a wall)');
ok(R6c.rows[0].note === 'his own words', 'his text is untouched either way');

/* arming is per-row: moving patient must disarm */
const editedRows2 = freshRows();
editedRows2[0].gen = true; editedRows2[0].edited = true; editedRows2[0].note = 'x';
const R6d = runRoom({ rows: editedRows2 });
fire(tplItem(R6d, 'tpl-c'), 'click');              /* arms row 0 */
fire(navItem(R6d, 1), 'click');                    /* move to another patient */
fire(navItem(R6d, 0), 'click');                    /* and back */
fire(tplItem(R6d, 'tpl-c'), 'click');
ok(R6d.rows[0].tplId === 'tpl-a',
  'an arm is CLEARED by changing patient, so it can never fire on the wrong row',
  'tplId=' + R6d.rows[0].tplId);

/* the pick survives a rebuild from a fresh _opPrep (day change / mode switch) */
const R6e = runRoom();
fire(tplItem(R6e, 'tpl-c'), 'click');
const rebuilt = freshRows();
R6e.win._opPrep = rebuilt;
R6e.api.rebuild();
ok(rebuilt[0].tplId === 'tpl-c' && rebuilt[0].tplManual === true,
  'the pick is restored after a rebuild (day change / mode switch / reopen)',
  'tplId=' + rebuilt[0].tplId);
ok(rebuilt[1].tplManual !== true,
  'and a row he never picked is left to the auto-matcher');

/* an empty template list must not break the rail */
const R6f = runRoom({ templates: [] });
ok(!R6f.err && /None uploaded yet/.test(R6f.doc.getElementById('oprTplRail').textContent),
  'with NO templates the rail explains itself instead of rendering an empty box',
  R6f.doc.getElementById('oprTplRail').textContent.slice(0, 80));

/* ======================================================================
   7. THE FOLLOW-MODE CONTROL PERSISTS AND READS BACK
   ================================================================== */
head('7. follow-mode');
const R7 = runRoom();
const MODE_KEY = 'sf_u::t@t::opNoteTemplateMode';
function modeBtn(res, m) { return res.doc.getElementById('oprTplMode').querySelector('[data-tplmode="' + m + '"]'); }
function pressedMode(res) {
  const b = res.doc.getElementById('oprTplMode').querySelectorAll('[data-tplmode]')
    .filter(x => x.getAttribute('aria-pressed') === 'true');
  return b.length === 1 ? b[0].getAttribute('data-tplmode') : '(' + b.length + ' pressed)';
}
ok(pressedMode(R7) === 'adapt' && R7.store[MODE_KEY] === undefined,
  'the DEFAULT mode is adapt and nothing is written until he chooses',
  'pressed=' + pressedMode(R7) + ' stored=' + R7.store[MODE_KEY]);
fire(modeBtn(R7, 'strict'), 'click');
ok(R7.store[MODE_KEY] === 'strict', 'clicking "Follow it closely" persists strict',
  'stored=' + R7.store[MODE_KEY]);
ok(pressedMode(R7) === 'strict', 'and the control reads back the stored value', 'pressed=' + pressedMode(R7));
ok(R7.toasts.some(t => t.k === 'ok' && /Drafts will now/.test(t.m)),
  'and it confirms only AFTER reading the value back',
  JSON.stringify(R7.toasts.slice(-1)));
fire(modeBtn(R7, 'guide'), 'click');
ok(R7.store[MODE_KEY] === 'guide' && pressedMode(R7) === 'guide', 'guide persists and reads back',
  'stored=' + R7.store[MODE_KEY]);
fire(modeBtn(R7, 'adapt'), 'click');
ok(R7.store[MODE_KEY] === 'adapt' && pressedMode(R7) === 'adapt', 'adapt persists and reads back',
  'stored=' + R7.store[MODE_KEY]);
ok(!R7.toasts.some(t => /could not be saved/.test(t.m)),
  'no false failure toast when the write really landed');

/* a storage that silently drops writes must be REPORTED, not celebrated */
const R7b = runRoom();
R7b.win.localStorage.setItem = function () {};      /* full/restricted profile */
fire(modeBtn(R7b, 'guide'), 'click');
ok(R7b.toasts.some(t => t.k === 'err' && /could not be saved/.test(t.m)),
  'a DROPPED write is reported as a failure instead of a fake "saved"',
  JSON.stringify(R7b.toasts.slice(-1)));

/* ======================================================================
   8. THE RENDER WRAP (the seam every rebuild flows through)
   ================================================================== */
head('8. render wrap');
const R8 = runRoom();
ok(typeof R8.win.opPrepRender === 'function' && R8.win.opPrepRender.__oprWrap === true,
  'window.opPrepRender is wrapped once, with its original kept for revert');
const beforeTick = R8.calls.onfTick;
R8.win._opPrep = freshRows();
const rv = R8.win.opPrepRender();
ok(rv === 'base-render' && R8.calls.render === 1, 'the wrap calls the base render and returns its value',
  'returned ' + rv);
ok(R8.calls.onfTick === beforeTick + 1,
  'it kicks the Fields-box tick SYNCHRONOUSLY (the occluded-tab law - no timer can be trusted)',
  'ticks ' + beforeTick + ' -> ' + R8.calls.onfTick);
ok(R8.doc.getElementById('oprRowNav').querySelectorAll('.opr-nav-item').length === 3,
  'and it rebuilds the rails after every list render');
ok(R8.cards[0].card.classList.contains('opr-cur'),
  'and re-marks the current card so the solo view is never blank');

/* ======================================================================
   9. IDEMPOTENCE - loading twice must not double-bind
   ================================================================== */
head('9. idempotence');
const R9 = runRoom();
const beforeApi = R9.api;
const beforeKeys = (R9.winListeners.keydown || []).length;
const beforeNavClick = R9.doc.getElementById('oprRowNav').onclick;
const err2 = R9.load();
ok(!err2, 'loading the module a SECOND time does not throw', err2);
ok((R9.winListeners.keydown || []).length === beforeKeys,
  'it does not double-bind the window keydown handlers',
  beforeKeys + ' -> ' + (R9.winListeners.keydown || []).length);
ok(R9.win.__mlsOpNoteRoom === beforeApi, 'the same api object is still installed');
ok(R9.win.opPrepRender.__oprOrig && R9.win.opPrepRender.__oprOrig.__oprWrap !== true,
  'opPrepRender is not double-wrapped (no wrap of a wrap)');
ok(R9.doc.head.querySelectorAll('style').length === 1,
  'only one #oprSkin stylesheet exists',
  'styles: ' + R9.doc.head.querySelectorAll('style').length);
ok(typeof R9.doc.getElementById('oprRowNav').onclick === 'function',
  'and the rails are still wired after the second load');
fire(navItem(R9, 1), 'click');
ok(navOn(R9) === 1, 'a click after the second load still moves exactly one selection', 'on=' + navOn(R9));

/* ======================================================================
   10. REVERT - the module leaves nothing behind
   ================================================================== */
head('10. revert');
const R10 = runRoom();
const origRender = R10.win.opPrepRender.__oprOrig;
const origOpenTpl = R10.win.openTemplates.__oprTplOrig;
const origOpenPrep = R10.win.openOpPrep.__oprProcOrig;
ok(typeof origRender === 'function' && typeof origOpenTpl === 'function' && typeof origOpenPrep === 'function',
  'the wraps keep a handle on the originals');
R10.api.revert();
ok(R10.win.opPrepRender === origRender, 'revert restores the original opPrepRender');
ok(R10.win.openTemplates === origOpenTpl && R10.win.closeTemplates.__oprTplWrap === undefined,
  'revert restores openTemplates / closeTemplates');
ok(R10.win.openOpPrep === origOpenPrep, 'revert restores the procedure openers');
ok((R10.winListeners.keydown || []).length === 0,
  'revert removes BOTH window keydown handlers',
  'left: ' + (R10.winListeners.keydown || []).length);
ok(!R10.doc.getElementById('oprSkin'), 'revert removes the room skin stylesheet');
ok(!R10.doc.getElementById('oprPager'), 'revert removes the pager it created');
ok(!R10.doc.getElementById('oprTplMode'), 'revert removes the follow-mode box it created');
ok(!R10.doc.getElementById('opPrepList').classList.contains('opr-solo'),
  'revert drops the solo presentation class');
ok(R10.doc.getElementById('oprRowNav').innerHTML === '' && R10.doc.getElementById('oprRowNav').onclick === null,
  'revert empties the patient rail AND detaches its click handler');
ok(R10.doc.getElementById('oprTplRail').innerHTML === '' && R10.doc.getElementById('oprTplRail').onclick === null,
  'revert empties the template rail AND detaches its click handler');
ok(R10.doc.getElementById('oprReceipt').textContent === '' &&
   R10.doc.getElementById('oprReceipt').style.display === 'none',
  'revert clears the receipt');
ok(R10.doc.getElementById('oprTabProcs').onclick === null,
  'revert unwires the Procedures tab');
ok(R10.win.__mlsOpNoteRoom === undefined, 'revert removes the api from window');
/* ---------------------------------------------------------------------
   THIS ONE WAS RED WHEN THIS FILE WAS WRITTEN, and it was the module that was
   wrong. buildTplRail installs rail.onkeydown (feat_mls_opnote_room.js:417 -
   the Enter/Space path for the Edit affordance) and revert() cleared only
   .onclick, while the sibling nav handler at :936 WAS cleared - an omission,
   not a design choice. A reverted module kept a live key handler and its whole
   closure on #oprTplRail, and #oprTplRail is also styled by
   feat_mls_opnote_templates_ui.js, so a rail rebuilt by another owner could
   still have reached dead code. Fixed at :941.
   ------------------------------------------------------------------- */
ok(R10.doc.getElementById('oprTplRail').onkeydown === null,
  'revert also detaches the template rail KEYDOWN handler',
  'onkeydown is still ' + typeof R10.doc.getElementById('oprTplRail').onkeydown +
  ' - buildTplRail installs .onkeydown (feat_mls_opnote_room.js:417); revert() must clear it\n' +
  '        beside .onclick (:941), or a reverted module keeps a live handler on #oprTplRail.');

/* re-install after revert must work (this is how a new build lands) */
const err3 = R10.load();
ok(!err3, 'the module re-installs cleanly after a revert', err3);
ok(!!R10.win.__mlsOpNoteRoom && R10.win.__mlsOpNoteRoom.installed === true,
  'and reports installed again');
ok((R10.winListeners.keydown || []).length === 2, 're-install re-binds exactly two keydown handlers',
  'bound: ' + (R10.winListeners.keydown || []).length);

/* ======================================================================
   11. POSTURES THAT MUST NOT CRASH OR LIE
   ================================================================== */
head('11. edge postures');
const R11 = runRoom({ rows: [freshRows()[0]] });
ok(!R11.err, 'a SINGLE-patient day loads', R11.err);
ok(R11.doc.getElementById('oprRowNav').innerHTML === '',
  'single-patient mode draws no patient rail (nothing to navigate)');
ok(!R11.doc.getElementById('oprPager'), 'and no pager');
ok(!R11.doc.getElementById('opPrepList').classList.contains('opr-solo'),
  'and no solo class, so the one card shows');
ok(R11.doc.getElementById('oprTplRail').querySelectorAll('.opr-tpl-item').length === 3,
  'but the template rail is still there and still usable');
fire(tplItem(R11, 'tpl-b'), 'click');
ok(R11.rows[0].tplId === 'tpl-b', 'and a template still applies with one patient',
  'tplId=' + R11.rows[0].tplId);
fireWinKey(R11, 'ArrowDown');
ok(!R11.err, 'an arrow key with one patient is a no-op, not a crash');

const R11b = runRoom({ rows: [] });
ok(!R11b.err, 'an EMPTY day loads without throwing', R11b.err);
ok(R11b.doc.getElementById('oprReceipt').style.display === 'none',
  'the receipt hides itself when there is no row to describe');
fire(tplItem(R11b, 'tpl-a'), 'click');
ok(R11b.toasts.some(t => t.k === 'err' && /Open a procedure first/.test(t.m)),
  'clicking a template with no procedure open REFUSES OUT LOUD instead of silently doing nothing',
  JSON.stringify(R11b.toasts));

const R11c = runRoom({ open: false });
ok(!R11c.err, 'the module loads with the room CLOSED', R11c.err);
ok(R11c.doc.getElementById('oprRowNav').innerHTML === '',
  'and builds no rails until the room is open (no work in a closed modal)');
R11c.doc.getElementById('opPrepModal').classList.add('show');
R11c.api.rebuild();
ok(R11c.doc.getElementById('oprRowNav').querySelectorAll('.opr-nav-item').length === 3,
  'opening the room and rebuilding fills the rails');

const R11d = runRoom({ resolvePatient: false });
ok(/identity not verified yet/.test(R11d.doc.getElementById('oprReceipt').textContent),
  'an UNRESOLVED patient is named as unverified rather than claimed as context',
  R11d.doc.getElementById('oprReceipt').textContent);

ok(!R.toasts.some(t => /undefined|NaN|\[object/.test(t.m)),
  'no toast in the whole walk printed undefined / NaN / [object Object]',
  JSON.stringify(R.toasts.filter(t => /undefined|NaN|\[object/.test(t.m))));

/* ======================================================================
   12. THE ONE THAT IS RED - AND IT IS THE PRODUCT, NOT THE HARNESS
   ----------------------------------------------------------------------
   MEASURED, not read. Be on patient 3 of 3 in all-day mode, then land on a
   SINGLE-procedure posture - "This patient" mode (opPrepSetMode), a day with
   one procedure, a reopen. Every one of those rebuilds window._opPrep, which
   is exactly the sequence feat_mls_opnote_room.js:289-306 documents.

   buildNav returns at :230 when rows.length < 2, and the clamp that would have
   corrected the selection sits on the NEXT line, :231 - unreachable on that
   path. SEL therefore stays 2 against a 1-row array, buildReceipt reads
   rows[SEL] at :618, gets undefined, and hides the receipt at :619.

   It never comes back. There is no nav and no pager in single-procedure mode,
   arrow keys return early at :693, and every later rebuild / render / template
   click re-runs buildReceipt against the same out-of-range SEL. Probed: three
   further rebuilds, a full opPrepRender, and a template apply all left it
   blank, while an identical day entered fresh at SEL=0 shows it correctly - so
   this is the stale index, not a single-procedure design choice.

   WHAT IS LOST. #oprReceipt is the room's one honest statement of what will
   ground the draft ("N verified visits + chart profile", or "identity not
   verified yet - the draft will name exactly what is missing"). It vanishing
   silently is the failure mode this repo keeps re-learning: the surface that
   says what the AI can actually see, gone with no message. The template rail
   meanwhile falls back to row 0 through curRow() at :371, so rail and receipt
   disagree about which row is current.

   THE FIX (in feat_mls_opnote_room.js, owned by another lane today): clamp SEL
   BEFORE the early return - move :231 above :230 - or better, clamp once in
   buildRails so no builder can ever read an out-of-range index.
   ================================================================== */
head('12. selection clamp across a multi-row -> single-row rebuild');
const R12 = runRoom();
fire(navItem(R12, 2), 'click');
ok(/^Context for EE/.test(R12.doc.getElementById('oprReceipt').textContent),
  'he is on the third patient and the receipt names that patient',
  R12.doc.getElementById('oprReceipt').textContent);
R12.win._opPrep = [{ appt: { name: 'ZZ ZZ' }, patientId: 'p-9', proc: 'x', tplId: 'tpl-a', tplManual: false, gen: false, note: '', edited: false }];
R12.api.rebuild();
R12.win.opPrepRender();
fire(tplItem(R12, 'tpl-b'), 'click');
ok(R12.win._opPrep[0].tplId === 'tpl-b',
  'the template rail still applies to the one remaining row (curRow falls back to 0 at :371)',
  'tplId=' + R12.win._opPrep[0].tplId);
ok(R12.doc.getElementById('oprReceipt').style.display !== 'none' &&
   /^Context for ZZ/.test(R12.doc.getElementById('oprReceipt').textContent),
  'THE CONTEXT RECEIPT SURVIVES A DROP TO A SINGLE PROCEDURE',
  'receipt is display:' + JSON.stringify(R12.doc.getElementById('oprReceipt').style.display) +
  ' text=' + JSON.stringify(R12.doc.getElementById('oprReceipt').textContent) + '\n' +
  '        PRODUCT DEFECT (measured, not grepped): buildNav returns at feat_mls_opnote_room.js:230\n' +
  '        when rows.length < 2, so the clamp on the very next line (:231) never runs; SEL stays 2,\n' +
  '        buildReceipt reads rows[SEL] at :618 -> undefined -> hidden at :619, and nothing in\n' +
  '        single-procedure mode ever calls oprSelect to correct it (no nav, no pager, arrows\n' +
  '        return early at :693). Fix: clamp SEL BEFORE the early return, or clamp in buildRails.');

/* ======================================================================
   RESULT
   ================================================================== */
console.log('');
if (failures === 0) {
  console.log('PASS  opnote-room-walkthrough-runtime: every control in the op-note room was pressed and did what it says.');
} else {
  console.log('FAIL  opnote-room-walkthrough-runtime: ' + failures + ' assertion(s) failed:');
  failed.forEach(f => console.log('        - ' + f));
  console.log('');
  console.log('        NOT A HARNESS FLAKE. Section 12 is red because of a measured product');
  console.log('        defect in feat_mls_opnote_room.js (SEL is never clamped on the');
  console.log('        rows.length < 2 path at :230, so #oprReceipt hides itself for good).');
  console.log('        Fix the module - do not relax this assertion.');
}
process.exit(failures === 0 ? 0 : 1);
