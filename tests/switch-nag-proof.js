'use strict';

/*
 * nonag-1.0.0 — THE UNSAVED-VISIT QUESTION IS FOR THE DOCTOR, ONCE.
 * -----------------------------------------------------------------------------
 * MEASURED in the owner's tab on 2026-09-02, late morning (the copy live at the
 * time was build b1205). With an unsaved generated note for the active patient
 * open on the Visit screen, this modal kept coming back — "it just keeps popping
 * up":
 *
 *   "You have an unsaved visit/note for <patient>.
 *    Switching patients now will leave that work behind - it will NOT follow the
 *    new patient. Continue switching?  [Cancel] [OK]"
 *
 * On screen at the same time: the schedule's "Up now: <patient> - loaded &
 * ready. Hit Start recording." banner, and the "Up now on the schedule: <other
 * patient>. You are working in a different chart, so nothing was switched.
 * [Switch to X] [Stay here]" strip.
 *
 * THE QUESTION WAS NEVER THE BUG — ITS CALLERS WERE. window.setActivePtId and
 * window.selectPatient are the switch chokepoint for the WHOLE app, and
 * feat_mls_patientlock_b53.js guards exactly those two. So every MACHINE arrival
 * lands on the same guard as a doctor's press: the up-next/schedule tick, the
 * up-now anchor's retry ladder, the athenaOne follow's arrival/visibility
 * handler, the day-strip header alignment's setTimeout, the pull-done landing.
 * Each arrival re-ran decideSwitch, and each one re-opened the dialog the doctor
 * had just dismissed. A tick has no answer to give: it cannot consent to
 * abandoning a doctor's note.
 *
 * WHAT THIS SUITE PINS, against the SHIPPED guard, the SHIPPED anchor strip and
 * the SHIPPED callers:
 *   A. Source — the guard still wraps both chokepoints, the confirm text is the
 *      one the owner saw, and the named automatic callers really do reach the
 *      chokepoint from machine events (tick / visibility / setTimeout / poll)
 *      while the patient row really is a click.
 *   B. An automatic arrival with unsaved work: NO confirm, NO switch, and the
 *      real anchor strip painted, with its real message and its own Switch /
 *      Stay buttons.
 *   C. A doctor press: exactly ONE confirm. Pressing the strip's own "Switch
 *      to X" is a doctor press and asks once — the strip is not a dead end.
 *   D. Cancel is an answer: a second tick and a second doctor press on the SAME
 *      target raise NO second confirm and switch nothing. A DIFFERENT target
 *      asks once. Saving (or clearing) the visit resets the memory.
 *   E. The recording block is unchanged, and stops speaking on machine ticks.
 *   F. A silent refusal is still a REFUSAL: switchWillBeRefused stays true, so
 *      mls-connect.js's __mlsOpenSwitchFix still skips its preserve-then-reset.
 *   H. AN EXPLICIT SELECTION WINS AND STAYS — measured in the same tab about
 *      11:5x: setActivePtId('<other chart>') returned without throwing and
 *      activePatient() still named the up-now patient afterwards, so the
 *      generation ran under HER context. The chart the doctor chose survives
 *      every following anchor tick, with and without unsaved work, and the
 *      strip names the up-now patient it stood down for.
 *   G. Anti-vacuity: with the classifier neutered, the same automatic ticks
 *      reproduce the measured nag.
 *
 * Synthetic patients only. No network, no Athena, no PHI.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

const lockSource = read('feat_mls_patientlock_b53.js');
const connect = read('mls-connect.js');
const shell1p = read('1pScribeFlow.html');
const shellProd = read('ScribeFlow.html');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

/* =============================================================== A. SOURCE ===
 * The runtime half below is only worth anything if these are still the shapes
 * that ship. Each one is a sentence from the caller table.
 */

/* The guard, and the exact question. */
ok(lockSource.includes('window.setActivePtId = guardedSwitchFn(window.setActivePtId') &&
   lockSource.includes('window.selectPatient = guardedSwitchFn(window.selectPatient'),
  'the patient lock no longer wraps BOTH switch chokepoints, so this suite is guarding nothing');
ok(lockSource.includes('You have an unsaved visit/note for ') &&
   lockSource.includes('Switching patients now will leave that work behind - it will NOT follow the new patient. Continue switching?'),
  'the abandon question is no longer the wording the owner measured');
ok(lockSource.includes('function doctorGesture()') && lockSource.includes('function offerInsteadOfSwitching(targetId)'),
  'nonag-1.0.0 is gone from the guard: nothing classifies the arrival any more');
ok(/if \(!human\) \{ offerInsteadOfSwitching\(targetId\); return false; \}/.test(lockSource),
  'the automatic-arrival branch no longer refuses silently');
ok(/if \(declinedTarget\(targetId\)\) \{ saidStayingHere\(\); return false; \}/.test(lockSource),
  'the once-per-target memory no longer short-circuits the dialog');
ok(lockSource.includes('if (!ok) { rememberDeclined(targetId); return; }'),
  'Cancel is no longer remembered, so the very next arrival asks again');
ok(lockSource.includes('function clearLock() { LOCK.snapshot = null; LOCK.hasPendingWork = false; LOCK.capturing = false; resetDeclined(); }'),
  'saving/sending/clearing the visit no longer resets the once-per-target memory');
ok(lockSource.includes('if (!human && wouldOverrideChosenChart(targetId)) { offerInsteadOfSwitching(targetId); return false; }'),
  'the anchor re-assertion branch is gone: a machine arrival can move the active patient off the chart the doctor chose');
ok(lockSource.includes('switchAsDoctor: function (id) {'),
  'the explicit-selection entry point is gone, so a programmatic selection has no way to say it is the doctor\'s');

/* DOCTOR callers — a press, in a trusted event. */
ok(shell1p.includes('onclick="selectPatient(\'') && shellProd.includes('onclick="selectPatient(\''),
  'the patient row is no longer a click that calls selectPatient — reclassify it before trusting this suite');

/* AUTOMATIC callers — machine events that reach the same two globals. */
const follow = read('feat_mls_athena_follow.js');
ok(follow.includes('if (isFn(window.setActivePtId)) window.setActivePtId(S(p.id));') &&
   follow.includes('function onVisibility()'),
  'the athenaOne follow no longer switches the active patient from an arrival/visibility handler');
const strip = read('feat_mls_strip_day_couple.js');
ok(strip.includes('window.selectPatient(p.id)') && strip.includes('alignHeaderToWorkspace(); }, 300);'),
  'the day-strip header alignment no longer switches the active patient from a timer');
const upnow = read('feat_mls_upnow_activeselect.js');
ok(upnow.includes("maybeSelect('retry-' + pollTries);") && upnow.includes('window.selectPatient(p.id);'),
  'the up-now anchor no longer re-checks the active patient from its retry ladder');
ok(shell1p.includes("_mlsCaptureKeepsSelection('chart-pull-target', true)"),
  'the pull-done landing no longer routes its selection through the shell');

/* The strip the automatic arrivals are allowed to paint, and nothing else. */
ok(connect.includes('offer: anchorOffer') && connect.includes('window.__mlsPtAnchor = {'),
  'the schedule anchor no longer publishes offer(), so a silent refusal has no surface left');

/* ====================================================== the sliced anchor ===
 * The REAL strip painter, lifted out of the shipped bundle so the message and
 * the buttons in this suite are the ones on the owner's screen.
 */
const anchorStart = connect.indexOf("  var ANCHOR_ID = 'mlsRevAnchorOffer';");
const anchorEnd = connect.indexOf('\n\n  /* =======================================================================\n   *  9. THE ORIGINAL CONTROLS', anchorStart);
ok(anchorStart > 0 && anchorEnd > anchorStart, 'could not bound the schedule anchor (section 8) in mls-connect.js');
const anchorSrc = connect.slice(anchorStart, anchorEnd);
ok(anchorSrc.includes('function anchorOffer(name, id) {') &&
   anchorSrc.includes('You are working in a different chart, so nothing was switched.'),
  'the sliced anchor is not the offer painter');

/* ============================================================== the harness ===
 * A DOM small enough to read and real enough for the sliced painter: element
 * creation, insertBefore/removeChild, textContent, per-element click listeners,
 * and a capture-phase document listener (which is what the guard's arrival
 * classifier subscribes to).
 */
function boot(options) {
  options = options || {};
  const lockSrc = options.lockSource || lockSource;

  const byId = Object.create(null);
  const docCaps = Object.create(null);

  function El(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.id = '';
    this.type = '';
    this.className = '';
    this.value = '';
    this.style = {};
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = Object.create(null);
    this.listeners = Object.create(null);
    this._text = '';
  }
  Object.defineProperty(El.prototype, 'firstChild', { get() { return this.childNodes[0] || null; } });
  Object.defineProperty(El.prototype, 'textContent', {
    get() { return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join('') : this._text; },
    set(v) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; this._text = String(v == null ? '' : v); }
  });
  El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  El.prototype.appendChild = function (c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this; this.childNodes.push(c);
    if (c.id) byId[c.id] = c;
    return c;
  };
  El.prototype.insertBefore = function (c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i >= 0) this.childNodes.splice(i, 0, c); else this.childNodes.push(c);
    c.parentNode = this;
    if (c.id) byId[c.id] = c;
    return c;
  };
  El.prototype.removeChild = function (c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    if (c.id && byId[c.id] === c) delete byId[c.id];
    return c;
  };
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.querySelectorAll = function () { return []; };

  const host = new El('div');
  host.id = 'mlsEz3Body';
  byId[host.id] = host;

  const els = {
    transcript: new El('textarea'),
    noteBox: new El('textarea')
  };
  Object.keys(els).forEach((k) => { els[k].id = k; byId[k] = els[k]; });

  const document = {
    readyState: 'complete',
    getElementById(id) { return byId[id] || null; },
    createElement(t) { return new El(t); },
    addEventListener(t, fn) { (docCaps[t] = docCaps[t] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; }
  };

  /* A clock this suite can move. GESTURE_MS is 1500 in the guard, so a tick has
     to be pushed clear of the last press or it would (correctly) still look
     like part of that press. */
  let skew = 0;
  const RealDate = Date;
  function FakeDate() { return arguments.length ? new RealDate(...arguments) : new RealDate(); }
  FakeDate.now = function () { return RealDate.now() + skew; };
  FakeDate.prototype = RealDate.prototype;

  const log = { dialogs: [], toasts: [], newVisit: 0, bumps: 0, saves: 0 };
  const state = { activeId: 'A', capturing: false };
  const patients = {
    A: { id: 'A', name: 'Synthetic Alpha', dob: '01/01/1970' },
    B: { id: 'B', name: 'Synthetic Bravo', dob: '02/02/1980' },
    C: { id: 'C', name: 'Synthetic Charlie', dob: '03/03/1990' }
  };
  const answers = [];

  const win = { document: document };
  const sandbox = {
    window: win, document: document, console: console, Date: FakeDate,
    setTimeout(fn) { return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    Promise: Promise, Object: Object, String: String, JSON: JSON
  };

  win.getActivePtId = function () { return state.activeId; };
  win.activePatient = function () { return patients[state.activeId] || null; };
  win.findPatient = function (id) { return patients[id] || null; };
  win.setActivePtId = function (id) { state.activeId = id ? String(id) : ''; };
  win.selectPatient = function (id) { if (!id) return; win.setActivePtId(id); };
  win.newVisit = function () { log.newVisit++; els.transcript.value = ''; els.noteBox.value = ''; };
  win.saveCurrentNote = function () { log.saves++; return true; };
  win.startCapture = function () { state.capturing = true; return true; };
  win.stopCapture = function () { state.capturing = false; };
  win.toast = function (m) { log.toasts.push(String(m)); };
  win.mlsConfirm = function (message) {
    log.dialogs.push(String(message));
    return new Promise(function (resolve) { answers.push(resolve); });
  };

  vm.createContext(sandbox);
  /* The shipped guard, wrapping both chokepoints exactly as the async=false
     loader makes it do in the browser. */
  vm.runInContext(lockSrc, sandbox, { filename: 'feat_mls_patientlock_b53.js' });
  /* The shipped strip painter, given the four names its enclosing module holds. */
  vm.runInContext(
    'function safe(fn, d) { try { return fn(); } catch (e) { return d; } }\n' +
    'function isFn(f) { return typeof f === "function"; }\n' +
    'function $(id) { return document.getElementById(id); }\n' +
    'function bump() { window.__bumps = (window.__bumps || 0) + 1; }\n' +
    anchorSrc + '\n' +
    'window.__mlsPtAnchor = { installed: true, offer: anchorOffer, activeId: activeId };\n',
    sandbox, { filename: 'mls-connect.js#anchorOffer' });

  function fireCapture(type, ev) { (docCaps[type] || []).forEach((fn) => { try { fn(ev); } catch (e) {} }); }

  return {
    window: win, log: log, state: state, els: els, patients: patients,
    /* the doctor holds unsaved recorded work but is not recording any more */
    holdUnsavedWork() { win.startCapture(); win.stopCapture(); },
    typeVisit(t, n) { els.transcript.value = t; els.noteBox.value = n; },
    /* A press: a trusted UI event is being dispatched while the call is made —
       the patient row, "Switch to X", a search pick, a History reopen. */
    doctorPress(fn) {
      const ev = { type: 'click', isTrusted: true };
      win.event = ev;
      fireCapture('click', ev);
      try { return fn(); } finally { win.event = undefined; }
    },
    /* A machine arrival: no event is being dispatched, and it is far enough
       from the last press that it cannot be mistaken for one. */
    machineTick(fn) { win.event = undefined; skew += 4000; return fn(); },
    strip() { return document.getElementById('mlsRevAnchorOffer'); },
    stripText() { const s = document.getElementById('mlsRevAnchorOffer'); return s ? s.textContent : ''; },
    stripButton(label) {
      const s = document.getElementById('mlsRevAnchorOffer');
      if (!s) return null;
      return s.childNodes.filter((c) => c.tagName === 'BUTTON' && c.textContent.indexOf(label) === 0)[0] || null;
    },
    pressEl(el) {
      const ev = { type: 'click', isTrusted: true };
      win.event = ev;
      fireCapture('click', ev);
      try { (el.listeners.click || []).forEach((fn) => fn(ev)); } finally { win.event = undefined; }
    },
    answer(v) { assert(answers.length, 'no dialog was open to answer'); answers.shift()(v); },
    pendingAnswers() { return answers.length; }
  };
}

function tick() { return new Promise((resolve) => setImmediate(resolve)); }
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

const A_TRANSCRIPT = 'Synthetic Alpha reports right knee pain for three weeks.';
const A_NOTE = 'S: Synthetic Alpha knee pain. A/P: synthetic plan.';

(async () => {
  /* ======================================================================= B.
   * An automatic arrival with unsaved work: silent, and the strip instead. */
  {
    const h = boot();
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    /* the schedule tick / follow / alignment arriving at the chokepoint */
    for (let i = 0; i < 5; i++) h.machineTick(() => { h.window.setActivePtId('B'); h.window.selectPatient('B'); });
    await settle();

    eq(h.log.dialogs.length, 0, 'a machine arrival opened the abandon dialog — this is the measured nag');
    eq(h.state.activeId, 'A', 'a machine arrival switched away from a visit with unsaved work');
    eq(h.els.transcript.value, A_TRANSCRIPT, 'a machine arrival disturbed the unsaved transcript');
    eq(h.els.noteBox.value, A_NOTE, 'a machine arrival disturbed the unsaved note');
    eq(h.log.toasts.length, 0, 'a machine arrival still said something to the doctor');

    ok(h.strip(), 'nothing was painted for the doctor when the automatic switch was refused');
    ok(h.stripText().indexOf('Up now on the schedule: Synthetic Bravo. You are working in a different chart, so nothing was switched.') === 0,
      'the strip does not carry the shipped "nothing was switched" sentence: ' + JSON.stringify(h.stripText()));
    ok(h.stripButton('Switch to Synthetic Bravo'), 'the strip has no "Switch to X" button — the doctor has no way through');
    ok(h.stripButton('Stay here'), 'the strip has no "Stay here" button');

    /* F. a silent refusal is still a refusal, and the outer wrapper is told. */
    eq(h.window.__mlsPatientLock.switchWillBeRefused('B'), true,
      'a silently refused switch no longer reports as refused, so __mlsOpenSwitchFix would preserve-then-reset a switch that never happens');
  }

  /* ======================================================================= C.
   * The doctor's own press asks exactly once — including from the strip. */
  {
    const h = boot();
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    h.machineTick(() => h.window.selectPatient('B'));
    eq(h.log.dialogs.length, 0, 'the machine arrival asked');
    ok(h.strip(), 'the strip was not painted');

    /* the doctor presses the strip's own Switch button */
    h.pressEl(h.stripButton('Switch to Synthetic Bravo'));
    eq(h.log.dialogs.length, 1, 'the strip\'s Switch button is a doctor action and must ask exactly once');
    ok(/will NOT follow the new patient/.test(h.log.dialogs[0]), 'the dialog is not the measured one');
    eq(h.state.activeId, 'A', 'the switch went through before the question was answered');

    h.answer(true);
    await settle();
    eq(h.state.activeId, 'B', 'OK did not complete the doctor\'s switch');
    eq(h.log.dialogs.length, 1, 'the confirmed re-invocation asked a second time');
  }

  /* ======================================================================= D.
   * Cancel is an answer: no second question for the same pair. */
  {
    const h = boot();
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    h.doctorPress(() => { h.window.setActivePtId('B'); h.window.selectPatient('B'); });
    eq(h.log.dialogs.length, 1, 'one doctor action must raise exactly one dialog');
    h.answer(false);
    await settle();
    eq(h.state.activeId, 'A', 'Cancel switched the patient anyway');

    /* a second tick on the same target */
    for (let i = 0; i < 4; i++) h.machineTick(() => { h.window.setActivePtId('B'); h.window.selectPatient('B'); });
    await settle();
    eq(h.log.dialogs.length, 1, 'a machine arrival re-asked after the doctor had already answered Cancel');
    eq(h.state.activeId, 'A', 'a machine arrival switched after Cancel');

    /* a second doctor press on the same target */
    h.doctorPress(() => { h.window.setActivePtId('B'); h.window.selectPatient('B'); });
    await settle();
    eq(h.log.dialogs.length, 1, 'the doctor was asked a second time about the same target in the same visit');
    eq(h.state.activeId, 'A', 'a declined target switched anyway on the second press');
    ok(h.log.toasts.some((t) => /Staying on Synthetic Alpha/.test(t)),
      'the second press did nothing and said nothing — the doctor cannot tell it was refused');

    /* a DIFFERENT target is a different question, and is asked once */
    h.doctorPress(() => { h.window.setActivePtId('C'); h.window.selectPatient('C'); });
    eq(h.log.dialogs.length, 2, 'a different target must be asked about exactly once');
    eq(h.state.activeId, 'A', 'the different target switched before it was answered');
    h.answer(false);
    await settle();
    eq(h.log.dialogs.length, 2, 'Cancel on the second target raised another dialog');
  }

  /* ---- saving the visit resets the memory (so does clearing it) ---- */
  {
    const h = boot();
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);
    h.doctorPress(() => h.window.selectPatient('B'));
    eq(h.log.dialogs.length, 1, 'the first press must ask');
    h.answer(false);
    await settle();

    h.window.saveCurrentNote();            /* the visit is filed — nothing is at risk any more */
    h.doctorPress(() => h.window.selectPatient('B'));
    await settle();
    eq(h.log.dialogs.length, 1, 'a saved visit still asked before switching — there is nothing left to abandon');
    eq(h.state.activeId, 'B', 'a saved visit refused the doctor\'s switch');

    /* and the memory is genuinely reset, not merely bypassed: a fresh visit for
       the same pair asks again rather than silently refusing forever. */
    h.window.setActivePtId('A');
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);
    h.doctorPress(() => h.window.selectPatient('B'));
    eq(h.log.dialogs.length, 2, 'a NEW unsaved visit inherited the old visit\'s Cancel and never asked again');
  }

  /* ======================================================================= E.
   * The recording block is untouched, and stops speaking on machine ticks. */
  {
    const h = boot();
    h.window.startCapture();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    for (let i = 0; i < 4; i++) h.machineTick(() => h.window.selectPatient('B'));
    eq(h.state.activeId, 'A', 'a machine arrival switched patients mid-recording');
    eq(h.state.capturing, true, 'a refused machine arrival stopped the recording');
    eq(h.log.toasts.length, 0, 'a machine arrival repeated the recording warning at the doctor');
    eq(h.log.dialogs.length, 0, 'the recording block opened a dialog');

    h.doctorPress(() => h.window.selectPatient('B'));
    eq(h.state.activeId, 'A', 'a doctor press switched patients mid-recording');
    ok(h.log.toasts.some((t) => /Recording is in progress for Synthetic Alpha/.test(t)),
      'the doctor was not told why their own press was refused mid-recording');
  }

  /* ======================================================================= H.
   * AN EXPLICIT SELECTION WINS AND STAYS.
   * MEASURED in the same tab about 11:5x: an explicit setActivePtId('<other
   * chart>') returned without throwing and activePatient() still named the
   * schedule's up-now patient afterwards, so the generation that followed ran
   * under HER context. The anchor had re-asserted the up-now patient over a
   * selection somebody made on purpose. */
  {
    const h = boot();                       /* nothing unsaved: this is the plain re-assertion */
    eq(h.state.activeId, 'A', 'harness did not start on the up-now patient');

    h.doctorPress(() => { h.window.setActivePtId('B'); h.window.selectPatient('B'); });
    eq(h.state.activeId, 'B', 'the doctor\'s explicit selection did not take');

    /* the anchor tick, arriving to put the up-now patient back */
    for (let i = 0; i < 5; i++) h.machineTick(() => { h.window.setActivePtId('A'); h.window.selectPatient('A'); });
    await settle();
    eq(h.state.activeId, 'B', 'a machine arrival moved the active patient back off the chart the doctor chose');
    eq(h.log.dialogs.length, 0, 'the re-assertion asked instead of standing down');
    ok(h.strip(), 'the anchor took the patient back instead of painting the honest strip');
    ok(h.stripText().indexOf('Up now on the schedule: Synthetic Alpha. You are working in a different chart, so nothing was switched.') === 0,
      'the strip does not name the up-now patient it stood down for: ' + JSON.stringify(h.stripText()));
    ok(h.stripButton('Switch to Synthetic Alpha'), 'the strip offers no way back to the up-now patient');

    /* and the strip's own button still works - it is a press */
    h.pressEl(h.stripButton('Switch to Synthetic Alpha'));
    eq(h.state.activeId, 'A', 'the strip\'s Switch button did not move the patient');
  }

  /* ---- the same, with unsaved work: confirmed switch, then it stays ---- */
  {
    const h = boot();
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    h.doctorPress(() => h.window.selectPatient('B'));
    eq(h.log.dialogs.length, 1, 'the explicit switch away from unsaved work must ask once');
    h.answer(true);
    await settle();
    eq(h.state.activeId, 'B', 'the confirmed explicit switch never landed');

    for (let i = 0; i < 3; i++) h.machineTick(() => h.window.selectPatient('A'));
    await settle();
    eq(h.state.activeId, 'B', 'the anchor took the chart back after the doctor had confirmed the switch');
  }

  /* ---- an explicit selection with no event behind it (console / API) ---- */
  {
    const h = boot();
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    /* A bare programmatic setActivePtId cannot be told apart from a schedule
       tick, so it is refused like one - silently, losing nothing. The named
       API is the supported way to say "this is the doctor's selection". */
    h.machineTick(() => h.window.setActivePtId('B'));
    eq(h.state.activeId, 'A', 'a bare programmatic switch took the unsaved visit away with no question asked');
    eq(h.log.dialogs.length, 0, 'a bare programmatic switch asked');

    const landed = h.window.__mlsPatientLock.switchAsDoctor('B');
    eq(h.log.dialogs.length, 1, 'switchAsDoctor did not ask - an explicit selection must never be swallowed silently');
    eq(landed, false, 'switchAsDoctor reported success while the question was still open');
    h.answer(true);
    await settle();
    eq(h.state.activeId, 'B', 'the confirmed switchAsDoctor never landed');

    for (let i = 0; i < 3; i++) h.machineTick(() => h.window.selectPatient('A'));
    await settle();
    eq(h.state.activeId, 'B', 'the anchor took the chart back after an explicit API selection');
  }

  /* ======================================================================= G.
   * Anti-vacuity: neuter the classifier and the measured nag comes back. */
  {
    const silentBranch = 'if (!human) { offerInsteadOfSwitching(targetId); return false; }';
    const memoBranch = 'if (declinedTarget(targetId)) { saidStayingHere(); return false; }';
    ok(lockSource.includes(silentBranch) && lockSource.includes(memoBranch),
      'the two nonag branches are not where the anti-vacuity patch expects them');
    const nagging = lockSource.split(silentBranch).join(';').split(memoBranch).join(';');
    ok(!nagging.includes(silentBranch) && !nagging.includes(memoBranch),
      'the anti-vacuity patch did not actually remove the fix');

    const h = boot({ lockSource: nagging });
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    h.doctorPress(() => h.window.selectPatient('B'));
    eq(h.log.dialogs.length, 1, 'anti-vacuity: the unfixed guard did not ask the first time');
    h.answer(false);
    await settle();
    for (let i = 0; i < 3; i++) { h.machineTick(() => h.window.selectPatient('B')); await settle(); }
    ok(h.log.dialogs.length > 1,
      'anti-vacuity failed: the unfixed guard did not re-open the dialog on machine ticks, so sections B-D prove nothing');
  }

  console.log('PASS switch-nag-proof (nonag-1.0.0): ' + checks + ' checks — a machine arrival never asks and never takes the unsaved visit (the strip is its only surface) and can never move the active patient off the chart the doctor chose, a doctor press asks exactly once per target, Cancel is remembered until the target changes or the visit is saved, and the recording block still speaks only to the doctor');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
