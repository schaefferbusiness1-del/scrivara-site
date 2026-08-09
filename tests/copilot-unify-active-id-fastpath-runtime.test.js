'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_copilot_unify.js'), 'utf8');

assert(source.includes('VERSION = "unify-1.2.0"'), 'Copilot active-id fast-path version missing');
assert(source.includes('isFn(window.getActivePtId)'), 'no-patient hint lost the canonical active-id fast path');

function harness(withCanonicalId) {
  const nodes = Object.create(null);
  const handlers = Object.create(null);
  const stats = { activePatientReads: 0, activeIdReads: 0, intervals: 0 };

  function node(tag) {
    return {
      tagName: String(tag || 'div').toUpperCase(), id: '', style: {}, children: [], parentNode: null,
      appendChild(child) { child.parentNode = this; this.children.push(child); if (child.id) nodes[child.id] = child; return child; },
      insertBefore(child) { return this.appendChild(child); },
      removeChild(child) { this.children = this.children.filter(value => value !== child); child.parentNode = null; },
      querySelector() { return null; }
    };
  }

  const document = {
    readyState: 'complete', head: node('head'), body: node('body'), documentElement: node('html'),
    createElement: node, createTextNode(text) { return { textContent: String(text), parentNode: null }; },
    getElementById(id) { return nodes[id] || null; }, querySelector() { return null; },
    addEventListener() {}, removeEventListener() {}
  };
  let activeId = 'P-1';
  let legacyPatient = { id: 'P-1', name: 'Synthetic Patient' };
  const context = {
    console, document, location: { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' },
    _copilotHistory: [], _copilotRenderThread() {}, _copilotRenderChips() {}, _copilotSaveHist() {},
    copilotSnapshot() { return {}; }, localStorage: { removeItem() {} }, uns(value) { return value; },
    activePatient() { stats.activePatientReads++; return legacyPatient; },
    setInterval() { stats.intervals++; return 1; }, clearInterval() {},
    addEventListener(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); },
    removeEventListener(name, fn) { if (handlers[name]) handlers[name] = handlers[name].filter(value => value !== fn); }
  };
  if (withCanonicalId) context.getActivePtId = () => { stats.activeIdReads++; return activeId; };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'feat_mls_copilot_unify.js' });
  return {
    context, handlers, stats,
    setActiveId(value) { activeId = value; },
    setLegacyPatient(value) { legacyPatient = value; }
  };
}

const fast = harness(true);
assert.strictEqual(fast.context.__mlsCopilotUnify.version, 'unify-1.2.0');
assert.strictEqual(fast.stats.intervals, 0, 'ready Copilot dependencies started a retry interval');
assert.strictEqual(fast.stats.activePatientReads, 0, 'boot decoded the patient roster just to decide hint presence');

const patientHandlers = fast.handlers['mls:active-patient-changed'] || [];
assert.strictEqual(patientHandlers.length, 1, 'canonical patient-change hint listener missing');
for (let i = 0; i < 1000; i++) patientHandlers[0]({ detail: { patientId: 'P-1' } });
for (let i = 0; i < 1000; i++) fast.context.__mlsCopilotUnify.route('synthetic-route');
fast.context.__mlsCopilotUnify._diag();
assert.strictEqual(fast.stats.activePatientReads, 0,
  'patient hint/route activity called activePatient() despite canonical getActivePtId()');
assert(fast.stats.activeIdReads >= 1001, 'the O(1) active-id binding was not consulted');

fast.setActiveId('');
patientHandlers[0]({ detail: { patientId: '' } });
assert.strictEqual(fast.context.__mlsCopilotConvo.noActivePatient(), true, 'empty canonical binding did not show no-patient state');
assert.strictEqual(fast.stats.activePatientReads, 0, 'empty canonical binding fell through to a roster decode');

const publicPatient = fast.context.__mlsCopilotConvo.activePatient();
assert.strictEqual(publicPatient.id, 'P-1', 'public activePatient compatibility API changed');
assert.strictEqual(fast.stats.activePatientReads, 1, 'public record API did not retain its record lookup');

const legacy = harness(false);
const legacyBootReads = legacy.stats.activePatientReads;
assert.strictEqual(legacy.context.__mlsCopilotConvo.noActivePatient(), false,
  'older host without getActivePtId lost activePatient fallback');
legacy.setLegacyPatient(null);
assert.strictEqual(legacy.context.__mlsCopilotConvo.noActivePatient(), true,
  'older-host fallback did not recognize a cleared active patient');
assert(legacy.stats.activePatientReads >= legacyBootReads + 2, 'older-host fallback was not exercised');

console.log('PASS Copilot no-patient hint and route checks use canonical O(1) active-id presence with older-host fallback');
