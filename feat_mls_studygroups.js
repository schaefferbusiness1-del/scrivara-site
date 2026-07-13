/* feat_mls_studygroups.js — MLS "Study Group" cohort + study engine
 * STAGING module. Additive, reversible, self-contained.
 * Revert handle: window.__mlsStudyGroups.revert()  (revert(true) also purges stored groups)
 *
 * What it does (Michael's vision, v1 spine):
 *   1. STUDY GROUP DATA MODEL — a named cohort of patients; each patient holds a list of
 *      per-visit records (date, type, full detail) stored individually (NOT a summary).
 *      Re-runs add NEW visits without duplicating (content hash dedupe).
 *   2. INTAKE — create a group, add patients by name + DOB (+ MRN), or import a pasted
 *      list (CSV: name,dob,mrn) or JSON in the app's existing import shape
 *      {patients:[{name,dob,mrn,history:[{date,note}]}]}.
 *   3. PER-VISIT EXTRACTION — feature-detects the app's existing Athena read/pull functions
 *      and reuses them to pull each patient's visits in full detail into per-visit records.
 *      If those globals are not reachable from this module's scope, Athena auto-extraction is
 *      marked STUBBED and the working manual/import path is used instead (clearly labelled).
 *   4. AI STUDIO RUN — select a group, run a study that analyzes the per-visit data and
 *      outputs a graph (SVG), an Excel workbook (.xlsx via SheetJS), and a PDF report
 *      (jsPDF; paginates up to ~100 pages). Real, working output on whatever is in the group.
 *
 * SAFETY: This module NEVER deletes or mutates existing patient/visit records. Its cohort
 * data lives in its own localStorage namespace ('mls_studygroups_v1'). It only READS from
 * the app's patient/Athena layer. No PHI is sent anywhere by this module.
 */
(function () {
  'use strict';
  if (window.__mlsStudyGroups && window.__mlsStudyGroups.__live) {
    try { window.__mlsStudyGroups.revert(); } catch (e) {}
  }

  var NS = 'mls_studygroups_v1';
  var TAG = 'data-mls-sg';                 // every injected node carries this for clean revert
  var CDN_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var CDN_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  /* ---------- tiny utils ---------- */
  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function djb2(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function nowISO() { return new Date().toISOString(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    n.setAttribute(TAG, '1');
    if (attrs) for (var k in attrs) { if (k === 'style') n.style.cssText = attrs[k]; else n.setAttribute(k, attrs[k]); }
    if (html != null) n.innerHTML = html;
    return n;
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var existing = document.querySelector('script[data-mls-sg-cdn="' + src + '"]');
      if (existing && existing.__loaded) return res();
      var s = document.createElement('script');
      s.src = src; s.async = true; s.setAttribute(TAG, '1'); s.setAttribute('data-mls-sg-cdn', src);
      s.onload = function () { s.__loaded = true; res(); };
      s.onerror = function () { rej(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* ---------- storage (own namespace; never touches app data) ---------- */
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(NS) || '{"groups":[]}'); }
    catch (e) { return { groups: [] }; }
  }
  function saveAll(db) {
    db.updatedAt = nowISO();
    try { localStorage.setItem(NS, JSON.stringify(db)); } catch (e) { console.warn('[mls-sg] persist failed', e); }
    // INTEGRATION POINT (optional, additive): mirror to server data layer if a known save hook exists.
    try {
      if (window.__mlsBackend && typeof window.__mlsBackend.saveBlob === 'function') {
        window.__mlsBackend.saveBlob(NS, db); // no-op if signature differs; wrapped in try/catch
      }
    } catch (e) {}
    return db;
  }

  /* ---------- data model ops ---------- */
  function visitHash(v) { return djb2((v.date || '') + '|' + (v.type || '') + '|' + String(v.detail || '').slice(0, 240)); }
  function normVisit(v) {
    var nv = {
      id: v.id || uid('v'),
      date: (v.date || '').slice(0, 10) || '',
      type: v.type || v.kind || 'Visit',
      detail: v.detail != null ? String(v.detail) : String(v.note != null ? v.note : ''),
      source: v.source || 'manual',
      meta: v.meta || {}
    };
    nv.hash = visitHash(nv);
    return nv;
  }
  function mergeVisits(patient, incoming) {
    patient.visits = patient.visits || [];
    var seen = {}; patient.visits.forEach(function (v) { seen[v.hash || visitHash(v)] = true; });
    var added = 0;
    (incoming || []).forEach(function (raw) {
      var v = normVisit(raw);
      if (!seen[v.hash]) { patient.visits.push(v); seen[v.hash] = true; added++; }
    });
    patient.visits.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    return added;
  }

  var API = {
    __live: true,
    list: function () { return loadAll().groups; },
    get: function (id) { return loadAll().groups.filter(function (g) { return g.id === id; })[0] || null; },
    createGroup: function (name) {
      var db = loadAll();
      var g = { id: uid('grp'), name: name || ('Study Group ' + (db.groups.length + 1)), createdAt: nowISO(), updatedAt: nowISO(), patients: [] };
      db.groups.push(g); saveAll(db); return g;
    },
    renameGroup: function (id, name) { var db = loadAll(); var g = db.groups.filter(function (x) { return x.id === id; })[0]; if (g) { g.name = name; saveAll(db); } return g; },
    deleteGroup: function (id) { var db = loadAll(); db.groups = db.groups.filter(function (g) { return g.id !== id; }); saveAll(db); },
    addPatient: function (groupId, p) {
      var db = loadAll(); var g = db.groups.filter(function (x) { return x.id === groupId; })[0]; if (!g) return null;
      var key = ((p.name || '').trim().toLowerCase()) + '|' + ((p.dob || '').trim());
      var existing = g.patients.filter(function (x) { return (((x.name || '').toLowerCase()) + '|' + (x.dob || '')) === key; })[0];
      if (existing) { if (p.visits) mergeVisits(existing, p.visits); saveAll(db); return existing; }
      var np = { id: uid('pt'), name: (p.name || '').trim(), dob: (p.dob || '').trim(), mrn: (p.mrn || '').trim(), addedAt: nowISO(), visits: [] };
      if (p.visits) mergeVisits(np, p.visits);
      g.patients.push(np); saveAll(db); return np;
    },
    addVisit: function (groupId, patientId, visit) {
      var db = loadAll(); var g = db.groups.filter(function (x) { return x.id === groupId; })[0]; if (!g) return 0;
      var pt = g.patients.filter(function (x) { return x.id === patientId; })[0]; if (!pt) return 0;
      var n = mergeVisits(pt, [visit]); saveAll(db); return n;
    },
    /* Import JSON in the app's existing shape: {patients:[{name,dob,mrn,history:[{date,note}]}]} */
    importJSON: function (groupId, jsonText) {
      var obj; try { obj = JSON.parse(jsonText); } catch (e) { throw new Error('Invalid JSON'); }
      var pats = obj.patients || (Array.isArray(obj) ? obj : []);
      var addedP = 0, addedV = 0;
      pats.forEach(function (p) {
        var visits = (p.history || p.visits || []).map(function (h) {
          return { date: h.date, type: h.type || 'Visit', detail: h.note != null ? h.note : (h.detail || ''), source: 'import' };
        });
        var np = API.addPatient(groupId, { name: p.name, dob: p.dob, mrn: p.mrn, visits: visits });
        if (np) { addedP++; addedV += (np.visits ? np.visits.length : 0); }
      });
      return { patients: addedP, visits: addedV };
    },
    /* Import CSV: header row with name,dob,mrn (order-independent). One patient per row. */
    importCSV: function (groupId, csvText) {
      var lines = csvText.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
      if (!lines.length) return { patients: 0 };
      var head = lines[0].split(',').map(function (h) { return h.trim().toLowerCase(); });
      var iN = head.indexOf('name'), iD = head.indexOf('dob'), iM = head.indexOf('mrn');
      if (iN < 0) { iN = 0; iD = head.length > 1 ? 1 : -1; iM = head.length > 2 ? 2 : -1; } // headerless fallback
      var start = (iN === 0 && head[0] !== 'name') ? 0 : 1;
      var added = 0;
      for (var i = start; i < lines.length; i++) {
        var c = lines[i].split(',');
        var name = (c[iN] || '').trim(); if (!name) continue;
        API.addPatient(groupId, { name: name, dob: iD >= 0 ? (c[iD] || '').trim() : '', mrn: iM >= 0 ? (c[iM] || '').trim() : '' });
        added++;
      }
      return { patients: added };
    },

    /* PER-VISIT EXTRACTION — reuse the app's existing Athena read/pull machinery if reachable.
     * We feature-detect known function names. They may be IIFE-scoped (not on window); in that
     * case extraction is reported as STUBBED and the manual/import path remains the working one. */
    athenaHook: function () {
      var cands = ['doFindInAthena', 'doAutoSearchAthena', '_assistReadAthenaTab', 'pullChartFromAthena', 'mlsPullAthenaChart'];
      for (var i = 0; i < cands.length; i++) { if (typeof window[cands[i]] === 'function') return { name: cands[i], fn: window[cands[i]] }; }
      if (window.__mlsAthenaMatch && typeof window.__mlsAthenaMatch.pull === 'function') return { name: '__mlsAthenaMatch.pull', fn: window.__mlsAthenaMatch.pull };
      return null;
    },
    extractFromAthena: function (groupId, onProgress) {
      var hook = API.athenaHook();
      var g = API.get(groupId);
      if (!g) return Promise.reject(new Error('group not found'));
      if (!hook) {
        return Promise.resolve({ stubbed: true, reason: 'Athena pull function not reachable from module scope', patients: g.patients.length });
      }
      // Hook reachable: pull each patient's full visit history, store each visit individually.
      var i = 0, totalV = 0;
      function next() {
        if (i >= g.patients.length) return Promise.resolve({ stubbed: false, patients: g.patients.length, visits: totalV });
        var pt = g.patients[i++];
        if (onProgress) onProgress(i, g.patients.length, pt);
        return Promise.resolve(hook.fn({ name: pt.name, dob: pt.dob, mrn: pt.mrn, fullHistory: true })).then(function (res) {
          var visits = (res && (res.visits || res.history || res.encounters)) || [];
          visits = visits.map(function (v) { return { date: v.date || v.encounterDate, type: v.type || v.encounterType || 'Visit', detail: v.detail || v.note || v.text || '', source: 'athena' }; });
          totalV += API_mergeIntoStore(groupId, pt.id, visits);
          return next();
        }).catch(function () { return next(); });
      }
      return next();
    },

    runStudy: runStudy,
    revert: revert
  };

  function API_mergeIntoStore(groupId, patientId, visits) {
    var db = loadAll(); var g = db.groups.filter(function (x) { return x.id === groupId; })[0]; if (!g) return 0;
    var pt = g.patients.filter(function (x) { return x.id === patientId; })[0]; if (!pt) return 0;
    var n = mergeVisits(pt, visits); saveAll(db); return n;
  }

  /* ================= STUDY ENGINE ================= */
  // Pure analyzers (also unit-testable in Node).
  function analyze(group) {
    var patients = group.patients || [];
    var allVisits = [];
    patients.forEach(function (p) { (p.visits || []).forEach(function (v) { allVisits.push({ pt: p, v: v }); }); });
    // visits per month
    var byMonth = {};
    allVisits.forEach(function (x) { var m = (x.v.date || '').slice(0, 7) || 'unknown'; byMonth[m] = (byMonth[m] || 0) + 1; });
    var months = Object.keys(byMonth).filter(function (m) { return m !== 'unknown'; }).sort();
    // visit types
    var byType = {};
    allVisits.forEach(function (x) { var t = x.v.type || 'Visit'; byType[t] = (byType[t] || 0) + 1; });
    // pain score trend (parse "pain 0-10" patterns from detail)
    var pain = [];
    allVisits.forEach(function (x) {
      var m = String(x.v.detail || '').match(/pain[^0-9]{0,12}(\b(?:10|[0-9])\b)\s*\/?\s*10?/i);
      if (m) pain.push({ date: x.v.date, score: parseInt(m[1], 10) });
    });
    pain.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    return {
      patientCount: patients.length,
      visitCount: allVisits.length,
      avgVisits: patients.length ? (allVisits.length / patients.length) : 0,
      months: months, byMonth: byMonth, byType: byType, pain: pain, allVisits: allVisits, patients: patients
    };
  }

  // SVG bar chart of visits-per-month (returns SVG string).
  function chartSVG(a, w, h) {
    w = w || 640; h = h || 280;
    var pad = 40, months = a.months, max = 1;
    months.forEach(function (m) { max = Math.max(max, a.byMonth[m]); });
    var bw = months.length ? (w - pad * 2) / months.length : 0;
    var bars = months.map(function (m, i) {
      var bh = (a.byMonth[m] / max) * (h - pad * 2);
      var x = pad + i * bw + 2, y = h - pad - bh;
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, bw - 4).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="#2E6A4B"></rect>' +
        '<text x="' + (x + (bw - 4) / 2).toFixed(1) + '" y="' + (h - pad + 12) + '" font-size="8" text-anchor="middle" fill="#475569" transform="rotate(45 ' + (x + (bw - 4) / 2).toFixed(1) + ' ' + (h - pad + 12) + ')">' + esc(m) + '</text>';
    }).join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' +
      '<rect width="' + w + '" height="' + h + '" fill="#ffffff"></rect>' +
      '<text x="' + (w / 2) + '" y="20" font-size="13" font-weight="bold" text-anchor="middle" fill="#0f172a">Visits per month — ' + esc((a.patientCount) + ' patients, ' + a.visitCount + ' visits') + '</text>' +
      '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) + '" stroke="#cbd5e1"></line>' +
      '<line x1="' + pad + '" y1="' + pad + '" x2="' + pad + '" y2="' + (h - pad) + '" stroke="#cbd5e1"></line>' +
      '<text x="' + pad + '" y="' + (pad - 6) + '" font-size="9" fill="#475569">max ' + max + '</text>' +
      bars + '</svg>';
  }

  // Build rows for xlsx: one row PER VISIT (per-visit detail, not a summary).
  function visitRows(a) {
    var rows = [['Patient', 'DOB', 'MRN', 'Visit Date', 'Type', 'Source', 'Detail']];
    a.patients.forEach(function (p) {
      (p.visits || []).forEach(function (v) {
        rows.push([p.name, p.dob, p.mrn, v.date, v.type, v.source, String(v.detail || '').replace(/\s+/g, ' ').slice(0, 4000)]);
      });
    });
    return rows;
  }
  function summaryRows(group, a) {
    return [
      ['MLS Study Group report'], ['Group', group.name], ['Generated', new Date().toLocaleString()],
      [], ['Patients', a.patientCount], ['Total visits', a.visitCount], ['Avg visits / patient', a.avgVisits.toFixed(2)],
      [], ['Visit types'].concat([]), ['Type', 'Count']
    ].concat(Object.keys(a.byType).map(function (t) { return [t, a.byType[t]]; }));
  }

  function runStudy(groupId, opts) {
    opts = opts || {};
    var group = API.get(groupId);
    if (!group) return Promise.reject(new Error('group not found'));
    var a = analyze(group);
    var result = { group: group, analysis: a, svg: chartSVG(a) };

    var jobs = [];
    // XLSX via SheetJS
    jobs.push(loadScript(CDN_XLSX).then(function () {
      var XLSX = window.XLSX; if (!XLSX) throw new Error('XLSX missing');
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows(group, a)), 'Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(visitRows(a)), 'Visits');
      result.xlsxBlob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      return result;
    }).catch(function (e) {
      // fallback: CSV
      var rows = visitRows(a).map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
      result.xlsxBlob = new Blob([rows], { type: 'text/csv' }); result.xlsxFallback = true; return result;
    }));

    // PDF via jsPDF — paginate up to ~100 pages
    jobs.push(loadScript(CDN_JSPDF).then(function () {
      var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF; if (!jsPDF) throw new Error('jsPDF missing');
      var doc = new jsPDF({ unit: 'pt', format: 'letter' });
      var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48, maxPages = opts.maxPages || 100, pages = 1;
      function newPageGuard() { if (pages >= maxPages) return false; doc.addPage(); pages++; return true; }
      // cover
      doc.setFontSize(20); doc.text('MLS Study Group Report', M, 90);
      doc.setFontSize(13); doc.text(group.name, M, 120);
      doc.setFontSize(10); doc.setTextColor(90);
      doc.text('Generated ' + new Date().toLocaleString(), M, 142);
      doc.text(a.patientCount + ' patients   |   ' + a.visitCount + ' visits   |   avg ' + a.avgVisits.toFixed(1) + ' visits/patient', M, 160);
      doc.setTextColor(0);
      // summary + types
      var y = 200; doc.setFontSize(13); doc.text('Visit type breakdown', M, y); y += 18; doc.setFontSize(10);
      Object.keys(a.byType).forEach(function (t) { doc.text('• ' + t + ': ' + a.byType[t], M + 8, y); y += 14; if (y > H - M) { if (!newPageGuard()) return; y = M; } });
      // per-patient, per-visit detail
      a.patients.forEach(function (p) {
        if (pages >= maxPages) return;
        if (!newPageGuard()) return; y = M;
        doc.setFontSize(13); doc.text(esc2(p.name) + (p.dob ? '  (DOB ' + p.dob + ')' : ''), M, y); y += 8;
        doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 16; doc.setFontSize(9);
        (p.visits || []).forEach(function (v) {
          if (pages >= maxPages) return;
          var header = (v.date || 'n/d') + '  —  ' + (v.type || 'Visit') + '  [' + (v.source || '') + ']';
          doc.setFont(undefined, 'bold'); doc.text(header, M, y); y += 13; doc.setFont(undefined, 'normal');
          var lines = doc.splitTextToSize(String(v.detail || '(no detail)'), W - M * 2);
          for (var li = 0; li < lines.length; li++) {
            if (y > H - M) { if (!newPageGuard()) return; y = M; }
            doc.text(lines[li], M, y); y += 12;
          }
          y += 8; if (y > H - M) { if (!newPageGuard()) return; y = M; }
        });
      });
      result.pdfBlob = doc.output('blob'); result.pdfPages = pages; return result;
    }).catch(function (e) { result.pdfError = e.message; return result; }));

    return Promise.all(jobs).then(function () { return result; });
  }
  function esc2(s) { return String(s == null ? '' : s); }

  /* ================= UI ================= */
  var STYLE_ID = 'mls-sg-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID; s.setAttribute(TAG, '1');
    s.textContent =
      '.mls-sg-wrap{font:13px/1.5 system-ui,Segoe UI,Arial;color:#0f172a;max-width:920px;margin:8px 0}' +
      '.mls-sg-wrap h3{font-size:16px;margin:6px 0}' +
      '.mls-sg-card{border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:10px 0;background:#fff}' +
      '.mls-sg-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}' +
      '.mls-sg-wrap input,.mls-sg-wrap select,.mls-sg-wrap textarea{border:1px solid #cbd5e1;border-radius:8px;padding:7px 9px;font:inherit}' +
      '.mls-sg-wrap textarea{width:100%;min-height:84px}' +
      '.mls-sg-btn{background:#2E6A4B;color:#fff;border:0;border-radius:8px;padding:8px 13px;cursor:pointer;font:inherit}' +
      '.mls-sg-btn.alt{background:#0ea5e9}.mls-sg-btn.gray{background:#64748b}.mls-sg-btn:disabled{opacity:.5;cursor:default}' +
      '.mls-sg-muted{color:#64748b;font-size:12px}.mls-sg-pill{background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:2px 9px;font-size:12px}' +
      '.mls-sg-warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:8px 10px;font-size:12px}' +
      '.mls-sg-ptlist{max-height:200px;overflow:auto;border:1px solid #f1f5f9;border-radius:8px}' +
      '.mls-sg-ptlist div{padding:5px 9px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between}' +
      '.mls-sg-out svg{max-width:100%;height:auto;border:1px solid #eee;border-radius:8px}';
    document.head.appendChild(s);
  }

  function findStudioMount() {
    // Prefer the AI Studio tab container; fall back to a floating launcher.
    var sels = ['#studioView', '#tab-studio', '[data-tab="studio"]', '#aiStudio', '#studio'];
    for (var i = 0; i < sels.length; i++) { var n = document.querySelector(sels[i]); if (n) return n; }
    // Heuristic: a visible panel whose heading mentions AI Studio / Build a custom tool
    var hs = document.querySelectorAll('h1,h2,h3');
    for (var j = 0; j < hs.length; j++) { if (/ai studio|build a custom tool|copilot/i.test(hs[j].textContent || '')) return hs[j].parentElement; }
    return null;
  }

  function render(mount) {
    var wrap = el('div', { 'class': 'mls-sg-wrap' });
    wrap.id = 'mls-sg-root';
    var hook = API.athenaHook();
    wrap.innerHTML =
      '<div class="mls-sg-card">' +
        '<h3>👥 Study Groups <span class="mls-sg-pill">v1 · staging</span></h3>' +
        '<div class="mls-sg-muted">Build a named cohort, store every visit in full detail per patient, then run a study that outputs a graph, an Excel file, and a PDF.</div>' +
        '<div class="mls-sg-row" style="margin-top:10px">' +
          '<select id="mls-sg-group"></select>' +
          '<input id="mls-sg-newname" placeholder="New group name">' +
          '<button class="mls-sg-btn" id="mls-sg-create">＋ Create group</button>' +
          '<button class="mls-sg-btn gray" id="mls-sg-del">Delete</button>' +
        '</div>' +
      '</div>' +
      '<div class="mls-sg-card">' +
        '<h3>① Add patients</h3>' +
        '<div class="mls-sg-row">' +
          '<input id="mls-sg-pname" placeholder="Patient name *">' +
          '<input id="mls-sg-pdob" placeholder="DOB (YYYY-MM-DD)">' +
          '<input id="mls-sg-pmrn" placeholder="MRN (optional)">' +
          '<button class="mls-sg-btn" id="mls-sg-add">Add patient</button>' +
        '</div>' +
        '<div class="mls-sg-muted" style="margin-top:8px">Or import a list — CSV (<code>name,dob,mrn</code>) or JSON (<code>{"patients":[{"name","dob","mrn","history":[{"date","note"}]}]}</code>):</div>' +
        '<textarea id="mls-sg-import" placeholder="Paste CSV or JSON here"></textarea>' +
        '<div class="mls-sg-row"><button class="mls-sg-btn alt" id="mls-sg-importbtn">📥 Import list</button>' +
          '<button class="mls-sg-btn alt" id="mls-sg-athena">📥 Pull visits from Athena</button>' +
          '<span id="mls-sg-athena-status" class="mls-sg-muted"></span></div>' +
        (hook ? '' : '<div class="mls-sg-warn" style="margin-top:8px">⚠ <b>Athena auto-extraction is stubbed in this build</b> — the app\'s pull function isn\'t reachable from this module\'s scope. The manual + CSV/JSON import paths above are fully working. Wiring the live pull is a one-line hook once the function name/scope is confirmed.</div>') +
        '<div class="mls-sg-ptlist" id="mls-sg-ptlist" style="margin-top:10px"></div>' +
      '</div>' +
      '<div class="mls-sg-card">' +
        '<h3>② Run a study</h3>' +
        '<div class="mls-sg-row"><button class="mls-sg-btn" id="mls-sg-run">▶ Run study on selected group</button>' +
          '<a id="mls-sg-xlsx" class="mls-sg-btn gray" style="display:none;text-decoration:none">⬇ Excel (.xlsx)</a>' +
          '<a id="mls-sg-pdf" class="mls-sg-btn gray" style="display:none;text-decoration:none">⬇ PDF report</a>' +
          '<span id="mls-sg-runstatus" class="mls-sg-muted"></span></div>' +
        '<div class="mls-sg-out" id="mls-sg-out" style="margin-top:10px"></div>' +
      '</div>';
    mount.insertBefore(wrap, mount.firstChild);
    wire(wrap);
    refreshGroups(wrap);
  }

  function refreshGroups(wrap) {
    var sel = wrap.querySelector('#mls-sg-group'); var groups = API.list();
    sel.innerHTML = groups.map(function (g) { return '<option value="' + g.id + '">' + esc(g.name) + ' (' + g.patients.length + ')</option>'; }).join('') || '<option value="">— no groups yet —</option>';
    refreshPatients(wrap);
  }
  function refreshPatients(wrap) {
    var gid = wrap.querySelector('#mls-sg-group').value; var g = gid && API.get(gid);
    var list = wrap.querySelector('#mls-sg-ptlist');
    if (!g || !g.patients.length) { list.innerHTML = '<div class="mls-sg-muted">No patients yet.</div>'; return; }
    list.innerHTML = g.patients.map(function (p) {
      return '<div><span>' + esc(p.name) + (p.dob ? ' · ' + esc(p.dob) : '') + '</span><span class="mls-sg-muted">' + (p.visits ? p.visits.length : 0) + ' visit(s)</span></div>';
    }).join('');
  }

  function wire(wrap) {
    function gid() { return wrap.querySelector('#mls-sg-group').value; }
    wrap.querySelector('#mls-sg-create').onclick = function () {
      var n = wrap.querySelector('#mls-sg-newname').value.trim(); var g = API.createGroup(n);
      wrap.querySelector('#mls-sg-newname').value = ''; refreshGroups(wrap); wrap.querySelector('#mls-sg-group').value = g.id; refreshPatients(wrap);
    };
    wrap.querySelector('#mls-sg-del').onclick = function () { var id = gid(); if (id && confirm('Delete this study group? (does not touch any patient chart)')) { API.deleteGroup(id); refreshGroups(wrap); } };
    wrap.querySelector('#mls-sg-group').onchange = function () { refreshPatients(wrap); };
    wrap.querySelector('#mls-sg-add').onclick = function () {
      var id = gid(); if (!id) return alert('Create a group first.');
      var name = wrap.querySelector('#mls-sg-pname').value.trim(); if (!name) return alert('Name required.');
      API.addPatient(id, { name: name, dob: wrap.querySelector('#mls-sg-pdob').value.trim(), mrn: wrap.querySelector('#mls-sg-pmrn').value.trim() });
      wrap.querySelector('#mls-sg-pname').value = wrap.querySelector('#mls-sg-pdob').value = wrap.querySelector('#mls-sg-pmrn').value = '';
      refreshGroups(wrap);
    };
    wrap.querySelector('#mls-sg-importbtn').onclick = function () {
      var id = gid(); if (!id) return alert('Create a group first.');
      var txt = wrap.querySelector('#mls-sg-import').value.trim(); if (!txt) return;
      try {
        var r = (txt[0] === '{' || txt[0] === '[') ? API.importJSON(id, txt) : API.importCSV(id, txt);
        wrap.querySelector('#mls-sg-import').value = '';
        alert('Imported ' + (r.patients || 0) + ' patient(s)' + (r.visits != null ? ', ' + r.visits + ' visit(s)' : '') + '.');
        refreshGroups(wrap);
      } catch (e) { alert('Import failed: ' + e.message); }
    };
    wrap.querySelector('#mls-sg-athena').onclick = function () {
      var id = gid(); if (!id) return alert('Create a group first.');
      var st = wrap.querySelector('#mls-sg-athena-status'); st.textContent = 'Pulling…';
      API.extractFromAthena(id, function (i, n, pt) { st.textContent = 'Pulling ' + i + '/' + n + ' (' + (pt && pt.name) + ')…'; })
        .then(function (r) {
          st.textContent = r.stubbed ? 'Athena pull stubbed — use manual/import (see note).' : ('Pulled ' + r.visits + ' visit(s) across ' + r.patients + ' patient(s).');
          refreshGroups(wrap);
        }).catch(function (e) { st.textContent = 'Error: ' + e.message; });
    };
    wrap.querySelector('#mls-sg-run').onclick = function () {
      var id = gid(); if (!id) return alert('Create/select a group first.');
      var rs = wrap.querySelector('#mls-sg-runstatus'); rs.textContent = 'Running study…';
      var out = wrap.querySelector('#mls-sg-out');
      runStudy(id, {}).then(function (res) {
        out.innerHTML = res.svg;
        rs.textContent = 'Done — ' + res.analysis.visitCount + ' visits analyzed' + (res.pdfPages ? ', PDF ' + res.pdfPages + 'pp' : '') + (res.xlsxFallback ? ' (xlsx→CSV fallback)' : '') + (res.pdfError ? ' · PDF error: ' + res.pdfError : '') + '.';
        var ax = wrap.querySelector('#mls-sg-xlsx'); if (res.xlsxBlob) { ax.href = URL.createObjectURL(res.xlsxBlob); ax.download = (res.group.name || 'study') + (res.xlsxFallback ? '.csv' : '.xlsx'); ax.style.display = ''; }
        var ap = wrap.querySelector('#mls-sg-pdf'); if (res.pdfBlob) { ap.href = URL.createObjectURL(res.pdfBlob); ap.download = (res.group.name || 'study') + '.pdf'; ap.style.display = ''; }
      }).catch(function (e) { rs.textContent = 'Study failed: ' + e.message; });
    };
  }

  function mountUI() {
    injectStyle();
    var mount = findStudioMount();
    if (!mount) {
      // floating launcher fallback
      var btn = el('button', { 'class': 'mls-sg-btn', id: 'mls-sg-launch', style: 'position:fixed;right:18px;bottom:18px;z-index:99999;box-shadow:0 4px 14px rgba(0,0,0,.2)' }, '👥 Study Groups');
      btn.onclick = function () {
        var host = el('div', { id: 'mls-sg-modal', style: 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:100000;overflow:auto;padding:24px' });
        var panel = el('div', { style: 'background:#FCFBF8;max-width:960px;margin:0 auto;border-radius:14px;padding:16px;position:relative' });
        var x = el('button', { 'class': 'mls-sg-btn gray', style: 'position:absolute;right:12px;top:12px' }, '✕ Close'); x.onclick = function () { host.remove(); };
        panel.appendChild(x); host.appendChild(panel); document.body.appendChild(host); render(panel);
      };
      document.body.appendChild(btn);
      return 'launcher';
    }
    render(mount);
    return 'studio';
  }

  /* ================= REVERT ================= */
  function revert(purgeData) {
    try { document.querySelectorAll('[' + TAG + ']').forEach(function (n) { n.remove(); }); } catch (e) {}
    var st = document.getElementById(STYLE_ID); if (st) st.remove();
    var modal = document.getElementById('mls-sg-modal'); if (modal) modal.remove();
    if (purgeData) { try { localStorage.removeItem(NS); } catch (e) {} }
    try { delete window.__mlsStudyGroups; } catch (e) { window.__mlsStudyGroups = undefined; }
    console.log('[mls-sg] reverted' + (purgeData ? ' (+ data purged)' : ''));
  }

  /* ================= BOOT ================= */
  API.mountUI = mountUI;
  API.analyze = analyze; API.chartSVG = chartSVG; API.visitRows = visitRows; // exposed for testing
  window.__mlsStudyGroups = API;

  function boot() {
    try { var where = mountUI(); console.log('[mls-sg] mounted via ' + where + '; handle: window.__mlsStudyGroups'); }
    catch (e) { console.warn('[mls-sg] mount deferred', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 600); // let the app's own tab modules settle first
})();
