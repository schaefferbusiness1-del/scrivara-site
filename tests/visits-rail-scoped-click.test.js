'use strict';
/* wcl-1.0.0 control: THE VISITS RAIL CLICK NEVER WANDERS.
 *
 * Codex static map + owner live repro ("kind of clicks around", missed
 * visits): mlsReadVisitsPaneDriverFn's clickRailByAttr clicked the FIRST
 * visible [data-chart-section-id="visits"] anywhere in the document - the
 * v2.01 recovery comment itself documents that click landing on athena's
 * top-nav Calendar menu. wcl-1.0.0: a candidate counts only inside a PROVEN
 * chart rail (chart-tabs item/container + the label scan's own left-edge
 * geometry + at least two sibling section ids); exactly one survivor is
 * clicked, two survivors refuse with 'ambiguous' BEFORE any click, zero
 * survivors falls back to the label scan. The ladder treats 'ambiguous' as a
 * terminal named refusal (reason 'rail-ambiguous') and the recovery re-click
 * refuses it too.
 *
 * Drives the REAL extracted clickRailByAttr against synthetic DOMs. OLD
 * BYTES FAIL CASES 2/3 BY NAME (decoy clicked; two rails clicked anyway). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'background.js'), 'latin1');

function extractFn(marker) {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, marker + ' present in background.js');
  const open = src.indexOf('{', at + marker.length - 1);
  let depth = 0, mode = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && src[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && src[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced ' + marker);
}

const fnSrc = extractFn('function clickRailByAttr(sectionId)');

/* ladder + recovery shape pins */
assert.ok(src.includes("if (attrRes === 'ambiguous') { railAmbiguous = true; break; }"),
  'the click ladder treats ambiguity as terminal');
assert.ok(src.includes("reason: 'rail-ambiguous'"), 'ambiguity refuses with its own named reason');
assert.ok(src.includes("if (clickRailByAttr('visits') === false) clickRailLabel('Visits')"),
  "the v2.01 recovery re-click refuses 'ambiguous' too");

/* ---- synthetic DOM ---- */
function makeNode(opts) {
  const n = {
    className: opts.className || '',
    attrs: opts.attrs || {},
    textContent: opts.text || '',
    parentElement: null,
    children: [],
    visible: opts.visible !== false,
    left: typeof opts.left === 'number' ? opts.left : 40,
    clicks: 0,
    getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; },
    getBoundingClientRect() { return { left: this.left, top: 10, width: 40, height: 20 }; },
    closest(sel) {
      const wantRail = /chart-tabs/.test(sel);
      let cur = this;
      while (cur) { if (wantRail && /chart-tabs/.test(String(cur.className))) return cur; cur = cur.parentElement; }
      return null;
    },
    querySelectorAll(sel) { return queryAll(this, sel); },
    querySelector(sel) { return queryAll(this, sel)[0] || null; }
  };
  return n;
}
function attach(parent, child) { child.parentElement = parent; parent.children.push(child); return child; }
function walk(n, out) { out.push(n); n.children.forEach(c => walk(c, out)); return out; }
function queryAll(scope, sel) {
  const all = walk(scope, []).slice(1);
  const ids = [...sel.matchAll(/data-chart-section-id="([a-zA-Z]+)"/g)].map(m => m[1]);
  if (ids.length) return all.filter(n => ids.includes(n.attrs['data-chart-section-id']));
  return [];
}
function railWith(sections, opts) {
  opts = opts || {};
  const rail = makeNode({ className: 'chart-tabs__list chart-tabs', left: 10 });
  sections.forEach(id => attach(rail, makeNode({
    className: 'chart-tabs__list-item', left: opts.left != null ? opts.left : 30,
    attrs: { 'data-chart-section-id': id, 'data-icon-caption': id }
  })));
  return rail;
}

function run(doc) {
  const clicked = [];
  const ctx = vm.createContext({
    W: { document: doc },
    visEl: el => el.visible !== false,
    BAD: /sign|order|submit|billing|prescri/i,
    realClick: el => { el.clicks++; clicked.push(el); },
    String, RegExp
  });
  vm.runInContext(fnSrc, ctx, { filename: 'background:clickRailByAttr' });
  return { result: vm.runInContext("clickRailByAttr('visits')", ctx), clicked };
}

let n = 0;
const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

/* ---- 1. the healthy chart: one rail, visits + siblings -> exactly one click ---- */
{
  const doc = makeNode({ className: 'doc' });
  attach(doc, railWith(['browse', 'allergies', 'problems', 'medications', 'visits', 'history']));
  const r = run(doc);
  assert.strictEqual(r.result, true, 'unique verified rail candidate is clicked');
  assert.strictEqual(r.clicked.length, 1, 'exactly one click');
  assert.strictEqual(r.clicked[0].attrs['data-chart-section-id'], 'visits', 'the visits item took the click');
  ok('healthy rail: one verified candidate, one click');
}

/* ---- 2. THE WANDERING CLICK: a decoy with the same attribute OUTSIDE the
 * rail (e.g. top-nav) must never take the click ---- */
{
  const doc = makeNode({ className: 'doc' });
  const topnav = makeNode({ className: 'global-nav', left: 400 });
  attach(doc, topnav);
  attach(topnav, makeNode({ className: 'nav-item', left: 420, attrs: { 'data-chart-section-id': 'visits' } }));
  const r = run(doc);
  assert.strictEqual(r.result, false, 'a lone out-of-rail decoy yields false (label-scan fallback), never a click');
  assert.strictEqual(r.clicked.length, 0, 'the decoy was not clicked (old bytes clicked it - the documented Calendar-menu wander)');
  ok('decoy outside the rail: zero clicks, honest fallback');
}

/* ---- 3. TWO verified rails (two open chart panels) -> ambiguous, no click ---- */
{
  const doc = makeNode({ className: 'doc' });
  attach(doc, railWith(['browse', 'allergies', 'visits', 'history']));
  attach(doc, railWith(['problems', 'medications', 'visits', 'results']));
  const r = run(doc);
  assert.strictEqual(r.result, 'ambiguous', 'two verified candidates refuse with ambiguous');
  assert.strictEqual(r.clicked.length, 0, 'ambiguity refuses BEFORE any click');
  ok('two rails: ambiguous refusal, zero clicks');
}

/* ---- 4. rail-shaped but wrong geometry (right side of the screen) ---- */
{
  const doc = makeNode({ className: 'doc' });
  attach(doc, railWith(['browse', 'allergies', 'visits', 'history'], { left: 500 }));
  const r = run(doc);
  assert.strictEqual(r.result, false, 'a right-side lookalike fails the left-edge geometry gate');
  assert.strictEqual(r.clicked.length, 0, 'no click');
  ok('geometry gate: right-side lookalike refused');
}

/* ---- 5. a lone visits item with no sibling sections is not a rail ---- */
{
  const doc = makeNode({ className: 'doc' });
  const bare = makeNode({ className: 'chart-tabs__list chart-tabs', left: 10 });
  attach(doc, bare);
  attach(bare, makeNode({ className: 'chart-tabs__list-item', left: 30, attrs: { 'data-chart-section-id': 'visits' } }));
  const r = run(doc);
  assert.strictEqual(r.result, false, 'a sibling-less candidate fails the rail signature');
  assert.strictEqual(r.clicked.length, 0, 'no click');
  ok('sibling signature: lone candidate refused');
}

/* ---- 6. hidden and forbidden-label candidates still refused ---- */
{
  const doc = makeNode({ className: 'doc' });
  const rail = railWith(['browse', 'allergies', 'problems']);
  attach(doc, rail);
  attach(rail, makeNode({ className: 'chart-tabs__list-item', left: 30, visible: false, attrs: { 'data-chart-section-id': 'visits' } }));
  const r = run(doc);
  assert.strictEqual(r.result, false, 'an invisible candidate never counts');
  assert.strictEqual(r.clicked.length, 0, 'no click');
  ok('visibility gate intact');
}

console.log('PASS visits-rail scoped click: unique verified rail clicked once, out-of-rail decoys never clicked, two rails refuse ambiguous before any click, geometry/sibling/visibility gates hold, ladder and recovery treat ambiguity as terminal (' + n + ' cases)');
