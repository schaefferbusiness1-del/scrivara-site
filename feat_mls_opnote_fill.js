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

  var VERSION = 'onf-1.7.1';
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
      '.onf-fillbox .onf-hist{font:800 9px system-ui;color:#204034;background:#e0ecfb;padding:1px 6px;border-radius:999px;margin-left:5px;vertical-align:middle;}',
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
      '<button type="button" class="ghost" id="mlsOnfProfBtn" title="Set your provider name, NPI, facility and practice ONCE — they auto-fill on every note">⚙ Practice profile</button>' +
      '<span class="onf-count"></span>' +
      profileFormHtml();
    list.parentNode.insertBefore(bar, list);
    var a = $('mlsOnfApplyAll'); if (a) a.addEventListener('click', function () { applyBulk(false); });
    var b = $('mlsOnfApplyBlank'); if (b) b.addEventListener('click', function () { applyBulk(true); });
    var pb = $('mlsOnfProfBtn'); if (pb) pb.addEventListener('click', toggleProfileEditor);
    var ps = $('mlsOnfProfSave'); if (ps) ps.addEventListener('click', saveProfileFromForm);
    updateBarCount();
  }
  /* ---- practice-profile editor (provider / NPI / facility / practice) ---- */
  function profFld(lbl, key, val) {
    return '<label style="display:flex;flex-direction:column;gap:3px;font:700 11px system-ui;color:#204034;">' + esc(lbl) +
      '<input type="text" data-prof="' + key + '" value="' + esc(val || '') + '" style="padding:6px 8px;border:1px solid #EAF1EE;border-radius:7px;font:600 12.5px system-ui;"></label>';
  }
  function profileFormHtml() {
    var p = seedProfile();
    return '<div id="mlsOnfProfForm" style="display:none;flex-basis:100%;margin-top:9px;padding:11px 12px;border:1px dashed #C9DCD2;border-radius:10px;background:#fff;">' +
      '<div style="font-weight:800;margin-bottom:7px;color:#204034;">Practice profile — set once, auto-fills every note (never fabricated)</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:9px;">' +
      profFld('Operating provider', 'name', p.name) + profFld('Provider NPI', 'npi', p.npi) +
      profFld('Facility / surgery center', 'facility', p.facility) + profFld('Practice / group name', 'practice', p.practice) +
      '</div>' +
      '<button type="button" id="mlsOnfProfSave" style="margin-top:9px;background:#2E6A4B;color:#fff;border:0;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer;">Save profile</button>' +
      '<span id="mlsOnfProfMsg" style="margin-left:9px;color:#2e7d43;font-weight:700;"></span></div>';
  }
  function toggleProfileEditor() { var f = $('mlsOnfProfForm'); if (f) f.style.display = (f.style.display === 'none' || !f.style.display) ? 'block' : 'none'; }
  function saveProfileFromForm() {
    var f = $('mlsOnfProfForm'); if (!f) return;
    var p = provProfile();
    Array.prototype.forEach.call(f.querySelectorAll('[data-prof]'), function (inp) { p[inp.getAttribute('data-prof')] = S(inp.value).trim(); });
    saveProfile(p);
    var m = $('mlsOnfProfMsg'); if (m) m.textContent = 'Saved ✓ — re-applying to all notes…';
    /* re-seed the known (identity/profile) values on every open note so
       facility / NPI / practice / provider fill NOW, then re-render each note. */
    var tas = noteBoxes();
    for (var i = 0; i < tas.length; i++) {
      (function (ta) {
        var row = safe(function () { return (window._opPrep || [])[+ta.id.replace('opPrepNote_', '')]; }, null);
        safe(function () { reseedKnown(row); });
        safe(function () { buildFillBox(ta); });
      })(tas[i]);
    }
    setTimeout(function () { var mm = $('mlsOnfProfMsg'); if (mm) mm.textContent = 'Saved ✓'; }, 1600);
  }
  /* refresh the known/profile-derived values on a row after the profile changes */
  function reseedKnown(row) {
    if (!row || row._onfRaw == null) return;
    row._onfVals = row._onfVals || {};
    var tk = fillTokens(row._onfRaw);
    for (var i = 0; i < tk.length; i++) { var kv = knownValue(tk[i], row); if (kv) row._onfVals[tk[i].toLowerCase()] = kv; }
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

  /* onf-1.3.0: AUTO-FILL fields the app already KNOWS. Provider/physician name,
     patient name, DOB, MRN, procedure date, provider NPI/facility (from the
     stored provider profile) should never be shown as a manual [FILL:] field --
     they are silently pre-filled from the appointment + provider profile before
     the fill box is built, so the clinician only sees genuinely unknown,
     procedure-specific blanks (laterality, needle size, etc.). */
  var PROFILE_KEY = 'mls_provider_profile';
  function provProfile() { return safe(function () { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {}; }, {}) || {}; }
  function saveProfile(p) { safe(function () { localStorage.setItem(PROFILE_KEY, JSON.stringify(p || {})); }); }
  function apptProvider(appt) { return S((appt && (appt.provider_raw || appt.provider_key || appt.provider)) || '').replace(/_/g, ' ').trim(); }
  function commonApptProvider() {
    return safe(function () {
      var appts = window._calAppts || [], t = {};
      for (var i = 0; i < appts.length; i++) { var n = apptProvider(appts[i]); if (n) t[n] = (t[n] || 0) + 1; }
      var best = '', bc = 0; for (var k in t) if (t[k] > bc) { bc = t[k]; best = k; } return best;
    }, '') || '';
  }
  /* Seed the practice profile ONCE with what we can DERIVE (the day's operating
     provider name). NPI / facility / practice stay blank for the clinician to set
     one time in the profile editor -- we NEVER fabricate an NPI or facility. */
  function seedProfile() {
    var p = provProfile();
    if (!S(p.name).trim()) { var cp = commonApptProvider(); if (cp) { p.name = cp; saveProfile(p); } }
    return p;
  }
  /* the patient's own recent chart text (for deriving laterality / prior values) */
  function patientHistText(row) {
    return safe(function () {
      var appt = row && row.appt; if (!appt) return '';
      var pts = isFn(window.getPatients) ? window.getPatients() : [];
      var nn = S(appt.name).toLowerCase().replace(/[^a-z0-9]/g, ''), wd = S(appt.dob).replace(/\D/g, ''), p = null;
      for (var i = 0; i < pts.length; i++) {
        var q = pts[i]; if (!q || S(q.name).toLowerCase().replace(/[^a-z0-9]/g, '') !== nn) continue;
        if (!wd || S(q.dob).replace(/\D/g, '') === wd) { p = q; break; } if (!p) p = q;
      }
      if (!p) return '';
      var vs = (p.visits || []).slice(0, 3), parts = [S(p.problems), S(p.summary)];
      for (var v = 0; v < vs.length; v++) parts.push(S(vs[v].plan), S(vs[v].findings), S(vs[v].raw).slice(0, 400));
      return parts.join(' ');
    }, '') || '';
  }
  /* onf-1.7.0: STABLE per-PATIENT key so known/entered fill values can be
     remembered for that patient across future op notes. Prefer a numeric MRN;
     else normalized name (+ DOB when present). */
  function patientKey(row) {
    var appt = (row && row.appt) || {};
    var mrn = S(appt.athenaId || appt.mrn || '').replace(/\D/g, '');
    if (mrn) return 'id:' + mrn;
    var nm = S(appt.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    var dob = S(appt.dob).replace(/\D/g, '');
    return nm ? ('nd:' + nm + (dob ? ('_' + dob) : '')) : '';
  }
  /* onf-1.7.0: per-patient fill MEMORY. Once a field value is known/entered for a
     patient, it is saved under that patient's record (localStorage keyed by
     patientKey) and pre-filled on their FUTURE op notes -- so the steroid /
     medication (and any other stable value) never has to be re-typed. The doctor
     still sees and can change every field before signing. Device-local; nothing
     is written to Athena. */
  var FILLMEM_PREFIX = 'mls_opfill_mem::';
  function loadFillMem(row) {
    var k = patientKey(row); if (!k) return {};
    return safe(function () { return JSON.parse(localStorage.getItem(FILLMEM_PREFIX + k) || '{}') || {}; }, {}) || {};
  }
  function saveFillMemValue(row, fieldKey, val) {
    var k = patientKey(row); if (!k || !fieldKey) return;
    val = S(val).trim();
    var mem = loadFillMem(row);
    if (val) mem[fieldKey] = val; else delete mem[fieldKey];
    safe(function () { localStorage.setItem(FILLMEM_PREFIX + k, JSON.stringify(mem)); });
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
      if (/bilateral|both sides|\bb\/l\b/.test(ctx)) return 'Bilateral';
      var lft = /\bleft\b|\blt\b|left[- ]sided/.test(ctx), rgt = /\bright\b|\brt\b|right[- ]sided/.test(ctx);
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
      [/contrast.*volume/, '1 mL'],
      [/^interval\b|follow.?up interval/, '6 weeks'],
      [/needle length/, '3.5-inch']
    ];
    for (var s2 = 0; s2 < STD.length; s2++) { if (STD[s2][0].test(l)) return STD[s2][1]; }
    /* anything else dose/level/count-like stays blank - patient-specific,
       never invented. */
    if (/\b(dose|dosage|volume|amount|\bmg\b|\bml\b|\bcc\b|mcg|units|concentration|levels?|which level|how many|number of|count)\b/.test(l)) return '';
    var CD = [
      [/type of anesthesia|anesthesia type/, 'Local anesthesia'],
      [/local anesthetic|anesthetic( agent| used| type)?$|lidocaine/, '1% lidocaine'],
      [/\bsedation\b/, 'None - local anesthesia only'],
      [/needle( gauge| size)?/, '22-gauge'],
      [/patient position|positioning/, 'Prone'],
      [/skin prep|antisep|prep solution|sterile prep/, 'Chlorhexidine'],
      [/imaging( guidance| modality)?|\bguidance\b/, 'Fluoroscopy'],
      [/contrast( agent| type)?/, 'Iodinated contrast'],
      [/estimated blood loss|\bebl\b/, 'Minimal'],
      [/complications?/, 'None'],
      [/consent/, 'Informed consent obtained']
    ];
    for (var c = 0; c < CD.length; c++) { if (CD[c][0].test(l)) return CD[c][1]; }
    return '';
  }
  function knownValue(label, row) {
    var l = S(label).toLowerCase().replace(/[^a-z0-9 \/]/g, ' ').replace(/\s+/g, ' ').trim();
    var appt = (row && row.appt) || {};
    var prof = provProfile();
    var prov = apptProvider(appt) || S(prof.name).trim();
    var pname = S(appt.name).trim();
    var dob = S(appt.dob).trim();
    var mrn = S(appt.athenaId || appt.mrn || '').trim();
    var dt = S((row && row.dateStr) || '').replace(/^[A-Za-z]+,\s*/, '').trim();
    var isProv = /(provider|physician|surgeon|\bdoctor\b|operator|attending|clinician|proceduralist|performed by|operating|rendering)/.test(l);
    if (/\bnpi\b/.test(l) && S(prof.npi).trim()) return S(prof.npi).trim();
    if (/(practice name|\bpractice\b|group name|group practice)/.test(l) && S(prof.practice || prof.facility).trim()) return S(prof.practice || prof.facility).trim();
    if (/(facility|clinic|location|site|hospital|center|ambulatory|surgery center|\basc\b)/.test(l) && S(prof.facility || prof.practice).trim()) return S(prof.facility || prof.practice).trim();
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
  /* onf-1.4.0: RAW-TEMPLATE + VALUES model. The drafted note is kept verbatim as
     the raw template; every [FILL:] field is PRE-FILLED (known identity/profile
     value, or a safe smart-default best-guess) and the note is rendered from
     raw+values, so a field can be changed any number of times with one click and
     the note re-renders correctly (no value collisions, no token loss). */
  /* onf-1.9.0 (owner directive): every best-guess field is a DROPDOWN - the
     #1 guess pre-selected, guesses #2/#3 as alternatives, the doctor's own
     previously-used values above the generic ones, and "Other (type custom)"
     last. Never type from scratch in the common case. */
  function altGuesses(label) {
    var l = S(label).toLowerCase();
    var A = [
      [/local anesthetic/, ['1% lidocaine, 3 mL', '2% lidocaine, 2 mL', '0.25% bupivacaine, 2 mL']],
      [/steroid/, ['Dexamethasone 10 mg', 'Triamcinolone (Kenalog) 40 mg', 'Methylprednisolone (Depo-Medrol) 40 mg']],
      [/anesthetic.*volume|injectate/, ['0.25% bupivacaine, 1 mL', '0.5% bupivacaine, 1 mL', '1% lidocaine, 1 mL']],
      [/needle/, ['22-gauge', '25-gauge', '20-gauge']],
      [/contrast/, ['1 mL', '2 mL', '0.5 mL']],
      [/interval|follow.?up/, ['6 weeks', '2 weeks', '3 months']],
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
  function buildOptions(label, cur) {
    var key = S(label).toLowerCase();
    var prev = safe(function () { return (typeof window.getOpFieldVals === 'function') ? window.getOpFieldVals(key) : []; }, []) || [];
    var opts = [], seen = {};
    function add(v) { v = S(v).trim(); if (!v || seen[v.toLowerCase()]) return; seen[v.toLowerCase()] = 1; opts.push(v); }
    add(cur);
    prev.slice(0, 3).forEach(add);       /* the doctor's own answers first */
    altGuesses(label).forEach(add);      /* then the standard alternatives */
    return opts;
  }
  function buildFillBox(ta) {
    var idx = ta.id.replace('opPrepNote_', '');
    var row = safe(function () { return (window._opPrep || [])[+idx]; }, null);
    var existing = ta.previousElementSibling && ta.previousElementSibling.classList && ta.previousElementSibling.classList.contains('onf-fillbox')
      ? ta.previousElementSibling : null;
    /* establish / reset the raw template: a fresh AI draft is any note that has
       [FILL:] tokens and is NOT our own last render (identical to applyVals(raw)). */
    if (row) {
      var lastRender = row._onfRaw != null ? applyVals(row._onfRaw, row._onfVals || {}) : null;
      if (/\[FILL:/i.test(ta.value || '') && ta.value !== lastRender) { row._onfRaw = ta.value; row._onfVals = {}; }
    }
    var raw = (row && row._onfRaw != null) ? row._onfRaw : (ta.value || '');
    var tokens = fillTokens(raw);
    if (!tokens.length) { if (existing) existing.parentNode.removeChild(existing); return; }
    css();
    var vals = (row && row._onfVals) || {}, meta = {};
    var pmem = row ? loadFillMem(row) : {};                      /* onf-1.7.0: this patient's saved fills */
    for (var t = 0; t < tokens.length; t++) {
      var lab = tokens[t], key = lab.toLowerCase(), spec0 = fieldSpec(lab);
      if (vals[key] == null) {
        var kv = knownValue(lab, row);
        if (kv) { vals[key] = kv; meta[key] = 'known'; }
        else if (pmem[key]) { vals[key] = pmem[key]; meta[key] = 'saved'; }        /* remembered for this patient */
        else {
          var hm = historyMed(lab, row);                                          /* from the patient's chart history */
          if (hm) { vals[key] = hm; meta[key] = 'history'; saveFillMemValue(row, key, hm); }
          else { var sd = smartDefault(lab, spec0, row); if (sd) { vals[key] = sd; meta[key] = 'suggested'; } else meta[key] = 'blank'; }
        }
      } else meta[key] = vals[key] ? 'set' : 'blank';
    }
    if (row) row._onfVals = vals;
    /* render the note from raw + current values */
    var rendered = applyVals(raw, vals);
    if (rendered !== (ta.value || '')) {
      ta.value = rendered;
      safe(function () { ta.dispatchEvent(new Event('input', { bubbles: true })); });
      safe(function () { if (window._opPrep && window._opPrep[+idx]) window._opPrep[+idx].note = rendered; });
    }
    /* build the box: EVERY field shown, pre-set, marked known / suggested / blank */
    var box = existing || document.createElement('div');
    box.className = 'onf-fillbox';
    var rowsHtml = tokens.map(function (label) {
      var key = label.toLowerCase(), spec = fieldSpec(label), cur = vals[key] || '', kind = meta[key] || 'blank';
      var fid = 'onfF_' + idx + '_' + key.replace(/[^a-z0-9]+/g, '_'), ctrl;
      if (spec.type === 'select') {
        var opsHtml = spec.opts.slice();
        if (cur && opsHtml.indexOf(cur) < 0) opsHtml.push(cur);
        ctrl = '<select data-onf-idx="' + idx + '" data-onf-label="' + esc(label) + '" id="' + fid + '">' +
          opsHtml.map(function (o) { return '<option value="' + esc(o) + '"' + (S(o) === S(cur) ? ' selected' : '') + '>' + (o ? esc(o) : '— pick —') + '</option>'; }).join('') +
          '<option value="' + OTHER + '">Other (type custom)…</option></select>';
      } else {
        var choices = buildOptions(label, cur);
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
        : kind === 'history' ? ' <span class="onf-hist">from chart</span>'
        : (kind === 'blank' ? ' <span class="onf-need">needs value</span>' : '');
      return '<label class="' + (cur ? 'onf-has' : '') + '">' + esc(label.charAt(0).toUpperCase() + label.slice(1)) + tag + ctrl + '</label>';
    }).join('');
    var blanks = 0; for (var m in meta) if (meta[m] === 'blank') blanks++;
    box.innerHTML = '<div class="onf-h">✏️ Fields (' + tokens.length + ') — pre-filled with best guesses; change any in one click' + (blanks ? ' · <b>' + blanks + '</b> still need a value' : '') + '</div>' +
      '<div class="onf-grid">' + rowsHtml + '</div>' +
      '<div class="onf-note">Every field is pre-selected from the patient + procedure context. Changing one updates the note instantly.</div>';
    if (!existing) ta.parentNode.insertBefore(box, ta);
    var ctrls = box.querySelectorAll('[data-onf-label]');
    for (var i = 0; i < ctrls.length; i++) {
      (function wire(ctrl) {
        function applyVal(el) {
          if (!row) return;
          var label = el.getAttribute('data-onf-label'), val = S(el.value).trim();
          row._onfVals = row._onfVals || {}; row._onfVals[label.toLowerCase()] = val;
          saveFillMemValue(row, label.toLowerCase(), val);   /* per-patient memory (onf-1.7.0) */
          safe(function () { if (val && typeof window.addOpFieldVal === 'function') window.addOpFieldVal(label.toLowerCase(), val); });  /* cross-patient dropdown history */
          var out = applyVals(row._onfRaw != null ? row._onfRaw : (ta.value || ''), row._onfVals);
          ta.value = out;
          safe(function () { ta.dispatchEvent(new Event('input', { bubbles: true })); });
          safe(function () { if (window._opPrep && window._opPrep[+idx]) window._opPrep[+idx].note = out; });
          var lbl = el.closest('label'); if (lbl) lbl.classList.toggle('onf-has', !!val);
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
          safe(function () {
            var cands = document.querySelectorAll('.modal-bg, [id*=emplate]');
            for (var k = 0; k < cands.length; k++) {
              var c = cands[k];
              if (!c.offsetParent && getComputedStyle(c).position !== 'fixed') continue;
              if (!/Use templates when generating|Add a template|Upload templates \(one PDF/i.test(c.textContent || '')) continue;
              var root = c.closest('.modal-bg') || c;
              root.style.zIndex = '99500';
              break;
            }
          });
        }, 80);
      });
    }
  }

  /* ---------------- tick (freeze-safe: cheap, gated, write-if-changed) ---------------- */
  var _sig = {}, iv = null, _wireN = 0;
  function tick() {
    _wireN++;
    if (_wireN <= 3 || _wireN % 6 === 0) safe(wireUploadButtons);   /* PERF: wire early, then only every ~6s (was a full document button/a scan EVERY tick) */
    if (!modalOpen()) return;
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
        safe(function () { buildFillBox(t); });           /* raw+values: pre-fill known + smart-default every field */
        _sig[t.id] = sigOf(t);                            /* store the POST-render signature (settles the tick) */
      })(ta);
    }
  }
  function boot() { css(); safe(seedProfile); tick(); iv = setInterval(function () { safe(tick); }, 1000); }
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
    _patientKey: patientKey, _loadFillMem: loadFillMem, _saveFillMemValue: saveFillMemValue, _historyMed: historyMed,
    wireUploadButtons: wireUploadButtons, tick: tick, revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
