'use strict';
/* =========================================================================
   THE FIELDS BOX SHOWS IN *BOTH* OP-NOTE MODES — PROVED BY EXECUTION
   -------------------------------------------------------------------------
   OWNER (2026-07-30): "the fill in the balnks should still show up even in the
   all scchaefualed patients view."

   WHAT HE SAW. In "This patient" mode the Fields box ("8 fields need you
   (2 blank · 6 suggested)") appears above the note. In "All scheduled patients"
   mode the same card showed the template picker, the Re-draft button, the
   preview and Save — and no Fields box at all.

   THE MECHANISM, MEASURED (not guessed).
   The suspected cause was the room's presentation-hide
   (`#opPrepList.opr-solo > div{display:none}`, feat_mls_opnote_room.js:136).
   It is NOT that. That rule matches the direct children of #opPrepList — the
   patient CARDS — and the Fields box lives one level deeper, immediately before
   textarea#opPrepNote_<i> inside the card, so it is never selected by it; the
   visible `.opr-cur` card renders its box normally. Scenario 3 below loads the
   real room module, asserts .opr-solo is actually on, and still finds the box.
   Nor does the fill module filter by visibility: its tick queries
   `textarea[id^="opPrepNote_"]` with no offsetParent/visibility test at all
   (feat_mls_opnote_fill.js reads offsetParent exactly once, in
   mainBoxWithBlanks(), and only for the MAIN editor #noteBox).

   The real cause was a CACHE THAT OUTLIVED ITS NODE. The tick skipped a
   textarea whenever a module-level `_sig[ta.id]` matched `sigOf(ta)`. But
   opPrepRender repaints the whole list with `box.innerHTML = rows.map(...)`
   (ScribeFlow.html:15748) — destroying every card and every `.onf-fillbox`
   inside it — and hands back a NEW textarea with the SAME id and the SAME
   value. An id-keyed cache cannot see a node replacement, so the signature
   still matched and the row was skipped forever.
   "Draft all" makes that the normal path, because opPrepGenerateOne ends in
   opPrepRender (ScribeFlow.html:15843) — once PER ROW. So each row's draft wiped
   the PREVIOUS row's box, and after an N-patient day exactly ONE box survived:
   the LAST row drafted. The room opens on the FIRST patient. Single-patient mode
   was never affected because its one row is always the last one drafted — which
   is exactly why this read as an "all scheduled patients" bug.

   WHAT THIS PINS
     1. one row  ("This patient")          -> the box is there.
     2. many rows ("All scheduled")        -> the box is there for EVERY row,
        after the per-row render storm that drafting the day produces. Scenario 2
        is the one that FAILED before the fix, with [true,false,false...] moving
        down the list and settling as [false,false,...,true].
     3. with the real room module loaded and .opr-solo actually applied.
     4. THE LOAD-BEARING CONTRACT: the box is the textarea's PREVIOUS ELEMENT
        SIBLING, exactly one of them, and the textarea is neither wrapped nor
        reparented.
     5. FREEZE SAFETY: once settled, further ticks rebuild nothing. The fix must
        not turn a 1s interval into a 1s repaint.

   NON-VACUITY. Reverting the fix (restoring the id-keyed `_sig` skip) was run
   and watched: scenario 2 fails with
   "row 0 of 3 has no Fields box after the day was drafted".
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILL_SRC = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_fill.js'), 'utf8');
const ROOM_SRC = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_room.js'), 'utf8');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function head(t) { console.log('\n' + t); }

/* ========================================================================
   A STUB DOM THAT KEEPS ITS NODES
   ------------------------------------------------------------------------
   Same shape as tests/opnote-room-walkthrough-runtime.test.js: innerHTML is
   PARSED into persistent nodes, so a box inserted on one tick is still there
   to be found on the next, and a list rebuild really does destroy the old
   subtree (which is the entire point of this file).

   THE INSTRUMENT LIES FIRST. Two stub bugs were hit while writing this and both
   read exactly like product bugs: (a) `className` was a plain property, so the
   box the module DID insert never matched `.onf-fillbox` and every scenario
   reported "no box"; (b) `el.id = x` did not register in the id map, so the
   module's own `$(STYLE_ID)` guard never saw its stylesheet. Both are fixed
   below — className is wired to classList, and `id` is an accessor.
   ==================================================================== */
const VOIDTAG = { br: 1, hr: 1, img: 1, input: 1, meta: 1, link: 1 };

function makeDom() {
  const nodes = new Map();

  function mk(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      _id: '', _html: '', _text: '', children: [], parentNode: null,
      style: {}, _attrs: {}, _listeners: {}, value: '', disabled: false,
      options: [], selectedIndex: -1,
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
        if (k === 'class') this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean));
        if (k === 'id') this.id = String(v);
        if (k === 'value' && /^(INPUT|TEXTAREA|OPTION)$/.test(this.tagName)) this.value = String(v);
      },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
      removeAttribute(k) { delete this._attrs[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k); },
      appendChild(c) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this; this.children.push(c);
        reregister(c);
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        const i = ref ? this.children.indexOf(ref) : -1;
        this.children.splice(i < 0 ? this.children.length : i, 0, c);
        reregister(c);
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        c.parentNode = null;
        deregister(c);            /* a removed subtree is unreachable by id */
        return c;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      querySelectorAll(sel) { const out = []; collectList(this, sel, out); return out; },
      querySelector(sel) { const out = []; collectList(this, sel, out, true); return out[0] || null; },
      closest(sel) { let n = this; while (n) { if (matchesCompound(n, sel)) return n; n = n.parentNode; } return null; },
      matches(sel) { return matchesCompound(this, sel); },
      scrollIntoView() { this._scrolled = (this._scrolled || 0) + 1; },
      dispatchEvent(e) {
        const h = this._listeners[e && e.type];
        if (h) h.slice().forEach(f => { try { f(e); } catch (x) {} });
        let n = this;
        while (n) { const on = n['on' + (e && e.type)]; if (typeof on === 'function') { try { on.call(n, e); } catch (x) {} } n = n.parentNode; }
        return true;
      },
      addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
      removeEventListener(t, f) { const a = this._listeners[t] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
      focus() { this._focused = true; }
    };
    Object.defineProperty(el, 'id', {
      get() { return el._id; },
      set(v) { el._id = String(v); el._attrs.id = String(v); if (el._id) nodes.set(el._id, el); }
    });
    Object.defineProperty(el, 'className', {
      get() { return el.classList._list.join(' '); },
      set(v) { el.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); el._attrs['class'] = String(v); }
    });
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html; },
      set(v) { el._html = String(v); parseInto(el, el._html, mk); },
      configurable: true
    });
    Object.defineProperty(el, 'textContent', {
      get() { return textOf(el); },
      set(v) { for (const c of el.children.slice()) el.removeChild(c); el._html = ''; el._text = String(v); }
    });
    Object.defineProperty(el, 'parentElement', { get() { return el.parentNode; } });
    Object.defineProperty(el, 'previousElementSibling', { get() { return sibEl(el, -1); } });
    Object.defineProperty(el, 'nextElementSibling', { get() { return sibEl(el, 1); } });
    Object.defineProperty(el, 'nextSibling', {
      get() {
        if (!el.parentNode) return null;
        const i = el.parentNode.children.indexOf(el);
        return (i >= 0 && el.parentNode.children[i + 1]) ? el.parentNode.children[i + 1] : null;
      }
    });
    /* null when this node or any ancestor is display:none — the real rule */
    Object.defineProperty(el, 'offsetParent', {
      get() { let n = el; while (n) { if (n.style && n.style.display === 'none') return null; n = n.parentNode; } return el.parentNode || null; }
    });
    return el;
  }
  function sibEl(el, d) {
    if (!el.parentNode) return null;
    let i = el.parentNode.children.indexOf(el);
    if (i < 0) return null;
    for (i += d; i >= 0 && i < el.parentNode.children.length; i += d) {
      if (el.parentNode.children[i].tagName !== '#TEXT') return el.parentNode.children[i];
    }
    return null;
  }
  function reregister(n) { if (!n) return; if (n.id) nodes.set(n.id, n); for (const c of n.children) reregister(c); }
  function deregister(n) { if (!n) return; if (n.id && nodes.get(n.id) === n) nodes.delete(n.id); for (const c of n.children) deregister(c); }
  function textOf(n) {
    if (!n) return '';
    if (n.tagName === '#TEXT') return n._text;
    let s = n._text || '';
    for (const c of n.children) s += textOf(c);
    return s;
  }

  /* selector engine: .class #id tag [a] [a="v"] [a^="v"], compounds, one
     descendant combinator, comma lists — everything these two modules ask for */
  function matchesSimple(n, part) {
    let m;
    if ((m = /^\.([-\w]+)$/.exec(part))) return n.classList.contains(m[1]);
    if ((m = /^#([-\w]+)$/.exec(part))) return n.id === m[1];
    if ((m = /^\[([-\w]+)\]$/.exec(part))) return n.getAttribute(m[1]) !== null;
    if ((m = /^\[([-\w]+)([\^$*]?)=["']?([^"'\]]*)["']?\]$/.exec(part))) {
      const v = n.getAttribute(m[1]);
      if (v === null) return false;
      if (m[2] === '^') return v.indexOf(m[3]) === 0;
      if (m[2] === '$') return v.slice(-m[3].length) === m[3];
      if (m[2] === '*') return v.indexOf(m[3]) >= 0;
      return v === m[3];
    }
    if ((m = /^([a-zA-Z][\w]*)$/.exec(part))) return n.tagName === m[1].toUpperCase();
    throw new Error('stub selector engine cannot parse simple part: ' + part);
  }
  function matchesCompound(n, sel) {
    if (!n || !sel || n.tagName === '#TEXT') return false;
    sel = String(sel).trim();
    const parts = sel.match(/(^[a-zA-Z][\w]*)|(\.[-\w]+)|(#[-\w]+)|(\[[^\]]+\])/g);
    if (!parts || parts.join('') !== sel) throw new Error('stub selector engine cannot parse: ' + sel);
    return parts.every(p => matchesSimple(n, p));
  }
  function collectDeep(root, sel, out, firstOnly) {
    for (const c of root.children) {
      if (matchesCompound(c, sel)) { out.push(c); if (firstOnly) return; }
      collectDeep(c, sel, out, firstOnly);
      if (firstOnly && out.length) return;
    }
  }
  function collectOne(root, sel, out, firstOnly) {
    const sp = String(sel).trim().split(/\s+/);
    if (sp.length === 2) {
      const hosts = [];
      collectDeep(root, sp[0], hosts, false);
      for (const h of hosts) { collectDeep(h, sp[1], out, firstOnly); if (firstOnly && out.length) return; }
      return;
    }
    collectDeep(root, String(sel).trim(), out, firstOnly);
  }
  function collectList(root, sel, out, firstOnly) {
    for (const one of String(sel).split(',')) {
      if (!one.trim()) continue;
      collectOne(root, one, out, firstOnly);
      if (firstOnly && out.length) return;
    }
  }

  function parseInto(el, html, mkFn) {
    for (const c of el.children.slice()) el.removeChild(c);
    el._text = '';
    const stack = [el];
    const tagRe = /<(\/?)([a-zA-Z][\w]*)((?:\s+[a-zA-Z][-\w]*(?:="[^"]*")?)*)\s*(\/?)>/g;
    let last = 0, m;
    function addText(parent, s) { if (!s) return; const t = mkFn('#text'); t._text = s; parent.appendChild(t); }
    while ((m = tagRe.exec(html))) {
      if (m.index > last) addText(stack[stack.length - 1], html.slice(last, m.index));
      last = tagRe.lastIndex;
      const closing = m[1] === '/', tag = m[2], attrs = m[3] || '', self = m[4] === '/';
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const node = mkFn(tag);
      const aRe = /([a-zA-Z][-\w]*)(?:="([^"]*)")?/g;
      let a;
      while ((a = aRe.exec(attrs))) { if (!a[1]) continue; node.setAttribute(a[1], a[2] === undefined ? '' : a[2]); }
      stack[stack.length - 1].appendChild(node);
      if (node.tagName === 'OPTION' && node.parentNode && node.parentNode.tagName === 'SELECT') {
        node.parentNode.options.push(node);
        if (node.hasAttribute('selected')) { node.parentNode.value = node.value; node.parentNode.selectedIndex = node.parentNode.options.length - 1; }
      }
      if (!self && !VOIDTAG[tag.toLowerCase()]) stack.push(node);
    }
    if (last < html.length) addText(stack[stack.length - 1], html.slice(last));
  }

  const doc = {
    _nodes: nodes,
    createElement: mk,
    createTextNode(t) { const n = mk('#text'); n._text = String(t); return n; },
    getElementById(id) { return nodes.get(id) || null; },
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible', readyState: 'complete',
    getAnimations() { return []; }
  };
  doc.body = mk('body'); doc.head = mk('head'); doc.documentElement = mk('html');
  doc.querySelectorAll = (s) => doc.body.querySelectorAll(s);
  doc.querySelector = (s) => doc.body.querySelector(s);
  doc._mk = mk;
  return doc;
}

/* ========================================================================
   THE OP-NOTE ROOM'S REAL NODE GRAPH + THE REAL CARD ELEMENT ORDER
   ------------------------------------------------------------------------
   The card markup mirrors ScribeFlow.html:15748-15766 element for element,
   because the thing under test is a STRUCTURAL contract: the note textarea's
   previous-element-sibling slot. In the shipped renderer that slot holds the
   div carrying the template <select> and the Re-draft button, and the textarea
   only exists at all when row.gen is true.
   ==================================================================== */
const NOTE_TOKENS = '\nLaterality: [FILL: laterality]\nLevel: [FILL: level]\nNeedle: [FILL: needle size]\n';

function build(nRows) {
  const doc = makeDom();
  const mk = doc._mk;
  function div(id, parent) { const n = mk('div'); if (id) n.setAttribute('id', id); (parent || doc.body).appendChild(n); return n; }

  const modal = div('opPrepModal');
  modal.classList.add('modal-bg'); modal.classList.add('show');
  const top = div('oprTop', modal);
  div('oprTabProcs', top); div('oprTabTpls', top);
  const panelProcs = div('oprPanelProcs', modal);
  const dayRail = div('oprDayRail', panelProcs);
  div('opPrepModeRow', dayRail); div('opPrepDayRow', dayRail);
  div('oprRowNav', dayRail); div('oprTplRail', dayRail);
  const editor = div('oprEditor', panelProcs);
  div('oprReceipt', editor);
  const list = div('opPrepList', editor);
  const genAll = mk('button'); genAll.setAttribute('id', 'opPrepGenAllBtn'); editor.appendChild(genAll);
  div('oprPanelTpls', modal);
  div('templatesModal');
  div('opPrepStatus', modal);

  const rows = [];
  for (let i = 0; i < nRows; i++) {
    rows.push({
      appt: { name: 'AA' + i + ' BB' + i, dob: '', mrn: '' },
      patientId: 'p-' + i, proc: 'esi', tplId: 'tpl-a', tplManual: false,
      gen: false, note: '', _genNote: '', edited: false, missing: [], values: {}
    });
  }

  const store = {};
  const win = {
    document: doc,
    _opPrep: rows,
    _opPrepMode: nRows > 1 ? 'all' : 'patient',
    _tplUI: { selectedId: '', dirty: false },
    getTemplates: () => [{ id: 'tpl-a', name: 'Left L4-L5 ESI', text: 'T'.repeat(400) }],
    opNoteBlankTokens: (s) => (String(s || '').match(/\[FILL:[^\]]*\]|\[\[[a-z0-9_]+\]\]/gi) || []),
    opNoteBlankCount: (s) => (String(s || '').match(/\[FILL:[^\]]*\]|\[\[[a-z0-9_]+\]\]/gi) || []).length,
    toast: () => {},
    uns: (s) => 'sf_u::t@t::' + s,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    opPrepRenderBadges: () => {},
    openTemplates: () => {}, closeTemplates: () => {},
    openOpPrep: () => {}, openOpPrepForPatient: () => {}, openOpPrepSmart: () => {},
    renderTemplateList: () => {}, renderTplDetail: () => {},
    opPrepSave: () => {}, opPrepGenerateOne: () => {}, opPrepAutosaveDraft: () => {},
    _opResolvePatient: () => null,
    getProviderName: () => 'Dr T',
    Event: function (t, o) { this.type = t; this.bubbles = !!(o && o.bubbles); },
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 99, clearInterval: () => {},
    getComputedStyle: (n) => ({ display: (n && n.style && n.style.display) || 'block', visibility: 'visible' }),
    requestIdleCallback: (f) => { try { f(); } catch (e) {} },
    addEventListener() {}, removeEventListener() {},
    console: { warn() {}, log() {}, error() {} }
  };
  win.window = win; win.self = win;

  /* the base renderer: element-for-element with ScribeFlow.html:15748-15766 */
  function render() {
    let h = '';
    for (let i = 0; i < rows.length; i++) {
      h += '<div>';
      h += '<div id="opPrepPrev_' + i + '">preview</div>';
      h += '<label class="mini" for="opPrepProc_' + i + '">Procedure</label>';
      h += '<div><input id="opPrepProc_' + i + '" value="" oninput="_opProcChanged(' + i + ',this.value)"><button>Match template</button></div>';
      h += '<div><span class="mini">Template:</span><select id="opPrepTpl_' + i + '"><option value="tpl-a" selected>Left L4-L5 ESI</option></select>'
        + '<button class="btn-primary">Re-draft</button></div>';
      if (rows[i].gen) {
        h += '<textarea id="opPrepNote_' + i + '"></textarea>';
        h += '<div class="row"><button class="btn-green">Save</button><span id="opPrepMsg_' + i + '"></span></div>';
      }
      h += '</div>';
    }
    list.innerHTML = h;
    /* the shipped renderer emits esc(row.note) as the textarea's TEXT; a browser
       folds that into .value, so do the same here */
    for (let i = 0; i < rows.length; i++) {
      const ta = doc.getElementById('opPrepNote_' + i);
      if (ta) ta.value = rows[i].note || '';
    }
    render.n++;
  }
  render.n = 0;
  win.opPrepRender = function () { render(); return 'base'; };

  return { doc, win, rows, list, render };
}

function load(src, win, doc) {
  new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'Event', 'getComputedStyle', 'console', src)(
    win, doc, win.localStorage, win.setTimeout, win.clearTimeout,
    win.setInterval, win.clearInterval, win.Event, win.getComputedStyle, win.console);
}

/* THE CONTRACT, read the way feat_mls_opnote_fill.js itself reads it. */
function fillBoxOf(doc, i) {
  const ta = doc.getElementById('opPrepNote_' + i);
  if (!ta) return null;
  const p = ta.previousElementSibling;
  return (p && p.classList && p.classList.contains('onf-fillbox')) ? p : null;
}
function boxMap(doc, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(!!fillBoxOf(doc, i));
  return out;
}

/* Draft the day the way the app does: opPrepGenerateOne writes the row then
   calls opPrepRender (ScribeFlow.html:15843) — once PER ROW.
   The tick afterwards is not test convenience: the room wraps opPrepRender and
   kicks onf.tick() SYNCHRONOUSLY in the same moment (feat_mls_opnote_room.js:907),
   and the module's own 1s interval ticks besides. Scenario 3 loads the real room
   and gets that kick for free; here it is supplied explicitly so the scenario
   isolates the fill module. An extra tick is a no-op by assertion 5a. */
function draftRow(env, i) {
  const r = env.rows[i];
  r.note = 'PROCEDURE NOTE for patient ' + i + NOTE_TOKENS;
  r._genNote = r.note; r.gen = true; r._genSeq = (r._genSeq || 0) + 1;
  env.win.opPrepRender();
  env.win.__mlsOpNoteFill.tick();
}

/* ======================================================================
   1. "THIS PATIENT" — one row
   ================================================================== */
head('1. "This patient" mode (a single row)');
{
  const env = build(1);
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  ok(!!env.win.__mlsOpNoteFill && env.win.__mlsOpNoteFill.installed, '1a: the fill module installed');
  draftRow(env, 0);
  env.win.__mlsOpNoteFill.tick();
  const box = fillBoxOf(env.doc, 0);
  ok(!!box, '1b: the Fields box is the note textarea\'s previous element sibling',
    'boxes=' + JSON.stringify(boxMap(env.doc, 1)));
  ok(!!box && /field/i.test(box.textContent), '1c: it names the fields rather than rendering empty',
    box ? box.textContent.slice(0, 90) : '(no box)');
  ok(!!box && box.querySelectorAll('[data-onf-label]').length === 3,
    '1d: one control per [FILL:] token (3)',
    box ? String(box.querySelectorAll('[data-onf-label]').length) : '(no box)');
  ok(!!env.win.__mlsOpNoteFill && env.win.__mlsOpNoteFill.lastFillError === null,
    '1e: nothing threw while building it',
    JSON.stringify(env.win.__mlsOpNoteFill && env.win.__mlsOpNoteFill.lastFillError));
}

/* ======================================================================
   2. "ALL SCHEDULED PATIENTS" — the defect the owner reported
   ------------------------------------------------------------------
   THIS is the assertion that failed before the fix. Drafting the day calls
   opPrepRender once per row, and each of those rebuilds destroys every card
   in the list. With the old id-keyed skip, only the row whose text had just
   changed was rebuilt, so the map walked [T,F,F] -> [F,T,F] -> [F,F,T] and
   settled with a box on the LAST patient only — while the room opens on the
   FIRST.
   ================================================================== */
head('2. "All scheduled patients" mode (the reported defect)');
{
  const N = 4;
  const env = build(N);
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  const walk = [];
  for (let i = 0; i < N; i++) { draftRow(env, i); walk.push(boxMap(env.doc, N).map(b => (b ? 'T' : 'F')).join('')); }
  const map = boxMap(env.doc, N);
  ok(map.every(Boolean), '2a: EVERY drafted patient has a Fields box after the day is drafted',
    'row ' + map.indexOf(false) + ' of ' + N + ' has no Fields box after the day was drafted' +
    '\n        per-row walk: ' + walk.join('  ->  '));
  ok(map[0] === true, '2b: patient 1 — the one the room opens on — has one',
    'this is precisely what he saw: picker + Re-draft + preview + Save, no Fields box');
  const lastOnly = map[N - 1] && map.slice(0, N - 1).every(b => !b);
  ok(!lastOnly, '2c: it is not the last-row-only shape the id-keyed cache produced');
  /* the steady-state interval must not undo it either */
  for (let k = 0; k < 5; k++) env.win.__mlsOpNoteFill.tick();
  ok(boxMap(env.doc, N).every(Boolean), '2d: five more ticks leave every box standing');
}

/* ======================================================================
   3. WITH THE REAL ROOM MODULE — .opr-solo is NOT the mechanism
   ================================================================== */
head('3. the room loaded, .opr-solo actually applied');
{
  const N = 3;
  const env = build(N);
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  load(ROOM_SRC, env.win, env.doc);
  ok(typeof env.win.opPrepRender === 'function' && env.win.opPrepRender.__oprWrap === true,
    '3a: the room wrapped opPrepRender (its onf tick kick is live)');
  for (let i = 0; i < N; i++) draftRow(env, i);
  const list = env.doc.getElementById('opPrepList');
  ok(list.classList.contains('opr-solo'),
    '3b: the room really did apply the presentation-hide class');
  ok(boxMap(env.doc, N).every(Boolean),
    '3c: every card still has its Fields box WITH .opr-solo on',
    'boxes=' + JSON.stringify(boxMap(env.doc, N)));
  /* and the refutation stated plainly: the rule selects the CARD, not the box */
  const box0 = fillBoxOf(env.doc, 0);
  ok(!!box0 && box0.parentNode !== list,
    '3d: the box is INSIDE the card, so `#opPrepList.opr-solo > div` cannot select it');
  ok(!!box0 && box0.parentNode === env.doc.getElementById('opPrepNote_0').parentNode,
    '3e: box and textarea share one parent — the card');
}

/* ======================================================================
   4. THE LOAD-BEARING CONTRACT — the previous-sibling slot
   ================================================================== */
head('4. the previous-sibling contract survives');
{
  const N = 3;
  const env = build(N);
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  for (let i = 0; i < N; i++) draftRow(env, i);
  for (let k = 0; k < 3; k++) env.win.__mlsOpNoteFill.tick();
  let dup = 0, wrapped = 0;
  for (let i = 0; i < N; i++) {
    const ta = env.doc.getElementById('opPrepNote_' + i);
    const card = ta.parentNode;
    if (card.querySelectorAll('.onf-fillbox').length !== 1) dup++;
    /* the card is a direct child of #opPrepList — nothing wrapped the textarea */
    if (card.parentNode !== env.doc.getElementById('opPrepList')) wrapped++;
  }
  ok(dup === 0, '4a: exactly ONE .onf-fillbox per card — no duplicates from the rebuilds', 'cards with != 1: ' + dup);
  ok(wrapped === 0, '4b: the textarea was neither wrapped nor reparented', 'reparented: ' + wrapped);
  ok(env.doc.querySelectorAll('.onf-fillbox').length === N,
    '4c: N boxes for N drafted rows, no orphans left in the document',
    'found ' + env.doc.querySelectorAll('.onf-fillbox').length + ' for ' + N + ' rows');
}

/* ======================================================================
   5. FREEZE SAFETY — a settled tick rebuilds nothing
   ------------------------------------------------------------------
   The fix must not convert the 1s interval into a 1s repaint of every box.
   buildFillBox stamps data-onf-for on every pass, so counting that attribute
   write counts the rebuilds.
   ================================================================== */
head('5. once settled, the tick rebuilds nothing');
{
  const N = 3;
  const env = build(N);
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  for (let i = 0; i < N; i++) draftRow(env, i);
  env.win.__mlsOpNoteFill.tick();
  let rebuilds = 0;
  for (let i = 0; i < N; i++) {
    const box = fillBoxOf(env.doc, i);
    if (!box) continue;
    const orig = box.setAttribute.bind(box);
    box.setAttribute = function (k, v) { if (k === 'data-onf-for') rebuilds++; return orig(k, v); };
  }
  for (let k = 0; k < 10; k++) env.win.__mlsOpNoteFill.tick();
  ok(rebuilds === 0, '5a: ten idle ticks rebuild ZERO boxes', 'rebuilds=' + rebuilds);

  /* but a box that VANISHES while its textarea survives must come back.
     Guarded: with the fix reverted there is no box on row 1 to remove, and a
     TypeError here would hide the four assertions above it. */
  const gone = fillBoxOf(env.doc, 1);
  if (ok(!!gone, '5b: (setup) row 1 had a box to remove')) {
    gone.parentNode.removeChild(gone);
    ok(fillBoxOf(env.doc, 1) === null, '5c: (setup) it is gone');
    env.win.__mlsOpNoteFill.tick();
    ok(!!fillBoxOf(env.doc, 1), '5d: one tick brings a vanished box back');
  } else {
    ok(false, '5c: (setup) it is gone', 'skipped — no box existed to remove');
    ok(false, '5d: one tick brings a vanished box back', 'skipped — no box existed to remove');
  }
}

/* ====================================================================== */
console.log('');
if (failures) {
  console.log('FAIL ' + failures + ' assertion(s) — the Fields box does not survive both op-note modes');
  process.exit(1);
}
console.log('PASS the Fields box shows in BOTH op-note modes (single patient and all scheduled)');
