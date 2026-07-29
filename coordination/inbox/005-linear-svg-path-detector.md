# P0: make both SVG-path detectors linear

## Measured problem

The two live sanitizer `isCode` copies at `mls-connect.js:8580` and
`mls-connect.js:11492` contain:

```text
/["'(]?\s*[MmLlCcSsQqTtAaZzHhVv]\s*-?\d[\d.,\-\s]{15,}/
```

On a non-matching synthetic string shaped as `X + spaces + Y`, exact-function
timings were:

| Input length | Current detector |
| ---: | ---: |
| 10,000 | 21.8 ms |
| 20,000 | 98.4 ms |
| 40,000 | 400 ms |
| 80,000 | 1,912 ms |
| 160,000 | 7,812 ms |

The roughly fourfold cost per doubling is quadratic. The optional prefix can
start at every whitespace position, then `\s*` repeatedly scans the remainder
before the required path command fails.

Reproducible probe:

```text
rg -n "\\[MmLlCcSsQqTtAaZzHhVv\\]" mls-connect.js
node tests/sanitize-regex-linear-time.test.js
```

The probe uses generated whitespace only; it contains no patient data.

## Proposed change

Replace both copies with:

```text
/[MmLlCcSsQqTtAaZzHhVv]\s*-?\d[\d.,\-\s]{15,}/
```

The removed quote/paren and leading-whitespace portion is entirely optional.
Every old successful match necessarily contains the same command-letter
suffix, so starting at that suffix preserves the yes/no result. Measured new
timings were 0.168 ms at 160,000 characters and 0.329 ms at 320,000.

The timing contract now forbids the old prefix, requires the new literal in
both live copies, times a 160 KB adversarial miss, and checks SVG-path and
clinical-prose verdicts.

`mls-connect.js` is read and written as `latin1`; the test remains UTF-8. Both
source edits and the test insertion are explicit single-occurrence
replacements with ambiguity failure. No satellite bytes or cache token change.

## Expected effect

Remove a remaining multi-second main-thread stall class from both summary
sanitizers while preserving their code-versus-clinical classification.

## Risks and release checks

- Risk is low because the deleted prefix was optional and therefore could not
  change whether the required command suffix existed.
- Run `node tests/sanitize-regex-linear-time.test.js`, sanitizer/chart-ingest
  contracts, the full gate, and a synthetic large-summary timing probe.
- Verify representative SVG path lines are still removed and representative
  medication, level, imaging, and narrative lines remain.

No tracked source, Git state, browser, extension, or live-site state was changed
by Codex.
