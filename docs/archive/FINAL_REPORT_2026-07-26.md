# Release Report — 2026-07-26 goal session (LIVING DOCUMENT — final after D/E/F integration)

Owner's brief: full ownership — redesign, repair, optimize, live-test, publish,
validate. Mid-session directives, all owner-verbatim: remove the bottom-left
bubbles; remove the top Start-recording extra button; add AI Studio to the
dock; fix the extension Settings text and badge; combine the three visit chips
into one; free doctors from buttons (dock stays); a history pull that never
fails and is still fast is the release bar; UI before extension.

## Builds shipped and live (each: 335→338-suite gate green, deployed, verified)

| build | what | live verification |
|---|---|---|
| b671 | Gate-loading watchdog — the loading screen ALWAYS ends; fails closed to sign-in | clean-state (Worker C) + owner-tab |
| b672 | pts-rowguard-2.0.0 (generation rule + pull shield) + sv-1.1.1 re-save cooldown — saves stop vanishing | clean-state + live rowGuardLog active + 2 loss-free pulls |
| b673 | AI Studio becomes a real dock destination | owner-tab screenshot |
| b674 | ext 3.0.21 published (schedule freshness receipts sfp-1.0.0/1.0.1) | zip byte-verified 60cb01b9…; installed + pong-verified |
| b675 | Idle churn: paintFab/paintChip re-decoration wars end (29→2 element-writes/20s) | clean-state + measured |
| b676 | Bubbles retired (vc-2.0.0) + record pill only Pause/Resume + Worker A contrast pass (2 new gates) | owner-tab screenshot |
| b677 | Extension badge compares installed↔channel; maintenance text + feed notes doctor-honest | owner-tab: "Installed: v3.0.21 — up to date" green |

## Extension: 3.0.18 → 3.0.21 on the owner's machine, zero owner action

The owner was RUNNING 3.0.18 (3.0.19/3.0.20 published but never installed — the
"published ≠ installed" gap nobody was watching). Proven protocol: audit the
enabled folder → push bytes → bridge reload → reload tabs → **pong 3.0.21**.
sfp-1.0.0 validated live: `liveSessionProven:true` via athena-frame-load on a
healthy pull; a signed-out athenaOne is now named, stale grids are disclosed,
`complete` untouched.

## The release criterion: history pull never fails, still fast — LIVE-PROVEN

- Run 1 (b675 page, ext 3.0.21): Tue Jul-28, **21/21 done, day ledger complete,
  ~9.5s/patient, 0 failures**, no staleness flag.
- Run 2 (b677): same day re-pull, **21/21 done again, ~7.9s/patient, 0
  failures**, idempotent (no duplicates), ledger rewritten with fresh receipts.
- Arm A control: empty Sunday reads authoritative-empty complete, fresh.
- ON-mode correctness was already closed at 3.0.18–3.0.20 (live 5/5, 47 bodies,
  coverageComplete on all — Worker B verified from the tip, not the brief).

## Test infrastructure

- Gate: 335 → **338 suites** (gate-loading-always-ends; schedule-read-declares-
  its-freshness 13/13 mutations; Worker A's two contrast/semantics floors) — every
  new gate proven in BOTH directions (fails on the regression, passes on the tree).
- E2E: **30/30** at b671, b673, b677 (three runs) + two instrument fixes
  (dock-walking long-press; overflow canary waits out the loading gate).
- Corrected records: timer-fleet brief marked superseded (shim-attribution
  artifact; observer fix disproven by measurement); HANDOFF §2.1 corrected.

## In flight (integration pending — this section becomes final results)

- Worker D: visitView + patientsView rebuild + the ONE combined voice control
  (expand-never-decide, inline, hot-mic visible).
- Worker E: calendar/settings/secondary views + app-wide dialog sweep.
- Worker F: dark theme completion (98 light panels), one heading system,
  dock-derived radius scale.
- After UI lands (owner ordering): ext 3.0.22 — six handOff-class false-success
  defects (worst: mls-popup.js:236 unconditional "Draft written";
  status_center wrong-patient refusal rendered green; root background.js:11814)
  + two lying strings (keep-alive armed:true no-op; phantom "freeze-guard reload").

## Noncritical known limitations (current)

- Freshness Arm B/C (>15-min stale grid; signed-out disclosure sentence) not yet
  observed live — mechanism validated via Arm A + 13-mutation gate; firing
  frequency depends on athenahealth's expiry behavior.
- E2E suite still not in run-all.js (deliberate: 3 of the 10-green-builds
  criterion; MLS_E2E_REQUIRED=1 must accompany registration).
- `#noteCard` with a real loaded note remains unmeasured (pre-existing gap).
- Boot TBT ~1.9s (4 long tasks) — boot path untouched by instruction (highest
  blast radius); load itself 1720ms, −52% vs the b569 baseline.
