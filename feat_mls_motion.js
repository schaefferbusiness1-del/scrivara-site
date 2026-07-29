/* MLS Motion — mo-1.0.0  (feat_mls_motion.js -> window.__mlsMotion)
 *
 * Owner, 2026-07-28, verbatim: "I want some awesome animations aple like added
 * to everything. Also like when copilot comes up have it have like a moving
 * ranbow boarder like apple siri stuff like that add awesome animations like
 * that everywhere" — and, emphatically, in the same breath: "make sure not to
 * break anything".
 *
 * Both halves of that are the brief. This file is additive decoration on a
 * clinical product: it injects ONE stylesheet, adds ONE body class, and does
 * nothing else. No handler is rebound, no markup is rewritten, no node is
 * moved. window.__mlsMotion.revert() takes the stylesheet and the class away
 * and the app is left exactly as a session where this file never loaded.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * MOTION_TOKENS.md is the standing law here and it already covers most of the
 * "everywhere" list. Redeclaring any of it would re-create the exact
 * incoherence that document exists to end ("eleven pulses and two spellings of
 * one curve"), so the incumbent wins in every one of these:
 *
 *   press feedback   ScribeFlow.html already ships a global
 *                    button:active{transform:scale(.97)} with !important. A
 *                    second .97 here would be a second spelling of one rule.
 *   hover lift       .btn-primary/.btn-green/.btn-red/.btn-gold/.btn-ghost
 *                    already lift 1px (ScribeFlow.html:1287-1288 plus
 *                    feat_mls_theme_polish.js). Adding another lift on top of
 *                    those would double the travel. This file gives a lift
 *                    ONLY to controls that have none today.
 *   modal entrance   .modal-bg.show and .modal-bg.show>.modal already fade and
 *                    lift (ScribeFlow.html:976-979).
 *   modal EXIT       not implemented, on purpose. A close animation requires
 *                    holding the node in the DOM past the close call, which is
 *                    a behaviour change to someone else's handler. Out of
 *                    scope for an additive polish satellite, and out of scope
 *                    for "make sure not to break anything".
 *   toasts           .toast / .toast.show already do the asymmetric
 *                    spring-in, quick-fade-out (ScribeFlow.html:960-963).
 *   view switching   ScribeFlow.html:10440 records the owner's REVERTED
 *                    verdict that "whole-view fades made every navigation feel
 *                    like a screen-level pop", and showView writes only
 *                    .style.display so a rule could not match anyway. No view
 *                    entrance is added. Section switches INSIDE a view — which
 *                    are class-driven and which the doctor triggers by hand —
 *                    are cross-faded instead.
 *
 * Every timing below is a token from that document. Nothing new invents a
 * number; the literals in the var() fallbacks are the page's own values, so a
 * surface that somehow gets this stylesheet without the page :root degrades to
 * the same feel rather than to none.
 *
 * ---------------------------------------------------------------------------
 * THE SIRI RING, AND WHY IT CANNOT REFLOW
 * ---------------------------------------------------------------------------
 * A single decorative ::before layer per Copilot surface:
 *
 *   position:absolute; inset:0 — OUT OF FLOW. It has no effect on its host's
 *     geometry or on any sibling's, in either direction, at any frame. That is
 *     the structural reason the ring cannot cause layout: there is no layout
 *     for it to be part of.
 *   inset:0 plus padding plus mask-composite:exclude — the gradient-border
 *     cutout. Both values are STATIC; the ring's box never changes size, so
 *     there is nothing for a frame to resize.
 *   the only animated value is --mls-mox-angle, a registered <angle> custom
 *     property consumed by conic-gradient(from ...). It is a paint-time input
 *     to one out-of-flow layer. It is not a layout property, it is not
 *     box-shadow, and it is not a filter.
 *   pointer-events:none — the ring can never intercept a click. It also masks
 *     down to a 2.2px band at the very edge, so it does not sit over anything
 *     a doctor would aim at even if it could. Measured in the harness: a
 *     hit-test 1px inside the band returns the dock itself.
 *
 * @property is registered so the angle INTERPOLATES. Where it is not
 * registered the interpolation is discrete instead: the value flips 0deg ->
 * 360deg once, and conic-gradient(from 0deg) and conic-gradient(from 360deg)
 * render identically — so the degraded case is a perfectly still ring, not a
 * flicker. There is a real @supports fallback underneath as well: the base
 * declaration is a static linear-gradient ring, and the conic background plus
 * its rotation only land inside @supports (background: conic-gradient(...)).
 *
 * Honest cost note, because this repo measures rather than asserts: a custom
 * property animation is NOT compositor-driven — it repaints its own layer each
 * frame. That is why the ring exists on exactly three surfaces, all of them
 * user-summoned AI surfaces, all absent from first paint, none present while
 * recording or on the note screen, and all off entirely under
 * prefers-reduced-motion.
 *
 * MEASURED, not asserted (law 5 of MOTION_TOKENS.md: a declaration is not
 * motion). Headless Chrome, synthetic harness, mean colour shift over 12
 * sampled points ON the ring band, two-sided:
 *
 *                                  control (same instant)   +3.5s
 *   normal                                   0.00            9.72   <- it moves
 *   prefers-reduced-motion: reduce           0.46            0.00   <- it stops
 *
 * and at +7.0s the shift is back to 1.05, i.e. exactly one revolution of the 7s
 * spin. Under reduced motion the ring is still fully VISIBLE (same chromatic
 * pixel count) — it is a still multi-colour band, not a missing one, which is
 * what "leave every state visually correct" has to mean.
 *
 * Do not try to verify this with getComputedStyle(el, '::before'). It reports
 * the INITIAL value of an animated registered custom property, not the live
 * one: measured "0deg" -> "0deg" while the ring was demonstrably rotating.
 * That is the instrument lying, and it cost a false defect report once already.
 *
 * ---------------------------------------------------------------------------
 * NO TIMERS, NO OBSERVERS — NOT EVEN A NARROW ONE
 * ---------------------------------------------------------------------------
 * Every surface this file animates is revealed by a class the app ALREADY
 * toggles (#copilotDock.open, .modal-bg.show, .set-tab-hidden, body.mls-sm-*)
 * or by a hover/focus state. CSS sees all of those for free. So there is no
 * setInterval, no setTimeout, no requestAnimationFrame loop and no
 * MutationObserver in this module at all — boot-script-budget.test.js counts
 * both interval and document-observer registrations against ceilings that are
 * currently AT their limit, and the cheapest way to be safe there is to need
 * neither.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NOT ONE animation-delay IN THIS FILE
 * ---------------------------------------------------------------------------
 * Law 3 of MOTION_TOKENS.md forbids `both`/`backwards` fill on a keyframe that
 * starts at opacity:0, because a surface that never gets to animate would then
 * be permanently invisible. That law and animation-delay are incompatible:
 * without a backwards fill, a delayed entrance renders the element NORMALLY
 * for the length of the delay, then snaps to opacity:0 and rises — a visible
 * blink, once per staggered child.
 *
 * So the stagger is baked into the keyframes instead. mlsMoxRise0..5 each hold
 * their from-state for a growing leading percentage of their own (growing)
 * duration, so every child still finishes ~300ms after it starts moving and
 * none of them carries a fill. "Never ran" and "finished" stay the same
 * picture: the element, in its own resting state, visible.
 *
 * ---------------------------------------------------------------------------
 * REDUCED MOTION IS DERIVED, NOT MAINTAINED
 * ---------------------------------------------------------------------------
 * Every rule that moves is declared in ONE table (MOTION) and nowhere else.
 * The prefers-reduced-motion block is generated from that table at inject
 * time, so a rule physically cannot be added to this file without its own kill
 * switch arriving with it.
 *
 * The kill switch clears `transform` only for the rules that actually set a
 * transform. Blanket-clearing it across every selector would have reached
 * app-owned transforms on modal children — an existing behaviour, changed by
 * a decoration module, which is the failure this whole file is written to
 * avoid.
 *
 * Everything here is transform/opacity/angle decoration over a state the CSS
 * already reaches statically, so switching all of it off leaves every state
 * visually correct: the modal is open, the tab is showing, the ring is a still
 * multi-colour band, the focus halo is simply there the instant focus lands.
 *
 * ---------------------------------------------------------------------------
 * NOTHING THE DOCTOR IS READING OR TYPING MOVES
 * ---------------------------------------------------------------------------
 * Structurally, not by promise. Every selector in this file is anchored to an
 * element id or to .modal-bg.show — there is no bare class or element
 * selector — so no rule here can reach #noteCard, #ez3Wrap, #visitView,
 * #visitOrdersBody or the transcript host on any screen in any state. The one
 * selector that could otherwise have matched a typing surface (a modal whose
 * direct child is a textarea) excludes them by :not(). The Copilot THREAD is
 * left alone deliberately: chips are offers, the thread is something the
 * doctor is reading.
 *
 * ES5. No dependencies. Escape hatch: window.__mlsMotion.revert().
 */
(function () {
  'use strict';

  if (window.__mlsMotion) return;

  var VERSION = 'mo-1.0.0';
  var D = document;
  var BODY_CLASS = 'mls-mox';
  var STYLE_ID = 'mlsMotionCss';
  var ANGLE = '--mls-mox-angle';

  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

  /* --------------------------------------------------------------- tokens ---
     Durations and easings come from MOTION_TOKENS.md. They are read through
     var() so this file follows the page if the page ever retunes them; the
     literal fallback is the page's current value, never a new number. */

  var DUR1 = 'var(--mls-dur-1,120ms)';   /* press / hover — under the finger */
  var DUR2 = 'var(--mls-dur-2,200ms)';   /* a state change settling          */
  var DUR3 = 'var(--mls-dur-3,300ms)';   /* an entrance                      */
  var DUR4 = 'var(--mls-dur-4,420ms)';   /* a whole panel arriving           */
  var E_OUT = 'var(--mls-ease-out,cubic-bezier(.2,.7,.3,1))';
  var E_SPRING = 'var(--mls-ease-spring,cubic-bezier(.2,.9,.3,1.06))';

  /* One full colour rotation. 7s is the slow end of the 4-8s band the brief
     asks for: at 7s no single hue is ever "arriving", the ring just breathes. */
  var SPIN = '7s';
  var SPIN_ASK = '9s';

  /* Apple Intelligence reads as light passing THROUGH glass, not as an RGB
     strip: six desaturated hues, evenly spaced, closing on the first so the
     loop has no seam. Saturation is deliberately below the app's own accent. */
  var HUES = '#5AA7FF,#8E7BFF,#D46BE0,#FF8FA8,#FFBE7A,#5FD3B2,#5AA7FF';
  var HUES_FLAT = 'linear-gradient(135deg,#5AA7FF,#8E7BFF,#D46BE0,#FF8FA8,#FFBE7A,#5FD3B2)';

  /* The ring's resting brightness. The entrance keyframe intensifies past it
     and settles back here — "alive", then calm.
     Tuned against a synthetic harness at four settings: 1.7px/.82 read as a
     tinted hairline rather than a glow, and 3px/1 read as a coloured border,
     which is the gamer-RGB failure mode. 2.2px/.95 with the bloom below is
     the one that reads as light coming through the edge. */
  var RING_REST = '.95';
  var RING_PAD = '2.2px';

  /* The bloom: a wider, softer, STATIC band sitting under the crisp one. It is
     what turns a coloured outline into a lit edge — and it is deliberately not
     animated, because a second rotating layer would double this file's entire
     per-frame paint cost and, at .17 opacity over 8px, the eye cannot track it
     anyway. It carries a one-shot fade so it arrives with the ring instead of
     snapping in under it. */
  var BLOOM_PAD = '8px';
  var BLOOM_REST = '.17';

  /* The stagger ladder, in milliseconds of leading hold. Six rungs, 24ms apart,
     so the LAST child finishes at 300 + 120 = 420ms — exactly --mls-dur-4,
     which law 2 of MOTION_TOKENS.md sets as the ceiling for an entrance. An
     earlier revision ran to 460ms and was over it; captured mid-flight in the
     harness, it also read as sluggish, because the modal card is ALREADY
     fading over --mls-dur-3 underneath and the two opacity ramps multiply.
     Nothing new is invented here: the ladder runs from --mls-dur-3 to
     --mls-dur-4 and every rung sits between those two existing values.
     These MUST be declared above the MOTION table that consumes them — as
     `var`s below it they hoist as undefined, and the stagger silently emits
     zero rules with a NaN duration. Measured: 14 moving rules instead of 21. */
  var RISE_STEP = 24;
  var RISE_BASE = 300;          /* --mls-dur-3, as a number the ladder adds to */
  var RISE_N = 6;

  function riseDur(i) { return (RISE_BASE + RISE_STEP * i) + 'ms'; }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* ---------------------------------------------------------- ring recipe ---
     ringBase() is entirely static: nothing it declares can move. The conic
     background is separate so it can live inside @supports, and the rotation
     is separate again so that EVERY animation declaration in this file lives
     in the MOTION table, which is what makes the reduced-motion block
     derivable rather than hand-maintained. */

  function ringBase(pad, alpha, z) {
    return "content:'';position:absolute;inset:0;border-radius:inherit;" +
      'padding:' + pad + ';box-sizing:border-box;' +
      'background:' + HUES_FLAT + ';' +
      'opacity:' + alpha + ';pointer-events:none;z-index:' + z + ';' +
      /* the cutout: paint the whole box, then subtract the content box, which
         leaves exactly `pad` of gradient tracing the inherited border radius */
      '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
      '-webkit-mask-composite:xor;' +
      'mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
      'mask-composite:exclude';
  }

  function ringConic() {
    return 'background:conic-gradient(from var(' + ANGLE + '),' + HUES + ')';
  }

  /* --------------------------------------------------------- the surfaces ---
     PLAIN  — static declarations. Nothing here moves; nothing here needs a
              reduced-motion counterpart.
     MOTION — [selector, declarations, wrapper?]. EVERY rule in this file that
              declares an animation or a transition lives in this table and
              only in this table. `wrapper` is an at-rule the declaration nests
              inside; the kill switch takes the selector regardless of wrapper
              and is itself page-level, so a wrapped rule cannot escape it. */

  var HOVER_FINE = '@media (hover:hover) and (pointer:fine)';
  var CONIC = '@supports (background:conic-gradient(from 0deg,#000,#fff))';

  var B = 'body.' + BODY_CLASS + ' ';

  /* The three Copilot surfaces, and only those three. The dock ring lives on
     the dock rather than on the card, because while the dock is open the card
     inside it is squared off to 0 radius (feat_athena_tooltip_dedupe.js) and
     the dock is the frame the doctor actually sees. */
  var RING_DOCK = B + '#copilotDock.open::before';
  var RING_CARD = B + '#studioView > #copilotCard::before';
  var RING_ASK = B + '#askCopilotHdrBtn::before';
  var BLOOM = B + '#copilotDock.open::after,' + B + '#studioView > #copilotCard::after';

  /* Modal children, minus the two modals that are themselves a tabbed shell
     (#settingsModal switches its own sections, which get the cross-fade
     below; #templatesModal is re-hosted inside a panel), minus any direct
     child that is a typing surface. */
  var MODAL_KID = B + '.modal-bg.show:not(#settingsModal):not(#templatesModal) > .modal > ' +
    '*:not(textarea):not(input):not(select):not([contenteditable="true"])';

  var HALO = B + '.modal-bg.show > .modal button::after,' +
    B + '#copilotCard button::after,' +
    B + '#copilotDock button::after';

  var PLAIN = [
    /* A registered <angle> so the spin INTERPOLATES rather than stepping.
       Unregistered, the step is 0deg -> 360deg, which is the same picture. */
    '@property ' + ANGLE + '{syntax:\'<angle>\';initial-value:0deg;inherits:false}',

    /* #copilotDock is already position:fixed; #askCopilotHdrBtn and the inline
       Studio card are static today, and an absolutely-positioned decorative
       layer needs a positioned host. These are the only box properties this
       file writes on anything it did not create. */
    B + '#studioView > #copilotCard{position:relative}',
    B + '#askCopilotHdrBtn{position:relative}',

    RING_DOCK + '{' + ringBase(RING_PAD, RING_REST, '1') + '}',
    RING_CARD + '{' + ringBase(RING_PAD, RING_REST, '1') + '}',
    BLOOM + '{' + ringBase(BLOOM_PAD, BLOOM_REST, '0') + '}',
    /* The header pill wears the ring only under a real pointer, on hover — a
       permanently rainbow control in the top bar is noise, not signal. A 30px
       control gets a thinner band and no bloom; the bloom would swallow it. */
    RING_ASK + '{' + ringBase('1.4px', '0', '1') + '}',

    CONIC + '{',
    '  ' + RING_DOCK + '{' + ringConic() + '}',
    '  ' + RING_CARD + '{' + ringConic() + '}',
    '  ' + B + '#askCopilotHdrBtn:hover::before{' + ringConic() + '}',
    '}',

    /* Focus halo. It NEVER touches outline — the app's own focus rings stay
       exactly as they are, and this is a second, softer ring outside them, so
       nothing is removed and nothing is relied upon. position:absolute keeps
       it out of flow, which matters here: #copilotSendBtn is display:flex and
       an in-flow ::after would become a flex item. */
    B + '.modal-bg.show > .modal button,' +
      B + '#copilotCard button,' +
      B + '#copilotDock button{position:relative}',
    HALO + "{content:'';position:absolute;inset:-4px;border-radius:inherit;" +
      'pointer-events:none;box-sizing:border-box;' +
      'border:2px solid var(--brand,#2E6A4B);opacity:0;transform:scale(.94)}',
    B + '.modal-bg.show > .modal button:focus-visible::after,' +
      B + '#copilotCard button:focus-visible::after,' +
      B + '#copilotDock button:focus-visible::after{opacity:.42;transform:none}'
  ];

  var MOTION = [
    /* ---- 1. the Copilot ring arrives, intensifies, and settles ----
       Two animations on one layer: an endless slow rotation, and a one-shot
       arrival that is over in --mls-dur-4 and never repeats. */
    [RING_DOCK, 'animation:mlsMoxSpin ' + SPIN + ' linear infinite,mlsMoxRingIn ' + DUR4 + ' ' + E_OUT, CONIC],
    [RING_CARD, 'animation:mlsMoxSpin ' + SPIN + ' linear infinite,mlsMoxRingIn ' + DUR4 + ' ' + E_OUT, CONIC],
    [BLOOM, 'animation:mlsMoxBloomIn ' + DUR4 + ' ' + E_OUT],
    [RING_ASK, 'transition:opacity ' + DUR2 + ' ' + E_OUT],
    [B + '#askCopilotHdrBtn:hover::before',
      'opacity:.9;animation:mlsMoxSpin ' + SPIN_ASK + ' linear infinite', HOVER_FINE],

    /* ---- 2 and 3, the two staggers, are generated below from ONE ladder ----
       so that the rung a child rides and the keyframe that holds it for the
       right fraction of that rung can never drift apart. Hand-written, they
       already had: five modal rungs ending at 460ms against a 420ms ceiling. */

    /* ---- 4. section changes cross-fade the INCOMING panel ----
       Both are class-driven and both are reached by a deliberate click, so the
       animation runs exactly once per switch. Neither is a view transition:
       the route does not change and nothing full-screen moves. */
    [B + '#settingsModal .set-section:not(.set-tab-hidden)',
      'animation:mlsMoxFade ' + DUR3 + ' ' + E_OUT],
    [B + '#studioView > #copilotCard,' + B + '#studioView > .sx-right,' +
      B + '#studioView > #analysisView',
      'animation:mlsMoxFade ' + DUR3 + ' ' + E_OUT],

    /* ---- 5. the two control families with no hover lift today ----
       Pointer-fine only, so a touch screen never gets a stuck hover state.
       Every other button family in the app already lifts; see the header. */
    [B + '#askCopilotHdrBtn,' + B + '#settingsModal .set-tab',
      'transition:transform ' + DUR1 + ' ' + E_OUT],
    [B + '#askCopilotHdrBtn:hover,' + B + '#settingsModal .set-tab:hover',
      'transform:translate3d(0,-1px,0)', HOVER_FINE],

    /* ---- 6. the focus halo settles in rather than snapping ---- */
    [HALO, 'transition:opacity ' + DUR2 + ' ' + E_OUT + ',transform ' + DUR2 + ' ' + E_OUT]
  ];

  /* ---- the two staggers, generated from one ladder ----
     A cap is the whole point: a stagger that never ends stops reading as a
     stagger and starts reading as a slow list. Modal children stop at five and
     Copilot chips at six; everything after simply appears. */
  function stagger(sel, count, ease) {
    var out = [], i;
    for (i = 0; i < count; i++) {
      out.push([sel + ':nth-child(' + (i + 1) + ')',
        'animation:mlsMoxRise' + i + ' ' + riseDur(i) + ' ' + ease]);
    }
    return out;
  }

  MOTION = MOTION
    /* modal contents arrive under the card that is already lifting */
    .concat(stagger(MODAL_KID, 5, E_OUT))
    /* chips are OFFERS, not content — #copilotThread, which the doctor is
       reading, is deliberately left alone */
    .concat(stagger(B + '#copilotChips > *', RISE_N, E_SPRING));

  /* ------------------------------------------------------------ keyframes ---
     mlsMoxRiseN: N steps of leading hold, so a stagger needs no
     animation-delay. Every one ends on the element's own resting state and
     none is ever given a fill, so "never ran" and "finished" are the same
     picture. See the header. */

  function keyframes() {
    var out = [
      /* the ring's rotation — the only thing in this file that loops */
      '@keyframes mlsMoxSpin{to{' + ANGLE + ':360deg}}',
      /* the ring's arrival: dark, a brief over-bright, then the resting glow */
      '@keyframes mlsMoxRingIn{from{opacity:0}38%{opacity:1}to{opacity:' + RING_REST + '}}',
      /* the bloom arrives with it, without the over-bright */
      '@keyframes mlsMoxBloomIn{from{opacity:0}to{opacity:' + BLOOM_REST + '}}',
      /* a panel taking over its cell */
      '@keyframes mlsMoxFade{from{opacity:0;transform:scale(.994)}to{opacity:1;transform:none}}'
    ];
    for (var i = 0; i < RISE_N; i++) {
      /* the hold is expressed as a PERCENTAGE of this rung's own duration, so
         the pause is always exactly RISE_STEP*i milliseconds no matter what the
         ladder is retuned to. Deriving it is the point: hand-written holds and
         hand-written durations are two numbers that must agree, and they did
         not. */
      var hold = round2(RISE_STEP * i / (RISE_BASE + RISE_STEP * i) * 100);
      /* opacity finishes early and the travel finishes last, so the content is
         READABLE well before the movement settles — the modal card underneath
         is fading at the same time and two ramps in series read as sluggish. */
      var lit = round2(hold + (100 - hold) * 0.55);
      out.push('@keyframes mlsMoxRise' + i + '{' +
        '0%' + (hold ? ',' + hold + '%' : '') +
        '{opacity:0;transform:translate3d(0,7px,0) scale(.988)}' +
        lit + '%{opacity:1}' +
        '100%{opacity:1;transform:none}}');
    }
    return out;
  }

  /* ------------------------------------------------------------------ css ---
     The reduced-motion block is DERIVED from MOTION. It cannot drift, because
     there is no second list to forget to update. */

  function motionRule(r) {
    return r[2] ? r[2] + '{' + r[0] + '{' + r[1] + '}}' : r[0] + '{' + r[1] + '}';
  }

  function killSwitch() {
    var all = [], moved = [], i;
    for (i = 0; i < MOTION.length; i++) {
      all.push(MOTION[i][0]);
      /* transform is cleared ONLY where this file set one. A blanket
         transform:none!important would have reached app-owned transforms on
         modal children — an existing behaviour changed by a decoration
         module, which is precisely what this file must not do. */
      if (/(^|;)\s*transform\s*:/.test(MOTION[i][1])) moved.push(MOTION[i][0]);
    }
    var out = ['@media (prefers-reduced-motion:reduce){' +
      all.join(',') + '{animation:none!important;transition:none!important}'];
    if (moved.length) out.push(moved.join(',') + '{transform:none!important}');
    out.push('}');
    return out.join('');
  }

  function css() {
    var out = keyframes().concat(PLAIN), i;
    for (i = 0; i < MOTION.length; i++) out.push(motionRule(MOTION[i]));

    /* The standing prohibition, restated. Every selector above is anchored to
       an id or to .modal-bg.show, so by construction none can reach these
       hosts — this is the belt to that braces, and it is kept even though it
       matches nothing, exactly as feat_mls_calm_shell.js keeps its own. The
       transcript host is destroyed and rebuilt about every 3s and
       #visitOrdersBody about every 5s; an entrance rule inside either is a
       permanent flicker in front of someone mid-recording, not a flourish.
       .mls-mo-never is the app's documented opt-out and is honoured here. */
    /* A plain class selector, NOT [class*="mls-mox"]. Both match nothing today,
       but a substring attribute selector is evaluated against every element in
       those subtrees on every style recalculation — and #visitView is the one
       screen in this app where that cost is never acceptable. Symbolism is not
       worth a matcher on the recording screen. */
    out.push('body.' + BODY_CLASS + ' #visitView .' + BODY_CLASS + '-anim,' +
      'body.' + BODY_CLASS + ' #ez3Wrap .' + BODY_CLASS + '-anim,' +
      'body.' + BODY_CLASS + ' #noteCard .' + BODY_CLASS + '-anim,' +
      'body.' + BODY_CLASS + ' #visitOrdersBody .' + BODY_CLASS + '-anim,' +
      'body.' + BODY_CLASS + ' .mls-mo-never .' + BODY_CLASS + '-anim' +
      '{animation:none!important}');

    out.push(killSwitch());
    return out.join('\n');
  }

  /* ----------------------------------------------------------- lifecycle ---- */

  function installCss() {
    if (D.getElementById(STYLE_ID)) return;
    var s = D.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css();
    (D.head || D.documentElement).appendChild(s);
  }

  function start() {
    safe(installCss);
    /* toggle(name, force) rather than add(): add() re-commits the attribute
       unconditionally, and that is a whole-document style invalidation for no
       visual change. This runs once, but the idiom is the house rule. */
    safe(function () {
      if (!D.body.classList.contains(BODY_CLASS)) D.body.classList.toggle(BODY_CLASS, true);
    });
  }

  function teardown() {
    safe(function () {
      var s = D.getElementById(STYLE_ID);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    });
    safe(function () { D.body.classList.toggle(BODY_CLASS, false); });
  }

  window.__mlsMotion = {
    installed: true,
    version: VERSION,
    asset: 'feat_mls_motion.js',
    bodyClass: BODY_CLASS,
    styleId: STYLE_ID,
    /* the emitted sheet and its moving selectors, so a test or a console can
       read what actually shipped instead of re-deriving it from the source */
    _css: css,
    _motionSelectors: function () {
      var sels = [], i;
      for (i = 0; i < MOTION.length; i++) sels.push(MOTION[i][0]);
      return sels;
    },
    revert: function () { teardown(); delete window.__mlsMotion; return 'reverted'; }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else start();
})();
