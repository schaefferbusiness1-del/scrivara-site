# b500 — Operative-note workflow hardening (2026-07-23)

Goal: make the op-note workflow reliable, accurate, visually polished, and ready for
authorized use. All testing on SYNTHETIC records in the local `?demo=1` sandbox
(throwaway local account, backend blanked, AI stubbed at the `api.openai.com` fetch
boundary so the entire wrapper chain — identity binding, fidelity, repair, airing —
runs for real). No real patient data touched; no deploy from this session.

Versions: oni-2.9.0 → **oni-2.10.0**, opnp-1.6.0 → **opnp-1.7.0**, onf-2.7.0 →
**onf-2.8.0**, build b499 → **b500**. New suite:
`tests/opnote-workflow-hardening-runtime.test.js` (registered in run-all).

## Defects found → fixed (each retested live in the sandbox + pinned by test)

1. **Appointment provider/facility silently dropped** — oni's `newRow` replacement
   predated the base `_opNewRow`'s 6th `scope` param; every prep row lost the
   scheduled provider/facility (readiness showed "⚠ Facility" even when the
   schedule knew it). FIX: scope carried (all raw shapes). VERIFIED: row.appt now
   carries `Sarah Quinn, MD` / `QA Surgery Center`; readiness ✓.
2. **Provider/facility attestation block dead** — oni-2.9.0 stamped `__opnpWrapped`
   on its own `generate`, neutering opnp's `_genOpNote` wrapper, so generated notes
   contained NO provider/NPI/facility statement at all. FIX: opnp exports a
   ctx-aware `attest()`; oni appends it AFTER fidelity+clinical validation on both
   return paths (absent prep module = no-op, so the pipeline tests stay green).
   VERIFIED: footer present with appointment provider/facility + "(DRAFT — not
   submitted to athenaOne…)" line; idempotent on re-draft.
3. **Duplicate draft notes on reopen (no resume)** — `row._noteId` lived only in
   memory; closing/reloading then re-drafting minted a second identical draft
   (reproduced live: two Alice drafts). FIX: opnp `adoptExistingDraft` — on modal
   open, an unambiguous patient + same-procedure `isDraft kind:'opnote'` note is
   adopted (same id, text resumed, marked "↩ Resumed your earlier draft").
   VERIFIED: reopen+re-draft leaves the count unchanged; different-procedure and
   finalized notes are never adopted.
4. **Template-switch staleness invisible** — a note drafted from template A could
   be saved while the dropdown showed template B, with no warning anywhere.
   FIX: successful drafts stamp `row._genTplId`; the status badge turns red
   ("⚠ draft below is from “X” — Re-draft to apply this template") and the save
   path warns on first click (see 6). VERIFIED live both ways.
5. **Machine auto-fill masqueraded as clinician edits** — onf's fill box writes
   suggested standard values into the note via a synthetic `input` event, which
   set `row.edited=true`: re-draft demanded "discard MY edits?" when the user had
   typed nothing, and "Draft all" skipped those rows as hand-edited. FIX:
   `writeRendered` snapshots/restores the edited flag around machine renders; real
   typing still marks edits. VERIFIED: fresh draft + machine fill → `edited:false`,
   immediate re-draft runs without the discard confirm.
6. **Auto-suggested values could finalize sight-unseen** — machine-filled
   placeholders defeat the blank-token draft quarantine, so a double-click
   Draft→Save could finalize invented standard values with zero review. FIX
   (preserves the owner's 2026-07-13 pre-fill directive): untouched amber
   suggestions are tracked (`_onfSuggestedPending`); the bare per-row 💾 asks for
   ONE confirming second click listing them; "✓ Looks right — save to History" and
   "✓ Save all drafted" count as the explicit review (no extra click in the
   owner's two-click flow). VERIFIED: first click blocked with named fields,
   second click saves.
7. **Cross-patient leak via shared dropdown history** — every touched field
   (including diagnosis/indication filled from patient A's chart) was written to
   the account-wide `opFieldVals` store and offered as "Last used" for patient B.
   FIX: write AND read now allowlist-gated by `defaultEligible` (stable practice
   identity/equipment only — never clinical values); pre-existing contaminated
   history is thereby unreadable too.
8. **Wrong needle default for deep targets** — fill box led with "25-gauge,
   1.5-inch" for a lumbar TFESI at BMI<30, contradicting the app's own
   `_predictNeedleSize` (3.5"). FIX: procedure-aware — spinal/deep targets lead
   3.5-inch; superficial (trigger point/bursa/peripheral) keep 1.5-inch; BMI≥30/35
   escalation unchanged. VERIFIED: TFESI note now reads "NEEDLE: 25-gauge,
   3.5-inch spinal needle."
9. **Irrelevant chart problem stamped as pre-op diagnosis** — with zero token
   overlap, `fillChartSlots` used `probList[0]` (e.g. "Hypertension") as the
   diagnosis. FIX: relevance gate (overlap>0) — otherwise the placeholder stays
   visible for the clinician. VERIFIED in the new suite both ways.
10. **Failures collapsed to "Couldn't draft that one — try again."** — network,
    server, identity, and template-conflict reasons were all hidden; guard paths
    left a STALE status line from another patient's draft. FIX: oni surfaces every
    real failure on `__mlsLastOpFidelityError`; ScribeFlow's catch names the row
    and the reason; edit-guard/no-template/compat-guard paths own the status line.
    VERIFIED: "Couldn't draft QA Bob Beta's op note — Failed to fetch".
11. **Silent data loss on day/mode switch** — typed-but-undrafted procedure text
    vanished when switching day or patient/all mode. FIX: non-blocking two-step
    confirm (8s window, no native dialogs). VERIFIED: first switch blocked with
    honest status, repeat proceeds.
12. **Backend sync invisible** — `saveNoteToBackend` was fire-and-forget; "✓
    Saved" showed even if the server write failed. FIX: it now returns
    'synced'/'queued' (behavior unchanged; callers ignored the return), and the
    op-prep save message appends "☁ synced" or "☁ offline — kept on this device,
    will retry" (demo mode: no backend, no suffix).
13. **A11y/consistency** — opPrepModal now has `role="dialog" aria-modal
    aria-labelledby`, ESC-to-close + Tab focus trap (same pattern as
    patientModal), label/for on the procedure and day inputs, aria-label on the
    close ×; Draft buttons show a disabled "⏳ Drafting…" in-flight state.
14. **Stale cache-buster (deploy-correctness)** — `?v=20260723oni282` still served
    while the file content was oni-2.9.0; returning browsers could run 2.8.2
    forever (SW serves `?v=` cache-first). FIX: tokens moved to
    `20260723oni2100` / `20260723opnp170` / `20260723onf280` in BOTH connect
    loaders; header comment corrected.

## What was tested and already correct (no fix needed)

- **Cross-patient isolation in generation**: same-name pair (two "QA Carol Same",
  different DOB) → correct chart facts per row, note bound to the right
  patientId, zero leakage; identity fail-closed (`MLS_OPNOTE_IDENTITY`) on any
  mismatch, re-checked mid-flight and before repair.
- **Duplicate actions**: double-click Draft = ONE AI call (generation-jobs
  single-flight); double-click Save = no duplicate note (`_noteId` reuse).
- **Draft quarantine**: notes with any unresolved placeholder save only as
  labeled "(op-note draft)", never finalize, never sign; complete saves stay
  `signed:false` (reviewable) and never touch Athena.
- **Adversarial model output**: rogue headings/fabricated content stripped via
  one repair round-trip; fail-closed if still unfaithful.
- **Template auto-match**: correct on all seeded procedures; cross-class refusal
  (a *block* procedure refuses an *RFA* template); blank-reason rows get NO
  template rather than a wrong default.
- **Recovery**: full page reload preserved patients/templates/notes; autosaved
  drafts in History survive any interruption (and now resume, see fix 3).
- Save-flow honesty (draft vs complete messaging), template searchable workspace,
  native `<select>` type-ahead + 🔎 Match template on the per-row picker,
  valid-choices-only dropdowns with "Other (type custom)…" escape.

## Evidence

- Baseline (clean b499 tree): 272-suite gate PASS, 17-step offline E2E PASS.
- Post-fix: full gate PASS (274 suites: +schedule-empty-day [other session's
  lane] +opnote-workflow-hardening [this lane]), offline E2E PASS — see final
  commit message for exact counts; logs in session scratchpad
  (`baseline-gate.log`, `post-fix-gate.log`, `post-fix-e2e.log`).
- Live sandbox retests recorded above per fix (b500 + all three satellites
  byte-verified loaded in the tab before retesting; SW cache cleared to defeat
  the `?v=` cache-first landmine during same-token iteration).

## Remaining limitations / release risks

- **PDF export re-normalization (mls-opnote-pro.js:519)**: exporting a
  template-faithful note re-sections it into the fixed 14-heading CANON layout
  and can inject `[not dictated]` AFTER the draft gate ran on the raw text — the
  exported PDF can differ structurally from the reviewed/saved note. NOT fixed
  in this lane (separate surface, its own pinned tokens); flagged for a
  follow-up. The on-screen preview and the chart-saved note are byte-identical
  (verified) — the divergence is PDF-only.
- **Resumed drafts have no `_genTplId`** (source template of an old draft is
  unknowable), so the template-staleness badge/save-warning cannot arm until the
  first re-draft of a resumed row.
- **Suggested-value review gate** adds one confirming click to the bare per-row
  💾 when untouched amber values would finalize. The onf accept buttons bypass it
  by design; if the owner prefers zero friction, flip the `_onfSuggestedPending`
  check in opnp's `opPrepSave` wrap.
- **Dark-theme consistency**: onf/opnp injected panels still hardcode light
  palettes (readable, but visually inconsistent in dark mode) — cosmetic,
  untouched to avoid unverifiable visual churn from a headless session.
- Retired one-at-a-time blank-walker code remains (unreachable) in
  ScribeFlow.html; staging shell still calls it — left for a staging-parity
  cleanup lane.
- The b500 commit excludes the other session's uncommitted extension lane
  (background.js / manifest.json 3.0.4 candidate + their run-all line — see
  coordination file); their `schedule-empty-day-proof-contract` suite passes in
  the shared tree.

## b501 addendum — template-matcher hardening (oni-2.11.0, same day)

Owner follow-up: "make sure the template matching is really good." Built a
65-case adversarial evaluation (16-template realistic library; clean forms,
Athena shorthand, CPT-only reasons, plurals/typos, generic-vs-specific,
cross-class traps, historical/negation/undecided rows, combined procedures).
Baseline: **48/65**. After oni-2.11.0: **65/65**, with every previously-passing
suite still green.

Matcher defects found → fixed:
1. **Word-over-code two-pass classification** — shared CPTs inside a template's
   own body mis-classed it and made it permanently unmatchable AND undraftable
   (Caudal template's 62323 → "interlaminar"; SCS-trial's 63650 → "implant").
   Words now decide first; codes only when no word signal exists.
2. **CPT-only reasons classify** (64490-95, 64633-36, 27096, 64625, 64454,
   64624 standalone) with unambiguous lumbar codes counting as region evidence
   so "64635 64636" cannot drift to a cervical RFA template.
3. **Historical/conditional mentions can no longer steal the class** — "Left
   L5-S1 TFESI (prior right L4-L5 MBB with relief)" matched the MBB template
   (class-list order beat primacy); prior/s-p/parenthetical-history and
   "possible … to follow" clauses are stripped before classification.
4. **Undecided rows refuse honestly** — "TFESI vs MBB — decide at visit" now
   returns no-match ("names more than one procedure") instead of confidently
   picking MBB; RFA-of-the-medial-branches shorthand ("RFA B/L L4MB L5 DRB")
   is recognized as ONE procedure via rfa-subsumes-block pairs.
5. **Sibling-class margin guard** — with no classified signal, a small keyword
   margin can no longer cross block↔RFA templates (the "blcok" typo previously
   picked the RFA template; typo now also normalizes).
6. **ESI hierarchy** — a generic "Cervical ESI" request may use the practice's
   single cervical (interlaminar) template (+45 family score, exact class still
   wins at +120); a generic "Lumbar ESI" against several lumbar ESI templates
   still refuses as ambiguous. Junction levels ("C7-T1") no longer false-
   conflict region (region compatibility = shared component, not equality).
7. **Shorthand/typos normalize**: B/L SI inj, SI RFA, ESI-TF/TF-ESI, TFESIs/
   ESIs/MBBs/RFAs plurals, DRB, transforminal, sacroilliac, epidral, blcok.

Pinned: 18 new matcher-contract assertions added to
`tests/opnote-workflow-hardening-runtime.test.js`; the pre-existing 12-case
classification map in `opnote-template-integrity-runtime` passes unchanged.
Versions: oni-2.11.0, token 20260723oni2111 (both loaders), build b502 / mls-v88. (b501 was taken mid-lane by the av-1.1.0 push, which also swept this suite's 2.11.0 asserts from the shared worktree WITHOUT the oni source — main's gate was red until this commit; the once-live oni2110 token was burned and skipped.)
Eval harness kept in the session scratchpad (matcher-eval.js, 65 cases).

Residual matcher limitations: bare shared-code reasons ("62323" alone) resolve
to the interlaminar template by code order — refusing may be preferable but
either candidate is defensible; no general fuzzy-typo matching (only the
curated list); thoracic-specific CPT region hints intentionally omitted.

## Live-release handoff

Per the goal, this session does NOT deploy. The lane is committed on the shared
tree; the coordination file (memory: coordination-2026-07-22-live-pull-lane)
carries the b500 claim + handoff note asking the active release-owning session
to push after the usual pull-stamp probe.
