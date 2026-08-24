'use strict';

/* EXECUTED contract for the 2026-08-17 Legal / IME restoration lane.
 *
 * Owner, verbatim: "the Legal / IME workspace needs a lot of work. I used to
 * have this amazing legal space ... It really needs to be able to add a
 * patient to it - or grab a patient from Athena and then add it - and you can
 * pick the report and all that stuff."
 *
 * Three things are proved here, all by RUNNING the module, never by grepping:
 *
 *   1. THE FLOW. unbound -> bound -> report-picked -> generated -> exported,
 *      published on the room root as data-mls-legal-state so the next-step
 *      glow lane has a state to light. Change re-binds AND re-freezes.
 *
 *   2. THE EMR BOUNDARY. "Grab from the EMR" delegates to read entry points
 *      the app already ships. This module owns no transport, so the strongest
 *      available proof is run here: a postMessage spy on window, document and
 *      the global, across a full workspace lifetime including both read ops,
 *      must observe ZERO messages; the op table must contain only its two read
 *      keys; and every write/execute verb name must be refused with no
 *      delegate invoked at all.
 *
 *   3. THE RESTORED PRODUCTION FEATURES. Each function ported out of
 *      feat_mls_legalpack.js is executed against a sample whose right answer
 *      is known, because the /1p fork's own regressions (one "Unattributed"
 *      provider chip for every imported row; office visits filed as operative
 *      notes; a provider-filtered export that never said it was filtered) all
 *      passed a green gate for exactly as long as nobody executed them.
 *
 * Synthetic names only. No network, no PHI, no clipboard, no download, no
 * print, no extension, no patient store write.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_legalpack.js'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
/* Values crossing the vm realm boundary carry that realm's prototypes, so a
   strict deep-equal would fail on identity rather than on content. */
function deep(actual, expected, message) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++;
}

/* ------------------------------------------------------------------ fixture */
function node(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), id: '', value: '', hidden: false,
    disabled: false, innerHTML: '', textContent: '', className: '', style: {},
    parentNode: null, children: [], listeners: {}, attributes: {}, files: [],
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter(x => x !== child); child.parentNode = null; },
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'hidden') this.hidden = true; if (k === 'disabled') this.disabled = true; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    getAttributeNames() { return Object.keys(this.attributes); },
    removeAttribute(k) { delete this.attributes[k]; if (k === 'hidden') this.hidden = false; if (k === 'disabled') this.disabled = false; },
    contains(candidate) { return candidate === this || (this.children || []).some(c => c.contains ? c.contains(candidate) : c === candidate); },
    addEventListener(name, fn) {
      const prior = this.listeners[name];
      const handlers = prior && prior._handlers ? prior._handlers.slice() : (prior ? [prior] : []);
      handlers.push(fn);
      const dispatch = (...args) => handlers.slice().forEach(h => h(...args));
      dispatch._handlers = handlers; this.listeners[name] = dispatch;
    },
    removeEventListener(name, fn) {
      const prior = this.listeners[name]; if (!prior) return;
      const handlers = (prior._handlers || [prior]).filter(h => h !== fn);
      if (!handlers.length) { delete this.listeners[name]; return; }
      const dispatch = (...args) => handlers.slice().forEach(h => h(...args));
      dispatch._handlers = handlers; this.listeners[name] = dispatch;
    },
    querySelectorAll() { return []; }, click() {},
    focus() { if (this._document) this._document.activeElement = this; this.focused = true; }
  };
  return el;
}

function makeClock() {
  let now = 0, next = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const id = next++; timers.set(id, { id, at: now + Number(ms || 0), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const end = now + Number(ms || 0);
      for (;;) {
        const due = [...timers.values()].filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers.delete(due.id); now = due.at; due.fn();
      }
      now = end;
    },
    count() { return timers.size; }
  };
}
async function flush(turns = 24) { while (turns-- > 0) await Promise.resolve(); }

/* legal-coherent-1.0.0: every AI-backed report is returned as one strict JSON
   object. Derive fixture replies from the request's own expected-section
   contract so this flow test follows each report type without copying the
   runtime's heading table. */
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
  const encounterMatch = /\[(E\d+)\]\s+(\d{4}-\d{2}-\d{2})\s+·\s+([^·]+?)\s+·\s+[^\n]+/.exec(String(request.user || ''));
  const encounterId = encounterMatch && evidenceIds.includes(encounterMatch[1]) ? encounterMatch[1] : evidenceIds.find(id => /^E/.test(id));
  const encounterDate = encounterMatch ? encounterMatch[2] : '2025-02-02';
  const encounterType = encounterMatch ? encounterMatch[3].trim() : 'Office visit';
  const imagingEncounter = /(?:\bmri\b|\bct\b|x[- ]?ray|radiograph|radiology|imaging|ultrasound|scan)/i.test(encounterType);
  const procedureEncounter = /(?:procedure|injection|block|ablation|epidural|facet|surgery|operative|operation)/i.test(encounterType);
  const hasConcreteGapPacket = /source supplied[\s\S]{0,220}unsigned summary[\s\S]{0,260}(?:accident history|original radiology)|(?:treatment\s+response|response\s+details)\s+(?:was|were|are|is)\s+not\s+documented/i.test(String(request.user || ''));
  const missingOpinion = (label, missing, detail) => ({
    text: label + ': Undeterminable on the record reviewed because ' + missing + (detail ? ' ' + detail : '') + '.', evidenceIds: []
  });
  const report = { sections: specs.map((spec, index) => ({
    heading: spec.heading,
    paragraphs: spec.heading === 'PURPOSE AND SCOPE' && evidenceIds.includes('P000')
      ? [{ text: hasConcreteGapPacket
          ? 'This physician narrative addresses the requested medical issues for ' + patientName + '. The source supplied is an unsigned summary rather than the complete underlying chart; the accident history, original radiology report, selected contemporaneous examination details, and treatment details should be verified before adoption.'
          : 'This physician narrative addresses the requested medical issues for ' + patientName + ' using only the records provided, with source limitations requiring clinician verification.', evidenceIds: ['P000'] }]
      : spec.heading === 'SUMMARY OF OPINIONS'
        ? [missingOpinion('Causation', 'the mechanism and chronology'), missingOpinion('Neuropathy', 'objective neurologic testing or a formally documented diagnosis'), { text: 'Permanent and Stationary / Maximum Medical Improvement: Not formally established because the latest condition and pending care are not documented.', evidenceIds: [] }, missingOpinion('Future Care', 'the records do not establish a documented recommendation, schedule, or trigger')]
      : spec.heading === 'MEDICAL OPINIONS'
          ? [missingOpinion('Causation', 'the mechanism and chronology', 'in the detailed medical analysis'), missingOpinion('Neuropathy', 'objective neurologic testing or a formally documented diagnosis', 'for the requested issue'), { text: 'Permanent and Stationary / Maximum Medical Improvement: Not formally established because the latest condition and pending care remain undocumented in the detailed review.', evidenceIds: [] }]
        : spec.heading === 'HISTORY AND COURSE OF TREATMENT' && encounterId
            ? [{ text: encounterDate + ' - ' + encounterType + (imagingEncounter
                ? ': The documented MRI result is limited to the supplied impression; treatment response was not documented.'
                : procedureEncounter
                  ? ': The documented procedure and technique are identified in the supplied record; response was not documented.'
                  : ': History: Not documented in the records reviewed. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.'), evidenceIds: [encounterId] }]
            : [{ text: 'The records reviewed do not document sufficient evidence for requested item ' + (index + 1) + '; clinician verification is required.', evidenceIds: [] }]
  })) };
  if (mutate) mutate(report, { specs, evidenceIds, patientName });
  return JSON.stringify(report);
}
async function resolveWholeReport(runtime) {
  for (let spin = 0; spin < 24 && runtime.pendingAi.length < 1; spin++) await Promise.resolve();
  eq(runtime.pendingAi.length, 1, 'AI-backed report made other than one coherent request before settlement');
  runtime.pendingAi[0].resolve(wholeReportResponse(runtime.pendingAi[0]));
}

/* The workspace paints with innerHTML, which this fixture does not parse. The
   UI ids it then wires are supplied directly so every control is real. */
const UI_IDS = {
  mlsP1LegalClose: 'button', mlsP1LegalCompile: 'button', mlsP1LegalChronCopy: 'button',
  mlsP1LegalChronDownload: 'button', mlsP1LegalChronPrint: 'button', mlsP1LegalProviders: 'div',
  mlsP1LegalChronology: 'div', mlsP1LegalDrop: 'button', mlsP1LegalFile: 'input',
  mlsP1LegalSources: 'div', mlsP1LegalDoi: 'input', mlsP1LegalQuestions: 'textarea',
  mlsP1LegalGenerate: 'button', mlsP1LegalCancel: 'button', mlsP1LegalStatus: 'div',
  mlsP1LegalModelAsk: 'div', mlsP1LegalModelLuna: 'button',
  mlsP1LegalModelFast: 'button', mlsP1LegalModelNote: 'span',
  mlsP1LegalDraftCopy: 'button', mlsP1LegalDraftDownload: 'button', mlsP1LegalDraftWord: 'button' /* wdoc-1.0.0 */, mlsP1LegalDraftPrint: 'button',
  mlsP1LegalDraft: 'textarea', mlsP1LegalLetterheadEmail: 'input', mlsP1LegalLetterheadPreview: 'pre',
  /* p1-legal-flow-2.0.0 / p1-legal-bind-2.0.0 */
  mlsP1LegalBanner: 'div', mlsP1LegalRoster: 'div', mlsP1LegalReadOps: 'div',
  mlsP1LegalReportTypes: 'div', mlsP1LegalFreeze: 'div',
  /* p1-legal-stepper-1.0.0 */
  mlsP1LegalStepper: 'ol'
};
/* the four ids each collapsed card owns */
const CARD_KEYS = ['report', 'chronology', 'records', 'generate', 'draft'];
CARD_KEYS.forEach(key => {
  const suffix = key.charAt(0).toUpperCase() + key.slice(1);
  UI_IDS['mlsP1LegalDisclose' + suffix] = 'button';
  UI_IDS['mlsP1LegalBody' + suffix] = 'div';
  UI_IDS['mlsP1LegalSum' + suffix] = 'span';
  UI_IDS['mlsP1LegalCue' + suffix] = 'span';
});

function makeRuntime(options = {}) {
  const ids = {};
  const head = node('head'), body = node('body'), rootNode = node('html');
  rootNode.appendChild(head); rootNode.appendChild(body);
  const events = {};
  const posted = [];
  const patients = (options.patients || [
    { id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A',
      problems: 'M54.50 Low back pain',
      visits: [
        /* an IMPORTED row: no `provider` field at all, the clinician's name is
           inside the raw athenaOne line, and that line ends in the provider's
           SPECIALTY ("Orthopedic Surgery") - the exact shape that used to file
           an office visit as an operative note. */
        { date: '2025-02-02', type: 'Office visit',
          raw: 'Office visit\n02-02-2025 9:15 AM, M Synthetic, DO, Orthopedic Surgery\nPain follow-up. Return in 4 weeks.' },
        { date: '2025-01-10', type: 'Lumbar MRI', provider: 'M Synthetic', detail: 'Documented impression only.',
          aiSummary: 'Synthetic stored summary line.' }
      ],
      docs: [{ date: '2025-01-08', name: 'Outside hospital records', text: 'Synthetic outside record.' }] },
    { id: 'B', name: 'Synthetic Beta', dob: '03/04/1990', mrn: 'TEST-B', visits: [] },
    { id: 'C', name: 'Synthetic Gamma', dob: '05/06/1975', mrn: 'MRN-9001', visits: [] }
  ]).map(p => JSON.parse(JSON.stringify(p)));
  let activeId = Object.prototype.hasOwnProperty.call(options, 'activeId') ? options.activeId : 'A';
  let epoch = 1;
  const pendingAi = [];
  const notes = options.notes || {
    A: [{ patientId: 'A', updated: 4, signed: true, provider: 'M Synthetic, DO',
      coding: { icd: [{ code: 'M51.36', desc: 'Other intervertebral disc degeneration, lumbar region' }] },
      soap: 'S:\nPain.\nA:\nLumbar strain.\nPLAN:\nContinue therapy. Follow-up in 4 weeks. MRI reviewed.\nO:\nNormal gait.' }]
  };
  function byIdOf(id) { return patients.filter(p => String(p.id) === String(id))[0] || null; }
  const window = {
    __MLS_P1_PREVIEW: { enabled: true, route: '/1p/' },
    _mlsActivePtEpoch: epoch,
    _calAppts: options.calAppts || [],
    getPatients: () => patients.slice(),
    activePatient: () => byIdOf(activeId),
    getActivePtId: () => String(activeId || ''),
    patientNotes: id => (notes[id] || []).slice(),
    __mlsVisitModel: { getVisits: p => (p && p.visits) || [] },
    addEventListener(name, fn) { events[name] = fn; },
    removeEventListener(name) { delete events[name]; },
    postMessage(...args) { posted.push({ target: 'window', args }); },
    aiCallRaw(sys, user, key, opts) { return new Promise((resolve, reject) => pendingAi.push({ sys, user, key, opts, resolve, reject })); },
    getKey: () => 'synthetic-key', toast() {}, open: () => null
  };
  if (options.withSwitcher !== false) {
    window.openPatient = function (id) {
      const previous = activeId;
      activeId = String(id); epoch++; window._mlsActivePtEpoch = epoch;
      if (events['mls:active-patient-changed']) events['mls:active-patient-changed']({ detail: { previousId: previous, patientId: activeId } });
    };
  }
  if (options.readers) Object.assign(window, options.readers);
  const clock = makeClock();
  function findIn(tree, id) {
    if (!tree) return null; if (tree.id === id) return tree;
    for (const child of tree.children || []) { const found = findIn(child, id); if (found) return found; }
    return null;
  }
  const document = {
    head, body, documentElement: rootNode, activeElement: null, currentScript: null,
    getElementById: id => ids[id] || findIn(rootNode, id),
    createElement(tag) { const el = node(tag); el._document = document; return el; },
    postMessage(...args) { posted.push({ target: 'document', args }); }
  };
  [head, body, rootNode].forEach(el => { el._document = document; });
  const installScript = node('script');
  installScript.setAttribute('data-mls-asset', 'feat_mls_legalpack.js');
  installScript.setAttribute('data-mls-install-token', 'synthetic-legal-install');
  document.currentScript = installScript;
  window.__mlsP1LegalLoader = { installed: true, version: 'p1-legal-1.0.0', state: 'loading', installToken: 'synthetic-legal-install' };
  window.bkUser = Object.prototype.hasOwnProperty.call(options, 'user') ? options.user : { role: 'doctor' };
  Object.keys(UI_IDS).forEach(id => { const el = node(UI_IDS[id]); el.id = id; el._document = document; ids[id] = el; });
  const context = {
    window, document,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    location: { search: options.search || '' }, URLSearchParams,
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
    Blob, Date, JSON, Math, Object, Array, String, Number, RegExp, Promise, AbortController,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, console,
    postMessage(...args) { posted.push({ target: 'global', args }); }
  };
  window.window = window; window.document = document; window.navigator = context.navigator;
  vm.createContext(context); vm.runInContext(source, context, { filename: '1p-feat_mls_legalpack.js' });
  return {
    window, document, ids, clock, pendingAi, posted, patients, notes,
    api: window.__mlsP1LegalPack,
    root() { return document.getElementById('mlsP1LegalRoot'); },
    stage() { const r = this.root(); return r ? r.getAttribute('data-mls-legal-state') : null; },
    setActive(id) { activeId = String(id); epoch++; window._mlsActivePtEpoch = epoch; },
    fire(name, detail) { if (events[name]) events[name]({ detail: detail || {} }); }
  };
}

/* ==========================================================================
   1. THE FLOW: unbound -> bound -> report-picked -> generated -> exported
   ======================================================================== */
(async function run() {
  {
    const r = makeRuntime();
    deep(r.api.stages, ['unbound', 'bound', 'report-picked', 'generated', 'exported'],
      'the published flow stages are not the four the glow lane wires plus unbound');
  }

  /* Opening with NO active patient is now a real, named state - it is how a
     clinician ADDS a patient - and it says so instead of refusing silently. */
  {
    const r = makeRuntime({ activeId: '' });
    eq(r.api.open(), true, 'the workspace refused to open without an active patient, so a patient can never be added');
    eq(r.stage(), 'unbound', 'an unbound workspace does not publish the unbound state');
    eq(r.api.state().patientBound, false, 'an unbound workspace claims a bound patient');
    eq(r.root().getAttribute('data-mls-legal-bound'), 'false', 'the room root does not publish its bound flag');
    ok(/No patient bound/.test(r.ids.mlsP1LegalBanner.innerHTML), 'the unbound header does not say plainly that no patient is bound');
    ok(/Add a patient/.test(r.ids.mlsP1LegalRoster.innerHTML), 'the unbound state offers no way to add a patient');
    ok(/Grab from the EMR/.test(r.ids.mlsP1LegalReadOps.innerHTML), 'the unbound state offers no way to grab a patient from the EMR');
    eq(r.ids.mlsP1LegalGenerate.disabled, true, 'Generate is reachable with no patient bound');
    eq(r.ids.mlsP1LegalCompile.disabled, true, 'Compile is reachable with no patient bound');
    eq(r.api.state().stage, 'unbound', 'the state receipt disagrees with the room root');
    /* Step 2 must not complete before step 1: a "report-picked" state with no
       patient would aim the next-step glow at a correctly-disabled Generate. */
    eq(r.api.pickReport('ime'), false, 'a report type was picked with no patient bound');
    eq(r.stage(), 'unbound', 'picking a report while unbound advanced the published flow state');
    eq(r.api.state().reportType, '', 'picking a report while unbound recorded a report type');
    ok(/Bind a patient first/i.test(r.ids.mlsP1LegalStatus.textContent), 'the refusal did not say which step comes first');
  }

  /* Re-binding to the patient ALREADY active is a real Change - the app emits
     no switch event, so this is the path that would silently keep a stale
     snapshot if the re-bind were driven off the event alone. */
  {
    const r = makeRuntime();
    r.api.open(); r.api.pickReport('ime');
    r.patients[0].visits.push({ date: '2025-05-05', type: 'Office visit', provider: 'M Synthetic', detail: 'Added before the no-op Change.' });
    eq(r.api.snapshotDrifted(), true, 'the fixture did not actually move the chart under the snapshot');
    eq(r.api.bindTo('A'), true, 'a Change back to the already-active patient failed');
    eq(r.window.getActivePtId(), 'A', 'the no-op Change moved the active patient');
    eq(r.api.snapshotDrifted(), false, 'a Change to the already-active patient did not re-freeze the snapshot');
    eq(r.api.state().reportType, '', 'the no-op Change kept the previous report type');
    eq(r.stage(), 'bound', 'the no-op Change did not return the flow to the bound step');
    ok(r.api.chronologyText().includes('Added before the no-op Change.'), 'the re-freeze did not pick up the new entry');
  }

  /* Add a patient from the roster: search, pick, bind, and the whole flow. */
  {
    const r = makeRuntime({ activeId: '' });
    r.api.open();
    deep(r.api.roster('gamma').map(p => p.id), ['C'], 'roster search by name did not find the patient');
    deep(r.api.roster('MRN-9001').map(p => p.id), ['C'], 'roster search by MRN did not find the patient');
    deep(r.api.roster('05/06/1975').map(p => p.id), ['C'], 'roster search by DOB did not find the patient');
    deep(r.api.roster('z'), [], 'a one-character query searched the roster');
    deep(r.api.roster('no-such-patient'), [], 'roster search invented a match');

    eq(r.api.bindTo('C'), true, 'binding to a roster patient failed');
    eq(r.stage(), 'bound', 'binding did not advance the flow to bound');
    eq(r.window.getActivePtId(), 'C', 'binding did not go through the app own active-patient switch');
    ok(/Bound to Synthetic Gamma/.test(r.ids.mlsP1LegalBanner.innerHTML), 'the bound header does not name the patient');
    ok(/MRN-9001/.test(r.ids.mlsP1LegalBanner.innerHTML), 'the bound header does not carry the MRN chip');
    ok(/p1l-bindname/.test(r.ids.mlsP1LegalBanner.innerHTML), 'the bound header is not the large identity card');
    ok(/id="mlsP1LegalChange"/.test(r.ids.mlsP1LegalBanner.innerHTML), 'the bound header has no Change button beside it');
    eq(r.api.state().reportType, '', 'binding pre-picked a report type instead of asking');
    eq(r.ids.mlsP1LegalGenerate.disabled, true, 'Generate was reachable before a report type was picked');

    eq(r.api.pickReport('not-a-report'), false, 'an unknown report type was accepted');
    eq(r.api.state().reportType, '', 'a refused report type still changed the state');
    eq(r.api.pickReport('ime'), true, 'picking the IME report type failed');
    eq(r.stage(), 'report-picked', 'picking a report did not advance the flow');
    eq(r.root().getAttribute('data-mls-legal-report'), 'ime', 'the room root does not publish the picked report');
    eq(r.ids.mlsP1LegalGenerate.disabled, false, 'Generate stayed unreachable after a report type was picked');

    const promise = r.api.generateDraft();
    await resolveWholeReport(r);
    eq(await promise, true, 'the IME generation did not complete');
    eq(r.pendingAi.length, 1, 'valid IME generation used more than one whole-report call');
    eq(r.stage(), 'generated', 'a completed draft did not advance the flow to generated');
    eq(r.ids.mlsP1LegalDraftCopy.disabled, false, 'export stayed disabled after generation');

    r.ids.mlsP1LegalDraftCopy.listeners.click();
    await flush();
    eq(r.stage(), 'exported', 'exporting the draft did not advance the flow to exported');
  }

  /* Change re-binds AND re-freezes: no prior model, filter, file, draft, report
     type or snapshot may survive into the new patient's workspace. */
  {
    const r = makeRuntime();
    r.api.open();
    eq(r.stage(), 'bound', 'opening on an active patient did not bind');
    r.api.pickReport('narrative');
    r.api.addFiles([{ name: 'carryover.txt', type: 'text/plain', size: 12, text: () => Promise.resolve('Synthetic carryover text.') }]);
    await flush();
    eq(r.api.state().sourceCount, 1, 'the fixture did not stage a local file to carry over');
    const frozenA = r.ids.mlsP1LegalFreeze.textContent;
    ok(/Frozen at /.test(frozenA), 'the chronology does not report when its snapshot was frozen');
    ok(/documented entries/.test(frozenA), 'the frozen notice does not say how much it froze');

    eq(r.api.bindTo('B'), true, 'Change to another roster patient failed');
    eq(r.stage(), 'bound', 'Change did not return the flow to the bound step');
    eq(r.api.state().reportType, '', 'Change carried the previous report type across patients');
    eq(r.api.state().sourceCount, 0, 'Change carried the previous patient local records across');
    eq(r.ids.mlsP1LegalDraft.value, '', 'Change left the previous patient draft on screen');
    eq(r.ids.mlsP1LegalDraftCopy.disabled, true, 'Change left the previous patient export enabled');
    ok(/Bound to Synthetic Beta/.test(r.ids.mlsP1LegalBanner.innerHTML), 'Change did not repaint the identity header');
    ok(r.api.chronologyText().includes('Synthetic Beta'), 'the chronology still belongs to the previous patient');
    ok(!r.api.chronologyText().includes('Synthetic Alpha'), 'the previous patient survived into the re-bound chronology');
    ok(/Frozen at /.test(r.ids.mlsP1LegalFreeze.textContent), 'Change did not re-freeze a snapshot for the new patient');
  }

  /* The frozen-snapshot warning is a MEASUREMENT, not a label: it must appear
     when the chart really moves under the workspace, and clear on re-compile. */
  {
    const r = makeRuntime();
    r.api.open();
    eq(r.api.snapshotDrifted(), false, 'a freshly frozen snapshot reported drift');
    ok(/unchanged/.test(r.ids.mlsP1LegalFreeze.textContent), 'the fresh snapshot notice does not report the re-check');
    r.patients[0].visits.push({ date: '2025-03-03', type: 'Office visit', provider: 'M Synthetic', detail: 'Added after the freeze.' });
    eq(r.api.snapshotDrifted(), true, 'a chart change under the frozen snapshot was not detected');
    r.ids.mlsP1LegalCompile.listeners.click();
    eq(r.api.snapshotDrifted(), false, 're-compiling did not re-freeze the snapshot');
    ok(/unchanged/.test(r.ids.mlsP1LegalFreeze.textContent), 're-compiling left the stale warning up');
    ok(r.api.chronologyText().includes('Added after the freeze.'), 're-compiling did not pick up the new entry');
    /* and a Change re-runs the same check for the newly bound patient */
    r.patients[1].visits.push({ date: '2025-04-04', type: 'Office visit', provider: 'M Synthetic', detail: 'Beta entry.' });
    r.api.bindTo('B');
    eq(r.api.snapshotDrifted(), false, 'Change did not re-freeze, so the new patient started out stale');
    ok(r.api.chronologyText().includes('Beta entry.'), 'the re-frozen snapshot missed the new patient own record');
  }

  /* An EXTERNAL patient change is still the fail-closed event it always was.
     Only a change this workspace ASKED for is a re-bind. */
  {
    const r = makeRuntime();
    r.api.open();
    r.api.pickReport('ime');
    r.window.openPatient('B');           /* not requested by the workspace */
    eq(r.api.state().open, false, 'an external patient change no longer closed the workspace');
    eq(r.api.state().patientBound, false, 'an external patient change kept the old binding');
    eq(r.api.state().reportType, '', 'an external patient change kept the old report type');
  }

  /* A build with no patient switcher must SAY so, not silently do nothing. */
  {
    const r = makeRuntime({ withSwitcher: false, activeId: 'A' });
    r.api.open();
    eq(r.api.bindTo('C'), false, 'binding claimed success with no switcher available');
    ok(/no patient switcher/i.test(r.ids.mlsP1LegalStatus.textContent), 'a missing switcher was not reported honestly');
    eq(r.window.getActivePtId(), 'A', 'a refused bind changed the active patient anyway');
    eq(r.api.bindTo('not-in-roster'), false, 'binding to a patient outside the roster was accepted');
    ok(/not in this account/i.test(r.ids.mlsP1LegalStatus.textContent), 'an off-roster bind was not refused honestly');
  }

  /* ==========================================================================
     2. THE EMR BOUNDARY - read only, delegated, and provably silent
     ======================================================================== */
  {
    const r = makeRuntime();
    deep(r.api.readOps().map(op => op.key), ['day', 'chart'],
      'the read-op allowlist is not exactly the two read operations');
    /* Every op is unavailable until the app reader it delegates to is loaded,
       and an unavailable op must refuse rather than fake a result. */
    deep(r.api.readOps().map(op => op.available), [false, false],
      'a read op reported itself available with no app reader loaded');
    r.api.open();
    eq(await r.api.runReadOp('day', { date: '2026-08-17' }), false, 'an unavailable read op reported success');
    ok(/not loaded/i.test(r.ids.mlsP1LegalStatus.textContent), 'an unavailable read op did not say why nothing ran');
  }

  /* Both ops delegate, and NOTHING is posted anywhere during a full lifetime. */
  {
    const dayCalls = [], chartCalls = [];
    const r = makeRuntime({
      readers: {
        __mlsSI: { dayPull: opts => { dayCalls.push(opts); return Promise.resolve({ ok: true }); } },
        pullPatientChartViaAssist: (btn, opts) => { chartCalls.push({ btn, opts }); return Promise.resolve(true); }
      }
    });
    r.api.open();
    deep(r.api.readOps().map(op => op.available), [true, true], 'a loaded app reader was not detected');

    eq(await r.api.runReadOp('day', { date: '2026-08-17' }), true, 'the day read did not complete');
    eq(dayCalls.length, 1, 'the day read did not delegate exactly once to the app schedule reader');
    eq(dayCalls[0].date, '2026-08-17', 'the day read did not pass the requested day');
    eq(dayCalls[0].includeHistory, true, 'the day read did not request the chart histories that carry identity');

    eq(await r.api.runReadOp('chart'), true, 'the chart read did not complete');
    eq(chartCalls.length, 1, 'the chart read did not delegate exactly once to the app chart reader');
    eq(chartCalls[0].btn, null, 'the chart read passed a DOM button into the app reader');
    eq(chartCalls[0].opts.patientId, 'A', 'the chart read did not scope itself to the bound patient');

    /* THE BOUNDARY: no envelope, to any target, ever. */
    deep(r.posted, [], 'the workspace posted a message of its own instead of delegating to the app readers');
  }

  /* Every write/execute verb the bridge accepts must be refused by the op
     table with NO delegate invoked - the table is the allowlist. */
  {
    let delegated = 0;
    const r = makeRuntime({
      readers: {
        __mlsSI: { dayPull: () => { delegated++; return Promise.resolve({ ok: true }); } },
        pullPatientChartViaAssist: () => { delegated++; return Promise.resolve(true); }
      }
    });
    r.api.open();
    const REFUSED = ['mlsAppPasteNote', 'mlsAppAthenaActionV2', 'mlsAppSignAndSave', 'mlsAppPushVisit',
      'mlsAppVerifiedWrite', 'mlsAppWriteV2', 'mlsAppReviewScreen', 'mlsAppPrepProcTemplate',
      'place_order', 'sign_encounter', 'stage_billing', 'write_note', 'save_draft',
      'write', 'constructor', '__proto__', 'toString', 'hasOwnProperty'];
    for (const key of REFUSED) {
      eq(await r.api.runReadOp(key, {}), false, 'the op table accepted "' + key + '"');
    }
    eq(delegated, 0, 'a refused operation still reached a delegate');
    deep(r.posted, [], 'a refused operation posted a message');
    /* and the two real ops still work afterwards, so the refusals are a gate,
       not a wedge */
    eq(await r.api.runReadOp('day', {}), true, 'the read gate wedged the workspace shut after refusing');
    eq(delegated, 1, 'the day read did not run after the refusals');
  }

  /* A read op must never run over a live draft or another read. */
  {
    let dayRuns = 0, release = null;
    const r = makeRuntime({ readers: { __mlsSI: { dayPull: () => { dayRuns++; return new Promise(resolve => { release = resolve; }); } } } });
    r.api.open(); r.api.pickReport('ime');
    r.api.runReadOp('day', {});
    await flush();
    eq(dayRuns, 1, 'the first read did not start');
    eq(r.api.state().reading, 'day', 'a running read is not reported in the state receipt');
    eq(r.ids.mlsP1LegalGenerate.disabled, true, 'Generate stayed live while the EMR was being read');
    eq(await r.api.runReadOp('day', {}), false, 'a second read started over a running one');
    eq(dayRuns, 1, 'a second read reached the delegate while one was already running');
    release({ ok: true }); await flush();
    eq(r.api.state().reading, '', 'the finished read did not release its slot');
    eq(r.ids.mlsP1LegalGenerate.disabled, false, 'Generate stayed disabled after the read finished');
  }

  /* A delegate that rejects must be reported, never swallowed into a green UI. */
  {
    const r = makeRuntime({ readers: { __mlsSI: { dayPull: () => Promise.reject(new Error('synthetic reader failure')) } } });
    r.api.open();
    eq(await r.api.runReadOp('day', {}), false, 'a failed read reported success');
    ok(/synthetic reader failure/.test(r.ids.mlsP1LegalStatus.textContent), 'a failed read hid its reason');
    eq(r.api.state().reading, '', 'a failed read left its slot held');
  }

  /* ==========================================================================
     3. THE RESTORED PRODUCTION FEATURES - each one EXECUTED
     ======================================================================== */
  {
    const r = makeRuntime();
    const R = r.api.restored;

    /* provOfVisit: the imported-row provider that used to be lost entirely */
    eq(R.provOfVisit({ provider: 'M Synthetic' }), 'M Synthetic', 'the explicit provider field was ignored');
    eq(R.provOfVisit({ raw: 'Office visit\n02-02-2025 9:15 AM, M Synthetic, DO, Orthopedic Surgery\nbody' }),
      'M Synthetic', 'the provider inside an imported athenaOne row was not recovered');
    eq(R.provOfVisit({ raw: 'Office visit\n2/2/2025, A Reader, MD, Neurology' }), 'A Reader',
      'the provider inside a slash-dated imported row was not recovered');
    eq(R.provOfVisit({ raw: 'Nothing dated here at all' }), '', 'a provider was invented from an undated row');
    eq(R.provOfVisit({ raw: '02-02-2025, 9:15, notes' }), '', 'a numeric field was mistaken for a provider name');

    /* normProv: one clinician must be one filter chip */
    eq(R.normProv('M Synthetic, DO'), 'M Synthetic', 'the DO credential was not normalized away');
    eq(R.normProv('M Synthetic MD'), 'M Synthetic', 'the MD credential was not normalized away');
    eq(R.normProv('M  Synthetic'), 'M Synthetic', 'internal whitespace was not collapsed');
    eq(R.normProv('M Synthetic, PA-C'), 'M Synthetic', 'the PA-C credential was not normalized away');
    eq(R.normProv(''), '', 'an empty provider became a name');

    /* classifiable: the specialty suffix must not survive into classification */
    ok(!/Orthopedic Surgery/.test(R.classifiable('Office visit', '02-02-2025 9:15 AM, M Synthetic, DO, Orthopedic Surgery\nPain follow-up.')),
      'the athenaOne provider/specialty line survived into the classifier input');
    ok(/Pain follow-up\./.test(R.classifiable('Office visit', '02-02-2025 9:15 AM, M Synthetic, DO, Orthopedic Surgery\nPain follow-up.')),
      'stripping the provider line also deleted the clinical text');

    /* planOf: a dictated SOAP note stops the PLAN at the next SOAP letter */
    eq(R.planOf('S:\nPain.\nPLAN:\nContinue therapy.\nO:\nNormal gait.'), 'Continue therapy.',
      'the PLAN section did not stop at the following SOAP block');
    eq(R.planOf('A:\nStrain.\nP: Ice and rest.'), 'Ice and rest.', 'a single-letter P: plan was not recovered');
    eq(R.planOf('No plan section at all here.'), '', 'a plan was invented from a note that has none');

    /* fuLinesOf */
    deep(R.fuLinesOf('Continue therapy.\nFollow-up in 4 weeks.\nReturn to clinic if worse.'),
      ['Follow-up in 4 weeks.', 'Return to clinic if worse.'], 'documented follow-up lines were not extracted');
    deep(R.fuLinesOf('Nothing scheduled.'), [], 'a follow-up was invented');

    /* icdOf: the STRUCTURED coding object the fork used to ignore */
    deep(R.icdOf({ icd: [{ code: 'M51.36', desc: 'Lumbar disc degeneration' }] }),
      ['M51.36 - Lumbar disc degeneration'], 'structured ICD-10 coding was not read');
    deep(R.icdOf({ icd10: ['M54.5'] }), ['M54.5'], 'the icd10 spelling of the coding array was not read');
    deep(R.icdOf(null), [], 'a diagnosis was invented from absent coding');
    deep(R.icdOf({}), [], 'a diagnosis was invented from an empty coding object');
  }

  /* The classifier end to end on the model: the imported row keeps its
     provider, is NOT filed as a procedure, and secondary AI prose is not
     promoted into the evidence packet as though it were chart text. */
  {
    const r = makeRuntime();
    r.api.open();
    const model = r.api.buildModel(JSON.parse(JSON.stringify(r.patients[0])),
      Object.freeze({ patientId: 'A', patientEpoch: 1, name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A' }));
    const visit = model.items.filter(i => i.title === 'Office visit')[0];
    ok(visit, 'the imported office visit is missing from the model');
    eq(visit.provider, 'M Synthetic', 'the imported row lost its provider to "Unattributed" again');
    eq(visit.category, 'visit', 'the provider specialty filed an office visit as a procedure again');
    deep(model.providers, ['M Synthetic', 'Unattributed'],
      'the provider roster is not credential-normalized into one chip per clinician');
    ok(!model.items.some(i => /Synthetic stored summary line\./.test(i.body)), 'a stored AI summary was promoted into legal evidence');
    ok(!model.items.some(i => /AI summary \(AI-generated - verify\)/.test(i.body)), 'secondary model prose survived in the legal evidence packet');
    const summaryOnlyModel = r.api.buildModel({ id: 'A', docs: [{ date: '2025-01-09', name: 'Summary-only document',
      aiSummary: 'Synthetic document summary must not become source evidence.' }] },
      Object.freeze({ patientId: 'A', patientEpoch: 1, name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A' }));
    const summaryOnlyDoc = summaryOnlyModel.items.filter(i => i.title === 'Summary-only document')[0];
    ok(summaryOnlyDoc, 'a summary-only document disappeared instead of remaining visibly unreadable');
    eq(summaryOnlyDoc.body, '(no extractable text stored)', 'doc.aiSummary was used as a fallback for absent source text');
    ok(!/Synthetic document summary/.test(summaryOnlyDoc.body), 'a document AI summary entered the legal evidence packet');
    ok(model.items.some(i => i.category === 'diagnosis' && /M51\.36/.test(i.title)), 'structured visit coding never reached the chronology');
    ok(model.items.some(i => i.category === 'plan' && /Continue therapy\./.test(i.body)), 'the documented treatment plan never reached the chronology');
    ok(model.items.every(i => i.category !== 'plan' || !/Normal gait/.test(i.body)), 'the plan section swallowed the following SOAP block');
  }

  /* A scheduled FUTURE appointment is a documented follow-up; a same-named
     appointment for a different patient is not. */
  {
    const today = new Date();
    const future = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    const pad = n => (n < 10 ? '0' : '') + n;
    const futureYmd = future.getFullYear() + '-' + pad(future.getMonth() + 1) + '-' + pad(future.getDate());
    const pastYmd = (today.getFullYear() - 1) + '-01-01';
    const r = makeRuntime({ calAppts: [
      { name: 'Synthetic Alpha', appt_date: futureYmd, reason: 'Six-week recheck', provider: 'M Synthetic' },
      { name: 'Synthetic Alpha', appt_date: pastYmd, reason: 'Already happened' },
      { name: 'Synthetic Beta', appt_date: futureYmd, reason: 'Another patient appointment' }
    ] });
    r.api.open();
    const text = r.api.chronologyText();
    ok(/Six-week recheck/.test(text), 'a scheduled future appointment is not in the chronology');
    ok(!/Already happened/.test(text), 'a past calendar row was filed as a future follow-up');
    ok(!/Another patient appointment/.test(text), 'another patient calendar row crossed into this chronology');
  }

  /* activeFilterNote: a provider-filtered export must SAY it is partial, in
     the exported bytes - not only in the on-screen chips. */
  {
    const r = makeRuntime();
    r.api.open();
    eq(r.api.restored.activeFilterNote(), '', 'an unfiltered compilation claimed a filter was active');
    const unfiltered = r.api.chronologyText();
    ok(unfiltered.length > 0, 'the chronology is empty, so the filter test would prove nothing');
    ok(!/PROVIDER FILTER ACTIVE/.test(unfiltered), 'an unfiltered export carried a filter warning');
    ok(/Documented impression only\./.test(unfiltered), 'the unfiltered export is missing the provider row under test');

    eq(r.api.filterProvider('No Such Provider', false), false, 'the filter accepted a provider who is not in the roster');
    eq(r.api.filterProvider('M Synthetic', false), true, 'turning a provider chip off failed');
    const filtered = r.api.chronologyText();
    ok(/PROVIDER FILTER ACTIVE/.test(filtered), 'a provider-filtered export did not say it was filtered');
    ok(/EXCLUDED FROM THIS COMPILATION: M Synthetic/.test(filtered), 'the filtered export does not name who was excluded');
    ok(/PARTIAL/.test(filtered), 'the filtered export does not say it is a partial record');
    ok(!/Documented impression only\./.test(filtered), 'the excluded provider rows are still in the export');
    ok(filtered.indexOf('PROVIDER FILTER ACTIVE') < filtered.indexOf('VISITS & ENCOUNTERS'),
      'the filter warning is buried below the record instead of leading it');

    eq(r.api.filterProvider('M Synthetic', true), true, 'turning the provider chip back on failed');
    eq(r.api.restored.activeFilterNote(), '', 'restoring every provider left the filter warning armed');
    ok(!/PROVIDER FILTER ACTIVE/.test(r.api.chronologyText()), 'restoring every provider left the export marked partial');
  }

  /* ==========================================================================
     4. REPORT TYPES
     ======================================================================== */
  {
    const r = makeRuntime();
    const types = r.api.reportTypes;
    deep(types.map(t => t.key), ['ime', 'narrative', 'records', 'chronology'],
      'the report-type list changed without a decision');
    types.forEach(t => {
      ok(t.label && t.label.length > 4, 'report type ' + t.key + ' has no label');
      ok(t.blurb && t.blurb.length > 30, 'report type ' + t.key + ' has no one-line description for the picker');
    });
    deep(types.map(t => t.sectionCount), [14, 7, 5, 0], 'the report types do not have distinct section sets');
    eq(r.api.sectionsFor('ime').length, 14, 'the IME set is not the 14-section default');
    eq(r.api.sectionsFor('narrative').length, 7, 'the narrative is not the compact seven-part reference form');
    deep(r.api.sectionsFor('narrative').map(s => s[0]), [
      'PURPOSE AND SCOPE', 'SUMMARY OF OPINIONS', 'HISTORY AND COURSE OF TREATMENT',
      'MEDICAL OPINIONS', 'LIKELY FUTURE CARE', 'REASONABLENESS AND NECESSITY', 'CONCLUSION'
    ], 'the narrative no longer follows the supplied reference report reasoning order');
    ok(r.api.sectionsFor('ime').some(s => /XIV\. OPINIONS/.test(s[0])), 'the IME report lost its OPINIONS section');
    ok(r.api.sectionsFor('records').every(s => !/CAUSATION|OPINION/.test(s[0])), 'the records summary offers opinions');
  }

  /* The counsel-questions section appears only when questions are supplied,
     and only for the types that answer questions. */
  {
    const r = makeRuntime();
    r.api.open();
    eq(r.api.runSections('ime').length, 14, 'an empty questions box still added a questions section');
    r.ids.mlsP1LegalQuestions.value = '1. Is the lumbar injury related to the documented event?';
    eq(r.api.runSections('ime').length, 15, 'supplied questions did not add their own IME section');
    /* p1-legal-counsel-order-1.0.0: pinned BY NUMBER, not by index. The
       section is called XIII-A because it belongs after XIII; it used to be
       appended, so the generated report printed XIII, XIV, XIII-A, XV. */
    {
      const heads = r.api.runSections('ime').map(s => s[0]);
      ok(/ANSWERS TO THE QUESTIONS ASKED/.test(heads[13]), 'the questions section is not named for what it does: ' + heads[13]);
      eq(heads.indexOf('XIII-A. ANSWERS TO THE QUESTIONS ASKED'), heads.findIndex(h => /^XIII\./.test(h)) + 1,
        'XIII-A is not immediately after XIII: ' + JSON.stringify(heads));
      ok(heads.indexOf('XIII-A. ANSWERS TO THE QUESTIONS ASKED') < heads.indexOf('XIV. OPINIONS'),
        'XIII-A still prints after XIV: ' + JSON.stringify(heads));
      const nHeads = r.api.runSections('narrative').map(s => s[0]);
      eq(nHeads[nHeads.length - 2], 'ANSWERS TO THE QUESTIONS PRESENTED',
        'the narrative question answers are not immediately before the conclusion: ' + JSON.stringify(nHeads.slice(-3)));
    }
    eq(r.api.runSections('narrative').length, 8, 'supplied questions did not add one compact narrative answer section');
    eq(r.api.runSections('records').length, 5, 'the records summary invented a questions section');
    eq(r.api.runSections('chronology').length, 0, 'the deterministic chronology report gained AI sections');
  }

  /* The narrative type asks for the supplied-reference seven-part form in one
     coherent call, with no IME-numbered OPINIONS section. */
  {
    const r = makeRuntime();
    r.api.open(); r.api.pickReport('narrative');
    const promise = r.api.generateDraft();
    await resolveWholeReport(r);
    eq(await promise, true, 'the narrative generation did not complete');
    eq(r.pendingAi.length, 1, 'the narrative report made other than one coherent AI call');
    ok(/^NARRATIVE MEDICAL REPORT$/m.test(r.ids.mlsP1LegalDraft.value), 'the report does not use the reference-form narrative title');
    ok(/^DOB: 01\/02\/1980$/m.test(r.ids.mlsP1LegalDraft.value) && /^MRN: TEST-A$/m.test(r.ids.mlsP1LegalDraft.value),
      'the narrative header omitted the frozen patient metadata');
    ok(/^To Whom It May Concern:$/m.test(r.ids.mlsP1LegalDraft.value), 'the narrative header omitted its deterministic addressee');
    ['PURPOSE AND SCOPE', 'SUMMARY OF OPINIONS', 'HISTORY AND COURSE OF TREATMENT', 'MEDICAL OPINIONS',
      'LIKELY FUTURE CARE', 'REASONABLENESS AND NECESSITY', 'CONCLUSION'].forEach(heading => {
      const pattern = heading === 'HISTORY AND COURSE OF TREATMENT'
        ? /^HISTORY AND COURSE OF (?:[A-Z]+ )?TREATMENT$/m
        : new RegExp('^' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm');
      ok(pattern.test(r.ids.mlsP1LegalDraft.value),
        'the narrative omitted ' + heading);
    });
    ['Causation:', 'Neuropathy:', 'Permanent and Stationary / Maximum Medical Improvement:', 'Future Care:'].forEach(label => {
      ok(r.ids.mlsP1LegalDraft.value.includes(label), 'the narrative omitted required opinion label ' + label);
    });
    ok(/History: .*Pertinent Examination: .*Assessment and Plan:/.test(r.ids.mlsP1LegalDraft.value),
      'the narrative history omitted the dated History/examination/assessment-plan labels');
    ok(!/XIV\. OPINIONS/.test(r.ids.mlsP1LegalDraft.value), 'the narrative report printed an OPINIONS section');
    ok(/NARRATIVE FORM: Aim for the density of a polished four-to-seven-page physician narrative/.test(r.pendingAi[0].sys),
      'the Luna prompt does not carry the compact reference-report form');
    ok(/select only clinically meaningful events/.test(r.pendingAi[0].sys) && /a complaint alone is not an independent diagnosis/.test(r.pendingAi[0].sys) &&
      /enumerate every concrete source gap/.test(r.pendingAi[0].sys) && /Pertinent Examination:/.test(r.pendingAi[0].sys),
      'the narrative prompt lost selective chronology or diagnostic-reasoning guidance');
    eq(r.pendingAi[0].opts.family, 'legal_ime', 'the narrative request did not use the legal_ime family');
    eq(r.pendingAi[0].opts.draftSubtype, 'narrative_medical_report', 'the narrative request did not use its explicit subtype');
    ok(/^ATTESTATION$/m.test(r.ids.mlsP1LegalDraft.value),
      'the narrative report lost its unnumbered signature attestation');
    ok(/This is an unsigned draft for clinician review\. It does not constitute a final medical-legal opinion unless verified, adopted, and signed by/.test(r.ids.mlsP1LegalDraft.value),
      'the narrative report lost its deterministic target-style unsigned guard');
  }

  /* Concrete source limitations named by a supplied record must survive as
     concrete PURPOSE language. A generic "source limitations" sentence is
     rejected once the packet itself identifies the missing source categories. */
  {
    const r = makeRuntime();
    r.api.open(); r.api.pickReport('narrative');
    r.api.addFiles([{ name: 'source-limitations.txt', type: 'text/plain', size: 240, text: () => Promise.resolve(
      'The source supplied for this report is an unsigned summary rather than the complete underlying chart. The accident history, original radiology report, and selected contemporaneous examination and treatment details should be verified before adoption or signing.'
    ) }]);
    await flush();
    eq(r.api.state().sourceCount, 1, 'the concrete source-gap fixture did not settle into the packet');
    const promise = r.api.generateDraft(); await flush();
    eq(r.pendingAi.length, 1, 'the source-gap narrative did not make one initial coherent request');
    r.pendingAi[0].resolve(wholeReportResponse(r.pendingAi[0], report => {
      report.sections.find(section => section.heading === 'PURPOSE AND SCOPE').paragraphs = [{
        text: 'This physician narrative addresses the requested medical issues using the records provided, with source limitations requiring clinician verification.', evidenceIds: ['P000']
      }];
    }));
    await flush();
    eq(r.pendingAi.length, 2, 'a generic source-limit sentence was not rejected when the packet named concrete gaps');
    ok(/concrete source gap|source summary|accident history|original radiology/i.test(r.pendingAi[1].sys),
      'the source-gap repair did not name the concrete missing categories');
    r.pendingAi[1].resolve(wholeReportResponse(r.pendingAi[1]));
    eq(await promise, true, 'the source-gap narrative did not complete after its bounded repair');
  }

  /* Imaging/procedure entries retain natural evidence prose. They must not be
     padded with clinical-encounter labels that imply an examination occurred
     or that a plan was documented. */
  {
    const r = makeRuntime({ patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [
      { date: '2025-02-02', type: 'Lumbar MRI', provider: 'M Synthetic', detail: 'Lumbar MRI demonstrated a documented disc finding; treatment response was not documented.' }
    ], docs: [] }, { id: 'B', name: 'Synthetic Beta', dob: '03/04/1990', mrn: 'TEST-B', visits: [] }, { id: 'C', name: 'Synthetic Gamma', dob: '05/06/1975', mrn: 'MRN-9001', visits: [] }] });
    r.api.open(); r.api.pickReport('narrative');
    const promise = r.api.generateDraft(); await flush();
    r.pendingAi[0].resolve(wholeReportResponse(r.pendingAi[0], (report, meta) => {
      const history = report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT');
      history.paragraphs = [{ text: '2025-02-02 - Lumbar MRI: History: Not documented in the records reviewed. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.', evidenceIds: [meta.evidenceIds.find(id => /^E/.test(id))] }];
    }));
    await flush();
    eq(r.pendingAi.length, 2, 'imaging boilerplate was accepted as a clinical encounter paragraph');
    ok(/imaging\/procedure entry|clinical-label boilerplate/i.test(r.pendingAi[1].sys), 'the imaging repair did not name the natural-entry defect');
    r.pendingAi[1].resolve(wholeReportResponse(r.pendingAi[1]));
    eq(await promise, true, 'the imaging narrative did not complete after its bounded repair');
  }

  /* Strict JSON alone used to let polished-looking nonsense through. The
     reference-form validator must reject a purpose with no scope/limits, an
     unlabeled opinion with no certainty standard, and an unstructured future-
     care suggestion; each receives only the existing one bounded repair. */
  for (const qualityCase of [
    {
      name: 'scope and source limits', heading: 'PURPOSE AND SCOPE',
      text: 'Synthetic Alpha has medical issues discussed in this physician report.',
      error: /both the requested scope and the source limitations/i
    },
    {
      name: 'labeled opinion and certainty', heading: 'SUMMARY OF OPINIONS',
      text: 'Synthetic Alpha is the bound patient whose requested medical opinion is addressed.',
      error: /one issue-labeled paragraph per opinion|certainty standard/i
    },
    {
      name: 'numbered conditional future care', heading: 'LIKELY FUTURE CARE',
      text: 'Future care for Synthetic Alpha may include clinical follow-up if the treating clinician recommends it.',
      error: /separately numbered paragraph/i
    }
  ]) {
    const r = makeRuntime();
    r.api.open(); r.api.pickReport('narrative');
    const promise = r.api.generateDraft(); await flush();
    eq(r.pendingAi.length, 1, qualityCase.name + ': first narrative request was not singular');
    r.pendingAi[0].resolve(wholeReportResponse(r.pendingAi[0], report => {
      const section = report.sections.find(candidate => candidate.heading === qualityCase.heading);
      section.paragraphs = [{ text: qualityCase.text, evidenceIds: ['P000'] }];
    }));
    await flush();
    eq(r.pendingAi.length, 2, qualityCase.name + ': invalid structured prose did not receive one repair');
    ok(qualityCase.error.test(r.pendingAi[1].sys), qualityCase.name + ': repair did not name the quality defect');
    eq(r.ids.mlsP1LegalDraft.value, '', qualityCase.name + ': rejected narrative was painted before repair');
    r.pendingAi[1].resolve(wholeReportResponse(r.pendingAi[1]));
    eq(await promise, true, qualityCase.name + ': valid bounded repair did not complete');
    eq(r.pendingAi.length, 2, qualityCase.name + ': repair escaped its one-attempt bound');
  }

  /* A JSON envelope and a real allowlisted ID are not proof. Exercise the
     adversarial narrative cases that previously survived the client check:
     mixed missing/factual clauses, identity-only or one-word citations,
     unauthored first person, novel/reversed conclusions, and history prose
     that does not lead with the cited encounter's date plus type. */
  for (const adversarial of [
    {
      name: 'missing-language factual tail', error: /without an evidence ID|affirmative clinical claim/i,
      mutate(report) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: 'The records reviewed do not document a lumbar operation; however, the patient underwent lumbar fusion surgery.', evidenceIds: []
        }];
      }
    },
    {
      name: 'P000 clinical laundering', error: /clinical evidence|patient-identity evidence/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: meta.patientName + ' underwent lumbar fusion surgery and was diagnosed with radiculopathy.', evidenceIds: ['P000']
        }];
      }
    },
    {
      name: 'one-word clinical laundering', error: /clinical evidence|fewer than two concrete facts/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: 'The office visit proves ' + meta.patientName + ' underwent lumbar fusion surgery.',
          evidenceIds: [meta.evidenceIds.find(id => /^E/.test(id))]
        }];
      }
    },
    {
      name: 'unsupported diagnosis hidden behind generic overlap', error: /clinical diagnosis, finding, or procedure not present/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: The patient had diabetes and reported pain during follow-up. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'uncommon Parkinson diagnosis hidden behind generic overlap', error: /diagnosis concept not present/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: The patient had Parkinson disease and reported pain during follow-up. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'uncommon Ehlers-Danlos diagnosis hidden behind generic overlap', error: /diagnosis concept not present/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: The patient was diagnosed with Ehlers-Danlos syndrome and reported pain during follow-up. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'record-establishes uncommon diagnosis', error: /diagnosis concept not present/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: The records establish Parkinson disease, and the patient reported pain during follow-up. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'reverse documented uncommon diagnosis', error: /diagnosis concept not present/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: Parkinson disease is documented, and the patient reported pain during follow-up. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'uncued possessive diagnosis', error: /diagnosis concept not present/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: The patient\'s Parkinson disease caused persistent symptoms during follow-up. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'uncued affirmative disease concept', error: /diagnosis concept not present/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: Parkinson disease caused persistent symptoms during follow-up. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'affirmative diagnosis from negated source', error: /supported only by negated evidence/i,
      runtime: { patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
        date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic', detail: 'No Parkinson disease was documented. The patient had lumbar radiculopathy.'
      }] }] },
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: Parkinson disease is documented. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'affirmative diagnosis from possible evaluation', error: /supported only by uncertain evidence/i,
      runtime: { patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
        date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic', detail: 'The patient was evaluated for possible Parkinson disease and found to have lumbar radiculopathy.'
      }] }] },
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: Parkinson disease is documented. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'affirmative diagnosis from suspected source', error: /supported only by uncertain evidence/i,
      runtime: { patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
        date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic', detail: 'Parkinson disease was suspected; lumbar radiculopathy was documented.'
      }] }] },
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: Parkinson disease is documented. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'affirmative diagnosis from differential source', error: /supported only by uncertain evidence/i,
      runtime: { patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
        date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic', detail: 'Parkinson disease was listed in the differential diagnosis; lumbar radiculopathy was documented.'
      }] }] },
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: Parkinson disease is documented. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'affirmative diagnosis from rule-out source', error: /supported only by (?:negated|uncertain) evidence/i,
      runtime: { patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
        date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic', detail: 'The record documents rule-out Parkinson disease; lumbar radiculopathy was documented.'
      }] }] },
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: Parkinson disease is documented. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'unsupported laterality', error: /laterality not present/i,
      runtime: { patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
        date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic', detail: 'The patient has right lumbar radiculopathy. Moderate pain was documented.'
      }] }] },
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: The patient had left lumbar radiculopathy. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'unsupported severity', error: /severity not present/i,
      runtime: { patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
        date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic', detail: 'The patient has lumbar radiculopathy. Moderate pain was documented.'
      }] }] },
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 - Office visit: History: The patient had severe lumbar radiculopathy. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'unsupported negative causation', error: /negative causation opinion without explicit support/i,
      mutate(report, meta) {
        const ids = meta.evidenceIds.filter(id => /^E/.test(id));
        const summary = report.sections.find(section => section.heading === 'SUMMARY OF OPINIONS');
        summary.paragraphs = [{
          text: 'Causation: To a reasonable degree of medical certainty, the documented lumbar strain is not causally related to the supplied records.', evidenceIds: ids
        }].concat(summary.paragraphs.filter(paragraph => !/^Causation:/i.test(paragraph.text)));
      }
    },
    {
      name: 'unsupported negative necessity', error: /negative necessity opinion without explicit support/i,
      mutate(report, meta) {
        const ids = meta.evidenceIds.filter(id => /^E/.test(id));
        const opinions = report.sections.find(section => section.heading === 'MEDICAL OPINIONS');
        opinions.paragraphs = [{
          text: 'Medical Necessity: To a reasonable degree of medical certainty, the documented therapy was not medically necessary.', evidenceIds: ids
        }].concat(opinions.paragraphs);
      }
    },
    {
      name: 'conditional negative necessity without support', error: /negative necessity opinion without explicit support/i,
      mutate(report, meta) {
        const ids = meta.evidenceIds.filter(id => /^E/.test(id));
        const opinions = report.sections.find(section => section.heading === 'MEDICAL OPINIONS');
        opinions.paragraphs = [{
          text: 'Medical Necessity: Conditional upon the current record, the documented therapy is not medically necessary unless later records show a qualifying indication.', evidenceIds: ids
        }].concat(opinions.paragraphs);
      }
    },
    {
      name: 'affirmative causation without causation evidence', error: /affirmative causation opinion without explicit support/i,
      mutate(report, meta) {
        const ids = meta.evidenceIds.filter(id => /^E/.test(id));
        const summary = report.sections.find(section => section.heading === 'SUMMARY OF OPINIONS');
        summary.paragraphs = [{
          text: 'Causation: To a reasonable degree of medical certainty, the documented lumbar strain, pain, and therapy are causally related.', evidenceIds: ids
        }].concat(summary.paragraphs.filter(paragraph => !/^Causation:/i.test(paragraph.text)));
      }
    },
    {
      name: 'unauthored first-person examination', error: /first-person examination or treatment claim/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: 'I examined and treated ' + meta.patientName + ' during the documented office visit.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'conclusion adds a new clinical fact', error: /CONCLUSION introduced a clinical fact or opinion/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'CONCLUSION').paragraphs = [{
          text: 'The documented therapy and lumbar strain support the final synthesis from the supplied record.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'conclusion reverses opinion polarity', error: /CONCLUSION reversed the polarity of the causation opinion/i,
      runtime: { patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
        date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic',
        detail: 'The documented incident caused a lumbar strain and was recorded as causally related. Pain and therapy continued.'
      }] }] },
      mutate(report, meta) {
        const ids = meta.evidenceIds.filter(id => /^E/.test(id));
        const summary = report.sections.find(section => section.heading === 'SUMMARY OF OPINIONS');
        const opinions = report.sections.find(section => section.heading === 'MEDICAL OPINIONS');
        summary.paragraphs = [{
          text: 'Causation: To a reasonable degree of medical certainty, the documented lumbar strain is causally related to the course represented in the supplied evidence.', evidenceIds: ids
        }].concat(summary.paragraphs.filter(paragraph => !/^Causation:/i.test(paragraph.text)));
        opinions.paragraphs = [{
          text: 'Causation: To a reasonable degree of medical certainty, pain and therapy records support the relationship for the lumbar strain.', evidenceIds: ids
        }].concat(opinions.paragraphs.filter(paragraph => !/^Causation:/i.test(paragraph.text)));
        report.sections.find(section => section.heading === 'CONCLUSION').paragraphs = [{
          text: 'Causation: To a reasonable degree of medical certainty, the lumbar strain is not related to the documented pain and therapy.', evidenceIds: ids
        }];
      }
    },
    {
      name: 'history date is not the prefix', error: /documented date and encounter type/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: meta.patientName + ' attended the documented office visit for pain and continued therapy on 2025-02-02.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    },
    {
      name: 'history prefix omits encounter type', error: /documented date and encounter type/i,
      mutate(report, meta) {
        report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
          text: '2025-02-02 ' + meta.patientName + ' reported pain and continued therapy.',
          evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
        }];
      }
    }
  ]) {
    const r = makeRuntime(adversarial.runtime || {}); r.api.open(); r.api.pickReport('narrative');
    const promise = r.api.generateDraft(); await flush();
    r.pendingAi[0].resolve(wholeReportResponse(r.pendingAi[0], adversarial.mutate));
    await flush();
    eq(r.pendingAi.length, 2, adversarial.name + ': invalid first response did not receive exactly one repair');
    ok(adversarial.error.test(r.pendingAi[1].sys), adversarial.name + ': repair did not name the validator defect: ' + r.pendingAi[1].sys.slice(-260));
    eq(r.ids.mlsP1LegalDraft.value, '', adversarial.name + ': invalid prose painted before repair');
    r.pendingAi[1].resolve(wholeReportResponse(r.pendingAi[1]));
    eq(await promise, true, adversarial.name + ': valid bounded repair did not complete');
    eq(r.pendingAi.length, 2, adversarial.name + ': repair escaped its one-attempt bound');
  }

  /* Concept grounding is normalized on both sides of the evidence boundary:
     a faithful Parkinson's/Parkinson spelling variant and an uncommon
     Ehlers-Danlos diagnosis are valid when the cited chart actually contains
     the same concepts. */
  for (const supported of [
    { label: 'Parkinson possessive normalization', source: 'The patient has Parkinson\'s disease documented.', claim: 'Parkinson disease is documented.' },
    { label: 'Ehlers-Danlos supported concept', source: 'The patient has Ehlers-Danlos syndrome documented.', claim: 'Ehlers-Danlos syndrome is documented.' },
    { label: 'later explicit Parkinson confirmation', source: 'The patient was evaluated for possible Parkinson disease. A later report confirmed Parkinson disease.', claim: 'Parkinson disease is documented.' },
    { label: 'confirmed diagnosis with unrelated negation', source: 'Parkinson disease was documented, with no fever.', claim: 'Parkinson disease is documented.' },
    { label: 'uncued possessive supported concept', source: 'The patient\'s Parkinson disease was documented.', claim: 'The patient\'s Parkinson disease caused persistent symptoms.' }
  ]) {
    const r = makeRuntime({ patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
      date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic', detail: supported.source
    }] }] });
    r.api.open(); r.api.pickReport('narrative');
    const promise = r.api.generateDraft(); await flush();
    r.pendingAi[0].resolve(wholeReportResponse(r.pendingAi[0], (report, meta) => {
      report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
        text: '2025-02-02 - Office visit: History: ' + supported.claim + ' Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.',
        evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
      }];
    }));
    await flush();
    eq(await promise, true, supported.label + ' was incorrectly rejected');
    eq(r.pendingAi.length, 1, supported.label + ' triggered a needless repair');
  }

  /* Negative opinions are allowed only when the cited record explicitly
     supports that issue. */
  for (const supported of [
    {
      label: 'supported negative causation',
      source: 'The record documents that the lumbar strain was not causally related to the reported incident.',
      heading: 'SUMMARY OF OPINIONS',
      text: 'Causation: To a reasonable degree of medical certainty, the lumbar strain is not causally related to the reported incident.'
    },
    {
      label: 'supported negative necessity',
      source: 'The record documents that the therapy was not medically necessary because no indication was documented.',
      heading: 'MEDICAL OPINIONS',
      text: 'Medical Necessity: To a reasonable degree of medical certainty, the therapy was not medically necessary.'
    }
  ]) {
    const r = makeRuntime({ patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
      date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic', detail: supported.source
    }] }] });
    r.api.open(); r.api.pickReport('narrative');
    const promise = r.api.generateDraft(); await flush();
    r.pendingAi[0].resolve(wholeReportResponse(r.pendingAi[0], (report, meta) => {
      const section = report.sections.find(candidate => candidate.heading === supported.heading);
      section.paragraphs = [{ text: supported.text, evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id)) }].concat(section.paragraphs.filter(paragraph => supported.label === 'supported negative causation' ? !/^Causation:/i.test(paragraph.text) : true));
      if (supported.label === 'supported negative causation') {
        const opinions = report.sections.find(candidate => candidate.heading === 'MEDICAL OPINIONS');
        opinions.paragraphs = [{ text: 'Causation: To a reasonable degree of medical certainty, the documented lumbar strain is not causally related to the reported incident based on the cited evidence.', evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id)) }].concat(opinions.paragraphs.filter(paragraph => !/^Causation:/i.test(paragraph.text)));
        report.sections.find(candidate => candidate.heading === 'CONCLUSION').paragraphs = [{ text: 'Causation: The supplied record is not causally related to the lumbar strain.', evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id)) }];
      }
    }));
    await flush();
    eq(await promise, true, supported.label + ' was incorrectly rejected');
    eq(r.pendingAi.length, 1, supported.label + ' triggered a needless repair');
  }

  /* First person remains available when the cited record actually names the
     report author and documents that author's examination/treatment. */
  {
    const r = makeRuntime({
      patients: [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [{
        date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic',
        detail: 'M Synthetic examined and treated Synthetic Alpha for lumbar strain with therapy.'
      }] }],
      notes: {}, readers: { getProviderName: () => 'M Synthetic' }
    });
    r.api.open(); r.api.pickReport('narrative');
    const promise = r.api.generateDraft(); await flush();
    r.pendingAi[0].resolve(wholeReportResponse(r.pendingAi[0], (report, meta) => {
      report.sections.find(section => section.heading === 'HISTORY AND COURSE OF TREATMENT').paragraphs = [{
        text: '2025-02-02 - Office visit: History: I examined and treated Synthetic Alpha for documented lumbar strain with therapy. Pertinent Examination: I documented the examination. Assessment and Plan: I continued therapy.',
        evidenceIds: meta.evidenceIds.filter(id => /^E/.test(id))
      }];
    }));
    eq(await promise, true, 'documented report-author examination was rejected');
    eq(r.pendingAi.length, 1, 'documented report-author examination unnecessarily triggered repair');
  }

  /* The visible Legal choice, not the global note preference, is forwarded
     on the whole-report request. The finished draft records what the server
     actually served and discloses a fallback. */
  for (const modelCase of [
    { button: 'mlsP1LegalModelLuna', requested: 'gpt-5.6-luna', served: 'gpt-4o', fallback: true },
    { button: 'mlsP1LegalModelFast', requested: 'gpt-4o', served: 'gpt-4o', fallback: false }
  ]) {
    const r = makeRuntime(); r.api.open(); r.api.pickReport('narrative');
    r.ids[modelCase.button].listeners.click();
    const promise = r.api.generateDraft(); await flush();
    eq(r.pendingAi[0].opts.model, modelCase.requested, modelCase.button + ' did not forward its visible model choice');
    r.window.__mlsLastAiModel = modelCase.served;
    r.pendingAi[0].resolve(wholeReportResponse(r.pendingAi[0]));
    eq(await promise, true, modelCase.button + ' draft did not complete');
    ok(r.ids.mlsP1LegalDraft.value.includes('AI model used: ' + modelCase.served + ' (1 draft attempt)'), modelCase.button + ' omitted the served-model receipt');
    eq(/NOTE: this differs from the model you selected/.test(r.ids.mlsP1LegalDraft.value), modelCase.fallback,
      modelCase.button + ' fallback disclosure was not honest');
  }

  /* The records-chronology type calls NO model at all. */
  {
    const r = makeRuntime();
    r.api.open(); r.api.pickReport('chronology');
    eq(await r.api.generateDraft(), true, 'the deterministic chronology report did not complete');
    eq(r.pendingAi.length, 0, 'the deterministic chronology report called AI');
    eq(r.stage(), 'generated', 'the deterministic report did not advance the flow');
    const out = r.ids.mlsP1LegalDraft.value;
    ok(/READ-ONLY MEDICAL-LEGAL CHRONOLOGY/.test(out), 'the chronology report does not contain the chronology');
    ok(/^SOURCE ATTESTATION$/m.test(out),
      'the chronology report lost its source-limited signature attestation');
    ok(/UNSIGNED DRAFT/.test(out), 'the chronology report lost its unsigned-draft framing');
    ok(out.indexOf('[The practice name is not configured') === 0, 'the chronology report does not lead with the letterhead');
  }

  /* An API caller that never picks a type still gets the IME document, and the
     state then SAYS ime rather than leaving the receipt blank. */
  {
    const r = makeRuntime();
    r.api.open();
    eq(r.api.state().reportType, '', 'the workspace pre-picked a report type');
    const promise = r.api.generateDraft();
    await resolveWholeReport(r);
    eq(await promise, true, 'the default generation did not complete');
    eq(r.pendingAi.length, 1, 'the default IME report made other than one coherent AI call');
    eq(promptJson(r.pendingAi[0], 'Expected sections: ', '. Evidence-ID allowlist: ').length, 14,
      'the default coherent report is no longer the 14-section IME');
    eq(r.api.state().reportType, 'ime', 'the default run did not record which type it used');
  }

  /* ==========================================================================
     5. The room contract the next-step glow lane wires against
     ======================================================================== */
  {
    const r = makeRuntime();
    r.api.open();
    eq(r.root().getAttribute('role'), 'dialog', 'the room root stopped being the dialog');
    ok(r.root().getAttribute('data-mls-legal-state') !== null, 'the room root publishes no flow state');
    ['bind', 'report', 'generate', 'export'].forEach(step => {
      ok(r.root().innerHTML.indexOf('data-mls-legal-step="' + step + '"') >= 0,
        'the room does not mark its ' + step + ' step for the glow lane');
    });

    /* This fixture hands the module its control nodes directly, so it would
       NOT notice a control the shell markup never renders. Cross-check the
       painted markup against every id the module actually looks up, and
       against the fixture's own list, so neither can drift silently. */
    const painted = new Set();
    let hit; const idRe = /id="(mlsP1Legal[A-Za-z0-9]*)"/g;
    while ((hit = idRe.exec(r.root().innerHTML)) !== null) painted.add(hit[1]);
    const looked = new Set();
    const lookRe = /byId\('(mlsP1Legal[A-Za-z0-9]*)'\)/g;
    while ((hit = lookRe.exec(source)) !== null) looked.add(hit[1]);
    /* ids painted later by a renderer, not by the one-time shell */
    /* p1-legal-readlive-1.0.0: the live read line is painted by renderReadOps,
       like the day box beside it — always present, shown only while a read is
       running, so this drift guard can still see it. */
    const RENDERED_LATER = ['mlsP1LegalChange', 'mlsP1LegalRosterSearch', 'mlsP1LegalRosterResults', 'mlsP1LegalReadDay', 'mlsP1LegalReadLive'];
    deep([...looked].filter(id => !painted.has(id) && RENDERED_LATER.indexOf(id) < 0).sort(), [],
      'the module looks up a control the shell markup never renders');
    deep([...painted].filter(id => !Object.prototype.hasOwnProperty.call(UI_IDS, id) &&
      /* static labels/landmarks, never looked up or wired */
      ['mlsP1LegalTitle', 'mlsP1LegalFileHelp', 'mlsP1LegalLetterhead', 'mlsP1LegalDraftLabel'].indexOf(id) < 0).sort(), [],
      'the shell renders a control this fixture never supplies, so its wiring is untested');
    RENDERED_LATER.forEach(id => {
      const host = id === 'mlsP1LegalChange' ? r.ids.mlsP1LegalBanner
        : ((id === 'mlsP1LegalReadDay' || id === 'mlsP1LegalReadLive') ? r.ids.mlsP1LegalReadOps : r.ids.mlsP1LegalRoster);
      ok(host.innerHTML.indexOf('id="' + id + '"') >= 0, 'the renderer never paints ' + id);
    });
  }

  /* ==========================================================================
     6. p1-legal-stepper-1.0.0 - "I open the legal page and I have no idea
        where to go next, and this patient data should start collapsed."
     ======================================================================== */
  {
    const r = makeRuntime({ activeId: '' });
    r.api.open();
    /* the stepper states all four steps, up front, with the current one marked */
    const stepper = r.ids.mlsP1LegalStepper.innerHTML;
    ['Bind patient', 'Pick report', 'Generate', 'Export'].forEach((label, i) => {
      ok(stepper.indexOf(label) >= 0, 'the stepper does not show step ' + (i + 1) + ' (' + label + ')');
    });
    ok(/data-state="current"[^>]*data-mls-legal-stepitem="bind"/.test(stepper) ||
      /data-mls-legal-stepitem="bind"[^>]*aria-current="step"/.test(stepper) ||
      /data-state="current"/.test(stepper), 'the stepper marks no current step');
    eq((stepper.match(/data-state="current"/g) || []).length, 1, 'more than one step is marked current');
    deep(r.api.flow(), { stage: 'unbound', step: 'bind', next: 'mlsP1LegalRosterSearch' },
      'the published flow receipt is wrong while unbound');
    eq(r.root().getAttribute('data-mls-legal-next'), 'mlsP1LegalRosterSearch',
      'the room root does not publish the id of the next control for the glow lane');
  }

  /* the next-control id tracks the stage, and exactly one control wears it */
  {
    const r = makeRuntime();
    r.api.open();
    eq(r.api.flow().next, 'mlsP1LegalReport_ime', 'a bound patient does not point at the report picker');
    ok(/id="mlsP1LegalReport_ime"/.test(r.ids.mlsP1LegalReportTypes.innerHTML), 'the report picker has no stable per-type control id');
    ok(/id="mlsP1LegalReport_chronology"/.test(r.ids.mlsP1LegalReportTypes.innerHTML), 'not every report type has a stable control id');
    r.api.pickReport('ime');
    eq(r.api.flow().next, 'mlsP1LegalGenerate', 'a picked report does not point at Generate');
    eq(r.root().getAttribute('data-mls-legal-next'), 'mlsP1LegalGenerate', 'the room root did not republish the next control');
    /* until the shared glow lands, the next control carries its own emphasis
       and the stale one must give it up */
    ok(/p1l-nextctl/.test(r.ids.mlsP1LegalGenerate.className), 'the next control carries no local emphasis');
    ok(!/p1l-nextctl/.test(r.ids.mlsP1LegalRosterSearch ? r.ids.mlsP1LegalRosterSearch.className : ''), 'a stale next control kept its emphasis');
    const promise = r.api.generateDraft();
    await resolveWholeReport(r);
    await promise;
    eq(r.api.flow().next, 'mlsP1LegalDraftDownload', 'a generated draft does not point at an export');
    ok(/p1l-nextctl/.test(r.ids.mlsP1LegalDraftDownload.className), 'the export control carries no emphasis');
    ok(!/p1l-nextctl/.test(r.ids.mlsP1LegalGenerate.className), 'Generate kept the emphasis after it was used');
    r.ids.mlsP1LegalDraftDownload.listeners.click(); await flush();
    eq(r.api.flow(), null, 'a finished flow still points somewhere');
  }

  /* EVERYTHING below the header starts collapsed; only the current step opens */
  {
    const r = makeRuntime({ activeId: '' });
    r.api.open();
    CARD_KEYS.forEach(key => {
      const suffix = key.charAt(0).toUpperCase() + key.slice(1);
      eq(r.ids['mlsP1LegalBody' + suffix].hidden, true, 'the ' + key + ' card did not start collapsed');
      eq(r.ids['mlsP1LegalDisclose' + suffix].getAttribute('aria-expanded'), 'false', 'the ' + key + ' card lies about being collapsed');
      eq(r.ids['mlsP1LegalCue' + suffix].textContent, 'Expand', 'the ' + key + ' card offers no Expand affordance');
    });
    /* a bound patient's default view is the stepper + the report picker */
    r.api.bindTo('C');
    eq(r.ids.mlsP1LegalBodyReport.hidden, false, 'binding a patient did not open the report picker');
    eq(r.ids.mlsP1LegalBodyChronology.hidden, true, 'binding a patient dumped the chronology on screen');
    eq(r.ids.mlsP1LegalBodyDraft.hidden, true, 'binding a patient opened the draft card');
    eq(r.ids.mlsP1LegalBodyGenerate.hidden, true, 'binding a patient opened the generate card');
    /* the current step auto-opens as the flow advances */
    r.api.pickReport('ime');
    eq(r.ids.mlsP1LegalBodyGenerate.hidden, false, 'picking a report did not open the step it points at');
    eq(r.ids.mlsP1LegalBodyChronology.hidden, true, 'picking a report opened the raw chronology');
    /* a card the clinician opens is never force-closed by a later stage */
    eq(r.api.toggleCard('chronology'), true, 'the chronology card could not be opened by hand');
    eq(r.ids.mlsP1LegalBodyChronology.hidden, false, 'the hand-opened card stayed hidden');
    eq(r.ids.mlsP1LegalCueChronology.textContent, 'Collapse', 'an open card still offers Expand');
    r.api.pickReport('narrative');
    eq(r.ids.mlsP1LegalBodyChronology.hidden, false, 'a stage change force-closed a card the clinician opened');
    eq(r.api.toggleCard('nope'), false, 'an unknown card key was accepted');
    /* the one-line summaries are what a collapsed card shows */
    ok(/entr(y|ies)/.test(r.ids.mlsP1LegalSumChronology.textContent), 'the collapsed chronology has no entry-count summary');
    ok(/compiled /.test(r.ids.mlsP1LegalSumChronology.textContent), 'the collapsed chronology does not say when it was compiled');
    ok(/no local files/.test(r.ids.mlsP1LegalSumRecords.textContent), 'the collapsed local-records card has no summary');
    ok(/Medical-legal narrative/.test(r.ids.mlsP1LegalSumReport.textContent), 'the collapsed report card does not name the pick');
  }

  /* Each encounter is collapsed to its date/type line, not a raw dump. */
  {
    const r = makeRuntime();
    r.api.open(); r.api.toggleCard('chronology', true);
    const html = r.ids.mlsP1LegalChronology.innerHTML;
    const heads = (html.match(/data-row-toggle="/g) || []).length;
    const bodies = (html.match(/class="p1l-rowbody" id="mlsP1LegalRowBody\d+" hidden/g) || []).length;
    ok(heads > 0, 'the chronology renders no collapsible encounter rows');
    eq(bodies, heads, 'an encounter body was rendered already expanded');
    ok(/Office visit</.test(html), 'the collapsed row does not show the encounter type');
    ok(!/Pain follow-up\./.test(html.replace(/<pre[\s\S]*?<\/pre>/g, '')), 'the encounter body leaked outside its collapsed body');
  }

  /* ==========================================================================
     7. p1-legal-scrub-1.0.0 - the owner's EXACT screenshot samples
     ======================================================================== */
  {
    const r = makeRuntime();
    const scrub = r.api.scrubBody;
    /* sample A: athenaOne page chrome stored as an encounter body */
    const A = 'Office visit 02-02-2025\nrecently edited this chart at . Refresh to view the most current information.REFRESH CHART\nPatient reports 6/10 low back pain radiating to the left calf.';
    const a = scrub(A);
    ok(!/REFRESH CHART/.test(a.text), 'the athenaOne refresh banner survived into the displayed body');
    ok(!/recently edited this chart/.test(a.text), 'the "recently edited this chart" banner survived');
    ok(/6\/10 low back pain radiating to the left calf/.test(a.text), 'the scrubber deleted the clinical line');
    eq(a.chrome, 1, 'the chrome line count is wrong');
    eq(a.code, 0, 'a chrome line was miscounted as script');
    eq(a.raw, A, 'the raw body was not preserved verbatim');

    /* THE SHAPE THE SCREENSHOT ACTUALLY SHOWS: the banner is on the SAME line
       as clinical text. A line-level stoplist deletes the clinical sentence
       with the banner - the defect class this cut-the-phrase rule exists for. */
    const inline = scrub('Assessment: lumbar radiculopathy. recently edited this chart at . Refresh to view the most current information.REFRESH CHART');
    ok(/Assessment: lumbar radiculopathy\./.test(inline.text),
      'a banner sharing a line with clinical text took the clinical text with it');
    ok(!/REFRESH CHART|recently edited/.test(inline.text), 'the inline banner survived');
    eq(inline.refused, false, 'the inline case fell back to raw instead of cleaning');

    /* sample B: a <script> tag's text stored as an encounter body */
    const B = 'Print Premier Ortho and Philadelphia Hand to Shoulder • 100 Example Rd\n' +
      'window.Original = {}; window.Original.IsSafari = IsSafari;\n' +
      'IsSafari = function(){ return 0; }\n' +
      'Jotter = function(params) { var svgjottercontainerid = params.div; }\n' +
      'Impression: L5-S1 disc herniation with left S1 radiculopathy.';
    const b = scrub(B);
    ok(!/window\.Original/.test(b.text), 'captured script text survived into the displayed body');
    ok(!/IsSafari/.test(b.text), 'captured script text survived into the displayed body');
    ok(!/Jotter/.test(b.text), 'captured script text survived into the displayed body');
    ok(!/svgjottercontainerid/.test(b.text), 'captured script text survived into the displayed body');
    ok(!/Print Premier Ortho/.test(b.text), 'the print-header page furniture survived');
    ok(/L5-S1 disc herniation with left S1 radiculopathy\./.test(b.text), 'the scrubber deleted the clinical impression');
    ok(b.removed >= 2, 'the scrubber under-counted what it removed: ' + b.removed);
    eq(b.raw, B, 'the raw body was not preserved verbatim');

    /* The SHARED production token walker is preferred when it is loaded,
       because the captured script is usually interleaved with the note on ONE
       long line - exactly the owner's screenshot. Prove the delegation, and
       prove the clinical tail survives it. */
    {
      const withShared = makeRuntime({ readers: { __mlsVisitModel: {
        getVisits: p => (p && p.visits) || [],
        _stripPageDebris: text => String(text).replace(/window\.[\s\S]*?params\.div;\s*\}/g, ' ')
      } } });
      const s = withShared.api.scrubBody(
        'Print Premier Ortho window.Original = {}; IsSafari = function(){ return 0; } Jotter = function(params) { var svgjottercontainerid = params.div; } Impression: L5-S1 herniation.');
      eq(s.shared, true, 'the shared production debris stripper was not used when it was available');
      ok(/Impression: L5-S1 herniation\./.test(s.text), 'delegating to the shared stripper lost the clinical tail');
      ok(!/window\.Original|svgjottercontainerid/.test(s.text), 'delegating to the shared stripper left script text');
    }
    /* and with no shared stripper loaded, the local fallback still runs */
    eq(scrub('window.Original = {};\nImpression: intact.').shared, false,
      'the fallback claimed to have used a stripper that is not loaded');

    /* NEVER delete a clinical line. These are the near-misses that a greedy
       pattern would have eaten - "loss of function (grade 3)" was the reason
       the code patterns require assignment or brace syntax. */
    [
      'Exam: loss of function (grade 3) in the left wrist.',
      'Patient function (ADLs) unchanged since the last visit.',
      'Discussed the variable response to the epidural injection.',
      'MRI window for repeat imaging is 6 weeks.',
      'The patient will print the work note at the front desk.',
      'Constant pain; variable at night.'
    ].forEach(line => {
      const kept = scrub('Header\n' + line + '\nFooter');
      ok(kept.text.indexOf(line) >= 0, 'the scrubber deleted a clinical line: ' + JSON.stringify(line));
      eq(kept.removed, 0, 'the scrubber flagged a clinical line: ' + JSON.stringify(line));
    });

    /* a body that is ENTIRELY junk falls back to raw rather than vanishing:
       a cleaner that silently empties an encounter is worse than the junk */
    const allJunk = scrub('REFRESH CHART\nrecently edited this chart at .');
    eq(allJunk.refused, true, 'an entirely-suppressed body did not fall back to raw');
    eq(allJunk.text, 'REFRESH CHART\nrecently edited this chart at .', 'the fallback did not show the raw text');
    eq(allJunk.removed, 0, 'the refused fallback still claimed to have removed lines');
    /* and an empty body stays empty without claiming anything */
    deep({ text: scrub('').text, removed: scrub('').removed, refused: scrub('').refused },
      { text: '', removed: 0, refused: false }, 'an empty body was mishandled');
  }

  /* End to end: the junk never reaches the screen or the export, the count is
     declared, and the raw text stays reachable. */
  {
    const junkPatient = [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A',
      visits: [{ date: '2025-02-02', type: 'Office visit', provider: 'M Synthetic',
        detail: 'recently edited this chart at . Refresh to view the most current information.REFRESH CHART\n' +
          'window.Original = {}; IsSafari = function(){ return 0; }\n' +
          'Assessment: lumbar radiculopathy, left S1.' }] }];
    const r = makeRuntime({ patients: junkPatient });
    r.api.open(); r.api.toggleCard('chronology', true);
    const painted = r.ids.mlsP1LegalChronology.innerHTML;
    ok(!/REFRESH CHART/.test(painted), 'the EMR banner reached the rendered chronology');
    ok(!/IsSafari/.test(painted), 'captured script text reached the rendered chronology');
    ok(/lumbar radiculopathy/.test(painted), 'the clinical assessment was lost from the rendered chronology');
    ok(/hidden as non-clinical/.test(painted), 'the suppression was silent on screen');
    ok(/data-row-raw="/.test(painted), 'there is no way to reach the raw text');

    const text = r.api.chronologyText();
    ok(!/REFRESH CHART/.test(text), 'the EMR banner reached the exported chronology');
    ok(!/IsSafari/.test(text), 'captured script text reached the exported chronology');
    ok(/lumbar radiculopathy/.test(text), 'the clinical assessment was lost from the exported chronology');
    ok(/DISPLAY NOTE: \d+ line\(s\)/.test(text), 'the export does not declare what it suppressed');
    ok(/the stored chart was not modified/.test(text), 'the export does not say the record itself is untouched');

    /* Show raw brings the exact stored bytes back, on demand */
    const rawButton = /data-row-raw="(\d+)"/.exec(painted);
    ok(rawButton, 'no raw toggle was rendered for a cleaned row');
    r.api.showRaw(rawButton[1], true);
    ok(/IsSafari/.test(r.ids.mlsP1LegalChronology.innerHTML), 'Show raw did not restore the exact stored text');
    r.api.showRaw(rawButton[1], false);
    ok(!/IsSafari/.test(r.ids.mlsP1LegalChronology.innerHTML), 'Show cleaned did not go back to the cleaned text');
  }

  /* ==========================================================================
     p1-legal-undated-1.0.0 - AN UNDATED ENTRY SAYS UNDATED, NEVER 1969

     MEASURED at HEAD in the real overlay (headless Chrome, synthetic chart):
     FIVE chronology rows read "Dec 31, 1969", the AT A GLANCE table printed
     "1969-12-31", and the exported .txt carried "Wednesday, December 31,
     1969". Cause: a note's only timestamp was a small number, and
     new Date(5) is five milliseconds after the Unix epoch - 1969-12-31
     anywhere west of Greenwich. A chronology a court reads must never invent
     a date. Executed here rather than grepped for.
     ======================================================================== */
  {
    /* Every shape that used to produce an epoch date, and every shape that
       must still date correctly, through the SAME ymd() the workspace uses. */
    const dated = [
      { id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A',
        visits: [
          { date: 0, type: 'Zero stamp', detail: 'A zero timestamp is a missing one.' },
          { date: 5, type: 'Tiny stamp', detail: 'Five milliseconds after the epoch is not a date.' },
          { date: 1755500000, type: 'Seconds not millis', detail: 'A seconds-based stamp must not print as 1970.' },
          { date: '2026', type: 'Bare year', detail: 'A year alone is not a day.' },
          { date: '', type: 'Empty', detail: 'Nothing at all.' },
          /* No body below may contain an epoch year as TEXT: the scan further
             down looks for one anywhere in the rendered and exported bytes,
             and a fixture that says the year out loud fails its own check. */
          { date: true, type: 'Boolean', detail: 'A boolean coerces to 1 and lands on the epoch.' },
          { date: NaN, type: 'NaN', detail: 'Not a number, and not a date either.' },
          { date: [0], type: 'Array of zero', detail: 'Coerces to a zero string and then to the epoch.' },
          /* and the ones that MUST keep their date */
          { date: '2026-02-11', type: 'ISO dated', detail: 'Documented.' },
          { date: '3/4/2026', type: 'US dated', detail: 'Documented.' },
          { date: 'Jan 5 1985', type: 'Old prose date', detail: 'A genuinely old outside record.' },
          { date: Date.UTC(2026, 6, 1) + 43200000, type: 'Real epoch millis', detail: 'A real Date.now() stamp.' }
        ] }
    ];
    const r = makeRuntime({ patients: dated, notes: { A: [] } });
    r.api.open();
    const model = r.api.buildModel(JSON.parse(JSON.stringify(dated[0])),
      { patientId: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A' });
    const byType = {};
    model.items.forEach(item => { byType[item.title] = item.date; });
    ['Zero stamp', 'Tiny stamp', 'Seconds not millis', 'Bare year', 'Empty',
      'Boolean', 'NaN', 'Array of zero'].forEach(type => {
      eq(byType[type], '', 'an undated entry ("' + type + '") was given the date ' + byType[type]);
    });
    eq(byType['ISO dated'], '2026-02-11', 'a documented ISO date was lost');
    eq(byType['US dated'], '2026-03-04', 'a documented US date was lost');
    eq(byType['Old prose date'], '1985-01-05',
      'a genuinely old prose date was refused by the epoch guard - the guard is too wide');
    eq(byType['Real epoch millis'], '2026-07-01', 'a real Date.now() stamp was refused by the epoch guard');

    /* And what the doctor actually READS: no 1969/1970 on screen or in either
       export, and the undated rows say so in a word. */
    r.api.toggleCard('chronology', true);
    const painted = r.ids.mlsP1LegalChronology.innerHTML;
    const text = r.api.chronologyText();
    [['the rendered chronology', painted], ['the exported chronology', text]].forEach(([where, blob]) => {
      ok(!/1969/.test(blob), 'an epoch date (1969) reached ' + where);
      ok(!/1970-01-0|Jan 1, 1970|January 1, 1970/.test(blob), 'an epoch date (1970) reached ' + where);
    });
    ok(/Undated/.test(painted), 'an undated row does not say "Undated" on screen');
    ok(/\(undated\)|Undated|Date not documented/.test(text), 'an undated row does not say so in the export');
  }
  {
    /* The date an encounter HAPPENED beats the date its row was last EDITED.
       The old code read `updated || created` only, so a note carrying its own
       service date was filed under whatever its modification stamp said. */
    const r = makeRuntime({
      notes: { A: [
        { patientId: 'A', date: '2026-05-18', updated: 5, signed: true, provider: 'M Synthetic, DO',
          soap: 'A:\nDocumented service date.\nPLAN:\nFollow-up in 3 months.' },
        { patientId: 'A', visitDate: '2026-06-02', created: 7, signed: true, provider: 'M Synthetic, DO',
          soap: 'A:\nOp-note visitDate.' },
        { patientId: 'A', updated: 0, signed: false, provider: 'M Synthetic, DO',
          soap: 'A:\nNo date of any kind.' }
      ] }
    });
    r.api.open();
    const dates = r.api.buildModel(
      { id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [] },
      { patientId: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A' })
      .items.filter(i => i.category === 'visit').map(i => i.date).sort();
    deep(dates, ['', '2026-05-18', '2026-06-02'],
      'a note was not dated by its own documented service date: ' + JSON.stringify(dates));
  }

  /* ==========================================================================
     p1-legal-readstop-1.0.0 - THE READ IS ESCAPABLE, AND ITS RECEIPT IS TRUE

     MEASURED at HEAD in the real overlay with no EMR tab and no Assist:
     "Pull a day of the schedule" held the workspace for 90,058 ms (timed)
     with Compile history, Generate report and Choose local files ALL
     disabled and no control of any kind that would let go - then settled
     claiming the read "finished. The patient list above was refreshed from
     this account's roster", for a read that brought back nothing.
     ======================================================================== */
  {
    let release = null, dayRuns = 0;
    const r = makeRuntime({ readers: { __mlsSI: { dayPull: () => { dayRuns++; return new Promise(res => { release = res; }); } } } });
    r.api.open(); r.api.pickReport('ime');
    r.api.runReadOp('day', {});
    await flush();
    eq(dayRuns, 1, 'the read did not start');
    eq(r.api.state().reading, 'day', 'a running read is not reported');
    eq(r.ids.mlsP1LegalCompile.disabled, true, 'Compile stayed live during a read');
    eq(r.ids.mlsP1LegalGenerate.disabled, true, 'Generate stayed live during a read');
    /* the way out is RENDERED, not just callable */
    ok(/data-read-stop="day"/.test(r.ids.mlsP1LegalReadOps.innerHTML),
      'a running read renders no "Stop the read" control - the workspace is wedged for as long as the reader hangs');
    ok(/Stop the read/.test(r.ids.mlsP1LegalReadOps.innerHTML), 'the stop control is not named in words');
    /* and the room says WHY it went quiet */
    ok(/wait while a read runs/.test(r.ids.mlsP1LegalReadOps.innerHTML),
      'the room does not say why Compile and Generate went quiet');

    eq(r.api.stopRead(), true, 'Stop the read did not stop the read');
    eq(r.api.state().reading, '', 'Stop the read left the read slot held');
    eq(r.ids.mlsP1LegalCompile.disabled, false, 'Compile stayed disabled after the read was stopped');
    eq(r.ids.mlsP1LegalGenerate.disabled, false, 'Generate stayed disabled after the read was stopped');
    ok(/was stopped/.test(r.ids.mlsP1LegalStatus.textContent), 'stopping the read said nothing');
    ok(!/data-read-stop=/.test(r.ids.mlsP1LegalReadOps.innerHTML), 'the Stop control outlived the read it stopped');

    /* THE OWNERSHIP BOUNDARY: the abandoned read comes back late and owns
       nothing. It must not re-disable the room, and it must not write a
       receipt over the one the clinician is reading. */
    const stoppedText = r.ids.mlsP1LegalStatus.textContent;
    release({ ok: true }); await flush();
    eq(r.api.state().reading, '', 'a stopped read re-took the read slot when it finally answered');
    eq(r.ids.mlsP1LegalGenerate.disabled, false, 'a stopped read re-disabled Generate when it finally answered');
    eq(r.ids.mlsP1LegalStatus.textContent, stoppedText, 'a stopped read wrote a receipt over the room it was let go of');
    eq(r.api.stopRead(), false, 'Stop the read claimed to stop a read that was not running');
  }
  /* ==========================================================================
     p1-legal-readlive-1.0.0 - THE LIVE LINE IS WHERE THE DOCTOR IS LOOKING

     MEASURED at HEAD: runReadOp's onStatus routed every progress line the
     delegate emits into setStatus, which writes #mlsP1LegalStatus. That node
     lives inside the GENERATE disclosure card, and autoExpandedFor() opens that
     card only at stage 'report-picked'. A read started at stage 'bound' - which
     is every read a doctor runs before picking a report type - narrated into a
     collapsed element for its entire duration. The settled verdict showed; the
     minutes in between showed nothing.
     ======================================================================== */
  {
    let say = null, release = null;
    const r = makeRuntime({ readers: { __mlsSI: { dayPull: (opts) => { say = opts && opts.onStatus; return new Promise(res => { release = res; }); } } } });
    r.api.open();                       /* deliberately NOT report-picked */
    r.api.runReadOp('day', {});
    await flush();
    /* the slot is painted where the doctor is looking - beside the control */
    ok(/id="mlsP1LegalReadLive"/.test(r.ids.mlsP1LegalReadOps.innerHTML),
      'the read-ops block renders no live line');
    ok(r.api.readLive().text.length > 0, 'the live line is blank while a read runs');
    ok(/elapsed/.test(r.api.readLive().text), 'the live line carries no elapsed stamp');

    /* the delegate's own words must land AT the control, not only in the
       collapsed status card */
    ok(typeof say === 'function', 'the day op was handed no onStatus to narrate through');
    say('Reading verified history 3 of 14…');
    ok(/Reading verified history 3 of 14/.test(r.api.readLive().text),
      'the live step never reached the read-ops block: ' + r.api.readLive().text);
    ok(/Reading verified history 3 of 14/.test(r.ids.mlsP1LegalStatus.textContent),
      'the existing status line must keep saying it too');

    /* the stall verdict, at the threshold the module publishes */
    eq(r.api.readLive().stallMs, 60000, 'the stall threshold moved');
    ok(!/no new step/.test(r.api.readLive().text), 'a fresh read must not read as stalled');
    r.api._readLiveBackdate(61000);
    const stalled = r.api.readLive().text;
    ok(/no new step for 1m 1s/.test(stalled), 'a 60s silence produced no stall verdict: ' + stalled);
    ok(/may be stuck/.test(stalled), 'the stall verdict does not name the likely cause');
    ok(/[Nn]othing has been written to the EMR/.test(stalled), 'the stall verdict does not say nothing was written');
    ok(/Stop the read/.test(stalled), 'the stall verdict does not point at the way out');
    /* a real step clears it */
    say('Reading verified history 4 of 14…');
    ok(!/no new step/.test(r.api.readLive().text), 'fresh progress did not clear the stall verdict');

    /* a stopped read stops narrating here too */
    eq(r.api.stopRead(), true, 'the read did not stop');
    eq(r.api.readLive().text, '', 'a stopped read left its live line on screen');
    release({ ok: true }); await flush();
    eq(r.api.readLive().text, '', 'an abandoned read narrated into the live line after it was let go');
  }
  {
    /* THE RECEIPT IS MEASURED. A day read that brings no patient must say so,
       and must never claim the list was "refreshed". */
    const r = makeRuntime({ readers: { __mlsSI: { dayPull: () => Promise.resolve({ ok: true }) } } });
    r.api.open();
    eq(await r.api.runReadOp('day', {}), true, 'the day read did not complete');
    const said = r.ids.mlsP1LegalStatus.textContent;
    ok(/no patient arrived/.test(said), 'a day read that brought nothing claimed otherwise: ' + said);
    ok(/nothing was faked/i.test(said), 'a barren read did not say plainly that nothing was read');
    ok(!/list above was refreshed/.test(said), 'a barren read still claims the patient list was refreshed');
  }
  {
    /* ...and one that DOES bring a patient counts it, rather than asserting. */
    const arriving = [{ id: 'A', name: 'Synthetic Alpha', dob: '01/02/1980', mrn: 'TEST-A', visits: [] }];
    let list = arriving.slice();
    const r = makeRuntime({
      patients: arriving,
      readers: { __mlsSI: { dayPull: () => { list = list.concat([{ id: 'D', name: 'Synthetic Delta', dob: '07/08/1988', mrn: 'TEST-D', visits: [] }]); return Promise.resolve({ ok: true }); } } }
    });
    r.window.getPatients = () => list.slice();
    r.api.open();
    eq(await r.api.runReadOp('day', {}), true, 'the day read did not complete');
    ok(/1 patient arrived/.test(r.ids.mlsP1LegalStatus.textContent),
      'a day read that brought a patient did not count it: ' + r.ids.mlsP1LegalStatus.textContent);
  }
  {
    /* A chart re-read is measured on the compiled entry count, the same way. */
    const r = makeRuntime({ readers: { pullPatientChartViaAssist: () => Promise.resolve(true) } });
    r.api.open();
    eq(await r.api.runReadOp('chart'), true, 'the chart read did not complete');
    const said = r.ids.mlsP1LegalStatus.textContent;
    ok(/documented entries/.test(said), 'a chart read did not report a measured entry count: ' + said);
    ok(/unchanged at \d+ documented entries/.test(said), 'an unchanged chart read did not say it was unchanged: ' + said);
    ok(/nothing was faked/i.test(said), 'an unchanged chart read did not say plainly that nothing new was read');
  }

  /* The tap-target floor is NOT asserted here: this fixture has no layout, so
     a CSS grep would be a claim rather than a measurement. It is measured for
     real, in headless Chrome at all five widths, by
     tests/1p-legal-e2e-press.test.js. */

  /* the delimited blocks stay delimited, so promotion is a copy not a diff */
  ['p1-legal-restore-2.0.0', 'p1-legal-bind-2.0.0', 'p1-legal-reports-2.0.0',
    'p1-legal-scrub-1.0.0', 'p1-legal-stepper-1.0.0', 'p1-legal-undated-1.0.0',
    'p1-legal-readstop-1.0.0', 'p1-legal-counsel-order-1.0.0'].forEach(name => {
    const a = source.indexOf('/* ===== ' + name + ' =');
    const b = source.indexOf('/* ===== end ' + name + ' ===== */');
    ok(a >= 0 && b > a, 'the ' + name + ' block is missing or unclosed');
    ok(source.indexOf('/* ===== ' + name + ' =', a + 1) < 0, 'the ' + name + ' block appears twice');
  });

  /* the twins stay canonical - this lane changed no shell byte */
  {
    const canon = v => String(v)
      .replace("base-uri 'self'", "base-uri 'none'")
      .replace(/<!-- p1-live-1\.0\.0:[\s\S]*?<base href="\/1p">\r?\n/, '')
      .replace("route:'/1p/'", "route:'/1pScribeFlow.html'");
    eq(canon(fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8')),
      fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8'),
      'the two /1p shells are no longer twins');
  }

  console.log('PASS 1p Legal bind / report / flow (' + checks + ' assertions)');
})().catch(error => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
