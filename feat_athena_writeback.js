/* feat_athena_writeback.js  ->  window.__mlsAthenaWriteback  (v1.0.0)
 * --------------------------------------------------------------------------
 * WRITE-BACK at visit completion: take the finished/reviewed note and WRITE it
 * into the OPEN athenaOne chart's note field via the EXISTING extension paste
 * path (mlsAppPasteNote -> mlsAppPasteResult, frame-aware + verified typing).
 *
 * HARD SAFETY RAILS (enforced here):
 *   - This NEVER clicks Save / Sign / attest / final-submit / any chart button.
 *     The only message it sends to the extension is a handshake ping and
 *     mlsAppPasteNote (a verified paste into the note field). The extension's
 *     paste handler itself "Never clicks Save/Sign".  The doctor signs.
 *   - WRONG-PATIENT GUARD (app-side, Decision A): before sending the paste it
 *     reads the OPEN chart's identity READ-ONLY (cv._driveRequest, no save) and
 *     requires a CONFIDENT name + DOB match (namesMatch + dobsMatch) against the
 *     MLS active patient. On any mismatch OR uncertainty it REFUSES to write and
 *     offers an explicit "I confirmed this patient" manual override.
 *   - Destination is VERIFIED: success is reported only when the extension
 *     returns resp.ok && resp.confirmed (it re-read the field). Never fabricates
 *     a "written" confirmation.
 *
 * Routes the live status + WRITE badge + destination-verify + adaptive recovery
 * through the §61 shared module (window.__mlsAthenaActions: _openTimeline/_step
 * + the .mlsaa-tl panel's native .mlsaa-done / .mlsaa-fix result rows).
 *
 * Self-contained, idempotent, reversible (window.__mlsAthenaWriteback.revert()).
 * Wraps NO existing function (button injection via a debounced MutationObserver),
 * so it cannot recurse with or break any other module. All work in try/catch.
 */
(function () {
  'use strict';
  try {
    if (window.__mlsAthenaWriteback && window.__mlsAthenaWriteback.installed) return;
  } catch (e) { return; }

  var VERSION = '1.0.0';
  var ASSET = 'feat_athena_writeback.js';
  var STYLE_ID = 'mlsWbStyle';
  var INTENT_TEXT = 'Writes the finished note into the open Athena chart — does NOT sign';

  /* ---------- tiny utils ---------- */
  function g(n) { try { return window[n]; } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  function trim(s) { return String(s == null ? '' : s).trim(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function normDob(s) {
    var ap = g('__mlsAthenaAutoPull');
    return (ap && isFn(ap.normDob)) ? safe(function () { return ap.normDob(s); }, trim(s)) : trim(s);
  }

  /* ---------- the note the doctor reviewed ---------- */
  function currentNoteText(explicit) {
    if (trim(explicit)) return String(explicit);
    /* FIX 2026-07-01: prefer the CLINICAL note -- a leftover op-note draft in #procNoteBody
       was hijacking plain "write note to chart" clicks. Explicit notes still win outright. */
    var ids = ['noteBox', 'viewBody', 'procNoteBody'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) {
        var v = trim(el.value != null ? el.value : el.textContent);
        if (v) return v;
      }
    }
    return '';
  }

  /* ---------- §61 shared timeline (status + WRITE badge + done/fix) ---------- */
  function AA() { return g('__mlsAthenaActions'); }
  function tlPanel() { try { return document.querySelector('.mlsaa-tl'); } catch (e) { return null; } }
  function openTL() {
    var a = AA();
    if (a && isFn(a._openTimeline)) {
      safe(function () {
        a._openTimeline({
          title: 'Write note to Athena chart',
          intent: { brings: INTENT_TEXT, mode: 'write' } // mode:'write' -> §61 shows the "WRITES TO CHART" badge
        });
      });
      return true;
    }
    return false;
  }
  function step(text, state) {
    var a = AA();
    if (a && isFn(a._step)) return safe(function () { return a._step(text, state); }, null);
    // honest fallback if §61 is somehow absent
    if (isFn(g('toast'))) safe(function () { g('toast')(String(text), state === 'fail' || state === 'warn' ? 'err' : ''); });
    return null;
  }
  function finishOk(msg) {
    step('✓ ' + msg, 'done');
    var p = tlPanel(); if (!p) return;
    var d = p.querySelector('.mlsaa-done');
    if (d) { d.textContent = '✓ ' + msg; d.removeAttribute('hidden'); }
  }
  function finishFail(msg, fix) {
    step(msg, 'fail');
    var p = tlPanel(); if (!p) { if (fix) step('Fix: ' + fix, 'warn'); return; }
    var d = p.querySelector('.mlsaa-done');
    if (d) { d.textContent = msg; d.removeAttribute('hidden'); }
    var f = p.querySelector('.mlsaa-fix');
    if (f && fix) { f.textContent = 'Fix: ' + fix; f.removeAttribute('hidden'); }
  }

  /* ---------- interactive action row (override / handoff), hosted in the §61 panel ---------- */
  function actionRow() {
    var p = tlPanel(); if (!p) return null;
    /* FIX 2026-07-01: the MLS Assistant panel CSS-hides .mlsaa-tl (display:none !important).
       When this row needs a HUMAN CLICK (mismatch override / Review & Sign), an invisible
       row dead-locked writeback: buttons could never be clicked, 'running' stayed true, and
       every later Send-to-Athena click silently no-oped. Inline !important re-shows it. */
    try { p.style.setProperty('display', 'block', 'important'); } catch (e) {}
    var existing = p.querySelector('.mlswb-row'); if (existing) return existing;
    var row = document.createElement('div'); row.className = 'mlswb-row';
    var steps = p.querySelector('.mlsaa-steps');
    if (steps && steps.parentNode) steps.parentNode.insertBefore(row, steps.nextSibling);
    else p.appendChild(row);
    return row;
  }
  function clearRow() { var p = tlPanel(); if (p) { var r = p.querySelector('.mlswb-row'); if (r) r.parentNode && r.parentNode.removeChild(r); } }
  function addBtn(row, label, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'mlswb-rowbtn ' + (cls || ''); b.textContent = label;
    b.addEventListener('click', onClick);
    row.appendChild(b); return b;
  }

  /* ---------- READ-ONLY: read the open chart's patient identity (never saves) ---------- */
  function readChartIdentity(onProgress) {
    var cv = g('__mlsCopyVisits');
    if (!cv || !isFn(cv._driveRequest)) return Promise.resolve({ error: 'modules' });
    return Promise.resolve().then(function () {
      // Same drive request the §56 auto-pull uses to read the OPEN chart, but we
      // DO NOT call cv._saveVisits(): identity is read only, nothing is persisted.
      return cv._driveRequest(
        'mlsAppReadAllVisits', {}, 'mlsAppAllVisitsResult',
        ['mlsAppVisitsProgress', 'mlsAppSearchProgress'],
        function (m) { if (m && onProgress) onProgress(m); },
        null, 60000, 12000
      );
    }).then(function (res) {
      if (res && res.ok === false) return { error: res.error || 'read-failed' };
      return { identity: (res && res.identity) || null };
    }, function (e) { return { error: (e && e.message) || String(e) }; });
  }

  /* ---------- the verified paste (mlsAppPasteNote -> mlsAppPasteResult) ---------- */
  function sendPasteNote(note) {
    return new Promise(function (resolve) {
      var done = false, ponged = false, tries = 0, iv = null, to = null;
      function cleanup() {
        try { window.removeEventListener('message', onMsg); } catch (e) {}
        if (iv) clearInterval(iv); if (to) clearTimeout(to);
      }
      function finish(resp) { if (done) return; done = true; cleanup(); resolve(resp || {}); }
      function onMsg(e) {
        var d = e && e.data; if (!d || d.source !== 'mls-ext') return;
        if (d.type === 'mlsPong' && !ponged) { ponged = true; if (iv) clearInterval(iv); proceed(); return; }
        if (d.type === 'mlsAppPasteResult') finish(d.resp || { error: 'no response' });
      }
      function proceed() {
        // The ONLY write message we ever send. The extension pastes + verifies and
        // (per its handler) NEVER clicks Save/Sign.
        try { window.postMessage({ source: 'mls-app', type: 'mlsAppPasteNote', note: String(note == null ? '' : note) }, '*'); } catch (e) {}
      }
      function ping() { try { window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); } catch (e) {} }
      window.addEventListener('message', onMsg);
      ping();
      iv = setInterval(function () {
        tries++;
        if (ponged) { clearInterval(iv); return; }
        if (tries > 8) { clearInterval(iv); finish({ error: 'noext' }); } else ping();
      }, 350);
      to = setTimeout(function () { finish({ error: 'timeout' }); }, 60000);
    });
  }

  /* ---------- honest failure messaging ---------- */
  function humanErr(e) {
    e = String(e || '');
    if (e === 'modules') return 'the visit reader isn’t loaded yet';
    if (e === 'noext') return 'MLS Assist isn’t responding';
    if (e === 'timeout') return 'it timed out';
    if (e === 'read-failed') return 'the chart read failed';
    return e;
  }
  function mapFix(err) {
    err = String(err || '');
    if (/noext|isn.t responding|not responding/i.test(err)) return 'Install/enable MLS Assist (latest version) and keep your athenaOne tab open, then try again.';
    if (/No EMR|chart tab is open|Open the patient/i.test(err)) return 'Open the patient’s chart in your athenaOne tab, then try again.';
    if (/could not find a note field/i.test(err)) return 'Open the patient and click into the note / Assessment & Plan area, then try again.';
    if (/could not paste/i.test(err)) return 'Click into the EMR note area, then try again.';
    if (/timeout/i.test(err)) return 'Update MLS Assist to the latest version, make sure the encounter is open, then try again.';
    return 'Open the patient’s chart in athenaOne, click into the note area, then try again.';
  }

  /* ---------- the one-click Review & Sign handoff (NEVER signs) ---------- */
  function offerReviewSign() {
    var row = actionRow(); if (!row) return;
    row.innerHTML = '';
    var lbl = document.createElement('div');
    lbl.className = 'mlswb-note';
    lbl.textContent = 'The note is in the chart as an UNSIGNED draft. Review it in athenaOne and click Sign yourself — MLS never signs.';
    row.appendChild(lbl);
    var b = addBtn(row, 'Review & Sign in Athena →', 'mlswb-primary', function () {
      // We do NOT sign and do NOT click any chart button. The verified paste already
      // brought the EMR tab to the front; this just makes the (doctor-only) sign explicit.
      step('Switch to your athenaOne tab → review the note → click Sign yourself.', 'note');
      b.textContent = 'Review & sign it in your athenaOne tab';
      b.disabled = true;
    });
  }

  /* ---------- explicit manual override (uncertainty or mismatch) ---------- */
  function offerOverride(note, mlsPt, chartId, reasonMsg, isMismatch, done) {
    step((isMismatch ? '⛔ ' : '⚠ ') + reasonMsg, isMismatch ? 'fail' : 'warn');
    var who = trim(mlsPt && mlsPt.name) || 'this patient';
    var whoDob = mlsPt && trim(mlsPt.dob) ? (' (DOB ' + normDob(mlsPt.dob) + ')') : '';
    var row = actionRow();
    if (!row) {
      var ok = safe(function () {
        return window.confirm(reasonMsg + '\n\nWrite the note into the OPEN Athena chart anyway?\nOnly do this if YOU have confirmed the open chart is ' + who + whoDob + '.');
      }, false);
      if (ok) { step('Doctor confirmed the patient manually — proceeding.', 'note'); return doWrite(note, mlsPt, done); }
      step('Cancelled — nothing was written.', 'note'); done && done(); return;
    }
    row.innerHTML = '';
    var lbl = document.createElement('div'); lbl.className = 'mlswb-note';
    lbl.textContent = 'Only proceed if YOU have confirmed the open chart is ' + who + whoDob + '. MLS could not auto-confirm it.';
    row.appendChild(lbl);
    addBtn(row, 'Write anyway — I confirmed this patient', 'mlswb-warnbtn', function () {
      clearRow(); step('Doctor confirmed the patient manually — proceeding.', 'note'); doWrite(note, mlsPt, done);
    });
    addBtn(row, 'Cancel', 'mlswb-cancel', function () {
      clearRow(); step('Cancelled — nothing was written to the chart.', 'note'); done && done();
    });
  }

  /* ---------- the actual write + verify + recovery ---------- */
  function doWrite(note, mlsPt, done) {
    step('Writing the note into the Athena chart… (does NOT sign)', 'run');
    sendPasteNote(note).then(function (resp) {
      resp = resp || {};
      if (resp.error) return recover(note, mlsPt, resp, 0, done);
      if (resp.ok && resp.confirmed) {
        var where = resp.chosenLabel || resp.chosenSection || resp.into || resp.targetLabel || 'the chart’s note field';
        step('✓ Wrote the note into the chart’s note field — confirmed.', 'done');
        step('Draft written (unsigned) — MLS did NOT click Save or Sign.', 'done');
        finishOk('Wrote the note into the Athena chart — confirmed it landed in ' + where + '. Unsigned draft; MLS never clicks Save/Sign.');
        offerReviewSign();
        done && done(); return;
      }
      if (resp.ok && !resp.confirmed) {
        var w = resp.warn || 'Wrote to the field but could not confirm the text landed.';
        finishFail('⚠ Wrote to a note field but could NOT confirm the text landed — please open the chart and check before signing. (' + w + ')',
          'Open the Athena note field and verify the text is there; if missing, click into the note area and try again.');
        offerReviewSign();
        done && done(); return;
      }
      recover(note, mlsPt, resp, 0, done);
    }, function (e) { recover(note, mlsPt, { error: (e && e.message) || String(e) }, 0, done); });
  }

  function recover(note, mlsPt, resp, attempt, done) {
    var err = (resp && (resp.error || resp.warn)) || 'unknown';
    step('That didn’t complete — diagnosing what went wrong…', 'note');
    var doctor = g('__mlsAthenaDoctor');
    var diagP = (doctor && isFn(doctor.diagnose)) ? Promise.resolve(safe(function () { return doctor.diagnose(); }, null)) : Promise.resolve(null);
    Promise.resolve(diagP).then(function () {
      // Hard, non-retryable environmental failures -> honest stop + one fix.
      if (/noext|isn.t responding|not responding/i.test(String(err))) {
        finishFail('MLS Assist isn’t responding — the note was NOT written.', mapFix('noext')); done && done(); return;
      }
      if (/No EMR|chart tab is open|Open the patient/i.test(String(err))) {
        finishFail('No open EMR/chart tab was found — nothing was written.', mapFix(err)); done && done(); return;
      }
      // Transient (timeout / field-not-found) -> try ONE alternate attempt, then stop honestly.
      if (attempt < 1 && (/timeout/i.test(String(err)) || /could not find a note field|could not paste/i.test(String(err)))) {
        step('Trying once more — make sure the note area is focused…', 'note');
        sendPasteNote(note).then(function (r2) {
          r2 = r2 || {};
          if (r2.ok && r2.confirmed) {
            var where = r2.chosenLabel || r2.chosenSection || r2.into || 'the chart’s note field';
            step('✓ Wrote the note into the chart’s note field — confirmed (2nd attempt).', 'done');
            finishOk('Wrote the note into the Athena chart — confirmed it landed in ' + where + '. Unsigned draft; MLS never clicks Save/Sign.');
            offerReviewSign(); done && done(); return;
          }
          finishFail('Couldn’t write the note after two attempts — nothing was confirmed in the chart.', mapFix(r2.error || r2.warn || err)); done && done();
        });
        return;
      }
      finishFail('Couldn’t write the note — nothing was confirmed in the chart. (' + humanErr(err) + ')', mapFix(err)); done && done();
    });
  }

  /* ---------- entry point ---------- */
  var running = false, runAt = 0;
  function writeNoteToChart(opts) {
    opts = opts || {};
    /* FIX 2026-07-01: self-healing latch -- if a previous run never called done() (e.g. an
       override row the doctor never saw), the latch auto-expires after 3 minutes instead of
       silently swallowing every future click until a page reload. */
    if (running && (Date.now() - runAt) < 180000) { step('A write is already in progress — give it a moment (it un-jams itself after 3 min).', 'warn'); return; }
    running = true; runAt = Date.now();
    var done = function () { running = false; };
    try {
      var note = currentNoteText(opts.note);
      var mlsPt = safe(function () { return isFn(g('activePatient')) ? (g('activePatient')() || {}) : {}; }, {}) || {};
      openTL(); clearRow();
      if (!trim(note)) { finishFail('No note text to write — generate or open a note first.', 'Generate the note, then click “Write note to Athena chart.”'); return done(); }
      if (!trim(mlsPt.name)) { finishFail('No active patient is selected in MLS — nothing was written.', 'Select the patient in MLS (or pull them from Athena), then try again.'); return done(); }

      step('Confirming this is the right patient (' + esc(mlsPt.name) + ')…', 'run');
      readChartIdentity(function (m) { /* progress text from the reader */ step(String(m), 'note'); }).then(function (r) {
        var ap = g('__mlsAthenaAutoPull');
        var chartId = r && r.identity;
        if (r && r.error) {
          return offerOverride(note, mlsPt, null, 'I couldn’t automatically read the open chart’s patient (' + humanErr(r.error) + ').', false, done);
        }
        if (!chartId || !trim(chartId.name) || !(ap && trim(normDob(chartId.dob)))) {
          return offerOverride(note, mlsPt, chartId, 'I couldn’t read a clear name + DOB from the open chart.', false, done);
        }
        var nameOk = ap && isFn(ap.namesMatch) && safe(function () { return ap.namesMatch(mlsPt.name, chartId.name); }, false);
        var dobOk = ap && isFn(ap.dobsMatch) && safe(function () { return ap.dobsMatch(mlsPt.dob, chartId.dob); }, false);
        if (nameOk && dobOk) {
          step('✓ Patient match: ' + esc(chartId.name) + ', DOB ' + esc(normDob(chartId.dob)), 'run');
          return doWrite(note, mlsPt, done);
        }
        // CLEAR mismatch (we DID read a clear identity and it does NOT match) -> hard refuse + deliberate override.
        var detail = 'MLS active patient: ' + (mlsPt.name || '?') + (trim(mlsPt.dob) ? (' (DOB ' + normDob(mlsPt.dob) + ')') : '') +
          '  ≠  Open Athena chart: ' + chartId.name + (trim(chartId.dob) ? (' (DOB ' + normDob(chartId.dob) + ')') : '') + '.';
        offerOverride(note, mlsPt, chartId, 'Patient mismatch — nothing was written. ' + detail, true, done);
      }, function (e) {
        offerOverride(note, mlsPt, null, 'I couldn’t verify the patient (' + humanErr(e && e.message || e) + ').', false, done);
      });
    } catch (e) {
      safe(function () { finishFail('Unexpected error — nothing was written. (' + (e && e.message || e) + ')', 'Reload the MLS page and try again.'); });
      done();
    }
  }

  /* ---------- styles (button intent label + action row); panel styling is §61's ---------- */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent =
      '.mlswb-action{cursor:pointer}' +
      '.mlswb-cap{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#475569;margin-left:8px;vertical-align:middle}' +
      '.mlswb-tag{display:inline-block;font-weight:700;font-size:10px;letter-spacing:.04em;padding:2px 6px;border-radius:6px;background:#fde68a;color:#7c2d12;border:1px solid #f59e0b}' +
      '.mlswb-emrwrap{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:10px}' +
      '.mlswb-emrwrap .mlswb-action{font-weight:600;padding:9px 14px;border-radius:10px;border:1px solid #2E6A4B;background:#2E6A4B;color:#fff}' +
      '.mlswb-row{margin:8px 0 2px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
      '.mlswb-row .mlswb-note{flex:1 1 100%;font-size:12px;color:#334155}' +
      '.mlswb-rowbtn{cursor:pointer;font-weight:600;font-size:12px;padding:7px 12px;border-radius:9px;border:1px solid #cbd5e1;background:#FCFBF8;color:#0f172a}' +
      '.mlswb-rowbtn.mlswb-primary{background:#2E6A4B;border-color:#2E6A4B;color:#fff}' +
      '.mlswb-rowbtn.mlswb-warnbtn{background:#b45309;border-color:#b45309;color:#fff}' +
      '.mlswb-rowbtn.mlswb-cancel{background:#fff}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- WRITE button injection (no function wrapping) ---------- */
  function makeWriteButton(suffix) {
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'mlsWbBtn' + suffix;
    b.className = 'mlswb-action';
    b.setAttribute('data-mlswb', '1');
    b.title = INTENT_TEXT;            // click-intent on hover, same idea as §61
    b.textContent = '✍ Write note to Athena chart';
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      /* ONE write surface: when the unified Athena review is installed, every
         write entry point opens the same immutable review (read-only probe +
         one typed Confirm & write). The legacy direct paste survives only as
         a fallback when the unified module is absent. */
      var wf = window.__mlsWriteFlow;
      var unified = document.getElementById('pushAllEmrBtn');
      if (wf && wf.installed && unified) { try { unified.click(); return; } catch (eU) {} }
      writeNoteToChart({});
    });
    return b;
  }
  function injectButtons() {
    safe(function () {
      // 1) MLS Easy "Finish" step: right after "Copy to Athena" (#ezCopy)
      var ezCopy = document.getElementById('ezCopy');
      if (ezCopy && !document.getElementById('mlsWbBtnEasy')) {
        var be = makeWriteButton('Easy');
        be.className = 'ez-minibtn mlswb-action';   // match MLS Easy's mini-button look
        if (ezCopy.parentNode) ezCopy.parentNode.insertBefore(be, ezCopy.nextSibling);
      }
      // 2) standalone, clearly-labelled WRITE action in the EMR/Athena card
      var emr = document.getElementById('emrCard');
      if (emr && !document.getElementById('mlsWbBtnEmr')) {
        var wrap = document.createElement('div'); wrap.className = 'mlswb-emrwrap'; wrap.setAttribute('data-mlswb', '1');
        wrap.appendChild(makeWriteButton('Emr'));
        var cap = document.createElement('span'); cap.className = 'mlswb-cap';
        cap.innerHTML = '<span class="mlswb-tag">WRITES TO CHART</span> ' + esc(INTENT_TEXT);
        wrap.appendChild(cap);
        emr.appendChild(wrap);
      }
    });
  }

  /* ---------- boot / observe / revert ---------- */
  var mo = null, retimer = null;
  function scheduleInject() {
    if (retimer) return;
    retimer = setTimeout(function () { retimer = null; injectButtons(); }, 250);
  }
  function boot() {
    ensureStyle();
    injectButtons();
    try {
      mo = new MutationObserver(function () { scheduleInject(); });
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  function revert() {
    try { if (mo) mo.disconnect(); } catch (e) {} mo = null;
    if (retimer) { clearTimeout(retimer); retimer = null; }
    safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.parentNode.removeChild(s); });
    safe(function () {
      ['mlsWbBtnEasy', 'mlsWbBtnEmr'].forEach(function (id) { var el = document.getElementById(id); if (el) el.parentNode && el.parentNode.removeChild(el); });
      [].slice.call(document.querySelectorAll('.mlswb-emrwrap[data-mlswb],.mlswb-row')).forEach(function (el) { el.parentNode && el.parentNode.removeChild(el); });
    });
    try { window.__mlsAthenaWriteback.installed = false; } catch (e) {}
  }

  /* ---------- public API ---------- */
  window.__mlsAthenaWriteback = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    /* FIX 2026-07-01: explicit safe recovery from a stuck 'running' latch (in addition to
       the 3-minute auto-expiry). Clears only the in-page latch flag; it touches no note,
       no patient data, and never talks to athenaOne. */
    resetLatch: function () { try { running = false; runAt = 0; step('Write-back state was reset - you can send again.', 'warn'); } catch (e) {} return true; },
    writeNoteToChart: writeNoteToChart,   // the WRITE action (note -> open chart note field; never signs)
    _readChartIdentity: readChartIdentity, // read-only identity probe (testing/diagnostics)
    _currentNoteText: currentNoteText,
    injectButtons: injectButtons,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
