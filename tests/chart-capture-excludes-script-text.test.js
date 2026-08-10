/* cx-1.0 control: NON-RENDERED NODES ARE NOT CONTENT.
   2026-08-10: 13 of 21 charts written by the day-9 run carried athena UI script
   text ("alert('Please select reason to delete this encounter.')") INTERLEAVED
   into the stored `problems` field. Root cause: the injected capture scopes'
   `txt()` primitives read `textContent`, which includes <script> bodies (and on
   a hidden tab `innerText` degrades to the same behaviour — the day-pull's
   normal condition). The fix is STRUCTURAL, at the extraction boundary: clone
   and drop script/style/noscript/template nodes before reading text. No
   denylist — a string rule fails on the patient whose diagnosis contains the
   string; a node-type rule cannot match a real problem entry.

   Non-vacuity is executed, not asserted by faith: the OLD one-line txt() defs
   (verbatim from the shipped 3.0.56 bytes, core 787747ac) run here as BEFORE
   and MUST reproduce the junk; the CURRENT defs extracted from background.js
   run as AFTER and must exclude it while preserving every clinical entry. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

/* ---- minimal DOM fake: exactly the surface txt() touches ---------------- */
function makeNode(tag, text, children) {
  const node = {
    tagName: String(tag || 'DIV').toUpperCase(),
    _text: text || '',
    children: children || [],
    parentNode: null,
  };
  node.children.forEach(c => { c.parentNode = node; });
  Object.defineProperty(node, 'textContent', {
    get() { return this._text + this.children.map(c => c.textContent).join(''); },
  });
  Object.defineProperty(node, 'innerText', {
    /* hidden-tab semantics: innerText degrades to textContent (script bodies included) */
    get() { return this.textContent; },
  });
  node.querySelectorAll = function (sel) {
    const tags = String(sel).toUpperCase().split(',').map(s => s.trim());
    const out = [];
    (function walk(n) {
      n.children.forEach(c => { if (tags.indexOf(c.tagName) >= 0) out.push(c); walk(c); });
    })(this);
    return out;
  };
  node.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  node.cloneNode = function (deep) {
    return makeNode(this.tagName, this._text, deep ? this.children.map(c => c.cloneNode(true)) : []);
  };
  node.removeChild = function (child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    return child;
  };
  return node;
}

const JUNK = "alert('Please select reason to delete this encounter.')\nalert('You have selected a reason without a deletion.')";
function poisonedContainer() {
  return makeNode('DIV', '', [
    makeNode('DIV', '1. Spinal stenosis of lumbar region with neurogenic claudication\n'),
    makeNode('SCRIPT', JUNK),
    makeNode('DIV', 'M48.061: Spinal stenosis, lumbar region without neurogenic claudication\n'),
    makeNode('STYLE', '.enc-row { color: red }'),
    makeNode('DIV', 'Osteoarthritis of right knee\n'),
  ]);
}

function evalTxt(defSource) {
  /* the 4992-scope def calls clean(); provide the identity so the def is runnable */
  return new Function('clean', 'return (' + defSource.replace(/^function txt/, 'function') + ')')(s => String(s || '').replace(/\s+/g, ' ').trim());
}

/* ---- BEFORE: the shipped 3.0.56 defs, verbatim — must REPRODUCE the junk - */
const OLD_DEFS = [
  "function txt(el) { return ((el && (el.textContent || el.innerText)) || '').replace(/\\s+/g, ' ').trim(); }",
  "function txt(el) { return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim(); }",
];
OLD_DEFS.forEach((src, i) => {
  const out = evalTxt(src)(poisonedContainer());
  assert(out.indexOf('Please select reason') >= 0,
    'non-vacuity control broken: OLD def #' + i + ' no longer reproduces the junk — the test is not testing');
});

/* ---- AFTER: the defs actually in background.js now ----------------------- */
const defs = bg.match(/function txt\(el\) \{[^\n]*\}/g) || [];
assert(defs.length >= 4, 'expected at least 4 single-line txt() defs in background.js, found ' + defs.length);
const cxDefs = defs.filter(d => d.indexOf('cx-1.0') >= 0);
assert(cxDefs.length >= 3, 'expected at least 3 cx-1.0 txt() defs (3942/4992/9065 scopes), found ' + cxDefs.length);

cxDefs.forEach((src, i) => {
  const out = evalTxt(src)(poisonedContainer());
  assert(out.indexOf('Spinal stenosis of lumbar region') >= 0,
    'cx def #' + i + ' lost a clinical entry — the strip is over-broad (b900 shape)');
  assert(out.indexOf('M48.061') >= 0, 'cx def #' + i + ' lost the ICD entry');
  assert(out.indexOf('Osteoarthritis of right knee') >= 0, 'cx def #' + i + ' lost the entry AFTER the script node');
  assert(out.indexOf('Please select reason') < 0 && out.indexOf('alert(') < 0,
    'cx def #' + i + ' still captures script text');
  assert(out.indexOf('enc-row') < 0, 'cx def #' + i + ' still captures style text');
});

/* the write-path scope (aria-label/value reader) is deliberately untouched */
assert(bg.indexOf("el.getAttribute('aria-label')") >= 0, 'write-path txt() def missing — file shape changed, re-audit cx-1.0');

/* all four capture sites carry the cx-1.0 marker: 3 txt() defs + the shadow-root walk */
assert((bg.match(/cx-1\.0/g) || []).length >= 4, 'expected 4 cx-1.0 sites (3 txt defs + shadow walk)');
assert(/cx-1\.0: strip non-rendered nodes from shadow text too/.test(bg), 'shadow-root walk strip missing');

console.log('chart-capture-excludes-script-text: OK (old defs reproduce junk; cx-1.0 defs exclude it and keep every clinical entry)');
