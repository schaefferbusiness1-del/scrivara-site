# P1 proposal: idle-defer three late report satellites

## Measured problem

The production boot budget currently reports 245 feature scripts: 220 eager and 25 deferred (`node tests/boot-script-budget.test.js`). Its checked-in foreground measurement records 10,929 ms of total blocking time even though the page load event completes in 373 ms. This proposal targets work in the synchronized post-login script burst, not request count.

A source and dependency probe on 2026-07-29 found three independent late-surface loaders still using `s.async=false`:

- `mls-connect.js:41831` loads `feat_mls_outcome_pdf.js` (18,583 bytes). Its top-level `boot()` starts a permanent 1,200 ms button-injection interval at `feat_mls_outcome_pdf.js:370-374`; the controls cannot be used until an Outcome Study result exists.
- `mls-connect.js:42615` loads `feat_comp_report.js` (39,604 bytes). It immediately adds a hidden legacy button/style and starts a bounded 1,000 ms mount interval at `feat_comp_report.js:556-575`.
- `mls-connect.js:43088` loads `feat_mls_study_request.js` (131,382 bytes). If `#mlsSgPro` is not ready, `boot()` attaches a document-wide subtree observer with a 60,000 ms deadline at `feat_mls_study_request.js:2106-2111`.

Total shifted out of the eager insertion wave: 189,569 raw bytes (185.1 KiB), three ordered `async=false` insertions, two interval startups, immediate Pay Report DOM/style work, and Study Request observer setup.

Reproducible probes:

```text
node tests/boot-script-budget.test.js
Get-Item feat_mls_outcome_pdf.js,feat_comp_report.js,feat_mls_study_request.js | Select Name,Length
rg -n "setInterval|MutationObserver|observe\(" feat_mls_outcome_pdf.js feat_comp_report.js feat_mls_study_request.js
```

One known accounting limitation is preserved rather than hidden: the aggregate boot test classifies the first textual feature-file mention. `feat_comp_report.js` first appears in an earlier comment at `mls-connect.js:16052`, so that test will report 218 eager / 27 deferred after this physically moves three loaders to 217 / 28. The exact late-surface contract added here pins all three real loader lines.

## Proposed change

- Wrap each of the three existing loaders in the repository-standard `requestIdleCallback` gate, with a 900 ms `setTimeout` fallback and a 2,500 ms idle deadline.
- Change their dynamic script mode from `s.async=false` to `s.async=true`.
- Preserve every URL, immutable cache token, asset marker, and satellite byte. No token advances are required.
- Keep all upstream dependencies eager:
  - Outcome Study remains eager at `mls-connect.js:41426`; the export module already polls for its result controls and lazy-loads its PDF library only on use.
  - Study Groups remains eager at `mls-connect.js:41861`; Study Request already waits up to 12 seconds for that engine before execution.
  - Pay Report callers resolve `window.__mlsComp` at click time, and the active launchers expose a loading state.
- Replace the Help/Find Study route's single 80 ms focus attempt with one bounded, user-triggered retry chain lasting about 3.3 seconds. This covers the idle deadline without adding boot timers or a permanent poll.
- Extend `tests/late-surfaces-stay-deferred.test.js` to locate both literal-asset and `var A="..."` loader forms and pin all three assets as idle plus async.
- Tighten `tests/help-search-location-contract.test.js` to require bounded late-mount focus recovery.

`mls-connect.js` is read and written as `latin1`. The two tests are read and written as UTF-8. Every edit is an explicit single-occurrence replacement, all replacements are completed in memory before any file is written, and ambiguity is a hard failure.

## Expected effect

- Remove three late report modules from the synchronized post-login insertion wave while keeping them loaded by 2.5 seconds even if the browser never grants idle time.
- Move 189,569 bytes of parse/execute work, two timer registrations, Pay Report's hidden DOM/style insertion, and the Study Request mount observer out of eager loader evaluation.
- Give the eager Study Groups mount up to 900 ms of fallback head start. On the normal path, Study Request should find `#mlsSgPro` immediately and avoid its document-wide fallback observer.
- Keep eventual feature count, URLs, cache behavior, exports, and report calculations unchanged.

## Risks and release checks

- A user who opens Pay Report inside the deferral window may briefly see the existing loading message. One older launcher silently no-ops, but its `.mls-b34-pay` control is already hidden by the current cleanup owner. Verify all visible Pay Report entry points immediately after app reveal and again after 2.5 seconds.
- Help/Find Study navigation now creates a bounded retry timer only after that human action. Verify it focuses `#mlsStudyPrompt` both before and after the satellite has loaded.
- If Outcome Study is opened immediately, PDF/SVG buttons can appear on the module's next 1.2-second injection pass. Verify export controls appear and both exports still work.
- Verify Study Request mounts once, accepts keyboard submit, waits correctly for Study Groups, and does not leave a document-wide observer after the target exists.
- Run the full 417-suite gate plus the focused contracts: boot budget, late surfaces, Help/Search location, compensation report, local clinical library boundary, Outcome reporting, and every Study Request test.

No tracked source was edited by Codex, no Git operation was performed, and no browser, extension, or live-site state was touched.
