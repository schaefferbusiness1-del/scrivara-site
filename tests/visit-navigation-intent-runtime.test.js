'use strict';

/* Synthetic execution of the production source: Pause must not schedule
 * Generate, and delayed review may only open the visit the doctor asked for. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', '1p-mls-connect.js'), 'utf8');
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'missing source region: ' + start);
  return source.slice(a, b);
}
const canonical = between('  function withAdvancedWorkspace(fn)', '  function wireVisitQuickTools()');
assert(!/installAutoAdvance|__ez3AutoGenWrap|ez3AutoGenerate|window\.stopCapture\s*=/.test(canonical),
  'a low-level Stop still installs deferred automatic generation');

/* The enhancement lane and the Easy renderer must agree on whether a visit
 * exists. Shared transcript bytes alone never authorize clinical controls on
 * Home/Choose, while an explicit Doctor open can adopt the exact active
 * patient and an already-frozen visit without mutating either. */
{
  const laneReady = between('  function doctorVisitLaneReady()', '  function clickTopVoiceControl(');
  let easyState = { mode: 'doctor', screen: 'home', locked: null };
  const laneCtx = { window: { __mlsEasyV32: { state: () => easyState } } };
  vm.createContext(laneCtx);
  vm.runInContext(laneReady + '\nthis.ready=doctorVisitLaneReady;', laneCtx);
  assert.strictEqual(laneCtx.ready(), false, 'Home accepted a source-only enhancement lane');
  easyState = { mode: 'doctor', screen: 'doctor', locked: null };
  assert.strictEqual(laneCtx.ready(), false, 'Doctor screen without a patient lock accepted the lane');
  easyState = { mode: 'doctor', screen: 'doctor', locked: { id: 'fixture-patient-one' } };
  assert.strictEqual(laneCtx.ready(), true, 'an exact active Doctor visit lost its enhancement lane');
  easyState = { mode: 'doctor', screen: 'choose', locked: { id: 'fixture-patient-one' } };
  assert.strictEqual(laneCtx.ready(), false, 'Choose retained the prior visit lane');
}
{
  const adopt = between('  function adoptActiveVisitForDoctorOpen()', '  function generationWarningDuplicatesLane(');
  const patient = { id: 'fixture-patient-one', name: 'Synthetic Patient', dob: '2000-01-02', mrn: 'MRN-1' };
  const binding = { id: 'binding-one', patient: { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn },
    visitContext: { sourceId: 'source-row-one', appointmentId: 'appointment-one', visitDate: '2026-09-10', provider: 'Synthetic Doctor' } };
  const S = { appt: null, locked: null, phase: 'note', editing: true, genClickedAt: 44, signedAt: 55, lastWarn: 'kept' };
  const ctx = {
    S, canonicalActivePatient: () => patient, currentVisitBinding: () => binding,
    nameMatch: (a, b) => String(a) === String(b), dobConflicts: (a, b) => !!a && !!b && a !== b,
    mrnConflicts: (a, b) => !!a.mrn && !!b.mrn && a.mrn !== b.mrn
  };
  vm.createContext(ctx);
  vm.runInContext(adopt + '\nthis.adopt=adoptActiveVisitForDoctorOpen;', ctx);
  assert.strictEqual(ctx.adopt(), true, 'exact active saved visit was not adopted');
  assert.strictEqual(S.appt.appointmentId, 'appointment-one', 'adoption lost the exact saved appointment');
  assert.strictEqual(S.appt.appt_date, '2026-09-10', 'adoption lost the exact saved visit date');
  assert.strictEqual(S.appt.provider, 'Synthetic Doctor', 'adoption lost the exact saved provider');
  assert.strictEqual(S.locked.id, patient.id, 'adoption changed the active patient');
  assert.deepStrictEqual({ phase: S.phase, editing: S.editing, genClickedAt: S.genClickedAt, signedAt: S.signedAt, lastWarn: S.lastWarn },
    { phase: 'note', editing: true, genClickedAt: 44, signedAt: 55, lastWarn: 'kept' },
    'navigation reset existing draft/visit state');
  S.appt = null; S.locked = null;
  binding.patient.patientId = 'different-patient';
  assert.strictEqual(ctx.adopt(), false, 'conflicting saved binding was silently adopted');
  assert.strictEqual(S.appt, null, 'refused adoption changed the workspace');
}
{
  const helpers = between("  function noteText() { var n = $('noteBox');", '  function signBtn()');
  const clickWire = between("    on('ez3ActiveGo', function () {", "    on('ez3Choose', function () {");
  const patient = { id: 'fixture-patient-one', name: 'Synthetic Patient', dob: '2000-01-02', mrn: 'MRN-1' };
  const visit = { id: 'appointment-one', _patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn };
  const S = { appt: visit, locked: { id: visit.id, name: patient.name, dob: patient.dob, mrn: patient.mrn }, phase: 'note', recStart: 0, genClickedAt: 0 };
  const fields = { transcript: { value: 'Exact retained synthetic source.' }, noteBox: { value: 'Exact retained synthetic note.' },
    ez3ActiveGo: { getAttribute: key => key === 'data-continue' ? '1' : '' } };
  let active = patient, modeCalls = 0, recordCalls = 0, renderCalls = 0, capturing = false;
  const originalVisit = JSON.stringify(visit), originalSource = fields.transcript.value, originalNote = fields.noteBox.value;
  const ctx = {
    S, String, $: id => fields[id] || null, canonicalActivePatient: () => active,
    visitBindingOwnsPatient: id => String(id) === String(patient.id) && String(S.appt._patientId) === String(id),
    nameMatch: (a, b) => String(a) === String(b), dobConflicts: (a, b) => !!a && !!b && a !== b,
    mrnConflicts: (a, b) => !!a.mrn && !!b.mrn && a.mrn !== b.mrn,
    captureBusy: () => capturing, esc: value => String(value), bannerPatient: () => active,
    on(id, fn) { if (id === 'ez3ActiveGo') ctx.click = fn; },
    setEasyMode(mode, screen, reason) { assert.deepStrictEqual([mode, screen, reason], ['doctor', 'doctor', 'home-continue-visit']); modeCalls++; },
    render() { renderCalls++; }, bannerRowToday: () => { throw new Error('continuation resolved a new appointment'); },
    lockAndStart() { recordCalls++; }, lockAndStartPatient() { recordCalls++; }
  };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\nthis.owns=homeOwnsContinuableVisit;this.action=activePatientHomeAction;', ctx);
  assert.strictEqual(ctx.owns(patient), true, 'exact owned draft did not become continuable');
  const html = ctx.action(patient, 'new visit detail', '');
  assert(/>➡ Continue visit</.test(html), 'owned draft still rendered Start recording');
  assert(/aria-label="Continue visit"/.test(html) && !/aria-label="[^"]*Synthetic Patient/.test(html), 'Continue visit accessible name includes a patient name');
  assert(/<small>Return to this visit’s note and transcript<\/small>/.test(html),
    'the Continue sub-label does not name what is actually there to return to. Markup: ' + html);
  assert(/ data-rec="0"/.test(html),
    'the Continue press is stamped as a recording press. The verdict lane watches #ez3ActiveGo, so it arms on this ' +
    'press and paints "Recording did not start and MLS was not told why" over a visit nobody asked to record. Markup: ' + html);
  vm.runInContext(clickWire, ctx);
  ctx.click();
  assert.strictEqual(modeCalls, 1, 'Continue visit did not navigate to the existing Doctor room');
  assert.strictEqual(recordCalls, 0, 'Continue visit started recording or rebuilt the visit');
  assert.strictEqual(renderCalls, 0, 'stable Continue visit needed an extra repaint');
  assert.strictEqual(JSON.stringify(S.appt), originalVisit, 'Continue visit changed the visit binding');
  assert.strictEqual(fields.transcript.value, originalSource, 'Continue visit changed the source');
  assert.strictEqual(fields.noteBox.value, originalNote, 'Continue visit changed the note');

  fields.transcript.value = ''; fields.noteBox.value = ''; S.phase = 'idle';
  assert.strictEqual(ctx.owns(patient), false, 'a new empty visit was promoted to Continue');
  assert(/Start Recording/.test(ctx.action(patient, 'new visit detail', '')), 'a new empty visit lost Start recording');
  fields.transcript.value = 'Stale bytes from the prior patient.';
  active = { id: 'fixture-patient-two', name: 'Other Patient', dob: '2001-03-04', mrn: 'MRN-2' };
  assert.strictEqual(ctx.owns(active), false, 'stale other-patient source promoted Continue visit');

  /* A PARKED PHASE IS NOT A LIVE VISIT.
     stopRecordingOnly parks S.phase at 'stopped' and clears nothing else, and
     a patient switch through lockAndStartPatient resets editing/genClickedAt
     but NOT phase/recStart. Both therefore outlive the visit that set them, so
     reading them as "live" offered "Continue visit" on an ENTIRELY EMPTY new
     visit - and Home was then left with no Start Recording door at all. */
  active = patient;
  fields.transcript.value = ''; fields.noteBox.value = '';
  S.phase = 'stopped'; S.recStart = 1757000000000; S.genClickedAt = 0;
  assert.strictEqual(ctx.owns(patient), false,
    'a parked stopped phase with empty editors was offered as a visit to continue - there is nothing there to return to');
  const startMarkup = ctx.action(patient, 'no appointment today', '');
  assert(/🎙 Start Recording/.test(startMarkup),
    'an empty visit on a parked phase lost its Start Recording door. Markup: ' + startMarkup);
  assert(/ data-rec="1"/.test(startMarkup),
    'the Start Recording form must still be stamped as a recording press. Markup: ' + startMarkup);

  /* and the sub-label names what actually exists, in each shape */
  fields.transcript.value = 'A synthetic spoken line from this visit.';
  assert.strictEqual(ctx.owns(patient), true, 'a stopped visit that already holds a transcript lost its Continue offer');
  const sourceOnly = ctx.action(patient, 'no appointment today', '');
  assert(/<small>Return to this visit’s transcript<\/small>/.test(sourceOnly),
    'a transcript-only visit was described as having a note. Markup: ' + sourceOnly);
  fields.transcript.value = ''; fields.noteBox.value = 'A synthetic drafted note.';
  assert.strictEqual(ctx.owns(patient), true, 'a stopped visit that already holds a note lost its Continue offer');
  assert(/<small>Return to this visit’s note<\/small>/.test(ctx.action(patient, 'no appointment today', '')),
    'a note-only visit was described as having a transcript');
  fields.noteBox.value = '';
  capturing = true;
  assert.strictEqual(ctx.owns(patient), true, 'a running capture with empty editors is a live visit and must stay continuable');
  assert(/<small>Return to this visit<\/small>/.test(ctx.action(patient, 'no appointment today', '')),
    'a live but still-empty visit claimed content it does not have');
  capturing = false;

  /* THE RECORDING-VERDICT LANE MUST NOT ARM ON A CONTINUE PRESS.
     #ez3ActiveGo is in REC_START_SEL, and recPressWanted arms on anything not
     stamped data-rec="0", so before this stamp every Continue press armed
     _recArmed and the sheet painted the red "Recording did not start and MLS
     was not told why" refusal 1.2 s later. Executed, not grepped: the lane's
     own listener is run against the markup the renderer actually emits. */
  const lane = between('  var _recFail = null;      /* { why, kind, at }', '  /* ===== recvis-1.0.0 end');
  const laneCtx = { document: { querySelectorAll: () => [] }, window: {}, console,
    recordingNow: () => false, verifiedActivePatient: () => patient, scheduleLaneSync() {} };
  vm.createContext(laneCtx);
  vm.runInContext(lane + '\nthis.press=laneRecordPress;this.wanted=recPressWanted;this.sel=REC_START_SEL;', laneCtx);
  function pressEventFor(markup) {
    const tag = (markup.match(/^<button[^>]*>/) || [''])[0];
    const attrs = {};
    const re = /([a-zA-Z-]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(tag))) attrs[m[1]] = m[2];
    const el = { getAttribute: key => (Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key] : null) };
    return { target: { closest: sel => (String(sel).split(',').indexOf('#' + attrs.id) >= 0 ? el : null) } };
  }
  fields.transcript.value = 'A synthetic spoken line from this visit.';
  const continueMarkup = ctx.action(patient, 'no appointment today', '');
  assert(/➡ Continue visit/.test(continueMarkup), 'the Continue markup under test is not a Continue offer');
  laneCtx._recArmed = null;
  laneCtx.press(pressEventFor(continueMarkup));
  assert.strictEqual(laneCtx._recArmed, null,
    'pressing Continue visit armed the recording-verdict lane. Nothing on the Continue path ever disarms it, so the ' +
    'sheet paints "Recording did not start and MLS was not told why" over a visit nobody asked to record.');
  laneCtx.press(pressEventFor(startMarkup));
  assert(laneCtx._recArmed && laneCtx._recArmed.at > 0,
    'POSITIVE CONTROL: a real Start Recording press no longer arms the lane, so the assertion above proves nothing - ' +
    'either #ez3ActiveGo left REC_START_SEL or the press listener stopped reading these buttons');
  assert.strictEqual(laneCtx.wanted(pressEventFor(continueMarkup).target.closest(laneCtx.sel)), false,
    'recPressWanted does not honour the data-rec="0" stamp the Continue form emits');
  assert.strictEqual(laneCtx.wanted(pressEventFor(startMarkup).target.closest(laneCtx.sel)), true,
    'recPressWanted stopped treating the Start Recording form as a recording press');
}
{
  const warningHelper = between('  function generationWarningDuplicatesLane(message)', '  /* =======================================================================\n   *  renderers');
  let hint = { state: 'failed', text: 'Generation could not finish. Your prior draft was retained. [draft_quality_failed]' };
  const ctx = { window: { __mlsEz3Flow: { genRun: { hint: () => hint } } } };
  vm.createContext(ctx);
  vm.runInContext(warningHelper + '\nthis.duplicate=generationWarningDuplicatesLane;', ctx);
  assert.strictEqual(ctx.duplicate('Generation could not finish. Your prior draft was retained.'), true,
    'the same generation error with a diagnostic suffix still rendered twice');
  hint = { state: 'failed', text: 'A different failure.' };
  assert.strictEqual(ctx.duplicate('Generation could not finish. Your prior draft was retained.'), false,
    'a distinct warning was incorrectly suppressed');
}
assert(source.includes("var kill = (staff || !doctorVisit) ? '.ez3fl-staffLink,.ez3fl-record'"),
  'Home/Choose does not remove a previously mounted enhancement lane');
assert(source.includes('!onStaffScreen(body) && doctorVisitLaneReady()'),
  'the fast remount path can recreate the lane on Home/Choose');
const stop = between('  function stopRecordingOnly(fromLane)', '  /* The top lane must not call');
for (const scenario of ['pause', 'resume', 'next-patient', 'next-visit']) {
  let capturing = true, stops = 0, generations = 0;
  const timers = [];
  const tx = 'A synthetic consultation with enough words to trigger the retired automatic generation behavior after pausing.';
  const state = { phase: 'rec', appt: { id: 'fixture-slot-one' }, genClickedAt: 0 };
  const sandbox = {
    window: { __mlsStopAllCapture() { stops++; capturing = false; return true; } },
    S: state, stopIv: null, captureBtn: () => ({}), isRecording: () => capturing,
    isFn: f => typeof f === 'function', toast() {}, render() {},
    setTimeout: f => timers.push(f), clearInterval() {},
    document: { getElementById: () => ({ value: tx }) },
    genBtnResolve: () => ({ click() { generations++; } })
  };
  vm.runInNewContext(stop + '\nstopRecordingOnly(false);', sandbox);
  assert.strictEqual(stops, 1, scenario + ': Pause did not call the recorder once');
  assert.strictEqual(state.phase, 'stopped', scenario + ': Pause did not settle stopped');
  if (scenario === 'resume') { capturing = true; state.phase = 'rec'; }
  if (scenario === 'next-patient' || scenario === 'next-visit') state.appt = { id: 'fixture-slot-two' };
  timers.splice(0).forEach(f => f());
  assert.strictEqual(generations, 0, scenario + ': Stop generated a note later');
  assert.strictEqual(state.genClickedAt, 0, scenario + ': Stop claimed generation');
}

const review = between('  function openReviewStep()', '  function setLaneHidden(');
const reviewState = between('  function setReviewStepOpen(open)', '  /* visitlane-1.0.0');
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { if (listeners.has(name)) listeners.get(name).delete(fn); },
    dispatchEvent(ev) { for (const fn of [...(listeners.get(ev.type) || [])]) fn(ev); },
    listenerCount() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); }
  };
}
function setup(options = {}) {
  const timers = new Map(), messages = [], flags = new Set();
  let time = 0, nextTimer = 0, doorClicks = 0, focusCalls = 0, scrollCalls = 0, patientId = 'fixture-patient-one';
  if (options.workspaceOpen !== false) flags.add('ez3adv');
  const elements = {
    noteBox: { id: 'noteBox', value: options.note === undefined ? 'A complete synthetic note ready to review.' : options.note, dispatchEvent() {} },
    transcript: { id: 'transcript', value: 'Synthetic visit conversation.' },
    visitView: { style: { display: 'block' } },
    mlsRvAckCss: {},
    ez3Adv: { click() { assert.strictEqual(window.__mlsAdvQuietOpen, true); flags.add('ez3adv'); } }
  };
  const classList = { contains: x => flags.has(x), toggle(x, on) { if (on) flags.add(x); else flags.delete(x); } };
  const send = elements.pushAllEmrBtn = {
    style: {}, disabled: false,
    getBoundingClientRect: () => ({ top: 50, bottom: 90, left: 0, right: 250 }),
    focus(opts) { assert.strictEqual(opts.preventScroll, true); focusCalls++; },
    classList: { remove() {}, add() {} }
  };
  function openDoor() {
    doorClicks++;
    if (options.throwDoor) throw new Error('synthetic dispatch failure');
    if (options.refuseDoor) return false;
    elements[options.patientConfirmation ? 'ez3Confirm' : 'mlsAthenaUnifiedConfirm'] = {};
    return true;
  }
  send.click = openDoor;
  elements.ez3Send = { click: openDoor };
  const window = Object.assign(eventTarget(), {
    __mlsCurrentView: 'visit', __mlsAdvQuietOpen: false,
    scrollY: 240, scrollX: 0, innerHeight: 900,
    getActivePtId: () => patientId,
    scrollTo(x, y) { scrollCalls++; window.scrollY = y; }
  });
  const document = Object.assign(eventTarget(), {
    body: { classList }, documentElement: {},
    getElementById: id => elements[id] || null
  });
  const ctx = {
    window, document, $: id => elements[id] || null,
    _reviewStepOpen: false, _genRun: { active: false },
    currentNoteId: 'fixture-note-one', _mlsConsentEpoch: 1,
    currentVisitAthenaBinding: { patient: { id: 'fixture-patient-one' }, visitContext: { appointmentId: 'fixture-slot-one' } },
    CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
    verifiedActivePatient: () => ({ id: patientId }),
    genTranscriptText: () => elements.transcript.value,
    noteRecordIdentity: () => 'fixture-note-one',
    noteTranscriptOutdated: () => false,
    noteLooksLikeRefusal: t => /^I cannot/.test(t), NEXTGATE_REFUSAL_WHY: 'Generate again before reviewing.',
    flowToast: (message, kind) => messages.push({ message, kind }), REVIEW_FIXED_FURNITURE: [],
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.createContext(ctx);
  vm.runInContext(reviewState + review, ctx);
  function advance(ms = 1000) {
    const until = time + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); time = next[1].at; next[1].fn();
    }
    time = until;
  }
  return {
    ctx, elements, window, document, messages, advance,
    open: () => ctx.openReviewStep(), close: () => ctx.setReviewStepOpen(false),
    patient: value => { patientId = value; },
    signal: (type, detail) => window.dispatchEvent({ type, detail }),
    counts: () => ({ doorClicks, focusCalls, scrollCalls }),
    assertClean() {
      assert.strictEqual(ctx.openReviewStep.pending, null, 'pending review leaked');
      assert.strictEqual(window.listenerCount(), 0, 'review lifecycle listeners leaked');
      assert.strictEqual(document.listenerCount(), 0, 'review input listener leaked');
    }
  };
}
for (const workspaceOpen of [true, false]) {
  const h = setup({ workspaceOpen }); h.open();
  assert.strictEqual(h.window.__mlsAdvQuietOpen, false, 'quiet-open flag escaped the synchronous toggle');
  h.window.scrollY = 580; h.advance();
  assert.deepStrictEqual(h.counts(), { doorClicks: 1, focusCalls: 1, scrollCalls: 0 });
  assert.strictEqual(h.window.scrollY, 580, 'review rewound a deliberate scroll');
  assert(h.messages.some(x => /Athena review opened/.test(x.message)), 'successful sheet lacked its receipt');
  h.assertClean();
}
const cancellations = {
  'selected patient changed': h => h.patient('fixture-patient-two'),
  'same patient different appointment': h => { h.ctx.currentVisitAthenaBinding.visitContext.appointmentId = 'fixture-slot-two'; },
  'new visit for same patient': h => { h.ctx._mlsConsentEpoch++; },
  'saved note reopened': h => { h.ctx.currentNoteId = 'fixture-note-two'; },
  'canonical note changed': h => { h.elements.noteBox.value += ' Added.'; },
  'transcript changed': h => { h.elements.transcript.value += ' Added.'; },
  'left Visit without event': h => { h.window.__mlsCurrentView = 'history'; },
  'Visit hidden': h => { h.elements.visitView.style.display = 'none'; },
  'left and returned to Visit': h => { h.signal('mls:view-changed', { view: 'history' }); h.signal('mls:view-changed', { view: 'visit' }); },
  'patient event away and back': h => { h.signal('mls:active-patient-changed', { patientId: 'fixture-patient-two' }); },
  'editing then undoing': h => { const before = h.elements.noteBox.value; h.elements.noteBox.value += ' Added.'; h.document.dispatchEvent({ type: 'input', target: h.elements.noteBox }); h.elements.noteBox.value = before; },
  'left review step': h => h.close(),
  'workspace closed before repaint': h => h.document.body.classList.toggle('ez3adv', false),
  'Send became unavailable': h => { h.elements.pushAllEmrBtn.disabled = true; },
  'generation started': h => h.signal('mls:generation-started', { runId: 1 }),
  'generation silently active': h => { h.ctx._genRun.active = true; },
  'session ended': h => h.signal('mls:session-boundary', {}),
  'day changed': h => h.signal('mls:easy-visit-day-changed', {}),
  'room changed': h => h.signal('mls:easy-mode-changed', { screen: 'home' })
};
for (const [name, mutate] of Object.entries(cancellations)) {
  const h = setup(); h.open(); mutate(h); h.advance();
  assert.deepStrictEqual(h.counts(), { doorClicks: 0, focusCalls: 0, scrollCalls: 0 }, name + ': stale review still acted');
  assert.strictEqual(h.ctx._reviewStepOpen, false, name + ': stale review hid the original note');
  h.assertClean();
}
{
  const h = setup(); h.open(); h.open(); h.advance();
  assert.strictEqual(h.counts().doorClicks, 1, 'rapid repeated Review opened duplicate sheets');
  h.assertClean();
}
{
  const h = setup(); h.open();
  h.document.dispatchEvent({ type: 'input', target: h.elements.noteBox });
  h.document.dispatchEvent({ type: 'input', target: h.elements.transcript });
  h.advance();
  assert.strictEqual(h.counts().doorClicks, 1, 'unchanged synchronization events cancelled a valid review');
  h.assertClean();
}
for (const option of ['refuseDoor', 'throwDoor', 'patientConfirmation']) {
  const h = setup({ [option]: true }); h.open(); h.advance();
  assert.strictEqual(h.counts().doorClicks, 1, 'the existing gated door was bypassed');
  assert(!h.messages.some(x => /Athena review opened/.test(x.message)), option + ': click was treated as a sheet receipt');
  assert(h.messages.some(x => option === 'patientConfirmation' ? /Confirm the note/.test(x.message) : /could not be opened/.test(x.message)));
  h.assertClean();
}
for (const note of ['', 'I cannot generate this note.']) {
  const h = setup({ note }); h.open(); h.advance();
  assert.strictEqual(h.counts().doorClicks, 0, 'empty/refusal note reached the review door');
  assert.strictEqual(h.messages.length, 1, 'empty/refusal gate stopped explaining its refusal');
}

/* Closing the unified sheet must unwind the Easy-only review workspace. The
 * marker is deliberately false for a clinician who opened Review from the
 * advanced workspace, so that path must remain exactly where it was. */
const closeReturn = between('  function laneUnifiedReviewClosed()', '  function laneSignal(');
function setupCloseReturn(easyOwned) {
  const flags = new Set(['ez3adv']);
  const calls = { adv: 0, sync: 0, focus: 0, generated: 0 };
  const elements = {
    noteBox: { value: 'Exact saved synthetic note bytes.' },
    ez3Adv: { click() { calls.adv++; flags.delete('ez3adv'); } },
    ez3flReview: { hidden: false, focus(opts) { assert.strictEqual(opts.preventScroll, true); calls.focus++; } }
  };
  const ctx = {
    _reviewStepOpen: easyOwned,
    _primaryLane: { id: 'fixture-lane' },
    window: { __mlsAdvQuietOpen: false },
    document: {
      body: { classList: { contains: value => flags.has(value) } },
      querySelector() { return null; }
    },
    $: id => elements[id] || null,
    setReviewStepOpen(value) { ctx._reviewStepOpen = !!value; },
    syncTopLane(rec) { assert.strictEqual(rec, ctx._primaryLane); calls.sync++; },
    setTimeout(fn) { fn(); }
  };
  vm.createContext(ctx);
  vm.runInContext(closeReturn, ctx);
  return { ctx, flags, calls, note: elements.noteBox.value };
}
{
  const h = setupCloseReturn(true);
  assert.strictEqual(h.ctx.laneUnifiedReviewClosed(), true, 'Easy-owned review did not return to its note screen');
  assert.deepStrictEqual(h.calls, { adv: 1, sync: 1, focus: 1, generated: 0 });
  assert.strictEqual(h.ctx._reviewStepOpen, false, 'Easy review ownership marker survived close');
  assert.strictEqual(h.flags.has('ez3adv'), false, 'advanced workspace remained over the Easy note');
  assert.strictEqual(h.note, 'Exact saved synthetic note bytes.', 'closing review changed the note');
}
{
  const h = setupCloseReturn(false);
  assert.strictEqual(h.ctx.laneUnifiedReviewClosed(), false, 'direct advanced review was claimed by Easy');
  assert.deepStrictEqual(h.calls, { adv: 0, sync: 0, focus: 0, generated: 0 });
  assert.strictEqual(h.flags.has('ez3adv'), true, 'direct advanced workspace was closed');
}
assert(/addEventListener\('mls:athena-review-closed', laneUnifiedReviewClosed\)/.test(source),
  'Easy return is not wired to unified review close');
assert(/removeEventListener\('mls:athena-review-closed', laneUnifiedReviewClosed\)/.test(source),
  'Easy return listener is not removed during shell rollback');
for (const file of ['1p-feat_mls_writeflow.js', 'feat_mls_writeflow.js']) {
  const wfSource = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = wfSource.indexOf('  function closeUnifiedConfirmation()');
  const end = wfSource.indexOf('  /* sheetux-1.0.0', start);
  assert(start >= 0 && end > start, file + ': unified close function missing');
  let removed = false;
  const events = [];
  const closeCtx = {
    unifiedAthenaState: { returnFocus: { id: 'ez3flReview' }, manifest: { rows: [] }, a11yKeyHandler: null },
    destinationTeacher: () => null,
    wfautoCancel() {},
    unifiedVisibleFocusTarget: () => false,
    setTimeout() { throw new Error('hidden old focus should not win after Easy closes its workspace'); },
    CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
    document: { getElementById: () => ({ remove() { removed = true; } }) },
    window: { dispatchEvent(ev) { assert.strictEqual(removed, true, 'close event preceded sheet removal'); events.push(ev); } }
  };
  vm.createContext(closeCtx);
  vm.runInContext(wfSource.slice(start, end) + '\ncloseUnifiedConfirmation();', closeCtx);
  assert.strictEqual(events.length, 1, file + ': unified close emitted no single lifecycle event');
  assert.strictEqual(events[0].type, 'mls:athena-review-closed');
  assert.strictEqual(events[0].detail.returnFocusId, 'ez3flReview');
  assert.strictEqual(closeCtx.unifiedAthenaState, null, file + ': unified state survived close');
}

console.log('PASS visit navigation intent: Pause stays paused; review acts once for the original visit, cancels stale work, preserves deliberate scrolling, reports real sheet receipts, and closes back to its owning Easy note');
