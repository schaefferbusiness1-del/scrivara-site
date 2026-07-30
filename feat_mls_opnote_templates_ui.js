/* =============================================================================
 * MLS Scribe — OP NOTES + TEMPLATES, REBUILT   (__mlsOpNoteTemplatesUi) ot-1.0.0
 * 2026-07-29
 * -----------------------------------------------------------------------------
 * OWNER: "completely redo UI for tempaltes and for op notes from scratch and
 * make it amazing buit be carful as tehre is a lot of features that u dont want
 * to screw up when it comes to op notes."
 *
 * He is right about the danger. A generated inventory of these two surfaces
 * (coordination/OPNOTE_TEMPLATES_GRIP_INVENTORY.md) found 23 ids referenced by
 * name across 20 modules, 47 writes into these subtrees, and 102 STRUCTURAL
 * dependencies — parent/sibling/child walks and dynamically-built ids — that
 * break SILENTLY when nesting changes. Four carry real features:
 *
 *   1. #opPrepList must stay a DIRECT CHILD of #oprEditor, or the Prev/Next
 *      pager stops appearing (feat_mls_opnote_room.js:326).
 *   2. textarea#opPrepNote_<i> must keep its PREVIOUS-SIBLING slot free, or
 *      every "gather the missing details" Fields box duplicates or dies
 *      (feat_mls_opnote_fill.js:319).
 *   3. select#opPrepTpl_<i> must keep a parentElement holding the badge slot,
 *      or template-health badges vanish (feat_mls_opnote_integrity.js:586).
 *   4. #tplList must keep a sibling-accepting parent, or the template-health
 *      panel never mounts (mls-connect.js:15668).
 *
 * SO THIS IS A COMPLETE VISUAL REBUILD WITH ZERO DOM RESTRUCTURING. Every
 * change here is a stylesheet rule. This module builds no nodes, moves no
 * nodes, and renames nothing. "From scratch" applies to the design language,
 * not to the markup — which is the only way to redo these two screens without
 * spending features. tests/opnote-templates-grips-survive-redesign.test.js is
 * the fence and fails if this module ever mutates a gripped subtree.
 *
 * HOW IT SUPERSEDES THE OLD SKIN, AND WHY NOT BY LOAD ORDER. The previous
 * presentation lived in #oprSkin inside feat_mls_opnote_room.js. This module
 * removes that element — but it does NOT rely on that, because both modules are
 * loaded by `async` script tags and async scripts execute on arrival, not in
 * append order. Relying on order is precisely the mistake that killed the
 * responsive layout for a day (an unconditioned runtime rule outranking
 * @media (max-width:900px) by source order). Instead EVERY rule here is scoped
 * under `body.mls-ot3`, which adds a class to the selector and therefore wins on
 * SPECIFICITY no matter who appended last. Removal is the tidy path; specificity
 * is the guarantee.
 *
 * AND WIDE-ONLY RULES ARE GATED. Anything that assumes a wide screen sits in
 * @media (min-width:901px) so the narrow rules in ScribeFlow.html can still do
 * their job. tests/runtime-skin-cannot-outrank-responsive.test.js enforces this.
 *
 * THE DESIGN, in one line each:
 *   OP NOTES is an operating list — the day down the left, one procedure sheet
 *   at a time on the right, and the single most important thing on screen is
 *   what MLS still needs from you before the note is finishable.
 *   TEMPLATES is a library — add on the left of the flow, browse below, preview
 *   beside. The drop zone is the hero while you have none and gets out of the
 *   way once you do.
 *
 * HARD RULES honoured: transform/opacity/colour/border/shadow/spacing only;
 * clinical text never shrinks and never animates; no timers; no rAF loops; no
 * document-subtree observer; every
 * animating rule is registered in MOVING so the reduced-motion off-switch is
 * GENERATED; dark theme via tokens; state never conveyed by colour alone. There
 * is deliberately NO body.mls-recording stand-down - that class has no writer in
 * the repo, and this surface has no recording state to yield to (see GUARDS).
 *
 * Idempotent. Revert: window.__mlsOpNoteTemplatesUi.revert()
 * ==========================================================================*/
(function () {
  'use strict';

  var VERSION = 'ot-2.0.0';
  var STYLE_ID = 'mlsOpNoteTemplatesUiCss';
  var BODY_CLASS = 'mls-ot3';
  var OLD_SKIN_ID = 'oprSkin';

  var previous = null;
  try { previous = window.__mlsOpNoteTemplatesUi; } catch (e0) { return; }
  if (previous && previous.installed && previous.version === VERSION) return;
  if (previous && typeof previous.revert === 'function') {
    try { previous.revert(); } catch (e1) {}
  }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  var api = { version: VERSION, installed: true };
  window.__mlsOpNoteTemplatesUi = api;

  /* ---- borrowed tokens, never invented ---------------------------------- */
  var D1 = 'var(--mls-dur-1,120ms)';
  var D2 = 'var(--mls-dur-2,200ms)';
  var D3 = 'var(--mls-dur-3,300ms)';
  var EO = 'var(--mls-ease-out,cubic-bezier(0.22,1,0.36,1))';
  var B = 'body.' + BODY_CLASS + ' ';

  /* Every rule that MOVES is registered here, so the off-switch below is
     derived from it and a new animation cannot ship without one. */
  var MOVING = [
    [B + '.opr-tab', 'transition:background ' + D2 + ' ' + EO + ', color ' + D2 + ' ' + EO],
    [B + '.opr-nav-item', 'transition:transform ' + D2 + ' ' + EO + ', border-color ' + D2 + ' ' + EO + ', background ' + D2 + ' ' + EO],
    [B + '.opr-nav-item:active', 'transform:scale(.995)'],
    [B + '#oprPager button', 'transition:transform ' + D1 + ' ' + EO + ', border-color ' + D1 + ' ' + EO],
    [B + '#oprPager button:active:not([disabled])', 'transform:scale(.97)'],
    [B + '#opPrepList > div', 'transition:box-shadow ' + D3 + ' ' + EO],
    /* 2026-07-30. These two carried NO !important and were therefore DEAD:
       both drop zones ship an inline `transition:all .12s`, and an inline
       declaration beats any selector. Measured on the replica - all five
       transition longhands resolved to the inline value.
       !important here is safe and is NOT the mistake b795 made: what the drag
       handlers write inline is `borderColor` and `background`, which this rule
       does not set - it only says how long a change to them takes. So the drag
       feedback keeps its colours and gains the fade it was always meant to have. */
    [B + '#tplDropZone, ' + B + '#tplMultiDrop',
     'transition:border-color ' + D2 + ' ' + EO + ', background ' + D2 + ' ' + EO +
     ', box-shadow ' + D2 + ' ' + EO + ' !important'],
    /* library rows: hover lift only. box-shadow has no inline owner on these
       rows, which is exactly why it is the property used for hover - it can
       never fight the selected/default state the renderer writes inline. */
    [B + '#tplList > div', 'transition:box-shadow ' + D2 + ' ' + EO],
    [B + '.onf-fillbox', 'transition:box-shadow ' + D3 + ' ' + EO]
  ];

  /* ======================= OP NOTES ======================================= */
  var OPNOTE = [
    /* ---- the room frame ---- */
    B + '#opPrepModal.opr-room > .modal{ background:var(--bg); }',

    /* A header that names where you are and gets you out. The exit is a real
       button with a real target - a 14x23px corner glyph as the only way out
       is a defect the owner already hit once. */
    B + '.opr-top{ padding:14px 60px 14px 20px; gap:18px; background:var(--card);' +
      ' border-bottom:1px solid var(--line); }',
    B + '.opr-top h3{ font-size:17px; letter-spacing:-.01em; white-space:nowrap; }',
    /* 44, NOT 40. `html body button{min-height:44px}` is the app-wide phone tap
       floor at (0,0,3); this selector out-specifies it, so declaring 40 here
       silently LOWERED the floor on the one control that gets you out of the
       room. b800's own commit message reported it ("measured 40px on a phone,
       under the 44px tap floor, on the control that gets you OUT") and it stayed
       at 40. It went on passing locally because
       tests/opnote-room-does-not-trap.test.js measures it in Chrome and skips
       silently when there is no Chrome on the machine - CI has one, and fails
       all four of its assertions. This module's own comment at the injected
       panels below already names this trap; the Back button is where it bit. */
    B + '.opr-back{ min-height:44px; padding:9px 16px; border-radius:12px;' +
      ' border:1.5px solid var(--line); background:var(--card); font-weight:700; }',
    B + '.opr-back:hover{ border-color:var(--green-dk); }',

    /* Tabs as one segmented control, so it reads as "two views of one room"
       rather than two loose buttons. */
    B + '.opr-tabs{ margin-left:4px; gap:2px; padding:3px; border-radius:12px;' +
      ' background:var(--bg); border:1px solid var(--line); }',
    B + '.opr-tab{ padding:7px 15px; border-radius:10px; border:1px solid transparent;' +
      ' background:transparent; color:var(--muted); font-weight:650; font-size:13px; }',
    B + '.opr-tab.on{ background:var(--card); color:var(--ink); border-color:var(--line);' +
      ' box-shadow:0 1px 3px rgba(32,64,52,.10); }',
    B + '.opr-tab:hover:not(.on){ color:var(--ink); }',

    /* ---- the day rail: this is THE LIST ---- */
    /* border-right is WIDE-ONLY and lives in the min-width block. Stated here
       because it is the trap this whole module was written to avoid: these rules
       carry a body class, so an unconditioned `border-right` would out-specify
       ScribeFlow's narrow `#oprDayRail{border-right:0}` and the rail would keep
       a dangling divider on a phone. Higher specificity makes the append-order
       defect WORSE, not better - it wins everywhere instead of just last. */
    B + '#oprDayRail{ padding:18px 16px 28px; background:var(--card); }',
    B + '#oprDayRail .note{ font-size:12.5px; line-height:1.55; color:var(--muted);' +
      ' margin:0 0 14px; }',
    B + '.opr-rail-title{ font-size:10.5px; font-weight:800; letter-spacing:.08em;' +
      ' text-transform:uppercase; color:var(--muted); margin:18px 0 8px; }',

    /* mode + day pickers: full-width, left-aligned, one decision per row */
    B + '#opPrepModeRow{ flex-direction:column; gap:6px !important; margin:2px 0 12px; }',
    /* 2026-07-29 REGRESSION FIX. b795 set `background:var(--bg) !important` here.
       opPrepRender rewrites style.cssText on these two buttons on EVERY render
       with `background:#204034;color:#fff` for the ACTIVE mode - so the
       background lost to my !important while the inline `color:#fff` survived,
       leaving white text on #FBFAF7 at about 1.03:1. The selected mode read as an
       empty box, on every open of the room. Measured, shipped, and mine.
       The rule now claims only SHAPE and leaves every colour to the inline
       writer that owns the state. State also gets a non-colour marker via the
       aria-pressed attribute now written alongside it, so it survives any future
       background override and a screen reader can read it. */
    B + '#opPrepModeRow button{ width:100%; text-align:left; padding:11px 14px !important;' +
      ' border-radius:12px !important; font-weight:650; font-size:13px; }',
    B + '#opPrepModeRow button[aria-pressed="true"]:before{ content:"\\2713\\00a0"; font-weight:800; }',
    B + '#opPrepModeRow button[aria-pressed="false"]:before{ content:"\\00a0\\00a0\\00a0"; }',
    B + '#opPrepDayRow{ flex-direction:column; align-items:stretch !important;' +
      ' gap:8px !important; background:var(--bg); border:1px solid var(--line);' +
      ' border-radius:16px; padding:12px; margin:0 0 12px; }',
    B + '#opPrepDayRow button{ border-radius:10px !important; text-align:left;' +
      ' background:var(--card); min-height:38px; }',
    B + '#opPrepDayRow input{ width:100%; box-sizing:border-box; min-height:38px;' +
      ' border-radius:10px !important; background:var(--card); }',

    /* the patient rows. A left accent bar carries "current", so the state does
       not depend on a border colour alone. */
    B + '#oprRowNav{ gap:5px; }',
    B + '.opr-nav-item{ position:relative; padding:10px 12px 10px 14px; border-radius:12px;' +
      ' border:1.5px solid var(--line); background:var(--bg); align-items:flex-start; }',
    B + '.opr-nav-item:hover{ border-color:var(--green-dk); background:var(--card); }',
    B + '.opr-nav-item .nm{ font-size:13px; font-weight:650; }',
    B + '.opr-nav-item .opr-nav-st{ display:block; font-size:10.5px; font-weight:700;' +
      ' letter-spacing:.02em; color:var(--muted); margin-top:3px; white-space:normal; }',
    B + '.opr-nav-item.on{ border-color:var(--green-dk); background:var(--card);' +
      ' box-shadow:0 2px 12px rgba(32,64,52,.10); }',
    B + '.opr-nav-item.on:before{ content:""; position:absolute; left:0; top:10px; bottom:10px;' +
      ' width:3px; border-radius:0 3px 3px 0; background:var(--green-dk); pointer-events:none; }',
    B + '.opr-dot{ width:9px; height:9px; margin-top:4px; }',

    /* ---- the template rail: now real buttons he can press ----------------
       2026-07-29. These items became <button data-tpl-id> so clicking one applies
       it to the procedure on screen. They need to LOOK pressable, which the old
       divs never did - the sibling patient rows had cursor:pointer and a hover
       and these had neither. */
    B + '#oprTplRail{ display:flex; flex-direction:column; gap:5px; }',
    B + '.opr-tpl-item{ display:flex; align-items:flex-start; gap:8px; width:100%;' +
      ' text-align:left; cursor:pointer; border:1.5px solid var(--line);' +
      ' background:var(--bg); color:var(--ink); font:600 12.5px system-ui;' +
      ' position:relative; }',
    B + '.opr-tpl-item:hover{ border-color:var(--green-dk); background:var(--card); }',
    B + '.opr-tpl-item.on{ border-color:var(--green-dk); background:var(--card);' +
      ' box-shadow:0 2px 12px rgba(32,64,52,.10); }',
    B + '.opr-tpl-item.on:before{ content:""; position:absolute; left:0; top:10px;' +
      ' bottom:10px; width:3px; border-radius:0 3px 3px 0; background:var(--green-dk);' +
      ' pointer-events:none; }',
    B + '.opr-tpl-item .opr-nav-st{ display:block; font-size:10.5px; font-weight:700;' +
      ' color:var(--muted); margin-top:3px; white-space:normal; }',
    B + '.opr-tpl-item.on .opr-nav-st{ color:var(--green-dk); }',
    /* the Edit affordance: quiet until the row is hovered or focused, never hidden
       from a keyboard, and it must never look like the primary action */
    B + '.opr-tpl-edit{ flex:0 0 auto; align-self:center; font:700 10.5px system-ui;' +
      ' color:var(--muted); border:1px solid var(--line); border-radius:999px;' +
      ' padding:3px 9px; background:var(--card); opacity:.55; }',
    B + '.opr-tpl-item:hover .opr-tpl-edit, ' + B + '.opr-tpl-edit:focus-visible{' +
      ' opacity:1; color:var(--ink); border-color:var(--green-dk); }',
    B + '.opr-tpl-edit:focus-visible{ outline:2px solid var(--green-dk); outline-offset:2px; }',

    /* ---- how drafts follow the template: three real choices --------------
       Stacked cards rather than a segmented pill, because each option needs its
       one-line explanation visible - a doctor should not have to hover to learn
       what "Follow it closely" will do to his note. State is the tick plus the
       accent bar, never the colour alone. */
    B + '#oprTplMode{ display:flex; flex-direction:column; gap:5px; margin-top:6px; }',
    B + '.opr-tplmode{ position:relative; display:block; width:100%; text-align:left;' +
      ' cursor:pointer; border:1.5px solid var(--line); border-radius:12px;' +
      ' background:var(--bg); color:var(--ink); padding:9px 11px 9px 13px;' +
      ' font:600 12.5px system-ui; }',
    B + '.opr-tplmode:hover{ border-color:var(--green-dk); background:var(--card); }',
    B + '.opr-tplmode .opr-nav-st{ display:block; font-size:10.5px; font-weight:600;' +
      ' color:var(--muted); margin-top:3px; white-space:normal; line-height:1.4; }',
    B + '.opr-tplmode.on{ border-color:var(--green-dk); background:var(--card);' +
      ' box-shadow:0 2px 12px rgba(32,64,52,.10); }',
    B + '.opr-tplmode.on .nm{ font-weight:750; }',
    B + '.opr-tplmode[aria-pressed="true"] .nm:before{ content:"\\2713\\00a0"; color:var(--green-dk); font-weight:800; }',
    B + '.opr-tplmode.on:before{ content:""; position:absolute; left:0; top:9px; bottom:9px;' +
      ' width:3px; border-radius:0 3px 3px 0; background:var(--green-dk); pointer-events:none; }',
    B + '.opr-tplmode:focus-visible{ outline:2px solid var(--green-dk); outline-offset:2px; }',

    /* ---- NEVER TRUNCATE A CLINICAL NAME --------------------------------------
       ScribeFlow.html:924 puts `overflow:hidden; text-overflow:ellipsis;
       white-space:nowrap` on `.opr-nav-item .nm, .opr-tpl-item .nm` inside a rail
       that is 290-312px wide. "Left L4-L5 transforaminal epidural steroid
       injection" and "Left L5-S1 transforaminal epidural steroid injection"
       truncate to the SAME visible string there, and picking the wrong one is a
       wrong-level operative note. Patient names truncate the same way. Wrapping to
       two or three lines costs a little vertical space in a rail that scrolls;
       an ambiguous name costs more than that. */
    B + '.opr-nav-item .nm, ' + B + '.opr-tpl-item .nm{ white-space:normal !important;' +
      ' overflow:visible !important; text-overflow:clip !important;' +
      ' overflow-wrap:anywhere; line-height:1.35; }',

    /* ---- the editor: one procedure at a time, on a sheet ---- */
    B + '#oprEditor{ padding:24px 28px 72px; }',
    B + '#oprEditor > .row{ margin:0 0 16px !important; }',
    B + '#oprReceipt{ font-size:12px; color:var(--muted); margin:0 0 14px; }',

    /* Draft-all reads as the one big move on the screen. #opPrepGenAllBtn stays
       a real node with a real rect inside a .row - the tpf capture interceptor
       and the history relabeler both need THAT node. */
    B + '#opPrepGenAllBtn{ font-size:14px !important; font-weight:750;' +
      ' padding:12px 22px !important; border-radius:12px !important; }',

    /* pager as a segmented control */
    B + '#oprPager{ display:flex; align-items:center; gap:10px; margin:0 0 14px;' +
      ' padding:4px; border-radius:999px; background:var(--card);' +
      ' border:1px solid var(--line); width:fit-content; }',
    B + '#oprPager button{ font:750 12.5px system-ui; padding:8px 16px; border-radius:999px;' +
      ' border:1px solid transparent; background:transparent; color:var(--ink); cursor:pointer; }',
    B + '#oprPager button:hover:not([disabled]){ background:var(--bg); border-color:var(--line); }',
    B + '#oprPager button[disabled]{ opacity:.4; cursor:default; }',
    B + '#oprPager .opr-pos{ font:750 12px system-ui; color:var(--muted); padding:0 8px; }',

    /* the procedure sheet */
    B + '#opPrepList > div{ border-radius:16px !important; border:1px solid var(--line) !important;' +
      ' background:var(--card) !important; padding:22px 24px !important;' +
      ' box-shadow:0 10px 32px rgba(32,64,52,.07); }',
    B + '#opPrepList > div:hover{ box-shadow:0 12px 36px rgba(32,64,52,.10); }',
    B + '#opPrepList.opr-solo > div{ display:none; }',
    B + '#opPrepList.opr-solo > div.opr-cur{ display:block; }',
    B + '#opPrepList .opr-cur{ box-shadow:0 0 0 1.5px var(--green-dk) inset,' +
      ' 0 10px 32px rgba(32,64,52,.07); }',
    B + '#opPrepList h4, ' + B + '#opPrepList h3{ font-size:15.5px; letter-spacing:-.01em;' +
      ' margin:0 0 10px; }',
    B + '#opPrepList .btn-primary{ font-size:13.5px !important; font-weight:700;' +
      ' padding:11px 20px !important; border-radius:12px !important; }',
    B + '#opPrepList select{ border-radius:10px !important; min-height:38px; }',

    /* THE OPERATIVE NOTE ITSELF. Comfortable measure and line-height; never
       smaller than the app default. This is a legal medical record being read
       under time pressure. */
    /* 2026-07-29: font-size and line-height carried NO !important in b795, and
       opPrepRender builds this node with inline `font-size:12.5px;
       font-family:ui-monospace,...`. So the one property the safety argument
       above was written about was the one that did not apply - the note kept
       rendering at 12.5px while padding and radius changed, and the header
       claimed the opposite. Measured and corrected: !important on the two
       properties that decide legibility. The monospace FAMILY is deliberately
       left alone - it aligns the template's columns and he is used to it; this
       raises the size, it does not restyle his record. */
    B + '#opPrepList textarea{ border:1px solid var(--line); border-radius:16px;' +
      ' padding:16px 18px; background:var(--bg); font-size:15px !important;' +
      ' line-height:1.62 !important; color:var(--ink); }',
    B + '#opPrepList textarea:focus{ background:var(--card); border-color:var(--green-dk);' +
      ' outline:2px solid color-mix(in srgb, var(--green-dk) 30%, transparent);' +
      ' outline-offset:1px; }',

    /* ---- the Fields box: the most important thing on this screen ----------
       This is what MLS still needs before the note is finishable, so it gets a
       gold accent edge and a clear heading instead of looking like more form.
       Its DOM is owned by feat_mls_opnote_fill.js and untouched here. */
    B + '#opPrepModal .onf-fillbox{ border:1px solid var(--line) !important;' +
      ' border-left:3px solid var(--gold) !important; background:var(--bg) !important;' +
      ' border-radius:16px !important; padding:15px 17px 16px !important;' +
      ' box-shadow:0 4px 16px rgba(32,64,52,.05); }',
    B + '#opPrepModal .onf-fillbox .onf-h{ color:var(--ink) !important; font-size:12.5px !important;' +
      ' font-weight:800 !important; letter-spacing:.02em; }',
    B + '#opPrepModal .onf-fillbox .onf-grid{ display:flex !important;' +
      ' flex-direction:column; gap:0 !important; }',
    B + '#opPrepModal .onf-fillbox .onf-field{ padding:11px 2px 12px;' +
      ' border-bottom:1px solid var(--line); }',
    B + '#opPrepModal .onf-fillbox .onf-field:last-child{ border-bottom:0; padding-bottom:2px; }',
    B + '#opPrepModal .onf-fillbox label{ font-size:12.5px !important; color:var(--ink) !important;' +
      ' font-weight:650; gap:5px !important; }',
    B + '#opPrepModal .onf-fillbox input, ' + B + '#opPrepModal .onf-fillbox select{' +
      ' font-size:13.5px !important; min-height:38px; padding:9px 12px !important;' +
      ' border-radius:10px !important; max-width:460px; }',
    B + '#opPrepModal .onf-fillbox .onf-field-actions{ margin-top:7px !important; }',
    B + '#opPrepModal .onf-fillbox .onf-field-actions button{ border-radius:999px !important;' +
      ' font-size:12px; padding:6px 13px; }',

    /* status line stays quiet but readable */
    B + '#opPrepStatus{ font-size:12.5px; color:var(--muted); }'
  ];

  /* ======================= TEMPLATES ======================================
     2026-07-30 — THE TEMPLATES TAB, REBUILT FOR THE THIRD TIME, AND THIS TIME
     IT HAD BETTER LOOK DIFFERENT.

     OWNER, twice: "The templates tab looks aweful so defantly completely re do
     taht and fix it" — and after two builds: he still does not see a change.

     He is right, and the two previous attempts failed for two different
     reasons. b795 shipped rules that LOST to inline styles: nine of twenty
     intended values never applied, so the file read as shipped and the screen
     was byte-identical. b799 fixed the !important problem but only spent it on
     spacing, radii and type at the SAME SIZE — correct, and invisible.
     TIMIDITY IS THE DEFECT BEING CORRECTED HERE.

     WHAT WAS MEASURED (PHI-free replica of this exact subtree, real shipped CSS
     and markup, headless Chrome, 1440/1280/390, light and dark):

       11 distinct font sizes, and NOTHING on the screen bigger than 15px. The
          page title rendered 15px/600 — the same size as, and LIGHTER than, its
          own sub-headings, because `h3{font-size:15px!important}` (the app-wide
          typography clamp) killed both of the previous title rules.
        8 distinct corner radii on 246 painted corners, five of them inside one
          190px band.
       15 background colours, 14 border colours, 9 different vertical gaps.
       17 of 17 top-level blocks full-bleed at 1380px — no column, no measure.
          The biggest control on the screen was the Close button at 57,960px2.
       28 surfaces still painting LIGHT under body.theme-dark, 1.2M px2 in
          total, with one heading at 1.21:1.

     THE SHAPE OF THE ANSWER. One anchor at the top the eye can land on, then
     three bands — ADD ONE / YOUR LIBRARY / THE ONE YOU PICKED — separated by
     the two <hr>s that are already in the markup, each led by a heading with a
     visible accent rule. A bounded intake column against a full-width library,
     so the page has a composition instead of nineteen stacked full-bleed rows.
     One primary action per band. And a type ramp and a radius vocabulary small
     enough to be learnable.

     THE TWO CONSTRAINTS THAT DECIDE HOW IT IS WRITTEN:

     1. NO NEW MARKUP. Six modules assemble this screen and four walk it — two
        of them anchor by HEADING TEXT rather than by id (mountSection scans for
        /template/i then hops to the next <p>; moveStandardLine matches /add a
        standard line to templates/i and walks up to six parents), the health
        panel and the cloud library both mount with
        anchor.parentElement.insertBefore against #tplList, #tplText's
        nextElementSibling must stay the Save/Clear row, and role gating selects
        button[onclick="openTemplates()"] by exact string. So grouping is done
        with spacing, rules, weight and surface — never with a wrapper.
        tests/opnote-templates-grips-survive-redesign.test.js is the fence.

     2. AN INLINE STYLE BEATS EVERY SELECTOR. Thirteen ids here carry 21
        authored inline declarations = 58 longhands = 142 (id, longhand) pairs.
        Every rule below states whether an inline style owns that property, and
        !important appears ONLY where the measurement proves it is needed. Where
        a property is owned by a runtime writer that encodes STATE, it is left
        alone and said so.

     WHAT IS DELIBERATELY NOT CLAIMED, because claiming it would break a feature:
       - #tplDropZone / #tplMultiDrop border-COLOUR and background. _tplDragOver
         and _tplMultiDragOver provide the only "this drop will be accepted"
         signal by writing exactly those two inline (ScribeFlow.html:16502,
         :16610). b795 put !important on them and killed the feedback. This
         rebuild claims SHAPE only — and re-tokens BOTH drag states for dark
         mode by attribute-matching the four literal colours those two handlers
         write, so dark mode is fixed without touching the mechanism.
       - #tplList row border-colour and background. renderTemplateList encodes
         SELECTED (#2E6A4B / #f2f8f4) and DEFAULT (#f7fbff) there. Selected
         state is made visible instead with an inset box-shadow, which no inline
         style sets, plus the aria-selected attribute that is already written.
       - Input font-size at <=760px: `html body input,textarea,select{font-size:
         16px!important}` is the iOS zoom guard. These rules carry NO !important
         on input font-size, so the guard still wins on a phone.
     ====================================================================== */
  var TEMPLATES = [
    /* Embedded in the room, the card is plain flow content and the PANEL
       scrolls. Restated here deliberately: a nested .modal inheriting
       height:100dvh + overflow:hidden is what made this unscrollable twice. */
    B + '#oprPanelTpls{ padding:22px 26px 44px; }',
    B + '#oprPanelTpls #templatesModal .modal{ height:auto; max-height:none;' +
      ' display:block; overflow:visible; background:transparent; box-shadow:none;' +
      ' border:0; padding:0 0 28px; }',

    /* ---------------------------------------------------------------------
       ONE VOCABULARY, DECLARED ONCE. Eight radii became three; the ramp is
       named so a future rule cannot quietly invent a ninth. Custom properties
       inherit, so the three injected panels below pick them up too.
       No inline style sets a custom property anywhere in this subtree. */
    B + '#templatesModal{ --ot-r-lg:22px; --ot-r-md:14px; --ot-col:760px; }',

    /* =====================================================================
       THE ANCHOR. 30px, and it needs !important twice.
       `h1,h2,h3{letter-spacing:-.01em!important}` and
       `h3{font-family:...!important; font-weight:600!important;
       font-size:15px!important}` sit in ScribeFlow.html at :805 and :808 — the
       app-wide typography clamp. Specificity (0,0,1) with !important beats any
       polite rule at any specificity, which is exactly why the previous two
       title rules (17px, then 19px) were both dead and the title rendered at
       the same 15px as its own sub-headings. An !important at (1,1,3) is the
       smallest thing that reaches it. NO inline style on this h3.
       ===================================================================== */
    B + '#templatesModal .modal > h3{ font-size:30px !important; font-weight:800 !important;' +
      ' letter-spacing:-.028em !important; line-height:1.1; color:var(--ink);' +
      ' align-items:baseline; gap:10px; margin:2px 0 12px !important; }',
    /* the "(optional output formatting)" span carries INLINE font-weight:400,
       font-size:14px and color:var(--muted) — all three need !important. It
       becomes the title's kicker rather than a fragment of the title. */
    B + '#templatesModal .modal > h3 > span{ font-size:11.5px !important;' +
      ' font-weight:800 !important; letter-spacing:.09em; text-transform:uppercase;' +
      ' color:var(--muted) !important; }',

    /* The lead paragraph. `.modal p.note` (ScribeFlow.html:1041) gives it a
       --soft slab at 13.5px; no inline style, so no !important is needed. A
       measure-bound rule-in-the-margin reads as a lead, and dropping the slab
       RAISES contrast (muted-on-soft measured 4.75:1; muted-on-page is higher). */
    B + '#templatesModal .modal > p.note{ background:transparent; border:0;' +
      ' border-left:3px solid var(--green-dk); border-radius:0; padding:2px 0 2px 16px;' +
      ' margin:0 0 26px; font-size:15px; line-height:1.62; max-width:var(--ot-col); }',

    /* =====================================================================
       THE THREE BANDS. There is no wrapper to give them, so the separation is
       carried by the two <hr>s that already exist plus a real accent rule above
       each band heading. Both <hr>s carry INLINE
       `border:none;border-top:1px solid var(--line);margin:14px 0`, so every
       one of those longhands needs !important or the band break stays a 1px
       hairline with 14px of air.
       ===================================================================== */
    B + '#templatesModal hr{ border:0 !important; border-top:2px solid var(--line) !important;' +
      ' margin:36px 0 26px !important; }',

    /* Band headings. h4 has NO app-wide !important clamp (the clamp at :805
       covers h1,h2,h3 only), so font-size and weight land without one. margin
       DOES need !important: both are authored inline (`margin:0 0 8px` on "Add
       a template", `margin:0` on "Saved templates").
       Two selectors because the second h4 sits one level deeper, inside the
       flex row that also holds Rename/Remove-duplicates. */
    B + '#templatesModal .modal > h4, ' + B + '#templatesModal .modal > div > h4{' +
      ' font-size:21px; font-weight:800; letter-spacing:-.022em; line-height:1.2;' +
      ' color:var(--ink); margin:0 0 16px !important; max-width:var(--ot-col); }',
    /* the accent rule that makes a band start. Pure form, no invented words. */
    B + '#templatesModal .modal > h4:before, ' + B + '#templatesModal .modal > div > h4:before{' +
      ' content:""; display:block; width:38px; height:4px; border-radius:999px;' +
      ' background:var(--green-dk); margin:0 0 12px; }',
    /* the "Saved templates" heading row itself: the two maintenance buttons
       stop floating 1300px away from the heading they belong to. Its inline
       style sets display/align-items/gap/flex-wrap/margin — margin needs
       !important, the rest is left as authored. */
    B + '#templatesModal .modal > div:has(> h4){ max-width:var(--ot-col);' +
      ' margin:0 0 16px !important; align-items:flex-end !important; }',

    /* =====================================================================
       A COLUMN, NOT A WALL. Every one of the 17 top-level blocks measured
       >=96% of the 1380px card. Capping the intake at 760px and leaving the
       library full width is what turns a stack of rows into a composition —
       and a 13.5px paragraph 1380px wide was never readable anyway.
       `.field` and `.row` are classes with no inline width; #tplDropZone,
       #tplText and #mls-stdline-section have no inline max-width either. So
       none of this needs !important. Unconditioned is safe: at 390px the card
       is 362px, far below the cap, and max-width is not a property any
       max-width @media rule in ScribeFlow.html claims for these elements.
       ===================================================================== */
    B + '#templatesModal .modal > .field, ' + B + '#templatesModal .modal > .row, ' +
    B + '#templatesModal .modal > div[style*="linear-gradient"], ' +
    B + '#templatesModal #tplDropZone, ' + B + '#templatesModal #tplText, ' +
    B + '#templatesModal #mls-stdline-section{ max-width:var(--ot-col); }',
    /* a search box 1380px wide reads as broken; no inline max-width. */
    B + '#tplSearch{ max-width:560px; }',

    /* --- BAND A: the setup switches ---------------------------------------
       Two checkboxes and a select. They are settings, so they read as settings.
       `.field label` would otherwise typeset the master switch at caption size,
       which is how "Use templates" ended up looking like its own small print. */
    B + '#templatesModal .field{ margin-bottom:16px; }',
    B + '#templatesModal .field label{ font-size:11.5px; font-weight:800;' +
      ' letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }',
    /* the parenthetical inside the Keywords label is a sentence, not a
       micro-label - uppercasing it would be unreadable. It carries INLINE
       font-weight:400 and color, which are left exactly as authored. */
    B + '#templatesModal .field > label[for] > span{ text-transform:none;' +
      ' letter-spacing:0; font-size:11.5px; font-weight:600; }',
    B + '#templatesModal label:has(#tplUseToggle), ' +
    B + '#templatesModal label:has(#tplAutoChoose){ display:flex; align-items:center;' +
      ' gap:11px; min-height:48px; padding:9px 15px; border-radius:var(--ot-r-md);' +
      ' background:var(--card); border:1.5px solid var(--line);' +
      ' margin:8px 0 !important; cursor:pointer; font-size:15px !important;' +
      ' color:var(--ink) !important; font-weight:650 !important;' +
      ' letter-spacing:0 !important; text-transform:none !important; }',
    B + '#templatesModal label:has(#tplUseToggle):hover, ' +
    B + '#templatesModal label:has(#tplAutoChoose):hover{ border-color:var(--green-dk); }',
    /* SELF-CORRECTION kept from b799: both checkboxes carry an INLINE
       `width:auto`, so without !important the width lost while the height won
       and the box rendered visibly non-square. Both dimensions must be forced. */
    B + '#tplUseToggle, ' + B + '#tplAutoChoose{ width:19px !important;' +
      ' height:19px !important; accent-color:var(--green-dk); flex:0 0 auto;' +
      ' cursor:pointer; }',
    B + '#tplActiveSel{ min-height:46px; border-radius:var(--ot-r-md); font-size:15px; }',
    /* the explanatory caption under the master switch carries an INLINE
       font-size:12px, so it needs !important to join the ramp. */
    B + '#templatesModal .modal > .field > div[style*="12px"]{ font-size:13px !important;' +
      ' line-height:1.55; color:var(--muted); margin-top:8px !important; max-width:66ch; }',

    /* --- BAND B: adding one -----------------------------------------------
       The bulk-import card first, then the single-template path. The card is
       the loudest colour on the screen today and it is not even in the app's
       palette: INLINE `background:linear-gradient(135deg,#eef4ff,#f3ecff)` with
       an INLINE `border:1px solid #EAF1EE`, `border-radius:10px`,
       `padding:13px 14px` and `margin-bottom:14px`. Every one of those needs
       !important; there is no other way to reach an inline declaration. */
    B + '#templatesModal .modal > div[style*="linear-gradient"]{' +
      ' background:var(--soft) !important; border:1.5px solid var(--line) !important;' +
      ' border-radius:var(--ot-r-lg) !important; padding:18px 20px !important;' +
      ' margin:0 0 26px !important; }',
    /* its own title/sub lines carry INLINE font-weight:700/font-size:14px and
       font-size:12.5px + margin — !important on each. */
    B + '#templatesModal div[style*="linear-gradient"] > div[style*="font-weight:700"]{' +
      ' font-size:15px !important; font-weight:800 !important; letter-spacing:-.015em;' +
      ' color:var(--ink); }',
    B + '#templatesModal div[style*="linear-gradient"] > div[style*="12.5px"]{' +
      ' font-size:13px !important; line-height:1.55; margin:5px 0 14px !important;' +
      ' max-width:62ch; }',
    /* ONE primary in this card. Inline font-size:13px and padding:8px 14px. */
    B + '#templatesModal div[style*="linear-gradient"] .btn-primary{ font-size:15px !important;' +
      ' font-weight:750; padding:13px 22px !important; border-radius:var(--ot-r-md) !important;' +
      ' min-height:48px; }',

    /* the two drop zones. SHAPE ONLY — border-colour and background belong to
       the drag handlers (see the header). Inline sets border-radius:10px and
       padding:14/16px and font-size, so those three need !important; the
       2px dashed border width/style is restated with !important because the
       inline shorthand carries it too. */
    B + '#tplDropZone, ' + B + '#tplMultiDrop{ border-width:2px !important;' +
      ' border-style:dashed !important; border-radius:var(--ot-r-lg) !important;' +
      ' font-weight:650; line-height:1.55; }',
    B + '#tplDropZone{ padding:34px 24px !important; font-size:15px !important;' +
      ' color:var(--muted) !important; margin-top:16px !important; }',
    B + '#tplMultiDrop{ padding:26px 20px !important; font-size:13px !important;' +
      ' margin-top:16px !important; }',
    B + '#tplDropZone:hover, ' + B + '#tplMultiDrop:hover{ color:var(--ink) !important;' +
      ' box-shadow:0 6px 22px rgba(32,64,52,.10); }',
    B + '#tplMultiStatus, ' + B + '#tplMultiResult{ font-size:13px !important;' +
      ' line-height:1.55; }',

    /* THE DROP ZONE AS THE HERO WHILE THE LIBRARY IS EMPTY.
       #tplList:empty is NOT the state to key on: renderTemplateList writes a
       <p> into the list when there is nothing to show (ScribeFlow.html:16219
       and :16223), so the list is never :empty after the first render. The
       honest selector is "the list is showing a message instead of rows". */
    B + '#templatesModal:has(#tplList > p) #tplDropZone{ padding:70px 26px !important;' +
      ' font-size:17px !important; font-weight:750 !important; border-width:3px !important;' +
      ' color:var(--ink) !important; }',
    /* and the empty message itself stays quiet, so the hero is the hero. */
    B + '#tplList > p{ font-size:13.5px !important; line-height:1.6; margin:6px 2px !important;' +
      ' color:var(--muted); }',

    /* name / keywords / search. NO !important on font-size: at <=760px
       `html body input[...]{font-size:16px!important}` is the iOS zoom guard
       and must keep winning. No inline styles on these three except
       #tplSearch's width:100%, which is left alone. */
    B + '#tplName, ' + B + '#tplKeywords, ' + B + '#tplSearch{ min-height:48px;' +
      ' border-radius:var(--ot-r-md); font-size:15px; padding:12px 15px;' +
      ' border:1.5px solid var(--line); }',
    B + '#tplName:focus, ' + B + '#tplKeywords:focus, ' + B + '#tplSearch:focus{' +
      ' border-color:var(--green-dk); }',
    B + '#tplName:focus-visible, ' + B + '#tplKeywords:focus-visible, ' +
    B + '#tplSearch:focus-visible{ outline:2px solid var(--green-dk); outline-offset:2px; }',

    /* the extracted text the doctor proofreads. INLINE min-height:120px,
       font-size:13px and margin-top:8px, and the app-wide input rule also
       declares font-size !important — so this one DOES need !important to
       reach a legible size, and it is the only input here that gets it,
       because a textarea does not trigger the iOS zoom the guard exists for. */
    B + '#tplText{ min-height:170px !important; border-radius:var(--ot-r-lg);' +
      ' padding:16px 18px; background:var(--card); border:1.5px solid var(--line);' +
      ' font-size:15px !important; line-height:1.62; margin-top:16px !important; }',
    B + '#tplText:focus{ border-color:var(--green-dk); }',
    B + '#tplText:focus-visible{ outline:2px solid var(--green-dk); outline-offset:2px; }',

    /* --- ONE PRIMARY PER BAND --------------------------------------------
       b799 promoted `.edit` with a green border and a soft fill, which put it
       in direct competition with the drop zone directly beneath it AND with
       Save. Upload has a 760x100 dashed target one row down; it does not also
       need to be a primary. It goes quiet, and 💾 Save template is the single
       primary of this band. */
    /* NO !important anywhere in this rule, and that is a correction, not an
       oversight. b799 wrote `color:var(--ink) !important` here - and an
       !important stylesheet declaration beats a NON-important inline one, so
       that would have silently repainted the preview pane's DELETE control,
       whose red is written inline as `color:#a12c2c`, in ordinary ink.
       `.btn-ghost` and `.edit` are only ever declared at (0,1,0) or by the bare
       `button{}` base, so (1,2,1) reaches them politely and the inline red
       survives. min-height is 44, not 40: `html body button{min-height:44px}` is
       the phone tap floor at (0,0,3) and this selector OUT-SPECIFIES it, so it
       has to satisfy the floor itself. */
    B + '#templatesModal .edit, ' + B + '#templatesModal .btn-ghost{' +
      ' background:var(--card); border:1.5px solid var(--line);' +
      ' color:var(--ink); font-weight:650;' +
      ' border-radius:var(--ot-r-md); min-height:44px; font-size:13px; }',
    B + '#templatesModal .edit:hover, ' + B + '#templatesModal .btn-ghost:hover{' +
      ' border-color:var(--green-dk); background:var(--soft); }',
    B + '#templatesModal .btn-green{ font-weight:750; border-radius:var(--ot-r-md);' +
      ' min-height:52px; font-size:15px; }',
    B + '#templatesModal .modal > .row{ gap:10px; margin-top:16px !important;' +
      ' align-items:center; }',
    B + '#templatesModal .row.tight{ gap:10px; flex-wrap:wrap; margin-top:16px !important; }',
    /* focus must stay visible on every control this module restyles */
    B + '#templatesModal button:focus-visible{ outline:2px solid var(--green-dk);' +
      ' outline-offset:2px; }',

    /* THE CLOSE ROW. The Close button measured 1380x42 = 57,960px2, the biggest
       control on the screen, purely because it carries an INLINE `flex:1` in a
       full-width row. flex needs !important; the row's `margin-top:14px` is
       inline too. A quiet, right-hand, auto-width exit under a hairline. */
    B + '#templatesModal .modal > .row:last-child{ justify-content:flex-end;' +
      ' border-top:1px solid var(--line); padding-top:20px; margin-top:26px !important; }',
    B + '#templatesModal .modal > .row:last-child > button{ flex:0 0 auto !important;' +
      ' min-width:170px; }',

    /* --- BAND C: your library --------------------------------------------
       The two maintenance buttons beside the heading are tertiary. Inline
       font-size:12.5px and padding:6px 11px on both, so both need !important. */
    B + '#templatesModal .modal > div:has(> h4) > .btn-ghost{ font-size:13px !important;' +
      ' padding:12px 16px !important; min-height:44px; font-weight:700; }',

    /* The inline `max-height:420px; overflow-y:auto` on #tplList is CORRECT and
       stays: it gives the list its own scroller so a long library cannot push
       the preview pane off the screen. Only the padding is ours here; the
       wide-screen ceiling is raised in the min-width block below, because the
       rows are now taller and 420px would show fewer of them than before. */
    B + '#tplList{ padding-right:4px; }',
    /* the search field's own bottom margin is INLINE (8px); rather than fight
       it with !important, the workspace supplies the other 8 itself. */
    B + '#tplWorkspace{ margin-top:8px; }',

    /* A ROW THAT LOOKS LIKE A ROW.
       renderTemplateList writes border, border-radius, padding, margin-bottom,
       background and cursor INLINE on every row, so radius/padding/margin all
       need !important — that is precisely what was measured dead in b795, where
       the rows rendered byte-identical to b794 while the header called this "a
       library". border-COLOUR and background are NOT claimed: they encode
       selected (#2E6A4B / #f2f8f4) and default (#f7fbff).
       SELF-CORRECTION kept from b799: no display:flex here. The row has three
       stacked block children and turning it into a row-direction flex container
       flattens all three onto one line. */
    B + '#tplList > div{ min-height:76px; border-radius:var(--ot-r-md) !important;' +
      ' padding:15px 17px !important; margin-bottom:10px !important; cursor:pointer; }',
    B + '#tplList > div:hover{ box-shadow:0 4px 16px rgba(32,64,52,.14); }',
    /* SELECTED, visible at a glance and WITHOUT touching the state colours: an
       inset left bar. No inline style sets box-shadow on these rows, so it can
       never fight the renderer. aria-selected is already written by
       renderTemplateList, so the hook needs no new markup. */
    B + '#tplList > div[aria-selected="true"]{ box-shadow:inset 4px 0 0 var(--green-dk),' +
      ' 0 4px 16px rgba(32,64,52,.12); }',
    B + '#tplList > div:focus-visible{ outline:2px solid var(--green-dk); outline-offset:2px; }',
    /* NEVER TRUNCATE A TEMPLATE NAME. The renderer puts
       `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`
       on the name, and two templates differing only at the end — "... L4-L5 ..."
       vs "... L5-S1 ..." — render as the SAME string in a 524px pane. Choosing
       the wrong one there is a wrong-level operative note. All four of those
       longhands are inline, so all four need !important.
       SELF-CORRECTION kept from b799: DESCENDANT combinator. `> strong` matched
       zero elements because the name is nested one level deeper inside the
       renderer's own flex div — a dead anti-truncation rule. */
    B + '#tplList > div strong{ white-space:normal !important; overflow:visible !important;' +
      ' text-overflow:clip !important; overflow-wrap:anywhere; line-height:1.32;' +
      ' font-size:15px; font-weight:750; letter-spacing:-.012em; }',
    /* the two sub-lines carry INLINE font-size (11.5px keywords, 11px meta). */
    B + '#tplList > div div[style*="11.5px"]{ font-size:13px !important; margin-top:5px;' +
      ' color:var(--muted); }',
    B + '#tplList > div div[style*="font-size:11px"]{ font-size:13px !important;' +
      ' margin-top:4px; color:var(--muted); }',
    /* the DEFAULT marker becomes a real pill. Inline font-size:10px + colour. */
    B + '#tplList > div span[style*="#127a55"]{ background:var(--soft);' +
      ' border:1px solid var(--green-dk); border-radius:999px; padding:3px 10px;' +
      ' font-size:11.5px !important; font-weight:800; letter-spacing:.06em; }',

    /* --- THE ONE YOU PICKED: the preview pane -----------------------------
       Inline sets border, border-radius:10px, padding:12px, min-height:200px
       and position:sticky. The sticky stays — the preview holding still while
       the list scrolls is the whole point of the two-pane layout — but radius,
       padding and min-height each need !important. This is the only raised card
       in the band, which is what makes it read as a different surface from the
       flat rows beside it. */
    B + '#tplDetail{ border:1.5px solid var(--line) !important;' +
      ' border-radius:var(--ot-r-lg) !important; padding:24px 26px !important;' +
      ' background:var(--card); min-height:260px !important;' +
      ' box-shadow:0 14px 40px rgba(32,64,52,.09); }',
    B + '#tplDetail p{ font-size:14px; line-height:1.6; color:var(--muted); }',
    B + '#tplDetail .field{ margin-bottom:14px !important; }',
    B + '#tplDetail #tplDetName, ' + B + '#tplDetail #tplDetKw{ min-height:46px;' +
      ' border-radius:var(--ot-r-md); font-size:15px; }',
    /* #tplDetText carries an INLINE `font:12.5px/1.5 ui-monospace,...` shorthand,
       which sets font-size and line-height inline — both need !important. The
       monospace FAMILY is deliberately left alone: it aligns the template's own
       columns and the owner is used to it. */
    B + '#tplDetail textarea{ border:1.5px solid var(--line); border-radius:var(--ot-r-md);' +
      ' padding:15px 17px; background:var(--bg); font-size:15px !important;' +
      ' line-height:1.6 !important; }',
    B + '#tplDetail textarea:focus{ background:var(--card); border-color:var(--green-dk); }',
    B + '#tplDetail #tplDetStatus{ font-size:13px !important; margin:10px 0 !important; }',
    /* the pane's action row: one primary (Save changes), the rest quiet. Each
       of those five buttons carries INLINE font-size:12.5px and padding:7px 12px. */
    B + '#tplDetail button{ font-size:13px !important; padding:11px 16px !important;' +
      ' min-height:44px; border-radius:var(--ot-r-md); }',
    B + '#tplDetail .btn-green{ font-size:15px !important; padding:12px 20px !important;' +
      ' min-height:48px; }',
    B + '#tplDetail > div:last-child{ gap:8px !important; margin-top:16px; }',

    /* --- the three injected panels join the same design -------------------
       #tpfPanel (template health, mls-connect.js), #tlPanel (cloud library,
       feat_mls_template_library.js) and #mls-stdline-section (standard lines)
       each ship their own stylesheet with their own palette — a blue-purple
       gradient, a green-blue gradient and a blue card, none of them the app's.
       Together they were 15 of the 15 measured background colours and most of
       the 1.2M px2 that stayed light in dark mode.
       They are MAINTENANCE, so they go flat and quiet: no card face, a hairline
       rule to separate them, and a small uppercase heading. Every declaration
       in their own sheets is at (1,0,x) or (1,1,x); these selectors are one
       class higher, so none of this needs !important except where THEY used it. */
    B + '#tpfPanel, ' + B + '#tlPanel{ background:transparent; border:0;' +
      ' border-top:1px solid var(--line); border-radius:0; padding:20px 0 4px;' +
      ' margin:10px 0 0; box-shadow:none; color:var(--ink); }',
    B + '#mls-stdline-section{ background:transparent; border:0;' +
      ' border-left:3px solid var(--line); border-radius:0; padding:2px 0 2px 16px;' +
      ' margin:0 0 26px; color:var(--ink); }',
    /* ONE type size across all three, so the 11 sizes on this screen can come
       down. Their own rules are at (1,0,1)/(1,1,0); these are (1,1,1). */
    B + '#tpfPanel *, ' + B + '#tlPanel *, ' + B + '#mls-stdline-section *{ font-size:13px; }',
    B + '#tpfPanel h4, ' + B + '#tpfPanel summary, ' + B + '#tlPanel h4, ' +
    B + '#mls-stdline-section .mls-sl-h{ font-size:11.5px !important; font-weight:800 !important;' +
      ' letter-spacing:.09em; text-transform:uppercase; color:var(--muted) !important;' +
      ' margin:0 0 8px !important; }',
    B + '#tpfPanel .tpf-sub, ' + B + '#tlPanel .tl-sub, ' +
    B + '#mls-stdline-section .mls-sl-sub{ color:var(--muted); line-height:1.55;' +
      ' max-width:74ch; }',
    B + '#tpfPanel label, ' + B + '#tlPanel label, ' +
    B + '#mls-stdline-section label.mls-sl-lab{ color:var(--muted); font-size:11.5px;' +
      ' font-weight:800; letter-spacing:.06em; text-transform:uppercase; }',
    /* their controls onto the shared radius + a real target height. 44 for the
       buttons, not the 30-33px they ship at: these selectors out-specify the
       `html body button{min-height:44px}` phone floor, so they have to meet it
       themselves - the same trap that left the room's Back button at 40px. */
    B + '#tpfPanel button, ' + B + '#tlPanel button, ' +
    B + '#mls-stdline-section .mls-sl-btn{ border-radius:var(--ot-r-md);' +
      ' border:1px solid var(--line); background:var(--card); color:var(--ink);' +
      ' min-height:44px; padding:9px 14px; }',
    B + '#tlPanel input, ' + B + '#tlPanel select, ' +
    B + '#mls-stdline-section textarea.mls-sl-text{ border-radius:var(--ot-r-md);' +
      ' border:1px solid var(--line); background:var(--card); color:var(--ink);' +
      ' min-height:42px; }',
    B + '#tpfPanel button:hover, ' + B + '#tlPanel button:hover{ background:var(--soft);' +
      ' border-color:var(--green-dk); }',
    B + '#mls-stdline-section .mls-sl-btn{ background:var(--green) !important;' +
      ' color:#fff !important; font-weight:750; padding:10px 18px; min-height:44px; }',
    B + '#tpfPanel .tpf-row, ' + B + '#tpfPanel .tpf-prev, ' + B + '#tlPanel .tl-active, ' +
    B + '#mls-stdline-section .mls-sl-tpls, ' + B + '#mls-stdline-section .mls-sl-item, ' +
    B + '#mls-stdline-section .mls-sl-chk{ border-radius:var(--ot-r-md);' +
      ' border:1px solid var(--line); background:var(--card); color:var(--ink); }',
    /* .tl-warn declares background and colour with !important, so the only way
       to re-token it is with !important. */
    B + '#tlPanel .tl-warn{ background:var(--gold-bg) !important; color:var(--ink) !important;' +
      ' border:1px solid var(--gold) !important; border-left:4px solid var(--gold) !important; }',
    /* pills stay pills — the third and last radius in the vocabulary */
    B + '#tpfPanel .tpf-badge, ' + B + '#tlPanel .tl-count, ' +
    B + '#mls-stdline-section .mls-sl-pill{ border-radius:999px; font-size:11.5px;' +
      ' font-weight:800; letter-spacing:.04em; padding:3px 10px; }',
    B + '#mls-stdline-section .mls-sl-chk.on{ background:var(--green) !important;' +
      ' border-color:var(--green) !important; color:#fff !important; }',
    B + '#tpfPanel button:focus-visible, ' + B + '#tlPanel button:focus-visible, ' +
    B + '#mls-stdline-section .mls-sl-btn:focus-visible{ outline:2px solid var(--green-dk);' +
      ' outline-offset:2px; }',

    /* the op-note rail row keeps the same radius vocabulary. It lives OUTSIDE
       #templatesModal so the custom property is not in scope; literal 14px. */
    B + '.opr-tpl-item{ border-radius:14px; padding:10px 12px; }',
    B + '.opr-tpl-empty{ font-size:13px; color:var(--muted); line-height:1.55; }',

    /* =====================================================================
       DARK THEME. Measured before this pass: 28 surfaces totalling 1,202,031px2
       still painted LIGHT under body.theme-dark, and 11 text nodes fell below
       4.5:1 — the worst a heading at 1.21:1, i.e. unreadable.
       Everything above already re-tokens the three injected panels, so what is
       left here is the colours that are written INLINE by a renderer or forced
       with !important by a foreign sheet. Attribute-matched, so light mode
       keeps exactly the values the renderers chose.
       ===================================================================== */
    /* the two green-on-white buttons. In dark, --brand-dk and --green resolve to
       LIGHT greens (#7CC4A0, #5FAF87) and `.btn-primary{color:#fff}` /
       `.btn-green{color:#fff}` then measure 2.05:1 and 2.64:1. Dark ink on the
       light green is the fix; the backgrounds stay as the app chose them.
       `.btn-primary`'s colour is not !important, so (1,3,1) is enough. */
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal .btn-primary, ' +
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal .btn-green, ' +
    'body.theme-dark.' + BODY_CLASS + ' #mls-stdline-section .mls-sl-btn, ' +
    'body.theme-dark.' + BODY_CLASS + ' #mls-stdline-section .mls-sl-chk.on{' +
      ' color:#10231A !important; }',
    /* the renderers' hardcoded greens read as ink-on-dark otherwise */
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal [style*="#204034"]{ color:var(--green-dk) !important; }',
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal [style*="#127a55"]{ color:var(--green-dk) !important; }',
    /* the Delete affordance in the preview pane is INLINE `color:#a12c2c`,
       which measured 2.23:1 on the dark card. */
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal [style*="#a12c2c"]{ color:var(--red) !important; }',
    /* BOTH DRAG STATES of BOTH drop zones. This is the one place the rebuild
       overrides a background the drag handlers own — and it does it by matching
       the specific literal each handler writes, so the resting state and the
       armed state are each re-tokened and the FEEDBACK STILL WORKS. The rgb()
       twins are required because the moment JS assigns el.style.background the
       whole style attribute is re-serialised out of hex. */
    'body.theme-dark.' + BODY_CLASS + ' #tplDropZone[style*="#fafcff"], ' +
    'body.theme-dark.' + BODY_CLASS + ' #tplDropZone[style*="250, 252, 255"], ' +
    'body.theme-dark.' + BODY_CLASS + ' #tplMultiDrop[style*="#fbfbff"], ' +
    'body.theme-dark.' + BODY_CLASS + ' #tplMultiDrop[style*="251, 251, 255"]{' +
      ' background:var(--bg) !important; }',
    'body.theme-dark.' + BODY_CLASS + ' #tplDropZone[style*="#EAF1EE"], ' +
    'body.theme-dark.' + BODY_CLASS + ' #tplDropZone[style*="234, 241, 238"], ' +
    'body.theme-dark.' + BODY_CLASS + ' #tplMultiDrop[style*="#eef0ff"], ' +
    'body.theme-dark.' + BODY_CLASS + ' #tplMultiDrop[style*="238, 240, 255"]{' +
      ' background:var(--soft) !important; }',
    'body.theme-dark.' + BODY_CLASS + ' #tplDropZone[style*="#cfe0f5"], ' +
    'body.theme-dark.' + BODY_CLASS + ' #tplDropZone[style*="207, 224, 245"], ' +
    'body.theme-dark.' + BODY_CLASS + ' #tplMultiDrop[style*="#EAF1EE"], ' +
    'body.theme-dark.' + BODY_CLASS + ' #tplMultiDrop[style*="234, 241, 238"]{' +
      ' border-color:var(--line) !important; }',
    /* the two row state colours are hardcoded near-whites; in dark a selected or
       default row would be a white slab under --ink text. Restated in tokens for
       dark ONLY, so light keeps exactly what the renderer chose. */
    'body.theme-dark.' + BODY_CLASS + ' #tplList > div[style*="#f2f8f4"]{ background:var(--soft) !important; }',
    'body.theme-dark.' + BODY_CLASS + ' #tplList > div[style*="#f7fbff"]{ background:var(--card) !important; }',
    /* the neutral text colours those three panels hardcode. These are NOT
       state colours - #5a6c82, #13283f, #16233a, #5a6b80, #29493d and
       #7a8aa0 are just greys and navies - so they are re-tokened in BOTH
       themes. Measured: '.mls-sl-empty' was the last text node under 4.5:1
       in dark, at 3.31:1. The .tpf-badge / .tl-count status chips are left
       exactly as they are: they encode ok/bad/warn and they already pass. */
    B + '#tpfPanel .tpf-name, ' + B + '#tpfPanel .tpf-prev, ' + B + '#tpfMatchOut, ' +
    B + '#tlPanel .tl-import-review, ' + B + '#mls-stdline-section .mls-sl-item .txt{' +
      ' color:var(--ink); }',
    B + '#tpfPanel .tpf-meta, ' + B + '#tpfLedgerList .pend, ' +
    B + '#mls-stdline-section .mls-sl-empty, ' + B + '#mls-stdline-section .mls-sl-none{' +
      ' color:var(--muted); }',
    B + '#mls-stdline-section .mls-sl-pill{ background:var(--soft); border:1px solid var(--line);' +
      ' color:var(--ink); }',
    B + '#mls-stdline-section .mls-sl-mini.edit{ background:var(--soft); color:var(--ink); }',
    B + '#mls-stdline-section .mls-sl-mini.del{ background:var(--soft); color:var(--red); }',
    /* the disclosure that opens the health panel is a 1380px-wide row only
       27px tall; padding, not min-height, so the marker survives. */
    B + '#tpfPanel summary{ padding:11px 0; cursor:pointer; }',

    /* the bulk-import card's inline gradient */
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal [style*="linear-gradient"]{' +
      ' background:var(--soft) !important; }'
  ];

  /* ======================= THE TEMPLATES TAB, COMPOSED ====================
     ot-2.0.0, 2026-07-30 — OWNER: "make a completely working new UI the
     templates tab only of op notes as I love the other tabs but just hate the
     templates UI."

     WHY A FOURTH PASS, AND WHY THIS ONE IS DIFFERENT IN KIND. b795, b799 and
     ot-1.0.0 were all PAINT. They fixed real things — a title that rendered at
     the same size as its own sub-headings, nine rules that lost to inline
     styles, 28 surfaces that stayed light in dark mode — and the owner still
     says he hates the screen. He is right, and repainting a fourth time would
     be the same mistake a fourth time, because the complaint was never the
     paint. It is the SHAPE:

       Everything above is a stack. Twenty top-level blocks, one under the
       other, in the order they happened to be authored. Opening Templates puts
       a checkbox, a select, a bulk-import advert, a name field, a keywords
       field, two buttons, a drop zone and a textarea between the doctor and
       THE THING HE CAME FOR — his own templates, which are dead last.

     So this pass changes the composition and nothing else. The library becomes
     the hero and comes first; setup and intake become a sidebar beside it. Two
     real columns on a wide screen, one column with the library hoisted above
     the intake on a narrow one.

     HOW IT IS DONE WITHOUT TOUCHING THE MARKUP. Not one node is created, moved,
     renamed or removed — the 102 structural grips make that non-negotiable and
     tests/opnote-templates-grips-survive-redesign.test.js is the fence. The
     card becomes a CSS grid and every child is PLACED. Reordering and
     two-columning a fixed set of children is exactly what grid placement is
     for, and it is invisible to every module that walks this subtree: the DOM
     order, the parent chain and the sibling relationships are all byte-identical
     to before.

     THE FOUR DECISIONS THAT MAKE IT SAFE:

     1. SCOPED TO THE TAB, NOT THE MODAL. Every selector here is under
        `#oprPanelTpls #templatesModal` — the reparented card inside the op-note
        room, which is the surface the owner named. Templates opened classically
        as a floating dialog is a 960px-wide box that cannot hold two columns
        anyway, and it keeps exactly the presentation it has today. One less
        surface changed is one less surface to regress.

     2. `display:grid` ON THE EMBEDDED CARD, DELIBERATELY, AND THE CLIPPING
        DEFECT CANNOT COME BACK WITH IT. tests/templates-panel-scrolls.test.js
        fails a flex/grid `display` on this card, because the owner reported
        "STILL CANT SCROLL DOWN IN TEMPLATES" twice and the cause was the room's
        `.modal{height:100dvh; display:flex; overflow:hidden}` leaking in. That
        suite reads ScribeFlow.html's <style> blocks only, so it would not see
        this rule — which is precisely why the rule must not be smuggled past
        it. What actually clipped was the HEIGHT CONSTRAINT, not the formatting
        context: `height:100dvh` + `overflow:hidden`. This sets neither, sets no
        max-height, and leaves `#oprPanelTpls` owning the scrolling exactly as
        it does today. tests/templates-tab-layout-proved.test.js re-states that
        invariant against THIS file and measures the resolved values in real
        Chrome, so the guarantee moves with the change instead of being dodged.

     3. EVERY RULE IS INSIDE `@supports selector(:has(*))`. Six of the children
        have no id and no class of their own, so they can only be addressed
        through `:has()`. A browser without `:has()` would apply the placements
        it understood and auto-place the rest — a jumble, which is worse than
        the stack. Gating the whole composition on the feature means such a
        browser gets today's single-column screen intact.

     4. THE CATCH-ALL COMES FIRST. Six modules inject panels into this card at
        runtime and more may follow. `> *` spans the full width and sorts after
        the intake, so a panel this file has never heard of lands in a sane
        place instead of landing in the middle of the sidebar.
     ====================================================================== */

  /* the reparented card, and its direct children */
  var R = B + '#oprPanelTpls #templatesModal ';
  var RM = R + '.modal > ';

  /* ONE COLUMN, LIBRARY FIRST. Applies at every width; the two-column block
     below refines it from 1100px up. `order` is the whole mechanism, so the
     DOM keeps the order every walker expects and only the paint moves. */
  var TAB_ONECOL = [
    R + '.modal{ display:grid; grid-template-columns:minmax(0,1fr); row-gap:0; }',
    /* unknown/injected children: full width, and after the intake */
    RM + '*{ grid-column:1; min-width:0; order:45; }',

    RM + 'h3{ order:1; }',
    RM + 'p.note{ order:2; }',
    R + '#mls-stdline-section{ order:3; }',
    /* the two switches are setup, and they are two lines, so they stay at the
       top where they read as the state of the screen rather than as a form */
    RM + '.field:has(#tplUseToggle){ order:4; }',
    RM + '#tplActiveWrap{ order:5; }',
    /* THE LIBRARY, hoisted over everything it used to sit under */
    RM + 'div:has(> h4){ order:6; }',
    RM + '.field:has(#tplSearch){ order:7; }',
    R + '#tplWorkspace{ order:8; }',
    /* then intake */
    RM + 'h4{ order:20; }',
    RM + '.field:has(#tplName){ order:21; }',
    RM + '.field:has(#tplKeywords){ order:22; }',
    RM + '.row.tight{ order:23; }',
    R + '#tplDropZone{ order:24; }',
    R + '#tplText{ order:25; }',
    RM + '.row:has(> button[onclick^="saveTemplateFromForm"]){ order:26; }',
    RM + 'div[style*="linear-gradient"]{ order:27; }',
    RM + '.row:has(> button[onclick^="closeTemplates"]){ order:90; }',
    /* The two <hr>s existed to separate three stacked bands. There are no
       stacked bands any more, so they are noise. Their inline
       `border-top:1px solid var(--line)` needs !important to silence. */
    RM + 'hr{ display:none !important; }'
  ];

  /* TWO COLUMNS from 1100px. Below that the sidebar would be narrower than the
     drop zone it holds, so the one-column order above is the better screen. */
  var TAB_TWOCOL = [
    /* THE ROW STRUCTURE, AND THE ONE RULE THAT DECIDES IT.
       A grid row is shared by both columns and is sized by its TALLEST cell. So
       every row that holds an item in each column opens a gap under whichever of
       the two is shorter. Measured on the first cut of this layout: the library
       heading sat in the same row as the "Active template" select and the gap
       under it was 106px, with another 152px under the search field. The screen
       had two columns and still looked broken.

       The fix is structural, not cosmetic: COLUMN 1 CONTRIBUTES EXACTLY ONE ITEM
       to the two-column region. Everything above the library - the master switch,
       the library heading and its search - spans the full width instead, and the
       sidebar is the only stack of many rows. Nothing can then be short beside
       something tall.

       Row 16 is the slack absorber. #tplWorkspace spans rows 7-16 while the
       sidebar occupies 7-15; when the library is the taller of the two, a grid
       distributes the surplus across every row the spanning item covers, which
       would re-open the same gap under each sidebar control. A flexible track is
       excluded from that intrinsic distribution and takes the remainder instead
       (CSS Grid 12.6/12.7), so the surplus lands in one empty row underneath the
       sidebar. Measured after: every sidebar gap 16px, the design value. */
    R + '.modal{ grid-template-columns:minmax(0,1fr) 384px; column-gap:40px;' +
      ' align-items:start; grid-template-rows:repeat(15,auto) 1fr auto; }',
    RM + '*{ grid-column:1 / -1; }',

    /* FULL WIDTH - the masthead */
    RM + 'h3{ grid-area:1 / 1 / 2 / -1; }',
    RM + 'p.note{ grid-area:2 / 1 / 3 / -1; }',
    R + '#mls-stdline-section{ grid-area:3 / 1 / 4 / -1; }',

    /* COLUMN 1 - the master switch, the library header, then the library. Only
       ONE of these (the workspace) shares a row with the sidebar stack, which is
       what keeps the left edge gap-free. */
    RM + '.field:has(#tplUseToggle){ grid-area:4 / 1 / 5 / 2; }',
    RM + 'div:has(> h4){ grid-area:5 / 1 / 6 / 2; }',
    RM + '.field:has(#tplSearch){ grid-area:6 / 1 / 7 / 2; }',
    R + '#tplWorkspace{ grid-area:7 / 1 / 17 / 2; }',

    /* COLUMN 2, rows 4-6: which template is in force. It SPANS the three header
       rows rather than taking one of its own, so it fills what would otherwise be
       400px of dead space beside them and still cannot stretch a row - a spanning
       item sits at the top of its span and only grows the tracks if it is taller
       than all three together, which the left-column gap assertion pins. */
    RM + '#tplActiveWrap{ grid-area:4 / 2 / 7 / 3; }',
    /* rows 7+: adding one, then the bulk path */
    RM + 'h4{ grid-area:7 / 2 / 8 / 3; }',
    RM + '.field:has(#tplName){ grid-area:8 / 2 / 9 / 3; }',
    RM + '.field:has(#tplKeywords){ grid-area:9 / 2 / 10 / 3; }',
    RM + '.row.tight{ grid-area:10 / 2 / 11 / 3; }',
    R + '#tplDropZone{ grid-area:11 / 2 / 12 / 3; }',
    R + '#tplText{ grid-area:12 / 2 / 13 / 3; }',
    RM + '.row:has(> button[onclick^="saveTemplateFromForm"]){ grid-area:13 / 2 / 14 / 3; }',
    RM + 'div[style*="linear-gradient"]{ grid-area:14 / 2 / 15 / 3; }',

    /* the exit, under both columns */
    RM + '.row:has(> button[onclick^="closeTemplates"]){ grid-area:17 / 1 / 18 / -1; }',

    /* the library is the hero now, so it gets the height. The inline
       `max-height:420px` on #tplList and the 600px raise in WIDE are both
       out-specified here on purpose: with the intake beside it rather than
       above it, the list finally has the room to show a real library. */
    R + '#tplList{ max-height:min(62vh,720px) !important; }',
    /* the sidebar's own controls stop pretending they have 760px to spend */
    R + '#tplText{ min-height:150px !important; }',
    R + '#tplDropZone{ padding:26px 18px !important; }',
    /* the preview pane holds still while the list scrolls - the inline
       `position:sticky; top:0` already does this; it only needs somewhere to
       stick FROM, which the taller column now gives it. */
    R + '#tplDetail{ top:8px; }'
  ];

  /* Wide-only: the two-pane template workspace and the roomier editor. Gated so
     the narrow rules in ScribeFlow.html still apply - an unconditioned rule here
     is exactly what killed the responsive layout before. */
  var WIDE = [
    /* On a wide screen the rail is its own column, so it can be generous - but
       still bounded, because the template list is now complete rather than the
       first six and the patient nav sits above it in the same column. */
    B + '#oprTplRail{ max-height:42vh; overflow:auto; }',
    B + '#oprDayRail{ border-right:1px solid var(--line); }',
    B + '#oprEditor{ padding:26px 34px 80px; }',
    B + '#oprPanelTpls{ padding:24px 30px 48px; }',
    /* grid-template-columns is INLINE on #tplWorkspace and stays inline (the
       narrow rules in ScribeFlow.html already override it with !important); only
       the gap is ours, and it needs !important for the same inline reason. */
    B + '#tplWorkspace{ gap:22px !important; }',
    /* The rows are now 76px tall instead of ~46px, so the inline
       `max-height:420px` would show FEWER templates than before the rebuild -
       a density regression hiding inside a visual improvement. Raised on wide
       screens only, and it needs !important because that ceiling is inline.
       Gated deliberately: a phone keeps the 420px scroller so the preview pane
       underneath is still reachable without a long scroll. */
    B + '#tplList{ max-height:600px !important; }',
    B + '#opPrepList > div{ padding:24px 28px !important; }'
  ];

  /* Narrow: give the sheet its space back and stop the rail eating the screen. */
  var NARROW = [
    /* b795 capped #oprRowNav at 22vh on narrow because an uncapped rail "grew
       without limit and pushed the editor off the bottom" - and left its SIBLING
       #oprTplRail, in the same auto-sized grid row, with no cap at all. The rail
       now lists EVERY template rather than the first six, so that omission got
       worse, not better. Capped and scrollable, same mechanism, same reason. */
    /* ---- Templates on a phone -------------------------------------------
       At <=640px the workspace collapses to one column and #tplList keeps its
       own inline 420px scroller. A 101px row would show barely four templates
       before an inner scroll, which is FEWER than before this rebuild - a
       density regression hiding inside a visual improvement, measured at 390px.
       Rows tighten, the ceiling lifts, and the 30px title comes down one step
       so its kicker does not wrap twice. Everything here is inside the
       max-width block, so none of it can out-rank a narrow rule. */
    B + '#tplList{ max-height:520px !important; }',
    B + '#tplList > div{ min-height:64px; padding:12px 14px !important; }',
    B + '#templatesModal .modal > h3{ font-size:26px !important; }',
    B + '#tplDetail{ padding:18px 18px !important; }',
    B + '#tplText{ min-height:150px !important; }',
    B + '#tplDropZone{ padding:26px 16px !important; }',
    B + '#templatesModal hr{ margin:28px 0 22px !important; }',
    B + '#oprTplRail{ max-height:26vh; overflow:auto; }',
    B + '#oprEditor{ padding:16px 14px 56px; }',
    B + '#oprPanelTpls{ padding:14px 14px 32px; }',
    B + '#opPrepList > div{ padding:16px 15px !important; }',
    B + '#oprDayRail{ padding:14px 14px 18px; border-right:0;' +
      ' border-bottom:1px solid var(--line); }',
    B + '.opr-top{ padding:12px 54px 12px 14px; gap:10px; flex-wrap:wrap; }',
    B + '#oprPager{ flex-wrap:wrap; }',
    B + '#opPrepModal .onf-fillbox input, ' + B + '#opPrepModal .onf-fillbox select{' +
      ' max-width:none; }'
  ];

  /* Clinical text and anything being typed into never animates.
     This deliberately does NOT carry a `body.mls-recording` stand-down. An
     earlier draft did, copied from the sibling motion modules - and a repo-wide
     grep found that class has NO classList writer anywhere: it appears only
     inside CSS in three modules, all of which are therefore standing down on a
     condition nothing ever sets. A guard that can never fire is worse than no
     guard, because it reads in review as a safety property that has been
     handled. It is also unnecessary here: nothing in the op-note room or the
     Templates library records audio - drafts are generated from templates, not
     dictated - so there is no recording state for this surface to yield to. */
  var GUARDS =
    B + '#opPrepList textarea, ' + B + '#tplText, ' + B + '.onf-fillbox input,' +
    B + '.onf-fillbox select{ animation:none !important; }';

  function build() {
    var out = [];
    MOVING.forEach(function (r) { out.push(r[0] + '{' + r[1] + '}'); });
    out = out.concat(OPNOTE, TEMPLATES);
    out.push('@media (min-width:901px){' + WIDE.join('') + '}');
    out.push('@media (max-width:900px){' + NARROW.join('') + '}');
    /* ot-2.0.0: the composition goes LAST so that where it ties on specificity
       with a rule above (the WIDE #tplList ceiling is the only one) it wins by
       source order rather than by an !important nobody can later unwind. The
       @supports gate is on both blocks: partial placement is worse than none. */
    out.push('@supports selector(:has(*)){' + TAB_ONECOL.join('') + '}');
    out.push('@media (min-width:1100px){@supports selector(:has(*)){' +
      TAB_TWOCOL.join('') + '}}');
    out.push(GUARDS);
    /* GENERATED off-switch: derived from MOVING, never hand-maintained. */
    out.push('@media (prefers-reduced-motion: reduce){' +
      MOVING.map(function (r) { return r[0]; }).join(',') +
      '{transition:none !important; animation:none !important; transform:none !important}}');
    return out.join('\n');
  }
  api.css = build;

  /* ---- install: remove the old opinion, then own the surface ------------- */
  api.install = function () {
    safe(function () {
      var old = document.getElementById(OLD_SKIN_ID);
      if (old && old.parentNode) old.parentNode.removeChild(old);
    });
    safe(function () {
      var st = document.getElementById(STYLE_ID);
      if (!st) {
        st = document.createElement('style');
        st.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(st);
      }
      if (st.textContent !== api.__css) { st.textContent = api.__css = build(); }
    });
    /* the scope class is what makes this win on specificity regardless of the
       async load order of the two modules */
    safe(function () { document.body.classList.add(BODY_CLASS); });
  };

  api.revert = function () {
    safe(function () {
      var st = document.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
    });
    safe(function () { document.body.classList.remove(BODY_CLASS); });
    safe(function () { delete window.__mlsOpNoteTemplatesUi; });
  };

  /* body may not exist yet if this arrives early; one deferred retry, no loop */
  if (document.body) api.install();
  else safe(function () {
    document.addEventListener('DOMContentLoaded', function () { api.install(); }, { once: true });
  });
})();
