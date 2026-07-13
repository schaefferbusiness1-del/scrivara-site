/* feat_mls_wb_console.js  ->  window.__mlsWbConsole  (wbc-1.2.0)
 * --------------------------------------------------------------------------
 * MLS ASSISTANT - WRITEBACK DESTINATION CONSOLE + CHAT-DRIVEN WRITE + OPT-IN
 * SIGN-&-SAVE (Phase 2). All additive, built ON TOP of the existing gated write
 * primitives - this module introduces NO new uncontrolled way to touch athenaOne.
 *
 *  1) DESTINATION CONTROL: a "Writeback destination" settings panel where the
 *     doctor picks WHERE each kind of output is written in athenaOne (op-note
 *     tab/section/template + erase-skeleton; note/dx/cpt section labels). Persists
 *     through window.__mlsWbRouter.setTarget() (per-doctor localStorage, no PHI).
 *     Defaults untouched, so current behavior is preserved.
 *
 *  2) CHAT-DRIVEN WRITEBACK: extends the assistant command seam
 *     (window.__mlsWbRouter.parseCommand, the hook the Phase-1 self-fix wraps) so
 *     "write the op-note to athena" / "do the writeback" propose a confirm-gated
 *     write to the chosen destination, then call the existing gated writer
 *     (window.__mlsOpWb.writeOpNote / window.__mlsAthenaWriteback.writeNoteToChart).
 *
 *  3) DE-DUPE: the "Write note to Athena chart" control showed its description
 *     twice (feat_athena_writeback's .mlswb-cap caption AND feat_athena_clarity's
 *     uniform .mlsac-sub). We hide the redundant .mlswb-cap so the description
 *     shows once. Reversible (revert removes the style).
 *
 *  4) OPT-IN SIGN & SAVE (USER-INITIATED ONLY): a clearly-labelled "Sign & Save
 *     in Athena" action (button + chat command). It NEVER fires on its own - only
 *     when the doctor clicks it / confirms in chat. It (a) confirms the OPEN chart
 *     matches the active MLS patient by NAME + DOB (app-side read-only probe AND
 *     the extension's own gate), (b) writes the verified note, then (c) asks MLS
 *     Assist to click athenaOne's Sign & Save. HONEST STATUS: it reports "signed"
 *     ONLY if the extension confirms it signed. If the installed MLS Assist has no
 *     Sign & Save handler yet, it writes the verified UNSIGNED draft and says so -
 *     it never fakes a signature and never signs a chart it could not confirm.
 *
 * SAFETY: never signs autonomously; never signs/writes without a confident
 * name+DOB match; never deletes; stores only routing labels (no PHI). Additive,
 * idempotent, reversible (window.__mlsWbConsole.revert()). ASCII-only. Chains
 * safely with the Phase-1 self-fix parseCommand wrapper.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsWbConsole && window.__mlsWbConsole.installed) return; } catch (e) { return; }

  var VERSION = 'wbc-1.2.0';
  var ASSET = 'feat_mls_wb_console.js';
  var STYLE_ID = 'mlsWbcStyle';
  var DEDUPE_ID = 'mlsWbcDedupeStyle';
  var MODAL_ID = 'mlsWbcModal';

  /* ---------------- tiny utils ---------------- */
  function win(n) { try { return window[n]; } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function trim(s) { return String(s == null ? '' : s).trim(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function router() { return win('__mlsWbRouter'); }

  /* ---------------- the note/op-note text the doctor reviewed ---------------- */
  function currentNoteText() {
    var ids = ['procNoteBody', 'noteBox', 'viewBody'];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) { var v = trim(el.value != null ? el.value : el.textContent); if (v) return v; }
    }
    return '';
  }

  /* ================================================================
   *  PART 1 - the destination settings UI (modal)
   * ================================================================ */
  var TABS = ['PE', 'HPI', 'ROS', 'A/P'];

  function targetOf(kind) {
    var r = router();
    if (r && isFn(r.get)) { var t = safe(function () { return r.get(kind); }, null); if (t) return t; }
    return null;
  }

  function ensureStyle() {
    if ($(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent =
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45)}' +
      '#' + MODAL_ID + ' .wbc-card{background:#fff;color:#0f172a;width:min(620px,94vw);max-height:88vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}' +
      '#' + MODAL_ID + ' .wbc-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid #e2e8f0;position:sticky;top:0;background:#fff}' +
      '#' + MODAL_ID + ' .wbc-hd h2{margin:0;font-size:16px}' +
      '#' + MODAL_ID + ' .wbc-hd .wbc-sub{margin-top:3px;font-size:12px;color:#64748b}' +
      '#' + MODAL_ID + ' .wbc-x{cursor:pointer;border:1px solid #cbd5e1;background:#FCFBF8;border-radius:8px;padding:4px 10px;font-weight:700}' +
      '#' + MODAL_ID + ' .wbc-bd{padding:14px 18px 4px}' +
      '#' + MODAL_ID + ' .wbc-grp{border:1px solid #e2e8f0;border-radius:10px;padding:12px 12px 10px;margin:0 0 14px}' +
      '#' + MODAL_ID + ' .wbc-grp h3{margin:0 0 8px;font-size:13px;letter-spacing:.02em;text-transform:uppercase;color:#475569}' +
      '#' + MODAL_ID + ' .wbc-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}' +
      '#' + MODAL_ID + ' .wbc-row label{flex:0 0 120px;font-size:12px;color:#334155}' +
      '#' + MODAL_ID + ' .wbc-row input[type=text],#' + MODAL_ID + ' .wbc-row select{flex:1 1 200px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px}' +
      '#' + MODAL_ID + ' .wbc-chk{display:flex;align-items:center;gap:7px;font-size:12px;color:#334155;margin:8px 0 2px}' +
      '#' + MODAL_ID + ' .wbc-prev{font-size:12px;color:#0f172a;background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:8px;padding:7px 9px;margin-top:8px}' +
      '#' + MODAL_ID + ' .wbc-prev b{color:#2E6A4B}' +
      '#' + MODAL_ID + ' .wbc-note{font-size:11.5px;color:#64748b;margin-top:6px}' +
      '#' + MODAL_ID + ' .wbc-mini{cursor:pointer;font-size:11px;font-weight:600;border:1px solid #cbd5e1;background:#FCFBF8;border-radius:7px;padding:4px 9px}' +
      '#' + MODAL_ID + ' .wbc-ft{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px 16px;position:sticky;bottom:0;background:#fff;border-top:1px solid #e2e8f0}' +
      '#' + MODAL_ID + ' .wbc-done{cursor:pointer;font-weight:700;border:1px solid #2E6A4B;background:#2E6A4B;color:#fff;border-radius:9px;padding:9px 16px}' +
      '.mlswbc-launch{cursor:pointer;font-weight:600;font-size:12px;padding:7px 12px;border-radius:9px;border:1px solid #2E6A4B;background:#e0f2fe;color:#204034;margin-top:8px}' +
      '.mlswbc-sign{cursor:pointer;font-weight:700;font-size:12px;padding:8px 13px;border-radius:9px;border:1px solid #047857;background:#2E6A4B;color:#fff;margin-top:8px;margin-left:8px}' +
      '.mlswbc-signcap{display:block;font-size:11px;color:#475569;margin-top:5px;max-width:340px;line-height:1.35}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- DE-DUPE: hide feat_athena_writeback's redundant .mlswb-cap so the
     "Write note to Athena chart" description shows ONCE (clarity's .mlsac-sub). ---- */
  function ensureDedupe() {
    if ($(DEDUPE_ID)) return;
    var s = document.createElement('style'); s.id = DEDUPE_ID;
    s.textContent = '.mlswb-cap{display:none !important}';
    (document.head || document.documentElement).appendChild(s);
  }

  function field(labelTxt, inputEl) {
    var row = document.createElement('div'); row.className = 'wbc-row';
    var l = document.createElement('label'); l.textContent = labelTxt; row.appendChild(l);
    row.appendChild(inputEl); return row;
  }
  function textInput(val) { var i = document.createElement('input'); i.type = 'text'; i.value = val == null ? '' : val; return i; }

  function commitTarget(kind, patch) {
    var r = router();
    if (r && isFn(r.setTarget)) safe(function () { r.setTarget(kind, patch); });
  }
  function resetKind(kind) {
    var r = router();
    if (r && isFn(r.reset)) safe(function () { r.reset(kind); });
  }

  function buildOpnoteGroup() {
    var t = targetOf('opnote') || { tab: 'PE', sectionName: 'Procedure Documentation', template: 'Injection Generic Template', clearFirst: true };
    var grp = document.createElement('div'); grp.className = 'wbc-grp';
    var h = document.createElement('h3'); h.textContent = 'Op-notes / injection procedure notes'; grp.appendChild(h);

    var tabSel = document.createElement('select');
    TABS.forEach(function (tb) { var o = document.createElement('option'); o.value = tb; o.textContent = tb; if (String(t.tab) === tb) o.selected = true; tabSel.appendChild(o); });
    var secIn = textInput(t.sectionName || 'Procedure Documentation');
    var tplIn = textInput(t.template || '');

    grp.appendChild(field('athenaOne tab', tabSel));
    grp.appendChild(field('Section', secIn));
    grp.appendChild(field('Procedure template', tplIn));

    var chkWrap = document.createElement('label'); chkWrap.className = 'wbc-chk';
    var chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = (t.clearFirst !== false);
    chkWrap.appendChild(chk); chkWrap.appendChild(document.createTextNode('Erase the template skeleton before inserting the op-note'));
    grp.appendChild(chkWrap);

    var prev = document.createElement('div'); prev.className = 'wbc-prev'; grp.appendChild(prev);
    var note = document.createElement('div'); note.className = 'wbc-note';
    note.textContent = 'This is wired end-to-end: the op-note writeback adds this template in this section, erases the skeleton (if checked), then inserts the note. It still confirms patient name + DOB.';
    grp.appendChild(note);

    function apply() {
      commitTarget('opnote', { tab: tabSel.value, sectionName: trim(secIn.value), section: undefined, template: trim(tplIn.value), addTemplate: !!trim(tplIn.value), clearFirst: !!chk.checked });
      refreshPreview();
    }
    function refreshPreview() {
      var cur = targetOf('opnote') || {};
      prev.innerHTML = 'Op-notes go to: <b>' + esc(cur.label || (cur.tab + ' > ' + cur.sectionName)) + '</b>';
    }
    tabSel.addEventListener('change', apply);
    secIn.addEventListener('change', apply); secIn.addEventListener('blur', apply);
    tplIn.addEventListener('change', apply); tplIn.addEventListener('blur', apply);
    chk.addEventListener('change', apply);

    var rst = document.createElement('button'); rst.type = 'button'; rst.className = 'wbc-mini'; rst.textContent = 'Reset to default';
    rst.addEventListener('click', function () { resetKind('opnote'); var d = targetOf('opnote') || {}; tabSel.value = d.tab || 'PE'; secIn.value = d.sectionName || ''; tplIn.value = d.template || ''; chk.checked = (d.clearFirst !== false); refreshPreview(); });
    var rstRow = document.createElement('div'); rstRow.className = 'wbc-row'; rstRow.style.marginTop = '8px'; rstRow.appendChild(rst); grp.appendChild(rstRow);

    refreshPreview();
    return grp;
  }

  function buildSimpleGroup(kind, title, lblNoun, honest) {
    var t = targetOf(kind) || {};
    var grp = document.createElement('div'); grp.className = 'wbc-grp';
    var h = document.createElement('h3'); h.textContent = title; grp.appendChild(h);
    var secIn = textInput(t.sectionName || '');
    grp.appendChild(field(lblNoun, secIn));
    var prev = document.createElement('div'); prev.className = 'wbc-prev'; grp.appendChild(prev);
    if (honest) { var note = document.createElement('div'); note.className = 'wbc-note'; note.textContent = honest; grp.appendChild(note); }

    function apply() { commitTarget(kind, { sectionName: trim(secIn.value) }); refreshPreview(); }
    function refreshPreview() { var cur = targetOf(kind) || {}; prev.innerHTML = title + ' -> <b>' + esc(cur.label || cur.sectionName || '(default)') + '</b>'; }
    secIn.addEventListener('change', apply); secIn.addEventListener('blur', apply);

    var rst = document.createElement('button'); rst.type = 'button'; rst.className = 'wbc-mini'; rst.textContent = 'Reset to default';
    rst.addEventListener('click', function () { resetKind(kind); var d = targetOf(kind) || {}; secIn.value = d.sectionName || ''; refreshPreview(); });
    var rstRow = document.createElement('div'); rstRow.className = 'wbc-row'; rstRow.style.marginTop = '8px'; rstRow.appendChild(rst); grp.appendChild(rstRow);

    refreshPreview();
    return grp;
  }

  function open() {
    if (!router()) { try { window.alert('The writeback router is still loading - reopen this in a moment.'); } catch (e) {} return; }
    ensureStyle();
    var existing = $(MODAL_ID); if (existing) existing.parentNode.removeChild(existing);
    var docId = safe(function () { var r = router(); return r && isFn(r.doctorId) ? r.doctorId() : ''; }, '');

    var wrap = document.createElement('div'); wrap.id = MODAL_ID; wrap.setAttribute('data-mlswbc', '1');
    var card = document.createElement('div'); card.className = 'wbc-card';

    var hd = document.createElement('div'); hd.className = 'wbc-hd';
    var ht = document.createElement('div');
    var h2 = document.createElement('h2'); h2.textContent = 'Writeback destination'; ht.appendChild(h2);
    var sub = document.createElement('div'); sub.className = 'wbc-sub';
    sub.textContent = 'Choose where MLS writes each thing into athenaOne' + (docId ? ' (doctor: ' + docId + ')' : '') + '. Saved per doctor.';
    ht.appendChild(sub); hd.appendChild(ht);
    var x = document.createElement('button'); x.type = 'button'; x.className = 'wbc-x'; x.textContent = 'Close'; x.addEventListener('click', close); hd.appendChild(x);
    card.appendChild(hd);

    var bd = document.createElement('div'); bd.className = 'wbc-bd';
    bd.appendChild(buildOpnoteGroup());
    bd.appendChild(buildSimpleGroup('note', 'Clinical note', 'Section', 'The clinical-note paste is auto-routed to the matching field by MLS Assist; this label is your stated preference and is shared with the assistant.'));
    bd.appendChild(buildSimpleGroup('dx', 'Diagnoses (ICD-10)', 'Field', null));
    bd.appendChild(buildSimpleGroup('cpt', 'Billing / CPT codes', 'Field', null));
    card.appendChild(bd);

    var ft = document.createElement('div'); ft.className = 'wbc-ft';
    var hint = document.createElement('div'); hint.className = 'wbc-note'; hint.textContent = 'Changes save as you edit. You can also tell the assistant, e.g. "put injections under Physical Exam".';
    ft.appendChild(hint);
    var done = document.createElement('button'); done.type = 'button'; done.className = 'wbc-done'; done.textContent = 'Done'; done.addEventListener('click', close); ft.appendChild(done);
    card.appendChild(ft);

    wrap.appendChild(card);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    (document.body || document.documentElement).appendChild(wrap);
  }
  function close() { var m = $(MODAL_ID); if (m && m.parentNode) m.parentNode.removeChild(m); }

  /* ================================================================
   *  PART 2 - shared timeline + ping-gated bridge to MLS Assist
   * ================================================================ */
  function AA() { return win('__mlsAthenaActions'); }
  function openTL(title, brings) {
    var a = AA();
    if (a && isFn(a._openTimeline)) { safe(function () { a._openTimeline({ title: title, intent: { brings: brings, mode: 'write' } }); }); return true; }
    return false;
  }
  function step(text, state) {
    var a = AA();
    if (a && isFn(a._step)) return safe(function () { return a._step(text, state); }, null);
    var t = win('toast'); if (isFn(t)) safe(function () { t(String(text), (state === 'fail' || state === 'warn') ? 'err' : ''); });
    return null;
  }

  /* ping-gated request to MLS Assist (same protocol the writeback modules use) */
  function bridge(reqType, payload, resultType, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false, ponged = false, tries = 0, iv = null, to = null;
      function cleanup() { try { window.removeEventListener('message', onMsg); } catch (e) {} if (iv) clearInterval(iv); if (to) clearTimeout(to); }
      function finish(resp) { if (done) return; done = true; cleanup(); resolve(resp || {}); }
      function onMsg(e) {
        var d = e && e.data; if (!d || d.source !== 'mls-ext') return;
        if (d.type === 'mlsPong' && !ponged) { ponged = true; if (iv) clearInterval(iv); send(); return; }
        if (d.type === resultType) finish(d.resp || { error: 'no response' });
      }
      function send() { safe(function () { window.postMessage(Object.assign({ source: 'mls-app', type: reqType }, payload || {}), '*'); }); }
      function ping() { safe(function () { window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); }); }
      window.addEventListener('message', onMsg);
      ping();
      iv = setInterval(function () { tries++; if (ponged) { clearInterval(iv); return; } if (tries > 8) { clearInterval(iv); finish({ error: 'noext' }); } else ping(); }, 350);
      to = setTimeout(function () { finish({ error: ponged ? 'sign-unsupported' : 'timeout' }); }, timeoutMs || 45000);
    });
  }

  /* ================================================================
   *  PART 3 - OPT-IN Sign & Save (user-initiated, name+DOB gated, honest)
   * ================================================================ */
  var signRunning = false;

  function normDob(s) { var ap = win('__mlsAthenaAutoPull'); return (ap && isFn(ap.normDob)) ? safe(function () { return ap.normDob(s); }, trim(s)) : trim(s); }

  /* app-side, READ-ONLY confirmation that the open chart == active MLS patient */
  function confirmPatient() {
    var wb = win('__mlsAthenaWriteback');
    var ap = win('__mlsAthenaAutoPull');
    var mlsPt = safe(function () { return isFn(win('activePatient')) ? (win('activePatient')() || {}) : {}; }, {}) || {};
    if (!trim(mlsPt.name)) return Promise.resolve({ ok: false, reason: 'No active patient is selected in MLS.' });
    if (!wb || !isFn(wb._readChartIdentity)) return Promise.resolve({ ok: false, reason: 'The chart reader is not loaded (reload the page).' });
    return Promise.resolve(wb._readChartIdentity(function () {})).then(function (r) {
      var chartId = r && r.identity;
      if (r && r.error) return { ok: false, reason: 'Could not read the open chart (' + r.error + ').' };
      if (!chartId || !trim(chartId.name)) return { ok: false, reason: 'Could not read a clear patient name from the open chart.' };
      var nameOk = ap && isFn(ap.namesMatch) && safe(function () { return ap.namesMatch(mlsPt.name, chartId.name); }, false);
      var dobOk = ap && isFn(ap.dobsMatch) && safe(function () { return ap.dobsMatch(mlsPt.dob, chartId.dob); }, false);
      if (nameOk && dobOk) return { ok: true, mlsPt: mlsPt, chartId: chartId };
      return { ok: false, mismatch: true, reason: 'Patient does not match. MLS: ' + (mlsPt.name || '?') + (trim(mlsPt.dob) ? ' (DOB ' + normDob(mlsPt.dob) + ')' : '') + '  vs  open chart: ' + chartId.name + (trim(chartId.dob) ? ' (DOB ' + normDob(chartId.dob) + ')' : '') + '.' };
    }, function (e) { return { ok: false, reason: 'Could not verify the patient (' + (e && e.message || e) + ').' }; });
  }

  /* the verified write, then ask the extension to click athenaOne Sign & Save */
  function signSaveFlow() {
    if (signRunning) return Promise.resolve('Already running.');
    signRunning = true;
    var release = function () { signRunning = false; };
    var note = currentNoteText();
    openTL('Write + Sign & Save to Athena', 'Writes the note, then signs & saves it in athenaOne (you chose Sign & Save). Confirms patient name + DOB first.');
    if (!trim(note)) { step('No note text to write - generate or open the note first. Nothing was written or signed.', 'fail'); release(); return Promise.resolve('No note text - nothing was written or signed.'); }
    step('Confirming the open chart matches the active MLS patient (name + DOB)...', 'run');
    return confirmPatient().then(function (c) {
      if (!c.ok) {
        step((c.mismatch ? 'STOP - ' : 'STOP - ') + c.reason + ' Nothing was written or signed.', 'fail');
        release(); return 'Stopped - ' + c.reason + ' Nothing was written or signed.';
      }
      step('Patient confirmed: ' + c.chartId.name + (trim(c.chartId.dob) ? ', DOB ' + normDob(c.chartId.dob) : '') + '. Writing the verified note...', 'run');
      return bridge('mlsAppPasteNote', { note: String(note) }, 'mlsAppPasteResult', 60000).then(function (resp) {
        resp = resp || {};
        if (resp.blocked) { step('STOP - the extension patient gate blocked the write. Nothing was written or signed.', 'fail'); release(); return 'Blocked by the patient gate - nothing was written or signed.'; }
        if (resp.error === 'noext' || resp.error === 'timeout') { step('MLS Assist did not respond - nothing was written or signed.', 'fail'); release(); return 'MLS Assist did not respond - nothing was written or signed.'; }
        if (!(resp.ok && resp.confirmed)) { step('Could not confirm the note landed - nothing was signed. Check the chart before signing.', 'fail'); release(); return 'Could not confirm the write - nothing was signed.'; }
        step('Note written and verified. Asking athenaOne to Sign & Save (you chose this)...', 'run');
        return bridge('mlsAppSignSave', {}, 'mlsAppSignSaveResult', 30000).then(function (r2) {
          r2 = r2 || {};
          if (r2.ok && r2.signed) {
            step('Signed & saved in athenaOne - confirmed.', 'done');
            release(); return 'Done - the note was written, signed and saved in athenaOne (confirmed).';
          }
          var why = (r2.error === 'sign-unsupported' || r2.unhandled || /unknown|no handler|no response/i.test(String(r2.error || '')))
            ? 'your MLS Assist extension does not have the Sign & Save handler yet'
            : ('the sign step did not confirm (' + (r2.error || r2.warn || 'unknown') + ')');
          step('Wrote the verified UNSIGNED draft, but ' + why + ' - so I did NOT sign. Your draft is in the chart; review and Sign in athenaOne, or update MLS Assist to enable auto Sign & Save.', 'warn');
          release(); return 'Wrote the verified unsigned draft. I did NOT sign because ' + why + '. Nothing was signed.';
        });
      });
    }, function (e) { step('Could not verify the patient - nothing was written or signed.', 'fail'); release(); return 'Could not verify the patient - nothing was written or signed.'; });
  }

  function confirmSignDialog() {
    var mlsPt = safe(function () { return isFn(win('activePatient')) ? (win('activePatient')() || {}) : {}; }, {}) || {};
    var who = trim(mlsPt.name) || 'the active patient';
    return safe(function () {
      return window.confirm('Sign & Save in athenaOne for ' + who + '?\n\nThis will write the note AND sign & save it in the OPEN athenaOne chart (only because you clicked Sign & Save). MLS first confirms the open chart matches ' + who + ' by name + DOB, and will stop if it cannot. Continue?');
    }, false);
  }

  /* ================================================================
   *  PART 4 - launcher + sign buttons (next to the write actions)
   * ================================================================ */
  function makeLaunch() {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'mlswbc-launch'; b.setAttribute('data-mlswbc', '1');
    b.textContent = 'Writeback destination...';
    b.title = 'Choose where MLS writes the note / op-note in athenaOne';
    b.addEventListener('click', function (ev) { ev.preventDefault(); open(); });
    return b;
  }
  function makeSignBtn() {
    var wrap = document.createElement('span'); wrap.setAttribute('data-mlswbc', '1'); wrap.style.display = 'inline-block';
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'mlswbc-sign'; b.setAttribute('data-mlswbc-sign', '1');
    b.textContent = 'Sign & Save in Athena';
    b.title = 'Writes the note AND signs & saves it in athenaOne (only when you click this).';
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (signRunning) return;
      if (!confirmSignDialog()) { step('Cancelled - nothing was written or signed.', 'note'); return; }
      signSaveFlow();
    });
    wrap.appendChild(b);
    var cap = document.createElement('span'); cap.className = 'mlswbc-signcap';
    cap.textContent = 'Choosing Sign & Save writes the note and signs & saves it in athenaOne for you (after a name + DOB match). Use "Write note to Athena chart" for an unsigned draft you sign yourself.';
    wrap.appendChild(cap);
    return wrap;
  }
  function injectLaunchers() {
    safe(function () {
      var hosts = [$('emrCard'), $('procNoteCard')];
      for (var i = 0; i < hosts.length; i++) {
        var h = hosts[i];
        if (!h) continue;
        if (!h.querySelector('.mlswbc-launch')) h.appendChild(makeLaunch());
        if (!h.querySelector('[data-mlswbc-sign]')) h.appendChild(makeSignBtn());
      }
    });
  }

  /* ================================================================
   *  PART 5 - chat-driven, confirm-gated writeback + sign
   * ================================================================ */
  var pending = null; /* { kind:'opnote'|'note'|'sign', where:string } */

  function hasConfigDest(low) {
    return /(under|into|in|to|onto|on)\s+(the\s+)?(pe\b|physical exam|procedure doc|procedure documentation|assessment|plan|a\s*\/?\s*p\b|hpi\b|ros\b|diagnos|orders?\b|cpt\b|billing)/.test(low)
        || /\buse\s+(the\s+)?[\w"'().\- ]+\s+template\b/.test(low)
        || /\btemplate\s+(called|named)\b/.test(low);
  }
  function wbLabel(kind) {
    var t = targetOf(kind);
    if (t && t.label) return t.label;
    return kind === 'opnote' ? 'PE > Procedure Documentation > the procedure template' : 'the chart note field';
  }

  function proposeWrite(kind) {
    var modName = kind === 'opnote' ? '__mlsOpWb' : '__mlsAthenaWriteback';
    var mod = win(modName);
    if (!mod) return { matched: true, reply: "I can't reach the " + (kind === 'opnote' ? 'op-note' : 'note') + " writeback module right now, so I will NOT pretend to write. Reload the MLS page and try again." };
    var where = wbLabel(kind);
    var noteText = currentNoteText();
    pending = { kind: kind, where: where };
    var noun = kind === 'opnote' ? 'op-note' : 'clinical note';
    var lines = [];
    lines.push((kind === 'opnote' ? 'Op-note' : 'Clinical note') + ' writeback (UNSIGNED draft) - here is exactly what will happen:');
    lines.push('1) Destination: ' + where + '.');
    lines.push('2) I first confirm the OPEN athenaOne chart matches the active MLS patient by NAME + DOB. On any mismatch or uncertainty I REFUSE and nothing is written.');
    lines.push('3) I write the ' + noun + ' as an UNSIGNED draft. For this path I do NOT sign - you review and sign. (Say "sign and save" instead if you want me to sign & save.)');
    if (!noteText) lines.push('Heads up: I do not see generated ' + noun + ' text yet. Generate or open it first, or the write will stop with "no text to write".');
    lines.push('I report success ONLY if athenaOne reads the text back as confirmed.');
    lines.push('');
    lines.push('Reply "confirm" to proceed, or "cancel" to stop.');
    return { matched: true, reply: lines.join('\n') };
  }

  function proposeSign() {
    var noteText = currentNoteText();
    pending = { kind: 'sign', where: wbLabel('note') };
    var lines = [];
    lines.push('Sign & Save in athenaOne - here is exactly what will happen (you asked for this):');
    lines.push('1) I confirm the OPEN athenaOne chart matches the active MLS patient by NAME + DOB. On any mismatch or uncertainty I REFUSE - nothing is written or signed.');
    lines.push('2) I write the verified note into the chart.');
    lines.push('3) I then ask MLS Assist to click athenaOne\'s Sign & Save for you.');
    lines.push('Honest note: if your installed MLS Assist does not have the Sign & Save handler yet, I will write the verified UNSIGNED draft and tell you it was NOT signed - I never fake a signature.');
    if (!noteText) lines.push('Heads up: I do not see generated note text yet. Generate or open it first.');
    lines.push('');
    lines.push('Reply "confirm" to write + Sign & Save, or "cancel" to stop.');
    return { matched: true, reply: lines.join('\n') };
  }

  function doConfirm() {
    var p = pending; pending = null;
    if (!p) return null;
    if (p.kind === 'sign') {
      signSaveFlow();
      return 'Starting write + Sign & Save. Watch the status panel that just opened: I confirm name + DOB, write the verified note, then sign & save - and I only report "signed" if athenaOne confirms it. If the extension cannot sign yet, I will say so and leave a verified unsigned draft.';
    }
    var modName = p.kind === 'opnote' ? '__mlsOpWb' : '__mlsAthenaWriteback';
    var mod = win(modName);
    if (!mod) return "The writeback module isn't loaded anymore - nothing was written. Reload the page and try again.";
    var started = safe(function () {
      if (p.kind === 'opnote' && isFn(mod.writeOpNote)) { mod.writeOpNote({}); return true; }
      if (isFn(mod.writeNoteToChart)) { mod.writeNoteToChart({}); return true; }
      return false;
    }, false);
    if (!started) return "The writeback action isn't available - nothing was written.";
    return 'Starting the ' + (p.kind === 'opnote' ? 'op-note' : 'note') + ' write to ' + p.where +
      '. Watch the status panel that just opened: it runs the name + DOB patient match first and shows the verified result there. ' +
      'I only mark it written if athenaOne confirms it. This path leaves an UNSIGNED draft.';
  }

  function openedMsg() {
    var lines = ['Opened the Writeback destination settings. There you can set:'];
    lines.push('- Op-notes -> ' + wbLabel('opnote') + '.');
    lines.push('- Clinical note -> ' + wbLabel('note') + '.');
    lines.push('You can also just tell me, e.g. "put injections under Physical Exam" or "use the Lumbar ESI template".');
    return lines.join('\n');
  }

  function handleConsole(text) {
    var t = trim(text); if (!t) return null;
    var low = t.toLowerCase();

    if (pending) {
      if (/^(confirm|yes,?\s*do\s*it|do\s*it|go\s*ahead|apply|proceed|yes|write\s*it|insert\s*it|sign\s*it)\b/.test(low)) {
        return { matched: true, reply: doConfirm() };
      }
      if (/^(cancel|no|stop|abort|nevermind|never\s*mind|don'?t)\b/.test(low)) {
        pending = null; return { matched: true, reply: 'Cancelled - nothing was written or signed in athenaOne.' };
      }
      pending = null;
    }

    /* SIGN & SAVE intent (check before plain-write, since it is more specific) */
    if (/\bsign\b/.test(low) && /\b(save|sign)\b/.test(low) && /\b(athena|chart|emr|note|it|save)\b/.test(low)
        && /\b(sign\s*(and|&|\+)?\s*save|sign\s*&\s*save|sign\s+and\s+save|auto\s*sign|sign\s+the\s+note|sign\s+it)\b/.test(low)) {
      return proposeSign();
    }

    if (/(writeback|destination)s?\s*(settings|config|console|panel|page)/.test(low)
        || (/\b(configure|manage|change|edit|open|show|set up|setup)\b/.test(low) && /\bdestinations?\b/.test(low) && !hasConfigDest(low))) {
      open(); return { matched: true, reply: openedMsg() };
    }

    var wantWrite = /\b(write|insert|send|push|paste|put|do)\b/.test(low);
    if (wantWrite && !hasConfigDest(low)) {
      var isOp = /\bop[\s-]?note|operative note|procedure note|injection note\b/.test(low);
      var isNote = /\b(clinical\s+)?note\b/.test(low) || /\bwriteback\b/.test(low) || /\bwrite\s+it\b/.test(low);
      var toChart = /\b(athena|athenaone|chart|emr|encounter|now|it)\b/.test(low);
      if (isOp && (toChart || /\bwriteback\b|\bnow\b/.test(low))) return proposeWrite('opnote');
      if (isNote && (toChart || /\bdo the writeback\b|\bdo writeback\b/.test(low))) return proposeWrite('note');
    }
    return null;
  }

  /* ---------------- chain-safe wrapper of __mlsWbRouter.parseCommand ---------------- */
  var WRAPPED = null;
  function ensureWrap() {
    var wbr = router();
    if (!wbr) return false;
    if (wbr.parseCommand === WRAPPED && wbr.__mlswbcWrapped) return true;
    var prev = isFn(wbr.parseCommand) ? wbr.parseCommand.bind(wbr) : function () { return { matched: false }; };
    WRAPPED = function (text) {
      try { var r = handleConsole(text); if (r && r.matched) return r; } catch (e) { /* never break the chat */ }
      try { return prev(text); } catch (e2) { return { matched: false }; }
    };
    WRAPPED.__mlswbc = true;
    wbr.__mlswbcWrapped = true;
    wbr.__mlswbcPrev = prev;
    wbr.parseCommand = WRAPPED;
    return true;
  }
  function unwrap() {
    var wbr = router();
    if (!wbr) return;
    safe(function () {
      if (wbr.__mlswbcWrapped && isFn(wbr.__mlswbcPrev) && wbr.parseCommand === WRAPPED) {
        wbr.parseCommand = wbr.__mlswbcPrev;
      }
      try { delete wbr.__mlswbcWrapped; delete wbr.__mlswbcPrev; } catch (e) { wbr.__mlswbcWrapped = undefined; wbr.__mlswbcPrev = undefined; }
    });
    WRAPPED = null;
  }

  /* ---------------- boot / observe / revert ---------------- */
  var mo = null, retimer = null, guard = null;
  function scheduleInject() { if (retimer) return; retimer = setTimeout(function () { retimer = null; injectLaunchers(); }, 300); }
  function boot() {
    ensureStyle();
    ensureDedupe();
    injectLaunchers();
    ensureWrap();
    guard = setInterval(ensureWrap, 3000);
    try { mo = new MutationObserver(scheduleInject); mo.observe(document.body || document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  function revert() {
    try { if (mo) mo.disconnect(); } catch (e) {} mo = null;
    if (retimer) { clearTimeout(retimer); retimer = null; }
    if (guard) { clearInterval(guard); guard = null; }
    try { unwrap(); } catch (e) {}
    pending = null;
    safe(function () { close(); });
    safe(function () { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { var s = $(DEDUPE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { [].slice.call(document.querySelectorAll('.mlswbc-launch,[data-mlswbc]')).forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); }); });
    try { window.__mlsWbConsole.installed = false; } catch (e) {}
  }

  /* ---------------- public API ---------------- */
  window.__mlsWbConsole = {
    installed: true, version: VERSION, asset: ASSET,
    open: open, close: close,
    signSave: signSaveFlow,            /* user-initiated only; gated + honest */
    _handle: handleConsole,            /* exposed for diagnostics/testing (no write) */
    _confirmPatient: confirmPatient,
    _target: targetOf,
    injectLaunchers: injectLaunchers,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
