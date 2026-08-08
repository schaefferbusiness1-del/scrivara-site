/* ============================================================================
 * feat_mls_saveshield.js -> window.__mlsSaveShield   (svs-1.0.0)
 * ---------------------------------------------------------------------------
 * THE CROSS-TAB STALE-LINEAGE SAVE SHIELD.
 *
 * Measured 2026-08-08: a second signed-in app tab sat wedged for hours with a
 * pre-heal roster in memory, its clamped timers re-saving that stale roster
 * ~45.6s behind each fresh write (machine-regular deltas, 45,594-47,515ms).
 * Because every save stamps updated=now, the STALE lineage carried the NEWER
 * stamp, and newest-updated-wins re-hydration at next sign-in replaced 98 of
 * 153 freshly healed records with their pre-heal bodies. The pull engines
 * already hold a cross-tab lease; the roster SAVE path had nothing.
 *
 * THE RULE (per record, optimistic-concurrency shaped): a writer may only
 * replace a stored record it has actually OBSERVED. The incoming object's
 * own pre-stamp `updated` value says which lineage it descends from:
 *   - same object reference as the stored row  -> live mutation, PASS
 *   - no stored counterpart / no stored stamp  -> new or legacy row, PASS
 *   - incoming.updated >= stored.updated       -> descended from the current
 *                                                 lineage (or newer), PASS
 *   - incoming.updated <  stored.updated       -> the writer is overwriting
 *                                                 data it never saw. REFUSE.
 * Two FRESH tabs writing concurrently both pass (each writes rows it just
 * read, stamps equal). Only a tab holding yesterday's materialization is
 * refused - which is exactly the measured failure and nothing else.
 *
 * Refusals are VISIBLE AND COUNTED, never silent: window.__mlsSaveShield.state
 * carries refusedUpserts / protectedBulkRows / samples, a console line per
 * refusal, and a toast at most once per 5 minutes.
 *
 * Bulk saves (savePatients) are not refused wholesale - a stale bulk save is
 * PER-ROW protected: any row that would regress a stored row's lineage is
 * replaced by the stored row before the save proceeds, counted per row. The
 * zombie's whole-roster re-save therefore preserves every fresher record
 * while its legitimately-untouched rows still land.
 *
 * Additive, idempotent, reversible: window.__mlsSaveShield.revert().
 * ==========================================================================*/
;(function () {
  'use strict';
  if (window.__mlsSaveShield && window.__mlsSaveShield.installed) return;

  var VERSION = 'svs-1.0.0';
  var state = { refusedUpserts: 0, protectedBulkRows: 0, lastRefusalAt: 0, lastToastAt: 0, samples: [] };

  function stamp(v) { var n = Number(v && v.updated); return isFinite(n) && n > 0 ? n : 0; }
  function note(kind, id, storedU, incomingU) {
    state.lastRefusalAt = Date.now();
    if (state.samples.length < 24) state.samples.push({ at: state.lastRefusalAt, kind: kind, id: String(id).slice(0, 24), stored: storedU, incoming: incomingU });
    try { console.warn('[MLS save shield] ' + kind + ' refused for ' + id + ': the write descends from an older copy (incoming updated ' + incomingU + ' < stored ' + storedU + '). Re-read the record before writing.'); } catch (e) {}
    var now = Date.now();
    if (now - state.lastToastAt > 300000) {
      state.lastToastAt = now;
      try { if (typeof window.toast === 'function') window.toast('A stale copy of a patient record tried to overwrite newer data and was refused. The newer data is safe.', ''); } catch (e) {}
    }
  }
  function rosterById() {
    var map = {};
    try { (window.getPatients() || []).forEach(function (p) { if (p && p.id != null) map[p.id] = p; }); } catch (e) {}
    return map;
  }

  /* WRAP ONCE, OR THE CHAIN EATS ITSELF (the b870 class, and this file's own
     first cut recreated it): if another module wraps AFTER us, the head no
     longer carries our flag, and a naive re-wrap makes a SECOND shield whose
     shared `orig` points into a chain that still contains the first — mutual
     recursion, stack overflow, no save ever reaches the base. Two rules:
     each wrapper closes over ITS OWN orig, and re-arming first walks the
     whole __mlsOrig chain — if our shield is anywhere in it, do nothing. */
  function chainHasShield(fn) {
    var seen = 0;
    while (typeof fn === 'function' && seen < 40) {
      if (fn.__mlsSvs) return true;
      fn = fn.__mlsOrig; seen++;
    }
    return false;
  }

  function wrapUpsert() {
    if (typeof window.upsertPatient !== 'function' || chainHasShield(window.upsertPatient)) return false;
    var orig = window.upsertPatient;
    var w = function (p) {
      try {
        if (p && p.id != null) {
          var stored = rosterById()[p.id];
          if (stored && stored !== p) {
            var su = stamp(stored), iu = stamp(p);
            if (su > 0 && iu > 0 && iu < su) {
              state.refusedUpserts++;
              note('upsert', p.id, su, iu);
              return { ok: false, refused: 'stale-lineage', storedUpdated: su, incomingUpdated: iu };
            }
          }
        }
      } catch (eG) {}
      return orig.apply(this, arguments);
    };
    w.__mlsSvs = 1; w.__mlsOrig = orig;
    window.upsertPatient = w;
    return true;
  }

  function wrapSave() {
    if (typeof window.savePatients !== 'function' || chainHasShield(window.savePatients)) return false;
    var orig = window.savePatients;
    var w = function (arr) {
      try {
        if (Array.isArray(arr)) {
          var stored = rosterById();
          for (var i = 0; i < arr.length; i++) {
            var row = arr[i];
            if (!row || row.id == null) continue;
            var cur = stored[row.id];
            if (!cur || cur === row) continue;
            var su = stamp(cur), iu = stamp(row);
            if (su > 0 && iu > 0 && iu < su) {
              arr[i] = cur; /* the fresher stored row survives the bulk save */
              state.protectedBulkRows++;
              note('bulk-save row', row.id, su, iu);
            }
          }
        }
      } catch (eG) {}
      return orig.apply(this, arguments);
    };
    w.__mlsSvs = 1; w.__mlsOrig = orig;
    window.savePatients = w;
    return true;
  }

  /* the base globals are inline in ScribeFlow and present at feat load time,
     but re-arm briefly in case a later module re-assigns them over us. A
     BOUNDED chain of timeouts, never an interval: it stops after 10 tries. */
  wrapUpsert(); wrapSave();
  var rearmTries = 0, rearmT = null, rearmStopped = false;
  function rearm() {
    if (rearmStopped) return;
    rearmTries++;
    wrapUpsert(); wrapSave();
    if (rearmTries < 10) rearmT = setTimeout(rearm, 3000);
  }
  rearmT = setTimeout(rearm, 3000);

  window.__mlsSaveShield = {
    installed: true, version: VERSION, state: state,
    revert: function () {
      try { rearmStopped = true; clearTimeout(rearmT); } catch (e) {}
      try { if (window.upsertPatient && window.upsertPatient.__mlsSvs && window.upsertPatient.__mlsOrig) window.upsertPatient = window.upsertPatient.__mlsOrig; } catch (e) {}
      try { if (window.savePatients && window.savePatients.__mlsSvs && window.savePatients.__mlsOrig) window.savePatients = window.savePatients.__mlsOrig; } catch (e) {}
      try { delete window.__mlsSaveShield; } catch (e) {}
    }
  };
})();
