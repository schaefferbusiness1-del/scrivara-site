'use strict';
/* =========================================================================
   THE VISIBLE "PROCEDURE" INPUT ACTUALLY GETS FILLED — PROVED BY EXECUTION
   -------------------------------------------------------------------------
   THE DEAD GUARD (found 2026-07-30, worktree b761).

   feat_mls_opnote_fill.js:fillProcInputs() mapped an op-prep card's Procedure
   input back to its row by reading the inline handler out of the `onchange`
   attribute:

       S(inp.getAttribute('onchange')).match(/_opProcChanged\((\d+)/)

   The shipped renderer has never emitted that attribute. ScribeFlow.html:15858
   emits `oninput="_opProcChanged(i,this.value)"`. Measured across the whole
   app: `onchange="_opProcChanged` occurs 0 times, `oninput="_opProcChanged`
   occurs once. So the regex never matched, `continue` fired on every input on
   every pass, and fillProcInputs() had never populated a single visible
   Procedure input since onf-1.6.0 — while being called on every 1s tick
   (feat_mls_opnote_fill.js tick(): `safe(fillProcInputs);`).

   WHY THE BEHAVIOUR IS KEPT RATHER THAN DELETED. The Athena schedule pull
   carries no procedure text (PROBLEM A at the head of feat_mls_opnote_fill.js),
   so every card's Procedure input is BORN empty. The doctor assigns a template
   in bulk; syncProcedure() then writes row.proc from that template so the
   readiness checklist can show "Procedure" as filled. Nothing repaints the card
   at that moment — "Apply to all" only dispatches `change` on each
   opPrepTpl_<i> select, and neither the base renderer nor the integrity
   module's change listener calls opPrepRender. Without fillProcInputs the
   checklist reads Procedure ✓ directly above a visibly empty box. Scenario 1
   walks that exact sequence.

   THE FIX. The row index now comes from the input's OWN id — `opPrepProc_<i>`,
   the shape ScribeFlow.html:15858 emits — which cannot rot when a handler
   attribute is renamed. The inline-handler read stays as a fallback for the
   staging and _test renderers (same input, no id) and now accepts EITHER
   attribute name.

   WHAT THIS PINS
     1. the real sequence: assign a template in bulk -> the visible input shows
        the procedure, and the card's live preview repaints with it.
     2. an input the doctor has already typed into is NEVER overwritten.
     3. a row with no procedure leaves its input empty (no invented text).
     4. per-row isolation: row 1's procedure never lands in row 0's input.
     5. the id-less renderers (staging/_test) still work, via `oninput` AND via
        a legacy `onchange`.
     6. freeze safety: once filled, further ticks write nothing.
     7. THE SOURCE CONTRACT: ScribeFlow.html really does emit id="opPrepProc_"
        + oninput, and really has no onchange form.

   NON-VACUITY IS MEASURED, NOT ASSERTED. Scenario 0 runs the OLD lookup
   (onchange-only) over the shipped-shape DOM this file builds and proves it
   matches 0 inputs while the shipped shape offers 3 — the dead guard,
   reproduced inside the harness. Reverting the fix in the module was also run
   and watched: scenarios 1, 4, 5 and 6 fail, starting with
   "1b: the visible Procedure input carries the assigned procedure".
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILL_SRC = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_fill.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');

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
   Same shape as tests/fields-box-shows-in-all-day-view.test.js: innerHTML is
   PARSED into persistent nodes, so a value written on one tick is still there
   on the next and a list rebuild really destroys the old subtree.
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
        deregister(c);
        return c;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      querySelectorAll(sel) { const out = []; collectList(this, sel, out); return out; },
      querySelector(sel) { const out = []; collectList(this, sel, out, true); return out[0] || null; },
      closest(sel) { let n = this; while (n) { if (matchesCompound(n, sel)) return n; n = n.parentNode; } return null; },
      matches(sel) { return matchesCompound(this, sel); },
      scrollIntoView() { this._scrolled = (this._scrolled || 0) + 1; },
      /* a browser fires listeners AND the compiled inline on<type> handler */
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
   THE OP-PREP CARD, IN EACH RENDERER SHAPE THAT EXISTS IN THE REPO
   ------------------------------------------------------------------------
   'shipped'  — ScribeFlow.html:15858:  id="opPrepProc_<i>" + oninput=...
   'noid'     — ScribeFlow-staging.html:11587 / ScribeFlow_test.html:10069:
                the same input with NO id, oninput=...
   'legacy'   — the shape fillProcInputs was written against: onchange=...
                Nothing emits it today; it is kept working so a renderer that
                moves back to `change` does not silently kill the fill again.
   ==================================================================== */
const TPL_ID = 'tpl-a';
const TPL_NAME = 'Left L4-L5 epidural steroid injection';

function build(nRows, shape) {
  shape = shape || 'shipped';
  const doc = makeDom();
  const mk = doc._mk;
  function div(id, parent) { const n = mk('div'); if (id) n.setAttribute('id', id); (parent || doc.body).appendChild(n); return n; }

  const modal = div('opPrepModal');
  modal.classList.add('modal-bg'); modal.classList.add('show');
  const panel = div('oprPanelProcs', modal);
  const editor = div('oprEditor', panel);
  const list = div('opPrepList', editor);
  const genAll = mk('button'); genAll.setAttribute('id', 'opPrepGenAllBtn'); editor.appendChild(genAll);
  div('opPrepStatus', modal);

  const rows = [];
  for (let i = 0; i < nRows; i++) {
    rows.push({
      appt: { name: 'AA' + i + ' BB' + i, dob: '', mrn: '' },
      patientId: 'p-' + i, proc: '', tplId: '', tplManual: false,
      gen: false, note: '', missing: [], values: {}
    });
  }

  const procCalls = [];
  const store = {};
  const win = {
    document: doc,
    _opPrep: rows,
    _opPrepMode: nRows > 1 ? 'all' : 'patient',
    getTemplates: () => [{ id: TPL_ID, name: TPL_NAME, text: 'T'.repeat(400) }],
    opNoteBlankTokens: () => [], opNoteBlankCount: () => 0,
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
    opPrepSave: () => {}, opPrepGenerateOne: () => {},
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

  /* the app's own handler, ScribeFlow.html:15786-15791, minus the template
     re-ranking (that is _opRankTemplates' contract, tested elsewhere). What
     matters here is that being filled programmatically notifies the app the
     same way typing does: row.proc updated, live preview repainted. */
  win._opProcChanged = function (i, v) {
    procCalls.push({ i: i, v: v });
    const row = rows[i]; if (!row) return;
    row.proc = v;
    const prev = doc.getElementById('opPrepPrev_' + i);
    if (prev) prev.innerHTML = 'Preview: ' + v;
  };

  function procMarkup(i) {
    const handler = (shape === 'legacy' ? 'onchange' : 'oninput') + '="_opProcChanged(' + i + ',this.value)"';
    const id = (shape === 'shipped' ? ' id="opPrepProc_' + i + '"' : '');
    return '<input' + id + ' value="" ' + handler + '>';
  }

  function render() {
    let h = '';
    for (let i = 0; i < rows.length; i++) {
      h += '<div>';
      h += '<div id="opPrepPrev_' + i + '">preview</div>';
      h += '<label class="mini">Procedure</label>';
      h += '<div>' + procMarkup(i) + '<button>Match template</button></div>';
      h += '<div><span class="mini">Template:</span><select id="opPrepTpl_' + i + '">'
        + '<option value="">-</option><option value="' + TPL_ID + '">' + TPL_NAME + '</option></select>'
        + '<button class="btn-primary">Re-draft</button></div>';
      h += '</div>';
    }
    list.innerHTML = h;
    compileInlineHandlers(list, win);
    render.n++;
  }
  render.n = 0;
  win.opPrepRender = function () { render(); return 'base'; };

  return { doc, win, rows, list, render, procCalls, shape };
}

/* A browser compiles an inline handler ATTRIBUTE into a real handler property.
   The stub parser only stores attributes, so do that compile step here — once,
   generically, from whichever attribute the scenario's markup carries. Without
   this the dispatched `input` event would reach nothing and scenario 1c would
   pass vacuously. */
function compileInlineHandlers(root, win) {
  root.querySelectorAll('input').forEach(inp => {
    ['oninput', 'onchange'].forEach(evt => {
      const src = inp.getAttribute(evt);
      const m = src && /^_opProcChanged\((\d+),this\.value\)$/.exec(src);
      if (!m) return;
      inp[evt] = function () { win._opProcChanged(+m[1], inp.value); };
    });
  });
}

function load(src, win, doc) {
  new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'Event', 'getComputedStyle', 'console', src)(
    win, doc, win.localStorage, win.setTimeout, win.clearTimeout,
    win.setInterval, win.clearInterval, win.Event, win.getComputedStyle, win.console);
}

/* read the Procedure input the way a doctor reads the card: the input that sits
   next to the "Procedure" label on row i, found without assuming an id exists */
function procInput(env, i) {
  const card = env.list.children[i];
  if (!card) return null;
  return card.querySelectorAll('input')[0] || null;
}
function procValues(env, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const p = procInput(env, i); out.push(p ? p.value : '(no input)'); }
  return out;
}

/* ======================================================================
   0. THE DEAD GUARD, REPRODUCED — the old lookup over the shipped shape
   ================================================================== */
head('0. the onchange-only lookup finds nothing in the shipped markup');
{
  const env = build(3, 'shipped');
  env.win.opPrepRender();
  const inputs = env.doc.getElementById('opPrepModal').querySelectorAll('input');
  const oldHits = inputs.filter(inp => /_opProcChanged\((\d+)/.test(String(inp.getAttribute('onchange') || '')));
  const newHits = inputs.filter(inp => /^opPrepProc_\d+$/.test(String(inp.id || '')));
  ok(inputs.length === 3, '0a: (setup) the modal holds one Procedure input per row', 'inputs=' + inputs.length);
  ok(oldHits.length === 0, '0b: the OLD onchange lookup matches ZERO inputs — the dead guard',
    'matched ' + oldHits.length);
  ok(newHits.length === 3, '0c: the id shape the fix keys off matches every row',
    'matched ' + newHits.length);
}

/* ======================================================================
   1. THE REAL SEQUENCE — bulk-assign a template, look at the card
   ================================================================== */
head('1. assign a template in bulk, then look at the card');
{
  const env = build(3, 'shipped');
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  const onf = env.win.__mlsOpNoteFill;
  ok(!!onf && onf.installed, '1a: (setup) the fill module installed');

  onf.tick();                                     /* the bar is injected on a tick */
  const sel = env.doc.getElementById('mlsOnfBulkSel');
  if (!ok(!!sel, '1a2: (setup) the bulk template picker is on screen')) {
    ok(false, '1b: the visible Procedure input carries the assigned procedure', 'skipped — no bulk picker');
  } else {
    sel.value = TPL_ID;
    onf.applyBulk(false);                         /* "Apply to all" */
    ok(env.rows.every(r => r.tplId === TPL_ID), '1a3: (setup) every row took the template',
      JSON.stringify(env.rows.map(r => r.tplId)));
    ok(procValues(env, 3).every(v => v === ''), '1a4: (setup) the inputs are still blank — nothing repainted the cards',
      JSON.stringify(procValues(env, 3)));

    onf.tick();
    const vals = procValues(env, 3);
    ok(vals.every(v => v === TPL_NAME), '1b: the visible Procedure input carries the assigned procedure',
      'inputs=' + JSON.stringify(vals));
    ok(env.rows.every(r => r.proc === TPL_NAME), '1b2: and row.proc agrees with what is on screen',
      JSON.stringify(env.rows.map(r => r.proc)));
    const prev = env.doc.getElementById('opPrepPrev_0');
    ok(!!prev && prev.textContent === 'Preview: ' + TPL_NAME,
      '1c: the card\'s live preview repainted — the app was notified as if typed',
      prev ? JSON.stringify(prev.textContent) : '(no preview node)');
    ok(env.procCalls.length === 3 && env.procCalls.every((c, i) => c.i === i && c.v === TPL_NAME),
      '1d: _opProcChanged fired exactly once per row, with that row\'s index',
      JSON.stringify(env.procCalls));
  }
}

/* ======================================================================
   2. A TYPED PROCEDURE IS NEVER OVERWRITTEN
   ------------------------------------------------------------------
   The guard keys off the INPUT being empty, not off row.proc, so the two are
   set divergent on purpose: whatever the row says, what the doctor typed wins.
   ================================================================== */
head('2. an input the doctor already typed into is left alone');
{
  const env = build(2, 'shipped');
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  const TYPED = 'Right L5-S1 transforaminal epidural steroid injection';
  env.rows[0].proc = TPL_NAME;
  env.rows[1].proc = TPL_NAME;
  procInput(env, 0).value = TYPED;                /* the doctor typed on row 0 */
  env.procCalls.length = 0;
  env.win.__mlsOpNoteFill.tick();

  ok(procInput(env, 0).value === TYPED, '2a: the typed text is still exactly what he typed',
    JSON.stringify(procInput(env, 0).value));
  ok(env.rows[0].proc === TPL_NAME, '2b: and his row was not rewritten behind him either',
    JSON.stringify(env.rows[0].proc));
  ok(!env.procCalls.some(c => c.i === 0), '2c: no change event was raised for the row he owns',
    JSON.stringify(env.procCalls));
  ok(procInput(env, 1).value === TPL_NAME, '2d: the untouched row beside it still gets filled',
    JSON.stringify(procInput(env, 1).value));
}

/* ======================================================================
   3. NOTHING IS INVENTED — no procedure, no text
   ================================================================== */
head('3. a row with no procedure keeps an empty input');
{
  const env = build(2, 'shipped');
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  env.rows[0].proc = '';
  env.rows[1].proc = '   ';                       /* whitespace is not a procedure */
  env.win.__mlsOpNoteFill.tick();
  ok(procValues(env, 2).every(v => v === ''), '3a: both inputs are still empty',
    JSON.stringify(procValues(env, 2)));
  ok(env.procCalls.length === 0, '3b: and nothing was announced to the app',
    JSON.stringify(env.procCalls));
}

/* ======================================================================
   4. PER-ROW ISOLATION — index N maps to row N
   ================================================================== */
head('4. each input gets its OWN row\'s procedure');
{
  const env = build(4, 'shipped');
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  const want = ['Left L4-L5 ESI', '', 'Right SI joint injection', 'Bilateral L3-L4 MBB'];
  want.forEach((p, i) => { env.rows[i].proc = p; });
  env.win.__mlsOpNoteFill.tick();
  const got = procValues(env, 4);
  ok(JSON.stringify(got) === JSON.stringify(want), '4a: every input shows its own row\'s procedure',
    'want=' + JSON.stringify(want) + '\n        got =' + JSON.stringify(got));
  ok(env.procCalls.every(c => c.v === want[c.i]), '4b: and every notification carried the matching index',
    JSON.stringify(env.procCalls));
}

/* ======================================================================
   5. THE ID-LESS RENDERERS STILL WORK (staging / _test / a legacy onchange)
   ================================================================== */
head('5. the fallback covers the renderers that emit no id');
{
  for (const shape of ['noid', 'legacy']) {
    const env = build(2, shape);
    env.win.opPrepRender();
    load(FILL_SRC, env.win, env.doc);
    env.rows[0].proc = 'Left L4-L5 ESI';
    env.rows[1].proc = 'Right SI joint injection';
    env.win.__mlsOpNoteFill.tick();
    ok(JSON.stringify(procValues(env, 2)) === JSON.stringify(['Left L4-L5 ESI', 'Right SI joint injection']),
      '5' + (shape === 'noid' ? 'a' : 'b') + ': ' + shape + ' markup (no id, ' +
      (shape === 'legacy' ? 'onchange' : 'oninput') + ') fills from the inline handler',
      JSON.stringify(procValues(env, 2)));
  }
}

/* ======================================================================
   6. FREEZE SAFETY — a filled input is written once, not once per second
   ================================================================== */
head('6. once filled, the 1s tick writes nothing more');
{
  const env = build(3, 'shipped');
  env.win.opPrepRender();
  load(FILL_SRC, env.win, env.doc);
  env.rows.forEach(r => { r.proc = TPL_NAME; });
  env.win.__mlsOpNoteFill.tick();
  ok(env.procCalls.length === 3, '6a: (setup) the first tick filled all three', 'calls=' + env.procCalls.length);
  const after = env.procCalls.length;
  for (let k = 0; k < 10; k++) env.win.__mlsOpNoteFill.tick();
  ok(env.procCalls.length === after, '6b: ten further ticks raise ZERO extra events',
    'extra=' + (env.procCalls.length - after));
  ok(procValues(env, 3).every(v => v === TPL_NAME), '6c: and the values are still standing',
    JSON.stringify(procValues(env, 3)));
}

/* ======================================================================
   7. THE SOURCE CONTRACT — what the shipped renderer actually emits
   ------------------------------------------------------------------
   This is the measurement that exposed the dead guard. It is pinned so a
   renderer edit that renames the handler or drops the id fails HERE, loudly,
   instead of silently switching the fill off again for another N builds.
   ================================================================== */
head('7. ScribeFlow.html still emits the shape this fill keys off');
{
  const withId = (APP_SRC.match(/id="opPrepProc_'\+i\+'"/g) || []).length;
  const onInput = (APP_SRC.match(/oninput="_opProcChanged\(/g) || []).length;
  const onChange = (APP_SRC.match(/onchange="_opProcChanged\(/g) || []).length;
  ok(withId === 1, '7a: the Procedure input still carries id="opPrepProc_<i>"', 'occurrences=' + withId);
  ok(onInput === 1, '7b: its handler is still bound to `input`', 'occurrences=' + onInput);
  ok(onChange === 0, '7c: nothing binds _opProcChanged to `change` — the attribute the old lookup read',
    'occurrences=' + onChange);
  ok(/function fillProcInputs\(\)/.test(FILL_SRC) && /procRowIndex/.test(FILL_SRC),
    '7d: fillProcInputs resolves its row through procRowIndex, not a bare onchange read');
  ok(!/getAttribute\('onchange'\)\)\.match\(\/_opProcChanged/.test(FILL_SRC),
    '7e: the onchange-only lookup is gone');
}

/* ====================================================================== */
console.log('');
if (failures) {
  console.log('FAIL ' + failures + ' assertion(s) — the visible Procedure input is not being filled');
  process.exit(1);
}
console.log('PASS the visible Procedure input is filled from row.proc, and typed text is never overwritten');
