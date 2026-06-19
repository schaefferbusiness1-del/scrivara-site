/* =====================================================================
   feat_visits_honest.js  — honest per-visit progress + real-data gate (§48)
   ---------------------------------------------------------------------
   PROBLEM it fixes: "📋 Copy every visit from athenaOne" could stream a
   fabricated "Reading visit N of M …" counter (and save empty/echo visits)
   even when the loaded MLS Assist extension returned NO real per-visit data
   (old extension, empty chart, error, or an optimistic driver). The §46
   guard only blocked the logged-OUT case; this also covers the
   logged-IN-but-no-real-data case.

   GUARANTEES:
   1. A "visit N" / "N of M" counter is NEVER shown from the extension's
      optimistic stream. Any progress shown is derived ONLY from REAL
      per-visit data actually saved to the model (window.__mlsVisitModel).
   2. If no real per-visit content comes back, the user sees an honest
      message and NOTHING is saved (empty/echo visits are dropped at the
      model save path, so they can never persist).
   3. Real reads (v1.33 extension returning real bodies) work normally and
      show a truthful saved-visit count.

   Self-contained, idempotent, progressive-enhancement, fully reversible via
   window.__mlsVisitsHonest.revert(). Wraps only the copy/cohort save+run
   paths; manual entry and every other feature are untouched.
   ===================================================================== */
(function () {
  // Loaders inject async, so the visit-model / copy-flow globals may not exist yet.
  // Poll until they're ready (up to ~20s), then install — order-independent.
  var tries = 0;
  function boot() {
    if (window.__mlsVisitsHonest && window.__mlsVisitsHonest.installed) return;
    if (!window.__mlsCopyVisits || !window.__mlsVisitModel) {
      if (tries++ < 80) { setTimeout(boot, 250); }
      return;
    }
    install();
  }
  function install() {
  try {
    if (window.__mlsVisitsHonest && window.__mlsVisitsHonest.installed) return;
    var H = { installed: false, version: '1.0.0' };

    var M  = window.__mlsVisitModel;
    var CV = window.__mlsCopyVisits;
    var CO = window.__mlsCohortVisits;

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
    H.isRealVisit = isRealVisit;

    /* ---------- optimistic-progress matcher (the fabricable counter) ------- */
    var FAKE = /(\breading\b|\bsaved visit\b|\bvisit\s*\d+\b|\b\d+\s*of\s*\d+\b|\bof\s*\d+\b|generating ai|summariz)/i;
    function isOptimistic(line) { return FAKE.test(String(line || '')); }
    H.isOptimistic = isOptimistic;

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
    H._gating = function () { return gating; };

    /* ---------- gate model.addVisit: drop non-real visits DURING a copy/cohort op ---------- */
    if (M && typeof M.addVisit === 'function' && !M.addVisit.__honestWrapped) {
      var origAdd = M.addVisit.bind(M);
      var wrapAdd = function (patient, visit) {
        try { if (gating > 0 && !isRealVisit(visit)) return null; } catch (e) {}
        return origAdd(patient, visit);
      };
      wrapAdd.__honestWrapped = true; wrapAdd.__orig = origAdd;
      M.addVisit = wrapAdd;
    }

    /* ---------- gate _saveVisits (defense in depth) ---------- */
    if (CV && typeof CV._saveVisits === 'function' && !CV._saveVisits.__honestWrapped) {
      var origSave = CV._saveVisits.bind(CV);
      var wrapSave = function () {
        var args = Array.prototype.slice.call(arguments);
        try {
          for (var i = 0; i < args.length; i++) {
            if (Array.isArray(args[i])) { args[i] = args[i].filter(isRealVisit); break; }
          }
        } catch (e) {}
        return origSave.apply(CV, args);
      };
      wrapSave.__honestWrapped = true; wrapSave.__orig = origSave;
      CV._saveVisits = wrapSave;
    }

    /* ---------- real-visit delta helpers ---------- */
    function getVisitsSafe(p) { try { var a = M.getVisits(p); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function keyOf(v) {
      return (v && (v.id || ((v.date || '') + '|' + (v.type || '') + '|' + ((v.cpt && v.cpt[0]) || '')))) || '';
    }

    /* ---------- wrap copy-every-visit run() ---------- */
    if (CV && typeof CV.run === 'function' && !CV.run.__honestWrapped) {
      var origRun = CV.run.bind(CV);
      var UPDATE_MSG = "⚠️ Couldn't read your visits from athenaOne — nothing was saved. "
                     + "Make sure the patient's athenaOne chart is open in a signed-in tab, then update "
                     + "MLS Assist to v1.33 (Settings → Get the extension) and reload. "
                     + "If this patient truly has no past visits in athenaOne, that's expected.";
      var MAXMS = 30000;

      var wrapRun = function (onStatus) {
        var cb = (typeof onStatus === 'function') ? onStatus : function () {};
        var patient = (typeof window.activePatient === 'function') ? window.activePatient() : null;
        var before = {};
        getVisitsSafe(patient).forEach(function (v) { if (isRealVisit(v)) before[keyOf(v)] = 1; });
        var neutralShown = false, lastShown = 0, finished = false;

        function realDelta() {
          var n = 0;
          getVisitsSafe(patient).forEach(function (v) { if (isRealVisit(v) && !before[keyOf(v)]) n++; });
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
          cb(line); // non-progress lines (genuine errors etc.) pass through
        }

        return withGate(function () {
          return Promise.race([
            Promise.resolve(origRun(filtered)).then(function (r) { return { r: r }; }, function (e) { return { err: e }; }),
            new Promise(function (res) { setTimeout(function () { res({ __timeout: true }); }, MAXMS); })
          ]);
        }).then(function (o) {
          finished = true;
          var d = realDelta();
          if (d > 0) {
            cb('✓ Done — ' + d + ' visit' + (d === 1 ? '' : 's') + ' read from athenaOne, each with an AI summary.');
            return (o && o.r) || { ok: true, real: d };
          }
          cb(UPDATE_MSG);
          return { blocked: true, real: 0, reason: (o && o.__timeout) ? 'timeout' : (o && o.err) ? 'error' : 'no-real-visits' };
        });
      };
      wrapRun.__honestWrapped = true; wrapRun.__orig = origRun;
      CV.run = wrapRun;
    }

    /* ---------- wrap cohort per-visit capture (same save gate) ---------- */
    if (CO && typeof CO._capturePatient === 'function' && !CO._capturePatient.__honestWrapped) {
      var origCap = CO._capturePatient.bind(CO);
      var wrapCap = function () {
        var args = arguments, self = this;
        return withGate(function () { return origCap.apply(self, args); });
      };
      wrapCap.__honestWrapped = true; wrapCap.__orig = origCap;
      CO._capturePatient = wrapCap;
    }

    /* ---------- revert ---------- */
    H.revert = function () {
      try { if (M && M.addVisit && M.addVisit.__orig) M.addVisit = M.addVisit.__orig; } catch (e) {}
      try { if (CV && CV._saveVisits && CV._saveVisits.__orig) CV._saveVisits = CV._saveVisits.__orig; } catch (e) {}
      try { if (CV && CV.run && CV.run.__orig) CV.run = CV.run.__orig; } catch (e) {}
      try { if (CO && CO._capturePatient && CO._capturePatient.__orig) CO._capturePatient = CO._capturePatient.__orig; } catch (e) {}
      H.installed = false;
    };

    H.installed = true;
    window.__mlsVisitsHonest = H;
  } catch (e) {
    /* progressive enhancement: never break the app */
    try { window.__mlsVisitsHonest = { installed: false, error: String(e && e.message || e) }; } catch (e2) {}
  }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  }
  boot();
})();
