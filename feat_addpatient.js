/* ============================================================================
 * MLS — "Add patient with per-visit info"  (append-only asset for mls-connect.js)
 * window.__mlsAddPatient — a self-contained UI + code to create a patient and
 * build their visit history THREE ways, all writing into the SAME §40 model
 * (window.__mlsVisitModel):
 *   (1) MANUAL guided field form, visit by visit
 *   (2) TYPE/PASTE a visit -> AI structures it into the same per-visit entry
 *   (3) ATHENA pull (reuses window.__mlsCopyVisits.run — §40 copy-every-visit
 *       DOM flow + strict name+DOB gate + live progress + the §42 detection fix)
 *
 * Progressive enhancement only: own IIFE, own overlay DOM (does NOT depend on the
 * app's patient-list markup), try/catch throughout, silent no-op if a required
 * global is missing. Removing this file fully reverts the feature. No backend
 * schema change — patients/visits ride the existing patient JSON that
 * upsertPatient() already mirrors to the server. Read-only in athenaOne.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__mlsAddPatient) return;

  var isFn = function (f) { return typeof f === 'function'; };
  var S = function (x) { return (x == null ? '' : String(x)); };
  var trim = function (x) { return S(x).trim(); };
  var M = function () { return window.__mlsVisitModel || null; };

  function esc(s) {
    return S(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- app integration helpers (all defensive) ---------- */
  function getPatients() { try { return isFn(window.getPatients) ? (window.getPatients() || []) : []; } catch (e) { return []; } }
  function upsertPatient(p) {
    try { if (isFn(window.upsertPatient)) { window.upsertPatient(p); return true; } } catch (e) {}
    try {
      if (isFn(window.getPatients) && isFn(window.savePatients)) {
        var arr = window.getPatients(); var i = arr.findIndex(function (x) { return x && x.id === p.id; });
        p.updated = Date.now(); if (i >= 0) arr[i] = p; else { p.created = p.created || Date.now(); arr.unshift(p); }
        window.savePatients(arr); return true;
      }
    } catch (e) {}
    return false;
  }
  /* capsel-1.0.0 (b1192): an MLS-driven read or capture never changes the
     doctor's active patient. The one answer lives in the engine
     (window.__mlsCaptureSelectionKeep); the lane predicate
     window.__mlsAthenaDrivenByMls() (dnote-1.1.0) is the fallback for a page
     where that block has not evaluated yet. Fail-open toward the doctor. */
  function capselKeep(site, scopedOnly) {
    try { if (typeof window.__mlsCaptureSelectionKeep === 'function') return window.__mlsCaptureSelectionKeep(site, scopedOnly) === true; } catch (eK1) {}
    if (scopedOnly === true) return false;
    try { var f = window.__mlsAthenaDrivenByMls, r = (typeof f === 'function') ? f() : null; return !!(r && r.driving === true); } catch (eK2) {}
    return false;
  }
  function selectPatient(id) {
    try { if (isFn(window.setActivePtId)) window.setActivePtId(id); } catch (e) {}
    try { if (isFn(window.selectPatient)) window.selectPatient(id); } catch (e) {}
    try { if (isFn(window.renderPatients)) window.renderPatients(); } catch (e) {}
    try { if (isFn(window.renderProfile)) window.renderProfile(); } catch (e) {}
    try { if (window.__mlsVisitUI && isFn(window.__mlsVisitUI.render)) window.__mlsVisitUI.render(true); } catch (e) {}
  }
  function aiCall(sys, user) {
    if (isFn(window.aiCallRaw)) return window.aiCallRaw(sys, user, null, { freeform: true });
    return Promise.reject(new Error('no-ai-transport'));
  }

  /* ---------- create-or-find a patient: MRN, or NAME+DOB. Nothing weaker ----
   * ptfix-1.0.0 (b1169): findExisting used to end with `return true` on a bare
   * name match whenever EITHER side had no DOB - and both save paths of the
   * shipped Add-patient modal route through it (doSave and doAthena), so the
   * new patient's demographics and every captured visit were written straight
   * into the existing chart with no warning and a status line that read
   * "Saved patient <name> with N visit(s)" exactly as if it had created one.
   * Two people sharing a common name, one of them a schedule-imported row with
   * no DOB stored, is cross-patient contamination on the CREATE path - and it
   * is weaker than the product law, which auto-attaches on an MRN match or a
   * name+DOB match and treats anything weaker as a one-click SUGGESTION the
   * doctor confirms. It now fails closed: a weak hit returns no auto-match and
   * is surfaced as a candidate instead (findSuggestions), which also means the
   * "Adam Schaeffer" / "Adam J Schaeffer" case that the exact-string compare
   * used to MINT a duplicate for is now offered as a match.
   * -------------------------------------------------------------------------*/
  function normName(s) { return trim(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function nameTokens(s) { var t = normName(s); return t ? t.split(' ') : []; }
  /* tolerant: every token of the shorter name appears in the longer one, so a
     middle initial or a suffix does not make two humans. Never used on its own
     to attach - only to OFFER. */
  function nameCompatible(a, b) {
    var ta = nameTokens(a), tb = nameTokens(b), i;
    if (!ta.length || !tb.length) return false;
    var shortT = ta.length <= tb.length ? ta : tb, longT = ta.length <= tb.length ? tb : ta;
    for (i = 0; i < shortT.length; i++) if (longT.indexOf(shortT[i]) < 0) return false;
    return true;
  }
  /* A DOB is an identity only when it is CANONICAL. Prefer the shell's own
     _opDobKey (the key the op-note resolver matches appointments to charts
     with) so this module and the shell can never disagree; the local
     reimplementation keeps the module testable and boot-order independent. */
  function localDobKey(v) {
    var s = trim(v); if (!s) return '';
    var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    return '';
  }
  function dobKey(v) {
    var out = null;
    try { if (isFn(window._opDobKey)) out = window._opDobKey(v); } catch (e) { out = null; }
    if (typeof out !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(out)) out = localDobKey(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : '';
  }
  function mrnKey(p) { return S(p && (p.mrn || p.athenaId)).replace(/\D/g, ''); }

  /* Returns { patient, basis } for an auto-attach, or null. Fail-closed:
     ambiguity (more than one record claiming the same key) NEVER attaches. */
  function findExisting(name, dob, mrn) {
    var all = getPatients();
    var wantName = normName(name), wantDob = dobKey(dob), wantMrn = S(mrn).replace(/\D/g, '');
    var i, p, hits;
    if (!wantName && !wantMrn) return null;
    /* 1. MRN (>=5 digits, the same threshold the duplicate auto-merge uses) */
    if (wantMrn.length >= 5) {
      hits = [];
      for (i = 0; i < all.length; i++) {
        p = all[i]; if (!p) continue;
        if (mrnKey(p) !== wantMrn) continue;
        /* an MRN hit whose canonical DOB CONTRADICTS the typed one is not the
           same human - the same veto the merge module applies to MRNs */
        var pd0 = dobKey(p.dob);
        if (wantDob && pd0 && pd0 !== wantDob) continue;
        hits.push(p);
      }
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return null;
    }
    /* 2. NAME + DOB, both present on both sides, exact normalized name */
    if (!wantName || !wantDob) return null;
    hits = [];
    for (i = 0; i < all.length; i++) {
      p = all[i]; if (!p) continue;
      if (normName(p.name) !== wantName) continue;
      if (dobKey(p.dob) !== wantDob) continue;
      hits.push(p);
    }
    return hits.length === 1 ? hits[0] : null;
  }

  /* Everything the auto-attach refused but a human might still recognise:
     the same name with a DOB missing on a side, or a tolerant name match. */
  function findSuggestions(name, dob, mrn) {
    var all = getPatients();
    var wantName = normName(name), wantDob = dobKey(dob), wantMrn = S(mrn).replace(/\D/g, '');
    var out = [], i, p, pd, why;
    if (!wantName && !wantMrn) return out;
    for (i = 0; i < all.length; i++) {
      p = all[i]; if (!p || p.id == null) continue;
      pd = dobKey(p.dob);
      why = '';
      if (wantMrn.length >= 5 && mrnKey(p) === wantMrn) why = 'same MRN';
      else if (!wantName) continue;
      else if (normName(p.name) === wantName && (!wantDob || !pd)) why = pd || wantDob ? 'same name, date of birth missing on one chart' : 'same name, no date of birth on either chart';
      else if (normName(p.name) === wantName && pd && wantDob && pd !== wantDob) why = 'same name, DIFFERENT date of birth';
      else if (nameCompatible(p.name, name) && wantDob && pd === wantDob) why = 'same date of birth, name written differently';
      else if (nameCompatible(p.name, name) && normName(p.name) !== wantName && (!wantDob || !pd)) why = 'similar name, date of birth missing on one chart';
      if (!why) continue;
      out.push({ id: S(p.id), name: S(p.name), dob: S(p.dob), mrn: S(p.mrn || p.athenaId), why: why, visits: (p.visits || []).length });
      if (out.length >= 5) break;
    }
    return out;
  }

  function patientById(id) {
    var all = getPatients(), i;
    for (i = 0; i < all.length; i++) if (all[i] && S(all[i].id) === S(id)) return all[i];
    return null;
  }

  function createOrFindPatient(details, opts) {
    opts = opts || {};
    var existing = null;
    /* an explicit doctor decision outranks the automatic test, in both
       directions - "yes, same person" attaches, "no, new chart" mints */
    if (opts.attachToId) {
      existing = patientById(opts.attachToId);
      if (!existing) return { patient: null, created: false, needsConfirm: false, reason: 'candidate-gone' };
    } else if (opts.confirmedNew !== true) {
      existing = findExisting(details.name, details.dob, details.mrn);
      if (!existing) {
        var sugg = findSuggestions(details.name, details.dob, details.mrn);
        if (sugg.length) return { patient: null, created: false, needsConfirm: true, candidates: sugg };
      }
    }
    if (existing) {
      // fill in any newly provided demographics without clobbering
      if (!trim(existing.dob) && trim(details.dob)) existing.dob = trim(details.dob);
      if (!trim(existing.mrn) && trim(details.mrn)) existing.mrn = trim(details.mrn);
      if (!trim(existing.sex) && trim(details.sex)) existing.sex = trim(details.sex);
      if (!trim(existing.phone) && trim(details.phone)) existing.phone = trim(details.phone);
      if (!Array.isArray(existing.visits)) existing.visits = [];
      upsertPatient(existing);
      return { patient: existing, created: false, attached: true, confirmed: !!opts.attachToId };
    }
    var p = {
      id: uid(),
      name: trim(details.name),
      dob: trim(details.dob),
      mrn: trim(details.mrn),
      sex: trim(details.sex),
      phone: trim(details.phone),
      visits: [],
      created: Date.now(),
      updated: Date.now(),
      source: 'manual-add'
    };
    upsertPatient(p);
    return { patient: p, created: true };
  }

  /* ---------- AI: structure a pasted free-text visit into the §40 fields ---------- */
  var STRUCT_SYS =
    'You are a clinical data extractor for a spine / pain management / PM&R practice. ' +
    'You are given the raw free text of ONE patient visit. Extract a single structured visit as STRICT JSON ' +
    'with EXACTLY these keys: ' +
    '{"date":"YYYY-MM-DD or empty","type":"visit type / procedure performed","icd10":["ICD-10 codes"],' +
    '"cpt":["CPT codes"],"meds":["medications, with changes noted"],"findings":"key exam/imaging findings",' +
    '"scores":{"VAS":"","NRS":"","ODI":""},"plan":"plan / follow-up"}. ' +
    'Rules: Output ONLY the JSON object, no prose, no code fences. Be factual — never invent codes, scores, ' +
    'medications, or findings that are not present in the text. Use empty string / empty array / omit a score key ' +
    'when a field is not documented. Normalize the visit date to YYYY-MM-DD when a date is present.';

  function structureWithAI(text) {
    return aiCall(STRUCT_SYS, 'RAW VISIT TEXT:\n' + S(text)).then(function (out) {
      var raw = trim(out);
      // tolerate code fences / leading prose around the JSON
      var fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) raw = trim(fence[1]);
      var first = raw.indexOf('{'), last = raw.lastIndexOf('}');
      if (first >= 0 && last > first) raw = raw.slice(first, last + 1);
      var obj;
      try { obj = JSON.parse(raw); } catch (e) { obj = null; }
      if (!obj || typeof obj !== 'object') {
        // fall back: let the model's text become the raw; the model's regex extracts codes
        return { date: '', type: '', icd10: [], cpt: [], meds: [], findings: '', scores: {}, plan: '', raw: text, _aiParseFailed: true };
      }
      var scores = {};
      if (obj.scores && typeof obj.scores === 'object') {
        Object.keys(obj.scores).forEach(function (k) { var v = trim(obj.scores[k]); if (v) scores[k] = v; });
      }
      return {
        date: trim(obj.date),
        type: trim(obj.type),
        icd10: Array.isArray(obj.icd10) ? obj.icd10.map(trim).filter(Boolean) : [],
        cpt: Array.isArray(obj.cpt) ? obj.cpt.map(trim).filter(Boolean) : [],
        meds: Array.isArray(obj.meds) ? obj.meds.map(trim).filter(Boolean) : (trim(obj.meds) ? [trim(obj.meds)] : []),
        findings: trim(obj.findings),
        scores: scores,
        plan: trim(obj.plan),
        raw: text
      };
    });
  }

  /* ---------- the modal UI ---------- */
  var _pending = [];   // visits queued in the modal before save
  var _details = {};   // patient details
  var _modalEpoch = 0; // invalidates async work from a closed/replaced modal

  function modalStillCurrent(modal, epoch) {
    if (!modal || Number(epoch) !== Number(_modalEpoch)) return false;
    var current = document.getElementById('mlsAddPtModal');
    return current === modal && Number(modal.__mlsAddPatientEpoch) === Number(epoch);
  }

  function activePatientId() {
    try { if (isFn(window.getActivePtId)) return S(window.getActivePtId()); } catch (e) {}
    try {
      if (isFn(window.activePatient)) {
        var p = window.activePatient();
        return p && p.id != null ? S(p.id) : '';
      }
    } catch (e) {}
    return '';
  }

  function modalPatientFingerprint(modal) {
    if (!modal || !isFn(modal.querySelector)) return '';
    return ['#apName', '#apDob', '#apMrn', '#apSex', '#apPhone'].map(function (id) {
      var el = modal.querySelector(id);
      return el ? trim(el.value) : '';
    }).join('\u001f');
  }

  function listToArr(s) { return S(s).split(/[\n,;]+/).map(trim).filter(Boolean); }

  function css() {
    if (document.getElementById('mlsAddPtCss')) return;
    var st = document.createElement('style'); st.id = 'mlsAddPtCss';
    st.textContent =
      '#mlsAddPtLauncher{position:fixed;right:18px;bottom:18px;z-index:99990;cursor:pointer;border:0;border-radius:999px;' +
        'padding:11px 16px;font-size:13px;font-weight:800;color:#fff;background:#204034;' +
        'box-shadow:0 8px 20px -8px rgba(32,64,52,.6)}' +
      '#mlsAddPtLauncher:hover{filter:brightness(1.07)}' +
      '#mlsAddPtOv{position:fixed;inset:0;z-index:99991;background:rgba(26,33,28,.45);display:flex;align-items:flex-start;' +
        'justify-content:center;padding:28px 14px;overflow:auto}' +
      '#mlsAddPtModal{width:min(720px,96vw);background:var(--card,#fff);color:inherit;border-radius:16px;box-shadow:0 24px 64px rgba(26,33,28,.2);overflow:hidden}' +
      '#mlsAddPtModal .ap-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line,#E7E5DD)}' +
      '#mlsAddPtModal .ap-hd h3{margin:0;font:600 19px Newsreader,Georgia,serif;display:flex;gap:8px;align-items:center}' +
      '#mlsAddPtModal .ap-x{cursor:pointer;border:0;background:transparent;font-size:20px;line-height:1;color:inherit;opacity:.6}' +
      '#mlsAddPtModal .ap-x:hover{opacity:1}' +
      '#mlsAddPtModal .ap-bd{padding:16px 18px;max-height:74vh;overflow:auto}' +
      '#mlsAddPtModal .ap-sec{margin:0 0 16px}' +
      '#mlsAddPtModal .ap-lab{display:block;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;opacity:.62;margin:0 0 4px}' +
      '#mlsAddPtModal .ap-row{display:flex;gap:10px;flex-wrap:wrap}' +
      '#mlsAddPtModal .ap-row>div{flex:1;min-width:150px}' +
      '#mlsAddPtModal input,#mlsAddPtModal textarea,#mlsAddPtModal select{width:100%;box-sizing:border-box;border:1px solid var(--line,#E7E5DD);' +
        'border-radius:9px;padding:8px 10px;font-size:13px;font-family:inherit;background:var(--bg,#fff);color:inherit}' +
      '#mlsAddPtModal textarea{min-height:74px;resize:vertical}' +
      '#mlsAddPtModal .ap-modes{display:flex;gap:8px;margin:0 0 10px}' +
      '#mlsAddPtModal .ap-mode{flex:1;cursor:pointer;text-align:center;border:1px solid var(--line,#E7E5DD);border-radius:10px;padding:9px;font-size:12.5px;font-weight:700;background:var(--bg2,#F4F2EC)}' +
      '#mlsAddPtModal .ap-mode.on{border-color:#2E6A4B;background:#EAF1EE;color:#204034}' +
      '#mlsAddPtModal .ap-card{border:1px solid var(--line,#E7E5DD);border-radius:12px;padding:13px;background:var(--bg2,#FCFBF8)}' +
      '#mlsAddPtModal .ap-pending{margin:10px 0 0}' +
      /* ptfix-1.0.0 (b1169): identity-confirm surface */
      '#mlsAddPtModal .ap-confirm{margin:12px 0 0;border:1px solid #f0d9a0;background:#fdf6e3;border-radius:10px;padding:12px}' +
      '#mlsAddPtModal .ap-cf-hd{font-weight:800;color:#8a5a00;margin-bottom:4px}' +
      '#mlsAddPtModal .ap-cf-sub{font-size:12.5px;color:#6b5a3a;margin-bottom:10px;line-height:1.45}' +
      '#mlsAddPtModal .ap-cf-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid #f0e0b0}' +
      '#mlsAddPtModal .ap-cf-who{font-size:13px;color:#2b2b2b;min-width:0}' +
      '#mlsAddPtModal .ap-cf-why{font-size:12px;color:#8a6d3b;margin-top:2px}' +
      '#mlsAddPtModal .ap-pv{display:flex;align-items:center;gap:10px;border:1px solid var(--line,#E7E5DD);border-radius:9px;padding:7px 10px;margin:0 0 6px;background:var(--card,#fff);font-size:12.5px}' +
      '#mlsAddPtModal .ap-pv b{min-width:92px}' +
      '#mlsAddPtModal .ap-pv .ap-pv-t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85}' +
      '#mlsAddPtModal .ap-pv .ap-del{cursor:pointer;border:0;background:transparent;color:#b91c1c;font-weight:800}' +
      '#mlsAddPtModal .ap-pill{font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 7px;background:#e8f5e9;color:#2e7d32}' +
      '#mlsAddPtModal .ap-ft{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 18px;border-top:1px solid var(--line,#E7E5DD)}' +
      '#mlsAddPtModal .ap-btn{cursor:pointer;border:0;border-radius:10px;padding:9px 15px;font-size:13px;font-weight:800;color:#fff;background:#204034;box-shadow:0 8px 20px -8px rgba(32,64,52,.6)}' +
      '#mlsAddPtModal .ap-btn.sec{background:#fff;color:inherit;border:1px solid #D9D6CD;box-shadow:none}' +
      '#mlsAddPtModal .ap-btn.ath{background:#204034}' +
      '#mlsAddPtModal .ap-btn[disabled]{opacity:.55;cursor:default}' +
      '#mlsAddPtModal .ap-status{font-size:12.5px;opacity:.82;flex:1;min-width:160px}' +
      '#mlsAddPtModal .ap-hint{font-size:11.5px;opacity:.6;margin:6px 0 0}';
    (document.head || document.documentElement).appendChild(st);
  }

  function pendingRowHtml(v, i) {
    var codes = (v.cpt || []).slice(0, 3).concat(v.icd10 || []).slice(0, 4);
    return '<div class="ap-pv"><b>' + esc(v.date || '(undated)') + '</b>' +
      '<span class="ap-pv-t">' + esc(v.type || 'Visit') + (codes.length ? ' · ' + esc(codes.join(', ')) : '') + '</span>' +
      (v._ai ? '<span class="ap-pill">AI</span>' : '') +
      '<button class="ap-del" data-i="' + i + '" title="Remove">✕</button></div>';
  }

  function refreshPending(modal) {
    var box = modal.querySelector('#apPending');
    if (!box) return;
    if (!_pending.length) { box.innerHTML = '<div class="ap-hint">No visits added yet. Add at least one visit, or use “Pull from athenaOne”.</div>'; return; }
    box.innerHTML = '<div class="ap-lab">Visits to save (' + _pending.length + ')</div>' +
      _pending.map(pendingRowHtml).join('');
    box.querySelectorAll('.ap-del').forEach(function (b) {
      b.addEventListener('click', function () { _pending.splice(parseInt(b.getAttribute('data-i'), 10), 1); refreshPending(modal); });
    });
  }

  function acceptStructuredResult(modal, expectedModalEpoch, expectedModeEpoch, currentModeEpoch, v) {
    if (!modalStillCurrent(modal, expectedModalEpoch) || Number(expectedModeEpoch) !== Number(currentModeEpoch)) return false;
    if (!v || typeof v !== 'object') return false;
    v._ai = true;
    _pending.push(v);
    refreshPending(modal);
    return true;
  }

  function structureAndQueue(modal, text, expectedModalEpoch, expectedModeEpoch, getCurrentModeEpoch, ui) {
    ui = ui || {};
    return structureWithAI(text).then(function (v) {
      var currentModeEpoch = isFn(getCurrentModeEpoch) ? getCurrentModeEpoch() : expectedModeEpoch;
      if (!acceptStructuredResult(modal, expectedModalEpoch, expectedModeEpoch, currentModeEpoch, v)) {
        return { added: false, reason: 'stale-modal' };
      }
      if (ui.textarea) ui.textarea.value = '';
      if (ui.status) ui.status.textContent = v._aiParseFailed ? 'Added (kept raw text - codes auto-detected).' : 'Structured & added.';
      if (ui.button) ui.button.disabled = false;
      return { added: true, visit: v };
    }, function (err) {
      var currentModeEpoch = isFn(getCurrentModeEpoch) ? getCurrentModeEpoch() : expectedModeEpoch;
      if (modalStillCurrent(modal, expectedModalEpoch) && Number(expectedModeEpoch) === Number(currentModeEpoch)) {
        if (ui.status) ui.status.textContent = 'AI failed (' + (err && err.message || 'error') + ').';
        if (ui.button) ui.button.disabled = false;
      }
      return { added: false, reason: 'ai-error', error: err };
    });
  }

  function guidedFormHtml() {
    return '<div class="ap-card" id="apGuided">' +
      '<div class="ap-row">' +
        '<div><label class="ap-lab">Visit date</label><input id="apgDate" type="date"></div>' +
        '<div><label class="ap-lab">Visit type / procedure</label><input id="apgType" placeholder="e.g. Transforaminal ESI — lumbar"></div>' +
      '</div>' +
      '<div class="ap-row" style="margin-top:8px">' +
        '<div><label class="ap-lab">ICD-10 dx (comma-sep)</label><input id="apgIcd" placeholder="M54.16, M51.36"></div>' +
        '<div><label class="ap-lab">CPT (comma-sep)</label><input id="apgCpt" placeholder="64483, 64484"></div>' +
      '</div>' +
      '<div class="ap-sec" style="margin:8px 0 0"><label class="ap-lab">Medications (comma or newline)</label><textarea id="apgMeds" style="min-height:46px" placeholder="gabapentin 300mg TID; ..."></textarea></div>' +
      '<div class="ap-sec" style="margin:8px 0 0"><label class="ap-lab">Findings (exam / imaging)</label><textarea id="apgFind" placeholder="key exam and imaging findings"></textarea></div>' +
      '<div class="ap-row" style="margin-top:8px">' +
        '<div><label class="ap-lab">Pain score (VAS/NRS)</label><input id="apgPain" placeholder="e.g. 7/10"></div>' +
        '<div><label class="ap-lab">Function (ODI)</label><input id="apgOdi" placeholder="e.g. 42%"></div>' +
      '</div>' +
      '<div class="ap-sec" style="margin:8px 0 0"><label class="ap-lab">Plan / follow-up</label><textarea id="apgPlan" placeholder="plan and follow-up"></textarea></div>' +
      '<div style="margin-top:10px"><button class="ap-btn sec" id="apgAdd" type="button">➕ Add this visit</button></div>' +
    '</div>';
  }
  function pasteFormHtml() {
    return '<div class="ap-card" id="apPaste">' +
      '<label class="ap-lab">Type or paste the visit — AI will structure it into the same per-visit entry</label>' +
      '<textarea id="appText" style="min-height:130px" placeholder="Paste the encounter note / visit text here…"></textarea>' +
      '<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        '<button class="ap-btn sec" id="appStruct" type="button">✨ Structure with AI &amp; add</button>' +
        '<span class="ap-status" id="appStatus"></span>' +
      '</div>' +
      '<div class="ap-hint">Uses the same OpenAI proxy as the rest of MLS. It extracts date, type, ICD-10, CPT, meds, findings, scores and plan, then a comprehensive AI summary is generated on save — identical to an Athena-pulled visit.</div>' +
    '</div>';
  }

  function collectGuided(modal) {
    var painScores = {};
    var pain = trim(modal.querySelector('#apgPain') && modal.querySelector('#apgPain').value);
    var odi = trim(modal.querySelector('#apgOdi') && modal.querySelector('#apgOdi').value);
    if (pain) painScores.Pain = pain;
    if (odi) painScores.ODI = odi;
    var raw = [];
    var get = function (id) { var el = modal.querySelector(id); return el ? trim(el.value) : ''; };
    var date = get('#apgDate'), type = get('#apgType'), icd = get('#apgIcd'), cpt = get('#apgCpt');
    var meds = get('#apgMeds'), find = get('#apgFind'), plan = get('#apgPlan');
    if (date) raw.push('Visit date: ' + date);
    if (type) raw.push('Visit type/procedure: ' + type);
    if (icd) raw.push('Diagnoses (ICD-10): ' + icd);
    if (cpt) raw.push('Procedures (CPT): ' + cpt);
    if (meds) raw.push('Medications: ' + meds);
    if (find) raw.push('Findings: ' + find);
    if (pain) raw.push('Pain score: ' + pain);
    if (odi) raw.push('Function (ODI): ' + odi);
    if (plan) raw.push('Plan: ' + plan);
    if (!date && !type && !icd && !cpt && !meds && !find && !plan) return null;
    return {
      date: date, type: type,
      icd10: listToArr(icd), cpt: listToArr(cpt), meds: listToArr(meds),
      findings: find, scores: painScores, plan: plan,
      raw: raw.join('\n')
    };
  }

  function clearGuided(modal) {
    ['#apgDate', '#apgType', '#apgIcd', '#apgCpt', '#apgMeds', '#apgFind', '#apgPain', '#apgOdi', '#apgPlan'].forEach(function (id) {
      var el = modal.querySelector(id); if (el) el.value = '';
    });
  }

  function buildModal() {
    css();
    var ov = document.createElement('div'); ov.id = 'mlsAddPtOv';
    ov.innerHTML =
      '<div id="mlsAddPtModal" role="dialog" aria-modal="true">' +
        '<div class="ap-hd"><h3>➕ Add patient <span style="opacity:.6;font-weight:600;font-size:13px">— with per-visit history</span></h3>' +
          '<button class="ap-x" id="apClose" title="Close">×</button></div>' +
        '<div class="ap-bd">' +
          '<div class="ap-sec"><div class="ap-lab">Patient</div><div class="ap-row">' +
            '<div><input id="apName" placeholder="Full name (e.g. Jane A. Doe)"></div>' +
            '<div><input id="apDob" placeholder="DOB (MM/DD/YYYY)"></div>' +
          '</div><div class="ap-row" style="margin-top:8px">' +
            '<div><input id="apMrn" placeholder="MRN (optional)"></div>' +
            '<div><input id="apSex" placeholder="Sex (optional)"></div>' +
            '<div><input id="apPhone" placeholder="Phone (optional)"></div>' +
          '</div></div>' +
          '<div class="ap-sec"><div class="ap-lab">Add a visit</div>' +
            '<div class="ap-modes"><div class="ap-mode on" data-mode="guided">📝 Guided fields</div>' +
              '<div class="ap-mode" data-mode="paste">✨ Type / paste → AI</div></div>' +
            '<div id="apModeHost"></div>' +
          '</div>' +
          '<div class="ap-pending" id="apPending"></div>' +
          /* ptfix-1.0.0 (b1169): the identity-confirm surface */
          '<div class="ap-confirm" id="apConfirm" style="display:none"></div>' +
        '</div>' +
        '<div class="ap-ft">' +
          '<button class="ap-btn" id="apSave" type="button">💾 Save patient</button>' +
          '<button class="ap-btn ath" id="apAthena" type="button">📋 Pull from athenaOne</button>' +
          '<button class="ap-btn sec" id="apCancel" type="button">Cancel</button>' +
          '<span class="ap-status" id="apStatus"></span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var modal = ov.querySelector('#mlsAddPtModal');
    var modalEpoch = _modalEpoch;
    ov.__mlsAddPatientEpoch = modalEpoch;
    modal.__mlsAddPatientEpoch = modalEpoch;

    // mode switching
    var mode = 'guided';
    var modeEpoch = 0;
    function renderMode() {
      modeEpoch++;
      var host = modal.querySelector('#apModeHost');
      host.innerHTML = (mode === 'guided') ? guidedFormHtml() : pasteFormHtml();
      if (mode === 'guided') {
        modal.querySelector('#apgAdd').addEventListener('click', function () {
          var v = collectGuided(modal);
          if (!v) { setStatus(modal, 'Fill in at least one visit field first.'); return; }
          _pending.push(v); clearGuided(modal); refreshPending(modal); setStatus(modal, 'Visit added. Add more, then Save.');
        });
      } else {
        modal.querySelector('#appStruct').addEventListener('click', function () {
          var t = trim(modal.querySelector('#appText').value);
          var stEl = modal.querySelector('#appStatus');
          if (!t) { stEl.textContent = 'Paste a visit first.'; return; }
          if (!isFn(window.aiCallRaw)) { stEl.textContent = 'AI transport unavailable — use Guided fields.'; return; }
          var btn = modal.querySelector('#appStruct'); btn.disabled = true; stEl.textContent = 'Structuring with AI…';
          var requestModeEpoch = modeEpoch;
          structureAndQueue(modal, t, modalEpoch, requestModeEpoch, function () { return modeEpoch; }, {
            textarea: modal.querySelector('#appText'), status: stEl, button: btn
          });
        });
      }
    }
    modal.querySelectorAll('.ap-mode').forEach(function (m) {
      m.addEventListener('click', function () {
        modal.querySelectorAll('.ap-mode').forEach(function (x) { x.classList.remove('on'); });
        m.classList.add('on'); mode = m.getAttribute('data-mode'); renderMode();
      });
    });
    renderMode();
    refreshPending(modal);

    function gatherDetails() {
      return {
        name: trim(modal.querySelector('#apName').value),
        dob: trim(modal.querySelector('#apDob').value),
        mrn: trim(modal.querySelector('#apMrn').value),
        sex: trim(modal.querySelector('#apSex').value),
        phone: trim(modal.querySelector('#apPhone').value)
      };
    }

    modal.querySelector('#apSave').addEventListener('click', function () { doSave(modal, gatherDetails()); });
    modal.querySelector('#apAthena').addEventListener('click', function () { doAthena(modal, gatherDetails()); });
    var closeFn = function () { close(modalEpoch); };
    modal.querySelector('#apClose').addEventListener('click', closeFn);
    modal.querySelector('#apCancel').addEventListener('click', closeFn);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(modalEpoch); });

    return ov;
  }

  function setStatus(modal, msg) { var el = modal.querySelector('#apStatus'); if (el) el.textContent = msg || ''; }

  /* ptfix-1.0.0 (b1169): the one-click "is this the same person?" step. The
     product law auto-attaches only on an MRN match or a name+DOB match; every
     weaker resemblance stops here and waits for the doctor. There is no silent
     path out of this function: if the confirm surface cannot be rendered the
     save REFUSES and says what to do, because minting-or-attaching on a guess
     is the defect this replaces. */
  function clearConfirm(modal) {
    var host = modal && modal.querySelector && modal.querySelector('#apConfirm');
    if (!host) return;
    host.innerHTML = '';
    host.style.display = 'none';
  }
  function renderConfirm(modal, details, candidates, onAttach, onNew) {
    var host = null;
    try { host = modal.querySelector('#apConfirm'); } catch (e) { host = null; }
    if (!host || !host.appendChild) return false;
    var html = '<div class="ap-cf-hd">Is this the same person?</div>' +
      '<div class="ap-cf-sub">MLS files a visit into an existing chart automatically only when the MRN matches, or when the name AND date of birth both match. ' +
      'These charts look close but do not meet that bar, so nothing has been saved yet.</div>';
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      html += '<div class="ap-cf-row"><div class="ap-cf-who"><b>' + esc(c.name || '(no name)') + '</b>' +
        (c.dob ? ' &nbsp;·&nbsp; DOB ' + esc(c.dob) : ' &nbsp;·&nbsp; no DOB on file') +
        (c.mrn ? ' &nbsp;·&nbsp; MRN ' + esc(c.mrn) : '') +
        ' &nbsp;·&nbsp; ' + c.visits + ' visit' + (c.visits === 1 ? '' : 's') +
        '<div class="ap-cf-why">' + esc(c.why) + '</div></div>' +
        '<button class="ap-btn" type="button" data-ap-attach="' + esc(c.id) + '">Yes — same person</button></div>';
    }
    html += '<div class="ap-cf-row"><div class="ap-cf-who">' + esc(trim(details.name) || 'This patient') +
      ' is someone else.<div class="ap-cf-why">A separate chart is created. Adding a date of birth first makes the match automatic next time.</div></div>' +
      '<button class="ap-btn sec" type="button" data-ap-new="1">No — create a new chart</button></div>';
    host.innerHTML = html;
    host.style.display = 'block';
    var btns = host.querySelectorAll ? host.querySelectorAll('button') : [];
    for (var b = 0; b < btns.length; b++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-ap-attach');
          clearConfirm(modal);
          if (id) onAttach(id); else onNew();
        });
      })(btns[b]);
    }
    return true;
  }
  function confirmRefusedMsg(details) {
    return 'A chart with a similar name already exists, and the date of birth does not match or is missing — MLS will not file this visit into it on a guess. ' +
      'Add ' + (trim(details.dob) ? 'the MRN' : 'the date of birth') + ' and save again, or open the existing chart from the Patients list.';
  }

  /* ---------- SAVE (manual + AI visits) into the §40 model ---------- */
  function doSave(modal, details, idOpts) {
    var saveEpoch = Number(modal && modal.__mlsAddPatientEpoch);
    if (!modalStillCurrent(modal, saveEpoch)) return Promise.resolve({ saved: false, reason: 'stale-modal' });
    if (!trim(details.name)) { setStatus(modal, 'Enter the patient name first.'); return Promise.resolve({ saved: false, reason: 'missing-name' }); }
    var mod = M();
    if (!mod) { setStatus(modal, 'Visit model not ready — reload the page.'); return Promise.resolve({ saved: false, reason: 'model-unavailable' }); }
    if (!_pending.length) { setStatus(modal, 'Add at least one visit, or use “Pull from athenaOne”.'); return Promise.resolve({ saved: false, reason: 'missing-visit' }); }
    var btn = modal.querySelector('#apSave'); btn.disabled = true;
    setStatus(modal, 'Saving patient…');
    var activeAtStart = activePatientId();
    var formAtStart = modalPatientFingerprint(modal);
    var res = createOrFindPatient(details, idOpts);
    /* ptfix-1.0.0 (b1169): a weak identity match NEVER writes. Nothing has been
       consumed from _pending at this point, so the doctor's decision resumes
       the identical save. */
    if (res && res.needsConfirm) {
      if (btn) btn.disabled = false;
      var offered = renderConfirm(modal, details, res.candidates, function (id) {
        doSave(modal, details, { attachToId: id });
      }, function () {
        doSave(modal, details, { confirmedNew: true });
      });
      setStatus(modal, offered
        ? 'Not saved yet — MLS found ' + res.candidates.length + ' chart' + (res.candidates.length === 1 ? '' : 's') + ' that could be this person. Choose below.'
        : confirmRefusedMsg(details));
      return Promise.resolve({ saved: false, reason: offered ? 'needs-confirm' : 'needs-confirm-no-surface', candidates: res.candidates });
    }
    if (!res || !res.patient) {
      if (btn) btn.disabled = false;
      setStatus(modal, 'That chart is no longer here — save again to choose.');
      return Promise.resolve({ saved: false, reason: (res && res.reason) || 'no-patient' });
    }
    clearConfirm(modal);
    var p = res.patient;
    var saved = 0;
    var visitsToSave = _pending.slice();
    visitsToSave.forEach(function (v) {
      var src = v._ai ? 'manual-ai' : 'manual';
      var stored = mod.addVisit(p.id, v, { source: src });
      if (stored) saved++;
    });
    // Consume only this save's captured visits before the await. Any visits added
    // later belong to the still-open (or subsequently reopened) modal session.
    _pending.splice(0, visitsToSave.length);
    setStatus(modal, 'Saved ' + saved + ' visit' + (saved === 1 ? '' : 's') + '. Generating AI summaries…');
    var summaryPromise;
    try {
      summaryPromise = mod.ensureSummaries(p.id, function (m) {
        if (modalStillCurrent(modal, saveEpoch)) setStatus(modal, m);
      });
    } catch (e) { summaryPromise = Promise.reject(e); }

    function finish(summaryOk) {
      if (!modalStillCurrent(modal, saveEpoch)) return { saved: true, patientId: p.id, uiUpdated: false };
      var contextMoved = activePatientId() !== activeAtStart || modalPatientFingerprint(modal) !== formAtStart;
      /* ptfix-1.0.0 (b1169): "Saved patient X" read the same whether a chart
         was created or an existing one was written into. It now names which. */
      var what = res.created ? ('new patient “' + p.name + '”') : ('into the existing chart for “' + p.name + '”');
      var base = summaryOk
        ? ('Saved ' + what + ' — ' + mod.getVisits(p).length + ' visit(s).')
        : ('Saved ' + what + ' (summaries can be generated from the profile).');
      if (contextMoved) {
        btn.disabled = false;
        setStatus(modal, base + ' Your current patient and form were left unchanged.');
        return { saved: true, patientId: p.id, uiUpdated: true, selectionPreserved: true };
      }
      selectPatient(p.id);
      setStatus(modal, base);
      setTimeout(function () { close(saveEpoch); }, summaryOk ? 900 : 1100);
      return { saved: true, patientId: p.id, uiUpdated: true, selectionPreserved: false };
    }

    return Promise.resolve(summaryPromise).then(function () { return finish(true); }, function () { return finish(false); });
  }

  /* ---------- ATHENA pull from the same UI (reuse §40 copy-every-visit) ---------- */
  function doAthena(modal, details, idOpts) {
    var athenaEpoch = Number(modal && modal.__mlsAddPatientEpoch);
    if (!modalStillCurrent(modal, athenaEpoch)) return Promise.resolve({ pulled: false, reason: 'stale-modal' });
    if (!trim(details.name)) { setStatus(modal, 'Enter the patient name (and DOB) first — the Athena pull verifies name + DOB.'); return; }
    if (!window.__mlsCopyVisits || !isFn(window.__mlsCopyVisits.run)) {
      setStatus(modal, 'Copy-every-visit module not loaded. Save manually, then use “📋 Copy every visit” on the profile.');
      return;
    }
    var btn = modal.querySelector('#apAthena'); btn.disabled = true;
    setStatus(modal, 'Preparing patient…');
    var res = createOrFindPatient(details, idOpts);
    /* ptfix-1.0.0 (b1169): the Athena path routes through the SAME resolver, so
       it takes the same confirm step - a weak name hit must not decide which
       chart an entire pulled history lands in. */
    if (res && res.needsConfirm) {
      if (btn) btn.disabled = false;
      var offeredA = renderConfirm(modal, details, res.candidates, function (id) {
        doAthena(modal, details, { attachToId: id });
      }, function () {
        doAthena(modal, details, { confirmedNew: true });
      });
      setStatus(modal, offeredA
        ? 'Nothing pulled yet — MLS found ' + res.candidates.length + ' chart' + (res.candidates.length === 1 ? '' : 's') + ' that could be this person. Choose below.'
        : confirmRefusedMsg(details));
      return Promise.resolve({ pulled: false, reason: offeredA ? 'needs-confirm' : 'needs-confirm-no-surface', candidates: res.candidates });
    }
    if (!res || !res.patient) {
      if (btn) btn.disabled = false;
      setStatus(modal, 'That chart is no longer here — try again to choose.');
      return Promise.resolve({ pulled: false, reason: (res && res.reason) || 'no-patient' });
    }
    clearConfirm(modal);
    var p = res.patient;
    // queue any manually-entered visits first so nothing is lost
    var mod = M();
    if (mod && _pending.length) {
      _pending.forEach(function (v) { mod.addVisit(p.id, v, { source: v._ai ? 'manual-ai' : 'manual' }); });
      _pending = [];
    }
    /* capsel-1.0.0 (b1192): copy-every-visit does NOT need the active patient -
       run(onStatus, patientOverride) has always taken the row explicitly, and
       that is what travels below. The selection moves only when the doctor is
       the one driving, which is every ordinary press of this button. */
    if (!capselKeep('addpatient-athena-adopt', true)) selectPatient(p.id);
    setStatus(modal, 'Open ' + esc(p.name) + '’s chart in athenaOne — pulling every visit (read-only)…');
    // run the proven §40 flow; it verifies name+DOB against the open Athena chart
    return window.__mlsCopyVisits.run(function (m) { if (modalStillCurrent(modal, athenaEpoch)) setStatus(modal, m); }, p).then(function () {
      if (!modalStillCurrent(modal, athenaEpoch)) return { pulled: true, uiUpdated: false };
      setStatus(modal, '✓ Athena pull complete — see the Visit history on the profile.');
      setTimeout(function () { close(athenaEpoch); }, 1200);
      return { pulled: true, uiUpdated: true };
    }, function (err) {
      if (!modalStillCurrent(modal, athenaEpoch)) return { pulled: false, uiUpdated: false, error: err };
      setStatus(modal, '⚠ ' + (err && err.message || 'Athena pull failed.') + ' (Any manual visits were saved.)');
      btn.disabled = false;
      return { pulled: false, uiUpdated: true, error: err };
    });
  }

  function close(expectedEpoch) {
    if (arguments.length && Number(expectedEpoch) !== Number(_modalEpoch)) return false;
    _modalEpoch++;
    var ov = document.getElementById('mlsAddPtOv'); if (ov) ov.remove();
    return true;
  }
  function open() {
    if (document.getElementById('mlsAddPtOv')) return;
    _modalEpoch++;
    _pending = [];
    return buildModal();
  }

  /* ---------- launcher button (robust: find a patients-area anchor, else float) ---------- */
  function loggedInUi() {
    // only show when the app's patient layer is available
    return isFn(window.getPatients) && (isFn(window.upsertPatient) || isFn(window.savePatients));
  }
  function ensureLauncher() {
    if (!loggedInUi()) { var ex0 = document.getElementById('mlsAddPtLauncher'); if (ex0) ex0.remove(); return; }
    // try to dock into a patients toolbar if one is present and visible
    var anchors = ['#patientSearch', '#ptSearch', '#patientsHeader', '#patientList', '#patientsList', '#patientsTab', '#patients'];
    var docked = null;
    for (var i = 0; i < anchors.length; i++) {
      var a = document.querySelector(anchors[i]);
      if (a && a.offsetParent !== null) { docked = a; break; }
    }
    if (document.getElementById('mlsAddPtLauncher')) return;
    css();
    var b = document.createElement('button');
    b.id = 'mlsAddPtLauncher';
    b.type = 'button';
    b.textContent = '➕ Add patient (per-visit)';
    b.title = 'Create a patient and build their visit history — by hand, by AI paste, or pulled from athenaOne';
    b.addEventListener('click', open);
    if (docked && docked.parentNode) {
      // inline placement next to a patients toolbar
      b.style.position = 'static';
      b.style.margin = '0 0 0 8px';
      b.style.boxShadow = 'none';
      b.style.padding = '8px 13px';
      try { docked.parentNode.insertBefore(b, docked.nextSibling); }
      catch (e) { document.body.appendChild(b); }
    } else {
      document.body.appendChild(b);   // floating fallback
    }
  }

  function start() {
    css();
    setInterval(function () { try { ensureLauncher(); } catch (e) {} }, 1100);
    try { ensureLauncher(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.__mlsAddPatient = {
    open: open,
    close: close,
    _structureWithAI: structureWithAI,
    _createOrFindPatient: createOrFindPatient,
    _findExisting: findExisting,
    _findSuggestions: findSuggestions,
    _dobKey: dobKey,
    _normName: normName,
    _nameCompatible: nameCompatible,
    _collectGuidedFrom: collectGuided,
    _listToArr: listToArr,
    _STRUCT_SYS: STRUCT_SYS,
    _pending: function () { return _pending; },
    _modalEpoch: function () { return _modalEpoch; },
    _modalStillCurrent: modalStillCurrent,
    _acceptStructuredResult: acceptStructuredResult,
    _structureAndQueue: structureAndQueue,
    _doSave: doSave
  };
})();
