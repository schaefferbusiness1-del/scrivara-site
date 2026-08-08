'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_patientpick.js'), 'utf8');
const start = source.indexOf('/* ===================== Complex view wiring ===================== */');
const end = source.indexOf('\n  function revert()', start);
assert(start >= 0 && end > start, 'patient-picker lifecycle section is missing');

const lifecycle = source.slice(start, end);
const visitState = lifecycle.slice(lifecycle.indexOf('function visitViewShown()'), lifecycle.indexOf('function onVisitComplex()'));
const ctxRepair = lifecycle.slice(lifecycle.indexOf('function ensureCtxBar()'), lifecycle.indexOf('function cancelTick()'));
assert(visitState.indexOf('display === "none"') < visitState.indexOf('getComputedStyle(v)'), 'known hidden Visit reads computed style before its fast path');
assert(!ctxRepair.includes('getComputedStyle('), 'global context-bar repair still forces a style/layout read');
assert(lifecycle.includes('ensureCtxBar();                 /* global banner repair is not Visit-only */'), 'hidden tick drops global context-bar repair');
assert(lifecycle.includes('cancelTick();\n      hideComplexInline();\n      ensureCtxBar();'), 'route exit does not cancel Complex work and repair the global bar');
assert(lifecycle.includes('_bootTimers.push(setTimeout(ensureCtxBar, ms))'), 'off-Visit boot no longer repairs a delayed context-bar remount');

const nav = { id: 'mlsRdNav' };
const wrap = {
  id: 'appWrap',
  insertCalls: 0,
  lastRef: undefined,
  insertBefore(node, ref) {
    this.insertCalls += 1;
    this.lastRef = ref;
    node.parentElement = this;
    header.nextSibling = node;
  }
};
const header = { id: 'appHeader', parentElement: wrap, nextSibling: null };
const ctxBar = {
  id: 'mlsCtxBar',
  style: { display: 'none' },
  parentElement: nav,
  querySelector: selector => selector === '.mlsctx-id' ? {} : null
};
const elements = {
  visitView: { style: { display: 'none' } },
  mlsPickComplexWrap: { style: { display: '' } },
  mlsCtxBar: ctxBar,
  appHeader: header,
  appWrap: wrap
};
let simpleMode = false;
let computedStyleReads = 0;
let nextTimer = 1;
const timers = new Map();

const context = {
  window: {},
  document: {
    documentElement: { classList: { contains: () => simpleMode } },
    getElementById: id => elements[id] || null
  },
  $: id => elements[id] || null,
  getComputedStyle: () => {
    computedStyleReads += 1;
    throw new Error('computed style must not be read by the route lifecycle');
  },
  setTimeout: fn => {
    const id = nextTimer++;
    timers.set(id, fn);
    return id;
  },
  clearTimeout: id => timers.delete(id),
  MutationObserver: function () {},
  DEFAULT_LIMIT: 6
};

vm.createContext(context);
vm.runInContext(lifecycle + `
  this.__patientpickLifecycle = {
    onVisitComplex: onVisitComplex,
    onViewChanged: onViewChanged,
    onPatientChanged: onPatientChanged,
    scheduleTick: scheduleTick,
    tick: tick,
    ensureCtxBar: ensureCtxBar,
    installHooks: function (wire, render, ensure) {
      wireComplex = wire;
      renderComplexInline = render;
      ensureCtxBar = ensure;
    }
  };
`, context);

const api = context.__patientpickLifecycle;
const runTimers = () => {
  const pending = [...timers.values()];
  timers.clear();
  pending.forEach(fn => fn());
};

assert.strictEqual(api.onVisitComplex(), false, 'hidden Visit was treated as active');
api.tick();
assert.strictEqual(ctxBar.parentElement, wrap, 'off-Visit tick did not repair a context bar clipped inside the rail');
assert.strictEqual(header.nextSibling, ctxBar, 'off-Visit context bar was not pinned directly after the header');
assert.strictEqual(wrap.lastRef, null, 'context bar was not inserted at the header\'s original next-sibling position');
assert.strictEqual(ctxBar.style.display, '', 'off-Visit context bar kept an actionable inline hidden state');
assert.strictEqual(wrap.insertCalls, 1, 'off-Visit context bar repair did not make exactly one structural move');
api.tick();
assert.strictEqual(wrap.insertCalls, 1, 'already-pinned context bar was moved again');
assert.strictEqual(computedStyleReads, 0, 'known hidden Visit/context-bar repair forced a layout read');

const calls = { wire: 0, render: 0, ensure: 0 };
api.installHooks(
  () => { calls.wire += 1; },
  () => { calls.render += 1; },
  () => { calls.ensure += 1; }
);

api.scheduleTick();
api.onPatientChanged();
api.onViewChanged();
assert.strictEqual(timers.size, 1, 'hidden lifecycle activity stopped scheduling global context-bar repair');
runTimers();
assert.deepStrictEqual(calls, { wire: 0, render: 0, ensure: 1 }, 'hidden lifecycle activity ran Complex work or skipped global repair');
assert.strictEqual(computedStyleReads, 0, 'hidden lifecycle activity read computed style');

elements.visitView.style.display = 'block';
assert.strictEqual(api.onVisitComplex(), true, 'visible Complex Visit was not detected');
simpleMode = true;
assert.strictEqual(api.onVisitComplex(), false, 'Simple Visit was incorrectly treated as Complex');
simpleMode = false;

api.onViewChanged({ detail: { previousView: 'patients', view: 'visit' } });
assert.strictEqual(timers.size, 1, 'entering Visit did not schedule one picker pass');
runTimers();
assert.deepStrictEqual(calls, { wire: 1, render: 1, ensure: 2 }, 'visible Visit did not perform the existing picker work');

api.onPatientChanged();
assert.strictEqual(timers.size, 1, 'visible patient change did not schedule picker refresh');
elements.visitView.style.display = 'none';
api.onViewChanged({ detail: { previousView: 'visit', view: 'patients' } });
assert.strictEqual(timers.size, 0, 'leaving Visit did not cancel pending picker work');
assert.strictEqual(elements.mlsPickComplexWrap.style.display, 'none', 'leaving Visit did not hide the Complex picker wrapper');
assert.deepStrictEqual(calls, { wire: 1, render: 1, ensure: 3 }, 'leaving Visit ran Complex work or skipped global context repair');
assert.strictEqual(computedStyleReads, 0, 'route exit forced a computed-style/layout read');

elements.visitView.style.display = 'block';
api.scheduleTick();
elements.visitView.style.display = 'none';
runTimers();
assert.deepStrictEqual(calls, { wire: 1, render: 1, ensure: 4 }, 'a hidden Visit ran Complex work or dropped queued global repair');

elements.visitView.style.display = '';
context.getComputedStyle = () => { computedStyleReads += 1; return { display: 'none' }; };
assert.strictEqual(api.onVisitComplex(), false, 'ambiguous CSS-hidden Visit was treated as visible');
assert.strictEqual(computedStyleReads, 1, 'ambiguous Visit state did not retain the compatibility fallback');

console.log('PASS patient picker hidden-view performance: off-Visit bar repair survives; hidden Complex work avoids layout; visible work still runs');
