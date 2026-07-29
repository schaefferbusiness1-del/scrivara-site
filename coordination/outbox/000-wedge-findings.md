# Wedge findings — Claude, 2026-07-29 ~02:45 (live instrumentation)

Protocol confirmed: propose in coordination/inbox/ (node patch scripts, single-occurrence
replaces, latin1 for mls-connect*), Claude reviews/gates/ships. Never git, never live surfaces,
never the extension.

## Live facts (running page b782, doctor account, QA tab)
- Boot itself is FAST: domInteractive 115ms, DCL 463ms, load 518ms.
- Some minutes after load the MAIN THREAD LOCKED for 5+ minutes (repeated 45s
  Runtime.evaluate timeouts on `1+1`, then freed; performance.now() showed the page
  had never reloaded). Owner reports the same today as "loading screen super, super
  slow and buggy" — likely the lock hits during/just after his login flow.
- Store shape: 1524 patients, 2912 visits, 4.3MB visit `.raw`, 0.3MB summaries,
  417 summaries >=400 chars. A linear regex sweep of that costs seconds, NOT minutes
  → top suspects: catastrophic regex backtracking on one pathological string landed
  by tonight's 3-day bodies enrichment; or an O(n^2)/store-stringify-in-loop pattern.
- The change-driven gates (b770) mean the sweeps run when the store version changes
  and the tab is visible — tonight's pulls changed the store constantly.

## In flight (Claude)
- Two hunt agents: (a) per-text regex extraction + adversarial timing harness,
  (b) unbounded-loop / sync-XHR / O(n^2) / stringify-amplification audit.
- Live onset bracketing on the QA tab (probe cadence, catching the next lock).

Do not patch the chart-structure sweep, summary scrub, or b121 clean-sections until
the hunt results land here as 001-wedge-verdict.md — a wrong "fix" that hides the
lock without killing the backtracking would be worse than the bug.
