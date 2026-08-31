/* =============================================================================
 * MLS Scribe — EXACT-DUPLICATE PATIENT AUTO-MERGE  (pm-1.0.0)
 *
 * Owner report 2026-07-17 (verified live: 12 duplicate pairs in 1427 records):
 * pulls + manual adds can leave TWO records for the same human. This module
 * merges duplicates automatically — and ONLY exact-identity duplicates:
 *
 *   - same MRN digits (5+ digits), OR
 *   - same normalized name AND same DOB digits (6+ digits).
 *
 * Near-matches (name-only, fuzzy names, missing DOB) are NEVER merged; a wrong
 * merge is clinically worse than a duplicate, so this stays fail-closed.
 *
 * Merge semantics (data can only grow, never be lost):
 *   - WINNER = the record with a verified-import id ('mr…' prefix), else the
 *     one with more visits, else the longer summary, else the first seen.
 *   - Scalar fields: winner's EMPTY fields are filled from the loser; a
 *     non-empty winner field is never overwritten.
 *   - Visits: loser visits move to the winner unless already present (matched
 *     by encounterId / sourceVisitKey / rowKey, else date + trimmed body).
 *     Moved visits keep every flag and are stamped mergedFrom for audit.
 *   - The loser record is then removed and an alias loserId -> winnerId is
 *     stored in localStorage (mls_patient_alias_v1) so later lookups can
 *     resolve stale references.
 *
 * Runs at boot (delayed), after each completed schedule job, and on demand via
 * window.__mlsPatientMerge.run(). Additive + reversible: __mlsPatientMerge_revert
 * (stops future runs; performed merges persist — data was only combined).
 * ES5 only (var/function, no arrows), matches house feature-module shape.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsPatientMerge && window.__mlsPatientMerge.installed) return;

  var ALIAS_KEY = 'mls_patient_alias_v1';
  var stopped = false;
  var deferT = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function S(v) { return v == null ? '' : String(v); }
  function normName(s) { return S(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function digits(s) { return S(s).replace(/\D/g, ''); }
  function visitBody(v) { return S(v && (v.raw || v.text || v.note || v.detail)).replace(/\s+/g, ' ').trim(); }
  function visitKey(v) {
    var eid = S(v && (v.encounterId || v.encounterID)).trim().toLowerCase();
    if (eid) return 'e|' + eid;
    var src = S(v && (v.sourceVisitKey || v.rowKey)).trim().toLowerCase();
    if (src) return 's|' + src;
    return 'd|' + S(v && v.date) + '|' + visitBody(v).toLowerCase().slice(0, 300);
  }
  function loadAliases() { return safe(function () { return JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}') || {}; }, {}); }
  function saveAliases(map) { safe(function () { localStorage.setItem(ALIAS_KEY, JSON.stringify(map)); }); }

  function winnerOf(a, b) {
    var aMr = /^mr/.test(S(a.id)), bMr = /^mr/.test(S(b.id));
    if (aMr !== bMr) return aMr ? [a, b] : [b, a];
    var av = (a.visits || []).length, bv = (b.visits || []).length;
    if (av !== bv) return av > bv ? [a, b] : [b, a];
    if (S(a.summary).length !== S(b.summary).length) return S(a.summary).length > S(b.summary).length ? [a, b] : [b, a];
    return [a, b];
  }

  /* Fields that may be copied INTO an empty winner slot. Never overwrites. */
  var FILL_FIELDS = ['dob', 'mrn', 'athenaId', 'phone', 'email', 'summary', 'meds', 'problems', 'allergies', 'vitals', 'provider', 'insurance', 'address'];

  function mergePair(winner, loser) {
    var moved = 0, fi, f;
    for (fi = 0; fi < FILL_FIELDS.length; fi++) {
      f = FILL_FIELDS[fi];
      if (!S(winner[f]).trim() && S(loser[f]).trim()) winner[f] = loser[f];
    }
    var have = {}, wi;
    var wv = winner.visits = winner.visits || [];
    for (wi = 0; wi < wv.length; wi++) have[visitKey(wv[wi])] = 1;
    var lv = loser.visits || [];
    for (wi = 0; wi < lv.length; wi++) {
      var key = visitKey(lv[wi]);
      if (have[key]) continue;
      have[key] = 1;
      var mv = lv[wi];
      /* identity equality is the merge criterion, so rebinding is truthful;
         the original binding is preserved for audit. */
      if (mv && mv.identityBinding != null) { mv.mergedFromBinding = mv.identityBinding; mv.identityBinding = String(winner.id); }
      if (mv) mv.mergedFrom = String(loser.id);
      wv.push(mv);
      moved++;
    }
    return moved;
  }

  /* pm-1.0.1: an explicit pull keeps __mlsPullBusyAt fresh (stamped at start,
     lease-touched every 25s, zeroed on finish). Merging while it is fresh
     rewrites the patient store MID-history-batch: the batch's patientById
     proofs then miss (the merged loser id vanishes) and every merged patient
     lands in history-partial — the live 2026-07-18 "history was not saved"
     verdict on a pull whose saves all verified. Defer until the pull is idle. */
  function pullBusy() {
    return safe(function () {
      var t = Number(window.__mlsPullBusyAt || 0);
      return t > 0 && (Date.now() - t) < 90000;
    }, false);
  }
  function run(opts) {
    if (stopped) return { merged: 0 };
    if (pullBusy()) {
      if (!deferT) deferT = setTimeout(function () { deferT = null; safe(function () { run(opts); }); }, 20000);
      return { merged: 0, reason: 'deferred-pull-busy' };
    }
    var getP = window.getPatients, saveP = window.savePatients;
    if (typeof getP !== 'function' || typeof saveP !== 'function') return { merged: 0, reason: 'store-unavailable' };
    var pts = safe(function () { return getP() || []; }, []);
    if (!pts.length) return { merged: 0 };
    var byKey = {}, i, p, keys, ki;
    for (i = 0; i < pts.length; i++) {
      p = pts[i]; if (!p || !p.id) continue;
      keys = [];
      var mrn = digits(p.mrn || p.athenaId);
      if (mrn.length >= 5) keys.push('m|' + mrn);
      var nn = normName(p.name), dd = digits(p.dob);
      if (nn && dd.length >= 6) keys.push('n|' + nn + '|' + dd);
      for (ki = 0; ki < keys.length; ki++) (byKey[keys[ki]] = byKey[keys[ki]] || []).push(p);
    }
    var seenPair = {}, removedIds = {}, aliases = null, merged = 0, movedVisits = 0, k;
    for (k in byKey) {
      if (!Object.prototype.hasOwnProperty.call(byKey, k)) continue;
      var group = byKey[k].filter(function (x) { return !removedIds[x.id]; });
      /* unique by id inside the group */
      var uniq = [], seenIds = {};
      for (i = 0; i < group.length; i++) if (!seenIds[group[i].id]) { seenIds[group[i].id] = 1; uniq.push(group[i]); }
      while (uniq.length > 1) {
        var pairKey = uniq[0].id + '|' + uniq[1].id;
        if (seenPair[pairKey]) break;
        seenPair[pairKey] = 1;
        var wl = winnerOf(uniq[0], uniq[1]), w = wl[0], l = wl[1];
        /* extra guard: if BOTH records carry an MRN and they disagree, never merge */
        var wm = digits(w.mrn || w.athenaId), lm = digits(l.mrn || l.athenaId);
        if (wm.length >= 5 && lm.length >= 5 && wm !== lm) break;
        movedVisits += mergePair(w, l);
        removedIds[l.id] = String(w.id);
        merged++;
        uniq = [w].concat(uniq.slice(2)).filter(function (x) { return !removedIds[x.id]; });
      }
    }
    if (!merged) return { merged: 0 };
    var kept = pts.filter(function (x) { return !x || !removedIds[x.id]; });
    aliases = loadAliases();
    for (k in removedIds) if (Object.prototype.hasOwnProperty.call(removedIds, k)) aliases[k] = removedIds[k];
    /* pm-1.0.3 (2026-08-31): {allowRemovals:true} IS REQUIRED FOR A SAVE THAT
       DROPS ROWS, and this one dropped rows for a year without it. The patient
       row guard reads an unflagged shrink as an accidental truncation and
       carries every absent row straight back - and `kept` is a .filter()
       product, so it carries no read-generation stamp either and falls to the
       12-second clock rule, which a just-merged loser always passes. So the
       merge announced "nothing was lost" and then undid its own removal, while
       the alias map was written unconditionally: the duplicate survived AND
       every later lookup was told it had been absorbed. The identical defect
       was found and fixed for the console dedup (feat_mls_b121_pack.js,
       dedupsrv-1.0.0) and never back-ported here. */
    safe(function () { saveP(kept, undefined, { allowRemovals: true }); });
    saveAliases(aliases);
    /* THE SELECTION FOLLOWS THE SURVIVOR (owner, 2026-08-31: "did u fix the
       patient selected"). This module ran 12s after boot and 4s after every
       completed pull - exactly when a pull has just minted the duplicates -
       removed the absorbed chart out from under whoever had it open, and never
       touched the active-patient pointer. The doctor was then selected on a
       chart that no longer existed: the banner blanked, every getActivePtId()
       caller kept the dead id, and none of the ~30 mls:active-patient-changed
       listeners heard anything, because nothing dispatched it.
       resolveAlias() follows a chain, so a loser absorbed twice in one run
       still lands on the final survivor, and setActivePtId is the canonical
       writer - it bumps the epoch and fires the app's own announcement. */
    safe(function () {
      if (typeof window.getActivePtId !== 'function' || typeof window.setActivePtId !== 'function') return;
      var a = S(window.getActivePtId());
      if (!a || !removedIds[a]) return;
      var win = S(resolveAlias(a));
      if (!win || win === a) return;
      window.setActivePtId(win);
    });
    safe(function () { if (typeof window.loadPatients === 'function') window.loadPatients(); });
    if (!opts || opts.silent !== true) {
      safe(function () { if (typeof window.toast === 'function') window.toast('Merged ' + merged + ' duplicate patient record' + (merged === 1 ? '' : 's') + ' (' + movedVisits + ' visit' + (movedVisits === 1 ? '' : 's') + ' combined - nothing was lost).', 'ok'); });
    }
    return { merged: merged, movedVisits: movedVisits };
  }

  /* alias resolver for stale references */
  function resolveAlias(id) {
    var map = loadAliases(), cur = S(id), hops = 0;
    while (map[cur] && hops++ < 5) cur = map[cur];
    return cur;
  }

  var bootT = null, jobHandler = null;
  function boot() {
    /* pm-1.0.2 (owner 2026-07-23): the boot-time sweep merges QUIETLY — dupes
       that regenerate between boots made this toast fire on every launch.
       Post-pull and on-demand merges still announce their result. */
    bootT = setTimeout(function () { bootT = null; safe(function () { run({ silent: true }); }); }, 12000);
    jobHandler = function (ev) {
      var j = ev && ev.detail;
      if (!j || j.kind !== 'schedule_pull') return;
      if (j.status === 'completed' || j.status === 'partial') setTimeout(function () { safe(function () { run({ silent: false }); }); }, 4000);
    };
    safe(function () { window.addEventListener('mls:job-progress', jobHandler, false); });
  }

  window.__mlsPatientMerge = { installed: true, version: 'pm-1.0.3', run: run, resolveAlias: resolveAlias };
  window.__mlsPatientMerge_revert = function () {
    stopped = true;
    if (bootT) { safe(function () { clearTimeout(bootT); }); bootT = null; }
    if (deferT) { safe(function () { clearTimeout(deferT); }); deferT = null; }
    if (jobHandler) safe(function () { window.removeEventListener('mls:job-progress', jobHandler, false); });
    safe(function () { delete window.__mlsPatientMerge; });
  };
  boot();
})();
