'use strict';

/* Focused runtime contract for feat_after_visit_summary.js.
 *
 * This deliberately exercises the module through its public open/generate
 * surface in a tiny VM DOM. The scenarios are separate because an async
 * result that is safe for one visit must not become safe merely because a
 * clinician switched away and later returned to the same patient.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_after_visit_summary.js'), 'utf8');

function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    type: '',
    className: '',
    title: '',
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    style: {},
    children: [],
    parentNode: null,
    listeners: Object.create(null),
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
    },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    click() { if (!this.disabled && this.listeners.click) this.listeners.click({ preventDefault() {} }); },
    select() {},
    querySelector(selector) {
      if (selector && selector[0] === '#') return findById(this, selector.slice(1));
      if (selector === '.mlsctx-switch') return null;
      return null;
    }
  };
  return node;
}

function findById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function parseMarkup(node, html) {
  node.innerHTML = String(html || '');
  const ids = [...node.innerHTML.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  for (const id of ids) {
    const child = makeNode(id === 'mlsavsText' ? 'textarea' : id === 'mlsavsEmail' ? 'input' : 'button');
    child.id = id;
    const textMatch = node.innerHTML.match(new RegExp('id="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>([\\s\\S]*?)<', 'i'));
    if (textMatch) child.textContent = textMatch[1].replace(/<[^>]*>/g, '');
    node.appendChild(child);
  }
}

function harness() {
  const nodes = Object.create(null);
  const body = makeNode('body');
  const head = makeNode('head');
  const pending = [];
  const calls = [];
  const toasts = [];
  const patients = {
    a: { id: 'patient-a', name: 'Patient A', dob: '01/01/1970' },
    b: { id: 'patient-b', name: 'Patient B', dob: '02/02/1970' }
  };
  const state = { activeId: 'a', notes: [{ patientId: 'patient-a', text: 'NOTE A', updated: '2026-08-01' }] };
  const document = {
    readyState: 'complete',
    body,
    head,
    documentElement: head,
    getElementById(id) { return nodes[id] || findById(body, id) || findById(head, id); },
    createElement(tag) {
      const node = makeNode(tag);
      const originalAppend = node.appendChild.bind(node);
      node.appendChild = (child) => {
        originalAppend(child);
        if (child.id) nodes[child.id] = child;
        return child;
      };
      return node;
    },
    querySelector() { return null; },
    addEventListener() {}
  };
  const context = {
    console,
    Promise,
    JSON,
    String,
    Array,
    Object,
    RegExp,
    Error,
    Date,
    setTimeout,
    clearTimeout,
    setInterval() { return 1; },
    clearInterval() {},
    MutationObserver: function MutationObserver() { this.observe = function () {}; this.disconnect = function () {}; },
    navigator: { clipboard: null },
    document,
    getActivePtId: () => patients[state.activeId].id,
    getPatients: () => Object.values(patients),
    getNotes: () => state.notes,
    aiCallRaw(sys, user, key, options) {
      calls.push({ sys, user, key, options });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    hasAI: () => true,
    getKey: () => 'test-key',
    toast: (message) => toasts.push(String(message)),
    getPracticeName: () => 'Test Practice',
    getClinicPhone: () => '(555) 555-5555',
    currentVisitAthenaBinding: { id: 'visit-a', patientId: 'patient-a' },
    currentVisitAthenaEpoch: 1,
    window: null
  };
  context.window = context;
  const originalBodyAppend = body.appendChild.bind(body);
  body.appendChild = (child) => {
    originalBodyAppend(child);
    if (child.id) nodes[child.id] = child;
    if (child.innerHTML) parseMarkup(child, child.innerHTML);
    for (const descendant of child.children) if (descendant.id) nodes[descendant.id] = descendant;
    return child;
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'feat_after_visit_summary.js', timeout: 1000 });

  function open() {
    context.window.__mlsAfterVisitSummary.open();
    return {
      overlay: nodes.mlsavsModal,
      generate: nodes.mlsavsGen,
      close: nodes.mlsavsClose,
      text: nodes.mlsavsText,
      status: nodes.mlsavsStatus
    };
  }
  function resolve(value) {
    assert.strictEqual(pending.length, 1, 'expected exactly one pending AI request');
    pending.shift().resolve(value);
  }
  function reject(error) {
    assert.strictEqual(pending.length, 1, 'expected exactly one pending AI request');
    pending.shift().reject(error);
  }
  return { context, state, pending, calls, toasts, open, resolve, reject, nodes };
}

async function staleSamePatientNoteChange() {
  const h = harness();
  const modal = h.open();
  modal.generate.click();
  h.state.notes = [{ patientId: 'patient-a', text: 'NOTE B', updated: '2026-08-02' }];
  h.resolve('STALE NOTE A RESULT');
  await new Promise(setImmediate);
  assert.strictEqual(modal.text.value, '', 'same-patient note change accepted an older result');
  assert.strictEqual(modal.generate.disabled, false, 'same-patient stale result left Generate disabled');
  assert.match(modal.status.innerHTML, /patient or visit note changed/i, 'same-patient stale result did not show a clear refusal');
}

async function visitABAEpochChange() {
  const h = harness();
  const modal = h.open();
  modal.generate.click();
  h.state.activeId = 'b';
  h.context.currentVisitAthenaBinding = { id: 'visit-b', patientId: 'patient-b' };
  h.context.currentVisitAthenaEpoch = 2;
  h.state.activeId = 'a';
  h.context.currentVisitAthenaBinding = { id: 'visit-a', patientId: 'patient-a' };
  h.context.currentVisitAthenaEpoch = 3;
  h.resolve('STALE A RESULT FROM OLD EPOCH');
  await new Promise(setImmediate);
  assert.strictEqual(modal.text.value, '', 'A→B→A visit epoch change accepted an older result');
  assert.strictEqual(modal.generate.disabled, false, 'epoch-stale result left Generate disabled');
  assert.match(modal.status.innerHTML, /patient or visit note changed/i, 'epoch-stale result did not show a clear refusal');
}

async function closeReopenIsolation() {
  const h = harness();
  const first = h.open();
  first.generate.click();
  first.close.click();
  const second = h.open();
  assert.strictEqual(second.generate.disabled, false, 'new modal Generate started disabled');
  assert.strictEqual(second.status.innerHTML, '', 'new modal started with an unexpected status');
  h.reject(new Error('OLD REQUEST FAILED AFTER CLOSE'));
  await new Promise(setImmediate);
  assert.strictEqual(second.text.value, '', 'closed modal result mutated a reopened modal');
  assert.strictEqual(second.status.innerHTML, '', 'old rejection changed the reopened modal status');
  assert.strictEqual(second.generate.disabled, false, 'old rejection changed the reopened modal Generate state');
}

async function unchangedAcceptance() {
  const h = harness();
  const modal = h.open();
  modal.generate.click();
  h.resolve('CURRENT VISIT RESULT');
  await new Promise(setImmediate);
  assert.strictEqual(modal.text.value, 'CURRENT VISIT RESULT', 'unchanged visit rejected a safe result');
  assert.match(modal.status.innerHTML, /Draft ready/i, 'unchanged visit did not show ready status');
}

async function avsFamilyOption() {
  const h = harness();
  const modal = h.open();
  modal.generate.click();
  assert.strictEqual(h.calls.length, 1, 'generation did not call aiCallRaw exactly once');
  assert.strictEqual(h.calls[0].options.family, 'avs', 'AVS generation did not identify family=avs');
  h.resolve('CURRENT VISIT RESULT');
  await new Promise(setImmediate);
}

const tests = [
  ['stale same-patient note changes are discarded', staleSamePatientNoteChange],
  ['A→B→A epoch changes are discarded', visitABAEpochChange],
  ['close/reopen isolates old results', closeReopenIsolation],
  ['unchanged visit accepts its result', unchangedAcceptance],
  ['generation sends family:avs', avsFamilyOption]
];

(async () => {
  let failures = 0;
  for (const [name, test] of tests) {
    try {
      await test();
      console.log('PASS ' + name);
    } catch (error) {
      failures++;
      console.error('FAIL ' + name + ': ' + (error && error.stack || error));
    }
  }
  console.log(`RESULT ${tests.length - failures}/${tests.length} passed`);
  if (failures) process.exitCode = 1;
})();
