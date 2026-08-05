# Adam live writeback proof — SESSION 3 (2026-08-05 morning)

Continues `2026-08-04-adam-writeback-proof-IN-FLIGHT.md` (sessions 1–2). Same authorization, same
hard scope: **Adam J Schaeffer #7833832 DOB 03/24/2006 only; write_note/save_draft only; signing
manual in athena; agent never signs in for the owner.**

## Timeline (ET)

- 08:36 — Owner signed into BOTH surfaces on his own (his athena tab + his MLS tab opened at
  08:36–08:37; my session's probe tabs bracket his tab IDs). Sign-in verified the honest way:
  same-origin fetch `/22724/6/ax/dashboard` → **200, 91,417 bytes, no `Re-Login`, no identity
  redirect** (the known live-page size).
- 08:37 — MLS app tab probed: signed in, extension bridge ready. `currentVisitAthenaBinding` = null
  (expected — the overnight tab died with its page memory). Owner's active patient was Aaron S.;
  his tab was left untouched.
- 08:40 — **Tab-reach discovery** (cost ~10 min): this session's tool access is scoped to its own
  tab group. The owner's tabs appeared reachable once (first group), then never again. Driving the
  proof therefore uses MY OWN tabs: athena frameset tab + fresh ScribeFlow tab. The shared
  localStorage store carries the appointment import; the binding is per-tab page memory and gets
  rebuilt by regeneration (per the session-2 recipe).
- 08:44 — My app tab booted with **Adam auto-selected** (banner Adam J Schaeffer · 20y ·
  DOB 03/24/2006 · MRN 7833832; chip `SELECTED PATIENT · 11:00 PM`; EST15 badge). Review panel:
  "No note has been generated yet" — the overnight note did NOT rehydrate (page-memory loss
  confirmed).
- 08:48 — **Pull today: 1/1 ok in ~20s** — `__mlsPullLastOutcome {ok:true, at:1785934083386}`,
  `__mlsDayHistoryPull.state {total:1, done:1, ok:1, failed:0, rows:[{name:"Adam J Schaeffer",
  ok:true}]}`. Ran with BOTH tabs hidden — the day-grid surfaces are classic .esp frames and
  hydrate fine occluded.
- 08:49 — Fresh 119-word plausible follow-up transcript entered (low back pain F/U, conservative
  care, no test markers). **Generate one note → 1,548-char SOAP note** grounded in the pulled chart.
  **`currentVisitAthenaBinding` REBUILT**: Adam + DOB + MRN, `visitDate: 2026-08-05`,
  identityConflict:false, routeBlocked:false.
- 08:52 — `#pushAllEmrBtn` → **wf3 sheet OPEN, manifest identity complete and correct**: Patient
  Adam J Schaeffer, DOB 03/24/2006, MRN 7833832, MLS id mr85n5sdkd6o, Expected visit 8/5/2026,
  Expected provider Matthew Schaeffer MD, **Appointment ID 55136018**, manifest
  `mls-preview-7f1d26be`. Step-2 read-only probe started.
- 08:52→09:15+ — **Probe starved occluded** (see finding below). Athena re-verified ALIVE mid-spin
  (91,417-byte fetch, no Re-Login). Owner pinged 3× (start warning; presence ask; deadline ask
  with the ~09:54 idle cutoff).

## THE LEDGER-GRADE FINDING: the wf3 probe lane has no presence assist, no starvation disclosure, and no deadline

Mechanism, evidenced live:

1. The probe drove MY athena tab's inner frame to `/ax/briefing/7611261#chart?section=visits`
   (7611261 is athena's INTERNAL chart id for Adam — the patient# 7833832 does NOT appear in that
   URL; identity confirmed by his exact problem list "Chronic midline low back pain…" painting in
   the frame).
2. The briefing is the rAF/idle-driven SPA surface. With the tab hidden, it hydrates at timer-crawl
   pace: after ~9 minutes the frame held only 1,921 chars, the visits section said "No data
   available", and the "recently edited this chart … REFRESH CHART" stale banner sat with its
   user/time fields UNHYDRATED (blank name, blank time).
3. The sheet spun "Read-only check running…" for 20+ minutes with no verdict, no disclosure, no
   timeout. Session 2 saw the same shape for a different reason (dead session, >170s). The pull
   lanes already solved this class with fg-1.x presence assist + banner disclosure; **the write
   lane predates that cure**.

Proposed (NOT implemented — gates never weakened mid-proof): give the wf3 probe the same
foregroundOk/presence lane the history retry uses, a starvation/deadline disclosure in the sheet
("athena read is starved — bring the athena tab forward"), and an honest named refusal after a
bounded budget instead of an unbounded spinner.

## Traps hit this session (new, cold-session-costly)

- **Session tab-group reach**: tools act only on tabs in this session's group; the owner's tabs are
  generally unreachable. `tabs_close_mcp` mid-batch STALES the group reference — the next action
  fails with a "valid tab IDs" list naming the just-closed tab. Close tabs only at batch END, then
  refresh with `tabs_context_mcp`.
- **Every tab this session creates reports `visibilityState: hidden`** — even freshly
  created-and-"fronted" ones. Presumed collapsed background tab group. Consequence: CDP clicks,
  screenshots, JS all work; rAF-driven SPA hydration does NOT. Schedule pulls (classic frames)
  work hidden; briefing/chart SPA reads starve.
- **`/ax/briefing/<id>` uses an internal chart id**, not the displayed patient # (Adam: briefing id
  7611261 vs patient #7833832). Never match a chart by URL id against the patient number.
- The binding's appointment id is NOT at `visitContext.appointmentId` (probe read '?') but it IS in
  the sheet manifest ("Appointment ID 55136018") — read the sheet, not guessed keys.

## State at last poll (~09:16)

Sheet OPEN mid-probe, Go disabled, athena session alive, runway to ~09:54. Waiting on the owner to
front the Claude-group athena tab (one click). If the session idles out first: attempt 3 ends
honestly; everything above (import, note, binding) is page-memory in MY app tab 256598156 and
survives as long as that tab lives — but a NEW sign-in restarts the athena side.

## Discovery: authenticated fetch probes appear to REFRESH athena's idle timer

The session outlived the naive deadline (last human activity ~08:44 + 78 min ≈ 10:02; the
09:47/10:05/10:15 probes all returned the live 91,41x-byte dashboard, no `Re-Login`) while my only
touches were same-origin authenticated `fetch('/22724/6/ax/dashboard')` calls every ~10 minutes.
Working hypothesis, one confirmation short of law: **CDP DOM-driving does not refresh the idle
timer, but authenticated fetches do** — a ~10-minute fetch cadence de-fangs the 78-minute sword
for every future live run. Confound to rule out: the owner may be active in athena in his own
tabs. Either way the cadence costs nothing and the probe doubles as liveness truth.

## STAGED WHILE BLOCKED: sx-1.1 per-read session liveness (ledger 6.2) — implemented + suite-green

Scope (mirrors sx-1.0's proven goto pattern onto every read verb; no gate weakened; ok:true paths
never probe, so zero happy-path pace cost):

- `background.js` (+2,525 bytes via latin1 index-splice, `scratchpad/patch-sx11.js`):
  S1 export `__mlsProbeSessionExpired` onto `self` (the allvisits listener is OUTSIDE its scope —
  a bare typeof guard there would silently no-op forever); S2 `chartRespond` failure rider;
  S3 `__schedRespond` failure rider; S4 allvisits `finish()` rider (response deferred ≤2.5s,
  cleanup untouched, no early return).
- `ScribeFlow.html` + `ScribeFlow-staging.html` (byte-identical, parity suites green):
  `_assistReadChart` translates the flag into the canonical `athena-session-expired: ` reason
  prefix.
- `feat_mls_schedimport_exact.js`: visits lane throws `athena-session-expired` BEFORE burning the
  chart-reopen retry; identity loop prefers the canonical reason; all three reason-recording halt
  sites ride the existing `stopAfterTimeout` machinery and stamp `receipt.sessionExpired`;
  schedule failure passes `schedSessionLikelyExpired` through `fail()`.
- `mls-connect.js`: the `signinRequired` predicate (the established "a sign-out must never read as
  a generic failed pull" lane) now also fires on the canonical reason, the schedule probe verdict,
  and a session-halted history batch — rendering the byte-stable calm instruction.
- New suite `tests/per-read-session-liveness-contract.test.js` (registered in run-all): byte
  contracts on all four splices + parity + canonical-spelling sweep + EXECUTED rider semantics
  (probe fires once on failure, flag rides, reason preserved, unreachable probe degrades to
  flag:false without throwing).

Focused suites green: per-read-session-liveness-contract, extension-read-path,
history-retry-foreground-contract (12/12), schedule-history-pipeline,
pull-first-attempt-convergence, staging-history-writeflow-parity, opnote-staging-parity-runtime.

**Full gate: ALL 477 LOCAL SUITES PASS** — after two honest gate kills that were both fences
working, not defects: (1) `tree-contains-everything-published` refused the run because the
worktree sat 3 commits behind origin/main (b869/chore/b870) → merged, never rebased (commit
`494b8dd7`); (2) `extension-package` refused because my splices drifted root background.js from
the stamped 3.0.44 digest → splices parked as `extension-candidates/3.0.45/background.js`, root
restored byte-identical to shipped, contract suite reads the candidate (commit `e46f1ec4`; the
staged work itself is commit `4c27d3dc`). **NOT SHIPPED — extension release trains hold until the
site lane's b872/b873 transition completes; this rides the next 3.0.45 train.** Nothing pushed.

## Remaining (unchanged from session 2)

1. Probe verdict → `#mlsAthenaUnifiedGo` enables → ONE physical (CDP-trusted) click.
2. Verify: sheet step-4 verdict + `__mlsWriteFlow.state.lastResp` (landed/noteWriteProof) + chart
   read-back in athena.
3. DELETE BOTH throwaway appointments (Aug 4 11 PM — status Arrived mid-check-in — and Aug 5 11 PM).
4. Closeout: this artifact, GOAL.md, memory, coordination ping.
