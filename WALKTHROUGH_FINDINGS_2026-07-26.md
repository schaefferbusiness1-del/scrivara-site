# WALKTHROUGH FINDINGS — 2026-07-26 late (companion to HANDOFF_GOAL_LANE_2026-07-26_EVENING.md)

```
origin/main   448b3a4   b703      live: mlsscribe.com = b703 (confirmed)
gate          356 registered, 355 PASS, exit 0 read before the b703 commit existed
extension     3.0.22 pong-verified installed on the owner's Chrome
```

I walked every dock destination and rail tab on the owner's live signed-in tab
with his real data (1,496 patients, 3,177 appointments, Bernard P Brooks active).

| surface | state |
|---|---|
| patientsView | works; **327 visible controls** — 150 Record + 150 delete, one pair per row |
| calendarView | 18 controls; continuity strip present; Jump lands correctly |
| visitView | 8 controls; banner-patient hero correct |
| ordersView (Review) | panel renders; gaps-first ordering intact |
| studioView | Analysis merge is LIVE — `nav_analysis` and `nav_studio` both land on Ask / Practice / Build |
| nav_recs, nav_history | inline `display:none` (role/feature gate). History is still reachable via "View completed notes" (`#ez3Hist`) on the visit home |
| nav_intake | element absent on this account |

**0 uncaught JS errors across the entire sweep.**

## Fixed during the sweep

**b703 — the patient banner stopped scrolling away.** `#mlsCtxBar` was
`position:static`; measured at scrollY 600 the patient name sat at `top:-186`,
off screen. It is now sticky under the sticky header, offset by the header's
real measured height (`--mls-hdr-h`, written only on change, install + resize,
no timer). Verified live: the name holds at `top:100` while scrolled.

Why it matters beyond cosmetics: the Review panel **deliberately** does not
repeat the patient name, on the documented argument that "the banner is
persistent, above every view." That argument was only half true while the
banner scrolled away — so on a laptop, or any review long enough to scroll,
the last human gate before Athena was anonymous. The fix makes the existing
decision correct rather than adding a duplicate chip back.

## The sweep's own false alarm, recorded

My probe reported "Review names the patient 0 times" and I nearly shipped a fix
for it. The omission is deliberate and correct; my probe had scanned only inside
`#ordersView`, and the banner lives outside that container. **Instrument
artifact, not a defect.** Checking the premise behind the decision — rather than
"fixing" the reading — is what surfaced the real static-banner bug.

## Open, ranked — for the next session

1. **150 delete buttons render simultaneously on Patients**, one per row, directly
   beside each row's Record button. A destructive control on clinical data,
   repeated 150 times next to the primary action, is both a misclick hazard and a
   direct violation of contract law 4 (secondary and destructive actions leave the
   surface). Suggested direction: row delete moves behind a per-row disclosure or
   the selection model; Record stays. **Deliberately not attempted — it needs a
   considered row redesign, not a quick hide.**
2. The four owner requests in §3 of the main handoff: the ask-bar overlap (NOT
   reproduced by probe — get a screenshot first), Copilot panel polish, the
   op-note reliability/quality/redesign workstream, and studio-merge route
   verification.
3. Surfaces not yet walked with real data: every Settings tab, Admin, Team,
   Intake, and every state of the Copilot panel.
