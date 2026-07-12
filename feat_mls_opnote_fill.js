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

  var VERSION = 'onf-1.0.0';
  var BAR_ID = 'mlsOnfBar', STYLE_ID = 'mlsOnfStyle';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function esc(s) { return S(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, k) { safe(function () { if (isFn(window.toast)) window.toast(m, k || ''); }); }

  function css() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '#' + BAR_ID + '{margin:0 0 12px;padding:11px 13px;border:1px solid #cfe0f5;border-radius:12px;',
      'background:linear-gradient(180deg,#f4f9ff,#eaf3ff);display:flex;flex-wrap:wrap;align-items:center;gap:9px;',
      'font:600 12.5px/1.35 "Plus Jakarta Sans",system-ui,sans-serif;color:#1b3a66;}',
      '#' + BAR_ID + ' b{font-weight:800;}',
      '#' + BAR_ID + ' select{font:600 12.5px system-ui;padding:6px 9px;border:1px solid #b9d0ee;border-radius:8px;background:#fff;color:#12294a;max-width:280px;}',
      '#' + BAR_ID + ' button{cursor:pointer;border:0;border-radius:8px;padding:7px 13px;font:700 12.5px system-ui;background:#2f6df0;color:#fff;}',
      '#' + BAR_ID + ' button.ghost{background:#e6eefb;color:#255ad0;}',
      '#' + BAR_ID + ' button:hover{filter:brightness(1.05);}',
      '#' + BAR_ID + ' .onf-count{margin-left:auto;font-weight:700;color:#3a5980;}',
      '.onf-fillbox{margin:8px 0;padding:10px 12px;border:1px solid #e0b877;border-radius:11px;background:#fffdf5;}',
      '.onf-fillbox .onf-h{font:800 12px/1.3 "Plus Jakarta Sans",system-ui,sans-serif;color:#7a5310;margin:0 0 7px;display:flex;align-items:center;gap:6px;}',
      '.onf-fillbox .onf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;}',
      '.onf-fillbox label{display:flex;flex-direction:column;gap:3px;font:700 11px/1.3 system-ui;color:#5a4a24;}',
      '.onf-fillbox input,.onf-fillbox select{font:600 12.5px system-ui;padding:5px 8px;border:1px solid #d9c48f;border-radius:7px;background:#fff;color:#3a2f12;}',
      '.onf-fillbox .onf-done{border-color:#8fce9e;background:#f2fbf4;}',
      '.onf-fillbox .onf-note{font:600 10.5px system-ui;color:#8a7130;margin:7px 0 0;}',
      '@media (max-width:600px){.onf-fillbox .onf-grid{grid-template-columns:1fr;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------- shared ---------------- */
  function modalOpen() { var m = $('opPrepModal'); return !!(m && getComputedStyle(m).display !== 'none'); }
  function templates() { return safe(function () { return isFn(window.getTemplates) ? (window.getTemplates() || []) : []; }, []); }
  function tplPickers() { return safe(function () { return document.querySelectorAll('select[id^="opPrepTpl_"]'); }, []); }

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
      '<span class="onf-count"></span>';
    list.parentNode.insertBefore(bar, list);
    var a = $('mlsOnfApplyAll'); if (a) a.addEventListener('click', function () { applyBulk(false); });
    var b = $('mlsOnfApplyBlank'); if (b) b.addEventListener('click', function () { applyBulk(true); });
    updateBarCount();
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
  /* distinct [FILL: label] tokens in a note, in first-seen order */
  function fillTokens(text) {
    var re = /\[FILL:\s*([^\]]+?)\s*\]/gi, seen = {}, out = [], m;
    while ((m = re.exec(text)) !== null) {
      var label = m[1].trim(), key = label.toLowerCase();
      if (!seen[key]) { seen[key] = 1; out.push(label); }
    }
    return out;
  }
  function replaceToken(text, label, value) {
    if (!value) return text;
    var q = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\[FILL:\\s*' + q + '\\s*\\]', 'gi');
    return text.replace(re, value);
  }
  function noteBoxes() { return safe(function () { return document.querySelectorAll('textarea[id^="opPrepNote_"]'); }, []); }
  function sigOf(ta) { var v = ta.value || ''; return v.length + '|' + (v.match(/\[FILL:/gi) || []).length; }

  function buildFillBox(ta) {
    var idx = ta.id.replace('opPrepNote_', '');
    var tokens = fillTokens(ta.value || '');
    var existing = ta.previousElementSibling && ta.previousElementSibling.classList && ta.previousElementSibling.classList.contains('onf-fillbox')
      ? ta.previousElementSibling : null;
    if (!tokens.length) { if (existing) existing.parentNode.removeChild(existing); return; }
    css();
    var box = existing || document.createElement('div');
    box.className = 'onf-fillbox';
    var rows = tokens.map(function (label) {
      var spec = fieldSpec(label);
      var fid = 'onfF_' + idx + '_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      var ctrl;
      if (spec.type === 'select') {
        ctrl = '<select data-onf-idx="' + idx + '" data-onf-label="' + esc(label) + '" id="' + fid + '">' +
          spec.opts.map(function (o) { return '<option value="' + esc(o) + '">' + (o ? esc(o) : '— pick —') + '</option>'; }).join('') + '</select>';
      } else {
        ctrl = '<input type="text" data-onf-idx="' + idx + '" data-onf-label="' + esc(label) + '" id="' + fid + '" placeholder="type value">';
      }
      return '<label>' + esc(label.charAt(0).toUpperCase() + label.slice(1)) + ctrl + '</label>';
    }).join('');
    box.innerHTML = '<div class="onf-h">✏️ Fields to fill (' + tokens.length + ')</div>' +
      '<div class="onf-grid">' + rows + '</div>' +
      '<div class="onf-note">Pick or type a value and it replaces every matching placeholder in the note below.</div>';
    if (!existing) ta.parentNode.insertBefore(box, ta);
    var ctrls = box.querySelectorAll('[data-onf-label]');
    for (var i = 0; i < ctrls.length; i++) {
      (function (ctrl) {
        var handler = function () {
          var label = ctrl.getAttribute('data-onf-label'), val = S(ctrl.value).trim();
          if (!val) return;
          var newText = replaceToken(ta.value || '', label, val);
          if (newText !== ta.value) {
            ta.value = newText;
            safe(function () { ta.dispatchEvent(new Event('input', { bubbles: true })); });
            safe(function () { var op = window._opPrep || []; if (op[+idx]) op[+idx].note = newText; });
            var lbl = ctrl.closest('label'); if (lbl) lbl.classList.add('onf-done');
          }
        };
        ctrl.addEventListener('change', handler);
      })(ctrls[i]);
    }
  }

  /* ---------------- tick (freeze-safe: cheap, gated, write-if-changed) ---------------- */
  var _sig = {}, iv = null;
  function tick() {
    if (!modalOpen()) return;
    safe(injectBar);
    var tas = noteBoxes();
    for (var i = 0; i < tas.length; i++) {
      var ta = tas[i]; if (!ta.id) continue;
      var s = sigOf(ta);
      if (_sig[ta.id] === s) continue;                   /* unchanged -> skip */
      _sig[ta.id] = s;
      safe(function () { buildFillBox(ta); });
    }
  }
  function boot() { css(); tick(); iv = setInterval(function () { safe(tick); }, 1000); }
  function revert() {
    if (iv) { clearInterval(iv); iv = null; }
    safe(function () { var b = $(BAR_ID); if (b) b.remove(); });
    safe(function () { Array.prototype.forEach.call(document.querySelectorAll('.onf-fillbox'), function (n) { n.remove(); }); });
    safe(function () { var s = $(STYLE_ID); if (s) s.remove(); });
    try { window.__mlsOpNoteFill.installed = false; } catch (e) {}
    return 'op-note fill reverted';
  }

  window.__mlsOpNoteFill = {
    installed: true, version: VERSION, asset: 'feat_mls_opnote_fill.js',
    applyBulk: applyBulk, _fillTokens: fillTokens, _fieldSpec: fieldSpec, _replaceToken: replaceToken,
    tick: tick, revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
