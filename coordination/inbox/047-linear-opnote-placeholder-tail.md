# Proposal 047 — Linear op-note placeholder-tail classification

## Measured problem

Audit target: exact b793 plus validated proposed train 031–046, from the isolated
known-clean copy with `feat_mls_opnote_integrity.js` SHA-256
`444D3BE37FAC897A0EC1A33B65C1FF7D9298BE91739C53366CA79720FDEE317A`.

At `feat_mls_opnote_integrity.js:672-675`, `placeholderOnlyTail()` applies:

```js
/^(?:\s*(?:...placeholder...)\s*)+$/i
```

The repeated group and its overlapping leading/trailing `\s*` allow many ways
to partition one whitespace run. A late non-placeholder character makes V8
retry those partitions quadratically. This classifier is called from
`forceFacts()` at line 688 and `reanchor()` at line 742 on generated
operative-note heading tails.

Reproducible Node probe, using the exact old function and input
`"[[field]]" + " ".repeat(n) + "X"`:

| Spaces | Old median-like run | Linear candidate |
|---:|---:|---:|
| 4,000 | 2.960 ms | 0.083 ms |
| 8,000 | 11.556 ms | 0.187 ms |
| 16,000 | 45.663 ms | 0.235 ms |
| 32,000 | 191.411 ms | 0.423 ms |
| 64,000 | 744.005 ms | 0.791 ms |
| 128,000 | 4,988.259 ms | 2.604 ms |

The old cost is approximately four times larger whenever input doubles. This
is a measured multi-second main-thread stall on one synthetic note tail, not a
speculative rewrite.

## Proposed change

`047-linear-opnote-placeholder-tail.js`:

- Replaces the nested repeated regex with a forward cursor. It consumes
  whitespace once, then consumes exactly one accepted placeholder token at the
  cursor. Any other character fails immediately.
- Keeps all prior accepted token forms: `[[...]]`, `[...]`, `{{...}}`, and two
  or more underscores.
- Advances both immutable loaders from
  `20260728oni2170` to `20260729phlinear`.
- Moves all three existing test pins with that token, including the paired
  production/staging assertions.
- Extends `tests/sanitize-regex-linear-time.test.js` with extraction of the
  live private function, anti-vacuity assertions, deterministic generated-case
  equivalence, and adversarial doubling timings.
- Reads and writes `mls-connect.js` and `mls-connect.staging.js` as `latin1`.
  All other touched files use UTF-8.
- Computes every replacement and postcondition before the first write.
  Missing or duplicate anchors fail explicitly.

The equivalence probe compared the old and proposed verdicts on 200,000
deterministically generated inputs containing brackets, braces, underscores,
`FILL`, ASCII whitespace, NBSP, Unicode line separators, and invalid prose.
Result: exact equality on all cases, with 327 true and 199,673 false verdicts.
The committed regression repeats 50,000 deterministic cases and requires both
verdict classes so the comparison cannot pass vacuously.

## Expected effect

The classifier becomes O(n) in the heading-tail length. On the measured
128,000-space miss it falls from about 4.99 seconds to about 2.60 milliseconds,
roughly 1,900 times faster in the probe. Normal short placeholders retain the
same output verdict.

This removes one demonstrated catastrophic-backtracking path from op-note
fact stamping and template re-anchoring. It does not claim to explain every
live wedge and does not alter UI.

## Risks

- The scanner intentionally preserves the old broad single-bracket behavior:
  any nonempty `[...]` token is accepted, not only tokens beginning with
  `FILL`. Tightening that rule is outside this performance proposal.
- Timing assertions use a generous 500 ms ceiling and doubling-ratio slack to
  avoid slow-runner flakes while still rejecting the measured seconds-scale
  quadratic behavior.
- The satellite byte change requires the included loader-token advance and
  exact test-pin moves. A partial manual application would leave stale cached
  bytes, so Claude should apply the script as one unit.

## Reviewer validation

Apply after proposals 031–046 in a clean worktree, then run:

```text
node tests/sanitize-regex-linear-time.test.js
node tests/opnote-live-findings-regression.test.js
node tests/opnote-staging-parity-runtime.test.js
node tests/opnote-template-integrity-runtime.test.js
```

Then apply proposal 048 and run the combined focused tests followed by the
complete current gate. Re-running this patch script must fail before writes and
leave file hashes unchanged.
