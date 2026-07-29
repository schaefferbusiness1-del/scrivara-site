# P2: remove the redundant Copilot autogrow layout read

## Measured problem

Copilot's textarea runs `_copilotAutogrow(this)` on every input
(`ScribeFlow.html:4167`). The production function at
`ScribeFlow.html:13820` and staging copy at
`ScribeFlow-staging.html:10396` currently:

1. write `height = auto`;
2. read `scrollHeight` and write a capped height;
3. immediately read `scrollHeight` again and overwrite that height with the
   same cap calculation.

An exact-source synthetic probe over 1,000 calls counted 2,000
`scrollHeight` reads and 3,000 height writes. Reading `scrollHeight` after the
`height = auto` write requires layout; the middle result can never survive the
following assignment.

Programmatic speech/chip paths also call the same function
(`ScribeFlow.html:14006,14049-14050`).

## Proposed change

In production and staging, keep only:

```text
height = auto
height = min(150, scrollHeight)
```

The performance contract extracts and executes both real functions with a
counting `scrollHeight` getter. It requires one read, exactly two writes, and
checks both below-cap and above-cap final heights.

Both HTML files and the test are read and written as UTF-8. Every edit is an
explicit single-occurrence replacement with ambiguity failure. No satellite
bytes or immutable token change.

## Expected effect

Reduce forced layout reads by 50% and style writes by 33% for each Copilot
composer resize. Across 100 typed characters, this removes 100 forced layout
reads while preserving the exact final height and 150 px cap.

## Risks and release checks

- Risk is very low: the removed intermediate height is unconditionally
  overwritten before the function returns.
- Type multiline text below and above the cap in production and staging;
  verify growth, cap, scrolling, speech insertion, and suggestion chips.
- Run `node tests/interaction-performance-contract.test.js`, inline syntax
  checks, the full gate, and a DevTools layout-count probe while typing.

No tracked source, Git state, browser, extension, or live-site state was changed
by Codex.
