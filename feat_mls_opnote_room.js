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
 * ==========================================================================*/
(function () {
  'use strict';
  var VERSION = 'opr-1.2.0';
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
        if (scroll) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    safe(markNav); safe(buildReceipt);
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
      var cls = row.gen ? (nb ? 'blanks' : 'ready') : '';
      var state = row.gen ? (nb ? (nb + ' blank' + (nb === 1 ? '' : 's') + ' to fill') : 'drafted') : 'not drafted yet';
      if (row.edited) state += ' · your edits';
      h += '<button type="button" class="opr-nav-item' + (i === SEL ? ' on' : '') + '" data-i="' + i + '" title="' + esc(row.appt.name + ' — ' + state) + '">'
        + '<span class="opr-dot ' + cls + '"></span>'
        + '<span class="nm">' + esc(row.appt.name) + (row.edited ? ' ✎' : '') + '</span>'
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

  function buildRails() { buildNav(); buildTplRail(); buildReceipt(); }

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
  wrapRender();
  /* If the drafter is already open when this module lands (idle-deferred
     load), give the rails their first build now. */
  if (shown($('opPrepModal'))) safe(buildRails);

  var api = {
    installed: true,
    version: VERSION,
    stage: 2,
    select: function (i) { oprSelect(+i || 0, true); },
    rebuild: function () { safe(buildRails); },
    describe: function () {
      return 'op-note workroom, stage 2b: patient nav + template-health rails ' +
        'and an honest per-row context receipt, rebuilt on a revertible ' +
        'opPrepRender wrap that also kicks the onf Fields tick synchronously ' +
        '(occluded-tab law). Stage 3 next: the in-room Templates tab.';
    },
    revert: function () {
      api.installed = false;
      try { window.removeEventListener('keydown', onKey, true); } catch (e2) {}
      try {
        var w = window.opPrepRender;
        if (isFn(w) && w.__oprWrap && isFn(w.__oprOrig)) window.opPrepRender = w.__oprOrig;
      } catch (e3) {}
      try { var a = $('oprRowNav'); if (a) { a.innerHTML = ''; a.onclick = null; } } catch (e4) {}
      try { var b = $('oprTplRail'); if (b) b.innerHTML = ''; } catch (e5) {}
      try { var c = $('oprReceipt'); if (c) { c.textContent = ''; c.style.display = 'none'; } } catch (e6) {}
      try { if (window.__mlsOpNoteRoom === api) delete window.__mlsOpNoteRoom; } catch (e7) {}
    }
  };
  window.__mlsOpNoteRoom = api;
})();
