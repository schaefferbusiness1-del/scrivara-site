/* =============================================================================
 * __mlsDictateAnywhere  da-1.0.3   (2026-07-15, owner directive)
 * -----------------------------------------------------------------------------
 * "There is always a chance to dictate into any text box."
 * Focus any textarea / text-ish input / contenteditable in MLS Scribe and a
 * small mic chip appears at the field's corner. Click it, talk, and the words
 * are inserted as plain text at the caret. Click again to stop. That's all.
 *
 * Guarantees:
 *  - NOTHING network- or Athena-facing: the Web Speech API result is inserted
 *    into the focused field only, exactly like typing.
 *  - Fail-safe: no SpeechRecognition support -> module inert; recognition
 *    error -> calm toast, state reset.
 *  - Freeze-safe: ZERO MutationObservers. One focusin/focusout listener pair
 *    plus scroll/resize repositioning while visible.
 *  - Never steals focus: mousedown on the chip is preventDefault'ed so the
 *    field keeps focus; recognition inserts at the caret position.
 *  - Opt-out: any field with [data-mls-no-dictate] is skipped (password,
 *    date/number/etc. never qualify in the first place).
 * Reversible: window.__mlsDictateAnywhere.revert(). ASCII-only.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__mlsDictateAnywhere) return;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var api = { installed: true, version: 'da-1.0.3', supported: !!SR, starts: 0 };
  window.__mlsDictateAnywhere = api;
  if (!SR) { api.revert = function () {}; return; }

  var CHIP_ID = 'mlsDaChip';
  var DOCK_ID = 'mlsDaDock';
  var STYLE_ID = 'mlsDaCss';
  var field = null;      /* the field the chip is attached to */
  var lastField = null;  /* survives blur - the bottom dock targets this */
  var rec = null;        /* active recognition */
  var listening = false;
  var recognitionEpoch = 0;
  var recognitionTarget = null;
  var recognitionBinding = null;
  var recognitionBindingEpoch = null;
  var hideT = null;
  var moveRaf = null;
  var unregisterSpeech = null;

  function speechHub() {
    try { if (typeof window.mlsSpeechHub === 'function') return window.mlsSpeechHub(); } catch (e) {}
    try { if (window.__mlsSpeechHub && typeof window.__mlsSpeechHub.claim === 'function') return window.__mlsSpeechHub; } catch (e2) {}
    return null;
  }
  function registerSpeech() {
    var h = speechHub();
    if (!h || unregisterSpeech) return h;
    unregisterSpeech = h.register('dictate', 'Dictate', function () {
      if (listening) stop();
    });
    return h;
  }
  function releaseSpeech() { try { var h = speechHub(); if (h) h.release('dictate'); } catch (e) {} }

  function isVisitField(el) {
    var id = el && el.id ? String(el.id) : '';
    return id === 'transcript' || id === 'noteBox' || id === 'patientLabel'
      || id === 'ez3Transcript' || id === 'ez3Note' || id === 'mlsProtoScratch';
  }
  function captureVisitToken(target) {
    var binding = null, epoch = null;
    try { binding = (typeof currentVisitAthenaBinding !== 'undefined') ? currentVisitAthenaBinding : null; } catch (e) {}
    /* A clinical field must be owned before the first spoken word. This closes
       the blank-editor window where a later patient switch could otherwise
       reuse the same DOM field before its first input event establishes it. */
    if (!binding && isVisitField(target)) {
      try {
        if (typeof window._athenaBindingForCurrentVisit === 'function' && typeof window._athenaSetVisitBinding === 'function') {
          var candidate = window._athenaBindingForCurrentVisit('field-dictation');
          if (candidate) window._athenaSetVisitBinding(candidate);
          binding = (typeof currentVisitAthenaBinding !== 'undefined') ? currentVisitAthenaBinding : null;
        }
      } catch (e2) {}
    }
    try { epoch = (typeof currentVisitAthenaEpoch !== 'undefined') ? currentVisitAthenaEpoch : null; } catch (e3) {}
    return { binding: binding, epoch: epoch };
  }
  function visitTokenStillSafe(target, binding, epoch) {
    try { if (!target || !document.contains(target) || target !== recognitionTarget) return false; } catch (e) { return false; }
    if (isVisitField(target) && !binding) return false;
    if (binding) {
      try {
        return typeof window._athenaAsyncBindingStillSafe === 'function'
          && window._athenaAsyncBindingStillSafe(binding, 'field dictation', epoch);
      } catch (e2) { return false; }
    }
    try {
      return epoch == null || (typeof currentVisitAthenaEpoch !== 'undefined' && Number(epoch) === Number(currentVisitAthenaEpoch));
    } catch (e3) { return false; }
  }

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + CHIP_ID + '{position:fixed;z-index:2147483000;display:none;align-items:center;gap:6px;',
      '  background:#fff;border:1px solid #D9D6CD;border-radius:999px;padding:4px 10px;cursor:pointer;',
      '  font:600 11.5px "Public Sans",system-ui,sans-serif;color:#55605A;box-shadow:0 1px 2px rgba(20,33,28,.08),0 6px 18px -8px rgba(20,33,28,.22);',
      '  transition:color .15s ease,border-color .15s ease;user-select:none;}',
      '#' + CHIP_ID + ':hover{color:#1A211C;border-color:#B9C7BE;}',
      '#' + CHIP_ID + ' .da-dot{width:7px;height:7px;border-radius:50%;background:#8A8F86;flex:0 0 auto;}',
      '#' + CHIP_ID + '.on{color:#B23B3B;border-color:#EAD3CE;background:#FBF1EF;}',
      '#' + CHIP_ID + '.on .da-dot{background:#B23B3B;animation:mlsDaPulse 1.1s ease-in-out infinite;}',
      '@keyframes mlsDaPulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.45;transform:scale(.8);}}',
      /* the always-there bottom dock */
      '#' + DOCK_ID + '{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:2147482900;',
      '  display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #D9D6CD;border-radius:999px;',
      '  padding:8px 15px;cursor:pointer;font:600 12.5px "Public Sans",system-ui,sans-serif;color:#55605A;',
      '  box-shadow:0 1px 2px rgba(20,33,28,.08),0 8px 22px -10px rgba(20,33,28,.28);}',
      '#' + DOCK_ID + ':hover{color:#1A211C;border-color:#B9C7BE;}',
      '#' + DOCK_ID + ' .da-dot{width:7px;height:7px;border-radius:50%;background:#2E6A4B;}',
      '#' + DOCK_ID + '.on{color:#B23B3B;border-color:#EAD3CE;background:#FBF1EF;}',
      '#' + DOCK_ID + '.on .da-dot{background:#B23B3B;animation:mlsDaPulse 1.1s ease-in-out infinite;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function chip() {
    var c = document.getElementById(CHIP_ID);
    if (c) return c;
    c = document.createElement('div');
    c.id = CHIP_ID;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', 'Dictate into this field');
    c.innerHTML = '<span class="da-dot"></span><span class="da-t">Dictate</span>';
    /* keep the field focused - the chip must never steal the caret */
    c.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    c.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (listening) stop(); else start();
    });
    document.body.appendChild(c);
    return c;
  }

  function eligible(el) {
    if (!el || el.getAttribute && el.getAttribute('data-mls-no-dictate') != null) return false;
    if (el.disabled || el.readOnly) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      var t = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url', 'tel'].indexOf(t) !== -1;
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function place() {
    var c = document.getElementById(CHIP_ID);
    if (!c || !field || c.style.display === 'none') return;
    try {
      var r = field.getBoundingClientRect();
      if (!r.width && !r.height) { hide(); return; }
      var chipWidth = c.offsetWidth;
      var top = r.top - 13;
      if (top < 4) top = r.bottom + 5;
      var nextTop = Math.round(top) + 'px';
      var nextLeft = Math.round(Math.max(8, r.right - chipWidth - 10)) + 'px';
      if (c.style.top !== nextTop) c.style.top = nextTop;
      if (c.style.left !== nextLeft) c.style.left = nextLeft;
    } catch (e) {}
  }

  function show(el) {
    field = el;
    css();
    var c = chip();
    c.style.display = 'flex';
    setLabel();
    place();
  }
  function hide() {
    if (listening) return;           /* keep visible while dictating */
    var c = document.getElementById(CHIP_ID);
    if (c) c.style.display = 'none';
    field = null;
  }
  function setLabel() {
    var c = document.getElementById(CHIP_ID);
    if (c) {
      c.classList.toggle('on', listening);
      var t = c.querySelector('.da-t');
      if (t) t.textContent = listening ? 'Listening - click to stop' : 'Dictate';
    }
    try { syncDock(); } catch (e) {}
  }

  function insertText(el, text) {
    if (!text) return;
    try {
      if (el.isContentEditable) {
        el.focus();
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      var v = el.value != null ? String(el.value) : '';
      var s = el.selectionStart != null ? el.selectionStart : v.length;
      var epos = el.selectionEnd != null ? el.selectionEnd : s;
      /* natural spacing: add a leading space when gluing onto a word */
      var lead = (s > 0 && !/[\s(\[{"'-]$/.test(v.slice(0, s))) ? ' ' : '';
      var ins = lead + text;
      el.value = v.slice(0, s) + ins + v.slice(epos);
      var pos = s + ins.length;
      try { el.setSelectionRange(pos, pos); } catch (e2) {}
      /* fire the events the app's own listeners expect from typing */
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}
  }

  function start() {
    if (listening || !field) return;
    var target = field;
    var visitToken = captureVisitToken(target);
    if (isVisitField(target) && !visitToken.binding) {
      try { if (typeof window.toast === 'function') window.toast('Open the correct patient visit before dictating into this field.', 'err'); } catch (e00) {}
      return;
    }
    var h = registerSpeech();
    var lease = h ? h.claim('dictate') : { ok: true, previous: null };
    if (!lease || lease.ok === false) {
      try { if (typeof window.toast === 'function') window.toast('Dictate could not take control of the microphone. Try again.', 'err'); } catch (e0) {}
      return;
    }
    if (lease.previous) {
      try { if (typeof window.toast === 'function') window.toast('Stopped ' + lease.previous.label + ' so Dictate can use the microphone. Any visit transcript already captured is safe.', ''); } catch (e1) {}
    }
    try {
      var instance = new SR();
      rec = instance;
      var sessionEpoch = ++recognitionEpoch;
      recognitionTarget = target;
      recognitionBinding = visitToken.binding;
      recognitionBindingEpoch = visitToken.epoch;
      instance.lang = (navigator.language && /^en/i.test(navigator.language)) ? navigator.language : 'en-US';
      instance.continuous = true;
      instance.interimResults = false;
      instance.onresult = function (ev) {
        if (instance !== rec || !listening || sessionEpoch !== recognitionEpoch
            || !visitTokenStillSafe(target, recognitionBinding, recognitionBindingEpoch)) {
          if (instance === rec) {
            /* The immutable-binding helper already explains a bound-visit
               mismatch. A non-visit field only needs our generic notice. */
            if (!recognitionBinding) {
              try { if (typeof window.toast === 'function') window.toast('The visit changed, so that older dictation was discarded. Nothing changed in Athena.', 'err'); } catch (e0) {}
            }
            stop();
          }
          return;
        }
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) insertText(target, ev.results[i][0].transcript.trim());
        }
      };
      instance.onerror = function (ev) {
        if (instance !== rec) return;
        var why = ev && ev.error === 'not-allowed' ? 'Microphone permission is blocked for this site.' :
                  ev && ev.error === 'no-speech' ? null : 'Dictation stopped (' + ((ev && ev.error) || 'error') + ').';
        if (why) { try { if (typeof window.toast === 'function') window.toast(why, 'err'); } catch (e) {} }
        cleanup(instance);
      };
      instance.onend = function () { cleanup(instance); };
      instance.start();
      api.starts++;
      listening = true;
      setLabel();
    } catch (e) {
      cleanup();
      try { if (typeof window.toast === 'function') window.toast('Dictate could not start the microphone. Wait a moment, then try again.', 'err'); } catch (e2) {}
    }
  }
  function stop() {
    var old = rec;
    recognitionEpoch++;
    rec = null;
    listening = false;
    recognitionTarget = null;
    recognitionBinding = null;
    recognitionBindingEpoch = null;
    releaseSpeech();
    try { if (old) old.stop(); } catch (e) {}
    setLabel();
    if (!field || document.activeElement !== field) hide();
  }
  function cleanup(instance) {
    if (instance && instance !== rec) return;
    listening = false;
    rec = null;
    recognitionTarget = null;
    recognitionBinding = null;
    recognitionBindingEpoch = null;
    releaseSpeech();
    setLabel();
    /* if focus already left the field, finish the deferred hide */
    if (!field || document.activeElement !== field) hide();
  }

  /* ---- persistent bottom dock: dictate into the LAST-focused text box ---- */
  function dock() {
    var d = document.getElementById(DOCK_ID);
    if (d) return d;
    css();
    d = document.createElement('button');
    d.type = 'button'; d.id = DOCK_ID;
    d.innerHTML = '<span class="da-dot"></span><span class="da-t">Dictate</span>';
    d.title = 'Dictate into the text box you last clicked';
    d.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (listening) { stop(); return; }
      var t = (field && document.contains(field)) ? field
            : (lastField && document.contains(lastField) && lastField.getBoundingClientRect().height > 0) ? lastField : null;
      if (!t) { try { if (typeof window.toast === 'function') window.toast('Click into a text box first, then hit Dictate.', 'err'); } catch (e2) {} return; }
      field = t;
      try { t.focus(); } catch (e3) {}
      start();
      syncDock();
    });
    (document.body || document.documentElement).appendChild(d);
    return d;
  }
  function syncDock() {
    var d = document.getElementById(DOCK_ID);
    if (!d) return;
    d.classList.toggle('on', listening);
    var t = d.querySelector('.da-t');
    if (t) t.textContent = listening ? 'Listening - tap to stop' : 'Dictate';
  }
  if (document.body) dock(); else document.addEventListener('DOMContentLoaded', function () { dock(); }, { once: true });

  function onFocusIn(e) {
    var el = e.target;
    if (hideT) { clearTimeout(hideT); hideT = null; }
    if (eligible(el)) { lastField = el; show(el); }
    else if (!listening) hide();
  }
  function onFocusOut() {
    if (listening) return;   /* chip stays while dictating */
    if (hideT) clearTimeout(hideT);
    hideT = setTimeout(function () {
      hideT = null;
      if (!listening && document.activeElement !== field) hide();
    }, 160);
  }
  function onMove() {
    if (moveRaf != null) return;
    var run = function () { moveRaf = null; place(); };
    moveRaf = window.requestAnimationFrame ? window.requestAnimationFrame(run) : setTimeout(run, 16);
  }

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', onMove, { capture: true, passive: true });
  window.addEventListener('resize', onMove, { passive: true });

  api.revert = function () {
    try { stop(); } catch (e) {}
    try { if (unregisterSpeech) unregisterSpeech(); } catch (e0) {}
    unregisterSpeech = null;
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    window.removeEventListener('scroll', onMove, true);
    window.removeEventListener('resize', onMove);
    try { if (moveRaf != null) { if (window.cancelAnimationFrame) window.cancelAnimationFrame(moveRaf); else clearTimeout(moveRaf); } } catch (e1) {}
    moveRaf = null;
    try { var c = document.getElementById(CHIP_ID); if (c) c.remove(); } catch (e) {}
    try { var dk = document.getElementById(DOCK_ID); if (dk) dk.remove(); } catch (e) {}
    try { var s = document.getElementById(STYLE_ID); if (s) s.remove(); } catch (e) {}
    api.installed = false;
    delete window.__mlsDictateAnywhere;
  };
  api.stop = stop;
  api.isListening = function () { return listening; };
})();
