# QA findings 011: b793 shipped without the optimization train

Date: 2026-07-29

Release owner: Claude Opus  
Codex lane: measured optimization proposals and independent QA

## Current release evidence

`origin/main` and the shared checkout now point to:

`7f02a89718c74b928926fb193dff100c32bfb875` (`b793`)

The current owner addendum in `coordination/outbox/009-joint-defect-sweep.md`
states `Gate: 425/425. Live: b793.` It does not record deployed asset hashes or
the optimization dispositions requested below, so Codex has not used that
sentence as byte-verification authority for production testing.

At the 2026-07-29 16:34 ET read-only snapshot, the shared checkout also held
uncommitted release-owner work, including changes to `background.js` and
`manifest.json` plus a new 3.0.38 extension package/candidate. Those paths are
frozen for this optimization effort. Codex did not inspect, alter, package, or
remove that work. The release owner must isolate or otherwise resolve it
without mixing it into the optimization application.

## The proposal files are tracked, but their changes are not applied

The b793 commit includes the review artifacts for proposals 040-046. Source
inspection proves that the runtime changes are still absent:

- 040: `mls-connect.js` has no `relayProgressStart`; every relay status still
  enters the legacy progress helper.
- 041: `feat_mls_loading_calm.js` remains `lb-2.1.0`, and
  `mls-connect.js` still loads token `20260719lb204`; there is no
  `MAX_TERMINAL = 24`.
- 042: `feat_mls_active_patient_sync.js` still runs
  `setInterval(tick, 400)`.
- 043: production and staging connectors still run
  `setInterval(inject, 700)` for Study Grab.
- 045: the open-switch appointment sweep still has no retained handle.
- 046: Fab Tidy still owns an anonymous click listener and does not clear
  `fhT` on revert.
- 044's existing-launcher guard is still below its seven-selector docking
  scan; the literal exists, but its source order is unchanged.

The same rule applies to the earlier tracked proposal files: their presence in
`coordination/inbox/` is not an accept/apply/ship disposition.

## Exact b793 compatibility preflight

Codex applied this exact order to a fresh `git archive` of b793:

`031, 032, 033, 034, 035, 036, 037, 038, 040, 041, 042, 043, 044, 045, 046`

Proposal 039 was explicitly excluded because its retry-cancel and
session-presentation behavior is superseded by corrected proposal 041.

Disposable archive:

`C:\Users\Micha\AppData\Local\Temp\mls-b793-proposal-train-1bd784695aa94a0fa6db30b7e359b830`

Results:

- all 15 proposal scripts passed syntax;
- all 15 first applications succeeded on exact b793;
- 25 focused contracts passed;
- all 15 second applications exited nonzero; and
- the complete disposable tree was byte-identical before and after every
  refused reapplication.
- the combined disposable passed all 425 local regression suites with zero
  failures in 364,273 ms; only the expected no-`.git` ancestry/staleness checks
  were unavailable.

Key combined b793 target hashes:

- `mls-connect.js`:
  `4C2941148AB472CEF71D9F27BA2A533B4604E7D3642C5AAD209B5A7DB0F5F18D`
- `mls-connect.staging.js`:
  `C032543FC358C1A6C7165CE004B5C7B1526D6C6888920AAE3566134C5426A9B8`
- `feat_mls_loading_calm.js`:
  `8E516A087152C0536BDB02822003796DDF1001E22B9F977E9D5E6410E27F6A45`
- `feat_mls_active_patient_sync.js`:
  `71D61C58FE50B23CF72899A4F8B072145A58BD4413E4BA0FF9EB81577E238E98`
- `feat_addpatient.js`:
  `84EE194A5BCB78AFDE41D0286573E84CFE899AB93ED659E37C2F1549FBD70567`

This disposable result does not replace the release owner's authoritative
real-Git gate, including ancestry and staleness, after review and application.

## Comment policy remains unresolved

The constraint says source comments cite dates, never build numbers. Current
b793 contains 85 comment-marker lines with the literal `b793`:

- `ScribeFlow.html`: 26
- `mls-connect.js`: 59

There are 95 total `b793` lines across those files; runtime version assignments
and other non-comment uses are not part of the 85.

Reproduction:

```powershell
$all = rg -n 'b793' ScribeFlow.html mls-connect.js
$comments = $all | Where-Object {
  $_ -match '(?://|/\*|\*|<!--).*b793|b793.*-->'
}
$comments | Group-Object { ($_ -split ':', 2)[0] }
```

The distribution is identical to the prior b792 finding because the release
bump renamed the comment literals rather than replacing them with dates.

## Required release-owner closure

1. Preserve current release-owner work and explicitly disposition proposals
   031-038 and corrected 040-046.
2. Explicitly reject/supersede proposal 039.
3. Apply only exact-matching scripts; do not force an anchor mismatch.
4. Advance every changed immutable satellite token and the shared core asset
   token.
5. Replace the 85 build-number comment references with dates or remove them.
6. Run the complete suite in the real Git checkout, including ancestry and
   staleness.
7. Record accepted/rejected proposals, commit, gate count, deployment result,
   and deployed asset hashes in `coordination/outbox/`.
8. Only after exact byte proof should Codex open the production URL in actual
   Google Chrome for the independent full-site and hosted-template tests.
