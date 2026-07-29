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
    safe(function () {
      var st = document.createElement('style'); st.id = SKIN_ID;
      st.textContent = [
        '/* op-note room remake 2026-07-28 - calm one-room presentation */',
        '#opPrepModal.opr-room .opr-top{ padding:14px 56px 14px 20px; gap:16px; }',
        '#oprPanelProcs{ grid-template-columns:312px minmax(0,1fr); }',
        '#oprDayRail{ padding:16px 18px 26px; }',
        '#opPrepModeRow{ flex-direction:column; gap:6px !important; }',
        '#opPrepModeRow button{ width:100%; text-align:left; border-radius:12px !important; padding:10px 14px !important; }',
        '#opPrepDayRow{ flex-direction:column; align-items:stretch !important; gap:7px !important;',
        '  background:var(--bg); border:1px solid var(--line); border-radius:16px; padding:12px; }',
        '#opPrepDayRow button{ border-radius:10px !important; text-align:left; background:var(--card); }',
        '#opPrepDayRow input{ width:100%; box-sizing:border-box; border-radius:10px !important; background:var(--card); }',
        '#oprRowNav{ gap:6px; max-height:none; }',
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
    if (rows.length < 2) { nav.innerHTML = ''; return; }   /* single-patient mode needs no nav */
    if (SEL >= rows.length) SEL = rows.length - 1;
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
    nav.innerHTML = h;
    /* one delegated listener, re-attached with the innerHTML rebuild */
    nav.onclick = function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.opr-nav-item') : null;
      if (b) oprSelect(+b.getAttribute('data-i'), true);
    };
  }

  function buildTplRail() {
    var rail = $('oprTplRail'); if (!rail) return;
    var list = safe(function () { return isFn(window.getTemplates) ? (window.getTemplates() || []) : []; }, []);
    var h = '<div class="opr-rail-title">Your templates — ' + list.length + '</div>';
    if (!list.length) {
      h += '<div class="opr-tpl-empty">None uploaded yet. Drafts follow your templates — add them on the Templates tab.</div>';
    } else {
      var hOf = safe(function () { return window.__mlsTplPrepFix && isFn(window.__mlsTplPrepFix.healthOf) ? window.__mlsTplPrepFix.healthOf : null; }, null);
      var shownN = Math.min(list.length, 6);
      for (var i = 0; i < shownN; i++) {
        var t = list[i];
        var health = hOf ? safe(function () { return hOf(t); }, null) : null;
        var cls = health ? health.cls : '';
        var lbl = health ? health.label : '';
        h += '<div class="opr-tpl-item" title="' + esc(lbl) + '"><span class="opr-dot ' + esc(cls) + '"></span><span class="nm">' + esc(t.name || 'Template') + '</span></div>';
      }
      if (list.length > shownN) h += '<div class="opr-tpl-empty">+ ' + (list.length - shownN) + ' more on the Templates tab</div>';
    }
    rail.innerHTML = h;
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
    el.textContent = p
      ? ('Context for ' + first + ': ' + (n ? (n + ' verified visit' + (n === 1 ? '' : 's') + ' + chart profile') : 'chart profile (no verified visits pulled yet)'))
      : ('Context for ' + first + ': identity not verified yet — the draft will name exactly what is missing');
    el.style.display = '';
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
    buildNav(); buildTplRail(); buildReceipt();
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
      try { var a = $('oprRowNav'); if (a) { a.innerHTML = ''; a.onclick = null; } } catch (e4) {}
      try { var b = $('oprTplRail'); if (b) b.innerHTML = ''; } catch (e5) {}
      try { var c = $('oprReceipt'); if (c) { c.textContent = ''; c.style.display = 'none'; } } catch (e6) {}
      try { if (window.__mlsOpNoteRoom === api) delete window.__mlsOpNoteRoom; } catch (e7) {}
    }
  };
  window.__mlsOpNoteRoom = api;
})();
