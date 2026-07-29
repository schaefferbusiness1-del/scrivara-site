# QA handoff 008: b791 P0 persistence multiplier and long-session train

Date: 2026-07-29

Release owner: Claude Opus  
Proposal/review lane: Codex proposes; Opus reviews, applies, gates, deploys,
and verifies.

## Shared checkout boundary

The exact committed base used for every measurement and disposable validation
is:

`0923b770d28b0497c495ddf815cbf212fcd4d33d` (`b791`)

The shared checkout currently contains Opus-owned tracked edits in
`feat_mls_motion.js`, `mls-connect.js`, and several tests, plus extension
candidate work. Codex did not edit, stage, reset, commit, or run a patch script
against that checkout. Review the proposal scripts against Opus current bytes;
do not replace the shared tree with a disposable archive.

## P0 verdict

The targeted automatic regex paths are no longer the minutes-long lock:

- exact synthetic roster: 1,524 patients, 2,912 visits, 4,298,112 visit-text
  bytes, and 297,060 summary bytes;
- normal automatic scan: 101.002 ms;
- unchanged-version repeat: 0.007 to 0.013 ms with no roster reads; and
- five dense-hit passes across 21,498,435 bytes: 1,239.576 ms.

The remaining conditional P0 is a failed whole-roster save:

1. Chart Structure, Continuous Summary Scrub, and base Summary Sanitize each
   attempt one `savePatients` batch.
2. If that batch throws, exact b791 treats it like a missing API and performs
   one `upsertPatient` per dirty row.
3. Each upsert normally serializes and compresses the full roster again.
4. The exact production encoder averaged 1,361.656 ms after warmup on a
   synthetic 2,936,251-byte roster.
5. Thirty-two fallback rows therefore cost about 43.6 seconds of compression;
   417 cost about 568 seconds, or 9.5 minutes.

This is the only remaining automatic path found whose exact-source cost fits
the observed finite five-plus-minute main-thread wedge. The live trace has not
yet proven a quota exception, so correlate the onset with a throwing
`savePatients` call or `QuotaExceededError`; do not label quota as confirmed
without that evidence.

## New separately applicable proposals

### 035: bounded template keyword compatibility work

- `035-bound-template-keyword-scrub.js`
- `035-bound-template-keyword-scrub.md`

Removes 20 full local-storage walks and 20 template-library parse passes per
minute per open tab after preserving boot, Templates-open, and ten bounded
wrapper-discovery attempts.

### 036: summary scrub failed-save fan-out

- `036-stop-summary-scrub-fanout.js`
- `036-stop-summary-scrub-fanout.md`

Preserves per-row compatibility only when `savePatients` is absent. A present
writer that throws produces one batch attempt, zero row upserts, zero false
completion, and no same-version heartbeat retry. Continuous Scrub remains the
automatic change-driven retry owner; the duplicate startup owner latches and
retires.

### 037: Chart Structure failed-save fan-out and cache isolation

- `037-stop-chart-sweep-fanout.js`
- `037-stop-chart-sweep-fanout.md`

Adds deep candidate isolation, restores visit-model cache side effects, makes
persistence success explicit, stops after the first failed writer, suppresses
false success renders/counts, and settles the post-failure version gate.

Deep isolation was measured on 417 synthetic rows and 4,737,068 JSON bytes:
8.410 ms mean and 11.784 ms maximum across ten complete clone passes. This is
less than one percent of one measured full-roster encode.

## Disposable validation

Independent exact-b791 validation:

- proposal 036 focused runtime: PASS;
- proposal 037 focused runtime: PASS;
- 036 then 037 together: PASS;
- every second application: nonzero exit with both target hashes unchanged.

Full 031-037 combined archive:

`C:\Users\Micha\AppData\Local\Temp\mls-b791-plus-031-035-3b145b895a4a423b87967e952a99549c`

Focused results after 036 and 037:

- `patient-scale-perf-contract.test.js`: PASS;
- `interaction-performance-contract.test.js`: PASS;
- `scoped-lifecycle-watchers-contract.test.js`: PASS;
- `freeze-resistance-contract.test.js`: PASS;
- `performance-lifecycle-contract.test.js`: PASS;
- `full-visit-reader-runtime.test.js`: PASS;
- `schedule-visit-persistence-adversarial.test.js`: PASS; and
- `chart-refresh-merge-runtime.test.js`: PASS.

Combined hashes:

- `mls-connect.js`:
  `1180F5F4C2F4DB22AE0F80558C58F6B09A90A14D407702BE0D04EB23A6957283`
- `tests/patient-scale-perf-contract.test.js`:
  `F12EACBEF9B4E75C615CC6B185B087E1609EC577F28B49D8DFF60B06D63A83A7`
- `tests/interaction-performance-contract.test.js`:
  `CE0FF2E67BC97A7961D6B69D970BFD61A9D80C30D357A36EA412A3A1D159859E`

The complete isolated 031-037 archive gate finished with exit code zero:

`PASS all 423 local regression suites`

There were no failures. The only non-executed checks were the expected
build-bump and staleness checks because the disposable archive has no `.git`
directory. This result therefore does not replace Opus authoritative
real-checkout gate with Git ancestry and staleness.

## Review order

1. Finish and preserve the current Opus-owned shared edits.
2. Review 031 and 032.
3. Apply 033 and 034 only if their exact prerequisite hashes match.
4. Review 035 independently.
5. Review 036 before 037; they touch disjoint production regions and disjoint
   sections of one test file, and both also apply independently to exact b791.
6. If 035-037 are accepted, advance the core `mls-connect.js` release/site
   token. No immutable satellite bytes change in these three proposals.
7. Run the full source gate in the real checkout with Git ancestry/staleness.
8. Record accept or reject reasons and applied hashes in the next outbox
   disposition.

## Required live closure

Do not call the optimization train shipped until the exact deployed bytes are
verified. Every post-deployment browser check must run in real Google Chrome.

After deployment:

1. Run the complete browser matrix and the strict template lifecycle E2E.
2. Run `live-synthetic-smoke.js --runs=10` in one fresh isolated Chrome
   profile and report every cycle duration. Treat a rising warm-load trend,
   accumulating timers/observers/wrappers, or a late cycle failure as a release
   blocker.
3. In a dedicated hosted synthetic QA account, use the real visible template
   workflow: upload an ASCII text file, add it, select it, set it as default,
   enable Templates, bind a synthetic patient visit, exercise automatic
   Generate and visible Use on current note across three varied synthetic
   transcripts, reload, and verify persistence and exact patient binding.
4. Never use a real clinician account, real patient data, Athena writes, or the
   extension for mutable QA.
5. Let Codex independently test the exact shipped live site in Google Chrome.
   Codex reports defects only; Opus owns every UI/product fix and reruns the
   affected gates until clean.
