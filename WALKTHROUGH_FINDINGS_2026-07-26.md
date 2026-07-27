# WALKTHROUGH — COMPLETE, 2026-07-26 (companion to HANDOFF_GOAL_LANE_2026-07-26_EVENING.md)

```
origin/main   3a5a7fc   b705      live: mlsscribe.com = b705 (confirmed)
gate          356 suites, exit 0 read before each commit existed
extension     3.0.22 pong-verified installed on the owner's Chrome
```

I personally walked **every surface this account exposes**, on the owner's live
signed-in tab, with his real data (1,496 patients, 3,177 appointments, Bernard P
Brooks active). **Zero uncaught JS errors across the entire sweep.**

## Every surface, and its verdict

| surface | verdict |
|---|---|
| patientsView | **defect found and fixed (b705)** — see below |
| calendarView | clean — 18 controls, continuity strip, Jump lands correctly |
| visitView | clean — 8 controls, banner-patient hero correct |
| ordersView (Review) | clean — gaps-first ordering intact, no controls in the panel |
| studioView | clean — Analysis merge live; `nav_analysis` and `nav_studio` both land on Ask / Practice / Build |
| Settings — all 7 tabs | clean — Account, Practice, Notes & AI, Display, Features, Integrations, Advanced. No empty panes, no `undefined`/`NaN`/`[object` leaks |
| Copilot panel | clean — opens, 460px, no horizontal overflow, 7 chips, bubbles have 24px/14px gutters, closes by slide-out, **0 click interception when closed** (measured at 15 points) |
| History | reachable via "View completed notes" (`#ez3Hist`); its rail tab is feature-gated |
| Team / Admin / Recs | feature-gated (`display:none` inline). Team is the documented held workspace |
| Intake | element absent on this account |

## Defects found and fixed during the walkthrough

**b703 — the patient banner scrolled away.** `#mlsCtxBar` was `position:static`;
at scrollY 600 the patient name sat at `top:-186`, off screen. This mattered
because the Review panel **deliberately** omits the patient name, on the argument
that "the banner is persistent, above every view" — an argument that was only half
true while the banner scrolled. On a laptop or any long review, the last human gate
before Athena was anonymous. Now sticky under the header, offset by the header's
real measured height (`--mls-hdr-h`, written only on change, install + resize, no
timer). **Verified live: the name holds at `top:100` while scrolled.**

**b705 — 150 delete buttons on one screen.** Patients rendered 327 visible
controls: 150 Record and 150 delete, one destructive pair per row, the trash
immediately beside the primary action on clinical records. `deletePatient()`
confirms first, so this was never silent loss — it was 150 chances to open a
destructive dialog by mistake, and contract law 4 in plain violation.
Delete now answers to **reach**, with one route per input method: hover (mouse),
`focus-within` (keyboard), `.active` (touch — tapping a row selects the patient and
that row keeps its delete). `visibility`, not `opacity` — an `opacity:0` control
still hit-tests, which is how an invisible toast ate dock clicks at b678.
**Verified live: 327 → 178 controls, delete 150 → 1, all three routes proven,
Record untouched at 150.**

## Two false alarms, recorded — neither shipped as a "fix"

1. **"Review names the patient 0 times."** The omission is deliberate and correct;
   my probe had scanned only inside `#ordersView`, and the banner lives outside
   that container. Checking the *premise* behind the decision, rather than
   "fixing" the reading, is what found the real b703 bug.
2. **"The Copilot drawer didn't close."** It had `transform: translateX(469px)` —
   sliding out correctly. My visibility test didn't account for off-viewport
   translation. A follow-up measured its 6px residual sliver at 15 points: **0
   interceptions.** No fix shipped.

## Owner's continuity law — PROVEN END TO END

*"PATIENT TO CALENDAR TO VISIT should all be on top banner patient."*

- **Patient** → banner carries Bernard P Brooks; Patients rows follow selection
- **Calendar** → continuity strip names him, shows his next appointment (2026-07-27)
  out of the same store the grid renders, and "Jump to it" lands on Monday July 27
  with his 7:30 AM row first — **on the first click**, and it stays (b699 + b701)
- **Visit** → with him active on an empty day, the primary IS him:
  "Start Recording — Bernard P Brooks" (b693)
- **And now the banner never leaves the screen** (b703), so the through-line holds
  on every view at every scroll position.

## Remaining (owner-facing, not defects I found)

- Copilot's **visual** upgrade ("much better, more pretty") — functionally clean,
  aesthetically untouched by me.
- The **op-note workstream**: reliability, content quality, and a from-scratch
  redesign of the drafter and Template pages. Needs its own lane and an owner
  check-in on direction.
- Ask-bar overlap: **fixed by a parallel lane at b704** (three stacked defects;
  see that lane's notes).
