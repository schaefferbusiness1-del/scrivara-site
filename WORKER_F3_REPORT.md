# WORKER F3 — motion report, 2026-07-26

**Lane:** F3 (motion, second pass). **Deliverable:** local commits + this report. **Never pushed.**
Base: `origin/main` @ `4697819` (**b700**). Started at `9f56613`/b692 and rebased **five times**
mid-run: main was being pushed every minute or two (b693 → b694/b695 → b696 → b698 → b700) while
a full gate run takes about two minutes, so `tree-contains-everything-published` kept refusing
the tree — correctly, and never because of anything in this branch. Every measurement below was
re-run on the final base. All five commits rebased cleanly onto every new main, with no conflicts.

Branch: **`worker-f3-motion`**, worktree `dispatch-work/worker-f2-motion`.

Gate: **355/355 green, run clean, no `MLS_ALLOW_STALE`** at the tip. (The total grew from 353 as
other lanes landed suites; one of the 355 is mine.)

One upstream red was seen and NOT fixed by me: b696 shipped `border-radius:9px` on
`#studioSavedFilter`, failing the radius-scale suite. It is not in my diff, and upstream fixed it
themselves two commits later in `b698: the creations filter uses the radius scale`. Recorded only
so the lead knows main was briefly red on its own.

---

## 0. THE BRIEF WAS ALREADY BUILT — AND THREE OF ITS SURFACES DID NOT MOVE

The brief said a prior instance "died before committing" and to start clean. That was wrong in a
way worth recording: `worker-f2-motion`'s tip **was the merge-base with `origin/main`** — F2's
five commits were already merged and main had moved 20 commits past them. Nothing was lost and
nothing needed redoing. Checked before touching anything; had I taken the brief literally I would
have rebuilt work that was already live.

So items 1, 2, 4, 5, 6, 7 and 8 were shipped. What I found instead is that **three of the
surfaces the brief lists as done have motion that is correctly declared and never executes.**
All of them passed every motion suite, because every motion suite reads declarations.

| brief item | reported state | what the running page did |
|---|---|---|
| 3. stage rail glides | "already glided, dots transition at 0.26s" | **0 animations.** The rail snapped. |
| 5. Copilot slide+fade | "CSS correct, runtime unverified" | **First open did not move at all.** |
| 7. one vocabulary, audited | tokens hoisted page-level at b680 | **The motion block was inside `@media (max-width:760px)`.** |

Owner's directive was "much more pretty and apple like animations — make motion FELT." On the
Visit screen, which is where a doctor lives, the felt reality was: the progress rail jumped, and
the assistant panel appeared without sliding the first time you ever opened it. Those are the
three things I fixed. I added no new vocabulary.

---

## 1. HOW THIS WAS MEASURED

My own Chrome, never the owner's: local static server → `ScribeFlow.html?demo=1` → on-device
demo signup → probe, headless, throwaway `userDataDir` under the OS temp, deleted on exit.
1440×900 — a real viewport, because at the default 0×0 every height lies. Worker A's settle
recipe (`showView` → 700ms → `getAnimations().forEach(a=>a.finish())` → 150ms).

Probes in the session scratchpad `.../scratchpad/wf3/`: `harness.js`, `p1-stagerail.js`,
`p2-cssom.js`, `p3-shellscope.js`, `p4-verify.js`, `p5-copilot.js`, `negtest.js`, `shots.js`.

**The decisive technique** for defects 1 and 2 was not reading computed style — computed style
reports the *declaration* and says "0.3s" whether or not anything ever moves. It was:

- **stamp the nodes** (`dataset.f3`), change state, count survivors → proves node replacement
- **sample `document.getAnimations()` every 20–25ms** through the change → proves execution
- **sample the computed matrix** and count *distinct* values → proves a curve, not a jump

**Instrument faults — three, all caught before they became findings:**

| # | Looked like | Actually was |
|---|---|---|
| 1 | the stage-rail probe crashed on `barI.style.width` | I read `.style` off a **computed style**, which has no such property |
| 2 | "the reduced-motion kill switch does not exist — 0 rules" | my walker unwrapped `CSSMediaRule`s, so the condition text was on the *parent* and never in the inner rule's `cssText`. Dumping the structure instead of pattern-matching it showed 5 such rules |
| 3 | **"reduced motion is ignored — the Copilot drawer still glides"** | `p5-copilot.js` called `boot({})` unconditionally and never read `MLS_REDUCE`. I had run the normal case twice. Re-run properly: 2 positions, no midpoint, 0.001s |

Fault 3 is the one to remember. It was one edit away from being reported as a law-4 violation.

---

## 2. DEFECT 1 — THE VISIT PROGRESS RAIL HAD NO MOTION AT ALL

`Prep · Record · Review · Sign · Send` declared transitions on `.dot` (transform, background,
border-color) and on the connector fill. Neither had ever run.

`renderStages()` rebuilt the rail with `el.innerHTML = parts.join('')` on every stage change,
creating nine fresh nodes with their final classes already applied. **A CSS transition needs the
same element to still be there when the value changes.** New nodes have no previous value, so
every transition on that rail was dead CSS.

Driving a real Prep→Review change, sampling every 25ms for 3s:

| | before | after |
|---|---:|---:|
| animations observed on the rail | **0** | **8** |
| stamped nodes surviving the change | **0 / 9** | **9 / 9** |
| distinct `scaleX` values on a connector | — | **22** (0 → 1) |
| passed through a midpoint | — | **true** |

The fix is `buildStages()` (nodes once) + `paintStages()` (classes and one transform only, both
writes guarded — `classList.toggle(name, force)` does not re-commit, `add`/`remove` do, and this
runs on the shell tick).

**The connector also stopped animating `width`** — a layout property, against law 1, a reflow
every frame. Now `width:100%` + `transform:scaleX(0→1)` from the left edge, composited,
`--mls-dur-4 --mls-ease-out`. F2's report called this fill "dead code (nothing sets that width)";
`renderStages` did write it, inline, on every rebuild. It was never *seen* because of the rebuild
above — the law-1 violation and the missing motion were **one bug wearing two faces**.

The dot moved to canonical tokens with a real `--mls-ease-spring` on its transform (the stage
that becomes `now` was summoned, so it overshoots ~1% and settles), colour stays linear (a colour
that springs reads as a flicker), and `box-shadow` joined the transition so the ring **blooms**
with the scale instead of snapping a frame ahead of it.

First paint still lands instantly — opening a visit shows the rail's true state rather than
replaying it. Only later changes transition.

---

## 3. DEFECT 2 — THE MOTION SYSTEM WAS TRAPPED IN THE PHONE QUERY

`feat_mls_calm_shell.js` opens `@media (max-width:760px){` for its phone layout and closed it
with `'#mlsStages .bar{display:none}}'` **at the very end of the CSS array**. Everything appended
in between was therefore nested inside the phone query. The motion system was appended in between.

Resolved through `document.styleSheets` on the running page (grep cannot see these selectors —
they are built by string concatenation):

```
143 rules in the shell sheet · 121 page-level · 14 trapped at max-width:760px
5 of the trapped rules were motion:
   #mlsRightNow:not(.empty)                    the mlsMoRise entrance
   #mlsDock/#mlsRightNow/#mlsStages button     colour transitions
   the .mls-mo standing prohibition            A SAFETY RULE — it forbids entrance
                                               animations inside hosts that rebuild on a
                                               timer, and it protected only phones
   the reduced-motion kill for the above

#mlsRightNow at 1440px   before: animation-name none
                          after: animation-name mlsMoRise, 0.3s
```

`MOTION_TOKENS.md` has claimed "right-now bar — rise on summon" since b680. On a desktop that was
never true. The close-brace moved up to where the phone rules actually end; **no rule text
changed, only where four of them live.**

---

## 4. DEFECT 3 — THE COPILOT DRAWER DID NOT SLIDE THE FIRST TIME

F2 shipped this "correct by inspection, runtime unverified" because no opener was reachable from
the demo harness. It is reachable — `openCopilotDock` is a top-level *function declaration*, so
it **is** on `window` (unlike a top-level `let`).

`openCopilotDock()` created the drawer, appended it, and added `.open` in one synchronous block —
no computed starting style, so it jumped to its end state.

Sampling computed transform + opacity every 20ms:

| | before | after |
|---|---:|---:|
| **first** open, distinct positions | **1** (`0px, opacity 1`) | **22** (`469px → 0`, `0 → 1`) |
| second open, distinct positions | 22 | 23 |

Every open but the first was already beautiful. The first one — the only one that forms an
impression — did not move.

Fixed with one forced style read, gated on first build. **Deliberately not
`requestAnimationFrame`:** rAF does not fire in an occluded tab, so deferring the class would
leave the drawer **shut** rather than merely un-animated. The class still lands synchronously, so
"never animated" and "finished" end in the same place — the un-strandable property, which is the
law that keeps getting broken here. Mirrored into `ScribeFlow-staging.html`.

---

## 5. THE GATE — PIN THE MECHANISM, NOT THE DECLARATION

`tests/motion-that-cannot-run-is-not-motion.test.js` (new, registered in `run-all.js`).

Every prior motion suite reads declarations, which is exactly why all three defects were green
the entire time they were broken. This one pins the three mechanisms that let a declaration run:

1. **scope** — brace-balances the shell's CSS array over its *string literals* and asserts depth
   0 at the motion marker (comments in that file quote CSS, so they are stripped first; counting
   them was the obvious wrong way to write this). Also asserts the phone breakpoint still exists
   and still closes on the connector rule, so a drifting brace cannot silently re-nest again.
2. **the stage rail** — `renderStages` must not assign `innerHTML`; `paintStages` must use
   `classList.toggle`; `buildStages` must survive; the connector must start at `scaleX(0)` and
   must not return to `transition:width`.
3. **the Copilot drawer** — on **both** pages: a flush must exist, be gated on first build, and
   come *before* `.open`; adding `.open` inside `requestAnimationFrame` is rejected by name.

**Negative-tested on the real tree, mutate then restore — both directions:**

```
unmodified tree                                   PASSES
re-nest the motion block inside the phone query   CAUGHT
rebuild the stage rail with innerHTML again       CAUGHT
animate the connector with width again            CAUGHT
drop the Copilot style flush                      CAUGHT
add .open inside requestAnimationFrame            CAUGHT
tree restored                                     PASSES  (git status clean)
```

`shell-passes-write-only-on-change` pinned the `lastStage` guard as one literal string. Its
substance is unchanged but `el.childNodes.length` is now derived into `built`, because the same
fact decides whether the rail needs building at all. **Both halves are pinned separately** —
pinning only the `if` would let `built` be re-derived from something always true, reinstating the
unconditional repaint that suite exists to prevent.

---

## 6. VERIFICATION — BOTH THEMES, AND THE NEGATIVE CONTROL

Everything above re-measured on the rebased tree at 1440×900.

| | light | dark | reduced motion |
|---|---|---|---|
| animations on the rail | 8 | 8 | durations `1e-05s` |
| distinct connector `scaleX` values | 22 | 22 | **2** (`[0,1]`) |
| passed through a midpoint | true | true | **false** |
| nodes surviving a stage change | 9/9 | 9/9 | 9/9 |
| `mlsMoRise` at 1440px | 0.3s | 0.3s | **none** |
| Copilot first open, distinct positions | 22 | — | **2**, `0.001s` |

Timings are theme-independent and read identical, as expected.

**The reduced-motion column is the negative control that makes the rest trustworthy:** the same
instrument that counts 22 intermediate positions counts **none** under
`prefers-reduced-motion: reduce`, while the rail and the drawer still land on the correct final
state and the drawer still closes. Motion here is decoration; the UI works identically without it.

---

## 7. SCREENSHOTS

`dispatch-work/WORKER_F3_SHOTS_20260726/{light,dark}/` — 12 frames, 1440×900, both themes:

- `rail-1-prep` · `rail-2-MIDGLIDE` · `rail-3-review`
- `copilot-1-closed` · `copilot-2-MIDSLIDE-firstopen` · `copilot-3-open`

The two `MIDGLIDE`/`MIDSLIDE` frames are captured **in flight** and are the point: the rail at
`scaleX 0.764` of a 420ms fill, and the drawer's **first** open at `130.3px, opacity 0.95`
(dark: `141.3px, opacity 0.93`) — the frame that did not exist before this pass.

A still cannot show a curve. The sampled numbers above are the honest evidence for the motion
itself; these show the states a doctor sees.

---

## 8. COMMITS ON `worker-f3-motion` (5, none pushed)

Identified by subject, not hash — main moved six times during this session and every rebase
rewrote them. In order:

| # | subject |
|---|---|
| 1 | `motion: the motion system escapes the phone query and reaches the desktop` |
| 2 | `motion: the visit progress rail actually moves — it had none at all` |
| 3 | `motion: the Copilot drawer slides the FIRST time too, not just afterwards` |
| 4 | `gate: a declaration is not motion — pin the three mechanisms that let it run` |
| 5 | `docs: MOTION_TOKENS law 5 — a declaration is not motion — and the F3 report` *(this)* |

Re-verified on the final base after the second rebase — rail: 8 animations, 22 `scaleX` values,
midpoint true, 9/9 nodes surviving, `mlsMoRise` 0.3s at 1440px; drawer: first open 22 positions,
second 23. Gate **355/355** at the tip.

---

## 9. WHAT THE LEAD SHOULD FEEL-CHECK LIVE

In this order — the first two are the ones the owner will notice:

1. **Open a visit and let the stage advance** (type into the note past ~40 chars). The rail
   should *flow*: the connector fills left-to-right over ~420ms and the next dot springs with its
   ring blooming. Before this it snapped between states with no in-between frame.
2. **Open the Copilot for the FIRST time in a fresh tab.** It should slide in from the right and
   fade. This is the case that never animated — and it only reproduces on a genuinely fresh page,
   because every open after the first was always correct. A reload is required to re-test.
3. **Anything that summons the right-now bar, on a desktop window.** It should rise. On a
   >760px-wide window it previously had no entrance at all.
4. **Both of the above with the OS set to Reduce Motion** — everything must land instantly in the
   correct final state, and the drawer must still close.

## 10. OPEN RISKS

1. **I edited `ScribeFlow.html`, `ScribeFlow-staging.html` and `feat_mls_calm_shell.js`** — files
   other lanes are editing. Every change is a timing, a brace position, or a DOM-update strategy;
   no layout, no logic, no structure. The calm-shell change is the largest (renderStages) and is
   the one most worth a second read.
2. **The Copilot fix pays one forced layout (~18ms) on first open ever.** Deliberate, and the
   alternative (rAF) is unsafe in an occluded tab. It does not recur.
3. **The rail now animates where it never did.** If any lane relied on the rail being visually
   instant, this changes it. First paint is still instant; only transitions between stages move.
4. **391 literal timings survive across 88 files** (`mls-connect.js` 115, `ScribeFlow.html` 41,
   `feat_mls_redesign.js` 21, six patient pages ~5 each). Measured, not fixed: they are pre-token
   bespoke curves, not forked tokens, and rewriting them blind across four lanes' files buys no
   behavioural change and guarantees conflicts. The standing rule holds — nothing NEW invents a
   timing; move a surface onto tokens when it is being touched anyway.
5. **`#mlsStages` was the only rail-like surface I audited this way.** The same
   "innerHTML-rebuild kills the transition" test has not been run against every other list that
   re-renders. The new suite pins the rail specifically; it cannot yet catch the class app-wide.
