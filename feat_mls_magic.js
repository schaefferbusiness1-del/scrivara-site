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

    /* 2. completion — a check that draws itself, and one settle */
    ['.mg-drawn',
     'animation:mgDraw ' + D4 + ' ' + EO + ' both'],
    ['.mg-settle',
     'animation:mgSettle ' + D3 + ' ' + EO + ' both'],

    /* 3. a stage advancing — one soft pulse on the current dot */
    ['#mlsStages .st.now .dot',
     'animation:mgPulse ' + D4 + ' ' + EO + ' both'],

    /* 4. waiting — a shimmer that TRAVELS, never a background-position tween */
    ['.mg-wait',
     'position:relative;overflow:hidden'],
    ['.mg-wait::after',
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
    '@keyframes mgDraw{from{stroke-dashoffset:var(--mg-len,24)}to{stroke-dashoffset:0}}',
    '@keyframes mgSettle{0%{transform:scale(.94);opacity:.6}60%{transform:scale(1.01)}100%{transform:none;opacity:1}}',
    '@keyframes mgPulse{0%{transform:scale(1)}45%{transform:scale(1.18)}100%{transform:scale(1.15)}}',
    '@keyframes mgShimmer{to{transform:translateX(100%)}}'
  ].join('\n');

  /* Clinical text is never animated by this module, and every moment stands
     down while capture is live or a note is on screen being read. */
  var GUARDS =
    '#noteBox, #transcript, textarea, [contenteditable="true"], .mlsf-note, .mlsf-note *' +
    '{animation:none!important}' +
    'body.mls-recording .mg-drawn, body.mls-recording .mg-settle,' +
    'body.mls-recording #mlsStages .st.now .dot, body.mls-recording .mg-wait::after' +
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
      '.mg-drawn{stroke-dashoffset:0!important}' +
      '.mg-wait::after{animation:none!important;opacity:0!important}' +
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

  api.revert = function () {
    safe(function () {
      var st = document.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
    });
    safe(function () {
      ['mg-drawn', 'mg-settle', 'mg-wait'].forEach(function (c) {
        var els = document.querySelectorAll('.' + c);
        for (var i = 0; i < els.length; i++) els[i].classList.remove(c);
      });
      document.body.classList.remove('mg-pt-swap');
    });
    safe(function () { delete window.__mlsMagic; });
  };
})();
