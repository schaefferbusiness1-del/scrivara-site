# 042 — Lifecycle-safe event-driven active-patient field sync

Base reviewed: `b5cdff00371ceb0af07ba2a88b02b06292b7322b` (b792).

## Measured problem

- `feat_mls_active_patient_sync.js:29-63` calls `activePatient()` every 400 ms even when the active patient is unchanged.
- `ScribeFlow.html:9543` implements `activePatient()` with `getPatients().find(...)`, and `ScribeFlow.html:9203-9211` makes a shallow roster copy on every `getPatients()` call.
- A reproducible Node VM probe using 1,524 synthetic roster entries with the active entry last measured 9,000 callbacks, 9,000 roster reads, and 13,716,000 copied/reference comparisons per hour. Five runs averaged 76.587 ms of Node CPU per hour; this excludes browser scheduling, storage decoding, and main-thread wake-up cost.
- Repository search at the reviewed commit found only two direct active-patient storage writers outside preview/test fixtures: the production setter at `ScribeFlow.html:9533-9541` and staging setter at `ScribeFlow-staging.html:6924`.
- The production setter already emits `mls:active-patient-changed` after storage adopts the new ID. Staging did not emit the event.
- A first synchronous event-hook design was rejected during independent review because caller lifecycle order matters:
  - production `__mlsOpenSwitchFix` calls the setter, then runs `newVisit()` in its `finally` path (`mls-connect.js:16803-16819`);
  - `newVisit()` clears both visit labels (`ScribeFlow.html:16810-16811`);
  - `ptQuickVisit()` also calls the setter before `goNewVisitForPatient()` in production and staging (`ScribeFlow.html:14737`, `ScribeFlow-staging.html:10884`).
  A synchronous handler would therefore write too early and have its result erased.
- Production and staging immutable satellite loaders used different retired tokens at `mls-connect.js:42050` and `mls-connect.staging.js:4682`.

## Proposed change

- Make `feat_mls_active_patient_sync.js` react to:
  - canonical `mls:active-patient-changed` events;
  - `mls:session-boundary` for warm account/session changes; and
  - `storage` events only when `event.key` exactly equals the current `uns('activePt')`.
- Coalesce those signals into one zero-delay task. The task reads the final active patient only after the switching call stack has finished, so downstream `newVisit()` resets cannot erase the result.
- Retain one 15-second compatibility/name-refresh backstop for same-ID renames, late cross-tab roster arrival, and noncanonical callers.
- If either visit-label field is actively being typed in, update the other field but leave the focused field untouched. Keep that field pending and reconcile it on its real captured `focusout`; do not rely on a fabricated same-tab storage event.
- Preserve clear-patient behavior: clearing the active patient does not itself blank visit labels. Existing explicit new-unassigned-visit flows may still clear them through their own `newVisit()`.
- Remove the patient, session, storage, and focusout listeners; interval; and any queued timeout in `window.__mlsActivePtSync.revert()`.
- Give the staging setter the same changed-only, write-before-dispatch event contract as production. Production remains byte-for-byte unchanged because it already owns that contract.
- Advance both immutable loader URLs to `20260729aps2`, move production and staging test pins, and add runtime coverage to the existing interaction-performance contract.
- The patch script reads and writes both connectors as `latin1`, computes all six outputs before writing, and rejects missing, repeated, or already-applied anchors.

## Expected effect

- Idle/backstop callbacks fall from 9,000 to 240 per hour per tab, a 97.3% reduction.
- At 1,524 roster entries, worst-case idle roster references fall from 13,716,000 to 365,760 per hour.
- Normal patient switches converge on the next task after all synchronous reset owners finish, rather than waiting up to 400 ms or being overwritten by a later reset.
- Rapid switch signals create at most one pending task and converge on the final patient.
- Warm session switches no longer wait for the 15-second compatibility backstop.

## Contract coverage

The added VM contract uses synthetic identifiers only and checks:

- initial seed performs no write;
- actual duplicate IIFE evaluation installs one patient listener, one session listener, one storage listener, one focusout listener, and one interval;
- setter event followed by an exact downstream `newVisit`-style clear still converges both fields after the queued task;
- rapid switches coalesce and land the final patient;
- session-boundary dispatch followed by same-stack reset converges in the new account namespace;
- old-account storage is ignored and current-account storage is accepted;
- active typing protects the focused field, then a real focusout reconciles it;
- same-ID rename is picked up by the 15-second backstop;
- clear-patient behavior;
- revert removes all listeners, the interval, and pending work and prevents later writes;
- production and staging setters both suppress same-ID events, write before dispatch, emit switch and clear events, and do not recurse; and
- production/staging immutable loader tokens advance together while retired tokens become unreachable.

## Exact-base proposal validation

Validation uses fresh disposable archives from the exact reviewed commit; no tracked workspace file is changed.

- `node --check` passes for the proposal script.
- Independent application changes the intended six files.
- The revised `interaction-performance-contract.test.js` and `immutable-satellite-loader-cache-contract.test.js` pass.
- The existing focused confirmed-billing and scoped-lifecycle contracts also pass in the patched archive.
- A second application exits nonzero and leaves all six target SHA-256 hashes unchanged.
- Applying 042 then 043 and 043 then 042 in separate exact-base archives produces identical final bytes. The combined target SHA-256 hashes are:
  - `feat_mls_active_patient_sync.js`: `71D61C58FE50B23CF72899A4F8B072145A58BD4413E4BA0FF9EB81577E238E98`
  - `ScribeFlow-staging.html`: `DA85B87A5A2657573915071CA997A0318E6DA25E96A77B897A8384AE23134EC5`
  - `mls-connect.js`: `2CD6D0DB2601B9D48819F0D5BDF54D3C363F4C3EB05A7531AC1BC129BEF68C5C`
  - `mls-connect.staging.js`: `C032543FC358C1A6C7165CE004B5C7B1526D6C6888920AAE3566134C5426A9B8`
  - `tests/immutable-satellite-loader-cache-contract.test.js`: `C2FD5925BB33AB64FABD084B98A9C1D417958F631A4C0ACE726DF3728EC40F1A`
  - `tests/interaction-performance-contract.test.js`: `9F3F3AC97736352388CD573D857106FDC032F548CB50FE9B8E0A745B67079738`

## Risks and reviewer gates

- Setter-driven field convergence moves from synchronous-in-handler to the next task. That intentional delay is normally below one frame and is required to land after `newVisit()` owners.
- A field actively being edited is reconciled only on focusout. This protects the current keystroke while preventing a permanently stale patient label.
- A caller that mutates the active storage key without the setter in the same tab relies on the 15-second backstop. Exact-source search found no such production caller at the reviewed commit.
- Same-ID name edits can take up to 15 seconds to reach visit labels.
- `focusout` is captured on `document`; Claude should verify keyboard switching while each field is focused, blur afterward, and confirm one final reconciliation with no keystroke loss.
- Claude should run the complete 424-test gate and live signed-in Chrome verification before shipping. Live checks should cover every switch entry point, rapid switching, warm account re-entry, cross-tab switching, same-ID rename, typing protection, clear patient, and revert diagnostics.
