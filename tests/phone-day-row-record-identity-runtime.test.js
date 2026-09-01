'use strict';

/* phone-day-row-record-identity-runtime
 *
 * Regression for the real phone path, not a resolver-only approximation:
 *
 *   rendered Day row -> feat_mls_phone_ui delegated `open`
 *   -> Easy remote.startVisitFor -> lockAndStart -> calStartVisit
 *   -> Easy remote.record -> requireExactScheduledBinding -> #captureBtn
 *
 * All fixtures are synthetic and the harness is browserless. The phone DOM
 * harness is extracted from its existing focused suite so this test uses the
 * same mount/render/delegated-tap convention. The visit activation, remote API,
 * identity resolver and action gate are extracted from the shipped sources and
 * executed together; none is replaced by a test reimplementation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const shellSource = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
const connectSource = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8');
const phoneSource = fs.readFileSync(path.join(ROOT, 'feat_mls_phone_ui.js'), 'utf8');
const phoneSuiteSource = fs.readFileSync(path.join(__dirname, 'phone-app-is-its-own-app.test.js'), 'utf8');

const DAY = '2026-08-26';
const PROVIDER = 'Synthetic Provider, MD';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function between(source, startText, endText, from, label) {
  const start = source.indexOf(startText, from || 0);
  const end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, `${label}: source boundary not found`);
  return source.slice(start, end);
}

/* Extract one declared function without depending on a parser package. The
 * scanner ignores braces inside comments, strings and template literals. */
function declaredFunction(source, name, from) {
  const start = source.indexOf(`function ${name}(`, from || 0);
  assert(start >= 0, `could not find function ${name}`);
  const open = source.indexOf('{', start);
  assert(open > start, `could not find ${name}'s body`);
  let depth = 0;
  let mode = 'code';
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    const n = source[i + 1];
    if (mode === 'line') {
      if (c === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; i++; }
      continue;
    }
    if (mode === 'single' || mode === 'double' || mode === 'template') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') ||
          (mode === 'template' && c === '`')) mode = 'code';
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`could not close function ${name}`);
}

/* Reuse the established hand-rolled phone DOM rather than creating a second
 * interpretation of how a phone control is mounted and tapped. Only the
 * makeHarness declaration is evaluated; the sibling suite's tests do not run. */
const phoneHarnessBlock = between(
  phoneSuiteSource,
  'function makeHarness(opts) {',
  '\nfunction visitAt(',
  0,
  'phone harness'
);
const makePhoneHarness = new Function(
  'assert', 'source', 'connect', 'vm', 'IPHONE_UA',
  `${phoneHarnessBlock}\nreturn makeHarness;`
)(assert, phoneSource, connectSource, vm, IPHONE_UA);

const easyOwner = connectSource.indexOf('MLS Scribe — EASY tuning pass: the effortless Visit tab');
assert(easyOwner >= 0, 'canonical Easy owner not found');

const calRuntime = between(
  shellSource,
  'function _calDobKey(v)',
  '// "Now in your waiting room"',
  0,
  'calendar visit activation'
);
const historyTargetRuntime = between(
  shellSource,
  'function _athenaHistoryDigits(v)',
  'function _athenaHistoryTargetStillExact(',
  0,
  'exact local history target resolver'
);
const activationRuntime = between(
  connectSource,
  '  /* =======================================================================\n   *  context lock + patient activation',
  '  /* =======================================================================\n   *  renderers',
  easyOwner,
  'canonical Easy activation'
);
/* liftbusy-1.0.2 (2026-08-28): the activation slice CALLS captureBusy() - the
   mid-recording patient-switch block is its very first statement - but does not
   DEFINE it, and this sandbox never supplied it. So every startVisitFor threw
   "ReferenceError: captureBusy is not defined", the phone's own safe() wrapper
   swallowed the throw, and its handler refused. From outside that looked exactly
   like a phone declining an unresolved row: zero engine calls, zero renders,
   zero engine-side toasts. It is why case 0b saw no receipt, and why the same
   symptom reproduced on the untouched baseline - the harness was broken, not
   the product.
   Same defect and same cure as tests/1p-easy-generate-sparse-runtime and
   tests/visit-exact-action-gate-runtime: lift the guard REAL and fake only its
   leaf bridge, so both disjuncts stay reachable. */
const captureBusyRuntime = between(
  connectSource,
  '  function directCaptureStatus()',
  '  function noteText()',
  easyOwner,
  'canonical capture-busy guard'
);
const patientLifecycleRuntime = between(
  connectSource,
  '  function visitBindingOwnsPatient(nextId) {',
  "  document.addEventListener('click', ez3Click, true);",
  easyOwner,
  'canonical Easy active-patient lifecycle'
);
const computePhaseRuntime = declaredFunction(connectSource, 'computePhase', easyOwner);
const bindingNoticeRuntime = declaredFunction(connectSource, 'bindingNotice', easyOwner);
const easyIdentityRuntime = [
  'normTokens', 'nameMatch', 'dobOf', 'dobKey', 'dobConflicts',
  'mrnKey', 'mrnConflicts', 'positiveIdentityEvidence',
  'canonicalActivePatient', 'activeName'
].map(name => declaredFunction(connectSource, name, easyOwner)).join('\n');
const remoteRuntime = between(
  connectSource,
  '    remote: {',
  '    /* Internal same-document release seam.',
  easyOwner,
  'canonical Easy remote API'
);

assert(/data-act="open" data-id="/.test(phoneSource), 'phone Day rows no longer use the delegated open action');
assert(/r\.startVisitFor\(id, \{ record: false(?:, quiet: true)? \}\)/.test(phoneSource), 'phone Day open no longer reaches Easy startVisitFor without recording');
assert(/window\.calStartVisit/.test(activationRuntime), 'Easy activation no longer reaches calStartVisit');
assert(/requireExactScheduledBinding/.test(remoteRuntime), 'phone recording no longer reaches the Easy identity/action gate');

function canonicalNameTokens(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(Boolean).sort();
}

function nameMatch(left, right) {
  const a = canonicalNameTokens(left);
  const b = canonicalNameTokens(right);
  if (!a.length || !b.length) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.every(token => longer.includes(token));
}

function makeEngine(options) {
  options = options || {};
  const rows = (options.rows || []).map(row => Object.assign({}, row));
  const patients = (options.patients || []).map(patient => Object.assign({}, patient));
  let activeId = String(options.activeId || '');
  let currentBinding = null;
  let capturing = false;
  const eventHandlers = {};
  const receipts = [];
  const calls = {
    capture: 0, generate: 0, newVisit: 0, select: [], clearActive: 0,
    showView: [], render: 0, toasts: [], bindingWrites: []
  };
  const elements = {
    patientLabel: { value: '' },
    contextBox: { value: '' },
    transcript: { value: '' },
    noteBox: { value: '' },
    genBtn: { disabled: false },
    genError: { textContent: '' },
    noteError: { textContent: '' }
  };
  const state = {
    mode: 'doctor', screen: 'home', visitDay: DAY,
    appt: null, locked: null, phase: 'idle', recStart: 0,
    genClickedAt: 0, signedAt: 0, expanded: null, editing: false,
    lastWarn: '', showCount: 5, providerFilter: '', providerRef: '',
    query: '', autoPull: 'idle', autoPullAt: 0, autoPullNote: ''
  };

  function patientById(id) {
    return patients.find(patient => String(patient && patient.id || '') === String(id || '')) || null;
  }
  function activePatient() { return patientById(activeId); }
  function resetBaseEncounter() {
    calls.newVisit++;
    capturing = false;
    elements.patientLabel.value = '';
    elements.contextBox.value = '';
    elements.transcript.value = '';
    elements.noteBox.value = '';
    currentBinding = null;
  }

  const context = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp,
    Promise, isNaN, isFinite, parseInt, parseFloat,
    S: state,
    P: null,
    _calAppts: rows,
    document: { getElementById(id) { return elements[id] || null; } },
    safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
    isFn(fn) { return typeof fn === 'function'; },
    $(id) { return elements[id] || null; },
    esc(value) { return String(value == null ? '' : value); },
    appts() { return rows; },
    dayRows(day) { return rows.filter(row => String(row.appt_date || row.day_local || '').slice(0, 10) === String(day)); },
    visitDay() { return state.visitDay; },
    setVisitDay(day) { state.visitDay = String(day); return true; },
    todayLocal() { return DAY; },
    fmtClock() { return '9:00 AM'; },
    activeProvider() { return PROVIDER; },
    guardInfo() { return { on: true, blocked: 0 }; },
    providerRosterReceipt() { return null; },
    apptDay(row) { return String(row && (row.appt_date || row.day_local) || '').slice(0, 10); },
    dobOf(row) { return String(row && row.dob || ''); },
    rowKey(row) { return String(row && row.id || ''); },
    t12(row) { return String(row && (row.time_display || row.time) || '9:00 AM'); },
    visitType(row) { return String(row && row.reason || 'Visit'); },
    isSeen(row) { return !!(row && row.seen); },
    normTokens: canonicalNameTokens,
    nameMatch,
    activeName() { const p = activePatient(); return p && p.name || ''; },
    patientById,
    findPatient: patientById,
    getPatients() { return patients; },
    upsertPatient(patient) {
      const at = patients.findIndex(item => String(item.id) === String(patient.id));
      if (at >= 0) patients[at] = patient; else patients.push(patient);
      return patient;
    },
    setActivePtId(id) {
      const previous = activeId;
      activeId = String(id || '');
      if (!activeId) calls.clearActive++;
      if (String(previous) !== activeId) context.dispatchEvent({
        type: 'mls:active-patient-changed',
        detail: { previousId: String(previous || ''), patientId: activeId }
      });
    },
    selectPatient(id) { calls.select.push(String(id)); activeId = String(id || ''); },
    activePatient,
    goNewVisitForPatient() {
      if (!activePatient()) return;
      context.showView('visit');
      resetBaseEncounter();
    },
    goNewUnassignedVisit() {
      if (options.failUnassigned) throw new Error('synthetic unassigned-start failure');
      context.setActivePtId('');
      context.showView('visit');
      resetBaseEncounter();
    },
    newVisit: resetBaseEncounter,
    showView(view) { calls.showView.push(String(view)); },
    _calLabelOf(row) { return String(row && row.name || 'Patient'); },
    toast(message, kind) { calls.toasts.push({ message: String(message), kind: String(kind || '') }); },
    render() { calls.render++; },
    setEasyMode(mode, screen) { state.mode = mode; state.screen = screen; return true; },
    isRecording() { return capturing; },
    blockSwitchWhileRecording() { state.lastWarn = 'Recording is still running.'; },
    noteText() { return elements.noteBox.value; },
    ez3EngineReason() { return ''; },
    captureBtn() {
      return { click() { calls.capture++; capturing = true; state.phase = 'rec'; state.recStart = Date.now(); } };
    },
    genBtnResolve() { return { click() { calls.generate++; } }; },
    ez3StampGenClick() { state.genClickedAt = Date.now(); },
    stopRecordingOnly() { capturing = false; state.phase = 'stopped'; },
    requestSend() {},
    currentVisitAthenaBinding: null,
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    addEventListener(type, fn) { (eventHandlers[type] = eventHandlers[type] || []).push(fn); },
    removeEventListener(type, fn) { eventHandlers[type] = (eventHandlers[type] || []).filter(item => item !== fn); },
    dispatchEvent(ev) { (eventHandlers[ev && ev.type] || []).slice().forEach(fn => fn(ev)); return true; }
  };
  context.window = context;
  context.window.window = context;
  Object.defineProperty(context, 'currentVisitAthenaBinding', {
    configurable: true,
    enumerable: true,
    get() { return currentBinding; },
    set(value) { currentBinding = value; }
  });
  context._athenaFreezeVisitBinding = function (patient, meta) {
    return {
      id: `binding-${String(meta && meta.visitContext && meta.visitContext.appointmentId || 'local')}`,
      patient: { patientId: String(patient.id), name: patient.name, dob: patient.dob },
      visitContext: Object.assign({}, meta.visitContext)
    };
  };
  context._athenaSetVisitBinding = function (binding) {
    currentBinding = binding || null;
    calls.bindingWrites.push(binding || null);
    return true;
  };
  context.__mlsCrossDayContext = { current() { return null; } };

  vm.createContext(context);
  vm.runInContext(
    `${historyTargetRuntime}\n${calRuntime}\n${easyIdentityRuntime}\n${computePhaseRuntime}\n${bindingNoticeRuntime}\n${captureBusyRuntime}\n${patientLifecycleRuntime}\n${activationRuntime}\n` +
    `this.__remoteHost = {\n${remoteRuntime}\n};\nthis.__engineState = S;`,
    context,
    { filename: 'phone-day-row-real-engine.js' }
  );

  const realCalStartVisit = context.calStartVisit;
  assert.strictEqual(typeof realCalStartVisit, 'function', 'real calStartVisit did not install');
  context.calStartVisit = function (id) {
    const receipt = realCalStartVisit(id);
    receipts.push(receipt == null ? receipt : JSON.parse(JSON.stringify(receipt)));
    return receipt;
  };

  return {
    context,
    state,
    rows,
    patients,
    calls,
    receipts,
    elements,
    remote: context.__remoteHost.remote,
    activePatient,
    binding() { return currentBinding; },
    capturing() { return capturing; },
    seedEncounter() {
      capturing = false;
      elements.patientLabel.value = activePatient() ? activePatient().name : '';
      elements.contextBox.value = 'Synthetic prior encounter context';
      elements.transcript.value = 'Synthetic prior encounter transcript';
      elements.noteBox.value = 'Synthetic prior generated note with enough text to be a completed note.';
      state.phase = 'stopped';
      state.recStart = Date.now() - 12000;
      state.genClickedAt = Date.now() - 6000;
      state.signedAt = Date.now() - 3000;
      state.lastWarn = 'Synthetic prior encounter warning';
      currentBinding = { patient: { patientId: activeId }, visitContext: { appointmentId: 'prior' } };
    }
  };
}

function makeChain(options) {
  const engine = makeEngine(options);
  const phone = makePhoneHarness({
    wantPhone: true,
    snapshot: { day: DAY, today: engine.rows },
    host: {
      __mlsEasyV32: { remote: engine.remote },
      _calAppts: engine.rows,
      activePatient: engine.activePatient,
      getPatients() { return engine.patients; },
      patientNotes() { return []; },
      _athenaChartLanded() { return false; }
    }
  });

  /* The phone reads these two canonical host fields directly. Proxy them to
   * the engine VM so its rendered transcript/note are the same encounter the
   * real remote methods mutate. */
  for (const id of ['transcript', 'noteBox']) {
    const node = phone.document.createElement('textarea');
    Object.defineProperty(node, 'value', {
      configurable: true,
      get() { return engine.elements[id].value; },
      set(value) { engine.elements[id].value = String(value == null ? '' : value); }
    });
    phone.byId.set(id, node);
  }
  phone.api().render();
  return { engine, phone };
}

function row(id, appointmentId, name, dob, extra) {
  return Object.assign({
    id, appointment_id: appointmentId, name, dob,
    appt_date: DAY, time: '9:00 AM', provider: PROVIDER, reason: 'Synthetic follow-up'
  }, extra || {});
}

function patient(id, name, dob) {
  return { id, name, dob, source: 'synthetic-phone-regression' };
}

/* 0. A stale phone row whose appointment vanished returns a structured
 * appointment-not-found receipt at the engine and leaves the phone on Day. */
{
  const selected = patient('pt-vanished', 'Vanished Row', '1970-01-02');
  const chain = makeChain({
    rows: [row('row-vanished', 'appt-vanished', selected.name, selected.dob)],
    patients: [selected], activeId: selected.id
  });
  const receipt = chain.engine.context.calStartVisit('missing-row');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(receipt)), {
    ok: false, bound: false, patientId: '', reason: 'appointment-not-found'
  }, 'missing appointment did not return the structured failure receipt');
  chain.engine.rows.splice(0, chain.engine.rows.length); /* rendered phone row is now stale */
  chain.phone.tap('open', { 'data-id': 'row-vanished' });
  assert.strictEqual(chain.phone.api().state().screen, 'day', 'phone left Day for a vanished appointment row');
  assert.strictEqual(chain.engine.calls.newVisit, 0, 'vanished appointment reset/started an encounter');
  assert.deepStrictEqual(chain.engine.calls.showView, [], 'vanished appointment moved the desktop to Visit before activation succeeded');
}

/* 0b. A failed unassigned encounter creator must not repaint prior encounter
 * fields or emit a success toast, and the phone must remain on Day. */
{
  const prior = patient('pt-unassigned-failure-prior', 'Prior Existing', '1970-02-02');
  const chain = makeChain({
    rows: [row('row-unassigned-failure', 'appt-unassigned-failure', 'Unresolved Target', '')],
    patients: [prior], activeId: prior.id, failUnassigned: true
  });
  chain.engine.elements.patientLabel.value = 'Existing patient label';
  chain.engine.elements.contextBox.value = 'Existing encounter context';
  chain.phone.tap('open', { 'data-id': 'row-unassigned-failure' });
  const receipt = chain.engine.receipts[chain.engine.receipts.length - 1];
  assert.strictEqual(receipt && receipt.reason, 'visit-start-failed', 'failed encounter creator returned the wrong structured receipt');
  assert.strictEqual(chain.phone.api().state().screen, 'day', 'failed encounter creator moved the phone into Visit');
  assert.strictEqual(chain.engine.elements.patientLabel.value, 'Existing patient label', 'failed encounter creator repainted the prior patient label');
  assert.strictEqual(chain.engine.elements.contextBox.value, 'Existing encounter context', 'failed encounter creator changed prior context');
  assert.strictEqual(chain.engine.calls.toasts.some(t => /Started a visit/i.test(t.message)), false,
    'failed encounter creator emitted a false success toast');
  assert.deepStrictEqual(chain.engine.calls.showView, [], 'failed encounter creator moved the desktop to Visit');
}

function tapOpen(chain, id) {
  assert(chain.phone.screen().includes(`data-id="${id}"`), `phone Day did not render row ${id}`);
  chain.phone.tap('open', { 'data-id': id });
  assert.strictEqual(chain.phone.api().state().screen, 'visit',
    `${id}: phone did not enter Visit; receipts=${JSON.stringify(chain.engine.receipts)} ` +
    `state=${JSON.stringify(chain.engine.state)} sticky=${JSON.stringify(chain.phone.noteText())}`);
  return chain.engine.receipts[chain.engine.receipts.length - 1];
}

function tapRecord(chain) {
  assert(chain.phone.action().includes('data-act="record"'), 'phone Visit did not offer Start recording');
  chain.phone.tap('record');
}

function assertBoundReceipt(receipt, patientId, label) {
  assert(receipt && typeof receipt === 'object', `${label}: calStartVisit returned no structured receipt`);
  assert.strictEqual(receipt.ok, true, `${label}: receipt did not report a started visit`);
  assert.strictEqual(receipt.bound, true, `${label}: receipt did not report an exact local chart`);
  assert.strictEqual(receipt.patientId, patientId, `${label}: receipt named the wrong local chart`);
}

/* 1. A different chart may be active from the prior room. The Day row must
 * synchronously heal all the way through the phone and record the selected
 * target, never leave the prior chart underneath the new visible name. */
{
  const selected = patient('pt-target', 'Ada Example', '1984-05-06');
  const prior = patient('pt-prior', 'Byron Prior', '1972-02-03');
  const chain = makeChain({
    rows: [row('row-heal', 'appt-heal', selected.name, selected.dob, { patient_external_id: selected.id })],
    patients: [prior, selected], activeId: prior.id
  });
  const receipt = tapOpen(chain, 'row-heal');
  assertBoundReceipt(receipt, selected.id, 'stale-chart heal');
  assert.strictEqual(chain.engine.rows[0]._mlsTargetPatientId, selected.id,
    'verified compatibility id was not stamped into the canonical MLS-local namespace');
  assert.strictEqual(chain.engine.activePatient().id, selected.id, 'Day row left the prior chart active');
  tapRecord(chain);
  assert.strictEqual(chain.engine.calls.capture, 1, 'healed target did not reach the real capture button');
  assert.strictEqual(chain.engine.remote.snapshot().phase, 'rec', 'healed target did not enter recording phase');
  assert.strictEqual(chain.engine.binding().patient.patientId, selected.id, 'recording binding belongs to the prior chart');
}

/* 2. DOB spelling is canonical identity, not presentation. */
{
  const selected = patient('pt-dob', 'Casey Format', '1987-04-09');
  const prior = patient('pt-dob-prior', 'Prior Format', '1970-01-01');
  const chain = makeChain({
    rows: [row('row-dob', 'appt-dob', selected.name, '04/09/1987')],
    patients: [prior, selected], activeId: prior.id
  });
  assertBoundReceipt(tapOpen(chain, 'row-dob'), selected.id, 'ISO/US DOB');
  tapRecord(chain);
  assert.strictEqual(chain.engine.calls.capture, 1, 'ISO/US DOB match was blocked before recording');
}

/* 3. Athena's Last, First row and MLS's First Last chart are one identity only
 * when DOB agrees. This runs through the phone action, not _calNameKeyFL alone. */
{
  const selected = patient('pt-order', 'Devon Rivera', '1991-12-13');
  const prior = patient('pt-order-prior', 'Prior Rivera', '1968-08-08');
  const chain = makeChain({
    rows: [row('row-order', 'appt-order', 'Rivera, Devon', '12/13/1991')],
    patients: [prior, selected], activeId: prior.id
  });
  assertBoundReceipt(tapOpen(chain, 'row-order'), selected.id, 'Last, First / First Last');
  tapRecord(chain);
  assert.strictEqual(chain.engine.calls.capture, 1, 'Last, First / First Last match was blocked before recording');
}

/* 3b. A sole same-name chart is not patient identity. Without DOB, MRN, or an
 * exact local id, the row must remain unbound even when only one chart shares
 * the name. */
{
  const sameNameOnly = patient('pt-name-only', 'Alex Example', '1988-08-18');
  const chain = makeChain({
    rows: [row('row-name-only', 'appt-name-only', sameNameOnly.name, '')],
    patients: [sameNameOnly], activeId: sameNameOnly.id
  });
  const receipt = tapOpen(chain, 'row-name-only');
  assert.strictEqual(receipt.bound, false, 'name-only schedule row was promoted to an exact local patient');
  assert.strictEqual(receipt.patientId, '', 'name-only schedule row leaked the same-name chart id');
  assert.strictEqual(chain.engine.activePatient(), null, 'name-only resolution left the same-name chart active');
}

/* 3c. One agreeing second factor cannot override a contradictory one. */
{
  const chart = Object.assign(patient('pt-mrn-conflict', 'Taylor Conflict', '1980-02-03'), { mrn: '111111' });
  const chain = makeChain({
    rows: [row('row-mrn-conflict', 'appt-mrn-conflict', chart.name, chart.dob, { mrn: '222222' })],
    patients: [chart], activeId: chart.id
  });
  const receipt = tapOpen(chain, 'row-mrn-conflict');
  assert.strictEqual(receipt.bound, false, 'agreeing name/DOB overrode a contradictory MRN');
  assert.strictEqual(chain.engine.activePatient(), null, 'MRN-conflicting chart remained active');
}

/* 4. No exact local chart is an ordinary unbound local encounter. The stale
 * prior chart must be explicitly cleared before the label is prefilled; Easy
 * then demotes only the schedule binding and the phone still records locally. */
{
  const prior = patient('pt-stale-only', 'Stale Prior', '1975-03-02');
  const chain = makeChain({
    /* With neither DOB nor MRN the real target resolver cannot safely create a
       chart from a name, so this is provably unresolved rather than a harness
       that merely omitted the resolver. */
    rows: [row('row-unresolved', 'appt-unresolved', 'No Local Chart', '')],
    patients: [prior], activeId: prior.id
  });
  const receipt = tapOpen(chain, 'row-unresolved');
  assert(receipt && typeof receipt === 'object', 'unresolved target returned no structured receipt');
  assert.strictEqual(receipt.ok, true, 'unresolved target did not start a local encounter');
  assert.strictEqual(receipt.bound, false, 'unresolved target claimed a local patient binding');
  assert.strictEqual(receipt.patientId, '', 'unresolved target retained a patient id');
  assert.strictEqual(receipt.reason, 'patient-unresolved', 'unresolved target returned the wrong reason');
  assert.strictEqual(chain.engine.activePatient(), null, 'unresolved target left the stale chart active');
  assert(chain.engine.calls.clearActive >= 1, 'unresolved target did not explicitly clear canonical active patient state');
  const toastsBeforeRecord = chain.engine.calls.toasts.length;
  tapRecord(chain);
  assert.strictEqual(chain.engine.calls.capture, 1, 'clearly unbound local visit did not reach recording');
  assert.strictEqual(chain.engine.binding(), null, 'unbound recording retained an Athena appointment binding');
  assert.strictEqual(chain.engine.calls.toasts.length, toastsBeforeRecord,
    'quiet phone recording emitted a second engine toast instead of letting the phone own the warning');
  chain.engine.remote.stopRecording();
  const toastsBeforeGenerate = chain.engine.calls.toasts.length;
  assert.strictEqual(chain.engine.remote.generate(), true, 'unbound phone generation was refused');
  assert.strictEqual(chain.engine.calls.generate, 1, 'unbound phone generation did not reach the real Generate control');
  assert.strictEqual(chain.engine.calls.toasts.length, toastsBeforeGenerate,
    'quiet phone generation emitted a second engine toast instead of letting the phone own the warning');

  const warning = chain.engine.remote.snapshot().warn;
  assert(warning && /not linked|unscheduled/i.test(warning), 'unbound recording has no visible explanatory warning');
  const visible = chain.phone.screen() + '\n' + chain.phone.action() + '\n' + chain.phone.noteText();
  const warningCount = visible.split(warning).length - 1;
  assert.strictEqual(warningCount, 1,
    `phone rendered ${warningCount} copies of the same unbound warning (sticky and inline must dedupe)`);
}

/* 5. A matching id/name does not erase a DOB contradiction. This is proven
 * evidence for two people, so it remains a hard stop rather than becoming the
 * unbound escape hatch above. */
{
  const chart = patient('pt-conflict', 'Morgan Same', '1980-02-03');
  const chain = makeChain({
    rows: [row('row-conflict', 'appt-conflict', chart.name, '1981-02-03', { patient_external_id: chart.id })],
    patients: [chart], activeId: chart.id
  });
  chain.phone.tap('open', { 'data-id': 'row-conflict' });
  assert.strictEqual(chain.phone.api().state().screen, 'day',
    'phone left Day after the activation identity check had already failed');
  assert.strictEqual(chain.engine.calls.newVisit, 0,
    'identity-conflicting Open reset/started an encounter before reporting failure');
  assert.strictEqual(chain.engine.calls.capture, 0, 'same name with a different DOB reached recording');
  assert.deepStrictEqual(chain.engine.calls.showView, [], 'identity-conflicting Open moved the desktop to Visit before validation');
  assert.strictEqual(chain.engine.capturing(), false, 'contradictory identity entered recording state');
  assert(/different patient/i.test(chain.engine.remote.snapshot().warn), 'contradictory identity block did not name the cause');
  assert(/could not open|different patient/i.test(chain.phone.noteText()),
    'phone gave no persistent explanation for the refused open');
  const warning = chain.engine.remote.snapshot().warn;
  const visible = chain.phone.screen() + '\n' + chain.phone.action() + '\n' + chain.phone.noteText();
  assert.strictEqual(visible.split(warning).length - 1, 1,
    'contradictory identity block rendered more than one visible phone warning');
  chain.engine.context.setActivePtId('');
  assert.strictEqual(chain.engine.remote.snapshot().warn, '',
    'a canonical patient release left the failed-activation warning stuck on Home');
}

/* 5b. A refused row is not the active Easy visit. Preserve the prior visit's
 * selection and completed-note state while reporting the new refusal. */
{
  const chart = patient('pt-prior-kept', 'Morgan Same', '1980-02-03');
  const prior = row('row-prior-kept', 'appt-prior-kept', chart.name, chart.dob,
    { patient_external_id: chart.id, time: '8:00 AM' });
  const conflict = row('row-conflict-after-note', 'appt-conflict-after-note', chart.name, '1981-02-03',
    { patient_external_id: chart.id, time: '9:00 AM' });
  const chain = makeChain({ rows: [prior, conflict], patients: [chart], activeId: chart.id });
  assertBoundReceipt(tapOpen(chain, prior.id), chart.id, 'prior visit before refused switch');
  chain.engine.seedEncounter();
  const before = {
    activeId: chain.engine.remote.snapshot().active.id,
    phase: chain.engine.state.phase,
    recStart: chain.engine.state.recStart,
    genClickedAt: chain.engine.state.genClickedAt,
    signedAt: chain.engine.state.signedAt,
    note: chain.engine.elements.noteBox.value,
    transcript: chain.engine.elements.transcript.value,
    resets: chain.engine.calls.newVisit
  };
  chain.phone.api().go('day');
  chain.phone.tap('open', { 'data-id': conflict.id });
  const after = chain.engine.remote.snapshot();
  assert.strictEqual(after.active.id, before.activeId,
    'refused row replaced the prior Easy appointment despite saying nothing was started');
  assert.strictEqual(chain.engine.state.phase, before.phase, 'refused row erased the prior visit phase');
  assert.strictEqual(chain.engine.state.recStart, before.recStart, 'refused row erased the prior recording clock');
  assert.strictEqual(chain.engine.state.genClickedAt, before.genClickedAt, 'refused row erased the prior generation timestamp');
  assert.strictEqual(chain.engine.state.signedAt, before.signedAt, 'refused row erased the prior sign timestamp');
  assert.strictEqual(chain.engine.elements.noteBox.value, before.note, 'refused row erased the prior generated note');
  assert.strictEqual(chain.engine.elements.transcript.value, before.transcript, 'refused row erased the prior transcript');
  assert.strictEqual(chain.engine.calls.newVisit, before.resets, 'refused row reset the prior encounter');
  assert(/different patient/i.test(after.warn),
    `refused switch lost its visible wrong-patient warning (actual: ${JSON.stringify(after.warn)})`);
}

/* 6. Reusing the same patient for a later appointment is still a new
 * encounter. selectPatient may be a same-id no-op, so calStartVisit and Easy
 * must reset the encounter independently of an active-patient-change event. */
{
  const selected = patient('pt-repeat', 'Riley Repeat', '1977-07-17');
  const rows = [
    row('row-repeat-1', 'appt-repeat-1', selected.name, selected.dob, { patient_external_id: selected.id, time: '9:00 AM' }),
    row('row-repeat-2', 'appt-repeat-2', selected.name, selected.dob, { patient_external_id: selected.id, time: '2:00 PM' })
  ];
  const chain = makeChain({ rows, patients: [selected], activeId: selected.id });
  assertBoundReceipt(tapOpen(chain, 'row-repeat-1'), selected.id, 'first same-patient appointment');
  chain.engine.seedEncounter();
  assert.strictEqual(chain.engine.remote.snapshot().phase, 'note', 'dirty encounter fixture did not reach a completed-note phase');

  chain.phone.api().go('day');
  assertBoundReceipt(tapOpen(chain, 'row-repeat-2'), selected.id, 'second same-patient appointment');
  const snapshot = chain.engine.remote.snapshot();
  assert.strictEqual(chain.engine.calls.newVisit, 2, 'same-patient second appointment did not create a fresh base encounter');
  assert.strictEqual(snapshot.active.id, 'row-repeat-2', 'Easy kept the first appointment active');
  assert.strictEqual(snapshot.phase, 'idle', 'Easy kept the prior appointment phase');
  assert.strictEqual(snapshot.noteLen, 0, 'Easy kept the prior appointment note');
  assert.strictEqual(chain.engine.elements.transcript.value, '', 'same-patient second appointment kept the prior transcript');
  assert.strictEqual(chain.engine.elements.contextBox.value, '', 'same-patient second appointment kept the prior context');
  assert.strictEqual(chain.engine.state.recStart, 0, 'same-patient second appointment kept the prior recording clock');
  assert.strictEqual(chain.engine.state.signedAt, 0, 'same-patient second appointment kept the prior sign state');
  assert.strictEqual(chain.engine.binding().visitContext.appointmentId, 'appt-repeat-2', 'second appointment kept the first encounter binding');
  assert.deepStrictEqual(chain.phone.barActs(), ['record'], 'fresh same-patient appointment did not return the phone to Start recording');
}

/* 7. After an exact row is stamped to local A, a same-demographics switch to
 * local B must release the Easy visit instead of preserving it by fallback. */
{
  const localA = patient('local-a', 'Jordan Same', '1984-04-14');
  const localB = patient('local-b', 'Jordan Same', '1984-04-14');
  const scheduled = row('row-jordan', 'appt-jordan', localA.name, localA.dob,
    { patient_external_id: 'athena-jordan', _mlsTargetPatientId: localA.id });
  const chain = makeChain({ rows: [scheduled], patients: [localA, localB], activeId: localA.id });
  assertBoundReceipt(tapOpen(chain, scheduled.id), localA.id, 'canonical local-A binding');
  assert.strictEqual(chain.engine.rows[0]._mlsTargetPatientId, localA.id, 'row was not stamped with canonical local target');
  chain.engine.context.setActivePtId(localB.id);
  assert.strictEqual(chain.engine.remote.snapshot().active, null,
    'same-demographics local-B switch preserved local-A appointment binding');
  assert.strictEqual(chain.engine.state.locked, null, 'stale Easy patient lock survived local-ID contradiction');
}

/* 8. An Athena external id is not an MLS-local id. Coincidental byte equality
 * with a same-name local chart cannot become identity without DOB or MRN. */
{
  const collision = patient('shared-id', 'Avery Collision', '1989-09-19');
  const chain = makeChain({
    rows: [row('row-external-collision', 'appt-external-collision', collision.name, '',
      { patient_external_id: collision.id })],
    patients: [collision], activeId: collision.id
  });
  const receipt = tapOpen(chain, 'row-external-collision');
  assert.strictEqual(receipt.bound, false, 'external-id collision was treated as an MLS-local patient id');
  assert.strictEqual(receipt.patientId, '', 'external-id collision leaked a local patient id');
  assert.strictEqual(chain.engine.rows[0]._mlsTargetPatientId, undefined,
    'external-id collision was stamped into the canonical MLS-local namespace');
  assert.strictEqual(chain.engine.activePatient(), null,
    'external-id collision preserved the coincidental local chart as active');
}

/* 9. Duplicate rows of ONE person, and two people wearing one name.
 *
 * RE-AIMED 2026-09-01. This case used to pin "two charts sharing a name and a
 * DOB are ambiguous, so refuse". dupadopt-1.0.0 (b1124, 2026-08-30) changed
 * that deliberately under the owner's 2026-08-28 identity ruling - name+DOB IS
 * identity, so two such charts are duplicate rows of one person minted while
 * the silent auto-merge was off, and refusing them locked Start Recording out
 * of the day permanently. The phone reaches the SAME _calExactLocalTarget /
 * _calDupSurvivor pair the desktop does, so the phone suite went red at b1124
 * and stayed red: the dupadopt lane ran six suites and this was not one of
 * them.
 *
 * The old assertion was pinning a superseded spelling. What follows pins the
 * PROPERTY dupadopt actually installed, in BOTH directions, so the safety half
 * is now covered here where it was not covered before:
 *   9a  duplicates of one person adopt exactly ONE deterministic survivor, and
 *       the same pool lands on the same survivor every time;
 *   9b  the MRN-bearing chart is the survivor when only one carries an MRN;
 *   9c  two DIFFERENT MRNs under one name+DOB is TWO PEOPLE - still refused,
 *       still released on manual selection, and recording on the released row
 *       is still refused. That last assertion is the property; the old
 *       `binding() === null` proxy is deliberately not reinstated, because the
 *       release path leaves an inert binding record behind in every branch
 *       (case 7 above included) while the action gate is what actually stops
 *       the capture. */
{
  /* 9a */
  const localA = patient('duplicate-a', 'Sam Duplicate', '1986-06-16');
  const localB = patient('duplicate-b', 'Sam Duplicate', '1986-06-16');
  const chain = makeChain({
    rows: [row('row-duplicate', 'appt-duplicate', localA.name, localA.dob)],
    patients: [localA, localB], activeId: localA.id
  });
  const receipt = tapOpen(chain, 'row-duplicate');
  assert.strictEqual(receipt.bound, true,
    'duplicate rows of one person did not adopt a survivor, so the phone cannot record');
  assert.strictEqual(receipt.patientId, localA.id,
    'duplicate pool adopted a non-deterministic survivor');
  assert.strictEqual(chain.engine.rows[0]._mlsTargetPatientId, localA.id,
    'adopted survivor was not stamped back onto the schedule row');
  /* determinism: an identical pool resolved again must land on the same chart */
  const again = makeChain({
    rows: [row('row-duplicate', 'appt-duplicate', localA.name, localA.dob)],
    patients: [localA, localB], activeId: localA.id
  });
  assert.strictEqual(tapOpen(again, 'row-duplicate').patientId, localA.id,
    'the same duplicate pool adopted a different survivor on a second resolution');
}
{
  /* 9b - the MRN-bearing row wins regardless of pool order */
  const plain = patient('duplicate-plain', 'Sam Duplicate', '1986-06-16');
  const carded = Object.assign(patient('duplicate-carded', 'Sam Duplicate', '1986-06-16'), { mrn: '333333' });
  const chain = makeChain({
    rows: [row('row-duplicate', 'appt-duplicate', plain.name, plain.dob)],
    patients: [plain, carded], activeId: plain.id
  });
  assert.strictEqual(tapOpen(chain, 'row-duplicate').patientId, carded.id,
    'duplicate pool preferred a chart with no MRN over the MRN-bearing one');
}
{
  /* 9c - two DIFFERENT MRNs is two people, and the refusal must hold */
  const oneA = Object.assign(patient('two-people-a', 'Sam Duplicate', '1986-06-16'), { mrn: '111111' });
  const oneB = Object.assign(patient('two-people-b', 'Sam Duplicate', '1986-06-16'), { mrn: '222222' });
  const chain = makeChain({
    rows: [row('row-duplicate', 'appt-duplicate', oneA.name, oneA.dob)],
    patients: [oneA, oneB], activeId: oneA.id
  });
  const receipt = tapOpen(chain, 'row-duplicate');
  assert.strictEqual(receipt.bound, false,
    'two charts carrying DIFFERENT MRNs were adopted as one person');
  assert.strictEqual(receipt.patientId, '', 'conflicting-MRN pool leaked a local patient id');
  assert.strictEqual(chain.engine.rows[0]._mlsTargetPatientId, undefined,
    'conflicting-MRN pool was stamped into the canonical MLS-local namespace');
  assert.strictEqual(chain.engine.remote.snapshot().active.id, 'row-duplicate',
    'ambiguous row did not remain available as an unbound local encounter');
  chain.engine.context.setActivePtId(oneA.id);
  assert.strictEqual(chain.engine.remote.snapshot().active, null,
    'manual selection of one of two people retained the ambiguous schedule row');
  assert.strictEqual(chain.engine.state.locked, null,
    'stale Easy patient lock survived the released ambiguous row');
  assert.strictEqual(chain.engine.remote.record(), false,
    'recording was allowed on a released ambiguous row');
  assert.strictEqual(chain.engine.calls.capture, 0,
    'a released ambiguous row still reached the real capture control');
}

console.log('PASS phone Day-row identity/recording chain: stale charts heal to exact targets; unresolved targets clear to one-warning unbound recording; contradictory DOB stays blocked; ISO/US DOB and Last, First names match safely; and a second appointment for the same patient resets encounter state');
