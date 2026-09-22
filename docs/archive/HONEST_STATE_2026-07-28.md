# Honest state — 2026-07-28

He said *"I expect everything tested."* This is the truthful answer, and it has **five**
categories, not two. The distinction that matters most is between **1** and **2**: category 2
looks like success and is not.

**Live right now: b756.** Eight commits are held locally and unpushed.

---

## 1 — VERIFIED LIVE (measured on a real browser, against real state)

These were measured, not read. Where an instrument could have lied, the check that proves it
could see the thing is named.

| what | measurement |
|---|---|
| Extension **3.0.29** is the running version | `mlsPong` returned version + core digest `af437897…a128ef` |
| His main tab had an **orphaned content script** | pong returned `version:""` with live capabilities; reload healed it. Would have bitten on his next pull |
| Dock overflows a 320px phone | `#mlsDockCopilot` right edge **347**, viewport 320 → **+27px** |
| The exact failure boundary | vw **347 → overflow 0**; vw **360 → −13** (13px spare). Fix breakpoint set to 346, not 365 |
| iOS zoom blanket already works | `computedUnder16` = **0** on the signed-out shell |
| Four sub-44px tap targets | `#mlsPqsInput` 40×38, `#mlsDrSnooze` 41×44, an unclassed ✕ 17×44, `.mainnav .navtab` 211×38 |
| The 17×44 control is **not** `button.modal-x` | `e.matches('button.modal-x')` returned **false** on the live node |
| Medications are absent from the athena briefing | `TEXTCONTENT_DOSE_HITS` = **0** across all 103,039 chars including hidden nodes. `not_documented` for 19/19 was honest |
| Hidden-tab timers are frozen | own `setInterval(1400ms)` → **0 ticks in 30,058 ms** (expected 21) |
| The pf2 fold builder works | `__mlsProfCalm.ensure()` built **5 sections + 5 headers** instantly, both gates passing |
| The b748 chevron suppression is live, not just shipped | `getComputedStyle(h,'::after').content` = **`none`** |
| The toast renders correctly | screenshot shows a normal pill — geometry had claimed 344×1085 |
| Boot request profile | **220** script requests of 250; 227 from cache |
| The standing unreachability sweep works | positive control planted, **detected**, cleaned up; 30 controls scanned |

---

## 2 — VERIFIED ONLY BY SOURCE READ, AT A BUILD HE HAS NEVER RUN

**This is the category to be suspicious of.** Every item below is "the code at HEAD looks
right". b748 is precisely the build whose fixes shipped *present, correct, and unconsumed on
the path he actually takes* — so a source read is not proof, and five separate items now rest
on the same unproven footing.

| item | state in source | why it is not proof |
|---|---|---|
| #38 three "generate" surfaces | b748 shipped both defences | his screenshot may predate it; the re-fix was **refuted** |
| #39 Review & Sign scrolls | `openReviewStep`'s `scrollIntoView` deleted in b748 | never confirmed on his lane |
| #40 two bare sparkle glyphs | inventory built, 3 candidates eliminated, 1 standing | **not diagnosed** — needs the live region |
| #41 pull-chart loading | glyphs fixed in b759 (mojibake → `↻ ✓ ⚠`) | b759 is **not live**. Only the announcement is fixed |
| #42a toasts from the top | stack is `top:var(--mls-notice-top,96px); bottom:auto` | source only |
| #42c doubled checkmark | renderer strips a leading glyph, unconditional | source only |
| #42b alerts "wait for things to finish" | **open** — batch guard exists for warnings, not successes | needs a real pull to confirm |
| #43 stat prep in Tools | implemented b748, comment quotes him verbatim | source only |
| #34 default provider | fixed b739, pinned by a 5-case suite | commit says "live verification lands with his next sign-in" |
| the dead ▶ arrows | repaired b748; his screenshot **provably predates** it (the `›` cannot render at ≥b748) | he has not retried them |
| b757 / b758 / b759 / b760 | gated 406/406 | **held, unpushed** |

---

## 2b — CLAIMED BY A PROOF THAT CANNOT FAIL

**Worse than unverified, because it has been counted as done.** See
`REACHABILITY_PROOF_AUDIT_2026-07-28.md`: **22 of 38** suites that claim a control
is reachable prove it by matching source text rather than exercising the shipped resolver.

One is confirmed to have certified a live defect — `shell-hidden-controls-keep-reach`
asserted that `#mlsDsVisitBodies` "is offered as Full visit notes" by
regex-extracting the spec literal from source, while the Tools row never rendered once.
Fixed in b760.

Items whose status traces to a source-text reachability proof, and which therefore move out
of "verified":

| item | suite | what it actually proves |
|---|---|---|
| every visit-focus route survives | `visit-focus-keeps-every-route` | 19 routes are **named in source**, not that any resolves |
| the calendar list keeps its exit (owner-reported nav trap) | `calendar-list-keeps-its-exit` | the exit exists in source |
| voice pills keep their routes | `voice-cluster-expands-never-decides`, `visit-voice-one-expands-never-decides` | routes and controls **counted** from source |

Four more are suites written during this effort and are listed in the audit rather than
exempted, including `phone-dock-fits-and-targets-reach-44`, whose name overclaims relative
to its method even though its geometry was separately measured live at 320 / 347 / 360.

**This is a screening result, not a verdict.** Source-text pinning is correct for claims
ABOUT source. Only runtime-reachability claims proved textually can certify a defect, and
each of the 22 needs reading before being called wrong. The real unit is the ASSERTION, not
the suite: a mixed suite that executes most things and proves the critical one by regex would
pass this sweep.

## 3 — PREPARED, WAITING ONLY ON HIS LANE

Ready to run the moment clinic ends. No further authoring required.

- **`ONE-LIVE-PASS.js`** — one paste, one normal day pull, one command. Answers every row of
  category 2 plus the b758 prediction, in a single visit to his tab. Refuses to report
  geometry when the viewport is 0. Leads with a **four-source build identity** (requested
  token / bytes received / server claim / extension pong) because "he is on b756" has been
  assumed all night and never read off his machine.
- **Eight held commits** — b757 (phone), b758 (problem-list data loss), b759 (glyphs),
  b760 (the pull-visits check mark gets a reachable home), the standing sweeps, the branch
  audit, this document, the reachability audit.
- **Six one-session specs** — boot, diarization, Mac, AI-surface audit, loading/motion,
  write-back.
- **`BOOT_WHAT_THE_PERF_COMMITS_MISSED.md`** — three candidates with discriminators that can
  come back wrong, and a prediction stated in advance.

---

## 4 — UNTOUCHED, AND HONESTLY SO

| item | why |
|---|---|
| speaker diarization | needs real audio and a clinical quality judgement |
| Mac extension | needs a Mac |
| AI output quality, five surfaces | context reaching the model is measurable; **output quality is not** — needs a clinician |
| motion / loading **design** | "Apple quality" is taste and cannot be gated |
| Athena write-back walkthrough | owner-blocked on the `[MLS TEST]` slot |
| `bump-build` bNNN corruption | real, measured (b759 appears **112×**), deliberately not fixed tonight |
| ~~the "check mark that lets you pull visits"~~ | **FIXED in b760** — it was never deleted; the Settings copy has existed since b743 and the Tools row that should have found it never rendered once |

---

## The three questions only he can answer

1. **Medications: pace vs completeness.** They are fetched on demand, so reaching them costs a
   network round trip per patient against a pull already at ~8 min per 60 patients.
2. **Chrome Web Store upload of 3.0.29** — his action, never ours.
3. **Whether to fix `bump-build`** — cosmetic at runtime, destructive to history.

---

## What tonight actually cost, stated plainly

**Fifteen instrument errors.** Three of them nearly shipped as fixes for defects that did not
exist. The fifteenth was a sweep that reported 86 suites from a blind
instrument and said so itself — the only one caught by its own positive control before it
reached anyone. The recurring shape: *a probe that could not have detected the thing it reported
absent.* Frozen hidden-tab timers reading as dead code; a CSS scanner returning zero across 208
stylesheets because cross-origin `cssRules` throws into a swallowed catch; latin1 decoding
being structurally incapable of producing U+FFFD; measuring `#toast` when the complaint was
about `.mls-sv-card`; and a grep printing `HEAD:0 perfbranch:0` whose own second number was the
disproof.

**Five of six defects in the adversarial workflow came back NOT SAFE TO SHIP**, one outright
refuted for resting on a false claim about `display:none`. That is the review layer working. A
layer that clears everything is decoration.

**The largest real finding was not a UI defect at all** — `organizePatientHistory` deleting
Athena chart facts it never re-read, reporting `ok:true`, measured 12 → 6 with a missing
receipt and 12 → **total wipe** with none. The repo had already measured the trigger twice
("11-14 of 16 day-pull histories lost `athenaProfileCoverage` to exactly this clobber") and
nobody had joined it to the symptom.
