const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const popupSource = fs.readFileSync(path.join(ROOT, 'mls-popup.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

/* athenaOne must return before content.js constructs the obsolete
   Dictate/Generate/Insert panel; mls-popup.js is the sole visible owner. */
const legacyPanelAt = contentSource.indexOf("panel.id = 'mls-assist-panel'");
assert(legacyPanelAt > 0, 'legacy panel fixture moved; update this contract deliberately');
const exactAthenaGuard = contentSource.lastIndexOf("String(location.hostname || '').toLowerCase() === 'athenanet.athenahealth.com'", legacyPanelAt);
assert(exactAthenaGuard >= 0, 'content.js needs an exact athenaOne-host guard before the legacy panel');
const guardedGap = contentSource.slice(exactAthenaGuard, legacyPanelAt);
assert(/\breturn\s*;/.test(guardedGap), 'the exact athenaOne-host guard must return before legacy panel construction');

const allUrlEntry = (manifest.content_scripts || []).find(entry =>
  Array.isArray(entry.js) && entry.js.includes('content.js') && entry.js.includes('mls-popup.js'));
assert(allUrlEntry, 'manifest must load the bridge and canonical Athena overlay together');
assert(allUrlEntry.js.indexOf('content.js') < allUrlEntry.js.indexOf('mls-popup.js'),
  'content.js must install its bridge/suppression before the canonical overlay boots');

class FakeClassList {
  constructor(node) { this.node = node; }
  _items() { return String(this.node.className || '').split(/\s+/).filter(Boolean); }
  contains(name) { return this._items().includes(name); }
  add(name) {
    const items = this._items();
    if (!items.includes(name)) items.push(name);
    this.node.className = items.join(' ');
  }
  remove(name) { this.node.className = this._items().filter(item => item !== name).join(' '); }
  toggle(name) {
    if (this.contains(name)) { this.remove(name); return false; }
    this.add(name); return true;
  }
}

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.id = '';
    this.disabled = false;
    this.value = '';
    this.placeholder = '';
    this._text = '';
    this.classList = new FakeClassList(this);
  }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
  set textContent(value) { this._text = String(value == null ? '' : value); this.children = []; }
  get innerHTML() { return ''; }
  set innerHTML(value) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    this._text = value ? String(value) : '';
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, before) {
    child.parentNode = this;
    const at = this.children.indexOf(before);
    if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    const at = this.parentNode.children.indexOf(this);
    if (at >= 0) this.parentNode.children.splice(at, 1);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { const set = this.listeners.get(type); if (set) set.delete(fn); }
  dispatch(type, extra) {
    const event = Object.assign({ type, target: this, currentTarget: this, preventDefault() {} }, extra || {});
    for (const fn of Array.from(this.listeners.get(type) || [])) fn(event);
  }
  click() { this.dispatch('click'); }
  querySelector(selector) { return findNode(this, node => matches(node, selector)); }
  querySelectorAll(selector) { return findNodes(this, node => matches(node, selector)); }
  getBoundingClientRect() {
    const left = parseFloat(this.style.left) || 0;
    const top = parseFloat(this.style.top) || 0;
    const width = this.id === 'mls-popup-root' ? 360 : 120;
    const height = this.id === 'mls-popup-root' ? 480 : 40;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
}

function matches(node, selector) {
  if (!node || !selector) return false;
  if (selector[0] === '#') return node.id === selector.slice(1);
  if (selector[0] === '.') return node.classList.contains(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

function findNode(root, predicate) {
  for (const child of root.children || []) {
    if (predicate(child)) return child;
    const nested = findNode(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function findNodes(root, predicate, out) {
  out = out || [];
  for (const child of root.children || []) {
    if (predicate(child)) out.push(child);
    findNodes(child, predicate, out);
  }
  return out;
}

function makeEnvironment(options) {
  options = options || {};
  const documentListeners = new Map();
  const windowListeners = new Map();
  const runtimeListeners = new Set();
  const intervals = new Map();
  const timeouts = new Map();
  const observers = [];
  const sentMessages = [];
  const storedWrites = [];
  const storageState = {
    mlsPopupPos: options.savedPosition || { left: 50000, top: 40000 },
    mlsPopupCollapsed: options.collapsed !== false
  };
  let timerId = 0;

  function addListener(map, type, fn) {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  }
  function removeListener(map, type, fn) { const set = map.get(type); if (set) set.delete(fn); }

  const document = {
    title: options.title || 'athenaOne',
    hidden: false,
    createElement(tag) { return new FakeElement(tag, document); },
    getElementById(id) {
      if (document.documentElement.id === id) return document.documentElement;
      return findNode(document.documentElement, node => node.id === id);
    },
    querySelector(selector) { return document.documentElement.querySelector(selector); },
    querySelectorAll(selector) { return document.documentElement.querySelectorAll(selector); },
    addEventListener(type, fn) { addListener(documentListeners, type, fn); },
    removeEventListener(type, fn) { removeListener(documentListeners, type, fn); }
  };
  document.documentElement = new FakeElement('html', document);
  document.body = new FakeElement('body', document);
  document.documentElement.appendChild(document.body);

  const hostname = options.hostname || 'athenanet.athenahealth.com';
  const location = {
    hostname,
    host: hostname,
    href: `https://${hostname}/1/100`,
    origin: `https://${hostname}`
  };

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }

  const window = {
    document,
    location,
    innerWidth: options.innerWidth || 800,
    innerHeight: options.innerHeight || 600,
    addEventListener(type, fn) { addListener(windowListeners, type, fn); },
    removeEventListener(type, fn) { removeListener(windowListeners, type, fn); }
  };
  /* Opt-in only, and set before the module runs — mountDOM reads it at mount
     time, so a flag applied afterwards would prove nothing. */
  if (options.showOnAthena) window.__mlsPopupShowOnAthena = true;
  window.window = window;

  const status = { athenaOpen: true, mlsApp: true, patientOpen: true, identity: { name: 'Test Patient' } };
  const chrome = {
    runtime: {
      lastError: null,
      getManifest() { return { version: '9.9.9' }; },
      sendMessage(message, callback) {
        sentMessages.push(message);
        if (callback) callback(message && message.type === 'MLS_OVL_STATUS' ? status : { ok: true });
      },
      onMessage: {
        addListener(fn) { runtimeListeners.add(fn); },
        removeListener(fn) { runtimeListeners.delete(fn); }
      }
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback(Object.assign({}, storageState));
        },
        set(value) { storedWrites.push(value); Object.assign(storageState, value || {}); }
      }
    }
  };

  const context = vm.createContext({
    window, document, location, chrome, MutationObserver: FakeMutationObserver,
    module: { exports: {} }, exports: {}, console, Promise, JSON, Math,
    setInterval(fn, ms) { const id = ++timerId; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, ms) {
      const id = ++timerId;
      if (Number(ms) === 0) { fn(); return id; }
      timeouts.set(id, { fn, ms }); return id;
    },
    clearTimeout(id) { timeouts.delete(id); },
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; }
  });

  vm.runInContext(popupSource, context, { filename: 'mls-popup.js' });

  return {
    context, window, document, runtimeListeners, intervals, timeouts, observers,
    sentMessages, storedWrites, documentListeners, windowListeners,
    activeTimers() { return intervals.size + timeouts.size; },
    activeObservers() { return observers.filter(observer => observer.active); },
    activeDocumentDragHandlers() {
      return ['mousemove', 'mouseup', 'pointermove', 'pointerup', 'pointercancel']
        .reduce((sum, type) => sum + ((documentListeners.get(type) || new Set()).size), 0);
    },
    sendRuntimeMessage(message) {
      const responses = [];
      for (const listener of Array.from(runtimeListeners)) {
        listener(message, {}, response => responses.push(response));
      }
      return responses;
    },
    triggerMutation() {
      for (const observer of observers.filter(item => item.active)) observer.callback([], observer);
    }
  };
}

function buttonWithText(root, expression) {
  return findNode(root, node => node.tagName === 'BUTTON' && expression.test(node.textContent));
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

(async function run() {
  /* A page merely mentioning Athena must never receive the overlay or any of
     its long-lived lifecycle resources. */
  const unrelated = makeEnvironment({ hostname: 'malicious.example', title: 'Fake Athena login' });
  assert.strictEqual(unrelated.document.getElementById('mls-popup-root'), null,
    'the overlay mounted outside the exact athenaOne host');
  assert.strictEqual(unrelated.runtimeListeners.size, 0, 'off-host overlay registered a runtime listener');
  assert.strictEqual(unrelated.activeTimers(), 0, 'off-host overlay registered a status timer');
  assert.strictEqual(unrelated.activeObservers().length, 0, 'off-host overlay registered a remount observer');

  /* The overlay is OFF on athenaOne by default.
   *
   * Owner, 2026-07-24, twice: "just remove this mls thing - the one that pops up
   * when on athena". It is the only unrequested surface MLS puts on top of a
   * live chart, and every pull, read and write is already driven from the MLS
   * app itself.
   *
   * This suite used to assert the overlay mounts on the exact athenaOne host,
   * full stop, which made the owner's request unshippable: the change was
   * written, and the branch carrying it could never go green, so it sat
   * unmerged. What the suite is actually FOR is that there is exactly one
   * canonical overlay owner and that its lifecycle is clean — one root, no
   * legacy second panel, no stray listeners, timers or observers off-host, and
   * a position that cannot escape the viewport. All of that is still asserted,
   * against the same overlay, one flag away.
   *
   * Removal, not deletion: window.__mlsPopup keeps its whole API and the module
   * stays loaded, so re-enabling is a flag rather than a revert. That is what
   * the two assertions below pin — default off, and identical behaviour when
   * switched on. If the owner reverses this, flip the default and the rest of
   * the suite is unchanged. */
  const offByDefault = makeEnvironment();
  await flushPromises();
  assert.strictEqual(offByDefault.document.getElementById('mls-popup-root'), null,
    'the athenaOne overlay must not mount by default — the owner asked for it gone twice');
  assert(offByDefault.window.__mlsPopup && offByDefault.window.__mlsPopup.installed,
    'the overlay must be REMOVED, not deleted: __mlsPopup must still install so callers and the toolbar keep working');

  const env = makeEnvironment({ showOnAthena: true });
  await flushPromises();
  const api = env.window.__mlsPopup;
  let root = env.document.getElementById('mls-popup-root');
  assert(api && api.installed && api.core, 'canonical Athena overlay did not mount');
  assert(root, 'canonical #mls-popup-root is missing');
  assert(!env.document.getElementById('mls-assist-panel'), 'legacy and canonical Athena surfaces mounted together');

  /* Persisted coordinates are untrusted/stale across monitor changes. */
  const rect = root.getBoundingClientRect();
  const left = parseFloat(root.style.left);
  const top = parseFloat(root.style.top);
  assert(Number.isFinite(left) && left >= 0 && left <= env.window.innerWidth - Math.min(rect.width, env.window.innerWidth),
    `persisted left position escaped the viewport: ${root.style.left}`);
  assert(Number.isFinite(top) && top >= 0 && top <= env.window.innerHeight - Math.min(rect.height, env.window.innerHeight),
    `persisted top position escaped the viewport: ${root.style.top}`);

  /* The extension toolbar owns the same widget; it must expand the pill, not
     resurrect content.js's old second panel. */
  assert(root.querySelector('.mlsp-pill'), 'overlay should begin as its quiet pill');
  const openResponses = env.sendRuntimeMessage({ type: 'mlsOpenPanel' });
  await flushPromises();
  root = env.document.getElementById('mls-popup-root');
  assert(root.querySelector('.mlsp-card'), 'mlsOpenPanel did not expand the canonical overlay');
  assert(openResponses.some(response => response && response.ok === true), 'mlsOpenPanel did not acknowledge the toolbar request');
  assert(!env.document.getElementById('mls-assist-panel'), 'toolbar request created the legacy Athena panel');

  /* Capture the owner counts after the first expanded render. Repainting the
     state machine must not add another document-level drag pair. */
  const initialRuntimeListeners = env.runtimeListeners.size;
  const initialTimers = env.activeTimers();
  const initialObservers = env.activeObservers().length;
  const initialDragHandlers = env.activeDocumentDragHandlers();
  const initialResizeHandlers = (env.windowListeners.get('resize') || new Set()).size;
  assert.strictEqual(initialRuntimeListeners, 1, 'progress and toolbar expansion must share one runtime listener owner');
  assert.strictEqual(initialTimers, 1, 'overlay must own exactly one live status refresh timer');
  assert.strictEqual(initialObservers, 1, 'overlay must own exactly one SPA remount observer');

  api.core.setState('ready');
  api.core.setState('idle');
  api.core.setState('ready');
  assert.strictEqual(env.runtimeListeners.size, initialRuntimeListeners, 'rerender leaked runtime listeners');
  assert.strictEqual(env.activeTimers(), initialTimers, 'rerender leaked status timers');
  assert.strictEqual(env.activeObservers().length, initialObservers, 'rerender leaked MutationObservers');
  assert.strictEqual(env.activeDocumentDragHandlers(), initialDragHandlers, 'rerender leaked document drag handlers');
  assert.strictEqual((env.windowListeners.get('resize') || new Set()).size, initialResizeHandlers, 'rerender leaked resize handlers');

  /* Record is not wired end-to-end. Keep the honest manual text lane visible
     without promising a microphone path that cannot complete. */
  root = env.document.getElementById('mls-popup-root');
  assert(root.querySelector('textarea'), 'manual typed-note path disappeared from the ready state');
  assert(!buttonWithText(root, /\bRecord(?:ing)?\b/i), 'ready UI still offers the unwired Record control');

  /* Sign & Save is blocked in the worker. The overlay may focus Athena so the
     doctor can finish manually, but must not claim it can sign. */
  api.core.setState('written');
  root = env.document.getElementById('mls-popup-root');
  assert(!buttonWithText(root, /Sign\s*&\s*Save/i), 'written UI still offers the blocked Sign & Save control');
  const focusAthena = buttonWithText(root, /(?:Athena|athenaOne)/i);
  assert(focusAthena, 'manual focus-Athena path disappeared');
  focusAthena.click();
  assert(env.sentMessages.some(message => message && message.type === 'MLS_OVL_FOCUS_ATHENA'),
    'manual focus-Athena control did not send the read-only focus intent');

  /* Simulate an Athena SPA wiping the root. Remount must replace the instance,
     not stack another set of listeners/timers/observers/drag handlers. */
  root.remove();
  env.triggerMutation();
  await flushPromises();
  assert(env.document.getElementById('mls-popup-root'), 'SPA wipe was not remounted');
  assert.strictEqual(env.runtimeListeners.size, initialRuntimeListeners, 'remount leaked runtime listeners');
  assert.strictEqual(env.activeTimers(), initialTimers, 'remount leaked status timers');
  assert.strictEqual(env.activeObservers().length, initialObservers, 'remount leaked MutationObservers');
  assert.strictEqual(env.activeDocumentDragHandlers(), initialDragHandlers, 'remount leaked document drag handlers');
  assert.strictEqual((env.windowListeners.get('resize') || new Set()).size, initialResizeHandlers, 'remount leaked resize handlers');

  assert.strictEqual(typeof env.window.__mlsPopup.revert, 'function', 'overlay has no reversible lifecycle');
  env.window.__mlsPopup.revert();
  assert.strictEqual(env.document.getElementById('mls-popup-root'), null, 'revert left the overlay root mounted');
  assert.strictEqual(env.runtimeListeners.size, 0, 'revert left runtime listeners active');
  assert.strictEqual(env.activeTimers(), 0, 'revert left status timers active');
  assert.strictEqual(env.activeObservers().length, 0, 'revert left MutationObservers active');
  assert.strictEqual(env.activeDocumentDragHandlers(), 0, 'revert left document drag handlers active');
  assert.strictEqual((env.windowListeners.get('resize') || new Set()).size, 0, 'revert left resize handlers active');

  console.log('athena overlay lifecycle contract tests passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
