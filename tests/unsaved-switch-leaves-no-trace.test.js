'use strict';

/* The unsaved-work patient switch must leave no trace of the old patient, and a
 * REFUSED switch must leave no trace at all.
 *
 * REPORTED (2026-07-29, live clinic): the doctor switched patients while holding
 * unsaved work, got
 *   "You have an unsaved visit/note for <patient>. Switching patients now will
 *    leave that work behind - it will NOT follow the new patient. Continue
 *    switching?"
 * and "everything glitched out".
 *
 * PROVEN CAUSE — two modules wrap the same two switch chokepoints:
 *   feat_mls_patientlock_b53.js:199-200  wraps setActivePtId/selectPatient
 *                                        SYNCHRONOUSLY when its loader script
 *                                        (mls-connect.js:42820, async=false) runs
 *   mls-connect.js __mlsOpenSwitchFix    wraps the SAME two globals from
 *                                        wrapGlobalOnce's 250 ms setInterval poll
 * so __mlsOpenSwitchFix sits OUTSIDE the patient lock and runs FIRST. The lock
 * fails closed by returning WITHOUT calling through, but the outer wrapper could
 * not see that: it had already run preserveBeforeSwitch() (a duplicate History
 * draft plus a "Draft saved to history on this device." toast under the open
 * question) and its `finally` still ran forceFreshVisitForNewPatient(), whose
 * newVisit() (ScribeFlow.html:16797) blanks #transcript / #noteBox / currentSoap /
 * currentCoding, wipes the sessionStorage recovery slot, and stops an in-progress
 * recording via `if(capturing) stopCapture()` — all while the doctor was still on
 * the OLD patient with the dialog open, and Cancel could not put any of it back.
 *
 * This suite executes the REAL modules, in the REAL wrap order, and pins:
 *   1. Cancel changes absolutely nothing.
 *   2. OK leaves none of the old patient's note/transcript/coding on screen, and
 *      every write lands under the OLD patient id — never the new one.
 *   3. One user action produces exactly ONE dialog.
 *   4. A switch refused while recording neither stops the recording nor wipes it.
 *   5. An ordinary switch still preserves-then-resets (the b591 rule that a
 *      refused save must still clear the box is unchanged).
 *   6. Anti-vacuity: the same harness run against the unfixed modules observes
 *      the defect.
 *
 * Synthetic patients only.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const lockSource = fs.readFileSync(path.join(root, 'feat_mls_patientlock_b53.js'), 'utf8');

/* ---------- the real __mlsOpenSwitchFix IIFE, sliced out of the bundle ---------- */
const osfMarker = connect.indexOf('__mlsOpenSwitchFix v1.1.0');
assert(osfMarker > 0, '__mlsOpenSwitchFix v1.1.0 header was not found in mls-connect.js');
const osfGuard = connect.indexOf('if (window.__mlsOpenSwitchFix) { return; }', osfMarker);
const osfStart = connect.lastIndexOf('(function () {', osfGuard);
const osfRevert = connect.indexOf('delete window.__mlsOpenSwitchFix_revert;', osfGuard);
const osfEnd = connect.indexOf('\n})();', osfRevert);
assert(osfStart > 0 && osfGuard > osfStart && osfEnd > osfRevert, 'could not bound the __mlsOpenSwitchFix IIFE');
const openSwitchFix = connect.slice(osfStart, osfEnd + '\n})();'.length);

/* The wrap ORDER this harness reproduces is a property of the shipped loaders:
   the lock is an async=false script injected while mls-connect.js is still
   executing (so it runs as soon as it is fetched), while __mlsOpenSwitchFix
   installs from a 250 ms poll. If either changes, the ordering argument above
   has to be re-derived rather than silently assumed. */
assert(/;\(function\(\)\{try\{var A="feat_mls_patientlock_b53\.js";[\s\S]{0,200}s\.async=false;/.test(connect),
  'the patient lock is no longer injected as an in-order async=false script');
assert(openSwitchFix.includes('}, 250);'),
  '__mlsOpenSwitchFix no longer installs its wrappers from a deferred poll');
assert(lockSource.includes('window.setActivePtId = guardedSwitchFn(window.setActivePtId') &&
  lockSource.includes('window.selectPatient = guardedSwitchFn(window.selectPatient'),
  'the patient lock no longer wraps the two switch chokepoints');

/* ---------- harness: the real modules over a stub visit engine ---------- */
function boot(options) {
  options = options || {};
  const lockSrc = options.lockSource || lockSource;
  const osfSrc = options.osfSource || openSwitchFix;

  const log = { newVisit: 0, prefill: 0, stopCapture: 0, dialogs: [], toasts: [], history: [], sessionDraft: null };
  const state = { activeId: 'A', capturing: false, soap: '', coding: null };
  const patients = {
    A: { id: 'A', name: 'Synthetic Alpha', dob: '01/01/1970' },
    B: { id: 'B', name: 'Synthetic Bravo', dob: '02/02/1980' }
  };
  const els = {
    transcript: { value: '', style: { display: '' } },
    noteBox: { value: '', style: { display: 'none' } },
    signLine: { style: { display: 'none' } }
  };
  const answers = [];
  const intervals = [];

  const document = { getElementById(id) { return Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null; } };
  const window = { document: document };

  const sandbox = {
    window: window,
    document: document,
    console: console,
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearInterval(handle) { if (handle) intervals[handle - 1] = null; },
    setTimeout(fn) { return 0; },
    clearTimeout() {}
  };

  /* --- the base app, matching the shipped shapes these modules read --- */
  window.getActivePtId = function () { return state.activeId; };
  window.activePatient = function () { return patients[state.activeId] || null; };
  window.findPatient = function (id) { return patients[id] || null; };
  /* ScribeFlow.html:9533 */
  window.setActivePtId = function (id) { state.activeId = id ? String(id) : ''; };
  /* ScribeFlow.html:14754 — the real body calls the GLOBAL setActivePtId, so it
     re-enters whatever wrappers are installed, exactly as in the browser. */
  window.selectPatient = function (id) { if (!id) return; window.setActivePtId(id); };
  /* ScribeFlow.html:16797 newVisit — the canonical reset */
  window.newVisit = function () {
    log.newVisit++;
    if (state.capturing) window.stopCapture();
    els.transcript.value = '';
    els.noteBox.value = '';
    els.noteBox.style.display = 'none';
    state.soap = '';
    state.coding = null;
    log.pendingVisitDraft = false; /* newVisit -> _wipeVisitDraft clears the debounce */
  };
  window.prefillContextFromProfile = function () { log.prefill++; };
  /* ScribeFlow.html:16917 saveDraft — stamps the CURRENTLY active patient */
  window.saveDraft = function () {
    const tr = String(els.transcript.value || '').trim();
    if (!tr && !state.soap) return undefined;
    log.history.push({
      patientId: window.getActivePtId(),
      transcript: els.transcript.value,
      soap: state.soap,
      note: els.noteBox.value
    });
    window.toast('Draft saved to history on this device.', 'ok');
    return true;
  };
  window.startCapture = function () { state.capturing = true; return true; };
  window.stopCapture = function () { state.capturing = false; log.stopCapture++; };
  window.toast = function (m) { log.toasts.push(String(m)); };
  window.mlsConfirm = function (message) {
    log.dialogs.push(String(message));
    return new Promise(function (resolve) { answers.push(resolve); });
  };
  /* ScribeFlow.html:8582 _saveVisitDraft — the 800 ms debounced sessionStorage
     recovery slot. It stamps ptId from getActivePtId() at FLUSH time (:8591), not
     at dirty time, and returns early when the editor is empty (:8588). */
  function flushVisitDraft() {
    if (!log.pendingVisitDraft) return;
    log.pendingVisitDraft = false;
    const t = String(els.transcript.value || ''), s = String(state.soap || '');
    if (!t.trim() && !s.trim()) return;
    log.sessionDraft = { ptId: window.getActivePtId(), t: t, soap: s };
  }

  vm.createContext(sandbox);
  /* LIVE ORDER: the lock wraps synchronously first ... */
  vm.runInContext(lockSrc, sandbox, { filename: 'feat_mls_patientlock_b53.js' });
  /* ... then __mlsOpenSwitchFix wraps from its poll, landing OUTSIDE the lock. */
  vm.runInContext(osfSrc, sandbox, { filename: 'mls-connect.js#__mlsOpenSwitchFix' });
  intervals.slice().forEach(function (fn) { if (fn) fn(); });

  assert(window.setActivePtId.__mlsOpenSwitchWrapped === true && window.selectPatient.__mlsOpenSwitchWrapped === true,
    'harness did not reproduce the live wrap order (__mlsOpenSwitchFix outside the patient lock)');

  return {
    window: window, log: log, state: state, els: els,
    /* the doctor holds unsaved recorded work but is not recording any more */
    holdUnsavedWork: function () { window.startCapture(); window.stopCapture(); log.stopCapture = 0; },
    typeVisit: function (transcript, note) {
      els.transcript.value = transcript;
      els.noteBox.value = note;
      els.noteBox.style.display = '';
      state.soap = note;
      state.coding = { cpt: ['99213'] };
      log.pendingVisitDraft = true;
    },
    /* MLS Easy v2's choosePatientRow: ONE doctor action, both entries */
    pickPatient: function (id) { window.setActivePtId(id); window.selectPatient(id); },
    answer: function (ok) {
      assert(answers.length, 'no dialog was open to answer');
      answers.shift()(ok);
    },
    flushVisitDraft: flushVisitDraft
  };
}

function tick() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

const A_TRANSCRIPT = 'Synthetic Alpha reports right knee pain for three weeks.';
const A_NOTE = 'S: Synthetic Alpha knee pain. A/P: synthetic plan.';

(async () => {
  /* ---------------- 1. Cancel changes absolutely nothing ---------------- */
  {
    const h = boot();
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    h.pickPatient('B');
    assert.strictEqual(h.log.dialogs.length, 1, 'one user action must raise exactly one abandon dialog');
    assert(/will NOT follow the new patient/.test(h.log.dialogs[0]), 'the abandon dialog is not the reported one');
    assert.strictEqual(h.state.activeId, 'A', 'the switch was not refused while the question was open');

    h.answer(false);
    await settle();

    assert.strictEqual(h.state.activeId, 'A', 'Cancel switched the patient anyway');
    assert.strictEqual(h.els.transcript.value, A_TRANSCRIPT, 'Cancel wiped the transcript');
    assert.strictEqual(h.els.noteBox.value, A_NOTE, 'Cancel wiped the note');
    assert.strictEqual(h.state.soap, A_NOTE, 'Cancel wiped currentSoap');
    assert.notStrictEqual(h.state.coding, null, 'Cancel wiped currentCoding');
    assert.strictEqual(h.log.newVisit, 0, 'a refused switch still reset the visit engine');
    assert.strictEqual(h.log.history.length, 0, 'a refused switch still persisted a draft');
    assert.deepStrictEqual(h.log.toasts, [], 'a refused switch still toasted underneath the open question');
    assert.strictEqual(h.log.dialogs.length, 1, 'a second dialog appeared for one user action');

    h.flushVisitDraft();
    assert(h.log.sessionDraft && h.log.sessionDraft.ptId === 'A',
      'the debounced recovery slot must still belong to the patient still on screen');
  }

  /* ---------------- 2. OK leaves no trace of the old patient ---------------- */
  {
    const h = boot();
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    h.pickPatient('B');
    assert.strictEqual(h.log.dialogs.length, 1, 'one user action must raise exactly one abandon dialog');
    h.answer(true);
    await settle();

    assert.strictEqual(h.state.activeId, 'B', 'OK did not complete the switch');
    assert.strictEqual(h.log.dialogs.length, 1, 're-invoking both entries prompted the doctor twice');
    assert.strictEqual(h.els.transcript.value, '', "the old patient's transcript is still on screen under the new patient");
    assert.strictEqual(h.els.noteBox.value, '', "the old patient's note is still on screen under the new patient");
    assert.strictEqual(h.state.soap, '', 'currentSoap still holds the old patient note');
    assert.strictEqual(h.state.coding, null, 'currentCoding still holds the old patient coding');
    assert(h.log.newVisit >= 1, 'the visit engine was never reset for the new patient');

    assert(h.log.history.length >= 1, "the old patient's work was not preserved anywhere");
    for (const rec of h.log.history) {
      assert.strictEqual(rec.patientId, 'A', 'a write carrying the old patient text landed under another patient id');
    }
    assert(h.log.history.some(r => r.transcript === A_TRANSCRIPT && r.patientId === 'A'),
      "the old patient's transcript was not filed under the old patient");

    /* the debounced recovery flush cannot file A's text under B */
    h.flushVisitDraft();
    assert.strictEqual(h.log.sessionDraft, null,
      'the debounced visit-draft flush wrote after the switch, filing the old text under the new patient');
  }

  /* ---------------- 3. one action, one dialog, on the lone-selectPatient path -------- */
  {
    const h = boot();
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);
    h.window.selectPatient('B'); /* no preceding setActivePtId — decides fresh */
    assert.strictEqual(h.log.dialogs.length, 1, 'a lone selectPatient must still ask exactly once');
    assert.strictEqual(h.state.activeId, 'A', 'a lone selectPatient switched without an answer');
    h.answer(true);
    await settle();
    assert.strictEqual(h.state.activeId, 'B', 'the confirmed lone selectPatient never switched');
    assert.strictEqual(h.log.dialogs.length, 1, 'the confirmed re-invocation asked a second time');
    assert.strictEqual(h.els.transcript.value, '', "the old patient's transcript survived a confirmed lone selectPatient");
  }

  /* ---------------- 4. a switch refused while RECORDING keeps the recording ---------- */
  {
    const h = boot();
    h.window.startCapture();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);

    h.pickPatient('B');
    await settle();

    assert.strictEqual(h.log.dialogs.length, 0, 'the recording block must not open the abandon dialog');
    assert.strictEqual(h.state.activeId, 'A', 'a switch went through while recording');
    assert.strictEqual(h.state.capturing, true, 'the refused switch stopped the recording');
    assert.strictEqual(h.log.stopCapture, 0, 'the refused switch called stopCapture');
    assert.strictEqual(h.els.transcript.value, A_TRANSCRIPT, 'the refused switch wiped the live transcript');
    assert.strictEqual(h.log.newVisit, 0, 'the refused switch reset the visit engine mid-recording');
    assert(h.log.toasts.some(t => /Recording is in progress/.test(t)), 'the doctor was not told why the switch was refused');
    assert.strictEqual(h.log.history.length, 0, 'the refused mid-recording switch persisted a draft');
  }

  /* ---------------- 5. an ordinary switch still preserves, then resets -------------- */
  {
    const h = boot();
    h.typeVisit(A_TRANSCRIPT, A_NOTE); /* unsaved work, but no lock held */

    h.pickPatient('B');
    await settle();

    assert.strictEqual(h.log.dialogs.length, 0, 'an unlocked switch must not prompt');
    assert.strictEqual(h.state.activeId, 'B', 'an ordinary switch was refused');
    assert.strictEqual(h.els.transcript.value, '', "an ordinary switch left the old patient's transcript on screen");
    assert.strictEqual(h.els.noteBox.value, '', "an ordinary switch left the old patient's note on screen");
    assert.strictEqual(h.log.newVisit, 1, 'an ordinary switch must reset the visit engine exactly once');
    assert.strictEqual(h.log.history.length, 1, 'an ordinary switch must preserve the old work exactly once');
    assert.strictEqual(h.log.history[0].patientId, 'A', 'an ordinary switch filed the old work under the new patient');
  }

  /* ---------------- 6. anti-vacuity: the unfixed modules exhibit the defect --------- */
  {
    const guardLine = ' && !switchWillBeRefused(newId);';
    const resetGate = 'if (getActiveIdSafe() === newId) forceFreshVisitForNewPatient(_preserveRefused);';
    assert(openSwitchFix.includes(guardLine), 'the refusal guard is missing from __mlsOpenSwitchFix');
    assert(openSwitchFix.includes(resetGate), 'the reset gate is missing from __mlsOpenSwitchFix');
    const unfixedOsf = openSwitchFix
      .replace(guardLine, ';')
      .replace(resetGate, 'forceFreshVisitForNewPatient(_preserveRefused);');
    assert(!unfixedOsf.includes(guardLine) && !unfixedOsf.includes(resetGate),
      'the anti-vacuity patch did not actually remove the fix');

    const purgeCall = '      purgeAbandonedVisit(targetId);\n';
    const exportLine = '    switchWillBeRefused: switchWillBeRefused,\n';
    assert(lockSource.includes(purgeCall) && lockSource.includes(exportLine),
      'the patient lock no longer keeps its own promise / no longer publishes the predicate');
    const unfixedLock = lockSource.replace(purgeCall, '').replace(exportLine, '');
    assert(!unfixedLock.includes(purgeCall) && !unfixedLock.includes(exportLine),
      'the anti-vacuity patch did not actually remove the lock-side fix');

    /* Cancel, unfixed: the note is destroyed before the doctor can answer */
    const h = boot({ osfSource: unfixedOsf, lockSource: unfixedLock });
    h.holdUnsavedWork();
    h.typeVisit(A_TRANSCRIPT, A_NOTE);
    h.pickPatient('B');
    h.answer(false);
    await settle();
    assert.strictEqual(h.state.activeId, 'A', 'unfixed build: expected the switch to stay refused');
    assert(h.log.newVisit > 0,
      'anti-vacuity failed: the unfixed build did not reset the visit engine on a refused switch, so tests 1-3 prove nothing');
    assert.strictEqual(h.els.transcript.value, '',
      'anti-vacuity failed: the unfixed build did not wipe the transcript behind the dialog');
    assert(h.log.toasts.some(t => /Draft saved/.test(t)),
      'anti-vacuity failed: the unfixed build did not toast under the open question');

    /* recording, unfixed: the refused switch silently stops the recording */
    const r = boot({ osfSource: unfixedOsf, lockSource: unfixedLock });
    r.window.startCapture();
    r.typeVisit(A_TRANSCRIPT, A_NOTE);
    r.pickPatient('B');
    await settle();
    assert.strictEqual(r.state.capturing, false,
      'anti-vacuity failed: the unfixed build did not stop the recording on a refused switch, so test 4 proves nothing');
    assert(r.log.stopCapture > 0, 'anti-vacuity failed: unfixed stopCapture was never reached');
  }

  console.log('PASS unsaved switch leaves no trace: Cancel changes nothing, OK clears the old note off the new patient, one action asks once, and a refused switch never resets the visit engine');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
