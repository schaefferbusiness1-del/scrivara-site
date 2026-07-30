/* =========================================================================
 * MLS Scribe — THE MOMENTS  (__mlsMagic) mg-1.0.0   2026-07-29
 *
 * OWNER: "really just make the site feel majical".
 *
 * Magic is not more motion. mo-1.0.0 owns the Copilot ring, pe-1.0.0 owns the
 * everyday entrances and press feedback. This layer owns the handful of MOMENTS
 * that carry meaning — the instants where the app should feel like it noticed
 * what just happened:
 *
 *   1. A NOTE ARRIVES.  The note card lifts in as though authored, not pasted.
 *      The card CHROME only — never the clinical text he is about to read, and
 *      never a typewriter effect on a medical record.
 *   2. SOMETHING COMPLETES.  A signature, a verified chart, a finished pull get
 *      a check that DRAWS ITSELF (stroke-dashoffset on an existing glyph) and a
 *      single dignified settle. No confetti; this is a medical record.
 *   3. A STAGE ADVANCES.  The visit rail's current dot gets one soft pulse so
 *      progress is felt, not just displayed.
 *   4. WAITING.  A shimmer that travels by TRANSFORM across a placeholder,
 *      instead of a spinner that says nothing about progress.
 *   5. THE PATIENT CHANGES.  The existing banner content crossfades, so a
 *      switch reads as deliberate rather than as a flicker.
 *
 * REJECTED deliberately: confetti or celebration on clinical completion (wrong
 * register for a medical record); any typewriter/streaming effect on note text
 * (he must be able to read and trust it instantly); parallax or scroll-linked
 * motion (nausea risk, and it fights a doctor scanning a chart); sound.
 *
 * CONSTRAINTS honoured: transform/opacity/stroke-dashoffset only; every moving
 * rule is registered in MOMENTS so the reduced-motion block is GENERATED from
 * it; nothing animates clinical text; everything stands down while recording or
 * while a note is live; no timers, no rAF, no observers; decorative layers are
 * pointer-events:none; dark theme inherits because only opacity/transform and
 * currentColor are used.
 *
 * Idempotent; additive. Revert: window.__mlsMagic.revert()
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsMagic) return; } catch (e) { return; }

  var STYLE_ID = 'mlsMagicCss';
  var api = { version: 'mg-1.0.0', installed: true };
  window.__mlsMagic = api;
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  var D2 = 'var(--mls-dur-2,200ms)';
  var D3 = 'var(--mls-dur-3,300ms)';
  var D4 = 'var(--mls-dur-4,420ms)';
  var EO = 'var(--mls-ease-out,cubic-bezier(0.22,1,0.36,1))';

  /* Each entry: [selector, declarations]. The off-switch is derived from this. */
  var MOMENTS = [
    /* 1. the note arriving — chrome only */
    ['body.mls-note-live #noteCard',
     'animation:mgArrive ' + D4 + ' ' + EO + ' both'],

    /* 2. completion - one dignified settle.
       `.mg-drawn` (a check drawing itself via stroke-dashoffset) was REMOVED on
       2026-07-29: nothing ever added the class, and the visit stage rail already
       draws its own SVG check, so there was no element left for it to drive. A
       rule that cannot fire is deleted, not kept for the look of it. */
    ['.mg-settle',
     'animation:mgSettle ' + D3 + ' ' + EO + ' both'],

    /* 3. a stage advancing — one soft pulse on the current dot */
    ['#mlsStages .st.now .dot',
     'animation:mgPulse ' + D4 + ' ' + EO + ' both'],

    /* 4. waiting — a shimmer that TRAVELS, never a background-position tween.
       RETARGETED 2026-07-29: this used to require a `.mg-wait` class that NOTHING
       in the repo ever added, so the moment could not fire. `.pp-wait` is a class
       the pull panel really emits for a patient being read right now, so the
       shimmer now lands on the one place in the app that genuinely means
       "waiting". A moment keyed to a class no writer sets is decoration, not a
       feature. */
    ['#mlsPullProgPanel .pp-wait',
     'position:relative;overflow:hidden'],
    ['#mlsPullProgPanel .pp-wait::after',
     'content:"";position:absolute;inset:0;pointer-events:none;' +
     'background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);' +
     'transform:translateX(-100%);animation:mgShimmer 1.4s linear infinite'],

    /* 5. the banner patient changing — crossfade the EXISTING content */
    ['#patientLabel, .mls-pt-banner-name',
     'transition:opacity ' + D2 + ' ' + EO],
    ['body.mg-pt-swap #patientLabel, body.mg-pt-swap .mls-pt-banner-name',
     'opacity:.35']
  ];

  var KEYFRAMES = [
    '@keyframes mgArrive{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}',
    '@keyframes mgSettle{0%{transform:scale(.94);opacity:.6}60%{transform:scale(1.01)}100%{transform:none;opacity:1}}',
    '@keyframes mgPulse{0%{transform:scale(1)}45%{transform:scale(1.18)}100%{transform:scale(1.15)}}',
    '@keyframes mgShimmer{to{transform:translateX(100%)}}'
  ].join('\n');

  /* Clinical text is never animated by this module, and every moment stands
     down while capture is live or a note is on screen being read. */
  var GUARDS =
    '#noteBox, #transcript, textarea, [contenteditable="true"], .mlsf-note, .mlsf-note *' +
    '{animation:none!important}' +
    'body.mls-recording .mg-settle,' +
    'body.mls-recording #mlsStages .st.now .dot, body.mls-recording #mlsPullProgPanel .pp-wait::after' +
    '{animation:none!important}';

  function build() {
    var out = [KEYFRAMES], kill = [];
    MOMENTS.forEach(function (m) {
      out.push(m[0] + '{' + m[1] + '}');
      if (/animation|transition/.test(m[1])) kill.push(m[0]);
    });
    out.push(GUARDS);
    out.push('@media (prefers-reduced-motion: reduce){' +
      kill.join(',') + '{animation:none!important;transition:none!important}' +
      'body.mls-note-live #noteCard{opacity:1!important;transform:none!important}' +
      '#mlsPullProgPanel .pp-wait::after{animation:none!important;opacity:0!important}' +
      '#mlsStages .st.now .dot{transform:scale(1.15)!important}' +
      '}');
    return out.join('\n');
  }
  api.css = build;

  safe(function () {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = build();
    (document.head || document.documentElement).appendChild(st);
  });

  /* =========================================================================
     2026-07-29 — THE MOMENTS ARE WIRED. Owner: "WHERE IS ALL THE MAJIC".

     He was right and the answer was embarrassing: this module shipped a
     stylesheet and NOTHING ELSE. A repo-wide sweep found ZERO writers for every
     class it keys off — `.mg-drawn` 0, `.mg-settle` 0, `.mg-wait` 0,
     `body.mg-pt-swap` 0 (its only mention was the remove() in revert), and
     `body.mls-note-live` 0 despite FOUR modules styling on it. Five moments,
     none of which could ever fire. It was dead CSS.

     Now it listens to events the app REALLY dispatches, verified by grep:
       mls:generation-complete  — ScribeFlow.html:19484, :19487, :19543
       mls:active-patient-changed
     No polling, no observer, no rAF. Two window listeners, both removed by
     revert(). The transient swap class is cleared on `transitionend` — the
     animation's own completion — with ONE bounded fallback timeout in case
     reduced-motion means no transition ever runs, so the class cannot latch.
     A single one-shot is not the timer LOOP the header forbids.

     body.mls-note-live is the valuable one: setting it truthfully also makes the
     stand-downs in three other modules real for the first time. */
  var listeners = [];
  var swapTimer = 0;
  function on(target, name, fn) {
    safe(function () { target.addEventListener(name, fn, false); listeners.push([target, name, fn]); });
  }

  function noteLive(yes) {
    safe(function () { document.body.classList.toggle('mls-note-live', !!yes); });
  }

  /* A note just arrived: the card lifts in, and the whole app now knows a note is
     on screen. */
  on(window, 'mls:generation-complete', function () {
    noteLive(true);
    safe(function () {
      var card = document.getElementById('noteCard');
      if (!card) return;
      /* restart the entrance even if the class is already there */
      card.classList.remove('mg-settle');
      void card.offsetWidth;
      card.classList.add('mg-settle');
    });
  });

  /* The patient changed: crossfade what the banner already shows, and stand the
     note-live state down because the new patient has no note yet. */
  on(window, 'mls:active-patient-changed', function () {
    noteLive(false);
    safe(function () {
      var b = document.body;
      b.classList.add('mg-pt-swap');
      var clear = function () { safe(function () { b.classList.remove('mg-pt-swap'); }); };
      var label = document.getElementById('patientLabel');
      if (label) safe(function () { label.addEventListener('transitionend', clear, { once: true }); });
      if (swapTimer) clearTimeout(swapTimer);
      swapTimer = setTimeout(clear, 700);   /* one bounded fallback, not a loop */
    });
  });

  api.revert = function () {
    safe(function () { if (swapTimer) clearTimeout(swapTimer); swapTimer = 0; });
    safe(function () {
      listeners.forEach(function (l) { safe(function () { l[0].removeEventListener(l[1], l[2], false); }); });
      listeners.length = 0;
    });
    safe(function () { document.body.classList.remove('mls-note-live'); });
    safe(function () {
      var st = document.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
    });
    safe(function () {
      ['mg-settle'].forEach(function (c) {
        var els = document.querySelectorAll('.' + c);
        for (var i = 0; i < els.length; i++) els[i].classList.remove(c);
      });
      document.body.classList.remove('mg-pt-swap');
    });
    safe(function () { delete window.__mlsMagic; });
  };
})();
