# 3.0.119 exact-row recovery candidate — 2026-09-12

Status: locally tested, built, and staged only. Not installed, reloaded, or published. No live Athena write was performed. The enabled 3.0.117 and the prior 3.0.118 staging directories were not changed.

## Why this change exists

The owner reported a completed 3-row pull with zero histories and each row labeled “not on the athenaOne schedule.” That label is not a schedule-membership receipt: the site maps the generic `open-failed` code to that sentence. The legacy site's `pullOne` also discards the opener's actual reason. No site file was changed here; the site owner is handling those issues.

Three extension defects/gaps were reproduced against actual shipped functions:

1. The staged 3.0.117 opener and initial 3.0.118 opener were byte-identical. Their exact-ID row finder accepted the existing punctuation-folded match, but 3.0.117's last-second literal-name recheck rejected that same unchanged row. A synthetic `Jane O'Example` / `OExample, Jane` exact-ID fixture returned `row-identity-changed`, one matching appointment, zero clicks. The new runtime test failed before the fix.
2. A detached/recycled exact row was refused, correctly, but never re-enumerated. A fresh replacement carrying the same exact appointment could not recover the request.
3. Ordinary MRN-backed reads try Find Patient first. `no-results`, `no-name-match`, rendering failures, and a failed search-field readback returned before the already-known exact appointment/date could be tried. The actual worker fixture with both exact fields returned `findReason: no-results` before the fix.

These source reproductions explain real failure mechanisms, but do not establish which raw refusal the owner's three screenshot rows hit. Their original detailed per-row receipts were not supplied to this extension audit. In particular, the screenshot does not prove missing schedule IDs, providers, or dates.

## Recovery and safety contract

- Selection and final click use one shared name-echo rule. Punctuation folding is allowed only for an independently exact-ID-bound row, as it was before the regression.
- Before clicking, the row must still be connected, still carry the expected name, and still be the unique current exact-ID row. The check runs again after scrolling and immediately before click. A changed node is never clicked.
- An exact-ID row can rebind at most twice, with short hidden-tab-safe settles, under the original absolute deadline. There is no name-only rebind fallback.
- A transient Find refusal can fall back only when both exact appointment ID and exact schedule date were supplied. Athena is re-grounded to that date, and a verified conflicting date causes refusal. The row then needs the existing appointment navigation proof. Real ambiguous-search/DOB-mismatch refusals stay terminal.
- A bootstrap row miss/churn can restore the same day and re-enumerate once. No retry follows deadline expiry, nonclinical targets, or ambiguous appointment IDs.
- An ordinary recovered history read remains a full chart read. `bootstrapIdentity` is not enabled on that follow-up: bootstrap is an identity-only protocol. The content bridge and worker validate the recovered appointment's request/date/tab/frame lease, while the existing normal name/DOB/MRN capture and save gates remain unchanged.
- Failure reason/route values cross the chart bridge only through a closed vocabulary. Diagnostics add bounded `rowRebinds`, `scheduleRegrounds`, `scheduleDateVerified`, and `exactScheduleFallback`. Arbitrary name/MRN-bearing strings cannot become diagnostic codes.
- No new reload, login, write, signing, billing, or ordering action was added.

## Local verification

31 focused suites passed on the final candidate: exact-row recovery; chart-failure diagnostics; appointment bootstrap; manual exact-open/MRN; same-tab history; final-patient deadlines; schedule-scrape deadlines; ax census/terminal; full-visit reader; cleanup serialization; Full Notes choice; day-pull convergence; single-pull accounting; native persistence runtime (123 checks); native proof contract; Slate reader; active surface; session preservation; busy keep-alive; session health; draft-only execution (98 checks); closed legacy executor (28 checks); extension read path; tab resilience; hidden-safe sleeps; orphan neutralization; packaged schedule reader; row demographics; adversarial schedule identity; own-day/future note (102 checks); resume/scope/cost (291 checks).

The two new extension runtime suites and four previously unregistered extension write-proof suites are registered in `tests/run-all.js`. Syntax checks, digest verification, and `git diff --check` passed. The entire shared site+extension regression gate was not run in this extension worktree. Registry planning still reports two pre-existing site-only omissions (`1p-pullpill-first-runtime.test.js` and `settings-modal-never-opens-unattended.test.js`), left to the site owner rather than changing site scope here.

The schedule receipt reader remains byte-identical to staged 3.0.117 (SHA256 `556eb8f451c2a87f85a739f26cc9412129a58bf05a09844eb6bd7ac4dc6edb3e`). Native write-driver source and write guards also remain byte-identical to that version. The existing own-day test prints an old site-side duplicate-read warning; it is not a new extension finding and must not override the newer independently audited site source.

## Package identity

- Version: `3.0.119`
- Core: `3.0.119+core-sha256:15ebd690e89b18e70df5e61cda380e93942a63791fc49ac97b1b6f54a7aa441a`
- ZIP: `MLS_Assist_v3.0.119.zip`
- ZIP SHA256: `a0d75dd0d29e51eacef2fc03d8ff3d7d148b4be757963536e2d03d1966f6a7b8`
- Stage: `extension-staging/MLS_Assist_v3.0.119`
- Two independent builds have the same ZIP hash; all 20 source/ZIP/stage files match exactly.
- Prior ZIP hashes remain unchanged: 3.0.117 `c9613f3d089e37f1fafff7c805917a563cf147628fb51e5baf7a8769a057141b`; 3.0.118 `c604b3c27b9555b4e1b099e8e2e123aee2253788de27c56589114f6bc86ae103`.

## Next authorized read-only acceptance run

After the owner confirms loading/reloading this exact candidate, verify the live version+core digest before retrying. Preserve the signed-in Athena tab. Record exact requested appointment IDs and day, matched schedule rows, per-chart opener route/recovery counters and closed refusal codes, and the terminal overall result.

Full Notes ON still requires the retained 3.0.118 census fix: every known expected encounter ID is either read successfully or accounted for as failed/not-attempted. An ax fallback cannot shrink a six-encounter census to a green four-of-four result. Only a zero-gap final census is complete; retry counts and terminal receipts must reconcile by exact IDs, not by adding overlapping subjob counts.

For every scheduled chart, separately prove the pulled day's own note outcome and the next appointment's available scheduling note/reason/context used by op notes. A future clinical encounter note that does not exist yet must be explicitly not-yet-available, never substituted with an older visit. The candidate is not accepted as “reads/writes perfectly” until these live outcomes are proved. Live clinical writes still require separate action-time confirmation for an explicitly authorized dummy chart and exact action/text.
