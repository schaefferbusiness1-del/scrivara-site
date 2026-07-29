/* =============================================================================
 * MLS Scribe -- CLINICAL SURFACE QUALITY PASS  (window.__mlsUiClinical, uc-1.0.0)
 * 2026-07-29
 *
 * OWNER, verbatim: "I LOVE THE UI FOR CO PIOLOT NOW ADD THATR LEVEL OF QUALITY
 * EVERYWHERE" and "Really look it look amazing and easy and simple and
 * intuitive and maek sure it all works perfect and that we dont lose any
 * features in the porcess".
 *
 * He is a practising orthopaedic surgeon reading this between patients, so
 * "easy, simple, intuitive" outranks "impressive". Every rule below had to
 * clear one bar: does it make the screen EASIER TO USE. Anything that only
 * made it look busier was deleted before it was written down; the four things
 * I deliberately did NOT do are named at the bottom of this header.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 * ---------------------------------------------------------------------------
 * ONE additive stylesheet plus ONE body class. No node is created, moved,
 * renamed or removed; no handler is bound or rebound; no id or class the app
 * ships is redefined. Every selector is prefixed `body.mls-uic ` so that
 * removing the class alone makes the whole sheet inert -- revert() removes the
 * class AND the sheet AND the global.
 *
 * There is not one keyframe in this file. Nothing spins, nothing bounces,
 * nothing pulses. Three rules move at all, all three on the SAME element (the
 * day row a doctor taps to pick a patient), all three transform/paint only.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR DEFECTS THIS FIXES, AND THE GREP THAT PROVES EACH
 * ---------------------------------------------------------------------------
 * The visit workspace `#mlsEz3` was authored as a DARK panel (mls-connect.js
 * ~18000: pale mint / pale amber / near-white text on white-alpha tints) and
 * later re-skinned into a LIGHT paper card by an unconditional equalizer:
 *
 *   mls-connect.js:6139  #mlsEz3{background:linear-gradient(180deg,#FFFFFF 0%,
 *                        #FCFBF8 100%) !important; ...}
 *
 * That equalizer is careful and mostly complete -- it repairs .ez3-badge.g/.a/
 * .dob, .ez3-warnbar, .ez3-vchip.warn, .ez3-prow .dob/.sub/.tm, .ez3-qchip .qt
 * and about forty more. Four states slipped through it, and every one of them
 * is a state a doctor is supposed to READ:
 *
 * 1. THE VISIT FLOW STRIP HAS NO "DONE".
 *    mls-connect.js:18054  .ez3-fstep.done{color:#9fd8bd;
 *                            border-color:rgba(5,150,105,.45);
 *                            background:rgba(5,150,105,.12)}
 *    mls-connect.js:6174   #mlsEz3 .ez3-fstep{color:#79837C !important;
 *                            background:#F2F0E9 !important;
 *                            border-color:#E4E1D8 !important}
 *    .done declares exactly three properties. The equalizer overrides all
 *    three with !important at (1,1,0) against .done's (0,2,0), and there is no
 *    `#mlsEz3 .ez3-fstep.done` rule anywhere in the repo (grepped: three hits
 *    for `fstep.done`, all the same base rule in the three ez3 copies). So on
 *    the shipped page a COMPLETED step of Record / Generate / Review & Sign /
 *    Send is pixel-identical to a step not started. The strip answers "where
 *    am I" and can never answer "how far along am I" -- which is the exact
 *    defect the Calm Shell fixed on #mlsStages by DRAWING a check, and nobody
 *    fixed here.
 *    FIX: a `\2713` glyph on ::before. `content` is a property nothing in the
 *    equalizer touches, so this needs no !important and fights nobody.
 *
 * 2. THE DAY ROW'S HOVER IS INVISIBLE.
 *    mls-connect.js:18102  .ez3-prow>.hd:hover{background:rgba(255,255,255,.05)}
 *    White at 5% alpha over a #FFFFFF card is nothing. The row that a doctor
 *    taps all day -- mls-connect.js:19419, whose header click runs
 *    lockAndStart() and IS how a patient gets picked -- gives no feedback that
 *    it is even tappable beyond the cursor, and no press acknowledgment at all
 *    because it is a <div> and ScribeFlow.html's one global press rule
 *    (`html body :is(button,[role="button"],.ez3fl-qchip,.chip,.navtab):active`)
 *    only reaches real controls.
 *    FIX: a 1px lift + a soft shadow on hover (pointer:fine only), and a
 *    scale(.998) press answer. NOT a colour change -- .ez3-prow.open owns
 *    border-color and background, and a hover that repainted those would erase
 *    the "expanded" state for as long as the pointer sat there.
 *
 * 3. "ALREADY SEEN" ON THE DAY STRIP IS OPACITY AND NOTHING ELSE.
 *    mls-connect.js:18063  .ez3-qchip.seen{opacity:.45}
 *    45% is both the only "done" signal on the strip and, at 12.5px, the
 *    reason the patient's name in a seen chip is hard to read. Opacity alone
 *    also reads as "disabled" rather than "finished".
 *    FIX: a `\2713` glyph, and .45 -> .62 so the NAME is legible. Still
 *    visibly quieter than an unseen chip; the glyph now carries the meaning.
 *
 * 4. THE AMBER FAMILY DISAGREES WITH ITSELF.
 *    The equalizer gives every amber surface the same light-panel treatment --
 *    #6F4300 on #FFF6DF with a #D99A26 edge (.ez3-warnbar:6155,
 *    .ez3-vchip.warn:6168, .ez3-badge.a:6159) -- and then excludes exactly one
 *    member of the family:
 *    mls-connect.js:6346  #mlsEz3 .ez3-sm:not(.pri):not(.warn){background:...}
 *    so `.ez3-sm.warn` (#ez3PullRetry, "Retry failed days",
 *    mls-connect.js:20904) alone renders as a WHITE chip with an amber
 *    hairline while its three siblings are amber washes. Its text is legible
 *    -- `#mlsEz3 .ez3-sm:not(.pri)` does set ink at :6345 -- so this is a
 *    consistency defect, not a contrast one, and it is fixed with the app's
 *    OWN two values and no !important.
 *
 * Plus one inconsistency outside #mlsEz3, on the patient list:
 *
 * 5. THE PATIENT LIST IS THE LAST BLUE ISLAND.
 *    ScribeFlow.html:1133  .pt-item:hover{border-color:var(--brand);
 *                            background:#f3f8ff}
 *    ScribeFlow.html:1141  .pt-item.active{border-color:var(--brand);
 *                            background:#eaf3ff;
 *                            box-shadow:0 0 0 2px rgba(31,122,224,.15)}
 *    --brand is #2E6A4B (ScribeFlow.html:361) and --soft is #F4F2EC, i.e. the
 *    app is green on warm paper -- but the SELECTED patient row is a green
 *    border around a blue fill inside a blue halo. Dark theme was already
 *    repaired (ScribeFlow.html:464 sets .active background to var(--soft)); the
 *    light theme was not.
 *    FIX: var(--soft) for both states and the halo idiom the Calm Shell
 *    already uses for "you are here" (#mlsStages .st.now .dot ->
 *    box-shadow:0 0 0 4px rgba(46,106,75,.14)). The ACTIVE row keeps its ring
 *    AND its "ACTIVE" word badge (ScribeFlow.html:14787), so it stays
 *    distinguishable from a hovered row without relying on colour.
 *
 * ---------------------------------------------------------------------------
 * HIERARCHY IS ALREADY OWNED, SO THIS FILE DOES NOT TOUCH IT
 * ---------------------------------------------------------------------------
 * feat_mls_visit_focus.js (vf-1.2.0) owns the primary/secondary hierarchy of
 * #visitView and #patientsView and enforces it with ~30 !important
 * declarations keyed on :has() state. Re-deciding which control is biggest
 * from a second file is how two lanes end up fighting over one button. What
 * this file contributes to hierarchy instead is the thing vf cannot express in
 * a size: STATE, so the doctor can tell at a glance which steps are behind him
 * and which patients are done -- and BREATHING ROOM, so the column reads as
 * one surface rather than six.
 *
 * ---------------------------------------------------------------------------
 * BREATHING ROOM: ONE GAP, ONE RHYTHM, ONE INSET
 * ---------------------------------------------------------------------------
 * Measured in mls-connect.js, all inside the same 720px column:
 *   chip-group gap       .ez3-badges 8  .ez3-quick 8  .ez3-daterow 8
 *                        .ez3-chips 6  .ez3-flow 6  .ez3-seg 6      -> 8
 *   stack bottom margin  .ez3-card 14  .ez3-row2 14  .ez3-big 14
 *                        .ez3-quick 12 .ez3-flow 12 .ez3-search 12
 *                        .ez3-warnbar 12 .ez3-seg 12 .ez3-daterow 12 -> 14
 *   row inset            .ez3-card padding 16 ... but .ez3-prow>.hd 15,
 *                        .ez3-prow .sub 15, .ez3-prow .ex 15         -> 16
 * Six values became three. Every delta is 1-2px, every write is a LONGHAND
 * (margin-bottom, padding-left, padding-right) so the vertical padding and top
 * margins the app tuned are untouched. Nothing here is ever animated.
 *
 * ---------------------------------------------------------------------------
 * WHAT MOVES, AND THE FIVE LAWS IT OBEYS
 * ---------------------------------------------------------------------------
 * MOVING is the ONLY place a transition may be declared in this file, and the
 * prefers-reduced-motion block is GENERATED from it (killSwitch()). A rule
 * cannot be added here without its own off-switch arriving with it.
 *
 *   transform + box-shadow + border-color + background-color only. No layout
 *     property, no `all`, no filter, no infinite anything.
 *   MOVING[0] REPLACES two app declarations -- `.ez3-prow{transition:.12s}`
 *     (:18099, which is `transition:all`) and `.ez3-prow{transition:
 *     border-color .12s,background .12s}` (:18247) -- because any `transition:`
 *     on a matching element overrides the whole shorthand. Both properties
 *     they animated are enumerated in mine at --mls-dur-1 (=120ms exactly), so
 *     the .open state still settles the way it does today. Dropping `all` is
 *     the repo's own law 1, not a preference.
 *   box-shadow is in the list on the Calm Shell's precedent (:558-561 puts
 *     box-shadow in the stage-dot transition so the halo blooms with the scale
 *     instead of snapping a frame early). It is paint-only, one hovered row at
 *     a time, and never on a loop.
 *   Hover lift lives inside @media (hover:hover) and (pointer:fine) so a tap
 *     on a touch screen cannot leave a row stuck lifted.
 *   The press answer is `:has(> .hd:active):not(:has(button:active))` -- it
 *     fires for the row's own header only, so pressing a button inside the row
 *     does not shrink the row AND the button at once. Where :has() is missing
 *     the rule simply does not match and the row behaves as it does today.
 *
 * NO ENTRANCE ANIMATION ON .ez3-prow, DELIBERATELY. renderDay() rebuilds the
 * whole list with innerHTML on every state change (the same pattern that made
 * renderStages' rail motion unobservable and MOTION_TOKENS law 5 case 1), so
 * an entrance rule there is not a flourish, it is a permanent flicker in front
 * of a doctor reading a schedule. .ez3-card entrances are already owned by
 * feat_mls_polish_everywhere.js off the app's .view-enter class.
 *
 * ---------------------------------------------------------------------------
 * STANDING DOWN, AND THE CLASS THAT IS NEVER SET
 * ---------------------------------------------------------------------------
 * Nothing may move while he is recording or reading a note. Three markers:
 *   body.mls-note-live   REAL -- feat_mls_visit_focus.js:514 toggles it from
 *                        #noteBox's own value, the same test openReviewStep
 *                        uses, so "a note is on screen" and "a note can be
 *                        sent" cannot disagree.
 *   body.mls-recording   HONOURED BUT DEAD. Grepped the whole repo: the class
 *                        appears in feat_mls_magic.js (CSS), in
 *                        feat_mls_polish_everywhere.js (CSS) and here (CSS) --
 *                        and in NO writer. Nothing puts it on <body>. It is
 *                        kept because two other modules already stand down on
 *                        it and it costs one selector, but on its own it is a
 *                        stand-down that can never engage, which is why:
 *   #mlsEz3:has(.ez3fl-recbtn.live)  the DOM FACT. mls-connect.js:6874 toggles
 *                        `live` on .ez3fl-recbtn if and only if a recording is
 *                        running. A class is a claim; this is the app's own
 *                        output. This is the marker that actually fires.
 *
 * ---------------------------------------------------------------------------
 * THE CLINICAL RECORD IS NOT DECORATION
 * ---------------------------------------------------------------------------
 * #noteBox, #transcript, every textarea, every [contenteditable="true"],
 * .mlsf-note, .ez3-transcript and .ez3-note are excluded from animation and
 * their font size, weight and colour are not touched by one declaration in
 * this file. Structurally, too: no selector in MOVING mentions any of them.
 *
 * The exclusion kills `animation` and NOT `transition`, and that is measured
 * rather than lazy. Four rules in the shipped app transition a typing surface:
 *   ScribeFlow.html  input,select,textarea{transition:border-color .16s,
 *                    box-shadow .16s,background .16s}
 *   ScribeFlow.html  .sf-select,input[...],textarea{transition:border-color
 *                    .12s,box-shadow .12s}
 *   ScribeFlow.html  input[...],textarea,select,.sf-select{transition:...}
 *   ScribeFlow.html  #transcript.mlsUxPasteReady{transition:outline-color .3s}
 * A blanket `transition:none!important` on `textarea` would delete the focus
 * ring settle on every text field in the product -- "we dont lose any
 * features" is the other half of the brief. This module declares no transition
 * on any of those hosts, so there is nothing of MINE to switch off there; the
 * animation clause is the belt, and the gate asserts the structural guarantee.
 *
 * ---------------------------------------------------------------------------
 * DARK THEME
 * ---------------------------------------------------------------------------
 * #mlsEz3 is a WHITE paper card in BOTH themes: the equalizer at :6139 is
 * unconditional and no `body.theme-dark` rule in the repo reaches #mlsEz3 or
 * any .ez3-* class (grepped). So the amber pair and the focus/hover values
 * scoped under #mlsEz3 are correct in both themes by construction, and using
 * a theme-conditional colour there would be the bug. The one surface here that
 * IS theme-aware is .pt-item, which reads var(--soft)/var(--brand) plus an
 * explicit body.theme-dark halo, because a #2E6A4B halo on a #1F2721 row is
 * invisible.
 *
 * ---------------------------------------------------------------------------
 * NO TIMER, NO rAF, NO OBSERVER
 * ---------------------------------------------------------------------------
 * Every state this file reads is a class the app already writes or a fact
 * :has() can see. CSS gets all of it for free. boot-script-budget.test.js
 * counts intervals and document observers against ceilings that are at their
 * limit; the cheapest way to be safe there is to need neither.
 *
 * ---------------------------------------------------------------------------
 * FIVE THINGS I DELIBERATELY DID NOT DO
 * ---------------------------------------------------------------------------
 *   .ez3-big.rec / .ez3-recbar animate `box-shadow` on an INFINITE ez3Pulse
 *     (mls-connect.js:18014). That is a forbidden property on a forever loop
 *     and it keeps the compositor awake for the whole clinic day. It is also
 *     the recording indicator, and this file stands down while recording.
 *     Overriding it from here would either kill the only "you are live" signal
 *     or contradict the stand-down. Reported, not touched.
 *   .ez3-safety.off ("Identity-guard module not detected") is defeated by
 *     `#mlsEz3 .ez3-safety{color:#79837C !important}` exactly the way .done is,
 *     so the guard-OFF state is colour-dead too -- but its distinction is
 *     carried by a whole different sentence, and it renders only inside the
 *     staff-mode expansion. A glyph there is noise on a surface a surgeon
 *     never opens.
 *   .ez3-nowtag vs .ez3-nowtag.next are colour-dead in the light panel for the
 *     same reason, and their text already reads "HAPPENING NOW" vs "UP NEXT"
 *     in caps. A glyph adds nothing a word is not already saying.
 *   .ez3-exbtn.rec and .ez3-exbtn.send are BOTH filled gradients in one
 *     four-cell grid, i.e. two co-equal primaries. Demoting one changes what
 *     the screen tells a doctor to do, which is an owner decision and vf's
 *     lane, not a polish pass.
 *   #mlsEz3 .ez3-prow .moredots is a 2px-bordered, 900-weight, shadowed chip
 *     for "more" -- a secondary shouting louder than its row. Quieting it
 *     means out-!importanting another lane's !important on a control I do not
 *     own. Reported, not touched.
 *
 * ES5. No dependencies. Idempotent. window.__mlsUiClinical.revert().
 * ========================================================================== */
(function () {
  'use strict';

  try { if (window.__mlsUiClinical) return; } catch (e0) { return; }

  var VERSION = 'uc-1.0.0';
  var D = document;
  var STYLE_ID = 'mlsUiClinicalCss';
  var BODY_CLASS = 'mls-uic';

  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

  /* ---------------------------------------------------------------- tokens ---
     MOTION_TOKENS.md, read through var() so this file follows the page if the
     page retunes. The literal fallback is the page's CURRENT value, never a
     new number -- nothing here invents a timing. */
  var D1 = 'var(--mls-dur-1,120ms)';   /* press / hover -- under the finger */
  var D2 = 'var(--mls-dur-2,200ms)';   /* a state settling                  */
  var EO = 'var(--mls-ease-out,cubic-bezier(.2,.7,.3,1))';

  var HOVER_FINE = '@media (hover:hover) and (pointer:fine)';

  /* Every selector hangs off this, so dropping the class makes the sheet
     inert without removing it. */
  var B = 'body.' + BODY_CLASS + ' ';

  /* The visit workspace. Everything ez3 lives inside it, and scoping here
     (a) keeps this file out of every other lane's surface and (b) buys the
     specificity to win without !important. */
  var EZ = B + '#mlsEz3 ';

  /* The one class this module puts in the document. Declared so the gate's
     anti-vacuity check can tell "mine" from "does not exist". */
  var OWN_TOKENS = [BODY_CLASS];

  /* The day row a doctor taps to pick a patient. Named once: it is the only
     element in this file that moves, and it is the only element three
     different rules have to agree about. */
  var ROW = EZ + '.ez3-prow';

  /* ------------------------------------------------------------------ static
     Nothing in here moves, so nothing in here needs a reduced-motion
     counterpart. Glyphs use CSS hex escapes, never a literal multi-byte
     character: this repo has shipped chart status glyphs as mojibake once, a
     PowerShell utf8 write has corrupted a core digest with a BOM, and an ASCII
     apostrophe in an ez3 string has swallowed forty rules. `\2713` cannot go
     wrong in any encoding. Both pseudo-elements carry pointer-events:none --
     they are in-flow text inside their own control and could not intercept a
     click, but this app has a history of invisible layers eating them. */
  var STATIC = [

    /* --- 1. the visit flow strip gets a "done" that survives the equalizer --- */
    EZ + '.ez3-flow .ez3-fstep.done::before{' +
      'content:"\\2713";margin-right:5px;font-weight:800;pointer-events:none}',

    /* --- 3. "already seen" says so, and the name is readable while it does --- */
    EZ + '.ez3-quick .ez3-qchip.seen{opacity:.62}',
    EZ + '.ez3-quick .ez3-qchip.seen::after{' +
      'content:"\\2713";margin-left:5px;font-weight:800;pointer-events:none}',

    /* --- 4. the amber family agrees with itself. The app's own two values
             (mls-connect.js:6155/6159/6168); ink is left to the equalizer's
             #1A211C, which is legible on #FFF6DF, so no !important and no
             colour fight. --- */
    EZ + '.ez3-sm.warn{background:#FFF6DF;border-color:#D99A26}',

    /* --- breathing room: one chip-group gap --- */
    EZ + '.ez3-badges,' + EZ + '.ez3-chips,' + EZ + '.ez3-flow,' +
      EZ + '.ez3-seg,' + EZ + '.ez3-daterow{gap:8px}',

    /* --- breathing room: one vertical rhythm. margin-bottom LONGHAND, so the
           top margins the app tuned (.ez3-seg has 2px, .ez3-late has 6px) are
           untouched. --- */
    EZ + '.ez3-quick,' + EZ + '.ez3-flow,' + EZ + '.ez3-search,' +
      EZ + '.ez3-warnbar,' + EZ + '.ez3-seg,' + EZ + '.ez3-daterow{margin-bottom:14px}',

    /* --- breathing room: one row inset, matching .ez3-card's 16px padding, so
           a row's text starts on the same vertical line as a card's. Longhands
           only -- .ez3-prow>.hd's 13px top/bottom and .sub's 11px bottom are
           load-bearing and stay. --- */
    EZ + '.ez3-prow > .hd,' + EZ + '.ez3-prow .sub,' + EZ + '.ez3-prow .ex' +
      '{padding-left:16px;padding-right:16px}',

    /* --- one focus ring for the whole clinical column. box-shadow ONLY: the
           browser's own outline is never removed, so this is strictly additive
           for anyone driving the app from a keyboard. Static on purpose -- a
           focus ring that fades in arrives after the eye has already moved. --- */
    EZ + '.ez3-big:focus-visible,' + EZ + '.ez3-sm:focus-visible,' +
      EZ + '.ez3-qchip:focus-visible,' + EZ + '.ez3-chip:focus-visible,' +
      EZ + '.ez3-exbtn:focus-visible,' + EZ + '.ez3-more:focus-visible,' +
      EZ + '.ez3-back:focus-visible{box-shadow:0 0 0 3px rgba(46,106,75,.34)}',
    /* ...and the "happening now" chip keeps ITS ring underneath the focus ring
       instead of losing it for as long as focus sits there. Feature preserved,
       not overwritten (mls-connect.js:18061). */
    EZ + '.ez3-qchip.now:focus-visible{' +
      'box-shadow:0 0 0 2px rgba(5,150,105,.35),0 0 0 5px rgba(46,106,75,.30)}',

    /* --- 5. the patient list joins the rest of the app. var(--soft) is
           theme-aware (#F4F2EC light / the dark shell's own soft), and the halo
           is the Calm Shell's "you are here" idiom from #mlsStages .st.now .dot.
           The ACTIVE row still differs from a hovered one by its ring and by
           its "ACTIVE" word badge, so the state is never colour alone. --- */
    B + '#patientsView .pt-item:hover{background:var(--soft,#F4F2EC)}',
    B + '#patientsView .pt-item.active{' +
      'background:var(--soft,#F4F2EC);box-shadow:0 0 0 3px rgba(46,106,75,.16)}',
    /* A #2E6A4B halo on a #1F2721 row is invisible; the dark shell's --brand
       is #5FAF87. This is the one theme-conditional value in the file. */
    'body.theme-dark.' + BODY_CLASS + ' #patientsView .pt-item.active{' +
      'box-shadow:0 0 0 3px rgba(95,175,135,.24)}'
  ];

  /* ------------------------------------------------------------------ moving
     THE ONLY PLACE A TRANSITION MAY BE DECLARED IN THIS FILE.
     [selector, declarations, wrapper?]. killSwitch() is generated from this
     table, so a rule physically cannot be added without its off-switch. */
  var MOVING = [
    /* Replaces .ez3-prow{transition:.12s} (an `all`) and .ez3-prow{transition:
       border-color .12s,background .12s}. Both of their properties are
       enumerated here at dur-1 = 120ms, so .open still settles as it does
       today; only the `all` is dropped. */
    [ROW,
     'transition:transform ' + D2 + ' ' + EO +
       ',box-shadow ' + D2 + ' ' + EO +
       ',border-color ' + D1 + ' ' + EO +
       ',background-color ' + D1 + ' ' + EO],

    /* The row lifts a hair and casts a little. NO colour: .ez3-prow.open owns
       border-color and background, and a hover that repainted them would erase
       "expanded" for as long as the pointer sat on the row. */
    [ROW + ':hover',
     'transform:translateY(-1px);box-shadow:0 4px 14px -8px rgba(20,33,28,.42)',
     HOVER_FINE],

    /* The press answers. .998 on a ~690px row is about 1.4px -- large surfaces
       scale less, which is why .ez3-big already carries .986 rather than the
       global .97. Scoped to the row's OWN header so pressing a button inside
       the row does not shrink both at once. */
    [ROW + ':has(> .hd:active):not(:has(button:active))',
     'transform:translateY(0) scale(.998)']
  ];

  /* ------------------------------------------------------------- stand down
     Nothing moves while he is recording or reading a note. The :has() term is
     the one that actually fires; see the header on body.mls-recording. */
  var STANDDOWN_SCOPES = [
    'body.' + BODY_CLASS + '.mls-note-live #mlsEz3 .ez3-prow',
    'body.' + BODY_CLASS + '.mls-recording #mlsEz3 .ez3-prow',
    'body.' + BODY_CLASS + ' #mlsEz3:has(.ez3fl-recbtn.live) .ez3-prow'
  ];

  /* --------------------------------------------------------- clinical record
     The medical record is not decoration. `animation` only, never
     `transition` -- four shipped rules transition a typing surface and killing
     them would delete the focus settle on every text field in the product. See
     the header; the gate pins both halves. */
  var CLINICAL_TEXT = [
    '#noteBox', '#transcript', 'textarea', '[contenteditable="true"]',
    '.mlsf-note', '.mlsf-note *', '.ez3-transcript', '.ez3-note'
  ];

  function exclusionRule() {
    var i, sels = [];
    for (i = 0; i < CLINICAL_TEXT.length; i++) sels.push(B + CLINICAL_TEXT[i]);
    return sels.join(',') + '{animation:none!important}';
  }

  function standDownRule() {
    return STANDDOWN_SCOPES.join(',') +
      '{transition:none!important;transform:none!important;box-shadow:none!important}';
  }

  /* ------------------------------------------------------------- kill switch
     DERIVED from MOVING. transform is cleared only for the rules that actually
     set one -- a blanket transform:none!important would reach app-owned
     transforms, which is a decoration module changing an existing behaviour to
     switch itself off. */
  function killSwitch() {
    var all = [], moved = [], i;
    for (i = 0; i < MOVING.length; i++) {
      all.push(MOVING[i][0]);
      if (/(^|;)\s*transform\s*:/.test(MOVING[i][1])) moved.push(MOVING[i][0]);
    }
    var out = ['@media (prefers-reduced-motion:reduce){' +
      all.join(',') + '{animation:none!important;transition:none!important}'];
    if (moved.length) out.push(moved.join(',') + '{transform:none!important}');
    out.push('}');
    return out.join('');
  }

  function movingRule(r) {
    return r[2] ? r[2] + '{' + r[0] + '{' + r[1] + '}}' : r[0] + '{' + r[1] + '}';
  }

  function css() {
    var out = [], i;
    for (i = 0; i < STATIC.length; i++) out.push(STATIC[i]);
    for (i = 0; i < MOVING.length; i++) out.push(movingRule(MOVING[i]));
    out.push(exclusionRule());
    out.push(standDownRule());
    out.push(killSwitch());
    return out.join('\n');
  }

  /* ----------------------------------------------------------------- install */

  function installCss() {
    if (D.getElementById(STYLE_ID)) return;
    var s = D.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css();
    (D.head || D.documentElement).appendChild(s);
  }

  function start() {
    safe(installCss);
    /* toggle(name, force), never add(): add() re-commits the attribute
       unconditionally and that is a whole-document style invalidation for no
       visual change. This runs once, but the idiom is the house rule. */
    safe(function () {
      if (D.body && !D.body.classList.contains(BODY_CLASS)) {
        D.body.classList.toggle(BODY_CLASS, true);
      }
    });
  }

  function teardown() {
    safe(function () {
      var s = D.getElementById(STYLE_ID);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    });
    safe(function () { if (D.body) D.body.classList.toggle(BODY_CLASS, false); });
  }

  window.__mlsUiClinical = {
    installed: true,
    version: VERSION,
    asset: 'feat_mls_ui_clinical.js',
    bodyClass: BODY_CLASS,
    styleId: STYLE_ID,
    ownTokens: OWN_TOKENS,
    clinicalText: CLINICAL_TEXT,
    /* the emitted sheet and its moving selectors, so a gate or a console reads
       what actually shipped instead of re-deriving it from the source text */
    css: css,
    _css: css,
    _movingSelectors: function () {
      var sels = [], i;
      for (i = 0; i < MOVING.length; i++) sels.push(MOVING[i][0]);
      return sels;
    },
    revert: function () {
      teardown();
      safe(function () { delete window.__mlsUiClinical; });
      return 'reverted';
    }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else start();
})();
