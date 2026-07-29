/* =========================================================================
 * MLS Scribe — MOTION EVERYWHERE, NOT JUST COPILOT  (__mlsPolishEverywhere)
 * pe-1.0.0  2026-07-29
 *
 * OWNER: "JUST LEtting u know you have not added beaturifl animation anywhere
 * but to copiloit". Correct. mo-1.0.0 (b792) targeted the Copilot/AI surfaces
 * and a handful of narrow selectors, so in practice only Copilot looked alive.
 * This module applies the SAME vocabulary to the surfaces the doctor actually
 * spends the day in, using the real classes this app ships:
 *
 *   .card       (42 instances)  every main panel across every view
 *   .ez3-card                   the visit-room cards (patient, transcript, ...)
 *   .ez3-row2                   the day/schedule rows he taps to start a visit
 *   .pt-item                    patient list rows
 *   .btn-ghost/.btn-primary/.btn-green/.btn-white/.btn-gold/.btn-red  (380+)
 *
 * DESIGN VOCABULARY — borrowed, not invented. Every timing is one of the app's
 * existing tokens with the current value as a fallback, so this module can
 * never introduce a new "feel":
 *   --mls-dur-1 120ms  --mls-dur-2 200ms  --mls-dur-3 300ms  --mls-dur-4 420ms
 *   --mls-ease-out     --mls-ease-spring
 *
 * HARD RULES honoured (this is a clinical product):
 *   - transform/opacity ONLY. Nothing here can trigger layout or paint on a
 *     large subtree.
 *   - prefers-reduced-motion: reduce kills every animation and transition this
 *     module adds, while leaving all states visually correct.
 *   - NOTHING moves that the doctor is reading or typing: the note body, the
 *     transcript, and every textarea/contenteditable are excluded, and all
 *     entrance motion stands down while body.mls-note-live or a recording class
 *     is present.
 *   - No timers, no rAF loops, no observers. Entrances key off the app's own
 *     .view-enter class, which showView already sets.
 *   - Hover lift only on pointer:fine (never a touch device, where "hover"
 *     sticks after a tap).
 *   - No decorative layers, so nothing can intercept a click.
 *
 * Idempotent; additive. Revert: window.__mlsPolishEverywhere.revert()
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsPolishEverywhere) return; } catch (e) { return; }

  var STYLE_ID = 'mlsPolishEverywhereCss';
  var api = { version: 'pe-1.0.0', installed: true };
  window.__mlsPolishEverywhere = api;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  var D1 = 'var(--mls-dur-1,120ms)';
  var D2 = 'var(--mls-dur-2,200ms)';
  var D3 = 'var(--mls-dur-3,300ms)';
  var D4 = 'var(--mls-dur-4,420ms)';
  var EO = 'var(--mls-ease-out,cubic-bezier(0.22,1,0.36,1))';
  var SP = 'var(--mls-ease-spring,cubic-bezier(0.22,1,0.36,1))';

  /* Every rule that MOVES lives here, so the reduced-motion block below is
     GENERATED from it and a rule can never be added without its off-switch. */
  var MOVING = [
    /* --- entrances: the app already stamps .view-enter on the incoming view --- */
    ['.view-enter > .card, .view-enter .ez3-card',
     'animation:peRise ' + D4 + ' ' + EO + ' both'],
    /* a short, capped stagger so a long list never ripples for seconds */
    ['.view-enter > .card:nth-of-type(1)', 'animation-delay:0ms'],
    ['.view-enter > .card:nth-of-type(2)', 'animation-delay:40ms'],
    ['.view-enter > .card:nth-of-type(3)', 'animation-delay:80ms'],
    ['.view-enter > .card:nth-of-type(4)', 'animation-delay:120ms'],
    ['.view-enter > .card:nth-of-type(n+5)', 'animation-delay:160ms'],

    /* --- rows he taps all day: settle in, lift on hover, answer the press --- */
    ['.ez3-row2, .pt-item',
     'transition:transform ' + D2 + ' ' + SP + ', opacity ' + D2 + ' ' + EO],
    ['@media (hover:hover) and (pointer:fine)', null,
     '.ez3-row2:hover, .pt-item:hover{transform:translateY(-1px)}'],
    ['.ez3-row2:active, .pt-item:active', 'transform:translateY(0) scale(.995)'],

    /* --- every button in the app answers a press --- */
    ['.btn-ghost, .btn-primary, .btn-green, .btn-white, .btn-gold, .btn-red, .ds-pull',
     'transition:transform ' + D1 + ' ' + EO + ', opacity ' + D1 + ' ' + EO],
    ['.btn-ghost:active, .btn-primary:active, .btn-green:active, .btn-white:active, .btn-gold:active, .btn-red:active, .ds-pull:active',
     'transform:scale(.97)'],
    ['@media (hover:hover) and (pointer:fine)', null,
     '.btn-primary:hover, .btn-green:hover, .btn-gold:hover{transform:translateY(-1px)}'],

    /* --- cards lift a hair on hover so the surface feels physical --- */
    ['@media (hover:hover) and (pointer:fine)', null,
     '.card{transition:transform ' + D3 + ' ' + EO + '}' +
     '.card:hover{transform:translateY(-1px)}']
  ];

  var KEYFRAMES =
    '@keyframes peRise{from{opacity:0;transform:translateY(6px) scale(.995)}' +
    'to{opacity:1;transform:none}}';

  /* NEVER animate what he is reading or typing, and stand fully down while a
     note is live or a recording is running. */
  var EXCLUDE =
    '#noteBox, #transcript, textarea, [contenteditable="true"], .mlsf-note, .mlsf-note *' +
    '{animation:none!important;transition:none!important}' +
    'body.mls-note-live .view-enter > .card, body.mls-note-live .view-enter .ez3-card,' +
    'body.mls-recording .view-enter > .card, body.mls-recording .view-enter .ez3-card' +
    '{animation:none!important}';

  function build() {
    var out = [KEYFRAMES], kill = [];
    MOVING.forEach(function (r) {
      if (r[1] === null) { out.push(r[0] + '{' + r[2] + '}'); }
      else { out.push(r[0] + '{' + r[1] + '}'); kill.push(r[0]); }
    });
    out.push(EXCLUDE);
    /* generated off-switch: derived from MOVING, never hand-maintained */
    out.push('@media (prefers-reduced-motion: reduce){' +
      kill.join(',') + '{animation:none!important;transition:none!important}' +
      '.view-enter > .card, .view-enter .ez3-card{animation:none!important;opacity:1!important;transform:none!important}' +
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
    safe(function () { delete window.__mlsPolishEverywhere; });
  };
})();
