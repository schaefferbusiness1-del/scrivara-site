/* feat_after_visit_summary.js -> window.__mlsAfterVisitSummary (v1.0.0)
 *
 * AFTER-VISIT PATIENT SUMMARY (additive, self-contained, fully reversible).
 *
 * Gives the patient a clear, plain-language summary of their visit AFTER the
 * visit. The doctor generates it, REVIEWS / edits it, then explicitly clicks
 * "Send to patient". Nothing is ever auto-sent.
 *
 * SOURCE OF TRUTH (no fabrication): the summary is derived ONLY from the real
 * visit note + the patient's structured chart already in MLS (chief complaint,
 * problems, medications, allergies). The model is instructed to NEVER invent
 * clinical facts and to mark anything not documented as "not documented in this
 * visit" instead of guessing. If there is no note text to summarize, MLS says so
 * and does NOT call the model on empty content.
 *
 * REUSE (no new infrastructure):
 *   - generation : window.aiCallRaw(sys,user,getKey(),{freeform:true}) -- the
 *                  existing OpenAI proxy / note-gen path. It auto-selects the
 *                  strong note model (getNoteModel(), e.g. gpt-4o).
 *   - email send : POST bkBase()+'/api/copilot/email' {to,subject,body} with the
 *                  app's Bearer auth (bkToken()) -- the SAME backend Resend
 *                  transactional path the app's copilot email uses.
 *   - PDF        : jsPDF (reusing window.jspdf/loadJsPdf if present, else loaded
 *                  from CDN) + window.pdfSafe() + MLS_OPNOTE_LETTERHEAD -- the
 *                  same jsPDF engine the op-note PDF uses.
 *
 * SAFETY:
 *   - Read-only w.r.t. athenaOne and the chart: never Save/Sign/attest/write.
 *   - NEVER auto-sends. Send requires an explicit click + a confirm dialog, and
 *     is disabled until a valid patient email + a non-empty summary are present.
 *   - PHI stays in the doctor's browser + the chosen patient email only; nothing
 *     is logged. Honest success/failure messaging.
 *   - SMS/text delivery is a future option (intentionally NOT built here).
 *   - window.__mlsAfterVisitSummary.revert() removes all UI/observers/styles.
 *   - ASCII-only; every external call wrapped in try/catch; idempotent.
 */
(function () {
  'use strict';
  try { if (window.__mlsAfterVisitSummary && window.__mlsAfterVisitSummary.installed) return; } catch (e) {}

  var VERSION = '1.0.0';
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
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(S(s).trim()); }

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
    lines.push('FULL VISIT NOTE (verbatim, the ONLY clinical source for findings, plan and instructions):');
    lines.push('"""');
    lines.push(S(note && note.text).trim() || '(no visit note text available)');
    lines.push('"""');
    return lines.join('\n');
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
    'End with one short reassuring line telling the patient to contact the clinic with any questions.',
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
    return Promise.resolve(window.aiCallRaw(SYS_PROMPT, src, key, { freeform: true })).then(function (r) {
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
      var host = document.querySelector('.mlsctx-actions');
      if (!host) return;
      if (document.getElementById(BTN_ID)) return;
      var btn = ce('button'); btn.id = BTN_ID; btn.type = 'button';
      btn.textContent = 'After-visit summary';
      btn.title = 'Generate a plain-language visit summary for the patient (you review before sending)';
      var sw = host.querySelector('.mlsctx-switch');
      if (sw) host.insertBefore(btn, sw); else host.appendChild(btn);
      btn.addEventListener('click', function (e) { try { e.preventDefault(); } catch (x) {} openModal(); });
    } catch (e) {}
  }

  // ---------------- the review / send modal ----------------
  var els = {};
  function openModal() {
    var pt = activePatient();
    if (!pt) { toast('Open a patient first.'); return; }
    injectStyle();
    closeModal();
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
            (note ? ' &middot; from the visit note dated ' + esc(S(note.updated || note.created).slice(0, 10)) : '') + '</p>' +
          '<textarea class="mlsavs-ta" id="mlsavsText" placeholder="Click Generate to create a patient-friendly summary from this visit\'s note. You can edit it before sending."></textarea>' +
          '<div class="mlsavs-row">' +
            '<button type="button" class="mlsavs-btn gen" id="mlsavsGen">Generate summary</button>' +
            '<button type="button" class="mlsavs-btn" id="mlsavsCopy">Copy</button>' +
            '<button type="button" class="mlsavs-btn" id="mlsavsPdf">Download PDF</button>' +
          '</div>' +
          '<div class="mlsavs-row">' +
            '<input type="email" class="mlsavs-email" id="mlsavsEmail" placeholder="Patient email (required to send)" value="' + esc(prefillEmail) + '">' +
            '<button type="button" class="mlsavs-btn primary" id="mlsavsSend" disabled>Send to patient</button>' +
          '</div>' +
          '<div class="mlsavs-status" id="mlsavsStatus"></div>' +
          '<div class="mlsavs-note">The summary is built only from this visit\'s note &mdash; it is never auto-sent. Review and edit it, then click <b>Send to patient</b>. Text/SMS delivery is planned for a future update.</div>' +
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
      send: q('#mlsavsSend', overlay),
      status: q('#mlsavsStatus', overlay),
      close: q('#mlsavsClose', overlay)
    };
    els.pt = pt; els.note = note;

    els.close.addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    els.gen.addEventListener('click', onGenerate);
    els.copy.addEventListener('click', onCopy);
    els.pdf.addEventListener('click', onPdf);
    els.send.addEventListener('click', onSend);
    els.text.addEventListener('input', refreshSendState);
    els.email.addEventListener('input', refreshSendState);

    if (!note) {
      setStatus('No visit note with text was found for this patient yet. Generate or open a visit note first, then come back.', 'err');
      els.gen.disabled = true;
    }
    refreshSendState();
  }

  function closeModal() {
    try { var m = document.getElementById(MODAL_ID); if (m && m.parentNode) m.parentNode.removeChild(m); } catch (e) {}
    els = {};
  }

  function setStatus(msg, kind) {
    if (!els.status) return;
    els.status.className = 'mlsavs-status' + (kind ? ' ' + kind : '');
    els.status.innerHTML = (kind === 'run' ? '<span class="mlsavs-spin"></span>' : '') + esc(msg);
  }

  function refreshSendState() {
    if (!els.send) return;
    var hasText = S(els.text && els.text.value).trim().length > 0;
    var okEmail = isEmail(els.email && els.email.value);
    els.send.disabled = !(hasText && okEmail);
    if (els.send.disabled && hasText && !okEmail) {
      // only nudge about email if there is content ready to send
      if (!els.status.textContent || els.status.className.indexOf('err') === -1) setStatus('Add a valid patient email to enable sending.', 'run');
    }
  }

  function onGenerate() {
    if (!els.pt) return;
    if (!els.note) { setStatus('No visit note to summarize.', 'err'); return; }
    els.gen.disabled = true;
    setStatus('Writing a patient-friendly summary from this visit\'s note...', 'run');
    generateSummary(els.pt, els.note).then(function (txt) {
      if (!els.text) return;
      els.text.value = txt;
      setStatus('Draft ready. Review and edit, then send or download.', 'ok');
      els.gen.textContent = 'Regenerate';
      els.gen.disabled = false;
      refreshSendState();
    }).catch(function (err) {
      setStatus('Could not generate the summary: ' + (err && err.message ? err.message : err), 'err');
      els.gen.disabled = false;
    });
  }

  function onCopy() {
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
  // window.loadJsPdf as a non-callable value), else load jsPDF from CDN (same engine).
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
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = function () { resolve(jsPdfCtor()); };
        s.onerror = function () { reject(new Error('Could not load the PDF engine.')); };
        (document.head || document.documentElement).appendChild(s);
      });
    });
  }

  // ---------------- PDF (reuses the op-note jsPDF engine) ----------------
  function onPdf() {
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
      var dateStr = els.note ? S(els.note.updated || els.note.created).slice(0, 10) : '';
      if (dateStr) { doc.text('Visit date: ' + clean(dateStr), marginX, y); y += 14; }
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

  // ---------------- send (reuses backend Resend path; doctor-confirmed only) ----------------
  function onSend() {
    var txt = S(els.text && els.text.value).trim();
    var to = S(els.email && els.email.value).trim();
    if (!txt) { setStatus('Generate a summary first.', 'err'); return; }
    if (!isEmail(to)) { setStatus('Enter a valid patient email first.', 'err'); return; }

    // explicit doctor confirmation -- this contains the patient's health info
    var ok = false;
    try { ok = window.confirm('Send this after-visit summary to ' + to + '?\n\nThis email contains the patient\'s health information. It will be sent now.'); } catch (e) { ok = false; }
    if (!ok) { setStatus('Send cancelled.', 'run'); return; }

    els.send.disabled = true;
    setStatus('Sending to ' + to + '...', 'run');

    var pt = els.pt || {};
    var subject = 'Your visit summary' + (S((window.MLS_OPNOTE_LETTERHEAD || {}).clinicName) ? ' from ' + S(window.MLS_OPNOTE_LETTERHEAD.clinicName) : '');
    var greeting = 'Hi ' + (firstName(pt.name) || 'there') + ',\n\nHere is a summary of your recent visit:\n\n';
    var footer = '\n\nIf you have any questions, please contact the clinic. This message may contain personal health information intended only for you.';
    var body = greeting + txt + footer;

    sendViaBackend(to, subject, body).then(function () {
      setStatus('✓ Summary sent to ' + to, 'ok');
    }).catch(function (err) {
      els.send.disabled = false;
      setStatus('Send failed: ' + (err && err.message ? err.message : err) + '. You can Copy or Download PDF instead.', 'err');
    });
  }

  // POST to the existing transactional email endpoint (Resend-backed), using the
  // SAME backend base + bearer auth the app's own copilot email uses:
  //   fetch(bkBase() + '/api/copilot/email', { headers:{ Authorization:'Bearer '+bkToken() }})
  function sendViaBackend(to, subject, body) {
    var base = '';
    try { if (typeof window.bkBase === 'function') base = window.bkBase() || ''; } catch (e) { base = ''; }
    var headers = { 'Content-Type': 'application/json' };
    try { if (typeof window.bkToken === 'function') { var tk = window.bkToken(); if (tk) headers.Authorization = 'Bearer ' + tk; } } catch (e) {}
    return fetch(base + '/api/copilot/email', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ to: to, subject: subject, body: body })
    }).then(function (res) {
      return res.text().then(function (t) {
        var data = {}; try { data = t ? JSON.parse(t) : {}; } catch (e) {}
        if (!res.ok || data.ok === false || data.error) {
          throw new Error((data && (data.error || data.message)) || ('server returned ' + res.status));
        }
        return data;
      });
    });
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
    _activePatient: activePatient, _latestNoteFor: latestNoteFor, revert: revert
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } catch (e) { try { boot(); } catch (e2) {} }
})();
