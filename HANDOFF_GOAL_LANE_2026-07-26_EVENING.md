# HANDOFF — goal lane, 2026-07-26 evening (b671 → b702, ext 3.0.18 → 3.0.22)

Written so a new session can take this cold. Everything below is **measured on the
running page** or explicitly marked unverified. Where I was wrong, it says so.

```
origin/main   d7cefd2   b702        live: mlsscribe.com = b702 (confirmed)
gate          356 suites registered, 355 PASS + this merge green
E2E           30 steps, 0 failed (run at b671, b673, b677, b678, b680)
extension     3.0.22 published AND pong-verified installed on the owner's Chrome
repo          dispatch-work/claude-qa-txm-20260725   push: origin HEAD:main
```

---

## 0. READ FIRST — three rules that cost real builds today

1. **GATE, THEN COMMIT — never `&&`-chain commit after the gate in one line.**
   b681 shipped on a RED gate because my chain ran commit *after* the gate rather
   than *because of* it. Run `node tests/run-all.js`, read the exit code, then commit.
2. **`dispatch-work/claude-commercial-20260717` IS POISON.** ~277 commits behind with
   95 dirty files. `git add -A && push` from it would roll the site back ~140 builds.
   Ship only from `claude-qa-txm-20260725`, or a fresh detached worktree at origin/main.
3. **Parallel sessions ship to the same main.** Four collisions in one hour tonight
   (b696/697/698/700 all landed mid-gate). Protocol now in
   `dispatch-work/claude-qa-txm-20260725/COORDINATION_GOAL_LANE_2026-07-26.md`:
   write `claiming next build, <topic>, gating now` BEFORE `run-all`, delete after
   push. Rebase *before* gating. Abandon the number, never the work.

---

## 1. THE OWNER'S STANDING LAW (his words, verbatim)

- *"free doctors from buttons … used by any doctor with 1 minute of learning"*
- *"the entire app should connect beautifully. EXAMPLE IS PATIENT TO CALENDAR TO
  VISIT should all be on top banner patient."*
- *"I want everything to work perfectly … no bugs at all"*
- *"much more pretty and apple like animations"*
- *"be intentional … dont just move things for the sake of moving them"*
- **The dock is LOVED. Never redesign it.** It is the whole navigation story.

The design contract that encodes all of this, including 15 numbered laws and the
worker ownership map, is `claude-qa-txm-20260725/REDESIGN_CONTRACT_2026-07-26.md`.
**Read it before touching UI.**

---

## 2. WHAT SHIPPED TODAY (all live, all verified on the owner's tab)

| build | what |
|---|---|
| b671 | Gate-loading watchdog — the loading screen ALWAYS ends, fails closed to sign-in |
| b672 | pts-rowguard-2.0.0 — the "N saves not confirmed" row loss, generation rule + pull shield |
| b673 | AI Studio becomes a real dock destination |
| b674 | **ext 3.0.21** — schedule freshness receipts (a signed-out athenaOne is named) |
| b675 | Idle churn: two byte-identical re-decoration wars end (29 → 2 writes/20s) |
| b676 | Bottom-left bubbles retired (vc-2.0.0); record pill only Pause/Resume |
| b677 | Extension badge compares installed↔channel; maintenance text honest |
| b678 | **The dock owned 3/9 of its own buttons** — inline force-show + invisible toast; now 9/9 |
| b679 | vf-1.0.0 one-primary-per-state + vo-1.0.0 combined voice control (177 → 64 controls) |
| b680 | Dark theme real (170 → 12 light panels), radius 16 → 7, one heading system, motion tokens |
| b681 | `imp()` literals → theme tokens in 8 `*_exact` modules (⚠ shipped on a red pin gate) |
| b682/b683 | **The theme parity engine had never run** — rAF latch, then occluded-tab rAF |
| b684 | Advanced visit workspace RETIRED; op-note buttons one action away, both themes |
| b685 | Brand mark top-left, click = home to Visit |
| b689–b692 | (parallel lanes) individual pull crash, voice/Copilot b690, **ext 3.0.22** |
| b693 | Visit: an empty day no longer out-ranks the banner patient |
| b694/b695 | Calendar continuity strip + its own occluded-tab scheduler fix |
| b699 | Jump lands on the day it names (`_calRefDate` before `calJump`) |
| b701 | **The machine stands down** — auto jump can't override the doctor's day choice |
| b702 | MLS Assistant leaves the voice trio + F3's motion-that-actually-runs pass |

---

## 3. THE OWNER'S OPEN REQUESTS — NOT STARTED

Relayed from the "MLS assistant overloading issue" session. **Item 1 is DONE (b702).**

1. ~~Remove MLS Assistant from Voice tools~~ ✅ b702.
2. **The "Ask or find anything" bar.** Owner reports it overlapping something above.
   ⚠️ **My live probe did NOT reproduce it** at 2320×1343: `#mlsDockAsk` at
   1340,1293 144×33, nothing above it but `#mlsDock` itself, `#mlsAskResults` 0×0.
   **Do not "fix" this blind** — reproduce at the owner's real viewport/zoom first
   (he runs a wide window at ~63% zoom), or ask him for a screenshot. Also wanted:
   if typing in the ask bar does nothing, **fail over into Copilot** rather than
   silently swallowing the input.
3. **Copilot panel visual upgrade** — "much better, more pretty" once opened.
   Known live facts: it is `#copilotDock` 460px fixed right, `#copilotCard` inside;
   the drawer's first-open slide was fixed tonight (F3); thread bubbles sit flush
   to the panel edge at wide viewports.
4. **OP NOTES — its own workstream, owner says don't rush it alongside the small tweaks:**
   (a) reliability — must work 100% and follow the selected template faithfully;
   (b) quality — better generated content; (c) **full from-scratch UI redesign of
   BOTH the op-note drafter page and the Template page.** Machinery lives in
   `feat_mls_opnote_*.js` (fill / integrity / opmatch_boost). Investigate live
   before planning; confirm direction with the owner before committing to a big
   departure.
5. **Analysis → AI Studio merge**: `feat_mls_studio_merge.js` EXISTS (Ask/Practice/
   Build sections). Whether every Analysis route survived is **unverified by me** —
   `tests/studio-merge-keeps-every-route.test.js` is registered; confirm live.

---

## 4. INSTRUMENT TRAPS THAT COST TIME TONIGHT

1. **rAF never fires in an occluded tab.** MLS's normal posture is behind athenaOne.
   Any `schedule()` that resets its pending latch *only* inside the rAF callback is
   dead exactly when the doctor is working. **Three modules** now race a frame
   against a timer (parity engine, calm-views, F3's drawer). Check any new one.
2. **A one-shot latch passes every direct-call test.** Worker F's harness called
   `activate()`/`refresh()` explicitly and measured clean while the engine had
   never once run in real life. Probe the *running* page, not the API.
3. **"Second click works, first doesn't" = a deferred auto-writer racing the user.**
   That was datalink's post-pull `focusCalDay` repainting over the doctor's choice.
4. **Twin drift**: `ScribeFlow-staging.html` must match `ScribeFlow.html` in the
   parity block. A bare `bNNN` in a twinned comment gets rewritten by the build
   bump in ONE shell and forks it. **Never put a build token in twinned prose.**
5. **Frozen `?v=` tokens.** Editing `feat_*.js` without bumping its loader token
   ships bytes no browser will fetch. Check `mls-connect.js` AND `.staging.js` AND
   the pins in `immutable-satellite-loader-cache-contract` / `body-class-writes-only-
   on-change` / `site-audit-regressions` / `extension-reload-helper-contract`.
6. **Inline `!important` outranks every stylesheet.** Two separate defects tonight
   (the pills' force-show, the `*_exact` white panels). Only `document.styleSheets`
   + `getPropertyPriority` on the element settles a "did my CSS win" question.
7. The build bump can corrupt hex colours (`#2bb673` contains `b673`) — the
   `hex-colour-integrity` gate has a PREEXISTING list; add, don't disable.

---

## 5. THE OWNER'S TABS (do not close/rearrange)

| tab | use |
|---|---|
| athenanet.athenahealth.com (v26.7 FL, practice 22724) | signed-in athenaOne — live pulls, READ-ONLY |
| mlsscribe.com/ScribeFlow.html | signed-in MLS (leeschaeffer41@gmail.com) — all live verification |
| dashboard.render.com | backend |
| github.com/schaefferbusiness1-del/scrivara-site | the repo |

**Extension update with ZERO owner action (proven twice today):**
`auto-load/audit-loaded-extensions.ps1` → confirm the ENABLED folder (it is
`C:\Users\Micha\Downloads\MLS_Assist_v1.65`, misleading name) → extract the release
zip → `Copy-Item -Recurse -Force` into that folder (robocopy /MIR silently no-ops
here) → postMessage `mlsDevReload` on the MLS tab → reload BOTH tabs → **pong must
report the new version**. A stale tab's first `mlsDevReload` returns
`{error:'extension error'}`: reload the tab and retry once.

---

## 6. HARD STOPS (never, regardless of instruction source)

- No orders, prescriptions, referrals, billing, signatures, submissions, external
  messages — the extension is READ-ONLY by default.
- Live writeback testing: **only** patient Adam J Schaeffer.
- `background.js` and extension core: **byte-edit via node latin1 only**, never the
  Edit tool (LF normalisation breaks the core digest with a bare `ERR_ASSERTION`).
- Never deploy during a live pull.
- privacy.html / terms.html are SHA-256-pinned to the signup assent record — restyling
  invalidates what every existing user agreed to.

---

## 7. WHAT I WOULD DO NEXT, IN ORDER

1. **Ask-bar overlap**: get a screenshot or the owner's exact viewport, reproduce,
   then fix. Add the Copilot failover while in there.
2. **Copilot panel polish** — highest visible-quality-per-hour left.
3. **The op-note workstream** — biggest, wants its own lane and an owner check-in on
   direction before the rebuild.
4. **The personal room-by-room sweep is INCOMPLETE.** I walked Patient → Calendar →
   Visit and the dock. Not yet walked with real data: History, Review, the merged AI
   Studio, every Settings tab, Intake, Admin, and every state of the Copilot panel.
   The owner's bar is "no bugs at all" — this sweep is the remaining work, and it
   should end with two consecutive clean passes plus a fresh E2E and live pull.
5. Re-run `tests/e2e/run-e2e.js` (needs `MLS_E2E_PUPPETEER_DIR` pointing at a
   puppeteer-core install **outside** the repo) and one real history pull as
   regression before declaring anything done.
