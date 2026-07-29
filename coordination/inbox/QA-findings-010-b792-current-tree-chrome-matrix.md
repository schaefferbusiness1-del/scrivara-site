# QA finding 010 - b792 current-tree Chrome matrix

Date: 2026-07-29

## Scope and safety boundary

This is the deduplicated response to `coordination/outbox/009-joint-defect-sweep.md`.

- Browser: installed Google Chrome `151.0.7922.48` at
  `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Source base: `b5cdff00371ceb0af07ba2a88b02b06292b7322b` (`b792`) plus
  the two exact Opus-owned tracked working-tree files copied into a stable
  disposable snapshot before Chrome launched.
- Snapshot:
  `C:\Users\Micha\AppData\Local\Temp\mls-current-tree-chrome-20260729-a91e2f`
- Snapshot `mls-connect.js` SHA-256:
  `80F5CD916EDFABE3E167E9B4CE6B156421AC7F5FDD4DF1CBE2285A63BE798125`
- Snapshot `tests/schedule-mutating-row-reverify-contract.test.js` SHA-256:
  `1761C7A609D3300BBDAA0072CA1FB62ECCEE3714743D6F19FF9647F9A8A65974`
- Both source hashes were checked before copying, after copying, and in the
  snapshot. They were stable and equal.
- All four drivers used a fresh isolated profile, loopback-only synthetic
  fixtures, blocked external hosts, and disabled extensions. No production
  site, real account, real patient data, Athena write, or extension was used.
- This is current-tree localhost evidence. It is not deployment or live-site
  proof.

## Result matrix

| Driver | Result | Exact outcome |
| --- | --- | --- |
| `tests/live-synthetic-smoke.js --runs=10` | FAIL in cycle 1 | Signup/login, date and account-boundary checks, synthetic patient/note save, hard reload, History persistence, and saved-note reopen passed. Setup then failed to expose the Staff Prep action through a visible Menu route. |
| `tests/live-visible-controls-audit.js` | HARNESS-FAIL | Timed out waiting for a visible History segment before it could inventory the remaining routes. |
| `tests/live-synthetic-a11y-responsive.js` | FAIL | Timed out waiting for the keyboard-visible History segment. |
| `tests/live-phone-secure-lifecycle.js` | PASS | Secure fragment handoff, trusted pairing, exact scheduled gate, legacy-query refusal, fragment scrub, local QR rendering, real `MediaRecorder` blob upload to the intercepted synthetic backend, failed-upload clearing, and phone viewport checks all passed. |

## Deduplicated finding A - Staff Prep still has no visible route

Classification: repeat of `QA-findings-002-staff-prep-visible-route.md`.
Product/UI owner: Opus.

Independent Chrome reproduction reached the same failure after the smoke
driver had already passed the core synthetic patient, note, persistence, and
History-reopen workflow.

The source/runtime conflict remains deterministic:

1. Setup asks `window.__mlsTopbar.openMenu()` to reveal the Staff row.
2. The redesign hides the top-bar menu owner.
3. The retired `#nav_staffpull` owner is hidden.
4. Calm Tools rejects that hidden source, so it cannot create a visible Staff
   delegate.

The failure is not fixed by changing a selector or clicking the hidden menu.
Opus should expose one visible Calm Tools Staff Prep delegate and point Setup
at that same canonical path. Retain the existing private acknowledgement and
do not create a second pull implementation.

Smoke evidence:

- report:
  `C:\Users\Micha\AppData\Local\Temp\mls-current-tree-chrome-20260729-a91e2f\chrome-artifacts\smoke-10-runs\report.json`
- report SHA-256:
  `20AC950C1096B15795C349D1E3E1671AC590E5DBEAA1325C4E8AF2660A1A70BB`
- failure screenshot SHA-256:
  `82EF16F6034E59B44CBC46100F8A9C97C2E6A4C5DBE7A13A16B846C96FBE208C`

## Deduplicated finding B - Review declares History but cannot render it

Classification: repeat of `QA-findings-003-history-review-reachability.md`,
with stale-driver and product portions separated. Product/UI owner: Opus.

The two current driver selectors first look for History under Patient, while
the current Calm contract declares it under Review. That part of each driver
is stale. Merely retargeting it is not sufficient, because the intended
Review route is also broken:

1. Calm declares `nav_history` as the visible Review `History` extra.
2. Redesign folds `#nav_history` with inline `display:none`.
3. Calm `available()` rejects that hidden owner.
4. Runtime therefore renders no visible History segment under Review.

The contextual Visit History route still works; the smoke driver used it to
reopen the exact saved synthetic note successfully. That does not satisfy the
declared visible Review ownership or its keyboard route.

Opus should first restore one visible Review-to-History offer. After that,
retarget the keyboard and visible-control drivers to Review and reinstate the
saved-detail coverage. Proposals 033 and 034 intentionally make the present
drivers conservative while the product route is absent; they do not repair
the UI.

Evidence:

- visible-controls report SHA-256:
  `A26F7EE10B14C1AB096438790AEF78F4F60F741352ADAC6A9B8E345456592116`
- accessibility report SHA-256:
  `2E5DA7C380AD3FD2C7435CC7BA1480AEC61655A9147680FCBFA0AE17A68B38B0`
- accessibility screenshot SHA-256:
  `8A03D1F64AC8C08872B5210A205B15FAF4CB2451292EF4F8F5A3D1D63FF849BC`

## Passing phone evidence

The phone result is not a live extension claim. It is an isolated real-Chrome
contract against an intercepted synthetic backend.

- report:
  `C:\Users\Micha\AppData\Local\Temp\mls-current-tree-chrome-20260729-a91e2f\tests\live-phone-artifacts\2026-07-29T19-43-23-587Z\report.json`
- report SHA-256:
  `860C5E61A8837E81BCCE54155E2FC363C192ED9789AF84324F4F2542A43F8CA2`
- `productionContacted`: `false`
- `programmaticPairingRefused`: `true`
- `exactScheduledGateRefusedPairing`: `true`
- `trustedClickPairingStarted`: `true`
- `realMediaRecorderBlobUploaded`: `true`
- `failedUploadWasVolatileThenCleared`: `true`

## Release impact

- The Staff route and visible Review History route remain product/UI release
  blockers for the requested whole-site Chrome pass.
- Do not weaken either driver to click hidden implementation owners.
- Apply/fix the visible owners, rerun all four drivers in installed Chrome,
  then continue the remaining browser matrix.
- Hosted template upload/apply/fidelity and ten complete warm-session cycles
  remain pending until Opus supplies deployment and a dedicated hosted
  synthetic account. Never substitute a real clinician account.

