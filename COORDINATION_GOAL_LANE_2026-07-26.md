# COORDINATION — goal lane, 2026-07-26 (started ~10:36 AM)

**Session:** full-ownership release mission (audit / redesign / test / publish / validate).
**Checked at start:** all other sessions report `isRunning:false` — QA lane stopped 10:21 AM,
phone-app lane stopped 10:18 AM. Nobody else is moving.

## Claimed work

1. **The uncommitted b671 watchdog fix in THIS lane's `ScribeFlow.html`** (97 insertions,
   `sfArmGateWatchdog` — the stuck-loading-screen P0). The QA lane wrote it and stopped
   before testing/shipping. This lane is completing it: pin test (both directions), full
   gate, bump to b671, ship, live verification. Attribution to the QA lane preserved in
   the commit message.
2. After b671: audit fan-out (app views, public pages, extension surfaces, responsive),
   the four `mls-connect.js` idle timers (§2.1 of HANDOFF_QA_LANE_2026-07-26.md),
   defect fixes / weak-page rebuilds, E2E reruns, final release + report.

## Ground rules I am following

- Verify on the RUNNING page, never the served file.
- Never re-open items in HANDOFF_QA_LANE_2026-07-26.md §3 (closed, verified).
- `background.js` byte-edit only; build bumps boundary-anchored; no deploys during a live pull.
- Hard stops: orders, real-patient writes, payment PRs. Writeback tests only Adam J Schaeffer.

## Build ledger (this lane)

| build | what | status |
|---|---|---|
| b671 | gate-loading watchdog (`sfArmGateWatchdog`) — loading screen must always end | LIVE, clean-state verified (Worker C) |
| b672 | pts-rowguard-2.0.0 (generation rule + pull shield) + sv-1.1.1 re-save cooldown | LIVE, clean-state verified (Worker C) |
| b673 | AI Studio dock destination (owner directive) | LIVE, clean-state verified (Worker C) |
| b674 | ext 3.0.21 (sfp-1.0.0/1.0.1 schedule freshness, Worker B) — zip byte-verified 60cb01b9… | LIVE; NOT yet pong-verified on a running machine |
| b675 | churn: paintFab/paintChip re-decoration wars end (Worker C); timer-brief corrections | pushed, deploy pending |

## Waiting on the owner (live-session steps)

1. Tab identification (Chrome connection is ACTIVE; group tab created; none of the owner's tabs touched).
2. Install/refresh ext 3.0.21 → pong must report 3.0.21.
3. Three-arm freshness live test (§6.2 of WORKER_B_EXT_REPORT_2026-07-26.md).
4. Read `window.__mlsPtsRowGuardLog` + `staleRisk` on the owner's tab during a real pull (save-loss live confirmation).
5. Identify the "top Start recording extra button" on the owner's real layout before removal (preview hides the dock and reflows; refusing to guess).
6. Confirm retirement of the bottom-left "Voice & assistant" floating cluster (screenshot suggests it duplicates dock routes; b669 furniture-clearance test must move with it).

## Escalated by Worker B (not yet fixed — queued)

Six handOff-class false-success defects, worst: mls-popup.js:236 unconditional
"✓ Draft written"; feat_mls_status_center.js:817 renders a wrong-patient sign
REFUSAL as green (root cause background.js:11814). Two lying strings:
keep-alive `armed:true` after injecting a no-op; background.js:10915 announces
a "freeze-guard reload" that does not exist.

If you are another session reading this: announce yourself here before editing
`ScribeFlow.html`, `mls-connect.js`, or `tests/` in this lane.
