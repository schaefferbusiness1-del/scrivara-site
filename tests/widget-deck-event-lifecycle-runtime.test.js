'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_widget_deck.js'), 'utf8');

assert(!/\bsetInterval\s*\(/.test(source), 'widget deck regained a permanent 1.2-second poll');
assert(!source.includes('offsetParent'), 'widget deck still forces layout to discover Visit visibility');
assert(source.includes("window.addEventListener('mls:view-changed', onViewChanged)") &&
  source.includes("window.addEventListener('mls:active-patient-changed', onPatientChanged)") &&
  source.includes("window.addEventListener('mls:session-boundary', onSessionBoundary)"),
  'widget deck is not driven by canonical view/patient/session events');
assert(source.includes("hostObserver.observe(host, { childList: true, subtree: true, characterData: true })") &&
  source.includes("builderObserver.observe(builder, { childList: true, subtree: true })"),
  'widget deck repair observers are not scoped to the base widget and builder roots');
assert(!/\.observe\((?:document|document\.documentElement|document\.body)/.test(source),
  'widget deck added a document-wide observer');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn); listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter(item => item !== fn));
    },
    emit(type, detail) { (listeners.get(type) || []).slice().forEach(fn => fn({ type, detail: detail || {} })); },
    count(type) { return (listeners.get(type) || []).length; }
  };
}

function classList() {
  const values = new Set();
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); }
  };
}

const ids = new Map();
function node(id) {
  const attrs = Object.create(null);
  const n = {
    id: id || '', style: { display: '' }, className: '', classList: classList(),
    children: [], parentNode: null, parentElement: null, innerHTML: '', textContent: '',
    setAttribute(name, value) { attrs[name] = String(value); if (name === 'id') this.id = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    addEventListener() {}, focus() {},
    appendChild(child) {
      child.parentNode = child.parentElement = this;
      this.children.push(child);
      if (child.id) ids.set(child.id, child);
      return child;
    },
    insertBefore(child, before) {
      child.parentNode = child.parentElement = this;
      const index = this.children.indexOf(before);
      if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
      if (child.id) ids.set(child.id, child);
      return child;
    },
    removeChild(child) { child.remove(); return child; },
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      if (this.id) ids.delete(this.id);
      this.parentNode = this.parentElement = null;
    },
    closest(selector) {
      if (selector === '#' + this.id) return this;
      return this.parentNode && this.parentNode.closest ? this.parentNode.closest(selector) : null;
    },
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
  if (id) ids.set(id, n);
  return n;
}

const winEvents = eventTarget();
const docEvents = eventTarget();
const head = node('head');
const documentElement = node('html');
const body = node('body');
const visit = node('visitView'); visit.style.display = 'none';
let layoutReads = 0;
Object.defineProperty(visit, 'offsetParent', { get() { layoutReads++; throw new Error('forced layout read'); } });
const note = node('noteCard'); visit.appendChild(note);
const host = node('customWidgetsHost'); visit.appendChild(host);
const builder = node('widgetBuilderModal');
const builderField = node('cwBuilderField'); builder.appendChild(builderField);
const describe = node('cwDescribe'); builderField.appendChild(describe);

const document = {
  readyState: 'complete', hidden: false, head, body, documentElement,
  getElementById(id) { return ids.get(id) || null; },
  createElement(tag) { const n = node(); n.tagName = String(tag).toUpperCase(); return n; },
  addEventListener: docEvents.addEventListener,
  removeEventListener: docEvents.removeEventListener
};

const frames = [];
const observers = [];
class FakeMutationObserver {
  constructor(callback) { this.callback = callback; this.target = null; this.disconnected = false; observers.push(this); }
  observe(target, options) { this.target = target; this.options = options; this.disconnected = false; }
  disconnect() { this.disconnected = true; }
  fire() { this.callback([]); }
}

let widgetReads = 0, baseRenders = 0, baseSets = 0, outputRenders = 0;
function originalRenderCustomWidgets() { baseRenders++; }
function originalSetCustomWidgets() { baseSets++; }
function originalRenderOutput() { outputRenders++; }

const context = {
  console, JSON, String, Number, Boolean, Object, Array, Math, Date, RegExp,
  document, MutationObserver: FakeMutationObserver,
  localStorage: { getItem() { return '[]'; } },
  uns(key) { return 'acct::' + key; },
  getCustomWidgets() { widgetReads++; return []; },
  getRenderableCustomWidgets() { widgetReads++; return []; },
  cwAnalyzeWidgetSpecs() { return { hiddenCount: 0, titleConflictCount: 0 }; },
  renderCustomWidgets: originalRenderCustomWidgets,
  setCustomWidgets: originalSetCustomWidgets,
  cwRenderOutput: originalRenderOutput,
  openWidgetBuilder() {}, refreshCustomWidget() {}, cwPushToNote() {},
  addEventListener: winEvents.addEventListener,
  removeEventListener: winEvents.removeEventListener,
  requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
  setTimeout(fn) { frames.push(fn); return frames.length; }, clearTimeout() {}
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_widget_deck.js' });

assert.strictEqual(context.__mlsWidgetDeck.version, 'wd-1.2.0');
assert.strictEqual(widgetReads, 0, 'hidden Visit view performed widget-list/render work at boot');
assert.strictEqual(layoutReads, 0, 'widget deck forced layout at boot');
assert.strictEqual(observers.length, 2, 'widget deck did not install exactly two scoped observers');
assert.strictEqual(observers.find(observer => observer.target === host).target, host, 'base widget observer is not host-scoped');
assert.strictEqual(observers.find(observer => observer.target === builder).target, builder, 'builder observer is not modal-scoped');
for (const type of ['mls:view-changed', 'mls:active-patient-changed', 'mls:session-boundary', 'storage']) {
  assert.strictEqual(winEvents.count(type), 1, `${type} listener is not installed exactly once`);
}
assert.strictEqual(docEvents.count('visibilitychange'), 1, 'visibility lifecycle listener is missing');

winEvents.emit('mls:view-changed', { view: 'patients', previousView: 'visit' });
assert.strictEqual(frames.length, 0, 'unrelated route scheduled widget work');

visit.style.display = 'block';
winEvents.emit('mls:view-changed', { view: 'visit', previousView: 'patients' });
winEvents.emit('mls:active-patient-changed', { patientId: 'patient-a' });
observers.find(observer => observer.target === host).fire();
assert.strictEqual(frames.length, 1, 'same-turn view/patient/base-render signals did not coalesce');
frames.shift()();
assert(document.getElementById('mlsWdDeck'), 'visible Visit activation did not mount the unchanged deck UI');
assert(widgetReads > 0, 'visible Visit activation did not read the widget list');
assert.strictEqual(layoutReads, 0, 'visible Visit activation read offsetParent/forced layout');

const readsBeforeRemotePatient = widgetReads;
winEvents.emit('storage', { key: 'acct::activePt' });
assert.strictEqual(frames.length, 1, 'cross-tab active patient did not schedule widget ownership repair');
frames.shift()();
assert(widgetReads > readsBeforeRemotePatient, 'cross-tab active patient left the previous patient widget deck rendered');

const readsBeforeSet = widgetReads;
context.setCustomWidgets([]);
context.renderCustomWidgets();
context.cwRenderOutput({}, '');
assert.strictEqual(baseSets, 1, 'setCustomWidgets wrapper did not delegate once');
assert.strictEqual(baseRenders, 1, 'renderCustomWidgets wrapper did not delegate once');
assert.strictEqual(outputRenders, 1, 'cwRenderOutput wrapper did not delegate once');
assert.strictEqual(frames.length, 1, 'widget store/base/output signals did not coalesce into one frame');
frames.shift()();
assert(widgetReads > readsBeforeSet, 'widget persistence did not invalidate the memoized deck list');

const chips = document.getElementById('mlsWdBuilderChips');
assert(chips, 'builder example chips did not mount');
chips.remove();
observers.find(observer => observer.target === builder).fire();
assert(document.getElementById('mlsWdBuilderChips'), 'builder-scoped mutation did not repair removed chips');

const replacementHost = node('customWidgetsHost');
const replacementBuilder = node('widgetBuilderModal');
winEvents.emit('mls:view-changed', { view: 'visit', previousView: 'patients' });
assert(observers.some(observer => observer.target === replacementHost),
  'canonical repair did not move the widget observer to a replaced host');
assert(observers.some(observer => observer.target === replacementBuilder),
  'canonical repair did not move the builder observer to a replaced modal');
assert.strictEqual(frames.length, 1, 'replacement-root repair did not stay coalesced');
frames.shift()();

let hotBaseRenders = 0, hotBaseSets = 0, hotOutputRenders = 0;
function hotRenderCustomWidgets() { hotBaseRenders++; }
function hotSetCustomWidgets() { hotBaseSets++; }
function hotRenderOutput() { hotOutputRenders++; }
context.renderCustomWidgets = hotRenderCustomWidgets;
context.setCustomWidgets = hotSetCustomWidgets;
context.cwRenderOutput = hotRenderOutput;
winEvents.emit('mls:active-patient-changed', { patientId: 'hot-owner' });
assert.strictEqual(context.renderCustomWidgets.__wdDeckOrig, hotRenderCustomWidgets,
  'canonical repair did not wrap a hot renderCustomWidgets replacement');
assert.strictEqual(context.setCustomWidgets.__wdDeckOrig, hotSetCustomWidgets,
  'canonical repair did not wrap a hot setCustomWidgets replacement');
assert.strictEqual(context.cwRenderOutput.__wdOrig, hotRenderOutput,
  'canonical repair did not wrap a hot cwRenderOutput replacement');
context.renderCustomWidgets();
context.setCustomWidgets([]);
context.cwRenderOutput({}, '');
assert.strictEqual(hotBaseRenders, 1, 'hot renderCustomWidgets wrapper did not delegate once');
assert.strictEqual(hotBaseSets, 1, 'hot setCustomWidgets wrapper did not delegate once');
assert.strictEqual(hotOutputRenders, 1, 'hot cwRenderOutput wrapper did not delegate once');
assert.strictEqual(frames.length, 1, 'hot-owner repair/render signals did not stay coalesced');
frames.shift()();

document.hidden = true;
winEvents.emit('mls:active-patient-changed', { patientId: 'patient-b' });
assert.strictEqual(frames.length, 0, 'hidden document scheduled widget deck work');
document.hidden = false;
docEvents.emit('visibilitychange');
assert.strictEqual(frames.length, 1, 'foregrounding did not schedule the retained widget refresh');

context.__mlsWidgetDeck.revert();
frames.shift()();
assert.strictEqual(context.__mlsWidgetDeck.installed, false, 'revert did not retire the widget owner');
assert.strictEqual(context.renderCustomWidgets, hotRenderCustomWidgets, 'revert did not restore the hot renderCustomWidgets owner');
assert.strictEqual(context.setCustomWidgets, hotSetCustomWidgets, 'revert did not restore the hot setCustomWidgets owner');
assert.strictEqual(context.cwRenderOutput, hotRenderOutput, 'revert did not restore the hot cwRenderOutput owner');
for (const type of ['mls:view-changed', 'mls:active-patient-changed', 'mls:session-boundary', 'storage']) {
  assert.strictEqual(winEvents.count(type), 0, `${type} listener leaked after revert`);
}
assert.strictEqual(docEvents.count('visibilitychange'), 0, 'visibility listener leaked after revert');
assert(observers.every(observer => observer.disconnected), 'a scoped observer remained connected after revert');
assert.strictEqual(document.getElementById('mlsWdDeck'), null, 'queued work resurrected the deck after revert');
assert.strictEqual(document.getElementById('mlsWdStyle'), null, 'widget style remained after revert');
assert(!body.classList.contains('mls-widget-deck-owner'), 'widget ownership class remained after revert');

console.log('PASS widget deck lifecycle: no permanent poll/layout read, canonical coalesced repair, scoped observers, delegated wrappers, hidden-tab quiet, and complete revert');
