# Proposal 048 — Linear patient-snapshot list splitting

## Measured problem

Audit target: exact b793 plus validated proposed train 031–046, from the isolated
known-clean copy with `feat_mls_patient_snapshot.js` SHA-256
`13D69C28AB42EC55F54672183BBD8A67947EF92611D626D4E73F536D3DFB481F`
and both connectors loading it at `20260727hcep1`.

At `feat_mls_patient_snapshot.js:81-90`, `parseList()` splits active-patient
problems and allergies with:

```js
/[;\n•\|]+|,(?![^()]*\))/
```

For every comma, the negative lookahead scans forward until it finds a
parenthesis or reaches the end. A comma-heavy field with no closing parenthesis
therefore rescans almost the entire remaining string at every comma. The
function runs twice when Patient Snapshot opens, once for problems and once
for allergies.

Reproducible Node probe, using the exact old parser and input
`"a,".repeat(n) + "a"`:

| Characters | Old parser | Linear candidate |
|---:|---:|---:|
| 4,001 | 4.030 ms | 0.131 ms |
| 8,001 | 15.524 ms | 0.227 ms |
| 16,001 | 59.902 ms | 0.385 ms |
| 32,001 | 240.431 ms | 0.996 ms |
| 64,001 | 956.543 ms | 2.761 ms |
| 128,001 | 3,452.292 ms | 5.464 ms |

The old cost is approximately four times larger whenever input doubles. This
is a measured multi-second main-thread stall from one synthetic active-patient
field.

The same regex literal also exists in `feat_mls_problem_strip.js:64`, but that
satellite is not loaded by either b793 connector and is actively suppressed by
the hide satellite. Proposal 048 deliberately limits its byte and token change
to the live Patient Snapshot owner.

## Proposed change

`048-linear-patient-snapshot-list-split.js`:

- Adds a reverse pass that records delimiter positions and remembers only the
  nearest following parenthesis.
- Preserves the old unusual unmatched-parenthesis rule exactly: a comma stays
  inside the current item only when the nearest following parenthesis is `)`.
- Builds the same raw pieces in a forward pass, then retains the existing
  trim, trailing-period removal, 90-character cap, case-insensitive dedupe,
  and documented-empty handling.
- Advances both immutable loaders from `20260727hcep1` to
  `20260729listlinear`.
- Extends `tests/sanitize-regex-linear-time.test.js` with extraction of the
  live private parser, anti-vacuity assertions, deterministic generated-case
  equivalence, adversarial doubling timings, and both loader-token pins.
- Reads and writes `mls-connect.js` and `mls-connect.staging.js` as `latin1`.
  The satellite and test remain UTF-8.
- Computes every replacement and postcondition before the first write.
  Missing or duplicate anchors fail explicitly.

The equivalence probe compared complete old and proposed parsed arrays on
300,000 deterministic strings containing commas, all strong delimiters,
balanced and unmatched parentheses, whitespace, periods, and bracket noise.
Result: exact array equality on every case. The committed regression repeats
50,000 generated cases, injects documented-empty variants, and requires
substantial empty, nonempty, and multi-item populations so it cannot pass
vacuously.

## Expected effect

List parsing becomes O(n + d), where `d` is the number of delimiters. On the
measured 128,001-character input it falls from about 3.45 seconds to about
5.46 milliseconds, roughly 630 times faster in the probe. Normal patient
problem and allergy output is unchanged.

This removes a demonstrated catastrophic scaling path when opening Patient
Snapshot. It does not change the popover UI.

## Risks

- The scanner stores delimiter offsets, so peak temporary memory is O(d).
  This is bounded by the input length and replaces much larger repeated
  main-thread work.
- The old parser has counterintuitive behavior for unmatched parentheses.
  The generated equivalence suite intentionally preserves it; this proposal
  does not reinterpret clinical grouping.
- Timing assertions use a generous 500 ms ceiling and doubling-ratio slack to
  avoid slow-runner flakes while still rejecting the measured seconds-scale
  quadratic behavior.
- The satellite byte change requires the included loader-token advance. A
  partial manual application would leave stale cached bytes, so Claude should
  apply the script as one unit.

## Reviewer validation

Apply independently after proposals 031–046, then run:

```text
node tests/sanitize-regex-linear-time.test.js
```

Also validate it combined with proposal 047, then run the complete current gate.
Re-running this patch script must fail before writes and leave file hashes
unchanged.
