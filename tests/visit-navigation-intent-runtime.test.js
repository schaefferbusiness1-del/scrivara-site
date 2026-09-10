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
