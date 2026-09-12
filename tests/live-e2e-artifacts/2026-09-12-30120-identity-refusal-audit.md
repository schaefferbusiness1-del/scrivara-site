# MLS Assist 3.0.120 candidate audit — 2026-09-12

Status: corrected, locally tested, packaged, and staged only. No extension install/reload, publication, live chart access, or clinical write occurred.

## Release blocker corrected

Do not publish 3.0.119. Its SearchOpen worker retained an older blank-DOB retry: Find Patient returning `dob-mismatch`, `count: 1`, and `tier: exact` caused another Find call with the requested DOB removed. A synthetic fixture that opens the conflicting-DOB result only on that second call reproduced `ok: true`, `opened: true`, and `dobOverride: true` on the original candidate.

3.0.120 removes that entire bypass. The same fixture now returns `dob-mismatch`, makes exactly one Find call with the original DOB, and makes no schedule-row call. Safe exact-appointment/date recovery for transient Find failures remains intact. The previously added 3.0.119 test used count zero and did not exercise this real refusal shape.

The MRN contract now inspects every remaining Find call (ordinary and compound-name) for both frozen MRN and original DOB, instead of requiring three call sites including the unsafe branch. The nonclinical-route contract now recognizes the shared exact-row name check introduced in 3.0.119; its browser checks still prove zero clicks on management/reschedule rows and successful exact React-row navigation.

## Verification

29 focused suites passed:

- Identity/recovery: exact-row-recovery-runtime; chart-open-failure-diagnostics-contract; schedule-identity-adversarial-runtime; appointment-id-bootstrap-contract; manual-history-exact-open-mrn-contract; appointment-nonclinical-route-guard; schedule-row-demographics-adversarial; visit-body-identity-302-contract; visit-wire-identity-guard-runtime.
- Completeness and deadlines: ax-history-census-terminal-runtime; full-visit-reader-runtime; background-all-visits-cleanup-serialization; extension-read-path; history-preopened-same-tab-contract; schedule-scrape-deadline-searchopen-runtime; chart-request-deadline-runtime; background-final-patient-timeout-runtime; 1p-copy-all-visits-full-text; 1p-fullhistory-pdf-idle-runtime.
- Day context/activity: 1p-day-note-day-and-future-runtime (102 checks); cross-day-appointment-context-runtime; full-visit-notes-choice-gates-runtime; 1p-progress-honesty-contract (91 checks); 1p-long-read-progress (46 checks); template-match-real-schedule-text; patient-banner-minimal-contract; athena-session-preservation-contract; ext-3063-athena-tab-resilience-contract.
- Packaging: extension-package, including two deterministic builds, all 20 root entries and source-byte parity, ZIP/BIN mirror equality, manifest closure, and all packaged JavaScript syntax.

Core digest verification, separate staging/source closure comparison, and `git diff --check` passed. Browser tests used the existing site worktree's Playwright dependency through NODE_PATH and ran synthetic local pages only. The complete shared site+extension test gate was not run here.

The own-day/future test retains an existing warning about a legacy site duplicate-read lane; this extension change does not alter that site lane. Full Notes ON retains the 3.0.118 census correction: known expected encounters cannot shrink to the successfully read subset. A future clinical encounter is explicitly unavailable rather than replaced with a historical note. Scheduling reason/type is retained by the row reader and site importer and used by the template matcher; no live proof of a particular next appointment's complete scheduling note was attempted, so this audit does not claim that outcome.

## Package identity

- Manifest version: `3.0.120`
- Core SHA256: `14d16e7cd595153af07a30b3cf77a070a811aed9cb33ce15c9cb09c277a0d4ce`
- ZIP and BIN: `MLS_Assist_v3.0.120.zip`, `MLS_Assist_v3.0.120.bin`
- ZIP/BIN SHA256: `ebb8518fb4265928fa8d54f76b35e408e3fc09b2124e64f038c6ccb47f017344`
- Clean stage: `extension-staging/MLS_Assist_v3.0.120`
- Prior 3.0.119 ZIP remains unchanged: `a0d75dd0d29e51eacef2fc03d8ff3d7d148b4be757963536e2d03d1966f6a7b8`; it is superseded and must not be published.

Only the source manifest carries the new version; published-channel metadata remains at its existing stable release because this is an isolated candidate. The final source commit and tree are reported with the handoff, avoiding a self-referential commit hash in this file.

Verdict: 3.0.120 clears the reproduced extension release blocker under the local synthetic checks. Publication must use these exact corrected bytes. No live-read or live-write acceptance claim is made.
