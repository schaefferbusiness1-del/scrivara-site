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
    B + '#opPrepModeRow button{ width:100%; text-align:left; padding:11px 14px !important;' +
      ' border-radius:12px !important; border:1.5px solid var(--line) !important;' +
      ' background:var(--bg) !important; font-weight:650; font-size:13px; }',
    B + '#opPrepModeRow button:hover{ border-color:var(--green-dk) !important; }',
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
    B + '#opPrepList textarea{ border:1px solid var(--line); border-radius:16px;' +
      ' padding:16px 18px; background:var(--bg); font-size:15px; line-height:1.62;' +
      ' color:var(--ink); }',
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
    B + '#tplDropZone{ border:2px dashed var(--line) !important;' +
      ' border-radius:16px !important; padding:26px 20px !important;' +
      ' background:var(--bg) !important; color:var(--muted) !important;' +
      ' font-size:13px !important; font-weight:600; line-height:1.5; }',
    B + '#tplDropZone:hover{ border-color:var(--green-dk) !important;' +
      ' background:var(--card) !important; color:var(--ink) !important; }',

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
    B + '#tplList > div, ' + B + '.opr-tpl-item{ border-radius:12px;' +
      ' border:1.5px solid transparent; padding:10px 12px; }',
    B + '#tplList > div:hover{ border-color:var(--line); background:var(--card); }',
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
      ' border-radius:12px; min-height:40px; font-weight:650; }'
  ];

  /* Wide-only: the two-pane template workspace and the roomier editor. Gated so
     the narrow rules in ScribeFlow.html still apply - an unconditioned rule here
     is exactly what killed the responsive layout before. */
  var WIDE = [
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
