'use strict';

/* "USE EVERY TIME" — THE WHOLE ROUND TRIP, BY EXECUTION (2026-07-30)
 *
 * Owner: "Make sure the use every time works." The per-field button under each
 * op-note field is only "working" if the value the doctor pins comes BACK on a
 * later draft. A store that is written and never re-read looks identical to a
 * feature that works, so nothing here is asserted from source text alone:
 *
 *   - the REAL renderer (feat_mls_opnote_fill.js buildFillBox) builds the Fields
 *     box into a DOM double,
 *   - the REAL "☆ Use every time" button that it rendered is CLICKED (its own
 *     production click listener runs — label and value are read out of the
 *     rendered markup, not re-implemented here),
 *   - the value is read back through the REAL resolver (resolveInitialField)
 *     into a NEW row's box, including after a simulated page reload (a second,
 *     independent module instance over the same storage),
 *   - and then the REAL sign-out purge (clinical-state-purge.js) plus the REAL
 *     cloud-prefs key list (PREF_SYNC_KEYS, read out of ScribeFlow.html) decide
 *     whether the pin survives sign-out.
 *
 * The last step is where it breaks, and this file is the proof.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const FILL_SRC = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');
const PURGE_SRC = fs.readFileSync(path.join(root, 'clinical-state-purge.js'), 'utf8');
const SCRIBEFLOW = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

let step = '(start)';
function S(n) { step = n; }
function ok(cond, msg) { assert.ok(cond, step + ' — ' + msg); }
function eq(a, b, msg) { assert.strictEqual(a, b, step + ' — ' + msg + ' (got ' + JSON.stringify(a) + ')'); }

/* ===================================================================== */
/* A DOM double good enough to run the production renderer + handlers.   */
/* innerHTML is really parsed, so querySelectorAll/getElementById find   */
/* the nodes the product wrote, and their listeners are the product's.   */
/* ===================================================================== */
const VOID_TAGS = { input: 1, br: 1, img: 1, hr: 1, meta: 1, link: 1 };

function unesc(s) {
  return String(s == null ? '' : s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function makeDom() {
  const allNodes = [];
  const byId = new Map();

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this._attrs = Object.create(null);
      this.childNodes = [];
      this.parentNode = null;
      this._listeners = Object.create(null);
      this._text = '';
      this._html = '';
      this.style = {};
      this.value = '';
      this.className = '';
      this.id = '';
      this.offsetParent = {};
      const self = this;
      this.classList = {
        contains(c) { return (' ' + (self.className || '') + ' ').indexOf(' ' + c + ' ') >= 0; },
        add(c) { if (!this.contains(c)) self.className = ((self.className || '') + ' ' + c).trim(); },
        remove(c) { self.className = (' ' + (self.className || '') + ' ').split(' ' + c + ' ').join(' ').trim(); },
        toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); }
      };
      allNodes.push(this);
    }
    /* --- attributes --- */
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; }
    setAttribute(n, v) {
      this._attrs[n] = String(v);
      if (n === 'id') { this.id = String(v); byId.set(this.id, this); }
      if (n === 'class') this.className = String(v);
    }
    removeAttribute(n) { delete this._attrs[n]; }
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n); }
    /* --- tree --- */
    get children() { return this.childNodes.filter(n => n instanceof El); }
    appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
    insertBefore(n, ref) {
      if (n.parentNode) n.parentNode.removeChild(n);
      const i = this.childNodes.indexOf(ref);
      n.parentNode = this;
      if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
      return n;
    }
    removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
    replaceChild(nu, old) { const i = this.childNodes.indexOf(old); if (i >= 0) { this.childNodes[i] = nu; nu.parentNode = this; old.parentNode = null; } return old; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const sib = this.parentNode.children, i = sib.indexOf(this);
      return i > 0 ? sib[i - 1] : null;
    }
    closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
    /* --- content --- */
    set innerHTML(html) {
      this.childNodes.length = 0;
      this._html = String(html);
      parseInto(this, this._html);
    }
    get innerHTML() { return this._html; }
    set textContent(t) { this._text = String(t); this.childNodes.length = 0; }
    get textContent() {
      if (!this.childNodes.length) return this._text;
      return this.childNodes.map(n => (n instanceof El ? n.textContent : String(n))).join('');
    }
    get options() { return this.children.filter(n => n.tagName === 'OPTION'); }
    focus() { this._focused = true; }
    /* --- queries --- */
    querySelectorAll(sel) { return descendants(this).filter(n => matches(n, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    /* --- events --- */
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    removeEventListener(type, fn) {
      const a = this._listeners[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    }
    dispatchEvent(ev) {
      const type = ev && ev.type ? ev.type : String(ev);
      (this._listeners[type] || []).slice().forEach(fn => fn.call(this, ev || { type }));
      return true;
    }
    click() { return this.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); }
  }

  function descendants(node) {
    const out = [];
    (function walk(n) { n.children.forEach(c => { out.push(c); walk(c); }); })(node);
    return out;
  }

  /* one-selector matcher: tag / .class / #id / [attr] / [attr="v"] / [attr^="v"],
     plus comma lists and "tag[attr...]" — the shapes the product actually uses */
  function matchOne(node, sel) {
    sel = sel.trim();
    if (!sel) return false;
    /* "#bar .count" (descendant) — only used for the bulk bar, resolve loosely */
    if (/\s/.test(sel)) {
      const parts = sel.split(/\s+/);
      if (!matchOne(node, parts[parts.length - 1])) return false;
      let n = node.parentNode;
      while (n) { if (matchOne(n, parts[0])) return true; n = n.parentNode; }
      return false;
    }
    const m = sel.match(/^([a-zA-Z][a-zA-Z0-9]*)?((?:[#.\[][^#.\[]*\]?)*)$/);
    if (!m) return false;
    if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
    const rest = m[2] || '';
    const re = /#([A-Za-z0-9_:-]+)|\.([A-Za-z0-9_-]+)|\[([a-zA-Z-][a-zA-Z0-9_:.-]*)(?:([\^$*]?=)"([^"]*)")?\]/g;
    let t;
    while ((t = re.exec(rest)) !== null) {
      if (t[1]) { if (node.id !== t[1]) return false; continue; }
      if (t[2]) { if (!node.classList.contains(t[2])) return false; continue; }
      const name = t[3];
      if (!node.hasAttribute(name)) return false;
      if (t[4]) {
        const v = String(node.getAttribute(name));
        if (t[4] === '=' && v !== t[5]) return false;
        if (t[4] === '^=' && v.indexOf(t[5]) !== 0) return false;
        if (t[4] === '*=' && v.indexOf(t[5]) < 0) return false;
      }
    }
    return true;
  }
  function matches(node, sel) { return String(sel).split(',').some(s => matchOne(node, s)); }

  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const ATTR_RE = /([a-zA-Z-][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
  function parseInto(host, html) {
    const stack = [host];
    let last = 0, m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(html)) !== null) {
      const text = html.slice(last, m.index);
      if (text) stack[stack.length - 1].childNodes.push(unesc(text));
      last = m.index + m[0].length;
      const closing = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3] || '', selfClose = m[4] === '/';
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const el = new El(tag);
      let a;
      ATTR_RE.lastIndex = 0;
      while ((a = ATTR_RE.exec(attrs)) !== null) {
        const name = a[1];
        if (!name) continue;
        const raw = a[2] != null ? a[2] : (a[3] != null ? a[3] : (a[4] != null ? a[4] : ''));
        el.setAttribute(name, unesc(raw));
        if (name === 'value') el.value = unesc(raw);
      }
      stack[stack.length - 1].appendChild(el);
      if (!selfClose && !VOID_TAGS[tag]) stack.push(el);
    }
    const tail = html.slice(last);
    if (tail) stack[stack.length - 1].childNodes.push(unesc(tail));
    /* a <select> reports the selected option's value, like a browser does */
    descendants(host).forEach(n => {
      if (n.tagName !== 'SELECT') return;
      const opts = n.options;
      const sel = opts.filter(o => o.hasAttribute('selected'))[0] || opts[0];
      n.value = sel ? String(sel.getAttribute('value') == null ? sel.textContent : sel.getAttribute('value')) : '';
    });
  }

  const documentElement = new El('html');
  const head = new El('head');
  const body = new El('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  function attached(n) { let p = n; while (p) { if (p === body || p === head || p === documentElement) return true; p = p.parentNode; } return false; }

  const document = {
    readyState: 'loading',
    documentElement, head, body,
    createElement(tag) { return new El(tag); },
    getElementById(id) { const n = byId.get(String(id)); return n && attached(n) ? n : (n || null); },
    querySelectorAll(sel) { return allNodes.filter(n => attached(n) && matches(n, sel)); },
    querySelector(sel) { return document.querySelectorAll(sel)[0] || null; },
    addEventListener() {}, removeEventListener() {}
  };
  return { document, El, body };
}

/* --------------------------- storage double ---------------------------- */
const store = new Map();
const localStorage = {
  get length() { return store.size; },
  key(i) { return Array.from(store.keys())[i]; },
  getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
  setItem(k, v) { store.set(String(k), String(v)); },
  removeItem(k) { store.delete(String(k)); },
  clear() { store.clear(); }
};

/* --------------------------- module loader ---------------------------- */
let account = '_';
const toasts = [];
function loadFill(opts) {
  opts = opts || {};
  const tpls = opts.templates || [];
  const dom = makeDom();
  const ctx = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error, isNaN, parseInt, parseFloat,
    document: dom.document,
    localStorage,
    Event: function Event(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    getComputedStyle() { return { display: 'none' }; },
    uns(suffix) { return 'sf_u::' + account + '::' + suffix; },
    toast(m, k) { toasts.push({ m: String(m), k: String(k || '') }); },
    getPatients() { return []; },
    getTemplates() { return tpls; },
    getTemplateById(id) { return tpls.filter(t => t.id === id)[0] || null; },
    getOpFieldVals() { return []; }, addOpFieldVal() {},
    activePatient() { return null; },
    _opPrep: []
  };
  ctx.window = ctx;
  vm.runInNewContext(FILL_SRC, ctx, { filename: 'feat_mls_opnote_fill.js' });
  return { ctx, dom, api: ctx.__mlsOpNoteFill };
}

/* a textarea + its container, attached to the document like the real modal */
function makeDraft(dom, idx, note) {
  const wrap = dom.document.createElement('div');
  dom.body.appendChild(wrap);
  const ta = dom.document.createElement('textarea');
  ta.setAttribute('id', 'opPrepNote_' + idx);
  ta.value = note;
  wrap.appendChild(ta);
  return ta;
}
function boxOf(dom, ta) {
  return dom.document.querySelectorAll('.onf-fillbox').filter(b => b.getAttribute('data-onf-for') === ta.id)[0] || null;
}

/* ===================================================================== */
S('STEP 1 — the module installs and the button tier exists');
let L = loadFill();
ok(L.api && L.api.installed, 'feat_mls_opnote_fill.js did not install');
console.log('  onf version:', L.api.version);

S('STEP 2 — signed OUT: nothing may be written to a shared namespace');
eq(L.api._setAnyDefault('needle gauge', '22-gauge, 3.5-inch'), false, 'a signed-out pin was accepted');
eq(store.size, 0, 'a signed-out pin touched storage');

account = 'doctor-a@example.test';

S('STEP 3 — the REAL renderer draws the "Use every time" button');
const RAW0 = 'PROCEDURE NOTE\nNeedle: [FILL: needle gauge]\nApproach: [FILL: approach]\n';
L.ctx._opPrep = [{ patientId: '', tplId: '', proc: 'Right L4-L5 transforaminal ESI', appt: {}, note: RAW0 }];
const ta0 = makeDraft(L.dom, 0, RAW0);
L.api._buildFillBox(ta0);
let box0 = boxOf(L.dom, ta0);
ok(box0, 'no Fields box was rendered at all');
const useBtns = box0.querySelectorAll('[data-onf-default-act="save"]');
ok(useBtns.length >= 2, 'the button is not under every reusable field (found ' + useBtns.length + ')');
const needleBtn = useBtns.filter(b => b.getAttribute('data-onf-default-label') === 'needle gauge')[0];
ok(needleBtn, 'no "Use every time" button under "needle gauge"');
ok(/☆ Use every time/.test(box0.innerHTML), 'the rendered label is not "☆ Use every time"');
const ctrlId = needleBtn.getAttribute('data-onf-default-control');
const ctrl0 = L.ctx.document.getElementById(ctrlId);
ok(ctrl0, 'the button points at control #' + ctrlId + ' which does not exist — the click could never read a value');

S('STEP 4 — the doctor picks a value (production change handler)');
const PIN = '22-gauge, 3.5-inch';
if (ctrl0.tagName === 'SELECT') {
  const opt = L.ctx.document.createElement('option');
  opt.setAttribute('value', PIN); opt.textContent = PIN; ctrl0.appendChild(opt);
}
ctrl0.value = PIN;
ctrl0.dispatchEvent({ type: 'change' });
eq(L.ctx._opPrep[0]._onfVals['needle gauge'], PIN, 'the change handler did not record the value');
ok(ta0.value.indexOf(PIN) >= 0, 'the draft was not re-rendered with the chosen value');

S('STEP 5 — CLICK the real button: the pin is written');
needleBtn.click();
const saved = toasts.filter(t => /will fill the same field in future op notes/.test(t.m));
eq(saved.length, 1, 'the click did not report a save (toasts: ' + JSON.stringify(toasts.map(t => t.m)) + ')');
const KEY_USER = 'sf_u::doctor-a@example.test::opFieldDefaultsUserV1';
ok(store.has(KEY_USER), 'the pin did not land in ' + KEY_USER + ' (keys: ' + Array.from(store.keys()).join(', ') + ')');
const rec = JSON.parse(store.get(KEY_USER));
eq(rec.fields.needle_gauge.value, PIN, 'the stored value is wrong');
console.log('  stored key   :', KEY_USER);
console.log('  stored shape :', JSON.stringify(rec).slice(0, 160));

S('STEP 6 — a NEW row gets it back through the real resolver');
const RAW1 = 'PROCEDURE NOTE\nNeedle: [FILL: needle gauge]\n';
L.ctx._opPrep[1] = { patientId: '', tplId: '', proc: 'Left knee injection', appt: {}, note: RAW1 };
const ta1 = makeDraft(L.dom, 1, RAW1);
L.api._buildFillBox(ta1);
const box1 = boxOf(L.dom, ta1);
ok(box1, 'the new row got no Fields box');
ok(ta1.value.indexOf(PIN) >= 0, 'THE PIN DID NOT COME BACK — new draft still reads: ' + JSON.stringify(ta1.value));
ok(/applied from your defaults/.test(box1.innerHTML), 'the value came back unlabelled (no "applied from your defaults" chip)');
eq(L.api._resolveInitialField('needle gauge', { patientId: '', appt: {} }, {}).kind, 'default', 'resolveInitialField does not classify it as a default');
console.log('  ROUND TRIP  : PASS (button -> store -> new row, same session)');

S('STEP 7 — survives a page RELOAD (independent module instance, same storage)');
const R = loadFill();
const RAW2 = 'Needle: [FILL: needle gauge]\n';
R.ctx._opPrep = [{ patientId: '', tplId: '', proc: 'Right shoulder injection', appt: {}, note: RAW2 }];
const ta2 = makeDraft(R.dom, 0, RAW2);
R.api._buildFillBox(ta2);
ok(ta2.value.indexOf(PIN) >= 0, 'after reload the pin did not reapply: ' + JSON.stringify(ta2.value));
console.log('  RELOAD      : PASS');

S('STEP 8 — scope: the pin is GLOBAL (every template, every procedure) and lands in the COLLAPSED block');
const box2 = boxOf(R.dom, ta2);
ok(/<details class="onf-auto">/.test(box2.innerHTML), 'the auto-filled fold is gone');
ok(box2.innerHTML.indexOf('applied from your defaults') > box2.innerHTML.indexOf('<details class="onf-auto">'),
  'a pinned value is NOT inside the collapsed fold (this assertion documents current behaviour)');
console.log('  scope       : pinned on a lumbar ESI, applied to a shoulder injection — one global slug per label,');
console.log('                and it renders inside the collapsed "filled automatically" fold.');

S('STEP 9 — the key is a SLUG of the label: punctuation collides, a rename orphans');
eq(R.api.getDefault('Needle-Gauge'), PIN, 'the slug is not punctuation/case-insensitive');
eq(R.api.getDefault('NEEDLE GAUGE'), PIN, 'the slug is not case-insensitive');
eq(R.api.getDefault('needle length'), '', 'two DIFFERENT fields collided on one slug');
eq(R.api.getDefault('gauge of needle'), '', 'unexpected: a renamed label still resolves');
eq(R.api._resolveInitialField('gauge of needle', { patientId: '', appt: {} }, {}).kind !== 'default', true,
  'a renamed label must not resolve to the old pin');
ok(store.has(KEY_USER) && JSON.parse(store.get(KEY_USER)).fields.needle_gauge,
  'the orphaned record should still be sitting in the store (nothing prunes or lists it)');
console.log('  identity    : slug = lowercase(label) with [^a-z0-9]+ -> "_"; a template label rename silently');
console.log('                orphans the pin and the orphan stays in the store with no surface that lists it.');

S('STEP 10 — SIGN-OUT: the real purge + the real cloud-prefs key list');
/* also pin a TIER-1 field, for the contrast */
eq(R.api._setAnyDefault('equipment model', 'OEC Elite 9900'), true, 'tier-1 pin failed');
const KEY_T1 = 'sf_u::doctor-a@example.test::opFieldDefaultsV1';
ok(store.has(KEY_T1), 'tier-1 pin did not land in ' + KEY_T1);

/* the product's own cloud-sync key list, read out of ScribeFlow.html */
const listSrc = SCRIBEFLOW.match(/const PREF_SYNC_KEYS=\[([\s\S]*?)\];/);
ok(listSrc, 'PREF_SYNC_KEYS could not be located in ScribeFlow.html');
const PREF_SYNC_KEYS = vm.runInNewContext('[' + listSrc[1] + ']');
console.log('  PREF_SYNC_KEYS count:', PREF_SYNC_KEYS.length);
eq(PREF_SYNC_KEYS.indexOf('opFieldDefaultsV1') >= 0, true, 'tier 1 is not cloud-synced');
const tier2Synced = PREF_SYNC_KEYS.indexOf('opFieldDefaultsUserV1') >= 0;

/* syncPrefsToServer: whitelisted uns() keys -> one server blob */
const serverBlob = {};
PREF_SYNC_KEYS.forEach(k => { const v = localStorage.getItem('sf_u::doctor-a@example.test::' + k); if (v !== null) serverBlob[k] = v; });

/* logout() -> window.__mlsClinicalStatePurge.purge(email) — the real module */
const purgeCtx = {
  console, Promise, Date, JSON, Object, String, Number, Array, RegExp, Error,
  localStorage, sessionStorage: { clear() {} }, setTimeout(fn) { fn(); return 1; }
};
purgeCtx.window = purgeCtx;
vm.runInNewContext(PURGE_SRC, purgeCtx, { filename: 'clinical-state-purge.js' });
const purgeResult = purgeCtx.__mlsClinicalStatePurge.purge('doctor-a@example.test');
ok(purgeResult.removedLocal.indexOf(KEY_USER) >= 0, 'expected the purge to remove ' + KEY_USER);
eq(store.has(KEY_USER), false, 'the explicit-tier pin survived the purge');
eq(store.has(KEY_T1), false, 'the tier-1 pin survived the purge');
console.log('  sign-out purge removed ' + purgeResult.removedLocal.length + ' account keys, including BOTH default stores.');

/* loadPrefsFromServer: fills LOCAL GAPS from the blob on next login */
PREF_SYNC_KEYS.forEach(k => {
  if (!Object.prototype.hasOwnProperty.call(serverBlob, k)) return;
  const lk = 'sf_u::doctor-a@example.test::' + k;
  const local = localStorage.getItem(lk);
  if (local === null || local === '') localStorage.setItem(lk, serverBlob[k]);
});

eq(store.has(KEY_T1), true, 'tier 1 was not restored from the account — the sync list changed');
const P = loadFill();
eq(P.api.getDefault('equipment model'), 'OEC Elite 9900', 'tier-1 pin did not come back after sign-out + sign-in');

/* THE DEFECT: the explicit tier is not in the sync list, so it is gone for good */
eq(tier2Synced, false,
  'GOOD NEWS: opFieldDefaultsUserV1 is now in PREF_SYNC_KEYS — delete this assertion and flip the two below');
eq(store.has(KEY_USER), false, 'unexpected: the explicit tier came back');
const after = P.api._resolveInitialField('needle gauge', { patientId: '', appt: {} }, {});
eq(after.kind === 'default', false, 'unexpected: the pin reapplied after sign-out');
eq(P.api.getDefault('needle gauge'), '', 'unexpected: the pin is still readable');

const RAW3 = 'Needle: [FILL: needle gauge]\n';
P.ctx._opPrep = [{ patientId: '', tplId: '', proc: 'Right L4-L5 transforaminal ESI', appt: {}, note: RAW3 }];
const ta3 = makeDraft(P.dom, 0, RAW3);
P.api._buildFillBox(ta3);
ok(ta3.value.indexOf(PIN) < 0, 'unexpected: the draft still carries the pinned value');
ok(/☆ Use every time/.test(boxOf(P.dom, ta3).innerHTML), 'the button is back to unpinned — the doctor must pin it again');

S('STEP 11 — a TEMPLATE line silently outranks the pin, and the pin loses its own controls');
account = 'doctor-c@example.test';
const TPL = { id: 't1', name: 'TFESI', text: 'PROCEDURE NOTE\nApproach: Transforaminal\nSide: [FILL: side]\n' };
const T = loadFill({ templates: [TPL] });
eq(T.api._setAnyDefault('approach', 'Paramedian'), true, 'could not pin "approach"');
eq(T.api._resolveInitialField('approach', { patientId: '', tplId: '', proc: 'ESI', appt: {} }, {}).value, 'Paramedian',
  'the pin does not apply without a template');
const viaTpl = T.api._resolveInitialField('approach', { patientId: '', tplId: 't1', proc: 'ESI', appt: {} }, {});
eq(viaTpl.kind, 'template', 'expected the template line to win');
eq(viaTpl.value, 'Transforaminal', 'expected the template value');
eq(T.api.getDefault('approach'), 'Paramedian', 'the pin is still stored while being ignored');
const RAW4 = 'Approach: [FILL: approach]\n';
T.ctx._opPrep = [{ patientId: '', tplId: 't1', proc: 'ESI', appt: {}, note: RAW4 }];
const ta4 = makeDraft(T.dom, 0, RAW4);
T.api._buildFillBox(ta4);
const box4 = boxOf(T.dom, ta4);
eq(box4.querySelectorAll('[data-onf-default-label="approach"]').length, 0,
  'expected NO default controls on a template-sourced field (reusableSurface excludes kind "template")');
ok(/from template/.test(box4.innerHTML), 'the template chip is missing');
console.log('  pinned "Paramedian", template says "Transforaminal" -> the note gets Transforaminal,');
console.log('  the pin is still stored, and neither "Change default" nor "Stop using" is rendered.');

S('STEP 12 — SAFETY: laterality and level are pinnable, and a pin overrides the procedure');
const H = loadFill();
const LEFT_ROW = { patientId: '', tplId: '', proc: 'Left knee injection', appt: {} };
const beforePin = H.api._resolveInitialField('side', LEFT_ROW, {});
eq(beforePin.kind, 'suggested', 'unpinned "side" is no longer a reviewed suggestion');
eq(beforePin.value, 'Left', 'unpinned "side" no longer follows the procedure');
eq(H.api._defaultOffered('side'), true, 'GOOD NEWS: "side" is no longer offered — update this assertion');
eq(H.api._setAnyDefault('side', 'Right'), true, 'GOOD NEWS: "side" can no longer be pinned — update this assertion');
const afterPin = H.api._resolveInitialField('side', LEFT_ROW, {});
eq(afterPin.kind, 'default', 'unexpected: the pin did not win');
eq(afterPin.value, 'Right', 'unexpected: the pin did not override the procedure-derived side');
eq(H.api._setAnyDefault('level', 'L5-S1'), true, 'GOOD NEWS: "level" can no longer be pinned');
eq(H.api._resolveInitialField('level', { patientId: '', tplId: '', proc: 'Right L4-L5 TFESI', appt: {} }, {}).value, 'L5-S1',
  'unexpected: the level pin did not apply');
/* and it renders folded away instead of in the ask list */
const RAW5 = 'Side: [FILL: side]\n';
H.ctx._opPrep = [{ patientId: '', tplId: '', proc: 'Left knee injection', appt: {}, note: RAW5 }];
const ta5 = makeDraft(H.dom, 0, RAW5);
H.api._buildFillBox(ta5);
const box5 = boxOf(H.dom, ta5);
ok(ta5.value.indexOf('Right') >= 0, 'the LEFT procedure draft did not take the pinned Right');
ok(box5.innerHTML.indexOf('applied from your defaults') > box5.innerHTML.indexOf('<details class="onf-auto">'),
  'the wrong-side value is not inside the collapsed fold');
console.log('  proc "Left knee injection": unpinned -> amber "Left" in the ASK list;');
console.log('  after pinning Right       -> note reads "Right", inside the COLLAPSED fold.');

S('STEP 13 — sweep: which real template labels offer the button');
const SWEEP = ['side', 'laterality', 'level', 'levels', 'needle gauge', 'gauge', 'gauge/tip', 'interval',
  'steroid + dose', 'facility name', 'practice name', 'contrast volume', 'anesthetic + volume', 'minutes',
  'fluoro time', 'equipment model', 'approach', 'sedation if any', 'temperature', 'thresholds',
  'muscles/regions', 'radicular pain distribution', 'consent details', 'diluent + volume', 'agent + volume',
  'patient name', 'date of procedure', 'diagnosis'];
const W = loadFill();
let offered = 0;
const rows = SWEEP.map(l => {
  const on = W.api._defaultOffered(l);
  if (on) offered++;
  return { label: l, offered: on, tier: W.api._defaultEligible(l) ? 1 : (W.api._userDefaultEligible(l) ? 2 : 0) };
});
console.log('  ' + offered + ' of ' + SWEEP.length + ' real [FILL:] labels offer "Use every time".');
console.log('  refused: ' + rows.filter(r => !r.offered).map(r => r.label).join(', '));
ok(rows.filter(r => r.label === 'side')[0].tier === 2, 'the sweep no longer classifies side in the explicit tier');
ok(offered >= 20, 'the button is offered under far fewer fields than expected (' + offered + ')');

console.log('');
console.log('  ================= MEASURED RESULT =================');
console.log('  same session      : PIN APPLIES      (button -> store -> new row)');
console.log('  after reload      : PIN APPLIES      (localStorage, account-scoped)');
console.log('  after SIGN-OUT    : PIN IS DESTROYED and CANNOT be restored');
console.log('     logout() -> __mlsClinicalStatePurge.purge() removes every');
console.log('     sf_u::<email>::* key (clinical-state-purge.js:41-47), and');
console.log('     ScribeFlow.html PREF_SYNC_KEYS carries opFieldDefaultsV1 but');
console.log('     NOT opFieldDefaultsUserV1 — so tier 1 comes back from the');
console.log('     account and every button-pressed pin does not.');
console.log('     Same path fires on the 15-minute idle logout (ScribeFlow.html:8029)');
console.log('     and on token expiry (ScribeFlow.html:7036-7038), neither of which asks.');
console.log('     FIX: add \'opFieldDefaultsUserV1\' to PREF_SYNC_KEYS (ScribeFlow.html:8311).');
console.log('  template speaks   : PIN IS IGNORED, silently, and its own Change/Stop');
console.log('                      controls are not rendered (feat_mls_opnote_fill.js:1157 + 1246).');
console.log('  side / level      : PINNABLE, and the pin OVERRIDES the procedure-derived');
console.log('                      laterality, folded into the collapsed block.');
console.log('  ==================================================');
console.log('');
console.log('PASS use-every-time round trip: writer, reader, reload proven by execution;');
console.log('     sign-out loss, template shadowing and the laterality hazard all proven the same way.');
