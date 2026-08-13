/*
 * MLS Scribe /1p/ preview only — Avatar likeness studio shell.
 *
 * This asset deliberately owns presentation and explanation, not the interview
 * microphone.  The face engine remains the single owner of capture, matching,
 * speech animation and save.  We enhance its mounted Setup form in place so
 * there cannot be a second, divergent avatar configuration.
 */
;(function () {
  'use strict';

  var VERSION = 'p1-face-studio-1.0.0';
  var STYLE_ID = 'mlsP1FaceStudioStyle';
  var ROOT_CLASS = 'mlsP1FaceStudio';
  var api = window.__mlsAvatarFaceStudio;
  if (api && api.version === VERSION && api.installed === true) return;
  if (api && typeof api.revert === 'function') {
    try { api.revert(); } catch (e0) {}
  }

  var observer = null;
  var eventRows = [];
  var enhanced = [];
  var timers = [];

  function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function on(node, type, fn) {
    if (!node || !node.addEventListener) return;
    node.addEventListener(type, fn, false);
    eventRows.push([node, type, fn]);
  }
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function later(fn, delay) {
    var timer = setTimeout(function () {
      var at = timers.indexOf(timer);
      if (at >= 0) timers.splice(at, 1);
      fn();
    }, delay);
    timers.push(timer);
    return timer;
  }

  function summarizeReceipt(receipt) {
    var r = receipt || {};
    var examined = Math.max(0, Number(r.examined) || 0);
    var claimed = Math.max(0, Math.min(examined, Number(r.claimed) || 0));
    var refused = Math.max(0, Number(r.refused) || Math.max(0, examined - claimed));
    var grid = Math.max(1, Number(r.grid) || 1);
    var faceW = Math.max(0, Number(r.faceW) || 0);
    var ratio = Math.min(1, faceW / grid);
    var sourcePenalty = r.fromIllustration === true ? 28 : 0;
    var adaptivePenalty = r.adaptiveSegmentation === true ? 5 : 0;
    var matchPart = examined ? (claimed / examined) * 64 : 0;
    var framingPart = Math.min(1, ratio / 0.52) * 30;
    var score = examined ? Math.max(0, Math.min(100, Math.round(matchPart + framingPart + 6 - sourcePenalty - adaptivePenalty))) : 0;
    var level = score >= 76 && claimed >= 8 ? 'strong' : (score >= 48 && claimed >= 4 ? 'usable' : 'limited');
    var heading = level === 'strong' ? 'Strong photo match' : (level === 'usable' ? 'Good starting match' : 'This photo needs a quick check');
    var detail = examined
      ? (claimed + ' of ' + examined + ' appearance details matched' + (refused ? '; ' + refused + ' left unchanged' : ''))
      : 'No appearance details were changed';
    return { score: score, level: level, heading: heading, detail: detail };
  }

  function style() {
    if (document.getElementById(STYLE_ID)) return;
    var node = document.createElement('style');
    node.id = STYLE_ID;
    node.textContent =
      '.' + ROOT_CLASS + '{display:grid!important;grid-template-columns:minmax(176px,210px) minmax(0,1fr);gap:18px!important;align-items:start!important;padding:16px!important;background:linear-gradient(145deg,#fbfcfa,#f3f7f4)!important;border-color:#dfe9e2!important}' +
      '.' + ROOT_CLASS + ' .mlsP1FacePreview{position:sticky;top:8px;display:grid;justify-items:center;gap:9px;text-align:center}' +
      '.' + ROOT_CLASS + ' #mlsAvLookStage{width:176px!important;height:176px!important;box-shadow:0 12px 36px rgba(32,64,52,.18)!important}' +
      '.mlsP1FacePreviewTitle{font:800 13px/1.25 "Public Sans",system-ui;color:#204034}' +
      '.mlsP1FacePreviewSub{font:500 11.5px/1.4 "Public Sans",system-ui;color:#69736d;max-width:205px}' +
      '.mlsP1FaceMeter{width:100%;border:1px solid #d9e4dc;background:#fff;border-radius:12px;padding:9px 10px;text-align:left;box-sizing:border-box}' +
      '.mlsP1FaceMeter[data-level="strong"]{border-color:#a8d5bc;background:#f1fbf5}.mlsP1FaceMeter[data-level="limited"]{border-color:#e8c9a1;background:#fff9ef}' +
      '.mlsP1FaceMeterHead{font:800 11.5px/1.3 system-ui;color:#204034}.mlsP1FaceMeterDetail{font:500 10.5px/1.35 system-ui;color:#69736d;margin-top:2px}' +
      '.mlsP1FaceBar{height:5px;background:#e5ebe7;border-radius:99px;overflow:hidden;margin-top:7px}.mlsP1FaceBar>i{display:block;height:100%;width:0;background:#2e6a4b;border-radius:inherit;transition:width .25s ease}' +
      '.mlsP1FaceControls{min-width:0}.mlsP1FaceControls>summary{list-style:none;cursor:pointer;border:1px solid #d9e4dc;background:#fff;border-radius:11px;padding:10px 12px;font:800 12.5px system-ui;color:#204034;display:flex;justify-content:space-between;align-items:center}' +
      '.mlsP1FaceControls>summary::-webkit-details-marker{display:none}.mlsP1FaceControls>summary::after{content:"Fine-tune";font:700 10.5px system-ui;color:#2e6a4b}' +
      '.mlsP1FaceControls[open]>summary{border-radius:11px 11px 0 0;border-bottom-color:#eef2ef}.mlsP1FaceControls[open]>summary::after{content:"Hide controls"}' +
      '.mlsP1FaceControlsGrid{border:1px solid #d9e4dc;border-top:0;border-radius:0 0 11px 11px;padding:12px;background:#fff}' +
      '.mlsP1FaceModeHelp{border:1px solid #dfe7e2;border-radius:11px;padding:10px 12px;background:#f8faf8;font:500 12px/1.45 system-ui;color:#55605a;margin-top:-2px}' +
      '.mlsP1FaceModeHelp strong{display:block;color:#204034;font-weight:800;margin-bottom:2px}' +
      '.mlsP1FaceStudio .mlsAvActions{gap:9px}.mlsP1FaceStudio .mlsAvAction{min-height:40px}' +
      '.mlsP1FaceStudio #mlsAvLookNote[role="status"]{line-height:1.5!important}' +
      '@media(max-width:680px){.' + ROOT_CLASS + '{grid-template-columns:1fr!important}.' + ROOT_CLASS + ' .mlsP1FacePreview{position:static}.' + ROOT_CLASS + ' #mlsAvLookStage{width:164px!important;height:164px!important}}' +
      '@media(prefers-reduced-motion:reduce){.mlsP1FaceBar>i{transition:none}}';
    (document.head || document.documentElement).appendChild(node);
  }

  function updateModeHelp(select, help, previewSub, stage) {
    var photo = select && select.value === 'photo';
    var kind = stage && stage.getAttribute ? stage.getAttribute('data-face-preview-kind') : '';
    var copyKey = (photo ? 'photo:' : 'animated:') + kind;
    /* reconcile runs from a subtree observer. Rewriting identical copy would
       trigger that observer again forever, so visible DOM changes only when
       mode or the actual stage kind changes. */
    if (help.__mlsP1FaceCopy === copyKey && previewSub.__mlsP1FaceCopy === copyKey) return;
    help.__mlsP1FaceCopy = copyKey;
    previewSub.__mlsP1FaceCopy = copyKey;
    if (photo && kind === 'photo') {
      help.innerHTML = '<strong>Your photo is the patient-facing face</strong>This is the exact portrait patients see. It keeps the closest likeness and moves gently with speaking and listening.';
      previewSub.textContent = 'Actual patient view — your saved camera portrait, with subtle voice and listening movement.';
    } else if (photo) {
      help.innerHTML = '<strong>Take a photo to use photo mode</strong>No portrait is available yet, so the animated fallback shown here is what patients would see.';
      previewSub.textContent = 'Current patient fallback — take a camera portrait to replace it with your photo.';
    } else {
      help.innerHTML = '<strong>The animated face is patient-facing</strong>It uses the matched features below, makes eye contact, changes expression, and moves its mouth with the selected voice.';
      previewSub.textContent = 'Live patient preview — expressions and speaking use this same face.';
    }
  }

  function updateMeter(meter, receipt) {
    if (!meter) return;
    var summary = summarizeReceipt(receipt);
    meter.setAttribute('data-level', summary.level);
    meter.setAttribute('aria-label', summary.heading + '. ' + summary.detail + '. Confidence ' + summary.score + ' percent.');
    var head = meter.querySelector('.mlsP1FaceMeterHead');
    var detail = meter.querySelector('.mlsP1FaceMeterDetail');
    var bar = meter.querySelector('.mlsP1FaceBar>i');
    if (head) head.textContent = summary.heading;
    if (detail) detail.textContent = summary.detail;
    if (bar) bar.style.width = summary.score + '%';
  }

  function enhance(stage) {
    if (!stage || stage.getAttribute('data-p1-face-studio') === VERSION) return false;
    var wrap = stage.parentNode;
    if (!wrap || !wrap.children || wrap.children.length < 2) return false;
    var grid = null;
    for (var i = 0; i < wrap.children.length; i++) {
      var candidate = wrap.children[i];
      if (candidate !== stage && candidate.querySelector && candidate.querySelector('[id^="mlsAvLook_"]')) { grid = candidate; break; }
    }
    if (!grid) return false;
    var form = wrap.closest ? wrap.closest('.mlsAvForm') : null;
    var mode = document.getElementById('mlsAvFaceMode');
    var note = document.getElementById('mlsAvLookNote');
    if (!form || !mode || !note) return false;

    style();
    stage.setAttribute('data-p1-face-studio', VERSION);
    wrap.classList.add(ROOT_CLASS);

    var preview = make('div', 'mlsP1FacePreview');
    var title = make('div', 'mlsP1FacePreviewTitle', 'Patient-facing preview');
    var sub = make('div', 'mlsP1FacePreviewSub', 'Live patient preview — expressions and speaking use this same face.');
    var meter = make('div', 'mlsP1FaceMeter');
    meter.setAttribute('role', 'status');
    meter.setAttribute('aria-live', 'polite');
    meter.innerHTML = '<div class="mlsP1FaceMeterHead">Ready to match your photo</div><div class="mlsP1FaceMeterDetail">Take a clear, front-facing photo to begin.</div><div class="mlsP1FaceBar" aria-hidden="true"><i></i></div>';
    wrap.insertBefore(preview, stage);
    preview.appendChild(title); preview.appendChild(stage); preview.appendChild(sub); preview.appendChild(meter);

    var details = make('details', 'mlsP1FaceControls');
    var summary = make('summary', '', 'Appearance details');
    summary.setAttribute('aria-label', 'Show or hide fine-tuning controls for the animated avatar');
    details.appendChild(summary);
    grid.classList.add('mlsP1FaceControlsGrid');
    details.appendChild(grid);
    wrap.appendChild(details);

    var help = make('div', 'mlsP1FaceModeHelp');
    help.setAttribute('role', 'note');
    mode.parentNode.insertBefore(help, mode.nextSibling);
    updateModeHelp(mode, help, sub, stage);
    on(mode, 'change', function () { updateModeHelp(mode, help, sub, stage); });

    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    note.setAttribute('aria-atomic', 'true');
    var matchButton = null;
    var actions = note.previousElementSibling;
    if (actions && actions.querySelectorAll) {
      var buttons = actions.querySelectorAll('button');
      for (var bi = 0; bi < buttons.length; bi++) {
        if (/match my photo/i.test(clean(buttons[bi].textContent))) { matchButton = buttons[bi]; break; }
      }
    }
    if (matchButton) {
      matchButton.setAttribute('aria-controls', 'mlsAvLookStage mlsAvLookNote');
      on(matchButton, 'click', function () {
        var before = Number(window.__mlsAvatar && window.__mlsAvatar.lastMatchReceipt && window.__mlsAvatar.lastMatchReceipt.at) || 0;
        var startedAt = Date.now();
        meter.setAttribute('data-level', '');
        var mh = meter.querySelector('.mlsP1FaceMeterHead');
        var md = meter.querySelector('.mlsP1FaceMeterDetail');
        if (mh) mh.textContent = 'Matching your photo…';
        if (md) md.textContent = 'Only details the photo supports will change.';
        var pollCount = 0;
        (function poll() {
          pollCount++;
          var owner = window.__mlsAvatar;
          var latest = owner && owner.lastMatchReceipt;
          if (latest && latest.receipt && Number(latest.at || 0) > before && Number(latest.at || 0) >= startedAt) {
            updateMeter(meter, latest.receipt);
            if (latest.wholeReadRefusal || Number(latest.receipt.refused || 0) > Number(latest.receipt.claimed || 0)) details.open = true;
            return;
          }
          if (pollCount < 30) later(poll, 150);
        }());
      });
    }

    enhanced.push({ stage: stage, wrap: wrap, grid: grid, preview: preview, sub: sub,
      details: details, help: help, mode: mode });
    return true;
  }

  function reconcile() {
    var stages = document.querySelectorAll ? document.querySelectorAll('#mlsAvLookStage') : [];
    for (var i = 0; i < stages.length; i++) enhance(stages[i]);
    /* Core swaps the stage contents immediately after a new capture. Keep the
       explanatory copy tied to what is really in that same patient preview. */
    for (var j = 0; j < enhanced.length; j++) {
      var row = enhanced[j];
      if (row.stage && row.stage.parentNode) updateModeHelp(row.mode, row.help, row.sub, row.stage);
    }
  }

  function revert() {
    if (observer) { try { observer.disconnect(); } catch (e1) {} observer = null; }
    for (var ti = 0; ti < timers.length; ti++) { try { clearTimeout(timers[ti]); } catch (eTimer) {} }
    timers = [];
    for (var i = 0; i < eventRows.length; i++) {
      try { eventRows[i][0].removeEventListener(eventRows[i][1], eventRows[i][2], false); } catch (e2) {}
    }
    eventRows = [];
    for (var j = 0; j < enhanced.length; j++) {
      var row = enhanced[j];
      try {
        if (row.wrap && row.stage && row.preview && row.preview.parentNode === row.wrap) {
          row.wrap.insertBefore(row.stage, row.preview);
          if (row.grid && row.details && row.details.parentNode === row.wrap) row.wrap.insertBefore(row.grid, row.details);
          row.wrap.removeChild(row.preview);
          row.wrap.removeChild(row.details);
          if (row.help && row.help.parentNode) row.help.parentNode.removeChild(row.help);
          row.wrap.classList.remove(ROOT_CLASS);
          row.stage.removeAttribute('data-p1-face-studio');
          row.grid.classList.remove('mlsP1FaceControlsGrid');
        }
      } catch (e3) {}
    }
    enhanced = [];
    var styleNode = document.getElementById(STYLE_ID);
    if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode);
    try { window.removeEventListener('mls:settings-reconciled', reconcile, false); } catch (e4) {}
    try { window.__mlsAvatarFaceStudio.installed = false; } catch (e5) {}
  }

  style();
  reconcile();
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(reconcile);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.addEventListener('mls:settings-reconciled', reconcile, false);
  window.__mlsAvatarFaceStudio = {
    installed: true,
    version: VERSION,
    reconcile: reconcile,
    summarizeReceipt: summarizeReceipt,
    revert: revert
  };
}());
