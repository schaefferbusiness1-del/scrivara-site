'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');
const start = source.indexOf('/* STAGING Staff Prep parity.');
const end = source.indexOf(";(function(){try{if(document.querySelector('script[data-mls-asset=\"feat_mls_writeback_router.js\"]'))", start);
assert(start >= 0 && end > start, 'could not isolate staging Staff Prep receiver');
const moduleSource = source.slice(start, end);

class Element {
  constructor(tag, registry) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.registry = registry;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.value = '';
    this.disabled = false;
    this._id = '';
    this._innerHTML = '';
    this.textContent = '';
  }
  get id() { return this._id; }
  set id(value) {
    if (this._id && this.registry[this._id] === this) delete this.registry[this._id];
    this._id = String(value || '');
    if (this._id) this.registry[this._id] = this;
  }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) {
    const drop = node => {
      for (const child of node.children.slice()) drop(child);
      if (node.id && node.registry[node.id] === node) delete node.registry[node.id];
    };
    for (const child of this.children.slice()) drop(child);
    this.children = [];
    this._innerHTML = String(value || '');
    const re = /<([a-z0-9]+)\b[^>]*\bid="([^"]+)"[^>]*>/gi;
    let match;
    while ((match = re.exec(this._innerHTML))) {
      const child = new Element(match[1], this.registry);
      child.id = match[2];
      this.appendChild(child);
    }
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  addEventListener(type, listener) { (this.listeners[type] || (this.listeners[type] = [])).push(listener); }
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(fn => fn !== listener); }
  dispatch(type, event) {
    const ev = event || {};
    ev.type = type;
    ev.target = ev.target || this;
    for (const listener of (this.listeners[type] || []).slice()) listener.call(this, ev);
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) {
    this.children = this.children.filter(candidate => candidate !== child);
    const drop = node => {
      for (const nested of node.children.slice()) drop(nested);
      if (node.id && this.registry[node.id] === node) delete this.registry[node.id];
    };
    drop(child); child.parentNode = null; return child;
  }
  focus() { this.focused = true; }
}

function eventTarget(target) {
  const listeners = Object.create(null);
  target.addEventListener = function (type, listener) { (listeners[type] || (listeners[type] = [])).push(listener); };
  target.removeEventListener = function (type, listener) { listeners[type] = (listeners[type] || []).filter(fn => fn !== listener); };
  target.dispatchEvent = function (event) {
    for (const listener of (listeners[event.type] || []).slice()) listener.call(target, event);
    return true;
  };
  target._listeners = listeners;
  return target;
}

(async function () {
  const registry = Object.create(null);
  const document = eventTarget({ readyState: 'complete' });
  document.createElement = tag => new Element(tag, registry);
  document.getElementById = id => registry[id] || null;
  document.head = new Element('head', registry);
  document.body = new Element('body', registry);
  document.documentElement = new Element('html', registry);

  const calls = { day: [], month: [], prep: [], acks: [] };
  const rosterRow = { id: 'doctor-7', stableKey: 'athena:doctor-7', raw: 'Doctor Seven MD', name: 'Doctor Seven, MD' };
  const window = eventTarget({
    __mlsProviderRoster: {
      list() { return [rosterRow]; },
      resolve(value) { return decodeURIComponent(String(value).replace(/^pv:/, '')) === rosterRow.stableKey ? rosterRow : null; },
      getReceipt() { return { complete: true }; }
    },
    __mlsSI: {
      pull(options) { calls.day.push(options); options.onStatus('Day read complete.', 'ok'); return Promise.resolve({ ok: true, complete: true }); },
      pullMonth(options) { calls.month.push(options); options.onStatus('Month read complete.', 'ok'); return Promise.resolve({ ok: true, complete: true }); }
    },
    openOpPrep(day) { calls.prep.push(day); }
  });
  const originalDispatch = window.dispatchEvent;
  window.dispatchEvent = function (event) {
    if (event.type === 'mls:menu-staff-prep-opened') calls.acks.push(event.detail);
    return originalDispatch.call(window, event);
  };

  function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  const context = { window, document, CustomEvent, Date, Promise, Array, Object, String, encodeURIComponent, decodeURIComponent, setTimeout(fn) { fn(); return 1; }, clearTimeout() {} };
  vm.createContext(context);
  vm.runInContext(moduleSource, context, { filename: 'mls-connect.staging.js#staff-prep' });

  assert(window.__mlsStagingStaffPrep && window.__mlsStagingStaffPrep.installed, 'staging Staff Prep receiver did not install');
  window.dispatchEvent(new CustomEvent('mls:menu-staff-prep-request', { detail: { source: 'untrusted', requestId: 'wrong' } }));
  assert.strictEqual(registry.mlsStagingStaffPrep, undefined, 'untrusted event opened Staff Prep');

  window.dispatchEvent(new CustomEvent('mls:menu-staff-prep-request', { detail: { source: 'mls-topbar-menu', requestId: 'request-1' } }));
  assert.strictEqual(registry.mlsStagingStaffPrep.style.display, 'flex', 'Menu request did not open staging Staff Prep');
  assert.deepStrictEqual(calls.acks.map(detail => ({ source: detail.source, requestId: detail.requestId })),
    [{ source: 'mls-staging-staff-prep', requestId: 'request-1' }], 'Menu request was not acknowledged after the dialog mounted');
  assert.deepStrictEqual({ day: calls.day.length, month: calls.month.length }, { day: 0, month: 0 }, 'opening Staff Prep started an automatic Athena pull');

  registry.mlsSspDay.value = '2026-07-21';
  registry.mlsSspPullDay.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(calls.day.length, 1, 'explicit day button did not use the exact day pull');
  assert.strictEqual(calls.day[0].date, '2026-07-21');
  assert.strictEqual(calls.day[0].provider, 'all');
  assert.strictEqual(calls.day[0].includeHistory, true);

  registry.mlsSspProvider.value = 'pv:' + encodeURIComponent(rosterRow.stableKey);
  registry.mlsSspMonth.value = '2026-07';
  registry.mlsSspPullMonth.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(calls.month.length, 1, 'explicit month button did not use the exact month pull');
  assert.strictEqual(calls.month[0].month, '2026-07');
  assert.deepStrictEqual(
    { id: calls.month[0].provider.id, stableKey: calls.month[0].provider.stableKey, rosterVerified: calls.month[0].provider.rosterVerified },
    { id: 'doctor-7', stableKey: 'athena:doctor-7', rosterVerified: true },
    'month pull widened or lost the verified provider identity'
  );

  registry.mlsSspDay.value = '2026-07-22';
  registry.mlsSspPrepNotes.dispatch('click');
  assert.deepStrictEqual(calls.prep, ['2026-07-22'], 'op-note prep did not retain the selected Staff Prep day');

  window.__mlsStagingStaffPrep.revert();
  assert.strictEqual(registry.mlsStagingStaffPrep, undefined, 'revert left the staging Staff Prep dialog mounted');
  const ackCount = calls.acks.length;
  window.dispatchEvent(new CustomEvent('mls:menu-staff-prep-request', { detail: { source: 'mls-topbar-menu', requestId: 'after-revert' } }));
  assert.strictEqual(calls.acks.length, ackCount, 'revert left the Staff Prep Menu listener active');

  console.log('PASS staging Staff Prep: Menu opens one explicit exact day/month pull surface with no automatic Athena action');
})().catch(error => { console.error(error); process.exit(1); });
