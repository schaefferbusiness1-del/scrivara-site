/* =========================================================================
 * MLS Scribe -- b53 "Patient-context lock" (window.__mlsPatientLock)
 * 2026-07-07. Additive, guarded, reversible IIFE.
 *
 * WHY THIS EXISTS (Michael's bug list, items 11-12):
 *   (11) The selected patient must stay LOCKED through recording, note
 *        generation, Athena writeback, billing suggestions, and template
 *        matching. Never let one patient's note go to another patient.
 *   (12) Writeback destination is risky - add patient name/DOB/destination
 *        confirmation before writing, and make sure it can't be silently
 *        skipped if the confirmation module fails to load.
 *
 * WHAT WAS FOUND (recon before writing this):
 *   - "Active patient" is a single global (getActivePtId/setActivePtId,
 *     ScribeFlow.html ~5665-5667), read live -- not snapshotted -- by
 *     recording, note-save, and writeback code.
 *   - startCapture()/stopCapture() (~11833-11852) never snapshot who is
 *     being recorded.
 *   - The actual patient gets stamped onto a note in exactly two places,
 *     both read "whatever is active right now": noteRecordFromState()
 *     (~10831, `patientId: getActivePtId()||''`) and attachVisitToPatient()
 *     (~10731-10752, unconditionally overwrites patientId from
 *     activePatient()). Neither reads what was actually being recorded.
 *   - A robust writeback confirmation already exists (__mlsWbSafetyGate,
 *     from feat_b18_qa.js) that checks name+DOB+destination via a
 *     window.postMessage interceptor before any Athena write. It is
 *     comprehensive but is a bolt-on: if it fails to load, writes proceed
 *     with zero confirmation. This module adds a same-shape fallback
 *     confirm (name + DOB + destination) that only fires when the primary
 *     gate is missing, so a write is never silently unconfirmed.
 *   - "Never auto-submit orders" (item 13) was checked and is already
 *     correctly handled everywhere (every writeback path explicitly stops
 *     before Save/Sign/Submit) - no change made for that item.
 *
 * REVISION (b53, superseding the original b52 draft before it ever shipped):
 *   A same-day commit (20c774600, "MLS Easy v2") landed a new UI whose
 *   choosePatientRow() switches patients via window.setActivePtId(pid) and
 *   window.selectPatient(pid) DIRECTLY - bypassing the legacy doctor-facing
 *   entry points (_heroPickPatient/ptQuickVisit) this module originally
 *   guarded. Guarding only those two legacy functions would leave the new
 *   v2 UI (and any future UI) completely unprotected. Fixed by guarding
 *   setActivePtId/selectPatient THEMSELVES instead - the lowest common path
 *   every patient switch must funnel through, in both classic and v2 mode.
 *   setActivePtId is treated as the PRIMARY/authoritative switch point and
 *   always decides fresh; selectPatient is SECONDARY and, if called for the
 *   same id immediately after setActivePtId already decided (v2's pattern:
 *   both called synchronously, back to back, for one doctor action), simply
 *   reuses that decision instead of prompting a second time. If selectPatient
 *   is ever called on its own (no preceding setActivePtId), it decides fresh
 *   too - nothing is ever silently skipped. v2 also sends via
 *   pushEntireVisitToAthena/pushToAthena (callFirst tries both names) - both
 *   are covered in WRITE_TARGETS below.
 *
 * DESIGN (why wrapping, not rewriting):
 *   All hooked names are flat top-level `function` declarations in the
 *   single big inline <script> in ScribeFlow.html, which per JS semantics
 *   attach to `window` automatically (confirmed: other later code already
 *   reads window.getActivePtId / window.activePatient). Wrapping them here
 *   -- rather than editing ScribeFlow.html's giant inline script directly
 *   -- keeps this reversible and avoids merge risk in a 21k-line file, and
 *   automatically covers both the classic and MLS Easy v2 UI layers since
 *   both call down into these same shared globals.
 *
 * SAFETY:
 *   - Never blocks the doctor from finishing/saving/sending a visit; only
 *     adds a hard stop while actively recording, and a cancel-able confirm
 *     when switching away from a patient with unsaved recorded work.
 *   - Never touches orders/meds/injections/referrals/imaging/billing
 *     submission (out of scope here; already safe per recon).
 *   - No PHI in console logs. Patient name/DOB appear only in on-screen
 *     confirm()/alert() dialogs the doctor themselves triggers.
 *
 * Revert: window.__mlsPatientLock.revert()
 * ========================================================================= */
(function () {
  "use strict";
  if (window.__mlsPatientLock) return;
  var VERSION = "1.0.3-b53-nonag";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }

  var LOCK = {
    capturing: false,
    snapshot: null,       /* {id,name,dob,at} - who is actually being recorded/drafted for */
    hasPendingWork: false /* true from startCapture() until the visit is saved/sent or explicitly abandoned */
  };

  function snapshotOf(p) {
    if (!p) return null;
    return { id: p.id || "", name: String(p.name || "").trim(), dob: String(p.dob || "").trim(), at: Date.now() };
  }
  function currentActive() { return safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null); }
  function clearLock() { LOCK.snapshot = null; LOCK.hasPendingWork = false; LOCK.capturing = false; resetDeclined(); }

  /* ---------------- item 11: snapshot who is actually being recorded ---------------- */
  if (isFn(window.startCapture)) {
    var origStart = window.startCapture;
    window.startCapture = function () {
      LOCK.snapshot = snapshotOf(currentActive());
      LOCK.capturing = true;
      LOCK.hasPendingWork = true;
      resetDeclined(); /* nonag-1.0.0: a new visit is a new set of (visit, target) pairs */
      var out = origStart.apply(this, arguments);
      /* 2026-07-23 wedge: startCapture returns false on EVERY refused start
         (consent pending/declined/canceled, prep refusal, no recognizer). No
         capture began, so no lock may remain — a stale capturing flag blocked
         patient switching until a full reload. */
      if (out === false) clearLock();
      return out;
    };
  }
  if (isFn(window.stopCapture)) {
    var origStop = window.stopCapture;
    window.stopCapture = function () {
      LOCK.capturing = false; /* hasPendingWork/snapshot stay set until save/send/abandon */
      return origStop.apply(this, arguments);
    };
  }

  /* ---------------- item 11: guard EVERY patient switch at the lowest common entry
   * point (setActivePtId/selectPatient), so classic UI, MLS Easy v2, and any future UI
   * that funnels through these are all covered without needing per-UI guards. ---------------- */
  function blockWhileCapturing(lockedName) {
    safe(function () { var m = "Recording is in progress for " + (lockedName || "the current patient") + " - stop the recording before switching patients (switching now risks the transcript landing on the wrong patient)."; if (typeof window.toast === "function") window.toast(m, "err"); else window.alert(m); });
  }
  /* ===================== nonag-1.0.0 (2026-09-02) ==========================
   * MEASURED in the owner's tab on 2026-09-02, late morning (build b1205, the
   * copy live at the time): with an unsaved generated note
   * for the active patient open on the Visit screen, the abandon question
   * below re-opened again and again - "it just keeps popping up" - while the
   * schedule's "Up now: <patient> - loaded & ready" banner and the "Up now on
   * the schedule: <other patient>. You are working in a different chart, so
   * nothing was switched." strip were both on screen.
   *
   * THE QUESTION WAS NEVER THE BUG - ITS CALLERS WERE. setActivePtId and
   * selectPatient are the switch chokepoint for the WHOLE app, so every
   * MACHINE arrival funnels through this guard too: the up-next/schedule tick,
   * the up-now anchor, the athenaOne follow, the day-strip header alignment,
   * the pull-done landing, the day-note catch-up, a visibility/focus handler,
   * a setInterval. Each arrival re-ran decideSwitch, each one re-opened the
   * dialog the doctor had just dismissed, and none of them had any answer to
   * give: a tick cannot consent to abandoning a doctor's note.
   *
   * THE RULE, and nothing is loosened by it:
   *   - A MACHINE arrival never asks and never switches away from unsaved
   *     work. It is refused silently, and the only thing it may paint is the
   *     schedule anchor strip - whose own "Switch to X" button IS the doctor's
   *     action, and goes through this guard as one.
   *   - A DOCTOR arrival asks exactly ONCE per (held visit, target patient).
   *     Cancel is remembered for that pair and is not asked again until the
   *     target changes, a new visit is recorded, or the visit is saved / sent /
   *     cleared (clearLock). OK still switches, exactly as before.
   * Both refusals stay fail-closed. This removes no guard; it stops one from
   * firing at events nobody triggered.
   *
   * SECOND MEASUREMENT, same tab, 2026-09-02 about 11:5x, same class: an
   * explicit setActivePtId('<other chart>') returned without throwing and
   * activePatient() STILL named the schedule's up-now patient afterwards, so
   * the generation that followed ran under her context. The schedule/visit
   * anchor had re-asserted the up-now patient over a selection somebody made
   * on purpose. So the rule has a second half, and it holds whether or not
   * there is unsaved work:
   *   - AN EXPLICIT SELECTION WINS AND STAYS. Once the doctor's own press (or
   *     __mlsPatientLock.switchAsDoctor) has put a chart on screen, no machine
   *     arrival may move the active patient off it. The anchor may paint its
   *     honest strip - "Up now on the schedule: X ... nothing was switched",
   *     with its own Switch button - and nothing else.
   * ========================================================================= */
  var GESTURE_MS = 1500;
  var GESTURE_TYPES = { click: 1, dblclick: 1, mousedown: 1, mouseup: 1, pointerdown: 1, pointerup: 1, touchend: 1, keydown: 1, keyup: 1, keypress: 1, submit: 1, change: 1 };
  var lastGestureAt = 0;
  var gestureWatch = false;
  safe(function () {
    var d = window.document;
    if (!d || !isFn(d.addEventListener)) return;
    var stamp = function (e) { if (e && e.isTrusted === true) lastGestureAt = Date.now(); };
    Object.keys(GESTURE_TYPES).forEach(function (t) { d.addEventListener(t, stamp, true); });
    gestureWatch = true;
  });
  /* Is a human hand behind THIS call? A doctor's switch is always dispatched
     inside a trusted UI event - a patient row, "Switch to X", a search pick, a
     History reopen. A tick, a poll, a fetch completion and a visibility
     handler are not. window.event is the event being dispatched right now, and
     the capture-phase stamp additionally covers the short press -> microtask ->
     selectPatient chains this app uses. If NEITHER can be observed (no DOM to
     listen on at all), this fails OPEN toward the doctor and the pre-nonag
     ask-every-time behavior stands - a real press is never silently refused
     because the classifier could not run. */
  var asDoctorDepth = 0; /* switchAsDoctor(): an explicit selection with no event behind it */
  function doctorGesture() {
    if (asDoctorDepth > 0) return true;
    if (!gestureWatch) return true;
    var ev = safe(function () { return window.event; }, null);
    if (ev && ev.isTrusted === true && GESTURE_TYPES[safe(function () { return String(ev.type || ""); }, "")] === 1) return true;
    return (Date.now() - lastGestureAt) <= GESTURE_MS;
  }
  /* THE CHART THE DOCTOR CHOSE, and the whole of "an explicit selection stays".
     Stamped only by a switch this guard allowed for a human arrival - a press,
     an answered abandon dialog, or switchAsDoctor. While that chart is the
     active one, a machine arrival cannot move off it. */
  var chosenId = null;
  function rememberChosen(targetId) { chosenId = (targetId === null || targetId === undefined) ? '' : String(targetId); }
  function activeIdNow() { return safe(function () { return isFn(window.getActivePtId) ? String(window.getActivePtId() || '') : ''; }, ''); }
  function wouldOverrideChosenChart(targetId) {
    if (!chosenId) return false;
    if (activeIdNow() !== chosenId) return false;           /* the doctor's chart is not the one on screen */
    return String(targetId == null ? '' : targetId) !== chosenId;
  }
  var declined = null; /* {targetId: 1} the doctor's own Cancels, for the visit currently held */
  function resetDeclined() { declined = null; }
  function declinedTarget(targetId) { return !!(declined && declined[String(targetId)] === 1); }
  function rememberDeclined(targetId) { if (!declined) declined = {}; declined[String(targetId)] = 1; }
  function nameOfTarget(targetId) {
    return safe(function () { var p = isFn(window.findPatient) ? window.findPatient(String(targetId)) : null; return p ? String(p.name || "").trim() : ""; }, "");
  }
  /* The ONE surface a machine arrival may paint: the schedule anchor strip
     ("Up now on the schedule: X. You are working in a different chart, so
     nothing was switched." + Switch to X / Stay here). anchorOffer is
     idempotent for the same target, so a poll that keeps arriving cannot stack
     anything up, and an absent workspace simply leaves silence. */
  function offerInsteadOfSwitching(targetId) {
    return safe(function () {
      var a = window.__mlsPtAnchor;
      var nm = nameOfTarget(targetId);
      if (!a || !isFn(a.offer) || !nm) return false;
      return a.offer(nm, String(targetId)) === true;
    }, false);
  }
  var lastStaySaidAt = 0;
  /* A doctor press on a target already declined for this visit must not reopen
     the dialog - but it must not look broken either. A toast is not a prompt:
     it blocks nothing, asks nothing, and answers nothing. */
  function saidStayingHere() {
    if (Date.now() - lastStaySaidAt < 2000) return;
    lastStaySaidAt = Date.now();
    safe(function () {
      var nm = (LOCK.snapshot && LOCK.snapshot.name) || "the current patient";
      var m = "Staying on " + nm + " - the unsaved visit/note is still here. Save it or start a new visit, then switch.";
      if (typeof window.toast === "function") window.toast(m, "err");
    });
  }
  /* 2026-07-22 non-blocking rewrite: the switch is REFUSED immediately (fail
   * closed), the in-app dialog asks, and a confirmed answer re-invokes the
   * canonical setActivePtId with a short-lived one-shot token this guard
   * honors. Net behavior is identical to the old blocking confirm, without
   * freezing the tab. */
  var pendingAbandon = null; /* {target, at} one-shot confirmed-switch token */
  var abandonAsk = null;     /* single-flight: one abandon dialog at a time — a
                                rapid second switch attempt must not replace the
                                open dialog (that orphaned its promise and let
                                the answer race the next attempt) */
  function confirmAbandon(lockedName, targetId) {
    if (abandonAsk) return false; /* still asking — stay locked, fail closed */
    var ask = (typeof window.mlsConfirm === 'function') ? window.mlsConfirm : function (m) { return Promise.resolve(safe(function () { return window.confirm(m); }, true)); };
    abandonAsk = ask("You have an unsaved visit/note for " + (lockedName || "the current patient") + ".\n\nSwitching patients now will leave that work behind - it will NOT follow the new patient. Continue switching?").then(function (ok) {
      abandonAsk = null;
      /* nonag-1.0.0: Cancel is an ANSWER, and it holds for this (visit, target)
         pair until the target changes or the visit is saved/cleared. Without
         this the very next arrival - human or machine - asked it all over
         again, which is the nag the owner measured. */
      if (!ok) { rememberDeclined(targetId); return; }
      pendingAbandon = { target: String(targetId), at: Date.now() };
      safe(function () {
        /* re-run BOTH wrapped entries (Easy v2's choosePatientRow pattern):
           setActivePtId consumes the one-shot token and records the primary
           decision; the synchronous selectPatient call reuses that decision,
           so its row-highlight/panel side-effects land too. */
        if (isFn(window.setActivePtId)) window.setActivePtId(targetId);
        if (isFn(window.selectPatient)) window.selectPatient(targetId);
      });
      purgeAbandonedVisit(targetId);
    }, function () { abandonAsk = null; });
    return false;
  }
  /* The dialog PROMISED "it will NOT follow the new patient". Keep that promise
   * from the module that makes it, instead of depending on another module's
   * post-switch reset. mls-connect.js's __mlsOpenSwitchFix normally saves the old
   * patient's work to THEIR history and then runs newVisit() once the new patient
   * is active, so this is a no-op in the shipped configuration; it only acts if
   * that wrapper is absent/reverted/failed and the OLD patient's transcript or
   * note is still on screen under the NEW patient - a note from one patient
   * displayed under another. No save is attempted here: the new patient is
   * already active, so any save-time patient stamp would read the WRONG chart. */
  function purgeAbandonedVisit(targetId) {
    safe(function () {
      if (!isFn(window.getActivePtId) || String(window.getActivePtId() || '') !== String(targetId)) return;
      var tr = document.getElementById('transcript'), nb = document.getElementById('noteBox');
      var leftBehind = !!((tr && String(tr.value || '').trim()) || (nb && String(nb.value || '').trim()));
      if (!leftBehind) return;
      if (isFn(window.newVisit)) window.newVisit();
    });
  }
  /* PURE classification of a switch request - no dialogs, no toasts, no state
   * changes, safe to call any number of times. Split out of decideSwitch so an
   * OUTER wrapper of these same globals can ask, WITHOUT side effects, whether
   * this switch is about to be refused (see switchWillBeRefused below).
   *   'blocked'   - recording in progress, refuse and say so
   *   'ask'       - unsaved work, refuse now and open the abandon dialog
   *   'confirmed' - the doctor already answered OK; consume the token and go
   *   'allow'     - nothing to protect */
  function switchState(targetId) {
    if (LOCK.capturing) return 'blocked';
    if (LOCK.hasPendingWork && LOCK.snapshot && LOCK.snapshot.id) {
      var cur = currentActive();
      var stillOnLockedPatient = cur && cur.id === LOCK.snapshot.id;
      var sameTarget = targetId != null && String(targetId) === String(LOCK.snapshot.id);
      if (stillOnLockedPatient && !sameTarget) {
        return (pendingAbandon && String(targetId) === String(pendingAbandon.target) && Date.now() - pendingAbandon.at < 15000) ? 'confirmed' : 'ask';
      }
    }
    return 'allow';
  }
  function decideSwitch(targetId) {
    var state = switchState(targetId);
    /* nonag-1.0.0: classify the ARRIVAL, not the patient. switchState above
       stays pure; this is where anything may be said or painted. */
    var human = doctorGesture();
    /* nonag-1.0.0, second half: the anchor's re-assertion. A machine arrival
       may not move the active patient off the chart the doctor chose, with or
       without unsaved work - it offers the strip instead. Evaluated before the
       states below so it also covers 'allow', which is where the measured
       re-assertion happened (nothing was being recorded; the chart just moved
       back to the schedule's up-now patient underneath the doctor). */
    if (!human && wouldOverrideChosenChart(targetId)) { offerInsteadOfSwitching(targetId); return false; }
    if (state === 'blocked') {
      /* The recording block stands either way - only the message is for the
         doctor who pressed something, never for a tick nobody triggered. */
      if (human) blockWhileCapturing(LOCK.snapshot && LOCK.snapshot.name);
      else offerInsteadOfSwitching(targetId);
      return false;
    }
    if (state === 'confirmed') { pendingAbandon = null; clearLock(); rememberChosen(targetId); return true; }
    if (state === 'ask') {
      if (!human) { offerInsteadOfSwitching(targetId); return false; }   /* nonag-1.0.0: a machine never asks and never takes the work */
      if (declinedTarget(targetId)) { saidStayingHere(); return false; } /* nonag-1.0.0: already answered for this exact pair */
      return confirmAbandon(LOCK.snapshot.name, targetId);
    }
    if (human) rememberChosen(targetId); /* nonag-1.0.0: this chart is now the doctor's explicit choice */
    return true;
  }
  /* True when this exact switch is about to be REFUSED (recording block, or the
   * abandon dialog). Published on window.__mlsPatientLock so mls-connect.js's
   * __mlsOpenSwitchFix - which wraps these same two globals on a 250ms poll, i.e.
   * AFTER this module's synchronous wrap, and therefore runs OUTSIDE it - can
   * skip its preserve-then-reset sequence for a switch that never happens. */
  function switchWillBeRefused(targetId) {
    var state = safe(function () { return switchState(targetId); }, 'allow');
    return state === 'blocked' || state === 'ask';
  }
  /* setActivePtId is the PRIMARY/authoritative switch point - always decides fresh and records
   * its decision briefly so a synchronously-following selectPatient() call for the SAME id (MLS
   * Easy v2's choosePatientRow pattern) can reuse it instead of prompting the doctor twice for
   * one action. The record is cleared on the next microtask tick, so it can only ever be reused
   * by a call that is truly part of the same synchronous action - any later, separate call to
   * setActivePtId always decides fresh again (see T2/T7b-style repeat-switch behavior). */
  var primaryDecision = null; /* {targetId, result} */
  function guardPrimary(targetId) {
    var result = decideSwitch(targetId);
    var entry = { targetId: targetId, result: result };
    primaryDecision = entry;
    safe(function () { Promise.resolve().then(function () { if (primaryDecision === entry) primaryDecision = null; }); });
    return result;
  }
  function guardSecondary(targetId) {
    if (primaryDecision && String(primaryDecision.targetId) === String(targetId)) return primaryDecision.result;
    return decideSwitch(targetId); /* selectPatient called on its own, with no preceding setActivePtId - still safe */
  }
  function guardedSwitchFn(orig, targetIdFromArgs, guardFn) {
    return function () {
      var targetId = targetIdFromArgs ? targetIdFromArgs(arguments) : null;
      if (!guardFn(targetId)) return;
      return orig.apply(this, arguments);
    };
  }
  /* lowest-level, UI-agnostic entry points - covers classic _heroPickPatient/ptQuickVisit
   * (both call down into setActivePtId) AND MLS Easy v2's choosePatientRow (calls
   * setActivePtId and, if present, selectPatient, directly). */
  if (isFn(window.setActivePtId)) window.setActivePtId = guardedSwitchFn(window.setActivePtId, function (args) { return args[0]; }, guardPrimary);
  if (isFn(window.selectPatient)) window.selectPatient = guardedSwitchFn(window.selectPatient, function (args) { return args[0]; }, guardSecondary);

  /* ---------------- item 11: save-time ownership ----------------
   * Retired: the core editor now owns an immutable patient/visit binding and
   * quarantines any mismatch. A second mutable LOCK snapshot must never
   * relabel the record returned by noteRecordFromState or the record already
   * attached by attachVisitToPatient. */

  /* ---------------- item 11: clear the lock once the visit is actually finalized ---------------- */
  if (isFn(window.saveCurrentNote)) {
    var origSave = window.saveCurrentNote;
    window.saveCurrentNote = function () { var r = origSave.apply(this, arguments); if (r === true) clearLock(); return r; };
  }
  if (isFn(window.newVisit)) {
    var origNewVisit = window.newVisit;
    window.newVisit = function () { var r = origNewVisit.apply(this, arguments); safe(function () { if (!LOCK.capturing) clearLock(); }); return r; };
  }

  /* ---------------- item 12: writeback name/DOB/destination confirmation, with a fallback
   * in case the primary gate (__mlsWbSafetyGate from feat_b18_qa.js) fails to load. Never
   * fires alongside the primary gate (it defers to it whenever present), so no double prompts. */
  function gateInstalled() { return !!window.__mlsWbSafetyGate; }
  var pendingFallbackSend = false; /* one-shot: async dialog already confirmed */
  function fallbackConfirmAsk(destLabel) {
    var p = currentActive();
    var name = (p && p.name) || (LOCK.snapshot && LOCK.snapshot.name) || "(no active patient)";
    var dob = (p && p.dob) || (LOCK.snapshot && LOCK.snapshot.dob) || "(unknown DOB)";
    var ask = (typeof window.mlsConfirm === 'function') ? window.mlsConfirm : function (m) { return Promise.resolve(safe(function () { return window.confirm(m); }, false)); };
    return ask("Safety-check module did not load, so confirming manually before sending:\n\nPatient: " + name + "\nDOB: " + dob + "\nDestination: " + destLabel + "\n\nSend?");
  }
  var WRITE_TARGETS = [["sendToEMRviaAssist", "athenaOne (paste/assist)"], ["copyForEMR", "clipboard for athenaOne"], ["pushEntireVisitToAthena", "athenaOne visit note"], ["pushToAthena", "athenaOne visit note"]];
  WRITE_TARGETS.forEach(function (pair) {
    var name = pair[0], dest = pair[1];
    if (!isFn(window[name])) return;
    var orig = window[name];
    window[name] = function () {
      if (!gateInstalled() && !pendingFallbackSend) {
        /* fail closed now; a confirmed dialog re-invokes exactly once */
        var self = this, args = arguments;
        fallbackConfirmAsk(dest).then(function (ok) {
          if (!ok) return;
          pendingFallbackSend = true;
          try { window[name].apply(self, args); } finally { pendingFallbackSend = false; }
        });
        return;
      }
      pendingFallbackSend = false;
      var r = orig.apply(this, arguments);
      clearLock();
      return r;
    };
  });

  window.__mlsPatientLock = {
    installed: true,
    version: VERSION,
    /* pure, side-effect-free; safe for an outer wrapper to call on every switch */
    switchWillBeRefused: switchWillBeRefused,
    /* nonag-1.0.0: an EXPLICIT selection with no user event behind it - a
       console/API call, or a feature that means "the doctor chose this". It is
       treated exactly as a press: it asks once if there is unsaved work, it is
       never swallowed silently, and the chart it lands on then stays put
       against every machine arrival. A bare setActivePtId() from a script is
       indistinguishable from a schedule tick, which is why this exists. */
    switchAsDoctor: function (id) {
      asDoctorDepth++;
      try {
        safe(function () { if (isFn(window.setActivePtId)) window.setActivePtId(id); });
        safe(function () { if (isFn(window.selectPatient)) window.selectPatient(id); });
      } finally { asDoctorDepth--; }
      return activeIdNow() === String(id == null ? '' : id);
    },
    _debugState: function () { return safe(function () { return JSON.parse(JSON.stringify(LOCK)); }, LOCK); },
    /* nonag-1.0.0 live handle: is the arrival classifier watching, and which
       targets has the doctor already declined for the visit now held. */
    _nonagState: function () { return { gestureWatch: gestureWatch, lastGestureAt: lastGestureAt, chosenId: chosenId, declined: Object.keys(declined || {}) }; },
    revert: function () { window.__mlsPatientLock.installed = false; }
  };
})();
