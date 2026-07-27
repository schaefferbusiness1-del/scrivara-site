# Release regression at b711 — 2026-07-26 night (goal-lane takeover session)

## Two consecutive clean passes (owner's bar)

Pass A (b711, post-fix walk): Visit (hero names the banner patient; right-now
bar hidden), Day (calendar renders, 0 text leaks; the b707 flat-list exit holds:
panel bounded 901px, sticky Back visible), Patients (150 Record visible; delete
reveals on reach — exactly 1 visible, the selected row, per b705), History
(op-note row title says the name once — b711), Review (honest empty state,
gaps-first), AI Studio (Ask/Practice/Build all render, 0 leaks), Settings (all
7 tabs, 0 undefined/NaN/[object leaks), Copilot (opens, b708 hero collapse
active, closes), Ask bar (zero-match Copilot failover row renders; no dictate
chip), Public preview (dock clears the SAMPLE WORKSPACE strip, 7px clearance).
Console: 0 errors.

Pass B (b711, fresh boot): same stations re-touched, 0 new findings, 0 console
errors including boot.

Instrument notes (probe artifacts, not defects, all re-checked visually):
"Tools menu empty" (items are div[role=menuitem], not buttons); "150 deletes
visible" (visibility:hidden keeps a layout rect); "reviewOk:false" and
"trapFixHolds:false" (compound probes raced their own renders); "19
appointments today" (b255 staff-filter excludes 2 owner-marked staff — correct).

## E2E

`node tests/e2e/run-e2e.js` with MLS_E2E_REQUIRED=1 and
MLS_E2E_PUPPETEER_DIR=C:\Users\Micha\mls-e2e-puppeteer (fresh puppeteer-core
install; the old dir was gone): **30 steps, 0 failed, exit 0** — includes the
full workday walkthrough, consent gate, op-note draft quarantine, both phone
profiles, keyboard-vs-dock, safe-area, offline honesty.

## One real history pull (the only accepted proof)

- First attempt: "Pull today" (Sun Jul 26) — the Athena tab was parked on a
  stray 2026-08-01 view; the date guard fired and NAMED it ("ignored a stray
  '2026-08-01' on the Athena page"); no receipt written. Honest refusal, and
  the owner-facing banner explains the remedy.
- Regression pull: **Tue 2026-07-28, full verified-history lane at b711 /
  ext 3.0.22**. Status advanced Reading verified history 1..21 of 21
  (~9-10s/patient). RECEIPT (namespace leeschaeffer41@gmail.com):
  - `schedImportIndexV1::2026-07-28` → v:1, **21 rows, state "done" ×21,
    all 21 keyed `appointment-id:<real id>`** (sample appointment-id:53638300)
  - `schedImportDaysV1` → **2026-07-28 present (day complete)**
  - Re-pull idempotency held: same 21, no duplicates.

## Builds shipped this session (all gated green BEFORE commit, all live-verified)

b705* (ask-bar: dictate-chip opt-out, zero-match Copilot failover row, b18 chip
scoped off the dock, 172px input — *carried into the b705 commit by the studio
lane's add -A; combined tree re-gated green) · b706 (right-now Start-Recording
duplicate retired; Record demotes instead of dying under an unproven binding —
proven through consent to a RUNNING capture on the [MLS TEST] slot) · b707
(calendar flat-list exit trap) · b708 (Copilot panel calm polish, both themes)
· b709 (op-note reliability: fidelity graded against the model's slice,
maxTokens, dropdown owns tplManual — proven with a real faithful draft on the
[MLS TEST] patient) · b710 (visit home follows the banner patient — found
during b709 verification, both directions) · b711 (preview strip clearance +
history title de-dup).

Op-note workroom: owner approved FULL WORKROOM + ALWAYS-ADAPTIVE (direction
check); plan committed as OPNOTE_WORKROOM_PLAN_2026-07-26.md (option C, 4
separately-green stages, 11 injection points, the modalOpen() seam named).
Remaining owner-data item: the QA-debris templates are still live options in
his dropdown — replace WITH him (OP_NOTE_TEMPLATE_PACK_2026-07-23.md).
