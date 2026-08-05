'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'feat_mls_patient_reach_v2.js');
const source = fs.readFileSync(filename, 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

new vm.Script(source, { filename });
assert(!/chrome\.|browser\.|extension/i.test(source), 'Patient Reach v2 must remain website-only');
assert(!/send-portal-invite|\/api\/patient\/admin/i.test(source), 'Patient Reach v2 must delegate instead of posting portal invites itself');
assert(source.includes("hardened.click();"), 'Patient Reach v2 must delegate through the hardened Patient portal entry');
assert(source.includes("open(kind, { mode: 'full'"), 'the left-navigation destination must always open the full workspace');
assert(source.includes('openContext: function'), 'non-navigation actions need an explicit compact-dialog route');
assert(!/setInterval\s*\(/.test(source), 'Patient Reach v2 must not install a perpetual polling loop');
assert(connect.includes("feat_mls_patient_reach_v2.js?v=20260804pr206"), 'Patient Reach v2 loader is not cache-busted to its secure portal-only release');

function makeHarness() {
  const byId = Object.create(null);
  const documentListeners = Object.create(null);
  const windowListeners = Object.create(null);

  function classSet(node) {
    return String(node.className || '').split(/\s+/).filter(Boolean);
  }
  function hasClass(node, name) { return classSet(node).includes(name); }
  function attrMatch(node, body) {
    const eq = body.match(/^([^=]+)="([^"]*)"$/);
    if (eq) return node.getAttribute(eq[1]) === eq[2];
    const suffix = body.match(/^([^$]+)\$="([^"]*)"$/);
    if (suffix) return String(node.getAttribute(suffix[1]) || '').endsWith(suffix[2]);
    return node.getAttribute(body) != null;
  }
  function matchesSimple(node, selector) {
    selector = selector.trim();
    if (!selector || !node || node.nodeType !== 1) return false;
    if (selector.includes(':not(')) selector = selector.slice(0, selector.indexOf(':not('));
    let tag = '';
    const tagMatch = selector.match(/^[a-z][a-z0-9-]*/i);
    if (tagMatch) { tag = tagMatch[0].toUpperCase(); selector = selector.slice(tagMatch[0].length); }
    if (tag && node.tagName !== tag) return false;
    const idMatch = selector.match(/#([\w-]+)/);
    if (idMatch && node.id !== idMatch[1]) return false;
    const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    if (classes.some(name => !hasClass(node, name))) return false;
    const attrs = [...selector.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    if (attrs.some(body => !attrMatch(node, body))) return false;
    return true;
  }
  function descendants(rootNode) {
    const out = [];
    (function walk(node) {
      (node.children || []).forEach(child => { out.push(child); walk(child); });
    })(rootNode);
    return out;
  }
  function query(rootNode, selector) {
    const selectors = String(selector).split(',').map(s => s.trim()).filter(Boolean);
    const candidates = descendants(rootNode);
    const out = [];
    for (const part of selectors) {
      let found;
      if (part.includes('>')) {
        const pieces = part.split('>').map(s => s.trim());
        found = candidates.filter(node => matchesSimple(node, pieces[pieces.length - 1]) && node.parentNode && matchesSimple(node.parentNode, pieces[0]));
      } else {
        found = candidates.filter(node => matchesSimple(node, part));
      }
      found.forEach(node => { if (!out.includes(node)) out.push(node); });
    }
    return out;
  }

  class Element {
    constructor(tag, owner) {
      this.ownerDocument = owner;
      this.tagName = String(tag || 'div').toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.parentNode = null;
      this.attributes = Object.create(null);
      this.listeners = Object.create(null);
      this.style = {
        overflow: '', display: '',
        removeProperty: function (key) { delete this[key]; }
      };
      this.className = '';
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.type = '';
      this.href = '';
      this._id = '';
      this._text = '';
      this.selected = false;
      this.classList = {
        add: name => { if (!hasClass(this, name)) this.className = classSet(this).concat(name).join(' '); },
        remove: name => { this.className = classSet(this).filter(v => v !== name).join(' '); },
        contains: name => hasClass(this, name)
      };
    }
    set id(value) {
      if (this._id && byId[this._id] === this) delete byId[this._id];
      this._id = String(value || '');
      if (this._id) byId[this._id] = this;
    }
    get id() { return this._id; }
    set textContent(value) { this._text = String(value == null ? '' : value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) {
      if (name === 'id') { this.id = value; return; }
      if (name === 'class') { this.className = String(value); return; }
      this.attributes[name] = String(value == null ? '' : value);
      if (name === 'href') this.href = String(value);
      if (name === 'hidden') this.hidden = true;
      if (name === 'readonly') this.readOnly = true;
    }
    getAttribute(name) {
      if (name === 'id') return this.id || null;
      if (name === 'class') return this.className || null;
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    removeAttribute(name) {
      if (name === 'hidden') this.hidden = false;
      delete this.attributes[name];
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      this.children.push(child); child.parentNode = this; return child;
    }
    removeChild(child) {
      const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null; return child;
    }
    replaceChild(next, old) {
      const at = this.children.indexOf(old); assert(at >= 0);
      if (next.parentNode) next.parentNode.removeChild(next);
      this.children[at] = next; next.parentNode = this; old.parentNode = null; return old;
    }
    insertBefore(child, before) {
      if (!before) return this.appendChild(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      const at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, child); child.parentNode = this; return child;
    }
    contains(node) { for (let cur = node; cur; cur = cur.parentNode) if (cur === this) return true; return false; }
    querySelectorAll(selector) { return query(this, selector); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
      const pieces = String(selector).split(',').map(s => s.trim());
      for (let cur = this; cur; cur = cur.parentNode) if (pieces.some(part => matchesSimple(cur, part))) return cur;
      return null;
    }
    addEventListener(name, fn) { (this.listeners[name] || (this.listeners[name] = [])).push(fn); }
    focus() { this.ownerDocument.activeElement = this; }
    select() { this.selected = true; }
    dispatchClick(isTrusted) {
      const event = {
        target: this, isTrusted,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.immediate = true; this.stopped = true; }
      };
      (documentListeners.click || []).forEach(fn => { if (!event.immediate) fn(event); });
      if (!event.immediate) (this.listeners.click || []).forEach(fn => fn.call(this, event));
      if (!event.immediate && typeof this.onclick === 'function') this.onclick(event);
      return event;
    }
    click() { return this.dispatchClick(false); }
  }

  const document = {
    readyState: 'loading', activeElement: null,
    createElement(tag) { return new Element(tag, document); },
    getElementById(id) { return byId[id] || null; },
    querySelectorAll(selector) { return query(document.documentElement, selector); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(name, fn) { (documentListeners[name] || (documentListeners[name] = [])).push(fn); },
    execCommand() { return true; }
  };
  document.documentElement = new Element('html', document);
  document.head = new Element('head', document);
  document.body = new Element('body', document);
  document.documentElement.appendChild(document.head); document.documentElement.appendChild(document.body);

  const app = document.createElement('main'); app.id = 'appWrap';
  const nav = document.createElement('nav'); nav.id = 'mlsRdNav'; nav.className = 'mainnav';
  const visit = document.createElement('button'); visit.id = 'nav_visit'; visit.className = 'navtab on';
  const help = document.createElement('button'); help.id = 'nav_help'; help.className = 'navtab';
  nav.appendChild(visit); nav.appendChild(help); document.body.appendChild(nav); document.body.appendChild(app);
  const patientBar = document.createElement('div'); patientBar.id = 'patientBar'; document.body.appendChild(patientBar);
  const portal = document.createElement('button'); portal.id = 'mlsPortalInviteBtn'; let portalClicks = 0;
  portal.addEventListener('click', () => { portalClicks += 1; }); document.body.appendChild(portal);

  let active = { id: 'A', name: 'Alice Example', dob: '01/02/1980', email: 'alice@example.test' };
  let patients = [active];
  const window = {
    document,
    location: { origin: 'http://127.0.0.1:8790' },
    navigator: {},
    __mlsCurrentView: 'visit',
    activePatient: () => active,
    getPatients: () => patients,
    effectivePremium: () => true,
    showView(value) { this.currentView = value; },
    addEventListener(name, fn) { (windowListeners[name] || (windowListeners[name] = [])).push(fn); },
    MutationObserver: class { observe() {} disconnect() {} }
  };
  window.window = window;

  const context = vm.createContext({
    window, document, console, Promise, Date, Object, Array, String, Number, RegExp,
    encodeURIComponent, setTimeout, clearTimeout
  });
  vm.runInContext(source, context, { filename });

  return {
    window, document,
    setActive(value) { active = value; patients = value ? [value] : []; },
    emitWindow(name, detail) { (windowListeners[name] || []).slice().forEach(fn => fn({ type: name, detail: detail || {} })); },
    getPortalClicks() { return portalClicks; }
  };
}

(function runtime() {
  const h = makeHarness();
  const api = h.window.__mlsPatientReach;
  assert.strictEqual(api.version, '2.0.4');
  assert(api.init(), 'controller did not create its real rail tabs');
  assert.strictEqual(h.document.querySelectorAll('[data-mls-pr-tab]').length, 2, 'controller must own exactly two rail tabs');

  const reviewsTab = h.document.getElementById('mlsPtab_reviews');
  reviewsTab.dispatchClick(true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.getState())), { open: true, kind: 'reviews', mode: 'full', frozenPatientKey: '' });
  assert.strictEqual(h.document.getElementById('mlsPatientReachWorkspace').hidden, false, 'rail click must open the full workspace');
  assert.strictEqual(h.document.querySelectorAll('.navtab.on').length, 1, 'full workspace must leave exactly one active navigation tab');
  assert.strictEqual(reviewsTab.getAttribute('aria-current'), 'page');

  h.emitWindow('mls:view-changed', { previousView: '__patientReach', view: 'history' });
  assert.strictEqual(api.getState().open, false, 'programmatic navigation must dismiss a full Reach workspace');
  assert.strictEqual(h.document.getElementById('mlsPatientReachWorkspace').hidden, true);

  reviewsTab.dispatchClick(true);

  api.close({ restore: true });
  const invoker = h.document.createElement('button'); h.document.body.appendChild(invoker); invoker.focus();
  h.window.__mlsCurrentView = 'patients';
  api.openReviews({ invoker });
  const panelBefore = h.document.querySelector('[data-mls-pr-kind="reviews"]');
  assert.strictEqual(api.getState().mode, 'dialog', 'context API must default to a compact dialog');
  assert.strictEqual(h.document.getElementById('mlsPatientReachDialog').querySelectorAll('.mls-pr-dialog-actions .mls-pr-action').length || h.document.getElementById('mlsPatientReachDialog').querySelectorAll('.mls-pr-action').length, 2, 'dialog must expose exactly Close and Open full screen chrome actions');
  api.fullscreen();
  const panelAfter = h.document.querySelector('[data-mls-pr-kind="reviews"]');
  assert.strictEqual(panelAfter, panelBefore, 'fullscreen must move, not rebuild, the live review node');
  api.close({ restore: true });
  assert.strictEqual(h.window.currentView, 'patients', 'closing fullscreen must restore the actual originating view');

  h.document.body.style.overflow = 'auto';
  api.openReviews({ invoker });
  api.openSend({ invoker });
  assert.strictEqual(h.document.body.style.overflow, 'hidden', 'compact dialog must lock background scrolling');
  api.close({ restore: true });
  assert.strictEqual(h.document.body.style.overflow, 'auto', 'switching compact Reach tools must restore the pre-dialog scroll state');

  reviewsTab.click();
  reviewsTab.click();
  assert.strictEqual(api.getState().mode, 'full', 'rail activation must remain a full workspace even for keyboard/automation activation');
  assert.strictEqual(h.document.querySelectorAll('#mlsPatientReachWorkspace').length, 1, 'double activation must not duplicate the workspace');
  api.close({ restore: true });
  api.openContext('reviews', { invoker, source: 'runtime-test' });
  assert.strictEqual(api.getState().mode, 'dialog', 'explicit context activation must open the compact dialog');
  api.close({ restore: true });
  assert.strictEqual(h.document.activeElement, invoker, 'closing a context dialog must restore focus to its invoker');

  h.setActive(null);
  api.openSend({ invoker });
  assert.strictEqual(h.document.querySelector('.mls-pr-patient').textContent, 'No patient selected');
  assert.strictEqual(h.document.querySelector('.mls-pr-action.primary').disabled, false, 'dialog fullscreen action should remain usable');
  assert.strictEqual(api.delegatePortalInvite(), false, 'send must refuse to delegate without a selected patient');
  assert.strictEqual(h.getPortalClicks(), 0);
  api.close({ restore: true });

  const alice = { id: 'A', name: 'Alice Example', dob: '01/02/1980', email: 'alice@example.test' };
  h.setActive(alice); api.openSend({ invoker });
  h.setActive({ id: 'B', name: 'Bob Example', dob: '03/04/1975', email: 'bob@example.test' });
  assert.strictEqual(api.delegatePortalInvite(), false, 'a patient switch must stale-block the frozen send action');
  assert.match(h.document.querySelector('.mls-pr-status').textContent, /active patient changed/i);
  assert.strictEqual(h.getPortalClicks(), 0, 'stale action must never reach the hardened invite owner');
  api.close({ restore: true });

  h.setActive(alice); api.openSend({ invoker });
  assert.strictEqual(api.delegatePortalInvite(), true, 'unchanged patient must delegate to the hardened portal owner');
  assert.strictEqual(h.getPortalClicks(), 1);
  assert(api.samePatient({ id: 'A', name: 'Alias' }, alice), 'same stable ID namespace should match');
  assert(!api.samePatient({ mrn: 'A' }, alice), 'equal raw values in different identity namespaces must not match');
  assert(!api.samePatient(
    { id: 'A', athenaId: 'ATH-OLD', mrn: 'MRN-1', name: 'Alice Example', dob: '01/02/1980' },
    { id: 'A', athenaId: 'ATH-NEW', mrn: 'MRN-1', name: 'Alice Example', dob: '01/02/1980' }
  ), 'a matching local ID must not override a contradictory Athena namespace');
  assert(!api.samePatient(
    { id: 'A', athenaId: 'ATH-1', mrn: 'MRN-OLD', name: 'Alice Example', dob: '01/02/1980' },
    { id: 'A', athenaId: 'ATH-1', mrn: 'MRN-NEW', name: 'Alice Example', dob: '01/02/1980' }
  ), 'a matching Athena ID must not override a contradictory MRN namespace');

  api.close({ restore: true });
  h.setActive({ id: 'A', athenaId: 'ATH-OLD', mrn: 'MRN-1', name: 'Alice Example', dob: '01/02/1980' });
  api.openSend({ invoker });
  h.setActive({ id: 'A', athenaId: 'ATH-NEW', mrn: 'MRN-1', name: 'Alice Example', dob: '01/02/1980' });
  assert.strictEqual(api.delegatePortalInvite(), false, 'contradictory stable namespaces must stale-block the frozen invite');
  assert.strictEqual(h.getPortalClicks(), 1, 'contradictory stable namespaces must never reach the hardened invite owner');
})();

console.log('PASS Patient Reach v2: one owner, true rail views, compact dialogs, and stale-patient-safe delegation');
