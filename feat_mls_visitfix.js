/* =============================================================================
 * feat_mls_visitfix.js  ->  window.__mlsVisitFix  (vfx-1.2.0)
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
 * Plus the behavior fixes:
 *   - BACKGROUND AI SUMMARIES: visits saved with raw text but no aiSummary are
 *     summarized automatically (rate-limited queue over the app's own
 *     __mlsVisitModel.summarizeVisit -> aiCallRaw), so cards never sit on
 *     "AI summary pending - click to view & generate" after a pull.
 *   - Removed rows are STASHED on patient._junkVisits (cap 60) - restore('ALL'|id)
 *     puts them back; nothing is destroyed.
 * v1.2.0 (duplicate-visit render + provenance, live root-caused):
 *   - WORKER-PACED TICKER: main-thread setInterval is throttled to ~0 ticks in a
 *     hidden MLS tab (measured live: 0 ticks/3.6s while a pull foregrounds
 *     athena) - so the echo-hider and panel refresh NEVER ran exactly when
 *     pulls were filing visits, leaving the same visit rendered top AND bottom.
 *     A blob-Worker postMessage tick (same pattern as the b121 pack) is immune.
 *   - EVENT-DRIVEN UI FIX: every addVisit filing / scrub-on-write also fixes
 *     the render immediately (echo hide + __mlsVisitHistoryExt.rebuild nudge).
 *   - SOURCE RETAG (one-shot, stashed on v._srcPrev): visits filed by the
 *     visits-pane backfill were stored source:'import' because the cache-pinned
 *     feat_visits.js?v=b84 addVisit drops opts.source - the pane row shape
 *     ("Provider: ...\n<type> | MM-DD-YYYY, ...") is retagged 'athena-visits'
 *     so they render "From Athena". The pack now also stamps v.source directly.
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

  var VERSION = 'vfx-1.2.1';
  var S = function (x) { return x == null ? '' : String(x); };
  var isFn = function (f) { return typeof f === 'function'; };
  function M() { return window.__mlsVisitModel; }

  /* ------------------------------ junk test ------------------------------ */
  var RE_CHARTSUM = /^chart\s*summary$/i;
  var RE_IMPORTED = /^imported\s*chart$/i;
  var RE_TIME_LEAD = /^(at\s+)?\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?(\s|$)/i;
  var RE_FOR_SLOT = /^for\s+[a-z]{1,10}\d{0,3}\s*$/i;            /* "for est20" */
  var RE_SLOT_ANY = /\bfor\s+(est|new|fu|f\/u|tele|proc)\s*\d{0,3}\b/i;
  /* v1.1.0: manufactured "visits" from the chart-structure summary parse (live
     shapes: medication-fill lines as types, section headers, a row dated the
     patient's BIRTH date). Real visits-pane rows ("Office visit", procedures,
     provider-typed rows) never look like these. */
  var RE_MEDSTATUS = /^(filled|refilled|entered|discontinued|prescribed|dispensed|active|inactive|expired)$/i;
  var RE_SECTIONISH = /^(service dept\.?|dept\.?|status|source|plan|type)$/i;
  function isJunkVisit(v) {
    if (!v) return false;
    var t = S(v.type).replace(/\s+/g, ' ').trim();
    var raw = S(v.raw).replace(/\s+/g, ' ').trim();
    if (RE_CHARTSUM.test(t)) return true;
    if (RE_IMPORTED.test(t) && /^pulled from athena/i.test(raw)) return true;
    if (t && (RE_TIME_LEAD.test(t) || RE_FOR_SLOT.test(t))) return true;
    if (t && t.length <= 40 && RE_SLOT_ANY.test(t) && raw.length < 200) return true;
    if (!t && raw && raw.length < 80 && (RE_TIME_LEAD.test(raw) || RE_SLOT_ANY.test(raw))) return true;
    if (RE_MEDSTATUS.test(t)) return true;
    if (RE_SECTIONISH.test(t)) return true;
    return false;
  }
  /* patient-context junk (needs p): a "visit" dated the patient's literal birth
     DATE, and clusters of >=3 rows sharing an IDENTICAL long raw (chart-text
     slices - real distinct visits never share the same 500+ char body). */
  function normD(s) { var m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(S(s)); if (m) { var y = m[3].length === 2 ? ((+m[3] > 26 ? '19' : '20') + m[3]) : m[3]; return (+m[1]) + '/' + (+m[2]) + '/' + y; } var i = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(S(s)); if (i) return (+i[2]) + '/' + (+i[3]) + '/' + i[1]; return ''; }
  function junkByContext(p, vs) {
    var junkIdx = {};
    var dob = normD(p && p.dob);
    var rawCount = {};
    vs.forEach(function (v) { var r = S(v && v.raw); if (r.length > 500) rawCount[r] = (rawCount[r] || 0) + 1; });
    vs.forEach(function (v, i) {
      if (!v) return;
      if (dob && normD(v.date) === dob) { junkIdx[i] = 1; return; }
      var r = S(v.raw);
      if (r.length > 500 && rawCount[r] >= 3) junkIdx[i] = 1;
    });
    return junkIdx;
  }

  /* --------------------------- scrub one patient ------------------------- */
  function scrubPatient(p) {
    if (!p || !Array.isArray(p.visits) || !p.visits.length) return 0;
    var ctx = junkByContext(p, p.visits);
    var keep = [], junk = [];
    for (var i = 0; i < p.visits.length; i++) {
      var v = p.visits[i];
      if (isJunkVisit(v) || ctx[i]) junk.push(v); else keep.push(v);
    }
    if (!junk.length) return 0;
    p.visits = keep;
    try {
      if (!Array.isArray(p._junkVisits)) p._junkVisits = [];
      p._junkVisits = p._junkVisits.concat(junk).slice(-60);
    } catch (e) {}
    return junk.length;
  }
  /* v1.1.0: the profile page rendered the SAME visits twice - the model list
     ("Visit history", top) AND the summary-derived read-only echoes in the
     "Visit timeline" (.mls-tl-hist, bottom). When the patient has REAL model
     visits, hide the summary echoes so each visit appears exactly once, in
     the right place; patients with no model visits keep the read-only rows
     (some history beats none). Gentle: one cheap class toggle per tick,
     app page only (never touches athena). */
  function echoTick() {
    try {
      var tl = document.getElementById('ptTimeline');
      if (!tl) return; /* cheap DOM check FIRST - activePatient() JSON.parses the whole 5MB store */
      var rows = tl.querySelectorAll('.mls-tl-hist');
      if (!rows.length) return;
      var ap = isFn(window.activePatient) ? window.activePatient() : null;
      var hasModel = !!(ap && Array.isArray(ap.visits) && ap.visits.length);
      for (var i = 0; i < rows.length; i++) rows[i].style.display = hasModel ? 'none' : '';
    } catch (e) {}
  }
  /* v1.2.0: sig-guarded refresh of the rich Visit-history panel - its own 900ms
     setInterval is frozen in a hidden tab, so filings during a pull rendered a
     stale "0 visits" panel until a manual poke. Cheap: rebuild(false) returns
     on an unchanged data signature. */
  function nudgePanel() {
    try { var X = window.__mlsVisitHistoryExt; if (X && isFn(X.rebuild)) X.rebuild(false); } catch (e) {}
  }
  /* uiFix is only ever run from the WORKER TICK (never synchronously inside a
     save/render call chain - a synchronous DOM fix from inside renderProfile's
     own save path can re-enter the renderer mid-build and wedge the tab).
     Wraps just raise this flag; the next 1.5s tick applies the fix. */
  var uiDirty = false;
  function uiFix() { echoTick(); nudgePanel(); }
  function scheduleUiFix() { uiDirty = true; }

  /* ---- v1.2.1 HYDRATION GUARD (visit content can never be emptied) --------
     The backend stores visits as {date,type,detail,source} and
     loadPatientsFromServer ADOPTS the server copy wholesale when its `updated`
     is newer - one reload strips raw/findings/aiSummary/id/captured from every
     visit (live: Patricia Allen 5/5 skeletal after a single round-trip). At
     the same write chokepoint as the junk scrub: when an incoming visit is
     SKELETAL and the currently-PERSISTED copy has a same-(date+type) row WITH
     content, put the content fields back. Only refuses to lose local content -
     server-won fields (date/type/detail/source) still win. */
  function keyDT(v) { return normD(v && v.date) + '|' + S(v && v.type).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 44); }
  function skeletalV(v) { return !!(v && (v.date || v.type) && !S(v.raw).trim() && !S(v.aiSummary).trim() && !S(v.id).trim()); }
  function hydrateFromPersisted(list) {
    var restored = 0, prevMap = null;
    try {
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!p || !Array.isArray(p.visits) || !p.visits.length) continue;
        var needs = false;
        for (var j = 0; j < p.visits.length; j++) { if (skeletalV(p.visits[j])) { needs = true; break; } }
        if (!needs) continue;
        if (!prevMap) { /* parse the persisted store ONCE, only when a skeleton exists */
          prevMap = {};
          try {
            var rawLs = (typeof window.uns === 'function') ? localStorage.getItem(window.uns('patients')) : null;
            var prev = rawLs ? JSON.parse(rawLs) : [];
            for (var k = 0; k < prev.length; k++) { if (prev[k] && prev[k].id) prevMap[prev[k].id] = prev[k]; }
          } catch (eL) { prevMap = {}; }
        }
        var pp = prevMap[p.id];
        if (!pp || !Array.isArray(pp.visits) || !pp.visits.length) continue;
        var richByKey = {};
        for (var q = 0; q < pp.visits.length; q++) { var pv = pp.visits[q]; if (pv && !skeletalV(pv)) richByKey[keyDT(pv)] = pv; }
        for (var j2 = 0; j2 < p.visits.length; j2++) {
          var v = p.visits[j2]; if (!skeletalV(v)) continue;
          var rich = richByKey[keyDT(v)];
          if (!rich) continue;
          var merged = {}, kk;
          for (kk in rich) merged[kk] = rich[kk];   /* local content survives */
          if (v.date) merged.date = v.date;          /* server-won basics still win */
          if (v.type) merged.type = v.type;
          if (v.detail != null) merged.detail = v.detail;
          /* generic 'import' never downgrades a specific local tag (the server
             round-trip echoes stale sources long after a retag) */
          if (v.source && !(v.source === 'import' && rich.source && rich.source !== 'import')) merged.source = v.source;
          p.visits[j2] = merged;
          restored++;
        }
      }
    } catch (eH) {}
    if (restored) STATE.hydrated += restored;
    return restored;
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
      try { if (v) scheduleUiFix(); } catch (e) {} /* v1.2.0: never leave a fresh filing rendered twice */
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
      var r = orig.apply(window, arguments);
      try { scheduleUiFix(); } catch (e) {}
      return r;
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
          hydrateFromPersisted(list); /* v1.2.1: BEFORE the persisted copy is overwritten */
        }
      } catch (e) {}
      var r = orig.apply(window, arguments);
      try { scheduleUiFix(); } catch (e) {}
      return r;
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
  /* v1.2.0: retag visits that the visits-pane backfill filed while the cache-
     pinned b84 addVisit was dropping opts.source. Shape is unmistakable: the
     backfill writes raw 'Provider: <name>\n<type> | <MM-DD-YYYY>, ...' (or the
     bare '<type> | <MM-DD-YYYY>, ...' textHead when the pane row had no
     provider). Old value stashed on v._srcPrev; re-runnable; never touches
     rows that already carry a real source. */
  var RE_PANE_PROV = /^Provider: [^\n]+\n/;
  var RE_PANE_HEAD = /\| [01]?\d-[0-3]?\d-\d{4},/;
  function retagSources() {
    var out = { retagged: 0, patients: 0 };
    try {
      var ps = isFn(window.getPatients) ? (window.getPatients() || []) : [];
      var touched = [];
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i]; if (!p || !Array.isArray(p.visits)) continue;
        var hit = 0;
        for (var j = 0; j < p.visits.length; j++) {
          var v = p.visits[j]; if (!v) continue;
          var src = S(v.source);
          if (src && src !== 'import') continue;
          var raw = S(v.raw), fin = S(v.findings);
          if (RE_PANE_PROV.test(raw) || RE_PANE_HEAD.test(raw) || RE_PANE_HEAD.test(fin)) {
            v._srcPrev = src || '';
            v.source = 'athena-visits';
            hit++;
          }
        }
        if (hit) { out.retagged += hit; out.patients++; touched.push(p); }
      }
      if (touched.length) {
        if (isFn(window.savePatients)) window.savePatients(ps);
        else if (isFn(window.upsertPatient)) for (var k = 0; k < touched.length; k++) window.upsertPatient(touched[k]);
      }
    } catch (e) { out.error = S(e && e.message || e).slice(0, 120); }
    STATE.lastRetag = out;
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
      try { uiFix(); } catch (e) {}
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

  /* -------- v1.2.0 worker ticker: immune to hidden-tab timer throttling ----
     Main-thread setInterval ticks ~0 times while the MLS tab is hidden (which
     is exactly when pulls file visits - athena is foregrounded). Worker timers
     and their postMessage handlers still fire. Same blob-Worker pattern as the
     b121 pack; degrades to the setTimeout paths if Worker creation fails. */
  var _wk = null, _wkUrl = null, _wkTicks = 0;
  function startWorkerTicker() {
    if (_wk) return;
    try {
      _wkUrl = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},1500)'], { type: 'text/javascript' }));
      _wk = new Worker(_wkUrl);
      _wk.onmessage = function () {
        if (stopped) return;
        _wkTicks++;
        try { if (_wkTicks <= 40) ensureWrapped(); } catch (e) {}
        try { if (uiDirty || _wkTicks % 4 === 0) { uiDirty = false; uiFix(); } } catch (e) {}
        if (_wkTicks % 3 === 0) { try { pumpOnce(); } catch (e) {} }
      };
    } catch (e) { _wk = null; }
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
      [{ type: 'Office visit (2)', date: '2026-05-04', raw: 'Second same-day visit, distinct note text here.' }, false],
      [{ type: 'filled', date: '2026-06-25', raw: 'gabapentin 300 mg capsule; TAKE 1 CAPSULE BY MOUTH AT BEDTIME' }, true],
      [{ type: 'entered', date: '2026-06-19', raw: 'irbesartan; levothyroxine' }, true],
      [{ type: 'Service Dept.', date: '1959-10-22', raw: 'POSM CL West Chester' }, true]
    ];
    var fails = [];
    for (var i = 0; i < cases.length; i++) {
      if (isJunkVisit(cases[i][0]) !== cases[i][1]) fails.push(i);
    }
    /* v1.2.0: retag shape checks ride along */
    var rt = [
      [{ source: 'import', raw: 'Provider: Matthew Schaeffer, MD\nfluoro non sedation | 07-09-2026, Matthew Schaeffer, MD, Phys. Med. & Rehab.' }, true],
      [{ source: 'import', raw: 'order group | 07-02-2026, Matthew Schaeffer, MD' }, true],
      [{ source: 'athena-copy', raw: 'Provider: X\ny | 07-02-2026, Z' }, false],
      [{ source: 'import', raw: 'Pulled from Athena 6/25/2026 PROBLEMS: ...' }, false]
    ];
    for (var j = 0; j < rt.length; j++) {
      var v = rt[j][0];
      var would = (!S(v.source) || S(v.source) === 'import') && (RE_PANE_PROV.test(S(v.raw)) || RE_PANE_HEAD.test(S(v.raw)) || RE_PANE_HEAD.test(S(v.findings)));
      if (would !== rt[j][1]) fails.push('rt' + j);
    }
    return { pass: !fails.length, fails: fails, total: cases.length + rt.length };
  }

  /* ------------------------------- public -------------------------------- */
  var STATE = { blocked: 0, scrubbedOnWrite: 0, hydrated: 0, summarized: 0, summarizeErrors: 0, lastMigrate: null, lastRetag: null };
  function revert() {
    stopped = true;
    ['addVisit', 'derive', 'upsert', 'save'].forEach(function (k) {
      var w = wrapped[k];
      try { if (w && w.host && w.host[w.key] && w.host[w.key].__vfxWrapped) w.host[w.key] = w.orig; } catch (e) {}
      wrapped[k] = null;
    });
    try { clearInterval(ensureIv); } catch (e) {}
    try { if (_wk) _wk.terminate(); } catch (e) {}
    try { if (_wkUrl) URL.revokeObjectURL(_wkUrl); } catch (e) {}
    _wk = null; _wkUrl = null;
    try { var tl = document.getElementById('ptTimeline'); if (tl) { var rows = tl.querySelectorAll('.mls-tl-hist'); for (var i = 0; i < rows.length; i++) rows[i].style.display = ''; } } catch (e) {}
    window.__mlsVisitFix.installed = false;
  }

  window.__mlsVisitFix = {
    installed: true, version: VERSION,
    state: STATE, cfg: CFG,
    isJunkVisit: isJunkVisit, selfTest: selfTest,
    migrateNow: migrateNow, retagSources: retagSources, restore: restore,
    enqueue: enqueue, queue: function () { return Q.slice(); },
    uiFix: uiFix, _hydrate: hydrateFromPersisted,
    revert: revert
  };

  /* boot: wraps may race satellite load order - heartbeat like visits_honest
     (kept alongside the worker ticker for the visible-tab boot window) */
  var ticks = 0;
  var ensureIv = setInterval(function () { ensureWrapped(); if (++ticks > 60) clearInterval(ensureIv); }, 500);
  ensureWrapped();
  function boot() {
    ensureWrapped();
    try { var r = migrateNow(); if (r && (r.removed || r.patients)) console.log('[MLS visitfix] removed ' + r.removed + ' junk visit row(s) across ' + r.patients + ' patient(s) (stashed on _junkVisits).'); } catch (e) {}
    try { var rt = retagSources(); if (rt && rt.retagged) console.log('[MLS visitfix] retagged ' + rt.retagged + ' visits-pane row(s) across ' + rt.patients + ' patient(s) as From Athena (old value on _srcPrev).'); } catch (e) {}
    startWorkerTicker();
    setTimeout(loop, 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 1500);
})();
