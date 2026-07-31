/* ============================================================================
 * mls-procedure-report.js  —  MLS "Procedure Report"
 * ----------------------------------------------------------------------------
 * Self-contained, additive, progressive-enhancement asset. NO bundle edits,
 * NO ScribeFlow.html edit, NO backend change. Loaded by a one-line guarded
 * loader appended to mls-connect(.staging).js.  Exposes window.__mlsProcReport.
 *
 * WHAT IT DOES
 *   • A "📊 Procedure Report" card mounted in the Analysis view (#analysisView).
 *   • Date range: default "This month", presets (This month, Last month,
 *     This quarter, YTD) + a custom from/to range.
 *   • Counts procedures performed in range from the REAL visit/CPT data
 *     (window.getPatients() -> patient.visits[]). A "procedure visit" is a
 *     visit carrying >=1 non-E/M CPT code. NEVER fabricates counts.
 *   • Breakdown BY procedure/injection TYPE (grouped by primary CPT, with
 *     human-readable names) and a higher-level category roll-up.
 *   • OFFICE vs ASC split via a NEW lightweight, persisted "Setting" field on
 *     each visit (Office / ASC; untagged -> "Unspecified" — never guessed).
 *   • RVU + estimated Medicare $ totals for the range and per-type subtotals
 *     (reuses window.__mlsRVU). Clean "No procedures in this range" empty state.
 *   • Export: Save as PDF (real selectable text; reuses window.loadJsPdf /
 *     pinned same-origin jsPDF 4.2.1) and CSV. Exports contain aggregate counts only — NO PHI.
 *
 * SAFETY: one guarded IIFE, all work in try/catch, no monkey-patching of any
 * existing function, no-op on any error. Removing the loader line (or blanking
 * this file) fully disables it; everything else is byte-identical.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__mlsProcReport) return;

  var isFn = function (f) { return typeof f === 'function'; };
  var S = function (x) { return (x == null ? '' : String(x)); };
  var trim = function (x) { return S(x).trim(); };
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(n) { return (n == null || isNaN(n)) ? '—' : (Math.round(n * 100) / 100).toFixed(2); }
  function money(n) { return (n == null || isNaN(n)) ? '—' : ('$' + (Math.round(n * 100) / 100).toFixed(2)); }
  function esc(s) {
    return S(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* --------------------------------------------------------------- data access */
  function getPatients() {
    try { return isFn(window.getPatients) ? (window.getPatients() || []) : []; } catch (e) { return []; }
  }
  function curEmail() {
    try { if (window.bkUser && window.bkUser.email) return window.bkUser.email; } catch (e) {}
    try {
      var k = Object.keys(localStorage).find(function (x) { return /^sf_u::[^:]+::/.test(x) && x.indexOf('::_::') < 0; });
      if (k) return k.split('::')[1];
    } catch (e) {}
    return '_';
  }
  // Reuse the visit model's date parser when present; otherwise a faithful copy.
  function svcToYMD(s) {
    try {
      if (window.__mlsVisitModel && isFn(window.__mlsVisitModel._svcToYMD)) {
        var r = window.__mlsVisitModel._svcToYMD(s); if (r) return r;
      }
    } catch (e) {}
    s = trim(s); if (!s) return '';
    var iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return [iso[1], pad(+iso[2]), pad(+iso[3])].join('-');
    var m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { var mo = +m[1], d = +m[2], y = +m[3]; if (y < 100) y += (y > 40 ? 1900 : 2000); return [y, pad(mo), pad(d)].join('-'); }
    return '';
  }

  /* ----------------------------------------------------------------- RVU bridge */
  function RVU() { return window.__mlsRVU || null; }
  function cf() { var R = RVU(); try { if (R && isFn(R._cf)) return R._cf(); } catch (e) {} return 33.40; }
  function cptDesc(code) { var R = RVU(); try { if (R && isFn(R.lookup)) { var r = R.lookup(code); if (r && r.desc) return r.desc; } } catch (e) {} return ''; }
  function wrvuOf(code) { var R = RVU(); try { if (R && isFn(R.wrvu)) { var w = R.wrvu(code); return (typeof w === 'number') ? w : 0; } } catch (e) {} return 0; }
  // Sum ALL cpt codes on a visit into {w,t,tDollars,hasT}. Falls back to wrvu-only.
  function sumVisitRVU(codes) {
    var R = RVU();
    if (R && isFn(R.sumVisit)) { try { return R.sumVisit(codes); } catch (e) {} }
    var out = { w: 0, t: 0, tDollars: null, hasT: false };
    (Array.isArray(codes) ? codes : [codes]).forEach(function (c) { out.w += wrvuOf(codeNorm(c)); });
    return out;
  }

  /* --------------------------------------------------------- CPT classification */
  function codeNorm(x) {
    if (x == null) return '';
    if (typeof x === 'object') x = x.code || x.cpt || x.value || '';
    var s = String(x);
    var m = s.match(/\b([0-9CG][0-9A-Z]{4})\b/); if (m) return m[1];
    m = s.match(/\b(\d{5})\b/); return m ? m[1] : '';
  }
  function isEM(code) { return /^99\d{3}$/.test(String(code)); }

  // Category roll-up for the common interventional-pain / PM&R procedure codes.
  var CAT_RULES = [
    { name: 'Transforaminal epidural steroid injection (TFESI)', codes: ['64479', '64480', '64483', '64484'] },
    { name: 'Interlaminar/caudal epidural steroid injection (ESI)', codes: ['62320', '62321', '62322', '62323', '62324', '62325', '62326', '62327'] },
    { name: 'Facet / medial branch block (MBB)', codes: ['64490', '64491', '64492', '64493', '64494', '64495'] },
    { name: 'Radiofrequency facet denervation (RFA)', codes: ['64633', '64634', '64635', '64636'] },
    { name: 'Neurolytic destruction, peripheral nerve', codes: ['64640'] },
    { name: 'Peripheral nerve block', codes: ['64450', '64451', '64454', '64455'] },
    { name: 'Sacroiliac joint injection', codes: ['27096', '27279'] },
    { name: 'Major / intermediate joint injection', codes: ['20600', '20605', '20610', '20611'] },
    { name: 'Trigger point / tendon injection', codes: ['20526', '20550', '20551', '20552', '20553'] },
    { name: 'Fluoroscopic / imaging guidance', codes: ['77002', '77003'] },
    { name: 'Spinal cord stimulation', codes: ['63650', '63655', '63685'] }
  ];
  var CAT_MAP = {};
  CAT_RULES.forEach(function (r) { r.codes.forEach(function (c) { CAT_MAP[c] = r.name; }); });
  function category(code) {
    code = codeNorm(code); if (!code) return 'Other / uncategorized';
    if (CAT_MAP[code]) return CAT_MAP[code];
    if (isEM(code)) return 'Office / E&M visit';
    return 'Other / uncategorized';
  }
  function humanName(code) {
    code = codeNorm(code); if (!code) return 'Procedure (no CPT captured)';
    var d = cptDesc(code);
    return d ? d : category(code);
  }
  // procedure (non-E/M) codes on a visit
  function procCodes(v) {
    var arr = (v && Array.isArray(v.cpt)) ? v.cpt : [];
    var out = [];
    arr.forEach(function (c) { var n = codeNorm(c); if (n && !isEM(n)) out.push(n); });
    return out;
  }
  function isProcedureVisit(v) { return procCodes(v).length > 0; }
  // primary procedure code = highest-wRVU non-E/M code (else first)
  function primaryProc(v) {
    var codes = procCodes(v); if (!codes.length) return '';
    var best = codes[0], bestW = -1;
    codes.forEach(function (c) { var w = wrvuOf(c); if (w > bestW) { bestW = w; best = c; } });
    return best;
  }

  /* ------------------------------------------------- Setting (Office/ASC) field */
  // Persisted two ways: (1) v.setting on the visit object (rides in uns_patients,
  // server-mirrored via upsertPatient), and (2) a per-user id->setting side-map
  // as a backstop so a later re-import that re-normalizes the visit can't lose it.
  function settingKey() { return 'sf_u::' + curEmail() + '::mlsProcSetting'; }
  function settingMap() { try { return JSON.parse(localStorage.getItem(settingKey()) || '{}') || {}; } catch (e) { return {}; } }
  function saveSettingMap(m) { try { localStorage.setItem(settingKey(), JSON.stringify(m)); } catch (e) {} }
  function normSetting(s) {
    s = trim(s).toLowerCase();
    if (s === 'office' || s === 'clinic' || s === 'in-office') return 'Office';
    if (s === 'asc' || s === 'surgery' || s === 'surgery center' || s === 'ambulatory surgery center' || s === 'hospital' || s === 'facility') return 'ASC';
    return '';
  }
  function getSetting(v) {
    var s = normSetting(v && v.setting); if (s) return s;
    var m = settingMap(); var x = (v && v.id) ? m[v.id] : ''; return normSetting(x);
  }
  function setSetting(patientId, visitId, val) {
    val = (val === 'Office' || val === 'ASC') ? val : '';
    try {
      var p = getPatients().find(function (x) { return x && x.id === patientId; });
      if (p && Array.isArray(p.visits)) {
        var v = p.visits.find(function (x) { return x && x.id === visitId; });
        if (v) {
          if (val) v.setting = val; else { try { delete v.setting; } catch (e) { v.setting = ''; } }
          try { if (isFn(window.upsertPatient)) window.upsertPatient(p); } catch (e) {}
        }
      }
    } catch (e) {}
    var m = settingMap(); if (val) m[visitId] = val; else delete m[visitId]; saveSettingMap(m);
  }

  /* ----------------------------------------------------------------- date range */
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function presetRange(key) {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    switch (key) {
      case 'this_month': return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)), label: 'This month' };
      case 'last_month': return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)), label: 'Last month' };
      case 'this_quarter': var q = Math.floor(m / 3); return { from: ymd(new Date(y, q * 3, 1)), to: ymd(new Date(y, q * 3 + 3, 0)), label: 'This quarter' };
      case 'ytd': return { from: ymd(new Date(y, 0, 1)), to: ymd(now), label: 'Year to date' };
      default: return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)), label: 'This month' };
    }
  }

  /* ----------------------------------------------------------------- aggregate  */
  function collect(range) {
    var pts = getPatients();
    var procVisits = [], totalVisitsInRange = 0, undatedProc = 0;
    pts.forEach(function (p) {
      var vs = (p && Array.isArray(p.visits)) ? p.visits : [];
      vs.forEach(function (v) {
        var d = svcToYMD(v && v.date);
        var inRange = d && d >= range.from && d <= range.to;
        if (inRange) totalVisitsInRange++;
        if (!isProcedureVisit(v)) return;
        if (!d) { undatedProc++; return; }
        if (inRange) procVisits.push({ patientId: p.id, patientName: trim(p.name), visit: v, ymd: d });
      });
    });
    return { procVisits: procVisits, totalVisitsInRange: totalVisitsInRange, undatedProc: undatedProc };
  }

  function aggregate(range) {
    var c = collect(range);
    var byCode = {}, byCat = {};
    var settings = { Office: 0, ASC: 0, Unspecified: 0 };
    var totalW = 0, totalT = 0, totalD = 0, anyT = false;
    c.procVisits.forEach(function (r) {
      var v = r.visit;
      var setting = getSetting(v) || 'Unspecified';
      settings[setting] = (settings[setting] || 0) + 1;
      var sv = sumVisitRVU(v.cpt || []);
      totalW += sv.w || 0;
      if (sv.hasT) { totalT += sv.t || 0; anyT = true; }
      if (sv.tDollars != null) totalD += sv.tDollars;
      var pc = primaryProc(v);
      var key = pc || '(no CPT)';
      var b = byCode[key] || (byCode[key] = { code: pc, name: pc ? humanName(pc) : 'Procedure (no CPT captured)', cat: pc ? category(pc) : 'Other / uncategorized', count: 0, w: 0, t: 0, d: 0, settings: { Office: 0, ASC: 0, Unspecified: 0 } });
      b.count++; b.w += sv.w || 0; b.t += sv.t || 0; b.d += (sv.tDollars || 0); b.settings[setting]++;
      var cat = b.cat;
      var cb = byCat[cat] || (byCat[cat] = { cat: cat, count: 0, w: 0, t: 0, d: 0 });
      cb.count++; cb.w += sv.w || 0; cb.t += sv.t || 0; cb.d += (sv.tDollars || 0);
    });
    var codeRows = Object.keys(byCode).map(function (k) { return byCode[k]; }).sort(function (a, b) { return b.count - a.count || b.w - a.w; });
    var catRows = Object.keys(byCat).map(function (k) { return byCat[k]; }).sort(function (a, b) { return b.count - a.count; });
    return {
      range: range, total: c.procVisits.length, settings: settings,
      codeRows: codeRows, catRows: catRows,
      totalW: totalW, totalT: totalT, totalD: totalD, anyT: anyT,
      undatedProc: c.undatedProc, totalVisitsInRange: c.totalVisitsInRange,
      rows: c.procVisits
    };
  }

  /* ---------------------------------------------------------------------- state */
  var STATE = { presetKey: 'this_month', range: presetRange('this_month'), customFrom: '', customTo: '', showTagger: false };

  /* ----------------------------------------------------------------------- CSS  */
  function injectCSS() {
    if (document.getElementById('mlsProcReportCSS')) return;
    var css = [
      '#mlsProcReport{background:#ffffff;color:#1f2a37;border:1px solid #d7deea;border-radius:14px;padding:18px 20px;margin:0 0 16px;box-shadow:0 1px 3px rgba(16,32,64,.06)}',
      '#mlsProcReport h2{margin:0 0 4px;font-size:19px;color:#204034;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '#mlsProcReport .mlspr-sub{color:#5f7186;font-size:12.5px;margin:0 0 12px}',
      '#mlsProcReport .mlspr-presets{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}',
      '#mlsProcReport .mlspr-btn{cursor:pointer;border:1px solid #c3d0e4;background:#EAF1EE;color:#204034;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:600;line-height:1}',
      '#mlsProcReport .mlspr-btn:hover{background:#e1ebf9}',
      '#mlsProcReport .mlspr-btn.on{background:#2E6A4B;border-color:#2E6A4B;color:#fff}',
      '#mlsProcReport .mlspr-custom{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px;font-size:12.5px;color:#204034}',
      '#mlsProcReport input[type=date]{border:1px solid #c3d0e4;border-radius:7px;padding:5px 8px;font-size:12.5px;color:#1f2a37;background:#fff}',
      '#mlsProcReport .mlspr-kpis{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}',
      '#mlsProcReport .mlspr-kpi{flex:1 1 130px;min-width:120px;background:#f5f8fd;border:1px solid #dde6f3;border-radius:10px;padding:10px 12px}',
      '#mlsProcReport .mlspr-kpi .n{font-size:24px;font-weight:800;color:#204034;line-height:1.1}',
      '#mlsProcReport .mlspr-kpi .l{font-size:11.5px;color:#5f7186;margin-top:2px;text-transform:uppercase;letter-spacing:.03em}',
      '#mlsProcReport .mlspr-kpi.office .n{color:#2E6A4B}',
      '#mlsProcReport .mlspr-kpi.asc .n{color:#9c4221}',
      '#mlsProcReport .mlspr-kpi.unspec .n{color:#6b7280}',
      '#mlsProcReport h3{font-size:14px;color:#204034;margin:16px 0 7px;font-weight:700}',
      '#mlsProcReport table{width:100%;border-collapse:collapse;font-size:12.5px}',
      '#mlsProcReport th,#mlsProcReport td{text-align:left;padding:6px 8px;border-bottom:1px solid #e7edf6;color:#28344a}',
      '#mlsProcReport th{background:#EAF1EE;color:#204034;font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:.02em}',
      '#mlsProcReport td.num,#mlsProcReport th.num{text-align:right;font-variant-numeric:tabular-nums}',
      '#mlsProcReport tr.total td{font-weight:800;background:#f5f8fd;color:#204034;border-top:2px solid #c3d0e4}',
      '#mlsProcReport .mlspr-code{font-weight:700;color:#204034}',
      '#mlsProcReport .mlspr-empty{background:#f5f8fd;border:1px dashed #c3d0e4;border-radius:10px;padding:22px;text-align:center;color:#48566e;font-size:13.5px}',
      '#mlsProcReport .mlspr-actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 4px}',
      '#mlsProcReport .mlspr-actions .mlspr-btn{padding:8px 13px;font-size:13px}',
      '#mlsProcReport .mlspr-actions .pdf{background:#204034;border-color:#204034;color:#fff}',
      '#mlsProcReport .mlspr-actions .csv{background:#10713b;border-color:#10713b;color:#fff}',
      '#mlsProcReport .mlspr-tagwrap{margin-top:14px;border-top:1px solid #e7edf6;padding-top:10px}',
      '#mlsProcReport .mlspr-tagrow{display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid #f0f4fa;font-size:12.5px;color:#204034;flex-wrap:wrap}',
      '#mlsProcReport .mlspr-tagrow .d{font-weight:700;color:#204034;min-width:88px}',
      '#mlsProcReport select.mlspr-set{border:1px solid #c3d0e4;border-radius:7px;padding:4px 7px;font-size:12.5px;color:#1f2a37;background:#fff}',
      '#mlsProcReport .mlspr-note{font-size:11.5px;color:#7a8aa0;margin-top:8px}',
      '#mlsProcReport a.mlspr-toggle{color:#2E6A4B;font-size:12.5px;cursor:pointer;font-weight:600;text-decoration:none}'
    ].join('\n');
    var s = document.createElement('style'); s.id = 'mlsProcReportCSS'; s.textContent = css; document.head.appendChild(s);
  }

  /* ---------------------------------------------------------------------- render*/
  function rangeLabel() {
    var r = STATE.range;
    return (r.label ? r.label + ' — ' : '') + r.from + ' to ' + r.to;
  }

  function buildHTML() {
    var A = aggregate(STATE.range);
    var h = [];
    h.push('<h2>📊 Procedure Report</h2>');
    h.push('<p class="mlspr-sub">Counts of procedures performed, by type and place of service, from your real visit records. Uses CPT codes already on each visit — nothing is fabricated.</p>');

    // presets
    h.push('<div class="mlspr-presets">');
    [['this_month', 'This month'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'], ['ytd', 'YTD'], ['custom', 'Custom range']].forEach(function (p) {
      h.push('<button class="mlspr-btn' + (STATE.presetKey === p[0] ? ' on' : '') + '" data-preset="' + p[0] + '">' + p[1] + '</button>');
    });
    h.push('</div>');
    if (STATE.presetKey === 'custom') {
      h.push('<div class="mlspr-custom"><label>From <input type="date" id="mlsprFrom" value="' + esc(STATE.customFrom || STATE.range.from) + '"></label>'
        + '<label>To <input type="date" id="mlsprTo" value="' + esc(STATE.customTo || STATE.range.to) + '"></label>'
        + '<button class="mlspr-btn on" id="mlsprApply">Apply</button></div>');
    }
    h.push('<div class="mlspr-sub" style="margin-top:-4px"><strong>Range:</strong> ' + esc(rangeLabel()) + '</div>');

    if (!A.total) {
      h.push('<div class="mlspr-empty"><div style="font-size:30px;margin-bottom:6px">🗓️</div><div style="font-weight:700;color:#204034;margin-bottom:4px">No procedures in this range</div>'
        + 'No visit in ' + esc(STATE.range.label || (STATE.range.from + '…' + STATE.range.to)) + ' carries a procedure CPT code.'
        + (A.undatedProc ? '<div class="mlspr-note">' + A.undatedProc + ' procedure visit(s) have no recorded date and are not counted in any range.</div>' : '')
        + '</div>');
      return h.join('');
    }

    // KPIs
    h.push('<div class="mlspr-kpis">');
    h.push('<div class="mlspr-kpi"><div class="n">' + A.total + '</div><div class="l">Procedures</div></div>');
    h.push('<div class="mlspr-kpi office"><div class="n">' + A.settings.Office + '</div><div class="l">Office</div></div>');
    h.push('<div class="mlspr-kpi asc"><div class="n">' + A.settings.ASC + '</div><div class="l">ASC / surgery ctr</div></div>');
    if (A.settings.Unspecified) h.push('<div class="mlspr-kpi unspec"><div class="n">' + A.settings.Unspecified + '</div><div class="l">Unspecified</div></div>');
    h.push('<div class="mlspr-kpi"><div class="n">' + fmt(A.totalW) + '</div><div class="l">Total wRVU</div></div>');
    h.push('<div class="mlspr-kpi"><div class="n">' + (A.anyT ? money(A.totalD) : '—') + '</div><div class="l">Est. Medicare $</div></div>');
    h.push('</div>');

    // by type (CPT)
    h.push('<h3>By procedure type (CPT)</h3>');
    h.push('<table><thead><tr><th>CPT</th><th>Type</th><th class="num">Count</th><th class="num">Office</th><th class="num">ASC</th><th class="num">wRVU</th><th class="num">Total RVU</th><th class="num">Est. $</th></tr></thead><tbody>');
    A.codeRows.forEach(function (r) {
      h.push('<tr><td class="mlspr-code">' + (r.code ? esc(r.code) : '—') + '</td><td>' + esc(r.name) + '</td>'
        + '<td class="num">' + r.count + '</td>'
        + '<td class="num">' + (r.settings.Office || '') + '</td>'
        + '<td class="num">' + (r.settings.ASC || '') + '</td>'
        + '<td class="num">' + fmt(r.w) + '</td>'
        + '<td class="num">' + (r.t ? fmt(r.t) : '—') + '</td>'
        + '<td class="num">' + (r.t ? money(r.t * cf()) : '—') + '</td></tr>');
    });
    h.push('<tr class="total"><td colspan="2">TOTAL</td><td class="num">' + A.total + '</td>'
      + '<td class="num">' + A.settings.Office + '</td><td class="num">' + A.settings.ASC + '</td>'
      + '<td class="num">' + fmt(A.totalW) + '</td><td class="num">' + (A.anyT ? fmt(A.totalT) : '—') + '</td>'
      + '<td class="num">' + (A.anyT ? money(A.totalD) : '—') + '</td></tr>');
    h.push('</tbody></table>');

    // by category roll-up
    if (A.catRows.length > 1) {
      h.push('<h3>By category</h3>');
      h.push('<table><thead><tr><th>Category</th><th class="num">Count</th><th class="num">wRVU</th><th class="num">Est. $</th></tr></thead><tbody>');
      A.catRows.forEach(function (r) {
        h.push('<tr><td>' + esc(r.cat) + '</td><td class="num">' + r.count + '</td><td class="num">' + fmt(r.w) + '</td><td class="num">' + (r.t ? money(r.t * cf()) : '—') + '</td></tr>');
      });
      h.push('</tbody></table>');
    }

    h.push('<div class="mlspr-note">' + A.total + ' procedure visit(s) of ' + A.totalVisitsInRange + ' total visit(s) in range. '
      + 'RVU/$ use ' + (RVU() ? 'the in-app RVU table (CF ' + money(cf()) + ', GPCI 1.0)' : 'the default conversion factor') + '; dollar figures are estimates, not a payment guarantee.'
      + (A.undatedProc ? ' ' + A.undatedProc + ' procedure visit(s) with no date are excluded.' : '') + '</div>');

    // actions
    h.push('<div class="mlspr-actions"><button class="mlspr-btn pdf" id="mlsprPdf">🧾 Save as PDF</button>'
      + '<button class="mlspr-btn csv" id="mlsprCsv">⬇ Export CSV</button>'
      + '<a class="mlspr-toggle" id="mlsprTagToggle" style="margin-left:auto;align-self:center">' + (STATE.showTagger ? '▾ Hide place-of-service tagging' : '⚙ Tag Office / ASC') + '</a></div>');

    // tagging editor (Setting field)
    if (STATE.showTagger) {
      h.push('<div class="mlspr-tagwrap"><div class="mlspr-sub">Set each procedure visit\'s place of service. Saved to the visit record (and mirrored to the server). Untagged visits stay "Unspecified".</div>');
      A.rows.slice().sort(function (a, b) { return b.ymd.localeCompare(a.ymd); }).forEach(function (r) {
        var v = r.visit, cur = getSetting(v), pc = primaryProc(v);
        h.push('<div class="mlspr-tagrow"><span class="d">' + esc(r.ymd) + '</span>'
          + '<span style="flex:1 1 180px">' + esc(r.patientName || 'Patient') + ' · <span class="mlspr-code">' + esc(pc || '—') + '</span> ' + esc(humanName(pc)) + '</span>'
          + '<select class="mlspr-set" data-pid="' + esc(r.patientId) + '" data-vid="' + esc(v.id) + '">'
          + '<option value=""' + (cur ? '' : ' selected') + '>Unspecified</option>'
          + '<option value="Office"' + (cur === 'Office' ? ' selected' : '') + '>Office</option>'
          + '<option value="ASC"' + (cur === 'ASC' ? ' selected' : '') + '>ASC</option>'
          + '</select></div>');
      });
      h.push('</div>');
    }
    return h.join('');
  }

  function bind(host) {
    host.querySelectorAll('button[data-preset]').forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-preset');
        STATE.presetKey = k;
        if (k !== 'custom') STATE.range = presetRange(k);
        else { STATE.range = { from: STATE.customFrom || STATE.range.from, to: STATE.customTo || STATE.range.to, label: 'Custom' }; }
        render(host);
      };
    });
    var ap = host.querySelector('#mlsprApply');
    if (ap) ap.onclick = function () {
      var f = host.querySelector('#mlsprFrom'), t = host.querySelector('#mlsprTo');
      var fv = f && f.value, tv = t && t.value;
      if (fv && tv && fv <= tv) { STATE.customFrom = fv; STATE.customTo = tv; STATE.range = { from: fv, to: tv, label: 'Custom' }; render(host); }
    };
    var tg = host.querySelector('#mlsprTagToggle');
    if (tg) tg.onclick = function () { STATE.showTagger = !STATE.showTagger; render(host); };
    host.querySelectorAll('select.mlspr-set').forEach(function (sel) {
      sel.onchange = function () { setSetting(sel.getAttribute('data-pid'), sel.getAttribute('data-vid'), sel.value); render(host); };
    });
    var pdf = host.querySelector('#mlsprPdf'); if (pdf) pdf.onclick = function () { exportPDF(); };
    var csv = host.querySelector('#mlsprCsv'); if (csv) csv.onclick = function () { exportCSV(); };
  }

  function render(host) {
    try { host.innerHTML = buildHTML(); bind(host); } catch (e) { try { host.innerHTML = '<h2>📊 Procedure Report</h2><div class="mlspr-empty">Report unavailable right now.</div>'; } catch (e2) {} }
  }

  /* ----------------------------------------------------------------- CSV export */
  function csvCell(s) { s = S(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function buildCSV() {
    var A = aggregate(STATE.range);
    var L = [];
    L.push(['MLS Procedure Report'].map(csvCell).join(','));
    L.push(['Range', rangeLabel()].map(csvCell).join(','));
    L.push(['Generated', new Date().toLocaleString()].map(csvCell).join(','));
    L.push(['Total procedures', A.total].map(csvCell).join(','));
    L.push(['Office', A.settings.Office].map(csvCell).join(','));
    L.push(['ASC', A.settings.ASC].map(csvCell).join(','));
    L.push(['Unspecified', A.settings.Unspecified].map(csvCell).join(','));
    L.push(['Total wRVU', fmt(A.totalW)].map(csvCell).join(','));
    L.push(['Total RVU', A.anyT ? fmt(A.totalT) : ''].map(csvCell).join(','));
    L.push(['Est. Medicare $', A.anyT ? fmt(A.totalD) : ''].map(csvCell).join(','));
    L.push('');
    L.push(['CPT', 'Type', 'Category', 'Count', 'Office', 'ASC', 'Unspecified', 'wRVU', 'Total RVU', 'Est. Medicare $'].map(csvCell).join(','));
    A.codeRows.forEach(function (r) {
      L.push([r.code || '', r.name, r.cat, r.count, r.settings.Office, r.settings.ASC, r.settings.Unspecified, fmt(r.w), r.t ? fmt(r.t) : '', r.t ? fmt(r.t * cf()) : ''].map(csvCell).join(','));
    });
    L.push(['TOTAL', '', '', A.total, A.settings.Office, A.settings.ASC, A.settings.Unspecified, fmt(A.totalW), A.anyT ? fmt(A.totalT) : '', A.anyT ? fmt(A.totalD) : ''].map(csvCell).join(','));
    return L.join('\r\n');
  }
  function exportCSV() {
    try {
      var blob = new Blob(['﻿' + buildCSV()], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'ProcedureReport_' + STATE.range.from + '_' + STATE.range.to + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      toast('Exported ' + a.download);
    } catch (e) { toast('Could not export CSV.'); }
  }

  /* ----------------------------------------------------------------- PDF export */
  function ensureJsPdf() {
    if (typeof window.loadJsPdf === 'function') return window.loadJsPdf();
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf);
    return new Promise(function (resolve, reject) {
      var ex = document.getElementById('jspdfScript');
      var ok = function () { (window.jspdf && window.jspdf.jsPDF) ? resolve(window.jspdf) : reject(new Error('jsPDF unavailable')); };
      if (ex) { ex.addEventListener('load', ok); ex.addEventListener('error', function () { reject(new Error('jsPDF load error')); }); return; }
      var s = document.createElement('script'); s.id = 'jspdfScript';
      s.src = 'vendor/jspdf.umd-4.2.1.min.js?v=e6551fcdc32f09d6';
      s.onload = ok; s.onerror = function () { reject(new Error('jsPDF load error')); };
      document.head.appendChild(s);
    });
  }
  function pdfSafe(s) {
    return S(s).replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[•●▪·]/g, '-').replace(/[^\x00-\x7F]/g, '');
  }
  /* providerName BEFORE docname. This read them the other way round, so the
     login/account display name outranked the configured clinical provider on
     every exported Procedure Report - the exact inversion
     tests/provider-identity-separation-contract forbids, on a surface it does
     not cover. docname stays as a last resort here (this is a productivity
     report attributed to an account, not a clinical attestation) but it can no
     longer win while a real provider identity exists. */
  function providerName() {
    try {
      var base = 'sf_u::' + curEmail() + '::';
      return localStorage.getItem(base + 'providerName') || localStorage.getItem(base + 'docname') || '';
    } catch (e) { return ''; }
  }
  function exportPDF() {
    ensureJsPdf().then(function (ns) {
      try {
        var A = aggregate(STATE.range);
        var jsPDF = ns.jsPDF;
        var doc = new jsPDF({ unit: 'pt', format: 'letter' });
        var pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
        var margin = 56, lineH = 14, y = margin;
        var lh = window.MLS_OPNOTE_LETTERHEAD || {};
        function footer() {
          var pc = doc.internal.getNumberOfPages();
          for (var i = 1; i <= pc; i++) {
            doc.setPage(i);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
            doc.text('Page ' + i + ' of ' + pc, pageW - margin, pageH - 24, { align: 'right' });
            doc.text('MLS Procedure Report — counts from real visit records; dollar figures are estimates.', margin, pageH - 24);
          }
        }
        function ensure(hh) { if (y + (hh || 0) > pageH - margin - 28) { doc.addPage(); y = margin; } }
        function line(txt, fs, bold, color) {
          doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(fs || 10);
          doc.setTextColor.apply(doc, color || [40, 52, 74]);
          var lines = doc.splitTextToSize(pdfSafe(txt), pageW - margin * 2);
          for (var i = 0; i < lines.length; i++) { ensure(lineH); doc.text(lines[i], margin, y); y += lineH; }
        }
        // letterhead
        /* b831: the practice's own logo on this letterhead too. One owner draws it
           (__mlsOpNotePro.drawLetterheadLogo) and returns the space consumed, so a
           refusal is 0 and this cursor cannot advance past a logo that was not drawn.
           Absent engine -> 0 -> letterhead exactly as before. */
        try {
          var _pro = window.__mlsOpNotePro;
          if (_pro && typeof _pro.drawLetterheadLogo === 'function') y += _pro.drawLetterheadLogo(doc, lh.logo, margin, y);
        } catch (eLogo) {}
        if (lh.clinicName) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(21, 95, 179);
          doc.text(pdfSafe(lh.clinicName), margin, y); y += 18;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(95, 113, 134);
          (lh.addressLines || []).forEach(function (a) { doc.text(pdfSafe(a), margin, y); y += 12; });
        } else {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(21, 95, 179);
          doc.text('MLS', margin, y);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(95, 113, 134);
          doc.text('Physical Medicine, Rehabilitation & Pain', margin + 42, y); y += 16;
        }
        var dn = providerName();
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(95, 113, 134);
        if (dn) doc.text(pdfSafe('Provider: ' + dn), pageW - margin, margin, { align: 'right' });
        doc.text(pdfSafe('Generated: ' + new Date().toLocaleString()), pageW - margin, margin + 12, { align: 'right' });
        y = Math.max(y, margin + 26);
        doc.setDrawColor(31, 122, 224); doc.setLineWidth(1.2); doc.line(margin, y, pageW - margin, y); y += 18;

        doc.setTextColor(21, 95, 179); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
        ensure(lineH); doc.text('PROCEDURE REPORT', margin, y); y += 20;
        line('Date range: ' + rangeLabel(), 10.5, true);
        y += 4;

        // summary
        line('SUMMARY', 12, true, [21, 95, 179]); y += 2;
        line('Total procedures: ' + A.total, 10.5, false);
        line('Office: ' + A.settings.Office + '    ASC / surgery center: ' + A.settings.ASC + '    Unspecified: ' + A.settings.Unspecified, 10.5, false);
        line('Total wRVU: ' + fmt(A.totalW) + (A.anyT ? ('    Total RVU: ' + fmt(A.totalT) + '    Est. Medicare $: ' + money(A.totalD) + ' (CF ' + money(cf()) + ', GPCI 1.0)') : ''), 10.5, false);
        y += 8;

        if (!A.total) {
          line('No procedures in this range.', 11, true, [120, 120, 120]);
          footer(); doc.save('ProcedureReport_' + STATE.range.from + '_' + STATE.range.to + '.pdf'); toast('Saved PDF'); return;
        }

        // by-type table (manual columns)
        line('BY PROCEDURE TYPE (CPT)', 12, true, [21, 95, 179]); y += 4;
        var cols = [margin, margin + 52, margin + 250, margin + 296, margin + 340, margin + 392, margin + 452];
        function rowCells(cells, bold, color) {
          ensure(lineH); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9);
          doc.setTextColor.apply(doc, color || [40, 52, 74]);
          doc.text(pdfSafe(cells[0]), cols[0], y);
          doc.text(doc.splitTextToSize(pdfSafe(cells[1]), 190)[0] || '', cols[1], y);
          [0, 1, 2, 3, 4].forEach(function (i) { doc.text(pdfSafe(cells[i + 2]), cols[i + 2], y, { align: 'right' }); });
          y += lineH;
        }
        rowCells(['CPT', 'Type', 'Cnt', 'Off', 'ASC', 'wRVU', 'Est.$'], true, [51, 80, 126]);
        doc.setDrawColor(200); doc.setLineWidth(0.5); doc.line(margin, y - lineH + 3, pageW - margin, y - lineH + 3);
        A.codeRows.forEach(function (r) {
          rowCells([r.code || '-', r.name, String(r.count), String(r.settings.Office || 0), String(r.settings.ASC || 0), fmt(r.w), r.t ? money(r.t * cf()).replace('$', '') : '-'], false);
        });
        rowCells(['TOTAL', '', String(A.total), String(A.settings.Office), String(A.settings.ASC), fmt(A.totalW), A.anyT ? money(A.totalD).replace('$', '') : '-'], true, [21, 95, 179]);
        y += 10;

        if (A.catRows.length > 1) {
          line('BY CATEGORY', 12, true, [21, 95, 179]); y += 4;
          A.catRows.forEach(function (r) { line('- ' + r.cat + ' — ' + r.count + ' (' + fmt(r.w) + ' wRVU' + (r.t ? ', ' + money(r.t * cf()) : '') + ')', 9.5, false); });
        }

        footer();
        doc.save('ProcedureReport_' + STATE.range.from + '_' + STATE.range.to + '.pdf');
        toast('Saved PDF');
      } catch (e) { toast('Could not build the PDF.'); }
    }, function () { toast('PDF library unavailable.'); });
  }

  /* ------------------------------------------------------------------- toast/UI */
  function toast(msg) {
    try { if (isFn(window.toast)) { window.toast(msg); return; } } catch (e) {}
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#204034;color:#fff;padding:9px 16px;border-radius:9px;font-size:13px;z-index:2147483600;box-shadow:0 4px 14px rgba(0,0,0,.25)';
      document.body.appendChild(t);
      setTimeout(function () { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 420); }, 1800);
    } catch (e) {}
  }

  /* ---------------------------------------------------------------------- mount */
  function mount() {
    var view = document.getElementById('analysisView'); if (!view) return;
    injectCSS();
    var host = document.getElementById('mlsProcReport');
    if (!host) {
      host = document.createElement('div'); host.id = 'mlsProcReport'; host.className = 'card';
      view.insertBefore(host, view.firstChild);
      render(host);
    }
  }

  function start() {
    try {
      mount();
      var t = null;
      var mo = new MutationObserver(function () {
        if (t) return;
        t = setTimeout(function () { t = null; safe(mount); }, 200);
      });
      try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
      var n = 0, iv = setInterval(function () { safe(mount); if (++n > 25) clearInterval(iv); }, 600);
    } catch (e) {}
  }

  // public API (also used by the offline test harness)
  window.__mlsProcReport = {
    __installed: true,
    mount: mount,
    aggregate: aggregate,
    presetRange: presetRange,
    getSetting: getSetting,
    setSetting: setSetting,
    _isProcedureVisit: isProcedureVisit,
    _primaryProc: primaryProc,
    _procCodes: procCodes,
    _category: category,
    _humanName: humanName,
    _svcToYMD: svcToYMD,
    _state: function () { return STATE; },
    exportCSV: exportCSV,
    exportPDF: exportPDF,
    _buildHTML: buildHTML,
    _buildCSV: buildCSV
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
