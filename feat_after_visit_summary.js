/* feat_after_visit_summary.js -> window.__mlsAfterVisitSummary (v1.1.1)
 *
 * AFTER-VISIT PATIENT SUMMARY (additive, self-contained, fully reversible).
 *
 * Gives the patient a clear, plain-language summary of their visit AFTER the
 * visit. The doctor generates it, REVIEWS / edits it, then copies a draft into
 * the practice's approved email system or downloads a PDF. MLS does not send it.
 *
 * SOURCE OF TRUTH (no fabrication): the summary is derived ONLY from the real
 * visit note + the patient's structured chart already in MLS (chief complaint,
 * problems, medications, allergies). The model is instructed to NEVER invent
 * clinical facts and to mark anything not documented as "not documented in this
 * visit" instead of guessing. If there is no note text to summarize, MLS says so
 * and does NOT call the model on empty content.
 *
 * REUSE (no new infrastructure):
 *   - generation : window.aiCallRaw(sys,user,getKey(),{freeform:true,family:'avs'}) -- the
 *                  existing OpenAI proxy / note-gen path. It auto-selects the
 *                  strong note model (getNoteModel(), e.g. gpt-4o).
 *   - email draft: local clipboard copy only; arbitrary-recipient network email
 *                  is held until a purpose-specific, exact-patient release path.
 *   - PDF        : jsPDF (reusing window.jspdf/loadJsPdf if present, else loaded
 *                  from the pinned same-origin 4.2.1 asset) + window.pdfSafe() + MLS_OPNOTE_LETTERHEAD -- the
 *                  same jsPDF engine the op-note PDF uses.
 *
 * SAFETY:
 *   - Read-only w.r.t. athenaOne and the chart: never Save/Sign/attest/write.
 *   - NEVER sends. The active patient is frozen when the modal opens; generation,
 *     copy, and PDF actions fail closed if the clinician switches charts.
 *   - PHI stays in the doctor's browser unless the clinician deliberately moves
 *     a reviewed draft into an approved system. Nothing is logged.
 *   - SMS/text delivery is a future option (intentionally NOT built here).
 *   - window.__mlsAfterVisitSummary.revert() removes all UI/observers/styles.
 *   - ASCII-only; every external call wrapped in try/catch; idempotent.
 */
(function () {
  'use strict';
  try { if (window.__mlsAfterVisitSummary && window.__mlsAfterVisitSummary.installed) return; } catch (e) {}

  var VERSION = '1.1.1';
  var ASSET = 'feat_after_visit_summary.js';
  var STYLE_ID = 'mlsavsStyle';
  var BTN_ID = 'mlsavsBtn';
  var MODAL_ID = 'mlsavsModal';

  // ---------------- tiny safe helpers ----------------
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function q(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
  function esc(s) {
    try { if (window.esc) return window.esc(s); } catch (e) {}
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function S(x) { return x == null ? '' : String(x); }
  /* epoch seconds/ms or ISO -> local date string (a raw 1783951892 leaked into the header before 2026-07-13) */
  function dateStr(v) {
    try {
      var d;
      if (typeof v === 'number' || /^[0-9]{9,13}$/.test(S(v))) { var n = Number(v); d = new Date(n < 1e12 ? n * 1000 : n); }
      else d = new Date(v);
      if (isNaN(d.getTime())) return S(v).slice(0, 10);
      return d.toLocaleDateString();
    } catch (e) { return S(v).slice(0, 10); }
  }

  // ---------------- patient + note gathering ----------------
  function activePatient() {
    return safe(function () {
      var id = window.getActivePtId && window.getActivePtId();
      if (!id) return null;
      var ps = (window.getPatients && window.getPatients()) || [];
      for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === id) return ps[i];
      return null;
    }, null);
  }

  function patientBinding(pt) {
    if (!pt) return '';
    var fields = ['id', 'athenaId', 'athena_id', 'patient_external_id', 'external_id', 'mrn'];
    var ids = fields.map(function (key) { return key + ':' + S(pt[key]).trim(); }).filter(function (row) { return !/:$/.test(row); });
    return ids.length ? ids.join('|') : ('fallback:' + S(pt.name).trim().toLowerCase() + '|' + S(pt.dob).trim());
  }

  function currentVisitBinding() {
    return safe(function () {
      if (typeof currentVisitAthenaBinding !== 'undefined') return currentVisitAthenaBinding || null;
      return window.currentVisitAthenaBinding || null;
    }, null);
  }

  function currentVisitEpochValue() {
    return safe(function () {
      var raw = (typeof currentVisitAthenaEpoch !== 'undefined') ? currentVisitAthenaEpoch : window.currentVisitAthenaEpoch;
      if (raw == null || raw === '') return null;
      var n = Number(raw);
      return isFinite(n) ? n : null;
    }, null);
  }

  function visitBindingIdentity(binding) {
    if (!binding) return '';
    return [
      S(binding.id || binding.visitId || binding.appointmentId).trim(),
      S(binding.patientId || (binding.patient && (binding.patient.patientId || binding.patient.id))).trim(),
      S(binding.departmentId || (binding.visitContext && binding.visitContext.departmentId)).trim()
    ].join('|');
  }

  function visitTokenStillSafe(binding, epoch) {
    if (binding) {
      if (typeof window._athenaAsyncBindingStillSafe === 'function') {
        return safe(function () {
          return window._athenaAsyncBindingStillSafe(binding, 'after-visit summary drafting', epoch) === true;
        }, false);
      }
      var current = currentVisitBinding();
      var expectedIdentity = visitBindingIdentity(binding);
      if (!current || (current !== binding && (!expectedIdentity || visitBindingIdentity(current) !== expectedIdentity))) return false;
    }
    var nowEpoch = currentVisitEpochValue();
    return epoch == null || (nowEpoch != null && Number(nowEpoch) === Number(epoch));
  }

  function ensureBoundPatient(action) {
    if (!els.pt || !els.patientBinding || patientBinding(activePatient()) !== els.patientBinding) {
      setStatus('The active patient changed. Close this summary and reopen it from the correct chart before ' + action + '.', 'err');
      return false;
    }
    return true;
  }

  // newest note that belongs to this patient and actually has text
  function latestNoteFor(pt) {
    return safe(function () {
      if (!pt) return null;
      var notes = (window.getNotes && window.getNotes()) || [];
      var mine = notes.filter(function (n) {
        if (!n) return false;
        var match = (n.patientId != null && pt.id != null && String(n.patientId) === String(pt.id)) ||
                    (n.patient && pt.name && S(n.patient).toLowerCase() === S(pt.name).toLowerCase());
        return match && S(n.text).trim().length > 0;
      });
      mine.sort(function (a, b) { return S(b.updated || b.created).localeCompare(S(a.updated || a.created)); });
      return mine[0] || null;
    }, null);
  }

  function listOrAbsent(v) {
    try {
      if (Array.isArray(v)) {
        var items = v.map(function (x) {
          if (x == null) return '';
          if (typeof x === 'string') return x;
          return S(x.name || x.label || x.text || x.title || JSON.stringify(x));
        }).filter(function (s) { return s.trim(); });
        return items.length ? items.join('; ') : '(not documented in this visit)';
      }
      var s = S(v).trim();
      return s ? s : '(not documented in this visit)';
    } catch (e) { return '(not documented in this visit)'; }
  }

  // Build the EXACT, factual source packet handed to the model. No invented data.
  function buildSource(pt, note) {
    var lines = [];
    lines.push('PATIENT FIRST NAME: ' + (firstName(pt && pt.name) || '(unknown)'));
    lines.push('VISIT DATE: ' + (note && (note.updated || note.created) ? S(note.updated || note.created).slice(0, 10) : '(not documented)'));
    lines.push('REASON FOR VISIT / CHIEF COMPLAINT: ' + listOrAbsent((note && note.cc) || (pt && pt.reason)));
    lines.push('PROBLEM LIST: ' + listOrAbsent(pt && pt.problems));
    lines.push('MEDICATIONS ON FILE: ' + listOrAbsent(pt && pt.meds));
    lines.push('ALLERGIES: ' + listOrAbsent(pt && pt.allergies));
    lines.push('');
    /* b823: the closing instruction told the model to tell the patient to
       "contact the clinic", and the packet carried NO practice name and NO phone
       number — so a patient walked out with a handout telling them to ring an
       office it could not name, while getPracticeName() and getClinicPhone() sat
       in Settings and the shared letterhead already read both.
       Labelled NON-CLINICAL and kept out of the clinical block below on purpose:
       these two facts are for the closing courtesy line only, and the model must
       never treat them as findings. When either is unset it says so in words, so
       the model has nothing to pattern-match a plausible number out of. */
    lines.push('PRACTICE NAME (non-clinical, for the closing line only): ' + (avsPracticeName() || 'NOT CONFIGURED'));
    lines.push('PRACTICE PHONE (non-clinical, for the closing line only): ' + (avsClinicPhone() || 'NOT CONFIGURED'));
    lines.push('');
    lines.push('FULL VISIT NOTE (verbatim, the ONLY clinical source for findings, plan and instructions):');
    lines.push('"""');
    lines.push(S(note && note.text).trim() || '(no visit note text available)');
    lines.push('"""');
    return lines.join('\n');
  }

  function noteIdentity(note) {
    if (!note) return '';
    return [
      S(note.id || note.noteId || note.visitId || note.appointmentId).trim(),
      S(note.version || note.revision || note.updated || note.created).trim(),
      S(note.text).trim()
    ].join('|');
  }

  function sourceFingerprint(pt, note) {
    return patientBinding(pt) + '\n' + noteIdentity(note) + '\n' + buildSource(pt, note);
  }

  /* Settings is the one source for both. Read live on every call, so a doctor who
     fills these in mid-session gets them in the next summary without a reload. */
  function avsPracticeName() {
    try { return (typeof window.getPracticeName === 'function') ? S(window.getPracticeName()).trim() : ''; } catch (e) { return ''; }
  }
  function avsClinicPhone() {
    try { return (typeof window.getClinicPhone === 'function') ? S(window.getClinicPhone()).trim() : ''; } catch (e) { return ''; }
  }

  function firstName(name) {
    var n = S(name).trim(); if (!n) return '';
    if (n.indexOf(',') > -1) { var p = n.split(',')[1]; if (p) return p.trim().split(/\s+/)[0]; }
    return n.split(/\s+/)[0];
  }

  var SYS_PROMPT = [
    'You are helping a clinician write an AFTER-VISIT SUMMARY that will be given to the PATIENT.',
    'Write in warm, plain language at about a 6th-to-8th grade reading level. Avoid heavy medical jargon;',
    'if a medical term is necessary, add a short plain-English explanation in parentheses.',
    '',
    'ABSOLUTE RULES:',
    '- Use ONLY the information in the provided visit note and structured fields below.',
    '- NEVER invent or assume diagnoses, test results, medications, doses, instructions, or follow-up that are not present in the source.',
    '- If a section has no information in the source, write a short honest line such as',
    '  "Nothing about this was documented in today\'s visit." Do NOT fill gaps with generic advice.',
    '- Do not include the doctor\'s internal/billing shorthand. Translate clinical content into patient-friendly wording.',
    '- Do not add a diagnosis the note does not state.',
    '',
    'OUTPUT FORMAT (use these exact section headers, plain text, no markdown symbols):',
    'What we did today',
    'What we found',
    'Your medications',
    'Your instructions and next steps',
    'Follow-up',
    '',
    'End with one short reassuring line telling the patient to contact the practice with any questions.',
    '- Use the PRACTICE NAME and PRACTICE PHONE from the fields above in that closing line when they',
    '  are given, so the patient knows exactly who to call and on what number.',
    '- If either says NOT CONFIGURED, simply refer to "the office" and give no number. NEVER invent,',
    '  guess or reformat a phone number, and never name a practice that was not supplied.',
    '- Those two fields are administrative. They are NOT clinical findings and must not appear anywhere',
    '  else in the summary.',
    'Keep the whole summary concise (roughly 150-350 words).'
  ].join('\n');

  function extractText(r) {
    try {
      if (r == null) return '';
      var t = r;
      if (typeof r === 'object') {
        t = r.text || r.content || r.output || r.message ||
            (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '';
      }
      t = S(t);
      // strip code fences the proxy sometimes wraps prose in
      t = t.replace(/^\s*```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '');
      return t.trim();
    } catch (e) { return ''; }
  }

  function aiAvailable() { return safe(function () { return typeof window.aiCallRaw === 'function' && (!window.hasAI || window.hasAI()); }, false); }

  function generateSummary(pt, note) {
    if (!aiAvailable()) return Promise.reject(new Error('AI is not available right now.'));
    var key = safe(function () { return (typeof window.getKey === 'function') ? window.getKey() : null; }, null);
    var src = buildSource(pt, note);
    return Promise.resolve(window.aiCallRaw(SYS_PROMPT, src, key, { freeform: true, family: 'avs' })).then(function (r) {
      var out = extractText(r);
      if (!out) throw new Error('The summary came back empty. Please try again.');
      return out;
    });
  }

  // ---------------- styles ----------------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = ce('style'); st.id = STYLE_ID;
    st.textContent = [
      '#' + BTN_ID + '{display:inline-flex;align-items:center;gap:6px;}',
      '.mlsavs-overlay{position:fixed;inset:0;z-index:2147483640;background:rgba(8,20,36,.55);display:flex;align-items:flex-start;justify-content:center;padding:28px 14px;overflow:auto;}',
      '.mlsavs-card{width:100%;max-width:680px;background:#fff;color:#13243a;border-radius:14px;box-shadow:0 18px 50px rgba(8,20,36,.35);font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;overflow:hidden;}',
      '.mlsavs-head{display:flex;align-items:center;gap:10px;padding:15px 18px;background:#204034;color:#fff;}',
      '.mlsavs-head h3{margin:0;font-size:16px;font-weight:700;flex:1;}',
      '.mlsavs-head .mlsavs-x{cursor:pointer;background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:8px;width:30px;height:30px;font-size:16px;line-height:1;}',
      '.mlsavs-body{padding:16px 18px;}',
      '.mlsavs-sub{font-size:12px;color:#41566b;margin:0 0 10px;}',
      '.mlsavs-sub b{color:#13243a;}',
      '.mlsavs-ta{width:100%;box-sizing:border-box;min-height:240px;resize:vertical;padding:11px 12px;border:1px solid #cbd6e4;border-radius:10px;font:13px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#13243a;}',
      '.mlsavs-row{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-top:12px;}',
      '.mlsavs-email{flex:1;min-width:200px;padding:9px 11px;border:1px solid #cbd6e4;border-radius:9px;font-size:13px;color:#13243a;}',
      '.mlsavs-btn{cursor:pointer;border-radius:9px;padding:9px 13px;font-size:13px;font-weight:600;border:1px solid #cbd6e4;background:#fff;color:#204034;}',
      '.mlsavs-btn:hover{background:#f3f7fc;}',
      '.mlsavs-btn.primary{background:#1e7d3a;border-color:#1e7d3a;color:#fff;}',
      '.mlsavs-btn.primary:hover{background:#19682f;}',
      '.mlsavs-btn:disabled{opacity:.5;cursor:default;}',
      '.mlsavs-btn.gen{background:#204034;border-color:#204034;color:#fff;}',
      '.mlsavs-btn.gen:hover{background:#204034;}',
      '.mlsavs-status{margin-top:12px;font-size:13px;min-height:18px;}',
      '.mlsavs-status.ok{color:#1e7d3a;font-weight:600;}',
      '.mlsavs-status.err{color:#b42318;font-weight:600;}',
      '.mlsavs-status.run{color:#41566b;}',
      '.mlsavs-note{font-size:11px;color:#41566b;margin-top:9px;line-height:1.4;}',
      '.mlsavs-spin{display:inline-block;width:13px;height:13px;border:2px solid #cbd6e4;border-top-color:#204034;border-radius:50%;animation:mlsavsSpin .7s linear infinite;vertical-align:-2px;margin-right:6px;}',
      '@keyframes mlsavsSpin{to{transform:rotate(360deg);}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ---------------- the action button (mounted in the patient header) ----------------
  function mountButton() {
    try {
      /* b742: the banner's action row is gone (owner 2026-07-27, "almost no
         buttons") and the bar's allowlist hides every child but the patient
         and Recent — so this button is now INVISIBLE. It still mounts on
         purpose: #mlsavsBtn is a published handle. mls-connect clicks it and
         otherwise toasts "After-visit summary is not available on this build",
         feat_mls_history_avs falls back to clicking it, and
         feat_athena_tooltip_dedupe resolves the assistant's "after-visit
         summary" request through it. Dropping the node would turn a rework of
         the banner into a silent loss of the feature on three other surfaces.
         The doctor-visible buttons are unchanged: History toolbar
         (#mlsHistAvsBtn) and the clinical tools row (#avsBtn). */
      var host = document.querySelector('.mlsctx-actions') || document.getElementById('mlsCtxBar');
      if (!host) return;
      if (document.getElementById(BTN_ID)) return;
      var btn = ce('button'); btn.id = BTN_ID; btn.type = 'button';
      btn.textContent = 'After-visit summary';
      btn.title = 'Generate a plain-language visit summary to review, copy, or download';
      var sw = host.querySelector('.mlsctx-switch');
      if (sw) host.insertBefore(btn, sw); else host.appendChild(btn);
      btn.addEventListener('click', function (e) { try { e.preventDefault(); } catch (x) {} openModal(); });
    } catch (e) {}
  }

  // ---------------- the review / local-export modal ----------------
  var els = {};
  var modalSerial = 0;
  var requestSerial = 0;
  function openModal() {
    var pt = activePatient();
    if (!pt) { toast('Open a patient first.'); return; }
    injectStyle();
    closeModal();
    var modalToken = ++modalSerial;
    var note = latestNoteFor(pt);

    var overlay = ce('div', 'mlsavs-overlay'); overlay.id = MODAL_ID;
    var prefillEmail = S(pt.email || pt.patientEmail || pt.contactEmail || '').trim();

    overlay.innerHTML =
      '<div class="mlsavs-card" role="dialog" aria-label="After-visit summary">' +
        '<div class="mlsavs-head"><h3>After-visit summary</h3>' +
          '<button type="button" class="mlsavs-x" id="mlsavsClose" aria-label="Close">&times;</button></div>' +
        '<div class="mlsavs-body">' +
          '<p class="mlsavs-sub">Patient: <b>' + esc(pt.name || 'Unknown') + '</b>' +
            (pt.dob ? ' &middot; DOB ' + esc(pt.dob) : '') +
            (note ? ' &middot; from the visit note dated ' + esc(dateStr(note.updated || note.created)) : '') + '</p>' +
          '<textarea class="mlsavs-ta" id="mlsavsText" placeholder="Click Generate to create a patient-friendly summary from this visit\'s note. Review and edit it before copying or downloading."></textarea>' +
          '<div class="mlsavs-row">' +
            '<button type="button" class="mlsavs-btn gen" id="mlsavsGen">Generate summary</button>' +
            '<button type="button" class="mlsavs-btn" id="mlsavsCopy">Copy</button>' +
            '<button type="button" class="mlsavs-btn" id="mlsavsPdf">Download PDF</button>' +
          '</div>' +
          '<div class="mlsavs-row">' +
            '<input type="email" class="mlsavs-email" id="mlsavsEmail" aria-label="Patient email on the selected chart (reference only)" title="Reference only; MLS does not send email" placeholder="No email on the selected chart" value="' + esc(prefillEmail) + '" readonly aria-readonly="true">' +
            '<button type="button" class="mlsavs-btn primary" id="mlsavsCopyEmail" disabled>Copy email draft</button>' +
          '</div>' +
          '<div class="mlsavs-status" id="mlsavsStatus"></div>' +
          '<div class="mlsavs-note">The summary is built only from this visit\'s note. <b>Nothing is sent from MLS.</b> Review it, then copy the draft into your approved email system or download the PDF.</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    els = {
      overlay: overlay,
      text: q('#mlsavsText', overlay),
      email: q('#mlsavsEmail', overlay),
      gen: q('#mlsavsGen', overlay),
      copy: q('#mlsavsCopy', overlay),
      pdf: q('#mlsavsPdf', overlay),
      copyEmail: q('#mlsavsCopyEmail', overlay),
      status: q('#mlsavsStatus', overlay),
      close: q('#mlsavsClose', overlay)
    };
    els.pt = pt; els.note = note; els.patientBinding = patientBinding(pt); els.modalToken = modalToken;

    els.close.addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    els.gen.addEventListener('click', onGenerate);
    els.copy.addEventListener('click', onCopy);
    els.pdf.addEventListener('click', onPdf);
    els.copyEmail.addEventListener('click', onCopyEmailDraft);
    els.text.addEventListener('input', refreshDraftState);

    if (!note) {
      setStatus('No visit note with text was found for this patient yet. Generate or open a visit note first, then come back.', 'err');
      els.gen.disabled = true;
    }
    refreshDraftState();
  }

  function closeModal() {
    modalSerial += 1;
    requestSerial += 1;
    try { var m = document.getElementById(MODAL_ID); if (m && m.parentNode) m.parentNode.removeChild(m); } catch (e) {}
    els = {};
  }

  function setStatus(msg, kind) {
    if (!els.status) return;
    els.status.className = 'mlsavs-status' + (kind ? ' ' + kind : '');
    els.status.innerHTML = (kind === 'run' ? '<span class="mlsavs-spin"></span>' : '') + esc(msg);
  }

  function refreshDraftState() {
    if (!els.copyEmail) return;
    var hasText = S(els.text && els.text.value).trim().length > 0;
    els.copyEmail.disabled = !hasText;
  }

  function onGenerate() {
    if (!els.pt) return;
    if (!ensureBoundPatient('generating')) return;
    if (!els.note) { setStatus('No visit note to summarize.', 'err'); return; }
    var binding = els.patientBinding;
    var requestToken = ++requestSerial;
    var modalToken = els.modalToken;
    var modal = els.overlay;
    var pt = els.pt;
    var note = els.note;
    var fingerprint = sourceFingerprint(pt, note);
    var visitBinding = currentVisitBinding();
    var visitEpoch = currentVisitEpochValue();
    function ownsCurrentModal() {
      return requestToken === requestSerial && els.modalToken === modalToken && els.overlay === modal;
    }
    function refuseStaleDraft() {
      if (!ownsCurrentModal()) return;
      setStatus('The patient or visit note changed while this summary was being written. Generate it again from the current visit.', 'err');
      if (els.gen) els.gen.disabled = false;
    }
    els.gen.disabled = true;
    setStatus('Writing a patient-friendly summary from this visit\'s note...', 'run');
    generateSummary(pt, note).then(function (txt) {
      if (!ownsCurrentModal()) return;
      var currentPatient = activePatient();
      var currentNote = latestNoteFor(currentPatient);
      if (!els.text || els.patientBinding !== binding || patientBinding(currentPatient) !== binding ||
          !currentNote || sourceFingerprint(currentPatient, currentNote) !== fingerprint ||
          !visitTokenStillSafe(visitBinding, visitEpoch)) {
        refuseStaleDraft();
        return;
      }
      els.text.value = txt;
      setStatus('Draft ready. Review and edit, then copy or download.', 'ok');
      els.gen.textContent = 'Regenerate';
      els.gen.disabled = false;
      refreshDraftState();
    }).catch(function (err) {
      if (!ownsCurrentModal()) return;
      setStatus('Could not generate the summary: ' + (err && err.message ? err.message : err), 'err');
      els.gen.disabled = false;
    });
  }

  function onCopy() {
    if (!ensureBoundPatient('copying')) return;
    var txt = S(els.text && els.text.value);
    if (!txt.trim()) { setStatus('Nothing to copy yet.', 'err'); return; }
    var done = function () { setStatus('Copied to clipboard.', 'ok'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { legacyCopy(txt, done); });
      } else { legacyCopy(txt, done); }
    } catch (e) { legacyCopy(txt, done); }
  }
  function legacyCopy(txt, done) {
    try {
      var ta = ce('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
    } catch (e) { setStatus('Copy failed. Select the text and copy manually.', 'err'); }
  }

  // Obtain a jsPDF constructor robustly: prefer one already loaded, then the app's
  // on-demand loader (only if it is actually callable -- some app builds leave
  // window.loadJsPdf as a non-callable value), else load the pinned local engine.
  function jsPdfCtor() { return (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || (window.jspdf && window.jspdf.default) || null; }
  function ensureJsPDF() {
    var cur = jsPdfCtor();
    if (cur) return Promise.resolve(cur);
    var viaApp = (typeof window.loadJsPdf === 'function')
      ? Promise.resolve(safe(function () { return window.loadJsPdf(); }, null))
      : Promise.resolve(null);
    return viaApp.then(function () {
      var JS = jsPdfCtor();
      if (JS) return JS;
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'vendor/jspdf.umd-4.2.1.min.js?v=e6551fcdc32f09d6';
        s.onload = function () { resolve(jsPdfCtor()); };
        s.onerror = function () { reject(new Error('Could not load the PDF engine.')); };
        (document.head || document.documentElement).appendChild(s);
      });
    });
  }

  // ---------------- PDF (reuses the op-note jsPDF engine) ----------------
  function onPdf() {
    if (!ensureBoundPatient('downloading')) return;
    var txt = S(els.text && els.text.value).trim();
    if (!txt) { setStatus('Generate a summary before downloading.', 'err'); return; }
    setStatus('Building PDF...', 'run');
    ensureJsPDF().then(function (JS) {
      if (!JS) throw new Error('PDF engine not available.');
      var clean = function (s) { try { return window.pdfSafe ? window.pdfSafe(s) : String(s); } catch (e) { return String(s); } };
      var doc = new JS({ unit: 'pt', format: 'letter' });
      var lh = (window.MLS_OPNOTE_LETTERHEAD) || {};
      var marginX = 54, y = 60, width = 612 - marginX * 2;
      // letterhead
      /* b831: the practice's own logo, drawn by the one owner
         (__mlsOpNotePro.drawLetterheadLogo) which returns the space consumed, so a
         refusal is 0 and this cursor cannot advance past a logo that was not drawn.
         This one matters: the after-visit summary is handed to the PATIENT. */
      try {
        var _pro = window.__mlsOpNotePro;
        if (_pro && typeof _pro.drawLetterheadLogo === 'function') y += _pro.drawLetterheadLogo(doc, lh.logo, marginX, y);
      } catch (eLogo) {}
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      doc.text(clean(lh.clinicName || 'After-Visit Summary'), marginX, y); y += 18;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
      (lh.addressLines || []).forEach(function (ln) { doc.text(clean(ln), marginX, y); y += 12; });
      doc.setTextColor(20); y += 10;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('After-Visit Summary', marginX, y); y += 18;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(70);
      var pt = els.pt || {};
      var meta = (pt.name ? clean(pt.name) : '') + (pt.dob ? '  (DOB ' + clean(pt.dob) + ')' : '');
      if (meta.trim()) { doc.text(meta, marginX, y); y += 14; }
      var visitDateTxt = els.note ? dateStr(els.note.updated || els.note.created) : '';
      if (visitDateTxt) { doc.text('Visit date: ' + clean(visitDateTxt), marginX, y); y += 14; }
      doc.setTextColor(20); y += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      var lines = doc.splitTextToSize(clean(txt), width);
      for (var i = 0; i < lines.length; i++) {
        if (y > 740) { doc.addPage(); y = 60; }
        doc.text(lines[i], marginX, y); y += 15;
      }
      var fn = 'After-Visit-Summary' + (pt.name ? '-' + S(pt.name).replace(/[^A-Za-z0-9]+/g, '_') : '') + '.pdf';
      doc.save(fn);
      setStatus('PDF downloaded.', 'ok');
    }).catch(function (err) {
      setStatus('Could not build the PDF: ' + (err && err.message ? err.message : err), 'err');
    });
  }

  // ---------------- local email draft (copy only; no network sender) ----------------
  function onCopyEmailDraft() {
    if (!ensureBoundPatient('copying the email draft')) return;
    var txt = S(els.text && els.text.value).trim();
    var to = S(els.email && els.email.value).trim();
    if (!txt) { setStatus('Generate a summary first.', 'err'); return; }

    var pt = els.pt || {};
    var subject = 'Your visit summary' + (S((window.MLS_OPNOTE_LETTERHEAD || {}).clinicName) ? ' from ' + S(window.MLS_OPNOTE_LETTERHEAD.clinicName) : '');
    var greeting = 'Hi ' + (firstName(pt.name) || 'there') + ',\n\nHere is a summary of your recent visit:\n\n';
    /* "contact the clinic" with no number, in an email to a patient, while
       Settings has held clinicPhone all along — the same gap already closed on
       intake.html, appointment.html and the patient portal. Name the practice and
       give the number when they are known; degrade to exactly the previous
       sentence when they are not. */
    var _lh = window.MLS_OPNOTE_LETTERHEAD || {};
    var _clinic = S(_lh.clinicName).trim();
    var _phone = '';
    try { if (typeof window.getClinicPhone === 'function') _phone = S(window.getClinicPhone()).trim(); } catch (e) { _phone = ''; }
    var _who = _clinic || 'the clinic';
    var footer = '\n\nIf you have any questions, please contact ' + _who +
      (_phone ? ' at ' + _phone : '') +
      '. This message may contain personal health information intended only for you.';
    var body = greeting + txt + footer;
    var draft = (to ? 'To: ' + to + '\n' : '') + 'Subject: ' + subject + '\n\n' + body;
    var done = function () { setStatus('Email draft copied. Review it in your approved email system before sending.', 'ok'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(draft).then(done, function () { legacyCopy(draft, done); });
      else legacyCopy(draft, done);
    } catch (e) { legacyCopy(draft, done); }
  }

  // ---------------- keep the button mounted as the app re-renders ----------------
  var _obs = null, _pollT = null, _raf = 0;
  function scheduleMount() {
    if (_raf) return;
    _raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { _raf = 0; mountButton(); });
  }
  function startObserver() {
    safe(function () { _obs = new MutationObserver(function () { scheduleMount(); }); _obs.observe(document.body, { childList: true, subtree: true }); });
    _pollT = setInterval(function () { mountButton(); }, 1500);
  }

  // ---------------- revert ----------------
  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_pollT) clearInterval(_pollT); });
    closeModal();
    safe(function () { var b = document.getElementById(BTN_ID); if (b && b.parentNode) b.parentNode.removeChild(b); });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { window.__mlsAfterVisitSummary.installed = false; });
  }

  // ---------------- boot ----------------
  function boot() { injectStyle(); mountButton(); startObserver(); }

  window.__mlsAfterVisitSummary = {
    installed: true, version: VERSION, asset: ASSET,
    open: openModal, generate: generateSummary, buildSource: buildSource,
    _activePatient: activePatient, _latestNoteFor: latestNoteFor,
    _sourceFingerprint: sourceFingerprint, revert: revert
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } catch (e) { try { boot(); } catch (e2) {} }
})();
