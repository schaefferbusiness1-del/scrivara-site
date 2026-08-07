/* =============================================================================
 * __mlsOpNoteRoom  opr-1.2.0  (2026-07-27 — Stage 2b of OPNOTE_WORKROOM_PLAN)
 * -----------------------------------------------------------------------------
 * The op-notes workroom. Owner-approved direction (2026-07-26, direction
 * check): ONE full-screen room replaces the two op-note modals; #opPrepModal
 * STAYS the container (option C in the plan — three satellites gate the entire
 * Fields box on that id's computed display, the decisive seam) and
 * #templatesModal reparents WHOLE as the Templates tab (Stage 3).
 *
 * STAGE 2b — the rails come alive. This module now:
 *   - wraps window.opPrepRender (idempotent, first-party idiom): after every
 *     list rebuild it (1) SYNCHRONOUSLY kicks the onf Fields-box tick — the
 *     occluded-tab law from b715: this tab's REAL posture is hidden behind
 *     athenaOne, where a 1s interval beats ~1/minute, so a re-render mid-draft
 *     would kill every Fields box for up to a minute if we waited for a timer —
 *     and (2) rebuilds the room rails;
 *   - builds #oprRowNav (one button per patient row: status dot — drafted /
 *     blanks remaining / not drafted — edited mark, click scrolls that row's
 *     card into view and marks it current);
 *   - builds #oprTplRail (template health at a glance via the tpf owner's own
 *     healthOf — single source, exported as __mlsTplPrepFix.healthOf — with
 *     the Templates tab as the one door to manage them);
 *   - fills #oprReceipt for the selected row: an HONEST context line naming
 *     the verified-visit count that will ground the draft (never a claim of
 *     content it cannot see).
 *   All writes land ONLY in room-owned nodes (#oprRowNav/#oprTplRail/
 *   #oprReceipt) plus one presentation class (.opr-cur) on the selected row
 *   card; the injection anchors inside #opPrepList are never touched.
 *
 * HARD RULES the stages inherit (from OPNOTE_WORKROOM_PLAN_2026-07-26.md):
 *   - ALL room code lives HERE. Never between the fourteen byte-pinned slice
 *     markers in ScribeFlow.html (save-truth, exact-patient-binding,
 *     site-continuity all slice by literal text; one slice runs in a vm).
 *   - #opPrepModal keeps its id and class-toggled open (modalOpen() gates in
 *     feat_mls_opnote_fill.js:95, feat_opnote_history.js:569,
 *     feat_mls_opnote_prep.js:369 — any other container silently kills every
 *     .onf-fillbox in the app).
 *   - #opPrepTpl_i keeps a parent whose first span.mini>span is the badge slot
 *     (integrity:583); #opPrepNote_i keeps its previous-sibling slot FREE
 *     (onf:1200 inserts the Fields box there).
 *   - #opPrepGenAllBtn stays a real node with a real rect inside a .row (the
 *     tpf capture interceptor and the history relabeler need THAT node).
 *   - No setInterval. No document-subtree observer. Motion tokens only,
 *     transform/opacity only. Radius 22/16/10/999.
 *
 * 2026-07-28 REMAKE (owner order: "I don't like the OpNotes UI - completely
 * remake from scratch the OpNotes UI"). This module now OWNS the room's
 * presentation - a calm one-room skin (brand greens, 16px radii, soft
 * shadows, generous whitespace), the day/mode rail as a tidy single column,
 * ONE patient card at a time in all-day mode (the other cards stay in the
 * DOM, presentation-hidden by a room class; every satellite keeps its node),
 * a Prev/Next pager, arrow-key patient navigation, and a one-field-per-row
 * Fields panel. The PIPELINE is untouched: drafts still flow through
 * window.opPrepGenerateOne, Draft-all through the real #opPrepGenAllBtn,
 * saves through opPrepSave, and the per-field "Use every time" mechanism is
 * owned by feat_mls_opnote_fill.js (this module only presents it).
 * ==========================================================================*/
(function () {
  'use strict';
  var VERSION = 'opr-2.0.0';
  var previous = null;
  try { previous = window.__mlsOpNoteRoom; } catch (e0) {}
  if (previous && previous.installed && previous.version === VERSION) return;
  if (previous && typeof previous.revert === 'function') {
    try { previous.revert(); } catch (e1) {}
  }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function esc(s) { return S(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isFn(f) { return typeof f === 'function'; }
  function shown(el) { return !!(el && el.classList && el.classList.contains('show')); }

  /* -------------------- 2026-07-28 remake: the room skin -------------------
     Presentation ONLY, layered over the legacy inline styles by specificity
     and !important where an inline style would otherwise win. Every id and
     anchor the satellites grip stays byte-identical in ScribeFlow.html. */
  var SKIN_ID = 'oprSkin';
  function skin() {
    if ($(SKIN_ID)) return;
    /* 2026-07-29: feat_mls_opnote_templates_ui.js (ot-1.0.0) owns this room's
       presentation now and removes #oprSkin once at its install. Both modules
       arrive on `async` script tags, so if that one executed FIRST this function
       would recreate the old skin after it and the two would coexist - and in
       that state the old rules win wherever they carry an id, including
       `#opPrepModal.opr-room .opr-top`, which is the header the findable-exit
       work depends on. Removal alone was never a guarantee; this closes the race
       from the other side, so order genuinely cannot matter. */
    if (safe(function () { return !!window.__mlsOpNoteTemplatesUi; }, false)) return;
    safe(function () {
      var st = document.createElement('style'); st.id = SKIN_ID;
      st.textContent = [
        '/* op-note room remake 2026-07-28 - calm one-room presentation */',
        '#opPrepModal.opr-room .opr-top{ padding:14px 56px 14px 20px; gap:16px; }',
        /* 2026-07-29, measured at 390x844 in a PHI-free replica of this room:
           this skin is APPENDED to <head> at runtime, so an unconditioned
           #oprPanelProcs rule here outranks the ScribeFlow
             @media (max-width:900px){ #oprPanelProcs{ grid-template-columns:1fr } }
           by source order at equal specificity (a media query adds none). The
           room's responsive collapse has therefore been dead since this skin
           shipped: on a 390px phone the room still drew a 312px sidebar, left
           ~78px for the editor, and pushed 9 procedure buttons past the right
           edge of the screen. Wide-only declarations must be gated so the
           narrow rules that already exist can do their job. */
        '@media (min-width:901px){',
        '  #oprPanelProcs{ grid-template-columns:312px minmax(0,1fr); }',
        '}',
        '#oprDayRail{ padding:16px 18px 26px; }',
        '#opPrepModeRow{ flex-direction:column; gap:6px !important; }',
        '#opPrepModeRow button{ width:100%; text-align:left; border-radius:12px !important; padding:10px 14px !important; }',
        '#opPrepDayRow{ flex-direction:column; align-items:stretch !important; gap:7px !important;',
        '  background:var(--bg); border:1px solid var(--line); border-radius:16px; padding:12px; }',
        '#opPrepDayRow button{ border-radius:10px !important; text-align:left; background:var(--card); }',
        '#opPrepDayRow input{ width:100%; box-sizing:border-box; border-radius:10px !important; background:var(--card); }',
        /* Same trap: `max-height:none` here killed BOTH the base 38vh cap and
           the narrow 22vh cap, so on a phone the patient rail grew without
           limit and pushed the editor off the bottom. Uncapping is a deliberate
           WIDE-screen choice, where the rail is its own column; gate it. */
        '#oprRowNav{ gap:6px; }',
        '@media (min-width:901px){ #oprRowNav{ max-height:none; } }',
        '.opr-nav-item{ background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:9px 11px; }',
        '.opr-nav-item .opr-nav-st{ display:block; font-size:10.5px; font-weight:600; color:var(--muted); margin-top:2px; white-space:normal; }',
        '.opr-nav-item.on{ border-color:var(--green-dk); background:var(--card); box-shadow:0 2px 10px rgba(32,64,52,.10); }',
        '#oprEditor{ padding:22px 30px 60px; }',
        '#oprEditor > .row{ margin:0 0 14px !important; }',
        '#opPrepGenAllBtn{ font-size:14px !important; padding:11px 20px !important; border-radius:12px !important; }',
        '#oprPager{ display:flex; align-items:center; gap:12px; margin:0 0 12px; }',
        '#oprPager button{ font:700 12.5px system-ui; padding:8px 16px; border:1px solid var(--line);',
        '  border-radius:999px; background:var(--card); color:var(--ink); cursor:pointer; }',
        '#oprPager button:hover{ border-color:var(--green-dk); }',
        '#oprPager button[disabled]{ opacity:.45; cursor:default; }',
        '#oprPager .opr-pos{ font:700 12px system-ui; color:var(--muted); }',
        '#opPrepList > div{ border-radius:16px !important; border:1px solid var(--line) !important;',
        '  background:var(--card) !important; padding:18px 20px !important; box-shadow:0 8px 28px rgba(32,64,52,.06); }',
        '#opPrepList.opr-solo > div{ display:none; }',
        '#opPrepList.opr-solo > div.opr-cur{ display:block; }',
        '#opPrepList .btn-primary{ font-size:13.5px !important; padding:10px 18px !important; border-radius:12px !important; }',
        '#opPrepList textarea{ border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:var(--bg); }',
        '/* the Fields panel: one field per row, calm card, roomy controls */',
        '#opPrepModal .onf-fillbox{ border:1px solid var(--line) !important; background:var(--card) !important;',
        '  border-radius:16px !important; padding:14px 16px 16px !important; }',
        '#opPrepModal .onf-fillbox .onf-h{ color:var(--ink) !important; font-size:13px !important; }',
        '#opPrepModal .onf-fillbox .onf-grid{ display:flex !important; flex-direction:column; gap:0 !important; }',
        '#opPrepModal .onf-fillbox .onf-field{ padding:10px 2px 11px; border-bottom:1px solid var(--line); }',
        '#opPrepModal .onf-fillbox .onf-field:last-child{ border-bottom:0; }',
        '#opPrepModal .onf-fillbox label{ font-size:12.5px !important; color:var(--ink) !important; gap:5px !important; }',
        '#opPrepModal .onf-fillbox input, #opPrepModal .onf-fillbox select{ font-size:13px !important;',
        '  padding:9px 11px !important; border-radius:10px !important; max-width:460px; }',
        '#opPrepModal .onf-fillbox .onf-field-actions{ margin-top:6px !important; }',
        '#opPrepModal .onf-fillbox .onf-field-actions button{ border-radius:999px !important; }',
        '@media (max-width:700px){',
        '  #oprEditor{ padding:14px 12px 44px; }',
        '  #opPrepList > div{ padding:13px 12px !important; }',
        '  #opPrepModal .onf-fillbox input, #opPrepModal .onf-fillbox select{ max-width:none; }',
        '  #oprPager{ flex-wrap:wrap; }',
        '}'
      ].join('\n');
      (document.head || document.documentElement).appendChild(st);
    });
  }

  /* Stage 1 ESC OWNERSHIP. Two .modal-bg surfaces can be open at once (the
     room + the Templates modal over it) and two ESC handlers already exist:
     the pinned document-capture handler (closes the room; DO NOT EDIT IT) and
     theme_polish's last-open-modal closer. A doctor on the Templates modal
     expects ESC to close THAT and return to the room - not to lose the room.
     window-capture fires before both; when templates is open we close it and
     stop the event so the room survives. When only the room is open, we do
     nothing and the existing owners behave exactly as before. */
  function onKey(e) {
    if (e.key !== 'Escape') return;
    var room = $('opPrepModal'), tpl = $('templatesModal');
    if (!shown(room) || !shown(tpl)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    safe(function () { if (isFn(window.closeTemplates)) window.closeTemplates(); });
  }
  window.addEventListener('keydown', onKey, true);

  /* ------------------------- selection + rails ---------------------------- */
  var SEL = 0;   /* selected row index; clamped on every rebuild */

  function rowCard(i) {
    /* The row card is the parent of the preview node the base render creates.
       Read-only lookup — never restructure it. */
    var prev = $('opPrepPrev_' + i);
    return prev ? prev.parentElement : null;
  }
  function blanksOf(row) {
    if (!row || !row.gen) return 0;
    return safe(function () { return isFn(window.opNoteBlankTokens) ? (window.opNoteBlankTokens(row.note || '').length || 0) : 0; }, 0);
  }

  function oprSelect(i, scroll) {
    var rows = window._opPrep || [];
    if (!rows.length) return;
    if (i < 0) i = 0; if (i >= rows.length) i = rows.length - 1;
    if (SEL !== i) ARMED_TPL = '';
    SEL = i;
    safe(function () {
      var list = $('opPrepList'); if (!list) return;
      var cur = list.querySelectorAll('.opr-cur'), k;
      for (k = 0; k < cur.length; k++) cur[k].classList.remove('opr-cur');
      var card = rowCard(i);
      if (card) {
        card.classList.add('opr-cur');
        /* opr-1.2.1: smooth scrolling is rAF-driven and this tab's REAL
           posture is occluded behind athenaOne — a 'smooth' request there
           NEVER MOVES (proven live at b719: card 1908px below the fold,
           scrollTop pinned at 0). Smooth only when actually visible. */
        if (scroll) card.scrollIntoView({ behavior: (document.visibilityState === 'visible' ? 'smooth' : 'auto'), block: 'start' });
      }
    });
    safe(markNav); safe(buildReceipt); safe(buildPager);
  }

  function markNav() {
    var nav = $('oprRowNav'); if (!nav) return;
    var items = nav.querySelectorAll('.opr-nav-item');
    for (var k = 0; k < items.length; k++) {
      if (+items[k].getAttribute('data-i') === SEL) items[k].classList.add('on');
      else items[k].classList.remove('on');
    }
  }

  function buildNav() {
    var nav = $('oprRowNav'); if (!nav) return;
    var rows = window._opPrep || [];
    /* 2026-07-29: THE CLAMP MUST COME FIRST. These two lines were the other way
       round, so the single-row early return skipped the clamp entirely - and
       switching from "All scheduled patients" (say SEL=2) to "This patient" (one
       row) left SEL pointing past the end of the array. Everything that reads
       _opPrep[SEL] then found undefined, and the context receipt #oprReceipt hid
       itself and never came back for the rest of the session. Clamping before any
       return keeps SEL a valid index no matter which branch is taken.
       Found by tests/opnote-room-walkthrough-runtime.test.js. */
    if (SEL >= rows.length) SEL = rows.length - 1;
    if (SEL < 0) SEL = 0;
    if (rows.length < 2) { if (nav.__oprHtml !== '') { nav.innerHTML = ''; nav.__oprHtml = ''; } return; }   /* single-patient mode needs no nav */
    var h = '<div class="opr-rail-title">Patients — ' + rows.length + '</div>';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var nb = blanksOf(row);
      /* 2026-07-28: per-row status chip - drafted / blanks / needs a template /
         not drafted yet - read from the row state the pipeline already keeps. */
      var cls, state;
      if (row.gen) { cls = nb ? 'blanks' : 'ready'; state = nb ? (nb + ' blank' + (nb === 1 ? '' : 's') + ' to fill') : 'drafted'; }
      else if (!row.tplId) { cls = 'warn'; state = 'needs a template'; }
      else { cls = ''; state = 'not drafted yet'; }
      if (row.edited) state += ' - your edits';
      h += '<button type="button" class="opr-nav-item' + (i === SEL ? ' on' : '') + '" data-i="' + i + '" title="' + esc(row.appt.name + ' — ' + state) + '">'
        + '<span class="opr-dot ' + cls + '"></span>'
        + '<span class="nm">' + esc(row.appt.name)
        + '<span class="opr-nav-st">' + esc(state) + '</span></span>'
        + '</button>';
    }
    /* b944 PERF — WRITE ONLY WHEN THE MARKUP ACTUALLY CHANGED.
       buildRails() runs after EVERY opPrepRender, and opPrepRender runs on
       nearly every control in this room, so this rail was being torn down and
       reparsed on clicks that changed nothing about it. innerHTML is not a
       cheap assignment: it destroys and re-creates every button, invalidates
       layout, and drops any focus inside. Comparing the string first makes an
       unchanged rail free, and an unchanged rail is the common case. */
    if (nav.__oprHtml !== h) { nav.innerHTML = h; nav.__oprHtml = h; }
    /* one delegated listener, re-attached with the innerHTML rebuild */
    nav.onclick = function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.opr-nav-item') : null;
      if (b) oprSelect(+b.getAttribute('data-i'), true);
    };
  }

  /* ---------------------------------------------------------------------------
     2026-07-29, OWNER: "let me click on my templates on the left side that come
     up to change them if I want".

     He was right that it looked clickable and was not. Every item was a plain
     <div class="opr-tpl-item"> with no id, no data attribute, no tabindex and no
     handler; this function ended at rail.innerHTML and never bound anything,
     while its sibling buildNav bound nav.onclick two functions below. No
     document-level delegation in the app could reach a bare div either. So the
     rail was a list of his own templates that read like something to press and
     did nothing - a dead affordance sitting in the middle of the workflow.

     Now each item is a real button carrying its template id, and the rail does
     two things:
       CLICK  - apply that template to the procedure he is on, through the
                EXISTING select#opPrepTpl_<i>, so the one pipeline runs rather
                than a second copy of it.
       EDIT   - open the Templates tab to change the template itself.

     Two other defects are fixed in the same pass, both measured:
       - Template health was a 9px coloured dot ALONE. healthOf already returns a
         glyphed sentence and it was being thrown into a title attribute, which
         never appears on touch. It is printed as text now, like the patient rows
         directly above it already do.
       - Only the first SIX templates rendered, with "+N more on the Templates
         tab". If the rail is the place he picks from, it has to show all of them;
         the rail scrolls instead (capped in CSS, narrow viewports included).
     ------------------------------------------------------------------------- */
  /* Which template is armed for a confirm-swap on an edited draft. Cleared on
     any row change, so it can never apply to a patient he has moved away from. */
  var ARMED_TPL = '';
  /* ---------------------------------------------------------------------------
     2026-07-29: A PICK THAT EVAPORATES IS NOT A PICK.

     `tplManual` lived only in memory on the row object, and EVERY one of these
     rebuilds window._opPrep from _opNewRow with `tplManual:false` plus a fresh
     auto-match: switching between "This patient" and "All scheduled patients"
     (opPrepSetMode), changing the day, opening whole-month mode, and simply
     re-opening the room. So a template he deliberately chose was silently handed
     back to the auto-matcher the moment he changed day - and the rail would then
     show a different template as "in use" with no explanation.

     The pick is remembered per PATIENT + PROCEDURE, not per row index, because
     row order changes with the day. Restored on rebuild, and only ever used to
     re-assert something he chose himself - it never invents a pick, so auto
     matching still owns every row he has not touched.

     Stored under the account namespace via window.uns (a satellite must call it
     through window: `session` is a top-level let and is NOT on window). Bounded
     to the most recent 400 entries so it cannot grow without limit. */
  var PICK_KEY = 'opNoteTemplatePicks';

  function pickIdFor(row) {
    if (!row) return '';
    var pid = S(row.patientId || (row.appt && row.appt.patientId) || '');
    var nm = S(row.appt && row.appt.name ? row.appt.name : '').trim().toLowerCase();
    var proc = S(row.proc || (row.appt && row.appt.reason) || '').trim().toLowerCase();
    if (!pid && !nm) return '';
    /* patient identity first, procedure second - the same procedure for the same
       patient is the thing he was choosing a template for */
    return (pid || nm) + '||' + proc;
  }
  function picksLoad() {
    return safe(function () {
      if (!isFn(window.uns)) return {};
      var raw = localStorage.getItem(window.uns(PICK_KEY));
      if (!raw) return {};
      var o = JSON.parse(raw);
      return (o && o.schema === 1 && o.picks && typeof o.picks === 'object') ? o.picks : {};
    }, {});
  }
  function rememberPick(row, tplId) {
    var k = pickIdFor(row);
    if (!k || !tplId) return;
    safe(function () {
      if (!isFn(window.uns)) return;
      var picks = picksLoad();
      picks[k] = { tplId: S(tplId), at: Date.now() };
      var keys = Object.keys(picks);
      if (keys.length > 400) {
        keys.sort(function (a, b) { return (picks[a].at || 0) - (picks[b].at || 0); });
        for (var i = 0; i < keys.length - 400; i++) delete picks[keys[i]];
      }
      localStorage.setItem(window.uns(PICK_KEY), JSON.stringify({ schema: 1, picks: picks }));
    });
  }
  /* Re-assert remembered picks onto a freshly built _opPrep. Only touches a row
     whose remembered template STILL EXISTS, and never clears anything. */
  function restorePicks() {
    var rows = window._opPrep || [];
    if (!rows.length) return 0;
    var picks = picksLoad();
    if (!picks || !Object.keys(picks).length) return 0;
    var have = {};
    safe(function () {
      (window.getTemplates() || []).forEach(function (t) { if (t && t.id) have[S(t.id)] = 1; });
    });
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.tplManual) continue;            /* already his - leave alone */
      var rec = picks[pickIdFor(row)];
      if (!rec || !rec.tplId || !have[S(rec.tplId)]) continue;
      row.tplId = S(rec.tplId);
      row.tplManual = true;                            /* it WAS his choice */
      row.tplMatchSource = 'remembered';
      /* ...so it is NOT a guess, and the row must stop saying it is. b813 added
         row._tplClosestGuess for the closest-match fallback, and the draft
         ledger reads it (mls-connect.js: `else if (row && row._tplClosestGuess)
         { lowConfidence = true; }`). Nothing here cleared it, so a row that was
         auto-matched as a guess and then restored to the doctor's own
         remembered pick kept warning "low confidence" about a template he chose
         himself - on every subsequent day, because the pick is persistent.
         Deleted rather than set false: the flag's only writer treats presence
         as truth, and two spellings of absent is how they drift apart. */
      try { delete row._tplClosestGuess; } catch (eGuess) {}
      n++;
    }
    return n;
  }

  function curRow() {
    var rows = window._opPrep || [];
    if (!rows.length) return null;
    var i = (SEL >= 0 && SEL < rows.length) ? SEL : 0;
    return { i: i, row: rows[i] };
  }

  var RAIL_FILTER = '';   /* b899 — the rail's name filter, survives rebuilds */
  function buildTplRail() {
    var rail = $('oprTplRail'); if (!rail) return;
    var list = safe(function () { return isFn(window.getTemplates) ? (window.getTemplates() || []) : []; }, []);
    /* b899 — 96 templates in library-insertion order is creation-time noise;
       alphabetical, with a name filter above (owner request 2026-08-06). */
    list = list.slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }); });
    var q = String(RAIL_FILTER || '').trim().toLowerCase();
    var shown = q ? list.filter(function (t) { return String(t.name || '').toLowerCase().indexOf(q) >= 0; }) : list;
    var cur = curRow();
    var appliedId = cur && cur.row ? S(cur.row.tplId || '') : '';
    var h = '<div class="opr-rail-title">Your templates &mdash; ' + list.length + (q ? ' &middot; ' + shown.length + ' match' + (shown.length === 1 ? '' : 'es') : '') + '</div>';
    if (list.length > 5 || q) {
      h += '<div class="opr-tpl-search"><input id="oprTplSearch" type="search" placeholder="Search templates by name…" aria-label="Search templates by name" autocomplete="off"></div>';
    }
    if (!list.length) {
      h += '<div class="opr-tpl-empty">None uploaded yet. Drafts follow your templates &mdash; add them on the Templates tab.</div>';
    } else if (!shown.length) {
      h += '<div class="opr-tpl-empty">No template name contains &ldquo;' + esc(RAIL_FILTER) + '&rdquo;. Clear the search to see all ' + list.length + '.</div>';
    } else {
      var hOf = safe(function () { return window.__mlsTplPrepFix && isFn(window.__mlsTplPrepFix.healthOf) ? window.__mlsTplPrepFix.healthOf : null; }, null);
      for (var i = 0; i < shown.length; i++) {
        var t = shown[i];
        var health = hOf ? safe((function (tt) { return function () { return hOf(tt); }; })(t), null) : null;
        var cls = health ? health.cls : '';
        var lbl = health ? health.label : '';
        var on = appliedId && S(t.id) === appliedId;
        /* "in use" is a WORD, not only the highlight - the same rule the patient
           rows follow. A doctor must never have to infer state from colour. */
        var armed = ARMED_TPL && S(t.id) === ARMED_TPL;
        var state = armed ? 'click again to switch - your text stays'
          : ((on ? 'in use for this procedure' : '') + (on && lbl ? ' · ' : '') + (lbl || ''));
        h += '<button type="button" class="opr-tpl-item' + (on ? ' on' : '') + (armed ? ' armed' : '') + '"'
          + ' data-tpl-id="' + esc(S(t.id)) + '"'
          + ' aria-pressed="' + (on ? 'true' : 'false') + '"'
          + ' title="' + esc((t.name || 'Template') + (state ? ' — ' + state : '')) + '">'
          + '<span class="opr-dot ' + esc(cls) + '"></span>'
          + '<span class="nm">' + esc(t.name || 'Template')
          + (state ? '<span class="opr-nav-st">' + esc(state) + '</span>' : '')
          + '</span>'
          + '<span class="opr-tpl-edit" data-tpl-edit="' + esc(S(t.id)) + '" role="button" tabindex="0"'
          + ' aria-label="Edit template ' + esc(t.name || '') + '" title="Open this template to edit it">Edit</span>'
          + '</button>';
      }
    }
    /* b899 — typing in the filter rebuilds this rail, and innerHTML replacement
       destroys focus mid-word. Remember focus + caret, restore after. */
    var hadFocus = document.activeElement && document.activeElement.id === 'oprTplSearch';
    var selStart = RAIL_FILTER.length, selEnd = RAIL_FILTER.length;
    if (hadFocus) {
      try {
        var _a = document.activeElement;
        if (_a.selectionStart != null) { selStart = _a.selectionStart; selEnd = _a.selectionEnd; }
      } catch (eSel) {}
    }
    /* b944 PERF — same law as the patient rail above, and it matters more here
       because this one carries the WHOLE library (96 templates on the owner's
       account): ~38KB of markup and 96 buttons, re-parsed after every repaint
       of the room. The health line for each of those templates is computed
       above, so skipping the write is only half the saving - but it is the half
       that costs layout. When nothing changed there is also nothing to restore,
       so the focus/caret dance below is skipped with it. */
    var changed = (rail.__oprHtml !== h);
    if (changed) { rail.innerHTML = h; rail.__oprHtml = h; }
    var searchInp = $('oprTplSearch');
    if (searchInp && changed) {
      searchInp.value = RAIL_FILTER;
      searchInp.oninput = function () { RAIL_FILTER = this.value; buildTplRail(); };
      /* b905 — RESTORE WHERE THE CARET WAS, NOT THE END OF THE LINE. The rebuild
         destroys and recreates this input on every keystroke, and jumping to
         value.length meant any correction made mid-string silently landed at
         the end instead: type "lumbar", click before the "l", type a character,
         and it appended. Measured live: caret at 4 came back at 7. */
      if (hadFocus) { try { searchInp.focus({ preventScroll: true }); searchInp.setSelectionRange(selStart, selEnd); } catch (eF) {} }
    }

    /* One delegated listener, re-attached with every innerHTML rebuild - the
       idiom buildNav already uses. Detached in revert() alongside the nav. */
    /* 2026-07-29: the Edit affordance is a span with role=button and tabindex=0,
       so a keyboard user can focus it and hear it announced as a button. Without
       a keydown handler it did nothing on Enter or Space - a control that lies
       about being a control. Space is preventDefault-ed so it cannot scroll. */
    rail.onkeydown = function (e) {
      if (!e || (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar')) return;
      var t = e.target;
      if (!t || !t.closest) return;
      var ed = t.closest('[data-tpl-edit]');
      if (!ed) return;
      e.preventDefault(); e.stopPropagation();
      openTemplateForEdit(ed.getAttribute('data-tpl-edit'));
    };
    rail.onclick = function (e) {
      var tgt = e.target;
      if (!tgt || !tgt.closest) return;
      var ed = tgt.closest('[data-tpl-edit]');
      if (ed) { e.preventDefault(); e.stopPropagation(); openTemplateForEdit(ed.getAttribute('data-tpl-edit')); return; }
      var b = tgt.closest('.opr-tpl-item');
      if (b) applyTemplateToCurrentRow(b.getAttribute('data-tpl-id'));
    };
  }

  /* Apply a template to the procedure currently on screen, by driving the
     EXISTING picker. Deliberately not a second write path: sel.value + the row
     fields + a real change event means every satellite that watches that select
     (the integrity badge writer, the auto-match bookkeeping) behaves exactly as
     it does when the doctor uses the dropdown. The direct row write is the
     guarantee, because a synthetic event can be ignored by a listener that
     checks isTrusted; the event is the courtesy. */
  function applyTemplateToCurrentRow(id) {
    id = S(id);
    var cur = curRow();
    if (!cur || !cur.row) {
      safe(function () { if (isFn(window.toast)) window.toast('Open a procedure first, then pick a template for it.', 'err'); });
      return;
    }
    /* 2026-07-29 BLOCKER FIX (this was my b796 bug, and it was exactly the thing
       the owner asked for: "when u click and select a procidure it acatlly uised
       that").
       This line used to `return` when the clicked template already equalled
       row.tplId - which is TRUE for every AUTO-MATCHED row, and the rail labels
       that row "in use for this procedure". So clicking it to CONFIRM the choice
       recorded nothing: tplManual stayed false, and a row without that flag is
       still owned by the auto-matcher - feat_mls_opnote_integrity.js re-matches
       at :1270 and can auto-reroute to a different template at :1282, both gated
       only on `!row.tplManual`. The pick looked accepted and was not.
       Confirming an auto-match is now a REAL act: it records the same manual flag
       a dropdown pick does, which is what takes the row out of the matcher's
       hands. Auto-matching is untouched for rows he has never touched - he asked
       to keep it, and this is what makes "keep auto, but my pick wins" true. */
    var alreadyThis = (S(cur.row.tplId) === id);

    /* A DRAFT HE HAS EDITED IS NOT OURS TO REPLACE. Changing the template is the
       first half of a re-draft, and this app has already shipped a bug where a
       refused switch destroyed a note.
       Confirmation is a TWO-STEP ARM on the button itself, not a dialog. The
       suite `no-native-blocking-dialogs` rejects confirm/alert/prompt in
       production scripts, and it is right to: a blocking dialog freezes the tab,
       and a frozen modal over the EMR is a defect this product has already had.
       Arming is also better here - it needs no reading, it is undone by clicking
       anything else, and it says what will happen in place. */
    if (!alreadyThis && cur.row.gen && cur.row.edited && ARMED_TPL !== id) {
      ARMED_TPL = id;
      safe(buildTplRail);
      safe(function () {
        if (isFn(window.toast)) window.toast('You have edited this draft. Click that template again to switch - your text stays until you re-draft.', '');
      });
      return;
    }
    ARMED_TPL = '';

    var sel = $('opPrepTpl_' + cur.i);
    cur.row.tplId = id;
    cur.row.tplManual = true;
    safe(function () { rememberPick(cur.row, id); });
    if (sel) {
      safe(function () { sel.value = id; });
      safe(function () { sel.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    safe(buildTplRail);
    safe(buildReceipt);
    safe(function () { if (isFn(window.opPrepRenderBadges)) window.opPrepRenderBadges(); });
    safe(function () {
      if (!isFn(window.toast)) return;
      var list = safe(function () { return window.getTemplates() || []; }, []);
      var t = null, k;
      for (k = 0; k < list.length; k++) if (S(list[k].id) === id) { t = list[k]; break; }
      var nm = t && t.name ? t.name : 'Template';
      window.toast(alreadyThis
        ? (nm + ' is locked in for this procedure. Auto-matching will not change it.')
        : (cur.row.gen
          ? ('Template set to ' + nm + '. Re-draft this procedure to apply it.')
          : ('Template set to ' + nm + '.')), 'ok');
    });
  }

  /* ---------------------------------------------------------------------------
     2026-07-29, OWNER: "give ioptiopns on how I want the op nopte to follow those
     tempaltes".

     Three modes, and each one is real at BOTH ends of the pipeline - the prompt
     clause and the deterministic fidelity gate (feat_mls_opnote_integrity.js).
     A prompt-only control would have been refused by that gate and silently
     killed drafts, so this is deliberately not just a stored preference.

     'adapt' is the default and adds no clause at all, so a doctor who never opens
     this control gets byte-for-byte the behaviour that shipped before it existed.

     What these do NOT touch, in any mode: "never invent a fact", the placeholder
     rules, and the network-layer strict dictation rule. Wording fidelity is a
     style choice; what may be asserted about a patient is not.
     ------------------------------------------------------------------------- */
  var TPL_MODES = [
    ['strict', 'Follow it closely', 'Keeps your wording. Fills only what varies.'],
    ['adapt', 'Adapt to the case', 'Keeps your structure, adapts the wording. Recommended.'],
    ['guide', 'Use it as a guide — concise', 'Keeps your headings, writes tighter prose in its own words.']
  ];
  var TPL_MODE_KEY = 'opNoteTemplateMode';

  function tplModeGet() {
    return safe(function () {
      var raw = (isFn(window.uns)) ? localStorage.getItem(window.uns(TPL_MODE_KEY)) : null;
      var m = S(raw).trim();
      return (m === 'strict' || m === 'guide' || m === 'adapt') ? m : 'adapt';
    }, 'adapt');
  }
  function tplModeSet(m) {
    if (m !== 'strict' && m !== 'guide' && m !== 'adapt') return;
    /* Write, then READ BACK before saying anything. A storage write can fail on a
       restricted or full profile, and "saved" is a claim this app has been caught
       making without proof more than once. */
    var landed = safe(function () {
      if (!isFn(window.uns)) return false;
      localStorage.setItem(window.uns(TPL_MODE_KEY), m);
      return S(localStorage.getItem(window.uns(TPL_MODE_KEY))) === m;
    }, false);
    safe(buildTplMode);
    safe(function () {
      if (!isFn(window.toast)) return;
      if (!landed) { window.toast('That setting could not be saved on this device.', 'err'); return; }
      var lbl = '';
      for (var k = 0; k < TPL_MODES.length; k++) if (TPL_MODES[k][0] === m) lbl = TPL_MODES[k][1];
      window.toast('Drafts will now ' + lbl.toLowerCase() + '. Re-draft to apply it.', 'ok');
    });
  }

  function buildTplMode() {
    var railHost = $('oprDayRail'); if (!railHost) return;
    var box = $('oprTplMode');
    if (!box) {
      box = document.createElement('div');
      box.id = 'oprTplMode';
      /* appended to the room-owned rail, AFTER the template list. No gripped
         subtree is touched: nothing in the repo walks #oprDayRail children. */
      var anchor = $('oprTplRail');
      if (anchor && anchor.parentNode === railHost) railHost.insertBefore(box, anchor.nextSibling);
      else railHost.appendChild(box);
    }
    var cur = tplModeGet();
    var h = '<div class="opr-rail-title">How drafts follow your template</div>';
    for (var i = 0; i < TPL_MODES.length; i++) {
      var m = TPL_MODES[i], on = (m[0] === cur);
      h += '<button type="button" class="opr-tplmode' + (on ? ' on' : '') + '"'
        + ' data-tplmode="' + esc(m[0]) + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
        + ' title="' + esc(m[1] + ' — ' + m[2]) + '">'
        + '<span class="nm">' + esc(m[1])
        + '<span class="opr-nav-st">' + esc(m[2]) + '</span></span>'
        + '</button>';
    }
    box.innerHTML = h;
    box.onclick = function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-tplmode]') : null;
      if (b) tplModeSet(b.getAttribute('data-tplmode'));
    };
  }

  /* "change them if I want" - the second reading. Open the Templates tab with
     this template selected, which is the one door that owns editing. */
  function openTemplateForEdit(id) {
    id = S(id);
    /* 2026-07-29: this wrote _tplUI.selectedId directly and never looked at
       _tplUI.dirty, so opening another template from the rail THREW AWAY text he
       had typed into the detail pane without a word. The base UI has a
       mid-edit guard; honour it rather than reaching past it. Refusing loudly is
       correct here - his unsaved wording is the thing of value. */
    var dirty = safe(function () {
      return !!(window._tplUI && window._tplUI.dirty && S(window._tplUI.selectedId) && S(window._tplUI.selectedId) !== id);
    }, false);
    if (dirty) {
      safe(function () {
        if (isFn(window.toast)) window.toast('You have unsaved changes in the template open below. Save or clear them first.', 'err');
      });
      safe(function () { if (isFn(window.openTemplates)) window.openTemplates(); });
      return;
    }
    safe(function () { if (window._tplUI) window._tplUI.selectedId = id; });
    safe(function () { if (isFn(window.openTemplates)) window.openTemplates(); });
    safe(function () { if (isFn(window.renderTemplateList)) window.renderTemplateList(); });
    safe(function () { if (isFn(window.renderTplDetail)) window.renderTplDetail(); });
  }

  function buildReceipt() {
    var el = $('oprReceipt'); if (!el) return;
    var rows = window._opPrep || [];
    var row = rows[SEL];
    if (!row) { el.style.display = 'none'; el.textContent = ''; return; }
    var p = safe(function () { return isFn(window._opResolvePatient) ? window._opResolvePatient(row.appt.name, row.appt.dob, row.patientId) : null; }, null);
    var n = 0;
    if (p) {
      n = safe(function () {
        var onf = window.__mlsOpNoteFill;
        var v = (onf && isFn(onf._verifiedHistoryVisits)) ? onf._verifiedHistoryVisits(p) : [];
        return Array.isArray(v) ? v.length : 0;
      }, 0);
    }
    var first = S(row.appt.name).split(' ')[0];
    var ctx = p
      ? ('Context for ' + first + ': ' + (n ? (n + ' verified visit' + (n === 1 ? '' : 's') + ' + chart profile') : 'chart profile (no verified visits pulled yet)'))
      : ('Context for ' + first + ': identity not verified yet — the draft will name exactly what is missing');

    /* -----------------------------------------------------------------------
       2026-07-30, OWNER: "have a little widget right above the note that tells u
       the stye u used and let me re go and maybe regentate with a use as aguide
       style for examppl;e".

       It closes the loop. Until now the style lived in a control in the rail and
       the note gave no clue which style produced it - so after the fact he could
       not tell, and changing his mind meant hunting for the setting and finding
       the re-draft separately.

       WHY IT LIVES IN THE RECEIPT and not directly above the textarea: the slot
       immediately before textarea#opPrepNote_<i> is RESERVED - feat_mls_opnote_
       fill.js finds the Fields box as that textarea's previousElementSibling, so
       inserting anything there would duplicate or kill every "fields need you"
       box in the app. The receipt is room-owned, sits directly above the editor,
       and is the honest home for "what produced this".

       IT NAMES WHAT WAS ACTUALLY USED, not the current setting. row.tplModeUsed
       is stamped from the generator's own result at draft time, so if he changes
       the setting afterwards this still reports what the note in front of him
       really followed - and it says nothing at all until a draft exists. */
    var styleHtml = '';
    if (row.gen) {
      var used = S(row.tplModeUsed);
      var lbl = {}, k;
      for (k = 0; k < TPL_MODES.length; k++) lbl[TPL_MODES[k][0]] = TPL_MODES[k][1];
      styleHtml = '<div class="opr-usedstyle">'
        + '<span class="opr-us-lbl">Style used</span>'
        + '<b>' + esc(used && lbl[used] ? lbl[used] : (used ? used : 'Adapt to the case')) + '</b>';
      /* offer the OTHER two, each as a one-press re-draft in that style */
      for (k = 0; k < TPL_MODES.length; k++) {
        if (TPL_MODES[k][0] === (used || 'adapt')) continue;
        styleHtml += '<button type="button" class="opr-us-redo" data-oprredo="' + esc(TPL_MODES[k][0]) + '"'
          + ' title="' + esc(TPL_MODES[k][2]) + '">Re-draft: ' + esc(TPL_MODES[k][1]) + '</button>';
      }
      styleHtml += '</div>';
    }

    el.innerHTML = '<div class="opr-ctxline">' + esc(ctx) + '</div>' + styleHtml;
    el.style.display = '';

    /* one delegated handler, re-attached with the innerHTML rebuild */
    el.onclick = function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-oprredo]') : null;
      if (b) redraftInStyle(b.getAttribute('data-oprredo'));
    };
  }

  /* Set the style and re-draft THIS procedure in it. Deliberately routed through
     the same two things a human press would use - the stored mode and the app's
     own opPrepGenerateOne - so there is no second drafting path to keep in step.
     A draft he has EDITED is never overwritten without asking; the confirmation is
     a two-step arm on the button, never a blocking dialog. */
  var ARMED_REDO = '';
  function redraftInStyle(mode) {
    mode = S(mode);
    var cur = curRow();
    if (!cur || !cur.row || !cur.row.gen) return;
    if (cur.row.edited && ARMED_REDO !== mode) {
      ARMED_REDO = mode;
      safe(function () {
        if (isFn(window.toast)) window.toast('You have edited this draft. Press that button again to replace it with a fresh one in that style.', '');
      });
      return;
    }
    ARMED_REDO = '';
    tplModeSet(mode);                     /* persists + re-renders the rail control */
    safe(function () {
      if (isFn(window.opPrepGenerateOne)) window.opPrepGenerateOne(cur.i);
    });
  }

  /* 2026-07-28: in all-day mode, ONE patient card shows at a time. The other
     cards stay in the DOM (base render + satellites keep every anchor); a
     room class on #opPrepList presentation-hides them, and .opr-cur - which
     the room already maintains - is the one that shows. Guarded writes only
     (a no-op classList write still re-commits the whole doc's styles). */
  function markSolo() {
    safe(function () {
      var list = $('opPrepList'); if (!list || !list.classList) return;
      var want = (window._opPrep || []).length >= 2;
      if (want && !list.classList.contains('opr-solo')) list.classList.add('opr-solo');
      if (!want && list.classList.contains('opr-solo')) list.classList.remove('opr-solo');
    });
  }

  /* Prev/Next pager above the list - room chrome, room-owned node. It only
     SELECTS (oprSelect); it never drafts, saves, or touches pipeline state. */
  function buildPager() {
    var editor = $('oprEditor'); if (!editor || !editor.insertBefore) return;
    var rows = window._opPrep || [];
    var pager = $('oprPager');
    if (rows.length < 2) {
      if (pager && pager.parentNode) pager.parentNode.removeChild(pager);
      return;
    }
    if (!pager) {
      pager = document.createElement('div');
      pager.id = 'oprPager';
      pager.innerHTML = '<button type="button" data-opr-nav="prev" aria-label="Previous patient">Prev</button>'
        + '<span class="opr-pos"></span>'
        + '<button type="button" data-opr-nav="next" aria-label="Next patient">Next</button>';
      pager.onclick = function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-opr-nav]') : null;
        if (!b) return;
        oprSelect(SEL + (b.getAttribute('data-opr-nav') === 'next' ? 1 : -1), true);
      };
      var anchor = $('oprReceipt');
      if (anchor && anchor.parentElement === editor) editor.insertBefore(pager, anchor);
      else if ($('opPrepList') && $('opPrepList').parentElement === editor) editor.insertBefore(pager, $('opPrepList'));
      else editor.appendChild(pager);
    }
    safe(function () {
      var pos = pager.querySelector('.opr-pos');
      if (pos) pos.textContent = 'Patient ' + (SEL + 1) + ' of ' + rows.length;
      var prev = pager.querySelector('[data-opr-nav="prev"]'), next = pager.querySelector('[data-opr-nav="next"]');
      if (prev) prev.disabled = SEL <= 0;
      if (next) next.disabled = SEL >= rows.length - 1;
    });
  }

  /* Arrow keys move between patients when the doctor is not typing in a
     field. Esc stays with its existing owners (pinned handler + onKey). */
  function onNavKey(e) {
    var k = e.key;
    if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'ArrowLeft' && k !== 'ArrowRight') return;
    if (!shown($('opPrepModal')) || shown($('templatesModal'))) return;
    var t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable)) return;
    var rows = window._opPrep || []; if (rows.length < 2) return;
    var next = SEL + ((k === 'ArrowDown' || k === 'ArrowRight') ? 1 : -1);
    if (next < 0 || next >= rows.length) return;
    if (e.preventDefault) e.preventDefault();
    oprSelect(next, true);
  }
  window.addEventListener('keydown', onNavKey);

  function buildRails() {
    /* BEFORE the rails are drawn, so the rail shows the template that will
       actually be used rather than the auto-match it is about to be corrected
       from. Returns a count; zero when he has never picked anything. */
    var restored = safe(restorePicks, 0);
    if (restored) safe(function () { if (isFn(window.opPrepRenderBadges)) window.opPrepRenderBadges(); });
    buildNav(); buildTplRail(); buildTplMode(); buildReceipt();
    safe(markSolo); safe(buildPager);
    /* self-heal: if the Templates tab is marked active but its modal is not
       shown (a close path we do not wrap took it down), return to Procedures */
    safe(function () {
      var panel = $('oprPanelTpls');
      if (panel && panel.classList.contains('on') && !shown($('templatesModal'))) showTab('procs');
    });
  }

  /* ------------------- Stage 3: the Templates tab ------------------------- */
  var TPL_HOME = null;   /* original DOM slot, for revert */

  function ensureEmbedded() {
    var panel = $('oprPanelTpls'), tpl = $('templatesModal');
    if (!panel || !tpl || tpl.parentElement === panel) return;
    if (!TPL_HOME) TPL_HOME = { parent: tpl.parentElement, next: tpl.nextSibling };
    panel.appendChild(tpl);
  }

  function showTab(which) {
    var onTpl = which === 'tpls';
    safe(function () { var p = $('oprPanelProcs'); if (p) p.style.display = onTpl ? 'none' : ''; });
    safe(function () { var p = $('oprPanelTpls'); if (p) p.classList.toggle('on', onTpl); });
    safe(function () {
      var a = $('oprTabProcs'), b = $('oprTabTpls');
      if (a) { a.classList.toggle('on', !onTpl); a.setAttribute('aria-selected', onTpl ? 'false' : 'true'); }
      if (b) { b.classList.toggle('on', onTpl); b.setAttribute('aria-selected', onTpl ? 'true' : 'false'); }
    });

    /* THE TEMPLATES TAB OPENS ON THE LIBRARY, NOT 2,139 PIXELS BELOW IT.
       MEASURED live at 1440x900 on a freshly created account with one saved
       template, sampling #oprPanelTpls.scrollTop the moment the tab is shown:

         as shipped                 scrollTop 2139, first visible block the
                                    "Have several forms to import?" advert,
                                    #tplList 1825px ABOVE the viewport
         with the standard-line
         section suppressed         scrollTop  796, still past the library

       Nothing scrolls the panel on purpose. Something inside it takes FOCUS as
       it mounts - mls-sl-text in the first case, tplUseToggle in the second -
       and the browser scrolls a newly focused control into view. Both targets
       are early in the DOM and late on the SCREEN, because this tab's reading
       order is composed with CSS `order` in feat_mls_opnote_templates_ui.js.
       That is a legitimate technique and it is what keeps the library first,
       but it means DOM order and visual order deliberately disagree - so any
       "focus what comes first" behaviour lands somewhere the doctor is not
       looking, and drags the whole panel with it. He opened his template
       library and got an advert for bulk import.

       Fixing the focusers one at a time cannot hold: they are in three
       different modules that mount on their own schedules, and the next one
       added would reintroduce this. The panel states its own scroll position
       instead, which is true no matter who focuses what.

       Two frames, deliberately. The first covers the synchronous mount; the
       120ms one covers mls-template-stdline.js, which re-mounts its section on
       exactly that delay (mls-template-stdline.js:431) and would otherwise
       scroll the panel again immediately after this ran.

       Only ever on ENTERING the tab, and only when the panel is really
       scrolled - so this cannot fight a doctor who has scrolled down himself
       and then had some unrelated re-render fire. */
    if (onTpl) {
      safe(function () {
        var p = $('oprPanelTpls');
        if (!p) return;
        /* AND IT YIELDS THE INSTANT HE TOUCHES IT.
           The 140ms pass is there for mls-template-stdline.js, which re-mounts
           its section on exactly that delay and would otherwise scroll the panel
           straight back down. But a timer that reasserts a scroll position is
           also a timer that can take one away, and being yanked to the top
           mid-scroll is a worse bug than the one this fixes.
           So a real input gesture ends it. Only wheel/touch/keydown count -
           NOT the scroll event itself, which is what the focus-driven jump this
           whole block exists to undo would fire. Passive listeners, removed as
           soon as the last pass has run, so nothing outlives the open. */
        /* THE ENTRANCE IS AN ENTRANCE, NOT A RE-RENDER EFFECT.
           feat_mls_opnote_templates_ui.js animates the library rows in when the
           doctor arrives. It keyed that off `.on`, which is this tab's
           shown/hidden state and therefore true for as long as he is in the
           tab - so every rebuild of the list replayed it. renderTemplateList()
           rebuilds via box.innerHTML, and tplSearchChanged() calls it on
           oninput, so MEASURED: one keystroke in the search box restarted 3
           row animations on a 3-template library, and it would be one per row
           on a real one. Typing his own search made the list flicker at him.
           That is the "glitchy" this whole rebuild exists to end, reintroduced
           by the polish.
           So the animation gets a class that only exists while he is ARRIVING.
           900ms: the list renders in the first frames of the open, and this is
           comfortably past the 300ms animation plus its 200ms stagger tail,
           while still being gone long before any human finishes a keystroke. */
        try {
          p.classList.add('ot-entering');
          setTimeout(function () { try { p.classList.remove('ot-entering'); } catch (e) {} }, 900);
        } catch (eEnter) {}

        var owned = true;
        var release = function () { owned = false; };
        var events = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
        events.forEach(function (n) {
          try { p.addEventListener(n, release, { passive: true }); } catch (e) { }
        });
        var stop = function () {
          events.forEach(function (n) { try { p.removeEventListener(n, release); } catch (e) { } });
        };
        var toTop = function () {
          safe(function () { if (owned && p.scrollTop > 0) p.scrollTop = 0; });
        };
        toTop();
        setTimeout(toTop, 0);
        setTimeout(function () { toTop(); stop(); }, 140);
      });
    }
  }

  /* openTemplates/closeTemplates wrapped OUTERMOST (this module loads
     idle-deferred, after every other wrapper): Templates now lives inside the
     room. Opening it embeds the modal (first time), opens the room when it is
     closed, calls the base opener (checkbox state + list render + 'show'),
     and fronts the Templates tab. Closing returns to Procedures. The modal's
     own show/hide lifecycle is untouched, so every satellite that reaches
     into #templatesModal (tpf health panel, stdline section, onf upload
     wiring, the E2E's real-form drive) keeps working on the same node. */
  /* opr-1.4.1 (found on my own full walk): leaving the room from the
     Templates tab via Back keeps the modal's .show, so the DRAFTER doors -
     which mean "procedures" - reopened on Templates. Each procedure opener
     lands on Procedures; the Templates door still lands on Templates
     (openTemplates' wrap runs its base opener AFTER openOpPrepSmart, so this
     inner close never fights it). */
  function wrapProcOpeners() {
    ['openOpPrep', 'openOpPrepForPatient', 'openOpPrepSmart'].forEach(function (name) {
      var orig = window[name];
      if (!isFn(orig) || orig.__oprProcWrap) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        safe(function () { if (shown($('templatesModal')) && isFn(window.closeTemplates)) window.closeTemplates(); else showTab('procs'); });
        return r;
      };
      w.__oprProcWrap = true; w.__oprProcOrig = orig;
      window[name] = w;
    });
  }

  function wrapTemplates() {
    var o = window.openTemplates;
    if (isFn(o) && !o.__oprTplWrap) {
      var w = function () {
        /* opr-1.5.1: openers defined AFTER module boot never got wrapped —
           re-attempt at call time (idempotent). And openOpPrepSmart has its
           own early-after-reload readiness refusal, so when it declines, the
           direct day opener gets one try before we fall back to floating. */
        safe(wrapProcOpeners);
        ensureEmbedded();
        if (!shown($('opPrepModal'))) {
          safe(function () { if (isFn(window.openOpPrepSmart)) window.openOpPrepSmart(); });
        }
        if (!shown($('opPrepModal'))) {
          safe(function () { if (isFn(window.openOpPrep)) window.openOpPrep(); });
        }
        /* opr-1.5.0 (owner, sample preview): in postures where the room
           REFUSES to open (the read-only preview workspace, or any future
           gate), the embed left the modal shown-but-invisible inside a closed
           room - a silent no-op dressed as a click. The embed is conditional
           on the room actually opening: if it did not, the modal returns to
           its original floating home and presents classically. */
        if (!shown($('opPrepModal'))) {
          safe(function () {
            var tpl = $('templatesModal');
            if (tpl && TPL_HOME && tpl.parentElement === $('oprPanelTpls')) {
              if (TPL_HOME.next && TPL_HOME.next.parentNode === TPL_HOME.parent) TPL_HOME.parent.insertBefore(tpl, TPL_HOME.next);
              else TPL_HOME.parent.appendChild(tpl);
            }
          });
          return o.apply(this, arguments);
        }
        var r = o.apply(this, arguments);
        showTab('tpls');
        return r;
      };
      w.__oprTplWrap = true; w.__oprTplOrig = o;
      window.openTemplates = w;
    }
    var c = window.closeTemplates;
    if (isFn(c) && !c.__oprTplWrap) {
      var w2 = function () {
        var r = c.apply(this, arguments);
        showTab('procs');
        return r;
      };
      w2.__oprTplWrap = true; w2.__oprTplOrig = c;
      window.closeTemplates = w2;
    }
  }

  /* ------------------- the render wrap (one seam, revertible) ------------- */
  function wrapRender() {
    var orig = window.opPrepRender;
    if (!isFn(orig) || orig.__oprWrap) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      /* onf kick FIRST — the Fields boxes the doctor is working in must
         reappear in the same synchronous moment the list was rebuilt (the
         b715 occluded-tab law: no timer can be trusted here). Then the rails.
         Both run after the base render's own focus restore; neither touches
         the focused field, so the caret survives. */
      safe(function () { var onf = window.__mlsOpNoteFill; if (onf && onf.installed && isFn(onf.tick)) onf.tick(); });
      safe(buildRails);
      safe(function () { var card = rowCard(SEL); if (card) card.classList.add('opr-cur'); });
      return r;
    };
    w.__oprWrap = true; w.__oprOrig = orig;
    window.opPrepRender = w;
  }
  skin();
  wrapRender();
  /* 2026-07-29: #oprTabProcs was a DEAD CONTROL. Its sibling #oprTabTpls carries
     onclick="openTemplates()" inline; Procedures carried nothing, and a repo-wide
     grep found the id only in the markup and inside showTab, which WRITES its
     class and never reads a click. So on the Templates tab the obvious way back
     did nothing, leaving only ESC or a Close button at the bottom of a long
     scroll. Wired to the showTab it should always have called; idempotent, and
     cleared in revert(). */
  function wireProcTab() {
    var a = $('oprTabProcs');
    if (!a || a.__oprWired) return;
    a.__oprWired = true;
    a.onclick = function () {
      safe(function () { if (shown($('templatesModal')) && isFn(window.closeTemplates)) window.closeTemplates(); });
      safe(function () { showTab('procs'); });
    };
  }
  wireProcTab();
  wrapTemplates();
  wrapProcOpeners();
  /* If the drafter is already open when this module lands (idle-deferred
     load), give the rails their first build now. */
  if (shown($('opPrepModal'))) safe(buildRails);
  /* opr-1.4.0 (owner live report: "templates taking up half the screen"):
     if the doctor opened Templates BEFORE this module landed, the base opener
     showed the old 960px floating modal — half a wide screen, and visually a
     different product from the room. Adopt it in place: embed, open the room,
     front the tab. The doctor's open surface upgrades instead of living in
     two inconsistent shapes. */
  if (shown($('templatesModal')) && safe(function () { return $('templatesModal').parentElement !== $('oprPanelTpls'); }, false)) {
    safe(function () {
      ensureEmbedded();
      if (!shown($('opPrepModal'))) {
        if (isFn(window.openOpPrepSmart)) window.openOpPrepSmart();
        else if (isFn(window.openOpPrep)) window.openOpPrep();
      }
      /* opr-1.5.0: adoption is conditional on the room actually opening —
         in a posture where it refuses (the preview workspace), embedding
         would turn a VISIBLE floating modal into an invisible one. */
      if (shown($('opPrepModal'))) { showTab('tpls'); }
      else {
        var tpl = $('templatesModal');
        if (tpl && TPL_HOME && tpl.parentElement === $('oprPanelTpls')) {
          if (TPL_HOME.next && TPL_HOME.next.parentNode === TPL_HOME.parent) TPL_HOME.parent.insertBefore(tpl, TPL_HOME.next);
          else TPL_HOME.parent.appendChild(tpl);
        }
      }
    });
  }

  var api = {
    installed: true,
    version: VERSION,
    stage: 3,
    select: function (i) { oprSelect(+i || 0, true); },
    rebuild: function () { safe(buildRails); },
    showTab: function (which) { safe(function () { showTab(which === 'tpls' ? 'tpls' : 'procs'); }); },
    describe: function () {
      return 'op-note workroom, 2026-07-28 remake: the room owns the ' +
        'PRESENTATION - calm one-room skin, single-column day/mode rail, ' +
        'patient nav with per-row status, ONE patient card at a time in ' +
        'all-day mode (opr-solo presentation class; every anchor stays in ' +
        'the DOM), Prev/Next pager, arrow-key navigation, one-field-per-row ' +
        'Fields panel. Pipeline untouched: opPrepGenerateOne / ' +
        '#opPrepGenAllBtn / opPrepSave; per-field "Use every time" is owned ' +
        'by feat_mls_opnote_fill.js. Plus stage 3 Templates-in-the-room and ' +
        'stage 2b rails with the synchronous onf kick (occluded-tab law).';
    },
    revert: function () {
      api.installed = false;
      try { window.removeEventListener('keydown', onKey, true); } catch (e2) {}
      try { window.removeEventListener('keydown', onNavKey); } catch (e11) {}
      try { var sk = $(SKIN_ID); if (sk && sk.parentNode) sk.parentNode.removeChild(sk); } catch (e12) {}
      try { var pg = $('oprPager'); if (pg && pg.parentNode) pg.parentNode.removeChild(pg); } catch (e13) {}
      try { var lst = $('opPrepList'); if (lst && lst.classList && lst.classList.contains('opr-solo')) lst.classList.remove('opr-solo'); } catch (e14) {}
      try {
        var w = window.opPrepRender;
        if (isFn(w) && w.__oprWrap && isFn(w.__oprOrig)) window.opPrepRender = w.__oprOrig;
      } catch (e3) {}
      try {
        var ot = window.openTemplates;
        if (isFn(ot) && ot.__oprTplWrap && isFn(ot.__oprTplOrig)) window.openTemplates = ot.__oprTplOrig;
        var ct = window.closeTemplates;
        if (isFn(ct) && ct.__oprTplWrap && isFn(ct.__oprTplOrig)) window.closeTemplates = ct.__oprTplOrig;
      } catch (e8) {}
      try {
        ['openOpPrep', 'openOpPrepForPatient', 'openOpPrepSmart'].forEach(function (name) {
          var f = window[name];
          if (isFn(f) && f.__oprProcWrap && isFn(f.__oprProcOrig)) window[name] = f.__oprProcOrig;
        });
      } catch (e10) {}
      try {
        var tpl = $('templatesModal');
        if (tpl && TPL_HOME && tpl.parentElement === $('oprPanelTpls')) {
          if (TPL_HOME.next && TPL_HOME.next.parentNode === TPL_HOME.parent) TPL_HOME.parent.insertBefore(tpl, TPL_HOME.next);
          else TPL_HOME.parent.appendChild(tpl);
        }
        showTab('procs');
      } catch (e9) {}
      /* b944: the write-if-changed caches live ON the nodes, and these nodes
         outlive the module. Emptying the rail without clearing its cache would
         leave a re-installed module believing the markup it is about to write
         is already there - an empty rail that never comes back. */
      try { var a = $('oprRowNav'); if (a) { a.innerHTML = ''; a.__oprHtml = null; a.onclick = null; } } catch (e4) {}
      /* onkeydown as well as onclick: the keyboard handler was added in the same
         change that made the Edit affordance reachable, and revert() forgot it -
         so a reverted module left a live key handler on a node it no longer owns.
         Found by tests/opnote-room-walkthrough-runtime.test.js. */
      try { var b = $('oprTplRail'); if (b) { b.innerHTML = ''; b.__oprHtml = null; b.onclick = null; b.onkeydown = null; } } catch (e5) {}
      /* the mode control is a node THIS module created, so revert removes it
         entirely rather than emptying it - leaving an orphan box would be a
         visible artefact of a module that is supposed to be gone. */
      try { var mb = $('oprTplMode'); if (mb && mb.parentNode) { mb.onclick = null; mb.parentNode.removeChild(mb); } } catch (e5b) {}
      try { var pt = $('oprTabProcs'); if (pt) { pt.onclick = null; pt.__oprWired = false; } } catch (e5c) {}
      try { var c = $('oprReceipt'); if (c) { c.textContent = ''; c.style.display = 'none'; } } catch (e6) {}
      try { if (window.__mlsOpNoteRoom === api) delete window.__mlsOpNoteRoom; } catch (e7) {}
    }
  };
  window.__mlsOpNoteRoom = api;
})();
