# P0: replace lazy wildcard block stripping with forward-only scans

## Measured problem

Both summary sanitizer copies remove script, style, and comment blocks with
lazy wildcard regexes at `mls-connect.js:8601` and
`mls-connect.js:11500`:

```text
/<script[\s\S]*?<\/script>/gi
/<style[\s\S]*?<\/style>/gi
/<!--[\s\S]*?-->/g
```

When text contains repeated opening tokens without a closing token, the engine
retries the lazy wildcard from each opener. Exact live-chain timings on
generated unclosed `<script` text were:

| Input length | Current chain |
| ---: | ---: |
| 28,000 | 23.6 ms |
| 56,000 | 96.7 ms |
| 112,000 | 411.9 ms |
| 224,000 | 1,651 ms |

That fourfold cost per doubling is quadratic and occurs before line-level
sanitization. No patient data was used.

## Proposed change

Inside each existing sanitizer IIFE:

- Add a scope-local `stripBlocks` helper using forward-only global-regex
  `exec` cursors, array fragments, and one final `join`.
- Apply it in the exact existing order: script, then style, then comment.
- Preserve script/style case-insensitivity, comment case-sensitivity,
  first-open/first-close pairing, one newline per complete block, and unchanged
  unmatched openers.

The helper was compared in memory against the old chain on mixed-case,
multiple, nested-like, unmatched, comment, and 1,000 deterministic generated
cases with exact output equality. New timings on 28 KB through 448 KB unclosed
input were 0.051, 0.062, 0.140, 0.340, and 0.593 ms.

The timing contract forbids all three old lazy-wildcard literals, requires two
scope-local helpers, evaluates the live helper, checks output equivalence, and
times a repeated-unclosed-opener miss.

`mls-connect.js` is read and written as `latin1`; the test remains UTF-8. Each
edit is an explicit single-occurrence replacement with ambiguity failure. No
satellite bytes or cache token change.

## Expected effect

Remove another seconds-to-minutes sanitizer stall class while retaining the
same output for complete and incomplete markup.

## Risks and release checks

- The helper resets both regex cursors on every call; losing either reset would
  create state leakage, so the contract executes the real helper repeatedly.
- Run `node tests/sanitize-regex-linear-time.test.js`, summary/ingest contracts,
  the full gate, and a synthetic large-summary comparison against the previous
  chain.
- Verify complete mixed-case script/style/comment blocks are removed and
  unmatched opener text remains available to later line classification.

No tracked source, Git state, browser, extension, or live-site state was changed
by Codex.
