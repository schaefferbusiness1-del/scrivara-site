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
  var VERSION = "1.0.2-b53";

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
      if (!ok) return;
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
    if (state === 'blocked') { blockWhileCapturing(LOCK.snapshot && LOCK.snapshot.name); return false; }
    if (state === 'confirmed') { pendingAbandon = null; clearLock(); return true; }
    if (state === 'ask') return confirmAbandon(LOCK.snapshot.name, targetId);
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
    _debugState: function () { return safe(function () { return JSON.parse(JSON.stringify(LOCK)); }, LOCK); },
    revert: function () { window.__mlsPatientLock.installed = false; }
  };
})();
