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

  /* ---------- create-or-find a patient by name+DOB (no duplicate) ---------- */
  function findExisting(name, dob) {
    var mod = M();
    var nn = trim(name).toLowerCase();
    var nd = mod ? mod._normDob(dob) : trim(dob);
    if (!nn) return null;
    return getPatients().find(function (p) {
      if (!p) return false;
      var pn = trim(p.name).toLowerCase();
      var pd = mod ? mod._normDob(p.dob) : trim(p.dob);
      if (pn !== nn) return false;
      if (nd && pd) return nd === pd;     // both DOBs present -> must match
      return true;                         // name match, DOB unknown on a side
    }) || null;
  }
  function createOrFindPatient(details) {
    var existing = findExisting(details.name, details.dob);
    if (existing) {
      // fill in any newly provided demographics without clobbering
      if (!trim(existing.dob) && trim(details.dob)) existing.dob = trim(details.dob);
      if (!trim(existing.mrn) && trim(details.mrn)) existing.mrn = trim(details.mrn);
      if (!trim(existing.sex) && trim(details.sex)) existing.sex = trim(details.sex);
      if (!trim(existing.phone) && trim(details.phone)) existing.phone = trim(details.phone);
      if (!Array.isArray(existing.visits)) existing.visits = [];
      upsertPatient(existing);
      return { patient: existing, created: false };
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

  function listToArr(s) { return S(s).split(/[\n,;]+/).map(trim).filter(Boolean); }

  function css() {
    if (document.getElementById('mlsAddPtCss')) return;
    var st = document.createElement('style'); st.id = 'mlsAddPtCss';
    st.textContent =
      '#mlsAddPtLauncher{position:fixed;right:18px;bottom:18px;z-index:99990;cursor:pointer;border:0;border-radius:999px;' +
        'padding:11px 16px;font-size:13px;font-weight:800;color:#fff;background:linear-gradient(135deg,#2E6A4B,#2E6A4B);' +
        'box-shadow:0 6px 18px rgba(30,41,80,.28)}' +
      '#mlsAddPtLauncher:hover{filter:brightness(1.07)}' +
      '#mlsAddPtOv{position:fixed;inset:0;z-index:99991;background:rgba(15,23,42,.46);display:flex;align-items:flex-start;' +
        'justify-content:center;padding:28px 14px;overflow:auto}' +
      '#mlsAddPtModal{width:min(720px,96vw);background:var(--card,#fff);color:inherit;border-radius:16px;box-shadow:0 24px 64px rgba(2,6,23,.4);overflow:hidden}' +
      '#mlsAddPtModal .ap-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line,#e8edf4)}' +
      '#mlsAddPtModal .ap-hd h3{margin:0;font-size:16px;font-weight:800;display:flex;gap:8px;align-items:center}' +
      '#mlsAddPtModal .ap-x{cursor:pointer;border:0;background:transparent;font-size:20px;line-height:1;color:inherit;opacity:.6}' +
      '#mlsAddPtModal .ap-x:hover{opacity:1}' +
      '#mlsAddPtModal .ap-bd{padding:16px 18px;max-height:74vh;overflow:auto}' +
      '#mlsAddPtModal .ap-sec{margin:0 0 16px}' +
      '#mlsAddPtModal .ap-lab{display:block;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;opacity:.62;margin:0 0 4px}' +
      '#mlsAddPtModal .ap-row{display:flex;gap:10px;flex-wrap:wrap}' +
      '#mlsAddPtModal .ap-row>div{flex:1;min-width:150px}' +
      '#mlsAddPtModal input,#mlsAddPtModal textarea,#mlsAddPtModal select{width:100%;box-sizing:border-box;border:1px solid var(--line,#cdd6e3);' +
        'border-radius:9px;padding:8px 10px;font-size:13px;font-family:inherit;background:var(--bg,#fff);color:inherit}' +
      '#mlsAddPtModal textarea{min-height:74px;resize:vertical}' +
      '#mlsAddPtModal .ap-modes{display:flex;gap:8px;margin:0 0 10px}' +
      '#mlsAddPtModal .ap-mode{flex:1;cursor:pointer;text-align:center;border:1px solid var(--line,#cdd6e3);border-radius:10px;padding:9px;font-size:12.5px;font-weight:700;background:var(--bg2,#f6f9fc)}' +
      '#mlsAddPtModal .ap-mode.on{border-color:#2E6A4B;background:#eef2ff;color:#204034}' +
      '#mlsAddPtModal .ap-card{border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:13px;background:var(--bg2,#FCFBF8)}' +
      '#mlsAddPtModal .ap-pending{margin:10px 0 0}' +
      '#mlsAddPtModal .ap-pv{display:flex;align-items:center;gap:10px;border:1px solid var(--line,#e2e8f0);border-radius:9px;padding:7px 10px;margin:0 0 6px;background:var(--card,#fff);font-size:12.5px}' +
      '#mlsAddPtModal .ap-pv b{min-width:92px}' +
      '#mlsAddPtModal .ap-pv .ap-pv-t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85}' +
      '#mlsAddPtModal .ap-pv .ap-del{cursor:pointer;border:0;background:transparent;color:#b91c1c;font-weight:800}' +
      '#mlsAddPtModal .ap-pill{font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 7px;background:#e8f5e9;color:#2e7d32}' +
      '#mlsAddPtModal .ap-ft{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 18px;border-top:1px solid var(--line,#e8edf4)}' +
      '#mlsAddPtModal .ap-btn{cursor:pointer;border:0;border-radius:10px;padding:9px 15px;font-size:13px;font-weight:800;color:#fff;background:linear-gradient(135deg,#2E6A4B,#7A5CC0)}' +
      '#mlsAddPtModal .ap-btn.sec{background:var(--bg2,#F4F2EC);color:inherit;border:1px solid var(--line,#cdd6e3)}' +
      '#mlsAddPtModal .ap-btn.ath{background:linear-gradient(135deg,#2E6A4B,#2E6A4B)}' +
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

    // mode switching
    var mode = 'guided';
    function renderMode() {
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
          structureWithAI(t).then(function (v) {
            v._ai = true;
            _pending.push(v); refreshPending(modal);
            modal.querySelector('#appText').value = '';
            stEl.textContent = v._aiParseFailed ? 'Added (kept raw text — codes auto-detected).' : 'Structured & added.';
            btn.disabled = false;
          }, function (err) { stEl.textContent = 'AI failed (' + (err && err.message || 'error') + ').'; btn.disabled = false; });
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
    var closeFn = function () { close(); };
    modal.querySelector('#apClose').addEventListener('click', closeFn);
    modal.querySelector('#apCancel').addEventListener('click', closeFn);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    return ov;
  }

  function setStatus(modal, msg) { var el = modal.querySelector('#apStatus'); if (el) el.textContent = msg || ''; }

  /* ---------- SAVE (manual + AI visits) into the §40 model ---------- */
  function doSave(modal, details) {
    if (!trim(details.name)) { setStatus(modal, 'Enter the patient name first.'); return; }
    var mod = M();
    if (!mod) { setStatus(modal, 'Visit model not ready — reload the page.'); return; }
    if (!_pending.length) { setStatus(modal, 'Add at least one visit, or use “Pull from athenaOne”.'); return; }
    var btn = modal.querySelector('#apSave'); btn.disabled = true;
    setStatus(modal, 'Saving patient…');
    var res = createOrFindPatient(details);
    var p = res.patient;
    var saved = 0;
    _pending.forEach(function (v) {
      var src = v._ai ? 'manual-ai' : 'manual';
      var stored = mod.addVisit(p.id, v, { source: src });
      if (stored) saved++;
    });
    setStatus(modal, 'Saved ' + saved + ' visit' + (saved === 1 ? '' : 's') + '. Generating AI summaries…');
    mod.ensureSummaries(p.id, function (m) { setStatus(modal, m); }).then(function () {
      _pending = [];
      selectPatient(p.id);
      setStatus(modal, '✓ Saved ' + (res.created ? 'new patient' : 'patient') + ' “' + p.name + '” with ' + mod.getVisits(p).length + ' visit(s).');
      setTimeout(close, 900);
    }, function () {
      _pending = [];
      selectPatient(p.id);
      setStatus(modal, '✓ Saved “' + p.name + '” (summaries can be generated from the profile).');
      setTimeout(close, 1100);
    });
  }

  /* ---------- ATHENA pull from the same UI (reuse §40 copy-every-visit) ---------- */
  function doAthena(modal, details) {
    if (!trim(details.name)) { setStatus(modal, 'Enter the patient name (and DOB) first — the Athena pull verifies name + DOB.'); return; }
    if (!window.__mlsCopyVisits || !isFn(window.__mlsCopyVisits.run)) {
      setStatus(modal, 'Copy-every-visit module not loaded. Save manually, then use “📋 Copy every visit” on the profile.');
      return;
    }
    var btn = modal.querySelector('#apAthena'); btn.disabled = true;
    setStatus(modal, 'Preparing patient…');
    var res = createOrFindPatient(details);
    var p = res.patient;
    // queue any manually-entered visits first so nothing is lost
    var mod = M();
    if (mod && _pending.length) {
      _pending.forEach(function (v) { mod.addVisit(p.id, v, { source: v._ai ? 'manual-ai' : 'manual' }); });
      _pending = [];
    }
    selectPatient(p.id);   // copy-every-visit operates on the ACTIVE patient
    setStatus(modal, 'Open ' + esc(p.name) + '’s chart in athenaOne — pulling every visit (read-only)…');
    // run the proven §40 flow; it verifies name+DOB against the open Athena chart
    window.__mlsCopyVisits.run(function (m) { setStatus(modal, m); }).then(function () {
      setStatus(modal, '✓ Athena pull complete — see the Visit history on the profile.');
      setTimeout(close, 1200);
    }, function (err) {
      setStatus(modal, '⚠ ' + (err && err.message || 'Athena pull failed.') + ' (Any manual visits were saved.)');
      btn.disabled = false;
    });
  }

  function close() {
    var ov = document.getElementById('mlsAddPtOv'); if (ov) ov.remove();
  }
  function open() {
    if (document.getElementById('mlsAddPtOv')) return;
    _pending = [];
    buildModal();
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
    _collectGuidedFrom: collectGuided,
    _listToArr: listToArr,
    _STRUCT_SYS: STRUCT_SYS,
    _pending: function () { return _pending; }
  };
})();
