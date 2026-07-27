/* =========================================================================
 * MLS -- Op-note prep: bulk template assign + fillable fields
 *   feat_mls_opnote_fill.js  ->  window.__mlsOpNoteFill  (onf-1.0.0)
 * 2026-07-12, final sweep (live, michael@ account, real Athena data).
 * ----------------------------------------------------------------------------
 * PROBLEM A (blocker): the Athena schedule pull carries NO procedure text
 *   (every pulled appointment row has reason/proc empty), so every op-prep row
 *   has tplId=null, and "Draft all op notes" matches no template and skips
 *   everyone: "0 drafted, N skipped (no template)" -- even though templates ARE
 *   uploaded. The template lookup is fine; there is simply nothing to match
 *   against. FIX: a compact strip on the op-prep list lets the physician assign
 *   one procedure template to ALL patients (or only the still-blank ones) in a
 *   click, and per-card pickers still override. This sets _opPrep[i].tplId --
 *   the exact field the app's own "Draft all" reads -- so drafting then works.
 *   No procedure is ever GUESSED; the physician chooses.
 *
 * PROBLEM B: drafted notes leave placeholders like "[FILL: laterality]" inline
 *   for someone to type over. FIX: each note's [FILL: ...] tokens are surfaced
 *   as real form controls in a "Fields to fill" box above the note -- a
 *   Left/Right/Bilateral dropdown for laterality, an X/Y dropdown for
 *   "[FILL: a or b]" choices, a text box otherwise -- and filling one replaces
 *   every matching token in the note.
 *
 * Additive, reversible, freeze-safe (idempotent cheap tick, only while the
 * op-prep modal is open; write-if-changed). window.__mlsOpNoteFill.revert().
 * No writeback, no orders, no identity guessing. ES5.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsOpNoteFill && window.__mlsOpNoteFill.installed) return; } catch (e) { return; }

  var VERSION = 'onf-2.11.1';
  var BAR_ID = 'mlsOnfBar', STYLE_ID = 'mlsOnfStyle';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function esc(s) { return S(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, k) { safe(function () { if (isFn(window.toast)) window.toast(m, k || ''); }); }
  /* a real MRN / patient id is numeric (4-15 digits). An internal app id like
     "pmrhsi1kbgl2p" must NEVER be printed as the MRN on a clinical note. */
  function plausibleMrn(s) { return /^\d{4,15}$/.test(S(s).replace(/[-\s]/g, '')); }

  function css() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '#' + BAR_ID + '{margin:0 0 12px;padding:11px 13px;border:1px solid #cfe0f5;border-radius:12px;',
      'background:linear-gradient(180deg,#f4f9ff,#eaf3ff);display:flex;flex-wrap:wrap;align-items:center;gap:9px;',
      'font:600 12.5px/1.35 "Plus Jakarta Sans",system-ui,sans-serif;color:#204034;}',
      '#' + BAR_ID + ' b{font-weight:800;}',
      '#' + BAR_ID + ' select{font:600 12.5px system-ui;padding:6px 9px;border:1px solid #EAF1EE;border-radius:8px;background:#fff;color:#1E2B24;max-width:280px;}',
      '#' + BAR_ID + ' button{cursor:pointer;border:0;border-radius:8px;padding:7px 13px;font:700 12.5px system-ui;background:#2E6A4B;color:#fff;}',
      '#' + BAR_ID + ' button.ghost{background:#e6eefb;color:#2E6A4B;}',
      '#' + BAR_ID + ' button:hover{filter:brightness(1.05);}',
      '#' + BAR_ID + ' .onf-count{margin-left:auto;font-weight:700;color:#204034;}',
      '.onf-fillbox{margin:8px 0;padding:10px 12px;border:1px solid #e0b877;border-radius:11px;background:#fffdf5;}',
      '.onf-fillbox .onf-h{font:800 12px/1.3 "Plus Jakarta Sans",system-ui,sans-serif;color:#7a5310;margin:0 0 7px;display:flex;align-items:center;gap:6px;}',
      '.onf-fillbox .onf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;}',
      '.onf-fillbox label{display:flex;flex-direction:column;gap:3px;font:700 11px/1.3 system-ui;color:#5a4a24;}',
      '.onf-fillbox input,.onf-fillbox select{font:600 12.5px system-ui;padding:5px 8px;border:1px solid #d9c48f;border-radius:7px;background:#fff;color:#3a2f12;}',
      '.onf-fillbox .onf-done{border-color:#8fce9e;background:#f2fbf4;}',
      '.onf-fillbox label.onf-has input,.onf-fillbox label.onf-has select{border-color:#8fce9e;background:#f6fdf8;}',
      '.onf-fillbox .onf-sug{font:800 9px system-ui;color:#7a5310;background:#fdf0d0;padding:1px 6px;border-radius:999px;margin-left:5px;vertical-align:middle;}',
      '.onf-fillbox .onf-need{font:800 9px system-ui;color:#8a2a2a;background:#fbe0e0;padding:1px 6px;border-radius:999px;margin-left:5px;vertical-align:middle;}',
      '.onf-fillbox .onf-saved{font:800 9px system-ui;color:#1b5e20;background:#dff0e0;padding:1px 6px;border-radius:999px;margin-left:5px;vertical-align:middle;}',
      '.onf-fillbox .onf-default{font:800 9px system-ui;color:#204034;background:#dce8fb;padding:1px 6px;border-radius:999px;margin-left:5px;vertical-align:middle;}',
      '.onf-fillbox .onf-hist{font:800 9px system-ui;color:#204034;background:#e0ecfb;padding:1px 6px;border-radius:999px;margin-left:5px;vertical-align:middle;}',
      '.onf-fillbox .onf-field{min-width:0;}',
      '.onf-fillbox .onf-field-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:4px;}',
      '.onf-fillbox .onf-field-actions button{cursor:pointer;border:1px solid #c9d6e5;border-radius:999px;padding:3px 8px;background:#fff;color:#204034;font:700 10px/1.2 system-ui;max-width:100%;white-space:normal;text-align:left;}',
      '.onf-fillbox .onf-field-actions button:hover{background:#eef4fb;}',
      '.onf-fillbox .onf-field-actions button.onf-stop{color:#8a2a2a;border-color:#e8c6c6;}',
      '.onf-fillbox .onf-mic{font-size:12px;padding:2px 7px;}',
      '.onf-fillbox details.onf-auto{margin-top:7px;border:1px dashed #cbd8c9;border-radius:8px;padding:5px 9px;background:#f6faf5;}',
      '.onf-fillbox details.onf-auto summary{cursor:pointer;font:700 11.5px system-ui;color:#16924e;outline-offset:2px;}',
      '.onf-fillbox details.onf-auto[open]{padding-bottom:8px;}',
      '.onf-dict{margin-top:8px;border-top:1px dashed #d8c9a8;padding-top:8px;}',
      '.onf-dict textarea{width:100%;min-height:52px;font:12.5px system-ui;border:1px solid #c9d6e5;border-radius:7px;padding:6px 8px;margin:6px 0 4px;}',
      '.onf-dict .onf-dict-status{font:600 11px system-ui;color:#7a5310;margin-left:8px;}',
      '.onf-dict button{cursor:pointer;border:1px solid #c9d6e5;border-radius:7px;background:#fff;font:600 11.5px system-ui;padding:4px 10px;margin-right:6px;}',
      '.onf-dict button.onf-dict-go{background:#204034;color:#fff;border-color:#204034;}',
      '.onf-dict button[data-onf-corr]{background:#fff7e6;border-color:#e0b877;color:#7a5310;display:block;margin-top:4px;}',
      '.onf-fillbox .onf-recent{color:#5a4a24!important;border-color:#dcc78d!important;background:#fffaf0!important;}',
      '.onf-fillbox .onf-note{font:600 10.5px system-ui;color:#8a7130;margin:7px 0 0;}',
      '.onf-fillbox .onf-accept{cursor:pointer;border:0;border-radius:8px;padding:8px 15px;font:700 12.5px system-ui;background:#2E6A4B;color:#fff;}',
      '.onf-fillbox .onf-accept:hover{filter:brightness(1.08);}',
      '@media (max-width:600px){.onf-fillbox .onf-grid{grid-template-columns:1fr;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------- shared ---------------- */
  function modalOpen() { var m = $('opPrepModal'); return !!(m && getComputedStyle(m).display !== 'none'); }
  function templates() { return safe(function () { return isFn(window.getTemplates) ? (window.getTemplates() || []) : []; }, []); }
  function tplPickers() { return safe(function () { return document.querySelectorAll('select[id^="opPrepTpl_"]'); }, []); }

  /* Never persist clinician defaults or patient memory in uns()'s shared,
     unresolved-account bucket. */
  function scopedKey(suffix) {
    return safe(function () {
      if (!isFn(window.uns)) return '';
      var key = S(window.uns(suffix));
      if (!key || key.indexOf('sf_u::_::') === 0 || key.indexOf('::_::') >= 0) return '';
      return key;
    }, '') || '';
  }
  function readScoped(suffix, fallback) {
    var key = scopedKey(suffix); if (!key) return fallback;
    return safe(function () { var raw = localStorage.getItem(key); return raw == null ? fallback : raw; }, fallback);
  }
  function writeScoped(suffix, value) {
    var key = scopedKey(suffix); if (!key) return false;
    return safe(function () { localStorage.setItem(key, value); return true; }, false) === true;
  }

  /* ================= PART A: bulk template assignment ================= */
  function assignedCount() {
    var op = window._opPrep || [], n = 0;
    for (var i = 0; i < op.length; i++) if (op[i] && op[i].tplId) n++;
    return n;
  }
  function applyBulk(onlyBlank) {
    var sel = $('mlsOnfBulkSel'); if (!sel || !sel.value) { toast('Pick a procedure template first.', 'err'); return; }
    var id = sel.value, op = window._opPrep || [], n = 0;
    for (var i = 0; i < op.length; i++) {
      if (!op[i]) continue;
      if (onlyBlank && op[i].tplId) continue;
      op[i].tplId = id;
      var picker = $('opPrepTpl_' + i);
      if (picker) { picker.value = id; safe(function () { picker.dispatchEvent(new Event('change', { bubbles: true })); }); }
      n++;
    }
    updateBarCount();
    toast('Assigned "' + (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : 'template') + '" to ' + n + ' patient' + (n === 1 ? '' : 's') + '. Press "Draft all op notes".', 'ok');
  }
  function updateBarCount() {
    var c = safe(function () { return document.querySelector('#' + BAR_ID + ' .onf-count'); });
    if (c) c.textContent = assignedCount() + ' / ' + (window._opPrep || []).length + ' patients have a template';
  }
  function injectBar() {
    if ($(BAR_ID)) { updateBarCount(); return; }
    var list = $('opPrepList'); if (!list || !list.parentNode) return;
    if (tplPickers().length < 2) return;                 /* only in multi-patient (all-day) mode */
    css();
    var tpls = templates();
    var opts = '<option value="">— choose a procedure template —</option>' + tpls.map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.name || t.id) + '</option>';
    }).join('');
    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.innerHTML =
      '<b>📋 Assign a template to every patient:</b>' +
      '<select id="mlsOnfBulkSel" title="These procedures aren\'t in the Athena schedule, so choose the template for this day\'s list">' + opts + '</select>' +
      '<button type="button" id="mlsOnfApplyAll">Apply to all</button>' +
      '<button type="button" class="ghost" id="mlsOnfApplyBlank">Only the blank ones</button>' +
      '<button type="button" id="mlsOnfSaveAll" title="Finalize every drafted note into its patient\'s History — nothing is sent to Athena">✓ Save all drafted</button>' +
      '<span class="onf-count"></span>';
    list.parentNode.insertBefore(bar, list);
    var a = $('mlsOnfApplyAll'); if (a) a.addEventListener('click', function () { applyBulk(false); });
    var b = $('mlsOnfApplyBlank'); if (b) b.addEventListener('click', function () { applyBulk(true); });
    /* onf-2.4.0 (owner: "one or two clicks then it's done"): click 1 = Draft all,
       click 2 = this. Finalizes every drafted note into its patient's History
       via the app's own opPrepSave (exact-identity gated, never Athena). */
    var sa = $('mlsOnfSaveAll'); if (sa) sa.addEventListener('click', function () {
      var op = window._opPrep || [], saved = 0, blanksLeft = 0, skipped = 0;
      for (var i = 0; i < op.length; i++) {
        var r = op[i];
        if (!r || !S(r.note).trim()) { skipped++; continue; }
        /* one canonical count (deduped per field, all syntaxes) — matches the
           save gate and every other surface */
        blanksLeft += (isFn(window.opNoteBlankCount) ? window.opNoteBlankCount(S(r.note)) : (S(r.note).match(/\[FILL:[^\]]*\]|\[\[[a-z0-9_]+\]\]/gi) || []).length);
        r._onfReviewed = true;   /* onf-2.8.0: "Save all drafted" is the explicit accept */
        safe(function (j) { return function () { if (isFn(window.opPrepSave)) window.opPrepSave(j); }; }(i)());
        saved++;
      }
      if (!saved) { toast('Nothing drafted yet — press "Draft all op notes" first.', 'err'); return; }
      toast('✓ Saved ' + saved + ' note' + (saved === 1 ? '' : 's') + ' to History' + (skipped ? ' · ' + skipped + ' not drafted' : '') + (blanksLeft ? ' · ' + blanksLeft + ' blank(s) still marked in the text' : ''), blanksLeft ? 'err' : 'ok');
    });
    updateBarCount();
  }
  /* onf-1.4.0: mark the row's procedure text from its assigned template so the
     readiness checklist's "Procedure" shows filled once a template is matched. */
  function syncProcedure(row) {
    if (!row || S(row.proc).trim() || !row.tplId) return;
    var t = null, tl = templates();
    for (var i = 0; i < tl.length; i++) if (tl[i] && tl[i].id === row.tplId) { t = tl[i]; break; }
    if (t) { row.proc = S(t.name || '').replace(/^(procedure note:?|op note:?)\s*/i, '').trim(); }
  }
  /* onf-1.6.0: auto-populate the VISIBLE editable "Procedure" input on each
     op-prep card with the matched procedure (row.proc) instead of leaving it
     blank. The input carries onchange="_opProcChanged(N,this.value)", so N maps
     it to its row. We only fill an EMPTY input (never override manual entry). */
  function fillProcInputs() {
    try {
      var op = window._opPrep || [], modal = $('opPrepModal'); if (!modal) return;
      var inputs = modal.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i], m = S(inp.getAttribute('onchange')).match(/_opProcChanged\((\d+)/);
        if (!m) continue;
        var idx = +m[1], row = op[idx];
        if (!row || !S(row.proc).trim() || S(inp.value).trim()) continue;
        inp.value = row.proc;
        safe(function () { inp.dispatchEvent(new Event('input', { bubbles: true })); });
      }
    } catch (e) {}
  }

  /* ================= PART B: fillable [FILL: ...] fields ================= */
  var LAT = ['', 'Left', 'Right', 'Bilateral', 'Midline'];
  function fieldSpec(label) {
    var l = S(label).trim(), low = l.toLowerCase();
    if (/laterality|\bside\b/.test(low)) return { type: 'select', opts: LAT };
    var mChoice = l.match(/^(.+?)\s+or\s+(.+)$/i) || l.match(/^([^\/]+)\/([^\/]+)$/);
    if (mChoice) return { type: 'select', opts: ['', mChoice[1].trim(), mChoice[2].trim()] };
    return { type: 'text', opts: null };
  }
  /* distinct fill tokens in a note, in first-seen order. onf-1.8.0: BOTH
     placeholder syntaxes land in this ONE box — "[FILL: label]" (template
     render path) AND "[[snake_key]]" (the _genOpNote AI path, which used to
     feed a separate one-at-a-time walker in ScribeFlow; the owner mandated
     exactly ONE fill mechanism, so the walker is retired and this box owns
     every blank). A [[key]] surfaces as its prettified label; the same label
     replaces both token forms. */
  function keyToLabel(k) { return S(k).toLowerCase().replace(/_/g, ' ').trim(); }
  function labelToKey(l) { return S(l).toLowerCase().trim().replace(/\s+/g, '_'); }
  /* onf-2.5.0 (owner report): templates from real past notes carry ANONYMOUS
     blanks — "___" runs and "[not dictated]" markers. The formatted view
     highlights them yellow but they never surfaced as fill fields. Convert
     each into a labeled [FILL: …] token (label = surrounding words, unique),
     so the ONE fill box owns every blank a doctor can see. */
  function normalizeAnonBlanks(text) {
    var t = S(text), seen = {};
    return t.replace(/_{3,}|\[not dictated[^\]]*\]/gi, function (m0, at) {
      var before = t.slice(Math.max(0, at - 44), at).replace(/[\[\]_]+/g, ' ').replace(/\s+/g, ' ').trim();
      var after = t.slice(at + m0.length, at + m0.length + 26).replace(/[\[\]_]+/g, ' ').replace(/\s+/g, ' ').trim();
      var bw = before.split(' ').slice(-4).join(' ').replace(/^[^A-Za-z0-9]+/, '');
      var aw = after.split(' ').slice(0, 2).join(' ');
      var label = ('after "' + bw + '"' + (aw ? (' before "' + aw + '"') : '')).slice(0, 70);
      var base = label, n = 2;
      while (seen[label.toLowerCase()]) label = base + ' #' + (n++);
      seen[label.toLowerCase()] = 1;
      return '[FILL: ' + label + ']';
    });
  }
  /* onf-2.11.0: the box now sees the THIRD placeholder shape — [CAPS LIKE
     THIS] — which _genOpNote itself emits ([LEVELS], [STEROID DOSE]…).
     Measured live at b712 on a real draft: 8 of 10 blanks were this shape and
     invisible to the box, while the draft-quarantine scanner already counted
     them. The alternative is deliberately strict (all-caps, 3-30 chars,
     starts/ends alphanumeric) so prose brackets and [[snake]] never match.
     KEEP IN SYNC with renderLayout() below — the edit-adoption math replays
     the same shapes; a shape known here but not there resets field state. */
  var CAPS_TOKEN_SRC = '\\[([A-Z][A-Z0-9 /&-]{1,28}[A-Z0-9])\\]';
  function fillTokens(text) {
    var re = new RegExp('\\[FILL:\\s*([^\\]]+?)\\s*\\]|\\[\\[([a-z0-9_]+)\\]\\]|' + CAPS_TOKEN_SRC, 'g'), seen = {}, out = [], m;
    while ((m = re.exec(text)) !== null) {
      var label = m[1] != null ? m[1].trim() : (m[2] != null ? keyToLabel(m[2]) : S(m[3]).toLowerCase().trim());
      var key = label.toLowerCase();
      if (!seen[key]) { seen[key] = 1; out.push(label); }
    }
    return out;
  }
  function replaceToken(text, label, value) {
    if (!value) return text;
    var q = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\[FILL:\\s*' + q + '\\s*\\]', 'gi');
    var out = text.replace(re, value);
    var qk = labelToKey(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp('\\[\\[' + qk + '\\]\\]', 'gi'), value);
    /* onf-2.11.0: the [CAPS] form of the same label (case-insensitive match,
       shape-anchored like CAPS_TOKEN_SRC so prose brackets stay untouched) */
    out = out.replace(new RegExp('\\[' + q + '\\]', 'gi'), function (m0) {
      return /^\[[A-Z][A-Z0-9 /&-]{1,28}[A-Z0-9]\]$/.test(m0) ? value : m0;
    });
    return out;
  }
  function noteBoxes() { return safe(function () { return document.querySelectorAll('textarea[id^="opPrepNote_"]'); }, []); }

  /* ================= onf-2.1.0: the fill box works OUTSIDE the op-prep modal too.
     The retired floating "N blank(s) to fill" walker used to cover [FILL:] tokens
     in the MAIN note editor; the fill box now owns those blanks as well, backed by
     a per-active-patient pseudo-row so known values, chart history, per-patient
     memory and dropdown history all behave exactly as they do in op-prep. */
  var MAIN_ID = 'noteBox';
  var _mainRows = {};
  function todayDateStr() {
    return safe(function () { return new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }, '');
  }
  function mainRowFor() {
    var p = safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null);
    if (!p || !S(p.name).trim()) return null;
    var key = S(p.id || p.mrn || p.name);
    var row = _mainRows[key];
    if (!row) {
      row = _mainRows[key] = { __onfMain: true, patientId: S(p.id), proc: '', tplId: '', dateStr: todayDateStr(), appt: {} };
    }
    /* refresh identity every pass — the active patient's record can gain a DOB/MRN */
    row.patientId = S(p.id);
    row.appt.patientId = S(p.id);
    row.appt.name = S(p.name).trim();
    row.appt.dob = S(p.dob).trim();
    row.appt.mrn = S(p.mrn || p.athenaId || '').trim();
    return row;
  }
  function rowFor(ta) {
    if (!ta || !ta.id) return null;
    if (ta.id === MAIN_ID) return mainRowFor();
    return safe(function () { return (window._opPrep || [])[+ta.id.replace('opPrepNote_', '')]; }, null);
  }
  function isPrepBox(ta) { return !!(ta && ta.id && ta.id.indexOf('opPrepNote_') === 0); }
  function mainBoxWithBlanks() {
    var ta = $(MAIN_ID);
    if (!ta || ta.offsetParent === null) return null;
    var hasTokens = /\[FILL:|\[\[[a-z0-9_]+\]\]|_{3,}|\[not dictated[^\]]*\]/i.test(ta.value || '')
      || new RegExp(CAPS_TOKEN_SRC).test(ta.value || '');
    /* also pick up a lingering fill box whose tokens were all just filled, so it re-renders/clears */
    var hasBox = ta.previousElementSibling && ta.previousElementSibling.classList && ta.previousElementSibling.classList.contains('onf-fillbox');
    return (hasTokens || hasBox) ? ta : null;
  }
  /* Length + placeholder count missed equal-length clinician edits, so the next
     tick could mistake an edited note for our prior render. Two cheap rolling
     hashes make the gate content-sensitive without retaining another full note. */
  function textSig(v) {
    v = S(v);
    var a = 2166136261, b = 5381;
    for (var i = 0; i < v.length; i++) {
      var c = v.charCodeAt(i);
      a ^= c;
      a = (a + ((a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24))) >>> 0;
      b = (((b << 5) + b) ^ c) >>> 0;
    }
    return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36);
  }
  function sigOf(ta) {
    var v = (ta && ta.value) || '';
    return v.length + '|' + ((v.match(/\[FILL:/gi) || []).length + (v.match(/\[\[[a-z0-9_]+\]\]/gi) || []).length
      + (v.match(new RegExp(CAPS_TOKEN_SRC, 'g')) || []).length) + '|' + textSig(v);
  }

  /* Auto-fill only identity already known from this visit or canonical Settings. */
  /* Practice/provider identity has one account-scoped source of truth. The
     former global mls_provider_profile key is deliberately not read or written. */
  function canonicalSetting(fn) { return safe(function () { return isFn(window[fn]) ? S(window[fn]()).trim() : ''; }, '') || ''; }
  function provProfile() {
    return {
      name: canonicalSetting('getProviderName'),
      cred: canonicalSetting('getProviderCred'),
      npi: canonicalSetting('getNpi'),
      practice: canonicalSetting('getPracticeName'),
      facility: ''
    };
  }
  function apptProvider(appt) { return S((appt && (appt.provider_raw || appt.provider_key || appt.provider)) || '').replace(/_/g, ' ').trim(); }
  function commonApptProvider() {
    return safe(function () {
      var appts = window._calAppts || [], t = {};
      for (var i = 0; i < appts.length; i++) { var n = apptProvider(appts[i]); if (n) t[n] = (t[n] || 0) + 1; }
      var best = '', bc = 0; for (var k in t) if (t[k] > bc) { bc = t[k]; best = k; } return best;
    }, '') || '';
  }
  /* Re-read canonical Settings every pass so edits apply immediately. An
     appointment provider may fill this draft only and is never persisted. */
  function seedProfile() {
    var p = provProfile();
    if (!S(p.name).trim()) p.name = commonApptProvider();
    return p;
  }
  function normPatientName(v) { return S(v).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function normPatientDob(v) { return S(v).replace(/\D/g, ''); }
  function rowPatientId(row) {
    var a = (row && row.appt) || {};
    return S((row && row.patientId) || a.patientId || a.patient_external_id || a._mlsTargetPatientId || '').trim();
  }
  /* Clinical autofill requires immutable patient-id ownership. Name-only and
     even name+DOB-only matching are not identity proof. */
  function chartPatient(row) {
    return safe(function () {
      var appt = row && row.appt; if (!appt) return null;
      var pid = rowPatientId(row); if (!pid) return null;
      var pts = isFn(window.getPatients) ? window.getPatients() : [];
      var p = null;
      for (var i = 0; i < pts.length; i++) {
        var q = pts[i]; if (q && S(q.id).trim() === pid) { p = q; break; }
      }
      if (!p) return null;
      if (S(appt.name).trim() && normPatientName(appt.name) !== normPatientName(p.name)) return null;
      if (S(appt.dob).trim() && normPatientDob(appt.dob) !== normPatientDob(p.dob)) return null;
      return p;
    }, null);
  }
  function verifiedHistoryVisits(p) {
    if (!p) return [];
    return safe(function () {
      var oni = window.__mlsOpNoteIntegrity;
      if (!oni || !isFn(oni._verifiedHistoryVisits)) return [];
      var visits = oni._verifiedHistoryVisits(p);
      return Array.isArray(visits) ? visits : [];
    }, []) || [];
  }
  function chartAge(p) {
    return safe(function () {
      var d = new Date(S(p.dob)); if (isNaN(d.getTime())) return 0;
      var now = new Date(), a = now.getFullYear() - d.getFullYear();
      if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
      return (a > 0 && a < 130) ? a : 0;
    }, 0) || 0;
  }
  /* onf-2.3.0: history / diagnosis blanks fill from the patient's OWN chart —
     problems list + latest documented plan. Chart-grounded only, never
     invented; when the chart has nothing, the field stays for the doctor. */
  /* onf-2.4.1: real pulled charts keep problems INSIDE the Athena visit raw
     ("<name> - Onset: MM/DD/YYYY") with p.problems empty — the integrity
     owner's chartProblems() extracts + procedure-ranks them; local fallback
     mirrors it for load-order safety. */
  function rowProblems(p, row) {
    var proc = S(row && (row.proc || (row.appt && row.appt.reason))).trim();
    var viaOni = safe(function () {
      var oni = window.__mlsOpNoteIntegrity;
      return oni && typeof oni.chartProblems === 'function' ? oni.chartProblems(p, proc) : null;
    }, null);
    if (viaOni && viaOni.length) return viaOni;
    var out = [], seen = {};
    var direct = S(p.problems).replace(/\s+/g, ' ').trim();
    if (direct) direct.split(/[;\n]/).forEach(function (x) { x = S(x).trim(); if (x && !seen[x.toLowerCase()]) { seen[x.toLowerCase()] = 1; out.push(x); } });
    if (!out.length) {
      var raw = ''; safe(function () { verifiedHistoryVisits(p).slice(0, 8).forEach(function (v) { raw += ' ' + S(v && v.raw); }); });
      var re = /([A-Z][A-Za-z0-9 ,()\/-]{2,60}?)\s*-\s*Onset:\s*\d{1,2}\/\d{1,2}\/\d{2,4}/g, m;
      while ((m = re.exec(raw)) !== null && out.length < 6) {
        var nm = S(m[1]).trim();
        while (/^(problems?|reviewed|problem list|active|list)\s+/i.test(nm)) nm = nm.replace(/^(problems?|reviewed|problem list|active|list)\s+/i, '');
        if (nm.length > 2 && !seen[nm.toLowerCase()]) { seen[nm.toLowerCase()] = 1; out.push(nm); }
      }
    }
    return out;
  }
  function chartValue(label, row) {
    var l = S(label).toLowerCase();
    /* onf-2.10.0 (owner: "never ask for things like patient history"): every
       chart-derivable field fills silently from the exact patient — history in
       all its spellings, meds, allergies, BMI. Empty chart data still asks
       (honest blank); nothing is ever invented. */
    if (!/history|diagnosis|indication|\bhpi\b|\bpmh\b|background|presentation|allerg|medication|\bmeds\b|\bbmi\b|body mass/.test(l)) return '';
    if (/postoperative|post ?op/.test(l)) return '';         /* postop stays the template's own value */
    var p = chartPatient(row); if (!p) return '';
    if (/allerg/.test(l)) return S(p.allergies).replace(/\s*\r?\n+\s*/g, '; ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (/medication|\bmeds\b/.test(l)) return S(p.meds || p.medications).replace(/\s*\r?\n+\s*/g, '; ').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (/\bbmi\b|body mass/.test(l)) { var b = patientBmi(row); return b ? S(b) : ''; }
    var probList = rowProblems(p, row);
    if (/diagnosis|indication/.test(l)) return S(probList[0] || '').slice(0, 140);
    var problems = probList.slice(0, 3).join('; ');
    var bits = [], age = chartAge(p), sex = S(p.sex || p.gender).trim();
    if (age && sex) bits.push(age + '-year-old ' + sex);
    if (problems) bits.push((bits.length ? 'with ' : '') + problems);
    var head = bits.join(' ');
    var plan = '';
    var vs = verifiedHistoryVisits(p); for (var i = 0; i < vs.length && !plan; i++) plan = S(vs[i] && vs[i].plan).replace(/\s+/g, ' ').trim();
    var out = [head, plan ? ('Most recent plan: ' + plan.slice(0, 160)) : ''].filter(Boolean).join('. ');
    return out ? (out.replace(/\.+$/, '') + '.') : '';
  }
  /* the patient's own recent chart text (for deriving laterality / prior values) */
  function patientHistText(row) {
    return safe(function () {
      var p = chartPatient(row);
      if (!p) return '';
      var vs = verifiedHistoryVisits(p).slice(0, 3), parts = [S(p.problems), S(p.summary)];
      for (var v = 0; v < vs.length; v++) parts.push(S(vs[v].plan), S(vs[v].findings), S(vs[v].raw).slice(0, 400));
      return parts.join(' ');
    }, '') || '';
  }
  /* Stable patient memory requires the row's immutable patient id. Display
     names, DOBs and MRNs are not used as ownership substitutes. */
  function patientKey(row) {
    var pid = rowPatientId(row);
    return pid ? ('pid:' + pid) : '';
  }
  /* Patient memory is nested in the resolved account namespace. Retired global
     keys are not read because their owning clinician cannot be proven. */
  var FILLMEM_PREFIX = 'opFillPatientMemV2::';
  function loadFillMem(row) {
    var k = patientKey(row); if (!k) return {};
    var raw = readScoped(FILLMEM_PREFIX + k, ''); if (!raw) return {};
    return safe(function () { return JSON.parse(raw) || {}; }, {}) || {};
  }
  function saveFillMemValue(row, fieldKey, val) {
    var k = patientKey(row); if (!k || !fieldKey) return;
    if (!scopedKey(FILLMEM_PREFIX + k)) return false;
    val = S(val).trim();
    var mem = loadFillMem(row);
    if (val) mem[fieldKey] = val; else delete mem[fieldKey];
    return writeScoped(FILLMEM_PREFIX + k, JSON.stringify(mem));
  }
  /* Explicit defaults are separate from recent history. A previous answer is
     suggested, but never silently promoted. */
  var DEFAULTS_SUFFIX = 'opFieldDefaultsV1';
  function fieldIdentity(label) { return S(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function anonymousField(label) {
    var s = S(label).trim();
    return /^after\s+["\u201c]/i.test(s) || (/\bafter\s+["\u201c]/i.test(s) && /\bbefore\s+["\u201c]/i.test(s));
  }
  function defaultEligible(label) {
    if (anonymousField(label)) return false;
    var l = S(label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!l) return false;
    /* Account defaults are an allowlist, not a broad "anything except patient
       identity" list. A clinical answer can be correct for one procedure and
       dangerous for the next, so diagnosis/history/medication/anatomy/findings,
       every date/time, implants/lots and procedure technique can never auto-fill
       across patients. Only stable practice identity and non-clinical equipment
       identification may be pinned. */
    if (/(\bpatient\b|date|time|\bday\b|\bdob\b|birth|\bmrn\b|medical record|chart (number|id|no)|account (number|no)|\bage\b|\bsex\b|\bgender\b|diagnos|\bdx\b|indication|history|\bhpi\b|medical|surgical|medication|\bmeds?\b|\bdrug\b|steroid|anesthetic|injectate|contrast|allerg|procedure|\boperation\b|technique|anatom|\bsite\b|\bside\b|laterality|\blevel\b|finding|complication|blood loss|specimen|implant|\blot\b|dose|volume|concentration|sedation|anesthesia|vital|\bbmi\b|disposition|consent|timeout|prep|needle|catheter)/.test(l)) return false;
    if (/\b(practice|clinic|facility|organization)\b/.test(l) && /\b(name|address|phone|fax)\b/.test(l)) return true;
    if (/\b(npi|provider credentials?|physician credentials?|surgeon credentials?|license number|taxonomy)\b/.test(l)) return true;
    if (/\b(operating provider|performing provider|performing physician|operating physician|surgeon name|dictated by)\b/.test(l)) return true;
    if (/\b(equipment|fluoroscopy (machine|unit)|ultrasound (machine|unit)|c arm)\b/.test(l) && /\b(model|make|manufacturer|serial|identifier|name)\b/.test(l)) return true;
    return false;
  }
  function loadDefaultsStore() {
    var raw = readScoped(DEFAULTS_SUFFIX, ''); if (!raw) return { schema: 1, fields: {} };
    var obj = safe(function () { return JSON.parse(raw); }, null);
    if (!obj || typeof obj !== 'object' || !obj.fields || typeof obj.fields !== 'object') return { schema: 1, fields: {} };
    return { schema: 1, fields: obj.fields };
  }
  function fieldDefault(label) {
    if (!defaultEligible(label)) return null;
    var rec = loadDefaultsStore().fields[fieldIdentity(label)];
    if (!rec || typeof rec !== 'object' || !S(rec.value).trim()) return null;
    return { label: S(rec.label || label), value: S(rec.value).trim(), updatedAt: +rec.updatedAt || 0 };
  }
  function saveFieldDefault(label, value) {
    label = S(label).trim(); value = S(value).trim();
    var id = fieldIdentity(label);
    if (!id || !value || !defaultEligible(label) || !scopedKey(DEFAULTS_SUFFIX)) return false;
    var store = loadDefaultsStore();
    store.fields[id] = { label: label.slice(0, 160), value: value.slice(0, 2000), updatedAt: Date.now() };
    var ok = writeScoped(DEFAULTS_SUFFIX, JSON.stringify(store));
    safe(function () { if (ok && isFn(window.syncPrefsToServer)) window.syncPrefsToServer(); });
    return ok;
  }
  function clearFieldDefault(label) {
    var id = fieldIdentity(label); if (!id || !scopedKey(DEFAULTS_SUFFIX)) return false;
    var store = loadDefaultsStore();
    if (!Object.prototype.hasOwnProperty.call(store.fields, id)) return true;
    delete store.fields[id];
    var ok = writeScoped(DEFAULTS_SUFFIX, JSON.stringify(store));
    safe(function () { if (ok && isFn(window.syncPrefsToServer)) window.syncPrefsToServer(); });
    return ok;
  }
  /* onf-1.7.0: read the patient's ACTUAL chart history for the medication they
     were given, so a steroid / anesthetic NAME field is pre-filled from what is
     actually in their record -- not a generic guess. Only fills a NAME; a
     dose/volume/concentration stays blank for the doctor (never invented). */
  function historyMed(label, row) {
    var l = S(label).toLowerCase();
    var hist = patientHistText(row).toLowerCase(); if (!hist) return '';
    if (/steroid|corticosteroid|cortico|kenalog|depo|injectate|\bmed(ication)?\b|\bdrug\b/.test(l) && !/dose|volume|\bmg\b|\bml\b|\bcc\b|mcg/.test(l)) {
      var STEROIDS = [
        [/triamcinolone|kenalog/, 'Triamcinolone'],
        [/methylprednisolone|depo-?medrol|depo medrol/, 'Methylprednisolone'],
        [/betamethasone|celestone/, 'Betamethasone'],
        [/dexamethasone|decadron/, 'Dexamethasone']
      ];
      for (var i = 0; i < STEROIDS.length; i++) if (STEROIDS[i][0].test(hist)) return STEROIDS[i][1];
    }
    if (/\banesthetic\b|lidocaine|bupivacaine|ropivacaine|marcaine/.test(l) && !/dose|volume|concentration|\bmg\b|\bml\b|\bcc\b/.test(l)) {
      var ANES = [
        [/bupivacaine|marcaine/, 'Bupivacaine'],
        [/ropivacaine/, 'Ropivacaine'],
        [/lidocaine|xylocaine/, 'Lidocaine']
      ];
      for (var j = 0; j < ANES.length; j++) if (ANES[j][0].test(hist)) return ANES[j][1];
    }
    return '';
  }
  /* A SAFE best-guess for a fill field, marked "suggested" and one-click editable:
     - laterality ONLY from a clear signal (never guess a side);
     - a finite either/or list -> the option that appears in the patient's own
       history/procedure, else the first real option;
     - free text -> blank (we never invent a clinical value like a drug/dose). */
  function smartDefault(label, spec, row) {
    var l = S(label).toLowerCase();
    var ctx = (S(row && row.proc) + ' ' + S(row && row.appt && row.appt.reason) + ' ' + patientHistText(row)).toLowerCase();
    if (/laterality|\bside\b/.test(l)) {
      /* single-letter side markers ("L SI joint inj") count only in the
         PROCEDURE text itself — the wider chart context is too noisy */
      var procTxt = (S(row && row.proc) + ' ' + S(row && row.appt && row.appt.reason)).toLowerCase();
      if (/bilateral|both sides|\bb\s*\/\s*l\b/.test(ctx) || /\bb\s*\/\s*l\b/.test(procTxt)) return 'Bilateral';
      var lft = /\bleft\b|\blt\b|left[- ]sided/.test(ctx) || /(^|[^a-z0-9])l(?=[^a-z0-9])/.test(procTxt);
      var rgt = /\bright\b|\brt\b|right[- ]sided/.test(ctx) || /(^|[^a-z0-9])r(?=[^a-z0-9])/.test(procTxt);
      if (lft && !rgt) return 'Left';
      if (rgt && !lft) return 'Right';
      return '';
    }
    if (spec.type === 'select' && spec.opts && spec.opts.length > 1) {
      for (var i = 1; i < spec.opts.length; i++) { var o = S(spec.opts[i]).toLowerCase(); if (o && ctx.indexOf(o) >= 0) return spec.opts[i]; }
      return spec.opts[1] || '';
    }
    /* OWNER DIRECTIVE 2026-07-13: standard procedure fields PRE-FILL with the
       widely-standard value instead of sitting blank — always rendered as
       "suggested" (amber) at the top of the draft for the doctor to correct,
       and nothing signs or leaves MLS without review. Chart-derived values
       (known > saved > chart) still take precedence over these. */
    var STD = [
      [/local anesthetic.*volume|local anesthetic\b/, '1% lidocaine, 3 mL'],
      [/steroid.*dose|steroid \+/, 'Dexamethasone 10 mg'],
      [/anesthetic.*volume|injectate.*anesthetic/, '0.25% bupivacaine, 1 mL'],
      [/agent.*volume|volume.*agent|injectate|per point|per level/, '0.25% bupivacaine + dexamethasone, 1 mL per point'],
      [/contrast.*volume/, '1 mL'],
      [/fluoro/, '< 1 minute'],
      [/^interval\b|follow.?up interval/, '6 weeks'],
      [/needle length/, '3.5-inch']
    ];
    for (var s2 = 0; s2 < STD.length; s2++) { if (STD[s2][0].test(l)) return STD[s2][1]; }
    /* onf-2.2.0 (owner directive): needle size pre-selects by the patient's
       BMI — the deeper the target, the longer the suggested needle. Amber
       "suggested"; the dropdown carries the alternatives. */
    if (/needle|gauge/.test(l)) return needleOpts(row)[0];
    /* anything else dose/level/count-like stays blank - patient-specific,
       never invented. */
    if (/\b(dose|dosage|volume|amount|\bmg\b|\bml\b|\bcc\b|mcg|units|concentration|levels?|which level|how many|number of|count)\b/.test(l)) return '';
    /* Explicit guidance stated in the procedure/dictation context is
       recognized directly; only then fall back to the common default. */
    if (/imaging( guidance| modality)?|\bguidance\b/.test(l)) {
      if (/fluoro/.test(ctx)) return 'Fluoroscopy';
      if (/ultrasound|\bus[- ]guided\b/.test(ctx)) return 'Ultrasound';
      if (/\bct[- ]guided\b|\bct guidance\b/.test(ctx)) return 'CT guidance';
      return 'Fluoroscopy';
    }
    var CD = [
      [/type of anesthesia|anesthesia type/, 'Local anesthesia'],
      [/local anesthetic|anesthetic( agent| used| type)?$|lidocaine/, '1% lidocaine'],
      [/\bsedation\b/, 'None - local anesthesia only'],
      [/needle( gauge| size)?/, '22-gauge'],
      [/patient position|positioning/, 'Prone'],
      [/skin prep|antisep|prep solution|sterile prep/, 'Chlorhexidine'],
      [/contrast( agent| type)?/, 'Iodinated contrast'],
      [/estimated blood loss|\bebl\b/, 'Minimal']
      /* consent and complications are deliberately ABSENT: attesting consent
         or "no complications" from nothing invents a clinical fact — those
         fields stay blank until dictated or explicitly confirmed. */
    ];
    for (var c = 0; c < CD.length; c++) { if (CD[c][0].test(l)) return CD[c][1]; }
    return '';
  }
  function knownValue(label, row) {
    var l = S(label).toLowerCase().replace(/[^a-z0-9 \/]/g, ' ').replace(/\s+/g, ' ').trim();
    var appt = (row && row.appt) || {};
    var prof = seedProfile();   /* onf-2.3.0: Settings-backed (name/practice/NPI) */
    var prov = apptProvider(appt) || S(prof.name).trim();
    if (prov && S(prof.cred).trim() && prov.toLowerCase().indexOf(S(prof.cred).trim().toLowerCase()) < 0) prov += ', ' + S(prof.cred).trim();
    var pname = S(appt.name).trim();
    var dob = S(appt.dob).trim();
    var mrn = S(appt.athenaId || appt.mrn || '').trim();
    var dt = S((row && row.dateStr) || '').replace(/^[A-Za-z]+,\s*/, '').trim();
    var isProv = /(provider|physician|surgeon|\bdoctor\b|operator|attending|clinician|proceduralist|performed by|operating|rendering)/.test(l);
    /* An NPI field may only receive an actual NPI. Falling through to the
       generic provider-name rule put "Matthew Schaeffer, MD" in NPI blanks. */
    if (/\bnpi\b/.test(l)) return S(prof.npi).trim();
    if (/(practice name|\bpractice\b|group name|group practice)/.test(l) && S(prof.practice).trim()) return S(prof.practice).trim();
    if (/(facility|clinic|location|site|hospital|center|ambulatory|surgery center|\basc\b)/.test(l) && S(prof.facility).trim()) return S(prof.facility).trim();
    if (isProv && prov) return prov;
    if (/(date of birth|birth ?date|\bdob\b)/.test(l) && dob) return dob;
    if (/(date of procedure|procedure date|date of service|service date|\bdos\b|date of operation|operation date|encounter date|todays date|today s date)/.test(l) && dt) return dt;
    if (/(mrn|medical record|patient id|chart (number|id|no)|account (number|no))/.test(l) && mrn && plausibleMrn(mrn)) return mrn;
    if (!isProv && /(patient name|patient|^name$|full name)/.test(l) && pname) return pname;
    return '';
  }
  function autoFillKnown(ta) {
    var idx = ta.id.replace('opPrepNote_', '');
    var row = safe(function () { return (window._opPrep || [])[+idx]; }, null);
    if (!row) return;
    var tokens = fillTokens(ta.value || ''), txt = ta.value || '', changed = false;
    for (var i = 0; i < tokens.length; i++) {
      var v = knownValue(tokens[i], row);
      if (v) { var nt = replaceToken(txt, tokens[i], v); if (nt !== txt) { txt = nt; changed = true; } }
    }
    if (changed) {
      ta.value = txt;
      safe(function () { ta.dispatchEvent(new Event('input', { bubbles: true })); });
      safe(function () { if (window._opPrep && window._opPrep[+idx]) window._opPrep[+idx].note = txt; });
    }
  }

  /* onf-1.2.0: GUARANTEED PERSONALIZATION. The AI draft sometimes writes "the
     patient" generically (name/DOB/date omitted). This deterministically
     ensures every drafted op-note carries a patient header with the real name,
     DOB and procedure date -- so the note is always personalized, never generic,
     regardless of AI variance. Added once per draft (skipped if a PATIENT: line
     already exists), and never leaves placeholder/example data. */
  function ensureHeader(ta) {
    var idx = ta.id.replace('opPrepNote_', '');
    var row = safe(function () { return (window._opPrep || [])[+idx]; }, null);
    if (!row || !row.appt) return;
    /* A selected template owns the complete document structure. The integrity
       layer already verifies patient identity and template fidelity before this
       UI enhancer runs, so never prepend an MLS-only heading afterward. Keep
       the legacy fallback only for genuinely untemplated drafts. */
    if (S(row.tplId || row.templateId || (row._ctx && row._ctx.templateId)).trim()) return;
    var val = ta.value || '';
    if (!val.trim()) return;                                  /* not drafted yet */
    if (/(^|\n)\s*PATIENT\s*:/i.test(val)) return;            /* already has a patient header */
    var nm = S(row.appt.name).trim();
    if (!nm) return;
    var dob = S(row.appt.dob).trim();
    var mrn = S(row.appt.athenaId || row.appt.mrn || '').trim();
    var dt = S(row.dateStr || '').replace(/^[A-Za-z]+,\s*/, '').trim();
    var bits = ['PATIENT: ' + nm];
    if (dob) bits.push('DOB: ' + dob);
    if (mrn && plausibleMrn(mrn)) bits.push('MRN: ' + mrn);
    if (dt) bits.push('DATE OF PROCEDURE: ' + dt);
    var header = bits.join('    ') + '\n\n';
    ta.value = header + val;
    safe(function () { ta.dispatchEvent(new Event('input', { bubbles: true })); });
    safe(function () { if (window._opPrep && window._opPrep[+idx]) window._opPrep[+idx].note = ta.value; });
  }

  /* render a raw template (with [FILL:] tokens) using a label->value map */
  function applyVals(raw, vals) {
    var out = S(raw), tk = fillTokens(out);
    for (var i = 0; i < tk.length; i++) { var v = vals && vals[tk[i].toLowerCase()]; if (v) out = replaceToken(out, tk[i], v); }
    return out;
  }
  function renderLayout(raw, vals) {
    raw = S(raw); vals = vals || {};
    /* MUST enumerate the same shapes as fillTokens (see CAPS_TOKEN_SRC note) */
    var re = new RegExp('\\[FILL:\\s*([^\\]]+?)\\s*\\]|\\[\\[([a-z0-9_]+)\\]\\]|' + CAPS_TOKEN_SRC, 'g'), parts = [], rendered = '', at = 0, m;
    function addLiteral(s) {
      if (!s) return;
      parts.push({ kind: 'literal', raw: s, rendered: s, renderStart: rendered.length, renderEnd: rendered.length + s.length });
      rendered += s;
    }
    while ((m = re.exec(raw)) !== null) {
      addLiteral(raw.slice(at, m.index));
      var token = m[0], label = m[1] != null ? S(m[1]).trim() : (m[2] != null ? keyToLabel(m[2]) : S(m[3]).toLowerCase().trim()), key = label.toLowerCase();
      var value = S(vals[key]), shown = value ? value : token;
      parts.push({ kind: 'token', raw: token, rendered: shown, label: label, key: key, renderStart: rendered.length, renderEnd: rendered.length + shown.length });
      rendered += shown;
      at = m.index + token.length;
    }
    addLiteral(raw.slice(at));
    return { rendered: rendered, parts: parts };
  }
  function editSpan(base, edited) {
    base = S(base); edited = S(edited);
    var start = 0, max = Math.min(base.length, edited.length);
    while (start < max && base.charCodeAt(start) === edited.charCodeAt(start)) start++;
    var tail = 0, bRemain = base.length - start, eRemain = edited.length - start;
    while (tail < bRemain && tail < eRemain && base.charCodeAt(base.length - 1 - tail) === edited.charCodeAt(edited.length - 1 - tail)) tail++;
    return { start: start, baseEnd: base.length - tail, editedEnd: edited.length - tail, replacement: edited.slice(start, edited.length - tail) };
  }
  function tokenTouched(part, span) {
    if (!part || part.kind !== 'token') return false;
    if (span.start === span.baseEnd) return span.start > part.renderStart && span.start < part.renderEnd;
    return span.start < part.renderEnd && span.baseEnd > part.renderStart;
  }
  function cloneVals(vals) { var out = {}, k; for (k in (vals || {})) if (Object.prototype.hasOwnProperty.call(vals, k)) out[k] = vals[k]; return out; }
  function pruneFieldState(row) {
    var active = {}, tokens = fillTokens(row && row._onfRaw || ''), i, k;
    for (i = 0; i < tokens.length; i++) active[tokens[i].toLowerCase()] = true;
    for (k in (row._onfVals || {})) if (!active[k]) delete row._onfVals[k];
    for (k in (row._onfDefaultKeys || {})) if (!active[k]) delete row._onfDefaultKeys[k];
  }
  /* Adopt a textarea edit as the new source of truth before any re-render.
     The normal case (editing prose around a field) patches the raw template and
     leaves every placeholder/control intact. Editing a field value directly is
     reconciled back into that field when the result is unambiguous. A complex
     cross-field edit materializes only the touched fields; untouched fields stay
     live. The final fallback keeps the clinician's exact text, never our stale
     render. */
  function adoptRenderedEdits(row, edited) {
    if (!row || row._onfRaw == null || row._onfLastRender == null) return false;
    edited = S(edited);
    var base = S(row._onfLastRender);
    if (edited === base) return false;
    var vals = row._onfVals || {}, layout = renderLayout(row._onfRaw, vals);
    if (layout.rendered !== base) {
      row._onfRaw = edited; row._onfVals = {}; row._onfDefaultKeys = {}; row._onfLastRender = edited;
      return true;
    }
    var span = editSpan(base, edited), contained = null, i;
    for (i = 0; i < layout.parts.length; i++) {
      var pt = layout.parts[i];
      if (pt.kind !== 'token') continue;
      var inside = span.start >= pt.renderStart && span.baseEnd <= pt.renderEnd;
      if (span.start === span.baseEnd) inside = span.start > pt.renderStart && span.start < pt.renderEnd;
      if (inside) { contained = pt; break; }
    }
    if (contained) {
      var candidateVals = cloneVals(vals), oldValue = contained.rendered;
      candidateVals[contained.key] = oldValue.slice(0, span.start - contained.renderStart) + span.replacement + oldValue.slice(span.baseEnd - contained.renderStart);
      if (candidateVals[contained.key] && applyVals(row._onfRaw, candidateVals) === edited) {
        row._onfVals = candidateVals;
        if (row._onfDefaultKeys) delete row._onfDefaultKeys[contained.key];
        row._onfLastRender = edited;
        return true;
      }
    }
    var hybrid = '', maps = [];
    for (i = 0; i < layout.parts.length; i++) {
      var part = layout.parts[i], materialize = tokenTouched(part, span);
      var piece = (part.kind === 'token' && !materialize) ? part.raw : part.rendered;
      maps.push({ baseStart: part.renderStart, baseEnd: part.renderEnd, hybridStart: hybrid.length, hybridEnd: hybrid.length + piece.length, direct: piece.length === (part.renderEnd - part.renderStart) });
      hybrid += piece;
    }
    function mapBoundary(pos) {
      if (pos <= 0) return 0;
      for (var x = 0; x < maps.length; x++) {
        var mp = maps[x];
        if (pos === mp.baseStart) return mp.hybridStart;
        if (pos === mp.baseEnd) return mp.hybridEnd;
        if (pos > mp.baseStart && pos < mp.baseEnd) {
          if (mp.direct) return mp.hybridStart + (pos - mp.baseStart);
          return mp.hybridStart + Math.round((pos - mp.baseStart) * (mp.hybridEnd - mp.hybridStart) / Math.max(1, mp.baseEnd - mp.baseStart));
        }
      }
      return hybrid.length;
    }
    var hs = mapBoundary(span.start), he = mapBoundary(span.baseEnd);
    var nextRaw = hybrid.slice(0, hs) + span.replacement + hybrid.slice(he);
    if (applyVals(nextRaw, vals) === edited) {
      row._onfRaw = nextRaw; row._onfLastRender = edited; pruneFieldState(row); return true;
    }
    row._onfRaw = edited; row._onfVals = {}; row._onfDefaultKeys = {}; row._onfLastRender = edited;
    return true;
  }
  function freshRawDraft(row, value) {
    var normalized = normalizeAnonBlanks(value), now = fillTokens(normalized);
    if (!now.length) return '';
    if (!row || row._onfRaw == null) return normalized;
    var old = {}, i; fillTokens(row._onfRaw).forEach(function (label) { old[label.toLowerCase()] = true; });
    for (i = 0; i < now.length; i++) {
      var key = now[i].toLowerCase();
      if (!old[key] || (row._onfVals && row._onfVals[key])) return normalized;
    }
    return '';
  }
  function resetRawDraft(row, raw) {
    row._onfRaw = raw; row._onfVals = {}; row._onfDefaultKeys = {}; row._onfLastRender = null;
  }
  function acceptExternalEdit(row, value) {
    if (!row) return false;
    var fresh = freshRawDraft(row, value);
    if (fresh) { resetRawDraft(row, fresh); return true; }
    return adoptRenderedEdits(row, value);
  }
  function wireTextareaEdits(ta) {
    if (!ta || !isFn(ta.addEventListener) || ta.__mlsOnfEditWired) return;
    ta.__mlsOnfEditWired = true;
    ta.addEventListener('input', function () {
      var row = rowFor(ta);
      if (!row || row._onfWriting) return;
      acceptExternalEdit(row, ta.value || '');
    });
  }
  function writeRendered(ta, row, value) {
    value = S(value);
    if (!ta) return;
    if (row) row._onfWriting = true;
    try {
      if ((ta.value || '') !== value) {
        /* onf-2.8.0: a machine render is NOT a clinician edit. The input event
           below trips the app's inline edited-flag (value !== _genNote), which
           used to mis-arm the "discard my edits?" guard and make "Draft all"
           skip untouched rows. Snapshot and restore the flag; real hand-typing
           still flows through the textarea's own input path and marks edits. */
        var wasEdited = row ? !!row.edited : false;
        ta.value = value;
        safe(function () { ta.dispatchEvent(new Event('input', { bubbles: true })); });
        if (row) row.edited = wasEdited;
      }
      if (row) row._onfLastRender = value;
    } finally { if (row) row._onfWriting = false; }
  }
  function existingFillBox(ta) {
    if (!ta) return null;
    var immediate = ta.previousElementSibling;
    var existing = immediate && immediate.classList && immediate.classList.contains('onf-fillbox') ? immediate : null;
    var all = safe(function () { return document.querySelectorAll('.onf-fillbox'); }, []) || [];
    for (var i = 0; i < all.length; i++) {
      var box = all[i], owner = safe(function (b) { return function () { return b.getAttribute('data-onf-for'); }; }(box), '');
      if (box !== immediate && owner !== ta.id) continue;
      if (!existing) existing = box;
      else if (box !== existing) safe(function (b) { return function () { if (b.parentNode) b.parentNode.removeChild(b); else if (isFn(b.remove)) b.remove(); }; }(box));
    }
    if (existing) safe(function () { existing.setAttribute('data-onf-for', ta.id); });
    return existing;
  }
  function openDraftBoxes() {
    return safe(function () { return document.querySelectorAll('textarea[id^="opPrepNote_"],#' + MAIN_ID); }, []) || [];
  }
  function refreshOpenFillBoxes() {
    var boxes = openDraftBoxes();
    for (var i = 0; i < boxes.length; i++) safe(function (ta) { return function () { buildFillBox(ta); }; }(boxes[i]));
  }
  /* A pin applies only to the exact normalized label in drafts that are already
     open. The raw template stays untouched; only that placeholder's value map
     changes, preserving template headings and fixed wording. */
  function applyDefaultToBoxes(label, value, boxes, repaint) {
    var wanted = fieldIdentity(label), changed = 0;
    boxes = boxes || [];
    if (!wanted || !defaultEligible(label)) return 0;
    for (var i = 0; i < boxes.length; i++) {
      var ta = boxes[i], row = rowFor(ta); if (!row || row._onfRaw == null) continue;
      var tokens = fillTokens(row._onfRaw), matched = false;
      row._onfVals = row._onfVals || {}; row._onfDefaultKeys = row._onfDefaultKeys || {};
      for (var t = 0; t < tokens.length; t++) {
        if (fieldIdentity(tokens[t]) !== wanted) continue;
        var tokenKey = tokens[t].toLowerCase(), protectedValue = knownValue(tokens[t], row);
        if (!protectedValue) protectedValue = historyMed(tokens[t], row) || chartValue(tokens[t], row);
        if (!protectedValue) protectedValue = templateDefault(tokens[t], row);
        if (!protectedValue) protectedValue = loadFillMem(row)[tokenKey];
        if (protectedValue) continue;
        row._onfVals[tokenKey] = value;
        row._onfDefaultKeys[tokenKey] = true;
        matched = true;
      }
      if (!matched) continue;
      var out = applyVals(row._onfRaw, row._onfVals);
      writeRendered(ta, row, out);
      if (isPrepBox(ta)) {
        var idx = +ta.id.replace('opPrepNote_', '');
        safe(function () { if (window._opPrep && window._opPrep[idx]) window._opPrep[idx].note = out; });
        safe(function () { if (isFn(window.opPrepAutosaveDraft)) window.opPrepAutosaveDraft(idx); });
      }
      changed++;
    }
    if (repaint !== false) refreshOpenFillBoxes();
    return changed;
  }
  function applyDefaultToOpen(label, value) { return applyDefaultToBoxes(label, value, openDraftBoxes(), true); }
  function stopDefaultInOpen(label) {
    var wanted = fieldIdentity(label), boxes = openDraftBoxes();
    for (var i = 0; i < boxes.length; i++) {
      var row = rowFor(boxes[i]); if (!row || !row._onfDefaultKeys) continue;
      var tokens = fillTokens(row._onfRaw || '');
      for (var t = 0; t < tokens.length; t++) if (fieldIdentity(tokens[t]) === wanted) delete row._onfDefaultKeys[tokens[t].toLowerCase()];
    }
    refreshOpenFillBoxes();
  }
  /* onf-1.4.0: RAW-TEMPLATE + VALUES model. The drafted note is kept verbatim as
     the raw template; every [FILL:] field is PRE-FILLED (known identity/profile
     value, or a safe smart-default best-guess) and the note is rendered from
     raw+values, so a field can be changed any number of times with one click and
     the note re-renders correctly (no value collisions, no token loss). */
  /* onf-1.9.0 (owner directive): every best-guess field is a DROPDOWN - the
     #1 guess pre-selected, guesses #2/#3 as alternatives, the doctor's own
     previously-used values above the generic ones, and "Other (type custom)"
     last. Never type from scratch in the common case. */
  /* onf-2.2.0: the patient's BMI (chart record or op-prep ctx) drives the
     needle suggestion — a deeper target needs a longer needle. The doctor
     always sees it as an amber "suggested" dropdown and can change it. */
  function patientBmi(row) {
    return safe(function () {
      var direct = parseFloat(row && (row.bmi || (row.appt && row.appt.bmi)));
      if (direct > 0) return direct;
      var p = chartPatient(row); if (!p) return 0;
      var b = parseFloat(p.bmi); return b > 0 ? b : 0;
    }, 0) || 0;
  }
  function needleOpts(row) {
    var bmi = patientBmi(row);
    if (bmi >= 35) return ['22-gauge, 5-inch', '25-gauge, 5-inch', '22-gauge, 3.5-inch'];
    if (bmi >= 30) return ['22-gauge, 3.5-inch', '22-gauge, 5-inch', '25-gauge, 3.5-inch'];
    /* onf-2.8.0: at normal BMI the FIRST option depends on target depth. A
       spinal/deep target (epidural, facet, MBB/RFA, SI, kypho, discogram,
       stim) takes the standard 3.5-inch spinal needle — matching the app's
       BMI rule (_predictNeedleSize) instead of contradicting it; the short
       1.5-inch leads only for superficial targets (trigger point, bursa,
       peripheral joints/nerves). */
    var procTxt = (S(row && row.proc) + ' ' + S(row && row.appt && row.appt.reason)).toLowerCase();
    var deep = /epidural|transforaminal|interlaminar|caudal|facet|medial branch|rhizotomy|ablation|\brfa\b|sacroiliac|\bsi joint\b|kyphoplasty|vertebroplasty|discogram|stimulator|\bscs\b|intracept|basivertebral|\bmild\b/.test(procTxt);
    if (deep) return ['25-gauge, 3.5-inch', '22-gauge, 3.5-inch', '25-gauge, 1.5-inch'];
    return ['25-gauge, 1.5-inch', '22-gauge, 3.5-inch', '27-gauge, 1.25-inch'];
  }
  /* onf-2.6.0 field-schema separation: a GAUGE field offers gauges (never
     lengths), a steroid NAME field offers names (never doses — a separate dose
     field exists), a contrast AGENT field offers agents (never volumes), and a
     DISPOSITION field can never be served patient POSITIONS (the old bare
     /position/ regex matched "disposition"). More-specific patterns first. */
  function needleGauges(row) {
    var seen = {}, out = [];
    needleOpts(row).forEach(function (c) { var g = (c.split(',')[0] || '').trim(); if (g && !seen[g]) { seen[g] = 1; out.push(g); } });
    return out;
  }
  function needleLengths(row) {
    var seen = {}, out = [];
    needleOpts(row).forEach(function (c) { var g = (c.split(',')[1] || '').trim(); if (g && !seen[g]) { seen[g] = 1; out.push(g); } });
    return out;
  }
  function altGuesses(label, row) {
    var l = S(label).toLowerCase();
    var A = [
      [/local anesthetic/, ['1% lidocaine, 3 mL', '2% lidocaine, 2 mL', '0.25% bupivacaine, 2 mL']],
      [/steroid.*dose|dose.*steroid/, ['40 mg', '80 mg', '20 mg', '10 mg']],
      [/steroid/, ['Dexamethasone', 'Triamcinolone (Kenalog)', 'Methylprednisolone (Depo-Medrol)', 'Betamethasone']],
      [/agent.*volume|volume.*agent|injectate|per point|per level|anesthetic.*volume/, ['0.25% bupivacaine + dexamethasone, 1 mL per point', '1% lidocaine, 1 mL per point', '0.25% bupivacaine, 1 mL', '0.5% bupivacaine, 0.5 mL per point']],
      [/gauge/, needleGauges(row)],
      [/needle.*length|length.*needle|\blength\b/, needleLengths(row)],
      [/needle/, needleOpts(row)],
      [/contrast.*(volume|amount|ml)|(volume|amount).*contrast/, ['1 mL', '2 mL', '0.5 mL']],
      [/contrast/, ['Iohexol (Omnipaque)', 'Iopamidol (Isovue)', 'None — no contrast used']],
      [/fluoro/, ['< 1 minute', '~1 minute', '~2 minutes']],
      [/\bnumber\b|\bcount\b|how many|points|levels/, ['2', '3', '4', '1', '5', '6']],
      [/interval|follow.?up/, ['6 weeks', '2 weeks', '3 months']],
      [/disposition/, ['Discharged home in stable condition', 'Observed in recovery, then discharged home', 'Transferred for further evaluation']],
      [/position/, ['Prone', 'Supine', 'Lateral decubitus']],
      [/sedation/, ['None - local anesthesia only', 'MAC sedation', 'Oral anxiolysis']],
      [/imaging|guidance/, ['Fluoroscopy', 'Ultrasound', 'CT guidance']],
      [/prep|antisep/, ['Chlorhexidine', 'Betadine (povidone-iodine)', 'Alcohol']],
      [/complication/, ['None', 'Vasovagal episode - resolved with observation', 'See note']],
      [/blood loss|\bebl\b/, ['Minimal', 'None', '< 5 mL']],
      [/laterality|\bside\b/, ['Left', 'Right', 'Bilateral']]
    ];
    for (var i = 0; i < A.length; i++) if (A[i][0].test(l)) return A[i][1].slice();
    return [];
  }
  var OTHER = '__onf_other__';
  /* onf-2.0.0 (owner HIGH 2026-07-13): a template may specify its OWN standard
     value for a field ("Skin prep: Chlorhexidine" as concrete text). The
     template is the source of truth where it speaks - its value outranks any
     generic guess (but identity/chart/doctor-saved values still come first,
     since they are about THIS patient). */
  function templateDefault(label, row) {
    try {
      var tpl = (row && row.tplId && typeof window.getTemplateById === 'function') ? window.getTemplateById(row.tplId) : null;
      if (!tpl || !tpl.text) return '';
      var words = S(label).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2; });
      if (!words.length) return '';
      var lines = String(tpl.text).split(/\n/);
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(/^\s*([A-Za-z][A-Za-z +\/&()-]{2,42}):\s*(.+?)\s*$/);
        if (!m) continue;
        var lab = m[1].toLowerCase(), val = m[2];
        if (!val || /\[\s*fill/i.test(val) || /\[\[[a-z0-9_]+\]\]/i.test(val) || /^[_.\s-]+$/.test(val) || val.length > 80) continue;
        var all = true;
        for (var w = 0; w < words.length; w++) { if (lab.indexOf(words[w]) < 0) { all = false; break; } }
        if (all) return val;
      }
    } catch (e) {}
    return '';
  }
  function priorValues(label) {
    /* onf-2.8.0: the shared history store may have learned clinical values
       before the write-side gate existed — stop READING them for clinical
       fields too, so nothing patient-specific ever crosses charts. */
    if (!defaultEligible(label)) return [];
    if (!scopedKey('opFieldVals')) return [];
    var key = S(label).toLowerCase();
    /* history was written under the space form by this box and under the
       snake_case form by the retired ScribeFlow walker — read BOTH */
    var prev = safe(function () {
      if (typeof window.getOpFieldVals !== 'function') return [];
      var a = window.getOpFieldVals(key) || [], b = window.getOpFieldVals(labelToKey(label)) || [];
      return a.concat(b);
    }, []) || [];
    var out = [], seen = {};
    prev.forEach(function (v) { v = S(v).trim(); var n = v.toLowerCase(); if (v && !seen[n]) { seen[n] = 1; out.push(v); } });
    return out;
  }
  function buildOptions(label, cur, row) {
    var prev = priorValues(label);
    var opts = [], seen = {};
    function add(v) { v = S(v).trim(); if (!v || seen[v.toLowerCase()]) return; seen[v.toLowerCase()] = 1; opts.push(v); }
    add(cur);
    prev.slice(0, 3).forEach(add);            /* the doctor's own answers first */
    altGuesses(label, row).forEach(add);      /* then the standard alternatives */
    return opts;
  }
  function resolveInitialField(label, row, patientMem) {
    var spec = fieldSpec(label), value = knownValue(label, row);
    if (value) return { value: value, kind: 'known' };
    value = historyMed(label, row);
    if (value) { saveFillMemValue(row, S(label).toLowerCase(), value); return { value: value, kind: 'history' }; }
    value = chartValue(label, row);
    if (value) {
      /* A diagnosis/indication lifted from the problem list is a SUGGESTION
         until the clinician confirms it for THIS encounter — it must never
         render as a confirmed chart fill. */
      if (/diagnosis|indication/.test(S(label).toLowerCase())) return { value: value, kind: 'suggested' };
      return { value: value, kind: 'history' };
    }
    value = templateDefault(label, row);
    if (value) return { value: value, kind: 'template' };
    value = patientMem && patientMem[S(label).toLowerCase()];
    if (value) return { value: value, kind: 'saved' };
    var pinned = fieldDefault(label);
    if (pinned) return { value: pinned.value, kind: 'default' };
    value = smartDefault(label, spec, row);
    return value ? { value: value, kind: 'suggested' } : { value: '', kind: 'blank' };
  }
  function buildFillBox(ta) {
    var prep = isPrepBox(ta);
    var idx = prep ? ta.id.replace('opPrepNote_', '') : 'main';
    var row = rowFor(ta);
    var existing = existingFillBox(ta);
    /* A newly generated raw draft resets field state. Any other difference from
       our last render is first adopted into the raw+values model, so re-opening
       or ticking the Fields box can never roll back clinician prose edits. */
    if (row) {
      var fresh = freshRawDraft(row, ta.value || '');
      if (fresh) resetRawDraft(row, fresh);
      else if (row._onfLastRender != null && S(ta.value) !== S(row._onfLastRender)) adoptRenderedEdits(row, ta.value || '');
      wireTextareaEdits(ta);
    }
    var raw = (row && row._onfRaw != null) ? row._onfRaw : (ta.value || '');
    var tokens = fillTokens(raw);
    if (!tokens.length) { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); return; }
    css();
    var vals = (row && row._onfVals) || {}, meta = {};
    var pmem = row ? loadFillMem(row) : {};                      /* onf-1.7.0: this patient's saved fills */
    for (var t = 0; t < tokens.length; t++) {
      var lab = tokens[t], key = lab.toLowerCase();
      if (vals[key] == null) {
        var resolved = resolveInitialField(lab, row, pmem);
        vals[key] = resolved.value; meta[key] = resolved.kind;
        if (resolved.kind === 'default') { row._onfDefaultKeys = row._onfDefaultKeys || {}; row._onfDefaultKeys[key] = true; }
        /* onf-2.8.0: machine-suggested (amber) values are tracked until the
           clinician touches or explicitly accepts them — the save path uses
           this to ask for one confirming look before a note finalizes. */
        if (row && resolved.kind === 'suggested' && resolved.value && !(row._onfTouched && row._onfTouched[key])) {
          row._onfSuggestedPending = row._onfSuggestedPending || {};
          row._onfSuggestedPending[key] = lab;
        }
      } else meta[key] = vals[key] ? ((row && row._onfDefaultKeys && row._onfDefaultKeys[key]) ? 'default' : 'set') : 'blank';
    }
    if (row) row._onfVals = vals;
    /* render the note from raw + current values */
    var rendered = applyVals(raw, vals);
    writeRendered(ta, row, rendered);
    if (prep) safe(function () { if (window._opPrep && window._opPrep[+idx]) window._opPrep[+idx].note = rendered; });
    /* build the box: EVERY field shown, pre-set, marked known / suggested / blank */
    var box = existing || document.createElement('div');
    box.className = 'onf-fillbox';
    safe(function () { box.setAttribute('data-onf-for', ta.id); });
    /* onf-2.10.0 (owner: "way too many fields — it should know way more"):
       fields the app filled CONFIDENTLY (chart / schedule / settings /
       template / the doctor's own saved answers) collapse into a review
       expander; the doctor only faces genuine unknowns and amber
       suggestions. Every collapsed field stays fully editable inside the
       expander — nothing is hidden, it's just no longer asking. */
    var askHtml = [], autoHtml = [];
    tokens.forEach(function (label) {
      var key = label.toLowerCase(), spec = fieldSpec(label), cur = vals[key] || '', kind = meta[key] || 'blank';
      var fid = 'onfF_' + idx + '_' + key.replace(/[^a-z0-9]+/g, '_'), ctrl;
      if (spec.type === 'select') {
        var opsHtml = spec.opts.slice();
        if (cur && opsHtml.indexOf(cur) < 0) opsHtml.push(cur);
        ctrl = '<select data-onf-idx="' + idx + '" data-onf-label="' + esc(label) + '" id="' + fid + '">' +
          opsHtml.map(function (o) { return '<option value="' + esc(o) + '"' + (S(o) === S(cur) ? ' selected' : '') + '>' + (o ? esc(o) : '— pick —') + '</option>'; }).join('') +
          '<option value="' + OTHER + '">Other (type custom)…</option></select>';
      } else {
        var choices = buildOptions(label, cur, row);
        if (choices.length) {
          ctrl = '<select data-onf-idx="' + idx + '" data-onf-label="' + esc(label) + '" id="' + fid + '">' +
            (cur ? '' : '<option value="" selected>— pick —</option>') +
            choices.map(function (o) { return '<option value="' + esc(o) + '"' + (S(o) === S(cur) ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
            '<option value="' + OTHER + '">Other (type custom)…</option></select>';
        } else {
          ctrl = '<input type="text" data-onf-idx="' + idx + '" data-onf-label="' + esc(label) + '" id="' + fid + '" value="' + esc(cur) + '" placeholder="type value">';
        }
      }
      var tag = kind === 'suggested' ? ' <span class="onf-sug">suggested</span>'
        : kind === 'saved' ? ' <span class="onf-saved">saved</span>'
        : kind === 'default' ? ' <span class="onf-default">your default</span>'
        : kind === 'history' ? ' <span class="onf-hist">from chart</span>'
        : kind === 'template' ? ' <span class="onf-hist">from template</span>'
        : (kind === 'blank' ? ' <span class="onf-need">needs value</span>' : '');
      var acts = [], recent = priorValues(label)[0] || '', def = fieldDefault(label);
      /* onf-2.9.0: per-field dictation (capture = pinned Dictate-Anywhere engine) */
      acts.push('<button type="button" class="onf-mic" data-onf-mic="' + esc(fid) + '" title="Dictate this field — spoken value is normalized by AI">🎙</button>');
      var reusableSurface = kind !== 'known' && kind !== 'history' && kind !== 'template';
      if (reusableSurface && recent && S(recent).toLowerCase() !== S(cur).toLowerCase()) {
        acts.push('<button type="button" class="onf-recent" data-onf-recent-control="' + esc(fid) + '" data-onf-recent-value="' + esc(recent) + '">Last used: ' + esc(recent) + ' — use</button>');
      }
      if (reusableSurface && defaultEligible(label)) {
        if (!def) acts.push('<button type="button" data-onf-default-act="save" data-onf-default-control="' + esc(fid) + '" data-onf-default-label="' + esc(label) + '">☆ Use every time</button>');
        else {
          acts.push('<button type="button" data-onf-default-act="save" data-onf-default-control="' + esc(fid) + '" data-onf-default-label="' + esc(label) + '">Change default</button>');
          acts.push('<button type="button" class="onf-stop" data-onf-default-act="clear" data-onf-default-label="' + esc(label) + '">Stop using</button>');
        }
      }
      var fieldHtml = '<div class="onf-field"><label class="' + (cur ? 'onf-has' : '') + '">' + esc(label.charAt(0).toUpperCase() + label.slice(1)) + tag + ctrl + '</label>' +
        (acts.length ? ('<div class="onf-field-actions">' + acts.join('') + '</div>') : '') + '</div>';
      /* silent-fill kinds: filled + not awaiting the doctor. A value that is
         itself an unresolved placeholder can never count as filled. */
      if (cur && kind !== 'suggested' && kind !== 'blank' && !/\[\[[a-z0-9_]+\]\]|\[FILL:/i.test(cur)) autoHtml.push(fieldHtml);
      else askHtml.push(fieldHtml);
    });
    var blanks = 0; for (var m in meta) if (meta[m] === 'blank') blanks++;
    /* onf-2.4.0 (owner: "one or two clicks then it's done"): the accept step IS
       the save step — one green button right here finalizes this note into the
       patient's History. Nothing is ever sent to Athena by this button. */
    var saveBtn = prep ? ('<div style="margin-top:9px;display:flex;align-items:center;gap:9px;">' +
      '<button type="button" class="onf-accept" data-onf-accept="' + idx + '">✓ Looks right — save to History' + (blanks ? (' (' + blanks + ' blank' + (blanks === 1 ? '' : 's') + ' left)') : '') + '</button>' +
      '<span style="font:600 10.5px system-ui;color:#7a5310;">saves to this patient’s History only — never sent to Athena</span></div>') : '';
    var dictHtml = '<div class="onf-dict">' +
      '<button type="button" id="mlsOnfDictBtn_' + idx + '" title="Dictate all remaining details in one go">🎙 Dictate to fill</button>' +
      '<button type="button" class="onf-dict-go" id="mlsOnfDictGo_' + idx + '" title="AI places each dictated detail into the right field — already-confirmed fields are never overwritten">✨ Fill from dictation</button>' +
      '<span class="onf-dict-status" id="mlsOnfDictStatus_' + idx + '"></span>' +
      '<textarea id="mlsOnfDictPad_' + idx + '" style="display:none" placeholder="Speak naturally — e.g. “22 gauge three and a half inch needle, half percent bupivacaine with 10 of dex per level, fluoro time 40 seconds” — or type here."></textarea>' +
      '</div>';
    var suggested = 0; for (var m2 in meta) if (meta[m2] === 'suggested') suggested++;
    var header = askHtml.length
      ? ('✏️ ' + askHtml.length + ' field' + (askHtml.length === 1 ? '' : 's') + ' need' + (askHtml.length === 1 ? 's' : '') + ' you'
        + (blanks && suggested ? (' (' + blanks + ' blank · ' + suggested + ' suggested)') : ''))
      : '✅ Nothing needs your input';
    if (autoHtml.length) header += ' · ✓ ' + autoHtml.length + ' filled automatically';
    var autoBlock = autoHtml.length
      ? ('<details class="onf-auto"><summary>✓ ' + autoHtml.length + ' filled automatically from the chart, schedule & your settings — tap to review or edit</summary>' +
         '<div class="onf-grid">' + autoHtml.join('') + '</div></details>')
      : '';
    box.innerHTML = '<div class="onf-h">' + header + '</div>' +
      (askHtml.length ? ('<div class="onf-grid">' + askHtml.join('') + '</div>') : '') +
      autoBlock +
      '<div class="onf-note">Anything uncertain stays editable. “Use every time” applies only after you choose it, and changing a field updates this draft instantly.</div>' + dictHtml + saveBtn;
    if (!existing || ta.previousElementSibling !== box) ta.parentNode.insertBefore(box, ta);
    var acc = box.querySelector('[data-onf-accept]');
    if (acc) acc.addEventListener('click', function () {
      safe(function () {
        /* "Looks right" IS the explicit review of the amber suggestions. */
        var rIdx = +acc.getAttribute('data-onf-accept'), rr = (window._opPrep || [])[rIdx];
        if (rr) rr._onfReviewed = true;
        if (isFn(window.opPrepSave)) window.opPrepSave(rIdx);
      });
    });
    var ctrls = box.querySelectorAll('[data-onf-label]');
    for (var i = 0; i < ctrls.length; i++) {
      (function wire(ctrl) {
        function applyVal(el) {
          if (!row) return;
          var label = el.getAttribute('data-onf-label'), val = S(el.value).trim();
          row._onfVals = row._onfVals || {}; row._onfVals[label.toLowerCase()] = val;
          row._onfDefaultKeys = row._onfDefaultKeys || {};
          var pinnedNow = fieldDefault(label);
          if (pinnedNow && pinnedNow.value === val) row._onfDefaultKeys[label.toLowerCase()] = true;
          else delete row._onfDefaultKeys[label.toLowerCase()];
          saveFillMemValue(row, label.toLowerCase(), val);   /* per-patient memory (onf-1.7.0) */
          /* onf-2.8.0: the clinician touched this field — it is no longer an
             unreviewed machine suggestion. */
          row._onfTouched = row._onfTouched || {}; row._onfTouched[label.toLowerCase()] = 1;
          if (row._onfSuggestedPending) delete row._onfSuggestedPending[label.toLowerCase()];
          /* onf-2.8.0: the ACCOUNT-scoped dropdown history may only learn
             non-clinical, cross-patient-safe fields (same allowlist as pinned
             defaults). A diagnosis/history/med value from patient A must never
             surface as a suggestion while prepping patient B. */
          safe(function () { if (val && defaultEligible(label) && scopedKey('opFieldVals') && typeof window.addOpFieldVal === 'function') window.addOpFieldVal(label.toLowerCase(), val); });
          var out = applyVals(row._onfRaw != null ? row._onfRaw : (ta.value || ''), row._onfVals);
          writeRendered(ta, row, out);
          if (prep) {
            safe(function () { if (window._opPrep && window._opPrep[+idx]) window._opPrep[+idx].note = out; });
            /* keep the draft autosaved as blanks fill in (parity with the retired walker) */
            safe(function () { if (typeof window.opPrepAutosaveDraft === 'function') window.opPrepAutosaveDraft(+idx); });
          }
          var lbl = el.closest('label'); if (lbl) lbl.classList.toggle('onf-has', !!val);
          /* onf-2.9.0: a value that arrived via the field mic gets one async AI
             normalization pass (spoken numbers -> digits, med terms, units);
             failure keeps the spoken text untouched. */
          if (val && el.getAttribute && el.getAttribute('data-onf-dictated') === '1') {
            el.removeAttribute('data-onf-dictated');
            safe(function () { normalizeDictatedField(el, label, row); });
          }
        }
        var handler = function () {
          /* "Other (type custom)…" swaps the dropdown for a focused text input
             wired to the same label - typed once, remembered for next time */
          if (S(ctrl.value).trim() === OTHER) {
            var inp = document.createElement('input');
            inp.type = 'text'; inp.id = ctrl.id;
            inp.setAttribute('data-onf-idx', ctrl.getAttribute('data-onf-idx'));
            inp.setAttribute('data-onf-label', ctrl.getAttribute('data-onf-label'));
            inp.placeholder = 'type custom value';
            ctrl.parentNode.replaceChild(inp, ctrl);
            var apply2 = function () { applyVal(inp); };
            inp.addEventListener('change', apply2);
            inp.addEventListener('blur', apply2);
            inp.focus();
            return;
          }
          applyVal(ctrl);
        };
        ctrl.addEventListener('change', handler);
        if (ctrl.tagName === 'INPUT') ctrl.addEventListener('blur', handler);
      })(ctrls[i]);
    }
    var recentBtns = box.querySelectorAll('[data-onf-recent-control]');
    for (var r = 0; r < recentBtns.length; r++) recentBtns[r].addEventListener('click', function () {
      var ctrl = $(this.getAttribute('data-onf-recent-control')), val = S(this.getAttribute('data-onf-recent-value'));
      if (!ctrl || !val) return;
      if (ctrl.tagName === 'SELECT' && !Array.prototype.some.call(ctrl.options || [], function (o) { return S(o.value) === val; })) {
        var opt = document.createElement('option'); opt.value = val; opt.textContent = val; ctrl.appendChild(opt);
      }
      ctrl.value = val;
      safe(function () { ctrl.dispatchEvent(new Event('change', { bubbles: true })); });
    });
    var defBtns = box.querySelectorAll('[data-onf-default-act]');
    for (var d = 0; d < defBtns.length; d++) defBtns[d].addEventListener('click', function () {
      var label = S(this.getAttribute('data-onf-default-label')), act = this.getAttribute('data-onf-default-act');
      if (act === 'clear') {
        if (!clearFieldDefault(label)) { toast('Sign in fully before changing op-note defaults.', 'err'); return; }
        stopDefaultInOpen(label);
        toast('Stopped using that answer automatically.', 'ok');
        return;
      }
      var ctrl = $(this.getAttribute('data-onf-default-control')), val = S(ctrl && ctrl.value).trim();
      if (!val || val === OTHER) { toast('Choose or type the answer first.', 'err'); return; }
      if (!saveFieldDefault(label, val)) { toast(!defaultEligible(label) ? 'Only stable practice, provider, facility, or equipment identity can be saved as a reusable default.' : 'Sign in fully before saving an op-note default.', 'err'); return; }
      applyDefaultToOpen(label, val);
      toast('Saved — this answer will fill the same field in future op notes.', 'ok');
    });
    /* onf-2.9.0: per-field mics + the dictate-and-fill pad */
    safe(function () { wireDictation(box, ta, row, idx, prep); });
  }

  /* ================= PART C: repair dead "Upload templates" buttons =================
   * onf-1.1.0: several "Upload templates" buttons on the page (e.g. #mlsUplTplBtn
   * on the visit view) have NO click handler at all -> clicking does nothing. The
   * real template-upload UI is opened by the existing global openTemplates(). This
   * wires any such handler-less button to it. Buttons that already work (their own
   * onclick, e.g. triggering a file input) are left untouched. */
  function looksDeadUploadBtn(b) {
    if (!b || b.getAttribute('data-onf-wired')) return false;
    if (!/upload template/i.test(b.textContent || '')) return false;
    if (b.getAttribute('onclick')) return false;      /* already has an inline handler */
    if (b.tagName === 'A' && b.getAttribute('href')) return false;
    if (b.type === 'file' || b.querySelector && b.querySelector('input[type=file]')) return false;
    return true;
  }
  function wireUploadButtons() {
    if (!isFn(window.openTemplates)) return;
    var btns = safe(function () { return document.querySelectorAll('button, a'); }, []);
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (!looksDeadUploadBtn(b)) continue;
      b.setAttribute('data-onf-wired', '1');
      b.addEventListener('click', function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
        safe(function () { window.openTemplates(); });
        /* the Templates modal shares z-index 9400 with the op modal and sits
           EARLIER in the DOM - it opened BEHIND the op modal, which read as
           "the button does nothing" (owner bug 2026-07-13). Raise it. */
        setTimeout(function () {
          safe(function () { var m = document.getElementById('templatesModal'); if (m) m.style.zIndex = '99500'; });
        }, 80);
        setTimeout(function () {
          safe(function () { var m = document.getElementById('templatesModal'); if (m) m.style.zIndex = '99500'; });
        }, 400);
      });
    }
  }

  /* ---------------- tick (freeze-safe: cheap, gated, write-if-changed) ---------------- */
  var _sig = {}, iv = null, _wireN = 0;
  /* onf-2.11.0: buildFillBox failures land on the export (queryable) and warn
     once - a bare safe() swallowed them and the stored signature then skipped
     every retry, so one throw killed the Fields box for the whole session. */
  function noteFillError(taId, e) {
    var rec = { ta: taId, message: S(e && e.message || e), stack: S(e && e.stack).slice(0, 400), time: Date.now() };
    try { if (window.__mlsOpNoteFill) window.__mlsOpNoteFill.lastFillError = rec; } catch (e2) {}
    if (!noteFillError._warned) { noteFillError._warned = true; safe(function () { console.warn('[onf] Fields box failed for #' + taId + ':', e); }); }
  }
  function clearFillError() { try { if (window.__mlsOpNoteFill) window.__mlsOpNoteFill.lastFillError = null; } catch (e) {} }
  function tick() {
    _wireN++;
    /* PERF: wire early then every ~6s - EXCEPT while the op modal is open,
       where its Upload-templates button must work on the FIRST click (it is
       born dead; the lazy cadence left a ~6s window where clicks did nothing
       - owner bug 2026-07-13) */
    if (_wireN <= 3 || _wireN % 6 === 0 || modalOpen()) safe(wireUploadButtons);
    var open = modalOpen();
    /* onf-2.1.0: [FILL:] blanks in the MAIN note editor get the same fill box
       (the floating tap-to-start walker is retired; this is the ONE mechanism).
       Skipped while the op modal is open — the modal owns the screen then. */
    if (!open) {
      var main = safe(mainBoxWithBlanks, null);
      if (main) {
        var ms = sigOf(main);
        if (_sig[MAIN_ID] !== ms) {
          /* onf-2.11.0: same not-silent rule as the prep loop below */
          try { buildFillBox(main); clearFillError(); }
          catch (eMB) { noteFillError(MAIN_ID, eMB); }
          _sig[MAIN_ID] = sigOf(main);
        }
      }
      return;
    }
    /* the Templates modal opens BEHIND the op modal (equal z 9400, earlier in
       DOM). The click-handler bump can miss (its wiring is lazy) - keep this
       tick-level guarantee: whenever both are open, templates paints on top. */
    safe(function () {
      var t = document.getElementById('templatesModal');
      if (t && t.classList.contains('show') && t.style.zIndex !== '99500') t.style.zIndex = '99500';
    });
    safe(injectBar);
    /* set each row's procedure from its matched template + pre-fill the visible
       "Procedure" input on every card (list view too, not just drafted rows). */
    safe(function () { var op = window._opPrep || []; for (var i = 0; i < op.length; i++) syncProcedure(op[i]); });
    safe(fillProcInputs);
    var tas = noteBoxes();
    for (var i = 0; i < tas.length; i++) {
      var ta = tas[i]; if (!ta.id) continue;
      var s = sigOf(ta);
      if (_sig[ta.id] === s) continue;                   /* unchanged -> skip */
      (function (t) {
        var rw = safe(function () { return (window._opPrep || [])[+t.id.replace('opPrepNote_', '')]; }, null);
        safe(function () { syncProcedure(rw); });         /* readiness "Procedure" = the matched template */
        safe(function () { ensureHeader(t); });          /* guarantee personalization (may prepend header) */
        /* onf-2.11.0: measured live at b712 on a resumed draft - box absent,
           no console error, nobody told. Not silent any more. */
        try { buildFillBox(t); clearFillError(); }
        catch (eFB) { noteFillError(t.id, eFB); }
        _sig[t.id] = sigOf(t);                            /* store the POST-render signature (settles the tick) */
      })(ta);
    }
  }
  /* =========================================================================
   * onf-2.9.0 — DICTATE & FILL. The physician dictates naturally (capture is
   * the pinned Dictate-Anywhere engine, untouched); the AI maps the dictation
   * onto the note's fill fields, normalizing medical terminology, units, and
   * formatting while preserving meaning. HARD RULES: only fields the dictation
   * clearly addresses are filled; a field the clinician already set is NEVER
   * overwritten silently — an explicit "correction" becomes a tap-to-apply
   * offer; a failed AI call loses nothing (the transcript stays in the pad).
   * Pure planning/parsing functions are exported for the offline test harness.
   * ======================================================================= */
  function dictApi() { var d = window.__mlsDictateAnywhere; return (d && d.installed && isFn(d.toggleFor)) ? d : null; }
  function stripFences(s) { return S(s).replace(/^```\w*\s*/,'').replace(/```\s*$/,'').trim(); }
  function buildRoutePrompt(fields, noteText, transcript) {
    var sys = 'You fill operative-note fields from a pain physician’s dictation. Map the dictation onto the listed fields only. '
      + 'NORMALIZE medical terminology, drug names, doses, units, laterality, and formatting (e.g. "twenty two gauge three and a half inch" -> "22-gauge, 3.5-inch"; "point five percent bupivacaine" -> "0.5% bupivacaine") while preserving the physician’s meaning exactly. '
      + 'Include ONLY fields the dictation clearly addresses — never guess, never fill a field from general context alone. '
      + 'A field marked ALREADY-SET may be included ONLY when the dictation explicitly states a different value for it; then set "correction":true. '
      + 'Each value is the final field text — concise, professional, no commentary. '
      + 'Return ONLY JSON: {"fills":[{"field":"<field label exactly as listed>","value":"...","correction":false}]}';
    var user = 'FIELDS:\n' + fields.map(function (f) {
      return '- ' + f.label + (f.value ? (' [ALREADY-SET: ' + S(f.value).slice(0, 120) + ']') : ' [blank]');
    }).join('\n')
      + '\n\nOPERATIVE NOTE (context):\n' + S(noteText).slice(0, 3500)
      + '\n\nDICTATION:\n' + S(transcript).slice(0, 4000);
    return { sys: sys, user: user };
  }
  function parseRouteResult(raw) {
    var s = stripFences(raw), obj = null;
    try { obj = JSON.parse(s); } catch (e) { var m = s.match(/\{[\s\S]*\}/); if (m) { try { obj = JSON.parse(m[0]); } catch (e2) {} } }
    var fills = (obj && Array.isArray(obj.fills)) ? obj.fills : [];
    return fills.filter(function (f) { return f && S(f.field).trim() && S(f.value).trim(); })
      .map(function (f) { return { field: S(f.field).trim(), value: S(f.value).trim().slice(0, 400), correction: f.correction === true }; });
  }
  /* Pure plan: which fills apply now, which become explicit-tap corrections,
     which are ignored. fieldState: [{label, value, touched}]. */
  function planRoutedFills(fills, fieldState) {
    var byLabel = {}, plan = { apply: [], corrections: [], ignored: [] };
    fieldState.forEach(function (f) { byLabel[S(f.label).toLowerCase()] = f; });
    fills.forEach(function (f) {
      var st = byLabel[S(f.field).toLowerCase()];
      if (!st) { plan.ignored.push({ field: f.field, why: 'unknown-field' }); return; }
      var already = !!(st.touched && S(st.value).trim());
      if (!already) { plan.apply.push({ label: st.label, value: f.value }); return; }
      if (f.correction && S(f.value).trim().toLowerCase() !== S(st.value).trim().toLowerCase()) {
        plan.corrections.push({ label: st.label, value: f.value, was: st.value });
      } else plan.ignored.push({ field: f.field, why: 'already-set' });
    });
    return plan;
  }
  function fidFor(idx, label) { return 'onfF_' + idx + '_' + S(label).toLowerCase().replace(/[^a-z0-9]+/g, '_'); }
  function setFieldValue(idx, label, value) {
    var el = $(fidFor(idx, label)); if (!el) return false;
    if (el.tagName === 'SELECT') {
      var has = Array.prototype.some.call(el.options || [], function (o) { return S(o.value) === value; });
      if (!has) { var opt = document.createElement('option'); opt.value = value; opt.textContent = value; el.appendChild(opt); }
    }
    el.value = value;
    safe(function () { el.dispatchEvent(new Event('change', { bubbles: true })); });
    return true;
  }
  async function routeDictation(idx, ta, row, transcript, statusEl) {
    var raw = S(row && row._onfRaw != null ? row._onfRaw : (ta && ta.value || ''));
    var labels = fillTokens(raw);
    var vals = (row && row._onfVals) || {};
    var fieldState = labels.map(function (label) {
      var key = label.toLowerCase();
      return { label: label, value: S(vals[key] || ''), touched: !!(row && row._onfTouched && row._onfTouched[key]) };
    });
    if (!fieldState.length) { if (statusEl) statusEl.textContent = 'No fill fields in this note.'; return null; }
    var p = buildRoutePrompt(fieldState, ta ? ta.value : '', transcript);
    if (statusEl) statusEl.textContent = '… routing dictation into fields';
    var out;
    try { out = await window.aiCallRaw(p.sys, p.user, (isFn(window.getKey) ? window.getKey() : ''), { freeform: true }); }
    catch (e) {
      if (statusEl) statusEl.textContent = '⚠ Couldn’t reach the AI — your dictation is kept below, nothing was changed. (' + S(e && e.message).slice(0, 80) + ')';
      return null;
    }
    var plan = planRoutedFills(parseRouteResult(out), fieldState);
    var applied = 0;
    plan.apply.forEach(function (a) { if (setFieldValue(idx, a.label, a.value)) applied++; });
    if (statusEl) {
      var bits = [];
      bits.push(applied ? ('✓ filled ' + applied + ' field' + (applied === 1 ? '' : 's')) : 'no blank fields matched the dictation');
      if (plan.corrections.length) bits.push(plan.corrections.length + ' change' + (plan.corrections.length === 1 ? '' : 's') + ' to confirm below');
      if (plan.ignored.length) bits.push(plan.ignored.length + ' already set (kept)');
      statusEl.textContent = bits.join(' · ');
      var host = statusEl.parentNode;
      safe(function () { Array.prototype.forEach.call(host.querySelectorAll('[data-onf-corr]'), function (n) { n.remove(); }); });
      plan.corrections.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button'; b.setAttribute('data-onf-corr', '1');
        b.textContent = 'Update ' + c.label + ': “' + c.value + '” (was “' + S(c.was).slice(0, 60) + '”)';
        b.addEventListener('click', function () { if (setFieldValue(idx, c.label, c.value)) b.remove(); });
        host.appendChild(b);
      });
    }
    return plan;
  }
  async function normalizeDictatedField(el, label, row) {
    if (!el || el.__onfNormBusy) return;
    var val = S(el.value).trim(); if (!val) return;
    var elId = S(el.id);   /* the fill box re-renders on its 1s tick — re-resolve by stable id */
    el.__onfNormBusy = true;
    try {
      var sys = 'Normalize ONE dictated value for the operative-note field named "' + S(label).slice(0, 80) + '". '
        + 'Fix medical terminology, units, drug names, capitalization, and formatting (spoken numbers become digits) while preserving the meaning exactly. '
        + 'Return ONLY the corrected value text — no quotes, no commentary. If it is already correct, return it unchanged.';
      var out = await window.aiCallRaw(sys, val, (isFn(window.getKey) ? window.getKey() : ''), { freeform: true });
      var clean = stripFences(out);
      var cur = elId ? ($(elId) || el) : el;
      /* apply only when the field STILL holds the exact spoken text — a
         clinician edit in the meantime always wins over the AI cleanup */
      if (clean && clean.length <= 400 && clean !== val && S(cur.value).trim() === val) {
        cur.value = clean;
        safe(function () { cur.dispatchEvent(new Event('change', { bubbles: true })); });
      }
    } catch (e) { /* keep the spoken text — never lose dictation */ }
    finally { el.__onfNormBusy = false; }
  }
  function wireDictation(box, ta, row, idx, prep) {
    var mics = box.querySelectorAll('[data-onf-mic]');
    for (var i = 0; i < mics.length; i++) (function (btn) {
      if (btn.__onfWired) return; btn.__onfWired = true;
      btn.addEventListener('click', function () {
        var d = dictApi(); if (!d) { toast('Dictation isn’t available in this browser.', 'err'); return; }
        var el = $(btn.getAttribute('data-onf-mic')); if (!el) return;
        if (el.tagName === 'SELECT') {
          el.value = OTHER;
          safe(function () { el.dispatchEvent(new Event('change', { bubbles: true })); });
          el = $(btn.getAttribute('data-onf-mic')); if (!el || el.tagName === 'SELECT') return;
        }
        el.setAttribute('data-onf-dictated', '1');
        d.toggleFor(el);
      });
    })(mics[i]);
    var mic = $('mlsOnfDictBtn_' + idx), pad = $('mlsOnfDictPad_' + idx), go = $('mlsOnfDictGo_' + idx), st = $('mlsOnfDictStatus_' + idx);
    if (mic && !mic.__onfWired) { mic.__onfWired = true; mic.addEventListener('click', function () {
      var d = dictApi(); if (!d) { toast('Dictation isn’t available in this browser.', 'err'); return; }
      if (pad) { pad.style.display = 'block'; pad.focus(); }
      d.toggleFor(pad);
      if (st) st.textContent = d.isListening && d.isListening() ? '🎙 listening — speak the details, then press Fill' : 'tap the mic chip to talk, then press Fill';
    }); }
    if (go && !go.__onfWired) { go.__onfWired = true; go.addEventListener('click', function () {
      var d = dictApi(); if (d && d.isListening && d.isListening()) { try { d.stop(); } catch (e) {} }
      var t = S(pad && pad.value).trim();
      if (!t) { if (st) st.textContent = 'Nothing dictated yet — press 🎙 and speak, or type here.'; return; }
      routeDictation(idx, ta, row, t, st).then(function (plan) {
        if (plan && pad && (plan.apply.length || plan.corrections.length)) pad.value = '';
      });
    }); }
  }

  /* onf-2.11.1: the first tick ran BARE here, so one boot-time throw aborted
     boot() before the interval was created - the Fields box then never ticked
     for the whole session (measured live at b713: export installed, manual
     tick() built the box perfectly, no interval running). The heartbeat's
     creation must never depend on the first beat succeeding. */
  function boot() { css(); safe(seedProfile); safe(tick); iv = setInterval(function () { safe(tick); }, 1000); }
  function revert() {
    if (iv) { clearInterval(iv); iv = null; }
    safe(function () { var b = $(BAR_ID); if (b) b.remove(); });
    safe(function () { Array.prototype.forEach.call(document.querySelectorAll('.onf-fillbox'), function (n) { n.remove(); }); });
    safe(function () { var s = $(STYLE_ID); if (s) s.remove(); });
    try { window.__mlsOpNoteFill.installed = false; } catch (e) {}
    return 'op-note fill reverted';
  }

  window.__mlsOpNoteFill = {
    installed: true, version: VERSION, asset: 'feat_mls_opnote_fill.js', lastFillError: null,
    applyBulk: applyBulk, _fillTokens: fillTokens, _fieldSpec: fieldSpec, _replaceToken: replaceToken,
    _patientKey: patientKey, _loadFillMem: loadFillMem, _saveFillMemValue: saveFillMemValue, _historyMed: historyMed,
    getDefault: function (labelOrKey) { var d = fieldDefault(labelOrKey); return d ? d.value : ''; },
    _setDefault: saveFieldDefault, _clearDefault: clearFieldDefault, _applyDefaultToOpen: applyDefaultToOpen, _applyDefaultToBoxes: applyDefaultToBoxes,
    _priorValues: priorValues, _anonymousField: anonymousField, _defaultEligible: defaultEligible,
    _scopedKey: scopedKey, _fieldDefault: fieldDefault, _applyVals: applyVals, _sigOf: sigOf,
    _adoptRenderedEdits: adoptRenderedEdits, _acceptExternalEdit: acceptExternalEdit, _existingFillBox: existingFillBox,
    _knownValue: knownValue, _buildOptions: buildOptions, _resolveInitialField: resolveInitialField, _buildFillBox: buildFillBox, _ensureHeader: ensureHeader,
    _chartPatient: chartPatient, _chartValue: chartValue, _patientHistText: patientHistText,
    _verifiedHistoryVisits: verifiedHistoryVisits, _profile: provProfile,
    wireUploadButtons: wireUploadButtons, tick: tick, revert: revert,
    /* onf-2.9.0 dictate-and-fill — pure parts exported for the offline harness */
    _dictation: { buildRoutePrompt: buildRoutePrompt, parseRouteResult: parseRouteResult, planRoutedFills: planRoutedFills, routeDictation: routeDictation, normalizeDictatedField: normalizeDictatedField, fidFor: fidFor }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
