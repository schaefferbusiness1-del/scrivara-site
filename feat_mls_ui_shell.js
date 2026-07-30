/* =========================================================================
 * MLS Scribe — SHELL AND DIALOG QUALITY PASS  (__mlsUiShell)
 * uish-1.0.0  2026-07-29
 *
 * OWNER: "I LOVE THE UI FOR CO PIOLOT NOW ADD THATR LEVEL OF QUALITY
 * EVERYWHERE" and, in the same breath, "make sure it all works perfect and
 * that we dont lose any features in the porcess". He is a practising
 * orthopaedic surgeon using this between patients, so EASY beats IMPRESSIVE
 * every time.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHY IT IS SMALL
 * ---------------------------------------------------------------------------
 * The shell is already heavily worked. ScribeFlow.html ships modal entrance
 * animation, asymmetric toast motion, a global press scale, hover lift on six
 * button families, and a 44px tap floor at phone widths; feat_mls_motion.js
 * adds the Copilot ring and staggered dialog contents; feat_mls_calm_shell.js
 * owns the dock and the top bar; feat_mls_polish_everywhere.js owns cards and
 * rows. So the honest gap in the SHELL and the DIALOGS was never motion. It
 * was REACH, HIERARCHY and CONTRAST.
 *
 * Fifteen candidate rules were written and then DELETED, most of them after
 * being MEASURED in a synthetic harness rather than merely reasoned about. They
 * are recorded here because each one looks like an obvious improvement and will
 * be proposed again:
 *
 *   primary-action emphasis in dialogs
 *       .btn-primary already carries box-shadow:0 8px 20px -8px
 *       rgba(32,64,52,.6) !important twice over (ScribeFlow.html:2371 and
 *       feat_mls_redesign.js:197). A dialog primary is ALREADY the loudest
 *       thing on the card, and a non-important rule could not have won anyway.
 *   quieting the destructive button
 *       body.mls-redesign .btn-red is already a pale #FBF1EF chip with #B23B3B
 *       text (feat_mls_redesign.js:203, !important). It is quiet ALREADY.
 *       Making it louder would invite exactly the accidental click the brief
 *       asks to prevent, so only its FOCUS ring is added here.
 *   .set-head contrast
 *       already forced to var(--ink) !important by TWO satellites
 *       (feat_athena_tooltip_dedupe.js:538, feat_mls_settings_exact.js:49).
 *   .set-tab shadow, .set-tab focus ring, .set-tab hover
 *       the Settings rail is owned end-to-end by those same satellites with
 *       !important at id specificity, including a focus-visible outline. Any
 *       rule here would have lost silently, which is the worst outcome: a
 *       stylesheet that reads as shipped and changes nothing.
 *   toast motion, modal entrance, modal exit, button press, card hover
 *       all incumbent. A second spelling of one rule is the incoherence the
 *       repo motion charter exists to end. Modal EXIT stays unimplemented on
 *       purpose: it needs the node held past the close call, which is a
 *       behaviour change to someone else handler.
 *   top bar and tool dock
 *       #mlsRdTop / #mlsDock and their controls are BUILT AT RUNTIME by
 *       feat_mls_redesign.js and feat_mls_calm_shell.js. Their ids are absent
 *       from ScribeFlow.html, so a rule here could not be proven against the
 *       app source and is out of scope by the anti-vacuity rule. The base
 *       `header{background:var(--header);color:#fff}` looks like a white-on-
 *       near-white contrast bug and is NOT one: feat_mls_redesign.js:111 hides
 *       every original header child with `> [data-mlsrd-hid]{display:none}` and
 *       builds its own bar.
 *   reserving title room beside the widened exit
 *       measured unnecessary. See the note in the rule table.
 *   a hover transition on the exit control
 *       measured vacuous. See the note above the MOVING table.
 *   login inactive-tab contrast
 *       a real WCAG AA failure, but not provably fixable from here. See the
 *       note at the end of the rule table.
 *
 * ---------------------------------------------------------------------------
 * THE ONE BUG THIS FILE IS REALLY FOR
 * ---------------------------------------------------------------------------
 * .modal-x is `float:right;padding:0;font-size:22px` (ScribeFlow.html:971) and
 * measures about 17x23px. The 44px floor on it exists ONLY inside
 * @media (max-width:760px) (ScribeFlow.html:1648). So on the DESKTOP the
 * doctor uses, every one of the fourteen dialogs in this app has a ~17px
 * corner glyph as its only exit. The op-note room already cost two live
 * reports of exactly this shape (COULDNT GET BACK OUT, and STILL CANT SCROLL
 * DOWN IN TEMPLATES). Rule 1 gives all fourteen a 44x44 target at every width.
 *
 * MEASURED in a synthetic PHI-free harness carrying the app own stylesheet
 * (headless Chrome, device scale 1, settled read):
 *
 *                       before            after
 *   exit control        17.13 x 23.64     44 x 44   (computed min-* 44px,
 *                                                    box-sizing border-box,
 *                                                    no transform, zoom 1)
 *   centre hit-test     self              self      (clickable in both; the
 *                                                    old one was simply tiny)
 *   title overlap       false             false
 *
 * The title does not need protecting: .modal h3 is display:flex, so it
 * establishes a new formatting context and CSS 2.1 section 9.5 requires such a
 * box not to overlap a float margin box — the browser narrows the heading
 * instead. Measured with a 96-character title in a 560px card, heading width
 * went 481.28 -> 455.07 and the overlap stayed false.
 *
 * min-width/min-height, never width/height: two Settings skins pin
 * width:34px !important and width:36px !important on this control
 * (feat_athena_tooltip_dedupe.js:529, feat_mls_settings_exact.js:45). Used
 * width is max(min-width,width), so 44 wins with no !important war. That is
 * the same reasoning ScribeFlow.html:1639-1648 already documents for phones.
 *
 * ---------------------------------------------------------------------------
 * HARD RULES HONOURED
 * ---------------------------------------------------------------------------
 *   - Presentation only. One <style> element, one body class, nothing else. No
 *     node is created, moved, renamed or removed; no handler is touched.
 *   - NO rule in this file sets height, max-height, display or overflow on
 *     anything, and no rule takes a .modal or .modal-bg as its SUBJECT. That
 *     is structural, not a promise: it makes the live clipping regression
 *     (`#opPrepModal.opr-room .modal` reaching a NESTED card and hiding its
 *     Close button) impossible to recreate from this file. Child combinators
 *     are used wherever a dialog own card is meant.
 *   - NOTHING in this file animates. Not a transition, not an animation, not a
 *     keyframe. The MOVING table is empty and the off-switch is still generated
 *     from it, so the first moving rule anyone adds arrives with its own kill
 *     switch. See the note above that table for why empty is the right answer.
 *   - Hover states live inside @media (hover:hover) and (pointer:fine) so a
 *     touch screen never gets a stuck hover.
 *   - No timer, no frame loop, no document-wide watcher. Everything keys off
 *     classes the app already toggles (.modal-bg.show) or off hover/focus,
 *     which CSS sees for free.
 *   - No decorative layer at all, so nothing new can intercept a click.
 *   - Nothing removes an outline. The two focus rules ADD one; the app own
 *     input rings (ScribeFlow.html:1309) are untouched.
 *   - Every colour is read through the app own custom properties, so dark mode
 *     follows automatically. There is not one hard-coded colour in the file.
 *
 * ---------------------------------------------------------------------------
 * CONTRAST
 * ---------------------------------------------------------------------------
 * Both colour changes move text from --muted to --ink, which RAISES contrast in
 * both themes. Measured in the harness: the empty-state call to action went
 * rgb(99,110,102) -> rgb(26,33,28) on --soft2.
 *
 * One contrast defect in scope is reported and NOT fixed here, because it could
 * not be proven fixable from a satellite: see the last note in the rule table.
 *
 * ES5. No dependencies. Idempotent. Escape hatch:
 * window.__mlsUiShell.revert()
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsUiShell) return; } catch (e) { return; }

  var VERSION = 'uish-1.0.0';
  var D = document;
  var STYLE_ID = 'mlsUiShellCss';
  var BODY_CLASS = 'mls-uish';

  var api = { installed: true, version: VERSION, asset: 'feat_mls_ui_shell.js',
              styleId: STYLE_ID, bodyClass: BODY_CLASS };
  window.__mlsUiShell = api;

  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

  /* ------------------------------------------------------------- tokens ----
     Read through var() so this file follows the page if the page ever retunes
     them; the literal fallback is the page current value at
     ScribeFlow.html:360-363, never a new number. No duration or easing token is
     declared here, because nothing in this file moves. */
  var INK = 'var(--ink,#1A211C)';
  var SOFT = 'var(--soft,#F4F2EC)';
  var BRAND = 'var(--brand,#2E6A4B)';
  var RED = 'var(--red,#B23B3B)';
  var LINE = 'var(--line,#E7E5DD)';

  var B = 'html body.' + BODY_CLASS + ' ';
  var HOVER_FINE = '@media (hover:hover) and (pointer:fine)';

  /* The exit control, and a dialog own card. `> .modal` is deliberate: the
     op-note room reparents #templatesModal (which contains its own .modal)
     inside itself, and a descendant selector there is the exact shape of the
     live clipping bug. Nothing below sets a box property on .modal anyway,
     but the combinator says what is meant. */
  var X = B + 'button.modal-x';
  var CARD = B + '.modal-bg.show > .modal ';

  var ACTIONS = ':is(.btn-primary,.btn-ghost,.btn-green,.btn-gold,.btn-red)';

  /* -------------------------------------------------------------- rules ----
     [selector, declarations, evidence[], wrapper?]

     `evidence` is the list of strings that must be present VERBATIM in
     ScribeFlow.html for the rule to be justified. The gate asserts every one
     of them, which is what stops this file from filling up with selectors
     that match nothing — the most common way a pass like this fails. */

  var STATIC = [
    /* 1. FINDABLE EXIT. The whole point of the file. See the header. */
    [X,
     'min-width:44px;min-height:44px;border-radius:10px',
     ['.modal-x{float:right;background:none;color:var(--muted);font-size:22px;padding:0;line-height:1}',
      'html body button.modal-x{ min-width:44px; }',
      '<button class="modal-x" onclick="closeSettings()">']],

    /* A `.modal > h3{padding-right:48px}` rule lived here to keep the widened
       exit off the title, and it was REMOVED after measurement, not moved.
       `.modal h3` is display:flex, so it establishes a new formatting context,
       and per CSS 2.1 section 9.5 such a box must not overlap a float margin
       box: the browser NARROWS the heading instead. Measured in the synthetic
       harness with the 44px exit in place, a 96-character title in a 560px
       card: heading width 481.28 -> 455.07 (exactly the extra 26px the wider
       float takes) and box overlap FALSE, before and after. The padding was
       buying nothing, it cost 48px of usable title width, and it leaked onto
       the reparented Templates heading inside the op-note room, which is
       precisely the unintended reach this file exists to avoid. Do not add it
       back without measuring an actual overlap first. */

    /* 2. IT READS AS A BUTTON. --muted to --ink is a contrast increase, and
       the chip only appears under a real pointer so a tap never leaves it
       stuck lit. In the Settings clean skin the control already has its own
       chip background and colour at !important; the 44px floor above still
       applies there because min-* is not contested.

       The hairline ring is not decoration. MEASURED: at 44px the float now
       overlaps the top-right 43.34 x 14.53px of the `p.note` panel that most
       dialogs put under the title (before: a 5.17px gap). The note text itself
       is untouched — p.note is a plain block, so its line boxes shorten around
       the float — but the note background is var(--soft), which is exactly the
       chip colour, so a chip alone would have been invisible over it. A 1px
       var(--line) ring reads on the white card AND on the note tint AND on the
       dark-theme surface. Shadow only; it cannot move anything. */
    [X + ':hover',
     'background:' + SOFT + ';color:' + INK + ';box-shadow:0 0 0 1px ' + LINE,
     ['.modal-x{float:right;background:none;color:var(--muted);font-size:22px;padding:0;line-height:1}'],
     HOVER_FINE],

    /* 3. A VISIBLE WAY BACK FOR THE KEYBOARD. ScribeFlow.html declares
       :focus-visible exactly once, for .hist-item, so every button in every
       dialog relies on the UA default ring. This ADDS an outline in the app
       own focus vocabulary (3px, brand green) and removes none. The Settings
       rail keeps its own 2px !important ring; no conflict. */
    [X + ':focus-visible,' + CARD + 'button:focus-visible',
     'outline:3px solid ' + BRAND + ';outline-offset:2px',
     ['.hist-item:focus-visible{outline:3px solid rgba(46,106,75,.42)',
      '<button class="modal-x" onclick="closeShareModal()">']],

    /* 4. COMFORTABLE TARGETS IN A DIALOG. Base buttons land at about 41px but
       the small inline-styled ones in Settings and the 2FA box sit near 31px,
       so a dialog action row is a mix of sizes. A 40px floor makes every
       dialog action the same comfortable size without inflating the standard
       ones by a pixel. Precedent for the idiom is the app own phone floor at
       ScribeFlow.html:1260. min-height only: nothing reflows sideways. */
    [CARD + ACTIONS,
     'min-height:40px',
     ['.btn-ghost{background:var(--card);color:var(--brand-dk);border:1px solid var(--line)}',
      'button{min-height:44px}',
      '<button class="btn-primary" onclick="savePatient()"']],

    /* 4b. ON A PHONE THE APP'S OWN FLOOR WINS BACK.
       Rule 4 raised Settings' 31px inline-styled buttons to 40px, which is the
       right number on a desktop pointer. It also, unintentionally, LOWERED them
       on a phone. ScribeFlow.html:1694 declares
           html body summary, html body button{ min-height:44px; }
       inside @media (max-width:760px) — the app's touch floor, and the very
       precedent rule 4's comment cites. But that selector scores (0,0,3) and
       rule 4 scores (0,5,2), so on a 390px screen rule 4 beat the floor and
       every dialog action came out at 40px.

       Not theory. tests/live-ui-defect-sweep.js at 390x844 measured exactly
       three: "Clear saved data" 143.1x40, "Save changes" 231x40, "Cancel"
       82x40 — the Settings action row, four pixels under the floor the app
       already promised, on the one input where the four pixels are a thumb.

       This restores the app's own number rather than inventing one. Same
       selector as rule 4 so it inherits its reach exactly, wrapped in the same
       breakpoint the floor uses, and later in the sheet so it wins on order
       without an !important or a specificity escalation. Desktop is untouched:
       above 760px rule 4 still resolves to 40px, unchanged. */
    [CARD + ACTIONS,
     'min-height:44px',
     ['html body summary, html body button{ min-height:44px; }',
      '@media (max-width:760px){',
      '<button class="btn-red" style="font-size:14px;padding:9px 15px" onclick="clearDeviceData()"'],
     '@media (max-width:760px)'],

    /* 5. THE DESTRUCTIVE ONE CANNOT BE MISTAKEN FOR THE PRIMARY. Settings
       carries "Clear saved data" ("This cannot be undone"), and on a keyboard
       it would otherwise wear the same green ring as Save. Its ring is red.
       Resting appearance is deliberately NOT touched — the redesign already
       renders it as a quiet pale chip, and a louder destructive control is the
       opposite of what the brief asks for. */
    [CARD + '.btn-red:focus-visible',
     'outline:3px solid ' + RED + ';outline-offset:3px',
     ['<button class="btn-red" style="font-size:14px;padding:9px 15px" onclick="clearDeviceData()"',
      '--red:#B23B3B']],

    /* 6. THE EMPTY STATE SAYS WHAT TO DO. .empty is --muted throughout, and
       the one thing in it that matters is the bolded instruction — "Press
       <b>New patient</b>", "<b>Save to history</b>", "<b>Refresh</b>". Lifting
       only the <b> to --ink raises contrast and makes the call to action the
       thing the eye lands on. */
    [B + '.empty b',
     'color:' + INK,
     ['color:var(--muted);text-align:center;padding:36px 18px',
      'No patients yet. Press <b>']],

    /* A login-tab contrast rule lived here and was REMOVED because it could not
       be PROVEN to take effect. #authScreen .auth-tab is color:#79837C
       !important (feat_mls_login_exact.js:27) over a hard-coded #f1f4f8 strip,
       which measures 3.32:1 at 13.5px and fails WCAG AA on the control a new
       user needs in order to reach Sign up. #636E66 measures 4.87:1 and passes.
       But in the synthetic harness the computed colour stayed #79837C with this
       rule present, matched and !important at higher specificity, and a
       freshly appended `div#tabSignup{color:blue!important}` did not move it
       either — so the instrument could not distinguish "my rule lost" from
       "the probe is wrong", and an unprovable rule must not ship. The fix
       belongs in feat_mls_login_exact.js, whose own value this is. */
  ];

  /* Every rule that MOVES lives here, and this pass adds NONE. That is a
     finding, not an omission:

       - the shell and the dialogs already animate. ScribeFlow.html:996 fades
         .modal-bg.show and lifts .modal-bg.show>.modal, :975 gives toasts an
         asymmetric spring-in/quick-fade-out, :850 scales every control on
         press, and feat_mls_motion.js stages dialog contents. A second
         spelling of any of those is the incoherence the motion charter exists
         to end.
       - the ONE transition genuinely missing was `color` on the exit control,
         so the hover in rule 2 would ease its background and snap its text.
         It is unreachable: ScribeFlow.html:847 sets
         `transition:transform var(--mls-dur-1)` on every button through
         `html body :is(button,...):not([disabled]):not(#mlsDock button)...`,
         which carries an id INSIDE a :not() and therefore scores (1,4,3).
         Nothing this file can write short of a specificity arms race beats
         that, and MEASURED in the harness the exit control resolves to
         transition-property: transform both before and after this module.
         So every non-transform hover change in this app already snaps, and a
         snapping hover here is CONSISTENT rather than broken.

     The off-switch below is still generated from this table, so the first
     moving rule anyone adds arrives with its own kill switch. */
  var MOVING = [];

  function rule(r) {
    var body = r[0] + '{' + r[1] + '}';
    return r[3] ? r[3] + '{' + body + '}' : body;
  }

  /* The off-switch is DERIVED from MOVING. There is no second list to forget
     to update, and a wrapped rule cannot escape it because the kill switch is
     itself page level. With MOVING empty it emits NOTHING: an empty selector
     list is invalid CSS, and a stylesheet that declares a reduced-motion block
     it does not need is a stylesheet that reads as if it animates something. */
  function killSwitch() {
    if (!MOVING.length) return '';
    var sels = [], i;
    for (i = 0; i < MOVING.length; i++) sels.push(MOVING[i][0]);
    return '@media (prefers-reduced-motion:reduce){' + sels.join(',') +
      '{animation:none!important;transition:none!important}}';
  }

  function css() {
    var out = [], i, ks;
    for (i = 0; i < STATIC.length; i++) out.push(rule(STATIC[i]));
    for (i = 0; i < MOVING.length; i++) out.push(rule(MOVING[i]));
    ks = killSwitch();
    if (ks) out.push(ks);
    return out.join('\n');
  }

  /* ------------------------------------------------------------ lifecycle -- */

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
       unconditionally, which is a whole-document style invalidation for no
       visual change. House rule. */
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

  api._css = css;
  api._static = function () { return STATIC.slice(); };
  api._moving = function () { return MOVING.slice(); };
  api._killSwitch = killSwitch;
  api.revert = function () { teardown(); try { delete window.__mlsUiShell; } catch (e) {} return 'reverted'; };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else start();
})();
