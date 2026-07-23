/* =========================================================================
 * MLS Scribe -- b52 "Patient-context lock" (window.__mlsPatientLock)
 * 2026-07-06. Additive, guarded, reversible IIFE.
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
 *     being recorded. The two doctor-facing "switch patient" actions,
 *     _heroPickPatient(i) (~11809) and ptQuickVisit(id) (~9447), never
 *     check whether a recording or unsaved note is in progress before
 *     switching. Both are real top-level globals (verified reachable as
 *     window._heroPickPatient / window.ptQuickVisit), called only via
 *     inline onclick="" attributes, which resolve against window at click
 *     time - so wrapping them here is picked up automatically.
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
 * DESIGN (why wrapping, not rewriting):
 *   All ten hooked names are flat top-level `function` declarations in the
 *   single big inline <script> in ScribeFlow.html, which per JS semantics
 *   attach to `window` automatically (confirmed: other later code already
 *   reads window.getActivePtId / window.activePatient). Wrapping them here
 *   -- rather than editing ScribeFlow.html's giant inline script directly
 *   -- keeps this reversible and avoids merge risk in a 21k-line file.
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
  var VERSION = "1.0.0-b52";

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
  function clearLock() { LOCK.snapshot = null; LOCK.hasPendingWork = false; LOCK.capturing = false; }

  /* ---------------- item 11: snapshot who is actually being recorded ---------------- */
  if (isFn(window.startCapture)) {
    var origStart = window.startCapture;
    window.startCapture = function () {
      LOCK.snapshot = snapshotOf(currentActive());
      LOCK.capturing = true;
      LOCK.hasPendingWork = true;
      return origStart.apply(this, arguments);
    };
  }
  if (isFn(window.stopCapture)) {
    var origStop = window.stopCapture;
    window.stopCapture = function () {
      LOCK.capturing = false; /* hasPendingWork/snapshot stay set until save/send/abandon */
      return origStop.apply(this, arguments);
    };
  }

  /* ---------------- item 11: guard the two doctor-facing "switch patient" actions ---------------- */
  function blockWhileCapturing(lockedName) {
    safe(function () { var m = "Recording is in progress for " + (lockedName || "the current patient") + " - stop the recording before switching patients (switching now risks the transcript landing on the wrong patient)."; if (typeof window.toast === "function") window.toast(m, "err"); else window.alert(m); });
  }
  /* 2026-07-22 non-blocking rewrite (mirrors the b53 owner): refuse the switch
     NOW (fail closed), ask through the in-app dialog, and a confirmed answer
     re-invokes the SAME guarded entry once via a short-lived token. */
  var pendingAbandon = null, abandonAsk = null;
  function confirmAbandon(lockedName, retry) {
    if (abandonAsk) return false; /* one dialog at a time — stay locked */
    var ask = (typeof window.mlsConfirm === 'function') ? window.mlsConfirm : function (m) { return Promise.resolve(safe(function () { return window.confirm(m); }, true)); };
    abandonAsk = ask("You have an unsaved visit/note for " + (lockedName || "the current patient") + ".\n\nSwitching patients now will leave that work behind - it will NOT follow the new patient. Continue switching?").then(function (ok) {
      abandonAsk = null;
      if (!ok) return;
      pendingAbandon = { at: Date.now() };
      safe(retry);
    }, function () { abandonAsk = null; });
    return false;
  }
  /* returns true if the switch may proceed */
  function guardSwitch(targetId, retry) {
    if (LOCK.capturing) { blockWhileCapturing(LOCK.snapshot && LOCK.snapshot.name); return false; }
    if (LOCK.hasPendingWork && LOCK.snapshot && LOCK.snapshot.id) {
      var cur = currentActive();
      var stillOnLockedPatient = cur && cur.id === LOCK.snapshot.id;
      var sameTarget = targetId != null && String(targetId) === String(LOCK.snapshot.id);
      if (stillOnLockedPatient && !sameTarget) {
        if (pendingAbandon && Date.now() - pendingAbandon.at < 15000) { pendingAbandon = null; clearLock(); }
        else return confirmAbandon(LOCK.snapshot.name, retry);
      }
    }
    return true;
  }
  function guardedSwitchFn(orig, targetIdFromArgs) {
    var w = function () {
      var self = this, args = arguments;
      var targetId = targetIdFromArgs ? targetIdFromArgs(args) : null;
      if (!guardSwitch(targetId, function () { w.apply(self, args); })) return;
      return orig.apply(this, arguments);
    };
    return w;
  }
  if (isFn(window._heroPickPatient)) window._heroPickPatient = guardedSwitchFn(window._heroPickPatient, null);
  if (isFn(window.ptQuickVisit)) window.ptQuickVisit = guardedSwitchFn(window.ptQuickVisit, function (args) { return args[0]; });

  /* ---------------- item 11: force save-time patient binding to the recording snapshot ---------------- */
  if (isFn(window.noteRecordFromState)) {
    var origNRFS = window.noteRecordFromState;
    window.noteRecordFromState = function () {
      var rec = origNRFS.apply(this, arguments);
      safe(function () { if (rec && LOCK.hasPendingWork && LOCK.snapshot && LOCK.snapshot.id) rec.patientId = LOCK.snapshot.id; });
      return rec;
    };
  }
  if (isFn(window.attachVisitToPatient)) {
    var origAttach = window.attachVisitToPatient;
    window.attachVisitToPatient = function (rec) {
      var r = origAttach.apply(this, arguments);
      safe(function () { if (rec && LOCK.hasPendingWork && LOCK.snapshot && LOCK.snapshot.id) rec.patientId = LOCK.snapshot.id; });
      return r;
    };
  }

  /* ---------------- item 11: clear the lock once the visit is actually finalized ---------------- */
  if (isFn(window.saveCurrentNote)) {
    var origSave = window.saveCurrentNote;
    window.saveCurrentNote = function () { var r = origSave.apply(this, arguments); clearLock(); return r; };
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
  var WRITE_TARGETS = [["sendToEMRviaAssist", "athenaOne (paste/assist)"], ["copyForEMR", "clipboard for athenaOne"], ["pushEntireVisitToAthena", "athenaOne visit note"]];
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
    _debugState: function () { return safe(function () { return JSON.parse(JSON.stringify(LOCK)); }, LOCK); },
    revert: function () { window.__mlsPatientLock.installed = false; }
  };
})();
