/* =============================================================================
 * feat_mls_opmatch_boost.js -> window.__mlsOpMatchBoost  (omb-1.0.0)
 * -----------------------------------------------------------------------------
 * NEVER-ZERO op-note template auto-match. The base matcher (_opRankTemplates)
 * only scores against the athenaOne appointment "reason" text, which the pull
 * frequently cannot supply. This module widens the signal so EVERY scheduled
 * patient gets a best-effort, pre-selected template instead of "no matching
 * template", using, in order:
 *
 *   A. the appointment TYPE / reason (athenaOne schedule; ext 2.9.3), when present
 *   B. the PATIENT'S OWN HISTORY already loaded in the app -- the most recent
 *      visit's type / CPT / ICD-10 / plan / findings and any procedure sentences
 *      in the note text (a patient whose last note plans a genicular block, a
 *      facet injection, a caudal ESI, etc. now auto-selects that template)
 *   C. a practice DEFAULT (the procedure this practice's own history matches most
 *      often) so a patient with no usable signal still gets a sensible, clearly
 *      "defaulted" pre-selection the clinician can confirm or change -- NEVER a
 *      blank / "0 have a template".
 *
 * It only ever FILLS an assignment the base logic left blank; a real base match
 * is never overridden. Additive, app-side, reversible
 * (window.__mlsOpMatchBoost.revert()), freeze-safe (idempotent, no timers beyond
 * one light re-assert). No writes, no Athena calls, no change to the AI payload.
 * ===========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsOpMatchBoost && window.__mlsOpMatchBoost.installed) return; } catch (e) { return; }

  var VERSION = 'omb-1.1.0';
  var S = function (x) { return x == null ? '' : String(x); };
  var isFn = function (f) { return typeof f === 'function'; };
  var STATE = { installed: true, version: VERSION, asset: 'feat_mls_opmatch_boost.js', matchedHistory: 0, matchedReason: 0, defaulted: 0, blanks: 0, practiceDefault: '' };

  var PROC = /(genicular|facet|caudal|epidural|nerve\s*block|\bblock\b|injection|\besi\b|\bmbb\b|\brfa\b|medial\s*branch|rhizotomy|ablation|radiofrequency|steroid|intra.?articular|transforaminal|interlaminar|sacroiliac|si\s*joint|bursa|trigger\s*point|aspiration|arthrocentesis|kyphoplasty|discogram|l[1-5]\b|s1\b|c[3-7]\b|stimulator)/i;

  function norm(n) { return S(n).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function nrmDob(s) { var m = /([01]?\d)[\/\-.]([0-3]?\d)[\/\-.](\d{2,4})/.exec(S(s)); if (!m) return ''; var y = m[3].length === 2 ? '20' + m[3] : m[3]; return (+m[1]) + '/' + (+m[2]) + '/' + y; }

  function templates() { try { return (isFn(window.getTemplates) ? window.getTemplates() : []) || []; } catch (e) { return []; } }
  function patients() { try { return (isFn(window.getPatients) ? window.getPatients() : []) || []; } catch (e) { return []; } }
  function rank(sig) { try { return (isFn(window._opRankTemplates) ? window._opRankTemplates(sig) : []) || []; } catch (e) { return []; } }

  function findPatient(name, dob) {
    var pl = patients(); if (!pl.length || !name) return null;
    var nn = norm(name), wd = nrmDob(dob);
    var byBoth = null, byName = null;
    for (var i = 0; i < pl.length; i++) {
      var p = pl[i]; if (!p) continue;
      if (norm(p.name) !== nn) continue;
      if (wd && nrmDob(p.dob) === wd) { byBoth = p; break; }
      if (!byName) byName = p;
    }
    return byBoth || byName || null;
  }
  function findAppt(name, dob) {
    try {
      var arr = window._calAppts || []; var nn = norm(name), wd = nrmDob(dob);
      for (var i = 0; i < arr.length; i++) { var a = arr[i]; if (!a) continue; if (norm(a.name) !== nn) continue; if (!wd || nrmDob(a.dob) === wd) return a; }
    } catch (e) {}
    return null;
  }

  /* pull the procedure-bearing sentences out of a note body */
  function procSnippet(t) {
    t = S(t); if (!t) return '';
    var out = [], parts = t.split(/[.\n;]/);
    for (var i = 0; i < parts.length && out.length < 8; i++) { if (PROC.test(parts[i])) out.push(parts[i]); }
    return out.join(' ').slice(0, 400);
  }
  function latestVisit(p) {
    var vs = (p && Array.isArray(p.visits)) ? p.visits.slice() : [];
    vs.sort(function (a, b) { return S(b && b.date).localeCompare(S(a && a.date)); });
    return vs[0] || null;
  }
  /* combined matching signal: appointment reason FIRST, then patient history */
  function buildSignal(reason, appt, patient) {
    var parts = [];
    if (S(reason).trim()) parts.push(reason);
    if (appt && S(appt.reason).trim() && norm(appt.reason) !== norm(reason)) parts.push(appt.reason);
    if (patient) {
      var v = latestVisit(patient);
      if (v) { parts.push(S(v.type), S(v.cpt), S(v.icd10), S(v.plan), S(v.findings)); parts.push(procSnippet(v.plan || v.aiSummary || v.raw)); }
      parts.push(procSnippet(patient.problems), procSnippet(patient.summary));
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /* practice default = the template this practice's own loaded history matches
     most often (computed once, cached); ties -> first template. Never null when
     any template exists. */
  var _pd = null;
  function practiceDefault() {
    if (_pd !== null) return _pd;
    var tally = {}, pl = patients();
    for (var i = 0; i < pl.length; i++) {
      var sig = buildSignal('', null, pl[i]); if (!PROC.test(sig)) continue;
      var r = rank(sig); if (r[0] && r[0].tpl && r[0].score > 0) { var id = r[0].tpl.id; tally[id] = (tally[id] || 0) + 1; }
    }
    var best = '', bc = -1;
    for (var k in tally) { if (tally.hasOwnProperty(k) && tally[k] > bc) { bc = tally[k]; best = k; } }
    if (!best) { var t = templates(); best = (t[0] && t[0].id) || ''; }
    _pd = best; STATE.practiceDefault = best;
    return best;
  }
  function tplName(id) { var t = templates(); for (var i = 0; i < t.length; i++) if (t[i] && t[i].id === id) return t[i].name; return ''; }

  /* the core: given (name, reason, dob) produce a best-effort {tplId, source} */
  function bestFor(name, reason, dob) {
    var appt = findAppt(name, dob), patient = findPatient(name, dob);
    var sig = buildSignal(reason, appt, patient);
    var r = rank(sig);
    if (r[0] && r[0].tpl && r[0].score > 0) {
      var src = (S(reason).trim() || (appt && S(appt.reason).trim())) ? 'reason' : 'history';
      return { tplId: r[0].tpl.id, source: src, score: r[0].score };
    }
    var d = practiceDefault();
    return { tplId: d, source: 'default', score: 0 };
  }

  /* ---- wrap _opNewRow: only FILL a blank assignment, never override a match --- */
  var installed = false, iv = null;
  function installWrap() {
    var cur = window._opNewRow;
    if (!isFn(cur) || cur.__omb) return false;
    var w = function (name, reason, dob, dateStr) {
      var row = cur.apply(this, arguments);
      try {
        if (row && !S(row.tplId).trim()) {
          var b = bestFor(name, reason, dob);
          if (b.tplId) {
            row.tplId = b.tplId;
            row.ombSource = b.source;
            if (b.source === 'history') STATE.matchedHistory++;
            else if (b.source === 'reason') STATE.matchedReason++;
            else { STATE.defaulted++; row.ombDefaulted = true; }
          } else { STATE.blanks++; }
        }
      } catch (e) {}
      return row;
    };
    w.__omb = true; w.__ombInner = cur;
    window._opNewRow = w;
    installed = true;
    return true;
  }

  /* Back-fill an ALREADY-BUILT op-prep list (one that was rendered before this
     module loaded, or before a fresh pull carried procedure text). Fills any row
     left blank, then re-renders once so the dropdowns + the "N/N have a template"
     counter update WITHOUT the clinician re-opening anything. Only touches blank
     rows; never overrides an existing pick. */
  function backfillOpPrep() {
    try {
      var op = window._opPrep;
      if (!Array.isArray(op) || !op.length) return 0;
      var n = 0;
      for (var i = 0; i < op.length; i++) {
        var r = op[i]; if (!r || S(r.tplId).trim()) continue;
        var name = S(r.name || (r.appt && r.appt.name));
        var reason = S(r.proc || r.reason || (r.appt && r.appt.reason));
        var dob = S(r.dob || (r.appt && r.appt.dob));
        var b = bestFor(name, reason, dob);
        if (!b.tplId) continue;
        r.tplId = b.tplId; r.ombSource = b.source;
        if (b.source === 'history') STATE.matchedHistory++;
        else if (b.source === 'reason') STATE.matchedReason++;
        else { STATE.defaulted++; r.ombDefaulted = true; }
        n++;
      }
      if (n && isFn(window.opPrepRender)) { try { window.opPrepRender(); } catch (e) {} }
      return n;
    } catch (e) { return 0; }
  }

  function boot() {
    installWrap();
    backfillOpPrep();
    /* keep our wrapper outermost even if another module re-wraps _opNewRow, and
       keep any open op-prep list back-filled (cheap: only re-renders when it
       actually fills a blank row). */
    iv = setInterval(function () {
      try { if (isFn(window._opNewRow) && !window._opNewRow.__omb) installWrap(); } catch (e) {}
      try { backfillOpPrep(); } catch (e) {}
    }, 1500);
  }
  function revert() {
    try { if (iv) { clearInterval(iv); iv = null; } } catch (e) {}
    try { if (isFn(window._opNewRow) && window._opNewRow.__omb && window._opNewRow.__ombInner) window._opNewRow = window._opNewRow.__ombInner; } catch (e) {}
    try { window.__mlsOpMatchBoost.installed = false; } catch (e) {}
    return 'op-match boost reverted';
  }

  window.__mlsOpMatchBoost = {
    installed: true, version: VERSION, asset: 'feat_mls_opmatch_boost.js', state: STATE,
    bestFor: bestFor, buildSignal: buildSignal, practiceDefault: practiceDefault, tplName: tplName, revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
