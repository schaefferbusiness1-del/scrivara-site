/* =====================================================================
   feat_visits_honest.js  — honest per-visit progress + real-data gate (§48)
   v1.1.2
   ---------------------------------------------------------------------
   PROBLEM it fixes: "📋 Copy every visit from athenaOne" (and the cohort
   per-visit capture) could stream a fabricated "Reading visit N of M …"
   counter and save empty/echo visits even when the loaded MLS Assist
   extension returned NO real per-visit data (old extension, empty chart,
   error, or an optimistic driver). The §46 guard only blocked the
   logged-OUT case; this also covers the logged-IN-but-no-real-data case.

   GUARANTEES:
   1. A "visit N" / "N of M" counter is NEVER shown from the extension's
      optimistic stream. Any progress shown is derived ONLY from REAL
      per-visit data actually saved to the model (window.__mlsVisitModel).
   2. If no real per-visit content comes back, the user sees an honest
      message and NOTHING is saved (empty/echo visits are dropped at the
      model save path, so they can never persist).
   3. Real reads (v1.33 extension returning real bodies) work normally and
      show a truthful saved-visit count.

   Robust to load order: an ensureWrapped() heartbeat re-applies the wraps
   after other modules (e.g. the §46 guard, cohort module) load, so the
   run/cohort wrappers can't be shadowed and cohort is wrapped once ready.
   Self-contained, idempotent, fully reversible via
   window.__mlsVisitsHonest.revert(). Manual entry is never gated.
   ===================================================================== */
(function () {
  try {
    if (window.__mlsVisitsHonest && window.__mlsVisitsHonest._full) return;

    /* ---------- realness test (aiSummary is DERIVED, so excluded) ---------- */
    function realContent(v) {
      if (!v) return false;
      var t = (((v.raw || '') + ' ' + (v.findings || '') + ' ' + (v.plan || ''))
                .replace(/\s+/g, ' ').trim());
      var codes = ((v.cpt && v.cpt.length) || 0) + ((v.icd10 && v.icd10.length) || 0);
      var meds  = (v.meds && v.meds.length) || 0;
      var scores = false;
      if (v.scores && typeof v.scores === 'object') {
        for (var k in v.scores) {
          var x = v.scores[k];
          if (x != null && x !== '' && !(typeof x === 'number' && isNaN(x))) { scores = true; break; }
        }
      }
      return t.length > 1 || codes > 0 || meds > 0 || scores;
    }
    function isRealVisit(v) { return !!v && !!v.date && realContent(v); }

    /* ---------- optimistic-progress matcher (the fabricable counter) ------- */
    var FAKE = /(\breading\b|\bsaved visit\b|\bvisit\s*\d+\b|\b\d+\s*of\s*\d+\b|\bof\s*\d+\b|\b\d+\s+(?:visit|encounter|chart|note|record)s?\b|generating ai|summariz)/i;
    function isOptimistic(line) { return FAKE.test(String(line || '')); }
    var HONEST = /(sign(ed)?[\s-]?in|log[\s-]?in|couldn'?t|can'?t read|athena[Oo]ne|extension|update|not found|no .*(visit|encounter|chart)|empty|nothing was saved|open .*chart)/i;
    function isHonest(line) { return HONEST.test(String(line || '')); }

    /* ---------- operation-scoped save gate (auto-clears, never sticks) ----- */
    var gating = 0;
    function withGate(factory) {
      gating++;
      var cleared = false;
      function clear() { if (!cleared) { cleared = true; gating = Math.max(0, gating - 1); } }
      var safety = setTimeout(clear, 35000);
      var p;
      try { p = Promise.resolve(factory()); } catch (e) { p = Promise.reject(e); }
      return p.then(
        function (r) { clearTimeout(safety); clear(); return r; },
        function (e) { clearTimeout(safety); clear(); throw e; }
      );
    }

    function getVisitsSafe(M, p) { try { var a = M.getVisits(p); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function keyOf(v) {
      return (v && (v.id || ((v.date || '') + '|' + (v.type || '') + '|' + ((v.cpt && v.cpt[0]) || '')))) || '';
    }

    var UPDATE_MSG = "⚠️ Couldn't read your visits from athenaOne — nothing was saved. "
                   + "Make sure the patient's athenaOne chart is open in a signed-in tab, then update "
                   + "MLS Assist to v1.33 (Settings → Get the extension) and reload. "
                   + "If this patient truly has no past visits in athenaOne, that's expected.";
    var MAXMS = 90000; /* b84: the real per-encounter walk takes ~55-60s with the v1.54 tab-foreground read; 30s cut it off and falsely reported "nothing saved" while the save was still pending. */

    /* ---------- wrappers (each idempotent) ---------- */
    function wrapAddVisit(M) {
      if (!M || typeof M.addVisit !== 'function' || M.addVisit.__honestWrapped) return;
      var orig = M.addVisit.bind(M);
      var w = function (patient, visit) {
        try { if (gating > 0 && !isRealVisit(visit)) return null; } catch (e) {}
        return orig(patient, visit);
      };
      w.__honestWrapped = true; w.__orig = orig;
      M.addVisit = w;
    }
    function wrapSave(CV) {
      if (!CV || typeof CV._saveVisits !== 'function' || CV._saveVisits.__honestWrapped) return;
      var orig = CV._saveVisits.bind(CV);
      var w = function () {
        var args = Array.prototype.slice.call(arguments);
        try {
          for (var i = 0; i < args.length; i++) {
            if (Array.isArray(args[i])) { args[i] = args[i].filter(isRealVisit); break; }
          }
        } catch (e) {}
        return orig.apply(CV, args);
      };
      w.__honestWrapped = true; w.__orig = orig;
      CV._saveVisits = w;
    }
    function wrapRun(CV, M) {
      if (!CV || typeof CV.run !== 'function' || CV.run.__honestWrapped) return;
      var orig = CV.run.bind(CV);
      var w = function (onStatus) {
        var cb = (typeof onStatus === 'function') ? onStatus : function () {};
        var patient = (typeof window.activePatient === 'function') ? window.activePatient() : null;
        /* b85: track the patient by ID. saveVisits()/upsertPatient can REPLACE the patient
           object in the store, leaving this captured `patient` reference stale (its .visits
           still reads 0) even though the save landed — which made realDelta read 0 and falsely
           report "nothing was saved" after a successful pull. Re-resolve the live object by id. */
        var __pid = patient && patient.id;
        function __curP() { try { if (__pid && typeof window.getPatients === 'function') { var ps = window.getPatients() || []; for (var _i = 0; _i < ps.length; _i++) { if (ps[_i] && ps[_i].id === __pid) return ps[_i]; } } } catch (e) {} return patient; }
        var before = {};
        getVisitsSafe(M, __curP()).forEach(function (v) { if (isRealVisit(v)) before[keyOf(v)] = 1; });
        var neutralShown = false, lastShown = 0, finished = false, honestSeen = false;
        function realDelta() {
          var n = 0;
          getVisitsSafe(M, __curP()).forEach(function (v) { if (isRealVisit(v) && !before[keyOf(v)]) n++; });
          return n;
        }
        function filtered(line) {
          if (finished) return;
          if (isOptimistic(line)) {
            if (!neutralShown) { cb('🔍 Reading visits from athenaOne…'); neutralShown = true; }
            var d = realDelta();
            if (d > lastShown) { lastShown = d; cb('✓ Saved ' + d + ' real visit' + (d === 1 ? '' : 's') + ' from athenaOne so far…'); }
            return;
          }
          if (isHonest(line)) honestSeen = true;
          cb(line);
        }
        gating++;
        var gateCleared = false;
        function clearGate() { if (!gateCleared) { gateCleared = true; gating = Math.max(0, gating - 1); } }
        var gateSafety = setTimeout(clearGate, 90000);
        var realRun = Promise.resolve(orig(filtered)).then(function (r) { return { r: r }; }, function (e) { return { err: e }; });
        realRun.then(function () { clearTimeout(gateSafety); clearGate(); }, function () { clearTimeout(gateSafety); clearGate(); });
        return Promise.race([
          realRun,
          new Promise(function (res) { setTimeout(function () { res({ __timeout: true }); }, MAXMS); })
        ]).then(function (o) {
          finished = true;
          var d = realDelta();
          if (d > 0) {
            cb('✓ Done — ' + d + ' visit' + (d === 1 ? '' : 's') + ' read from athenaOne, each with an AI summary.');
            return (o && o.r) || { ok: true, real: d, saved: d };
          }
          if (!honestSeen) cb(UPDATE_MSG);
          return { blocked: true, real: 0, reason: (o && o.__timeout) ? 'timeout' : (o && o.err) ? 'error' : 'no-real-visits' };
        });
      };
      w.__honestWrapped = true; w.__orig = orig;
      CV.run = w;
    }
    function wrapCohort(CO) {
      if (!CO || typeof CO._capturePatient !== 'function' || CO._capturePatient.__honestWrapped) return;
      var orig = CO._capturePatient.bind(CO);
      var w = function () {
        var args = arguments, self = this;
        return withGate(function () { return orig.apply(self, args); });
      };
      w.__honestWrapped = true; w.__orig = orig;
      CO._capturePatient = w;
    }

    /* ---------- heartbeat: (re)apply wraps until everything settles ---------- */
    function ensureWrapped() {
      try {
        var M = window.__mlsVisitModel, CV = window.__mlsCopyVisits, CO = window.__mlsCohortVisits;
        wrapAddVisit(M);
        wrapSave(CV);
        if (CV && M) wrapRun(CV, M);
        wrapCohort(CO);
      } catch (e) {}
    }
    var ticks = 0;
    var iv = setInterval(function () { ensureWrapped(); if (++ticks > 60) clearInterval(iv); }, 500);
    ensureWrapped();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureWrapped);

    /* ---------- public surface + revert ---------- */
    window.__mlsVisitsHonest = {
      installed: true, _full: true, version: '1.1.2',
      isRealVisit: isRealVisit, isOptimistic: isOptimistic, ensureWrapped: ensureWrapped,
      _gating: function () { return gating; },
      revert: function () {
        try { clearInterval(iv); } catch (e) {}
        var M = window.__mlsVisitModel, CV = window.__mlsCopyVisits, CO = window.__mlsCohortVisits;
        try { if (M && M.addVisit && M.addVisit.__orig) M.addVisit = M.addVisit.__orig; } catch (e) {}
        try { if (CV && CV._saveVisits && CV._saveVisits.__orig) CV._saveVisits = CV._saveVisits.__orig; } catch (e) {}
        try { if (CV && CV.run && CV.run.__orig) CV.run = CV.run.__orig; } catch (e) {}
        try { if (CO && CO._capturePatient && CO._capturePatient.__orig) CO._capturePatient = CO._capturePatient.__orig; } catch (e) {}
        this.installed = false; this._full = false;
      }
    };
  } catch (e) {
    try { window.__mlsVisitsHonest = { installed: false, error: String(e && e.message || e) }; } catch (e2) {}
  }
})();
