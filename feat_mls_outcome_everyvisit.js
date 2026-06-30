/* ============================================================================
 * MLS — Outcome Study: pull EVERY visit per cohort patient -> full per-visit
 * longitudinal VAS pain + functional score series.
 * window.__mlsOutcomeEveryVisit   (append-only asset for mls-connect.staging.js)
 *
 * WHAT THIS ADDS
 *   For every patient already in the Outcome Study's cohort, this auto-fills the
 *   study's baseline + ALL follow-up timepoints from the patient's FULL athenaOne
 *   visit history — instead of relying only on a manually-typed spreadsheet.
 *
 * HOW IT REUSES THE EXISTING MACHINERY (no parallel system, no duplicate model)
 *   1) THE PULL  — it installs an Outcome-Study "chartReader" that drives the SAME
 *      copy-every-visit read the rest of the app uses:
 *          window.__mlsCopyVisits._driveRequest(
 *              'mlsAppReadAllVisits' -> 'mlsAppAllVisitsResult', …)
 *      which loops the FULL athenaOne visit set for one open patient, READ-ONLY
 *      (the identical transport behind window.__mlsCopyVisits.run() and
 *       window.__mlsCohortVisits). No second pull, no new bridge.
 *   2) THE MODEL — each returned visit is normalised through the ONE per-visit
 *      data model, window.__mlsVisitModel._normVisit(), so dates/text/scores are
 *      read exactly the way every other visit feature reads them.
 *   3) THE SCORES — the normalised per-visit text is handed to the study's OWN
 *      configurable extract knob, window.__mlsOutcome._extractVisits() (tuned by
 *      window.__mlsOutcomeCfg.extract), so VAS pain + functional short-form are
 *      pulled from wherever they actually live in the chart. A visit with no
 *      recorded score is left BLANK — never fabricated.
 *   4) THE TIMEPOINTS — the resulting per-visit {date, vas, shortForm} series is
 *      mapped to the study's timepoints by the study's OWN
 *      window.__mlsOutcome._buildPatientStudy(): visit 1 (DOS / earliest) = the
 *      baseline, each later visit -> its follow-up window, out-of-window visits
 *      retained as 'late'. Aggregation / chart / Excel / PDF then reflect ALL of
 *      these via the existing study pipeline (runAthena / fillBlanksFromAthena).
 *
 *   Because it works by supplying the study's existing chartReader, the existing
 *   "Read charts from Athena & build study" and "Fill blanks from Athena" actions
 *   now pull the full per-visit series. A clearly-labelled button is also added
 *   to the panel so the capability is discoverable. The manual spreadsheet /
 *   paste / demo paths are untouched and remain the fallback/override.
 *
 * GUARDRAILS
 *   - Additive + fully reversible: window.__mlsOutcomeEveryVisit.revert()
 *     (removes the button, restores the prior chartReader, stops the poller).
 *   - athenaOne READ-ONLY: only reuses the existing read transport. Never
 *     Save/Sign, never creates/edits/deletes any record, visit, or appointment.
 *   - Never fabricates a score: absent VAS/function stays blank.
 *   - Identity safety: when a DOB is available on both the local record and the
 *     chart, identity is re-verified via __mlsCopyVisits._verifyIdentity and a
 *     mismatched chart is SKIPPED (blank) rather than mis-attributed.
 *   - No body-subtree MutationObserver (scoped polling, like the existing
 *     Copy-every-visit bar). No PHI in logs.
 * ==========================================================================*/
(function () {
  'use strict';
  if (typeof window !== 'undefined' && window.__mlsOutcomeEveryVisit) return;

  var isFn = function (f) { return typeof f === 'function'; };
  var S = function (x) { return (x == null ? '' : String(x)); };
  var trim = function (x) { return S(x).trim(); };
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  /* ----- pure helpers (also exported for the offline node test harness) ----- */

  // Normalise ONE athena visit object into a dated, SINGLE-LINE block the study's
  // extract knob can parse. Prefers the shared visit model when present, falls
  // back to reading common fields directly (so this is testable under node).
  // The whole visit is kept on one line (no internal newline) so the study's own
  // visit-splitter — which breaks on newline-prefixed phrases like "office
  // visit" / "encounter date" — can never re-split one real visit and separate
  // its date from its scores. Visits are separated from each other (in
  // visitsToChartText) by the study's own "\n----\n" delimiter.
  function visitToBlock(v, model) {
    if (!v) return '';
    var nv = null;
    if (model && isFn(model._normVisit)) { nv = safe(function () { return model._normVisit(v, 'outcome-everyvisit'); }, null); }
    var date = nv ? nv.date : '';
    if (!date) {
      date = trim(v.date || v.serviceDate || v.dos || v.dateOfService || v.encounterDate || '');
    }
    if (!date) return '';
    var bodyParts = [];
    function add(x) { x = trim(x); if (x) bodyParts.push(x); }
    if (nv) {
      add(nv.type);
      add(nv.findings);
      add(nv.plan);
      add(nv.raw);
      if (nv.scores && typeof nv.scores === 'object') {
        Object.keys(nv.scores).forEach(function (k) { add(k + ': ' + nv.scores[k]); });
      }
    }
    // also fold in any raw text-bearing fields straight off the visit object so a
    // labelled score is never missed regardless of which field carried it
    ['raw', 'text', 'note', 'detail', 'summary', 'assessment', 'exam', 'findings',
     'plan', 'hpi', 'subjective', 'objective'].forEach(function (k) {
      if (v[k] != null) add(v[k]);
    });
    if (v.scores && typeof v.scores === 'object') {
      Object.keys(v.scores).forEach(function (k) { add(k + ': ' + v.scores[k]); });
    }
    var body = bodyParts.join('  ·  ').replace(/\s+/g, ' ');  // collapse ALL whitespace incl. newlines -> single line
    return 'Date of service: ' + date + (body ? '  ·  ' + body : '');
  }

  // Join every visit's dated block with the study's visit-split delimiter so the
  // study's _extractVisits() sees each visit as its own block.
  function visitsToChartText(visits, model) {
    var blocks = [];
    (visits || []).forEach(function (v) { var b = visitToBlock(v, model); if (b) blocks.push(b); });
    return blocks.length ? blocks.join('\n----\n') : '';
  }

  /* =========================== browser wiring =============================== */
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { visitToBlock: visitToBlock, visitsToChartText: visitsToChartText };
    }
    return;
  }

  var OUT = function () { return window.__mlsOutcome || null; };
  var MODEL = function () { return window.__mlsVisitModel || null; };
  var CV = function () { return window.__mlsCopyVisits || null; };

  var BTN_ID = 'ocRunEveryVisit';
  var STAT_ID = 'ocEveryVisitStat';
  var _timer = null;
  var _prevReaderSet = false;
  var _prevReader; // prior __mlsOutcomeCfg.chartReader, if any

  function norm(s) { return S(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  // find the local patient record for a cohort patient (only to obtain a DOB to verify against)
  function findRec(name) {
    return safe(function () {
      var arr = (isFn(window.getPatients) ? window.getPatients() : []) || [];
      var want = norm(name);
      if (!want) return null;
      var hit = arr.find(function (p) { return p && norm(p.name) === want; });
      if (hit) return hit;
      return arr.find(function (p) { if (!p) return false; var n = norm(p.name); return n && (n.indexOf(want) >= 0 || want.indexOf(n) >= 0); }) || null;
    }, null);
  }

  // drive the SAME copy-every-visit read for one patient (read-only)
  function readEveryVisit(hint, onStatus) {
    var cv = CV();
    if (cv && isFn(cv._driveRequest)) {
      return cv._driveRequest(
        'mlsAppReadAllVisits',
        { hint: hint || {} },
        'mlsAppAllVisitsResult',
        ['mlsAppVisitsProgress', 'mlsAppSearchProgress'],
        function (m) { if (m && onStatus) onStatus(m); },
        null, 180000, 6000
      );
    }
    return Promise.reject(new Error('Copy-every-visit transport not found (MLS Assist + a signed-in athenaOne tab are needed).'));
  }

  // The Outcome-Study chartReader: returns combined per-visit chart TEXT for one
  // patient, pulled via the copy-every-visit machinery. The study itself then
  // runs _extractVisits (the knob) + _buildPatientStudy (timepoint mapping).
  function everyVisitReader(p) {
    var rec = findRec(p && p.name);
    var hint = { name: p && p.name, dob: rec ? rec.dob : '' };
    return readEveryVisit(hint).then(function (res) {
      var visits = (res && (res.visits || res.result || [])) || [];
      // identity re-verify ONLY when a DOB exists on both sides — never mis-attribute
      var ident = (res && res.identity) || { name: res && res.name, dob: res && res.dob };
      var cv = CV();
      if (rec && rec.dob && ident && ident.dob && cv && isFn(cv._verifyIdentity)) {
        var vr = cv._verifyIdentity(rec, ident);
        if (!vr.ok) {
          var err = new Error('chart identity did not match name+DOB — skipped (nothing attributed)');
          err.__mlsSkip = 1;
          throw err;
        }
      }
      return visitsToChartText(visits, MODEL());
    });
  }
  everyVisitReader.__mlsEveryVisit = 1;

  // install our reader as the study's chartReader (idempotent, reversible)
  function installReader() {
    var cfg = window.__mlsOutcomeCfg = (window.__mlsOutcomeCfg || {});
    if (cfg.chartReader === everyVisitReader) return;
    if (!_prevReaderSet) { _prevReader = cfg.chartReader; _prevReaderSet = true; }
    cfg.chartReader = everyVisitReader;
  }
  function restoreReader() {
    var cfg = window.__mlsOutcomeCfg;
    if (cfg && cfg.chartReader === everyVisitReader) {
      if (_prevReaderSet && isFn(_prevReader)) cfg.chartReader = _prevReader;
      else { try { delete cfg.chartReader; } catch (e) { cfg.chartReader = undefined; } }
    }
    _prevReaderSet = false; _prevReader = undefined;
  }

  function status(box, msg, col) {
    var el = box.querySelector('#' + STAT_ID);
    if (!el) return;
    el.textContent = msg ? ('🗂 ' + msg) : '';
    if (col) el.style.color = col;
  }

  // trigger the study's OWN build over its cohort, using our installed reader.
  function trigger(box) {
    installReader();
    // Paste / inline cohort path -> full rebuild from every visit.
    var runBtn = box.querySelector('#ocRunAthena');
    if (runBtn) { status(box, 'Pulling every visit per patient (read-only)…'); runBtn.click(); return; }
    // Uploaded score-sheet path -> augment the sheet by filling blanks from every visit.
    var fillBtn = box.querySelector('#ocFillAthena');
    if (fillBtn) { status(box, 'Filling timepoints from every visit (read-only)…'); fillBtn.click(); return; }
    status(box, 'Load or paste a cohort first (Name + DOS), then pull every visit.', '#f5a623');
  }

  function ensureCss() {
    if (document.getElementById('mlsOcEvCss')) return;
    var s = document.createElement('style'); s.id = 'mlsOcEvCss';
    s.textContent =
      '#' + BTN_ID + '{background:linear-gradient(135deg,#4f46e5,#7c3aed);border:0;color:#fff;' +
      'padding:8px 12px;border-radius:9px;cursor:pointer;font-size:12.5px;font-weight:700;margin-left:6px}' +
      '#' + BTN_ID + ':hover{filter:brightness(1.06)}' +
      '#' + STAT_ID + '{font-size:11.5px;opacity:.85;margin-top:6px}';
    (document.head || document.documentElement).appendChild(s);
  }

  // inject the labelled button next to the existing Athena actions (no duplicate pipeline)
  function ensureButton() {
    var box = document.getElementById('mlsStudyOv') || document.querySelector('.mls-study-card') || document;
    if (!box || !box.querySelector) return;
    var anchor = box.querySelector('#ocRunAthena') || box.querySelector('#ocFillAthena');
    if (!anchor) return;                       // panel/cohort not in an Athena-capable state yet
    if (box.querySelector('#' + BTN_ID)) return; // already injected
    ensureCss();
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '🗂 Pull EVERY visit & build full series';
    btn.title = 'Read every athenaOne visit per cohort patient (read-only) and auto-fill baseline + all follow-up timepoints from the full visit history.';
    btn.addEventListener('click', function () { try { trigger(box); } catch (e) {} });
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    if (!box.querySelector('#' + STAT_ID)) {
      var st = document.createElement('div'); st.id = STAT_ID;
      (anchor.parentNode).insertBefore(st, btn.nextSibling);
    }
  }

  function start() {
    if (_timer) return;
    installReader();
    _timer = setInterval(function () { try { ensureButton(); } catch (e) {} }, 900);
    try { ensureButton(); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.__mlsOutcomeEveryVisit = {
    _visitToBlock: visitToBlock,
    _visitsToChartText: visitsToChartText,
    _reader: everyVisitReader,
    _readEveryVisit: readEveryVisit,
    install: installReader,
    revert: function () {
      try { if (_timer) { clearInterval(_timer); _timer = null; } } catch (e) {}
      try { restoreReader(); } catch (e) {}
      try { var b = document.getElementById(BTN_ID); if (b) b.remove(); } catch (e) {}
      try { var s = document.getElementById(STAT_ID); if (s) s.remove(); } catch (e) {}
      try { var c = document.getElementById('mlsOcEvCss'); if (c) c.remove(); } catch (e) {}
      try { delete window.__mlsOutcomeEveryVisit; } catch (e) { window.__mlsOutcomeEveryVisit = undefined; }
    }
  };
})();
