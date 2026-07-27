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
  var VERSION = 'opr-1.0.0';
  var previous = null;
  try { previous = window.__mlsOpNoteRoom; } catch (e0) {}
  if (previous && previous.installed && previous.version === VERSION) return;
  if (previous && typeof previous.revert === 'function') {
    try { previous.revert(); } catch (e1) {}
  }

  var api = {
    installed: true,
    version: VERSION,
    stage: 0,
    describe: function () {
      return 'op-note workroom home, stage 0: inert. The room container is ' +
        '#opPrepModal (option C); stages 1-4 build the shell, editor parity, ' +
        'the Templates tab, and the modal-presentation retirement here.';
    },
    revert: function () {
      api.installed = false;
      try { if (window.__mlsOpNoteRoom === api) delete window.__mlsOpNoteRoom; } catch (e2) {}
    }
  };
  window.__mlsOpNoteRoom = api;
})();
