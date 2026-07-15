/* ============================================================================
 * MLS — Injection/procedure cohort: capture EACH matching visit per patient
 * window.__mlsCohortVisits  (append-only asset for mls-connect.js)
 *
 * Enhances the §39 find-by-procedure/injection cohort grab so that, for EACH
 * matched + imported patient, EACH INDIVIDUAL VISIT where that vaccine/injection
 * was given is captured as its OWN AI-converted per-visit entry in the patient's
 * visits[] — instead of a single flattened history snapshot. Each captured visit
 * is run through AI at pull time (same comprehensive per-visit summary as §40).
 *
 * It does this by reversibly wrapping window.__mlsStudy._importRow (the per-patient
 * verify+import step the grab already calls). After the ORIGINAL import resolves
 * with a verified name+DOB match, this module:
 *   1) drives the §40 per-visit walker (mlsAppReadAllVisits) on that patient's
 *      now-open athenaOne chart (read-only; the same DOM-grab path, no Athena API),
 *   2) keeps the visits that MATCH the cohort's CPT/procedure,
 *   3) saves each matching visit as its own entry in the SAME §40 model, and
 *   4) generates a comprehensive AI summary per captured visit.
 * If the walker is unavailable or returns nothing (e.g. an older extension, or
 * selectors not yet tuned to this athenaOne layout), it FALLS BACK to synthesizing
 * a per-matching-visit entry from the harvested cohort row itself (its service
 * date + CPT + procedure), so PART B always yields a real per-matching-visit
 * record and upgrades to full detail once the walker is confirmed live.
 *
 * Strict name+DOB verification is preserved (the wrapped _importRow already gates
 * it, and we re-verify before saving). Read-only in athenaOne — never Save/Sign.
 * Self-contained: own IIFE, try/catch throughout, reversible (restoring the
 * original _importRow fully reverts). Does NOT fork the model.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__mlsCohortVisits) return;

  var isFn = function (f) { return typeof f === 'function'; };
  var S = function (x) { return (x == null ? '' : String(x)); };
  var trim = function (x) { return S(x).trim(); };
  var M = function () { return window.__mlsVisitModel || null; };
  var CV = function () { return window.__mlsCopyVisits || null; };
  var ST = function () { return window.__mlsStudy || null; };

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  /* ---------- live progress surface inside the grab output ---------- */
  function statusEl() {
    var host = document.getElementById('mlsGrabOut') || document.getElementById('mlsGrabImpSum');
    if (!host) return null;
    var el = document.getElementById('mlsCohortVisitStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mlsCohortVisitStatus';
      el.style.cssText = 'font-size:12px;opacity:.85;margin:8px 0 0;line-height:1.45;color:var(--muted,#475569)';
      host.appendChild(el);
    }
    return el;
  }
  function say(msg) { var el = statusEl(); if (el && msg) el.textContent = '🗂 ' + msg; }

  var cohortRequestSeq = 0;
  function nextCohortRequestId() {
    cohortRequestSeq = (cohortRequestSeq + 1) % 1000000;
    return ('mlscohort-' + Date.now().toString(36) + '-' + cohortRequestSeq.toString(36) + '-' + Math.floor(Math.random() * 0x100000000).toString(36)).slice(0, 100);
  }
  function responseRequestId(d) {
    if (!d || typeof d !== 'object') return '';
    return String(d.requestId || d.id || (d.resp && (d.resp.requestId || d.resp.id)) || '').slice(0, 100);
  }

  /* ---------- bridge: read every visit for the OPEN athena chart ----------
     Reuse __mlsCopyVisits._driveRequest so we inherit the §42 source:'mls-app'
     handshake fix and the live, event-driven progress. Falls back to its own
     minimal poster if that export is ever absent. ------------------------- */
  function readAllVisits(hint, onStatus) {
    var cv = CV();
    if (cv && isFn(cv._driveRequest)) {
      return cv._driveRequest(
        'mlsAppReadAllVisits',
        { hint: hint || {}, managed: true, background: true, initiator: 'batch' },
        'mlsAppAllVisitsResult',
        ['mlsAppVisitsProgress', 'mlsAppSearchProgress'],
        function (m) { if (m && onStatus) onStatus(m); },
        null, 180000, 6000
      );
    }
    // minimal fallback poster (still uses source:'mls-app' — never regress §42)
    return new Promise(function (resolve, reject) {
      var requestId = nextCohortRequestId();
      var done = false, engaged = false, eng = null, lng = null;
      function fin(fn, a) { if (done) return; done = true; window.removeEventListener('message', on); if (eng) clearTimeout(eng); if (lng) clearTimeout(lng); fn(a); }
      function on(ev) {
        var d = ev.data; if (!d || !d.type) return;
        if (d.source !== 'mls-ext' || responseRequestId(d) !== requestId) return;
        if (d.type === 'mlsAppVisitsProgress' || d.type === 'mlsAppSearchProgress') { engaged = true; if (lng) { clearTimeout(lng); } lng = setTimeout(function () { fin(reject, new Error('timeout')); }, 180000); if (onStatus) onStatus(d.message || d.status || d.text || ''); return; }
        if (d.type === 'mlsAppAllVisitsResult') { if (d.ok === false || d.error) fin(reject, new Error(d.error || 'ext-error')); else fin(resolve, d); }
      }
      window.addEventListener('message', on);
      safe(function () { window.postMessage({ type: 'mlsAppReadAllVisits', source: 'mls-app', from: 'mls-app', id: requestId, requestId: requestId, hint: hint || {}, managed: true, background: true, initiator: 'batch' }, '*'); });
      eng = setTimeout(function () { if (!engaged) fin(reject, new Error('no-ext')); }, 6000);
    });
  }

  /* ---------- decide whether a visit matches the cohort ---------- */
  function codeSet(arr) { var s = {}; (arr || []).forEach(function (c) { c = trim(c).toUpperCase(); if (c) s[c] = 1; }); return s; }
  function visitMatchesCohort(v, cohort) {
    if (!v) return false;
    var wantCpt = cohort.codes || [];
    var vcpt = v.cpt || [];
    if (wantCpt.length && vcpt.length) {
      var want = codeSet(wantCpt);
      for (var i = 0; i < vcpt.length; i++) { if (want[trim(vcpt[i]).toUpperCase()]) return true; }
    }
    // keyword / procedure-name match against type + raw
    var hay = (trim(v.type) + ' ' + trim(v.raw)).toLowerCase();
    var kws = cohort.keywords || [];
    for (var k = 0; k < kws.length; k++) { var w = trim(kws[k]).toLowerCase(); if (w && w.length > 2 && hay.indexOf(w) >= 0) return true; }
    if (cohort.procName) { var pn = trim(cohort.procName).toLowerCase(); if (pn.length > 2 && hay.indexOf(pn) >= 0) return true; }
    // date match against the harvested row's service date
    if (cohort.svcYmd) { var mod = M(); var vd = mod ? mod._svcToYMD(v.date) : trim(v.date); if (vd && vd === cohort.svcYmd) return true; }
    return false;
  }

  /* ---------- synthesize a per-matching-visit entry from the harvested row ---------- */
  function rowToVisit(row, cohort) {
    var mod = M();
    var date = (mod ? mod._svcToYMD(row.svc) : '') || trim(row.svc);
    var lines = [];
    lines.push('Matched cohort visit (from athenaOne procedure search).');
    if (row.name) lines.push('Patient: ' + row.name + (row.dob ? ' (DOB ' + row.dob + ')' : ''));
    if (date) lines.push('Service date: ' + date);
    if (cohort.procName || cohort.label) lines.push('Procedure: ' + (cohort.procName || cohort.label));
    var codes = (row.codes && row.codes.length) ? row.codes : (cohort.codes || []);
    if (codes.length) lines.push('CPT: ' + codes.join(', '));
    if (row.line) lines.push('Source row: ' + row.line);
    return {
      date: date,
      type: (cohort.procName || cohort.label || 'Procedure'),
      cpt: codes.slice ? codes.slice() : codes,
      icd10: [],
      meds: [],
      findings: '',
      scores: {},
      plan: '',
      raw: lines.join('\n'),
      source: 'cohort-injection'
    };
  }

  /* ---------- capture every matching visit for one imported patient ---------- */
  function capturePatient(patientId, identity, row, cohort) {
    var mod = M(); if (!mod) return Promise.resolve(0);
    var p = safe(function () { return (window.getPatients() || []).find(function (x) { return x && x.id === patientId; }); }, null);
    if (!p) return Promise.resolve(0);
    var name = (identity && identity.name) || row.name || p.name;
    say('Capturing each matching visit for ' + name + '…');

    return readAllVisits({ name: p.name, dob: p.dob }, function (m) { if (m) say(m); }).then(function (res) {
      var all = (res && (res.visits || res.result || [])) || [];
      // re-verify identity (name+DOB) before saving anything from the chart read
      var ident = (res && res.identity) || { name: res && res.name, dob: res && res.dob };
      var cv = CV();
      var ok = true;
      if (cv && isFn(cv._verifyIdentity) && (ident.name || ident.dob)) {
        var vr = cv._verifyIdentity(p, ident);
        ok = !!vr.ok;
      }
      if (!ok) { say('Safety stop for ' + name + ' — chart identity did not match; nothing saved from the chart read.'); return saveFallback(p, row, cohort); }

      var matched = all.filter(function (v) { return visitMatchesCohort(mod._normVisit(v, 'cohort-injection'), cohort); });
      if (!matched.length) {
        // walker worked but found no clearly-matching encounter -> keep the row-level matching visit
        return saveFallback(p, row, cohort);
      }
      var saved = 0;
      matched.forEach(function (v, i) {
        var stored = mod.addVisit(p.id, v, { source: 'cohort-injection' });
        if (stored) { saved++; say('Saved matching visit ' + (stored.date || (i + 1)) + ' for ' + name + ' (' + (i + 1) + ' of ' + matched.length + ')…'); }
      });
      return summarize(p, saved, name);
    }, function () {
      // walker unavailable / timed out / selectors not tuned -> robust row fallback
      say('Per-visit walker not available for ' + name + ' — saving the matched visit from the cohort row.');
      return saveFallback(p, row, cohort);
    });
  }

  function saveFallback(p, row, cohort) {
    var mod = M(); if (!mod) return Promise.resolve(0);
    var v = rowToVisit(row, cohort);
    var stored = mod.addVisit(p.id, v, { source: 'cohort-injection' });
    return summarize(p, stored ? 1 : 0, p.name);
  }

  function summarize(p, saved, name) {
    var mod = M();
    if (!saved || !mod) return Promise.resolve(saved || 0);
    say('Generating AI summaries for ' + name + '…');
    return mod.ensureSummaries(p.id, function (m) { say(m); }).then(function () {
      try { if (window.__mlsVisitUI && isFn(window.__mlsVisitUI.render)) window.__mlsVisitUI.render(true); } catch (e) {}
      return saved;
    }, function () { return saved; });
  }

  /* ---------- read the active cohort criteria from the live Study DOM ---------- */
  function resolveCohort(row) {
    var st = ST();
    var codes = [], keywords = [], procName = '', label = '';
    if (st && isFn(st._resolveCriteria)) {
      var sel = safe(function () { return document.querySelector('#mlsStudyBSel').value; }, '');
      var proc = safe(function () { return document.querySelector('#mlsStudyBProc').value; }, '');
      var crit = safe(function () { return st._resolveCriteria(sel, proc); }, null) || {};
      codes = crit.codes || [];
      keywords = crit.keywords || [];
      procName = trim(proc) || trim(crit.label);
      label = trim(crit.label);
    }
    // union the row's own CPTs (each row encodes a specific matching encounter)
    var rowCodes = (row && row.codes) || [];
    var set = codeSet(codes.concat(rowCodes));
    var mod = M();
    return {
      codes: Object.keys(set),
      keywords: keywords,
      procName: procName,
      label: label,
      svcYmd: (mod && row) ? (mod._svcToYMD(row.svc) || '') : ''
    };
  }

  /* ---------- sequential queue so we never drive Athena for two patients at once ---------- */
  var _queue = Promise.resolve();
  function enqueue(task) { _queue = _queue.then(function () { return safe(task, Promise.resolve()) || Promise.resolve(); }).catch(function () {}); return _queue; }

  /* ---------- reversibly wrap __mlsStudy._importRow ---------- */
  function wrapImportRow() {
    var st = ST();
    if (!st || !isFn(st._importRow)) return false;
    if (st._importRow.__mlsCohortWrapped) return true;
    var orig = st._importRow;
    var wrapped = function (row, cohortName) {
      var ret = orig.apply(this, arguments);
      return Promise.resolve(ret).then(function (res) {
        try {
          res = res || {};
          if (res.status === 'match' && res.patientId) {
            var cohort = resolveCohort(row);
            var identity = { name: res.chartName || row.name, dob: res.chartDob || row.dob };
            // fire-and-forget, sequentialized; does NOT delay the grab's own flow/counts
            enqueue(function () { return capturePatient(res.patientId, identity, row, cohort); });
          }
        } catch (e) {}
        return res;   // hand the ORIGINAL result back unchanged -> grab behaves exactly as before
      });
    };
    wrapped.__mlsCohortWrapped = true;
    try { wrapped.__mlsOrig = orig; } catch (e) {}
    st._importRow = wrapped;
    return true;
  }

  // __mlsStudy may load after us; keep trying.
  if (!wrapImportRow()) {
    var n = 0;
    var iv = setInterval(function () { if (wrapImportRow() || ++n > 80) clearInterval(iv); }, 500);
  }

  window.__mlsCohortVisits = {
    _wrapImportRow: wrapImportRow,
    _visitMatchesCohort: visitMatchesCohort,
    _rowToVisit: rowToVisit,
    _resolveCohort: resolveCohort,
    _capturePatient: capturePatient,
    _readAllVisits: readAllVisits,
    _saveFallback: saveFallback
  };
})();
