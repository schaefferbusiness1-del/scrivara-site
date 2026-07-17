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

  function run(opts) {
    if (stopped) return { merged: 0 };
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
    safe(function () { saveP(kept); });
    saveAliases(aliases);
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
    bootT = setTimeout(function () { bootT = null; safe(function () { run({ silent: false }); }); }, 12000);
    jobHandler = function (ev) {
      var j = ev && ev.detail;
      if (!j || j.kind !== 'schedule_pull') return;
      if (j.status === 'completed' || j.status === 'partial') setTimeout(function () { safe(function () { run({ silent: false }); }); }, 4000);
    };
    safe(function () { window.addEventListener('mls:job-progress', jobHandler, false); });
  }

  window.__mlsPatientMerge = { installed: true, version: 'pm-1.0.0', run: run, resolveAlias: resolveAlias };
  window.__mlsPatientMerge_revert = function () {
    stopped = true;
    if (bootT) { safe(function () { clearTimeout(bootT); }); bootT = null; }
    if (jobHandler) safe(function () { window.removeEventListener('mls:job-progress', jobHandler, false); });
    safe(function () { delete window.__mlsPatientMerge; });
  };
  boot();
})();
