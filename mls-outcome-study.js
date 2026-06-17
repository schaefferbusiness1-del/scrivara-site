/* ============================================================================
 * feat_outcome_study.js  —  MLS "Outcome Study" feature
 * ----------------------------------------------------------------------------
 * Clinical outcomes study from an uploaded patient spreadsheet (name + DOS).
 *   1. Upload Excel/CSV of patients  -> parse {name, dos}
 *   2. For each patient, read their Athena chart (read-only, via MLS Assist)
 *   3. Capture BASELINE  : VAS pain (0-10) + functional short-form (0-25)
 *                          from the DOS visit, or the office visit immediately
 *                          PRIOR to the procedure.
 *   4. Capture FOLLOW-UP : same two scores from each subsequent office visit,
 *                          bucketed to ~10d / 1mo / 2mo / 3mo post-procedure.
 *   5. AGGREGATE + ANALYZE: mean/median/SD/n at baseline and each window,
 *                          change-from-baseline, results summary + chart,
 *                          export to Excel / CSV.
 *
 * Self-contained IIFE, appended to the mls-connect.js bundle (same progressive-
 * enhancement pattern as every other module: own scope, try/catch throughout,
 * no monkey-patching, silent no-op if a global is missing).
 *
 * LAYERS (honest):
 *   - FULLY BUILT + offline-validated: spreadsheet parse, the per-patient study
 *     model, baseline/follow-up bucketing, aggregation/stats, the results UI +
 *     chart, and Excel/CSV export.
 *   - NEEDS LIVE-ATHENA TUNING (built configurable, defaults provided): the
 *     extraction of the VAS pain score and the functional short-form score from
 *     an Athena chart at a given visit date. Tunable via window.__mlsOutcomeCfg.
 *     READ-ONLY in Athena. Never Save/Sign.
 * ==========================================================================*/
;(function () {
  'use strict';

  var HAS_WIN = (typeof window !== 'undefined');
  var HAS_DOC = (typeof document !== 'undefined');

  /* ---------------------------------------------------------------------- *
   * 1. CONFIG  (field-finding for VAS + short-form is the live-tuning knob)
   * ---------------------------------------------------------------------- */
  var DEFAULT_CFG = {
    // --- spreadsheet column detection (case-insensitive substring match) ---
    nameHeaders: ['name', 'patient', 'patient name', 'pt name', 'pt'],
    dosHeaders : ['dos', 'date of service', 'procedure date', 'service date',
                  'proc date', 'date', 'visit date', 'surgery date'],

    // --- score-bearing-sheet ingest (the uploaded Excel IS the data source) -
    // Header detection for sheets that already contain the VAS + short-form
    // values at each timepoint.  Used by analyzeSheet/buildStudiesFromSheet.
    idHeaders        : ['patient name', 'patient id', 'patient', 'pt name', 'pt',
                        'name', 'mrn', 'medical record', 'record id', 'record',
                        'subject', 'study id', 'chart id', 'chart'],
    procHeaders      : ['date of service', 'procedure date', 'service date',
                        'proc date', 'surgery date', 'injection date',
                        'baseline date', 'index date', 'dos', 'procedure'],
    visitDateHeaders : ['visit date', 'encounter date', 'date of visit',
                        'date seen', 'seen on', 'appt date', 'appointment date',
                        'follow up date', 'visit dt'],
    timepointHeaders : ['timepoint', 'time point', 'interval', 'phase', 'period',
                        'stage', 'follow up', 'follow-up', 'followup',
                        'visit type', 'visit name', 'visit label'],

    // --- follow-up bucket windows (days post-procedure) -------------------
    // Each follow-up visit is assigned to the NEAREST target whose [min,max]
    // window contains its day-offset. Visits beyond the last window are "late"
    // (kept, but not counted in a study timepoint).
    windows: [
      { key: '10d', label: '~10 days', target: 10, min: 1,  max: 20  },
      { key: '1mo', label: '1 month',  target: 30, min: 21, max: 45  },
      { key: '2mo', label: '2 months', target: 60, min: 46, max: 75  },
      { key: '3mo', label: '3 months', target: 90, min: 76, max: 135 }
    ],
    // when >1 visit falls in a bucket: 'nearest' (to target) | 'first' | 'last'
    bucketPick: 'nearest',
    // how far before the DOS we still accept a visit as "baseline (prior)"
    baselineLookbackDays: 180,

    // --- score ranges / validation ---------------------------------------
    vasMin: 0, vasMax: 10,
    sfMin: 0,  sfMax: 25,
    // VAS pain: lower is better.  Short-form: set per the instrument used.
    shortFormHigherIsBetter: true,

    // --- ATHENA CHART EXTRACTION (THE LIVE-TUNING KNOBS) -----------------
    // The chart-read returns the chart's visible text (per visit / per page).
    // These patterns turn that text into per-visit {date, vas, shortForm}.
    // Tune the label words / regexes to where the scores actually live in his
    // athenaOne charts.  All matching is case-insensitive.
    extract: {
      // a "visit" / "encounter" / "office visit" date anchor in the chart text
      visitDateLabels: ['date of service', 'dos', 'encounter date', 'visit date',
                        'office visit', 'date:', 'seen on', 'service date'],
      // generic date forms accepted anywhere a date is expected
      dateRegexes: [
        '\\b(\\d{1,2})[\\/\\-](\\d{1,2})[\\/\\-](\\d{2,4})\\b',          // m/d/y
        '\\b(\\d{4})[\\/\\-](\\d{1,2})[\\/\\-](\\d{1,2})\\b',            // y/m/d
        '\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b'
      ],
      // VAS pain score (0-10). label words/phrases that precede the number.
      // Matching is space/punctuation tolerant; two-digit (10) wins over 1.
      vasLabels: ['vas pain', 'vas', 'pain score', 'pain scale', 'nprs',
                  'numeric pain', 'pain level', 'pain rating', 'pain 0-10',
                  'current pain'],
      // a number after a vas label, optionally "/10". longest-first alternation.
      vasValueRegex: '(10|[0-9])(?![0-9])(?:\\s*\\/\\s*10)?',
      // functional short-form score (0-25). label words/phrases.
      sfLabels: ['functional short form', 'functional short-form', 'short form',
                 'short-form', 'functional index', 'functional score',
                 'function score', 'sf score', 'oswestry short',
                 'disability index', 'function 0-25', 'sf'],
      sfValueRegex: '(2[0-5]|1[0-9]|[0-9])(?![0-9])(?:\\s*\\/\\s*25)?',
      // text that splits a multi-visit chart dump into per-visit blocks
      visitSplitRegexes: [
        '\\n\\s*(?:date of service|encounter date|office visit|visit date)\\b',
        '\\n-{3,}\\n', '\\n={3,}\\n'
      ]
    }
  };

  function cfg() {
    var c = JSON.parse(JSON.stringify(DEFAULT_CFG));
    try {
      var u = (HAS_WIN && window.__mlsOutcomeCfg) || null;
      if (u) deepMerge(c, u);
    } catch (e) {}
    return c;
  }
  function deepMerge(dst, src) {
    for (var k in src) {
      if (!src.hasOwnProperty(k)) continue;
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) &&
          dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) {
        deepMerge(dst[k], src[k]);
      } else { dst[k] = src[k]; }
    }
    return dst;
  }

  /* ---------------------------------------------------------------------- *
   * 2. DATE HELPERS
   * ---------------------------------------------------------------------- */
  var MS_DAY = 86400000;
  var MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

  // Parse many date shapes -> a UTC-midnight Date, or null.
  function parseDate(v) {
    if (v == null) return null;
    if (v instanceof Date && !isNaN(v)) return utcMid(v.getFullYear(), v.getMonth(), v.getDate());
    // Excel serial number (SheetJS may hand back a number)
    if (typeof v === 'number' && isFinite(v)) {
      if (v > 59 && v < 80000) { // plausible Excel serial (1900 system)
        var ms = Math.round((v - 25569) * MS_DAY);
        var d = new Date(ms);
        return utcMid(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
      return null;
    }
    var s = String(v).trim();
    if (!s) return null;
    var m;
    // ISO / y-m-d
    if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) {
      return utcMid(+m[1], +m[2] - 1, +m[3]);
    }
    // m/d/y or m-d-y
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) {
      var yr = +m[3]; if (yr < 100) yr += (yr < 70 ? 2000 : 1900);
      return utcMid(yr, +m[1] - 1, +m[2]);
    }
    // Mon DD, YYYY
    if ((m = s.match(/^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/i))) {
      var mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mo != null) return utcMid(+m[3], mo, +m[2]);
    }
    // DD Mon YYYY
    if ((m = s.match(/^(\d{1,2})\s+([a-z]{3,})\.?\s+(\d{4})/i))) {
      var mo2 = MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mo2 != null) return utcMid(+m[3], mo2, +m[1]);
    }
    var t = Date.parse(s);
    if (!isNaN(t)) { var dd = new Date(t); return utcMid(dd.getFullYear(), dd.getMonth(), dd.getDate()); }
    return null;
  }
  function utcMid(y, mo, d) { var x = new Date(Date.UTC(y, mo, d)); return isNaN(x) ? null : x; }
  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / MS_DAY); }
  function fmtISO(d) { return d ? d.toISOString().slice(0, 10) : ''; }

  /* ---------------------------------------------------------------------- *
   * 3. SPREADSHEET PARSE  (rows = array-of-arrays, e.g. from SheetJS sheet_to_json header:1)
   * ---------------------------------------------------------------------- */
  // Returns { patients:[{name,dos,dosDate,_row}], skipped:[{row,reason}], headerRow }
  function parseSpreadsheet(rows, c) {
    c = c || cfg();
    var out = { patients: [], skipped: [], headerRow: -1, nameCol: -1, dosCol: -1 };
    if (!rows || !rows.length) return out;

    // find the header row (first row whose cells match a name header AND a dos header)
    var hr = -1, nameCol = -1, dosCol = -1;
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var r = rows[i] || [];
      var nc = matchCol(r, c.nameHeaders), dc = matchCol(r, c.dosHeaders);
      if (nc !== -1 && dc !== -1) { hr = i; nameCol = nc; dosCol = dc; break; }
    }
    // fallback: no header found -> assume col0=name, col1=dos
    var startRow = 0;
    if (hr === -1) {
      nameCol = 0; dosCol = 1; startRow = 0;
      var first = rows[0] || [];
      if (parseDate(first[dosCol]) == null && String(first[nameCol] || '').trim()) {
        startRow = 1; // looks like a header line -> skip it
      }
    } else { startRow = hr + 1; }
    out.headerRow = hr; out.nameCol = nameCol; out.dosCol = dosCol;

    for (var j = startRow; j < rows.length; j++) {
      var row = rows[j] || [];
      var name = cleanStr(row[nameCol]);
      var dosRaw = row[dosCol];
      if (!name && (dosRaw == null || dosRaw === '')) continue; // blank line
      if (!name) { out.skipped.push({ row: j + 1, reason: 'no patient name' }); continue; }
      var dosDate = parseDate(dosRaw);
      if (!dosDate) { out.skipped.push({ row: j + 1, reason: 'unparseable DOS: "' + cleanStr(dosRaw) + '"' }); continue; }
      out.patients.push({ name: name, dos: fmtISO(dosDate), dosDate: dosDate, _row: j + 1 });
    }
    return out;
  }
  function matchCol(rowArr, headerList) {
    for (var i = 0; i < rowArr.length; i++) {
      var cell = String(rowArr[i] == null ? '' : rowArr[i]).trim().toLowerCase();
      if (!cell) continue;
      for (var h = 0; h < headerList.length; h++) {
        if (cell === headerList[h] || cell.indexOf(headerList[h]) !== -1) return i;
      }
    }
    return -1;
  }
  function cleanStr(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }

  /* ---------------------------------------------------------------------- *
   * 3b. SCORE-BEARING SHEET INGEST  (the uploaded Excel IS the data source)
   * ----------------------------------------------------------------------
   * Reads EVERY per-patient / per-timepoint VAS + short-form value straight
   * from the sheet — NO paste, NO demo, NO Athena required.  Two layouts are
   * auto-detected (and a manual column-mapper can override the detection):
   *   WIDE : one row per patient, columns like "VAS baseline", "SF 10d", …
   *   LONG : one row per visit  (patient, visit date|timepoint, pain, function)
   * ---------------------------------------------------------------------- */
  var TP_ORDER = ['baseline', '10d', '1mo', '2mo', '3mo'];

  function normHdr(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function hdrHas(norm, list) {
    for (var i = 0; i < (list || []).length; i++) {
      if (norm.indexOf(list[i]) !== -1) return true;
    }
    return false;
  }
  // a timepoint key from arbitrary text (header word OR a cell value), else null
  function detectTimepoint(s) {
    var t = ' ' + normHdr(s).replace(/-/g, ' ') + ' ';
    if (/\b(baseline|base|pre ?op|pre ?procedure|preop|initial|day ?0|d0|t0|visit ?0|month ?0)\b/.test(t)) return 'baseline';
    if (/\b(10 ?d|10 ?days?|day ?10|2 ?weeks?|2 ?wk|two ?weeks?)\b/.test(t)) return '10d';
    if (/\b(1 ?mo|1 ?months?|one ?month|month ?1|m1|30 ?d|30 ?days?|4 ?weeks?|4 ?wk)\b/.test(t)) return '1mo';
    if (/\b(2 ?mo|2 ?months?|two ?months?|month ?2|m2|60 ?d|60 ?days?|8 ?weeks?|8 ?wk)\b/.test(t)) return '2mo';
    if (/\b(3 ?mo|3 ?months?|three ?months?|month ?3|m3|90 ?d|90 ?days?|12 ?weeks?|12 ?wk)\b/.test(t)) return '3mo';
    return null;
  }
  // a metric from arbitrary text: 'vas' (pain) | 'sf' (function) | null
  function detectMetric(s) {
    var t = ' ' + normHdr(s).replace(/-/g, ' ') + ' ';
    if (/\b(short ?form|shortform|functional|function|disability|oswestry|odi|fsf|sf)\b/.test(t)) return 'sf';
    if (/\b(vas|pain|nprs|npr|soreness|ache)\b/.test(t)) return 'vas';
    return null;
  }
  // classify ONE header cell -> {role, metric, timepoint, header}
  function classifyColumn(headerCell, c) {
    c = c || cfg();
    var norm = normHdr(headerCell);
    var out = { role: 'ignore', metric: null, timepoint: null, header: cleanStr(headerCell) };
    if (!norm) return out;
    var metric = detectMetric(norm);
    var tp = detectTimepoint(norm);
    // a column whose VALUES are timepoint labels (explicitly a tp/visit-type col)
    if (!metric && hdrHas(norm, c.timepointHeaders)) { out.role = 'timepoint'; return out; }
    if (metric) { out.role = 'score'; out.metric = metric; out.timepoint = tp; return out; }
    if (hdrHas(norm, c.procHeaders)) { out.role = 'dos'; return out; }
    if (hdrHas(norm, c.visitDateHeaders)) { out.role = 'visitDate'; return out; }
    if (hdrHas(norm, c.idHeaders)) { out.role = 'id'; return out; }
    if (/\bdate\b/.test(norm)) { out.role = 'visitDate'; return out; }
    return out;
  }
  function applyCols(res, cols) {
    res.idCol = -1; res.dosCol = -1; res.visitDateCol = -1; res.timepointCol = -1;
    res.wideCols = []; res.bareMetricCols = { vas: -1, sf: -1 };
    cols.forEach(function (x, ci) {
      if (x.role === 'id') { if (res.idCol < 0) res.idCol = ci; }
      else if (x.role === 'dos') { if (res.dosCol < 0) res.dosCol = ci; }
      else if (x.role === 'visitDate') { if (res.visitDateCol < 0) res.visitDateCol = ci; }
      else if (x.role === 'timepoint') { if (res.timepointCol < 0) res.timepointCol = ci; }
      else if (x.role === 'score') {
        if (x.timepoint) res.wideCols.push({ col: ci, metric: x.metric, timepoint: x.timepoint });
        else if (x.metric === 'vas') { if (res.bareMetricCols.vas < 0) res.bareMetricCols.vas = ci; }
        else if (x.metric === 'sf') { if (res.bareMetricCols.sf < 0) res.bareMetricCols.sf = ci; }
      }
    });
    res.layout = res.wideCols.length ? 'wide'
      : (res.bareMetricCols.vas >= 0 || res.bareMetricCols.sf >= 0) ? 'long' : 'simple';
    return res;
  }
  // Inspect rows (array-of-arrays) and return a column analysis.
  function analyzeSheet(rows, c) {
    c = c || cfg();
    var res = { layout: 'simple', headerRow: -1, headers: [], cols: [],
                idCol: -1, dosCol: -1, visitDateCol: -1, timepointCol: -1,
                wideCols: [], bareMetricCols: { vas: -1, sf: -1 } };
    if (!rows || !rows.length) return res;
    var bestRow = -1, bestScore = -1, bestCols = null;
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var r = rows[i] || [];
      var cols = r.map(function (cell) { return classifyColumn(cell, c); });
      var nonIgnore = cols.filter(function (x) { return x.role !== 'ignore'; }).length;
      var hasId = cols.some(function (x) { return x.role === 'id'; });
      var hasSignal = cols.some(function (x) { return x.role === 'score' || x.role === 'dos' || x.role === 'visitDate'; });
      if (hasId && hasSignal && nonIgnore > bestScore) { bestScore = nonIgnore; bestRow = i; bestCols = cols; }
    }
    if (bestRow === -1) return res;
    res.headerRow = bestRow; res.headers = (rows[bestRow] || []).map(cleanStr); res.cols = bestCols;
    return applyCols(res, bestCols);
  }
  // Build an analysis from explicit per-column selection tokens (the mapper UI).
  // token forms: 'ignore' | 'id' | 'dos' | 'visitDate' | 'timepoint'
  //              | 'score:vas:baseline' … | 'bare:vas' | 'bare:sf'
  function buildAnalysisFromMapping(headerRow, headers, selections) {
    var cols = (selections || []).map(function (sel, ci) {
      var o = { role: 'ignore', metric: null, timepoint: null, header: headers ? headers[ci] : '' };
      if (!sel || sel === 'ignore') return o;
      if (sel === 'id' || sel === 'dos' || sel === 'visitDate' || sel === 'timepoint') { o.role = sel; return o; }
      var m = String(sel).split(':');
      if (m[0] === 'score') { o.role = 'score'; o.metric = m[1]; o.timepoint = m[2]; }
      else if (m[0] === 'bare') { o.role = 'score'; o.metric = m[1]; o.timepoint = null; }
      return o;
    });
    var res = { layout: 'simple', headerRow: headerRow, headers: headers || [], cols: cols };
    return applyCols(res, cols);
  }

  function readScore(cell, metric, c) {
    return metric === 'vas' ? normScore(cell, c.vasMin, c.vasMax)
                            : normScore(cell, c.sfMin, c.sfMax);
  }
  function winByKey(c, key) {
    for (var i = 0; i < c.windows.length; i++) if (c.windows[i].key === key) return c.windows[i];
    return null;
  }
  function emptyStudy(name, dosDate) {
    return { name: name, dos: dosDate ? fmtISO(dosDate) : '', baseline: null,
             followups: {}, late: [], notes: [] };
  }
  function putRec(study, tp, rec) {
    if (tp === 'baseline') study.baseline = pickBetter(study.baseline, rec);
    else study.followups[tp] = study.followups[tp] ? pickBetter(study.followups[tp], rec) : rec;
  }
  function rowHasAny(row) {
    for (var i = 0; i < (row || []).length; i++) { if (cleanStr(row[i]) !== '') return true; }
    return false;
  }
  // Turn an analyzed sheet directly into per-patient studies (same shape as
  // buildPatientStudy output) — zero paste, zero Athena.
  function buildStudiesFromSheet(rows, an, c) {
    c = c || cfg();
    var start = (an.headerRow == null ? -1 : an.headerRow) + 1;
    var studies = [], skipped = [], scoreCells = 0;

    if (an.layout === 'wide') {
      for (var j = start; j < rows.length; j++) {
        var row = rows[j] || [];
        var name = cleanStr(row[an.idCol]);
        if (!name) { if (rowHasAny(row)) skipped.push({ row: j + 1, reason: 'no patient name' }); continue; }
        var dosDate = an.dosCol >= 0 ? parseDate(row[an.dosCol]) : null;
        var st = emptyStudy(name, dosDate);
        var byTp = {};
        an.wideCols.forEach(function (wc) {
          var val = readScore(row[wc.col], wc.metric, c);
          if (val == null) return;
          var slot = byTp[wc.timepoint] || (byTp[wc.timepoint] = {});
          slot[wc.metric === 'vas' ? 'vas' : 'shortForm'] = val;
        });
        TP_ORDER.forEach(function (tp) {
          var d = byTp[tp];
          if (!d) return;
          var w = tp === 'baseline' ? null : winByKey(c, tp);
          var off = tp === 'baseline' ? 0 : (w ? w.target : 0);
          var date = dosDate ? fmtISO(new Date(dosDate.getTime() + off * MS_DAY)) : '';
          var rec = { date: date, offsetDays: off, bucket: tp,
                      vas: d.vas != null ? d.vas : null, shortForm: d.shortForm != null ? d.shortForm : null };
          if (rec.vas != null) scoreCells++;
          if (rec.shortForm != null) scoreCells++;
          putRec(st, tp, rec);
        });
        studies.push(st);
      }
    } else if (an.layout === 'long') {
      var groups = {}, order = [];
      for (var k = start; k < rows.length; k++) {
        var r = rows[k] || [];
        var nm = cleanStr(r[an.idCol]);
        if (!nm) { if (rowHasAny(r)) skipped.push({ row: k + 1, reason: 'no patient name' }); continue; }
        if (!groups[nm]) { groups[nm] = []; order.push(nm); }
        groups[nm].push(r);
      }
      order.forEach(function (nm) {
        var grp = groups[nm];
        var dosDate = null, a;
        if (an.dosCol >= 0) { for (a = 0; a < grp.length; a++) { var dd = parseDate(grp[a][an.dosCol]); if (dd) { dosDate = dd; break; } } }
        if (an.timepointCol >= 0) {
          // labeled long: each row carries its own timepoint label
          var st2 = emptyStudy(nm, dosDate);
          grp.forEach(function (r) {
            var tp = detectTimepoint(r[an.timepointCol]);
            if (!tp) return;
            var vd = an.visitDateCol >= 0 ? parseDate(r[an.visitDateCol]) : (an.dosCol >= 0 ? parseDate(r[an.dosCol]) : null);
            var vas = an.bareMetricCols.vas >= 0 ? readScore(r[an.bareMetricCols.vas], 'vas', c) : null;
            var sf = an.bareMetricCols.sf >= 0 ? readScore(r[an.bareMetricCols.sf], 'sf', c) : null;
            if (vas != null) scoreCells++;
            if (sf != null) scoreCells++;
            var w = tp === 'baseline' ? null : winByKey(c, tp);
            var off = tp === 'baseline' ? 0 : (w ? w.target : 0);
            putRec(st2, tp, { date: vd ? fmtISO(vd) : '', offsetDays: off, bucket: tp, vas: vas, shortForm: sf });
          });
          studies.push(st2);
        } else {
          // date-based long: pivot visit dates around DOS (or earliest visit)
          var visits = grp.map(function (r) {
            return {
              date: an.visitDateCol >= 0 ? parseDate(r[an.visitDateCol]) : (an.dosCol >= 0 ? parseDate(r[an.dosCol]) : null),
              vas: an.bareMetricCols.vas >= 0 ? readScore(r[an.bareMetricCols.vas], 'vas', c) : null,
              shortForm: an.bareMetricCols.sf >= 0 ? readScore(r[an.bareMetricCols.sf], 'sf', c) : null
            };
          }).filter(function (v) { return v.date; });
          visits.forEach(function (v) { if (v.vas != null) scoreCells++; if (v.shortForm != null) scoreCells++; });
          if (!dosDate && visits.length) {
            dosDate = visits.slice().sort(function (x, y) { return x.date - y.date; })[0].date;
          }
          studies.push(buildPatientStudy(nm, dosDate, visits, c));
        }
      });
    }
    return { studies: studies, skipped: skipped, scoreCells: scoreCells, layout: an.layout };
  }
  // Merge Athena-derived scores into existing studies, filling BLANKS ONLY.
  function fillBlanksInto(target, src, c) {
    function fill(dst, s) {
      if (!s) return dst;
      if (!dst) return { date: s.date, offsetDays: s.offsetDays, bucket: s.bucket, vas: s.vas, shortForm: s.shortForm };
      if (dst.vas == null && s.vas != null) dst.vas = s.vas;
      if (dst.shortForm == null && s.shortForm != null) dst.shortForm = s.shortForm;
      return dst;
    }
    target.baseline = fill(target.baseline, src.baseline);
    c.windows.forEach(function (w) { if (src.followups[w.key]) target.followups[w.key] = fill(target.followups[w.key], src.followups[w.key]); });
    return target;
  }

  /* ---------------------------------------------------------------------- *
   * 4. CHART TEXT -> per-visit {date, vas, shortForm}   (CONFIGURABLE)
   * ---------------------------------------------------------------------- */
  // Accepts either an array of visit objects [{date, vas, shortForm}] (already
  // structured), or a raw chart-text blob (the Assist chart-read output).
  function extractVisits(chartTextOrArray, c) {
    c = c || cfg();
    if (Array.isArray(chartTextOrArray)) {
      return chartTextOrArray.map(function (v) {
        return {
          date: parseDate(v.date),
          vas: normScore(v.vas, c.vasMin, c.vasMax),
          shortForm: normScore(v.shortForm != null ? v.shortForm : v.sf, c.sfMin, c.sfMax)
        };
      }).filter(function (v) { return v.date; });
    }
    var text = String(chartTextOrArray || '');
    if (!text.trim()) return [];
    var ex = c.extract;
    var blocks = splitVisits(text, ex);
    var visits = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var date = findVisitDate(b, ex);
      if (!date) continue;
      visits.push({
        date: date,
        vas: findLabeledScore(b, ex.vasLabels, ex.vasValueRegex, c.vasMin, c.vasMax),
        shortForm: findLabeledScore(b, ex.sfLabels, ex.sfValueRegex, c.sfMin, c.sfMax)
      });
    }
    // de-dupe by date (keep the block with the most data)
    var byDate = {};
    visits.forEach(function (v) {
      var k = fmtISO(v.date);
      if (!byDate[k]) { byDate[k] = v; return; }
      var cur = byDate[k], score = (v.vas != null) + (v.shortForm != null),
          have = (cur.vas != null) + (cur.shortForm != null);
      if (score > have) byDate[k] = v;
    });
    return Object.keys(byDate).map(function (k) { return byDate[k]; })
      .sort(function (a, b) { return a.date - b.date; });
  }
  function splitVisits(text, ex) {
    var positions = [0];
    (ex.visitSplitRegexes || []).forEach(function (rs) {
      var re = new RegExp(rs, 'gi'), m;
      while ((m = re.exec(text))) { positions.push(m.index); if (re.lastIndex === m.index) re.lastIndex++; }
    });
    positions = positions.filter(function (v, i, a) { return a.indexOf(v) === i; })
      .sort(function (a, b) { return a - b; });
    if (positions.length <= 1) return [text];
    var blocks = [];
    for (var i = 0; i < positions.length; i++) {
      blocks.push(text.slice(positions[i], positions[i + 1] == null ? text.length : positions[i + 1]));
    }
    return blocks;
  }
  function findVisitDate(block, ex) {
    var lower = block.toLowerCase();
    for (var i = 0; i < ex.visitDateLabels.length; i++) {
      var idx = lower.indexOf(ex.visitDateLabels[i]);
      if (idx !== -1) {
        var slice = block.slice(idx, idx + 60);
        var d = firstDate(slice, ex);
        if (d) return d;
      }
    }
    return firstDate(block, ex);
  }
  function firstDate(s, ex) {
    var best = null, bestIdx = Infinity;
    (ex.dateRegexes || []).forEach(function (rs) {
      var re = new RegExp(rs, 'gi'), m;
      while ((m = re.exec(s))) {
        if (m.index < bestIdx) {
          var d = parseDate(m[0]);
          if (d) { best = d; bestIdx = m.index; }
        }
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    });
    return best;
  }
  function findLabeledScore(block, labels, valRe, lo, hi) {
    for (var i = 0; i < labels.length; i++) {
      var re = buildLabelRegex(labels[i], valRe);
      if (!re) continue;
      var m = re.exec(block);
      if (m) {
        var n = normScore(+m[1], lo, hi);
        if (n != null) return n;
      }
    }
    return null;
  }
  // Build a tolerant regex: label tokens joined by any non-word glue, a word
  // boundary, then non-word glue, then the value pattern.  e.g. "sf score" ->
  //   \bsf[\W_]*score\b[\W_]*<value>
  function buildLabelRegex(label, valRe) {
    var toks = String(label).toLowerCase().match(/[a-z0-9]+/g);
    if (!toks || !toks.length) return null;
    var body = toks.map(escapeRegex).join('[\\W_]*');
    try { return new RegExp('\\b' + body + '\\b[\\W_]{0,4}' + valRe, 'i'); }
    catch (e) { return null; }
  }
  function escapeRegex(s) { return s.replace(/[.*+^${}()|[\]\\]/g, '\\$&'); }
  function normScore(v, lo, hi) {
    if (v == null || v === '') return null;
    var n = (typeof v === 'number') ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    if (!isFinite(n)) return null;
    if (n < lo || n > hi) return null;
    return n;
  }

  /* ---------------------------------------------------------------------- *
   * 5. BUILD PER-PATIENT STUDY (baseline + bucketed follow-ups)
   * ---------------------------------------------------------------------- */
  function buildPatientStudy(name, dosDate, visits, c) {
    c = c || cfg();
    visits = (visits || []).filter(function (v) { return v && v.date; })
      .sort(function (a, b) { return a.date - b.date; });

    var study = { name: name, dos: fmtISO(dosDate), baseline: null,
                  followups: {}, late: [], notes: [] };

    // baseline: DOS visit, else latest office visit <= DOS within lookback
    var dosVisit = null, prior = null;
    visits.forEach(function (v) {
      var d = daysBetween(dosDate, v.date);
      if (d === 0) dosVisit = pickBetter(dosVisit, v);
      else if (d < 0 && -d <= c.baselineLookbackDays) {
        if (!prior || v.date > prior.date) prior = v;
      }
    });
    if (dosVisit) { study.baseline = mark(dosVisit, 0, 'dos'); }
    else if (prior) { study.baseline = mark(prior, daysBetween(dosDate, prior.date), 'prior'); }

    // follow-ups: visits after DOS -> nearest window
    var post = visits.filter(function (v) { return daysBetween(dosDate, v.date) > 0; });
    post.forEach(function (v) {
      var off = daysBetween(dosDate, v.date);
      var w = assignWindow(off, c.windows);
      if (!w) { study.late.push(mark(v, off, 'late')); return; }
      var rec = mark(v, off, w.key);
      var cur = study.followups[w.key];
      if (!cur) { study.followups[w.key] = rec; return; }
      study.followups[w.key] = chooseBucket(cur, rec, w, c.bucketPick);
    });
    return study;
  }
  function pickBetter(a, b) {
    if (!a) return b; if (!b) return a;
    var sb = (b.vas != null) + (b.shortForm != null), sa = (a.vas != null) + (a.shortForm != null);
    return sb > sa ? b : a;
  }
  function mark(v, offset, bucket) {
    return { date: fmtISO(v.date), offsetDays: offset, bucket: bucket,
             vas: v.vas != null ? v.vas : null, shortForm: v.shortForm != null ? v.shortForm : null };
  }
  function assignWindow(offsetDays, windows) {
    var inWin = windows.filter(function (w) { return offsetDays >= w.min && offsetDays <= w.max; });
    if (!inWin.length) return null;
    inWin.sort(function (a, b) { return Math.abs(offsetDays - a.target) - Math.abs(offsetDays - b.target); });
    return inWin[0];
  }
  function chooseBucket(cur, rec, w, mode) {
    if (mode === 'first') return cur;
    if (mode === 'last') return rec;
    return Math.abs(rec.offsetDays - w.target) < Math.abs(cur.offsetDays - w.target) ? rec : cur;
  }

  /* ---------------------------------------------------------------------- *
   * 6. STATS + AGGREGATION
   * ---------------------------------------------------------------------- */
  function mean(arr) { if (!arr.length) return null; return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length; }
  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; }), n = s.length, mid = n >> 1;
    return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function sd(arr) {
    if (arr.length < 2) return null;
    var m = mean(arr);
    var v = arr.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (arr.length - 1);
    return Math.sqrt(v);
  }
  function round1(x) { return x == null ? null : Math.round(x * 10) / 10; }

  function aggregate(studies, c) {
    c = c || cfg();
    var timepoints = [{ key: 'baseline', label: 'Baseline' }].concat(
      c.windows.map(function (w) { return { key: w.key, label: w.label }; }));

    function valuesAt(tpKey, metric) {
      var vals = [];
      studies.forEach(function (s) {
        var rec = tpKey === 'baseline' ? s.baseline : s.followups[tpKey];
        if (rec && rec[metric] != null) vals.push(rec[metric]);
      });
      return vals;
    }
    function baselineVal(s, metric) { return s.baseline && s.baseline[metric] != null ? s.baseline[metric] : null; }

    function statBlock(metric) {
      return timepoints.map(function (tp) {
        var vals = valuesAt(tp.key, metric);
        var row = { key: tp.key, label: tp.label, n: vals.length,
                    mean: round1(mean(vals)), median: round1(median(vals)), sd: round1(sd(vals)) };
        if (tp.key !== 'baseline') {
          var deltas = [];
          studies.forEach(function (s) {
            var b = baselineVal(s, metric);
            var rec = s.followups[tp.key];
            if (b != null && rec && rec[metric] != null) deltas.push(rec[metric] - b);
          });
          row.nPaired = deltas.length;
          row.changeMean = round1(mean(deltas));
          row.changeMedian = round1(median(deltas));
        }
        return row;
      });
    }

    return {
      nPatients: studies.length,
      nWithBaselineVas: studies.filter(function (s) { return s.baseline && s.baseline.vas != null; }).length,
      nWithBaselineSf: studies.filter(function (s) { return s.baseline && s.baseline.shortForm != null; }).length,
      timepoints: timepoints,
      vas: statBlock('vas'),
      shortForm: statBlock('shortForm'),
      cfg: { vasMin: c.vasMin, vasMax: c.vasMax, sfMin: c.sfMin, sfMax: c.sfMax,
             shortFormHigherIsBetter: c.shortFormHigherIsBetter }
    };
  }

  function summarize(agg, c) {
    c = c || cfg();
    function bl(block) { for (var i = 0; i < block.length; i++) if (block[i].key === 'baseline') return block[i]; return block[0]; }
    function last(block) { for (var i = block.length - 1; i >= 0; i--) if (block[i].n > 0) return block[i]; return null; }
    var lines = [];
    lines.push(agg.nPatients + ' patient(s) in the study.');
    var vb = bl(agg.vas), vl = last(agg.vas);
    if (vb && vb.n) {
      var s = 'VAS pain: baseline mean ' + fmtN(vb.mean) + ' (n=' + vb.n + ')';
      if (vl && vl.key !== 'baseline' && vl.n) {
        s += '; at ' + vl.label + ' mean ' + fmtN(vl.mean) + ' (n=' + vl.n + '), ' +
             changeWord(vl.changeMean, true) + ' of ' + fmtN(absN(vl.changeMean)) + ' from baseline.';
      } else s += '.';
      lines.push(s);
    }
    var fb = bl(agg.shortForm), fl = last(agg.shortForm);
    if (fb && fb.n) {
      var s2 = 'Functional short-form: baseline mean ' + fmtN(fb.mean) + ' (n=' + fb.n + ')';
      if (fl && fl.key !== 'baseline' && fl.n) {
        s2 += '; at ' + fl.label + ' mean ' + fmtN(fl.mean) + ' (n=' + fl.n + '), ' +
              changeWord(fl.changeMean, !c.shortFormHigherIsBetter) + ' of ' + fmtN(absN(fl.changeMean)) + ' from baseline.';
      } else s2 += '.';
      lines.push(s2);
    }
    return lines.join(' ');
  }
  function fmtN(x) { return x == null ? '—' : String(x); }
  function absN(x) { return x == null ? null : Math.abs(x); }
  function changeWord(change, lowerIsBetter) {
    if (change == null) return 'no paired change';
    if (change === 0) return 'no change';
    var improved = lowerIsBetter ? (change < 0) : (change > 0);
    return improved ? 'an improvement' : 'a worsening';
  }

  /* ---------------------------------------------------------------------- *
   * 7. EXPORT (per-patient rows + aggregate summary)  -> CSV / XLSX
   * ---------------------------------------------------------------------- */
  function exportRows(studies, c) {
    c = c || cfg();
    var keys = c.windows.map(function (w) { return w.key; });
    var head = ['Patient', 'DOS', 'Baseline source', 'Baseline date',
                'Baseline VAS', 'Baseline ShortForm'];
    keys.forEach(function (k) {
      var lbl = c.windows.filter(function (w) { return w.key === k; })[0].label;
      head.push(lbl + ' date', lbl + ' day', lbl + ' VAS', lbl + ' ShortForm');
    });
    var rows = [head];
    studies.forEach(function (s) {
      var b = s.baseline || {};
      var r = [s.name, s.dos, b.bucket || '', b.date || '',
               b.vas != null ? b.vas : '', b.shortForm != null ? b.shortForm : ''];
      keys.forEach(function (k) {
        var f = s.followups[k];
        if (f) r.push(f.date, f.offsetDays, f.vas != null ? f.vas : '', f.shortForm != null ? f.shortForm : '');
        else r.push('', '', '', '');
      });
      rows.push(r);
    });
    return rows;
  }
  function summaryRows(agg) {
    var rows = [['OUTCOME STUDY — AGGREGATE SUMMARY'], [],
                ['Metric', 'Timepoint', 'n', 'Mean', 'Median', 'SD', 'n paired', 'Mean change vs baseline', 'Median change vs baseline']];
    function push(metricName, block) {
      block.forEach(function (r) {
        rows.push([metricName, r.label, r.n, nz(r.mean), nz(r.median), nz(r.sd),
                   r.nPaired == null ? '' : r.nPaired, nz(r.changeMean), nz(r.changeMedian)]);
      });
    }
    push('VAS pain (' + agg.cfg.vasMin + '-' + agg.cfg.vasMax + ')', agg.vas);
    rows.push([]);
    push('Short-form (' + agg.cfg.sfMin + '-' + agg.cfg.sfMax + ')', agg.shortForm);
    return rows;
  }
  function nz(x) { return x == null ? '' : x; }

  function toCSV(rows) {
    return rows.map(function (r) {
      return r.map(function (cell) {
        var s = cell == null ? '' : String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  /* ====================================================================== *
   *  Everything below is BROWSER-ONLY (DOM + app integration).
   *  Guarded so this file loads cleanly under node for offline tests.
   * ====================================================================== */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // public API (also used by the node test harness)
  var API = {
    DEFAULT_CFG: DEFAULT_CFG,
    _cfg: cfg,
    _parseDate: parseDate,
    _daysBetween: daysBetween,
    _fmtISO: fmtISO,
    _parseSpreadsheet: parseSpreadsheet,
    _classifyColumn: classifyColumn,
    _detectTimepoint: detectTimepoint,
    _detectMetric: detectMetric,
    _analyzeSheet: analyzeSheet,
    _buildAnalysisFromMapping: buildAnalysisFromMapping,
    _buildStudiesFromSheet: buildStudiesFromSheet,
    _fillBlanksInto: fillBlanksInto,
    _extractVisits: extractVisits,
    _buildPatientStudy: buildPatientStudy,
    _assignWindow: assignWindow,
    _aggregate: aggregate,
    _summarize: summarize,
    _mean: mean, _median: median, _sd: sd,
    _exportRows: exportRows, _summaryRows: summaryRows, _toCSV: toCSV,
    _esc: esc
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }

  if (HAS_WIN) {
    window.__mlsOutcome = (function (cur) { for (var k in API) cur[k] = API[k]; return cur; })(window.__mlsOutcome || {});
    if (HAS_DOC) { try { bootUI(); } catch (e) { /* silent no-op */ } }
  }

  /* ---------------------------------------------------------------------- *
   * 8. DOM / APP INTEGRATION  (mount the panel, wire Cmd-K, drive Athena)
   * ---------------------------------------------------------------------- */
  function bootUI() {
    if (window.__mlsOutcome.__booted) return;
    window.__mlsOutcome.__booted = true;
    window.__mlsOutcome.open = openModal;
    registerCmdK();
    // The Study/Import UI is an on-demand modal (.mls-study-card) whose tab bar
    // (.mls-study-tabs) holds "By name + DOB / By procedure / Cohorts". We add a
    // 4th "Outcome Study" tab. Because the modal is created on demand (and may be
    // re-created), watch the DOM and (re)inject the tab whenever it appears.
    try {
      injectTab();
      var pending = false;
      function schedule() { if (pending) return; pending = true; setTimeout(function () { pending = false; try { injectTab(); } catch (e) {} }, 250); }
      var mo = new MutationObserver(schedule);
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
      window.__mlsOutcome.__mo = mo;
    } catch (e) {}
    // low-frequency safety scan in case an observer mutation is missed
    setInterval(function () { try { injectTab(); } catch (e) {} }, 1500);
  }

  // Inject the "Outcome Study" tab button into the Study/Import modal tab bar.
  function injectTab() {
    var bars = document.querySelectorAll('.mls-study-tabs');
    var did = false;
    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];
      if (bar.querySelector('[data-mls-outcome-tab]')) continue;
      var btn = document.createElement('button');
      btn.setAttribute('data-mls-outcome-tab', '1');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Outcome Study');
      btn.textContent = '\uD83D\uDCC8 Outcome Study';
      btn.addEventListener('click', function (e) {
        try { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } catch (_) {}
        try { dismissStudyCard(this); } catch (_) {}
        openModal();
      }, true);
      bar.appendChild(btn);
      did = true;
    }
    return did;
  }

  function registerCmdK() {
    try {
      var ck = window.__mlsCmdK;
      var action = {
        id: 'outcome-study', type: 'action', label: 'Outcome study (upload spreadsheet)',
        title: 'Outcome study (upload spreadsheet)', keywords: 'outcome study vas pain function cohort spreadsheet',
        run: openModal, action: openModal, handler: openModal
      };
      if (ck) {
        if (typeof ck.addAction === 'function') ck.addAction(action);
        else if (typeof ck.add === 'function') ck.add(action);
        else if (typeof ck.register === 'function') ck.register(action);
        else if (Array.isArray(ck.actions)) ck.actions.push(action);
      }
    } catch (e) {}
  }

  function mountPanel() {
    if (document.getElementById('mlsOutcomeSection')) return true;
    var host = findStudyHost();
    if (!host) return false;
    var sec = document.createElement('div');
    sec.id = 'mlsOutcomeSection';
    sec.style.cssText = 'margin-top:18px;padding:14px 16px;border:1px solid var(--border,#2a3550);' +
      'border-radius:12px;background:var(--panel,rgba(255,255,255,.03));';
    sec.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<span style="font-size:16px">📈</span>' +
        '<strong style="font-size:15px">Outcome Study</strong>' +
        '<span style="font-size:11px;padding:2px 7px;border-radius:10px;background:#1f9ad6;color:#fff">VAS + function</span>' +
      '</div>' +
      '<div style="font-size:12.5px;opacity:.8;margin-bottom:10px">Upload a spreadsheet of patients (name + date of service). ' +
        'MLS reads each chart, captures baseline &amp; follow-up VAS pain (0–10) and the functional short-form (0–25), ' +
        'buckets follow-ups to ~10 days / 1 / 2 / 3 months, and reports the outcomes.</div>' +
      '<button id="mlsOutcomeOpen" style="' + btnCss('#1f9ad6') + '">📈 Open Outcome Study</button>';
    host.appendChild(sec);
    var b = sec.querySelector('#mlsOutcomeOpen');
    if (b) b.addEventListener('click', openModal);
    return true;
  }
  function findStudyHost() {
    var ids = ['studyImportView', 'studyView', 'mlsStudyPanel', 'mlsStudyByProcedure'];
    for (var i = 0; i < ids.length; i++) { var el = document.getElementById(ids[i]); if (el) return el; }
    var cands = document.querySelectorAll('div,section');
    for (var j = 0; j < cands.length; j++) {
      var t = (cands[j].textContent || '');
      if (/Find patients in Athena by procedure/i.test(t) && cands[j].children.length < 30) {
        return cands[j].closest('[id]') || cands[j].parentElement || cands[j];
      }
    }
    return null;
  }
  function btnCss(bg) {
    return 'display:inline-block;padding:8px 14px;border:0;border-radius:9px;cursor:pointer;' +
      'font-size:13px;font-weight:600;color:#fff;background:' + (bg || '#1f9ad6') + ';';
  }

  // Close the app's Study/Import modal (card + its fixed backdrop) so the
  // Outcome Study workflow is shown on its own, not stacked behind it.
  function dismissStudyCard(fromEl) {
    try {
      var card = fromEl && fromEl.closest ? fromEl.closest('.mls-study-card') : document.querySelector('.mls-study-card');
      if (!card) return;
      // climb to the fixed-position backdrop (the modal root)
      var backdrop = card, el = card.parentElement, hops = 0;
      while (el && hops < 6) { try { if (getComputedStyle(el).position === 'fixed') { backdrop = el; break; } } catch (e) {} el = el.parentElement; hops++; }
      // prefer the app's own close button (lets it clean up state)
      var x = card.querySelector('button');
      var closeBtn = null, btns = card.querySelectorAll('button,[role=button],span');
      for (var i = 0; i < btns.length; i++) { var t = (btns[i].textContent || '').trim(); if (t === '\u2715' || t === '\u00d7' || /^close$/i.test(t)) { closeBtn = btns[i]; break; } }
      if (closeBtn) { closeBtn.click(); }
      // belt-and-suspenders: if it is still in the DOM, hide the backdrop
      setTimeout(function () { try { if (document.body.contains(backdrop)) backdrop.style.display = 'none'; } catch (e) {} }, 30);
    } catch (e) {}
  }

  /* ---------------------- the modal workflow ---------------------------- */
  var STATE = { patients: [], studies: [], agg: null, _demoVisits: null,
                rawRows: null, analysis: null, ingestInfo: null, sourceName: '' };

  function openModal() {
    closeModal();
    var ov = document.createElement('div');
    ov.id = 'mlsOutcomeModal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(6,10,20,.82);' +
      'display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:28px 14px;';
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    var box = document.createElement('div');
    box.style.cssText = 'width:min(960px,96vw);background:var(--bg,#0e1626);color:var(--text,#e8eefc);' +
      'border:1px solid var(--border,#2a3550);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.5);padding:20px 22px;';
    box.innerHTML = modalHTML();
    ov.appendChild(box);
    document.body.appendChild(ov);
    var c2 = box.querySelector('#ocClose'); if (c2) c2.addEventListener('click', closeModal);
    renderStep1(box);
  }
  function closeModal() { var m = document.getElementById('mlsOutcomeModal'); if (m) m.remove(); }

  function modalHTML() {
    return '' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:9px"><span style="font-size:20px">📈</span>' +
        '<strong style="font-size:17px">Outcome Study</strong></div>' +
        '<button id="ocClose" style="background:transparent;border:0;color:inherit;font-size:20px;cursor:pointer">✕</button>' +
      '</div>' +
      '<div id="ocBody"></div>';
  }

  function renderStep1(box) {
    var body = box.querySelector('#ocBody');
    body.innerHTML =
      '<div style="font-size:13px;opacity:.85;margin-bottom:12px">Step 1 — Upload your spreadsheet ' +
        '(<b>.xlsx</b>, <b>.xls</b>, or <b>.csv</b>). If it already contains the scores — VAS pain (0–10) ' +
        'and the functional short-form (0–25) at <b>baseline / 10d / 1mo / 2mo / 3mo</b> — MLS reads every ' +
        'value straight from the sheet and shows the results immediately (no paste, no Athena). ' +
        'Both <b>one row per patient</b> (columns like “VAS baseline”, “SF 10d”…) and ' +
        '<b>one row per visit</b> (patient, visit date, pain, function) are auto-detected; ' +
        'you can fine-tune the column mapping after upload.</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
        '<input type="file" id="ocFile" accept=".xlsx,.xls,.csv,text/csv" style="font-size:13px">' +
        '<span style="opacity:.6;font-size:12px">or</span>' +
        '<button id="ocPasteBtn" style="background:#33415c;' + btnCss('#33415c') + '">Paste rows</button>' +
        '<button id="ocDemo" style="background:transparent;border:1px solid var(--border,#2a3550);color:inherit;padding:7px 12px;border-radius:9px;cursor:pointer;font-size:12px">Load demo data</button>' +
      '</div>' +
      '<textarea id="ocPaste" placeholder="Name, DOS&#10;Jane Doe, 03/04/2026&#10;John Smith, 2026-02-15" ' +
        'style="display:none;width:100%;min-height:120px;box-sizing:border-box;background:var(--panel,#0b1220);' +
        'color:inherit;border:1px solid var(--border,#2a3550);border-radius:9px;padding:10px;font-size:13px;font-family:monospace"></textarea>' +
      '<div id="ocParseMsg" style="margin-top:12px;font-size:13px"></div>' +
      '<div id="ocPatientList" style="margin-top:10px"></div>' +
      '<div id="ocStep1Actions" style="margin-top:14px"></div>';

    var file = body.querySelector('#ocFile');
    file.addEventListener('change', function () { if (file.files && file.files[0]) readFile(file.files[0], box); });
    body.querySelector('#ocPasteBtn').addEventListener('click', function () {
      var ta = body.querySelector('#ocPaste');
      ta.style.display = ta.style.display === 'none' ? 'block' : 'none';
      if (ta.style.display === 'block') ta.focus();
    });
    body.querySelector('#ocPaste').addEventListener('input', function () {
      ingestRows(parsePastedRows(this.value), box, 'pasted rows');
    });
    body.querySelector('#ocDemo').addEventListener('click', function () { loadDemo(box); });
  }

  function parsePastedRows(text) {
    return String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); })
      .map(function (l) { return l.split(/\t|,/).map(function (c) { return c.trim(); }); });
  }

  function readFile(f, box) {
    var msg = box.querySelector('#ocParseMsg');
    msg.textContent = 'Reading ' + f.name + ' …';
    var isCSV = /\.csv$/i.test(f.name) || f.type === 'text/csv';
    if (isCSV) {
      var fr = new FileReader();
      fr.onload = function () { ingestRows(parsePastedRows(fr.result), box, f.name); };
      fr.onerror = function () { msg.innerHTML = redMsg('Could not read the file.'); };
      fr.readAsText(f);
    } else {
      ensureXLSX(function (ok) {
        if (!ok) { msg.innerHTML = redMsg('Excel parser failed to load. Save the sheet as CSV and try again.'); return; }
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var wb = window.XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: true });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
            ingestRows(rows, box, f.name);
          } catch (e) { msg.innerHTML = redMsg('Could not parse the spreadsheet: ' + esc(e.message)); }
        };
        fr.onerror = function () { msg.innerHTML = redMsg('Could not read the file.'); };
        fr.readAsArrayBuffer(f);
      });
    }
  }

  function ensureXLSX(cb) {
    if (window.XLSX && window.XLSX.utils) return cb(true);
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = function () { cb(!!(window.XLSX && window.XLSX.utils)); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  function handleParsed(parsed, box) {
    STATE.patients = parsed.patients;
    var msg = box.querySelector('#ocParseMsg');
    var list = box.querySelector('#ocPatientList');
    var acts = box.querySelector('#ocStep1Actions');
    if (!parsed.patients.length) {
      msg.innerHTML = redMsg('No usable rows found. Need a patient name + a date of service.');
      list.innerHTML = ''; acts.innerHTML = ''; return;
    }
    msg.innerHTML = '<span style="color:#39d98a">✓ Parsed ' + parsed.patients.length + ' patient(s).</span>' +
      (parsed.skipped.length ? ' <span style="color:#f5a623">' + parsed.skipped.length + ' row(s) skipped.</span>' : '');
    var rowsHtml = parsed.patients.slice(0, 200).map(function (p) {
      return '<tr><td style="padding:3px 8px">' + esc(p.name) + '</td><td style="padding:3px 8px">' + esc(p.dos) + '</td></tr>';
    }).join('');
    var skHtml = parsed.skipped.length ?
      '<div style="margin-top:6px;font-size:12px;color:#f5a623">Skipped: ' +
        parsed.skipped.slice(0, 10).map(function (s) { return 'row ' + s.row + ' (' + esc(s.reason) + ')'; }).join('; ') +
        (parsed.skipped.length > 10 ? ' …' : '') + '</div>' : '';
    list.innerHTML = '<div style="max-height:200px;overflow:auto;border:1px solid var(--border,#2a3550);border-radius:9px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
      '<thead><tr><th style="text-align:left;padding:4px 8px;position:sticky;top:0;background:var(--panel,#10182a)">Patient</th>' +
      '<th style="text-align:left;padding:4px 8px;position:sticky;top:0;background:var(--panel,#10182a)">DOS</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div>' + skHtml;
    acts.innerHTML =
      '<button id="ocRunAthena" style="' + btnCss('#1f9ad6') + '">▶ Read charts from Athena &amp; build study</button> ' +
      '<button id="ocRunDemo" style="background:transparent;border:1px solid var(--border,#2a3550);color:inherit;padding:8px 12px;border-radius:9px;cursor:pointer;font-size:12.5px">Build from pasted/demo scores</button>';
    acts.querySelector('#ocRunAthena').addEventListener('click', function () { runAthena(box); });
    acts.querySelector('#ocRunDemo').addEventListener('click', function () { runFromInline(box); });
  }
  function redMsg(t) { return '<span style="color:#ff6b6b">⚠ ' + t + '</span>'; }

  /* ---- Excel-as-data-source router (zero paste / zero Athena) ---------- */
  // Analyze the uploaded rows. If the sheet already carries the scores (wide
  // or long), build the study + results straight from the file. Otherwise
  // fall back to the legacy name+DOS path (paste/Athena/demo).
  function ingestRows(rows, box, sourceName) {
    var c = cfg();
    var an = analyzeSheet(rows, c);
    STATE.rawRows = rows; STATE.analysis = an; STATE.sourceName = sourceName || '';
    if (an.layout === 'wide' || an.layout === 'long') {
      var built = buildStudiesFromSheet(rows, an, c);
      if (!built.studies.length) {
        var msg0 = box.querySelector('#ocParseMsg');
        if (msg0) msg0.innerHTML = redMsg('A score layout was detected but no patient rows were read. Use “Adjust columns”.');
        renderMapper(box);
        return;
      }
      STATE.studies = built.studies;
      STATE.patients = built.studies.map(function (s) { return { name: s.name, dos: s.dos, dosDate: parseDate(s.dos) }; });
      STATE.ingestInfo = built;
      STATE.agg = aggregate(built.studies, c);
      renderResults(box);
    } else {
      STATE.ingestInfo = null;
      handleParsed(parseSpreadsheet(rows, c), box);
    }
  }

  function layoutLabel(l) { return l === 'wide' ? 'one row per patient' : l === 'long' ? 'one row per visit' : l; }

  // Banner shown atop results when the data came straight from the sheet.
  function ingestBannerHTML() {
    var info = STATE.ingestInfo, an = STATE.analysis;
    if (!info || !an) return '';
    var src = STATE.sourceName ? esc(STATE.sourceName) : 'the uploaded sheet';
    return '<div id="ocIngestBanner" style="margin-bottom:10px;padding:9px 12px;border:1px solid #1f6f3f;' +
      'background:rgba(57,217,138,.08);border-radius:10px;font-size:12.5px">' +
      '<span style="color:#39d98a">✓ Read directly from ' + src + '</span> — ' +
      esc(layoutLabel(info.layout)) + ' layout, <b>' + info.studies.length + '</b> patient(s), <b>' +
      info.scoreCells + '</b> score value(s) read from the sheet. No paste or Athena needed.' +
      (info.skipped && info.skipped.length ? ' <span style="color:#f5a623">' + info.skipped.length + ' row(s) skipped.</span>' : '') +
      ' <button id="ocAdjustCols" style="margin-left:6px;background:transparent;border:1px solid var(--border,#2a3550);color:inherit;padding:4px 9px;border-radius:8px;cursor:pointer;font-size:11.5px">🛠 Adjust columns</button>' +
      ' <button id="ocFillAthena" style="background:transparent;border:1px solid var(--border,#2a3550);color:inherit;padding:4px 9px;border-radius:8px;cursor:pointer;font-size:11.5px">＋ Fill blanks from Athena (optional)</button>' +
      '<div id="ocFillLog" style="margin-top:6px;font-size:11.5px"></div></div>';
  }
  function wireIngestBanner(box) {
    var a = box.querySelector('#ocAdjustCols'); if (a) a.addEventListener('click', function () { renderMapper(box); });
    var f = box.querySelector('#ocFillAthena'); if (f) f.addEventListener('click', function () { fillBlanksFromAthena(box); });
  }

  /* ---- manual column-mapper fallback (any layout works) ---------------- */
  var MAP_OPTIONS = [
    ['ignore', '— ignore —'],
    ['id', 'Patient name / ID'],
    ['dos', 'Date of service (procedure)'],
    ['visitDate', 'Visit date (per-visit rows)'],
    ['timepoint', 'Timepoint label (baseline / 10d / …)'],
    ['score:vas:baseline', 'VAS pain — baseline'],
    ['score:vas:10d', 'VAS pain — 10 days'],
    ['score:vas:1mo', 'VAS pain — 1 month'],
    ['score:vas:2mo', 'VAS pain — 2 months'],
    ['score:vas:3mo', 'VAS pain — 3 months'],
    ['bare:vas', 'VAS pain — (per-visit value)'],
    ['score:sf:baseline', 'Short-form — baseline'],
    ['score:sf:10d', 'Short-form — 10 days'],
    ['score:sf:1mo', 'Short-form — 1 month'],
    ['score:sf:2mo', 'Short-form — 2 months'],
    ['score:sf:3mo', 'Short-form — 3 months'],
    ['bare:sf', 'Short-form — (per-visit value)']
  ];
  function colToken(x) {
    if (!x) return 'ignore';
    if (x.role === 'id' || x.role === 'dos' || x.role === 'visitDate' || x.role === 'timepoint') return x.role;
    if (x.role === 'score') return x.timepoint ? ('score:' + x.metric + ':' + x.timepoint) : ('bare:' + x.metric);
    return 'ignore';
  }
  function renderMapper(box) {
    var body = box.querySelector('#ocBody');
    var an = STATE.analysis, rows = STATE.rawRows || [];
    if (!an || an.headerRow < 0) { body.innerHTML = redMsg('No spreadsheet loaded to map. Go back and upload a file.') +
      '<div style="margin-top:12px"><button id="ocMapBack" style="' + btnCss('#33415c') + '">↩ Back</button></div>';
      var bb = body.querySelector('#ocMapBack'); if (bb) bb.addEventListener('click', function () { renderStep1(box); }); return; }
    var headers = an.headers || [];
    var firstData = rows[an.headerRow + 1] || [];
    var optsFor = function (sel) {
      return MAP_OPTIONS.map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('');
    };
    var rowsHtml = headers.map(function (h, ci) {
      var sel = colToken(an.cols && an.cols[ci]);
      var sample = cleanStr(firstData[ci]);
      return '<tr style="border-top:1px solid var(--border,#222e48)">' +
        '<td style="padding:5px 9px;font-weight:600">' + esc(h || ('Column ' + (ci + 1))) + '</td>' +
        '<td style="padding:5px 9px;opacity:.7;font-size:11.5px">' + esc(sample) + '</td>' +
        '<td style="padding:5px 9px"><select data-mapcol="' + ci + '" style="background:var(--panel,#0b1220);color:inherit;' +
          'border:1px solid var(--border,#2a3550);border-radius:7px;padding:4px 6px;font-size:12px">' + optsFor(sel) + '</select></td></tr>';
    }).join('');
    body.innerHTML =
      '<div style="font-size:13px;opacity:.85;margin-bottom:10px">🛠 <b>Column mapping</b> — confirm what each column holds, then build the study. ' +
        'Use the per-timepoint options for one-row-per-patient sheets, or the “(per-visit value)” + “Timepoint label / Visit date” options for one-row-per-visit sheets.</div>' +
      '<div style="max-height:340px;overflow:auto;border:1px solid var(--border,#2a3550);border-radius:9px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>' +
        '<th style="text-align:left;padding:5px 9px;position:sticky;top:0;background:var(--panel,#10182a)">Column</th>' +
        '<th style="text-align:left;padding:5px 9px;position:sticky;top:0;background:var(--panel,#10182a)">Sample</th>' +
        '<th style="text-align:left;padding:5px 9px;position:sticky;top:0;background:var(--panel,#10182a)">Maps to</th></tr></thead><tbody>' +
        rowsHtml + '</tbody></table></div>' +
      '<div id="ocMapMsg" style="margin-top:10px;font-size:12.5px"></div>' +
      '<div style="margin-top:12px">' +
        '<button id="ocMapApply" style="' + btnCss('#1f9ad6') + '">✓ Apply mapping &amp; build study</button> ' +
        '<button id="ocMapBack" style="background:transparent;border:1px solid var(--border,#2a3550);color:inherit;padding:8px 12px;border-radius:9px;cursor:pointer;font-size:12.5px">↩ Back</button></div>';
    body.querySelector('#ocMapBack').addEventListener('click', function () {
      if (STATE.ingestInfo) renderResults(box); else renderStep1(box);
    });
    body.querySelector('#ocMapApply').addEventListener('click', function () { applyMapping(box); });
  }
  function applyMapping(box) {
    var c = cfg();
    var selects = box.querySelectorAll('select[data-mapcol]');
    var sels = [];
    for (var i = 0; i < selects.length; i++) { sels[+selects[i].getAttribute('data-mapcol')] = selects[i].value; }
    var an = buildAnalysisFromMapping(STATE.analysis.headerRow, STATE.analysis.headers, sels);
    if (an.layout === 'simple') {
      box.querySelector('#ocMapMsg').innerHTML = redMsg('Map at least one VAS or short-form column (and a Patient column) to build the study.');
      return;
    }
    STATE.analysis = an;
    var built = buildStudiesFromSheet(STATE.rawRows, an, c);
    if (!built.studies.length) {
      box.querySelector('#ocMapMsg').innerHTML = redMsg('No patient rows read with this mapping — check the Patient column.');
      return;
    }
    STATE.studies = built.studies;
    STATE.patients = built.studies.map(function (s) { return { name: s.name, dos: s.dos, dosDate: parseDate(s.dos) }; });
    STATE.ingestInfo = built;
    STATE.agg = aggregate(built.studies, c);
    renderResults(box);
  }

  /* ---- optional: pull Athena charts to FILL BLANKS ONLY ---------------- */
  function fillBlanksFromAthena(box) {
    var c = cfg();
    var log = box.querySelector('#ocFillLog');
    function put(t, col) { if (!log) return; var d = document.createElement('div'); if (col) d.style.color = col; d.innerHTML = t; log.appendChild(d); }
    var reader = resolveChartReader();
    if (!reader) {
      put(redMsg('Athena chart-read bridge not found (MLS Assist + a signed-in athenaOne tab needed). The sheet results above are unchanged.'), '#ff6b6b');
      return;
    }
    put('Filling blanks read-only via MLS Assist (never Save/Sign)…');
    var i = 0, filled = 0;
    (function next() {
      if (i >= STATE.studies.length) {
        STATE.agg = aggregate(STATE.studies, c);
        put('<b>Done.</b> Filled ' + filled + ' blank field(s) from Athena.', '#39d98a');
        setTimeout(function () { renderResults(box); }, 300);
        return;
      }
      var st = STATE.studies[i++];
      var p = { name: st.name, dos: st.dos };
      Promise.resolve().then(function () { return reader(p); }).then(function (chartText) {
        var before = countScores(st);
        fillBlanksInto(st, buildPatientStudy(st.name, parseDate(st.dos), extractVisits(chartText, c), c), c);
        filled += countScores(st) - before;
        next();
      }).catch(function () { next(); });
    })();
  }
  function countScores(st) {
    var n = 0;
    if (st.baseline) { if (st.baseline.vas != null) n++; if (st.baseline.shortForm != null) n++; }
    for (var k in st.followups) { if (st.followups[k].vas != null) n++; if (st.followups[k].shortForm != null) n++; }
    return n;
  }

  function loadDemo(box) {
    var c = cfg();
    var demoPts = makeDemo(c);
    STATE.patients = demoPts.map(function (d) { return { name: d.name, dos: d.dos, dosDate: parseDate(d.dos) }; });
    STATE._demoVisits = {};
    demoPts.forEach(function (d) { STATE._demoVisits[d.name] = d.visits; });
    handleParsed({ patients: STATE.patients, skipped: [] }, box);
    box.querySelector('#ocParseMsg').innerHTML += ' <span style="opacity:.7">(demo synthetic scores loaded — use “Build from pasted/demo scores”).</span>';
  }
  function makeDemo() {
    function visit(dos, off, vas, sf) { var d = new Date(parseDate(dos).getTime() + off * MS_DAY); return { date: fmtISO(d), vas: vas, shortForm: sf }; }
    var out = [];
    var names = ['Ann Baseline', 'Ben Carter', 'Carla Diaz', 'Dan Evans', 'Ella Frost', 'Frank Gomez'];
    var seeds = [[7, 8], [8, 6], [6, 10], [9, 5], [7, 9], [8, 7]];
    names.forEach(function (nm, i) {
      var dos = '2026-0' + ((i % 3) + 1) + '-10';
      var bv = seeds[i][0], bs = seeds[i][1];
      var visits = [
        visit(dos, -3, bv, bs), visit(dos, 11, bv - 2, bs + 4), visit(dos, 31, bv - 3, bs + 6),
        visit(dos, 63, bv - 4, bs + 7), visit(dos, 88, Math.max(0, bv - 4), Math.min(25, bs + 8))
      ];
      if (i === 5) visits.splice(2, 1); // one patient missing 1mo
      out.push({ name: nm, dos: dos, visits: visits });
    });
    return out;
  }

  function runFromInline(box) {
    var c = cfg();
    STATE.studies = STATE.patients.map(function (p) {
      var visits = (STATE._demoVisits && STATE._demoVisits[p.name]) || [];
      return buildPatientStudy(p.name, p.dosDate, extractVisits(visits, c), c);
    });
    STATE.agg = aggregate(STATE.studies, c);
    renderResults(box);
  }

  function runAthena(box) {
    var c = cfg();
    var body = box.querySelector('#ocBody');
    var prog = document.createElement('div');
    prog.id = 'ocProg';
    prog.style.cssText = 'margin-top:14px;font-size:12.5px;max-height:260px;overflow:auto;' +
      'border:1px solid var(--border,#2a3550);border-radius:9px;padding:8px 10px';
    body.appendChild(prog);
    function log(t, cls) { var d = document.createElement('div'); if (cls) d.style.color = cls; d.innerHTML = t; prog.appendChild(d); prog.scrollTop = prog.scrollHeight; }

    var reader = resolveChartReader();
    if (!reader) {
      log(redMsg('MLS Assist chart-read bridge not found. Make sure MLS Assist (extension) is loaded ' +
        'and a signed-in athenaOne tab is open. You can also use “Build from pasted/demo scores”.'), '#ff6b6b');
      return;
    }
    log('Reading charts read-only via MLS Assist (never Save/Sign)…');
    var studies = [], i = 0;
    (function next() {
      if (i >= STATE.patients.length) {
        STATE.studies = studies; STATE.agg = aggregate(studies, c);
        log('<b>Done.</b> Built study for ' + studies.length + ' patient(s).', '#39d98a');
        setTimeout(function () { renderResults(box); }, 350);
        return;
      }
      var p = STATE.patients[i++];
      log('• ' + esc(p.name) + ' (DOS ' + esc(p.dos) + ') …');
      Promise.resolve().then(function () { return reader(p); }).then(function (chartText) {
        var st = buildPatientStudy(p.name, p.dosDate, extractVisits(chartText, c), c);
        studies.push(st);
        log('&nbsp;&nbsp;' + (st.baseline ? 'baseline ✓' : 'baseline —') + ', ' +
          Object.keys(st.followups).length + ' follow-up(s) bucketed.', st.baseline ? '#39d98a' : '#f5a623');
        next();
      }).catch(function (e) {
        log('&nbsp;&nbsp;' + redMsg('could not read chart: ' + esc(e && e.message || e)), '#ff6b6b');
        studies.push(buildPatientStudy(p.name, p.dosDate, [], c));
        next();
      });
    })();
  }

  function resolveChartReader() {
    if (window.__mlsOutcomeCfg && typeof window.__mlsOutcomeCfg.chartReader === 'function') {
      return window.__mlsOutcomeCfg.chartReader;
    }
    if (typeof window._assistReadChart === 'function') {
      return function (p) { return Promise.resolve(window._assistReadChart(p.name, p.dos)); };
    }
    if (window.__mlsStudy && typeof window.__mlsStudy._readChartFor === 'function') {
      return function (p) { return Promise.resolve(window.__mlsStudy._readChartFor(p.name, p.dos)); };
    }
    if (typeof window.postMessage === 'function') {
      return function (p) { return bridgeReadChart(p); };
    }
    return null;
  }

  function bridgeReadChart(p) {
    return new Promise(function (resolve, reject) {
      var id = 'oc_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      var done = false;
      function onMsg(ev) {
        var d = ev && ev.data;
        if (!d || d.__mlsReplyId !== id) return;
        done = true; window.removeEventListener('message', onMsg);
        if (d.error) reject(new Error(d.error)); else resolve(d.chartText || d.text || d.visits || '');
      }
      window.addEventListener('message', onMsg);
      try {
        window.postMessage({ __mlsApp: true, type: 'mlsAppReadChart', name: p.name, dob: '', dos: p.dos, __mlsReplyId: id }, '*');
      } catch (e) { window.removeEventListener('message', onMsg); reject(e); return; }
      setTimeout(function () { if (!done) { window.removeEventListener('message', onMsg); reject(new Error('timeout')); } }, 25000);
    });
  }

  /* ---------------------- results render ------------------------------- */
  function renderResults(box) {
    var body = box.querySelector('#ocBody');
    var agg = STATE.agg, c = cfg();
    body.innerHTML =
      ingestBannerHTML() +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">' +
        '<div style="font-size:13px;opacity:.85;max-width:560px">' + esc(summarize(agg, c)) + '</div>' +
        '<div><button id="ocExpCsv" style="' + btnCss('#33415c') + '">⬇ CSV</button> ' +
        '<button id="ocExpXlsx" style="' + btnCss('#1f9ad6') + '">⬇ Excel</button> ' +
        '<button id="ocBack" style="background:transparent;border:1px solid var(--border,#2a3550);color:inherit;padding:8px 12px;border-radius:9px;cursor:pointer;font-size:12.5px">↩ Start over</button></div>' +
      '</div>' +
      chartSVG(agg, c) +
      statTable('VAS pain (' + c.vasMin + '–' + c.vasMax + ', lower = better)', agg.vas, true) +
      statTable('Functional short-form (' + c.sfMin + '–' + c.sfMax + ')', agg.shortForm, !c.shortFormHigherIsBetter) +
      perPatientTable();
    body.querySelector('#ocExpCsv').addEventListener('click', exportCSVFile);
    body.querySelector('#ocExpXlsx').addEventListener('click', exportXLSXFile);
    body.querySelector('#ocBack').addEventListener('click', function () { renderStep1(box); });
    wireIngestBanner(box);
  }

  function statTable(title, block, lowerIsBetter) {
    var head = '<tr>' + ['Timepoint', 'n', 'Mean', 'Median', 'SD', 'Change mean', 'Change median', 'n paired']
      .map(function (h) { return '<th style="text-align:left;padding:5px 9px;font-size:11.5px;opacity:.8">' + h + '</th>'; }).join('') + '</tr>';
    var rows = block.map(function (r) {
      var dCell = '';
      if (r.key !== 'baseline' && r.changeMean != null) {
        var improved = lowerIsBetter ? r.changeMean < 0 : r.changeMean > 0;
        var col = r.changeMean === 0 ? 'inherit' : (improved ? '#39d98a' : '#ff6b6b');
        dCell = '<span style="color:' + col + '">' + (r.changeMean > 0 ? '+' : '') + r.changeMean + '</span>';
      }
      var dMed = (r.key !== 'baseline' && r.changeMedian != null) ? ((r.changeMedian > 0 ? '+' : '') + r.changeMedian) : '';
      return '<tr style="border-top:1px solid var(--border,#222e48)">' +
        td(r.label, true) + td(r.n) + td(fmtN(r.mean)) + td(fmtN(r.median)) + td(fmtN(r.sd)) +
        '<td style="padding:5px 9px">' + dCell + '</td>' + td(dMed) + td(r.nPaired == null ? '' : r.nPaired) + '</tr>';
    }).join('');
    return '<div style="margin-top:14px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">' + esc(title) + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' + head + rows + '</table></div>';
  }
  function td(v, b) { return '<td style="padding:5px 9px' + (b ? ';font-weight:600' : '') + '">' + esc(v) + '</td>'; }

  function chartSVG(agg, c) {
    var tps = agg.timepoints;
    var W = 620, H = 200, padL = 38, padR = 16, padT = 14, padB = 28, n = tps.length;
    function x(i) { return padL + (n <= 1 ? 0 : i * (W - padL - padR) / (n - 1)); }
    function line(block, max, color) {
      var pts = [], dots = '';
      block.forEach(function (r, i) {
        if (r.mean == null) return;
        var yy = padT + (H - padT - padB) * (1 - r.mean / max);
        pts.push(x(i).toFixed(1) + ',' + yy.toFixed(1));
        dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + yy.toFixed(1) + '" r="3.5" fill="' + color + '"></circle>';
      });
      if (!pts.length) return '';
      return '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2.5"></polyline>' + dots;
    }
    var labels = tps.map(function (tp, i) {
      return '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" font-size="10.5" fill="currentColor" text-anchor="middle" opacity=".75">' + esc(tp.label) + '</text>';
    }).join('');
    var gridY = '';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var yy = padT + (H - padT - padB) * f;
      gridY += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yy.toFixed(1) + '" stroke="currentColor" opacity=".08"></line>';
    });
    return '<div style="margin-top:6px;border:1px solid var(--border,#222e48);border-radius:10px;padding:8px">' +
      '<div style="font-size:11.5px;margin-bottom:2px"><span style="color:#1f9ad6">●</span> mean VAS pain (0–' + c.vasMax + ') &nbsp; <span style="color:#f5a623">●</span> mean short-form (0–' + c.sfMax + ')</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;color:var(--text,#e8eefc)">' +
      gridY + line(agg.vas, c.vasMax, '#1f9ad6') + line(agg.shortForm, c.sfMax, '#f5a623') + labels + '</svg></div>';
  }

  function perPatientTable() {
    var c = cfg(), keys = c.windows.map(function (w) { return w.key; });
    var head = ['Patient', 'DOS', 'Base VAS', 'Base SF'];
    c.windows.forEach(function (w) { head.push(w.label + ' VAS', w.label + ' SF'); });
    var ths = head.map(function (h) { return '<th style="text-align:left;padding:4px 8px;font-size:11px;opacity:.8;position:sticky;top:0;background:var(--panel,#10182a)">' + esc(h) + '</th>'; }).join('');
    var trs = STATE.studies.map(function (s) {
      var b = s.baseline || {};
      var cells = [s.name, s.dos, num(b.vas), num(b.shortForm)];
      keys.forEach(function (k) { var f = s.followups[k] || {}; cells.push(num(f.vas), num(f.shortForm)); });
      return '<tr style="border-top:1px solid var(--border,#222e48)">' + cells.map(function (cl, i) { return '<td style="padding:4px 8px' + (i === 0 ? ';font-weight:600' : '') + '">' + esc(cl) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div style="margin-top:16px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">Per-patient detail</div>' +
      '<div style="max-height:260px;overflow:auto;border:1px solid var(--border,#2a3550);border-radius:9px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table></div></div>';
  }
  function num(v) { return v == null ? '—' : v; }

  /* ---------------------- export to file ------------------------------- */
  function exportCSVFile() {
    var c = cfg();
    var csv = toCSV(summaryRows(STATE.agg)) + '\r\n\r\n' + toCSV(exportRows(STATE.studies, c));
    download('outcome_study_' + stamp() + '.csv', csv, 'text/csv');
  }
  function exportXLSXFile() {
    var c = cfg();
    ensureXLSX(function (ok) {
      if (!ok || !window.XLSX) { exportCSVFile(); return; }
      var wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(summaryRows(STATE.agg)), 'Summary');
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(exportRows(STATE.studies, c)), 'Per-patient');
      window.XLSX.writeFile(wb, 'outcome_study_' + stamp() + '.xlsx');
    });
  }
  function download(name, content, mime) {
    try {
      var url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }));
      var a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    } catch (e) {}
  }
  function stamp() { var d = new Date(); function p(x) { return (x < 10 ? '0' : '') + x; } return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); }

})();
