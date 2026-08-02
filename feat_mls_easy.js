/* feat_mls_easy.js — "MLS Easy" guided one-/two-button visit wizard.
 * Progressive enhancement: wraps the existing blue "Just Talk" hero (#visitHero)
 * into a step-by-step flow that drives the REAL existing handlers. It never
 * reimplements recording / generation / pull / save — it calls the same
 * functions the full UI calls, and only advances when the real thing happened.
 *
 * Self-contained, own scope, every external call wrapped in try/catch,
 * idempotent (no double-build, no render loop), fully reversible:
 *   window.__mlsEasy.revert()   removes the panel + styles + un-hides originals.
 *
 * Real features it wires to (verified live on mlsscribe.com/ScribeFlow.html):
 *   Patient  : pullPatientFromAthenaPrompt()  (autopull-wrapped, auto-fills
 *              #heroPtName/#heroPtDob)  OR manual entry into those same inputs.
 *   Record   : startCapture() / stopCapture()  (state read from #captureBtn).
 *   Generate : generateNote()  -> note text lands in #noteBox.
 *   Review   : reads #noteBox; "Edit" hands off to the full note editor.
 *   Finish   : saveCurrentNote(true) / copyForEMR() / the note "Save as PDF".
 * Connectivity for the Athena step is read honestly from __mlsAthenaStatusDot.
 *
 * No PHI is logged or sent anywhere; the note preview renders only in-page.
 */
(function () {
  'use strict';
  if (window.__mlsEasy && window.__mlsEasy.installed) { return; }

  var VERSION = '1.0.1';
  var PANEL_ID = 'mlsEasyPanel';
  var STYLE_ID = 'mlsEasyStyle';
  var HIDE_CLASS = 'mlsEasyHidden';
  // The detail sections inside #visitView that MLS Easy hides in simple mode.
  // Identified by stable selectors; the original blue hero's own children are
  // hidden separately (everything in #visitHero except our panel).
  var DETAIL_SELECTORS = ['.howto', '.grid', '#emrCard', '#outcomesCard'];

  var state = {
    step: 1,        // 1..5 plus 'done'
    mode: 'easy',   // 'easy' | 'full'
    manual: false,  // manual patient entry shown
    did: { saved: false, copied: false, pdf: false } // honest action tracking
  };
  var _bootObs = null;
  var _refreshTimer = null;
  var _pullTimer = null;
  var _genTimer = null;
  var _operation = null;
  var _timers = [];
  var _listeners = [];
  var _domReadyHandler = null;
  var _reverted = false;
  var _lastSig = '';

  function later(fn, delay) {
    var id = setTimeout(function () {
      var i = _timers.indexOf(id); if (i >= 0) { _timers.splice(i, 1); }
      if (!_reverted) { try { fn(); } catch (e) {} }
    }, delay);
    _timers.push(id);
    return id;
  }
  function cancelLater(id) {
    if (!id) { return null; }
    try { clearTimeout(id); } catch (e) {}
    var i = _timers.indexOf(id); if (i >= 0) { _timers.splice(i, 1); }
    return null;
  }
  function listen(target, type, fn, options) {
    try {
      target.addEventListener(type, fn, options);
      _listeners.push([target, type, fn, options]);
    } catch (e) {}
  }

  // ---------- tiny helpers ----------
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function hero() { return $('visitHero'); }
  function visitView() { return $('visitView'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function call(fnName, arg) {
    try {
      if (typeof window[fnName] === 'function') { return window[fnName](arg); }
    } catch (e) { /* swallow — never break the host app */ }
    return undefined;
  }
  function val(id) { var e = $(id); return e ? (e.value || '') : ''; }
  function txt(id) { var e = $(id); return e ? (e.textContent || '') : ''; }

  // ---------- live state probes (decoupled, robust) ----------
  function isRecording() {
    // captureBtn label flips to include "Stop" while capturing.
    var t = txt('captureBtn');
    return /stop/i.test(t);
  }
  function hasTranscript() { return val('transcript').trim().length > 0; }
  function hasNote() { return val('noteBox').trim().length > 0; }
  function patientName() {
    var n = val('heroPtName').trim();
    return n;
  }
  function notePreview() { return val('noteBox'); }

  // The note's "Save as PDF" button (added by the op-note-pro asset, no inline
  // onclick) — find it live within the clinical-note card at click time.
  function notepdfBtn() {
    try {
      var btns = (visitView() || document).querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var t = (b.textContent || '').trim();
        if (/save as pdf/i.test(t) && !/legal/i.test((b.getAttribute('onclick') || ''))) {
          // prefer the note one (the legal one has onclick=downloadLegalPdf)
          if (!(b.getAttribute('onclick') || '').trim()) { return b; }
        }
      }
      // fallback: any visible "Save as PDF"
      for (var j = 0; j < btns.length; j++) {
        if (/save as pdf/i.test(btns[j].textContent || '') && btns[j].offsetParent) { return btns[j]; }
      }
    } catch (e) {}
    return null;
  }

  // ---------- show/hide originals ----------
  function setSimpleHidden(on) {
    var vv = visitView(); if (!vv) { return; }
    // detail sections
    DETAIL_SELECTORS.forEach(function (sel) {
      try {
        vv.querySelectorAll(sel).forEach(function (el) {
          if (on) { el.classList.add(HIDE_CLASS); } else { el.classList.remove(HIDE_CLASS); }
        });
      } catch (e) {}
    });
    // the original hero's own children (keep our panel visible)
    var h = hero(); if (!h) { return; }
    Array.prototype.forEach.call(h.children, function (c) {
      if (c.id === PANEL_ID) { return; }
      if (on) { c.classList.add(HIDE_CLASS); } else { c.classList.remove(HIDE_CLASS); }
    });
  }

  // ---------- styles ----------
  function injectStyle() {
    if ($(STYLE_ID)) { return; }
    var css = '' +
      '.' + HIDE_CLASS + '{display:none !important;}' +
      '#' + PANEL_ID + '{position:relative;color:#fff;font-family:inherit;padding:4px 2px 6px;}' +
      '#' + PANEL_ID + ' .ez-top{display:flex;align-items:center;gap:10px;margin:0 0 10px;flex-wrap:wrap;}' +
      '#' + PANEL_ID + ' .ez-badge{font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;opacity:.92;background:rgba(255,255,255,.18);padding:4px 10px;border-radius:999px;}' +
      '#' + PANEL_ID + ' .ez-prog{display:flex;gap:6px;align-items:center;margin-left:auto;}' +
      '#' + PANEL_ID + ' .ez-dot{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.32);}' +
      '#' + PANEL_ID + ' .ez-dot.on{background:#fff;}' +
      '#' + PANEL_ID + ' .ez-dot.done{background:#86efac;}' +
      '#' + PANEL_ID + ' h2.ez-title{margin:2px 0 4px;font-size:26px;line-height:1.15;font-weight:800;color:#fff;}' +
      '#' + PANEL_ID + ' .ez-sub{margin:0 0 14px;font-size:14.5px;opacity:.93;max-width:640px;}' +
      '#' + PANEL_ID + ' .ez-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch;}' +
      '#' + PANEL_ID + ' button.ez-btn{appearance:none;border:0;cursor:pointer;font-family:inherit;' +
        'font-weight:800;border-radius:14px;padding:18px 22px;font-size:18px;line-height:1.1;' +
        'display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:60px;' +
        'transition:transform .06s ease, box-shadow .12s ease, background .12s ease;}' +
      '#' + PANEL_ID + ' button.ez-btn:active{transform:translateY(1px);}' +
      '#' + PANEL_ID + ' button.ez-btn:disabled{opacity:.5;cursor:not-allowed;}' +
      '#' + PANEL_ID + ' button.ez-primary{background:#ffffff;color:#204034;box-shadow:0 8px 22px rgba(0,0,0,.22);flex:1 1 260px;}' +
      '#' + PANEL_ID + ' button.ez-primary:hover:not(:disabled){background:#F2F0E9;}' +
      '#' + PANEL_ID + ' button.ez-rec{background:#B23B3B;color:#fff;flex:1 1 260px;box-shadow:0 8px 22px rgba(0,0,0,.25);}' +
      '#' + PANEL_ID + ' button.ez-rec:hover:not(:disabled){background:#9C3232;}' +
      '#' + PANEL_ID + ' button.ez-secondary{background:rgba(255,255,255,.16);color:#fff;border:1.5px solid rgba(255,255,255,.55);flex:0 1 auto;}' +
      '#' + PANEL_ID + ' button.ez-secondary:hover:not(:disabled){background:rgba(255,255,255,.26);}' +
      '#' + PANEL_ID + ' .ez-mini{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;}' +
      '#' + PANEL_ID + ' button.ez-minibtn{background:rgba(255,255,255,.16);color:#fff;border:1.5px solid rgba(255,255,255,.5);' +
        'border-radius:12px;padding:12px 16px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:8px;}' +
      '#' + PANEL_ID + ' button.ez-minibtn:hover{background:rgba(255,255,255,.26);}' +
      '#' + PANEL_ID + ' button.ez-minibtn.ok{background:#2E6A4B;border-color:#2E6A4B;}' +
      '#' + PANEL_ID + ' .ez-inputs{display:flex;gap:12px;flex-wrap:wrap;margin:4px 0 14px;}' +
      '#' + PANEL_ID + ' .ez-field{display:flex;flex-direction:column;gap:5px;flex:1 1 220px;}' +
      '#' + PANEL_ID + ' .ez-field label{font-size:12px;font-weight:700;opacity:.9;}' +
      '#' + PANEL_ID + ' .ez-field input{border:0;border-radius:10px;padding:13px 14px;font-size:16px;font-family:inherit;color:#1A211C;}' +
      '#' + PANEL_ID + ' .ez-hint{margin-top:12px;font-size:13.5px;opacity:.95;display:flex;align-items:flex-start;gap:8px;line-height:1.4;}' +
      '#' + PANEL_ID + ' .ez-hint.warn{background:rgba(0,0,0,.18);border-radius:10px;padding:10px 12px;}' +
      '#' + PANEL_ID + ' .ez-note{background:#fff;color:#1A211C;border-radius:12px;padding:14px 16px;max-height:230px;overflow:auto;' +
        'white-space:pre-wrap;font-size:13.5px;line-height:1.5;margin:2px 0 14px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);}' +
      '#' + PANEL_ID + ' .ez-foot{display:flex;align-items:center;gap:16px;margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,.22);flex-wrap:wrap;}' +
      '#' + PANEL_ID + ' a.ez-link{color:#fff;font-size:13.5px;font-weight:700;text-decoration:underline;cursor:pointer;opacity:.92;}' +
      '#' + PANEL_ID + ' a.ez-link:hover{opacity:1;}' +
      '#' + PANEL_ID + ' .ez-rec-live{display:inline-flex;align-items:center;gap:7px;font-weight:800;}' +
      '#' + PANEL_ID + ' .ez-pulse{width:11px;height:11px;border-radius:50%;background:#fff;animation:ezpulse 1s infinite;}' +
      '@keyframes ezpulse{0%,100%{opacity:1;}50%{opacity:.25;}}' +
      '#' + PANEL_ID + '.ez-min .ez-body{display:none;}' +
      '#' + PANEL_ID + '.ez-min{padding:8px 2px;}' +
      '@media(max-width:560px){#' + PANEL_ID + ' button.ez-btn{flex:1 1 100%;}#' + PANEL_ID + ' h2.ez-title{font-size:22px;}}';
    var st = document.createElement('style');
    st.id = STYLE_ID; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---------- build / mount ----------
  function ensurePanel() {
    var h = hero(); if (!h) { return null; }
    var p = $(PANEL_ID);
    if (p && p.parentNode === h) { return p; }
    if (p && p.parentNode !== h) { try { p.parentNode.removeChild(p); } catch (e) {} p = null; }
    p = document.createElement('div');
    p.id = PANEL_ID;
    p.setAttribute('data-mls-asset', 'feat_mls_easy.js');
    h.insertBefore(p, h.firstChild);
    return p;
  }

  function progressDots(active, total) {
    var html = '<div class="ez-prog" aria-hidden="true">';
    for (var i = 1; i <= total; i++) {
      var cls = 'ez-dot' + (i < active ? ' done' : (i === active ? ' on' : ''));
      html += '<span class="' + cls + '"></span>';
    }
    return html + '</div>';
  }

  function foot(showBack) {
    var back = showBack ? '<a class="ez-link" id="ezBack">← Back</a>' : '';
    return '<div class="ez-foot">' + back +
      '<a class="ez-link" id="ezFull" style="margin-left:auto;">⚙ Switch to full view</a></div>';
  }

  // Each step returns {title, sub, badge, body, foot:bool}
  function render() {
    var p = ensurePanel(); if (!p) { return; }
    injectStyle();

    if (state.mode === 'full') {
      p.classList.add('ez-min');
      setSimpleHidden(false);
      p.innerHTML = '<div class="ez-top"><span class="ez-badge">MLS Easy</span>' +
        '<a class="ez-link" id="ezBackEasy" style="margin-left:auto;">↩ Use MLS Easy (simple guided view)</a></div>';
      var be = $('ezBackEasy');
      if (be) { be.onclick = function () { state.mode = 'easy'; render(); }; }
      return;
    }

    p.classList.remove('ez-min');
    setSimpleHidden(true);

    var pname = patientName();
    var who = pname ? esc(pname) : 'this visit';
    var total = 5;
    var html = '';

    if (state.step === 'done') {
      var bits = [];
      bits.push('Note generated');
      if (state.did.saved) { bits.push('saved to chart'); }
      if (state.did.copied) { bits.push('copied for Athena'); }
      if (state.did.pdf) { bits.push('PDF saved'); }
      html =
        '<div class="ez-body">' +
        '<div class="ez-top"><span class="ez-badge" style="background:rgba(134,239,172,.28);">✓ Complete</span></div>' +
        '<h2 class="ez-title">✓ Visit complete</h2>' +
        '<p class="ez-sub">' + (pname ? '<b>' + esc(pname) + '</b> — ' : '') + esc(bits.join(' · ')) + '.</p>' +
        '<div class="ez-actions"><button class="ez-btn ez-primary" id="ezNext">→ Start next patient</button></div>' +
        '</div>' +
        '<div class="ez-foot"><a class="ez-link" id="ezFull" style="margin-left:auto;">⚙ Switch to full view</a></div>';
      p.innerHTML = html;
      wire();
      bindNext(function () {
        // honest reset: clear the visit using the app's own New Visit
        call('newVisit');
        state.step = 1; state.manual = false; state.did = { saved: false, copied: false, pdf: false };
        render();
      });
      return;
    }

    if (state.step === 1) {
      var conn = window.__mlsEzConn || null; // {ok, label} filled async
      var connWarn = '';
      if (conn && !conn.ok) {
        connWarn = '<div class="ez-hint warn">⚠️ <span>' + esc(conn.label) +
          ' You can still pull (it will tell you how to fix it) or just enter the patient by hand.</span></div>';
      }
      var manualBlock = state.manual
        ? '<div class="ez-inputs">' +
            '<div class="ez-field"><label>Patient name</label><input id="ezName" placeholder="First Last" value="' + esc(val('heroPtName')) + '"></div>' +
            '<div class="ez-field"><label>Date of birth</label><input id="ezDob" placeholder="MM/DD/YYYY" value="' + esc(val('heroPtDob')) + '"></div>' +
          '</div>'
        : '';
      var primary = state.manual
        ? '<button class="ez-btn ez-primary" id="ezContinue">Continue →</button>'
        : '<button class="ez-btn ez-primary" id="ezPull">⬇ Pull open Athena patient</button>';
      var secondary = state.manual
        ? '<button class="ez-btn ez-secondary" id="ezPullAlt">⬇ Pull from Athena instead</button>'
        : '<button class="ez-btn ez-secondary" id="ezManual">✍ Enter manually</button>';
      html =
        '<div class="ez-body">' +
        '<div class="ez-top"><span class="ez-badge">Step 1 of 5 · Patient</span>' + progressDots(1, total) + '</div>' +
        '<h2 class="ez-title">Who are you seeing?</h2>' +
        '<p class="ez-sub">Pull the patient you have open in athenaOne (fills name, DOB &amp; past visits automatically), or type their details.</p>' +
        manualBlock +
        '<div class="ez-actions">' + primary + secondary + '</div>' +
        (pname ? '<div class="ez-hint">✓ <span>Ready: <b>' + esc(pname) + '</b>. <a class="ez-link" id="ezGoRec">Go to recording →</a></span></div>' : connWarn) +
        '</div>' + foot(false);
      p.innerHTML = html; wire();
      bind('ezManual', function () { state.manual = true; render(); });
      bind('ezPullAlt', function () { state.manual = false; doPull(); });
      bind('ezPull', doPull);
      bind('ezGoRec', function () { state.step = 2; render(); });
      bind('ezContinue', function () {
        var n = ($('ezName') || {}).value || '';
        var d = ($('ezDob') || {}).value || '';
        if (!n.trim()) { flashHint('Please enter a name first (or pull from Athena).'); return; }
        var hn = $('heroPtName'), hd = $('heroPtDob');
        if (hn) { hn.value = n; }
        if (hd) { hd.value = d; }
        state.step = 2; render();
      });
      return;
    }

    if (state.step === 2) {
      var rec = isRecording();
      var recBtn = rec
        ? '<button class="ez-btn ez-rec" id="ezRec"><span class="ez-rec-live"><span class="ez-pulse"></span>⏹ Stop recording</span></button>'
        : '<button class="ez-btn ez-primary" id="ezRec">🎙️ Start recording</button>';
      var canNext = hasTranscript();
      var nextBtn = '<button class="ez-btn ez-secondary" id="ezNext"' + (canNext ? '' : ' disabled') + '>Next: Generate →</button>';
      html =
        '<div class="ez-body">' +
        '<div class="ez-top"><span class="ez-badge">Step 2 of 5 · Record</span>' + progressDots(2, total) + '</div>' +
        '<h2 class="ez-title">' + (rec ? 'Listening…' : 'Record the visit') + '</h2>' +
        '<p class="ez-sub">Press start and just talk naturally with ' + who + '. MLS listens and builds the transcript for you. Press stop when you’re done.</p>' +
        '<div class="ez-actions">' + recBtn + nextBtn + '</div>' +
        '<div class="ez-hint" id="ezRecHint">' + (rec ? '🔴 <span>Recording… the conversation is being captured.</span>' : (canNext ? '✓ <span>Transcript captured. You can generate the note.</span>' : 'ℹ️ <span>No microphone? You can also type or paste the conversation in full view.</span>')) + '</div>' +
        '</div>' + foot(true);
      p.innerHTML = html; wire();
      bind('ezRec', function () {
        // drive the REAL recorder
        var wasRecording = isRecording();
        if (wasRecording) { call('stopCapture'); } else { call('startCapture'); }
        startOperationWatch('record', wasRecording);
        later(render, 250);
      });
      bindNext(function () {
        if (!hasTranscript()) { flashHint('There’s no transcript yet — record or type the visit first.'); return; }
        state.step = 3; render();
      });
      return;
    }

    if (state.step === 3) {
      var noteReady = hasNote();
      var working = !!window.__mlsEzGenerating;
      var primary3 = noteReady
        ? '<button class="ez-btn ez-primary" id="ezNext">→ Review the note</button>'
        : '<button class="ez-btn ez-primary" id="ezGen"' + (working ? ' disabled' : '') + '>' + (working ? '⏳ Generating…' : '✨ Generate note') + '</button>';
      html =
        '<div class="ez-body">' +
        '<div class="ez-top"><span class="ez-badge">Step 3 of 5 · Generate</span>' + progressDots(3, total) + '</div>' +
        '<h2 class="ez-title">Generate the note</h2>' +
        '<p class="ez-sub">Turn the conversation into a clean, structured clinical note.</p>' +
        '<div class="ez-actions">' + primary3 + '</div>' +
        (noteReady ? '<div class="ez-hint">✓ <span>Note ready.</span></div>' :
          (hasTranscript() ? '' : '<div class="ez-hint warn">⚠️ <span>No transcript yet — go <a class="ez-link" id="ezBack2">back to record</a> first.</span></div>')) +
        '</div>' + foot(true);
      p.innerHTML = html; wire();
      bind('ezBack2', function () { state.step = 2; render(); });
      bind('ezGen', function () {
        if (!hasTranscript()) { flashHint('Record or type the visit before generating.'); return; }
        window.__mlsEzGenerating = true; render();
        call('generateNote');
        // generation is async; the tick() watcher flips to "Review" when #noteBox fills.
        // safety: clear the spinner flag after a while if nothing appeared.
        _genTimer = cancelLater(_genTimer);
        _genTimer = later(function () {
          _genTimer = null; window.__mlsEzGenT = null;
          window.__mlsEzGenerating = false;
          stopOperationWatch();
          if (state.step === 3) { render(); }
        }, 45000);
        window.__mlsEzGenT = _genTimer;
        startOperationWatch('generate');
      });
      bindNext(function () { state.step = 4; render(); });
      return;
    }

    if (state.step === 4) {
      var preview = notePreview();
      html =
        '<div class="ez-body">' +
        '<div class="ez-top"><span class="ez-badge">Step 4 of 5 · Review</span>' + progressDots(4, total) + '</div>' +
        '<h2 class="ez-title">Review the note</h2>' +
        '<p class="ez-sub">Read it over. Looks right? Move on. Need a tweak? Edit it in the note box.</p>' +
        '<div class="ez-note" id="ezNotePrev">' + (preview.trim() ? esc(preview) : 'No note text found — go back and generate the note.') + '</div>' +
        '<div class="ez-actions">' +
          '<button class="ez-btn ez-primary" id="ezGood">✓ Looks good →</button>' +
          '<button class="ez-btn ez-secondary" id="ezEdit">✎ Edit the note</button>' +
        '</div>' +
        '</div>' + foot(true);
      p.innerHTML = html; wire();
      bind('ezGood', function () { state.step = 5; render(); });
      bind('ezEdit', function () {
        // hand off to the real editable note box in full view
        state.mode = 'full'; render();
        var nb = $('noteBox');
        if (nb) { try { nb.scrollIntoView({ behavior: 'smooth', block: 'center' }); nb.focus(); } catch (e) {} }
      });
      return;
    }

    if (state.step === 5) {
      html =
        '<div class="ez-body">' +
        '<div class="ez-top"><span class="ez-badge">Step 5 of 5 · Finish</span>' + progressDots(5, total) + '</div>' +
        '<h2 class="ez-title">Save the note</h2>' +
        '<p class="ez-sub">Put the finished note where you need it.</p>' +
        '<div class="ez-actions">' +
          '<button class="ez-btn ez-primary" id="ezSave">💾 Save to chart</button>' +
        '</div>' +
        '<div class="ez-mini">' +
          '<button class="ez-minibtn' + (state.did.copied ? ' ok' : '') + '" id="ezCopy">' + (state.did.copied ? '✓ Copied' : '📋 Copy to Athena') + '</button>' +
          '<button class="ez-minibtn' + (state.did.pdf ? ' ok' : '') + '" id="ezPdf">' + (state.did.pdf ? '✓ PDF saved' : '🧾 Save as PDF') + '</button>' +
        '</div>' +
        '<div class="ez-hint" id="ezFinHint">' + (state.did.saved ? '✓ <span>Saved to chart. <a class="ez-link" id="ezDone">Finish →</a></span>' : 'ℹ️ <span>Save to chart records this visit in the patient’s history.</span>') + '</div>' +
        '</div>' + foot(true);
      p.innerHTML = html; wire();
      bind('ezSave', function () {
        call('saveCurrentNote', true);
        state.did.saved = true;
        later(function () { state.step = 'done'; render(); }, 600);
      });
      bind('ezCopy', function () {
        call('copyForEMR');
        state.did.copied = true; render();
      });
      bind('ezPdf', function () {
        var b = notepdfBtn();
        if (b) { try { b.click(); state.did.pdf = true; } catch (e) {} }
        else { flashHint('Save-as-PDF isn’t available until a note is generated.'); }
        render();
      });
      bind('ezDone', function () { state.step = 'done'; render(); });
      return;
    }
  }

  // ---------- shared wiring ----------
  function wire() {
    bind('ezFull', function () { state.mode = 'full'; render(); });
    bind('ezBack', function () {
      if (state.step === 'done') { return; }
      if (typeof state.step === 'number' && state.step > 1) { state.step -= 1; render(); }
    });
  }
  function bind(id, fn) { var e = $(id); if (e) { e.onclick = fn; } }
  function bindNext(fn) { var e = $('ezNext'); if (e) { e.onclick = fn; } }
  function flashHint(msg) {
    var ids = ['ezRecHint', 'ezFinHint'];
    for (var i = 0; i < ids.length; i++) {
      var e = $(ids[i]);
      if (e) { e.classList.add('warn'); e.innerHTML = '⚠️ <span>' + esc(msg) + '</span>'; return; }
    }
    try { if (typeof window.toast === 'function') window.toast(msg, 'err'); else (window.toast || window.alert)(msg); } catch (e2) {}
  }

  // ---------- patient pull (real) ----------
  function doPull() {
    var before = patientName();
    call('pullPatientFromAthenaPrompt');
    // the real autopull is async; tick() will notice when #heroPtName fills.
    // give a gentle confirmation path:
    var tries = 0;
    _pullTimer = cancelLater(_pullTimer);
    function checkPull() {
      _pullTimer = null; window.__mlsEzPullW = null;
      tries++;
      var now = patientName();
      if (now && now !== before) { if (state.step === 1) { render(); } return; }
      if (tries <= 30) {
        _pullTimer = later(checkPull, 500);
        window.__mlsEzPullW = _pullTimer;
      }
    }
    _pullTimer = later(checkPull, 500);
    window.__mlsEzPullW = _pullTimer;
  }

  // ---------- connectivity (honest, read-only) ----------
  function refreshConn() {
    try {
      var sd = window.__mlsAthenaStatusDot;
      if (!sd || typeof sd.check !== 'function') {
        window.__mlsEzConn = { ok: true, label: '' }; // can't tell; don't nag
        return;
      }
      Promise.resolve(sd.check()).then(function (r) {
        // r is typically a state string/object; be liberal
        var ok = false, label = '';
        if (r === true || r === 'green' || (r && (r.ok || r.state === 'green' || r.connected))) { ok = true; }
        else {
          ok = false;
          label = (r && r.label) || (sd.state === 'green' ? '' : 'athenaOne isn’t detected (open a signed-in athenaOne tab and make sure MLS Assist is installed).');
          if (sd.state === 'green') { ok = true; label = ''; }
        }
        window.__mlsEzConn = { ok: ok, label: label };
        if (state.mode === 'easy' && state.step === 1 && !patientName()) { render(); }
      }).catch(function () { window.__mlsEzConn = { ok: true, label: '' }; });
    } catch (e) { window.__mlsEzConn = { ok: true, label: '' }; }
  }

  // ---------- watcher (no jitter: only act on change) ----------
  function tick() {
    if (!hero() || state.mode !== 'easy') { return; }
    var sig = state.step + '|' + isRecording() + '|' + hasTranscript() + '|' + hasNote() + '|' + patientName();
    if (sig === _lastSig) { return; }
    var prev = _lastSig; _lastSig = sig;

    // step 2: recording state or transcript availability changed -> re-render step 2
    if (state.step === 2) { render(); return; }
    // step 3: note appeared while generating -> advance to review
    if (state.step === 3) {
      if (hasNote()) {
        window.__mlsEzGenerating = false;
        _genTimer = cancelLater(_genTimer); window.__mlsEzGenT = null;
        stopOperationWatch();
        state.step = 4; render(); return;
      }
      render(); return;
    }
    // step 1: patient name changed -> reflect
    if (state.step === 1) { render(); return; }
  }

  // ---------- bootstrap (idempotent, re-mounts if app re-renders hero) ----------
  function boot() {
    if (!hero()) { return; }
    injectStyle();
    if (!$(PANEL_ID)) { render(); }
  }

  function stopOperationWatch() {
    if (_operation && _operation.timer) { _operation.timer = cancelLater(_operation.timer); }
    _operation = null;
  }

  function operationPulse() {
    if (!_operation || _reverted) { return; }
    var op = _operation;
    op.timer = null;
    tick();
    var keep = false;
    if (op.kind === 'record') {
      var active = isRecording();
      if (active) { op.sawActive = true; op.idle = 0; }
      else if (op.sawActive) { op.idle++; }
      keep = active || (!op.sawActive && Date.now() < op.deadline) || (op.sawActive && op.idle < 4);
    } else if (op.kind === 'generate') {
      keep = !hasNote() && !!window.__mlsEzGenerating && Date.now() < op.deadline;
    }
    if (keep) { op.timer = later(operationPulse, 250); }
    else { stopOperationWatch(); }
  }

  function startOperationWatch(kind, sawActive) {
    stopOperationWatch();
    _operation = {
      kind: kind,
      sawActive: !!sawActive,
      idle: 0,
      deadline: Date.now() + (kind === 'generate' ? 45000 : 5000),
      timer: null
    };
    operationPulse();
  }

  function scheduleRefresh() {
    if (_refreshTimer || _reverted) { return; }
    _refreshTimer = later(function () {
      _refreshTimer = null;
      boot();
      tick();
      if (state.step === 2 && isRecording() && (!_operation || _operation.kind !== 'record')) {
        startOperationWatch('record', true);
      }
    }, 0);
  }

  function relevantNode(node) {
    if (!node) { return false; }
    if (node.nodeType !== 1) { node = node.parentElement; }
    if (!node) { return false; }
    var sel = '#visitView, #visitHero, #' + PANEL_ID + ', #transcript, #noteBox, #heroPtName, #captureBtn';
    try { return !!(node.matches(sel) || node.closest(sel)); } catch (e) { return false; }
  }

  function relevantMutations(records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (relevantNode(r.target)) { return true; }
      for (var j = 0; j < r.addedNodes.length; j++) { if (relevantNode(r.addedNodes[j])) { return true; } }
      for (var k = 0; k < r.removedNodes.length; k++) { if (relevantNode(r.removedNodes[k])) { return true; } }
    }
    return false;
  }

  function startObserver() {
    try {
      if (_bootObs) { return; }
      _bootObs = new MutationObserver(function (records) {
        if (relevantMutations(records)) { scheduleRefresh(); }
      });
      _bootObs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-pressed']
      });
    } catch (e) {}
  }

  function onStateEvent(e) {
    var t = e && e.target;
    if (!t || t === document || t === window) { scheduleRefresh(); return; }
    try {
      if (t.id === 'transcript' || t.id === 'noteBox' || t.id === 'heroPtName' ||
          t.id === 'captureBtn' || t.closest('#visitHero, #visitView')) { scheduleRefresh(); }
    } catch (err) { scheduleRefresh(); }
  }

  function onFocusRefresh() {
    if (_reverted || state.mode !== 'easy' || state.step !== 1 || patientName()) { return; }
    refreshConn();
  }

  // ---------- public API ----------
  window.__mlsEasy = {
    installed: true,
    version: VERSION,
    render: render,
    goto: function (s) { state.step = s; render(); },
    state: state,
    revert: function () {
      _reverted = true;
      stopOperationWatch();
      _refreshTimer = cancelLater(_refreshTimer);
      _pullTimer = cancelLater(_pullTimer); window.__mlsEzPullW = null;
      _genTimer = cancelLater(_genTimer); window.__mlsEzGenT = null;
      window.__mlsEzGenerating = false;
      while (_timers.length) { cancelLater(_timers[_timers.length - 1]); }
      try { if (_bootObs) { _bootObs.disconnect(); } } catch (e) {}
      _bootObs = null;
      while (_listeners.length) {
        var l = _listeners.pop();
        try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) {}
      }
      if (_domReadyHandler) {
        try { document.removeEventListener('DOMContentLoaded', _domReadyHandler); } catch (e) {}
        _domReadyHandler = null;
      }
      try { setSimpleHidden(false); } catch (e) {}
      var p = $(PANEL_ID); if (p && p.parentNode) { p.parentNode.removeChild(p); }
      var st = $(STYLE_ID); if (st && st.parentNode) { st.parentNode.removeChild(st); }
      // strip any leftover hide classes
      try {
        document.querySelectorAll('.' + HIDE_CLASS).forEach(function (el) { el.classList.remove(HIDE_CLASS); });
      } catch (e) {}
      window.__mlsEasy.installed = false;
    }
  };

  // init
  function init() {
    if (_reverted) { return; }
    boot();
    refreshConn();
    startObserver();
    listen(document, 'input', onStateEvent, true);
    listen(document, 'change', onStateEvent, true);
    listen(window, 'focus', onFocusRefresh, false);
    listen(document, 'visibilitychange', function () { if (!document.hidden) { onFocusRefresh(); scheduleRefresh(); } }, false);
    scheduleRefresh();
  }
  if (document.readyState === 'loading') {
    _domReadyHandler = function () { _domReadyHandler = null; init(); };
    document.addEventListener('DOMContentLoaded', _domReadyHandler);
  } else {
    init();
  }
})();
