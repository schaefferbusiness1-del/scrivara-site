# P1 release blockers: restore two first-use dependencies

## Measured problem

The 2026-07-29 deferral batch moved 36 assets totaling 824,303 raw bytes off
the ordered eager tail. A post-change dependency audit found that two of those
assets are synchronously consumed before the idle fallback is guaranteed to
run:

- `feat_mls_patient_reach_v2.js`, 32,188 bytes, is idle/async at
  `mls-connect.js:43089`. Its execution creates `#mlsPtab_reviews`,
  `#mlsPtab_send`, and the callable `window.__mlsPatientReach` API
  (`feat_mls_patient_reach_v2.js:359-382,558-572`). Before that happens,
  already-visible actions at `mls-connect.js:31300-31303,34526,34677` fall
  through without opening anything. The login veil can reveal after 300 ms
  (`ScribeFlow.html:25664`) and does not await optional satellites
  (`ScribeFlow.html:30541-30543`), so this is a real silent-click window.
- `feat_mls_code_table.js`, 17,486 bytes, is idle/async at
  `mls-connect.js:43107`. Three note-generation paths synchronously append
  `window.__mlsCodeTable.promptBlock()` when present and append an empty string
  when absent (`ScribeFlow.html:16496,19878,20123`). They do not wait or replay,
  so Generate during the idle window permanently omits the practice ICD/CPT
  table from that request.

Reproducible source probes:

```text
rg -n "feat_mls_patient_reach_v2.js|feat_mls_code_table.js" mls-connect.js
rg -n "__mlsPatientReach|mlsPtab_reviews|mlsPtab_send" mls-connect.js feat_mls_patient_reach_v2.js
rg -n "__mlsCodeTable.*promptBlock" ScribeFlow.html
```

## Proposed change

- Restore only Patient Reach and Code Table to their exact pre-batch
  `async=false` loader shapes, preserving their loader locations and relative
  order.
- Remove those two names from the deferred-tranche contract and correct its
  measured accounting to 34 safe batch assets: 18 literal-locator entries and
  16 alternate-locator entries.
- Adjust the existing boot-budget measurement from 195 eager / 50 deferred to
  the detector's observed 196 eager / 49 deferred. Patient Reach was already
  counted as eager because the detector sees an earlier compatibility string;
  the exact loader contract closes that known detector blind spot.
- Replace the touched Code Table build-number comment with a dated comment.

`mls-connect.js` is read and written as `latin1`; test files remain UTF-8.
Every edit is an explicit single-occurrence replacement with ambiguity failure.
Neither satellite's bytes change, so immutable tokens stay
`20260727pr205` and `20260716ct110`.

## Expected effect

- Reviews and Send actions have their owner/API before the app becomes
  interactive.
- Every generation path sees the practice ICD/CPT prompt table on its first
  request.
- The other 34 audited assets, approximately 774,629 raw bytes, remain
  deferred. This retains about 94% of the batch's byte deferral while restoring
  the two proven first-use dependencies.

## Risks and release checks

- The ordered tail regains 49,674 raw bytes and two synchronous script
  insertions. Measure cold and warm boot against b785; do not accept a material
  regression without revisiting an explicit readiness gate.
- Before accepting, click Reviews and Send at the earliest interactive moment
  and verify both open on the first click.
- Generate through all three prompt builders immediately after reveal and
  verify the saved practice code table is present in each outbound prompt.
- Run `node tests/late-surfaces-stay-deferred.test.js`,
  `node tests/boot-script-budget.test.js`,
  `node tests/patient-reach-v2-runtime.test.js`, Code Table/study contracts,
  the full gate, and focused live verification.

No tracked source, Git state, browser, extension, or live-site state was changed
by Codex.
