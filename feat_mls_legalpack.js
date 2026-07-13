/* ============================================================================
   MLS — feat_mls_legalpack.js — __mlsLegalPack lp-1.0.0
   Task 13: Legal Request / Full-History Workflow (patient search, "Pull
            Complete Patient History", provider filtering, categorized
            chronology: visits, procedure & op notes, imaging, diagnoses,
            treatment plans, follow-ups, uploaded records, outside records).
   Task 14: Medical-Legal Narrative Generator (13 fixed sections + optional
            counsel-questions section; inputs: chart record, prior visits,
            procedure notes, uploaded PDF / Word / image / scan files,
            custom questions; output is doctor-editable and can be handed to
            the existing Legal tool for sign / PDF / save-to-chart).

   HARD PROPERTIES
   - ADDITIVE + GUARDED: own IIFE, everything in try/catch, wraps nothing.
   - READ-ONLY on patient data: never calls upsertPatient / savePatients /
     any mlsApp* bridge; builds views and text exports only.
   - DRAFT-ONLY: narrative output carries the DRAFT banner; signing runs
     through the app's existing signLegalReport flow (local, never sent).
   - NO athena interaction of any kind. NO extension messages.
   - HONEST: empty states say so; unattributed providers are shown as
     "Unattributed", never guessed; truncation is labelled; nothing invented.
   - revert(): window.__mlsLegalPack.revert() removes all UI + style.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__mlsLegalPack && window.__mlsLegalPack.installed) return;
  var VERSION = 'lp-1.0.0';

  /* ---------------- small utils ---------------- */
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function say(m, k) { try { if (isFn(window.toast)) window.toast(m, k || ''); } catch (e) {} }
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  /* normalize many date shapes to YYYY-MM-DD ('' when unknown — never invented) */
  function ymd(v) {
    try {
      if (v == null || v === '') return '';
      if (typeof v === 'number') { var dn = new Date(v); return isNaN(dn) ? '' : dn.getFullYear() + '-' + pad2(dn.getMonth() + 1) + '-' + pad2(dn.getDate()); }
      var s = String(v).trim();
      var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
      m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) return m[3] + '-' + pad2(m[1]) + '-' + pad2(m[2]);
      m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/); if (m) { var yy = +m[3]; return (yy > 40 ? '19' : '20') + pad2(yy) + '-' + pad2(m[1]) + '-' + pad2(m[2]); }
      if (isFn(window._normDate)) { var nd = window._normDate(s); if (nd && /^\d{4}-\d{2}-\d{2}$/.test(nd)) return nd; }
      var d = new Date(s); return isNaN(d) ? '' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    } catch (e) { return ''; }
  }
  function niceDate(y) {
    if (!y) return 'Undated';
    try { var p = y.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return y; }
  }
  function todayYmd() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  /* ---------------- data access (all read-only, all guarded) ---------------- */
  function allPatients() { try { return isFn(window.getPatients) ? (window.getPatients() || []) : []; } catch (e) { return []; } }
  function patientById(id) { var a = allPatients(); for (var i = 0; i < a.length; i++) if (String(a[i].id) === String(id)) return a[i]; return null; }
  function visitsOf(p) {
    try {
      var vm = window.__mlsVisitModel;
      if (vm && isFn(vm.getVisits)) { var vs = vm.getVisits(p); if (vs) return vs; }
    } catch (e) {}
    return (p && Array.isArray(p.visits)) ? p.visits.slice() : [];
  }
  function notesOf(p) { try { return (p && isFn(window.patientNotes)) ? (window.patientNotes(p.id) || []) : []; } catch (e) { return []; } }
  function docsOf(p) { return (p && Array.isArray(p.docs)) ? p.docs.slice() : []; }
  function providerName() { try { return isFn(window.getName) ? (window.getName() || '') : ''; } catch (e) { return ''; } }

  /* provider of an athena visit row: explicit field first, else the raw line
     "<type>\n<MM-DD-YYYY[ h:mm AM]>, <Provider>, <Cred>, <Specialty>" */
  function provOfVisit(v) {
    try {
      if (v && v.provider) return String(v.provider).trim();
      var raw = String((v && (v.raw || v.detail)) || '');
      var lines = raw.split('\n');
      for (var i = 0; i < lines.length && i < 4; i++) {
        var ln = lines[i];
        if (/^\s*\d{2}-\d{2}-\d{4}/.test(ln) || /^\s*\d{1,2}\/\d{1,2}\/\d{2,4}/.test(ln)) {
          var parts = ln.split(',');
          if (parts.length >= 2) {
            var cand = parts[1].trim();
            if (cand && !/^\d/.test(cand)) return cand;
          }
        }
      }
    } catch (e) {}
    return '';
  }

  /* ---------------- categorizer ---------------- */
  var RE_PROC = /\b(operative|op\s?note|operation|procedure|surgery|surgical|injection|epidural|arthroscop|fusion|discectomy|laminectomy|fluoro|nerve\s?block|rfa|ablation|kyphoplasty|vertebroplasty|carpal\s?tunnel\s?release|trigger\s?finger\s?release|synvisc|viscosupplement)/i;
  var RE_IMG = /\b(mri|x-?ray|radiograph|ct\s|ct\b|computed\s?tomograph|ultrasound|sonogra|emg|nerve\s?conduction|ncs\b|dexa|bone\s?scan|myelogram|arthrogram|imaging)\b/i;
  var RE_FU = /\b(follow[\s-]?up|f\/u|return\s+(?:in|to)\s|re-?check|re-?evaluate|next\s+visit)\b/i;
  /* explicit op/procedure-NOTE markers — much stricter than RE_PROC keywords */
  var RE_OPMARK = /\b(operative\s+(?:report|note)|procedure\s+note|procedure\s*(?:\(s\))?\s+performed|description\s+of\s+(?:the\s+)?procedure|operation\s+performed)\b/i;
  var RE_OUTSIDE = /\b(outside|external|referral\s+records|records\s+from|prior\s+records|transferred|another\s+(?:provider|practice|facility)|hospital\s+records|er\s+records|emergency\s+(?:room|department))\b/i;

  /* strip athena "MM-DD-YYYY, Provider, Cred, Specialty" lines so a provider's
     SPECIALTY (e.g. "Orthopedic Surgery") never mis-classifies the row as a procedure */
  function classifiable(type, body) {
    var lines = String(body || '').split('\n').filter(function (ln) {
      return !(/^\s*\d{2}-\d{2}-\d{4}/.test(ln) && ln.indexOf(',') >= 0);
    });
    return String(type || '') + '\n' + lines.join('\n');
  }
  /* group providers without credential suffixes so "M Schaeffer" and
     "M Schaeffer, DO" are ONE filter chip */
  function normProv(s) {
    return String(s || '').replace(/\s*,?\s*(MD|DO|PA-?C?|NP|CRNP|DPT|PT|RN|FNP|APRN)\.?\s*$/i, '').replace(/\s+/g, ' ').trim();
  }

  var CATS = [
    ['visit',   '🩺 Visits & encounters'],
    ['proc',    '🔪 Procedure & operative notes'],
    ['imaging', '🩻 Imaging & diagnostic studies'],
    ['dx',      '🧬 Diagnoses'],
    ['plan',    '📋 Treatment plans'],
    ['fu',      '📅 Follow-ups'],
    ['doc',     '📎 Uploaded records'],
    ['outside', '🏥 Outside records']
  ];
  function catLabel(k) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === k) return CATS[i][1]; return k; }

  /* pull the PLAN section from a SOAP-style note (returns '' if none found) */
  function planOf(text) {
    try {
      var m = String(text || '').match(/(?:^|\n)\s*(?:P\s*[:\-]|PLAN\s*[:\-]?)\s*\n?([\s\S]*?)(?=\n\s*(?:[A-Z][A-Z /&-]{3,}:|S\s*:|O\s*:|A\s*:)|$)/);
      return m ? m[1].trim() : '';
    } catch (e) { return ''; }
  }
  function fuLinesOf(text) {
    var out = [];
    try {
      String(text || '').split('\n').forEach(function (ln) { if (RE_FU.test(ln)) out.push(ln.trim()); });
    } catch (e) {}
    return out;
  }
  function icdOf(coding) {
    var out = [];
    try {
      if (!coding) return out;
      var arr = Array.isArray(coding.icd) ? coding.icd : (Array.isArray(coding.icd10) ? coding.icd10 : null);
      if (arr) { arr.forEach(function (c) { var t = typeof c === 'string' ? c : ((c.code || '') + (c.desc ? ' — ' + c.desc : '')); if (t) out.push(t); }); return out; }
      var txt = isFn(window.codingText) ? window.codingText(coding) : JSON.stringify(coding);
      (String(txt || '').match(/\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b[^\n]*/g) || []).forEach(function (l) { out.push(l.trim()); });
    } catch (e) {}
    return out;
  }

  /* ---------------- Task 13: build the categorized chronology model ----------------
     Returns { patient, items[], providers[], counts{} } — items:
     {ymd, cat, title, provider, source, body}. Read-only. Honest. */
  function buildModel(p) {
    var items = [];
    if (!p) return { patient: null, items: items, providers: [], counts: {} };
    var myName = providerName();

    /* 1) structured visits (Athena reads / imports) */
    visitsOf(p).forEach(function (v) {
      try {
        if (!v) return;
        var body = String(v.detail || v.raw || '').trim();
        var type = String(v.type || v.procedure || 'Visit').trim();
        var prov = provOfVisit(v);
        var src = String(v.source || '') === 'athena-visits' ? 'From Athena (visits pane)'
                : String(v.source || '') === 'import' ? 'Imported record'
                : (v.source ? String(v.source) : 'Stored visit');
        var blob = classifiable(type, body);
        /* the TYPE decides imaging/procedure; prose keywords alone are too weak
           (a follow-up that MENTIONS a prior injection is still a visit) */
        var cat = RE_IMG.test(type) ? 'imaging' : (RE_PROC.test(type) ? 'proc' : (RE_OPMARK.test(blob) ? 'proc' : 'visit'));
        if (RE_OUTSIDE.test(blob)) cat = 'outside';
        items.push({ ymd: ymd(v.date), cat: cat, title: type, provider: prov, source: src, body: body });
        if (v.aiSummary && String(v.aiSummary).trim()) {
          items[items.length - 1].body += (body ? '\n\n' : '') + 'AI summary (AI-generated — verify): ' + String(v.aiSummary).trim();
        }
      } catch (e) {}
    });

    /* 2) MLS visit notes (dictated / generated in this app) */
    notesOf(p).forEach(function (n) {
      try {
        if (!n || n.isDraft) return;
        var when = ymd(n.updated || n.created);
        var soap = String(n.soap || n.text || '').trim();
        var prov = String(n.provider || '').trim() || myName;
        var isOp = RE_OPMARK.test(soap.slice(0, 800));
        items.push({
          ymd: when, cat: isOp ? 'proc' : 'visit',
          title: (isOp ? 'Procedure / operative note' : 'Visit note') + (n.signed ? ' (signed)' : ' (unsigned)'),
          provider: prov, source: 'MLS visit note', body: soap
        });
        var plan = planOf(soap);
        if (plan) items.push({ ymd: when, cat: 'plan', title: 'Treatment plan', provider: prov, source: 'MLS visit note (Plan section)', body: plan });
        fuLinesOf(plan || soap).forEach(function (ln) {
          items.push({ ymd: when, cat: 'fu', title: 'Follow-up (documented)', provider: prov, source: 'MLS visit note', body: ln });
        });
        icdOf(n.coding).forEach(function (dx) {
          items.push({ ymd: when, cat: 'dx', title: dx.split('—')[0].trim() || 'Diagnosis', provider: prov, source: 'Visit coding (ICD-10)', body: dx });
        });
        if (RE_IMG.test(soap)) {
          var imgLines = soap.split('\n').filter(function (l) { return RE_IMG.test(l); }).slice(0, 12);
          if (imgLines.length) items.push({ ymd: when, cat: 'imaging', title: 'Imaging referenced in note', provider: prov, source: 'MLS visit note', body: imgLines.join('\n') });
        }
      } catch (e) {}
    });

    /* 3) problem list → diagnoses (undated — shown honestly as undated) */
    try {
      String(p.problems || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (pr) {
        items.push({ ymd: '', cat: 'dx', title: pr, provider: '', source: 'Problem list', body: pr });
      });
    } catch (e) {}

    /* 4) uploaded documents / outside records */
    docsOf(p).forEach(function (d) {
      try {
        if (!d) return;
        var name = String(d.name || 'Document');
        var text = String(d.text || '').trim();
        var sum = String(d.aiSummary || '').trim();
        var outside = RE_OUTSIDE.test(name + '\n' + text.slice(0, 2000));
        items.push({
          ymd: ymd(d.date), cat: outside ? 'outside' : 'doc',
          title: name + (d.kind === 'image' ? ' (image)' : ''),
          provider: '', source: outside ? 'Uploaded — outside record' : 'Uploaded document',
          body: (sum ? 'AI summary (AI-generated — verify): ' + sum + (text ? '\n\n' : '') : '') + (text ? text.slice(0, 20000) + (text.length > 20000 ? '\n…[truncated for display — full text remains in the document]' : '') : (sum ? '' : '(no extractable text)'))
        });
      } catch (e) {}
    });

    /* 5) scheduled future appointments for this patient → follow-ups */
    try {
      var nm = String(p.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      var today = todayYmd();
      ((window._calAppts || [])).forEach(function (a) {
        var an = String(a.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!an || !nm || (an !== nm && an.indexOf(nm) < 0 && nm.indexOf(an) < 0)) return;
        var ad = ymd(a.appt_date || String(a.start_at || '').slice(0, 10));
        if (!ad || ad <= today) return;
        items.push({ ymd: ad, cat: 'fu', title: 'Scheduled appointment', provider: String(a.provider || a.doctor_name || ''), source: 'MLS calendar', body: (a.reason ? String(a.reason) : 'Scheduled visit') });
      });
    } catch (e) {}

    /* provider roster + counts (credential-normalized so one clinician = one chip) */
    var provs = {}, counts = {};
    items.forEach(function (it) { it.provider = normProv(it.provider); });
    items.forEach(function (it) {
      var pv = (it.provider || '').trim();
      provs[pv || '(unattributed)'] = 1;
      counts[it.cat] = (counts[it.cat] || 0) + 1;
    });
    /* chronological (undated last) */
    items.sort(function (a, b) {
      if (!a.ymd && !b.ymd) return 0;
      if (!a.ymd) return 1; if (!b.ymd) return -1;
      return a.ymd < b.ymd ? -1 : (a.ymd > b.ymd ? 1 : 0);
    });
    return { patient: p, items: items, providers: Object.keys(provs).sort(), counts: counts };
  }

  function filterModel(model, activeProviders) {
    if (!activeProviders) return model.items;
    return model.items.filter(function (it) {
      var pv = (it.provider || '').trim() || '(unattributed)';
      return !!activeProviders[pv];
    });
  }

  /* ---------------- text export of the chronology ---------------- */
  function chronologyText(model, items, filteredNote) {
    var p = model.patient || {};
    var L = [];
    L.push('COMPLETE PATIENT HISTORY — CATEGORIZED CHRONOLOGY');
    L.push('='.repeat(60));
    L.push('Patient: ' + (p.name || '(unknown)'));
    var demo = [p.sex, p.dob ? ('DOB ' + p.dob) : '', p.mrn ? ('MRN ' + p.mrn) : ''].filter(Boolean).join(' · ');
    if (demo) L.push(demo);
    L.push('Compiled: ' + new Date().toLocaleString());
    if (filteredNote) L.push(filteredNote);
    L.push('');
    CATS.forEach(function (c) {
      var rows = items.filter(function (it) { return it.cat === c[0]; });
      L.push(c[1].replace(/^[^\s]+\s/, '').toUpperCase() + ' (' + rows.length + ')');
      L.push('-'.repeat(50));
      if (!rows.length) { L.push('(none on file)'); L.push(''); return; }
      rows.forEach(function (it) {
        L.push('• ' + niceDate(it.ymd) + ' — ' + it.title + (it.provider ? ' — ' + it.provider : '') + '  [' + it.source + ']');
        if (it.body && it.body !== it.title) L.push(String(it.body).trim());
        L.push('');
      });
    });
    L.push('-'.repeat(60));
    L.push('Generated by MLS on this device from the stored record only. Nothing in this compilation is invented; missing data is shown as missing. Handle as PHI.');
    return L.join('\n');
  }

  /* ---------------- shared UI helpers ---------------- */
  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'text/plain' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { say('Could not download.', 'err'); }
  }
  function printText(title, text) {
    try {
      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
        '<style>body{font-family:Segoe UI,Arial,sans-serif;color:#1A211C;padding:34px 40px;font-size:13px;line-height:1.55}h1{font-size:18px;color:#204034;border-bottom:2px solid #2E6A4B;padding-bottom:8px}pre{white-space:pre-wrap;font-family:inherit;font-size:13px;margin:0}</style></head><body><h1>' + esc(title) + '</h1><pre>' + esc(text) + '</pre></body></html>';
      var win = window.open('', '_blank', 'width=840,height=1000');
      if (win && win.document) { win.document.open(); win.document.write(html); win.document.close(); win.focus(); setTimeout(function () { try { win.print(); } catch (e) {} }, 350); }
      else say('Allow pop-ups to print.', 'err');
    } catch (e) { say('Could not open print view.', 'err'); }
  }

  /* ---------------- state ---------------- */
  var state = {
    pickedId: null,
    model: null,
    provFilter: null,      /* {providerName: true} */
    sources: [],           /* [{name, chars, text}] — Task 14 uploads */
    narrative: ''
  };

  /* ---------------- Task 13 + 14 UI ---------------- */
  var CSS = [
    '#mlsLpHost .lp-card{background:var(--card-bg,#fff);border:1px solid var(--line,#dfe7f0);border-radius:14px;padding:16px 18px;margin:14px 0}',
    '#mlsLpHost h2{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:18px;margin:0 0 4px}',
    '#mlsLpHost .lp-sub{color:var(--muted,#5b7186);font-size:13px;margin:2px 0 10px}',
    '#mlsLpHost .lp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '#mlsLpHost input[type=text],#mlsLpHost textarea{border:1px solid var(--line,#E4E1D8);border-radius:9px;padding:9px 11px;font-size:13.5px;background:var(--field-bg,#fff);color:var(--ink,#1A211C)}',
    '#mlsLpHost .lp-btn{border:1px solid var(--line,#E4E1D8);background:#EAF1EE;color:#204034;border-radius:9px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer}',
    '#mlsLpHost .lp-btn.green{background:#e6f6ec;border-color:#bfe6cf;color:#1f7a4d}',
    '#mlsLpHost .lp-btn[disabled]{opacity:.55;cursor:default}',
    '#mlsLpHost .lp-ident{background:#f4f8ff;border:1px solid #cfe2f8;border-radius:10px;padding:9px 12px;font-size:13.5px;font-weight:600;color:#2E6A4B;margin:8px 0}',
    '#mlsLpHost .lp-warn{background:#fff6e5;border:1px solid #f0d9a0;border-radius:10px;padding:9px 12px;font-size:13px;color:#8a5a00;margin:8px 0}',
    '#mlsLpHost .lp-provchip{display:inline-flex;align-items:center;gap:5px;background:#f2f6fb;border:1px solid #d7e2ee;border-radius:18px;padding:4px 11px;font-size:12.5px;font-weight:600;color:#204034;cursor:pointer;user-select:none}',
    '#mlsLpHost .lp-provchip.off{opacity:.45;text-decoration:line-through}',
    '#mlsLpHost .lp-cat{margin:14px 0 4px;font-size:14px;font-weight:800;color:#204034;border-bottom:1px solid var(--line,#e2e9f1);padding-bottom:4px}',
    '#mlsLpHost .lp-item{border:1px solid var(--line,#e6edf4);border-radius:10px;padding:8px 11px;margin:7px 0;font-size:13px}',
    '#mlsLpHost .lp-item .hd{font-weight:700;color:#204034}',
    '#mlsLpHost .lp-item .src{font-weight:500;color:var(--muted,#7189a0);font-size:12px;margin-left:6px}',
    '#mlsLpHost .lp-item pre{white-space:pre-wrap;font-family:inherit;font-size:12.5px;margin:5px 0 0;color:#2c4258;max-height:260px;overflow:auto}',
    '#mlsLpHost .lp-srcrow{display:flex;align-items:center;gap:8px;border:1px solid #e2e9f1;border-radius:9px;padding:6px 10px;margin:5px 0;font-size:12.5px}',
    '#mlsLpHost .lp-results{position:relative}',
    '#mlsLpHost .lp-drop{border:2px dashed #c9d7e6;border-radius:11px;padding:14px;text-align:center;color:var(--muted,#5b7186);font-size:13px;margin:8px 0;cursor:pointer}',
    '#mlsLpSearchRes{position:absolute;z-index:60;left:0;right:0;top:100%;background:#fff;border:1px solid #E4E1D8;border-radius:10px;box-shadow:0 8px 22px rgba(20,50,90,.14);max-height:280px;overflow:auto;display:none}',
    '#mlsLpSearchRes .r{padding:8px 12px;font-size:13.5px;cursor:pointer}',
    '#mlsLpSearchRes .r:hover{background:#EAF1EE}',
    '#mlsLpNarrOut{width:100%;min-height:360px;resize:vertical;font-family:Segoe UI,Arial,sans-serif}',
    '#mlsLpHost .lp-disclaim{background:#fff4f0;border:1px solid #f4c9b8;border-radius:9px;color:#a13c22;font-size:12.5px;padding:8px 11px;margin-top:8px}'
  ].join('\n');

  function buildHost() {
    var host = document.createElement('div');
    host.id = 'mlsLpHost';
    host.innerHTML =
      /* ---- shared patient picker ---- */
      '<div class="lp-card">' +
      '<h2>⚖️ Legal case workspace <span style="font-size:11.5px;font-weight:600;color:#7189a0">(' + esc(VERSION) + ')</span></h2>' +
      '<p class="lp-sub">Search any patient on file, pull their complete categorized history, filter by provider, and draft a medical-legal narrative. Everything stays on this device; nothing is sent or written to the chart or to athenaOne.</p>' +
      '<div class="lp-row lp-results" style="max-width:520px">' +
      '<input type="text" id="mlsLpSearch" placeholder="🔍 Search patient by name, DOB, or MRN…" autocomplete="off" style="flex:1;min-width:260px">' +
      '<div id="mlsLpSearchRes"></div>' +
      '</div>' +
      '<div id="mlsLpIdent" class="lp-ident" style="display:none"></div>' +
      '</div>' +

      /* ---- Task 13: full history ---- */
      '<div class="lp-card">' +
      '<h2>📚 Complete patient history <span style="font-weight:500;font-size:13px;color:#7189a0">(categorized chronology for legal / records requests)</span></h2>' +
      '<p class="lp-sub">One click compiles everything on file — visits, procedure &amp; op notes, imaging, diagnoses, treatment plans, follow-ups, uploaded and outside records — into a categorized, chronological record. Filter to one or more providers (e.g. only Dr. Schaeffer’s visits, or a colleague’s visits related to his care) with the chips that appear after the pull.</p>' +
      '<div class="lp-row">' +
      '<button class="lp-btn green" id="mlsLpPullBtn">📚 Pull Complete Patient History</button>' +
      '<button class="lp-btn" id="mlsLpCopyBtn" disabled>📑 Copy</button>' +
      '<button class="lp-btn" id="mlsLpDlBtn" disabled>⬇ Download .txt</button>' +
      '<button class="lp-btn" id="mlsLpPrintBtn" disabled>🖨 Print</button>' +
      '</div>' +
      '<div id="mlsLpProvRow" class="lp-row" style="margin-top:10px;display:none"></div>' +
      '<div id="mlsLpChron"></div>' +
      '</div>' +

      /* ---- Task 14: narrative generator ---- */
      '<div class="lp-card">' +
      '<h2>🧾 Medical-legal narrative generator</h2>' +
      '<p class="lp-sub">Drafts a structured narrative report (patient introduction, injury date, initial presentation, prior history, imaging, treatment timeline, procedures, response, current condition, causation, medical necessity, future treatment, conclusion) from the pulled chart, prior visits and procedure notes, plus any records you add below — PDFs, Word documents, images and scans are read automatically. Add counsel’s custom questions and edit the draft freely before signing.</p>' +
      '<div class="lp-row">' +
      '<div style="flex:1;min-width:200px"><label style="font-size:12.5px;font-weight:700;color:#204034">Date of injury / onset</label><br>' +
      '<input type="text" id="mlsLpDoi" placeholder="e.g. 2025-03-14" style="width:95%"></div>' +
      '</div>' +
      '<label style="font-size:12.5px;font-weight:700;color:#204034;display:block;margin-top:8px">Custom questions from counsel (optional — each is answered in its own section)</label>' +
      '<textarea id="mlsLpQuestions" style="width:100%;min-height:70px" placeholder="e.g.&#10;1. Is the lumbar injury causally related to the 3/14/2025 accident?&#10;2. Has the patient reached maximum medical improvement?"></textarea>' +
      '<div class="lp-drop" id="mlsLpDrop">📎 Drop records here or click to add — PDF, Word (.docx), images/scans (OCR), .txt<br><span style="font-size:11.5px">Outside records, prior imaging reports, IME letters, anything counsel sent.</span></div>' +
      '<input type="file" id="mlsLpFile" multiple accept=".pdf,.docx,.txt,image/*" style="display:none">' +
      '<div id="mlsLpSrcList"></div>' +
      '<div class="lp-row" style="margin-top:10px">' +
      '<button class="lp-btn green" id="mlsLpGenBtn">🧾 Generate narrative draft</button>' +
      '<button class="lp-btn" id="mlsLpNarrCopy" disabled>📑 Copy</button>' +
      '<button class="lp-btn" id="mlsLpNarrDl" disabled>⬇ Download .txt</button>' +
      '<button class="lp-btn" id="mlsLpNarrPrint" disabled>🖨 Print</button>' +
      '<button class="lp-btn" id="mlsLpNarrSend" disabled title="Copies the draft into the Legal tool’s report card so you can Fill blanks, Save as PDF, Save to chart, and Sign there">⚖️ Send to Legal tool (sign / PDF)</button>' +
      '</div>' +
      '<div id="mlsLpNarrStatus" class="lp-sub" style="margin-top:8px"></div>' +
      '<textarea id="mlsLpNarrOut" style="display:none" spellcheck="true"></textarea>' +
      '<div class="lp-disclaim" id="mlsLpNarrDisc" style="display:none">⚠️ DRAFT — built only from the documented record and the files provided; anything not documented appears as a [bracketed placeholder]. The physician must verify, complete, and sign before any legal use. Nothing is sent anywhere by this tool.</div>' +
      '</div>';
    return host;
  }

  /* ---------------- patient search ---------------- */
  function wireSearch() {
    var inp = $('mlsLpSearch'), res = $('mlsLpSearchRes');
    if (!inp || !res) return;
    function hide() { res.style.display = 'none'; }
    inp.addEventListener('input', function () {
      var q = inp.value.trim().toLowerCase();
      if (q.length < 2) { hide(); return; }
      var hits = allPatients().filter(function (p) {
        var hay = (String(p.name || '') + ' ' + String(p.dob || '') + ' ' + String(p.mrn || '')).toLowerCase();
        return hay.indexOf(q) >= 0;
      }).slice(0, 12);
      if (!hits.length) { res.innerHTML = '<div class="r" style="color:#7189a0;cursor:default">No matching patient on file.</div>'; res.style.display = 'block'; return; }
      res.innerHTML = hits.map(function (p) {
        return '<div class="r" data-id="' + esc(p.id) + '"><b>' + esc(p.name || '(unnamed)') + '</b>' +
          '<span style="color:#7189a0"> — ' + esc([p.dob ? 'DOB ' + p.dob : '', p.mrn ? 'MRN ' + p.mrn : ''].filter(Boolean).join(' · ') || 'no DOB/MRN on file') + '</span></div>';
      }).join('');
      res.style.display = 'block';
      Array.prototype.forEach.call(res.querySelectorAll('.r[data-id]'), function (row) {
        row.addEventListener('click', function () { pickPatient(row.getAttribute('data-id')); hide(); });
      });
    });
    document.addEventListener('click', function (ev) { if (!res.contains(ev.target) && ev.target !== inp) hide(); });
  }

  function pickPatient(id) {
    var p = patientById(id);
    state.pickedId = p ? p.id : null;
    state.model = null; state.provFilter = null;
    var ident = $('mlsLpIdent');
    if (ident) {
      if (p) {
        ident.style.display = 'block';
        ident.innerHTML = '👤 ' + esc(p.name || '(unnamed)') + ' — ' +
          esc([p.sex || '', p.dob ? 'DOB ' + p.dob : 'DOB not on file', p.mrn ? 'MRN ' + p.mrn : 'MRN not on file'].filter(Boolean).join(' · ')) +
          ' <span style="font-weight:500;color:#5b7186">(all work below is locked to this record)</span>';
      } else { ident.style.display = 'none'; ident.innerHTML = ''; }
    }
    var s = $('mlsLpSearch'); if (s && p) s.value = p.name || '';
    var ch = $('mlsLpChron'); if (ch) ch.innerHTML = '';
    var pr = $('mlsLpProvRow'); if (pr) { pr.style.display = 'none'; pr.innerHTML = ''; }
    ['mlsLpCopyBtn', 'mlsLpDlBtn', 'mlsLpPrintBtn'].forEach(function (b) { var e = $(b); if (e) e.disabled = true; });
  }

  /* ---------------- Task 13 rendering ---------------- */
  function renderProvChips() {
    var row = $('mlsLpProvRow');
    if (!row || !state.model) return;
    var provs = state.model.providers;
    if (!state.provFilter) { state.provFilter = {}; provs.forEach(function (pv) { state.provFilter[pv] = true; }); }
    row.style.display = 'flex';
    row.innerHTML = '<span style="font-size:12.5px;font-weight:700;color:#204034">Providers:</span>' + provs.map(function (pv) {
      var on = !!state.provFilter[pv];
      return '<span class="lp-provchip' + (on ? '' : ' off') + '" data-prov="' + esc(pv) + '">' + (on ? '✓ ' : '✕ ') + esc(pv) + '</span>';
    }).join('') +
    '<button class="lp-btn" id="mlsLpProvAll" style="padding:4px 10px;font-size:12px">All</button>';
    Array.prototype.forEach.call(row.querySelectorAll('.lp-provchip'), function (chip) {
      chip.addEventListener('click', function () {
        var pv = chip.getAttribute('data-prov');
        state.provFilter[pv] = !state.provFilter[pv];
        renderProvChips(); renderChronology();
      });
    });
    var all = $('mlsLpProvAll');
    if (all) all.addEventListener('click', function () { provs.forEach(function (pv) { state.provFilter[pv] = true; }); renderProvChips(); renderChronology(); });
  }

  function activeFilterNote() {
    if (!state.model || !state.provFilter) return '';
    var offs = state.model.providers.filter(function (pv) { return !state.provFilter[pv]; });
    if (!offs.length) return '';
    return 'Provider filter active — EXCLUDED from this compilation: ' + offs.join(', ') + '.';
  }

  function renderChronology() {
    var box = $('mlsLpChron');
    if (!box || !state.model) return;
    var items = filterModel(state.model, state.provFilter);
    var note = activeFilterNote();
    var html = note ? '<div class="lp-warn">⚠️ ' + esc(note) + '</div>' : '';
    if (!items.length) {
      html += '<div class="lp-warn">Nothing on file matches the current provider filter. This record honestly has no matching entries — nothing is hidden or invented.</div>';
      box.innerHTML = html; return;
    }
    CATS.forEach(function (c) {
      var rows = items.filter(function (it) { return it.cat === c[0]; });
      html += '<div class="lp-cat">' + esc(c[1]) + ' <span style="font-weight:600;color:#7189a0">(' + rows.length + ')</span></div>';
      if (!rows.length) { html += '<div style="font-size:12.5px;color:#8fa3b8;margin:4px 0 2px">(none on file)</div>'; return; }
      rows.forEach(function (it) {
        var body = String(it.body || '').trim();
        html += '<div class="lp-item"><span class="hd">' + esc(niceDate(it.ymd)) + ' — ' + esc(it.title) + '</span>' +
          (it.provider ? '<span class="src">· ' + esc(it.provider) + '</span>' : '<span class="src">· unattributed</span>') +
          '<span class="src">· ' + esc(it.source) + '</span>' +
          (body && body !== it.title ? '<pre>' + esc(body) + '</pre>' : '') + '</div>';
      });
    });
    box.innerHTML = html;
  }

  function doPull() {
    var p = patientById(state.pickedId) || (isFn(window.activePatient) ? window.activePatient() : null);
    if (!p) { say('Search and pick a patient first.', 'err'); return; }
    if (!state.pickedId) pickPatient(p.id);
    state.model = buildModel(p);
    state.provFilter = null;
    renderProvChips();
    renderChronology();
    ['mlsLpCopyBtn', 'mlsLpDlBtn', 'mlsLpPrintBtn'].forEach(function (b) { var e = $(b); if (e) e.disabled = false; });
    var n = state.model.items.length;
    say(n ? ('Complete history compiled — ' + n + ' entries across ' + state.model.providers.length + ' provider group(s).') : 'This chart has no stored visits, notes, or documents yet — the compilation is honestly empty.', n ? 'ok' : 'err');
  }

  /* ---------------- Task 14: sources (file reading) ---------------- */
  function readAnyFile(file) {
    /* Prefer the app's universal reader (PDF text layer, .docx via mammoth, image OCR via backend vision). */
    if (isFn(window._tplReadAnyFile)) return window._tplReadAnyFile(file);
    var lower = (file.name || '').toLowerCase();
    if (lower.slice(-4) === '.pdf' && isFn(window.extractPdfText)) return window.extractPdfText(file);
    if (lower.slice(-5) === '.docx' && isFn(window._extractDocxText)) return window._extractDocxText(file);
    if (lower.slice(-4) === '.txt') return file.text();
    return Promise.resolve('');
  }
  function renderSources() {
    var list = $('mlsLpSrcList');
    if (!list) return;
    list.innerHTML = state.sources.map(function (s, i) {
      return '<div class="lp-srcrow"><span style="flex:1"><b>' + esc(s.name) + '</b> — ' +
        (s.chars ? (s.chars.toLocaleString() + ' characters read') : '<span style="color:#a13c22">no text could be extracted' + (s.whyEmpty ? ' (' + esc(s.whyEmpty) + ')' : '') + '</span>') +
        '</span><button class="lp-btn" data-rm="' + i + '" style="padding:3px 9px;font-size:12px">✕ Remove</button></div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('button[data-rm]'), function (b) {
      b.addEventListener('click', function () { state.sources.splice(+b.getAttribute('data-rm'), 1); renderSources(); });
    });
  }
  function addFiles(files) {
    var arr = Array.prototype.slice.call(files || []);
    if (!arr.length) return;
    say('Reading ' + arr.length + ' file' + (arr.length > 1 ? 's' : '') + '…', '');
    var done = 0;
    arr.forEach(function (f) {
      readAnyFile(f).then(function (text) {
        text = String(text || '').trim();
        var whyEmpty = '';
        if (!text) {
          var lower = (f.name || '').toLowerCase();
          if (/\.(png|jpe?g|webp|gif|bmp|heic|jfif|tiff)$/.test(lower) || /^image\//.test(f.type || '')) whyEmpty = 'image OCR needs the hosted backend';
          else if (lower.slice(-4) === '.pdf') whyEmpty = 'no text layer — likely a scan; upload it as an image instead';
        }
        state.sources.push({ name: f.name, chars: text.length, text: text, whyEmpty: whyEmpty });
      }).catch(function (e) {
        state.sources.push({ name: f.name, chars: 0, text: '', whyEmpty: (e && e.message) || 'read failed' });
      }).then(function () {
        done++; if (done === arr.length) { renderSources(); say('Files processed — check each line below for what was read.', 'ok'); }
      });
    });
  }
  function wireDrop() {
    var drop = $('mlsLpDrop'), fi = $('mlsLpFile');
    if (!drop || !fi) return;
    drop.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function (ev) { addFiles(ev.target.files); ev.target.value = ''; });
    drop.addEventListener('dragover', function (ev) { ev.preventDefault(); drop.style.borderColor = '#C9DCD2'; });
    drop.addEventListener('dragleave', function () { drop.style.borderColor = '#c9d7e6'; });
    drop.addEventListener('drop', function (ev) { ev.preventDefault(); drop.style.borderColor = '#c9d7e6'; if (ev.dataTransfer) addFiles(ev.dataTransfer.files); });
  }

  /* ---------------- Task 14: narrative generation ---------------- */
  var SECTIONS = [
    ['I. PATIENT INTRODUCTION', 'Introduce the patient: name, age or date of birth if documented, relevant occupation or activity level if documented, and the context in which they came under care. 1-2 paragraphs.'],
    ['II. DATE OF INJURY AND MECHANISM', 'State the documented date of injury/onset and the documented mechanism of injury. If the date of injury supplied in the case details conflicts with the record, note the discrepancy explicitly.'],
    ['III. INITIAL PRESENTATION', 'Describe the first documented presentation after the injury: chief complaint, symptoms, initial examination findings, and initial working diagnosis — only as documented.'],
    ['IV. PRIOR AND PRE-EXISTING HISTORY', 'Summarize the documented pre-injury medical history relevant to the affected body regions, including prior injuries, prior treatment, and pre-existing degenerative findings. If the record documents no relevant prior history, say so plainly.'],
    ['V. IMAGING AND DIAGNOSTIC STUDIES', 'Chronologically list each imaging or diagnostic study documented (X-ray, MRI, CT, EMG/NCS, etc.) with its date, the body region, and the documented findings/impression. Never infer findings not stated.'],
    ['VI. TREATMENT TIMELINE', 'Provide a chronological account of the treatment course: visits, conservative care, medications, therapy, injections — with dates and providers as documented.'],
    ['VII. PROCEDURES PERFORMED', 'Describe each documented procedure or operation: date, procedure name, provider, indication, and documented findings/outcome. If none are documented, state that.'],
    ['VIII. RESPONSE TO TREATMENT', 'Describe the documented response to each major phase of treatment — improvement, plateau, or worsening — citing the record.'],
    ['IX. CURRENT CONDITION', 'Describe the patient’s condition as of the most recent documentation: symptoms, examination findings, functional status, and work status if documented.'],
    ['X. CAUSATION ANALYSIS', 'Provide a causation analysis grounded ONLY in the documented record: temporal relationship, mechanism plausibility, consistency of the record, and aggravation of any pre-existing condition. State opinions "to a reasonable degree of medical probability" and mark anything not determinable from the record as such.'],
    ['XI. MEDICAL NECESSITY OF CARE', 'Address whether the documented care was medically necessary and reasonable: visit frequency, therapy course, imaging, injections, procedures. Tie every statement to the documented course.'],
    ['XII. FUTURE TREATMENT', 'Describe documented or medically reasonable anticipated future care (visits, therapy, injections, possible surgery, imaging, medications) with hedged language ("likely", "possible", "medically reasonable"). Use [bracketed placeholders] for anything the record cannot support.'],
    ['XIII. SUMMARY AND CONCLUSION', 'Close with a concise summary of the injury, course, current status, and the key opinions, each held to a reasonable degree of medical probability.']
  ];

  function sysFor(header, instruction) {
    return 'You are the treating physician drafting ONE SECTION of a formal MEDICAL-LEGAL NARRATIVE REPORT. Output CLEAN PROFESSIONAL PROSE ONLY — no markdown, no asterisks, no code fences, and do NOT restate the section title. Write ONLY the body of the section "' + header + '". ' + instruction +
      ' CRITICAL GUARDRAILS: base every statement ONLY on the documented record and files provided below; NEVER fabricate findings, history, dates, diagnoses, imaging results, causation, percentages, or restrictions; for ANYTHING not documented, insert a clearly marked [bracketed placeholder]. This is a DRAFT the physician must verify, complete, and SIGN.';
  }

  function buildCaseContext() {
    var parts = [];
    var p = patientById(state.pickedId) || (isFn(window.activePatient) ? window.activePatient() : null);
    var doi = ($('mlsLpDoi') || {}).value || '';
    var questions = ($('mlsLpQuestions') || {}).value || '';
    parts.push('CASE DETAILS:');
    if (doi.trim()) parts.push('Date of injury / onset (per counsel): ' + doi.trim());
    parts.push('Date of this report: ' + new Date().toLocaleDateString());
    if (questions.trim()) parts.push('Counsel’s questions:\n' + questions.trim());
    if (p) {
      parts.push('\nPATIENT IDENTIFICATION (from the chart):');
      parts.push('Name: ' + (p.name || '[not on file]'));
      parts.push('DOB: ' + (p.dob || '[not on file]') + (p.mrn ? '  MRN: ' + p.mrn : ''));
      var basics = [];
      if (p.problems && p.problems.trim()) basics.push('Problem list:\n' + p.problems.trim());
      if (p.meds && p.meds.trim()) basics.push('Medications:\n' + p.meds.trim());
      if (p.allergies && p.allergies.trim()) basics.push('Allergies:\n' + p.allergies.trim());
      if (p.summary && p.summary.trim()) basics.push('Running history / prior summary:\n' + p.summary.trim());
      if (basics.length) parts.push('\nCHART BASICS:\n' + basics.join('\n\n'));
      var model = (state.model && state.model.patient && String(state.model.patient.id) === String(p.id)) ? state.model : buildModel(p);
      var items = state.provFilter && state.model === model ? filterModel(model, state.provFilter) : model.items;
      var chron = chronologyText(model, items, activeFilterNote());
      if (chron.length > 45000) chron = chron.slice(0, 45000) + '\n…[record truncated for length — the physician must verify against the full chart]';
      parts.push('\nCATEGORIZED CHART CHRONOLOGY (visits, procedures, imaging, diagnoses, plans, follow-ups, documents):\n' + chron);
    } else {
      parts.push('\nNO IN-HOUSE CHART IS ATTACHED — build the report ONLY from the uploaded records below; use [bracketed placeholders] for anything they do not document.');
    }
    var srcText = '';
    state.sources.forEach(function (s) {
      if (!s.text) return;
      srcText += '\n----- UPLOADED RECORD: ' + s.name + ' -----\n' + s.text + '\n';
    });
    if (srcText) {
      if (srcText.length > 60000) srcText = srcText.slice(0, 60000) + '\n…[uploaded records truncated for length — the physician must verify against the originals]';
      parts.push('\nRECORDS PROVIDED (extracted from uploaded files — treat as records reviewed; cite findings from them):' + srcText);
    }
    return parts.join('\n');
  }

  var _generating = false;
  function doGenerate() {
    if (_generating) return;
    var p = patientById(state.pickedId) || (isFn(window.activePatient) ? window.activePatient() : null);
    var haveSources = state.sources.some(function (s) { return s.text; });
    if (!p && !haveSources) { say('Pick a patient (or add at least one readable record file) first — there is nothing to build from.', 'err'); return; }
    if (!(isFn(window.hasAI) && window.hasAI())) { say('Add your OpenAI key in Settings to draft the narrative — generation refuses to run without it.', 'err'); return; }
    var btn = $('mlsLpGenBtn'), status = $('mlsLpNarrStatus');
    var questions = (($('mlsLpQuestions') || {}).value || '').trim();
    var secs = SECTIONS.slice();
    if (questions) secs.splice(12, 0, ['XIII-A. ANSWERS TO COUNSEL’S QUESTIONS', 'Restate and explicitly answer EACH of counsel’s questions, one by one, grounding each answer in the documented record. Where the record cannot answer a question, say it is undeterminable from the record provided.']);
    var ctx = buildCaseContext();
    var caption = 'MEDICAL-LEGAL NARRATIVE REPORT' + (p && p.name ? '\nRe: ' + p.name + (p.dob ? ' (DOB ' + p.dob + ')' : '') : '') + '\nDate of report: ' + new Date().toLocaleDateString() + '\nDRAFT — for physician review and signature';
    _generating = true;
    if (btn) { btn.disabled = true; }
    var outParts = [caption];
    var i = 0;
    function step() {
      if (i >= secs.length) { finish(); return; }
      var header = secs[i][0], instr = secs[i][1];
      if (btn) btn.textContent = '🧾 Drafting… ' + (i + 1) + '/' + secs.length;
      if (status) status.textContent = 'Drafting "' + header + '" (' + (i + 1) + ' of ' + secs.length + ')…';
      Promise.resolve(window.aiCallRaw(sysFor(header, instr), ctx + '\n\nNow write the "' + header + '" section in full.', window.getKey(), { freeform: true, legal: true }))
        .then(function (part) {
          part = String(part || '').replace(/^```\w*\s*/, '').replace(/```$/, '').trim();
          part = part.replace(new RegExp('^' + header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:\\-]?\\s*', 'i'), '').trim();
          outParts.push(header + '\n' + part);
        })
        .catch(function (e) {
          outParts.push(header + '\n[This section could not be generated automatically — please complete. (' + ((e && e.message) || 'error') + ')]');
        })
        .then(function () { i++; step(); });
    }
    function finish() {
      state.narrative = outParts.join('\n\n');
      var out = $('mlsLpNarrOut'), disc = $('mlsLpNarrDisc');
      if (out) { out.style.display = 'block'; out.value = state.narrative; }
      if (disc) disc.style.display = 'block';
      ['mlsLpNarrCopy', 'mlsLpNarrDl', 'mlsLpNarrPrint', 'mlsLpNarrSend'].forEach(function (b) { var e = $(b); if (e) e.disabled = false; });
      if (btn) { btn.disabled = false; btn.textContent = '🧾 Generate narrative draft'; }
      if (status) status.textContent = 'Draft complete — ' + secs.length + ' sections. Edit anything below, then copy / print / send to the Legal tool to sign.';
      _generating = false;
      say('Narrative draft ready — DRAFT: verify, complete, and sign before any legal use.', 'ok');
    }
    step();
  }

  function currentNarrative() { var o = $('mlsLpNarrOut'); return o ? o.value : state.narrative; }

  function sendToLegalTool() {
    var txt = currentNarrative();
    if (!txt.trim()) { say('Generate the narrative first.', 'err'); return; }
    var body = $('legalBody'), card = $('legalCard');
    if (!body || !card) { say('The Legal tool’s report card is not available in this build — use Copy / Download instead.', 'err'); return; }
    if (body.value.trim() && !confirm('The Legal tool already holds a draft. Replace it with this narrative?')) return;
    body.value = txt;
    try { if (typeof window.currentLegal !== 'undefined') window.currentLegal = txt; } catch (e) {}
    try { if (isFn(window.legalSetSignedBadge)) window.legalSetSignedBadge(false); } catch (e) {}
    card.style.display = 'block';
    try { if (isFn(window.legalUpdateFillBtn)) window.legalUpdateFillBtn(); } catch (e) {}
    try { if (isFn(window.showView)) window.showView('visit'); } catch (e) {}
    try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    say('Narrative moved to the Legal tool — review, Fill in blanks, Save as PDF, Save to chart, or Sign there.', 'ok');
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    wireSearch(); wireDrop();
    var map = [
      ['mlsLpPullBtn', doPull],
      ['mlsLpCopyBtn', function () { if (!state.model) return; navigator.clipboard.writeText(chronologyText(state.model, filterModel(state.model, state.provFilter), activeFilterNote())).then(function () { say('Chronology copied.', 'ok'); }).catch(function () { say('Could not copy.', 'err'); }); }],
      ['mlsLpDlBtn', function () { if (!state.model) return; var p = state.model.patient || {}; download('MLS_Complete_History_' + String(p.name || 'patient').replace(/[^A-Za-z0-9]/g, '_') + '_' + todayYmd() + '.txt', chronologyText(state.model, filterModel(state.model, state.provFilter), activeFilterNote())); }],
      ['mlsLpPrintBtn', function () { if (!state.model) return; printText('Complete Patient History — ' + ((state.model.patient || {}).name || ''), chronologyText(state.model, filterModel(state.model, state.provFilter), activeFilterNote())); }],
      ['mlsLpGenBtn', doGenerate],
      ['mlsLpNarrCopy', function () { navigator.clipboard.writeText(currentNarrative()).then(function () { say('Narrative copied.', 'ok'); }).catch(function () { say('Could not copy.', 'err'); }); }],
      ['mlsLpNarrDl', function () { var p = patientById(state.pickedId) || {}; download('MLS_Legal_Narrative_' + String(p.name || 'draft').replace(/[^A-Za-z0-9]/g, '_') + '_' + todayYmd() + '.txt', currentNarrative()); }],
      ['mlsLpNarrPrint', function () { printText('Medical-Legal Narrative (DRAFT)', currentNarrative()); }],
      ['mlsLpNarrSend', sendToLegalTool]
    ];
    map.forEach(function (m) { var e = $(m[0]); if (e) e.addEventListener('click', function () { try { m[1](); } catch (err) { say('Something went wrong: ' + ((err && err.message) || err), 'err'); } }); });
  }

  /* ---------------- mount ---------------- */
  var _style = null, _host = null, _mo = null;
  function mount() {
    try {
      if ($('mlsLpHost')) return true;
      var view = $('legalReqView');
      if (!view) return false;
      if (!_style) { _style = document.createElement('style'); _style.id = 'mlsLpStyle'; _style.textContent = CSS; document.head.appendChild(_style); }
      _host = buildHost();
      var firstCard = view.querySelector('.card');
      if (firstCard && firstCard.nextSibling) view.insertBefore(_host, firstCard.nextSibling);
      else view.appendChild(_host);
      wire();
      /* preselect the app's active patient if one is open (explicit, visible identity) */
      try { var ap = isFn(window.activePatient) ? window.activePatient() : null; if (ap) pickPatient(ap.id); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }
  /* timers are throttled ~0 in hidden MLS tabs — mount now, and observe the DOM if the view isn't there yet */
  if (!mount()) {
    try {
      _mo = new MutationObserver(function () { if (mount() && _mo) { _mo.disconnect(); _mo = null; } });
      _mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
      setTimeout(function () { if (_mo && mount()) { _mo.disconnect(); _mo = null; } }, 4000);
    } catch (e) {}
  }

  window.__mlsLegalPack = {
    version: VERSION,
    installed: true,
    open: function () { try { if (isFn(window.showView)) window.showView('legalreq'); } catch (e) {} mount(); },
    buildModel: buildModel,            /* exposed for tests */
    chronologyText: chronologyText,    /* exposed for tests */
    _state: state,
    revert: function () {
      try { if (_mo) { _mo.disconnect(); _mo = null; } } catch (e) {}
      try { var h = $('mlsLpHost'); if (h && h.parentNode) h.parentNode.removeChild(h); } catch (e) {}
      try { var s = $('mlsLpStyle'); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
      window.__mlsLegalPack = null;
    }
  };
})();
