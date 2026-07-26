# The Button-Liberation Contract — 2026-07-26

Owner's words, verbatim, the entire brief:

> "i LOVE THE NAVIGATER BUT I BASICALLY HATE HOW MANY BUTTONS EVERY SINGLE UI
> ANYTHING HAS COMPLETLY CHANGE IT ALL FROM SCRATCH. I WANT IT TO FREE DOCTORS
> FROM BUTTONS AND JUST BE ABLE TO BE USED BY ANY DOCTOR WITH 1 MUINIT OF
> LEARNING"

## The law

1. **The dock is untouchable.** Day · Patient · Visit · Review · AI Studio ·
   Tools · Copilot · Ask. It is the whole navigation story. Nothing else
   navigates.
2. **One primary action per screen state, rendered as the one big obvious
   thing.** The model is the visit hero (`#ez3Nxt` — "🎙 Start Recording —
   Dawn I Jenkins"): big, named, pre-loaded with the right context, impossible
   to miss. Every screen gets its `#ez3Nxt`.
3. **A doctor's next step must always be the biggest thing on screen.** If two
   actions compete, the screen is wrong. State decides: nothing recorded →
   Record is primary; transcript exists → Generate note is primary; note
   exists → Review & send is primary.
4. **Everything else leaves the surface.** Secondary/rare actions live in
   Tools (the dock menu) or answer to Ask/Copilot. They are NOT deleted:
   class-hide only (available() reads inline display — an inline hide
   silently removes a feature; tests/shell-hidden-controls-keep-reach
   enforces the route back).
5. **Zero floating anything.** The bubbles are gone (vc-2.0.0). Nothing new
   ever floats over content. Fixed chrome = the dock, full stop.
6. **No blocking dialogs for information.** Confirm ONLY destructive or
   clinical-outbound acts (delete, send-to-Athena, sign). Everything else is
   inline, undoable, or a toast.
7. **The 1-minute test is literal.** For each rebuilt screen, write the
   walkthrough in ≤6 steps where each step's target is the biggest visible
   thing. If a step needs explaining, the screen failed.
8. **Text budget:** headers ≤3 words; buttons = verb + object ("Start
   recording", never "Click here to begin your recording session"); empty
   states = one sentence + the primary action.
9. **What already passed the owner's bar stays:** the dock, the visit hero,
   the Review panel's three rules (gaps first, reads _athenaBuildPlan(), NO
   controls inside), the prep rows on the patient card (the pre-visit brief
   is the reason the page exists), privacy/terms (SHA-pinned, frozen).
10. **Truth rules survive the diet:** never state a negative the system
    cannot back ("—", not "None"); success is asserted only on receipts;
    errors name a route that exists.

## Non-negotiable mechanics (each has bitten)

- Verify on the RUNNING page. CSS is concatenated — grep can't see resolved
  selectors; walk document.styleSheets.
- Top-level `let` in ScribeFlow.html is not on window.
- Never proxy trusted-gesture controls (isTrusted gates refuse `.click()`).
- Hide by class; every hidden control keeps a Tools route.
- `node --check` after every JS edit; full `node tests/run-all.js` green
  before declaring anything done; pins updated deliberately, never deleted.
- background.js is not yours (byte-edit-only, extension domain).
- One concern per commit. Local commits only — the lead ships.

## Ownership map (no overlapping edits)

| Worker | Owns | Must not touch |
|---|---|---|
| D | visitView, patientsView (+ their feat modules/CSS) | theme tokens, other views |
| E | calendarView, ordersView, historyView, analysisView, studioView, teamView, intakeView, adminView, settings surfaces, all modals/popups | visitView/patientsView, theme tokens |
| F | theme layer only: dark-theme's 98 light panels, ONE heading system, the dock-derived radius scale (22/16/10/999) | per-view layout, feat module logic |

Cross-view primitives (buttons, cards, inputs) follow F's tokens; D and E
consume them, never fork them.
