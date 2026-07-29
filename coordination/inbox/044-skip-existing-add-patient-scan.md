# P2 proposal: bypass Add patient docking scans after mount

## Measured problem

On exact b792 commit `b5cdff00371ceb0af07ba2a88b02b06292b7322b`,
`feat_addpatient.js:534-566` runs `ensureLauncher()` immediately and every
1,100 ms. The existing-node guard is currently below a loop over seven docking
selectors. Once `#mlsAddPtLauncher` exists, every recurring callback still
performs all seven `document.querySelector()` calls before returning.

An exact-source VM probe supplied the normal logged-in globals, an already
mounted launcher, no visible docking anchor, and the real 1,100 ms callback.
Over `floor(3,600,000 / 1,100) = 3,272` callbacks, it measured:

```text
b792 current:  22,904 querySelector + 3,272 getElementById
proposal 044:       0 querySelector + 3,272 getElementById
```

The in-memory proposed result removes 22,904 selector lookups per foreground
hour after the launcher mounts. The probe does not assign a millisecond claim
because selector cost varies with document size and browser state.

Pin search before authoring:

```text
rg -n "feat_addpatient\\.js|ensureLauncher\\(\\)|mlsAddPtLauncher" .
```

The only test that directly evaluates `feat_addpatient.js` is
`tests/async-owner-guards.test.js`; it does not pin the launcher block.
`tests/interaction-performance-contract.test.js:204` mentions the launcher only
as a FAB coordinate owned by another satellite. No source literal has to move.

## Proposed change

- Keep the logged-out removal path first and unchanged.
- Move the existing `#mlsAddPtLauncher` guard immediately after
  `loggedInUi()` succeeds.
- Leave the seven-anchor docking search, button construction, event binding,
  insertion behavior, timer cadence, and missing-launcher path unchanged.
- Add a focused source-order assertion to
  `tests/interaction-performance-contract.test.js` so the existing-node guard
  cannot drift below the docking scan again.

`feat_addpatient.js` and the test are read and written as UTF-8. Every
replacement is exact and single-occurrence, missing or ambiguous anchors are
hard failures, and both complete outputs are computed before either file is
written.

The production loader at `mls-connect.js:41778` uses
`?v=` plus `(window.__MLS_AV || Date.now())`; this satellite has no literal
immutable loader token or satellite-specific test pin to advance. Because its
bytes change, the shared core asset token must advance when Opus releases the
proposal. This proposal intentionally does not edit the unrelated core bundle
or its release-token pins.

## Expected effect

- Eliminate seven redundant selector searches from each recurring callback
  after the launcher exists: 22,904 avoided searches per hour at the current
  cadence.
- Preserve all Add patient behavior. An existing launcher already caused the
  function to return without docking or rebuilding; the return simply happens
  before work whose result was discarded.
- Preserve recovery when the launcher is removed. The next callback misses the
  guard, performs the same docking scan, and constructs the same button.
- Preserve logged-out cleanup because the authentication check and removal
  remain before the new guard.

This proposal changes no UI markup, text, styles, controls, patient behavior,
storage, network request, visit-engine content, live site, or extension.

## Risks and release checks

The primary risk is future code being added between the docking scan and the
old guard that must run for an existing launcher. The focused order contract
makes the intended early-return boundary explicit. Today the intervening work
only computes the local `docked` variable, which is unused when the launcher
already exists.

Opus should apply this only after reviewing the source block, advance the
shared asset release token and its exact pins in the release-owned change, then
run:

```text
node tests/interaction-performance-contract.test.js
node tests/async-owner-guards.test.js
node tests/run-all.js
```

## Disposable exact-b792 validation

Validation used a private copy of exact commit
`b5cdff00371ceb0af07ba2a88b02b06292b7322b`. The shared tracked checkout was
not used as the apply target.

```text
proposal script node --check: PASS

input feat_addpatient.js:
  31FB6333645713661D262B934DB03498DCAED3BC32327E80648D0BF4AB358F13
input tests/interaction-performance-contract.test.js:
  A824A829C64E51EDA2E7CE41F94D814B58A9B9B9A16824940EA2192611255725

first apply: exit 0
patched source/test node --check: PASS
node tests/interaction-performance-contract.test.js: PASS
node tests/async-owner-guards.test.js: PASS

output feat_addpatient.js:
  84EE194A5BCB78AFDE41D0286573E84CFE899AB93ED659E37C2F1549FBD70567
output tests/interaction-performance-contract.test.js:
  321C1D0D8834F0F37047AA1607F2ACBF5B679BFC1DD39842A16439AFE7802636

second apply: exit 1, exact source anchor missing
second-apply source/test hashes: unchanged

044-skip-existing-add-patient-scan.js:
  A1BA73EE10038A3761DEA656463CCE1F72FF3A0CA7467EEB4289D94F044BC687
```

The full release suite is intentionally left to Opus after review, shared
token advancement, and application to the release-owned checkout.

No tracked source, Git state, browser, extension, or live site is changed by
this proposal artifact.
