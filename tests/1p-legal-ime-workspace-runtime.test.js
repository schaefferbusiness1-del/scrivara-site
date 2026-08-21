'use strict';

/* Executed contract for the 1p-only Legal / IME workspace. The fixture uses
   synthetic names and keeps network access inside a stubbed authenticated OCR
   boundary; it never touches a real patient store, extension, Athena,
   production Legal feature, clipboard, download, or print. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_legalpack.js'), 'utf8');
const showcase = fs.readFileSync(path.join(root, '1p', 'legal', 'index.html'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function deep(actual, expected, message) { assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; }

function node(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(), id: '', value: '', hidden: false,
    disabled: false, innerHTML: '', textContent: '', style: {}, parentNode: null,
    children: [], listeners: {}, attributes: {}, files: [],
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter(x => x !== child); child.parentNode = null; },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'hidden') this.hidden = true;
      if (k === 'disabled') this.disabled = true;
      if (k === 'style') {
        const display = /(?:^|;)\s*display\s*:\s*([^;]*)/i.exec(String(v));
        this.style.display = display ? display[1].trim() : '';
      }
    },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    getAttributeNames() { return Object.keys(this.attributes); },
    removeAttribute(k) {
      delete this.attributes[k];
      if (k === 'hidden') this.hidden = false;
      if (k === 'disabled') this.disabled = false;
      if (k === 'style') this.style = {};
    },
    contains(candidate) {
      if (candidate === this) return true;
      return (this.children || []).some(child => child.contains ? child.contains(candidate) : child === candidate);
    },
    addEventListener(name, fn) {
      const prior = this.listeners[name];
      const handlers = prior && prior._handlers ? prior._handlers.slice() : (prior ? [prior] : []);
      handlers.push(fn);
      const dispatch = (...args) => handlers.slice().forEach(handler => handler(...args));
      dispatch._handlers = handlers;
      this.listeners[name] = dispatch;
    },
    removeEventListener(name, fn) {
      const prior = this.listeners[name]; if (!prior) return;
      const handlers = (prior._handlers || [prior]).filter(handler => handler !== fn);
      if (!handlers.length) { delete this.listeners[name]; return; }
      const dispatch = (...args) => handlers.slice().forEach(handler => handler(...args));
      dispatch._handlers = handlers; this.listeners[name] = dispatch;
    },
    querySelectorAll() { return []; }, click() {},
    focus() { if (this._document) this._document.activeElement = this; this.focused = true; }
  };
}

function makeClock() {
  let now = 0, next = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const id = next++; timers.set(id, { id, at: now + Number(ms || 0), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const end = now + Number(ms || 0);
      while (true) {
        const due = [...timers.values()].filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers.delete(due.id); now = due.at; due.fn();
      }
      now = end;
    },
    count() { return timers.size; }
  };
}

async function flush(turns = 16) { while (turns-- > 0) await Promise.resolve(); }

/* legal-coherent-1.0.0: the model now returns one whole strict-JSON report.
   Build fixture replies from the section contract carried by the actual
   request so report-type, counsel-question, and heading-order drift stays
   executable instead of being duplicated in this test. */
function promptJson(request, prefix, suffix) {
  const sys = String(request && request.sys || '');
  const start = sys.indexOf(prefix);
  assert.ok(start >= 0, 'whole-report prompt omitted ' + prefix.trim());
  const from = start + prefix.length;
  const end = sys.indexOf(suffix, from);
  assert.ok(end > from, 'whole-report prompt omitted ' + suffix.trim());
  return JSON.parse(sys.slice(from, end));
}
function wholeReportResponse(request, mutate) {
  const specs = promptJson(request, 'Expected sections: ', '. Evidence-ID allowlist: ');
  const evidenceIds = promptJson(request, 'Evidence-ID allowlist: ', '.');
  const nameMatch = /\[P000\] EXACT ACTIVE PATIENT BINDING\s*\nName:\s*([^\n]+)/.exec(String(request.user || ''));
  const patientName = nameMatch ? nameMatch[1].trim() : 'the bound patient';
  const sections = specs.map((spec, index) => ({
    heading: spec.heading,
    paragraphs: index === 0 && evidenceIds.includes('P000')
      ? [{ text: 'The frozen patient binding identifies ' + patientName + ' by name.', evidenceIds: ['P000'] }]
      : [{ text: 'The records reviewed do not document sufficient evidence for requested item ' + (index + 1) + '; clinician verification is required.', evidenceIds: [] }]
  }));
  const report = { sections };
  if (mutate) mutate(report, { specs, evidenceIds, patientName });
  return JSON.stringify(report);
}
async function waitForAi(runtime, count) {
  for (let spin = 0; spin < 24 && runtime.pendingAi.length < count; spin++) await Promise.resolve();
  eq(runtime.pendingAi.length, count, 'expected whole-report AI request ' + count);
  return runtime.pendingAi[count - 1];
}

function makeRuntime(options = {}) {
  const ids = {};
  let originalTogglePtMore = null;
  const head = node('head'), body = node('body'), rootNode = node('html');
  rootNode.appendChild(head); rootNode.appendChild(body);
  const events = {};
  const patients = {
    A: { id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A',
      problems: 'M54.50 Low back pain',
      visits: [
        { date: '2025-02-02', type: 'Office visit', provider: 'Dr Preview', detail: 'Pain follow-up. Return in 4 weeks.' },
        { date: '2025-01-10', type: 'Lumbar MRI', provider: 'Dr Reader', detail: 'Documented impression only.' }
      ],
      docs: [{ date: '2025-01-08', name: 'Outside hospital records', text: 'Synthetic outside record.' }] },
    B: { id: 'B', name: 'Synthetic Beta', dob: '03/04/1990', mrn: 'TEST-B', visits: [] }
  };
  let activeId = 'A', epoch = 1;
  const pendingAi = [];
  const visionRequests = [];
  const window = {
    __MLS_P1_PREVIEW: { enabled: true, route: '/1p/' }, _mlsActivePtEpoch: epoch,
    activePatient: () => patients[activeId], getActivePtId: () => activeId,
    patientNotes: id => id === 'A' ? [{ patientId: 'A', updated: 4, signed: true, provider: 'Dr Preview', soap: 'ASSESSMENT:\nM54.50\nPLAN:\nContinue therapy. Follow-up in 4 weeks. MRI reviewed.' }] : [],
    __mlsVisitModel: { getVisits: p => p.visits || [] },
    addEventListener(name, fn) { events[name] = fn; },
    removeEventListener(name) { delete events[name]; },
    aiCallRaw(sys, user, key, opts) {
      return new Promise((resolve, reject) => pendingAi.push({ sys, user, key, opts, resolve, reject }));
    },
    getKey: () => 'synthetic-key', toast() {}, open: () => null,
    bkBase: () => 'https://synthetic.invalid', bkToken: () => 'synthetic-ocr-token',
    readFileAsDataUrl: file => Promise.resolve(file.dataUrl || 'data:image/png;base64,c3ludGhldGljLWltYWdl'),
    fetch: async (url, init) => {
      visionRequests.push({ url, init });
      if (typeof options.visionFetch === 'function') return options.visionFetch(url, init);
      return { ok: true, status: 200, json: async () => ({ text: options.visionText === undefined ? 'Synthetic OCR text.' : options.visionText }) };
    }
  };
  const clock = makeClock();
  function findIn(tree, id) {
    if (!tree) return null; if (tree.id === id) return tree;
    for (const child of tree.children || []) { const found = findIn(child, id); if (found) return found; }
    return null;
  }
  const document = {
    head, body, documentElement: rootNode,
    activeElement: null,
    currentScript: null,
    getElementById: id => ids[id] || findIn(rootNode, id),
    createElement(tag) {
      const el = node(tag); el._document = document;
      if (String(tag).toLowerCase() === 'canvas') {
        el.getContext = () => ({ fillStyle: '', fillRect() {}, drawImage() {} });
        el.toDataURL = () => 'data:image/jpeg;base64,c3ludGhldGljLXBhZ2U=';
      }
      return el;
    }
  };
  [head, body, rootNode].forEach(el => { el._document = document; });
  const installScript = node('script');
  installScript.setAttribute('data-mls-asset', 'feat_mls_legalpack.js');
  installScript.setAttribute('data-mls-install-token', 'synthetic-legal-install');
  document.currentScript = installScript;
  window.__mlsP1LegalLoader = { installed: true, version: 'p1-legal-1.0.0', state: 'loading', installToken: 'synthetic-legal-install' };
  window.bkUser = Object.prototype.hasOwnProperty.call(options, 'user') ? options.user : { role: 'doctor' };
  if (options.door) {
    const button = node('button'); button._document = document; button.id = 'ptLawyerBtn';
    button.setAttribute('class', 'btn-ghost'); button.setAttribute('hidden', ''); button.setAttribute('disabled', '');
    button.setAttribute('aria-disabled', 'true'); button.setAttribute('style', 'display:none;margin-left:8px');
    button.setAttribute('title', 'Networked legal intake is not released'); button.textContent = 'Legal workspace unavailable';
    if (typeof options.doorListener === 'function') button.addEventListener('click', options.doorListener);
    ids.ptLawyerBtn = button; body.appendChild(button);
    window.togglePtMore = function () {
      button.style.display = 'none'; button.setAttribute('aria-hidden', 'true'); button.setAttribute('tabindex', '-1');
      return 'original-result';
    };
    originalTogglePtMore = window.togglePtMore;
  }
  const context = { window, document, navigator: { clipboard: { writeText: () => Promise.resolve() } },
    location: { search: options.search || '' }, URLSearchParams, URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
    Blob, Date, JSON, Math, Object, Array, String, Number, RegExp, Promise, AbortController,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, console };
  window.window = window; window.document = document; window.navigator = context.navigator;
  vm.createContext(context); vm.runInContext(source, context, { filename: '1p-feat_mls_legalpack.js' });
  return {
    window, document, api: window.__mlsP1LegalPack, pendingAi, visionRequests, ids, clock, events, originalTogglePtMore,
    fire(name, detail) { if (events[name]) events[name]({ detail: detail || {} }); },
    switchPatient(id) { const previous = activeId; activeId = id; epoch++; window._mlsActivePtEpoch = epoch; if (events['mls:active-patient-changed']) events['mls:active-patient-changed']({ detail: { previousId: previous, patientId: id } }); },
    switchPatientSilently(id) { activeId = id; epoch++; window._mlsActivePtEpoch = epoch; }
  };
}

const UI_IDS = [
  'mlsP1LegalClose', 'mlsP1LegalCompile', 'mlsP1LegalChronCopy',
  'mlsP1LegalChronDownload', 'mlsP1LegalChronPrint', 'mlsP1LegalProviders',
  'mlsP1LegalChronology', 'mlsP1LegalDrop', 'mlsP1LegalFile',
  'mlsP1LegalSources', 'mlsP1LegalDoi', 'mlsP1LegalQuestions',
  'mlsP1LegalGenerate', 'mlsP1LegalCancel', 'mlsP1LegalStatus',
  'mlsP1LegalDraftCopy', 'mlsP1LegalDraftDownload', 'mlsP1LegalDraftPrint',
  'mlsP1LegalDraft',
  /* p1-legal-letterhead-1.0.0 */
  'mlsP1LegalLetterheadEmail', 'mlsP1LegalLetterheadPreview'
];
function installUi(runtime) {
  for (const id of UI_IDS) {
    const tag = id === 'mlsP1LegalDraft' || id === 'mlsP1LegalQuestions'
      ? 'textarea' : (id === 'mlsP1LegalFile' || id === 'mlsP1LegalDoi' || id === 'mlsP1LegalLetterheadEmail' ? 'input' : 'div');
    runtime.ids[id] = node(tag);
    runtime.ids[id].id = id;
    runtime.ids[id]._document = runtime.document;
  }
}

/* Preview-only bootstrap and reversible public surface. */
{
  const r = makeRuntime();
  ok(r.api && r.api.installed, '1p marker did not install the isolated workspace');
  eq(r.api.version, 'p1-legal-1.0.0', 'workspace version drifted');
  eq(r.api.installToken, 'synthetic-legal-install', 'workspace did not publish its exact loader ownership token');
  /* p1-legal-letterhead-1.0.0 added XIV. OPINIONS as the 14th AI section. The
     XV. ATTESTATION block is written locally and is NOT an AI section. */
  eq(r.api.sections.length, 14, 'draft does not have exactly 14 fixed sections (13 chronology + XIV. OPINIONS)');
  /* p1-legal-flow-2.0.0 added the flow receipt (stage / reportType / reading).
     A closed workspace must report the unbound start of that flow. */
  deep(r.api.state(), { open: false, patientBound: false, generating: false, sourceCount: 0,
    pendingFileCount: 0, activeReaderCount: 0, sectionCount: 14,
    stage: 'unbound', reportType: '', reading: '' }, 'initial receipt is not PHI-free and closed');
  r.api.revert();
  eq(r.window.__mlsP1LegalPack, undefined, 'revert left the workspace API installed');
}
/* A saved API object becomes inert after revert. It cannot reopen or tear down
   a newer same-version owner that later takes the canonical global slot. */
{
  const r = makeRuntime();
  const oldApi = r.api;
  eq(oldApi.revert(), true, 'current API did not acknowledge its first revert');
  const newOwner = { installed: true, version: 'p1-legal-1.0.0', installToken: 'new-owner-token' };
  const newRoot = node('div'), newStyle = node('style');
  newRoot.id = 'mlsP1LegalRoot'; newStyle.id = 'mlsP1LegalStyle';
  r.document.body.appendChild(newRoot); r.document.head.appendChild(newStyle);
  r.window.__mlsP1LegalPack = newOwner;
  eq(oldApi.open(), false, 'saved reverted API reopened an orphan workspace');
  eq(oldApi.revert(), false, 'saved reverted API ran destructive cleanup twice');
  eq(r.window.__mlsP1LegalPack, newOwner, 'saved reverted API deleted a newer owner');
  eq(r.document.getElementById('mlsP1LegalRoot'), newRoot, 'saved reverted API removed the newer root');
  eq(r.document.getElementById('mlsP1LegalStyle'), newStyle, 'saved reverted API removed the newer style');
}
{
  const r = makeRuntime({ search: '?tool=legal' });
  eq(r.clock.count(), 1, 'query route did not schedule exactly one deferred open');
  r.api.revert();
  eq(r.clock.count(), 0, 'revert did not cancel the deferred query auto-open');
  r.clock.tick(1);
  eq(r.document.getElementById('mlsP1LegalRoot'), null, 'revert-before-tick reopened an orphaned workspace');
  eq(r.window.__mlsP1LegalPack, undefined, 'revert-before-tick restored the deleted API');
}
{
  const context = { window: {}, document: {}, console };
  vm.createContext(context); vm.runInContext(source, context);
  eq(context.window.__mlsP1LegalPack, undefined, 'asset installed outside the 1p preview marker');
}
{
  let listeners = 0, timers = 0;
  const context = {
    window: { __MLS_P1_PREVIEW: { enabled: true }, __mlsP1LegalLoader: {
      installed: false, version: 'p1-legal-1.0.0', state: 'reverted', installToken: 'late-token'
    }, addEventListener() { listeners++; } },
    document: {
      currentScript: { getAttribute(name) { return name === 'data-mls-install-token' ? 'late-token' : (name === 'data-mls-asset' ? 'feat_mls_legalpack.js' : null); } },
      getElementById() { return null; }
    },
    setTimeout() { timers++; }, console
  };
  vm.createContext(context); vm.runInContext(source, context);
  eq(context.window.__mlsP1LegalPack, undefined, 'real asset installed after loader revert');
  eq(listeners, 0, 'real asset bound listeners after loader revert');
  eq(timers, 0, 'real asset scheduled work after loader revert');
}
{
  const context = {
    window: { __MLS_P1_PREVIEW: { enabled: true }, __mlsP1LegalLoader: {
      installed: true, version: 'p1-legal-1.0.0', state: 'loading', installToken: 'current-token'
    } },
    document: { currentScript: { getAttribute(name) { return name === 'data-mls-install-token' ? 'stale-token' : (name === 'data-mls-asset' ? 'feat_mls_legalpack.js' : null); } } }, console
  };
  vm.createContext(context); vm.runInContext(source, context);
  eq(context.window.__mlsP1LegalPack, undefined, 'real asset installed from a stale loader token');
}

/* The existing patient-level held button is adopted only for clinical users,
   survives the shell's More-menu reset, and reverts byte-for-byte without
   deleting an existing listener. */
{
  let oldClicks = 0;
  const r = makeRuntime({ door: true, user: { role: 'user' }, doorListener: () => { oldClicks++; } });
  installUi(r);
  const button = r.ids.ptLawyerBtn, originalToggle = r.originalTogglePtMore;
  eq(button.hidden, false, 'clinical Legal door remained hidden');
  eq(button.disabled, false, 'clinical Legal door remained disabled');
  ok(/Free preview/.test(button.textContent), 'clinical Legal door does not say Free preview');
  eq(button.getAttribute('data-mls-p1-legal-door'), 'p1-legal-1.0.0', 'clinical Legal door lacks canonical ownership');
  const wrappedToggle = r.window.togglePtMore;
  ok(wrappedToggle !== originalToggle, 'togglePtMore was not wrapped for 1p door reassertion');
  eq(wrappedToggle(), 'original-result', 'door wrapper changed togglePtMore return value');
  eq(button.style.display, '', 'togglePtMore re-hid the eligible clinical door');
  eq(button.getAttribute('aria-hidden'), null, 'togglePtMore left the eligible clinical door aria-hidden');
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  eq(oldClicks, 1, 'adopting the door deleted its prior click listener');
  eq(r.api.state().open, true, 'clinical patient-level door did not open the workspace');
  ok(r.api.chronologyText().includes('Synthetic Alpha'), 'door did not bind the exact active patient');
  r.api.revert();
  eq(button.hidden, true, 'revert did not restore hidden');
  eq(button.disabled, true, 'revert did not restore disabled');
  eq(button.getAttribute('aria-disabled'), 'true', 'revert did not restore aria-disabled');
  eq(button.getAttribute('style'), 'display:none;margin-left:8px', 'revert did not restore exact style');
  eq(button.getAttribute('title'), 'Networked legal intake is not released', 'revert did not restore title');
  eq(button.textContent, 'Legal workspace unavailable', 'revert did not restore original text');
  eq(button.getAttribute('data-mls-p1-legal-door'), null, 'revert left 1p door ownership behind');
  eq(r.window.togglePtMore, originalToggle, 'revert did not restore exact togglePtMore function');
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  eq(oldClicks, 2, 'revert deleted the button\'s pre-existing click listener');
}
{
  const r = makeRuntime({ door: true, user: { role: 'receptionist' } });
  installUi(r); const button = r.ids.ptLawyerBtn;
  eq(button.hidden, true, 'receptionist was shown the clinical Legal door');
  eq(button.disabled, true, 'receptionist Legal door became enabled');
  eq(button.getAttribute('data-mls-p1-legal-door'), null, 'receptionist door was adopted');
  eq(r.api.open(), false, 'receptionist bypassed the door through the API');
  eq(r.api.state().open, false, 'receptionist workspace opened');
  r.window.togglePtMore();
  eq(button.style.display, 'none', 'toggle reassert exposed the receptionist door');
}
{
  const r = makeRuntime({ door: true, user: { role: 'lawyer' } });
  installUi(r);
  eq(r.api.open(), false, 'lawyer role opened the clinician-only free preview');
  eq(r.ids.ptLawyerBtn.hidden, true, 'lawyer role was shown the clinician patient-level door');
}
{
  const r = makeRuntime({ door: true, user: null, search: '?tool=legal' });
  installUi(r); r.clock.tick(0);
  eq(r.api.state().open, false, 'query opened before a clinical session existed');
  eq(r.ids.ptLawyerBtn.hidden, true, 'query exposed the door before role resolution');
  r.window.bkUser = { role: 'doctor' };
  r.fire('mls:session-boundary', { nextAccount: 'synthetic@example.invalid' });
  eq(r.ids.ptLawyerBtn.hidden, false, 'clinical session did not reveal the free preview door');
  eq(r.api.state().open, false, 'session boundary consumed query against the pre-boundary patient');
  r.switchPatient('B');
  eq(r.api.state().open, true, 'pending query CTA did not open after exact clinical patient readiness');
  ok(r.api.chronologyText().includes('Synthetic Beta'), 'pending query CTA opened for the wrong patient');
}
{
  const r = makeRuntime({ door: true, user: undefined, search: '?tool=legal' });
  installUi(r); r.clock.tick(0);
  eq(r.api.state().open, false, 'unresolved role + active patient exposed query PHI');
  eq(r.api.open(), false, 'manual API opened while role was unresolved');
  eq(r.ids.ptLawyerBtn.hidden, true, 'unresolved role exposed the patient-level door');
  r.window.bkUser = { role: 'doctor' };
  r.fire('mls:session-boundary');
  eq(r.api.state().open, false, 'unresolved pending query opened on session boundary before patient rebinding');
  r.switchPatient('B');
  eq(r.api.state().open, true, 'eligible session did not consume the safely pending query');
}
/* Exact binding and executed read-only chronology. */
{
  const r = makeRuntime();
  const binding = Object.freeze({ patientId: 'A', patientEpoch: 1, name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A' });
  const snapshot = JSON.parse(JSON.stringify(r.window.activePatient()));
  const model = r.api.buildModel(snapshot, binding);
  eq(model.binding.patientId, 'A', 'model lost its exact patient binding');
  ok(model.items.length >= 7, 'chronology omitted documented categories');
  ok(model.items.some(row => row.category === 'imaging'), 'documented imaging was not classified');
  ok(model.items.some(row => row.category === 'procedure') === false, 'visit mention invented a procedure row');
  ok(model.items.some(row => row.category === 'outside'), 'outside record was not classified');
  ok(model.items.some(row => row.category === 'followup'), 'documented follow-up was not classified');
  ok(!r.api.buildModel({ id: 'A', visits: [{ patientId: 'B', type: 'Foreign visit marker' }] }, binding).items.some(row => row.title === 'Foreign visit marker'), 'foreign-patient row crossed the exact binding');
  eq(r.api.buildModel({ id: 'B' }, binding).items.length, 0, 'model accepted a patient different from its binding');
  eq(r.api.bindingCurrent(binding), true, 'current exact binding was refused');
  r.switchPatient('B');
  eq(r.api.bindingCurrent(binding), false, 'patient switch left old binding current');
}

/* Browser-local file policy: text resolves; image OCR is explicitly refused;
   no generic universal reader or network helper exists in the module. */
(async function runAsync() {
  /* Session privilege is part of every async owner. Losing clinical access
     closes immediately and aborts both AI and local parsing; late results are inert. */
  {
    const r = makeRuntime({ door: true, user: { role: 'doctor' } }); installUi(r); r.api.open();
    const promise = r.api.generateDraft(); await flush();
    const request = r.pendingAi[0];
    r.window.bkUser = { role: 'receptionist' };
    r.fire('mls:session-boundary');
    eq(r.api.state().open, false, 'receptionist session boundary left prior clinical workspace visible');
    eq(r.api.state().patientBound, false, 'receptionist session boundary retained patient binding');
    eq(request.opts.signal.aborted, true, 'receptionist session boundary did not abort AI');
    eq(r.ids.ptLawyerBtn.hidden, true, 'receptionist session boundary left door visible');
    request.resolve('late role-boundary text');
    eq(await promise, false, 'late AI after receptionist boundary reported success');
    eq(r.ids.mlsP1LegalDraft.value, '', 'late AI after receptionist boundary painted PHI');
  }
  {
    const r = makeRuntime({ door: true, user: { role: 'doctor' } }); installUi(r); r.api.open();
    let resolveFile;
    r.api.addFiles([{ name: 'role-boundary.txt', type: 'text/plain', size: 10,
      text: () => new Promise(resolve => { resolveFile = resolve; }) }]);
    r.window.bkUser = undefined;
    r.fire('mls:session-boundary');
    eq(r.api.state().open, false, 'unresolved session boundary left prior clinical workspace visible');
    deep({ pending: r.api.state().pendingFileCount, active: r.api.state().activeReaderCount }, { pending: 0, active: 0 }, 'unresolved session boundary left local parser owned');
    resolveFile('late parser PHI'); await flush();
    eq(r.api.state().sourceCount, 0, 'late parser after unresolved role boundary landed PHI');
  }
  {
    const r = makeRuntime({ door: true, user: { role: 'doctor', email: 'doctor-a@example.invalid' } }); installUi(r); r.api.open();
    r.api.addFiles([{ name: 'account-a.txt', type: 'text/plain', size: 10,
      text: () => Promise.resolve('Synthetic account A local context.') }]);
    await flush();
    eq(r.api.state().sourceCount, 1, 'doctor-A fixture did not stage a source');
    const promise = r.api.generateDraft(); await flush(); const request = r.pendingAi[0];
    r.window.bkUser = { role: 'doctor', email: 'doctor-b@example.invalid' };
    r.fire('mls:session-boundary', { previousAccount: 'doctor-a@example.invalid', nextAccount: 'doctor-b@example.invalid' });
    deep({ open: r.api.state().open, bound: r.api.state().patientBound, sources: r.api.state().sourceCount },
      { open: false, bound: false, sources: 0 }, 'doctor-to-doctor account boundary retained account-A workspace/PHI');
    eq(request.opts.signal.aborted, true, 'doctor-to-doctor account boundary did not abort account-A AI');
    request.resolve('late account-A draft');
    eq(await promise, false, 'late account-A run reported success after doctor-to-doctor switch');
    eq(r.api.state().open, false, 'doctor-to-doctor boundary auto-reopened on the old active patient');
    eq(r.ids.mlsP1LegalDraft.value, '', 'late account-A result painted after doctor-to-doctor switch');
  }

  {
    const r = makeRuntime();
    eq(await r.api.readLocalFile({ name: 'record.txt', type: 'text/plain', text: () => Promise.resolve('local only') }), 'local only', 'local text file did not read');
    eq(r.visionRequests.length, 0, 'local text was sent to OCR');
    eq(await r.api.readLocalFile({ name: 'scan.png', type: 'image/png', size: 100 }), 'Synthetic OCR text.', 'selected image did not use AI OCR');
    eq(r.visionRequests.length, 1, 'selected image made other than one OCR request');
    eq(r.visionRequests[0].url, 'https://synthetic.invalid/api/vision', 'image OCR left the exact authenticated endpoint');
    eq(r.visionRequests[0].init.headers.Authorization, 'Bearer synthetic-ocr-token', 'image OCR omitted the signed-in bearer token');
    const body = JSON.parse(r.visionRequests[0].init.body);
    eq(body.mimetype, 'image/png', 'image OCR omitted the selected image MIME type');
    ok(/^data:image\/png;base64,/.test(body.image), 'image OCR did not send an image data URL');
    await assert.rejects(() => r.api.readLocalFile({ name: 'oversize.txt', type: 'text/plain', size: 21 * 1024 * 1024, text: () => Promise.resolve('never read') }), /20 MB preview limit/i);
    checks++;
  }
  {
    const r = makeRuntime({ visionText: '' });
    await assert.rejects(() => r.api.readLocalFile({ name: 'empty-scan.jpg', type: 'image/jpeg', size: 100 }), /could not extract text/i);
    checks++;
    ok(!/no readable text/i.test(source), 'Legal workspace restored the misleading no-readable-text dead end');
  }
  {
    const r = makeRuntime();
    const pages = [
      { getTextContent: async () => ({ items: [{ str: 'Page one has a documented treatment note with enough searchable text.' }] }), cleanup() {} },
      { getTextContent: async () => ({ items: [] }), getViewport: () => ({ width: 900, height: 1200 }),
        render: () => ({ promise: Promise.resolve() }), cleanup() {} }
    ];
    r.window.loadPdfJsOnDemand = async () => ({
      getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: async n => pages[n - 1] }), destroy: async () => {} })
    });
    const text = await r.api.readLocalFile({ name: 'mixed.pdf', type: 'application/pdf', size: 500, arrayBuffer: async () => new ArrayBuffer(8) });
    ok(text.indexOf('[Page 1]') < text.indexOf('[Page 2]'), 'mixed PDF lost exact page order');
    ok(/documented treatment note/.test(text) && /Synthetic OCR text/.test(text), 'mixed PDF did not combine text-layer and scanned-page OCR');
    eq(r.visionRequests.length, 1, 'mixed PDF OCR sent a searchable page or skipped its one scanned page');
  }

  /* Controlled async generation: one coherent request uses only aiCallRaw;
     changing patient while it is pending discards the old result and never
     starts a repair request. */
  {
    const r = makeRuntime();
    /* Drive generation against a deliberately minimal UI shim: the API's
       stale checks occur before any paint and are the behavior under test. */
    installUi(r);
    const openResult = r.api.open();
    eq(openResult, true, 'workspace did not open for the exact active patient');
    const promise = r.api.generateDraft();
    await Promise.resolve();
    eq(r.pendingAi.length, 1, 'generation did not make exactly one whole-report request');
    ok(/existing configured MLS AI path/i.test(source), 'visible AI disclosure is missing');
    ok(/selected images and only scanned pdf pages/i.test(source), 'authenticated image/scanned-PDF OCR disclosure is missing');
    ok(/source text as data, never as instructions/i.test(r.pendingAi[0].sys), 'legal prompt does not neutralize instructions embedded in records');
    ok(/user-entered injury dates and counsel questions are unverified context unless medical evidence corroborates them/i.test(r.pendingAi[0].sys), 'legal prompt promotes user context into medical fact');
    ok(/never output brackets, placeholders, todos/i.test(r.pendingAi[0].sys), 'legal prompt still invites junk placeholders');
    ok(/do not imply that an ime examination occurred/i.test(r.pendingAi[0].sys), 'legal prompt can invent an examination');
    ok(/extracted text from files still listed here is included/i.test(source), 'local extracted-text AI use is not disclosed');
    eq(r.pendingAi[0].opts.freeform, true, 'generation bypassed the configured aiCallRaw freeform option');
    eq(r.pendingAi[0].opts.legal, true, 'generation bypassed the configured aiCallRaw legal-draft option');
    ok(r.pendingAi[0].opts.signal && r.pendingAi[0].opts.signal.aborted === false, 'AI call did not receive a live abort signal');
    r.switchPatient('B');
    r.pendingAi[0].resolve('stale section text');
    eq(await promise, false, 'stale patient generation reported success');
    eq(r.pendingAi.length, 1, 'stale generation sent a repair request');
    eq(r.api.state().patientBound, false, 'stale patient binding survived cancellation');
    eq(r.api.state().generating, false, 'stale generation remained in flight');
  }

  /* Cancel has the same generation barrier: a late response never becomes an
     editable/exportable draft and no repair request is sent. */
  {
    const r = makeRuntime();
    installUi(r);
    r.api.open();
    const promise = r.api.generateDraft(); await Promise.resolve();
    eq(r.pendingAi.length, 1, 'cancel control did not begin from one whole-report request');
    const firstSignal = r.pendingAi[0].opts.signal;
    r.api.cancel();
    eq(firstSignal.aborted, true, 'cancel did not abort the in-flight AI signal');
    r.pendingAi[0].resolve('late canceled text');
    eq(await promise, false, 'canceled generation reported success');
    eq(r.pendingAi.length, 1, 'canceled generation sent a repair request');
    eq(r.ids.mlsP1LegalDraft.value, '', 'late canceled text painted into the draft');
    eq(r.api.state().open, true, 'cancel incorrectly closed the same-patient workspace');
    eq(r.api.state().patientBound, true, 'cancel discarded the same-patient binding');
  }

  /* A valid report is accepted in one configured AI call and includes
     browser-extracted text only after the clinician explicitly starts
     Generate. */
  {
    const r = makeRuntime();
    installUi(r);
    r.api.open();
    r.ids.mlsP1LegalFile.files = [{ name: 'synthetic-record.txt', type: 'text/plain', size: 42,
      text: () => Promise.resolve('Synthetic local record marker.') }];
    r.ids.mlsP1LegalFile.listeners.change();
    await Promise.resolve(); await Promise.resolve();
    eq(r.pendingAi.length, 0, 'reading a local file sent it to AI before Generate');
    eq(r.api.state().sourceCount, 1, 'browser-local record was not staged');
    const promise = r.api.generateDraft();
    const request = await waitForAi(r, 1);
    ok(request.user.includes('Synthetic local record marker.'), 'configured AI context omitted explicitly staged local text');
    request.resolve(wholeReportResponse(request));
    eq(await promise, true, 'complete 14-section generation did not report success');
    eq(r.pendingAi.length, 1, 'a valid coherent report made other than one configured AI call');
    eq((r.ids.mlsP1LegalDraft.value.match(/^I{0,3}V?I{0,3}\.|^IX\.|^X(?:I{0,3})?\./gm) || []).length, 13, 'completed editable draft omitted a fixed section heading');
    ok(/^XIV\. OPINIONS$/m.test(r.ids.mlsP1LegalDraft.value), 'completed draft omitted the XIV. OPINIONS section');
    ok(/^XV\. ATTESTATION$/m.test(r.ids.mlsP1LegalDraft.value), 'completed draft omitted the XV. ATTESTATION block');
    ok(r.ids.mlsP1LegalDraft.value.includes('UNSIGNED DRAFT'), 'completed output omitted its unsigned-draft warning');
    eq(r.clock.count(), 0, 'successful generation left deadline timers alive');
  }

  /* Arbitrary prose is never painted as a partial section. It causes one
     explicit structured-report repair, and a valid correction can then land
     as the sole complete draft. */
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const promise = r.api.generateDraft();
    const first = await waitForAi(r, 1);
    first.resolve('Arbitrary unstructured legal prose must not be accepted.');
    const repair = await waitForAi(r, 2);
    ok(/prior response was rejected/i.test(repair.sys), 'arbitrary prose did not produce an explicit repair prompt');
    ok(/not valid structured JSON/i.test(repair.sys), 'repair prompt did not name the structured-JSON failure');
    eq(r.ids.mlsP1LegalDraft.value, '', 'invalid first response painted a partial draft before repair');
    repair.resolve(wholeReportResponse(repair));
    eq(await promise, true, 'a valid one-time repair did not complete the report');
    eq(r.pendingAi.length, 2, 'arbitrary prose caused other than one bounded repair request');
  }

  /* Evidence and section-order validation are fail closed. An unknown ID gets
     the one repair opportunity; a wrong-order correction then stops visibly,
     exports nothing, and never exposes either invalid response. */
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const promise = r.api.generateDraft();
    const first = await waitForAi(r, 1);
    first.resolve(wholeReportResponse(first, report => {
      report.sections[0].paragraphs[0].evidenceIds = ['E999'];
    }));
    const repair = await waitForAi(r, 2);
    ok(/unknown evidence ID: E999/i.test(repair.sys), 'unknown evidence ID did not reach the bounded repair prompt');
    repair.resolve(wholeReportResponse(repair, report => {
      const firstSection = report.sections[0];
      report.sections[0] = report.sections[1];
      report.sections[1] = firstSection;
    }));
    eq(await promise, false, 'a wrong-order second response reported success');
    eq(r.pendingAi.length, 2, 'a second invalid response triggered an unbounded third attempt');
    eq(r.ids.mlsP1LegalDraft.value, '', 'a failed corrected response left a partial draft');
    ok(r.api.state().stage !== 'generated' && r.api.state().stage !== 'exported', 'a failed corrected response advanced to an exportable stage');
    ok(/corrected report still failed its evidence check/i.test(r.ids.mlsP1LegalStatus.textContent), 'second validation failure was not shown to the clinician');
    ok(/No partial draft was exported/i.test(r.ids.mlsP1LegalStatus.textContent), 'second validation failure did not disclose the no-partial boundary');
    eq(r.api.state().generating, false, 'second validation failure left generation running');
  }

  /* Cancel owns only its exact run. A replacement run may start immediately;
     the old Promise and its late transport result cannot clear or repaint it. */
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const oldPromise = r.api.generateDraft(); await flush();
    const oldRequest = r.pendingAi[0];
    r.api.cancel();
    const newPromise = r.api.generateDraft(); await flush();
    eq(r.pendingAi.length, 2, 'replacement run did not start after cancel');
    const currentStatus = r.ids.mlsP1LegalStatus.textContent;
    oldRequest.resolve('late old-run result');
    eq(await oldPromise, false, 'canceled old run reported success');
    eq(r.api.state().generating, true, 'old run settlement cleared replacement generating state');
    eq(r.ids.mlsP1LegalStatus.textContent, currentStatus, 'old run settlement overwrote replacement status');
    eq(r.ids.mlsP1LegalDraft.value, '', 'old run settlement painted a draft');
    r.api.cancel(); eq(await newPromise, false, 'replacement cancel did not settle');
    eq(r.clock.count(), 0, 'cancel/restart left deadline timers alive');
  }

  /* Close/reopen and patient-switch/reopen are independent lifetime barriers. */
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const oldPromise = r.api.generateDraft(); await flush(); const oldRequest = r.pendingAi[0];
    r.api.close(); eq(oldRequest.opts.signal.aborted, true, 'close did not abort the old AI signal');
    r.api.open(); const reopenedStatus = r.ids.mlsP1LegalStatus.textContent;
    oldRequest.resolve('late after close'); eq(await oldPromise, false, 'closed old run reported success');
    eq(r.api.state().open, true, 'old close-run settlement closed the reopened workspace');
    eq(r.ids.mlsP1LegalStatus.textContent, reopenedStatus, 'old close-run settlement repainted the reopened workspace');
  }
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const oldPromise = r.api.generateDraft(); await flush(); const oldRequest = r.pendingAi[0];
    r.switchPatient('B'); eq(oldRequest.opts.signal.aborted, true, 'patient switch did not abort the old AI signal');
    r.api.open(); const reopenedStatus = r.ids.mlsP1LegalStatus.textContent;
    oldRequest.resolve('late patient-A text'); eq(await oldPromise, false, 'switched-patient old run reported success');
    eq(r.api.state().open, true, 'old patient settlement closed patient B workspace');
    eq(r.api.state().patientBound, true, 'old patient settlement cleared patient B binding');
    eq(r.ids.mlsP1LegalStatus.textContent, reopenedStatus, 'old patient settlement repainted patient B status');
  }
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const promise = r.api.generateDraft(); await flush();
    r.switchPatientSilently('B'); r.pendingAi[0].resolve('late after missed event');
    eq(await promise, false, 'silent active-patient mismatch reported success');
    deep({ open: r.api.state().open, bound: r.api.state().patientBound, generating: r.api.state().generating },
      { open: false, bound: false, generating: false }, 'run boundary did not fail closed when the patient event was missed');
  }

  /* Local parser ownership is separate from AI-run ownership. Pending readers
     are visible and block Generate; deadlines/cancel discard every late read. */
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    let resolveFile;
    eq(r.api.addFiles([{ name: 'pending.txt', type: 'text/plain', size: 20,
      text: () => new Promise(resolve => { resolveFile = resolve; }) }]), 1, 'pending local file was not accepted');
    deep({ pending: r.api.state().pendingFileCount, active: r.api.state().activeReaderCount }, { pending: 1, active: 1 }, 'pending reader receipt is wrong');
    eq(await r.api.generateDraft(), false, 'Generate ran while a local parser was pending');
    eq(r.pendingAi.length, 0, 'pending-parser Generate refusal sent chart context');
    resolveFile('Parser result survives because Generate was refused.'); await flush();
    deep({ pending: r.api.state().pendingFileCount, sources: r.api.state().sourceCount }, { pending: 0, sources: 1 }, 'settled local parser did not land once');
  }
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    let resolveLate;
    r.api.addFiles([{ name: 'hung.txt', type: 'text/plain', size: 20,
      text: () => new Promise(resolve => { resolveLate = resolve; }) }]);
    r.clock.tick(3 * 60 * 1000); await flush();
    deep({ pending: r.api.state().pendingFileCount, active: r.api.state().activeReaderCount, sources: r.api.state().sourceCount },
      { pending: 0, active: 0, sources: 1 }, 'hung parser did not settle visibly at its deadline');
    ok(/three-minute limit/i.test(r.ids.mlsP1LegalStatus.textContent), 'parser/OCR deadline was not disclosed');
    resolveLate('too late'); await flush();
    eq(r.api.state().sourceCount, 1, 'late timed-out parser landed twice');
    eq(r.clock.count(), 0, 'parser deadline left a timer alive');
  }
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const files = Array.from({ length: 10 }, (_, i) => ({ name: 'queued-' + i + '.txt', type: 'text/plain', size: 1,
      text: () => new Promise(() => {}) }));
    eq(r.api.addFiles(files), 8, 'local file-count cap did not accept exactly eight');
    deep({ pending: r.api.state().pendingFileCount, active: r.api.state().activeReaderCount }, { pending: 8, active: 2 }, 'reader concurrency was not capped at two');
    r.api.close();
    deep({ pending: r.api.state().pendingFileCount, active: r.api.state().activeReaderCount }, { pending: 0, active: 0 }, 'close did not cancel all local readers');
    eq(r.clock.count(), 0, 'close left local parser deadlines alive');
  }
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const tenMb = 10 * 1024 * 1024;
    const files = Array.from({ length: 6 }, (_, i) => ({ name: 'aggregate-' + i + '.txt', type: 'text/plain', size: tenMb,
      text: () => new Promise(() => {}) }));
    eq(r.api.addFiles(files), 5, '50 MB aggregate cap accepted the wrong file count');
    eq(r.api.state().pendingFileCount, 5, 'aggregate-cap refusal did not keep exact accepted tasks');
    ok(/50 MB combined preview limit/i.test(r.ids.mlsP1LegalStatus.textContent), 'aggregate cap was not disclosed');
    r.api.close();
  }

  /* The whole-report transport deadline settles and aborts. */
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const promise = r.api.generateDraft(); await flush(); const signal = r.pendingAi[0].opts.signal;
    r.clock.tick(3 * 60 * 1000); await flush();
    eq(await promise, false, 'whole-report AI deadline did not settle the run');
    eq(signal.aborted, true, 'whole-report AI deadline did not abort its signal');
    eq(r.api.state().generating, false, 'whole-report timeout left generating true');
    eq(r.clock.count(), 0, 'whole-report timeout left deadline timers alive');
  }

  /* Dialog focus stays contained, Escape closes, and focus returns exactly to
     the patient-level invoker. Native buttons provide keyboard semantics. */
  {
    const r = makeRuntime(); installUi(r);
    const opener = node('button'); opener._document = r.document; opener.focus();
    r.api.open();
    eq(r.document.activeElement, r.ids.mlsP1LegalClose, 'dialog did not focus its close control on open');
    const rootDialog = r.document.getElementById('mlsP1LegalRoot');
    eq(rootDialog.attributes.role, 'dialog', 'workspace root is not a dialog');
    eq(rootDialog.attributes['aria-modal'], 'true', 'workspace dialog is not modal');
    const last = r.ids.mlsP1LegalDraft; rootDialog.querySelectorAll = () => [r.ids.mlsP1LegalClose, last]; last.focus();
    let prevented = false;
    rootDialog.listeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
    eq(prevented, true, 'Tab at the end was not contained');
    eq(r.document.activeElement, r.ids.mlsP1LegalClose, 'Tab did not wrap to first dialog control');
    rootDialog.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    eq(r.api.state().open, false, 'Escape did not close the workspace');
    eq(r.document.activeElement, opener, 'close did not restore focus to the invoker');
  }

  /* If compiled source context exceeds the AI cap, the clinician—not just the
     model—gets a persistent receipt in both the editable draft and live status. */
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    for (let i = 0; i < 2; i++) {
      r.api.addFiles([{ name: 'long-' + i + '.txt', type: 'text/plain', size: 100,
        text: () => Promise.resolve(String(i).repeat(60000)) }]);
      await flush();
    }
    const promise = r.api.generateDraft();
    const request = await waitForAi(r, 1);
    request.resolve(wholeReportResponse(request));
    eq(await promise, true, 'limited-context draft did not complete');
    ok(/IMPORTANT SOURCE-LIMIT NOTICE/.test(r.ids.mlsP1LegalDraft.value), 'editable draft omitted source-limit receipt');
    ok(/SOURCE-LIMIT WARNING/.test(r.ids.mlsP1LegalStatus.textContent), 'clinician-visible status omitted source-limit warning');
    eq(r.ids.mlsP1LegalStatus.style.color, '#9a3d29', 'source-limit warning was not styled as a warning');
  }

  /* p1-legal-letterhead-1.0.0 END TO END: a report that leaves the practice
     must carry the practice letterhead and state its certainty standard, and
     must state each EXACTLY ONCE - a duplicated attestation reads as two
     different opinions of record. Every export (the editable textarea, Copy,
     Download .txt and Print) reads that same string, so proving it on the
     textarea proves it on all four. */
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const LH = { practice: 'Synthetic Spine & Pain Institute', provider: 'Alex Synthetic',
      cred: 'MD', npi: '1234567890', address: '10 Synthetic Way, Suite 3, Testville PA 19000',
      phone: '(610) 555-0100', email: 'records@synthetic-spine.example' };
    r.window.getPracticeName = () => LH.practice;
    r.window.getProviderName = () => LH.provider;
    r.window.getProviderCred = () => LH.cred;
    r.window.getNpi = () => LH.npi;
    r.window.getClinicAddress = () => LH.address;
    r.window.getClinicPhone = () => LH.phone;
    /* the ONE field Settings has no home for, typed into the workspace */
    r.ids.mlsP1LegalLetterheadEmail.value = LH.email;
    /* the account display name must never be able to stand in for the
       clinical provider identity on a medical-legal document */
    r.window.getName = () => 'signup-account-display-name';

    const promise = r.api.generateDraft();
    const request = await waitForAi(r, 1);
    request.resolve(wholeReportResponse(request));
    eq(await promise, true, 'letterhead draft did not complete');
    const report = r.ids.mlsP1LegalDraft.value;
    function count(needle) { return report.split(needle).length - 1; }

    /* the letterhead is FIRST, before the draft banner */
    ok(report.indexOf(LH.practice) === 0, 'the practice letterhead is not the first thing on the report');
    ok(report.indexOf(LH.practice) < report.indexOf('MEDICAL-LEGAL / IME WORKSPACE DRAFT'),
      'the letterhead does not precede the draft banner');
    eq(count(LH.address), 1, 'the practice address appears ' + count(LH.address) + ' times, not once');
    eq(count(LH.phone), 1, 'the practice phone appears ' + count(LH.phone) + ' times, not once');
    eq(count(LH.email), 1, 'the letterhead email appears ' + count(LH.email) + ' times, not once');
    eq(count('NPI ' + LH.npi), 1, 'the NPI appears ' + count('NPI ' + LH.npi) + ' times, not once');
    /* provider + credentials print twice BY DESIGN: masthead and signature */
    eq(count(LH.provider + ', ' + LH.cred), 2,
      'the provider name and credentials must appear exactly twice - the masthead and the signature line');
    eq(count(LH.practice), 2, 'the practice name must appear exactly twice - the masthead and the signature block');
    eq(count('signup-account-display-name'), 0,
      'the login/account display name reached a medical-legal document');

    /* the certainty standard, stated exactly once by the local attestation */
    eq(count(r.api.certaintyStandard), 1,
      'the certainty standard appears ' + count(r.api.certaintyStandard) + ' times, not exactly once');
    eq(r.api.certaintyStandard, 'to a reasonable degree of medical certainty', 'the certainty standard drifted');
    ok(/^XV\. ATTESTATION$/m.test(report), 'the report has no attestation section');
    eq(count('Signature: ______'), 1, 'the report does not carry exactly one signature line');
    ok(/subject to revision if additional/.test(report),
      'the attestation does not say the opinions may change if more records arrive');
    ok(/rest solely on the records and findings specifically identified above/.test(report),
      'the attestation does not limit opinions to identified evidence');
    ok(/does not represent that an independent examination occurred unless/.test(report),
      'the attestation falsely implies an examination occurred');
    ok(/UNSIGNED DRAFT/.test(report), 'the attestation lost the unsigned-draft framing');

    /* the OPINIONS prompt demands the standard AND a per-opinion basis */
    const opinionCall = r.pendingAi[0];
    ok(/XIV\. OPINIONS/.test(opinionCall.sys), 'the coherent report prompt omitted the OPINIONS section contract');
    ok(opinionCall.sys.includes('to a reasonable degree of medical certainty'),
      'the OPINIONS prompt does not require the certainty standard');
    ok(/single-line .*Basis:/.test(opinionCall.sys), 'the OPINIONS prompt does not require a one-line basis per opinion');
    ok(/Undeterminable on the record reviewed/.test(opinionCall.sys),
      'the OPINIONS prompt does not force an undeterminable verdict instead of an unsupported opinion');
    ok(/Never state a certainty for a fact that is bracketed or undocumented/.test(opinionCall.sys),
      'the OPINIONS prompt does not forbid certainty over undocumented facts');

    /* every export path reads this exact string */
    eq(r.api.letterheadBlock().split('\n')[0], LH.practice, 'the exported letterhead block does not lead with the practice');
    ok(r.api.attestationBlock().includes(r.api.certaintyStandard), 'the exported attestation lost the certainty standard');
    /* and the export the doctor actually presses carries it verbatim */
    const copied = [];
    r.window.navigator.clipboard.writeText = value => { copied.push(String(value)); return Promise.resolve(); };
    r.ids.mlsP1LegalDraftCopy.listeners.click();
    await flush();
    eq(copied.length, 1, 'Copy did not export the draft');
    eq(copied[0], report, 'the exported draft is not the report the clinician saw');
    eq(copied[0].split(r.api.certaintyStandard).length - 1, 1,
      'the exported draft does not state the certainty standard exactly once');
    ok(copied[0].indexOf(LH.practice) === 0, 'the exported draft does not lead with the practice letterhead');
  }

  /* Records-only and chronology outputs are compilations, not examinations or
     opinion reports. Their deterministic closing must never manufacture either. */
  for (const key of ['records', 'chronology']) {
    const r = makeRuntime(); installUi(r); r.api.open();
    eq(r.api.pickReport(key), true, key + ' report type was not selectable');
    const attestation = r.api.attestationBlock();
    ok(/^SOURCE ATTESTATION/m.test(attestation), key + ' output did not use the source-only attestation');
    ok(/states no independent medical-legal opinions/i.test(attestation), key + ' source attestation does not disclaim new opinions');
    ok(/does not represent an independent examination/i.test(attestation), key + ' source attestation implies an examination');
    eq(attestation.includes(r.api.certaintyStandard), false, key + ' source compilation states an opinion certainty standard');
  }

  /* An UNSET letterhead is stated as unset - never blank, never invented. */
  {
    const r = makeRuntime(); installUi(r); r.api.open();
    const block = r.api.letterheadBlock();
    ok(/\[The practice name is not configured/.test(block), 'an unset practice name printed as a blank line');
    ok(/\[The evaluating provider name is not configured/.test(block), 'an unset provider printed as a blank line');
    ok(/\[The practice address is not configured/.test(block), 'an unset address printed as a blank line');
    ok(!/undefined|null/.test(block), 'the unset letterhead leaked a JS placeholder value');
    const lh = r.api.letterhead();
    deep({ practice: lh.practice, provider: lh.provider, npi: lh.npi }, { practice: '', provider: '', npi: '' },
      'an unset letterhead invented values');
  }

  /* p1-legal-letterhead-1.0.0 is a delimited block so promotion is a copy. */
  {
    const a = source.indexOf('/* ===== p1-legal-letterhead-1.0.0 =');
    const b = source.indexOf('/* ===== end p1-legal-letterhead-1.0.0 ===== */');
    ok(a >= 0 && b > a, 'the p1-legal-letterhead-1.0.0 block is missing or unclosed');
    ok(source.indexOf('/* ===== p1-legal-letterhead-1.0.0 =', a + 1) < 0,
      'the p1-legal-letterhead-1.0.0 block appears twice');
    ok(!/'getName'|getName\s*\(\s*\)\s*[|;)]/.test(source.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, ' ')),
      'the letterhead falls back to the login/account display name for the clinical provider identity');
  }

  /* Static authority boundaries complement execution. */
  const executableSource = source.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(executableSource), 'workspace contains an unapproved network transport');
  eq((executableSource.match(/\/api\/vision/g) || []).length, 1, 'workspace must have exactly one authenticated OCR endpoint');
  ok(!/\/api\/legal|_tplReadAnyFile/.test(executableSource), 'workspace reaches a held legal or universal-upload path');
  ok(!/upsertPatient|savePatients|_savePatientChart|signLegalReport|sendToLegal|legalBody|currentLegal|showView\(['"]legalreq/.test(executableSource), 'workspace contains chart/sign/delivery handoff');
  /* p1-legal-bind-2.0.0 CHANGED THIS BOUNDARY DELIBERATELY, on the owner's
     2026-08-17 instruction that the workspace must be able to grab a patient
     from the EMR. A blanket "the word athena does not appear" scan is the
     wrong instrument for that: it proves a word is absent, not that no write
     can leave. The boundary that actually holds is
       (a) this module owns NO transport - it mints no message envelope, posts
           nothing, and listens to no message channel, so it cannot address
           the extension at all; it can only call read entry points the app
           already ships;
       (b) no write/execute verb or action name appears anywhere in it;
       (c) its read-op table IS the allowlist - EXECUTED, together with a
           postMessage spy that must observe zero traffic, in
           tests/1p-legal-bind-report-flow.test.js. */
  ok(!/chrome\.runtime|MLS_ASSIST|postMessage|addEventListener\(\s*['"]message['"]/.test(executableSource),
    'workspace mints its own extension transport instead of delegating to the app readers');
  ok(!/source\s*:\s*['"]mls-app['"]|['"]mls-ext['"]/.test(source),
    'workspace builds an extension message envelope of its own');
  ['mlsAppPasteNote', 'mlsAppAthenaActionV2', 'mlsAppSignAndSave', 'mlsAppPushVisit', 'mlsAppVerifiedWrite',
    'mlsAppWriteV2', 'mlsAppReviewScreen', 'mlsAppPrepProcTemplate', 'place_order', 'sign_encounter',
    'stage_billing', 'write_note', 'save_draft'].forEach(verb => {
    ok(source.indexOf(verb) < 0, 'workspace names the write/execute verb ' + verb);
  });
  ok(/navigator\.clipboard\.writeText/.test(source) && /URL\.createObjectURL/.test(source) && /win\.print\(\)/.test(source), 'copy/download/print exits are incomplete');
  ok(/<button type="button" class="p1l-drop"/.test(source), 'local file chooser is not a native keyboard button');
  ok(/<button type="button" class="p1l-filter/.test(source) && /aria-pressed=/.test(source), 'provider filters lack native keyboard/pressed semantics');
  ok(/role="status" aria-live="polite"/.test(source), 'status changes are not announced accessibly');
  ok(/id="mlsP1LegalDraft" aria-labelledby="mlsP1LegalDraftLabel"/.test(source), 'editable draft lacks an accessible label');
  ok(showcase.includes("connect-src 'none'") && showcase.includes("form-action 'none'"), 'showcase does not block network/form delivery');
  ok(!/<form\b|<input\b|<textarea\b|\bfetch\s*\(|<script\b/i.test(showcase), 'showcase accepts input or runs code');
  ok(showcase.includes('/1p/?tool=legal'), 'showcase does not route to the isolated preview workspace');
  ok(/No public PHI intake, payments, lawyer messaging, signing, delivery, chart filing, or Athena write/.test(showcase), 'showcase does not state the held boundaries');
  /* p1-legal-pagecount-1.0.0 (2026-08-19 press-pass): the showcase claimed
     "Thirteen sections" while SECTIONS had carried fourteen since
     p1-legal-letterhead-1.0.0 added XIV. OPINIONS. A page that miscounts the
     product is a defect, not a wording preference — so the number is now READ
     off the module instead of being trusted, and this drifts loudly next time. */
  {
    const NUMBER_WORDS = { 12: 'Twelve', 13: 'Thirteen', 14: 'Fourteen', 15: 'Fifteen', 16: 'Sixteen' };
    const sectionsBlock = source.slice(source.indexOf('var SECTIONS = ['), source.indexOf('var RECORDS_SECTIONS'));
    const realCount = (sectionsBlock.match(/^\s*\['[IVX]+\./gm) || []).length;
    ok(realCount === 14, 'the section engine no longer has 14 sections (counted ' + realCount + ') — update the showcase page with it');
    const claimed = NUMBER_WORDS[realCount];
    ok(showcase.indexOf(claimed + ' sections remain editable and unsigned') > 0,
      'the showcase page does not state the real section count (' + realCount + ' = "' + claimed + '")');
  }

  console.log('PASS 1p Legal / IME workspace runtime (' + checks + ' assertions)');
})().catch(error => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
