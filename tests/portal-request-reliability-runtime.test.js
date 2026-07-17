const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_portal_request_inbox.js'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'patient-portal.html'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

assert(portal.includes('clientRequestId:openClientRequestId'), 'patient request does not keep one retry-safe receipt id');
assert(portal.includes('requestFetch("/api/patient/requests")'), 'patient portal does not reconcile its own durable requests');
assert(portal.includes('My submitted requests'), 'patient portal has no visible request status list');
assert(portal.includes('not a prescription or approval'), 'patient receipt copy does not preserve the review-only boundary');
assert(!portal.includes('btn.textContent="Sent"; setTimeout(closeModal'), 'successful receipt still disappears automatically');
assert(loader.includes("A='feat_mls_portal_request_inbox.js'") && loader.includes("A+'?v=20260717prq102'"), 'clinician inbox asset is not loaded');
assert(!/postMessage|mlsApp(?:Read|Write|Pull)|runPull|pullSchedule/i.test(source), 'clinician inbox contains a pull/Athena/extension action');

function descendants(rootNode) {
  const out = [];
  (function visit(node) { for (const child of node.children || []) { out.push(child); visit(child); } })(rootNode);
  return out;
}
function matches(node, selector) {
  if (!node) return false;
  if (selector[0] === '#') return node.id === selector.slice(1);
  if (selector[0] === '.') return (` ${node.className || ''} `).includes(` ${selector.slice(1)} `);
  return node.tagName === selector.toUpperCase();
}
class Element {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase(); this.nodeType = 1;
    this.children = []; this.parentNode = null; this.className = ''; this.attributes = {};
    this.listeners = {}; this.style = {}; this._text = ''; this._id = ''; this.disabled = false; this.type = '';
  }
  set id(value) { this._id = String(value || ''); }
  get id() { return this._id; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return this.parentNode.children[i + 1] || null; }
  set textContent(value) { this._text = String(value == null ? '' : value); this.children.slice().forEach(child => this.removeChild(child)); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) {
    this._text = ''; this.children.slice().forEach(child => this.removeChild(child));
    if (String(value).includes('mlsPrqCount')) {
      const icon = new Element('span'); icon.textContent = 'mail';
      const label = new Element('span'); label.textContent = 'Portal requests';
      const badge = new Element('span'); badge.className = 'mlsPrqCount';
      this.appendChild(icon); this.appendChild(label); this.appendChild(badge);
    }
  }
  get classList() {
    const el = this;
    return {
      contains(name) { return (` ${el.className} `).includes(` ${name} `); },
      add(name) { if (!this.contains(name)) el.className = (el.className + ' ' + name).trim(); },
      remove(name) { el.className = el.className.split(/\s+/).filter(value => value && value !== name).join(' '); },
      toggle(name, force) { const has = this.contains(name); const on = force == null ? !has : !!force; if (on) this.add(name); else this.remove(name); return on; },
    };
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = before ? this.children.indexOf(before) : -1;
    if (index >= 0) this.children.splice(index, 0, child); else this.children.push(child);
    child.parentNode = this; return child;
  }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(node) { return node === this || descendants(this).includes(node); }
  setAttribute(name, value) { if (name === 'id') this.id = value; else this.attributes[name] = String(value); }
  getAttribute(name) { return name === 'id' ? this.id : (this.attributes[name] || ''); }
  addEventListener(type, listener) { (this.listeners[type] || (this.listeners[type] = [])).push(listener); }
  querySelector(selector) { return descendants(this).find(node => matches(node, selector)) || null; }
  querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)); }
  click() { const event = { target: this, preventDefault() {}, stopPropagation() {} }; for (const listener of this.listeners.click || []) listener.call(this, event); }
}

const document = {
  readyState: 'complete', listeners: {},
  createElement(tag) { return new Element(tag); },
  getElementById(id) { return descendants(this.documentElement).find(node => node.id === id) || null; },
  querySelector(selector) { return descendants(this.documentElement).find(node => matches(node, selector)) || null; },
  querySelectorAll(selector) { return descendants(this.documentElement).filter(node => matches(node, selector)); },
  addEventListener(type, listener) { (this.listeners[type] || (this.listeners[type] = [])).push(listener); },
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(fn => fn !== listener); },
};
document.documentElement = new Element('html'); document.head = new Element('head'); document.body = new Element('body');
document.documentElement.appendChild(document.head); document.documentElement.appendChild(document.body);
const tools = new Element('div'); tools.className = 'tools'; document.body.appendChild(tools);
const menu = new Element('div'); menu.id = 'mlsTbMenuPanel'; tools.appendChild(menu);
const settings = new Element('button'); settings.textContent = 'Settings'; menu.appendChild(settings);

const patients = [
  { id: 'PAT-A', name: 'Exact Patient' },
  { id: 'PAT-X', athenaId: 'PAT-A', name: 'Namespace collision' },
  { id: 'DUP', name: 'Duplicate One' }, { id: 'DUP', name: 'Duplicate Two' },
];
const fetches = [];
let handled = false;
let selected = null;
let opened = null;
function response(body, status = 200) { return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }); }
const context = {
  console, document, Promise, Date, Math, JSON, Object, String, Array, RegExp, Error,
  encodeURIComponent, localStorage: { getItem: () => 'clinician-token' }, sessionStorage: { getItem: () => '' },
  getPatients: () => patients,
  setActivePtId(id) { selected = id; }, openPatient(id) { opened = id; },
  addEventListener() {}, removeEventListener() {},
  setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
  fetch(url, options = {}) {
    fetches.push({ url, options });
    if (/\/handled$/.test(url)) { handled = true; return response({ ok: true, status: 'reviewed' }); }
    if (/\/api\/patient\/admin\/requests/.test(url)) {
      const requests = handled ? [] : [
        { id: 1, ref: 'REQ-ONE', category: 'Refill request', status: 'new', patient_external_id: 'PAT-A', data: { medication: 'Synthetic med' }, created_at: '2026-07-17T12:00:00Z', notification: { delivered: true } },
        { id: 2, ref: 'REQ-TWO', category: 'Office message', status: 'new', patient_external_id: 'DUP', data: { message: 'Synthetic message' }, created_at: '2026-07-17T12:01:00Z', notification: { delivered: false } },
      ];
      return response({ ok: true, requests });
    }
    return response({}, 404);
  },
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'feat_mls_portal_request_inbox.js' });

async function flush() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); }
async function main() {
  const api = context.__mlsPortalRequestInbox;
  assert(api && api.installed, 'clinician inbox did not install');
  assert.strictEqual(api.exactPatient('PAT-A').name, 'Exact Patient', 'primary exact external id did not link');
  assert.strictEqual(api.exactPatient('DUP'), null, 'duplicate exact external ids did not fail closed');
  assert.strictEqual(api.exactPatient(''), null, 'blank patient identity linked');
  const button = document.getElementById('mlsPortalRequestInboxBtn');
  assert(button, 'portal requests menu action was not injected');
  assert.strictEqual(button.nextSibling, settings, 'portal requests action was not placed before Settings');
  assert.strictEqual(fetches.length, 0, 'portal requests fetched before explicit open');

  button.click(); await flush();
  assert(document.getElementById('mlsPrqBack'), 'portal requests dialog did not open');
  assert.strictEqual(fetches.length, 1, 'explicit open did not make exactly one initial list request');
  assert(/status=new/.test(fetches[0].url), 'initial clinician queue did not request new items');
  const cards = document.querySelectorAll('.mlsPrqCard');
  assert.strictEqual(cards.length, 2, 'clinician queue did not render returned requests');
  const exactChart = descendants(cards[0]).find(node => node.tagName === 'BUTTON' && /Open exact patient chart/.test(node.textContent));
  assert(exactChart, 'uniquely linked request has no exact-chart action');
  const blockedChart = descendants(cards[1]).find(node => node.tagName === 'BUTTON' && /Chart link unavailable/.test(node.textContent));
  assert(blockedChart && blockedChart.disabled, 'ambiguous request exposed a chart action');
  exactChart.click();
  assert.strictEqual(selected, 'PAT-A'); assert.strictEqual(opened, 'PAT-A');
  assert.strictEqual(document.getElementById('mlsPrqBack'), null, 'opening the chart did not close the queue');

  api.open(); await flush();
  const review = descendants(document.getElementById('mlsPrqBack')).find(node => node.tagName === 'BUTTON' && node.textContent === 'Mark reviewed');
  assert(review, 'new request has no review acknowledgement');
  review.click(); await flush();
  assert(fetches.some(item => /\/1\/handled$/.test(item.url) && item.options.method === 'POST'), 'review acknowledgement did not use the handled endpoint');
  assert.strictEqual(handled, true);
  assert(!fetches.some(item => /athena|prescri|pharmacy|pull/i.test(item.url)), 'review UI triggered a clinical/extension route');
  console.log('PASS portal request UI: durable patient receipts and exact clinician review linkage');
}
main().catch(error => { console.error(error); process.exit(1); });
