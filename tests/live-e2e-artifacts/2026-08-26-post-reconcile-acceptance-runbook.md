# Post-reconciliation acceptance runbook — 2026-08-26

Written at branch tip `46a566ee` (all thirteen reliability slices Codex-accepted: cva, cvi,
pts-1.1, pvd, tax-1.0.1, nvl-1.5, fvn-1.1, scl, pv7-1.1, prov-1.0.1, vt-1.1, spd — replies
35/36/41/42/46/47). Run this AFTER Codex reconciles the branch into main and the enabled
extension is restamped/reloaded through the normal protocol. Every step names the exact
receipt that proves it; a green click path proves nothing by itself.

**Boundaries (unchanged, absolute):** live writes only on dummy Adam J Schaeffer
(#7833832, appt 55816420, encounter 15991289); only write_note/save_draft ever execute;
no orders/billing/Save/Sign; one signed-in athena tab; never navigate athena while the
extension drives; the running-counter chip — not the pull button — is the idle authority;
every mutation needs action-time confirmation (Codex reply 48 standing rule).

## 0. Preflight (read-only)
- `list_connected_browsers` → extension answering; app tab on the RECONCILED build
  (`window.__MLS_APP_BUILD` must be the new token, not main-20260823-r2).
- Idle: `__mlsLoadingCalm.snapshot()` has zero running/retrying; `__mlsDaySwitch.isBusy()`,
  `__mlsSI.isBusy()` false; `__mlsPullBusyAt` 0/stale.
- `git log` receipts: the reconciled main contains the thirteen slices' SHAs (spot-check
  `95b0abb7`, `047f1b5a`, `886333c0`, `27fcf3ec`).

## 1. Owner-validated whoever-pull re-test (SACRED — first, per standing law)
- Real click on the open-patient toolbar verb with the dummy open in athena.
- PROVE: right patient (digits-only MRN in the capture receipt — cap-mrn law), no
  false "different patient" warning, `#ptPullAthenaBtn` visible in every render
  (pv7: select a patient on the Patients view and confirm the verb never vanishes;
  hidden-header render too).

## 2. Five-path pull matrix (each path ×2 minimum; verify DATA, not clicks)
Read after every pull: `window.__mlsPullLastOutcome` — it now carries `historyVerdicts`
(closed arithmetic: requested = succeeded + failed + omitted + notAttempted + unaccounted),
`costBreakdown` (per-stage ms — name the slow step), `navDiag` (attempts monotonic across
sequences, `recoveryRan`/`recoveryVia`/`sequences`, exact booleans), `visitNotesMode`,
`calendarDiag`/`attributionCoverage`/`historyRetryReasons` on failure, and interim truth
during convergence (`interim:true` while finishing — never complete:true mid-phase).
- **P1 DAY pull, FVN OFF:** schedule/booking identity + chart facts + exactly the pulled
  day's own note per patient. `visitNotesMode === 'day-facts'`. No historical bodies.
- **P2 DAY pull, FVN ON:** P1 + all dated prior notes. ON-mode completeness partial only
  with named omissions (`complete-with-named-omissions` ONLY for the two reviewed content
  causes; transport classes stay in retry and DRAIN after capped rounds — the eternal
  "(N)" button must not persist for content-class leftovers).
- **P3 open-patient pull** (×3+ across chart AND encounter surfaces): identity digits-only.
- **P4 MLS search `Last,First`:** the typed door matches the existing patient (no mint —
  exact-name law: tolerant comparator + DOB gate); palette finds deep-index patients
  (qfp: no 800-row cap).
- **P5 per-patient refresh:** both lanes truthful; refresh chip paints via the chart-work
  scope even right after a day pull (scl lease: no stale-scope reopen after it settles).
- **Recovery controls:** park athena on the ENCOUNTER surface then P1 — the goto must
  recover via its own ladder exactly once (`recoveryRan:true`, truthful attempt total);
  a sleeping/absent tab must fail in ONE dispatch with its coded reason.
- **Progress truth:** during each pull the chip lives; at `done()` the scoped terminal
  closes BOTH observer jobs (no stale "2 running"); late chatter reopens nothing.
- **UI truth:** labeled tallies ("N MLS visit notes" vs "N visits — all sources" —
  numbers may differ, labels must scope them); facts-card provenance lines (the
  verified-empty divergence warns loudly; check the dummy's meds card if the stale
  Ibuprofen row still exists locally); import receipts never counted as visits.

## 3. Write matrix on the dummy (action-time confirmation per write)
- Per-section HPI/ROS/PE writes re-proven on reconciled bytes (probe ok:true
  context-verified → real-click Confirm & Send → read back in athena; empty-only,
  unsigned).
- **bx-1.0.0 batch:** check multiple ready sections → one confirm → sequential per-row
  probe+execute → all land + read back. **ap-1.0.0 combined A&P row** live for real
  (synthetic probe already proved binding pre-freeze).
- sn-1.0.0: the driver opens the right stage tab regardless of athena's current tab.

## 4. Template lane (deferred by reply 48 — action-time confirmation REQUIRED)
Recipe proven 2026-08-26 ~06:0x and fully reversed (Entry 48): Settings → Notes & AI →
family=Assessment (label repaints) → paste synthetic example → Create AI template preview
(de-identified scaffold) → Apply → Save (ONLY `draftTuningV1` changes; op-note template
keys byte-identical) → fresh generation adheres (numbered condition–status + pain level).
Re-run under explicit confirmation if the mutation should count on the record.

## 5. LAST — owner's standing order
Delete the dummy's appointment 55816420 (EST30 08-25-2026 10:00 PM) only after ALL
testing wraps, with action-time confirmation, and verify the server row dies (a local
delete without a server delete resurrects).

## Receipts bundle per run
PHI-free: `__mlsPullLastOutcome` JSON, `__mlsDayHistoryPull.state`, the day-strip verdict
sentence, chip states, screenshots with PHI redacted, and for writes the step-4 verdict +
`noteWriteProof` + athena read-back. File under tests/live-e2e-artifacts/ dated.
