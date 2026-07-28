# Takeover handoff — 2026-07-28

Read this top to bottom before touching anything. It is written for someone with no context.

---

## 0. STATE IN ONE PARAGRAPH

Live site is **b756**. There are **ten commits held locally and unpushed** on branch
`integrate-codex-perf` in `dispatch-work/claude-qa-txm-20260725`, gated green at **406/406**,
tree clean, **0 behind `origin/main`**. Nothing has been pushed all session — deliberately,
because the owner is a working surgeon who was seeing patients. Four are real builds
(b757–b760), six are tests and documentation.

**Ship command when cleared:** `git push origin HEAD:main` — never any other target.

---

## 1. WHO AND WHAT

- Product: **MLS Scribe**, live at mlsscribe.com. An ambient AI medical scribe.
- Owner: **Michael**, a practising orthopaedic surgeon. His practice uses **athenaOne**.
- Almost all owner communication arrives as **relays from another session**
  (`local_8aaf0a8d-2bed-4f70-8413-149427d89776`, "MLS assistant overloading issue").
- His bar, verbatim: *"it's not done till the extension always does perfect Athena pulls with
  perfect history and at a decent pace, not slow."* Three conditions, all required.

### Hard safety rules — these are NOT permission questions

- **athenaOne is READ AND NAVIGATE ONLY.** No writes, no signing, no orders, no modifications.
  Real EHR, real patients.
- **Stay off his primary tab.** Use a background tab in his profile. `tabs_context_mcp` returns
  `selectedTabId` — that one is his.
- **If any sign of recording appears, stop touching the browser entirely** and report. A dropped
  dictation costs him a note he cannot recover.
- **PHI:** report shapes, counts, initials. Never names, DOBs, MRNs or clinical text.
- Real clinical writes only ever to the `[MLS TEST]` slot, patient MRN **7833832**. MLS never
  finalises an encounter.
- **Chrome Web Store upload is HIS action.** Never attempt it.

### What he HAS authorised, repeatedly and forcefully

Driving Athena, driving the app, local extension installs, real pulls, publishing to his site,
shipping green builds, spawning subagents. Verbatim: *"IT CAN DO AND TEST EVERYTHING IDK WHY IT
THINKS IT DOESNT HAVE PREMITION."* Do not stall waiting for permission he has already given.

### Two additional takeover rules from the owner

1. **The lead may use OPAS/subagents, but the lead is in charge.** Subagents sometimes struggle
   with this work. Delegate where it saves time, but independently verify their evidence and
   conclusions; responsibility for safety, release decisions, and the final result stays with the
   lead.
2. **Move quickly and make the Chrome evidence lane easy for the owner.** Set up a dedicated
   group of Chrome tabs so he can hand over everything needed without delay. The goal is the
   extension itself: a normal user signs into Athena and that is all the setup required. Every
   pull must return complete history on the first attempt, with no missed history or other silent
   omissions. If a user has to re-pull to get a complete result, that pull is a failure.

---

## 2. THE TEN HELD COMMITS

| commit | what |
|---|---|
| `HEAD` | takeover handoff written for a reader with no prior context |
| `9cfbccd` **b757** | phone: dock fits a 320px screen; four sub-44px tap targets; iOS-zoom date-picker gap |
| `cf887d3` **b758** | the chart problem list stops being halved and shredded (see §4) |
| `edfba06` **b759** | the pull-chart row stops announcing itself with broken glyphs |
| `cb499f9` | two standing UI sweeps as reusable browser instruments |
| `2b5c0e1` | branch audit — fourteen branches, merge none |
| `ea3af17` | the honest state document |
| `7c96dd8` | 22 of 38 reachability proofs cannot fail |
| `11cb3ff` | bring the honest state current |
| `da2abe8` **b760** | the pull-visits check mark gets a reachable home |

Gate: **406/406**, exit 0. `app-version.json` reads b760 and agrees with the tip commit's title.

---

## 3. THE LIVE MEASUREMENT JUST TAKEN — AND IT OVERTURNS b758's STORY

Run on his real store, background tab, 1,512 patients visible.

**Build identity, measured from three independent sources for the first time:**
requested token **b756**, bytes actually received **b756**, server claims **b756**. No
shipped-but-never-served mismatch. Extension pong: **3.0.29**, core digest `af437897…`.

**The coverage-receipt prediction was WRONG, and the pre-registration is why we know:**

```
patients with an Athena chart snapshot : 91
X  stored problems shorter than snapshot : 16
Y  missing / mismatched coverage receipt :  0
X === Y : FALSE
```

The prediction was X === Y — that every patient losing problems lost them to the unread-slice
clobber. **Y is zero.** Every one of the 16 has a `complete` receipt with a matching patientId.

**So the b758 mechanism-2 clobber is NOT the live cause on his machine.** It is real in code —
it was reproduced by running the production function, with a control row — but it is not what is
eating his problems right now.

**What IS happening, measured:**

```
lossy patients             16
  stored completely EMPTY   5    (no athenaHistoryFactsSnapshot - never merged at all)
  stored partial           11    (mostly off by exactly ONE: 11->10, 4->3, 15->14, 12->11, 32->30)
total problem rows missing 61
```

Neither of the two mechanisms I had named in advance explains it: `withComma` 0,
`endsQualifier` 0, `_mlsUnsortedProblems` 0 across the sample. Several patients have
`_rawProblems` matching the snapshot **exactly** (15/15, 12/12) while stored is one short — so
the raw text survived and the WRITE dropped rows.

**There is a third mechanism nobody has found yet.** The pre-registration said to say so rather
than round it into the two known ones. That is the single highest-value open thread.

**First three things the next session should do:**
1. Take one of the off-by-one patients and diff `athenaChartSnapshot.problems` against
   `p.problems` row by row — shapes only. Which single row vanishes, and does it share a
   normalised key with a survivor?
2. The 5 empty ones have `hasFactsSnap: false`. Determine whether `organizePatientHistory` ever
   ran for them, and if not, why the snapshot exists without it.
3. Only then decide whether b758 still ships. Its comma fix is independently correct; its
   unread-slice guard fixes a real code path that is not currently firing.

---

## 4. WHAT WAS FOUND AND FIXED THIS SESSION

**b757 — phone.** Dock overflowed a 320px screen by **+27px**, measured, with the failure
boundary pinned at exactly 347px (360px Androids have 13px spare, so the breakpoint is 346, not
365). Four sub-44px tap targets, each identified by measuring the **live node** — the 17×44
close control is *not* `button.modal-x`, proven by `e.matches()` returning false. The
"135 inputs risk iOS zoom" claim was **wrong**: an `!important` 16px blanket already covers them
and `computedUnder16` measured **0**.

**b758 — the problem list.** Two defects found by *running* production code with a control row:
`organizePatientHistory` deleting Athena facts it never re-read while reporting `ok:true` (12→6
with a missing receipt, total wipe with none), and `split(/[\r\n;,]+/)` shredding ICD-10 wording
so "Spinal stenosis, lumbar region, with neurogenic claudication (M48.062)" becomes three rows.
**See §3 — the clobber is not the live cause.**

**b759 — mojibake.** His "loading thing" existed and rendered as rubble. Three status messages
led with `0xCF`, `0x13`, `0xA0` — remains of multi-byte emoji written into a latin1 file. His
*success* state was invisible. Fixed as ASCII escapes (`↻ ✓ ⚠`).

**b760 — the pull-visits check mark.** It was never deleted; the Settings copy has existed since
b743. The Tools row meant to make it findable **never rendered once**: `toolsResolve` rejects a
bare `<input type=checkbox>` because `textOf` finds no text on it, one line before `spec.as` is
read. **And the suite written to prevent exactly this certified it** — it proved "offered" by
regex-matching the spec literal in source.

---

## 5. THE COLLAPSE — most owner UI complaints were already fixed

#38, #39, #41, #42a, #42c, #43, #34 and the dead arrows are all **already repaired in b748 or
b739**, which he is running. Either his screenshots predate those builds, or the fixes shipped
*present, correct, and unconsumed on his path* — which is b748's documented reputation.

**This is one question, not eight.** `scratchpad/ONE-LIVE-PASS.js` answers all of them in one
paste. The arrows are datable: the `›` chevron in his screenshot **cannot render at ≥b748**.

---

## 6. THE METHODOLOGY — fifteen instrument errors, and what survived

Three nearly shipped as fixes for defects that did not exist. **Every one shares a shape: a
probe that could not have detected the thing it reported absent.**

| the probe | what it reported | the truth |
|---|---|---|
| `.pf2-sec` count in a hidden tab | builder never invoked | hidden-tab timers are **frozen** — 0 ticks in 30s |
| CSS rule scan | no rule matches | **0 rules across 208 stylesheets** — cross-origin `cssRules` throws into a swallowed catch |
| latin1 scan for U+FFFD | no mojibake | latin1 **cannot produce** U+FFFD |
| `#toast` geometry | a 344×1085 opaque column | a screenshot showed a normal pill |
| grep for perf markers | `HEAD:0 perfbranch:0` | **zero on both sides** — read only the first number |
| reachability sweep v1 | 86 suites | it said `SWEEP IS BLIND` itself — caught by its own control |

**Tools falsified on this repo, with what to use instead:**

- `grep` for marker strings → cannot answer "is this content present"
- `git diff HEAD...branch` → would have called the perf branch 975 lines; real delta was **2**
- `git merge-tree` → "zero conflict markers" on files that produced **3 real conflicts**
- **What works:** merge into a throwaway detached worktree, read the **staged diff vs HEAD**.
  Right 3 times out of 3.

**The rules earned:**
1. Before believing an absence, prove the probe could have seen presence. Build a **positive
   control** into the instrument.
2. Measure, then **look**. Geometry proves size and reachability; only pixels prove painting.
3. Disproving a *mechanism* does not disprove the *defect*.
4. A receipt that measures the wrong thing is worse than no receipt.
5. **22 of 38** reachability suites prove their claim by matching source text. Named ≠ resolved.
6. Two sessions agreeing is **not** evidence — we both repeated an inherited claim about the
   default provider through three briefings until someone opened the file.

---

## 7. PREPARED AND WAITING

- **`scratchpad/ONE-LIVE-PASS.js`** — one paste, one pull, one command. Answers §5 entirely.
- **Six one-session specs** — boot, diarization, Mac, AI-surface audit, loading/motion,
  write-back.
- **`BOOT_WHAT_THE_PERF_COMMITS_MISSED.md`** — the boot analysis. Every perf commit is a *view
  gate*; what is untouched is **always-on** work: 96 whole-document subtree observers, 131
  sub-second intervals (fastest **18ms**). Explains the 1.4s hidden-tab boot vs 10,929ms
  foreground TBT, why bundling was measured at ~2% and rejected, and why synthetic accounts
  never reproduce him.
- **`REACHABILITY_PROOF_AUDIT`**, **`BRANCH_AUDIT`**, **`HONEST_STATE`** — all committed.

---

## 8. OPEN, IN PRIORITY ORDER

1. **The third problem-loss mechanism** (§3). 61 rows missing across 16 patients with perfect
   receipts. Nobody has found it.
2. **Boot under 5 seconds.** His loudest non-Athena complaint. Candidates and discriminators are
   written; needs a **foreground** tab.
3. **#42b** — success banners firing per-patient during a batch pull. The batch guard exists for
   warnings only.
4. **#40** — two bare sparkle glyphs. Inventory built, 3 candidates eliminated, 1 standing.
   Budget for *reachable but invisible*: ez3 controls are near-white and every calm repair is
   scoped to `#mlsEz3`; emoji ignore CSS colour.
5. Medications: **owner decision**, pace vs completeness.
6. `bump-build` corrupts bNNN in comments — b759 appears **112×**. Quiet-day job.

---

## 9. DO NOT REPEAT THESE

- Do not propose **bundling** for boot. Measured at ~2%, already rejected.
- Do not merge **`worker-a-ui`**. It would collapse five admin buttons into five reading
  "Refresh".
- Do not delete the fourteen branch pointers. Only irreversible action available; costs nothing.
- Do not trust a source-read as proof that something works **on his lane**.
- Do not measure timing or layout in a hidden tab. `innerWidth` reports 0 and every rect lies.
