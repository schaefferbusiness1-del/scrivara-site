'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const fullSource = fs.readFileSync(path.join(root, 'feat_autosave.js'), 'utf8');
const loaderMarker = fullSource.indexOf('/* --- ADDITIVE LOADER');
assert(loaderMarker > 0, 'autosave IIFE boundary was not found');
const autosaveSource = fullSource.slice(0, loaderMarker);

function makeHarness(saveImpl) {
  const byId = Object.create(null);
  const documentListeners = Object.create(null);
  const storageData = Object.create(null);
  const timeouts = new Map();
  let nextTimerId = 1;
  let activePatientId = 'A';

  function hasClass(el, cls) {
    return (` ${el.className || ''} `).includes(` ${cls} `);
  }

  function matches(el, selector) {
    if (!el || el.nodeType !== 1) return false;
    if (selector === '.mls-as-rec') return hasClass(el, 'mls-as-rec');
    if (selector === '.mls-as-ind') return hasClass(el, 'mls-as-ind');
    if (selector === '.mls-as-recover') return hasClass(el, 'mls-as-recover');
    const recover = selector.match(/^\.mls-as-recover\[data-mls-as="([^"]+)"\]$/);
    if (recover) return hasClass(el, 'mls-as-recover') && el.getAttribute('data-mls-as') === recover[1];
    if (selector === 'button,a,[role=button]') {
      return el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button';
    }
    return false;
  }

  function descendants(rootEl) {
    const found = [];
    (function visit(el) {
      for (const child of el.children || []) {
        found.push(child);
        visit(child);
      }
    })(rootEl);
    return found;
  }

  class FakeElement {
    constructor(tag = 'div') {
      this.tagName = String(tag).toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.parentNode = null;
      this.ownerDocument = document;
      this.listeners = Object.create(null);
      this.attributes = Object.create(null);
      this.style = {};
      this.className = '';
      this.textContent = '';
      this.value = '';
      this.title = '';
      this.type = '';
      this._id = '';
    }

    set id(value) {
      const next = String(value || '');
      if (this._id && byId[this._id] === this) delete byId[this._id];
      this._id = next;
      if (next) byId[next] = this;
    }

    get id() { return this._id; }

    get nextSibling() {
      if (!this.parentNode) return null;
      const index = this.parentNode.children.indexOf(this);
      return index >= 0 ? (this.parentNode.children[index + 1] || null) : null;
    }

    appendChild(child) {
      return this.insertBefore(child, null);
    }

    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const index = before ? this.children.indexOf(before) : -1;
      if (index >= 0) this.children.splice(index, 0, child);
      else this.children.push(child);
      child.parentNode = this;
      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    }

    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }

    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] || ''; }
    removeAttribute(name) { delete this.attributes[name]; }

    addEventListener(type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    }

    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] || []).filter(listener => listener !== fn);
    }

    dispatchEvent(event) {
      if (!event.target) event.target = this;
      for (const fn of [...(this.listeners[event.type] || [])]) fn.call(this, event);
      return true;
    }

    click() { return this.dispatchEvent(new FakeEvent('click')); }

    contains(node) {
      for (let cur = node; cur; cur = cur.parentNode) if (cur === this) return true;
      return false;
    }

    closest(selector) {
      for (let cur = this; cur; cur = cur.parentNode) if (matches(cur, selector)) return cur;
      return null;
    }

    querySelector(selector) {
      return descendants(this).find(el => matches(el, selector)) || null;
    }

    querySelectorAll(selector) {
      const parts = selector.split(',').map(part => part.trim());
      return descendants(this).filter(el => parts.some(part => matches(el, part)));
    }
  }

  class FakeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = !!options.bubbles;
      this.target = options.target || null;
    }
  }

  const document = {
    readyState: 'complete',
    createElement: tag => new FakeElement(tag),
    getElementById: id => byId[id] || null,
    addEventListener(type, fn) {
      (documentListeners[type] || (documentListeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      documentListeners[type] = (documentListeners[type] || []).filter(listener => listener !== fn);
    },
    dispatchEvent(event) {
      for (const fn of [...(documentListeners[event.type] || [])]) fn.call(document, event);
      return true;
    },
    querySelectorAll(selector) {
      const roots = [this.documentElement];
      return roots.flatMap(el => el.querySelectorAll(selector));
    }
  };

  document.documentElement = new FakeElement('html');
  document.head = new FakeElement('head');
  document.body = new FakeElement('body');
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);

  const noteWrap = new FakeElement('div');
  const noteBox = new FakeElement('textarea');
  noteBox.id = 'noteBox';
  noteWrap.appendChild(noteBox);
  document.body.appendChild(noteWrap);

  const viewModal = new FakeElement('div');
  viewModal.id = 'viewModal';
  const viewBody = new FakeElement('textarea');
  viewBody.id = 'viewBody';
  viewModal.appendChild(viewBody);
  document.body.appendChild(viewModal);

  const localStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : null; },
    setItem(key, value) { storageData[key] = String(value); },
    removeItem(key) { delete storageData[key]; },
    clear() { for (const key of Object.keys(storageData)) delete storageData[key]; }
  };

  function fakeSetTimeout(fn) {
    const id = nextTimerId++;
    timeouts.set(id, fn);
    return id;
  }

  function fakeClearTimeout(id) { timeouts.delete(id); }

  function flushTimeouts() {
    let passes = 0;
    while (timeouts.size) {
      assert(++passes < 50, 'timer queue did not settle');
      const pending = [...timeouts.entries()];
      timeouts.clear();
      for (const [, fn] of pending) fn();
    }
  }

  function MutationObserver() {
    this.observe = () => {};
    this.disconnect = () => {};
  }

  const window = {
    document,
    localStorage,
    Event: FakeEvent,
    MutationObserver,
    __MLS_AUTOSAVE_DEBOUNCE: 10,
    uns: name => `test::${name}`,
    getActivePtId: () => activePatientId,
    saveCurrentNote: typeof saveImpl === 'function' ? saveImpl : () => true
  };
  window.window = window;

  const context = {
    window,
    document,
    localStorage,
    Event: FakeEvent,
    MutationObserver,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: () => nextTimerId++,
    clearInterval: () => {},
    console,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Promise
  };
  vm.createContext(context);
  vm.runInContext(autosaveSource, context, { filename: 'feat_autosave.js' });

  return {
    window,
    document,
    noteBox,
    viewBody,
    viewModal,
    api: window.__mlsAutosave,
    setActive(id) { activePatientId = String(id); },
    flushTimeouts,
    FakeElement,
    FakeEvent
  };
}

function draft(text, ptId) {
  return { text, ts: Date.now() + 1000, kind: 'note', ptId };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function testDelayedDebounceStaysWithPatientA() {
  const h = makeHarness();
  h.noteBox.value = 'Patient A delayed draft';
  h.api._scheduleSave(h.noteBox);

  h.setActive('B');
  h.noteBox.value = 'Patient B reused textarea';
  h.flushTimeouts();

  const store = h.api._readStore();
  assert.deepStrictEqual(Object.keys(store.drafts), ['note::A']);
  assert.strictEqual(store.drafts['note::A'].text, 'Patient A delayed draft');
  assert.strictEqual(store.drafts['note::B'], undefined);
}

async function testSuccessfulAsyncSaveClearsOnlyPatientA() {
  const gate = deferred();
  const h = makeHarness(() => gate.promise);
  h.api._writeStore({
    drafts: {
      'note::A': draft('A note', 'A'),
      'proc::A': { text: 'A procedure', ts: Date.now() + 1000, kind: 'proc', ptId: 'A' },
      'note::B': draft('B note', 'B'),
      'proc::B': { text: 'B procedure', ts: Date.now() + 1000, kind: 'proc', ptId: 'B' }
    },
    savedAt: {}
  });

  const saveResult = h.window.saveCurrentNote();
  h.setActive('B');
  gate.resolve(true);
  assert.strictEqual(await saveResult, true);

  const store = h.api._readStore();
  assert.strictEqual(store.drafts['note::A'], undefined);
  assert.strictEqual(store.drafts['proc::A'], undefined);
  assert.strictEqual(store.drafts['note::B'].text, 'B note');
  assert.strictEqual(store.drafts['proc::B'].text, 'B procedure');
  assert(store.savedAt['note::A'] > 0);
  assert.strictEqual(store.savedAt['note::B'], undefined);
}

async function testFailedAsyncSaveClearsNeitherPatient() {
  const gate = deferred();
  const h = makeHarness(() => gate.promise);
  h.api._writeStore({
    drafts: {
      'note::A': draft('A unsaved note', 'A'),
      'note::B': draft('B unsaved note', 'B')
    },
    savedAt: {}
  });

  const saveResult = h.window.saveCurrentNote();
  h.setActive('B');
  gate.resolve(false);
  assert.strictEqual(await saveResult, false);

  const store = h.api._readStore();
  assert.strictEqual(store.drafts['note::A'].text, 'A unsaved note');
  assert.strictEqual(store.drafts['note::B'].text, 'B unsaved note');
  assert.strictEqual(store.savedAt['note::A'], undefined);
  assert.strictEqual(store.savedAt['note::B'], undefined);
}

function testStaleRecoveryCannotOverwritePatientB() {
  const h = makeHarness();
  h.noteBox.value = 'Current Patient A text';
  h.api._writeStore({ drafts: { 'note::A': draft('Recovered Patient A text', 'A') }, savedAt: {} });
  h.api._maybePrompt(h.noteBox);

  const prompt = h.noteBox.parentNode.querySelector('.mls-as-recover[data-mls-as="noteBox"]');
  assert(prompt, 'Patient A recovery prompt was not rendered');
  const recoverButton = prompt.querySelector('.mls-as-rec');
  assert(recoverButton, 'Patient A recovery button was not rendered');

  h.setActive('B');
  h.noteBox.value = 'Patient B current text';
  recoverButton.click();

  assert.strictEqual(h.noteBox.value, 'Patient B current text');
  assert.strictEqual(h.api._readStore().drafts['note::A'].text, 'Recovered Patient A text');
  assert.strictEqual(h.api.stats().recovered, 0);
  assert.strictEqual(h.noteBox.parentNode.querySelector('.mls-as-recover[data-mls-as="noteBox"]'), null);
}

function testRawHistoryDelayedClearStaysWithCapturedNote() {
  const h = makeHarness();
  h.api._writeStore({
    drafts: {
      'view::v_noteA': { text: 'Raw history A', ts: Date.now() + 1000, kind: 'view', ptId: 'A' },
      'view::v_noteB': { text: 'Raw history B', ts: Date.now() + 1000, kind: 'view', ptId: 'A' }
    },
    savedAt: {}
  });
  h.api._setViewNoteId('noteA');

  const saveButton = new h.FakeElement('button');
  saveButton.textContent = 'Save note';
  h.viewModal.appendChild(saveButton);
  h.document.dispatchEvent(new h.FakeEvent('click', { target: saveButton }));

  h.api._setViewNoteId('noteB');
  h.flushTimeouts();

  const store = h.api._readStore();
  assert.strictEqual(store.drafts['view::v_noteA'], undefined);
  assert.strictEqual(store.drafts['view::v_noteB'].text, 'Raw history B');
  assert(store.savedAt['view::v_noteA'] > 0);
  assert.strictEqual(store.savedAt['view::v_noteB'], undefined);
}

(async () => {
  testDelayedDebounceStaysWithPatientA();
  await testSuccessfulAsyncSaveClearsOnlyPatientA();
  await testFailedAsyncSaveClearsNeitherPatient();
  testStaleRecoveryCannotOverwritePatientB();
  testRawHistoryDelayedClearStaysWithCapturedNote();
  console.log('PASS autosave patient scoping runtime: debounce, async save, failure, recovery, and raw-history clear');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
