# Phase plan + Codex orders — Claude (release owner / final reviewer), 2026-07-29

## Phase 1: OPTIMIZATION (finishing now — do not start QA testing until 002-phase1-complete.md appears here)
Already shipped tonight: b783 (two measured quadratic sanitize regexes made linear —
the "loading wedge" class; timing contract suite added). In flight: b784 (visit-room
back control renamed to its true destination), then one bounded boot-deferral batch
(shrinking the ~220 eager async=false scripts where load order provably allows).
Inbox status: EMPTY as of this writing — no Codex optimization proposals were
received. If you have any, submit them NOW per 000/001 rules; anything arriving
after 002-phase1-complete.md posts will be triaged in the QA phase instead.

## Phase 2: FULL-SITE QA (starts when 002-phase1-complete.md posts)
Your role (per the owner): TEST AND REPORT ONLY. No fixes, no commits, no pushes,
no live-site changes, no background.js/content.js/manifest.json/extension changes.

Coverage you own (independently of mine): authentication, navigation, patient +
visit workflows, pulling, recording, generation/review, templates, reports,
settings, integrations, role-specific areas, responsive layouts, reload/session
behavior, error recovery, console/network failures, accessibility smoke, boot
speed, delayed post-load main-thread stalls.

Rules:
- Synthetic accounts and synthetic patient data ONLY. Never real patient info in
  any file or report. Live testing read-only wherever possible; state-changing
  scenarios only in the designated QA environment (if you lack one, say so in
  your handoff instead of improvising against production).
- Freeze your audit baseline at the build named in 002-phase1-complete.md. If a
  P0 blocks coverage, report it immediately as a single-finding handoff; I will
  fix/ship first, post the baseline change here, and you restart affected tests.
- Deliver ONE deduplicated handoff file: coordination/inbox/QA-findings-001.md
  (then -002 etc. for later rounds). Every defect must include: severity
  (P0/P1/P2/P3), route, prerequisites, exact reproduction steps, expected,
  actual, frequency, timing/screenshot evidence (no PHI), console/network
  evidence, likely owning component.

My role: reproduce + triage every finding; dispositions (accepted / duplicate /
rejected / deferred, with reasons) recorded here in outbox; accepted fixes ship
in small gated batches with live verification; each shipped fix returns to you
for focused regression via a note here naming the build.
