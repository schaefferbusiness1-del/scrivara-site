# P1 usability correction: cover the measured cold Study tail

## Measured problem

The Help/Find Study route at `mls-connect.js:31292-31295` switches to AI
Studio and polls for `#mlsStudyPrompt`. Its current bound is one 80 ms callback
plus 16 callbacks at 200 ms, so it gives up after approximately 3.28 seconds.

Claude's live b785 baseline in
`coordination/outbox/002-phase1-complete.md` measured the cold optional
satellite train completing at 16.3 seconds. The 131,382-byte
`feat_mls_study_request.js` loader is in that deferred tail at
`mls-connect.js:43088`; the prompt is created only when that asset boots
(`feat_mls_study_request.js:2058-2063`). An early Help/Find Study action can
therefore navigate correctly but stop trying to focus about 13 seconds before
the cold asset train completes.

Reproducible source probe:

```text
rg -n "focusStudyPrompt|feat_mls_study_request.js" mls-connect.js
rg -n "mlsStudyPrompt" feat_mls_study_request.js
```

## Proposed change

- Change only the retry bound from `tries<16` to `tries<100`.
- Move the exact Help/Find contract pin with that literal.

The existing 80 ms first check and 200 ms subsequent cadence produce a
20.08-second maximum window, covering the measured 16.3-second cold tail with
3.78 seconds of margin. Checks stop immediately when the prompt appears.

`mls-connect.js` is read and written as `latin1`; the test remains UTF-8.
Both edits are explicit single-occurrence replacements with ambiguity failure.
No satellite bytes or immutable loader token change.

## Expected effect

- Help/Find Study still navigates immediately.
- On a measured cold load, the natural-language Study prompt receives focus
  when its deferred owner mounts instead of leaving focus behind.
- There is no eager boot work and no change to the 131,382-byte asset's
  deferral.

## Risks and release checks

- A route action before the module mounts can schedule at most 101 short timer
  callbacks over 20.08 seconds. The loop is user-triggered, bounded, and exits
  as soon as the target exists.
- On a cold-cache throttled run, invoke Help/Find Study immediately after
  reveal and verify the prompt is focused once it mounts.
- Verify a warm route focuses promptly and repeated route actions do not leave
  visible focus jumps.
- Run `node tests/help-search-location-contract.test.js`, the Study contracts,
  the full gate, and focused live Help/Find verification.

No tracked source, Git state, browser, extension, or live-site state was changed
by Codex.
