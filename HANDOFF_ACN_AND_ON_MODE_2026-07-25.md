# Handoff — the three open defects, closed out

Taking over `HANDOFF_THREE_OPEN_DEFECTS_2026-07-24.md` (commit 9cf2389, written
at b569). Everything below was measured on the running page or proved by a test
that was negative-tested. Where something is unverified it says so.

**Site: b591 shipped by this session (live at b593, gate 295/295 at push).
Extension: `agent/ext-3.0.14-on-mode`, green at 297/297, deliberately unpublished.**

---

## Scoreboard

| defect | state |
|---|---|
| 3 — label welding | **CLOSED.** 0 welded accessible names across 367 visible controls on 7 screens, desktop and 375px |
| 3b — "no patient header at all" | **NOT REPRODUCIBLE as written.** The header exists; what was real was that it announced the patient's surname welded to a hidden chip. Fixed |
| 1a — noise surfaces (safety item) | **FIXED** in ext 3.0.14, with the test. Unpublished |
| 1b — enumerate frame qualification | **BLOCKED on one owner action.** Not guessed at. See §4 |
| 2 — boot 26s | **BLOCKED on one owner measurement**, and the instrument that was missing now exists. See §5 |
| S7 — inventory blind spot | **CLOSED** by the parallel session in b582; coverage now reach-checks 1187 controls, up from 802 |

---

## 1. The handoff was right about the mechanism and wrong about the scope

It said the welding fix must go "in `textOf` at label-derivation time, centrally"
and that "per-shape fixes don't hold". Both correct. But `controlLabel` — the
central function — **separated exactly one level**. At a block child it pushed
that child's entire flattened subtree, so anything nested deeper re-welded.

Measured on the running page at b581 and b582, with a patient active:

```
.mlsctx-id   "SOSample Patient OneAge 51 yrs51y F · DOB 01/15/1975 · MRN …"
.ez3-qchip   "8:10 AMSample O."
#ez3Choose   "Choose patient2 on today's schedule"
.uc1-pay     "Pay Reports PREMIUMThis month's visits, coded and totaled…"
```

The first is the **patient header**, on every screen. The second is the owner's
original complaint exactly — a time welded to a patient's surname — in a shape
nobody had looked at.

**Every one of them looks correct on screen.** The colliding pieces are separate
boxes on separate lines. They are wrong only in the flat string, which is what a
screen reader speaks, what voice control matches, and what the Ask index and the
control inventory search. That is why five builds of looking at the screen never
found them.

Fixed by making `controlLabel` recurse (so the hidden test applies at every
depth), guarding inline boundaries that never reach the block branch, and
**publishing** the derived label as `aria-label` so the announced name matches
the read name.

### The two bugs found only by measuring the fix

1. **`nameControls` gated on `visible()`, which rejects `disabled`.** A disabled
   control is still painted and still read out. The Pay Reports card was 486px
   wide, on screen, disabled and unnamed — while its enabled twin on another
   screen was named correctly, which is what made it look like a race rather
   than a rule. Whether a control can be pressed has nothing to do with what it
   is called.
2. **A naming verdict could be cached from a styleless moment.** The signature
   was text-only, but the derivation depends on computed style. A control
   examined before its stylesheet applied derives its own flat text, caches
   "nothing to fix", and is never re-examined. The key now carries a
   per-destination epoch.

### Verified live at b593

```
367 visible controls across 7 screens · 20 named by the shell · 0 welded
375×812: 120 controls · 0 welded · patient header correct
.uc1-pay (disabled, 225px): "Pay Reports · PREMIUM · This month's visits, coded and totaled · Open full report"
.mlsctx-id: "SO · Sample Patient One · 51y F · DOB 01/15/1975 · MRN SAMPLE-001 · 2 visits · last seen Jul 16, 2026"
40 consecutive renders: 1.7ms each, stamps 7 → 7, names stable
revert() → 0 stamps, no stray aria-label · boot() → names restored
Ask "patient" → "Patient type", "Switch patient" (clean labels, no welding)
```

`tests/control-accessible-name-runtime.test.js` runs the **real** derivation
lifted out of the shipped file against those exact shapes. Eight arms
negative-tested.

---

## 2. Defect 3b: there IS a patient header

The handoff says "There is **no patient header element at all** (`banner: false`)
… That needs a component, not a rule."

`#mlsCtxBar` is a patient header — avatar, name, age chip, DOB, MRN, visit count,
last seen — at top ≈95px, present on Calendar, Patients, Today, Orders,
Recommendations, History and Tools whenever a patient is active, and correctly
**absent** when none is. Measured at b581 and again at b593, desktop and phone.
`#patientBar` is hidden by `feat_mls_patient_reach_v2.js`, which replaced it with
`#mlsCtxBar`; a probe looking for the old id finds nothing and reports no header.

Building a second header would have duplicated an existing one — the exact
duplication the b572–b581 density work removed. **What was real** is that the
header announced the patient's surname welded to a hidden age chip and then to
their sex. That is fixed.

---

## 3. Method notes, added to the five already in the handoff

6. **A parallel session sharing your clone will commit your unfinished work.**
   b582 shipped `acn-1.0.0` — my in-flight edit, sitting uncommitted in a clone
   I had made clean 30 minutes earlier. It went out without its test and with the
   `disabled` bug still in it. `git add -A` cannot tell a mid-thought line from a
   finished one. Work in a worktree outside the repo tree; claim build numbers in
   a file; re-fetch `origin/main` immediately before every push. I collided five
   times in one afternoon and caught every one only by re-fetching.
7. **Your mutation script can lie about mutating.** Three "the test did not catch
   this" results this session were the negative-test harness failing to apply its
   own edit and reporting success. Make every mutation assert the file changed.
8. **The Browser pane runs with `document.hidden === true`.** Layout and
   `getComputedStyle` are fine; **rAF is not**, so the shell's scheduled render
   never fires and `.view-enter` freezes at its `opacity:0` start frame. Call
   `__mlsCalmShell.render()` explicitly — twice, some cards mount after the first
   pass — and strip `.view-enter` before judging visibility. I read "the profile
   card is hidden with a patient active" off that and nearly filed it.
9. **`?preview=1` disables 118 controls with inline `display:none`.** Preview
   cannot be used to judge whether a screen offers actions, or to measure boot.
10. **Read `bestResult` before asserting what it returns.** My first
    noise-exclusion test asserted `null` where the shipped function returns a
    refusal object. The code was right and the test was modelling.

---

## 4. ON mode — one owner action, and the safety item is done

### The safety item is FIXED (ext 3.0.14, unpublished)

The handoff asked to "exclude noise surfaces when **building** enumerate
candidates, not only in the walk", and it was still open at 3.0.13. 3.0.8 added
the exclusion to the candidate *walk*, so a noise frame can no longer be
*selected* as the chart. The hole was one step earlier:

```js
var eb = bestResult(enR, ...);        // every frame that answered, unfiltered
enumRes = eb.result; listFrame = eb.frameId;
```

Three consequences, all silent:

- `enumRes.indexComplete` decides whether the read proceeds at all
- `receipt.expected` is counted against that frame's rows, so completeness is
  measured against the wrong denominator
- **a satisfied index ENDS the retry loop** that would have re-opened the real
  chart, so the failure is terminal rather than merely wrong

The enumerate op now reports its own frame URL — that is what makes the test
possible where candidates are built, and the only reason it previously lived in
the walk. One shared `NOISE_SURFACE_RE` serves both sites. It **fails open**: a
result with no `frameUrl` is kept, so it can only remove a surface that
identified *itself* as noise. The walk keeps its own drop, as the handoff asked.

`tests/enumerate-noise-surface-exclusion.test.js` runs the real predicate and the
real `bestResult` against the frame set recorded live, including the collapsed
`qualityPane?isCollapsed=` chart URL, which must NOT read as noise.

### The qualification defect: NOT guessed at

Three gates inside the enumerate op can refuse the real chart frame:

| reason | gate |
|---|---|
| `visits-panel-not-open` | no ancestor within 8 levels whose text matches `/visits and cases/i` |
| `visits-total-not-readable` | no ancestor declares `All Events (N)` — **mandatory**, so an unreadable total refuses forever |
| `visits-list-still-rendering` | `g.parent.children.length < evTotal` |

They need **opposite** fixes. My reading of the evidence favours the second or
third — the 2026-07-21 athenaOne flip made the panel collapsible, the frame URL
carries `?isCollapsed=`, and `All Events` counts non-visit artifacts that the
22-row list will never match — but that is a theory, and the handoff's most
expensive lesson is that six theories died to experiment and none to argument.
**Do not ship a guess into a clinical read path.**

**The one action.** Install `agent/ext-3.0.14-on-mode`, run one pull, read the
`enum=` reason. 3.0.13's instrument names which gate refused; 3.0.14 adds the
noise fix on top. Success is `coverageComplete` **above zero on real patients** —
accepting the frame is necessary, not sufficient.

Note for whoever fixes it: `visits-total-not-readable` refusing forever is a
design choice, not an accident, and replacing it needs a completeness signal that
is just as strong. **Stability is available and was already measured** — the
handoff recorded the same 22 rows across 40 of 40 samples over 70 seconds. Row
count unchanged over N samples inside the real Visits panel is a defensible
substitute for a declared total. Do not simply drop the gate.

### The branch was uncertifiable, and now is not

The old `agent/ext-3.0.10-on-mode` gate was **red before any of this work**: 30+
commits stale, and `tests/athena-overlay-lifecycle-contract.test.js` asserted the
athenaOne overlay mounts — while the branch carried the owner's twice-made
request to remove it. So an implemented owner request could never ship, and
nobody could tell because the branch never ran green.

Rebuilt on current main. The contract now reads "off by default, identical
behaviour when `__mlsPopupShowOnAthena` is set" — every lifecycle property it was
protecting still asserted, one flag away. Removal, not deletion: `__mlsPopup`
still installs with its whole API.

---

## 5. Boot — the instrument that was missing now exists

The handoff's warning was exact: `tests/boot-script-budget.test.js` counts
feature *names*, so it measures **bundling only**, and a deferral win would read
as zero progress with the floor arm never tripping to lock it in. That is closed
— the suite now has a second two-sided arm counting scripts inserted eagerly
rather than behind a deferral marker. (The parallel session landed an equivalent
arm in b586; mine was dropped rather than duplicated.)

`tools/boot-cost-probe.js` (b591) is the measurement the handoff says must come
first. **It refuses to answer on a preview session** — the naive `#appScreen`
test reports "signed in" there, and that reading would be taken for the very
measurement that has never reproduced the problem.

Warm preview at b591:

```
202 feature scripts · 201 cached · 70ms total download
script phase 2,068ms  ·  load 2,396ms  ·  8ms after the last script
aggregate queue 218,710ms
verdict: the 26s did not reproduce here
```

A 2.1s script phase cannot make a 26s load. **Run the probe on the signed-in tab
before touching the loader.** If the script phase is still ~2s while load is 26s,
the loader is a red herring and the cost is downstream — hydration or a backend
call — and rewriting the highest-blast-radius code in the product would risk
every boot to save nothing. The probe says which, in one line.

---

## 6. Landed and safe (don't undo)

- **`tests/control-accessible-name-runtime.test.js`** — eight arms
  negative-tested. If it goes red, a label is welding again; fix the derivation,
  never the expectation.
- **`tests/enumerate-noise-surface-exclusion.test.js`** (extension branch) — the
  safety item. The handoff asked that it "stand on its own terms" and not be
  deleted as redundant once the enumerate fix lands. It still stands.
- **`tools/boot-cost-probe.js`** — do not "improve" the preview refusal away.
- **`ScribeFlow-staging.html` now follows production's stamp on every bump.** It
  had drifted a build behind at b586 and was serving its bundle from an older
  cache entry — the frozen-token failure from §2 of the overnight handoff, one
  build deep. Nothing pins that pair; worth a test if it drifts again.
- Everything the previous handoff listed as landed and safe is untouched.

---

## Addendum — corrections to this document, same day

Written after the boot lane published measurements that retire two things this
document said. Both corrections are mine to make: one of them is about code I
shipped.

### Boot is no longer blocked on the owner, and my probe was wrong

Section 5 above said "run the probe on the signed-in tab before touching the
loader" and treated that as blocking. The boot lane has since taken it, in
front, and the answer arrived: **the loader is not the cause and bundling will
not fix it.** Same 205 cached assets, same service worker, idle main thread:
~170ms. A bundle buys ~2%. The 6,477ms median per-script queue is a *symptom* of
main-thread contention.

`tools/boot-cost-probe.js`, which I shipped in b591, read exactly that queue and
concluded "LOADER IS THE CAUSE". It would have sent the next reader straight at
the disproved fix. Rewritten (b603) to:

- **refuse when the tab is not in front** — a backgrounded tab reports ~1.4s and
  zero long tasks for a boot that costs 24.5s in front, which is why three
  sessions failed to reproduce this. It checks `visibilityState` *and* that
  paint entries exist, and says which precondition failed.
- **refuse on signed-out or `?preview=1`** — the feature scripts do not load
  until after authentication (the login screen is 5 resources), which is both
  why the owner calls it slow login and why preview readings mislead.
- measure **long tasks and total blocking time** instead of resource timings.
- list every killed theory with its number: network, parse/exec, one hot script,
  stylesheet count, the SW cache write, request count/bundling, and observers.

Live-verified: it refuses the preview tab it previously answered.

### My naming pass left the boot path

The boot lane measured 5,576 forced-layout reads during boot, **1,633 of them
(29%) in `feat_mls_calm_shell.js`**, and named read/write interleaving as the
strongest surviving lead. `nameControls` reads layout once per composite control
and computed style once per child.

Measured at b598: steady state costs **zero** extra layout reads and **zero**
`getComputedStyle` — the text signature short-circuits first — but a cold epoch
touched all 95 composites on that screen. Small against 5,576, and it buys
nothing before first paint, so it now runs from `requestIdleCallback` with a
1,200ms timeout, coalesced. `__mlsCalmShell.render()` stays synchronous, because
that is the entry point verification uses and a deferred answer there reads as a
missing name.

### Two aria-label writers now share this file

The other lane added `nameIfGeneric`, deliberately scoped to `#profileCard`
because a global version pulled patient data ("Sample medication 10 mg daily")
into accessible names. That is a different operation from this one — it
*synthesises* a name for a generically-labelled control, whereas `nameControls`
only re-punctuates text that was already the accessible name — so the scoping
difference is correct and not an inconsistency.

They can still collide on one element. The stamp now records the **value**
written rather than a flag, and a control whose `aria-label` no longer matches
what this pass wrote is released to its new owner. Without that, a control
renamed by the other pass would be silently overwritten on the next render, and
a name that flips between two correct-looking values by render order is worse
than either.

### ON mode: ext 3.0.15

3.0.14 fixed the safety item. **3.0.15** closes the instrument gap that would
have cost a second live pull: the gate-3 refusal carried `declaredEvents` and
`renderedListItems` as *object fields*, which are dropped at the
extension→page hop, so the receipt named the gate but not the numbers. All three
refusals now carry theirs in the string, plus row-count stability across passes:

```
visits-panel-not-open[rows=22;up=8]
visits-total-not-readable[rows=22;kids=22;n=19;sameFor=67s]
visits-list-still-rendering[22/38;rows=22;n=19;sameFor=67s]
```

`sameFor` is the reading that separates "still rendering, wait longer" from
"this rule can never be satisfied on this chart" — the distinction the whole
remaining question turns on, and nothing recorded it before.

Deliberately observe-only: acceptance is unchanged, and the suite asserts the
stability figure is *not* wired into it, so nobody promotes it without the
reading. One pull still settles it.

**Two fixes I talked myself into and then measured out of:**

- *"Gate 3 compares the wrong things."* `listKids` is `g.parent.children.length`,
  paired with an All-Events total that legitimately counts appointments and
  vitals alongside encounters. Narrowing it to matched encounter rows would have
  made the gate refuse **more** and broken charts that work today. The pairing is
  correct as written.
- *"A stability window should replace the mandatory total."* Plausible, and still
  possibly right — but the landing pane the mandatory total exists to reject can
  also sit stable, so swapping one for the other without the live reading trades
  a known refusal for an unknown false accept in a clinical read path.
