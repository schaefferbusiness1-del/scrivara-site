/*
 * RED/GREEN CONTRACT — the 1p full-history PDF owner stays idle off-chart.
 *
 * The shared feat_fullhistory_pdf.js is protected production.  The preview
 * must load an isolated 1p fork which finds a visible mount (or an already
 * mounted PDF button) before it asks for activePatient().  This test runs the
 * real fork through its initial wire, interval, and MutationObserver paths.
 *
 * This remains in run-all so the 1p-only performance boundary cannot regress.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const forkPath = path.join(root, '1p-feat_fullhistory_pdf.js');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

assert(fs.existsSync(forkPath), 'missing isolated 1p-feat_fullhistory_pdf.js fork');
assert(fs.statSync(forkPath).size > 10_000, '1p full-history PDF fork is missing or truncated');
const fork = fs.readFileSync(forkPath, 'utf8');

assert.strictEqual((connect.match(/1p-feat_fullhistory_pdf\.js/g) || []).length, 1,
  '1p bundle must name the isolated full-history PDF source exactly once');
const loaderAt = connect.indexOf('1p-feat_fullhistory_pdf.js');
const loader = connect.slice(Math.max(0, loaderAt - 500), loaderAt + 700);
assert(/data-mls-asset[\s\S]{0,100}feat_fullhistory_pdf\.js|setAttribute\(['"]data-mls-asset['"],[\s]*['"]feat_fullhistory_pdf\.js['"]\)/.test(loader),
  '1p PDF loader must retain feat_fullhistory_pdf.js as its canonical dedupe identity');
assert(/src[\s\S]{0,100}1p-feat_fullhistory_pdf\.js/.test(loader),
  '1p PDF loader does not fetch the isolated source');

function hasClass(node, cls) {
  return String(node.className || '').split(/\s+/).includes(cls);
}
function matches(node, selector) {
  selector = selector.trim();
  if (!selector) return false;
  if (selector[0] === '#') return node.id === selector.slice(1);
  if (selector[0] === '.') return hasClass(node, selector.slice(1));
  const attr = selector.match(/^\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/);
  if (attr) return Object.prototype.hasOwnProperty.call(node.attributes, attr[1]) &&
    (attr[2] == null || node.attributes[attr[1]] === attr[2]);
  return node.tagName === selector.toUpperCase();
}
function allBelow(node, selector, out) {
  for (const child of node.children || []) {
    if (selector.split(',').some((part) => matches(child, part))) out.push(child);
    allBelow(child, selector, out);
  }
  return out;
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.style = { cssText: '' };
    this.className = '';
    this.id = '';
    this.offsetParent = {};
    this.listeners = Object.create(null);
    this.textContent = '';
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  querySelector(selector) { return allBelow(this, selector, [])[0] || null; }
  querySelectorAll(selector) { return allBelow(this, selector, []); }
  remove() {
    if (!this.parentNode) return;
    const at = this.parentNode.children.indexOf(this);
    if (at >= 0) this.parentNode.children.splice(at, 1);
    this.parentNode = null;
  }
}

function makeHarness(options) {
  options = options || {};
  let patientReads = 0;
  const intervals = [];
  const observers = [];
  const document = {
    readyState: 'complete',
    createElement(tag) { return new FakeElement(tag); },
    addEventListener() {},
    getElementById(id) {
      return [document.documentElement].concat(allBelow(document.documentElement, '*', []))
        .find((node) => node.id === id) || null;
    },
    querySelector(selector) { return allBelow(document.documentElement, selector, [])[0] || null; },
    querySelectorAll(selector) { return allBelow(document.documentElement, selector, []); }
  };
  /* allBelow's tag matcher intentionally has no wildcard; getElementById uses
     this explicit walk instead. */
  document.getElementById = function getElementById(id) {
    function walk(node) {
      if (node.id === id) return node;
      for (const child of node.children || []) { const hit = walk(child); if (hit) return hit; }
      return null;
    }
    return walk(document.documentElement);
  };
  document.documentElement = new FakeElement('html');
  document.head = new FakeElement('head');
  document.body = new FakeElement('body');
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);

  if (options.mount) {
    const mount = new FakeElement('section'); mount.id = options.mount;
    if (options.hidden) mount.offsetParent = null;
    if (options.mount === 'mlsVisitHistoryExt') {
      const head = new FakeElement('div'); head.className = 'mlsxh-head'; mount.appendChild(head);
    }
    document.body.appendChild(mount);
  }
  if (options.existingButton) {
    const b = new FakeElement('button'); b.setAttribute('data-mls-fhpdf', '1'); document.body.appendChild(b);
  }

  class MO {
    constructor(fn) { this.fn = fn; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const window = {
    activePatient() { patientReads += 1; return options.patient === undefined ? { id: 'synthetic-patient' } : options.patient; },
    toast() {}
  };
  const context = vm.createContext({
    window, document, MutationObserver: MO, Promise,
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearInterval() {},
    setTimeout() { return 1; },
    Date, console
  });
  window.window = window; window.document = document; window.MutationObserver = MO;

  vm.runInContext(fork, context, { filename: '1p-feat_fullhistory_pdf.js' });
  return {
    window, document, intervals, observers,
    patientReads() { return patientReads; },
    tick(count) { for (let n = 0; n < count; n += 1) intervals.slice().forEach((fn) => fn()); },
    mutate(count) { for (let n = 0; n < count; n += 1) observers.slice().forEach((ob) => { if (!ob.disconnected) ob.fn([]); }); },
    buttons() { return document.querySelectorAll('[data-mls-fhpdf]'); }
  };
}

{
  const h = makeHarness();
  assert.strictEqual(h.patientReads(), 0, 'initial off-chart wire called activePatient() before finding a visible mount');
  h.tick(25); h.mutate(25);
  assert.strictEqual(h.patientReads(), 0, 'idle interval/observer churn repeatedly read the full patient roster off-chart');
  assert.strictEqual(h.buttons().length, 0, 'off-chart wiring fabricated a PDF button');
}

{
  const h = makeHarness({ mount: 'profileCard', hidden: true });
  h.tick(10); h.mutate(10);
  assert.strictEqual(h.patientReads(), 0, 'a hidden profile card was treated as a visible history mount');
  assert.strictEqual(h.buttons().length, 0, 'a PDF action was mounted into a hidden profile card');
}

{
  const h = makeHarness({ mount: 'mlsVisitHistoryExt', hidden: true });
  h.tick(10); h.mutate(10);
  assert.strictEqual(h.patientReads(), 0, 'a hidden visit-history extension was treated as a visible history mount');
  assert.strictEqual(h.buttons().length, 0, 'a PDF action was mounted into hidden visit history');
}

{
  const h = makeHarness({ mount: 'mlsVisitHistory', hidden: true });
  h.tick(10); h.mutate(10);
  assert.strictEqual(h.patientReads(), 0, 'a hidden base visit history was treated as a visible history mount');
  assert.strictEqual(h.buttons().length, 0, 'a PDF action was mounted into hidden base visit history');
}

{
  const h = makeHarness({ existingButton: true });
  h.tick(10); h.mutate(10);
  assert.strictEqual(h.patientReads(), 0, 'an already-mounted PDF action did not short-circuit activePatient()');
  assert.strictEqual(h.buttons().length, 1, 'idempotent wiring duplicated the existing PDF action');
}

{
  const h = makeHarness({ mount: 'mlsVisitHistoryExt', patient: null });
  assert.strictEqual(h.patientReads(), 1, 'a visible history mount did not perform the one necessary active-patient check');
  assert.strictEqual(h.buttons().length, 0, 'visible history with no active patient mounted an unusable action');
}

{
  const h = makeHarness({ mount: 'mlsVisitHistoryExt', patient: { id: 'synthetic-patient' } });
  assert.strictEqual(h.patientReads(), 1, 'visible history performed more than the one necessary initial patient check');
  assert.strictEqual(h.buttons().length, 1, 'normal visible history lost its full-history PDF action');
  h.tick(25); h.mutate(25);
  assert.strictEqual(h.patientReads(), 1, 'mounted action did not short-circuit later interval/observer probes');
  assert.strictEqual(h.buttons().length, 1, 'interval/observer wiring duplicated the mounted PDF action');
  assert(h.window.__mlsFullHistoryPdf && h.window.__mlsFullHistoryPdf.installed,
    'isolated full-history PDF public API did not install');
  h.window.__mlsFullHistoryPdf.revert();
  assert.strictEqual(h.buttons().length, 0, 'revert did not remove the preview PDF action');
  assert(h.observers.every((ob) => ob.disconnected), 'revert did not disconnect the preview PDF observer');
}

console.log('PASS 1p full-history PDF idle path: isolated loader, zero off-chart patient reads, visible mount preserved, mounted action idempotent and reversible');
