# OP-NOTE WORKROOM — implementation plan (owner-approved direction, 2026-07-26)

Owner direction (via direction check, recorded in COORDINATION_GOAL_LANE_2026-07-26.md):
FULL WORKROOM — one full-screen op-notes room; Templates becomes a tab of it; both
old modals retire as *presentations*. Template behavior stays ALWAYS-ADAPTIVE
(b509 ruling stands — he explicitly declined manual-strict).

Reliability phase SHIPPED: b709 (oni-2.16.0 — fidelity graded against the model's
slice, maxTokens:4096, dropdown owns tplManual, honest label), live-verified with
a real draft on the [MLS TEST] patient.

## The load-bearing decision — Option C

KEEP `#opPrepModal` AS THE ROOM'S CONTAINER, restyled to inset:0 (`.opr-room` on
the same .modal-bg), and REPARENT THE ENTIRE `#templatesModal` NODE into the
room's Templates tab panel (positioning neutralized by `.opr-hosted-modal`).

Why this wins over a new #opnoteView or an #studioFsOverlay clone:
- `feat_mls_opnote_fill.js:95 modalOpen()` gates the ENTIRE Fields box on
  `#opPrepModal` computed display — same gate in feat_opnote_history.js:569 and
  feat_mls_opnote_prep.js:369. Any other container silently kills .onf-fillbox
  everywhere (no error; placeholder-riddled drafts reach charts). THE WORST SEAM.
- Every entry point (openOpPrep*/openTemplates + ~14 callers incl. Tools, topbar,
  Copilot action, palette, cross-day card) works UNCHANGED — they class-toggle
  the same node.
- A `*View` id would drag in ui-reach-map/showView/dock edits (forbidden).
- `.modal-bg` keeps theme_polish focus trap + ESC; the pinned
  role/aria-modal/aria-labelledby string survives byte-identical.
- `mls-template-stdline.js:400-421` finds its anchor by an /template/i heading
  INSIDE #templatesModal — moving the WHOLE node keeps it; moving inner content
  loses the standard-line card silently.

## Structure (id scheme)

.opr-room > .opr-shell (grid): header .opr-top (h3#opPrepHdr "Op notes" +
#mlsOpHistChip + tabs #oprTabProcs/#oprTabTpls + .modal-x) ·
#oprPanelProcs [aside#oprDayRail (#opPrepModeRow/#opPrepDayRow KEPT + ol#oprRowNav)
| main#oprEditor (button#oprPrimary + #opPrepStatus/#opPrepEmpty/#opPrepList KEPT,
row ids opPrepPrev_i/Proc_i/Tpl_i/Note_i/Msg_i UNCHANGED)
| aside#oprTplRail (#oprTplPickList — reads getTemplates(), reuses tpf healthOf()
badge classes)] · #oprPanelTpls [the reparented #templatesModal].

#oprPrimary state machine (one primary per state): no templates→"Upload templates"
(tab switch); row without tpl→"Match template"; tpl+!gen→"Draft op note";
gen+fields outstanding→"Fill remaining fields"; gen+0 blanks→"Save to chart";
all-mode→#opPrepGenAllBtn ITSELF restyled (the tpf capture interceptor
mls-connect.js:15497 and history relabeler NEED that exact node clicked — never a
proxy button).

## Hard rules

1. FOURTEEN literal-slice markers in ScribeFlow.html stay byte-identical, column
   0, same ORDER (save-truth:39, opnote-exact-patient-binding:21-27,
   site-continuity:51-58; one slice is EXECUTED in a vm sandbox). ALL room code
   goes in a NEW FILE `feat_mls_opnote_room.js` (opr-1.0.0) — never between
   markers.
2. Positional DOM contracts: integrity:583 badge lookup =
   `#opPrepTpl_i.parentElement` first `span.mini span`; onf:1200 inserts the
   Fields box as `#opPrepNote_i.previousElementSibling` — the slot before each
   note textarea stays FREE (no wrapper/toolbar).
3. ELEVEN satellites total (6 templates-side incl. the uploadClick/moveStandardLine
   block mls-connect.js:35592, 5 op-prep-side). All keep working via option C —
   pinned by a new contract (below).
4. ESC: room module owns a WINDOW-capture keydown (Templates tab → back to
   Procedures; Procedures → close). NEVER edit the pinned handler at
   ScribeFlow.html:14593; never data-mls-no-esc.
5. Backdrop: .opr-shell fills inset:0 padding:0 so no .modal-bg pixel is ever a
   mousedown target (theme_polish:119 closes on backdrop mousedown).
6. Radius 22/16/10/999 only; motion tokens only, transform/opacity, no
   backwards-fill on opacity:0 keyframes.
7. openTemplates/closeTemplates get WRAPPED (outermost — three modules already
   wrap openTemplates: stdline:424, template_library:208; preserve return value);
   never renamed. #templatesBtn + header button keep onclick="openTemplates()"
   VERBATIM (topbar_unify:76 and calm_shell:911 find them by it).

## Rollout — four separately-green builds

Stage 0: inert feat_mls_opnote_room.js (installed/version/describe/revert, no
interval, no subtree observer, requestIdleCallback loader like calm_views);
boot-script-budget CEILING 242→243 with the three-question comment; immutable
token registered. Gates: budget, immutable, coverage.
Stage 1: room skeleton — modal-bg gains .opr-room, .opr-shell grid, tabs, three
regions; pinned attrs/ids untouched; opPrepRender wrapper (third wrapper — after
opnp:701 and oni:1184, idempotent __oprWrapped) + #oprPrimary + ESC owner +
onf tick()-before-focus-restore. CSS next to #settingsModal's wide-modal block
(ScribeFlow.html:852).
Stage 2: editor parity — current row full-width, others in #oprRowNav; template
rail with health badges; secondary controls class-folded (calm-views-folds
pattern); NEW tests below.
Stage 3: Templates tab — reparent whole #templatesModal at install (idempotent,
revert() restores to body); openTemplates wrapper = tab switch; update the two
feature-directory `where:` strings (mls-connect.js:30595,30597).
Stage 4: retirement of the modal PRESENTATION only (nothing deleted): the
one-sentence empty states, single exit, ≤6-step walkthrough doc. Dead code
(_opBlanksHtml etc. 14855-14894) spun off as its own task.

## New contracts

- opnote-room-keeps-every-injection-point.test.js — BOTH halves for each of the
  11 satellites (b669 rule: removing an anchor fails by name).
- opnote-room-is-one-primary.test.js — 6 state fixtures; Draft-all primary IS
  #opPrepGenAllBtn.
- opnote-room-holds-the-caret.test.js — focus/selection restored in
  #opPrepNote_i AND .onf-fillbox after rebuild; tick() before restore; note
  _keep.modalScroll/boxScroll are no-ops today (no overflow on those nodes).
- opnote-room-templates-tab-keeps-its-exit.test.js — ESC semantics + no
  position:fixed .modal-bg inside the room.

## Risks ranked

🔴 modalOpen() display gate (the worst seam — option C neutralizes; contract 1
pins) · 🟠 integrity positional badge · 🟠 stdline heading anchor ·
🟡 literal slices · 🟡 double-ESC · 🟡 backdrop mousedown · 🟢 manifest churn ·
🟢 calm_shell child animation double-fade · 🟢 staging (leave alone; parity
suites prove it).

## Also in this workstream, not yet done

- Template hygiene on the OWNER'S ACCOUNT DATA (not code): the QA-debris
  templates ("QA Bilateral Lumbar Facet Injection 20260722", "QA Lumbar
  Transforaminal ESI 20260722") are still options 1-2 in his live dropdown and
  historically catch real TFESI/facet patients; OP_NOTE_TEMPLATE_PACK_2026-07-23
  ships replacements + a cleanup list. Owner-data mutation — do it WITH him or
  with explicit sign-off, on his tab.
- Dead-weight removals (own builds): feat_mls_opmatch_boost.js (reverted on
  every boot yet cache-busted every build), feat_mls_opnote_fillblank.js
  (unloaded; a test FORBIDS loading it).
