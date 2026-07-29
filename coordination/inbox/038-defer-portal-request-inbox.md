# P1 proposal: defer the self-healing Portal Request Inbox

## Measured problem

The exact committed release candidate `0923b770d28b0497c495ddf815cbf212fcd4d33d`
still contains 130 explicit `async=false` feature/core satellite loaders totaling
3,537,038 committed bytes (3,454.1 KiB). The population-level boot detector
reports 196 eager and 49 deferred feature scripts.

One remaining loader has no sign-in dependency:

- `mls-connect.js:46806` synchronously inserts
  `feat_mls_portal_request_inbox.js?v=20260717prq102`.
- The satellite is 16,372 committed bytes.
- Its eager top level at `feat_mls_portal_request_inbox.js:255-277` inserts one
  style, registers three window listeners, and schedules six timeout-driven
  button scans at 0, 160, 420, 900, 1,800, and 3,200 ms.
- `tests/portal-request-reliability-runtime.test.js:137` proves the module makes
  no network request before a clinician explicitly opens it.
- An exact production grep excluding the satellite finds no caller of
  `window.__mlsPortalRequestInbox` and no consumer of
  `#mlsPortalRequestInboxBtn`. The satellite owns its button and its click
  handler itself.
- Load-order recovery is explicit: after registering for
  `mls:ui-ready`, `mls:topbar-ready`, and `mls:header-rendered`, lines 276-277
  call `scheduleEnsure()` even when all of those events occurred before the
  satellite loaded. A late evaluation therefore still mounts the action and
  retries for 3.2 seconds.

Reproducible probes:

```text
git cat-file -s 0923b770:feat_mls_portal_request_inbox.js
git grep -n -E "__mlsPortalRequestInbox|mlsPortalRequestInboxBtn" 0923b770 -- "*.js" "*.html"
git show 0923b770:feat_mls_portal_request_inbox.js
node tests/boot-script-budget.test.js
```

An in-memory exact-loader substitution measured the detector at 195 eager and
50 deferred, with exactly one asset name and exactly one
`20260717prq102` token remaining.

## Proposed change

- Wrap only the Portal Request Inbox loader in the established
  `requestIdleCallback` pattern, with the 900 ms timer fallback and 2,500 ms
  idle timeout.
- Change only that dynamic script insertion from `async=false` to `async=true`.
- Keep `feat_mls_portal_request_inbox.js` unchanged. Its immutable token remains
  `20260717prq102`; advancing it would be incorrect because the satellite bytes
  do not change.
- Move the exact portal-loader prefix used as the end anchor in
  `tests/cross-day-appointment-context-runtime.test.js`.
- Add the asset to exact deferred coverage in
  `tests/late-surfaces-stay-deferred.test.js`.
- Lock the measured boot result by changing the eager ceiling from 196 to 195
  and its 20-script floor from 176 to 175.

`mls-connect.js` is read and written with `latin1`; all three tests use UTF-8.
Every replacement is exact and single-occurrence, ambiguity is a hard failure,
and all four complete outputs are computed before any file is written.

## Expected effect

- Move one serialized 16,372-byte compile/evaluation out of the synchronized
  sign-in burst.
- Move one style insertion, three event-listener registrations, and at least
  six timer/button scans out of sign-in.
- Reduce the explicit `async=false` train from 130 to 129 assets and its raw
  bytes from 3,537,038 to 3,520,666.
- Reduce the boot detector from 196 eager / 49 deferred to
  195 eager / 50 deferred.
- Preserve request URLs, clinician-review behavior, exact-patient matching,
  ambiguity refusal, and the rule that no portal request is fetched until the
  clinician opens the review surface.

This is a scheduling-only performance change. It does not edit Menu or dialog
markup, styling, patient matching, review behavior, the backend, or the
extension. Its only intended observable difference is when the unchanged
Portal requests action becomes available.

## Risks and release checks

The Portal requests Menu action can be absent until the browser gives the idle
callback main-thread time. The previously measured cold optional tail reached
16.3 seconds, so the 2,500 ms timeout is not a wall-clock guarantee while the
main thread is blocked. The module self-heals after it evaluates, but a
clinician who opens Menu immediately after reveal may need to reopen it after
the idle tail. Reject this proposal if that late-surface tradeoff is not
acceptable.

After release, verify in real Google Chrome with a dedicated synthetic QA
account only:

1. Hard-reload in the foreground and confirm sign-in becomes interactive
   without the portal satellite in the synchronized loader wave.
2. Open Menu at the earliest interactive moment and again after the idle tail;
   Portal requests must appear exactly once and remain immediately before
   Settings.
3. Confirm no portal-review fetch occurs before explicit open.
4. Open the review surface, verify one uniquely linked synthetic patient opens
   the correct synthetic chart, and verify an ambiguous synthetic identity
   exposes no chart action.
5. Mark one synthetic request reviewed and confirm no Athena, extension, pull,
   prescription, or pharmacy action occurs.
6. Trigger a same-document backend refresh and a topbar remount; verify one
   script, one style, and one Menu action remain.
7. Run repeated warm reloads and a long-session soak, checking that the portal
   action and loader do not duplicate.

Run the focused contracts below, then the full release gate:

```text
node tests/boot-script-budget.test.js
node tests/late-surfaces-stay-deferred.test.js
node tests/cross-day-appointment-context-runtime.test.js
node tests/portal-request-reliability-runtime.test.js
node tests/run-all.js
```

No tracked source, Git state, browser, extension, or live site is changed by
this proposal.
