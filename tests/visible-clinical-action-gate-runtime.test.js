'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const connect = read('mls-connect.js');
const stagingConnect = read('mls-connect.staging.js');
const stagingAdapter = read('feat_mls_staging_exact_actions.js');
const stagingVisitOwner = read('feat_mls_visit_exact.js');

function between(source, first, next, label) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start + first.length);
  assert(start >= 0 && end > start, `${label}: source boundary not found`);
  return source.slice(start, end);
}

const ownerMarker = connect.indexOf('the effortless Visit tab  (__mlsEasyV32)');
const ownerStart = connect.indexOf('(function () {', ownerMarker);
const ownerEnd = connect.indexOf('\n})();', ownerStart);
assert(ownerMarker >= 0 && ownerStart >= 0 && ownerEnd > ownerStart, 'canonical Easy owner could not be bounded');
const owner = connect.slice(ownerStart, ownerEnd);

// Advanced is a review workspace, not an alternate record/generate lane.
assert(owner.includes("'#captureCard,#noteCard,#emrCard,#outcomesCard{display:none!important;}'"), 'raw engine cards are not fail-closed by default');
assert(owner.includes("'body.ez3adv #noteCard,body.ez3adv #emrCard,body.ez3adv #outcomesCard{display:block!important;}'"), 'Advanced no longer preserves note review, EMR, and outcome surfaces');
assert(!owner.includes('body.ez3adv #captureCard'), 'Advanced can expose the duplicate raw capture/generate card');
assert(owner.includes('body.ez3adv #noteCard button[onclick*="generateNote"]'), 'Advanced does not hide raw full-note generation controls');
assert(owner.includes('body.ez3adv #noteCard button[onclick*="regenerateNote"]'), 'Advanced does not hide raw full-note regeneration controls');
assert(owner.includes('body.ez3adv #noteCard .ne-regen{display:none!important;}'), 'Advanced does not hide direct section-AI regeneration controls');
assert(!between(connect, 'function wireAdv()', '\n  function homeStatus()', 'Advanced toggle').includes("$('captureCard')"), 'Advanced toggle still scrolls users to the hidden raw capture card');
/* 2026-07-30: the marker drops the empty argument list. openWorkspace gained a
   scrollToNoteCard parameter so the Visit-shortcut chips, which have always
   called openWorkspace(false), can finally be honoured instead of being thrown
   into the advanced workspace and scrolled to #noteCard. This pin is about WHAT
   the opener targets, not its arity, and matching on 'function openWorkspace('
   keeps it true across any future signature change rather than failing for a
   reason it does not care about. The assertion itself is unchanged. */
assert(!between(connect, 'function openWorkspace(', '\n  function recordingNow()', 'top-lane workspace opener').includes("$('captureCard')"), 'top-lane workspace opener still targets the hidden raw capture card');
assert(!owner.includes('#pushAllEmrBtn{display:none'), 'Advanced hides the supervised Athena review control');

// Staging deliberately does not load the canonical Easy owner. Its Visit
// rebuild exposes the legacy cards, so the engine sinks must instead use the
// staging exact-action adapter below.
assert(!stagingConnect.includes('the effortless Visit tab  (__mlsEasyV32)'), 'staging unexpectedly gained a second canonical Easy owner');
assert(stagingConnect.includes("var A='feat_mls_staging_exact_actions.js'"), 'staging does not load its exact scheduled action adapter');
assert(stagingConnect.includes("s.src='feat_mls_visit_exact.js"), 'staging no longer loads its intentional visible Visit-grid owner');
assert(stagingVisitOwner.includes('var cap = $("captureCard"), note = $("noteCard"), emr = $("emrCard")'), 'staging Visit owner no longer declares the visible engine-card grid');
assert(stagingVisitOwner.includes('grid.appendChild(cap); grid.appendChild(note); if (emr) grid.appendChild(emr);'), 'staging Visit owner no longer exposes the audited raw engine cards');

function attr(attrs, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs);
  return match ? match[2] : '';
}

function enumerateInlineClinicalRoutes(html) {
  const captureAt = html.indexOf('id="captureCard"');
  const noteAt = html.indexOf('id="noteCard"');
  const emrAt = html.indexOf('id="emrCard"');
  assert(captureAt >= 0 && noteAt > captureAt && emrAt > noteAt, 'clinical engine card order changed');
  const routes = [];
  const button = /<button\b([^>]*)>/gi;
  let match;
  while ((match = button.exec(html))) {
    const onclick = attr(match[1], 'onclick');
    const direct = /\b(toggleCapture|startCapture|startPhoneMic|generateNote|regenerateNote)\s*\(/.exec(onclick);
    if (!direct) continue;
    const section = match.index > captureAt && match.index < noteAt
      ? 'captureCard'
      : (match.index > noteAt && match.index < emrAt ? 'noteCard' : 'outside');
    const id = attr(match[1], 'id') || (attr(match[1], 'class').split(/\s+/).filter(Boolean)[0] || 'anonymous');
    routes.push({ section, id, action: direct[1] });
  }
  return routes;
}

function enumerateInlineReviewRoutes(html) {
  const noteAt = html.indexOf('id="noteCard"');
  const emrAt = html.indexOf('id="emrCard"');
  assert(noteAt >= 0 && emrAt > noteAt, 'note/review engine card order changed');
  const routes = [];
  const button = /<button\b([^>]*)>/gi;
  let match;
  while ((match = button.exec(html))) {
    const onclick = attr(match[1], 'onclick');
    const direct = /\b(pushEntireVisitToAthena)\s*\(/.exec(onclick);
    if (!direct) continue;
    routes.push({
      section: match.index > noteAt && match.index < emrAt ? 'noteCard' : 'outside',
      id: attr(match[1], 'id') || 'anonymous',
      action: direct[1]
    });
  }
  return routes;
}

const expectedInlineRoutes = [
  { section: 'captureCard', id: 'phoneMicBtn', action: 'startPhoneMic' },
  { section: 'captureCard', id: 'captureBtn', action: 'toggleCapture' },
  { section: 'captureCard', id: 'genBtn', action: 'generateNote' },
  { section: 'noteCard', id: 'sec-copy', action: 'regenerateNote' }
];
const expectedReviewRoutes = [
  { section: 'noteCard', id: 'pushAllEmrBtn', action: 'pushEntireVisitToAthena' }
];

const htmlSources = ['ScribeFlow.html', 'ScribeFlow-staging.html'];
for (const file of htmlSources) {
  const html = read(file);
  assert.deepStrictEqual(enumerateInlineClinicalRoutes(html), expectedInlineRoutes, `${file}: unowned inline record/generate route appeared`);
  assert.deepStrictEqual(enumerateInlineReviewRoutes(html), expectedReviewRoutes, `${file}: Athena review route moved outside the reviewed note surface`);
}

// Every released visible proxy must terminate in one of the guarded engine
// sinks. This inventory makes newly introduced alternate action paths fail the
// suite until they are explicitly audited.
const proxyInventory = [
  { file: 'mls-connect.js', label: 'top visit lane', needles: ['function toggleTopRecording()', "seg.startSegment('visit')", 'else cb.click()', 'function generateTopNote()', 'gen.click()'] },
  { file: 'feat_mls_command_palette.js', label: 'command palette', needles: ['Start recording', 'window.startCapture()', 'Generate note', 'window.generateNote()'] },
  { file: 'feat_mls_copilot_voice_v2.js', label: 'Copilot Voice', needles: ['function requestVoiceGeneration()', 'window.generateNote()', 'function legRecordNow(q)', 'window.startCapture()'] },
  { file: 'feat_mls_voice_ai.js', label: 'voice AI', needles: ["name: 'start_recording'", 'window.heroStartVisit', "name: 'generate_note'", 'window.generateNote'] },
  { file: 'feat_mls_voice_commands.js', label: 'voice commands', needles: ['function doStartRecording()', 'window.heroStartVisit()', 'window.startCapture()'] },
  { file: 'feat_mls_recording_segments.js', label: 'recording segments', needles: ['window.startCapture()', 'window.generateNote()'] },
  { file: 'feat_mls_note_editor.js', label: 'note editor wrapper', needles: ['wrapped.generateNote.apply(this, arguments)', 'wrapped.regenerateNote.apply(this, arguments)'] }
];
for (const route of proxyInventory) {
  const source = read(route.file);
  for (const needle of route.needles) assert(source.includes(needle), `${route.label}: audited guarded-sink route changed (${needle})`);
}

function actionSources(html) {
  const todayEvidenceMarker = 'function _mlsTranscriptHasDraftableTodayEvidence(';
  return {
    helper: between(html, 'function _mlsExactScheduledClinicalAction(', '\nfunction toggleCapture()', 'exact scheduled engine helper'),
    capture: between(html, 'function startCapture()', '\nfunction stopCapture()', 'recording sink'),
    phone: between(html, 'async function startPhoneMic(', '\nasync function pollPhoneMic()', 'phone recording sink'),
    generate: between(html, 'async function generateNote()', '\nfunction autoPopulateExtras(', 'note-generation sink'),
    draftable: html.includes(todayEvidenceMarker)
      ? between(html, todayEvidenceMarker, '\nasync function callOpenAI(', 'today-evidence gate')
      : '',
    hero: between(html, 'function heroStartVisit()', '\nfunction emrConnectFromHero()', 'legacy hero proxy'),
    regenerate: between(html, 'function regenerateNote()', '\n\n/* =========================================================', 'full-note regeneration proxy'),
    review: between(html, 'function pushEntireVisitToAthena(btn)', '\n/* Legacy natural-language autopilot', 'Athena review route')
  };
}

const actionBlocks = htmlSources.map((file) => ({ file, source: read(file) })).map((entry) => ({ ...entry, blocks: actionSources(entry.source) }));
assert.strictEqual(actionBlocks[0].blocks.helper.trim(), actionBlocks[1].blocks.helper.trim(), 'production/staging exact engine gates drifted');

for (const { file, blocks } of actionBlocks) {
  const recordGate = blocks.capture.indexOf("_mlsExactScheduledClinicalAction('recording')");
  const recordEffect = Math.min(...['initRecog()', 'recog.start()', "_athenaPrepareRecording('recording')"]
    .map((needle) => blocks.capture.indexOf(needle)).filter((index) => index >= 0));
  assert(recordGate >= 0 && recordGate < recordEffect, `${file}: recording can touch the microphone/binding before the exact gate`);

  const phoneGate = blocks.phone.indexOf("_mlsExactScheduledClinicalAction('phone recording')");
  const phoneEffect = blocks.phone.indexOf("fetch(bkBase()+'/api/mic/start'");
  assert(phoneGate >= 0 && phoneEffect > phoneGate, `${file}: phone recording can contact the backend before the exact gate`);

  const generateGate = blocks.generate.indexOf("_mlsExactScheduledClinicalAction('note generation')");
  const generateEffect = blocks.generate.indexOf('const key=getKey()');
  assert(generateGate >= 0 && generateEffect > generateGate, `${file}: note generation can reach AI/key state before the exact gate`);

  assert(blocks.hero.includes('startCapture()'), `${file}: legacy record proxy no longer terminates in the guarded recording sink`);
  assert(blocks.regenerate.includes('generateNote()'), `${file}: full-note regeneration no longer terminates in the guarded generation sink`);

  const reviewBinding = blocks.review.indexOf("_athenaBoundVisitForAction('note',false)");
  const reviewBuild = blocks.review.indexOf('_athenaBuildPlan(binding)');
  const reviewOpen = blocks.review.indexOf('_athenaPushPlan(');
  assert(reviewBinding >= 0 && reviewBuild > reviewBinding && reviewOpen > reviewBuild, `${file}: visible Athena review can bypass the frozen visit binding/plan sequence`);
  assert(!blocks.review.includes('mlsAppPushVisit'), `${file}: visible Athena review regained a legacy direct-write route`);
}

const prodPushPlan = between(actionBlocks[0].source, 'function _athenaPushPlan(sections, who, immutablePatient)', '\n/* Review card', 'production Athena review planner');
assert(prodPushPlan.includes('_athenaShowReceipt('), 'production review control no longer terminates in the supervised receipt/confirmation surface');
const prodReceipt = between(actionBlocks[0].source, 'function _athenaShowReceipt(who, results, partial, immutablePatient, sections, visitContext)', '\n/* Review the frozen superbill payload', 'production Athena confirmation surface');
assert(prodReceipt.includes("typeof unifiedWf.openUnifiedConfirmation==='function'"), 'production review surface no longer prefers the typed unified confirmation');

const stagingPushPlan = between(actionBlocks[1].source, 'function _athenaPushPlan(sections, who, immutablePatient, visitContext)', '\n/* RECEIPT', 'staging Athena review planner');
assert(stagingPushPlan.includes("!String(ctx.visitDate||'').trim()||!String(ctx.provider||'').trim()"), 'staging review can open without an exact visit date/provider');
assert(stagingPushPlan.includes('typeof wf.openUnifiedConfirmation'), 'staging review no longer terminates in the typed unified confirmation');
assert(stagingPushPlan.includes('requireExpectedVisit:true'), 'staging review no longer requires the exact expected encounter at confirmation time');

assert(owner.includes('exactActionReady: function (actionLabel)'), 'canonical API does not expose the exact scheduled action decision to engine sinks');
/* pin updated 2026-07-22: the no-locked-visit OUTCOME must be VISIBLE
   (toast + render), never silent. pin moved b745 (write-blocker audit #36):
   the outcome is now a DEMOTION — proceed as an UNSCHEDULED visit with the
   visible warning — instead of a hard refusal, matching the owner's standing
   ruling in requireExactScheduledBinding. The visibility requirement and the
   scheduled-path gate are unchanged. */
assert(owner.includes("if (!S.appt) {"), 'engine decision lost its explicit no-locked-visit branch');
assert(owner.includes("Unscheduled visit — ' + label + ' works normally"), 'the unscheduled demotion lost its calm visible notice');
assert(/if \(!S\.appt\) \{[\s\S]{0,900}?S\.lastWarn[\s\S]{0,300}?toast\(S\.lastWarn\)[\s\S]{0,200}?return true;/.test(owner), 'the no-locked-visit branch must WARN visibly and demote, never refuse silently');
assert(!owner.includes("S.lastWarn = 'MLS blocked ' + label + ' because no scheduled visit is locked"), 'the old hard generation refusal must stay gone');
assert(owner.includes('return requireExactScheduledBinding(S.appt, label);'), 'engine decision can pass without the selected scheduled appointment gate');

function makeEngineHarness(blocks, gate) {
  const calls = { labels: [], toasts: [], dom: [], network: 0 };
  const context = {
    console,
    window: { __mlsEasyV32: gate === 'missing' ? undefined : { remote: { exactActionReady(label) { calls.labels.push(label); if (gate === 'throw') throw new Error('gate failure'); return gate === true; } } } },
    document: {
      getElementById(id) {
        calls.dom.push(id);
        if (id === 'transcript') return { value: 'Patient reports new knee pain with exam and treatment plan today.' };
        throw new Error(`unsafe DOM effect reached: ${id}`);
      }
    },
    toast(message, type) { calls.toasts.push({ message, type }); },
    _mlsAbortActiveGeneration() { return false; },
    _mlsGenerationEvidenceDecision() { return { ok: true, basis: 'today' }; },
    _mlsRefuseGeneration(code, message) { calls.toasts.push({ message, type: code }); return false; },
    fetch() { calls.network += 1; throw new Error('network effect reached'); }
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext([
    blocks.helper,
    blocks.capture,
    blocks.phone,
    blocks.generate,
    blocks.draftable,
    'this.actions={guard:_mlsExactScheduledClinicalAction,startCapture:startCapture,startPhoneMic:startPhoneMic,generateNote:generateNote};'
  ].join('\n'), context, { filename: 'visible-clinical-action-engine.js' });
  return { context, calls };
}

function frozenBinding(patient, meta) {
  const raw = meta.visitContext || {};
  const boundPatient = Object.freeze({
    patientId: String(patient.id || patient.patientId || ''),
    name: String(patient.name || ''),
    dob: String(patient.dob || ''),
    mrn: String(patient.mrn || patient.athenaId || '')
  });
  const visitContext = Object.freeze({
    historical: false,
    noteTimestamp: Number(raw.noteTimestamp || meta.noteTimestamp || 0) || null,
    visitDate: String(raw.visitDate || ''),
    provider: String(raw.provider || ''),
    appointmentId: String(raw.appointmentId || ''),
    encounterId: String(raw.encounterId || ''),
    encounterUrl: String(raw.encounterUrl || '')
  });
  return Object.freeze({
    id: `test-binding-${Date.now()}`,
    patient: boundPatient,
    source: String(meta.source || ''),
    historical: false,
    identityConflict: false,
    routeBlocked: !boundPatient.patientId || !boundPatient.name || !boundPatient.dob,
    visitContext,
    noteTimestamp: visitContext.noteTimestamp,
    displayDate: visitContext.visitDate,
    displayProvider: visitContext.provider
  });
}

function makeStagingAdapterHarness(options = {}) {
  const active = options.patient || { id: 'p-exact', name: 'Jane Exact', dob: '1980-03-24', mrn: 'MRN-7' };
  const rows = options.rows || [{
    id: '3794', athena_appointment_id: '52585118', patient_external_id: 'p-exact',
    name: 'Jane Exact', dob: '03/24/1980', appt_date: '2026-07-19', time: '9:00 AM', provider: 'Matthew Exact, MD'
  }];
  const storage = new Map(Object.entries(options.storage || {}));
  const calls = { toasts: [], calendar: [], hero: [], listeners: {} };
  const context = {
    console,
    _calAppts: rows,
    _heroTodayList: options.heroRows || [],
    _heroSelIdx: options.heroSelected == null ? -1 : options.heroSelected,
    _heroNowIdx: options.heroNow == null ? -1 : options.heroNow,
    currentVisitAthenaBinding: options.binding || null,
    currentVisitAthenaCompromised: options.compromised === true,
    currentVisitAthenaEpoch: 0,
    activePatient() { return active; },
    _athenaFreezeVisitBinding(patient, meta) { return frozenBinding(patient, meta); },
    _docName(id) { return id === 44 ? 'Matthew Exact, MD' : 'Unassigned'; },
    _apptHHMMTz(value) { const match = /T(\d{2}:\d{2})/.exec(String(value || '')); return match ? match[1] : ''; },
    calStartVisit(id) { calls.calendar.push(String(id)); return true; },
    _heroPickPatient(index) { calls.hero.push(index); context._heroSelIdx = index; return true; },
    uns(key) { return `acct:${key}`; },
    localStorage: { getItem(key) { return storage.has(key) ? storage.get(key) : null; } },
    toast(message, type) { calls.toasts.push({ message, type }); },
    addEventListener(type, listener) { calls.listeners[type] = listener; },
    removeEventListener(type, listener) { if (calls.listeners[type] === listener) delete calls.listeners[type]; },
    dispatchEvent() { return true; }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(stagingAdapter, context, { filename: 'feat_mls_staging_exact_actions.js' });
  return { context, calls, active, rows, storage, api: context.__mlsStagingExactActions };
}

function makeStagingHelperHarness(blocks, decision) {
  const calls = { labels: [], toasts: [] };
  const context = {
    window: {
      __mlsStagingExactActions: decision === 'missing' ? undefined : {
        exactActionReady(label) {
          calls.labels.push(label);
          if (decision === 'throw') throw new Error('staging gate failure');
          return decision === true;
        }
      }
    },
    toast(message, type) { calls.toasts.push({ message, type }); }
  };
  vm.createContext(context);
  vm.runInContext(`${blocks.helper}\nthis.guard=_mlsExactScheduledClinicalAction;`, context, { filename: 'staging-engine-helper.js' });
  return { context, calls };
}

(async function runRuntimeProof() {
  for (const { file, blocks } of actionBlocks) {
    const denied = makeEngineHarness(blocks, false);
    assert.strictEqual(denied.context.actions.startCapture(), false, `${file}: denied exact gate did not fail recording closed`);
    assert.strictEqual(await denied.context.actions.startPhoneMic({ isTrusted: true }), false, `${file}: denied exact gate did not fail phone recording closed`);
    assert.strictEqual(await denied.context.actions.generateNote(), false, `${file}: denied exact gate did not fail generation closed`);
    assert.deepStrictEqual(denied.calls.labels, ['recording', 'phone recording', 'note generation'], `${file}: an engine sink skipped the canonical exact gate`);
    assert.strictEqual(denied.calls.network, 0, `${file}: denied engine action reached the network`);
    assert.deepStrictEqual(denied.calls.dom, ['transcript'], `${file}: denied engine action mutated/read clinical UI beyond the non-empty transcript precheck`);

    const missing = makeEngineHarness(blocks, 'missing');
    assert.strictEqual(missing.context.actions.startCapture(), false, `${file}: missing canonical gate allowed recording`);
    assert(missing.calls.toasts.some((row) => /exact scheduled appointment gate is not ready/i.test(row.message)), `${file}: missing gate did not explain the fail-closed block`);

    const throwing = makeEngineHarness(blocks, 'throw');
    assert.strictEqual(throwing.context.actions.guard('recording'), false, `${file}: throwing canonical gate did not fail closed`);

    const allowed = makeEngineHarness(blocks, true);
    assert.strictEqual(allowed.context.actions.guard('recording'), true, `${file}: proven exact gate was not honored`);
    assert.deepStrictEqual(allowed.calls.labels, ['recording'], `${file}: exact decision did not receive the action label`);
  }

  const stagingHelperAllowed = makeStagingHelperHarness(actionBlocks[1].blocks, true);
  assert.strictEqual(stagingHelperAllowed.context.guard('recording'), true, 'staging engine helper did not honor its staging-only exact adapter');
  assert.deepStrictEqual(stagingHelperAllowed.calls.labels, ['recording'], 'staging exact adapter did not receive the action label');
  const stagingHelperDenied = makeStagingHelperHarness(actionBlocks[1].blocks, false);
  assert.strictEqual(stagingHelperDenied.context.guard('recording'), false, 'staging engine helper did not fail closed on an adapter refusal');
  const stagingHelperThrow = makeStagingHelperHarness(actionBlocks[1].blocks, 'throw');
  assert.strictEqual(stagingHelperThrow.context.guard('recording'), false, 'staging engine helper did not fail closed when its adapter threw');

  const exact = makeStagingAdapterHarness();
  assert(exact.api && exact.api.installed, 'staging exact scheduled action adapter did not install');
  assert.strictEqual(exact.api.exactActionReady('recording'), true, 'one exact staging schedule row did not enable the clinical sink');
  assert(Object.isFrozen(exact.context.currentVisitAthenaBinding), 'staging adapter did not install an immutable visit binding');
  assert.deepStrictEqual(
    {
      appointmentId: exact.context.currentVisitAthenaBinding.visitContext.appointmentId,
      visitDate: exact.context.currentVisitAthenaBinding.visitContext.visitDate,
      provider: exact.context.currentVisitAthenaBinding.visitContext.provider
    },
    { appointmentId: '52585118', visitDate: '2026-07-19', provider: 'Matthew Exact, MD' },
    'staging adapter froze the wrong appointment/date/provider tuple'
  );

  const indexedRow = {
    id: '3794', patient_external_id: 'p-exact', name: 'Jane Exact', dob: '03/24/1980',
    appt_date: '2026-07-19', time: '9:00 AM', provider: 'Matthew Exact, MD'
  };
  const indexed = makeStagingAdapterHarness({
    rows: [indexedRow],
    storage: {
      'acct:schedImportIndexV1::2026-07-19': JSON.stringify({
        rows: { 'appointment-id:52585118': { backendAppointmentId: '3794', patientId: 'p-exact', appt_date: '2026-07-19' } }
      })
    }
  });
  assert.strictEqual(indexed.api.exactActionReady('note generation'), true, 'exact schedule-import index mapping was not accepted');
  assert.strictEqual(indexed.context.currentVisitAthenaBinding.visitContext.appointmentId, '52585118', 'backend calendar id was substituted for the Athena appointment id');

  const missingAppointment = makeStagingAdapterHarness({ rows: [indexedRow] });
  assert.strictEqual(missingAppointment.api.exactActionReady('recording'), false, 'staging accepted a backend-only calendar id as an Athena appointment id');
  assert.strictEqual(missingAppointment.context.currentVisitAthenaBinding, null, 'missing Athena appointment proof still installed a binding');

  const ambiguousRows = [
    exact.rows[0],
    { ...exact.rows[0], id: '3795', athena_appointment_id: '52585119', time: '10:00 AM' }
  ];
  const ambiguous = makeStagingAdapterHarness({ rows: ambiguousRows });
  assert.strictEqual(ambiguous.api.exactActionReady('recording'), false, 'staging guessed between multiple scheduled encounters for one patient');
  assert.strictEqual(ambiguous.context.currentVisitAthenaBinding, null, 'ambiguous staging appointments installed a binding');

  const calendarSelected = makeStagingAdapterHarness({ rows: ambiguousRows });
  assert.strictEqual(calendarSelected.context.calStartVisit('3795'), true, 'calendar selection wrapper did not preserve the original Start visit behavior');
  assert.strictEqual(calendarSelected.api.exactActionReady('recording'), true, 'explicit calendar appointment did not disambiguate the exact staging visit');
  assert.strictEqual(calendarSelected.context.currentVisitAthenaBinding.visitContext.appointmentId, '52585119', 'calendar selection froze the wrong Athena appointment');

  const heroSelected = makeStagingAdapterHarness({
    rows: ambiguousRows,
    heroRows: [{ name: 'Jane Exact', dob: '03/24/1980', date: '2026-07-19', time: '10:00 AM', provider: 'Matthew Exact, MD' }],
    heroSelected: 0
  });
  assert.strictEqual(heroSelected.api.exactActionReady('note generation'), true, 'explicit next-up selection did not disambiguate the exact staging visit');
  assert.strictEqual(heroSelected.context.currentVisitAthenaBinding.visitContext.appointmentId, '52585119', 'next-up selection froze the wrong Athena appointment');

  const wrongPatient = makeStagingAdapterHarness({ rows: [{ ...exact.rows[0], patient_external_id: 'p-other' }] });
  assert.strictEqual(wrongPatient.api.exactActionReady('recording'), false, 'staging accepted a schedule row linked to another patient');
  const missingProvider = makeStagingAdapterHarness({ rows: [{ ...exact.rows[0], provider: '' }] });
  assert.strictEqual(missingProvider.api.exactActionReady('recording'), false, 'staging accepted a schedule row without an exact provider');

  const staleBinding = frozenBinding(exact.active, {
    source: 'old-visit',
    visitContext: { noteTimestamp: Date.now(), visitDate: '2026-07-18', provider: 'Other Provider, MD', appointmentId: '40000000' }
  });
  const rebound = makeStagingAdapterHarness({ binding: staleBinding });
  assert.strictEqual(rebound.api.exactActionReady('note generation'), false, 'staging silently replaced a mismatched in-progress visit binding');
  assert.strictEqual(rebound.context.currentVisitAthenaBinding, staleBinding, 'staging mutated the prior mismatched visit binding');

  console.log(`PASS visible clinical action ownership: ${expectedInlineRoutes.length * htmlSources.length} raw record/generate DOM routes are hidden/contained, ${expectedReviewRoutes.length * htmlSources.length} review routes stay supervised, and ${proxyInventory.length} visible proxy families terminate in exact-gated engine sinks`);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
