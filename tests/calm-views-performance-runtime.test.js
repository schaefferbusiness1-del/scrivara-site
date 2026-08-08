'use strict';

/*
 * Calm Views used to queue its layout-sensitive full pass for every class
 * mutation below .mainnav and for every one of its 20 async-owner retries.
 * With route/list churn that made an otherwise unrelated frame spend 10-31ms
 * in feat_mls_calm_views.js. This harness executes the shipped module and
 * proves both sides of the boundary:
 *
 *   - unchanged nav classes, bounded retries and calendar-grid rebuilds queue
 *     zero frames and perform zero layout reads;
 *   - a real route, changed calendar input, or removed owned control queues
 *     exactly one frame and preserves/remounts the same UI furniture.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'feat_mls_calm_views.js');
const source = fs.readFileSync(filename, 'utf8');
new vm.Script(source, { filename });

function harness() {
  const ids = Object.create(null);
  const observers = [];
  const rafs = [];
  const timers = [];
  const rectReads = Object.create(null);

  function classes(el) {
    return String(el.className || '').split(/\s+/).filter(Boolean);
  }
  function hasClass(el, name) { return classes(el).includes(name); }
  function simpleMatch(el, selector) {
    if (!el || el.nodeType !== 1) return false;
    selector = String(selector || '').trim();
    if (!selector) return false;
    if (selector === '*') return true;
    const tag = selector.match(/^[a-z][\w-]*/i);
    if (tag && el.tagName !== tag[0].toUpperCase()) return false;
    const id = selector.match(/#([\w-]+)/);
    if (id && el.id !== id[1]) return false;
    const wanted = [...selector.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    return wanted.every(name => hasClass(el, name));
  }
  function matchesPart(el, part) {
    const pieces = String(part).trim().split(/\s+/).filter(Boolean);
    if (!pieces.length || !simpleMatch(el, pieces[pieces.length - 1])) return false;
    let ancestor = el.parentElement;
    for (let i = pieces.length - 2; i >= 0; i--) {
      while (ancestor && !simpleMatch(ancestor, pieces[i])) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  }
  function matches(el, selector) {
    return String(selector).split(',').some(part => matchesPart(el, part));
  }
  function descendants(node) {
    const out = [];
    (function walk(parent) {
      (parent.children || []).forEach(child => { out.push(child); walk(child); });
    })(node);
    return out;
  }
  function query(node, selector) {
    return descendants(node).filter(el => matches(el, selector));
  }
  function visibleThroughTree(el) {
    for (let cur = el; cur; cur = cur.parentElement) {
      if (cur.style && cur.style.display === 'none') return false;
    }
    return true;
  }
  function styleObject() {
    const values = Object.create(null);
    return {
      display: '', visibility: '',
      getPropertyValue(name) { return values[name] || ''; },
      setProperty(name, value) { values[name] = String(value); },
      removeProperty(name) { delete values[name]; }
    };
  }

  class Element {
    constructor(tag, owner) {
      this.ownerDocument = owner;
      this.tagName = String(tag || 'div').toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.parentNode = null;
      this.style = styleObject();
      this.attributes = Object.create(null);
      this.className = '';
      this._id = '';
      this._text = '';
      this.type = '';
      this.onclick = null;
      this.classList = {
        contains: name => hasClass(this, name),
        add: name => { if (!hasClass(this, name)) this.className = classes(this).concat(name).join(' '); },
        remove: name => { this.className = classes(this).filter(v => v !== name).join(' '); },
        toggle: (name, force) => {
          const on = force == null ? !hasClass(this, name) : !!force;
          if (on) this.classList.add(name); else this.classList.remove(name);
          return on;
        }
      };
    }
    set id(value) {
      if (this._id && ids[this._id] === this) delete ids[this._id];
      this._id = String(value || '');
      if (this._id) ids[this._id] = this;
    }
    get id() { return this._id; }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get firstChild() { return this.children[0] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const at = this.parentNode.children.indexOf(this);
      return at >= 0 ? (this.parentNode.children[at + 1] || null) : null;
    }
    get isConnected() {
      for (let cur = this; cur; cur = cur.parentNode) if (cur === document.documentElement) return true;
      return false;
    }
    set textContent(value) { this._text = String(value == null ? '' : value); }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set innerHTML(value) {
      this.children.slice().forEach(child => this.removeChild(child));
      this._text = '';
      const html = String(value || '');
      for (const match of html.matchAll(/<span class="([^"]+)"><\/span>/g)) {
        const span = new Element('span', this.ownerDocument);
        span.className = match[1];
        this.appendChild(span);
      }
    }
    get innerHTML() { return this.textContent; }
    setAttribute(name, value) {
      if (name === 'id') { this.id = value; return; }
      if (name === 'class') { this.className = String(value); return; }
      this.attributes[name] = String(value);
    }
    getAttribute(name) {
      if (name === 'id') return this.id || null;
      if (name === 'class') return this.className || null;
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const at = before ? this.children.indexOf(before) : -1;
      this.children.splice(at < 0 ? this.children.length : at, 0, child);
      child.parentNode = this;
      return child;
    }
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null;
      return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(node) {
      for (let cur = node; cur; cur = cur.parentNode) if (cur === this) return true;
      return false;
    }
    matches(selector) { return matches(this, selector); }
    closest(selector) {
      for (let cur = this; cur; cur = cur.parentElement) if (matches(cur, selector)) return cur;
      return null;
    }
    querySelectorAll(selector) { return query(this, selector); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() {
      const key = this.id || this.className || this.tagName;
      rectReads[key] = (rectReads[key] || 0) + 1;
      if (!visibleThroughTree(this)) return { width: 0, height: 0, top: 0 };
      if (this.id === 'mlsDock') return { width: 500, height: 80, top: 720 };
      return { width: 500, height: 40, top: 100 };
    }
    click() { if (typeof this.onclick === 'function') this.onclick(); }
  }

  const document = {
    readyState: 'complete',
    createElement(tag) { return new Element(tag, document); },
    getElementById(id) { const el = ids[id]; return el && el.isConnected ? el : null; },
    querySelectorAll(selector) { return query(document.documentElement, selector); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener() {}
  };
  document.documentElement = new Element('html', document);
  document.head = new Element('head', document);
  document.body = new Element('body', document);
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);

  function el(tag, id, className, parent) {
    const node = new Element(tag, document);
    if (id) node.id = id;
    if (className) node.className = className;
    (parent || document.body).appendChild(node);
    return node;
  }

  const nav = el('nav', '', 'mainnav');
  const patientsTab = el('button', 'nav_patients', 'navtab on', nav);
  const calendarTab = el('button', 'nav_calendar', 'navtab', nav);
  const historyTab = el('button', 'nav_history', 'navtab', nav);
  const teamTab = el('button', 'nav_team', 'navtab', nav);
  const dock = el('div', 'mlsDock');

  const calendarView = el('section', 'calendarView'); calendarView.style.display = 'none';
  const calendarCard = el('div', '', 'card cx-agenda', calendarView);
  const calendarGrid = el('div', 'calendarGrid', 'calendar-grid', calendarCard);
  el('div', '', 'cx-rightctrls', calendarCard);

  const historyView = el('section', 'historyView'); historyView.style.display = 'none';
  const historyCard = el('div', '', 'card', historyView);
  el('h2', '', '', historyCard);
  el('div', 'histList', '', historyCard);
  el('button', 'pullChartBtn', '', historyCard);

  const teamView = el('section', 'teamView'); teamView.style.display = 'none';
  const teamCard = el('div', '', 'card', teamView);
  el('h2', '', '', teamCard);
  el('div', 'teamList', '', teamCard);
  el('div', 'teamEmpty', '', teamCard);

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.target = null; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.target = null; }
  }

  const location = { search: '' };
  const windowListeners = Object.create(null);
  const window = {
    document, location, console,
    innerWidth: 1280, innerHeight: 800,
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame(fn) { rafs.push(fn); return rafs.length; },
    getComputedStyle(node) { return { display: node.style.display || 'block', visibility: node.style.visibility || 'visible' }; },
    addEventListener(name, fn) { (windowListeners[name] || (windowListeners[name] = [])).push(fn); },
    removeEventListener(name, fn) { windowListeners[name] = (windowListeners[name] || []).filter(v => v !== fn); },
    pullScheduleViaAssist() {},
    loadTeamPatients() {},
    activePatient() { return null; },
    _calAppts: [], _calRefDate: '2026-08-08'
  };
  window.window = window;

  const context = {
    window, document, location, console,
    MutationObserver: FakeMutationObserver,
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout() {},
    Date, Math, Object, Array, String, Number, RegExp, JSON
  };
  vm.runInNewContext(source, context, { filename, timeout: 2000 });

  function observerFor(target) {
    const found = observers.find(item => item.target === target);
    assert(found, 'missing observer for ' + (target.id || target.className));
    return found;
  }
  function flushRafs() {
    const batch = rafs.splice(0);
    batch.forEach(fn => fn());
    return batch.length;
  }
  function runRetry() {
    const at = timers.findIndex(item => item.delay === 700);
    assert(at >= 0, 'bounded retry timer was not installed');
    timers.splice(at, 1)[0].fn();
  }
  function totalRects() { return Object.values(rectReads).reduce((a, b) => a + b, 0); }

  return {
    window, document, nav, patientsTab, calendarTab, historyTab, teamTab,
    calendarView, calendarCard, calendarGrid, historyView, teamView, rectReads,
    observerFor, flushRafs, runRetry, totalRects,
    pendingFrames: () => rafs.length
  };
}

const h = harness();
const navObserver = h.observerFor(h.nav);
const calendarObserver = h.observerFor(h.calendarView);

/* Initial route is Patients, which Calm Views does not own. Its install may
   measure the dock once, but no calm-view reconcile frame should be queued. */
assert.strictEqual(h.pendingFrames(), 0);
const installRects = h.totalRects();

for (let i = 0; i < 500; i++) {
  navObserver.callback([{ type: 'attributes', target: h.patientsTab, attributeName: 'class' }]);
}
assert.strictEqual(h.pendingFrames(), 0, 'unchanged nav subtree churn queued calm-view frames');
assert.strictEqual(h.totalRects(), installRects, 'unchanged nav subtree churn performed layout reads');

for (let i = 0; i < 5; i++) h.runRetry();
assert.strictEqual(h.pendingFrames(), 0, 'unchanged async-owner retries queued reconcile frames');
assert.strictEqual(h.totalRects(), installRects, 'unchanged async-owner retries performed layout reads');

/* One real route change is coalesced even if several class mutation batches
   arrive before the browser paints. */
h.patientsTab.classList.remove('on');
h.calendarTab.classList.add('on');
h.calendarView.style.display = 'block';
const preRouteRects = h.totalRects();
for (let i = 0; i < 100; i++) {
  navObserver.callback([{ type: 'attributes', target: h.calendarTab, attributeName: 'class' }]);
}
assert.strictEqual(h.pendingFrames(), 1, 'one route change must queue exactly one frame');
assert.strictEqual(h.flushRafs(), 1);
const primary = h.document.getElementById('mlsCvNxt_calendar');
const more = h.document.getElementById('mlsCvMore_calendar');
assert(primary && more, 'first cooperative frame did not mount the unchanged primary/More UI');
assert.strictEqual(h.totalRects(), preRouteRects, 'Calendar mount forced layout in the interaction frame');
assert.strictEqual(h.pendingFrames(), 1, 'route mount must defer its real-rect safety check to the next frame');
assert.strictEqual(h.flushRafs(), 1, 'deferred More visibility check did not run as one cooperative frame');
assert(h.totalRects() > preRouteRects, 'deferred frame did not verify the More disclosure real rect');
assert.strictEqual(h.rectReads.historyView || 0, 0, 'calendar reconciliation measured hidden History');
assert.strictEqual(h.rectReads.teamView || 0, 0, 'calendar reconciliation measured hidden Team');

const settledRects = h.totalRects();
for (let i = 0; i < 500; i++) {
  calendarObserver.callback([{ type: 'childList', target: h.calendarGrid, addedNodes: [], removedNodes: [] }]);
  navObserver.callback([{ type: 'attributes', target: h.calendarTab, attributeName: 'class' }]);
}
assert.strictEqual(h.pendingFrames(), 0, 'unrelated active-calendar DOM churn queued full reconcile frames');
assert.strictEqual(h.totalRects(), settledRects, 'unrelated active-calendar DOM churn performed layout reads');

/* Changing the appointment source is a real concern. It queues one pass, and
   the existing controls stay the same nodes (no visual/UI rebuild). */
h.window._calAppts = [{ id: 1, name: 'Someone Else', appt_date: '2026-08-09' }];
for (let i = 0; i < 100; i++) {
  calendarObserver.callback([{ type: 'childList', target: h.calendarGrid, addedNodes: [], removedNodes: [] }]);
}
assert.strictEqual(h.pendingFrames(), 1, 'changed calendar input did not coalesce to one frame');
h.flushRafs();
assert.strictEqual(h.document.getElementById('mlsCvNxt_calendar'), primary, 'calendar input change rebuilt the primary UI');
assert.strictEqual(h.document.getElementById('mlsCvMore_calendar'), more, 'calendar input change rebuilt the More UI');

/* Removing owned furniture is intentionally relevant and must self-heal once. */
h.calendarCard.removeChild(primary);
calendarObserver.callback([{ type: 'childList', target: h.calendarCard, addedNodes: [], removedNodes: [primary] }]);
assert.strictEqual(h.pendingFrames(), 1, 'removed owned control did not queue repair');
h.flushRafs();
const repaired = h.document.getElementById('mlsCvNxt_calendar');
assert(repaired && repaired !== primary, 'removed primary control was not remounted');
assert.strictEqual(repaired.textContent, primary.textContent, 'primary repair changed visible copy');

const repairedRects = h.totalRects();
for (let i = 0; i < 10; i++) h.runRetry();
assert.strictEqual(h.pendingFrames(), 0, 'settled calendar retries queued reconcile frames');
assert.strictEqual(h.totalRects(), repairedRects, 'settled calendar retries performed layout reads');

console.log('PASS calm views performance: 1,000 unrelated nav/view mutations and 15 settled retries queued zero frames/layout reads; route mount + rect verification split across frames, while real data/removal concerns each coalesced to one UI-identical repair frame');
