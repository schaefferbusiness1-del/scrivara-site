/* =============================================================================
 * feat_mls_visitfix.js  ->  window.__mlsVisitFix  (vfx-1.0.0)
 * -----------------------------------------------------------------------------
 * §2.2 VISIT-TIMELINE QUALITY (certification item): the patient visit timeline
 * must hold ONLY REAL visits. Live junk shapes it removes and blocks forever:
 *   - {type:'Chart summary'} rows: the day-pull's whole-chart blob filed AS a
 *     visit, dated the pull day (renders "Jul 10, 2026 - Chart summary").
 *     The chart text itself is NOT lost: it already lives in patient.summary
 *     and the structured fields (__mlsChartStructure).
 *   - appointment-echo rows from old ingests: types like "for est20",
 *     "at 8:20 AM for est20", bare "8:20 AM ..." (schedule echoes, not visits).
 *   - {type:'Imported chart'} legacy blob rows (deriveFromLegacy re-derivations
 *     of patient.summary - same blob under another name; the derivation is
 *     gated off too, so they cannot come back).
 * Plus the two behavior fixes:
 *   - BACKGROUND AI SUMMARIES: visits saved with raw text but no aiSummary are
 *     summarized automatically (rate-limited queue over the app's own
 *     __mlsVisitModel.summarizeVisit -> aiCallRaw), so cards never sit on
 *     "AI summary pending - click to view & generate" after a pull.
 *   - Removed rows are STASHED on patient._junkVisits (cap 40) - restore('ALL'|id)
 *     puts them back; nothing is destroyed.
 *
 * Wrap points (all additive, all reverted by revert()):
 *   __mlsVisitModel.addVisit        - junk gate (blocks new junk at the chokepoint)
 *   __mlsVisitModel.deriveFromLegacy- gated to [] (no blob re-derivation)
 *   window.upsertPatient            - scrub-on-write (junk can never persist)
 *   window.savePatients             - scrub-on-bulk-write
 * Re-runnable migration (migrateNow), selfTest with the exact observed junk,
 * honest counters, ASCII-only. Follows the __mlsCleanSections precedent.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsVisitFix && window.__mlsVisitFix.installed) return;

  var VERSION = 'vfx-1.0.0';
  var S = function (x) { return x == null ? '' : String(x); };
  var isFn = function (f) { return typeof f === 'function'; };
  function M() { return window.__mlsVisitModel; }

  /* ------------------------------ junk test ------------------------------ */
  var RE_CHARTSUM = /^chart\s*summary$/i;
  var RE_IMPORTED = /^imported\s*chart$/i;
  var RE_TIME_LEAD = /^(at\s+)?\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?(\s|$)/i;
  var RE_FOR_SLOT = /^for\s+[a-z]{1,10}\d{0,3}\s*$/i;            /* "for est20" */
  var RE_SLOT_ANY = /\bfor\s+(est|new|fu|f\/u|tele|proc)\s*\d{0,3}\b/i;
  function isJunkVisit(v) {
    if (!v) return false;
    var t = S(v.type).replace(/\s+/g, ' ').trim();
    var raw = S(v.raw).replace(/\s+/g, ' ').trim();
    if (RE_CHARTSUM.test(t)) return true;
    if (RE_IMPORTED.test(t) && /^pulled from athena/i.test(raw)) return true;
    if (t && (RE_TIME_LEAD.test(t) || RE_FOR_SLOT.test(t))) return true;
    if (t && t.length <= 40 && RE_SLOT_ANY.test(t) && raw.length < 200) return true;
    if (!t && raw && raw.length < 80 && (RE_TIME_LEAD.test(raw) || RE_SLOT_ANY.test(raw))) return true;
    return false;
  }

  /* --------------------------- scrub one patient ------------------------- */
  function scrubPatient(p) {
    if (!p || !Array.isArray(p.visits) || !p.visits.length) return 0;
    var keep = [], junk = [];
    for (var i = 0; i < p.visits.length; i++) {
      var v = p.visits[i];
      if (isJunkVisit(v)) junk.push(v); else keep.push(v);
    }
    if (!junk.length) return 0;
    p.visits = keep;
    try {
      if (!Array.isArray(p._junkVisits)) p._junkVisits = [];
      p._junkVisits = p._junkVisits.concat(junk).slice(-40);
    } catch (e) {}
    return junk.length;
  }

  /* ------------------------------- wraps --------------------------------- */
  var wrapped = { addVisit: null, derive: null, upsert: null, save: null };

  function wrapAddVisit() {
    var m = M();
    if (!m || !isFn(m.addVisit) || m.addVisit.__vfxWrapped) return;
    var orig = m.addVisit;
    var w = function (patientId, raw, opts) {
      try {
        var probe = raw;
        if (typeof raw === 'string') probe = { raw: raw };
        if (isJunkVisit(probe)) { STATE.blocked++; return null; }
      } catch (e) {}
      var v = orig.apply(m, arguments);
      try { if (v && v.raw && !S(v.aiSummary).trim()) enqueue(patientId); } catch (e) {}
      return v;
    };
    w.__vfxWrapped = true; w.__vfxOrig = orig;
    /* keep the visits_honest heartbeat from double-wrapping over us */
    try { if (orig.__honestWrapped) w.__honestWrapped = true; } catch (e) {}
    m.addVisit = w; wrapped.addVisit = { host: m, key: 'addVisit', orig: orig };
  }
  function wrapDerive() {
    var m = M();
    if (!m || !isFn(m.deriveFromLegacy) || m.deriveFromLegacy.__vfxWrapped) return;
    var orig = m.deriveFromLegacy;
    var w = function () { return []; };                 /* no blob re-derivation, ever */
    w.__vfxWrapped = true; w.__vfxOrig = orig;
    m.deriveFromLegacy = w; wrapped.derive = { host: m, key: 'deriveFromLegacy', orig: orig };
  }
  function wrapUpsert() {
    if (!isFn(window.upsertPatient) || window.upsertPatient.__vfxWrapped) return;
    var orig = window.upsertPatient;
    var w = function (p) {
      try { var n = scrubPatient(p); if (n) STATE.scrubbedOnWrite += n; } catch (e) {}
      return orig.apply(window, arguments);
    };
    w.__vfxWrapped = true; w.__vfxOrig = orig;
    window.upsertPatient = w; wrapped.upsert = { host: window, key: 'upsertPatient', orig: orig };
  }
  function wrapSave() {
    if (!isFn(window.savePatients) || window.savePatients.__vfxWrapped) return;
    var orig = window.savePatients;
    var w = function (list) {
      try {
        if (Array.isArray(list)) {
          for (var i = 0; i < list.length; i++) { var n = scrubPatient(list[i]); if (n) STATE.scrubbedOnWrite += n; }
        }
      } catch (e) {}
      return orig.apply(window, arguments);
    };
    w.__vfxWrapped = true; w.__vfxOrig = orig;
    window.savePatients = w; wrapped.save = { host: window, key: 'savePatients', orig: orig };
  }
  function ensureWrapped() { wrapAddVisit(); wrapDerive(); wrapUpsert(); wrapSave(); }

  /* ---------------------------- migration -------------------------------- */
  function migrateNow() {
    var out = { patients: 0, removed: 0 };
    try {
      var ps = isFn(window.getPatients) ? (window.getPatients() || []) : [];
      var touched = [];
      for (var i = 0; i < ps.length; i++) {
        var n = scrubPatient(ps[i]);
        if (n) { out.patients++; out.removed += n; touched.push(ps[i]); }
      }
      if (touched.length) {
        if (isFn(window.savePatients)) window.savePatients(ps);
        else if (isFn(window.upsertPatient)) for (var j = 0; j < touched.length; j++) window.upsertPatient(touched[j]);
      }
    } catch (e) { out.error = S(e && e.message || e).slice(0, 120); }
    STATE.lastMigrate = out;
    return out;
  }
  function restore(which) {
    var out = { patients: 0, restored: 0 };
    try {
      var ps = isFn(window.getPatients) ? (window.getPatients() || []) : [];
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i]; if (!p) continue;
        if (which !== 'ALL' && p.id !== which) continue;
        if (Array.isArray(p._junkVisits) && p._junkVisits.length) {
          p.visits = (Array.isArray(p.visits) ? p.visits : []).concat(p._junkVisits);
          out.restored += p._junkVisits.length; out.patients++;
          delete p._junkVisits;
        }
      }
      if (out.patients && isFn(window.savePatients)) window.savePatients(ps);
    } catch (e) { out.error = S(e && e.message || e).slice(0, 120); }
    return out;
  }

  /* ----------------- background AI summaries (rate-limited) --------------- */
  var Q = [];                    /* patient ids, FIFO, deduped */
  var QSEEN = {};
  var PER_PATIENT = {};          /* summaries generated per patient this session */
  var CFG = { tickMs: 4500, minRaw: 40, maxPerPatient: 15, maxPerSession: 250, errPauseMs: 300000 };
  function enqueue(pid) {
    pid = S(pid); if (!pid || QSEEN[pid]) return;
    QSEEN[pid] = 1; Q.push(pid);
  }
  function eligible(v) {
    return v && S(v.raw).trim().length >= CFG.minRaw && !S(v.aiSummary).trim() && !isJunkVisit(v);
  }
  function findPatientById(pid) {
    try {
      var ps = isFn(window.getPatients) ? (window.getPatients() || []) : [];
      for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === pid) return ps[i];
    } catch (e) {}
    return null;
  }
  var pumpBusy = false, consecErr = 0, pausedUntil = 0, stopped = false;
  function pumpOnce() {
    if (pumpBusy || stopped) return Promise.resolve();
    if (Date.now() < pausedUntil) return Promise.resolve();
    if (STATE.summarized >= CFG.maxPerSession) return Promise.resolve();
    var m = M(); if (!m || !isFn(m.summarizeVisit)) return Promise.resolve();
    /* also keep the ACTIVE patient's card fresh */
    try { var ap = isFn(window.activePatient) ? window.activePatient() : null; if (ap && ap.id) enqueue(ap.id); } catch (e) {}
    var pid = null, vid = null;
    while (Q.length && !vid) {
      var cand = Q[0];
      var p = findPatientById(cand);
      var vs = (p && Array.isArray(p.visits)) ? p.visits : [];
      var count = PER_PATIENT[cand] || 0;
      var v = null;
      if (p && count < CFG.maxPerPatient) { for (var i = 0; i < vs.length; i++) { if (eligible(vs[i])) { v = vs[i]; break; } } }
      if (v) { pid = cand; vid = v.id; }
      else { Q.shift(); delete QSEEN[cand]; }        /* drained or capped: rotate out */
    }
    if (!vid) return Promise.resolve();
    pumpBusy = true;
    return m.summarizeVisit(pid, vid).then(function () {
      pumpBusy = false; consecErr = 0;
      STATE.summarized++; PER_PATIENT[pid] = (PER_PATIENT[pid] || 0) + 1;
      try { if (window.__mlsVisitUI && isFn(window.__mlsVisitUI.render)) window.__mlsVisitUI.render(true); } catch (e) {}
    }, function (err) {
      pumpBusy = false; consecErr++; STATE.summarizeErrors++;
      if (consecErr >= 3) {
        pausedUntil = Date.now() + CFG.errPauseMs; consecErr = 0;
        try { console.log('[MLS visitfix] AI summary transport failing (' + S(err && err.message || err).slice(0, 80) + ') - pausing background summaries 5 min.'); } catch (e) {}
      }
    });
  }
  function loop() {
    if (stopped) return;
    Promise.resolve().then(pumpOnce).then(function () { setTimeout(loop, CFG.tickMs); }, function () { setTimeout(loop, CFG.tickMs); });
  }

  /* ------------------------------ self-test ------------------------------ */
  function selfTest() {
    var cases = [
      [{ type: 'Chart summary', date: '2026-07-10', raw: 'PROBLEMS: ...' }, true],
      [{ type: 'chart Summary', date: '', raw: 'x' }, true],
      [{ type: 'for est20', date: '2026-07-10', raw: 'Dunne, Bob' }, true],
      [{ type: 'at 8:20 AM for est20', date: '2026-07-10', raw: '' }, true],
      [{ type: '8:20 AM', date: '2026-07-10', raw: 'echo' }, true],
      [{ type: 'Imported chart', date: '2026-06-20', raw: 'Pulled from Athena 6/20/2026 PROBLEMS ...' }, true],
      [{ type: '', date: '2026-07-10', raw: 'at 9:00 AM for new12' }, true],
      [{ type: 'Office visit', date: '2026-05-04', raw: 'Provider: John Vresilovic, MD\nFollow-up lumbar ESI, improving.' }, false],
      [{ type: 'Procedure', date: '2026-04-14', raw: 'L4-5 TFESI performed. Tolerated well. CPT 64483.' }, false],
      [{ type: 'PT CONSULTATION', date: '2026-03-02', raw: 'Physical therapy evaluation for chronic LBP.' }, false],
      [{ type: 'Office visit (2)', date: '2026-05-04', raw: 'Second same-day visit, distinct note text here.' }, false]
    ];
    var fails = [];
    for (var i = 0; i < cases.length; i++) {
      if (isJunkVisit(cases[i][0]) !== cases[i][1]) fails.push(i);
    }
    return { pass: !fails.length, fails: fails, total: cases.length };
  }

  /* ------------------------------- public -------------------------------- */
  var STATE = { blocked: 0, scrubbedOnWrite: 0, summarized: 0, summarizeErrors: 0, lastMigrate: null };
  function revert() {
    stopped = true;
    ['addVisit', 'derive', 'upsert', 'save'].forEach(function (k) {
      var w = wrapped[k];
      try { if (w && w.host && w.host[w.key] && w.host[w.key].__vfxWrapped) w.host[w.key] = w.orig; } catch (e) {}
      wrapped[k] = null;
    });
    try { clearInterval(ensureIv); } catch (e) {}
    window.__mlsVisitFix.installed = false;
  }

  window.__mlsVisitFix = {
    installed: true, version: VERSION,
    state: STATE, cfg: CFG,
    isJunkVisit: isJunkVisit, selfTest: selfTest,
    migrateNow: migrateNow, restore: restore,
    enqueue: enqueue, queue: function () { return Q.slice(); },
    revert: revert
  };

  /* boot: wraps may race satellite load order - heartbeat like visits_honest */
  var ticks = 0;
  var ensureIv = setInterval(function () { ensureWrapped(); if (++ticks > 60) clearInterval(ensureIv); }, 500);
  ensureWrapped();
  function boot() {
    ensureWrapped();
    try { var r = migrateNow(); if (r && (r.removed || r.patients)) console.log('[MLS visitfix] removed ' + r.removed + ' junk visit row(s) across ' + r.patients + ' patient(s) (stashed on _junkVisits).'); } catch (e) {}
    setTimeout(loop, 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 1500);
})();
