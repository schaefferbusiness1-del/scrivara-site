'use strict';

/* The Visit allergy strip keeps the same DOM/text contract but only reads the
 * active patient on explicit route/patient/store lifecycle signals. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_allergy_strip.js'), 'utf8');

function eventTarget(target) {
  const handlers = Object.create(null);
  target.addEventListener = function (name, fn) {
    (handlers[name] || (handlers[name] = [])).push(fn);
  };
  target.removeEventListener = function (name, fn) {
    handlers[name] = (handlers[name] || []).filter(item => item !== fn);
  };
  target.emit = function (name, event) {
    (handlers[name] || []).slice().forEach(fn => fn(event || { type: name }));
  };
  target.listenerCount = name => (handlers[name] || []).length;
  return target;
}

function frameHarness() {
  let nextId = 0;
  const frames = new Map();
  return {
    request(fn) { const id = ++nextId; frames.set(id, fn); return id; },
    cancel(id) { frames.delete(id); },
    run() {
      const row = frames.entries().next();
      if (row.done) return false;
      const [id, fn] = row.value;
      frames.delete(id);
      fn();
      return true;
    },
    get count() { return frames.size; }
  };
}

const frames = frameHarness();
const idle = frameHarness();
const elements = Object.create(null);
const localStorage = {};
let intervalCreates = 0;
let active = { id: 'p-1', name: 'Synthetic One', allergies: 'Penicillin' };
let activeReads = 0;

function element(tag) {
  return {
    tagName: String(tag || '').toUpperCase(),
    id: '',
    className: '',
    style: {},
    innerHTML: '',
    textContent: '',
    parentNode: null,
    nextSibling: null,
    attrs: Object.create(null),
    setAttribute(name, value) { this.attrs[name] = String(value); },
    remove() {
      if (this.id && elements[this.id] === this) delete elements[this.id];
      this.parentNode = null;
      this.nextSibling = null;
    }
  };
}

const parent = {
  insertBefore(node, before) {
    node.parentNode = this;
    node.nextSibling = before;
    if (node.id) elements[node.id] = node;
  }
};
const grid = element('div');
grid.offsetParent = {};
grid.parentNode = parent;
const head = {
  appendChild(node) {
    node.parentNode = this;
    if (node.id) elements[node.id] = node;
  }
};
const document = eventTarget({
  readyState: 'complete',
  hidden: false,
  head,
  createElement: element,
  getElementById(id) { return elements[id] || null; },
  querySelector(selector) { return selector === '.vx-grid' ? grid : null; }
});
const window = eventTarget({
  document,
  localStorage,
  __mlsCurrentView: 'visit',
  uns(suffix) { return 'sf_u::doctor@example.test::' + suffix; },
  getActivePtId() { return active && active.id; },
  activePatient() { activeReads++; return active; },
  requestAnimationFrame: frames.request,
  cancelAnimationFrame: frames.cancel,
  requestIdleCallback: idle.request,
  cancelIdleCallback: idle.cancel
});
window.window = window;

const context = vm.createContext({
  window, document, localStorage, console,
  setTimeout(fn) { return frames.request(fn); },
  clearTimeout(id) { frames.cancel(id); },
  setInterval() { intervalCreates++; return intervalCreates; },
  clearInterval() {},
  navigator: { scheduling: { isInputPending() { return false; } } }
});
vm.runInContext(source, context, { filename: 'feat_mls_allergy_strip.js', timeout: 1000 });

const api = window.__mlsAllergyStrip;
assert(api && api.version === 'allergy-strip-1.1.0', 'event-driven allergy strip did not install');
assert.strictEqual(intervalCreates, 0, 'allergy strip installed an idle polling interval');
assert.strictEqual(activeReads, 0, 'allergy strip cold-read the roster while its late asset installed');
assert.strictEqual(idle.count, 1, 'allergy strip did not admit its initial record lookup at genuine idle');
idle.run();
assert.strictEqual(activeReads, 0, 'allergy strip read the roster before its idle frame');
assert.strictEqual(frames.count, 1, 'allergy startup idle admission did not hand off one render');
frames.run();
assert.strictEqual(activeReads, 1, 'allergy strip did more than its one visible idle boot read');
let strip = elements.mlsAllergyStrip;
assert(strip && /Penicillin/.test(strip.innerHTML), 'initial allergy UI/text contract changed');
assert.strictEqual(strip.className, 'mlsalg-has', 'documented allergy styling changed');
[
  'mls:view-changed', 'mls:active-patient-changed', 'mls:patient-record-updated',
  'mls:session-boundary', 'mls:ui-ready', 'pageshow', 'storage'
].forEach(name => assert.strictEqual(window.listenerCount(name), 1, name + ' listener is not installed exactly once'));
assert.strictEqual(document.listenerCount('visibilitychange'), 1, 'visibility lifecycle listener is missing');

active = { id: 'p-2', name: 'Synthetic Two', allergies: 'NKDA' };
window.emit('mls:active-patient-changed', { detail: { patientId: 'p-2' } });
window.emit('mls:active-patient-changed', { detail: { patientId: 'p-2' } });
assert.strictEqual(frames.count, 1, 'rapid patient signals did not coalesce to one render');
frames.run();
assert.strictEqual(activeReads, 2, 'one patient switch caused duplicate full-roster reads');
assert(/NKDA/.test(strip.innerHTML) && strip.className === 'mlsalg-none', 'NKDA UI changed after patient switch');

window.emit('mls:patient-record-updated', {
  detail: { patientId: 'someone-else', patientStoreKey: window.uns('patients') }
});
assert.strictEqual(frames.count, 0, 'unrelated patient update scheduled an active-patient read');
window.emit('storage', { key: window.uns('notes'), storageArea: localStorage });
assert.strictEqual(frames.count, 0, 'unrelated store generation scheduled an allergy read');

active.allergies = 'Latex';
window.emit('mls:patient-record-updated', {
  detail: { patientId: 'p-2', patientStoreKey: window.uns('patients') }
});
assert.strictEqual(frames.count, 1, 'active patient record update did not refresh the strip');
frames.run();
assert.strictEqual(activeReads, 3, 'active record update caused duplicate reads');
assert(/Latex/.test(strip.innerHTML) && strip.className === 'mlsalg-has', 'same-patient allergy update changed the UI contract');

active.allergies = 'Queued then invalidated';
const readsBeforeQueuedRace = activeReads;
window.emit('mls:active-patient-changed', { detail: { patientId: 'p-2' } });
assert.strictEqual(frames.count, 1, 'same-tab active signal did not queue its normal render');
window.emit('storage', { key: window.uns('patients'), storageArea: localStorage });
assert.strictEqual(frames.count, 0, 'cross-tab invalidation left an unsafe pre-idle frame queued');
assert.strictEqual(activeReads, readsBeforeQueuedRace, 'cross-tab invalidation decoded the roster before idle');
assert.strictEqual(idle.count, 1, 'cross-tab invalidation did not replace the frame with idle work');
idle.run(); frames.run();
assert.strictEqual(activeReads, readsBeforeQueuedRace + 1, 'cross-tab race repair did not perform exactly one idle read');

active = { id: 'p-3', name: 'Synthetic Three', allergies: 'Shellfish' };
const readsBeforeRemotePatient = activeReads;
window.emit('storage', { key: window.uns('activePt'), storageArea: localStorage });
assert.strictEqual(strip.style.display, 'none', 'remote patient switch left the prior patient allergy visible');
assert.strictEqual(activeReads, readsBeforeRemotePatient, 'remote patient switch decoded the roster in the storage stack');
assert.strictEqual(idle.count, 1, 'remote patient switch did not schedule one idle record refresh');
idle.run(); frames.run();
assert.strictEqual(activeReads, readsBeforeRemotePatient + 1, 'remote patient idle refresh did not perform one record read');
assert(/Shellfish/.test(strip.innerHTML), 'remote patient idle refresh did not adopt the new allergy');

window.__mlsCurrentView = 'patients';
const readsBeforeLeavingVisit = activeReads;
window.emit('mls:view-changed', { detail: { previousView: 'visit', view: 'patients' } });
frames.run();
assert.strictEqual(activeReads, readsBeforeLeavingVisit, 'leaving Visit scanned the roster');
assert.strictEqual(strip.style.display, 'none', 'leaving Visit did not hide the strip');
window.emit('mls:active-patient-changed', { detail: { patientId: 'p-2' } });
frames.run();
assert.strictEqual(activeReads, readsBeforeLeavingVisit, 'hidden Visit patient event scanned the roster');

window.__mlsCurrentView = 'visit';
window.emit('mls:view-changed', { detail: { previousView: 'patients', view: 'visit' } });
assert.strictEqual(frames.count, 0, 'opening Visit re-entered the first navigation frame');
assert.strictEqual(idle.count, 1, 'opening Visit did not wait for genuine idle');
idle.run();
assert.strictEqual(frames.count, 1, 'Visit idle admission did not hand off one render');
frames.run();
assert.strictEqual(activeReads, readsBeforeLeavingVisit + 1, 'opening Visit did not perform its one required active-patient read');
assert.strictEqual(strip.style.display, '', 'returning to Visit did not restore the strip');

active.allergies = 'Sulfa';
window.emit('storage', { key: window.uns('patients'), storageArea: localStorage });
assert.strictEqual(frames.count, 0, 'cross-tab patient generation re-entered the next-frame click lane');
assert.strictEqual(idle.count, 1, 'exact cross-tab patient generation did not schedule one idle refresh');
idle.run();
assert.strictEqual(frames.count, 1, 'idle cross-tab refresh did not hand off one render frame');
frames.run();
assert.strictEqual(activeReads, readsBeforeLeavingVisit + 2, 'cross-tab patient generation caused duplicate reads');
assert(/Sulfa/.test(strip.innerHTML), 'cross-tab allergy update did not reach the visible strip');

document.hidden = true;
document.emit('visibilitychange');
assert.strictEqual(frames.count, 0, 'hidden-tab visibility event scheduled work');
document.hidden = false;
document.emit('visibilitychange');
assert.strictEqual(frames.count, 0, 'visible-tab resume re-entered the first-click frame');
assert.strictEqual(idle.count, 1, 'visible-tab resume did not schedule an idle refresh');
const readsBeforeVisibleIdle = activeReads;
idle.run();
assert.strictEqual(activeReads, readsBeforeVisibleIdle, 'visible-tab idle admission read before its render frame');
assert.strictEqual(frames.count, 1, 'visible-tab idle admission did not hand off one render');
frames.run();
assert.strictEqual(activeReads, readsBeforeVisibleIdle + 1, 'visible-tab resume did not perform one fresh active-patient read');

active = { id: 'p-4', name: 'Synthetic Four', allergies: 'Iodine' };
const readsBeforeBoundary = activeReads;
window.emit('mls:session-boundary', { detail: { nextAccount: 'doctor-b@example.test' } });
assert.strictEqual(strip.style.display, 'none', 'account boundary left the previous account allergy visible');
assert.strictEqual(activeReads, readsBeforeBoundary, 'account boundary decoded the roster in the post-login task');
assert.strictEqual(frames.count, 0, 'account boundary queued an immediate allergy frame');
assert.strictEqual(idle.count, 1, 'account boundary did not defer allergy lookup to genuine idle');
idle.run(); frames.run();
assert.strictEqual(activeReads, readsBeforeBoundary + 1, 'account boundary idle repair did not read exactly once');
assert(/Iodine/.test(strip.innerHTML), 'account boundary idle repair did not adopt the new patient allergy');

api.revert();
assert.strictEqual(frames.count, 0, 'revert left allergy work scheduled');
assert.strictEqual(idle.count, 0, 'revert left allergy idle work scheduled');
assert.strictEqual(elements.mlsAllergyStrip, undefined, 'revert left the allergy strip in the DOM');
assert.strictEqual(elements['mlsAllergyStrip-style'], undefined, 'revert left allergy CSS in the DOM');
[
  'mls:view-changed', 'mls:active-patient-changed', 'mls:patient-record-updated',
  'mls:session-boundary', 'mls:ui-ready', 'pageshow', 'storage'
].forEach(name => assert.strictEqual(window.listenerCount(name), 0, name + ' listener leaked after revert'));
assert.strictEqual(document.listenerCount('visibilitychange'), 0, 'visibility listener leaked after revert');
const readsAfterRevert = activeReads;
window.emit('mls:active-patient-changed', { detail: { patientId: 'p-2' } });
assert.strictEqual(activeReads, readsAfterRevert, 'reverted allergy strip still read the roster');

console.log('PASS allergy strip lifecycle is event-driven: identical UI, no idle polling, exact filtering, clean revert');
