'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_writeback_safety.js'), 'utf8');
assert(source.includes("var VERSION = 'wbs-1.2.0'"), 'writeback safety fast-path version is missing');
assert(!/setInterval\s*\(/.test(source), 'writeback preview regained its four-second permanent poll');
assert(source.includes('renderPreview(panel, true);   /* re-evaluate FRESH at click time */'),
  'write click no longer forces a fresh fail-closed patient check');
assert(source.includes("panel.addEventListener('input', function () { renderPreview(panel, false);"),
  'ordinary panel input no longer uses the cached presentation snapshot');
assert(source.includes("S(ev.key) !== activeStorageKey()"),
  'writeback preview does not listen for the exact cross-tab active-patient key');
assert(source.includes('hideStalePreview(panel);') && source.includes('scheduleStoragePreview();'),
  'cross-tab patient changes no longer hide stale identity before idle reconciliation');
assert(source.includes("panel.getAttribute('data-wbs-identity-pending')"),
  'panel input can repaint a cross-tab stale patient while reconciliation is pending');

const start = source.indexOf('var previewPatientId = null');
const end = source.indexOf('function esc(', start);
assert(start >= 0 && end > start, 'writeback patient snapshot helper is missing');
let rosterReads = 0, activeId = 'p-1';
const context = {
  S(value) { return value == null ? '' : String(value); },
  activePt() { rosterReads++; return { id: activeId, name: 'Synthetic Patient', dob: '2000-01-01', mrn: 'TEST-1' }; },
  window: {
    getActivePtId() { return activeId; },
    activePatient() { throw new Error('extracted helper must use the injected activePt owner'); }
  }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nthis.previewPatient=previewPatient;', context);
assert.strictEqual(context.previewPatient(true).id, 'p-1');
for (let i = 0; i < 1000; i++) assert.strictEqual(context.previewPatient(false).id, 'p-1');
assert.strictEqual(rosterReads, 1, '1,000 writeback inputs repeatedly read the roster');
activeId = 'p-2';
assert.strictEqual(context.previewPatient(false), null, 'unexpected patient switch reused stale identity on input');
assert.strictEqual(rosterReads, 1, 'unexpected patient switch decoded the roster from the input event');
assert.strictEqual(context.previewPatient(true).id, 'p-2', 'fresh write-click lookup did not adopt the current patient');
assert.strictEqual(rosterReads, 2, 'fresh write-click lookup performed duplicate patient reads');

/* The real boot/storage helpers must hide patient A synchronously without a
   roster read, then reconcile patient B only in a genuine idle callback. */
const bootStart = source.indexOf('var STATE = { blocks: 0');
const bootEnd = source.indexOf('function revert()', bootStart);
assert(bootStart >= 0 && bootEnd > bootStart, 'writeback lifecycle helper block is missing');
const listeners = Object.create(null);
const localStorage = {};
let idleCallback = null, idleArgCount = -1, invalidations = 0, storageRosterReads = 0;
const attrs = new Map([['data-wbs', '1']]);
const host = { style: { display: '' } };
const buttonAttrs = new Map();
const button = {
  style: {}, title: 'Write',
  setAttribute(k, v) { buttonAttrs.set(k, String(v)); },
  getAttribute(k) { return buttonAttrs.has(k) ? buttonAttrs.get(k) : null; }
};
const panel = {
  getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
  setAttribute(k, v) { attrs.set(k, String(v)); },
  removeAttribute(k) { attrs.delete(k); },
  querySelector(sel) { return sel === '#mlsWbSafety' ? host : (sel === '#emrWbAthena' ? button : null); }
};
const bootContext = {
  stopped: false,
  lastVerdict: {},
  S(value) { return value == null ? '' : String(value); },
  navigator: { scheduling: { isInputPending() { return false; } } },
  invalidatePreviewPatient() { invalidations++; },
  renderPreview(p, force) {
    assert.strictEqual(p, panel);
    assert.strictEqual(force, true);
    storageRosterReads++;
    host.style.display = '';
    p.removeAttribute('data-wbs-identity-pending');
    return {};
  },
  gateClick() {},
  setTimeout(fn) { throw new Error('genuine requestIdleCallback path must not use a timer'); },
  clearTimeout() {},
  MutationObserver: class { observe() {} disconnect() {} },
  document: {
    body: {},
    getElementById(id) { return id === 'emrPanel' ? panel : null; },
    addEventListener() {}, removeEventListener() {}
  },
  window: {
    localStorage,
    uns(name) { return name === 'activePt' ? 'acct::activePt' : ''; },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
    requestIdleCallback(fn) { idleArgCount = arguments.length; idleCallback = fn; return 41; },
    cancelIdleCallback() {}
  }
};
vm.createContext(bootContext);
vm.runInContext(source.slice(bootStart, bootEnd) + '\nthis.boot=boot;', bootContext);
bootContext.boot();
assert.strictEqual(typeof listeners.storage, 'function', 'writeback storage listener was not installed');
listeners.storage({ key: 'acct::unrelated', storageArea: localStorage });
assert.strictEqual(invalidations, 0, 'unrelated storage invalidated the preview');
listeners.storage({ key: 'acct::activePt', storageArea: localStorage });
assert.strictEqual(storageRosterReads, 0, 'cross-tab storage synchronously decoded the roster');
assert.strictEqual(host.style.display, 'none', 'old patient preview remained visible before idle');
assert.strictEqual(panel.getAttribute('data-wbs-identity-pending'), '1', 'pending patient identity was not fail-closed');
assert.strictEqual(buttonAttrs.get('data-wbs-blocked'), '1', 'write action was not blocked during cross-tab reconciliation');
assert.strictEqual(idleArgCount, 1, 'storage reconciliation used an idle timeout that can fire during input');
assert.strictEqual(typeof idleCallback, 'function', 'storage reconciliation did not schedule genuine idle work');
idleCallback({ didTimeout: false, timeRemaining() { return 20; } });
assert.strictEqual(storageRosterReads, 1, 'idle reconciliation did not perform exactly one fresh patient lookup');
assert.strictEqual(host.style.display, '', 'new patient preview did not return after idle reconciliation');
assert.strictEqual(panel.getAttribute('data-wbs-identity-pending'), null, 'pending identity marker survived reconciliation');

console.log('PASS writeback patient fast path: 1,000 inputs use one snapshot, clicks reverify, and cross-tab identity hides before genuine-idle repair');
