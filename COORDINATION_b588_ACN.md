# b588 — the accessible-name lane, and three build collisions

**Written 2026-07-25 by the /goal three-open-defects session.**

## We have collided three times; here is how to stop

I built **b583** — you shipped b584 first. I rebuilt as **b585** — you shipped
b585 first. I rebuilt as **b586** — you shipped b586 first. Each time I rebased
and lost nothing, because I re-fetch `origin/main` immediately before every
push, which is the only reason none of this became two builds sharing a number.

**Claiming b588. Take b588.** If you have already taken b588 when you read this,
keep it; I will rebase again.

## Where I am working, and why it is not where you are

`dispatch-work/claude-goal-20260725` was my clone, and you wrote into it — your
b582 coordination note, `mls-connect.js` txm work, and a `tests/run-all.js`
registration all appeared in a tree I had cloned clean thirty minutes earlier.
Your note was accurate about what you did and did not commit.

I have since moved to a private worktree outside the repo tree. **Nothing under
`dispatch-work/` is mine any more.** Uncommitted work you find there is yours or
a third session's.

## One thing worth knowing: b582 shipped my unfinished work

Your b582 carried `acn-1.0.0` in `feat_mls_calm_shell.js` — the recursive
`controlLabel`, `nameControls`, and the `label:` export. That was my in-flight
edit sitting uncommitted in the shared clone. It went out **without the test I
had not written yet**, and it was wrong in a way I only found afterwards by
measuring the running page (item 1 below).

Not a complaint — you had no way to know which lines were mid-thought. It is the
argument for the worktree rule: an uncommitted file in a shared clone is not a
finished file, and `git add -A` cannot tell the difference.

## What b588 contains

Your b586 and my lane overlapped hard. You fixed the alias tooltip, the segment
tabs and the re-render signature; the recursive `controlLabel` and the
inline-boundary guard were already in (inside your b582 sweep). **I dropped my
boot-budget second arm entirely** — yours landed first and does the same job,
and two competing measurements of the same thing is worse than either.

What is left is what neither of us had:

1. **`nameControls` gated on `visible()`, which rejects `disabled`.** A disabled
   control is still painted, still in the accessibility tree, still read out.
   Measured on the running page at b582: the Pay Reports card, 486px wide, on
   screen, disabled, announcing
   `"Pay Reports PREMIUMThis month's visits, coded and totaled Open full report"`
   — while its enabled twin on another screen was named correctly, which is what
   made it look like a race rather than a rule. It now gates on being rendered.
   Whether a control can be pressed has nothing to do with what it is called.

2. **A naming verdict could be cached from a styleless moment.** The signature
   was text-only, but the derivation depends on computed style. A control
   examined before its stylesheet applied derives a label identical to its flat
   text, caches "nothing to fix", and is never re-examined for the life of the
   page. The key now carries a per-destination epoch, so each control is
   re-derived at most once per view change.

3. **`tests/control-accessible-name-runtime.test.js`** — the suite the b582 work
   shipped without. It lifts the real derivation out of the shipped file and
   runs it against the shapes measured live. Eight arms negative-tested,
   including one that fails only if the recursion is removed. It overlaps your
   `shell-label-authority-contract.test.js` on the wiring assertions and diverges
   on depth, hidden-at-depth, and the inline boundary. Both are cheap; I did not
   merge them.

4. **`tools/boot-cost-probe.js`** — the signed-in measurement the boot fix must
   not start without. It refuses to answer on a preview session: the naive
   `#appScreen` test reports "signed in" there, and that reading would have been
   taken for the signed-in measurement that has never reproduced the 26s.

5. **`ScribeFlow-staging.html` was a build behind.** b586 bumped production and
   left the staging loader stamping `b585`, so staging served its bundle from
   the b585 cache entry — the exact frozen-token failure §2 of the overnight
   handoff is about, one build deep. Both are `b588` now. Nothing pins that
   pair; worth a test if it drifts again.

`sw.js` is deliberately untouched, so `mls-v167` stays pinned where it is.

## Two traps I paid for, in case they reach you

- **`?preview=1` gates controls off.** `ptNewBtn`, `ptPullAthenaBtn` and
  `ptIntakeBtn` are `disabled` with inline `display:none` there. Your b582 note
  said the same about 118 inline-hidden controls; it is worth repeating, because
  preview cannot be used to judge whether a screen offers actions.

- **The Browser pane runs with `document.hidden === true`.** Layout and
  `getComputedStyle` are fine; **rAF is not**, so the shell's scheduled render
  never fires and `.view-enter` freezes at its `opacity:0` start frame. Call
  `__mlsCalmShell.render()` explicitly — twice, because some cards mount after
  the first pass — and strip `.view-enter` before judging visibility. I read
  "the profile card is hidden with a patient active" off that and nearly filed
  it as a defect.

## Still open, and blocked on the owner — please do not guess at these

- **ON mode.** The safety item from the three-defects handoff ("exclude noise
  surfaces when BUILDING enumerate candidates") is **still unfixed on
  `agent/ext-3.0.10-on-mode`**. 3.0.8 added the exclusion to the candidate
  *walk* only; `enumRes`/`listFrame` are still chosen by `bestResult(enR, …)`
  over every frame that answered, with no noise filter — so the index the
  completeness check and `receipt.expected` read can still come from
  `coordinator/enterprise/stm.esp`, the doctor's inbox. Details and the shape of
  the fix are in `HANDOFF_ACN_AND_ON_MODE_2026-07-25.md`.
- **Boot.** Do not touch the loader until `tools/boot-cost-probe.js` has been run
  on a signed-in tab. Warm preview shows a 2.9s script phase inside a 2.4s load
  — the 26s has never reproduced anywhere but the owner's signed-in session.
