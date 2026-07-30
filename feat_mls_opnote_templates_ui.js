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

  var VERSION = 'ot-1.0.0';
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
    [B + '#tplDropZone', 'transition:border-color ' + D2 + ' ' + EO + ', background ' + D2 + ' ' + EO],
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
    B + '.opr-back{ min-height:40px; padding:9px 16px; border-radius:12px;' +
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

  /* ======================= TEMPLATES ====================================== */
  var TEMPLATES = [
    /* Embedded in the room, the card is plain flow content and the PANEL
       scrolls. Restated here deliberately: a nested .modal inheriting
       height:100dvh + overflow:hidden is what made this unscrollable twice. */
    B + '#oprPanelTpls{ padding:20px 24px 40px; }',
    B + '#oprPanelTpls #templatesModal .modal{ height:auto; max-height:none;' +
      ' display:block; overflow:visible; background:transparent; box-shadow:none;' +
      ' border:0; padding:0 0 24px; }',

    B + '#templatesModal h3{ font-size:17px; letter-spacing:-.01em; margin:0 0 4px; }',
    B + '#templatesModal h4{ font-size:14px; letter-spacing:-.005em; }',

    /* --- ADD A TEMPLATE: the intake --- */
    B + '#templatesModal .field{ margin-bottom:12px; }',
    B + '#templatesModal .field label{ font-size:12px; font-weight:750;' +
      ' letter-spacing:.02em; color:var(--muted); }',
    B + '#tplName, ' + B + '#tplKeywords, ' + B + '#tplSearch{ min-height:40px;' +
      ' border-radius:10px; font-size:13.5px; padding:9px 13px; }',
    B + '#tplName:focus, ' + B + '#tplKeywords:focus, ' + B + '#tplSearch:focus{' +
      ' border-color:var(--green-dk); }',

    /* The drop zone is the hero: a real target, not a hint.
       !important throughout, and this is NOT decoration: ScribeFlow.html carries
       an INLINE style on this node (margin-top, border, border-radius, padding,
       text-align, colour, font-size, background), and an inline style beats any
       selector regardless of specificity. Measured in a replica before these
       were added: this element kept radius 10px and padding 16px while the
       stylesheet asked for 16px and 26px 20px. A body class does not help - only
       !important does. */
    /* 2026-07-29 REGRESSION FIX. b795 put !important on `border` (which carries
       border-color) and on `background`. _tplDragOver provides the drag feedback
       by writing exactly those two inline - `z.style.borderColor` and
       `z.style.background` (ScribeFlow.html:16320) - so the zone stopped
       responding when a file was dragged over it: the standard signal that a drop
       will not be accepted, killed. The sibling #tplMultiDrop, which this module
       never restyled, still worked, so the two zones behaved differently on one
       screen.
       This rule now claims SHAPE only - width, style, radius, padding - and
       leaves border-COLOUR and background to the writer that animates them.
       Function over polish: the app's own #cfe0f5 / #fafcff are perfectly fine. */
    B + '#tplDropZone{ border-width:2px !important; border-style:dashed !important;' +
      ' border-radius:16px !important; padding:26px 20px !important;' +
      ' color:var(--muted) !important; font-size:13px !important;' +
      ' font-weight:600; line-height:1.5; }',
    B + '#tplDropZone:hover{ color:var(--ink) !important; }',

    /* The extracted text is editable content the doctor proofreads - readable,
       never condensed. Inline style sets min-height:120px and font-size:13px. */
    B + '#tplText{ min-height:150px !important; border-radius:16px; padding:14px 16px;' +
      ' background:var(--bg); font-size:14px !important; line-height:1.6; }',
    B + '#tplText:focus{ background:var(--card); border-color:var(--green-dk); }',

    /* --- YOUR TEMPLATES: the library --- */
    B + '#tplSearch{ background:var(--bg); }',
    /* The inline max-height:420px + overflow-y:auto on #tplList is CORRECT and
       deliberately left alone: it gives the list its own scroller so a long
       library cannot push the preview pane off the screen. An earlier draft of
       this module set max-height:none here, which would have stretched the page
       and contradicted the invariant its own gate asserts. Measurement caught
       it; only the padding is ours. */
    B + '#tplList{ padding-right:2px; }',
    /* 2026-07-29 REGRESSION FIX. Every declaration here was dead in b795 - no
       !important against an inline style, so the library rows rendered
       byte-identical to b794 (10px radius, 8px 10px padding, no hover) while the
       module header called Templates "a library". Measured.
       Shape is reclaimed with !important. Border-COLOUR and background are NOT:
       renderTemplateList encodes state in them - `border:1px solid
       (isSel?#2E6A4B:var(--line))` and `background:(isSel?#f2f8f4:(isActive?
       #f7fbff:transparent))` - so overriding them would erase which template is
       selected and which is the default. Hover therefore uses box-shadow, which
       no inline style sets, so it can never fight state. */
    B + '#tplList > div{ border-radius:12px !important; padding:10px 12px !important; }',
    B + '#tplList > div:hover{ box-shadow:0 2px 10px rgba(32,64,52,.12); }',
    B + '.opr-tpl-item{ border-radius:12px; padding:10px 12px; }',
    /* Those two state backgrounds are hard-coded near-whites, so in dark theme a
       selected or default row became a white slab with --ink text on it. Restated
       in tokens for dark only; light keeps the values the renderer chose. */
    'body.theme-dark.' + BODY_CLASS + ' #tplList > div[style*="#f2f8f4"]{ background:var(--soft) !important; }',
    'body.theme-dark.' + BODY_CLASS + ' #tplList > div[style*="#f7fbff"]{ background:var(--card) !important; }',
    B + '.opr-tpl-empty{ font-size:12px; color:var(--muted); line-height:1.5; }',

    /* Inline style here sets border, border-radius:10px, padding:12px,
       min-height and position:sticky. The sticky is kept - the preview holding
       still while the list scrolls is the point of the two-pane layout - but the
       chrome needs !important or the pane keeps its old 10px/12px look. */
    B + '#tplDetail{ border:1px solid var(--line) !important; border-radius:16px !important;' +
      ' padding:20px 22px !important; background:var(--card); min-height:220px !important;' +
      ' box-shadow:0 8px 28px rgba(32,64,52,.06); }',
    B + '#tplDetail p{ font-size:13px; line-height:1.6; }',

    /* Buttons in this surface answer a press and read as a hierarchy. */
    B + '#templatesModal .btn-green{ font-weight:750; border-radius:12px;' +
      ' min-height:42px; }',
    B + '#templatesModal .btn-ghost, ' + B + '#templatesModal .edit{' +
      ' border-radius:12px; min-height:40px; font-weight:650; }',

    /* =====================================================================
       2026-07-29 TEMPLATES TAB, REBUILT. Owner: "The templates tab looks
       aweful so defantly completely re do taht and fix it."

       He is right, and the reason is mechanical rather than a matter of taste.
       This one screen is assembled by SIX owners - the base markup, the health
       panel, the cloud library, the stdline section, the multi-upload block and
       the list renderer - and they never agreed on anything. A measured
       inventory of the subtree found THIRTEEN ids carrying inline styles across
       28 distinct properties, plus runtime writers emitting hardcoded #204034,
       #2E6A4B, #127a55, #f2f8f4 and #f7fbff. So: every radius, padding and font
       size differs from its neighbour, nothing reads as the primary action, and
       in dark theme the hardcoded near-whites become white slabs.

       Two consequences for how this is written:
         - !important is used deliberately and only where the inventory proves an
           inline style would otherwise win. It is not decoration.
         - NO new markup. Six modules inject into this subtree and four of them
           walk it, so grouping is done with spacing, dividers and weight rather
           than with wrapper elements. tests/opnote-templates-grips-survive-
           redesign.test.js fails the build if that rule is broken.

       The screen is made to read top-to-bottom as: ADD ONE -> YOUR LIBRARY ->
       THE ONE YOU PICKED.
       ===================================================================== */

    /* --- the whole surface gets one rhythm --------------------------------- */
    B + '#templatesModal .modal > h3{ font-size:19px; letter-spacing:-.015em;' +
      ' margin:0 0 6px !important; }',
    /* the <hr> between intake and library becomes a real section break */
    B + '#templatesModal hr{ border:0 !important; border-top:1px solid var(--line) !important;' +
      ' margin:26px 0 20px !important; }',
    B + '#templatesModal h4{ font-size:15px !important; font-weight:750;' +
      ' letter-spacing:-.01em; margin:0 !important; }',

    /* --- ADD ONE: the intake reads as a single grouped task ---------------- */
    B + '#templatesModal .row.tight{ gap:8px; flex-wrap:wrap; }',
    /* Upload is the primary way in; paste is the alternative. Same size, clearly
       different weight - never two co-equal primaries. */
    B + '#templatesModal .edit{ background:var(--soft) !important;' +
      ' border:1.5px solid var(--green-dk) !important; color:var(--ink) !important;' +
      ' font-weight:750 !important; }',
    B + '#templatesModal .edit:hover{ background:var(--card) !important; }',

    /* --- YOUR LIBRARY ------------------------------------------------------ */
    /* The search box is how a real library is used, so it gets prominence. */
    B + '#tplSearch{ border:1.5px solid var(--line) !important; min-height:42px !important;' +
      ' font-size:14px !important; }',
    B + '#tplSearch:focus{ border-color:var(--green-dk) !important; }',

    /* Rows: a real target, a wrapped name, and state that is never colour alone.
       Padding and radius need !important (the renderer writes both inline);
       border-COLOUR and background do not, because they encode selected/default
       and overriding them would erase which template is which. */
    /* 2026-07-29 SELF-CORRECTION, caught by audit before it reached the owner.
       The first draft of this rule set `display:flex; align-items:center` here.
       The row has THREE stacked block children (name+badge line, keywords, meta),
       so that turned it into a row-direction flex container, flattened all three
       onto one line and made the truncation below WORSE rather than better. The
       row stays normal flow; only the target size and rhythm are ours. */
    B + '#tplList > div{ min-height:46px; cursor:pointer;' +
      ' margin-bottom:7px !important; }',
    /* NEVER TRUNCATE A TEMPLATE NAME. The renderer puts
       `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`
       on the name, and in this pane two templates differing only at the end -
       "... L4-L5 ..." vs "... L5-S1 ..." - render as the SAME string. Choosing
       the wrong one there is a wrong-level operative note. Same fix as the rail.

       SELF-CORRECTION: the first draft of this used a CHILD combinator,
       `#tplList > div > strong`, which matched ZERO elements - the renderer nests
       the name one level deeper inside a `<div style="display:flex...">`. The
       anti-truncation rule was dead, which is the same class of mistake as the
       whole b795 batch: a rule that reads as shipped and changes nothing.
       Descendant combinator, verified against the renderer's actual markup. */
    B + '#tplList > div strong{ white-space:normal !important; overflow:visible !important;' +
      ' text-overflow:clip !important; overflow-wrap:anywhere; line-height:1.35;' +
      ' font-size:13.5px; font-weight:700; }',
    /* the "DEFAULT" marker becomes a pill instead of loose green text */
    B + '#tplList > div span[style*="#127a55"]{ background:var(--soft);' +
      ' border:1px solid var(--green-dk); border-radius:999px;' +
      ' padding:2px 8px; font-size:10px !important; letter-spacing:.03em; }',

    /* --- THE ONE YOU PICKED: the preview pane ----------------------------- */
    B + '#tplDetail h4, ' + B + '#tplDetail #tplDetName{ font-size:15px;' +
      ' letter-spacing:-.01em; }',
    B + '#tplDetail textarea{ border:1px solid var(--line); border-radius:12px;' +
      ' padding:13px 15px; background:var(--bg); font-size:14px !important;' +
      ' line-height:1.6; }',
    B + '#tplDetail textarea:focus{ background:var(--card); border-color:var(--green-dk); }',
    B + '#tplDetail .row{ gap:8px; flex-wrap:wrap; margin-top:12px !important; }',

    /* --- the second drop zone must match the first ------------------------ */
    B + '#tplMultiDrop{ border-width:2px !important; border-style:dashed !important;' +
      ' border-radius:16px !important; padding:22px 18px !important;' +
      ' font-size:13px !important; font-weight:600; line-height:1.5; }',
    B + '#tplMultiStatus, ' + B + '#tplMultiResult{ font-size:12.5px !important;' +
      ' line-height:1.5; }',

    /* --- the injected panels join the same design ------------------------- */
    B + '#tpfPanel, ' + B + '#tlPanel{ border:1px solid var(--line); border-radius:16px;' +
      ' background:var(--card); padding:16px 18px; margin:14px 0;' +
      ' box-shadow:0 6px 22px rgba(32,64,52,.05); }',
    B + '#tpfPanel h4, ' + B + '#tlPanel h4{ margin:0 0 8px !important; }',

    /* --- the two checkboxes read as settings, not as stray text ----------- */
    B + '#templatesModal label:has(#tplUseToggle), ' +
    B + '#templatesModal label:has(#tplAutoChoose){ display:flex; align-items:center;' +
      ' gap:9px; min-height:40px; padding:6px 11px; border-radius:12px;' +
      ' background:var(--bg); border:1px solid var(--line); font-size:13px;' +
      ' font-weight:600; margin:6px 0 !important; cursor:pointer; }',
    /* SELF-CORRECTION: both checkboxes carry an INLINE `width:auto`, so without
       !important the width lost and the height won - a 17px-tall, auto-wide
       checkbox, i.e. visibly non-square. Both dimensions must be forced. */
    B + '#tplUseToggle, ' + B + '#tplAutoChoose{ width:17px !important;' +
      ' height:17px !important; accent-color:var(--green-dk); flex:0 0 auto;' +
      ' cursor:pointer; }',
    /* And the master on/off switch must not be typeset like its own caption. My
       `.field label` rule set 12px/--muted, which is exactly the caption style
       beneath it - so "Use templates" read as small print rather than as the
       setting that governs the whole screen. */
    B + '#templatesModal label:has(#tplUseToggle), ' +
    B + '#templatesModal label:has(#tplAutoChoose){ font-size:13.5px !important;' +
      ' color:var(--ink) !important; font-weight:700 !important;' +
      ' letter-spacing:0 !important; }',

    /* --- DARK THEME: the hardcoded near-whites and greens the renderers emit.
       Without these the pane is a set of white slabs with pale-green text on a
       dark shell - which is most of why this screen "looks awful" for anyone in
       dark mode. Attribute-matched, so light mode keeps the renderer's values. */
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal [style*="#204034"]{ color:var(--green-dk) !important; }',
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal [style*="#127a55"]{ color:var(--green-dk) !important; }',
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal [style*="#fafcff"]{ background:var(--bg) !important; }',
    'body.theme-dark.' + BODY_CLASS + ' #templatesModal [style*="#cfe0f5"]{ border-color:var(--line) !important; }'
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
    B + '#tplWorkspace{ gap:16px !important; }',
    B + '#opPrepList > div{ padding:24px 28px !important; }'
  ];

  /* Narrow: give the sheet its space back and stop the rail eating the screen. */
  var NARROW = [
    /* b795 capped #oprRowNav at 22vh on narrow because an uncapped rail "grew
       without limit and pushed the editor off the bottom" - and left its SIBLING
       #oprTplRail, in the same auto-sized grid row, with no cap at all. The rail
       now lists EVERY template rather than the first six, so that omission got
       worse, not better. Capped and scrollable, same mechanism, same reason. */
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
