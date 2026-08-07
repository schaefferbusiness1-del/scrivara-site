# QA gate — closeout on b922 (2026-08-06, ~23:5x ET)

The owner's standing order: *"test every single feature added from my other tasks … on my live
browser all the way through, and if any don't work tell that session to fix the issue and don't let
it be done till I re-test it and it does work."*

Live went **b894 → b922** during the session (28 builds). Every result below was measured on the
owner's own signed-in Chrome, not from a suite.

## Final regression, live b922 — all green

```
48-cell op-note matcher matrix   PASS 48/48        (ninth consecutive build)
staleness sweep                  0 stale of 150 hand-maintained loaders
extension download               href .bin -> 419,620 bytes, download="…zip", no target
draft identity gate              raw byte-equality GONE, _normTpl comparison present
si-1.7.20 / av-5.4.0 / ad-1.1.3  all correct
templates                        96 intact
```

## Closed this session (each re-tested live before closing)

| item | cure | proof |
|---|---|---|
| `L4-5` selected **L3-L4**; bare `R` selected **Left** | b903/b904 | 48/48, ties 167/167 → 173 vs 168 |
| Word-junk template **could not draft at all** (b897 regression) | b905 | normalised compare; 90%-junk template drafted a 1,157-char note on a real patient |
| Extension download **410** in every browser | b919 | `.bin` mirror + refresher normalisation; sha256 matches released zip |
| `feat_mls_template_library.js` 38 bytes stale | b907 | build-number cache-buster; sweep clean |
| `feat_mls_copilot_actions.js` 27 bytes stale — a missing `appControl` guard silently sent the doctor to the **wrong screen** | b909 | guard present in served bytes; sweep clean |
| Avatar self-ending broken on 3 axes | b909 | `kioskStopBounded`, `kiosk.heard`, 3-attempt cap |
| Kiosk exit gate **failed OPEN** (roster exposed to a patient) | b902 | tri-state `pinSet = null` |
| Avatar deaf until it finished speaking | b918 | `echoCancellation`, mic opens WITH the question, true barge-in |
| Start button vanished with no patient | b916 | renders 209×36; click explains |
| Voices unlabelled | b917 | 8/8 carry male/female/neutral |
| Bottom search could not reach Copilot | b921 | Copilot row appended last on all 3 query shapes |
| Failed Athena read was **silent** | b920/b922 | 6px amber dot on `#mlsAccountMenuBtn`, 126×38, clears on next good read |

## Still open

- **`providerKey("Anh Do") === ""`** — a clinician whose two-token name contains a credential-spelled
  surname (Do, Pa, Rn, Od, Dc) can NEVER run a selected-provider pull. Pre-existing, app-wide blast
  radius, deliberately not folded into an mdx bump.
- **Performance** — his live complaint. Baseline, cache-independent: **10.72 MB payload · 8.54 MB JS
  across 220 files · 2.18 MB HTML shell · 103 render-blocking tags · `mls-connect.js` 2,995 KB**
  (35% of all JS). Only 2 of 230 tags use `defer`.
- **The build stamp** — see `one-stamp-in-165-places-collides-every-lane`. The single highest-value
  fix on the board.
- **Is `🔧 Troubleshoot Athena` still reachable?** Both elements carrying that text are unrendered.
  A synthetic click did not open the account menu, so this is unproven, not proven-broken.
- **Owner-gated:** ambient-listening consent wording; the test check-in on `p1781276119610hu0`.

## Owner-authorised test residue

Driving the "is it fake?" question to an answer required a real completed interview. It created a
**real check-in on a real patient** (`p1781276119610hu0`) with fabricated content (3-week back pain,
7/10, lisinopril). There is no delete route; `POST /api/avatar/checkins/:id/seen` only moves it out
of Ready. Flagged to the owner; his call between mark-seen and a purpose-built delete endpoint.
**Do not reach into storage.**

## The two findings that outlive the features

1. **`a-gate-that-stopped-looking`** — six suites in one night passed because they had stopped
   examining the thing they were named for. Cure: run the OLD code against the NEW test.
2. **`one-stamp-in-165-places-collides-every-lane`** — 9 mid-gate origin moves, 4 invalidated gates,
   3 deploy inversions (a lower build deploying later and silently reverting shipped fixes,
   both runs green), 2 red mains. None from two lanes touching the same feature.

## Instrument corrections made against myself

- `offsetParent` is `null` for `position:fixed` — my on-screen receipt was wrong; rects decide now.
- A page-context `fetch` rides the service worker; `curl` does not. Assert downloads **twice**.
- `.text().length` counts CHARACTERS, `wc -c` counts BYTES — a 346-unit gap is multi-byte UTF-8.
- A **literal grep cannot see a runtime-concatenated value**; my own check #1 for the extension fix
  would have produced a false negative and the ext lane caught it before I ran it.
- A hidden tab cannot judge focus, caret restoration, or latency. I withdrew a caret "confirmation"
  that could not have distinguished the defect from my own rig.
