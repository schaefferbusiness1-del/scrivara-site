/* mlsProv — schedule provider extractor (worker side), inlined into background.js. */
var mlsProv = (function () {
  'use strict';


  var RE_TIME = /\b(\d{1,2}):(\d{2})\s*([ap]\.?\s?m\.?)?\b/i;
  var RE_TIME_G = /\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?\b/gi;
  var RE_CRED = /(?:^|[^A-Za-z])(MD|DO|NP|PA-?C?|APRN|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DPM|DDS|DMD|PHD|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC)(?:[^A-Za-z]|$)/;
  var CRED_I = /^(md|do|np|pa|pac|aprn|fnp|dnp|agnp|whnp|pmhnp|rn|lpn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc)$/;
  var RE_APPTWORD = /\bappointment/i;
  var RE_NAMECOMMA = /([A-Z][A-Za-z'’-]+)\s*,\s*([A-Z][A-Za-z'’-]+)/;
  var STOP = /^(am|pm|new|est|established|office|visit|tele|telehealth|video|phone|follow|followup|fu|consult|consultation|annual|physical|wellness|exam|sick|nurse|lab|labs|injection|inj|procedure|recheck|np|min|mins|minute|minutes|arrived|checkedin|checked|scheduled|confirmed|cancelled|canceled|noshow|no|show|room|status|reason|provider|patient|time|type|resource|rendering|department|dept|appt|appts|total|appointments)$/i;

  function S(x) { return x == null ? '' : String(x); }
  function clean(s) { return S(s).replace(/\s+/g, ' ').trim(); }

  function nameTokens(name) {
    return clean(name).toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/)
      .filter(function (t) { return t && t.length > 1 && !STOP.test(t) && !CRED_I.test(t); });
  }
  function hasTime(s) { return RE_TIME.test(S(s)); }
  function firstTime(s) { var m = S(s).match(RE_TIME_G); return m ? clean(m[0]) : ''; }

  function cleanProvider(s) {
    var t = clean(s);
    t = t.replace(/[•‣▪●>*\-–—]+\s*$/g, '');
    t = t.replace(/[-–—:|(]*\s*\d+\s*appointments?\b.*$/i, '');
    t = t.replace(/\b\d+\s*appointments?\b/i, '');
    t = t.replace(/\(\s*\d+\s*\)\s*$/, '');
    t = t.replace(/[\s,;:|–—-]+$/, '');
    return clean(t);
  }

  function looksLikeProviderHeader(line) {
    var t = clean(line);
    if (!t || t.length > 80) return false;
    if (hasTime(t)) return false;
    var hasCred = RE_CRED.test(t);
    var hasApptWord = RE_APPTWORD.test(t);
    var hasName = RE_NAMECOMMA.test(t) || /[A-Z][a-z]+[ _][A-Z][a-z]+/.test(t);
    if ((hasCred && hasName) || (hasApptWord && hasName)) return true;
    if (hasCred && RE_NAMECOMMA.test(t) && t.split(/\s+/).length <= 5) return true;
    return false;
  }

  function patientNameFromRow(line) {
    var t = clean(line);
    var mc = t.match(RE_NAMECOMMA);
    if (mc) return clean(mc[0]);
    var afterTime = t.replace(RE_TIME_G, ' ');
    var words = afterTime.split(/\s+/).filter(function (w) { return /[A-Za-z]/.test(w); });
    var picked = [];
    for (var i = 0; i < words.length && picked.length < 3; i++) {
      var w = words[i].replace(/[^A-Za-z'’-]/g, '');
      if (!w) continue;
      if (STOP.test(w) || CRED_I.test(w.toLowerCase())) { if (picked.length) break; else continue; }
      if (/^[A-Z]/.test(w)) picked.push(w); else if (picked.length) break;
    }
    return picked.join(' ');
  }

  function mlsExtractScheduleFromText(text) {
    var out = { appts: [], providers: [], diag: { strategy: 'text', lineCount: 0, headerCount: 0, apptCount: 0, providerCount: 0, credsSeen: [], providerNames: [] } };
    try {
      var raw = S(text);
      if (!raw.trim()) return out;
      var lines = raw.split(/\r?\n/).map(clean).filter(function (l) { return l.length; });
      out.diag.lineCount = lines.length;
      var current = '';
      var provSet = {}, provOrder = [], credSet = {};
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (looksLikeProviderHeader(ln)) {
          var p = cleanProvider(ln);
          if (p) {
            current = p;
            if (!provSet[p.toLowerCase()]) { provSet[p.toLowerCase()] = 1; provOrder.push(p); }
            var cm = ln.match(RE_CRED); if (cm && cm[1]) credSet[cm[1].toUpperCase()] = 1;
            out.diag.headerCount++;
          }
          continue;
        }
        if (hasTime(ln)) {
          var nm = patientNameFromRow(ln);
          if (nm) out.appts.push({ time: firstTime(ln), name: nm, provider: current || '' });
        }
      }
      var withAppts = {};
      out.appts.forEach(function (a) { if (a.provider) withAppts[a.provider.toLowerCase()] = a.provider; });
      var provs = Object.keys(withAppts).length ? provOrder.filter(function (p) { return withAppts[p.toLowerCase()]; }) : provOrder;
      out.providers = provs;
      out.diag.apptCount = out.appts.length;
      out.diag.providerCount = provs.length;
      out.diag.providerNames = provs.slice(0, 20);
      out.diag.credsSeen = Object.keys(credSet);
    } catch (e) { out.diag.err = S(e && e.message || e).slice(0, 120); }
    return out;
  }

  function txt(el) { try { return clean(el.textContent); } catch (e) { return ''; } }

  function mlsExtractScheduleFromDom(doc) {
    var out = { appts: [], providers: [], diag: { strategy: 'dom', tables: 0, rowsScanned: 0, apptCount: 0, providerCount: 0, via: '', providerNames: [], credsSeen: [] } };
    try {
      if (!doc || !doc.querySelectorAll) return out;
      var provSet = {}, provOrder = [], credSet = {};
      function noteProv(p) {
        p = cleanProvider(p);
        if (p && /[A-Za-z]/.test(p) && p.length <= 60 && !provSet[p.toLowerCase()]) { provSet[p.toLowerCase()] = 1; provOrder.push(p); }
        if (p) { var cm = p.match(RE_CRED); if (cm && cm[1]) credSet[cm[1].toUpperCase()] = 1; }
        return p;
      }

      var grids = [].slice.call(doc.querySelectorAll('table, [role="grid"], [role="table"]'));
      out.diag.tables = grids.length;
      for (var g = 0; g < grids.length && !out.appts.length; g++) {
        var grid = grids[g];
        var headerCells = [].slice.call(grid.querySelectorAll('thead th, [role="columnheader"]'));
        var rows = [].slice.call(grid.querySelectorAll('tbody tr, [role="row"]'));
        if (!rows.length) rows = [].slice.call(grid.querySelectorAll('tr'));
        if (!headerCells.length && rows.length) headerCells = [].slice.call(rows[0].querySelectorAll('th, td, [role="columnheader"], [role="cell"], [role="gridcell"]'));
        var provIdx = -1, nameIdx = -1;
        headerCells.forEach(function (h, idx) {
          var ht = txt(h).toLowerCase();
          if (provIdx < 0 && /(provider|rendering|resource|clinician|scheduling provider|doctor|seen by|with)/.test(ht) && !/patient/.test(ht)) provIdx = idx;
          if (nameIdx < 0 && /(patient|name)/.test(ht)) nameIdx = idx;
        });
        if (provIdx < 0) continue;
        rows.forEach(function (r) {
          out.diag.rowsScanned++;
          var cells = [].slice.call(r.querySelectorAll('th, td, [role="cell"], [role="gridcell"]'));
          if (!cells.length) return;
          var rowText = txt(r);
          if (!hasTime(rowText)) return;
          var prov = cells[provIdx] ? noteProv(txt(cells[provIdx])) : '';
          var nm = nameIdx >= 0 && cells[nameIdx] ? txt(cells[nameIdx]) : patientNameFromRow(rowText);
          if (nm) out.appts.push({ time: firstTime(rowText), name: clean(nm), provider: prov || '' });
        });
        if (out.appts.length) out.diag.via = 'table-column';
      }

      if (!out.appts.length) {
        var all = [].slice.call(doc.querySelectorAll('div,li,tr,section,article,a,span,p'));
        var seq = [];
        all.forEach(function (el) {
          var own = txt(el);
          if (!own || own.length > 400) return;
          if (own.length <= 80 && looksLikeProviderHeader(own) && el.querySelectorAll('*').length <= 6) {
            seq.push({ kind: 'prov', el: el, text: own });
          } else if (hasTime(own) && own.length < 300 && patientNameFromRow(own)) {
            var childHasBoth = false;
            for (var c = 0; c < el.children.length; c++) {
              var ct = txt(el.children[c]);
              if (hasTime(ct) && patientNameFromRow(ct)) { childHasBoth = true; break; }
            }
            if (!childHasBoth) seq.push({ kind: 'appt', el: el, text: own });
          }
        });
        var cur = '';
        seq.forEach(function (n) {
          out.diag.rowsScanned++;
          if (n.kind === 'prov') { cur = noteProv(n.text); }
          else {
            var inRow = '';
            if (RE_CRED.test(n.text)) {
              var mNme = n.text.match(/([A-Z][A-Za-z'’-]+\s*,\s*[A-Z][A-Za-z'’-]+\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|RN|DPM|DDS|DMD|PHD|MBBS|OD)\b)/);
              if (mNme) inRow = noteProv(mNme[1]);
            }
            var nm2 = patientNameFromRow(n.text);
            if (nm2) out.appts.push({ time: firstTime(n.text), name: nm2, provider: inRow || cur || '' });
          }
        });
        if (out.appts.length && !out.diag.via) out.diag.via = 'grouped-dom';
      }

      var used = {};
      out.appts.forEach(function (a) { if (a.provider) used[a.provider.toLowerCase()] = a.provider; });
      out.providers = Object.keys(used).length ? provOrder.filter(function (p) { return used[p.toLowerCase()]; }) : provOrder;
      out.diag.apptCount = out.appts.length;
      out.diag.providerCount = out.providers.length;
      out.diag.providerNames = out.providers.slice(0, 20);
      out.diag.credsSeen = Object.keys(credSet);
    } catch (e) { out.diag.err = S(e && e.message || e).slice(0, 120); }
    return out;
  }

  function mlsMergeSchedule(domRes, textRes) {
    var dom = domRes || { appts: [], providers: [], diag: {} };
    var text = textRes || { appts: [], providers: [], diag: {} };
    var primary = (dom.providers && dom.providers.length) ? dom : text;
    var other = primary === dom ? text : dom;
    var seen = {}, providers = [];
    (primary.providers || []).concat(other.providers || []).forEach(function (p) {
      var k = clean(p).toLowerCase(); if (p && !seen[k]) { seen[k] = 1; providers.push(p); }
    });
    return {
      appts: primary.appts && primary.appts.length ? primary.appts : (other.appts || []),
      providers: providers,
      providerDiag: {
        source: primary === dom ? 'dom' : 'text',
        dom: dom.diag || {},
        text: text.diag || {},
        providerCount: providers.length,
        providerNames: providers.slice(0, 20)
      }
    };
  }
  return { fromText: mlsExtractScheduleFromText, fromDom: mlsExtractScheduleFromDom, merge: mlsMergeSchedule };
})();
