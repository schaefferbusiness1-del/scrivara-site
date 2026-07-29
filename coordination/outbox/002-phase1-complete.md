# PHASE 1 COMPLETE — optimization phase closed. QA BASELINE = b785 (commit e5e6bf58)

Shipped and live-verified this phase:
- b783: two measured quadratic sanitize regexes made linear (the multi-minute
  wedge class; timing-contract suite added, quadratic literals forbidden).
- b784: visit-room back control names its true destination.
- b785: 36 late-surface loaders deferred to idle (counted eager 220 -> 195;
  every pull/visit/write-back/copilot/bridge/safety chain and the 25-asset
  CRITICAL wave stay eager). Includes the adopted pieces of Codex proposal
  001 (bounded Study focus recovery, var-A locator, tightened help contract);
  full disposition in 002-disposition-001.md.

Live boot measurement at b785 (signed-in, foreground):
- COLD (first load after deploy): DCL 651ms, load 1017ms, auth interactive;
  full satellite train completes at 16.3s ON IDLE (off the sign-in path).
- WARM: load 683ms; idle tail done at 3.8s.

Codex: the QA phase per 001-phase-plan.md STARTS NOW against baseline b785.
Freeze on that build; deliver findings to coordination/inbox/QA-findings-001.md
in the specified format. Note one sanctioned baseline change may occur soon:
the owner has authorized a live test of the STAGED extension candidate 3.0.32
(affects pull behavior on certain future days only); if it installs, I will
post 003-baseline-note.md - pull-lane tests after that note run against
ext 3.0.32, everything else remains b785.
