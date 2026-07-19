'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const deckSource = fs.readFileSync(path.join(root, 'feat_mls_widget_deck.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `could not extract ${start}`);
  return source.slice(a, b);
}

const identitySource = between(app, 'const CW_MAX_WIDGETS=10;', '/* Browse-library view:');
const saveSource = between(app, 'function saveCustomWidget(){', 'function editCustomWidget(id)');
const managerSource = between(app, 'function renderWidgetBuilderList(){', '/* ---- render the REAL cards');

const storage = new Map();
const toasts = [];
const fields = {
  cwTitle: field(), cwPrompt: field(), cwEmoji: field('🧩'), cwDescription: field(),
  cwFormat: field('text'), cwAuto: field('', true), cwUseHistory: field('', false),
  cwSaveBtn: field(), cwList: field()
};
let reenterSave = false;
let reentered = false;
const identityContext = {
  console, JSON, String, Number, Boolean, Object, Array, Math, Date, RegExp,
  isFinite, setTimeout(fn) { fn(); return 1; },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  },
  uns(key) { return key; },
  syncPrefsToServer() {
    if (reenterSave && !reentered) {
      reentered = true;
      identityContext.__cwApi.save();
    }
  },
  effectivePremium() { return true; },
  toast(message, kind) { toasts.push({ message: String(message), kind: kind || '' }); },
  renderWidgetBuilderList() {}, renderCustomWidgets() {}, cwHideLibrary() {},
  hideWidgetPreview() {},
  esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, ''); },
  document: { getElementById(id) { return fields[id] || null; } }
};
identityContext.window = identityContext;
vm.createContext(identityContext);
vm.runInContext(
  identitySource + '\n' + saveSource + '\n' + managerSource + `
this.__cwApi={
  install:installLibraryWidget,
  save:saveCustomWidget,
  fingerprint:cwSemanticFingerprint,
  identity:cwWidgetIdentity,
  analyze:cwAnalyzeWidgetSpecs,
  getAll:getCustomWidgets,
  getRenderable:getRenderableCustomWidgets,
  renderManager:renderWidgetBuilderList,
  setPending:function(v){_cwPendingLayout=v;},
  resetCreate:function(){_cwEditingId=null;_cwEditingIndex=null;_cwCreateInFlight=false;}
};`,
  identityContext,
  { filename: 'custom-widget-identity-runtime.js' }
);

const api = identityContext.__cwApi;

/* Repeated curated install is idempotent, including an event-turn re-entry. */
storage.set('customWidgets', '[]');
api.install(0);
api.install(0);
assert.strictEqual(api.getAll().length, 1, 'installing the same library widget twice created two saved rows');
assert.strictEqual(api.getAll()[0].originKey, 'library:injection-tracker', 'library origin identity was not persisted');

/* Create + exact double-save are idempotent, and the explicit in-flight guard
   prevents a persistence callback from re-entering the create path. */
storage.set('customWidgets', '[]');
toasts.length = 0;
api.resetCreate();
setBuilderFields('Work status', 'Extract documented work status.');
api.setPending([{ type: 'select', label: 'Status', options: ['Full duty', 'Off work'] }]);
reenterSave = true;
reentered = false;
api.save();
reenterSave = false;
api.save();
assert(reentered, 'test did not exercise the re-entrant/double-click save guard');
assert.strictEqual(api.getAll().length, 1, 'double-save or re-entrant save created a duplicate widget');

/* Semantic identity ignores case and repeated whitespace throughout the title,
   prompt, and layout strings, but retains materially different instructions. */
const first = api.getAll()[0];
const equivalent = Object.assign({}, first, {
  id: 'equivalent',
  title: '  WORK   STATUS ',
  prompt: ' extract   DOCUMENTED work status. ',
  layout: [{ type: 'SELECT', label: ' status ', options: [' full duty ', 'OFF WORK'] }]
});
assert.strictEqual(api.fingerprint(first), api.fingerprint(equivalent), 'case/whitespace-equivalent specs have different fingerprints');
setBuilderFields(equivalent.title, equivalent.prompt);
api.setPending(equivalent.layout);
api.save();
assert.strictEqual(api.getAll().length, 1, 'case/whitespace-equivalent save created a duplicate');

setBuilderFields('Work status', 'Extract a materially different work-capacity instruction.');
api.setPending([{ type: 'text', label: 'Different output' }]);
api.save();
assert.strictEqual(api.getAll().length, 1, 'same-title materially different widget was silently added/merged');
assert(toasts.some(t => /different widget already uses this title/i.test(t.message)), 'same-title conflict did not force an explicit rename/edit decision');

/* Existing saved rows are never rewritten by read/render dedupe. Exact semantic
   duplicates render once and remain explicitly reviewable in My widgets. */
const duplicateRows = [
  Object.assign({}, first, { id: 'savedone' }),
  Object.assign({}, first, { id: 'savedtwo', title: ' WORK   STATUS ', prompt: 'Extract  documented WORK status.' })
];
const rawDuplicates = JSON.stringify(duplicateRows);
storage.set('customWidgets', rawDuplicates);
const analysis = api.analyze(api.getAll());
assert.strictEqual(api.getAll().length, 2, 'read-time dedupe deleted a saved widget row');
assert.strictEqual(api.getRenderable().length, 1, 'existing exact duplicate would render more than once');
assert.strictEqual(analysis.hiddenCount, 1, 'existing duplicate was not flagged for review');
assert.strictEqual(storage.get('customWidgets'), rawDuplicates, 'render analysis mutated persisted widget data');
api.renderManager();
assert(/id="cwWidgetReviewNotice"/.test(fields.cwList.innerHTML), 'My widgets has no explicit duplicate review indicator');
assert(/not shown twice/i.test(fields.cwList.innerHTML) && /Edit/.test(fields.cwList.innerHTML) && /Delete/.test(fields.cwList.innerHTML), 'saved duplicate lacks a safe edit/delete review path');

const differentSameTitle = api.analyze([
  Object.assign({}, first, { id: 'materialone' }),
  Object.assign({}, first, { id: 'materialtwo', prompt: 'Materially different prompt.' })
]);
assert.strictEqual(differentSameTitle.visible.length, 2, 'materially different same-title widgets were silently merged');
assert(differentSameTitle.byIndex.every(row => row.titleConflict), 'materially different same-title widgets were not flagged');

/* Run the real deck module against a small DOM. It must render one card from
   duplicate storage, remain the sole visible owner when Clinical tools opens,
   and rebuild doctor-visible text when an existing id is edited. */
let deckWidgets = duplicateRows.map(row => Object.assign({}, row));
let deckRaw = JSON.stringify(deckWidgets);
const dom = makeDom();
const visit = dom.add('visitView'); visit.offsetParent = {};
const note = dom.add('noteCard', visit);
const clinical = dom.add('visitToolsGroup', visit); clinical.style.display = 'none';
const hiddenHost = dom.add('customWidgetsHost', clinical);
const hiddenCard = dom.add('cw_savedone', hiddenHost); hiddenCard.className = 'extra-card';
const hiddenBody = dom.add('cwBody_savedone', hiddenCard); hiddenBody.innerHTML = '<p>Generated content</p>';
dom.add('cwDescribe');

const deckContext = {
  console, JSON, String, Number, Boolean, Object, Array, Math, Date, RegExp,
  document: dom.document,
  localStorage: { getItem() { return deckRaw; } },
  uns(key) { return key; },
  getCustomWidgets() { return deckWidgets.map(row => Object.assign({}, row)); },
  getRenderableCustomWidgets() { return api.analyze(deckWidgets).visible; },
  cwAnalyzeWidgetSpecs(list) { return api.analyze(list); },
  cwSemanticFingerprint(widget) { return api.fingerprint(widget); },
  renderCustomWidgets() {}, openWidgetBuilder() {}, refreshCustomWidget() {}, cwPushToNote() {},
  setInterval() { return 1; }, clearInterval() {}, setTimeout(fn) { fn(); return 1; }
};
deckContext.window = deckContext;
vm.createContext(deckContext);
vm.runInContext(deckSource, deckContext, { filename: 'feat_mls_widget_deck.js' });

const deck = dom.document.getElementById('mlsWdDeck');
assert(deck, 'widget deck did not mount');
assert.strictEqual(deck.querySelectorAll('.wd-card').length, 1, 'duplicate saved specs produced multiple deck cards');
assert(dom.document.getElementById('mlsWdReview'), 'deck did not expose the saved-duplicate review path');
const ownerStyle = dom.document.getElementById('mlsWdStyle');
assert(ownerStyle && /mls-widget-deck-owner #customWidgetsHost\{display:none!important\}/.test(ownerStyle.textContent), 'deck does not hide its base mirror owner');
assert(dom.document.body.classList.contains('mls-widget-deck-owner'), 'deck did not claim visible widget ownership');

function visibleWidgetOwners(advancedOpen) {
  clinical.style.display = advancedOpen ? 'block' : 'none';
  const deckCount = deck.querySelectorAll('.wd-card').length;
  const baseHiddenByOwner = dom.document.body.classList.contains('mls-widget-deck-owner');
  const baseCount = advancedOpen && !baseHiddenByOwner ? hiddenHost.children.filter(n => /(^|\s)extra-card(\s|$)/.test(n.className)).length : 0;
  return deckCount + baseCount;
}
assert.strictEqual(visibleWidgetOwners(false), 1, 'normal Visit mode does not have exactly one visible widget card');
assert.strictEqual(visibleWidgetOwners(true), 1, 'Advanced/Clinical-tools mode exposes a second widget owner');

deckWidgets = [Object.assign({}, first, { id: 'savedone', title: 'Edited work status', prompt: 'Edited clinical instruction.' })];
deckRaw = JSON.stringify(deckWidgets);
deckContext.__mlsWidgetDeck.sync();
assert(/Edited work status/.test(deck.innerHTML), 'same-id widget edit left stale deck content');
assert.strictEqual(deck.querySelectorAll('.wd-card').length, 1, 'same-id refresh changed visible card ownership');

for (const marker of ['cwSemanticFingerprint', 'getRenderableCustomWidgets', 'cwWidgetReviewNotice', '_cwCreateInFlight']) {
  assert(staging.includes(marker), `staging widget identity parity is missing ${marker}`);
}
assert(/getRenderableCustomWidgets\(\):getCustomWidgets\(\)\)\.filter\(w=>w\.auto\)/.test(staging), 'staging can still auto-run hidden duplicate widgets');

console.log('PASS custom widget identity runtime/DOM: library and save idempotence, normalized fingerprints, explicit title conflicts, non-destructive render dedupe, same-id refresh, and single visible owner');

function field(value = '', checked = false) {
  return {
    value, checked, disabled: false, innerHTML: '', focused: false, selected: false,
    focus() { this.focused = true; }, select() { this.selected = true; }
  };
}

function setBuilderFields(title, prompt) {
  fields.cwTitle.value = title;
  fields.cwPrompt.value = prompt;
  fields.cwEmoji.value = '🧩';
  fields.cwDescription.value = '';
  fields.cwFormat.value = 'text';
  fields.cwAuto.checked = true;
  fields.cwUseHistory.checked = false;
}

function makeDom() {
  const ids = new Map();
  class ClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach(name => this.values.add(name)); }
    remove(...names) { names.forEach(name => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
  }
  class Element {
    constructor(tag = 'div') {
      this.tagName = String(tag).toUpperCase();
      this.id = '';
      this.className = '';
      this.classList = new ClassList();
      this.style = {};
      this.attributes = {};
      this.dataset = {};
      this.children = [];
      this.parentNode = null;
      this.textContent = '';
      this._innerHTML = '';
      this._virtual = [];
      this.offsetParent = null;
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); register(child); return child; }
    insertBefore(child, before) {
      child.parentNode = this;
      const i = this.children.indexOf(before);
      if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
      register(child);
      return child;
    }
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); unregister(child); child.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    closest(selector) {
      let node = this;
      while (node) { if (selector[0] === '#' && node.id === selector.slice(1)) return node; node = node.parentNode; }
      return null;
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') { this.id = String(value); register(this); }
      if (name === 'class') { this.className = String(value); this.className.split(/\s+/).filter(Boolean).forEach(v => this.classList.add(v)); }
    }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
    addEventListener() {}
    scrollIntoView() {}
    querySelectorAll(selector) {
      const all = this._virtual.concat(this.children);
      if (selector[0] === '.') return all.filter(n => n.className.split(/\s+/).includes(selector.slice(1)));
      const dataPresence = selector.match(/^\[([^=\]]+)\]$/);
      if (dataPresence) return all.filter(n => n.getAttribute(dataPresence[1]) !== null);
      const dataValue = selector.match(/^\[([^=]+)="([^"]*)"\]$/);
      if (dataValue) return all.filter(n => n.getAttribute(dataValue[1]) === dataValue[2]);
      return [];
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(html) {
      this._virtual.forEach(unregister);
      this._virtual = [];
      this._innerHTML = String(html);
      const tag = /<([a-z0-9]+)([^>]*)>/gi;
      let match;
      while ((match = tag.exec(this._innerHTML))) {
        const node = new Element(match[1]);
        node.parentNode = this;
        const attr = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
        let pair;
        while ((pair = attr.exec(match[2]))) node.setAttribute(pair[1], pair[2]);
        this._virtual.push(node);
      }
    }
  }
  function register(node) { if (node && node.id) ids.set(node.id, node); }
  function unregister(node) { if (node && node.id && ids.get(node.id) === node) ids.delete(node.id); }
  const document = {
    readyState: 'complete',
    createElement(tag) { return new Element(tag); },
    getElementById(id) { return ids.get(id) || null; },
    addEventListener() {},
    head: new Element('head'), documentElement: new Element('html'), body: new Element('body')
  };
  function add(id, parent) { const node = new Element('div'); node.id = id; register(node); if (parent) parent.appendChild(node); return node; }
  return { document, add };
}
