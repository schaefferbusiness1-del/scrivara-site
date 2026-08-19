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

  var VERSION = 'p1-face-studio-1.0.1';
  var LOADER_KEY = '__mlsP1AvatarFaceLoader';
  var STYLE_ID = 'mlsP1FaceStudioStyle';
  var ROOT_CLASS = 'mlsP1FaceStudio';
  var script = document.currentScript;
  var installToken = script && script.getAttribute ? cleanToken(script.getAttribute('data-mls-install-token')) : '';
  var liveLoader = window[LOADER_KEY];
  if (!(window.__MLS_P1_PREVIEW && window.__MLS_P1_PREVIEW.enabled === true) ||
      !installToken || !liveLoader || liveLoader.installed !== true ||
      liveLoader.version !== VERSION || liveLoader.installToken !== installToken) return;
  var api = window.__mlsAvatarFaceStudio;
  if (api && api.version === VERSION && api.installToken === installToken && api.installed === true &&
      typeof api.reconcile === 'function' && typeof api.revert === 'function') return;
  if (api && api.installed === true) {
    if (typeof api.revert !== 'function') return;
    var retiring = api;
    try { retiring.revert(); } catch (e0) { return; }
    if (retiring.installed === true) return;
    api = window.__mlsAvatarFaceStudio;
    if (api && api.installed === true) {
      /* A retiring owner may publish another installation synchronously. An
         exact valid replacement already won; any other live replacement is a
         collision and must fail closed. Neither may be overwritten here. */
      if (api.version === VERSION && api.installToken === installToken &&
          typeof api.reconcile === 'function' && typeof api.revert === 'function') return;
      return;
    }
  }

  var owner = null;
  var observer = null;
  var eventRows = [];
  var enhanced = [];
  var timers = [];

  function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function cleanToken(value) { return clean(value).replace(/[^a-z0-9._:-]/gi, '').slice(0, 160); }
  function owned() {
    var loader = window[LOADER_KEY];
    return !!(owner && owner.installed === true && window.__mlsAvatarFaceStudio === owner &&
      loader && loader.installed === true && loader.version === VERSION &&
      loader.installToken === installToken && owner.installToken === installToken);
  }
  function active() {
    return !!(window.__MLS_P1_PREVIEW && window.__MLS_P1_PREVIEW.enabled === true && owned());
  }
  function on(node, type, fn) {
    if (!node || !node.addEventListener) return;
    var guarded = function () { if (active()) return fn.apply(this, arguments); };
    node.addEventListener(type, guarded, false);
    eventRows.push([node, type, guarded]);
  }
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function priorAttr(node, name) {
    var value = node && node.getAttribute ? node.getAttribute(name) : null;
    return { name: name, present: value != null, value: value };
  }
  function restoreAttrs(node, rows) {
    if (!node || !rows) return;
    for (var i = 0; i < rows.length; i++) {
      try {
        if (rows[i].present) node.setAttribute(rows[i].name, rows[i].value);
        else node.removeAttribute(rows[i].name);
      } catch (e0) {}
    }
  }
  function later(fn, delay) {
    var timer = setTimeout(function () {
      var at = timers.indexOf(timer);
      if (at >= 0) timers.splice(at, 1);
      if (!active()) return;
      fn();
    }, delay);
    timers.push(timer);
    return timer;
  }
  function clearPollTimers() {
    for (var i = 0; i < timers.length; i++) { try { clearTimeout(timers[i]); } catch (e0) {} }
    timers = [];
  }
  function pruneDetached() {
    var dropped = false, kept = [];
    for (var i = 0; i < enhanced.length; i++) {
      var row = enhanced[i];
      if (row.stage && row.stage.isConnected !== false) kept.push(row);
      else dropped = true;
    }
    enhanced = kept;
    var keptEvents = [];
    for (var j = 0; j < eventRows.length; j++) {
      var eventRow = eventRows[j];
      if (eventRow[0] && eventRow[0].isConnected === false) {
        try { eventRow[0].removeEventListener(eventRow[1], eventRow[2], false); } catch (e1) {}
        dropped = true;
      } else keptEvents.push(eventRow);
    }
    eventRows = keptEvents;
    /* A receipt poll closes over its old meter/details tree. When that Setup
       form leaves the document, no timer from it may retain the form. */
    if (dropped) clearPollTimers();
  }

  function summarizeReceipt(receipt, wholeReadRefusal, partialApplied) {
    var r = receipt || {};
    var partialCount = Math.max(0, Number(partialApplied) || 0);
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
    /* The meter may describe evidence, but only a whole-match receipt may call
       it an applied likeness. A 1-of-14 read is not a "starting match" — it is
       a refusal, and the natural portrait remains the patient-facing face.
       p1-photo-truth-1.2.0: this shadows the engine's faceMatchDecision and
       the two must agree exactly, or the meter calls a real match "No animated
       traits changed" while the traits visibly change beside it. The engine
       dropped `claimed > refused` — a fifth condition that silently raised the
       documented six-control bar to eight and failed a 7-of-14 tie — so this
       drops it too. `wholeReadRefusal` still comes from the engine's own
       decision, so a refusal there is still a refusal here. */
    var applyEligible = !wholeReadRefusal && r.fromIllustration !== true &&
      examined >= 10 && claimed >= 6;
    /* avfit-1.0.0 — THE THIRD STATE THE ENGINE NOW HAS.
       Owner, 2026-08-17, holding this meter: "No animated traits changed · 5 of
       14 details were readable; the match was incomplete, so all character
       settings stayed unchanged ... this is unacceptable and always happens."
       An incomplete read now APPLIES the traits it really measured
       (facePartialDecision in the engine), so a heading saying nothing changed
       while five controls visibly change beside it would be the same
       engine/meter contradiction p1-photo-truth-1.2.0 was written to close —
       just in the other direction.
       ⛔ `applied` still means WHOLE MATCH and is still false here: a partial
       read must never be presented as a match, and the gate that decides that
       (examined >= 10 && claimed >= 6, plus the engine's own whole-read
       refusal) is untouched above. `partialApplied` is the count the engine
       reports for THIS read; zero means the engine applied nothing and the old
       words are the true ones. */
    var partialShown = !applyEligible && partialCount > 0;
    var level = applyEligible && score >= 76 && claimed >= 8 ? 'strong' : (applyEligible ? 'usable' : 'limited');
    var heading = level === 'strong' ? 'Strong animated match' :
      (level === 'usable' ? 'Animated match applied' :
        (partialShown ? 'Partial read applied' : 'No animated traits changed'));
    var detail = examined
      ? (partialShown
        ? ('Applied ' + partialCount + ' of ' + examined + '; ' + (examined - partialCount) +
           ' could not be read — retake in better light to refine. This is a partial read, not a match.')
        : (claimed + ' of ' + examined + ' details were readable; ' +
           (applyEligible ? (refused + ' left unchanged') : 'the match was incomplete, so all character settings stayed unchanged')))
      : 'No appearance details were changed';
    return { score: score, level: level, heading: heading, detail: detail,
      applied: applyEligible, partial: partialShown, partialApplied: partialCount };
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
      '.mlsP1FaceModeHelp .mlsP1FaceProvenance{display:block;margin-top:5px;color:#69736d;font-size:11px}' +
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
      help.innerHTML = '<strong>Your photo is the patient-facing face</strong>This is the exact portrait patients see. It keeps the closest likeness and moves gently with speaking and listening.<span class="mlsP1FaceProvenance">Matched field badges distinguish on-device pixels, the second vision read, and your manual settings.</span>';
      previewSub.textContent = 'Actual patient view — your saved camera portrait, with subtle voice and listening movement.';
    } else if (photo && kind === 'photo-unreadable') {
      /* p1-photo-fallback-1.0.0 — DO NOT TELL HIM TO TAKE A PHOTO HE CAN SEE
         HE ALREADY TOOK. The saved portrait exists and the browser could not
         decode it, so the animated character is standing in. That is a
         different sentence from "no portrait yet", and the engine now
         distinguishes the two states so this can say which one it is. */
      help.innerHTML = '<strong>Your saved portrait could not be opened</strong>The stored photo did not decode, so the animated face below is what patients are seeing right now. Taking a new photo replaces it.<span class="mlsP1FaceProvenance">Nothing was changed about your saved appearance settings.</span>';
      previewSub.textContent = 'Current patient fallback — your saved photo could not be opened, so this is what patients see.';
    } else if (photo) {
      help.innerHTML = '<strong>Take a photo to use photo mode</strong>No portrait is available yet, so the animated fallback shown here is what patients would see.<span class="mlsP1FaceProvenance">Photo mode is recommended whenever a valid portrait is available.</span>';
      previewSub.textContent = 'Current patient fallback — take a camera portrait to replace it with your photo.';
    } else {
      help.innerHTML = '<strong>The animated face is patient-facing</strong>It is an approximate illustrated likeness: matched fields below inform the character, but it is not a photo likeness. It makes eye contact, changes expression, and moves its mouth with the selected voice.<span class="mlsP1FaceProvenance">Badges identify on-device pixels, the second vision read, or your manual setting; refused fields stay unchanged.</span>';
      previewSub.textContent = 'Live patient preview — expressions and speaking use this same face.';
    }
  }

  function updateMeter(meter, receipt, wholeReadRefusal, partialApplied) {
    if (!meter) return;
    var summary = summarizeReceipt(receipt, wholeReadRefusal, partialApplied);
    meter.setAttribute('data-level', summary.level);
    meter.setAttribute('aria-label', summary.heading + '. ' + summary.detail + '. Evidence coverage ' + summary.score + ' percent.');
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

    var noteAttrs = [priorAttr(note, 'role'), priorAttr(note, 'aria-live'), priorAttr(note, 'aria-atomic')];
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
    var matchAttrs = matchButton ? [priorAttr(matchButton, 'aria-controls')] : [];
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
        /* p1-face-studio-poll-1.1.0 — THE METER USED TO STOP LOOKING.
           Owner, 2026-08-13: "this never loads", with a screenshot of this
           meter frozen on "Matching your photo…" while the engine's own
           refusal was already printed underneath it. The poll gave up after
           30 ticks of 150ms — FOUR AND A HALF SECONDS — and gave up SILENTLY,
           so a match that took longer than a warm round trip (a cold backend
           is routinely 10-30s) left a permanent spinner that no later result
           could ever clear. The engine now bounds its own vision read at 30s,
           so this outlasts that deadline instead of expiring inside it, and
           when it does expire it SAYS SO. A meter that stops looking must
           never look like a meter that is still working. */
        var POLL_DEADLINE_MS = 45000;
        var polledMs = 0;
        (function poll() {
          var owner = window.__mlsAvatar;
          var latest = owner && owner.lastMatchReceipt;
          if (latest && latest.receipt && Number(latest.at || 0) > before && Number(latest.at || 0) >= startedAt) {
            var partialCount = (latest.partialApplied && latest.partialApplied.length) || 0;
            updateMeter(meter, latest.receipt, latest.wholeReadRefusal === true, partialCount);
            if (latest.wholeReadRefusal || Number(latest.receipt.refused || 0) > Number(latest.receipt.claimed || 0)) details.open = true;
            return;
          }
          if (polledMs >= POLL_DEADLINE_MS) {
            meter.setAttribute('data-level', 'limited');
            if (mh) mh.textContent = 'The match did not finish';
            if (md) md.textContent = 'No animated traits were changed. Check the message below, then try Match my photo again.';
            details.open = true;
            return;
          }
          /* 150ms while a warm match is plausible, then a second apart: the
             doctor cannot see a difference and a 45-second window does not
             need 300 timers to watch one variable. */
          var step = polledMs < 4500 ? 150 : 1000;
          polledMs += step;
          later(poll, step);
        }());
      });
    }

    enhanced.push({ stage: stage, wrap: wrap, grid: grid, preview: preview, sub: sub,
      details: details, help: help, mode: mode, note: note, noteAttrs: noteAttrs,
      matchButton: matchButton, matchAttrs: matchAttrs });
    return true;
  }

  function reconcile() {
    if (!active()) return false;
    pruneDetached();
    var stages = document.querySelectorAll ? document.querySelectorAll('#mlsAvLookStage') : [];
    for (var i = 0; i < stages.length; i++) enhance(stages[i]);
    /* Core swaps the stage contents immediately after a new capture. Keep the
       explanatory copy tied to what is really in that same patient preview. */
    for (var j = 0; j < enhanced.length; j++) {
      var row = enhanced[j];
      if (row.stage && row.stage.parentNode) updateModeHelp(row.mode, row.help, row.sub, row.stage);
    }
    return true;
  }

  function revert() {
    /* Teardown is an ownership operation, not a preview activity. If the
       preview marker is withdrawn while a bundle is live, its exact controller
       must still be able to remove this installation cleanly. */
    if (!owned()) return false;
    if (observer) { try { observer.disconnect(); } catch (e1) {} observer = null; }
    clearPollTimers();
    for (var i = 0; i < eventRows.length; i++) {
      try { eventRows[i][0].removeEventListener(eventRows[i][1], eventRows[i][2], false); } catch (e2) {}
    }
    eventRows = [];
    for (var j = 0; j < enhanced.length; j++) {
      var row = enhanced[j];
      restoreAttrs(row.note, row.noteAttrs);
      restoreAttrs(row.matchButton, row.matchAttrs);
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
    owner.installed = false;
    if (window.__mlsAvatarFaceStudio === owner) {
      try { delete window.__mlsAvatarFaceStudio; } catch (e5) { window.__mlsAvatarFaceStudio = null; }
    }
    return true;
  }

  owner = {
    installed: true,
    version: VERSION,
    installToken: installToken,
    reconcile: reconcile,
    summarizeReceipt: summarizeReceipt,
    revert: revert
  };
  window.__mlsAvatarFaceStudio = owner;
  try {
    style();
    reconcile();
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(reconcile);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    window.addEventListener('mls:settings-reconciled', reconcile, false);
  } catch (installError) {
    /* Do not leave a half-installed API for the loader to receipt as ready.
       Its onload check will see owner-missing and make one bounded retry. */
    try { revert(); } catch (rollbackError) {
      owner.installed = false;
      if (window.__mlsAvatarFaceStudio === owner) {
        try { delete window.__mlsAvatarFaceStudio; } catch (deleteError) { window.__mlsAvatarFaceStudio = null; }
      }
    }
  }
}());
