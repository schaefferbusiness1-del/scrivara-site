'use strict';
/* AI Studio's Ask / Practice / Build switcher: ONE CELL, ONE PANEL.
 *
 * The owner photographed "Practice trends" and the NATURAL-LANGUAGE STUDY
 * BUILDER card painted on top of each other, text over text, unreadable.
 * Cause: #studioView is a CSS grid whose children are placed EXPLICITLY, and
 * two of them were placed in the same cell while both visible --
 *   feat_mls_studio_exact.js:98   #studioView.sx-grid>#mlsSgPro, >#mlsStudyRequest,
 *                                 >#mls-sg-root, >#mlsB39SgWrap
 *                                 {grid-column:1/-1!important;grid-row:3!important}
 *   feat_mls_studio_merge.js      body.mls-sm #studioView > #analysisView
 *                                 {grid-column:1 / -1;grid-row:3}
 * -- and #mlsSgPro (the host feat_mls_study_request.js mounts the builder into)
 * was in NO section's member list, so the switcher had no hide rule for it and
 * it stayed visible under every tab.
 *
 * This file does not grep for the fix. It RUNS both modules against a stub DOM,
 * captures the stylesheets they actually inject, resolves the cascade for every
 * (tab x viewport) state, and asserts no two visible panels land in one cell.
 * Assertion F re-runs the same resolver against the pre-fix member list and
 * requires it to FAIL -- so the suite is a detector, not a tautology.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.env.STUDIO_TABS_ROOT || path.resolve(__dirname, '..');

const failures = [];
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL ' + name + ' -- ' + e.message); }
}

/* ===================================================== stub DOM + module run */

function makeDom() {
  const ids = new Map();
  const styles = [];

  function Style() { this._p = {}; }
  Style.prototype.setProperty = function (k, v) { this._p[k] = v; };
  Style.prototype.getPropertyValue = function (k) { return this._p[k] || ''; };
  Style.prototype.removeProperty = function (k) { delete this._p[k]; };
  Object.defineProperty(Style.prototype, 'cssText', { get() { return ''; }, set() {} });
  ['display', 'height', 'scrollTop', 'opacity', 'pointerEvents'].forEach(function (p) {
    Object.defineProperty(Style.prototype, p, {
      get() { return this._p[p] === undefined ? '' : this._p[p]; },
      set(v) { this._p[p] = v; }
    });
  });

  function El(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.attrs = Object.create(null);
    this.style = new Style();
    this._id = '';
    this._text = '';
    this.innerHTML = '';
    this.parentElement = null;
    this.parentNode = null;
    const self = this;
    this.classList = {
      _s: [],
      contains(c) { return this._s.indexOf(c) >= 0; },
      add() { for (const c of arguments) if (this._s.indexOf(c) < 0) this._s.push(c); self.attrs.class = this._s.join(' '); },
      remove() { for (const c of arguments) { const i = this._s.indexOf(c); if (i >= 0) this._s.splice(i, 1); } self.attrs.class = this._s.join(' '); },
      toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; }
    };
  }
  Object.defineProperty(El.prototype, 'id', {
    get() { return this._id; },
    set(v) { this._id = v; this.attrs.id = v; if (v) ids.set(v, this); }
  });
  Object.defineProperty(El.prototype, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); if (this.tagName === 'STYLE') styles.push(this); }
  });
  Object.defineProperty(El.prototype, 'className', {
    get() { return this.classList._s.join(' '); },
    set(v) { this.classList._s = String(v).split(/\s+/).filter(Boolean); this.attrs.class = v; }
  });
  Object.defineProperty(El.prototype, 'childNodes', { get() { return this.children; } });
  Object.defineProperty(El.prototype, 'firstChild', { get() { return this.children[0] || null; } });
  Object.defineProperty(El.prototype, 'nextSibling', {
    get() {
      if (!this.parentElement) return null;
      const i = this.parentElement.children.indexOf(this);
      return this.parentElement.children[i + 1] || null;
    }
  });
  Object.defineProperty(El.prototype, 'previousSibling', {
    get() {
      if (!this.parentElement) return null;
      const i = this.parentElement.children.indexOf(this);
      return i > 0 ? this.parentElement.children[i - 1] : null;
    }
  });
  El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); };
  El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
  El.prototype.hasAttribute = function (k) { return k in this.attrs; };
  El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
  El.prototype.addEventListener = function () {};
  El.prototype.removeEventListener = function () {};
  El.prototype.appendChild = function (n) {
    if (n.parentElement) n.parentElement.removeChild(n);
    this.children.push(n); n.parentElement = this; n.parentNode = this; return n;
  };
  El.prototype.removeChild = function (n) {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parentElement = null; n.parentNode = null; return n;
  };
  El.prototype.insertBefore = function (n, ref) {
    if (n.parentElement) n.parentElement.removeChild(n);
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    n.parentElement = this; n.parentNode = this; return n;
  };
  El.prototype.remove = function () { if (this.parentElement) this.parentElement.removeChild(this); };
  El.prototype.contains = function (n) { return n === this || this.children.some(c => c.contains(n)); };
  El.prototype.closest = function () { return null; };
  El.prototype.getBoundingClientRect = function () { return { width: 320, height: 44, x: 0, y: 0, top: 0, left: 0 }; };
  El.prototype.querySelectorAll = function (sel) { return queryAll(sel, this); };
  El.prototype.querySelector = function (sel) { return queryAll(sel, this)[0] || null; };

  /* Only the shapes these two modules actually ask for. Anything else returns
     nothing, which both modules treat as "not mounted yet" and survive. */
  function queryAll(sel, scope) {
    sel = String(sel).trim();
    let m = /^#([\w-]+)\s+\[([\w-]+)\]$/.exec(sel);
    if (m) { const host = ids.get(m[1]); return host ? host.children.filter(c => m[2] in c.attrs) : []; }
    m = /^#([\w-]+)\s+\.([\w-]+)$/.exec(sel);
    if (m) { const host = ids.get(m[1]); return host ? host.children.filter(c => c.classList.contains(m[2])) : []; }
    m = /^:scope\s*>\s*\.([\w-]+)$/.exec(sel);
    if (m && scope) return scope.children.filter(c => c.classList.contains(m[1]));
    m = /^\.([\w-]+)$/.exec(sel);
    if (m && scope) return scope.children.filter(c => c.classList.contains(m[1]));
    return [];
  }

  const doc = {
    readyState: 'complete',
    createElement(t) { return new El(t); },
    getElementById(id) { return ids.get(id) || null; },
    querySelector(sel) { return queryAll(sel, null)[0] || null; },
    querySelectorAll(sel) { return queryAll(sel, null); },
    addEventListener() {},
    removeEventListener() {}
  };
  doc.documentElement = new El('html');
  doc.head = new El('head');
  doc.body = new El('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  const studio = new El('div');
  studio.id = 'studioView';
  doc.body.appendChild(studio);

  return { doc, ids, styles, El, studio };
}

function runModules() {
  const dom = makeDom();
  const sandbox = {
    document: dom.doc,
    location: { search: '', pathname: '/ScribeFlow.html', href: 'https://mlsscribe.com/ScribeFlow.html' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    requestAnimationFrame() { return 0; },
    requestIdleCallback() { return 0; },
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
    console: { warn() {}, error() {}, log() {} },
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    __MLS_SX_PROD: 1
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  /* sx first, merge second -- that is the live order (sx boots on DOM ready,
     merge is appended on requestIdleCallback), and later-in-head wins ties. */
  const sheets = {};
  vm.runInContext(fs.readFileSync(path.join(root, 'feat_mls_studio_exact.js'), 'utf8'), sandbox, { filename: 'feat_mls_studio_exact.js' });
  sheets.sx = (dom.ids.get('sxStyle') || {}).textContent || '';
  vm.runInContext(fs.readFileSync(path.join(root, 'feat_mls_studio_merge.js'), 'utf8'), sandbox, { filename: 'feat_mls_studio_merge.js' });
  sheets.merge = (dom.ids.get('mlsStudioMergeCss') || {}).textContent || '';
  return { dom, sandbox, sheets };
}

const RUN = runModules();

/* ============================================================== css cascade */

function parseCss(text, origin) {
  const rules = [];
  let i = 0;
  (function block(media) {
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === '}') { i++; return; }
      const brace = text.indexOf('{', i);
      if (brace < 0) { i = text.length; return; }
      const head = text.slice(i, brace).trim();
      i = brace + 1;
      if (/^@media/i.test(head)) { block(head.replace(/^@media\s*/i, '').trim()); continue; }
      const end = text.indexOf('}', i);
      const body = text.slice(i, end < 0 ? text.length : end);
      i = (end < 0 ? text.length : end) + 1;
      if (head) rules.push({ sel: head, body, media, origin, order: rules.length });
    }
  })(null);
  return rules;
}

const RULES = []
  .concat(parseCss(RUN.sheets.sx, 0))
  .concat(parseCss(RUN.sheets.merge, 1))
  .map((r, n) => (r.seq = n, r));

function mediaActive(cond, vw) {
  if (!cond) return true;
  if (/prefers-reduced-motion/.test(cond)) return false;
  const m = /max-width:\s*(\d+)px/.exec(cond);
  if (m) return vw <= Number(m[1]);
  return false;
}

function parseCompound(str) {
  const c = { tag: null, id: null, classes: [], nots: [], attrs: 0, pseudos: 0 };
  let i = 0;
  while (i < str.length) {
    const rest = str.slice(i);
    let m;
    if ((m = /^#([\w-]+)/.exec(rest))) { c.id = m[1]; i += m[0].length; }
    else if ((m = /^\.([\w-]+)/.exec(rest))) { c.classes.push(m[1]); i += m[0].length; }
    else if ((m = /^:not\(([^)]*)\)/.exec(rest))) { c.nots.push(parseCompound(m[1].trim())); i += m[0].length; }
    else if ((m = /^::?[\w-]+(\([^)]*\))?/.exec(rest))) { c.pseudos++; i += m[0].length; }
    else if ((m = /^\[[^\]]*\]/.exec(rest))) { c.attrs++; i += m[0].length; }
    else if ((m = /^[\w-]+|^\*/.exec(rest))) { c.tag = m[0]; i += m[0].length; }
    else i++;
  }
  return c;
}

function compoundSpec(c) {
  const s = [c.id ? 1 : 0, c.classes.length + c.attrs + c.pseudos, c.tag && c.tag !== '*' ? 1 : 0];
  c.nots.forEach(n => { const t = compoundSpec(n); s[0] += t[0]; s[1] += t[1]; s[2] += t[2]; });
  return s;
}

function parseSelector(sel) {
  const seq = [];
  const tokens = sel.trim().split(/(\s*>\s*|\s+)/).filter(t => t !== '');
  let combinator = null;
  tokens.forEach(t => {
    if (/^\s*>\s*$/.test(t)) combinator = 'child';
    else if (/^\s+$/.test(t)) combinator = 'descendant';
    else { seq.push({ compound: parseCompound(t), combinator }); combinator = null; }
  });
  const spec = [0, 0, 0];
  seq.forEach(s => { const t = compoundSpec(s.compound); spec[0] += t[0]; spec[1] += t[1]; spec[2] += t[2]; });
  return { seq, spec };
}

function matchCompound(c, el) {
  if (!el) return false;
  if (c.tag && c.tag !== '*' && c.tag.toLowerCase() !== el.tag) return false;
  if (c.id && c.id !== el.id) return false;
  if (c.attrs) return false; /* no panel rule uses one; tab-strip rules must not match a panel */
  for (const cl of c.classes) if ((el.classes || []).indexOf(cl) < 0) return false;
  for (const n of c.nots) if (matchCompound(n, el)) return false;
  return true;
}

/* chain = [html, body, appWrap, studioView, panel] as plain models */
function matchSelector(parsed, chain) {
  const seq = parsed.seq;
  let ci = chain.length - 1;
  if (!matchCompound(seq[seq.length - 1].compound, chain[ci])) return false;
  let si = seq.length - 2;
  ci -= 1;
  while (si >= 0) {
    const step = seq[si + 1].combinator === 'child' ? 'child' : 'descendant';
    if (step === 'child') {
      if (ci < 0 || !matchCompound(seq[si].compound, chain[ci])) return false;
      ci -= 1; si -= 1;
    } else {
      let hit = -1;
      for (let k = ci; k >= 0; k--) if (matchCompound(seq[si].compound, chain[k])) { hit = k; break; }
      if (hit < 0) return false;
      ci = hit - 1; si -= 1;
    }
  }
  return true;
}

function cmpSpec(a, b) { return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]); }

const PARSED = new Map();
function parsedSelectors(sel) {
  if (!PARSED.has(sel)) PARSED.set(sel, sel.split(',').map(s => parseSelector(s.trim())));
  return PARSED.get(sel);
}

function declValue(body, prop) {
  const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;}]+)', 'i');
  const m = re.exec(body);
  if (!m) return null;
  let v = m[1].trim();
  const important = /!important\s*$/i.test(v);
  return { value: v.replace(/!important\s*$/i, '').trim(), important };
}

function resolve(prop, chain, vw) {
  let best = null;
  for (const r of RULES) {
    if (!mediaActive(r.media, vw)) continue;
    const d = declValue(r.body, prop);
    if (!d) continue;
    let bestSpec = null;
    for (const p of parsedSelectors(r.sel)) {
      if (!matchSelector(p, chain)) continue;
      if (!bestSpec || cmpSpec(p.spec, bestSpec) > 0) bestSpec = p.spec;
    }
    if (!bestSpec) continue;
    const cand = { important: d.important, spec: bestSpec, seq: r.seq, value: d.value };
    if (!best) { best = cand; continue; }
    if (cand.important !== best.important) { if (cand.important) best = cand; continue; }
    const c = cmpSpec(cand.spec, best.spec);
    if (c > 0 || (c === 0 && cand.seq > best.seq)) best = cand;
  }
  return best ? best.value : null;
}

/* ==================================================== the studio grid model */

/* Every panel the switcher can put on screen, and the section that owns it.
   `null` = page chrome that is on screen in every section by design. */
const ROSTER = {
  '.sx-title': null,
  '#mlsSmTabs': null,
  '#mlsStudioPremiumLock': null,   /* non-premium lock card, sx row 5 col 1 */
  '.uc1-pay-wrap': null,           /* Pay Reports tile,      sx row 5 col 2 */
  '#copilotCard': 'ask',
  '#analysisView': 'practice',
  '#mlsSgPro': 'build',
  '#mlsStudyRequest': 'build',
  '#mls-sg-root': 'build',
  '.sx-right': 'build',
  '#studioResultCard': 'build',
  '#mlsB39SgWrap': 'build'
};

function elModel(key) {
  const el = { tag: 'div', id: '', classes: [] };
  if (key[0] === '#') el.id = key.slice(1); else el.classes = [key.slice(1)];
  if (key === '#analysisView') el.classes = ['ax-grid'];   /* ax installs on prod */
  return el;
}

function chainFor(key, bodyClasses) {
  return [
    { tag: 'html', id: '', classes: [] },
    { tag: 'body', id: '', classes: bodyClasses },
    { tag: 'div', id: 'appWrap', classes: [] },
    { tag: 'div', id: 'studioView', classes: ['sx-grid'] },
    elModel(key)
  ];
}

function columns(vw) { return vw <= 980 ? 1 : 2; }

function cellOf(key, bodyClasses, vw) {
  const chain = chainFor(key, bodyClasses);
  const row = resolve('grid-row', chain, vw);
  const col = resolve('grid-column', chain, vw);
  if (!row || !col) return null;
  const rowN = /^\d+$/.test(row.trim()) ? Number(row.trim()) : null;
  if (rowN === null) return null;              /* auto-placed: collision-free by spec */
  const cols = columns(vw);
  let lo, hi;
  if (col.indexOf('/') >= 0) {
    const parts = col.split('/').map(s => s.trim());
    lo = Number(parts[0]);
    hi = (Number(parts[1]) < 0 ? cols + 1 + Number(parts[1]) + 1 : Number(parts[1])) - 1;
  } else if (/^\d+$/.test(col.trim())) { lo = hi = Number(col.trim()); }
  else return null;
  lo = Math.max(1, lo); hi = Math.min(cols, hi);
  if (hi < lo) return null;
  return { row: rowN, lo, hi };
}

function visibleIn(key, bodyClasses, vw) {
  const chain = chainFor(key, bodyClasses);
  const d = resolve('display', chain, vw);
  return d !== 'none';
}

const KEYS = ['ask', 'practice', 'build'];
const VIEWPORTS = [1440, 1280, 1024, 900, 768, 480, 360];

function statesToCheck() {
  const out = [];
  KEYS.forEach(k => out.push({ name: 'tab=' + k, classes: ['mls-sm', 'mls-sm-' + k] }));
  KEYS.forEach(k => out.push({ name: 'tab=' + k + ' +stranded-switcher', classes: ['mls-sm', 'mls-sm-' + k, 'mls-sm-all'] }));
  return out;
}

function overlapsIn(state, vw) {
  const shown = Object.keys(ROSTER).filter(k => visibleIn(k, state.classes, vw));
  const cells = shown.map(k => ({ key: k, cell: cellOf(k, state.classes, vw) })).filter(c => c.cell);
  const hits = [];
  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      const A = cells[a], B = cells[b];
      if (A.cell.row !== B.cell.row) continue;
      if (A.cell.hi < B.cell.lo || B.cell.hi < A.cell.lo) continue;
      hits.push(A.key + ' + ' + B.key + ' both at row ' + A.cell.row +
        ' cols ' + A.cell.lo + '-' + A.cell.hi + ' / ' + B.cell.lo + '-' + B.cell.hi);
    }
  }
  return { shown, hits };
}

/* ================================================================ the pins */

/* The hide rules the module actually emitted, read back off the stylesheet. */
const HIDE = new Map();
parseCss(RUN.sheets.merge, 1).forEach(r => {
  r.sel.split(',').forEach(sel => {
    const m = /^body\.mls-sm:not\(\.mls-sm-all\):not\(\.mls-sm-([a-z]+)\)\s+#studioView\s*>\s*(\S+)$/.exec(sel.trim());
    if (m && /display\s*:\s*none/i.test(r.body)) {
      if (!HIDE.has(m[2])) HIDE.set(m[2], new Set());
      HIDE.get(m[2]).add(m[1]);
    }
  });
});

check('0: both modules installed and injected a stylesheet', function () {
  assert(RUN.sheets.sx.length > 500, 'feat_mls_studio_exact.js produced no CSS - the harness is lying, not the module');
  assert(RUN.sheets.merge.length > 500, 'feat_mls_studio_merge.js produced no CSS');
  assert(RUN.sandbox.__mlsStudioMerge, 'the merge module did not export __mlsStudioMerge');
  /* joined, not deepStrictEqual: the array comes from another vm realm, so its
     prototype is a different Array and a strict deep compare would fail on a
     module that is perfectly correct. */
  assert.strictEqual(Array.prototype.join.call(RUN.sandbox.__mlsStudioMerge.sections, ','), KEYS.join(','),
    'the switcher no longer owns exactly ask/practice/build');
});

check('A: each tab owns at least one panel and no panel is owned twice', function () {
  const owned = {};
  HIDE.forEach((keys, sel) => {
    assert.strictEqual(keys.size, 1, sel + ' is hidden for ' + keys.size + ' sections - a panel must belong to exactly one');
    const k = Array.from(keys)[0];
    (owned[k] = owned[k] || []).push(sel);
  });
  KEYS.forEach(k => assert(owned[k] && owned[k].length, 'tab "' + k + '" owns no panel at all'));
  assert(owned.ask.indexOf('#copilotCard') >= 0, 'Ask must own the Copilot surface');
  assert(owned.practice.indexOf('#analysisView') >= 0, 'Practice must own the analysis / practice-trends view');
  assert(owned.build.indexOf('#mlsSgPro') >= 0,
    'Build must own #mlsSgPro - the host feat_mls_study_request.js mounts the natural-language study builder into. ' +
    'This is the panel that painted over Practice.');
});

check('B: every panel the strip owns has a hide path, and the roster is complete', function () {
  const owned = Object.keys(ROSTER).filter(k => ROSTER[k]);
  owned.forEach(sel => {
    assert(HIDE.has(sel), sel + ' is owned by section "' + ROSTER[sel] + '" but the module emits no display:none rule for it');
    assert.strictEqual(Array.from(HIDE.get(sel))[0], ROSTER[sel], sel + ' is hidden for the wrong section');
  });
  Array.from(HIDE.keys()).forEach(sel => {
    assert(Object.prototype.hasOwnProperty.call(ROSTER, sel), sel + ' has a hide rule but is not in this test\'s roster - register it');
  });
  /* Anything sx explicitly places AS A DIRECT CHILD of the grid is a panel by
     definition. A new one must be registered here (and given a section) or this
     fails - that is how the next #mlsSgPro gets caught before the owner does. */
  const placed = new Set();
  parseCss(RUN.sheets.sx, 0).forEach(r => {
    if (!/grid-(row|column)\s*:/.test(r.body)) return;
    r.sel.split(',').forEach(sel => {
      const m = /#studioView(?:\.[\w-]+)*\s*>\s*([#.][\w-]+)\s*$/.exec(sel.trim());
      if (m) placed.add(m[1]);
    });
  });
  assert(placed.size >= 6, 'sx no longer places direct grid children by selector - re-derive this test (' + placed.size + ' found)');
  placed.forEach(sel => {
    assert(Object.prototype.hasOwnProperty.call(ROSTER, sel),
      sel + ' is placed in the studio grid by feat_mls_studio_exact.js but belongs to no section and is not registered chrome');
  });
});

check('C: the selected tab is exposed programmatically, not by colour alone', function () {
  const bar = RUN.dom.ids.get('mlsSmTabs');
  assert(bar, 'the switcher did not mount');
  assert.strictEqual(bar.getAttribute('role'), 'tablist', 'the strip must be a tablist');
  const tabs = bar.children.filter(c => c.getAttribute('data-mls-sm-tab'));
  assert.strictEqual(tabs.length, 3, 'expected 3 tabs, found ' + tabs.length);
  const on = tabs.filter(t => t.getAttribute('aria-selected') === 'true');
  const off = tabs.filter(t => t.getAttribute('aria-selected') === 'false');
  assert.strictEqual(on.length, 1, 'exactly one tab must carry aria-selected="true", found ' + on.length);
  assert.strictEqual(off.length, 2, 'the other two tabs must carry aria-selected="false", found ' + off.length);
  tabs.forEach(t => assert.strictEqual(t.getAttribute('role'), 'tab', 'every tab needs role=tab'));
  assert.strictEqual(on[0].getAttribute('tabindex'), '0', 'the selected tab must be the strip\'s tab stop');
  off.forEach(t => assert.strictEqual(t.getAttribute('tabindex'), '-1', 'unselected tabs must leave the tab order'));
  /* and the visual state must key on that same attribute, so the two can never
     disagree the way an independent "active" class can. */
  assert(/\.mls-sm-tab\[aria-selected="true"\]\{/.test(RUN.sheets.merge),
    'the selected-tab styling must key on [aria-selected="true"], not a colour-only class');
});

check('D: exactly one section\'s panels are visible per tab', function () {
  statesToCheck().filter(s => s.classes.indexOf('mls-sm-all') < 0).forEach(state => {
    const key = state.classes[1].replace('mls-sm-', '');
    const shown = Object.keys(ROSTER).filter(k => visibleIn(k, state.classes, 1280));
    Object.keys(ROSTER).forEach(k => {
      const owner = ROSTER[k];
      const isShown = shown.indexOf(k) >= 0;
      if (owner === null) assert(isShown, k + ' is page chrome but is hidden on ' + state.name);
      else if (owner === key) assert(isShown, k + ' belongs to ' + owner + ' but is hidden on ' + state.name);
      else assert(!isShown, k + ' belongs to "' + owner + '" but is still visible on ' + state.name);
    });
  });
});

check('E: no two visible studio panels share a grid cell, at any viewport', function () {
  const bad = [];
  statesToCheck().forEach(state => {
    VIEWPORTS.forEach(vw => {
      const r = overlapsIn(state, vw);
      r.hits.forEach(h => bad.push(state.name + ' @' + vw + 'px: ' + h));
    });
  });
  assert.strictEqual(bad.length, 0, 'panels stacked in one cell:\n      - ' + bad.join('\n      - '));
});

check('F: the same resolver DETECTS the shipped defect (this suite is not vacuous)', function () {
  /* Re-run E against the pre-fix member list: Build owned only .sx-right,
     #studioResultCard and #mlsB39SgWrap, so the three study hosts had no hide
     rule. Simulated by deleting their display:none rules from the cascade. */
  const study = ['#mlsSgPro', '#mlsStudyRequest', '#mls-sg-root'];
  const removed = [];
  for (let i = RULES.length - 1; i >= 0; i--) {
    const r = RULES[i];
    if (!/display\s*:\s*none/i.test(r.body)) continue;
    if (study.some(s => r.sel.indexOf(s) >= 0)) removed.push(RULES.splice(i, 1)[0]);
  }
  assert(removed.length >= study.length, 'could not find the study-host hide rules to remove; re-derive this test');
  PARSED.clear();
  let hits = [];
  try {
    statesToCheck().forEach(state => VIEWPORTS.forEach(vw => { hits = hits.concat(overlapsIn(state, vw).hits); }));
  } finally {
    removed.reverse().forEach(r => RULES.push(r));
    RULES.sort((a, b) => a.seq - b.seq);
    PARSED.clear();
  }
  assert(hits.length > 0, 'with the study hosts unowned the resolver still finds no overlap - it cannot see the defect it exists for');
  assert(hits.some(h => /#mlsSgPro/.test(h) && /#analysisView/.test(h)),
    'the resolver missed the exact pair the owner photographed (#mlsSgPro over #analysisView); it found: ' + hits.join(' | '));
});

console.log('');
if (failures.length) {
  console.error('studio-tabs-show-one-panel: ' + failures.length + ' FAILED');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('studio-tabs-show-one-panel: all assertions passed');
