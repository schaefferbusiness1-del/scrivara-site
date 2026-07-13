/* =============================================================================
 * feat_mls_dictate_letter.js  ->  window.__mlsDictateLetter   (dl-1.0.0)
 * -----------------------------------------------------------------------------
 * TASK 15 — Dictated Letters tool (APP-SIDE ONLY, standalone / greenfield).
 *
 * A self-contained "Dictate Letter" surface: dictate (or type) a letter to a
 * Primary care doctor / Referring doctor / Attorney / Other recipient, using
 * the practice letterhead + provider signature block, and PREVIEW it as a
 * draft chart-copy, a print page, a fax cover sheet, or an email — plus copy.
 *
 * HARD SAFETY INVARIANTS (this module is designed so it CANNOT send anything):
 *   - ZERO network calls. No fetch/XHR/sendBeacon/WebSocket. No AI call.
 *   - NEVER posts to the extension (no `mls-app` postMessage / write bridge).
 *   - NO auto `mailto:`, NO auto `window.open` to a mail/fax service, NO auto
 *     `window.print()`. Every "send / fax / email / chart-copy" affordance is a
 *     rendered PREVIEW plus a clipboard Copy. The only user-initiated external
 *     handoff is an OPTIONAL "open a printable page in a new tab" that the user
 *     then prints themselves (local, never automatic, never a send).
 *   - Draft chart-copy is TEXT ONLY, labeled "not written to athenaOne".
 *   - Uses its OWN SpeechRecognition instance; never touches the app's
 *     recog/finalText/capturing/#transcript recording state.
 *
 * The letter builders (buildLetterText / buildFaxText / buildEmail /
 * buildChartCopy / salutationFor / letterheadLines) are PURE and exported so
 * every output is unit-testable with mock data.
 *
 * Additive; revert(): window.__mlsDictateLetter.revert(). ASCII-only.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsDictateLetter && window.__mlsDictateLetter.installed) return;

  var VERSION = 'dl-1.0.0';
  var S = function (x) { return x == null ? '' : String(x); };

  var RECIPIENTS = {
    pcp:       { label: 'Primary care doctor', honorific: 'Dr.', clinicalDefault: true,  medical: true },
    referring: { label: 'Referring doctor',    honorific: 'Dr.', clinicalDefault: true,  medical: true },
    attorney:  { label: 'Attorney',            honorific: '',    clinicalDefault: false, medical: false },
    other:     { label: 'Other recipient',     honorific: '',    clinicalDefault: false, medical: false }
  };

  /* ------------------------- app data (read-only) -------------------------- */
  function g(fn) { try { return (typeof window[fn] === 'function') ? (window[fn]() || '') : ''; } catch (e) { return ''; } }
  function activePt() { try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; } catch (e) { return null; } }
  function appEsc(s) {
    if (typeof window.esc === 'function') { try { return window.esc(s); } catch (e) {} }
    return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function readLetterhead() {
    return {
      practiceName: g('getPracticeName'),
      providerName: g('getName'),
      providerCred: g('getProviderCred'),
      spec: g('getSpec'),
      npi: g('getNpi'),
      clinicAddress: g('getClinicAddress'),
      clinicPhone: g('getClinicPhone'),
      logo: (function () { try { return (typeof window.effectivePremium === 'function' && window.effectivePremium() && typeof window.getClinicLogo === 'function') ? (window.getClinicLogo() || '') : ''; } catch (e) { return ''; } })()
    };
  }
  function defaultSignature(lh) {
    var sig = g('getQolSignature');
    if (S(sig).trim()) return S(sig).trim();
    var parts = [];
    if (lh.providerName) parts.push(lh.providerName + (lh.providerCred ? ', ' + lh.providerCred : ''));
    if (lh.spec) parts.push(lh.spec);
    if (lh.practiceName) parts.push(lh.practiceName);
    if (lh.npi) parts.push('NPI: ' + lh.npi);
    return parts.join('\n');
  }

  /* ------------------------------ PURE CORE -------------------------------- */
  function fmtDate(d) {
    try { return (d || new Date()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return S(d); }
  }
  function salutationFor(state) {
    var meta = RECIPIENTS[state.recipientType] || RECIPIENTS.other;
    var nm = S(state.recipientName).trim();
    if (nm) {
      var h = meta.honorific ? meta.honorific + ' ' : '';
      if (h && /^(dr\.?|doctor|prof\.?)\b/i.test(nm)) h = '';   /* don't double the title */
      return 'Dear ' + h + nm + ':';
    }
    return meta.medical ? 'Dear Colleague:' : 'To whom it may concern:';
  }
  function reLine(state) {
    if (S(state.subject).trim()) return S(state.subject).trim();
    var p = state.patient;
    if (p && S(p.name).trim()) return S(p.name).trim() + (p.dob ? ', DOB: ' + S(p.dob) : '') + (p.mrn ? ', MRN: ' + S(p.mrn) : '');
    return '';
  }
  function letterheadLines(lh) {
    var out = [];
    if (lh.practiceName) out.push(lh.practiceName);
    if (lh.clinicAddress) out.push(lh.clinicAddress);
    if (lh.clinicPhone) out.push(lh.clinicPhone);
    return out;
  }
  function clinicalBlock(state) {
    if (!state.includeClinical || !state.clinical) return '';
    var c = state.clinical, lines = [];
    if (S(c.problems).trim()) lines.push('Problems: ' + S(c.problems).trim());
    if (S(c.meds).trim()) lines.push('Medications: ' + S(c.meds).trim());
    if (S(c.allergies).trim()) lines.push('Allergies: ' + S(c.allergies).trim());
    if (S(c.summary).trim()) lines.push('Summary: ' + S(c.summary).trim());
    return lines.length ? ('Clinical summary:\n' + lines.join('\n')) : '';
  }

  /* full plain-text letter (used for copy / email body / fax body) */
  function buildLetterText(state) {
    var lh = state.letterhead || {};
    var out = [];
    var hd = letterheadLines(lh);
    if (hd.length) { out.push(hd.join('\n')); out.push(''); }
    out.push(fmtDate(state.date));
    out.push('');
    var rcpt = [];
    if (S(state.recipientName).trim()) rcpt.push(S(state.recipientName).trim());
    if (S(state.recipientOrg).trim()) rcpt.push(S(state.recipientOrg).trim());
    if (S(state.recipientAddress).trim()) rcpt.push(S(state.recipientAddress).trim());
    if (rcpt.length) { out.push(rcpt.join('\n')); out.push(''); }
    out.push(salutationFor(state));
    out.push('');
    var re = reLine(state);
    if (re) { out.push('Re: ' + re); out.push(''); }
    out.push(S(state.body).trim() || '[letter body]');
    var cb = clinicalBlock(state);
    if (cb) { out.push(''); out.push(cb); }
    out.push('');
    out.push('Sincerely,');
    out.push('');
    var sig = S(state.signature).trim();
    if (sig) out.push(sig);
    return out.join('\n');
  }

  /* email preview object (NEVER sent) */
  function buildEmail(state) {
    var re = reLine(state);
    return {
      to: S(state.recipientEmail).trim(),
      subject: S(state.subject).trim() || (re ? ('Letter re: ' + re) : 'Letter from ' + (S(state.letterhead && state.letterhead.practiceName) || 'your provider')),
      body: buildLetterText(state)
    };
  }

  /* fax cover sheet + letter (NEVER sent) */
  function buildFaxText(state) {
    var lh = state.letterhead || {};
    var out = [];
    out.push('=========== FAX COVER SHEET ===========');
    out.push('TO:    ' + (S(state.recipientName).trim() || '__________'));
    out.push('FAX:   ' + (S(state.recipientFax).trim() || '__________'));
    out.push('FROM:  ' + (S(lh.providerName).trim() || S(lh.practiceName).trim() || '__________'));
    if (S(lh.clinicPhone).trim()) out.push('PHONE: ' + S(lh.clinicPhone).trim());
    out.push('DATE:  ' + fmtDate(state.date));
    var re = reLine(state);
    if (re) out.push('RE:    ' + re);
    out.push('PAGES: 1 (including this cover)');
    out.push('');
    out.push('CONFIDENTIAL: This transmission may contain protected health');
    out.push('information. If received in error, notify the sender and destroy.');
    out.push('=======================================');
    out.push('');
    out.push(buildLetterText(state));
    return out.join('\n');
  }

  /* draft chart-copy documentation (TEXT ONLY — never written to Athena) */
  function buildChartCopy(state) {
    var re = reLine(state);
    var meta = RECIPIENTS[state.recipientType] || RECIPIENTS.other;
    var out = [];
    out.push('CORRESPONDENCE — DRAFT (not written to athenaOne)');
    out.push('Date: ' + fmtDate(state.date));
    out.push('Letter sent to: ' + meta.label + (S(state.recipientName).trim() ? ' (' + S(state.recipientName).trim() + ')' : ''));
    if (re) out.push('Re: ' + re);
    out.push('');
    out.push('Copy of letter on file:');
    out.push('');
    out.push(buildLetterText(state));
    return out.join('\n');
  }

  /* print/preview HTML for the letter (letterhead styled) */
  function buildLetterHTML(state) {
    var lh = state.letterhead || {};
    var brand = (lh.logo ? '<img src="' + appEsc(lh.logo) + '" alt="" style="max-height:46px;max-width:200px;display:block;margin-bottom:6px">' : '') +
      '<div style="font-size:19px;font-weight:700;color:#204034">' + appEsc(lh.practiceName || lh.providerName || 'Letter') + '</div>' +
      (lh.clinicAddress ? '<div style="font-size:12px;color:#5f7186">' + appEsc(lh.clinicAddress) + '</div>' : '') +
      (lh.clinicPhone ? '<div style="font-size:12px;color:#5f7186">' + appEsc(lh.clinicPhone) + '</div>' : '');
    var body = appEsc(buildLetterText(state));
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Letter' + (state.patient && state.patient.name ? ' - ' + appEsc(state.patient.name) : '') + '</title>' +
      '<style>body{font-family:"Segoe UI",Arial,sans-serif;color:#1A211C;margin:0;padding:34px 40px;font-size:13.5px;line-height:1.55}' +
      '.hd{border-bottom:2px solid #2E6A4B;padding-bottom:10px;margin-bottom:16px}pre{white-space:pre-wrap;font-family:inherit;margin:0}' +
      '@media print{body{padding:0}}</style></head><body><div class="hd">' + brand + '</div><pre>' + body + '</pre></body></html>';
  }

  /* =======================================================================
   *  DOM GLUE (browser-only; core above is pure)
   * ===================================================================== */
  var stopped = false;
  var recog = null, listening = false;
  var STATE = { opens: 0, copies: 0, previews: 0, dictations: 0, printsOpened: 0 };

  function currentState() {
    var lh = readLetterhead();
    var p = activePt();
    var pnode = document.getElementById('mlsdlPatient');
    var manualName = pnode ? S(pnode.value).trim() : '';
    var patient = null;
    if (manualName) patient = { name: manualName, dob: (p && S(p.name).trim() === manualName ? p.dob : ''), mrn: (p && S(p.name).trim() === manualName ? p.mrn : '') };
    else if (p && p.name) patient = { name: p.name, dob: p.dob, mrn: p.mrn };
    var rtype = valOf('mlsdlType') || 'pcp';
    var inc = document.getElementById('mlsdlClinical');
    var clinical = (p ? { problems: p.problems, meds: p.meds, allergies: p.allergies, summary: p.summary } : null);
    return {
      patient: patient,
      includeClinical: inc ? !!inc.checked : false,
      clinical: clinical,
      recipientType: rtype,
      recipientName: valOf('mlsdlName'),
      recipientOrg: valOf('mlsdlOrg'),
      recipientAddress: valOf('mlsdlAddr'),
      recipientFax: valOf('mlsdlFax'),
      recipientEmail: valOf('mlsdlEmail'),
      subject: valOf('mlsdlSubject'),
      body: valOf('mlsdlBody'),
      date: null,
      letterhead: lh,
      signature: defaultSignature(lh)
    };
  }
  function valOf(id) { var e = document.getElementById(id); return e ? S(e.value).trim() : ''; }

  /* ------------------------------ dictation -------------------------------- */
  function startDictation(btn, status) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { status.textContent = 'Dictation is not supported in this browser — type or paste below.'; return; }
    if (listening) { stopDictation(btn, status); return; }
    try {
      recog = new SR(); recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
      var base = valOf('mlsdlBody');
      recog.onresult = function (e) {
        var finalAdd = '', interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) finalAdd += r[0].transcript + ' '; else interim += r[0].transcript;
        }
        if (finalAdd) { base = (base ? base + ' ' : '') + finalAdd.trim(); STATE.dictations++; }
        var ta = document.getElementById('mlsdlBody');
        if (ta) ta.value = (base + (interim ? ' ' + interim : '')).trim();
      };
      recog.onerror = function (ev) {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          status.textContent = 'Microphone access was blocked. Allow mic access, or just type/paste the letter below.';
          stopDictation(btn, status);
        } else if (ev.error === 'no-speech') { /* keep going */ }
      };
      recog.onend = function () { if (listening) { try { recog.start(); } catch (e) {} } };
      recog.start();
      listening = true; btn.textContent = 'Stop dictation'; btn.style.background = '#c0392b';
      status.textContent = 'Listening... dictate the letter body. Click Stop when done.';
    } catch (e) { status.textContent = 'Could not start dictation — type or paste below.'; }
  }
  function stopDictation(btn, status) {
    listening = false;
    try { if (recog) recog.stop(); } catch (e) {}
    if (btn) { btn.textContent = 'Dictate'; btn.style.background = '#2E6A4B'; }
    if (status && /Listening/.test(status.textContent)) status.textContent = 'Dictation stopped. Edit the letter below, then preview.';
  }

  /* ------------------------------- previews -------------------------------- */
  function copyText(txt, note) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
      else { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }
      STATE.copies++;
      if (note) { note.textContent = 'Copied to clipboard.'; setTimeout(function () { try { note.textContent = ''; } catch (e) {} }, 1600); }
    } catch (e) {}
  }
  function showPreview(kind) {
    var st = currentState();
    var out = document.getElementById('mlsdlPreviewBody');
    var lbl = document.getElementById('mlsdlPreviewLabel');
    if (!out || !lbl) return;
    STATE.previews++;
    var text = '';
    if (kind === 'chart') { lbl.textContent = 'Draft chart-copy preview — NOT written to athenaOne'; text = buildChartCopy(st); }
    else if (kind === 'fax') { lbl.textContent = 'Fax preview — PREVIEW ONLY, MLS does not send faxes'; text = buildFaxText(st); }
    else if (kind === 'email') { var em = buildEmail(st); lbl.textContent = 'Email preview — PREVIEW ONLY, MLS does not send email'; text = 'To: ' + (em.to || '(recipient email)') + '\nSubject: ' + em.subject + '\n\n' + em.body; }
    else if (kind === 'print') { lbl.textContent = 'Print preview — local only; use "Open printable page" then your browser Print'; text = buildLetterText(st); }
    else { lbl.textContent = 'Letter'; text = buildLetterText(st); }
    out.value = text;
    out.setAttribute('data-kind', kind);
  }
  function openPrintable() {
    /* USER-INITIATED only. Opens a new tab with the letter; does NOT auto-print
       and does NOT send anything. The user prints it themselves. */
    try {
      var st = currentState();
      var w = window.open('', '_blank');
      if (!w) { var n = document.getElementById('mlsdlNote'); if (n) n.textContent = 'Pop-up blocked — allow pop-ups to open the printable page.'; return; }
      w.document.open(); w.document.write(buildLetterHTML(st)); w.document.close();
      STATE.printsOpened++;
      /* deliberately NO w.print() — the user invokes print manually */
    } catch (e) {}
  }

  /* -------------------------------- modal ---------------------------------- */
  function optionsHtml() {
    var o = '';
    for (var k in RECIPIENTS) { if (RECIPIENTS.hasOwnProperty(k)) o += '<option value="' + k + '">' + appEsc(RECIPIENTS[k].label) + '</option>'; }
    return o;
  }
  var IN = 'width:100%;box-sizing:border-box;background:#24332A;border:1px solid rgba(143,216,190,.28);border-radius:8px;color:#EAF1EC;padding:8px 10px;font:13px/1.4 system-ui';
  var LB = 'font:600 12px system-ui;color:#B9CEC2;display:block;margin:8px 0 3px';
  var BT = 'border:none;border-radius:9px;color:#fff;padding:8px 12px;font:700 12.5px system-ui;cursor:pointer';

  function openModal() {
    if (document.getElementById('mlsdlModal')) return;
    STATE.opens++;
    var p = activePt();
    var host = document.createElement('div');
    host.id = 'mlsdlModal';
    host.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(6,10,24,.72);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:22px';
    host.innerHTML =
      '<div style="max-width:820px;width:100%;background:#1E2B24;border:1px solid rgba(143,216,190,.3);border-radius:16px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.5);margin:0 auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px"><div style="font-size:17px;font-weight:800;color:#EAF1EC">Dictate a letter</div><button id="mlsdlClose" style="background:transparent;color:#EAF1EC;border:1px solid rgba(143,216,190,.3);border-radius:10px;padding:6px 10px;cursor:pointer">Close</button></div>' +
      '<div style="font-size:12px;color:#B9CEC2;margin-bottom:10px">Draft &amp; preview only. MLS never sends, faxes, emails, or writes to athenaOne from here.</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div><label style="' + LB + '">Patient (from the open chart; edit for a general letter)</label><input id="mlsdlPatient" style="' + IN + '" value="' + appEsc(p && p.name ? p.name : '') + '"></div>' +
      '<div><label style="' + LB + '">Recipient type</label><select id="mlsdlType" style="' + IN + '">' + optionsHtml() + '</select></div>' +
      '<div><label style="' + LB + '">Recipient name</label><input id="mlsdlName" style="' + IN + '" placeholder="e.g. Dr. Jane Smith / Attorney John Doe"></div>' +
      '<div><label style="' + LB + '">Recipient organization</label><input id="mlsdlOrg" style="' + IN + '" placeholder="Practice / firm (optional)"></div>' +
      '<div style="grid-column:1 / -1"><label style="' + LB + '">Recipient address</label><input id="mlsdlAddr" style="' + IN + '" placeholder="Mailing address (optional)"></div>' +
      '<div><label style="' + LB + '">Recipient fax</label><input id="mlsdlFax" style="' + IN + '" placeholder="For the fax preview (optional)"></div>' +
      '<div><label style="' + LB + '">Recipient email</label><input id="mlsdlEmail" style="' + IN + '" placeholder="For the email preview (optional)"></div>' +
      '<div style="grid-column:1 / -1"><label style="' + LB + '">Subject / Re</label><input id="mlsdlSubject" style="' + IN + '" placeholder="Defaults to the patient name/DOB"></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:10px 0 4px"><button id="mlsdlDictate" style="background:#2E6A4B;' + BT + '">Dictate</button><span id="mlsdlStatus" style="font:12px system-ui;color:#B9CEC2"></span></div>' +
      '<label style="' + LB + '">Letter body (dictate above, or type/edit here)</label>' +
      '<textarea id="mlsdlBody" style="' + IN + ';min-height:150px;resize:vertical" placeholder="Dictate or type the letter body..."></textarea>' +
      '<label style="font:12px system-ui;color:#B9CEC2;display:flex;gap:6px;align-items:center;margin-top:8px;cursor:pointer"><input type="checkbox" id="mlsdlClinical">Include a clinical summary (problems / meds / allergies) from the open chart</label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' +
      '<button class="mlsdlPv" data-k="chart" style="background:#1E2B24;border:1px solid rgba(143,216,190,.35);' + BT + ';color:#EAF1EE">Draft chart copy</button>' +
      '<button class="mlsdlPv" data-k="print" style="background:#1E2B24;border:1px solid rgba(143,216,190,.35);' + BT + ';color:#EAF1EE">Print preview</button>' +
      '<button class="mlsdlPv" data-k="fax" style="background:#1E2B24;border:1px solid rgba(143,216,190,.35);' + BT + ';color:#EAF1EE">Fax preview</button>' +
      '<button class="mlsdlPv" data-k="email" style="background:#1E2B24;border:1px solid rgba(143,216,190,.35);' + BT + ';color:#EAF1EE">Email preview</button>' +
      '<button id="mlsdlOpenPrint" style="background:#1E2B24;border:1px solid rgba(143,216,190,.35);' + BT + ';color:#EAF1EE">Open printable page</button>' +
      '<button id="mlsdlCopy" style="background:#2E6A4B;' + BT + '">Copy</button>' +
      '</div>' +
      '<div id="mlsdlPreviewLabel" style="font:700 12px system-ui;color:#ffcf8f;margin:12px 0 4px">Letter preview</div>' +
      '<textarea id="mlsdlPreviewBody" readonly style="' + IN + ';min-height:170px;background:#0a0f24;resize:vertical" placeholder="Pick a preview above..."></textarea>' +
      '<div id="mlsdlNote" style="font:12px system-ui;color:#8FD8BE;margin-top:6px;min-height:16px"></div>' +
      '</div>';
    document.body.appendChild(host);

    var closeBtn = host.querySelector('#mlsdlClose');
    closeBtn.onclick = function () { stopDictation(host.querySelector('#mlsdlDictate'), host.querySelector('#mlsdlStatus')); host.remove(); };
    host.addEventListener('click', function (e) { if (e.target === host) { stopDictation(host.querySelector('#mlsdlDictate'), host.querySelector('#mlsdlStatus')); host.remove(); } });
    /* default clinical toggle + resets by recipient type */
    var typeSel = host.querySelector('#mlsdlType'), clin = host.querySelector('#mlsdlClinical');
    function applyType() { var m = RECIPIENTS[typeSel.value] || RECIPIENTS.other; clin.checked = !!m.clinicalDefault; }
    applyType(); typeSel.onchange = applyType;
    host.querySelector('#mlsdlDictate').onclick = function () { startDictation(this, host.querySelector('#mlsdlStatus')); };
    var pv = host.querySelectorAll('.mlsdlPv');
    for (var i = 0; i < pv.length; i++) { pv[i].onclick = function () { showPreview(this.getAttribute('data-k')); }; }
    host.querySelector('#mlsdlOpenPrint').onclick = openPrintable;
    host.querySelector('#mlsdlCopy').onclick = function () {
      var out = host.querySelector('#mlsdlPreviewBody');
      var txt = out && out.value.trim() ? out.value : buildLetterText(currentState());
      copyText(txt, host.querySelector('#mlsdlNote'));
    };
  }

  /* ------------------------------ launcher --------------------------------- */
  function addButton() {
    if (stopped) return;
    var host = document.querySelector('#legalReqView .card h2') || document.querySelector('#legalReqView .card');
    if (!host) return;
    if (host.querySelector('#mlsdlLaunch')) return;
    var stale = document.getElementById('mlsdlLaunch'); if (stale && stale.parentNode !== host) { try { stale.parentNode.removeChild(stale); } catch (e) {} }
    var b = document.createElement('button');
    b.id = 'mlsdlLaunch';
    b.type = 'button';
    b.textContent = 'Dictate letter';
    b.title = 'Dictate a letter to a doctor, attorney, or other recipient — draft & preview only.';
    b.className = 'btn-ghost';
    b.style.cssText = 'margin-left:8px;font-size:14px;padding:9px 15px';
    b.onclick = openModal;
    host.appendChild(b);
  }

  var mo = null, iv = null;
  function boot() {
    addButton();
    try { mo = new MutationObserver(function () { if (!stopped) addButton(); }); mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    var n = 0; try { iv = setInterval(function () { addButton(); if (++n > 20 || stopped) clearInterval(iv); }, 800); } catch (e) {}
  }
  function revert() {
    stopped = true;
    try { stopDictation(null, null); } catch (e) {}
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { if (iv) clearInterval(iv); } catch (e) {}
    try { var m = document.getElementById('mlsdlModal'); if (m) m.remove(); } catch (e) {}
    try { var b = document.getElementById('mlsdlLaunch'); if (b) b.remove(); } catch (e) {}
    window.__mlsDictateLetter.installed = false;
  }

  window.__mlsDictateLetter = {
    installed: true, version: VERSION, state: STATE, RECIPIENTS: RECIPIENTS,
    /* pure, testable builders */
    salutationFor: salutationFor, reLine: reLine, letterheadLines: letterheadLines,
    clinicalBlock: clinicalBlock, buildLetterText: buildLetterText, buildEmail: buildEmail,
    buildFaxText: buildFaxText, buildChartCopy: buildChartCopy, buildLetterHTML: buildLetterHTML,
    fmtDate: fmtDate,
    /* glue (for harness) */
    openModal: openModal, currentState: currentState, showPreview: showPreview, revert: revert
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
