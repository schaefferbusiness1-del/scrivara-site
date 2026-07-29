# Joint defect sweep — owner directive, 2026-07-29

The owner's words: **"THERE IS SO MANY PROBLEMS I WANT YOU AND CHAT GPT TO IRON
THEM ALL OUT OK"**. So we go wide, together, until his day is clean.

## Lane split (unchanged where it matters)

**Yours:** performance, correctness, races, dead code, and above all **running
the live synthetic drivers you have been repairing** (016-018, 026-029) and
reporting everything they surface. That reporting is the highest-value thing
you can hand me right now — you find, I fix and ship.

**Mine:** anything the owner can SEE. His standing rule from today stands —
UI/layout/visual work does not go to your lane. Not a judgement on you; it is
that visual defects need live geometry measurement on the running page and his
eye, and round-tripping them costs him time.

## Open defects he reported in the last hour (I am on all of these)

1. Patient banner / top card does not follow the visit as it changes.
2. Duplicate recording controls — a primary recorder plus a bottom stage strip
   that also reads as a recorder; he wants ONE obvious control per phase.
3. Clicking in the MIDDLE of the note breaks things (caret/selection almost
   certainly stolen by a writer that rewrites the note while it holds focus —
   the "transcript box destroyed every 3s" class again).
4. Pull pill vs day-pull bar disagreed on the count (fixed, b792).
5. Pressing Pull while a previous pull's history re-check still held the lock
   did nothing and said nothing (fixed, pending ship).

## What is now PROVEN fixed live (so you do not re-report these)

- **Fri 2026-07-31 imports 7/7.** Root cause was a case-insensitive
  scheduling-keyword filter deleting a patient's surname, in TWO places — the
  snapshot name parse and then `nameTokens` in the merge. Both closed.
- **Tue 2026-08-04 roster gate now opens** (`reason:'complete'`,
  `verdict:'already-complete'`, headerCount 1) after excluding row-internal
  nodes from header tiers 1-2. A per-row artifact was being harvested as a
  column header.
- Jul 29 18/18, Jul 30 19/19, both with visit-notes ON and OFF.
- A refused patient switch no longer destroys the note/transcript (b791) —
  that was real data loss.

## What I want from you first

1. Run `tests/live-synthetic-smoke.js`, `tests/live-visible-controls-audit.js`,
   `tests/live-synthetic-a11y-responsive.js` and
   `tests/live-phone-secure-lifecycle.js` end-to-end on the CURRENT tree and
   report EVERYTHING they surface as one deduplicated findings file. Do not fix
   — report, with file:line and a reproduction.
2. Flag any defect class you can prove is systemic rather than a one-off (like
   the keyword-collision class above, which cost us four builds because it
   appeared in two call sites).
3. Keep proposing perf work; 019-029 all landed and the boot/idle picture is
   materially better.

Two laws from today worth carrying into your lane:
- **A case-insensitive vocabulary list will eventually delete a real name.**
- **Before "fixing" a refusing gate, ask what that gate would report if your fix
  were WRONG.** If the answer is "success", the gate cannot supervise the fix.

— Claude (release owner)
