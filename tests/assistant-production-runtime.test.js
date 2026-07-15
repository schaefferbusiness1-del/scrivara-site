'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function makeClassList(node) {
  const set = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
  return {
    add(name) { set.add(name); node.className = Array.from(set).join(' '); },
    remove(name) { set.delete(name); node.className = Array.from(set).join(' '); },
    contains(name) { return set.has(name); },
    toggle(name, on) { const next = arguments.length > 1 ? !!on : !set.has(name); if (next) this.add(name); else this.remove(name); return next; }
  };
}

function makeHarness() {
  const ids = Object.create(null);
  function node(tag) {
    const handlers = Object.create(null);
    const n = {
      tagName: String(tag || '').toUpperCase(), nodeType: 1, id: '', className: '',
      textContent: '', value: '', type: '', hidden: false, disabled: false,
      style: { display: '', setProperty(name, value) { this[name] = String(value); }, removeProperty(name) { delete this[name]; } },
      attributes: {}, children: [], parentNode: null, options: [], scrollTop: 0, scrollHeight: 0,
      appendChild(child) { child.parentNode = this; this.children.push(child); if (child.id) ids[child.id] = child; return child; },
      insertBefore(child, before) { child.parentNode = this; const at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, child); if (child.id) ids[child.id] = child; return child; },
      removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); if (child.id) delete ids[child.id]; child.parentNode = null; return child; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
      removeAttribute(name) { delete this.attributes[name]; },
      hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); },
      addEventListener(type, fn, capture) { (handlers[type] || (handlers[type] = [])).push({ fn, capture: !!capture }); },
      removeEventListener(type, fn) { if (handlers[type]) handlers[type] = handlers[type].filter(h => h.fn !== fn); },
      click() { (handlers.click || []).slice().sort((a, b) => Number(b.capture) - Number(a.capture)).forEach(h => h.fn.call(this, { target: this, preventDefault() {}, stopImmediatePropagation() {} })); },
      dispatchEvent() {}, focus() {},
      querySelector(selector) { return (this._selectors && this._selectors[selector]) || null; },
      querySelectorAll(selector) { const hit = this._selectorLists && this._selectorLists[selector]; return hit ? hit.slice() : []; }
    };
    n.classList = makeClassList(n);
    Object.defineProperty(n, 'nextSibling', { get() { if (!this.parentNode) return null; const at = this.parentNode.children.indexOf(this); return this.parentNode.children[at + 1] || null; } });
    Object.defineProperty(n, 'innerHTML', {
      get() { return this._html || ''; },
      set(value) {
        this._html = String(value || '');
        if (this.id === 'mlsAsstPanel' && !this._selectors) hydratePanel(this);
      }
    });
    return n;
  }

  function hydratePanel(panel) {
    const make = (tag, cls) => { const x = node(tag); x.className = cls || ''; x.classList = makeClassList(x); x.parentNode = panel; panel.children.push(x); return x; };
    const close = make('button', 'as-x');
    const status = make('div', 'as-status');
    const sdot = make('span', 'as-sdot');
    const slabel = make('div', 'as-slabel');
    const sdetail = make('div', 'as-sdetail');
    const slot = make('span', 'as-connect-slot');
    const tabSchedule = make('button', 'as-tab on'); tabSchedule.setAttribute('data-tab', 'schedule');
    const tabChat = make('button', 'as-tab'); tabChat.setAttribute('data-tab', 'chat');
    const bodyNode = make('div', 'as-body');
    const schedule = make('div', 'as-pane-schedule');
    const today = make('button', 'as-daybtn'); today.setAttribute('data-day', 'today');
    const tomorrow = make('button', 'as-daybtn'); tomorrow.setAttribute('data-day', 'tomorrow');
    const date = make('input', 'as-date');
    const provider = make('select', 'as-prov'); provider.options = [];
    const pull = make('button', 'as-pullbtn');
    const pullStatus = make('div', 'as-pullstatus');
    const statPatients = make('b', '');
    const statOps = make('b', '');
    const listHead = make('p', 'as-listhd');
    const list = make('div', 'as-list');
    const chatPane = make('div', 'as-pane-chat');
    const thread = make('div', 'as-thread');
    const input = make('div', 'as-input');
    const textarea = make('textarea', '');
    const send = make('button', 'as-send');
    status._selectors = { '.as-sdot': sdot, '.as-slabel': slabel, '.as-sdetail': sdetail, '.as-connect-slot': slot };
    schedule._selectors = { '.as-date': date, '.as-prov': provider, '.as-pullbtn': pull, '.as-pullstatus': pullStatus, '.as-stat-pt b': statPatients, '.as-stat-op b': statOps, '.as-listhd': listHead, '.as-list': list };
    schedule._selectorLists = { '.as-daybtn': [today, tomorrow] };
    list._selectorLists = { '.as-pcard': [] };
    panel._selectors = {
      '.as-x': close, '.as-status': status, '.as-sdot': sdot, '.as-slabel': slabel,
      '.as-sdetail': sdetail, '.as-connect-slot': slot, '.as-pane-schedule': schedule,
      '.as-pane-chat': chatPane, '.as-thread': thread, '.as-body': bodyNode,
      '.as-input': input, '.as-input textarea': textarea, 'textarea': textarea,
      '.as-send': send, '.as-pullstatus': pullStatus, '.as-prov': provider
    };
    panel._selectorLists = { '.as-tab': [tabSchedule, tabChat] };
  }

  const html = node('html'), head = node('head'), body = node('body');
  html.appendChild(head); html.appendChild(body);
  const docHandlers = Object.create(null);
  const document = {
    readyState: 'complete', head, body, documentElement: html, activeElement: null,
    createElement: node, createTextNode(text) { const x = node('#text'); x.textContent = String(text); return x; },
    getElementById(id) { return ids[id] || null; },
    querySelector(selector) {
      if (selector === '#mlsAsstFab .dot') return null;
      if (selector.includes('mls-connect.staging.js')) return null;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (docHandlers[type] || (docHandlers[type] = [])).push(fn); },
    removeEventListener(type, fn) { if (docHandlers[type]) docHandlers[type] = docHandlers[type].filter(x => x !== fn); }
  };
  const toasts = [];
  class FakeMutationObserver { observe() {} disconnect() {} }
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    location: { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' },
    document, MutationObserver: FakeMutationObserver,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, postMessage() {}, open() {},
    getComputedStyle(el) { return { display: el && el.id === 'mlsAsstPanel' ? (el.classList.contains('open') ? 'flex' : 'none') : 'block', visibility: 'visible' }; },
    getPatients() { return [{ id: 'p1', name: 'Test Patient' }]; },
    getActivePtId() { return 'p1'; },
    activePatient() { return { id: 'p1', name: 'Test Patient' }; },
    currentVisitAthenaBinding: { id: 'visit-p1' }, currentVisitAthenaEpoch: 1,
    _athenaAsyncBindingStillSafe() { return true; },
    toast(message) { toasts.push(String(message)); },
    $: id => ids[id] || null,
    flowToast(message) { toasts.push(String(message)); }
  };
  context.window = context;
  return { context, document, ids, toasts };
}

const h = makeHarness();
const context = vm.createContext(h.context);
vm.runInContext(read('feat_mls_assistant_exact.js'), context, { filename: 'feat_mls_assistant_exact.js' });
assert(context.__mlsAsst && context.__mlsAsst.installed, 'assistant core did not install on production ScribeFlow');
assert.strictEqual(context.__mlsAsst.version, 'asst-2.1.5');
assert(h.document.getElementById('mlsAsstFab'), 'production assistant FAB was not created');
assert(h.document.getElementById('mlsAsstPanel'), 'production assistant panel was not created');

// The production fix bridge must install over the real panel, not merely leave
// an extension-version-shaped marker behind.
h.document.readyState = 'loading';
vm.runInContext(read('feat_mls_asst_fix.js'), context, { filename: 'feat_mls_asst_fix.js' });
const realFix = context.__mlsAsstFix;
assert(realFix && realFix.installed && typeof realFix._handleSend === 'function' && typeof realFix.registerIntent === 'function', 'production assistant fix bridge is incomplete');

// Execute the actual top-proxy helper against the real FAB made above.
const connect = read('mls-connect.js');
const proxyStart = connect.indexOf('function clickTopVoiceControl(id, label)');
const proxyEnd = connect.indexOf('function syncTopLane(rec)', proxyStart);
assert(proxyStart >= 0 && proxyEnd > proxyStart, 'top assistant proxy helper not found');
vm.runInContext(connect.slice(proxyStart, proxyEnd) + '\nthis.__clickTopVoiceControl = clickTopVoiceControl;', context);
context.__clickTopVoiceControl('mlsAsstFab', 'MLS Assistant');
assert(h.document.getElementById('mlsAsstPanel').classList.contains('open'), 'top proxy did not open the production assistant panel');
assert(!h.toasts.some(t => /still loading/i.test(t)), 'top proxy still reported an indefinite loading failure');

// A command heard before the complete bridge is ready is queued, then handed
// to the restored production bridge exactly once and opens the same panel.
context.__mlsAsst.close();
context.__mlsAsstFix = { installed: true, version: 'incomplete-marker' };
vm.runInContext(read('feat_mls_copilot_voice_v2.js'), context, { filename: 'feat_mls_copilot_voice_v2.js' });
const voice = context.__mlsCopilotVoiceV2;
voice._testHandle('summarize this visit');
assert.strictEqual(voice._test.pendingAssistant().length, 1, 'cold production command was dropped instead of queued');
const delivered = [];
realFix._handleSend = text => delivered.push(text);
context.__mlsAsstFix = realFix;
assert.strictEqual(voice._test.flushPendingAssistant(), true, 'restored production bridge did not flush the cold queue');
voice._test.flushPendingAssistant();
assert.deepStrictEqual(delivered, ['summarize this visit'], 'cold command was lost or delivered more than once');
assert(h.document.getElementById('mlsAsstPanel').classList.contains('open'), 'cold queue handoff did not open the assistant panel');

// Preserve the intended off-page gate on the same production domain.
const off = { console, location: { hostname: 'mlsscribe.com', pathname: '/pricing.html' }, document: { querySelector() { return null; } } };
off.window = off;
vm.runInNewContext(read('feat_mls_assistant_exact.js'), off, { filename: 'feat_mls_assistant_exact.js' });
assert(off.__mlsAsst && off.__mlsAsst.installed === false && off.__mlsAsst.skipped === 'gate', 'assistant leaked onto an unrelated production page');

console.log('PASS production assistant runtime: core/FAB/panel, top proxy, cold exact-once queue, and off-page gate');
