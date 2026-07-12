/* =============================================================================
 * feat_mls_code_table.js  ->  window.__mlsCodeTable   (ct-1.0.0)
 * -----------------------------------------------------------------------------
 * PRACTICE BILLING / ICD-10-CPT CODE TABLE (owner-requested, b173).
 *
 * A practice can upload/paste its own authoritative billing code table (like the
 * op-note "Practice profile"): diagnosis -> ICD-10 and procedure -> CPT. When a
 * table is present, the drafting AI is told to use those EXACT practice-approved
 * codes for matching diagnoses/procedures. When NO table is uploaded, the AI is
 * explicitly authorized to return its best current, fully-specified standard code
 * CONFIDENTLY -- never blank, never a "[verify ...]" placeholder as a default.
 * This closes the "needs a provider-approved dx->code table" gap: best-AI-answer
 * by default, with an upload option for practices that want to lock in exact codes.
 *
 * Storage: localStorage 'mls_code_table_v1' = {v:1, entries:[{desc,code,kind}], updated}.
 * Device-local; PHI-free (codes + short descriptions only); nothing sent to Athena.
 * Read-only w.r.t. clinical data. Additive; reversible: __mlsCodeTable.revert().
 *
 * PUBLIC API
 *   __mlsCodeTable.load()                 -> {v,entries,updated}
 *   __mlsCodeTable.save(entries)          -> persists (validated/normalized)
 *   __mlsCodeTable.parse(text)            -> [{desc,code,kind}]  (CSV/TSV/paste)
 *   __mlsCodeTable.lookup(desc[,kind])    -> {desc,code,kind} | null
 *   __mlsCodeTable.promptBlock()          -> string to inject into the coding prompt
 *   __mlsCodeTable.count()                -> entry count
 *   __mlsCodeTable.openEditor()           -> opens the upload/paste UI
 *   __mlsCodeTable.revert()
 * ===========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCodeTable && window.__mlsCodeTable.installed) return; } catch (e) { return; }

  var VERSION = 'ct-1.0.0';
  var STORE_KEY = 'mls_code_table_v1';
  var MAX_ENTRIES = 4000;          /* hard cap so a giant paste can't bloat storage */
  var PROMPT_MAX = 6000;           /* chars of table injected into a prompt */

  function S(x) { return x == null ? '' : String(x); }
  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  var esc = (typeof window.esc === 'function') ? window.esc
    : function (s) { return S(s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); };

  function norm(s) { return S(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* ICD-10-CM = letter + digit then optional more (e.g. M47.816, J20.9, S83.511A).
     CPT = 5 digits (e.g. 64493, 20610). HCPCS = letter + 4 digits (e.g. J1030). */
  function inferKind(code) {
    var c = S(code).toUpperCase().replace(/\s+/g, '');
    if (/^[A-TV-Z][0-9][0-9A-Z]?(\.[0-9A-Z]{1,4})?$/.test(c)) return 'icd';
    if (/^[0-9]{5}$/.test(c)) return 'cpt';
    if (/^[A-Z][0-9]{4}$/.test(c)) return 'hcpcs';
    if (/[A-Z]/.test(c) && /[0-9]/.test(c) && c.indexOf('.') >= 0) return 'icd';
    if (/^[0-9]+$/.test(c)) return 'cpt';
    return '';
  }
  function looksLikeCode(s) { return !!inferKind(s) || /^[A-Z0-9][A-Z0-9.\-]{2,7}$/i.test(S(s).replace(/\s+/g, '')); }

  /* -------- parse pasted / uploaded table (CSV, TSV, or loose 2-column) -------- */
  function splitLine(line, delim) {
    /* minimal CSV: honor double-quoted fields containing the delimiter */
    if (delim !== ',') return line.split(delim);
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
    }
    out.push(cur); return out;
  }
  function parse(text) {
    text = S(text).replace(/\r\n?/g, '\n').trim();
    if (!text) return [];
    var lines = text.split('\n').filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var delim = (lines[0].indexOf('\t') >= 0) ? '\t' : ',';
    /* header detection: a first row whose cells are words like desc/code and no code-shaped cell */
    var first = splitLine(lines[0], delim).map(function (c) { return c.trim(); });
    var headerLc = first.map(function (c) { return c.toLowerCase(); });
    var hasHeader = headerLc.some(function (c) { return /desc|diagnos|procedure|condition|name|indication/.test(c); })
      && headerLc.some(function (c) { return /code|icd|cpt|hcpcs|billing/.test(c); });
    var descCol = 0, codeCol = 1, kindCol = -1;
    if (hasHeader) {
      headerLc.forEach(function (c, i) {
        if (/desc|diagnos|procedure|condition|name|indication/.test(c) && descCol === 0 && !/code/.test(c)) descCol = i;
        if (/code|icd|cpt|hcpcs|billing/.test(c)) codeCol = i;
        if (/type|kind|category/.test(c)) kindCol = i;
      });
    }
    var out = [], seen = {}, start = hasHeader ? 1 : 0;
    for (var r = start; r < lines.length; r++) {
      var cells = splitLine(lines[r], delim).map(function (c) { return c.trim().replace(/^"|"$/g, ''); });
      if (!cells.length) continue;
      var desc = S(cells[descCol]), code = S(cells[codeCol]);
      /* if the 2 default columns are swapped (code first), auto-correct by shape */
      if (!looksLikeCode(code) && looksLikeCode(desc) && cells.length >= 2) { var t = desc; desc = code; code = t; }
      if (cells.length === 1) { /* single column: skip unless it is "desc - code" */
        var m = cells[0].match(/^(.*\S)\s*[|=:>\-]{1,2}\s*([A-Z0-9][A-Z0-9.\-]{2,7})$/i);
        if (m) { desc = m[1]; code = m[2]; } else continue;
      }
      code = code.toUpperCase().replace(/\s+/g, '');
      if (!desc || !code || !looksLikeCode(code)) continue;
      var kind = (kindCol >= 0 && cells[kindCol]) ? cells[kindCol].toLowerCase().replace(/[^a-z]/g, '') : inferKind(code);
      if (kind !== 'icd' && kind !== 'cpt' && kind !== 'hcpcs') kind = inferKind(code) || 'icd';
      var k = norm(desc) + '|' + code;
      if (seen[k]) continue; seen[k] = 1;
      out.push({ desc: desc.slice(0, 160), code: code.slice(0, 12), kind: kind });
      if (out.length >= MAX_ENTRIES) break;
    }
    return out;
  }

  /* ------------------------------- storage ------------------------------- */
  function load() {
    return safe(function () {
      var x = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!x || x.v !== 1 || !Array.isArray(x.entries)) return { v: 1, entries: [], updated: 0 };
      return x;
    }, { v: 1, entries: [], updated: 0 }) || { v: 1, entries: [], updated: 0 };
  }
  function save(entries) {
    entries = (entries || []).filter(function (e) { return e && e.desc && e.code; }).slice(0, MAX_ENTRIES);
    var obj = { v: 1, entries: entries, updated: nowTs() };
    safe(function () { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); });
    return obj;
  }
  function nowTs() { return safe(function () { return (window.Date && Date.now) ? Date.now() : 0; }, 0) || 0; }
  function count() { return load().entries.length; }

  /* ------------------------------- lookup -------------------------------- */
  /* exact normalized match first; else best keyword-overlap (>=60% of the query
     words present) so "facet mediated lumbar pain" hits "lumbar facet arthropathy". */
  function lookup(desc, kind) {
    var q = norm(desc); if (!q) return null;
    var entries = load().entries; if (!entries.length) return null;
    var qw = q.split(' ').filter(Boolean), best = null, bestScore = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]; if (kind && e.kind !== kind) continue;
      var en = norm(e.desc);
      if (en === q) return e;                                  /* exact */
      var ew = en.split(' ').filter(Boolean), hit = 0;
      for (var j = 0; j < qw.length; j++) if (ew.indexOf(qw[j]) >= 0) hit++;
      var score = qw.length ? hit / qw.length : 0;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return bestScore >= 0.6 ? best : null;
  }

  /* --------------------- prompt block for the coding AI ------------------- */
  function promptBlock() {
    var entries = load().entries;
    if (!entries.length) {
      return 'BILLING CODES: No practice-specific code table has been uploaded. Provide your BEST current, '
        + 'fully-specified, billable ICD-10/CPT code for each diagnosis/procedure actually addressed -- confidently and by default. '
        + 'Do NOT leave a code blank or output a "[verify ...]" placeholder unless the exact current code is genuinely ambiguous.';
    }
    var head = 'PRACTICE-APPROVED BILLING CODE TABLE (' + entries.length + ' entries). For any diagnosis or procedure '
      + 'that matches an entry below, use the EXACT code shown -- it is the practice standard. For anything NOT listed, '
      + 'still provide your best current standard ICD-10/CPT code confidently (never blank/placeholder):\n';
    var body = '', i = 0;
    while (i < entries.length && body.length < PROMPT_MAX) {
      body += '- ' + entries[i].desc + ' => ' + entries[i].code + (entries[i].kind ? (' [' + entries[i].kind.toUpperCase() + ']') : '') + '\n';
      i++;
    }
    if (i < entries.length) body += '- ...(' + (entries.length - i) + ' more practice entries not shown; apply the same rule)\n';
    return head + body;
  }

  /* -------------------------------- UI ----------------------------------- */
  var STYLE_ID = 'mlsCtStyle', MODAL_ID = 'mlsCtModal';
  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = [
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;font-family:inherit}',
      '#' + MODAL_ID + ' .ctcard{background:#fff;color:#0f2740;width:min(680px,94vw);max-height:88vh;overflow:auto;border-radius:14px;padding:20px 22px;box-shadow:0 18px 60px rgba(0,0,0,.35)}',
      '#' + MODAL_ID + ' h3{margin:0 0 4px;font-size:17px}',
      '#' + MODAL_ID + ' .ctsub{font-size:12.5px;color:#5b6b80;margin:0 0 12px;line-height:1.45}',
      '#' + MODAL_ID + ' textarea{width:100%;min-height:150px;font:12px/1.45 ui-monospace,Consolas,monospace;border:1px solid #cfe0f3;border-radius:9px;padding:9px;box-sizing:border-box}',
      '#' + MODAL_ID + ' .ctrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}',
      '#' + MODAL_ID + ' button{font:inherit;font-size:13px;font-weight:700;border-radius:9px;padding:8px 14px;cursor:pointer;border:1px solid #cfe0f3;background:#eef4fc;color:#15528f}',
      '#' + MODAL_ID + ' button.pri{background:#1763b6;border-color:#1763b6;color:#fff}',
      '#' + MODAL_ID + ' button.ghost{background:#fff}',
      '#' + MODAL_ID + ' .ctprev{margin-top:12px;border:1px solid #e2ecf6;border-radius:9px;max-height:210px;overflow:auto;font-size:12px}',
      '#' + MODAL_ID + ' .ctprev table{border-collapse:collapse;width:100%}',
      '#' + MODAL_ID + ' .ctprev td,#' + MODAL_ID + ' .ctprev th{border-bottom:1px solid #eef2f7;padding:4px 8px;text-align:left}',
      '#' + MODAL_ID + ' .ctnote{font-size:12px;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 10px;margin-top:12px}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }
  var _pending = null;
  function renderPreview(entries) {
    if (!entries.length) return '<div style="padding:10px;color:#8a97a8">No valid rows parsed yet.</div>';
    var rows = entries.slice(0, 60).map(function (e) {
      return '<tr><td>' + esc(e.desc) + '</td><td><b>' + esc(e.code) + '</b></td><td>' + esc((e.kind || '').toUpperCase()) + '</td></tr>';
    }).join('');
    var more = entries.length > 60 ? '<tr><td colspan="3" style="color:#8a97a8">…' + (entries.length - 60) + ' more</td></tr>' : '';
    return '<table><thead><tr><th>Diagnosis / procedure</th><th>Code</th><th>Type</th></tr></thead><tbody>' + rows + more + '</tbody></table>';
  }
  function openEditor() {
    css();
    var cur = load();
    var old = document.getElementById(MODAL_ID); if (old) old.remove();
    var m = document.createElement('div'); m.id = MODAL_ID;
    m.innerHTML =
      '<div class="ctcard">' +
        '<h3>&#9877; Practice billing code table</h3>' +
        '<p class="ctsub">Paste or upload your practice&#39;s diagnosis&rarr;ICD-10 and procedure&rarr;CPT codes (CSV or tab-separated: <b>description, code</b> per line; a header row is fine). When set, the AI uses YOUR exact codes for matching diagnoses/procedures. ' +
          'Currently loaded: <b id="mlsCtCount">' + cur.entries.length + '</b> codes.</p>' +
        '<input type="file" id="mlsCtFile" accept=".csv,.tsv,.txt" style="margin-bottom:8px">' +
        '<textarea id="mlsCtText" placeholder="Lumbar facet arthropathy, M47.816&#10;Lumbar medial branch block, 64493&#10;Caudal epidural steroid injection, 62323">' +
          esc(cur.entries.map(function (e) { return e.desc + ', ' + e.code; }).join('\n')) + '</textarea>' +
        '<div class="ctrow">' +
          '<button class="pri" id="mlsCtParse">Preview</button>' +
          '<button class="pri" id="mlsCtSave">Save table</button>' +
          '<button class="ghost" id="mlsCtClear">Clear table</button>' +
          '<button class="ghost" id="mlsCtClose" style="margin-left:auto">Close</button>' +
        '</div>' +
        '<div class="ctprev" id="mlsCtPreview"></div>' +
        '<div class="ctnote">&#10003; If you leave this empty, the AI automatically fills its best current, real ICD-10/CPT code for each diagnosis &mdash; never blank. Upload a table only if you want to lock in your practice&#39;s exact codes.</div>' +
      '</div>';
    document.body.appendChild(m);
    var ta = m.querySelector('#mlsCtText'), prev = m.querySelector('#mlsCtPreview');
    function doPreview() { _pending = parse(ta.value); prev.innerHTML = renderPreview(_pending); m.querySelector('#mlsCtCount').textContent = _pending.length; return _pending; }
    m.querySelector('#mlsCtParse').onclick = doPreview;
    m.querySelector('#mlsCtFile').onchange = function (ev) {
      var f = ev.target.files && ev.target.files[0]; if (!f) return;
      var rd = new FileReader(); rd.onload = function () { ta.value = S(rd.result); doPreview(); }; rd.readAsText(f);
    };
    m.querySelector('#mlsCtSave').onclick = function () {
      var entries = _pending || parse(ta.value); save(entries);
      safe(function () { if (isFn(window.toast)) window.toast(entries.length + ' billing codes saved for this practice.', 'ok'); });
      m.remove();
    };
    m.querySelector('#mlsCtClear').onclick = function () { save([]); ta.value = ''; prev.innerHTML = ''; m.querySelector('#mlsCtCount').textContent = '0'; safe(function () { if (isFn(window.toast)) window.toast('Billing code table cleared — AI will fill best codes.', 'ok'); }); };
    m.querySelector('#mlsCtClose').onclick = function () { m.remove(); };
    m.onclick = function (e) { if (e.target === m) m.remove(); };
    doPreview();
  }

  /* place a "Billing codes" button next to the op-note "Practice profile" button
     whenever that bar exists (op-note prep). Idempotent, cheap, self-stopping. */
  var _btnTimer = null, _stopped = false;
  function placeButton() {
    if (_stopped) return;
    var prof = document.getElementById('mlsOnfProfBtn');
    if (prof && !document.getElementById('mlsCtBtn')) {
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'mlsCtBtn'; b.className = prof.className || 'ghost';
      b.textContent = '⚕ Billing codes';
      b.title = 'Upload your practice ICD-10/CPT code table (optional). If empty, the AI fills its best current codes.';
      b.style.cssText = prof.style.cssText;
      b.addEventListener('click', function (e) { try { e.preventDefault(); e.stopPropagation(); } catch (x) {} openEditor(); });
      prof.parentNode.insertBefore(b, prof.nextSibling);
    }
  }

  function revert() {
    _stopped = true;
    try { if (_btnTimer) { clearInterval(_btnTimer); _btnTimer = null; } } catch (e) {}
    safe(function () { var b = document.getElementById('mlsCtBtn'); if (b) b.remove(); });
    safe(function () { var m = document.getElementById(MODAL_ID); if (m) m.remove(); });
    try { window.__mlsCodeTable.installed = false; } catch (e) {}
    return 'code-table reverted';
  }

  var api = {
    installed: true, version: VERSION, asset: 'feat_mls_code_table.js',
    load: load, save: save, parse: parse, lookup: lookup, promptBlock: promptBlock,
    count: count, openEditor: openEditor, inferKind: inferKind, _norm: norm, revert: revert
  };
  window.__mlsCodeTable = api;

  function boot() { safe(placeButton); _btnTimer = setInterval(function () { safe(placeButton); }, 2500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
