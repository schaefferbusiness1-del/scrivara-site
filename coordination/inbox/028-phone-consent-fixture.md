# 028 - Exercise real encounter consent in the secure phone lifecycle

## Measured problem

The unmodified synthetic phone lifecycle failed 0/1 on frozen HEAD
`e2373668f5d45cd376750223397d5b5794bbb8a3`. It ran for about 19.8 seconds
and stopped at `tests/live-phone-secure-lifecycle.js:263`:

`Timed out waiting for trusted production phone handoff; last=false`

The source path explains why the fixture cannot reach `/api/mic/start`:

- `tests/live-phone-secure-lifecycle.js:220-243` stubs the backend,
  exact-appointment gate, and Athena binding, but creates no active patient
  and confirms no encounter consent.
- `ScribeFlow.html:18827-18836` checks trusted input, the exact appointment,
  backend mode, Athena readiness, and then requires real encounter consent
  before the fetch at line 18845.
- `ScribeFlow.html:8840-8844` makes the exported consent request fail closed
  when `activePatient()` has no patient.

The programmatic and denied exact-appointment probes correctly make no backend
request. On the final allowed click, the missing active patient makes the real
consent request return false, so the expected handoff can never be generated.
The rest of the phone-page lifecycle is consequently untested.

This is a stale test fixture, not evidence that the production consent gate
should be weakened.

The repository already defines a legitimate test path:

- `tests/e2e/run-e2e.js:171-182` creates a synthetic patient with
  `getPatients()`, `savePatients()`, and `setActivePtId()`.
- `tests/e2e/run-e2e.js:360-396` calls the exported
  `_mlsRequestEncounterConsent()` contract, operates the real consent dialog,
  awaits its result, and checks the durable audit record.
- Exact searches confirmed each proposed phone-harness anchor occurs once and
  is not pinned elsewhere.

## Change

Change only `tests/live-phone-secure-lifecycle.js`.

- Create one ASCII-only synthetic patient in the isolated browser profile
  through the same public patient-store functions used by the main E2E.
- Bind the fixture to a synthetic appointment identifier so consent has a
  deterministic patient and encounter owner.
- After proving that a denied exact-appointment gate cannot contact the
  backend, call the real exported consent request.
- Wait for the real dialog, select `patient-verbal`, confirm it, await the
  production promise, and verify the resulting patient, encounter, consent
  type, and audit record.
- Prove that confirming consent alone does not contact `/api/mic/start`, then
  perform the trusted phone click and continue the existing lifecycle.

The proposal never writes `_mlsConsentCurrent`, replaces a consent function,
or bypasses a production check. No product, UI, live-site, extension,
manifest, satellite, or immutable loader bytes change.

## Expected effect

The lifecycle reaches the trusted phone handoff through the production consent
contract and then executes all existing fragment, local-QR, recorder upload,
volatile retry, URL scrubbing, legacy-query refusal, and cleanup assertions.

Production consent remains fail closed. A regression in patient ownership,
dialog completion, audit persistence, encounter ownership, or backend ordering
will fail the test before pairing.

## Risks

Low and test-only.

- The test deliberately depends on the exported consent hooks and dialog IDs
  that are already covered by repository contract tests. A legitimate contract
  change will require this lifecycle fixture to change with those pins.
- The real patient and consent stores are used only inside the harness fresh,
  isolated Chrome profile. All identifiers and content are explicitly
  synthetic; no patient data is present.
- The proposal uses guarded single-occurrence replacements and an atomic
  same-directory rename. Missing or duplicate anchors fail before target
  write.

## Scratch verification

Validation used a disposable archive of frozen HEAD under:

`C:\Users\Micha\AppData\Local\Temp\mls-028-phone-consent-a37dc7550eb545d292772acf001585df`

- Proposal script syntax: pass.
- First application: pass.
- Original target SHA-256:
  `e86060e2f66d2520dac00ffa8a526dfb84e2c10073af2ff290932b18a8558565`
- Patched target SHA-256:
  `225738ec1f9a2ec8a3d9f445b1fe44704074a1512148cf9b638b88fefb4dff27`
- Patched target syntax: pass.
- Temporary atomic-write files left behind: zero.
- Actual isolated Chrome lifecycle: pass in about 6.9 seconds.
- Result: `ok=true`, `syntheticOnly=true`, `productionContacted=false`,
  programmatic pairing refused, denied exact gate refused, trusted pairing
  started, fragment handoff used, and QR rendered locally.
- Report:
  `C:\Users\Micha\AppData\Local\Temp\mls-028-phone-consent-a37dc7550eb545d292772acf001585df\repo\tests\live-phone-artifacts\2026-07-29T17-14-54-555Z\report.json`
- Report SHA-256:
  `deaea00110a30c5a7ab2b4ab13e5640229af7f4247cee6658b125b84214e69df`
- Second application: refused with exit 1 because the original guarded anchor
  was absent.
- Hash after refused second application:
  `225738ec1f9a2ec8a3d9f445b1fe44704074a1512148cf9b638b88fefb4dff27`
  (unchanged).
