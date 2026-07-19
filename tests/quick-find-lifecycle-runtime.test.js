'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_topbar_unify.js'), 'utf8');
const start = source.indexOf('var _boxFocus = null, _boxInput = null, _boxClick = null, _origPlaceholder = null;');
const end = source.indexOf('function unwireFind()', start);
assert(start >= 0 && end > start, 'could not isolate unified Find lifecycle');
const findSource = source.slice(start, end);

class FakeEvent {
  constructor(type, options) {
    this.type = type;
    this.bubbles = !!(options && options.bubbles);
    this.target = null;
  }
}

function harness(ownerKind) {
  const byId = Object.create(null);
  const body = {
    removeChild(node) {
      function drop(el) {
        if (el.id && byId[el.id] === el) delete byId[el.id];
        (el.children || []).forEach(drop);
      }
      drop(node);
      node.parentNode = null;
      return node;
    }
  };
  class El {
    constructor(id, display) {
      this.id = id || '';
      this.nodeType = 1;
      this.style = { display: display == null ? '' : display, visibility: 'visible' };
      this.attributes = Object.create(null);
      this.listeners = Object.create(null);
      this.children = [];
      this.parentNode = body;
      this.value = '';
      this.focusCount = 0;
      this.events = [];
      if (this.id) byId[this.id] = this;
    }
    getAttribute(name) { return this.attributes[name] == null ? null : this.attributes[name]; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] || []).filter(candidate => candidate !== fn);
    }
    dispatchEvent(event) {
      event.target = this;
      this.events.push(event.type);
      (this.listeners[event.type] || []).slice().forEach(fn => fn.call(this, event));
      return true;
    }
    focus() { this.focusCount++; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  }

  let launcher = new El('mlsPqsInput', '');
  launcher.setAttribute('placeholder', 'Find patient');
  let openCalls = 0;

  function mountSurface(kind) {
    const isPro = kind === 'pro';
    const overlayId = isPro ? 'mlsFpQf' : 'mlsQuickFindOv';
    const inputId = isPro ? 'mlsFpQfInput' : 'mlsQfInput';
    let overlay = byId[overlayId];
    if (!overlay) {
      overlay = new El(overlayId, 'none');
      const input = new El(inputId, '');
      input.parentNode = overlay;
      overlay.children.push(input);
    }
    overlay.style.display = 'flex';
    return overlay;
  }

  function quickFind() {
    openCalls++;
    if (ownerKind === 'legacy' && byId.mlsQuickFindOv) return;
    mountSurface(ownerKind);
  }
  if (ownerKind === 'pro') quickFind.__fpWrap = true;

  const window = { mlsQuickFind: quickFind };
  const context = {
    window,
    Event: FakeEvent,
    getComputedStyle(el) {
      return { display: el.style.display || '', visibility: el.style.visibility || 'visible' };
    },
    setTimeout(fn) { fn(); return 1; },
    safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
    gid(id) { return byId[id] || null; },
    pqsInput() { return launcher; },
    Object
  };
  vm.createContext(context);
  vm.runInContext(findSource, context, { filename: 'feat_mls_topbar_unify.js#find' });

  return {
    byId,
    context,
    window,
    launcher() { return launcher; },
    replaceLauncher() {
      launcher = new El('mlsPqsInput', '');
      launcher.setAttribute('placeholder', 'Find patient');
      return launcher;
    },
    mountSurface,
    openCalls() { return openCalls; }
  };
}

{
  const h = harness('pro');
  h.mountSurface('legacy').style.display = 'none'; // stale legacy poison
  h.context.wireFind();
  h.launcher().value = 'synthetic';
  h.launcher().dispatchEvent(new FakeEvent('focus'));

  assert.strictEqual(h.openCalls(), 1, 'current Pro owner was not invoked');
  assert.strictEqual(h.byId.mlsQuickFindOv, undefined, 'closed legacy poison was not retired');
  assert.strictEqual(h.byId.mlsFpQf.style.display, 'flex', 'Pro Find surface did not open');
  assert.strictEqual(h.byId.mlsFpQfInput.value, 'synthetic', 'launcher seed did not reach current Pro input');
  assert.strictEqual(h.byId.mlsFpQfInput.focusCount, 1, 'current Pro input was not focused');
  assert.strictEqual(h.launcher().value, '', 'launcher was not reset after handoff');

  h.byId.mlsFpQf.style.display = 'none';
  h.launcher().value = 'again';
  h.launcher().dispatchEvent(new FakeEvent('click')); // already focused: no second focus event
  assert.strictEqual(h.openCalls(), 2, 'click on an already-focused launcher did not reopen the closed Pro surface');
  assert.strictEqual(h.byId.mlsFpQfInput.value, 'again');

  h.launcher().value = 'visible';
  h.launcher().dispatchEvent(new FakeEvent('focus'));
  assert.strictEqual(h.openCalls(), 2, 'already-visible canonical surface was opened twice');

  h.byId.mlsFpQf.style.display = 'none';
  const remounted = h.replaceLauncher();
  h.context.wireFind();
  remounted.value = 'remount';
  remounted.dispatchEvent(new FakeEvent('focus'));
  assert.strictEqual(h.openCalls(), 3, 'replacement top-bar launcher was not wired');
  assert.strictEqual(h.byId.mlsFpQfInput.value, 'remount');
}

{
  const h = harness('legacy');
  h.mountSurface('legacy').style.display = 'none';
  h.context.wireFind();
  h.launcher().dispatchEvent(new FakeEvent('focus'));
  assert.strictEqual(h.openCalls(), 1, 'legacy owner was not called after its hidden stale node was retired');
  assert.strictEqual(h.byId.mlsQuickFindOv.style.display, 'flex', 'legacy Find surface did not rebuild');
  const first = h.byId.mlsQuickFindOv;
  first.style.display = 'none';
  h.launcher().dispatchEvent(new FakeEvent('click')); // already focused: no second focus event
  assert.strictEqual(h.openCalls(), 2, 'legacy Find failed its second reopen from an already-focused launcher');
  assert.notStrictEqual(h.byId.mlsQuickFindOv, first, 'closed legacy node was reused despite its existence guard');
  assert.strictEqual(h.byId.mlsFpQf, undefined, 'a competing Pro surface was mounted');
}

console.log('PASS unified Find lifecycle: current owner opens, closes, reopens, and survives launcher remount without hidden legacy poisoning');
