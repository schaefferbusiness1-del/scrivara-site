/* =============================================================================
 * feat_mls_writeflow.js -> window.__mlsWriteFlow  (wf2-1.1.0)
 * wf2-1.1.0 (2026-07-12): WRITE-BACK SAFETY. The panel now independently
 *   re-checks the chart identity the driver reports it wrote under against the
 *   patient we intended, and REFUSES to print any success line unless a content
 *   section is BOTH written AND read-back-verified. A wrong/absent chart yields
 *   a loud "nothing was written" refusal -- never a false "WROTE". Pairs with
 *   the extension driver's target-frame identity guard (background.js) that
 *   stops a write from landing in a field that is not on this patient's chart.
 * -----------------------------------------------------------------------------
 * Owner-requested write-back UX, generic for ANY account/patient/provider:
 *
 * 1) ONE-CLICK WRITE: a "Write to Athena" button on the active-patient banner.
 *    Click -> the chart is opened in athenaOne (pull), the note is organized
 *    into sections (generate), and the EMR review-and-confirm panel opens with
 *    content sections pre-ticked (preview). The clinician reviews and presses
 *    "Insert confirmed to athenaOne" (confirm) -> identity-gated write. The
 *    safety gates are unchanged: identity verification + explicit on-screen
 *    confirm remain between the click and any write.
 *
 * 2) UNIFIED BRIDGE: the panel's write button is rewired to the v2.05
 *    mlsAppWriteV2 bridge (one top-frame shadow-aware driver). Sections:
 *      - history/exam/assessment/plan: execute (write into the matching
 *        athena field; unsigned; the driver verifies identity first)
 *      - orders/prescriptions/billing: TARGET-ONLY, always - the driver
 *        locates and reports the destination field but never touches it and
 *        never submits. (Also forced inside the extension driver itself.)
 *
 * 3) SUGGESTED ORDERS: one-click chips derived from the visit note content
 *    ("We suggest: [+ MRI lumbar spine]") - clicking adds that order line to
 *    the Orders card so it appears in the final preview. Preview only; the
 *    extension never sends orders.
 *
 * 4) COPY CLEANUP: the legacy "Orders - confirmed for your reference but never
 *    sent by MLS (athenaOne orders auto-execute; enter these in Athena
 *    yourself)." banner is removed from the review screen (behavior is
 *    unchanged - orders still are never sent; only the copy is gone).
 *
 * Additive; revert(): window.__mlsWriteFlow.revert(). ASCII-only.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsWriteFlow && window.__mlsWriteFlow.installed) return;

  var VERSION = 'wf2-1.1.0';
  var S = function (x) { return x == null ? '' : String(x); };
  var STATE = { oneClicks: 0, writes: 0, lastResp: null, suggestionsShown: 0, suggestionsAdded: 0, copyScrubbed: 0 };
  var stopped = false;

  /* ---------------------- bridge (same pattern as b111) -------------------- */
  function bridge(type, payload, respType, timeout) {
    return new Promise(function (resolve) {
      var done = false;
      function h(ev) { var d = ev && ev.data; if (!d || d.source !== 'mls-ext' || d.type !== respType) return; if (done) return; done = true; try { window.removeEventListener('message', h); } catch (e) {} resolve(d.resp || d); }
      try { window.addEventListener('message', h, false); } catch (e) {}
      try { var m = { type: type, source: 'mls-app', from: 'mls-app' }; for (var k in (payload || {})) m[k] = payload[k]; window.postMessage(m, '*'); } catch (e) {}
      setTimeout(function () { if (done) return; done = true; try { window.removeEventListener('message', h); } catch (e) {} resolve({ __timeout: true }); }, timeout || 150000);
    });
  }
  function esc(s) { return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function activePt() { try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; } catch (e) { return null; } }

  /* ---- identity helpers: MIRROR the extension driver's own matchers so the
     app's "is this the right chart?" judgment is identical to the driver's
     gate. Used to REFUSE a false "written" claim when the chart the driver
     reports it verified is NOT the patient we intended. ---------------------- */
  function nrmName(s) { return S(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function nameMatch(a, b) {
    var ta = nrmName(a).split(' ').filter(function (x) { return x.length > 1; });
    var tb = nrmName(b).split(' ').filter(function (x) { return x.length > 1; });
    if (!ta.length || !tb.length) return false;
    var o = ta.filter(function (x) { return tb.indexOf(x) >= 0; }).length;
    return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1);
  }
  function nrmDob(s) {
    var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(S(s));
    if (!m) return '';
    var pivot = (new Date().getFullYear() % 100) + 1;
    var y = m[3].length === 2 ? ((Number(m[3]) > pivot ? '19' : '20') + m[3]) : m[3];
    var mo = Number(m[1]), dy = Number(m[2]);
    if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return '';
    return mo + '/' + dy + '/' + y;
  }
  function nrmId(s) { return S(s).replace(/\D/g, ''); }

  /* -------------------- sections from the review panel --------------------- */
  /* Panel card keys (bundle organizer): history, exam, assessment, plan,
     orders, rx, referrals, pt, imaging, followup, billing. Order-class keys
     are ALWAYS sent execute:false (target-only); the extension driver forces
     this too, so no caller can widen it. */
  var ORDER_CLASS = { orders: 1, rx: 1, referrals: 1, pt: 1, imaging: 1, billing: 1 };
  var EXEC_KEYS = { history: 1, exam: 1, assessment: 1, plan: 1, followup: 1 };
  function gatherSections(panel) {
    var out = [];
    var boxes = panel.querySelectorAll('input[data-k]');
    for (var i = 0; i < boxes.length; i++) {
      var k = boxes[i].getAttribute('data-k');
      if (!boxes[i].checked) continue;
      var ta = panel.querySelector('textarea[data-t="' + k + '"]');
      var v = ta ? S(ta.value).trim() : '';
      if (!v) continue;
      out.push({ key: k, text: v, execute: !!EXEC_KEYS[k] && !ORDER_CLASS[k] });
    }
    return out;
  }

  /* --------------------------- result rendering ---------------------------- */
  function logTo(el, html) { try { el.innerHTML += '<div style="margin:3px 0">' + html + '</div>'; el.scrollTop = el.scrollHeight; } catch (e) {} }
  function bigRefusal(logEl, html) {
    try { logEl.innerHTML += '<div style="margin:6px 0;padding:8px 10px;border-radius:8px;background:rgba(220,38,38,.16);border:1px solid rgba(248,113,113,.55);color:#ffd9d9;font-weight:600">' + html + '</div>'; logEl.scrollTop = logEl.scrollHeight; } catch (e) {}
  }
  /* HONEST result rendering. The write driver returns ok:true whenever its
     identity gate PASSED and it attempted the sections -- ok:true is NOT a
     guarantee that anything landed, nor that it landed on the RIGHT chart.
     So we independently re-check the chart identity the driver reports it
     wrote under against the patient we intended, and we NEVER print a success
     line unless a content section is BOTH written AND verified (read-back). */
  function renderResp(logEl, resp, want) {
    want = want || {};
    if (!resp || resp.__timeout) { bigRefusal(logEl, '&#9888; No response from MLS Assist (timed out). Nothing was written. Is your signed-in athenaOne open in another tab?'); return; }
    if (!resp.ok) {
      bigRefusal(logEl, '&#9940; <b>Nothing was written.</b> ' + esc(resp.error || resp.reason || 'The write was refused.'));
      return;
    }
    /* ---- independent chart-identity check (must match the intended patient) -- */
    var cName = S(resp.chartName), cDob = S(resp.chartDob), cMrn = S(resp.chartMrn);
    if (!cName) {
      bigRefusal(logEl, '&#9940; <b>Nothing was written.</b> Could not confirm which chart is open in athenaOne. Open <b>' + esc(want.name || 'the patient') + '</b>&#39;s chart, then write.');
      return;
    }
    var nameOK = want.name ? nameMatch(cName, want.name) : true;
    var dobOK = want.dob ? (nrmDob(cDob) === nrmDob(want.dob)) : true;
    var idOK = (want.mrn && cMrn) ? (nrmId(cMrn) === nrmId(want.mrn)) : true;
    if (!nameOK || !dobOK || !idOK) {
      bigRefusal(logEl, '&#9940; <b>WRONG CHART OPEN &mdash; nothing was written.</b><br>athenaOne is showing <b>' + esc(cName) + '</b>' + (cDob ? ' (' + esc(cDob) + ')' : '') + (cMrn ? ' #' + esc(cMrn) : '') +
        ',<br>not <b>' + esc(want.name || '?') + '</b>' + (want.dob ? ' (' + esc(want.dob) + ')' : '') + (want.mrn ? ' #' + esc(want.mrn) : '') +
        '.<br>Open the correct patient&#39;s chart in athenaOne, then write.');
      return;
    }
    logTo(logEl, '&#10003; Chart identity confirmed: <b>' + esc(cName) + '</b>' + (cDob ? ' (' + esc(cDob) + ')' : '') + (cMrn ? ' #' + esc(cMrn) : '') + ' &mdash; writing to THIS chart only.');
    var rs = resp.results || [];
    var okN = 0, tgtN = 0, warnN = 0, execTotal = 0;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      var label = r.key.charAt(0).toUpperCase() + r.key.slice(1);
      if (r.execute) {
        execTotal++;
        if (r.written && r.verified) { okN++; logTo(logEl, '&nbsp;&nbsp;&#10003; <b>' + esc(label) + '</b> — written &amp; verified' + (r.persisted ? ' &amp; saved' : '') + ' (' + esc(r.method || '') + ').'); }
        else if (r.written) { warnN++; logTo(logEl, '&nbsp;&nbsp;&#9888; ' + esc(label) + ' — wrote but could <b>not</b> verify it landed; check in Athena before you trust it.'); }
        else { warnN++; logTo(logEl, '&nbsp;&nbsp;&#9888; ' + esc(label) + ' — ' + esc(r.error === 'target-not-on-open-chart' ? 'the field found was not on this patient’s chart' : (r.error || 'no matching field on this chart')) + ' (<b>NOT written</b>).'); }
      } else {
        if (r.found) { tgtN++; logTo(logEl, '&nbsp;&nbsp;&#127919; <b>' + esc(label) + '</b> — destination identified: ' + esc(r.fieldLabel || r.fieldTag || 'field') + '. Preview only, never sent.'); }
        else { logTo(logEl, '&nbsp;&nbsp;&#183; ' + esc(label) + ' — no destination field on this screen (preview kept here).'); }
      }
    }
    /* ---- final verdict: only ever claim success on verified content ---------- */
    if (execTotal > 0 && okN === 0) {
      bigRefusal(logEl, '&#9940; <b>Nothing was written.</b> No section could be verified as landed on this chart &mdash; do not trust any partial paste. Confirm the right chart is open and try again.');
    } else if (warnN > 0) {
      logTo(logEl, '&#9888; <b>' + okN + ' section(s) written &amp; verified</b> · ' + warnN + ' need a manual check in athenaOne. Unsigned &mdash; review and sign in Athena. MLS never clicks Save/Sign.');
    } else if (okN > 0) {
      logTo(logEl, '&#10003; <b>Done &mdash; ' + okN + ' section(s) written &amp; verified on ' + esc(cName) + '.</b> Unsigned &mdash; review and sign in athenaOne. MLS never clicks Save/Sign.');
    } else {
      logTo(logEl, 'Destination(s) identified (preview only). Nothing was written.');
    }
  }

  /* ------------------------- v2 write from the panel ------------------------ */
  function runV2(panel) {
    var logEl = panel.querySelector('#emrWbLog'); if (!logEl) return;
    var secs = gatherSections(panel);
    if (!secs.length) { logTo(logEl, 'Confirm at least one section first (tick "confirm" on the cards above).'); return; }
    var p = activePt() || {};
    var want = { name: S(p.name), dob: S(p.dob), mrn: S(p.athenaId || p.mrn || '') };
    if (!want.name) { bigRefusal(logEl, '&#9940; No active patient selected. Pick the patient first, then write.'); return; }
    STATE.writes++;
    logTo(logEl, 'Verifying <b>' + esc(want.name) + '</b> is the chart open in athenaOne before writing anything&#8230;');
    bridge('mlsAppWriteV2', { patient: want.name, dob: want.dob, athenaId: want.mrn, sections: secs }, 'mlsAppWriteV2Result', 150000)
      .then(function (resp) { STATE.lastResp = resp; renderResp(logEl, resp, want); });
  }

  /* -------------------- panel takeover + copy cleanup ----------------------- */
  var SCRUB_RE = /Orders\s*[-—]\s*confirmed for your reference but never sent by MLS/i;
  function scrubLegacyCopy(logEl) {
    try {
      var kids = logEl.querySelectorAll('div');
      for (var i = 0; i < kids.length; i++) {
        if (SCRUB_RE.test(S(kids[i].textContent))) { kids[i].remove(); STATE.copyScrubbed++; }
      }
    } catch (e) {}
  }
  function enhancePanel(panel) {
    if (panel.getAttribute('data-wf2')) return;
    var btn = panel.querySelector('#emrWbAthena');
    var logEl = panel.querySelector('#emrWbLog');
    if (!btn || !logEl) return; /* b111 enhancement not there yet - retry on next tick */
    panel.setAttribute('data-wf2', '1');
    btn.onclick = function () { runV2(panel); }; /* replace legacy per-frame path with the unified driver */
    try {
      var mo = new MutationObserver(function () { scrubLegacyCopy(logEl); });
      mo.observe(logEl, { childList: true, subtree: true });
    } catch (e) {}
    scrubLegacyCopy(logEl);
    addSuggestions(panel);
  }

  /* ------------------------- suggested orders chips ------------------------- */
  /* Generic keyword map over the note text - modality + body region. Nothing
     account- or provider-specific. Preview-only additions. */
  var MODS = [
    { re: /\bmri\b|magnetic resonance/i, label: 'MRI' },
    { re: /x-?ray|\bxr\b|radiograph/i, label: 'X-ray' },
    { re: /\bct\b|computed tomography/i, label: 'CT' },
    { re: /physical therapy|\bpt eval\b|therapy referral/i, label: 'Physical therapy referral' },
    { re: /injection|\besi\b|epidural|nerve block|\bmbb\b|\brfa\b/i, label: 'Injection procedure' },
    { re: /\blabs?\b|\bcbc\b|\bcmp\b|\ba1c\b|blood work/i, label: 'Labs' },
    { re: /\bemg\b|nerve conduction|\bncs\b/i, label: 'EMG/NCS' }
  ];
  var REGION = /(lumbar|cervical|thoracic|shoulder|knee|hip|wrist|ankle|elbow|foot|hand)(\s*spine)?/i;
  function suggestOrders(text) {
    var t = S(text);
    var out = [];
    var rg = REGION.exec(t);
    var region = rg ? rg[0].toLowerCase() : '';
    for (var i = 0; i < MODS.length && out.length < 5; i++) {
      if (MODS[i].re.test(t)) {
        var lbl = MODS[i].label;
        if (region && /MRI|X-ray|CT/.test(lbl)) lbl += ' ' + region;
        out.push(lbl);
      }
    }
    return out;
  }
  function noteText() {
    try { var n = document.getElementById('mls-note'); if (!n) return ''; return S(n.value != null ? n.value : n.textContent); } catch (e) { return ''; }
  }
  function addSuggestions(panel) {
    try {
      if (panel.querySelector('#wf2Suggest')) return;
      var ta = panel.querySelector('textarea[data-t="orders"]'); if (!ta) return;
      var src = noteText() + '\n' + (function () { var vals = []; panel.querySelectorAll('textarea[data-t]').forEach(function (t) { vals.push(t.value || ''); }); return vals.join('\n'); })();
      var sugg = suggestOrders(src);
      if (!sugg.length) return;
      var host = document.createElement('div');
      host.id = 'wf2Suggest';
      host.style.cssText = 'margin-top:6px;font:12px system-ui;color:#B9CEC2;display:flex;flex-wrap:wrap;gap:6px;align-items:center';
      host.appendChild(document.createTextNode('We suggest:'));
      sugg.forEach(function (lbl) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = '+ ' + lbl;
        chip.style.cssText = 'background:rgba(52,82,214,.25);border:1px solid rgba(143,216,190,.45);color:#dfe7ff;border-radius:999px;padding:3px 10px;font:12px system-ui;cursor:pointer';
        chip.onclick = function () {
          var cur = S(ta.value).trim();
          if (cur.toLowerCase().indexOf(lbl.toLowerCase()) >= 0) { chip.disabled = true; return; }
          ta.value = (cur ? cur + '\n' : '') + lbl;
          try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
          var cb = panel.querySelector('input[data-k="orders"]');
          if (cb && !cb.checked) { cb.checked = true; try { cb.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
          chip.disabled = true; chip.style.opacity = '.55';
          STATE.suggestionsAdded++;
        };
        host.appendChild(chip);
      });
      ta.parentElement.appendChild(host);
      STATE.suggestionsShown += sugg.length;
    } catch (e) {}
  }

  /* ----------------------------- one-click write ---------------------------- */
  function ensureNoteContent() {
    var n = document.getElementById('mls-note'); if (!n) return false;
    var cur = S(n.value != null ? n.value : n.textContent).trim();
    if (cur) return true;
    /* generate a starting draft from the patient's own record (generic) */
    var p = activePt(); if (!p) return false;
    var vs = Array.isArray(p.visits) ? p.visits : [];
    var latest = null;
    for (var i = 0; i < vs.length; i++) { if (vs[i] && (vs[i].aiSummary || vs[i].raw)) { latest = vs[i]; break; } }
    var parts = [];
    if (latest && S(latest.aiSummary).trim()) parts.push('HPI: ' + S(latest.aiSummary).trim());
    else if (latest && S(latest.raw).trim()) parts.push('HPI: ' + S(latest.raw).trim().slice(0, 600));
    if (S(p.problems).trim()) parts.push('Assessment: ' + S(p.problems).trim().split('\n').slice(0, 6).join('; '));
    if (!parts.length && S(p.summary).trim()) parts.push('HPI: ' + S(p.summary).trim().slice(0, 600));
    if (!parts.length) return false;
    var txt = parts.join('\n\n');
    if (n.value != null) { n.value = txt; try { n.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
    else n.textContent = txt;
    return true;
  }
  function oneClick() {
    var p = activePt();
    if (!p || !p.name) { try { alert('Pick a patient first.'); } catch (e) {} return; }
    STATE.oneClicks++;
    /* PULL: open the patient chart in athenaOne (background, identity-checked
       by the opener); the write's own identity gate re-verifies on the DOM. */
    try { window.postMessage({ type: 'mlsAppSearchOpenPatient', source: 'mls-app', name: S(p.name), dob: S(p.dob) }, '*'); } catch (e) {}
    /* GENERATE: make sure there is note content to organize. */
    ensureNoteContent();
    /* PREVIEW: open the review-and-confirm panel (it organizes the note into
       sections on open) and pre-tick the content sections (order-class stays
       for the clinician to tick deliberately). */
    var b = document.getElementById('emrBtn'); if (b) b.click();
    setTimeout(function () {
      var panel = document.getElementById('emrPanel'); if (!panel) return;
      enhancePanel(panel);
      var boxes = panel.querySelectorAll('input[data-k]');
      for (var i = 0; i < boxes.length; i++) {
        var k = boxes[i].getAttribute('data-k');
        if (ORDER_CLASS[k]) continue;
        var ta = panel.querySelector('textarea[data-t="' + k + '"]');
        if (ta && S(ta.value).trim() && !boxes[i].checked) { boxes[i].checked = true; try { boxes[i].dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
      }
    }, 600);
  }
  function addOneClickButton() {
    try {
      if (stopped || document.getElementById('wf2OneClick')) return;
      var sw = null;
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) { if (/^Switch patient$/i.test(S(btns[i].textContent).trim())) { sw = btns[i]; break; } }
      if (!sw || !sw.parentElement) return;
      var b = document.createElement('button');
      b.id = 'wf2OneClick';
      b.type = 'button';
      b.textContent = 'Write to Athena';
      b.title = 'One click: opens the chart, organizes the note into sections, and shows the review-and-confirm screen. Nothing is sent until you confirm.';
      b.style.cssText = 'margin-left:6px;background:#d97706;border:none;color:#fff;border-radius:10px;padding:6px 12px;font-weight:800;font-size:12.5px;cursor:pointer';
      b.onclick = oneClick;
      sw.parentElement.insertBefore(b, sw.nextSibling);
    } catch (e) {}
  }

  /* --------------------------------- boot ----------------------------------- */
  var mo = null;
  function boot() {
    addOneClickButton();
    try {
      mo = new MutationObserver(function () {
        if (stopped) return;
        addOneClickButton();
        var p = document.getElementById('emrPanel');
        if (p) enhancePanel(p);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    try { var p0 = document.getElementById('emrPanel'); if (p0) enhancePanel(p0); } catch (e) {}
  }
  function revert() {
    stopped = true;
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { var b = document.getElementById('wf2OneClick'); if (b) b.remove(); } catch (e) {}
    window.__mlsWriteFlow.installed = false;
  }

  window.__mlsWriteFlow = {
    installed: true, version: VERSION, state: STATE,
    suggestOrders: suggestOrders, oneClick: oneClick, runV2: runV2,
    revert: revert
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
