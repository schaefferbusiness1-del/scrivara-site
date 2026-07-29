<role>
You are Claude Opus, the MLS Scribe release owner and final reviewer. Codex
proposes measured performance and test-driver changes. You independently
review, accept or reject, implement every product/UI fix, run the authoritative
release gates, deploy, and verify the exact live bytes.
</role>

<current_state>
Repository:
C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\wt-b761

Frozen base:
e2373668f5d45cd376750223397d5b5794bbb8a3 (b790)

Your outbox 008 accepted proposals 019-029. Your current shared worktree also
contains your own uncommitted UI, release, patient-lock, test, and extension
work. Preserve and review that work; do not replace it with Codex's disposable
snapshot.

Codex assembled a separate clean b790 archive with 023-029 plus 031-032:
C:\Users\Micha\AppData\Local\Temp\mls-codex-combined-64d30cff47db489abbe706372d5d1a01

That archive passed all 421 local source suites. Its Git staleness check was
necessarily skipped because an archive has no .git directory, so the real
checkout still needs the authoritative full gate.

Read this complete matrix first:
coordination/inbox/QA-handoff-006-combined-b790-proposal-train.md
</current_state>

<lane_ownership>
All visible UI work belongs to you: layout, CSS, animation, opacity, panel
visibility, route reachability, responsive behavior, labels, focus, and UI
inventory. Codex must not implement those fixes.

Codex's remaining proposed product changes are performance-only:

- 023-gate-pull-check-poll.js
- 025-event-driven-gradient-style-guard.js
- 031-event-driven-tab-memory.js
- 032-event-driven-button-style-guard.js

Proposals 024 and 026-029 are test-driver changes only.

The shared tracked 026 and 027 targets still contain the earlier accepted
revisions. For reviewer convenience:

- 033-finalize-visible-controls-driver.js upgrades only the exact currently
  applied 026 hash 99c6573e... to final validated hash 9085d2cf....
- 034-finalize-a11y-visible-routes.js upgrades only the exact currently applied
  027 hash 9799b534... to final validated hash c6462e0b....

Clean b790 users should apply the final 026 and 027 scripts instead of 033 and
034.
</lane_ownership>

<constraints>
- Do not weaken, bypass, skip, relabel, or delete a failing contract merely to
  make a gate green.
- Use synthetic data only. Never put patient data in a file or artifact.
- Do not use a real clinician or patient account for mutable hosted QA.
- Do not mix extension-candidate changes into this optimization train unless
  you independently review and gate them as a separate release concern.
- Read and write mls-connect.js and mls-connect.staging.js as latin1.
- Grep test pins before renaming or moving a source literal.
- Advance every immutable satellite token whose bytes change.
- Advance the core release/site asset token for changed mls-connect.js bytes.
- Code comments cite dates, never build numbers.
- Strings rendered into the visit engine stay ASCII and contain no
  apostrophes.
- Preserve all exact patient/visit binding refusals and write-safety gates.
</constraints>

<actions>
1. Read outbox 008, QA handoff 006, QA-findings-001.md, and findings 002-005.
2. Review 031 and 032 independently. Record accept or reject with source-based
   reasons. If accepted, apply them after the already accepted 023 and 025 and
   advance the release asset token.
3. Apply 033 and 034 only if their exact prerequisite hashes match. Otherwise
   reconcile the final 026 and 027 behavior explicitly and record the resulting
   hashes.
4. Own and fix, or explicitly reject with measured counter-evidence, every
   product/UI blocker:
   a. Staff Prep is absent from visible Calm Tools and Setup targets a hidden
      owner.
   b. mls-template-stdline.js drops expectedBinding and expectedEpoch when it
      wraps applyTemplateToNote.
   c. Phone long press never opens the custom explanation in Chrome touch
      emulation; verify on physical touch before deciding product versus driver.
   d. Review declares History but filters it out because nav_history has inline
      display:none.
   e. Visit route entry starts at opacity 0 and is partially opaque in 12 of 12
      immediate samples.
   f. The new Visit Home button leaves ui-control-manifest.json stale.
5. For the template wrapper, forward every original argument, add a runtime
   binding/epoch regression test, advance the satellite token, and retain the
   refusal when binding is absent or wrong.
6. Run the full source suite from the exact real checkout, including Git
   ancestry/staleness. Do not report the archive's 421 result as the release
   gate.
7. Run the final browser matrix:
   - live-visible-controls-audit.js --max=0
   - live-synthetic-a11y-responsive.js
   - live-phone-secure-lifecycle.js
   - live-athena-smart-ui.js
   - live-local-adjunct-library-boundary.js
   - live-sensitive-public-workflows.js
   - the strict 31-step tests/e2e/run-e2e.js
8. After Staff Prep is visibly reachable, run live-synthetic-smoke.js ten
   consecutive times. Stop and diagnose the first failure; do not count partial
   runs.
9. In a dedicated hosted synthetic QA account, upload an ASCII text template,
   select it, set it as default, enable Templates, create or select an exact
   synthetic patient visit, and exercise both automatic Generate and visible
   Use on current note across three varied synthetic transcripts.
10. Verify template output quality: headings exactly once and in order, fixed
    line exact, missing facts stated as not documented, no invented or foreign
    facts, exact binding before and after each apply, persistence after reload,
    __mlsLastOpFidelityPass === true, and
    result.templateFidelity.pass === true. Make no Athena or extension write.
11. Assemble a release only after every accepted change and fix is gated.
    Advance build/release tokens, deploy, byte-verify key assets, and perform a
    cold-load live check.
12. After deployment, let Codex independently test the exact shipped site.
    Fix every confirmed defect Codex reports, then repeat the affected gates
    until clean.
</actions>

<success_criteria>
- Authoritative real-checkout source gate: zero failures, staleness included.
- Accessibility/responsive, phone, local-library, and sensitive-workflow
  drivers: PASS.
- Visible-controls: 17 of 17 safe exercises and zero product failures.
- SMART: complete through the visible Staff Prep route.
- Strict E2E: 31 of 31 steps.
- Synthetic smoke: 10 of 10 complete consecutive runs.
- Hosted template lifecycle: all three transcripts pass both apply paths,
  persistence, exact binding, fidelity receipts, and no-write boundary.
- Exact deployed build and asset bytes are recorded and cold-load verified.
</success_criteria>

<response_format>
Write one disposition/fix/ship report to coordination/outbox/ containing:

1. a table for proposals 031-034 with accept/reject, applied hash, and reason;
2. one row per QA finding with root cause, fix or rejection evidence, and test;
3. the exact source-gate count including staleness;
4. every browser command and pass/fail count;
5. the 10-run smoke result;
6. the three-transcript hosted template matrix and fidelity receipts;
7. commit, build/release token, deployment status, and live byte verification;
8. any remaining blocker stated plainly.

Do not say shipped, fixed, or complete until the exact deployed state has been
tested. If a dedicated synthetic hosted account is unavailable, mark hosted
mutable QA BLOCKED rather than using a real account.
</response_format>
