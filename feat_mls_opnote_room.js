/* =============================================================================
 * __mlsOpNoteRoom  opr-1.0.0  (2026-07-26 — Stage 0 of OPNOTE_WORKROOM_PLAN)
 * -----------------------------------------------------------------------------
 * The op-notes workroom's HOME, installed inert. Owner-approved direction
 * (2026-07-26, direction check): ONE full-screen room replaces the two op-note
 * modals; #opPrepModal STAYS the container (option C in the plan — three
 * satellites gate the entire Fields box on that id's computed display, the
 * decisive seam) and #templatesModal reparents WHOLE as the Templates tab.
 *
 * STAGE 0 DELIBERATELY RENDERS NOTHING AND WRAPS NOTHING. It exists so that
 * every later stage of the room ships inside a module that:
 *   - is revertible ON ITS OWN at 2am (revert() below), without touching the
 *     drafter machinery (oni/onf/opnp) or any view layout;
 *   - carries the plan's hard rules in one place, next to the code that will
 *     have to obey them.
 *
 * HARD RULES the later stages inherit (from OPNOTE_WORKROOM_PLAN_2026-07-26.md):
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
  var VERSION = 'opr-1.1.0';
  var previous = null;
  try { previous = window.__mlsOpNoteRoom; } catch (e0) {}
  if (previous && previous.installed && previous.version === VERSION) return;
  if (previous && typeof previous.revert === 'function') {
    try { previous.revert(); } catch (e1) {}
  }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
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
    safe(function () { if (typeof window.closeTemplates === 'function') window.closeTemplates(); });
  }
  window.addEventListener('keydown', onKey, true);

  var api = {
    installed: true,
    version: VERSION,
    stage: 1,
    describe: function () {
      return 'op-note workroom, stage 1: full-screen shell live inside ' +
        '#opPrepModal (option C - the container id and class-toggled open are ' +
        'load-bearing for three satellites); tab strip routes Templates to the ' +
        'real openTemplates(); ESC on the Templates modal returns to the room. ' +
        'Stages 2-4: editor parity + template rail, the in-room Templates tab, ' +
        'presentation retirement.';
    },
    revert: function () {
      api.installed = false;
      try { window.removeEventListener('keydown', onKey, true); } catch (e2) {}
      try { if (window.__mlsOpNoteRoom === api) delete window.__mlsOpNoteRoom; } catch (e3) {}
    }
  };
  window.__mlsOpNoteRoom = api;
})();
