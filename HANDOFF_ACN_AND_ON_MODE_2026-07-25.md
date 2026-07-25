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

---

## The ON-mode pull is now three steps, and here is what to do with each answer

**The build is staged and ready to load:**
`C:\Users\Micha\Downloads\MLS_Assist_3.0.15_ONMODE_DIAGNOSTIC\`

Twenty package files copied from `agent/ext-3.0.14-on-mode` @ `adc05ee` and
**verified byte-identical by SHA-256 per file**, manifest `3.0.15`, core digest
`cac24f27…`, gate 298/298. Deliberately a separate folder — the running
extension in `Downloads\MLS_Assist_v1.65` is untouched, because overwriting a
loaded unpacked folder is its own documented way to lose an evening. Loading it
alongside gives two entries; removing the 3.0.15 one restores the status quo
exactly.

`READ-ME-FIRST.md` in that folder is written for the owner: load unpacked, paste
a listener into the signed-in tab, run **one** pull with Full visit notes ON,
paste back what it printed. The listener is passive — a `message` handler plus a
DOM/localStorage scan — so nothing depends on knowing where the receipt lives.

### Why the gates cannot simply be relaxed, which is the fix's whole shape

Gate 1 is the only check that identifies the panel; gates 2 and 3 only measure
completeness. So the tempting fix — drop the mandatory total, accept once the
row count is stable — is safe **only if gate 1 reliably excludes the landing
pane**. It probably does not:

```js
var vcOk = false, vcScope = g.parent;
for (var va = 0; va < 8 && vcScope; va++) {
  var vcT = String(vcScope.textContent || '').slice(0, 6000);
  if (/visits\s*and\s*cases/i.test(vcT)) { vcOk = true; break; }
  vcScope = vcScope.parentElement;
}
```

That is a **text scan over up to 6,000 characters of an ancestor eight levels
up**. Eight levels above an encounter list on a briefing page is plausibly the
whole briefing page — which contains the "Visits and Cases" heading whether or
not the rows in hand belong to that panel. The 3.0.2 note says the landing pane
carries *the same row markup* and hydrates first. If both surfaces sit under a
common ancestor containing that heading, gate 1 passes for both, and the
mandatory total is the only thing standing between the reader and a 1–2 row
landing pane believed to be a complete history.

That is reasoning from the source, not a measurement — flagged as such. But it
is the reason the sequencing matters: **tighten gate 1 to structural identity
before relaxing gates 2 and 3.** Bind to the element that actually owns the
`ul.encounter-list.accordion-container` — a heading node, an `aria-label`, a
`data-` attribute on the panel container — rather than to text found anywhere in
an ancestor's subtree. Once panel identity is *structural*, a stability-based
completeness rule becomes safe, and the "refuses forever when the SHOW label
never renders" problem disappears with it.

Sequenced the other way round, a stable landing pane becomes an accepted
complete index, and the failure is silent: a chart that reports success with two
of a patient's twenty-two encounters is worse than one that honestly refuses.

### Reading the answer

| receipt | what it establishes | first move |
|---|---|---|
| `visits-panel-not-open[rows=N;up=8]` | the walk never matched the heading even at 8 levels | gate 1 is too strict *and* structurally wrong — go straight to structural identity |
| `visits-total-not-readable[…;sameFor=67s]` | no "All Events (N)"; list unchanged for a minute | the collapsible-panel flip removed the label. Tighten gate 1, then let stability replace the total |
| `visits-list-still-rendering[22/38;…;sameFor=67s]` | declared 38, rendered 22, not moving | the declared total counts non-encounters. Compare against encounter rows, or drop to stability — after gate 1 |
| `noise-frames-excluded:N` present | 3.0.14 working: the inbox is no longer offered as the index | nothing; confirmation only |
| nothing printed | the pull never reached the chart | check the Athena session first — expired session has been the #1 blocker |

---

## Correction: "only the reason string survives the hop" is wrong

This is the most-cited rule in the ON-mode work — method note 3 of the
2026-07-24 handoff, quoted in three commit messages and obeyed by four builds
including two of mine. It is a misdiagnosis, and it has been degrading the one
diagnostic the owner's single live pull depends on.

**The observation was real. The cause was not the boundary.** 3.0.11 attached
the frame table to `gate.frames` and never saw it on the page — and `gate` is a
**local variable**. Nothing returns it; there is no `gate: gate` anywhere in
`background.js`. `gate.frames` could not have arrived no matter what the
boundary does. A code-path bug, read as a platform limit.

**Objects cross fine, and the proof was already in the shipped code:**

```
content.js:1710    var out = {}; for (var k in res) out[k] = res[k];
                   window.postMessage(out, origin)        <- structured clone
mls-connect.js     reads r.identity.name off that very message
```

`identity` is a nested object on the same response, read in production today. If
objects were dropped, chart-identity display could never have worked — and the
handoff itself reports reading a patient banner out of exactly that field. The
later commit `5586d6d` ("the body-failure instrumentation already exists —
`receipt.expected/parsed/failedIndexes` — capture it, do not build it") says the
same thing from the other direction: `receipt` is an object, and it arrives.

**What it cost.** Evidence squeezed into truncated strings — four frames of
twelve, URLs cut to 26 characters, gate reasons to 22 — on a defect whose whole
remaining question is *which gate refused and with what numbers*, and where a
live pull on the owner's signed-in session is scarce. One pull should not come
back abbreviated.

**Fixed in ext 3.0.16.** Both refusals now return the full table as `enumDiag`:
every frame, untruncated URLs, scores, drop reasons, the answered-frame list,
the noise-dropped count, the row count, the selector. The `enum=` summary stops
truncating at twelve.

**The string encoding stays.** It is proven to arrive, it costs nothing, and
betting a scarce live pull on my being right about the boundary would be the
same mistake pointing the other way.

`tests/enumerate-evidence-crosses-the-hop.test.js` pins the correction *at the
cause*: any new field hung on the local `gate` fails the suite by name, with the
explanation. It also pins the bridge's copy-every-key relay, because if that
ever narrows to a whitelist the field silently stops arriving and the string
becomes load-bearing again.

**Two of its seven arms caught bugs in the suite itself**, which is the argument
for negative-testing every assertion: an unscoped regex passed while the visits
bridge had been replaced by a whitelist (that copy line appears twice in
`content.js`), and the slice bound I picked ended *before* the line it asserted
on, so it failed against correct code. Measure the instrument.

### Restated for the next session

> Objects, arrays and nested fields **do** survive the extension→page hop —
> `content.js` copies every key and `postMessage` structured-clones it. What
> does not survive is anything you attach to a variable that is never returned.
> Before concluding the boundary ate your evidence, check that the object you
> decorated is the object you sent.

The staged build is now
`C:\Users\Micha\Downloads\MLS_Assist_3.0.16_ONMODE_DIAGNOSTIC\` (20 files,
byte-verified, gate 299/299); the 3.0.15 folder has been removed so there is
only one to load. Its README captures both `enumDiag` and the strings, so the
reading is complete whichever turns out to be right.

---

## Defect 1b, gate by gate: what is fixed, and what each fix would need

Asserting "three gates need opposite fixes" is not the same as showing it. Here
is the enumeration, so the next person can check the reasoning rather than
inherit the conclusion — and so it is clear that **one part of this defect was
never blocked at all** and has now been fixed.

### Already fixed, and it needed no reading (ext 3.0.17)

The handoff records the symptom as two things: patients fail, **and** it "burns
93–160s per patient first". The second half is this loop — 47 retries at 3.5s,
re-running `openVisits` each pass — and it is fixable regardless of which gate
fires, because stopping early **never turns a refusal into an acceptance**. It
exits through the same `return { ok: false }`, about 110 seconds sooner.

The stuck key carries the row and child counts (which move while a panel
renders) and excludes the elapsed-time counters (which move every pass by
construction), so a hydrating chart cannot look stuck. Threshold: 16 identical
passes, ~56s, against a recorded observation of a real panel sitting at 22 rows
for 70s. The refusal says it stopped early and after how many passes.

Also fixed without a reading: the noise-surface hole (3.0.14), the evidence that
never crossed the hop (3.0.16), and the truncation that hid the numbers (3.0.17).

### Not fixable without the reading — one gate at a time

**Gate 1 — `visits-panel-not-open`.** The only check that identifies the
*panel*; gates 2 and 3 only measure completeness.

| candidate fix | why it must wait |
|---|---|
| widen the text pattern ("Visits", "Encounters") | widens what counts as the panel. The landing pane carries the same row markup, so this can admit the very surface gate 1 exists to reject |
| add a structural check *alongside* the text one | same problem — an OR only ever accepts more |
| replace with structural identity | the right answer, but it needs the actual DOM: which element owns `ul.encounter-list.accordion-container`, and whether it carries a heading, `aria-label` or `data-` handle. Inventing a selector is guessing |
| tighten to structural *only* | narrows. If gate 1 currently passes, this could start failing charts that work today |

**Gate 2 — `visits-total-not-readable`.** Refuses **forever** while the SHOW
label is unreadable.

| candidate fix | why it must wait |
|---|---|
| drop the requirement | removes the only positive proof of completeness. A partial index becomes a complete one |
| fall back to row-count stability | correct *only if* gate 1 excludes the landing pane — see below |
| widen the label pattern | needs to know what the label now says. The 2026-07-21 flip changed the panel; nobody has read the new markup |

**Gate 3 — `visits-list-still-rendering`.** `listKids < evTotal`.

| candidate fix | why it must wait |
|---|---|
| compare encounter rows instead of `parent.children` | **measured out already**: `listKids` pairs with an All-Events total that legitimately counts appointments and vitals. Narrowing it makes the gate refuse *more* and breaks charts that work today |
| accept below the total once stable | same landing-pane dependency as gate 2 |

### The dependency that ties them together

Gates 2 and 3 are the only thing standing between the reader and a landing pane
believed to be a complete history — **because gate 1 probably cannot tell them
apart.** It is a text scan over 6,000 characters of an ancestor *eight levels
up*, and eight levels above an encounter list on a briefing page is plausibly
the whole briefing page, which contains the "Visits and Cases" heading whether
or not the rows in hand belong to that panel.

So the sequencing is forced: **make gate 1 structural first, then relax 2 and
3.** In that order the "refuses forever" problem disappears with it. In the
other order, a stable landing pane becomes an accepted complete index — a chart
reporting success with 2 of a patient's 22 encounters, silently. That is worse
than the current failure, which at least refuses honestly.

Every one of these needs one fact that only a pull produces: **which gate fires,
with its numbers.** That is what the staged build reports.

### The staged build

`C:\Users\Micha\Downloads\MLS_Assist_3.0.17_ONMODE_DIAGNOSTIC\` — 20 files from
`agent/ext-3.0.14-on-mode`, SHA-256 verified per file, gate 300/300, unpublished.
Superseded folders removed so there is only one to load. Three steps in its
README: load unpacked, paste a passive listener, run one pull.

---

## Recorded live evidence narrows Defect 1b from three gates to two

`tests/live-e2e-artifacts/2026-07-21-reliability-acceptance.md` has been in the
repo since the day of the athenaOne flip and is not cited anywhere in the
ON-mode handoffs. It contains a live observation of the post-flip panel that
settles two things I had only reasoned about.

> "Remaining blocker at stop time: the new panel's PROGRESSIVE render
> **satisfies every completeness check with its first 1-2 rows (real panel, real
> identity, unique bindings, rendered==declared)** before the rest stream in, so
> the reader binds a too-short index and per-row detail then fails."

Same surface as today's defect — the same artifact describes the flip that
produced it: the Visits panel became collapsible, and "the chart landing pane
now clones `li.encounter-list-item` markup for a 1-2 row 'recent' list that
hydrates FIRST".

### 1. Gate 1 does not discriminate the landing pane — confirmed, not inferred

"**real panel**" in that sentence means the panel check passed *on the landing
pane*. I had argued from the source that an 8-ancestor, 6,000-character text
scan probably could not tell the two apart. It is not "probably": on
2026-07-21, on this exact surface, it did not.

Everything the earlier addendum says about sequencing therefore stands on a
measurement rather than an argument. **Relaxing gate 2 or 3 before gate 1 is
structural would re-create the exact failure this artifact records** — an index
of 1–2 rows accepted as a complete history.

### 2. Gate 1 is very unlikely to be the gate refusing today

Gate 1 is recorded *passing* on this surface. That makes it the least likely of
the three to be the one refusing now, and narrows the live reading's job from
three candidates to two: `visits-total-not-readable` and
`visits-list-still-rendering`. Both are completeness checks, and both were added
*as the fix for what this artifact describes*.

### 3. The three gates ARE the 3.0.2 fix, now over-refusing

The artifact's queued fix direction reads:

> "require the rendered row count to be STABLE across two consecutive polls AND
> reconcile with the panel's 'All Events (N)' total before accepting the index."

That is precisely what gates 2 and 3 plus the caller's `ehStableCount` check now
do. So this is not an unexplained refusal — it is a guard built for
accept-too-early, now failing in the opposite direction after the panel changed
again. That reframes the fix: not "why is the reader broken", but "the
completeness proof this guard depends on is no longer available on this panel,
and the panel-identity check underneath it was never load-bearing enough to
stand alone".

Which of the two remaining gates loses that proof — the label not rendering at
all, or rendering a total the encounter list can never reach — is the one fact
the pull returns, and 3.0.17 now reports both with their numbers.

### What this does not change

It does not make the fix guessable. Gate 2 failing needs the label's new markup;
gate 3 failing needs to know whether the declared total is unreachable or merely
late. Those are different changes and the evidence distinguishes them. But the
*shape* of the eventual fix is now fixed by measurement rather than judgement:

1. give gate 1 structural identity, because it demonstrably cannot carry the
   discrimination on its own;
2. then let stability replace whichever completeness proof the panel stopped
   providing.

Doing (2) without (1) is not a risk any more. It is a known regression with a
date on it.

---

## No agent session can take this reading — proven, not assumed

Worth writing down so nobody spends a session rediscovering it. The remaining
step is not owner-gated by policy or preference. It is gated by the environment.

Taking the reading requires the 3.0.17 diagnostic loaded as an unpacked
extension, which requires interacting with `chrome://extensions`. Both routes
are closed:

| route | result |
|---|---|
| browser MCP `navigate('chrome://extensions')` | rewritten to `https://chrome://extensions`, lands on `chrome-error://chromewebdata/`. Verified 2026-07-25 |
| desktop computer-use | browsers are granted at tier **"read"** — visible in screenshots, clicks and typing **blocked**. "Load unpacked" needs exactly those |

So the sequence "load unpacked → run one pull → read `enum=`" cannot be
performed by an agent in this environment at all, whatever it decides about
driving a live EMR. The staged folder, its README and the passive console
listener exist because that is the entire remaining surface an agent *can*
prepare.

If a future session is tempted to try: the answer is no, and this is why. Spend
the time on the two candidate gates instead — the analysis above narrows which
one to expect and what each answer implies.

---

## Defect 1b: final state

**Fixed, no reading required.**

| | build |
|---|---|
| the inbox could supply the encounter index, set `receipt.expected`, and END the retry loop | 3.0.14 |
| evidence never crossed the hop — attached to a local nothing returned | 3.0.16 |
| refusals dropped their numbers; reasons truncated to 22 chars | 3.0.15 / 3.0.17 |
| 47 retries (~165s) on an answer that could not change | 3.0.17 |
| the branch itself was red and could not be certified at all | rebased onto main |

**Narrowed by measurement.** Three gates → two. Gate 1 is recorded *passing* on
the landing pane (2026-07-21 acceptance artifact), so it is the least likely to
be refusing and it demonstrably cannot carry the discrimination alone.

**Not fixed, and deliberately not guessed.** Which of
`visits-total-not-readable` and `visits-list-still-rendering` loses its
completeness proof, and whether the declared total is unreachable or merely
late. Those are different changes. The failure mode of guessing is not a broken
build — it is a chart reporting success with 2 of a patient's 22 encounters,
silently, which is the exact regression the 2026-07-21 artifact records.

The reader currently refuses honestly and saves nothing. That is the correct
behaviour for a reader that cannot prove completeness, and it is why this is a
defect to fix rather than an incident to contain.

---

## Gate 2 is not a completeness check. It is the landing-pane discriminator.

This is the last thing source analysis can establish, and it inverts the obvious
reading of the code.

Gate 2's own comment presents it as a progressive-render guard:

> "when the SHOW control itself declares 'All Events (N)', the index is complete
> only when the list really renders N items."

Read alongside the 2026-07-21 acceptance artifact, it is doing something else as
well — and the something else is the safety-critical half.

**The chain.** Gate 1 is recorded *passing* on the landing pane, so it cannot
discriminate. Gates 2 and 3 were added afterwards, as the queued fix for exactly
that failure ("reconcile with the panel's 'All Events (N)' total"). The reason
they work is not arithmetic: it is that **"All Events (N)" belongs to the real
Visits panel's SHOW control, and a 1–2 row "recent" landing list does not have
one.** Requiring the label is what tells the two surfaces apart. The count
comparison is the completeness check riding on top of it.

### Why that matters more than it looks

It means gate 2 is load-bearing for **safety**, not merely for completeness, and
that changes the risk of every candidate fix:

- **"Drop the mandatory total"** does not merely lose a completeness proof. It
  removes the only working landing-pane discriminator in the reader, because
  gate 1 demonstrably is not one. A 1–2 row index would then be accepted.
- **"Fall back to row-count stability when the total is unreadable"** is the
  same thing wearing a disguise. A landing pane that has finished rendering its
  two rows is *perfectly stable*. Stability proves rendering has stopped; it says
  nothing about which surface stopped.
- **The safe shape is to split the two jobs the label is currently doing**:
  prove panel identity from the presence of the SHOW control (or a structural
  handle on the panel that owns the list), and prove completeness separately —
  from the count when it is there, from stability when it is not. Today one
  string has to satisfy both, which is why one missing label breaks everything.

### What still needs the reading, stated exactly

Whether the collapsed panel renders *no SHOW control at all* (identity is
genuinely unavailable — the split above is impossible and gate 1 must become
structural first) or renders **"All Events" without the "(N)"** (identity is
available, only the count is missing — the split is straightforward and the fix
is small).

Those two are one word apart in the DOM and lead to completely different
changes. The receipt distinguishes them: `visits-total-not-readable` with
`rows=N;kids=N` tells you the list is populated and the label is not matching,
and `enumDiag.frames` carries the URLs to confirm which surface answered.

**Do not widen the `All\s*Events\s*\(\s*(\d{1,4})\s*\)` pattern to make the gate
pass.** If the count is genuinely absent, matching "All Events" alone would let
the gate succeed with `evTotal = 0`, and `listKids < 0` is false — so the index
is accepted with no completeness proof whatsoever. That is the worst available
outcome and it is one careless regex edit away.

---

# DEFECT 1b IS FIXED AND VERIFIED — ext 3.0.18

The owner authorised the diagnostic pull. One run settled what six theories
could not, and the fix is proven on the same patients that failed.

## What the reading said

Five consecutive patients, Fri Jul 24 schedule, ext 3.0.17, every one refusing
at **gate 3** — as the narrowing from the 2026-07-21 artifact predicted:

```
102 list-still-rendering  rendered=9   declared=13  rows=7   n=16 sameFor=53
102 list-still-rendering  rendered=9   declared=11  rows=7   n=16 sameFor=53
102 list-still-rendering  rendered=16  declared=53  rows=14  n=16 sameFor=53
102 list-still-rendering  rendered=22  declared=41  rows=20  n=16 sameFor=53
```

`rows === listKids - 2` on every one — a fixed two-item chrome in the `<ul>`.
The declared total ranges 11 to 53 with no relation to either figure. Nothing
moved for 53 seconds across 16 passes, each with an `openVisits` re-drive.

## The root cause

`listKids >= evTotal` was never a race condition. It is a **category error**,
and `background.js` already said so a few lines below the branch that made it:

> "Athena's nearby declared count includes non-visit artifacts sharing the list
> (future appointments, vitals and patient cases). The exact previous-visit
> encounter rows are the authoritative body count."

One branch treated the declared count as authoritative while the next declared
it untrustworthy. "All Events (N)" counts a population the encounter `<ul>`
never renders, so the comparison is unsatisfiable on every chart — which is why
ON mode refused 5 of 5 on 2026-07-24 and 5 of 5 again at the start of this
session.

## The fix

Below the declared total, refuse only while the panel is still **moving**;
accept once both the child count and the row count have held across ≥6 passes
and ≥20s. Measured settle was immediate and held 53s, so the dwell is ~3×
conservative.

**The mandatory-total rule is untouched.** Its *presence* is the only working
landing-pane discriminator, because gate 1's ancestor text scan is recorded
passing on that pane. Only the arithmetic changed.

## The proof

Same five patients, same day, immediately after loading 3.0.18:

```
Verified complete: schedule 5/5; history 5/5; failures 0

expected/parsed/visitCount/persisted/bodies/orgOk
7/7/10/7/7/1      7/7/7/7/7/1       20/20/22/20/20/1
14/14/15/14/14/1  6/6/14/6/6/1
```

`expected == parsed == persisted == bodies` on all five, `coverageComplete = 1`
on all five, **47 encounter bodies persisted**. The 7-row, 20-row and 14-row
charts are the same ones that refused an hour earlier.

That is *coverageComplete above zero on real patients* — the handoff's own
success criterion, and the one it warned not to confuse with the frame merely
being accepted.

## What changed elsewhere, and what to watch

- The receipt carries `acceptedOnStability`, `declaredEvents` and
  `renderedListItems`, so nothing downstream can present a stability-accepted
  index as count-verified.
- `tests/enumerate-refusal-evidence.test.js` asserted the opposite until now —
  "stability must not yet be used as an acceptance condition … until one live
  pull says what the numbers are." The pull happened. That assertion is
  replaced, with the reason recorded rather than deleted.
- **Duration is the remaining rough edge.** A full-bodies pull ran ~18 minutes
  per patient (7–20 encounters each, each body a slideout + iframe read). It
  completes and it is honest, but that is the next thing worth attacking, and it
  is now a performance problem rather than a correctness one.

## Environment note, corrected

An earlier section of this document says no agent session can take this reading
because `chrome://extensions` is unreachable. That was true of *loading a new
unpacked extension*, and it is not the only route: `dispatch-work/auto-load/`
already documents pushing bytes into the **pinned** folder Chrome has loaded and
firing `mlsDevReload` from an mlsscribe.com tab. That is what was used here —
backup taken first, files copied individually rather than mirrored, digest
verified in the running browser before and after. The earlier claim stands only
for a *new* folder.
