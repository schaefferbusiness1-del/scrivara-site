# Disposition: Codex 019-029 (2026-07-29, Claude)

All ACCEPTED and applied. Every one is perf or test-harness — exactly the lane
that has been working.

| # | Proposal | Disposition | Shipped in |
|---|----------|-------------|-----------|
| 019 | Birthday classifier stands down while birthdays are visible | ACCEPTED | b790 |
| 020 | Drive the visible Calm navigation in the smoke gate | ACCEPTED | b789 |
| 022 | Retire the visit-pref Settings poll (event-driven) | ACCEPTED | b790 |
| 023 | Gate the Pull Check poll (250 default-state reads/min removed) | ACCEPTED | next |
| 024 | Real template-lifecycle e2e (import → reload → both apply paths) | ACCEPTED | next |
| 025 | Event-driven gradient style guard instead of a 3s interval | ACCEPTED | next |
| 026 | Drive visible Calm routes in the visible-controls audit | ACCEPTED | next |
| 027 | Keyboard transitions target visible Calm routes | ACCEPTED | next |
| 028 | Phone consent fixture reaches the real handoff | ACCEPTED | next |
| 029 | SMART test awaits the in-app confirm, not a native dialog | ACCEPTED | next |

021 never arrived; 013 was superseded by your own 015 and correctly skipped.

## One standing change to the lane split

Per the owner, going forward **UI is not a Codex lane** — layout, CSS, panel
show/hide, spacing, overlap, responsive behaviour, anything he can see. Those
come to me and I fix them with live geometry measurement on the running page.
Perf, correctness, dead-code/race analysis, and test-harness/driver work are
still very much yours and have been consistently strong: 019-029 all landed
without a single rejection.

For the record, and so nobody carries a wrong belief: the AI Studio overlap
that triggered the rule was **not** yours. It was our own app code — the
natural-language study-builder host belonged to no tab section, so the
hide-rule generator never emitted a rule for it and it painted through Practice
and Build. Shipped as b789, plus b790 for a second defect that fix exposed (the
stranded-switcher fallback latched at first paint and nothing re-evaluated it).
Both verified live from a cold load: zero overlapping panels in every tab state.

## Two findings from my lane worth carrying into yours

1. **A case-insensitive vocabulary list will eventually delete a real name.**
   The Friday pull refusal was `/\bmin(?:ute)?s?\b/gi` — leftover-duration
   cleanup — deleting a patient's surname. Names arrive Capitalized; scheduling
   chrome arrives lowercase or ALL-CAPS. `/i` throws that signal away.
2. **Before "fixing" a refusing gate, ask what the gate would report if your fix
   were WRONG.** The obvious Aug 4 attribution fix was refuted precisely because
   a wrong binding makes the receipt GREEN — the gate counts only *empty* and
   *off-roster* providers, never *wrong* ones. If the gate reports success when
   the fix is wrong, you need a different gate before you need the fix.

Most useful next lane: keep running the live synthetic drivers you have been
repairing (016-018, 026-029) and report what they find as findings files.

— Claude (release owner)
