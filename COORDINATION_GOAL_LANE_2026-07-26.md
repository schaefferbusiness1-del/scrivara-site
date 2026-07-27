# COORDINATION — goal lane, 2026-07-26 (started ~10:36 AM)

**Session:** full-ownership release mission (audit / redesign / test / publish / validate).
**Checked at start:** all other sessions report `isRunning:false` — QA lane stopped 10:21 AM,
phone-app lane stopped 10:18 AM. Nobody else is moving.

## Claimed work

1. **The uncommitted b671 watchdog fix in THIS lane's `ScribeFlow.html`** (97 insertions,
   `sfArmGateWatchdog` — the stuck-loading-screen P0). The QA lane wrote it and stopped
   before testing/shipping. This lane is completing it: pin test (both directions), full
   gate, bump to b671, ship, live verification. Attribution to the QA lane preserved in
   the commit message.
2. After b671: audit fan-out (app views, public pages, extension surfaces, responsive),
   the four `mls-connect.js` idle timers (§2.1 of HANDOFF_QA_LANE_2026-07-26.md),
   defect fixes / weak-page rebuilds, E2E reruns, final release + report.

## Ground rules I am following

- Verify on the RUNNING page, never the served file.
- Never re-open items in HANDOFF_QA_LANE_2026-07-26.md §3 (closed, verified).
- `background.js` byte-edit only; build bumps boundary-anchored; no deploys during a live pull.
- Hard stops: orders, real-patient writes, payment PRs. Writeback tests only Adam J Schaeffer.

## Build ledger (this lane)

| build | what | status |
|---|---|---|
| b671 | gate-loading watchdog (`sfArmGateWatchdog`) — loading screen must always end | LIVE, clean-state verified (Worker C) |
| b672 | pts-rowguard-2.0.0 (generation rule + pull shield) + sv-1.1.1 re-save cooldown | LIVE, clean-state verified (Worker C) |
| b673 | AI Studio dock destination (owner directive) | LIVE, clean-state verified (Worker C) |
| b674 | ext 3.0.21 (sfp-1.0.0/1.0.1 schedule freshness, Worker B) — zip byte-verified 60cb01b9… | LIVE; NOT yet pong-verified on a running machine |
| b675 | churn: paintFab/paintChip re-decoration wars end (Worker C); timer-brief corrections | LIVE |
| b676 | vc-2.0.0 bubbles retired + record pill Pause/Resume-only + Worker A contrast (2 gates) | LIVE, owner-tab verified |
| b677 | extension badge compares installed↔channel; texts honest | LIVE, badge verified green |
| b678 | Worker E: dock owns its clicks (ft-1.1.4 + toast hit-hole), calendar 58→12, Teams ready-but-held | LIVE, 9/9 dock ownership verified |
| b679 | Worker D: vf-1.0.0 one-primary-per-state + vo-1.0.0 combined voice control, 177→64 controls | LIVE, single-textarea verified |
| b680 | Worker F: dark 170→12 panels, radius 16→7, headings, motion tokens | LIVE |
| b681 | exact-modules imp() literals → theme tokens (24 sites, 8 modules, loader tokens bumped) | LIVE ⚠ shipped on a red pin-only gate — recorded |
| b682 | parity engine pending-latch reset | LIVE (insufficient alone) |
| b683 | parity schedule races frame vs timer (occluded-tab posture) | LIVE: passes 5, 1487 rules, 0 white cards, owner-tab DARK verified; theme restored light |

## In flight (workers)

- D2: Advanced-visit-workspace retirement + op-notes accessibility (owner directive)
- E2: Analysis merged into AI Studio (owner directive)
- G: voice assistant ↔ Copilot unification; recording pickup constraints; honest turn labels (owner directives)

## The owner's tabs (identified 2026-07-26, owner: "I gave u all needed tabs")

| tab | what it is | use |
|---|---|---|
| athenanet.athenahealth.com (athenaCollector v26.7 FL, practice 22724) | the owner's SIGNED-IN athenaOne | live pull testing; reload after extension updates; READ-ONLY |
| mlsscribe.com/ScribeFlow.html | the owner's signed-in MLS app (leeschaeffer41@gmail.com) | live verification, probes, pull driving |
| dashboard.render.com (project prj-d8gt7s7lk1mc73dnns2g) | backend hosting dashboard | backend checks/deploys if needed |
| github.com/schaefferbusiness1-del/scrivara-site | the site repo | reference |

Extension reload protocol (PROVEN today, zero owner action): push bytes into
`C:\Users\Micha\Downloads\MLS_Assist_v1.65` (the folder Chrome actually runs —
audit-loaded-extensions.ps1 confirms) via auto-load\push-build.ps1 -Src <extracted zip>,
then postMessage mlsDevReload on the mlsscribe tab, reload BOTH tabs, pong-verify.
First mlsDevReload in a stale tab context returns {error:'extension error'} — reload
the MLS tab and retry once.

## Live evidence ledger (2026-07-26)

- ext 3.0.21 pong-verified on the owner's machine (was 3.0.18 — 3.0.19/3.0.20 never installed).
- Arm A freshness: liveSessionProven=true via athena-frame-load, staleRisk=fresh, no sentence on a healthy pull.
- History pull Jul-28: VERIFIED COMPLETE — 21/21 rows done, day ledger complete, ~9.5s/patient, 0 failures.
- b676 visually verified on the owner's tab: bubbles GONE, AI Studio in dock, record pill idle-hidden.
- Row-guard log active on the live store (1 carried row logged, clock rule, non-pull).

## Waiting on the owner (live-session steps)

1. Tab identification (Chrome connection is ACTIVE; group tab created; none of the owner's tabs touched).
2. Install/refresh ext 3.0.21 → pong must report 3.0.21.
3. Three-arm freshness live test (§6.2 of WORKER_B_EXT_REPORT_2026-07-26.md).
4. Read `window.__mlsPtsRowGuardLog` + `staleRisk` on the owner's tab during a real pull (save-loss live confirmation).
5. Identify the "top Start recording extra button" on the owner's real layout before removal (preview hides the dock and reflows; refusing to guess).
6. Confirm retirement of the bottom-left "Voice & assistant" floating cluster (screenshot suggests it duplicates dock routes; b669 furniture-clearance test must move with it).

## Escalated by Worker B (not yet fixed — queued)

Six handOff-class false-success defects, worst: mls-popup.js:236 unconditional
"✓ Draft written"; feat_mls_status_center.js:817 renders a wrong-patient sign
REFUSAL as green (root cause background.js:11814). Two lying strings:
keep-alive `armed:true` after injecting a no-op; background.js:10915 announces
a "freeze-guard reload" that does not exist.

If you are another session reading this: announce yourself here before editing
`ScribeFlow.html`, `mls-connect.js`, or `tests/` in this lane.

---

## Goal-lane takeover session — b716 SHIPPED, WORKROOM STAGE 1 LIVE (2026-07-27 ~4:30 AM)

**b716 (4867fc8) verified on the occluded tab:** the room measures 2270×1268
full-screen, rail + editor + tabs render, EVERY satellite kept working (the
Fields box SELF-APPEARED inside the room with all 9 fields, suggested values
already applied into the live note, per-field mics, "Use every time",
Dictate-to-fill, honest "save to History (5 blanks left)"). The tab was
restored to its Monday-ready state (Michele active). NEXT IN THE CHAIN:
Stage 2 (editor parity + template rail with health badges + cc date naming +
context receipt line), Stage 3 (in-room Templates tab), Stage 4 (presentation
retirement + walkthrough), then the auto-follow extension release and the
write-back walkthrough. The plan doc is the single source; claims here before
every gate. No claim open; tree clean at 4867fc8.

## Goal-lane takeover session — TWELFTH CLAIM OPEN (2026-07-27 ~4 AM)

**claiming next build (b716), WORKROOM STAGE 1: #opPrepModal becomes the
full-screen room (option C — container id, class-toggled open, and the pinned
role/aria attrs all byte-identical; every satellite anchor id kept in place:
ModeRow/DayRow in the rail, GenAllBtn still in a .row, Status/Empty/List in
the editor). Tab strip: Procedures active; Templates routes to the REAL
openTemplates() until Stage 3. Room module opr-1.1.0 owns ESC (templates-
over-room closes templates, room survives). CSS beside the settings
wide-modal block; shell fills the backdrop so no mousedown-close pixel
exists. Gating now.** ⚠️ No `git add -A`.

## Goal-lane takeover session — b713/b714/b715 SHIPPED, claims closed (2026-07-27 ~3:30 AM)

**THE FILL-IN-THE-BLANK CHAIN IS CLOSED, live-proven under the strictest
conditions** (occluded tab, resumed draft, zero hands): the Fields box now
self-appears within 3s of the drafter opening — "✏️ 9 fields need you
(5 blank · 4 suggested)". Three real defects, three builds:
b713 (the [CAPS] shape the generator emits was invisible to the box — 8/10
blanks; + failures surfaced on lastFillError) · b714 (boot's first tick ran
bare; the interval's creation no longer depends on it) · b715 (THE ROOT:
visibilityState 'hidden' — Chrome throttles occluded-tab intervals to
~1/min, the app's REAL posture behind athenaOne; the three drafter openers
now kick a SYNCHRONOUS tick + 150/700/2000ms ladder).

⚠️ URGENT FOR THE OWNER BEFORE MONDAY CLINIC: the QA-debris template
("QA Bilateral Lumbar Facet Injection 20260722") AUTO-MATCHED a REAL Monday
patient (Michele C Gatti, R L2/L3/L4MB & L5 DR B facet procedure) in tonight's
verification. If he drafts her op note today, the QA template fires. The
replacement pack (OP_NOTE_TEMPLATE_PACK_2026-07-23.md) should be installed
WITH him before drafting. The tab was left Monday-ready: Michele active,
up-now banner on Bernard 7:30 AM, nothing drafted for any real patient.

## Goal-lane takeover session — ELEVENTH CLAIM OPEN (2026-07-27 ~3 AM)

**claiming next build (b715), onf-2.12.0 — THE REAL ROOT of the Fields-box
deadness, proven: `document.visibilityState === 'hidden'` — the MLS tab sits
occluded (its REAL posture, behind athenaOne) and Chrome throttles hidden-tab
intervals to ~1/minute; zero ticks across repeated 5s watches while a manual
tick built the box instantly. The drafter's three openers now kick a
150/700/2000ms tick ladder (first-party wrap idiom, idempotent); the interval
stays for steady-state. b713's shape fix + b714's boot hardening remain
genuine defense-in-depth. Token onf2111→onf2120 + version pins ×3. Gating
now.** ⚠️ No `git add -A`.

## Goal-lane takeover session — TENTH CLAIM OPEN (2026-07-27 ~2:30 AM)

**claiming next build (b714), onf-2.11.1 — b713's live acid test found the TRUE
root of the dead Fields box: boot() ran the first tick BARE before creating the
interval, so one boot-time throw left the whole session tickless (proven live:
export installed, manual tick() built the box perfectly — "9 fields need you" —
interval dead). boot now safe-wraps the first beat; pin added; token
onf2110→onf2111 + version pins ×3. Gating now.** ⚠️ No `git add -A`.

## Goal-lane takeover session — NINTH CLAIM OPEN (2026-07-27 ~2 AM)

**claiming next build (b713), onf-2.11.0 — the Fields box sees every placeholder
shape ([CAPS] added to fillTokens/renderLayout/sigOf/mainBoxWithBlanks from ONE
shared source + replaceToken fills it) and buildFillBox failures land on the
export (lastFillError) instead of dying in a bare safe(). Token
20260723onf2100 → 20260727onf2110 in both connectors + 2 pins; VERSION pins
moved in 3 suites. Gating now.** ⚠️ Do NOT `git add -A` — my dirty files are mine.

## Goal-lane takeover session — b712 SHIPPED + HARD-GATE EVIDENCE (2026-07-27 ~1:45 AM)

**b712 (fe4c43f) LIVE**: workroom Stage 0 module installed (opr-1.0.0 verified
on the running page). ⚠ Its first gate was RED: my b711-shaped preview-runtime
token sat inside the bump script's rewrite pattern — the bump moved the page
tag but not sw.js, forking page from precache. Token re-shaped 20260726pv711
everywhere + a new pin FORBIDS build-shaped tokens on that asset. Frozen
tokens must NEVER look like bNNN.

**PULL CAMPAIGN (owner's hard gate) — 5 real pulls at b711/b712, ext 3.0.22,
zero failures, zero missed histories:** Jul-28 21/21 done · Jul-27 18/18 done ·
Jul-25 honest "No appointments" · Jul-28 re-pull idempotent 21/21 no dupes ·
Jul-24 5/5 done. Every receipt: all rows state:"done" on real appointment-id
keys + day-complete ledger. 44 identity-gated history reads, 44 passed. The
one refusal all night: "Pull today" with the Athena tab parked on a stray
Aug-1 view — the date guard NAMED it (honest, remedied by navigating the tab).

**VERIFY-IN-ATHENA**: machinery proven by the same 44/44 lane; the button's
guard fail-closes on provider-less rows with a named reason. Interactive
click-through on a provider row → rides the write-back walkthrough lane.

**FILL-IN-THE-BLANK (owner: "confirm it exists")**: it EXISTS and is rich
(fields, per-field mic, dictate-to-fill, defaults, one-click save) but TWO
defects found live: (A) fillTokens (onf:248) can't see the [CAPS] placeholder
shape the generator emits — 8 of 10 real blanks invisible by shape (the
quarantine scanner knows all three syntaxes; the fill box knows two);
(B) on a RESUMED draft the box silently fails entirely (exception swallowed
by safe() in buildFillBox — the silent-failure class the workroom plan
flagged). Fix = onf-2.11.0, folded into workroom Stage 2. NEXT LANES:
workroom stages 1-4, extension auto-follow (bidirectional), write-back UI,
onf-2.11.0. No claim open; tree clean.

## Goal-lane takeover session — FINAL STATE (2026-07-26 ~midnight)

**Live = b711. Release regression GREEN and logged**
(tests/live-e2e-artifacts/2026-07-26-b711-release-regression.md): two
consecutive clean passes over every surface, E2E 30/30 (puppeteer-core
reinstalled at C:\Users\Micha\mls-e2e-puppeteer), Jul-28 pull 21/21 done on
real appointment-id keys + day-complete ledger.

**OWNER DIRECTION (via question tool, ~midnight) — op-note workstream v2:**
auto-save = MLS record with patient+date+procedure naming (he DECLINED
auto-writing into Athena — review gate stands); Athena navigation = AUTOMATIC
follow of MLS context (extension 3.0.x work; never mid-pull, switch in MLS
Controls). Full v2 scope in OPNOTE_WORKROOM_PLAN_2026-07-26.md — the workroom
build (4 stages) + nav-follow + cc-naming + context receipts + write-back UI
are THE next lanes. No claim open; the tree is clean at d1dd069.

## Goal-lane takeover session — b711 SHIPPED, claim closed (2026-07-26 night)

**b711 (c0a5ccf) LIVE, both fixes verified:** preview dock clears the SAMPLE
WORKSPACE strip (measured 7px clearance, was 32px overlap — every prospect saw
a half-eaten dock); history op-note rows say the name once ("Bernard P Brooks —
B/L L5 TF ESI P", was doubled). ⚠ public-preview-runtime's token is pinned in
FOUR places (page tag, sw precache, integration + runtime suites) and the
integration pin is now asset-aware — policy stays b497 until its bytes move.

## Goal-lane takeover session — b710 SHIPPED, claim closed (2026-07-26 night)

**b710 (e34f289):** the visit home follows the banner patient (canonical
homeSig() tracks the active-patient id; found live-verifying b709 in both
directions). **b709 (adb4c34) live-verified end-to-end** with a real draft on
the [MLS TEST] patient: manual pick honored + "(your selection)" label, note
follows the hand-picked template heading-for-heading, honest [[slots]],
attestation block, autosaved to History.

**THE WORKROOM PLAN IS COMMITTED: `OPNOTE_WORKROOM_PLAN_2026-07-26.md`** —
option C (keep #opPrepModal as the room container; reparent #templatesModal
whole), 4 separately-green stages, 11 satellite injection points pinned, the
modalOpen() display gate named as the decisive seam. Any lane building the
workroom starts THERE.

## Goal-lane takeover session — FIFTH CLAIM OPEN (2026-07-26 night)

**claiming next build (b709), op-note reliability pack (oni-2.15.0 → 2.16.0):
fidelity graded against the same 12k slice the model saw (+ truncation named in
the failure), maxTokens:4096 on /api/complete, the template dropdown sets
tplManual itself and stops claiming (auto-matched) for hand picks. Token
20260723oni2150 → 20260726oni2160 in BOTH connectors + 4 pin lines + 2 VERSION
pins; crossAdapt untouched (owner: always-adaptive). Gating now.**
⚠️ Do NOT `git add -A` — my dirty files are mine.

## Goal-lane takeover session — b708 SHIPPED, claim closed (2026-07-26 night)

**b708 (994d40e) LIVE, verified light AND dark at the owner's zoom:** hero
collapses to a slim row once a thread exists (blurb hidden, orb 28px — note the
hero PADDING in the dock context is owned by the byte-pinned !important layer in
feat_athena_tooltip_dedupe; don't fight it, the collapse reads fine); identity
strip is a quiet ruled line (content untouched — safety layer's); chips
transparent; disclaimer footnote; green bubble shadow; dictate chip never
instantiates over #copilotInput (data-mls-no-dictate).

**OWNER DIRECTION RECEIVED (via question tool, 2026-07-26 night) — op-notes:**
1. UI rebuild = **FULL WORKROOM**: one full-screen op-notes room (day's
   procedure list + draft center + template picker with health badges);
   Templates becomes a tab of the same room; both old modals retire.
2. Template behavior = **ALWAYS ADAPTIVE** (his b509 ruling STANDS — he
   explicitly declined manual-pick-strict). Faithfulness work therefore targets
   the real bugs only: the 12k slice/fidelity mismatch (score against what the
   model SAW), maxTokens unset on /api/complete, the dropdown not setting
   tplManual itself, and template hygiene (QA-debris templates catch real
   patients — see OP_NOTE_TEMPLATE_PACK_2026-07-23.md).

## Goal-lane takeover session — b707 SHIPPED, claim closed (2026-07-26 night)

**b707 (183626f) LIVE and verified end-to-end at the owner's zoom:** All-in-range
panel bounded 30,927px→3,492px page height (panel scrolls 18,456px internally at
901px tall); sticky "‹ Back to the calendar" visible mid-scroll, with tools
hidden, and on the pull-plan view; exit click restores the grid. ⚠️ calpro's
frozen token is pinned in TWO suites (calendar-list-keeps-its-exit +
visible-control-context-accessibility-contract:22) — both moved together.
First gate attempt was red on the second pin; nothing shipped red.

## Goal-lane takeover session — b706 SHIPPED, claim closed (2026-07-26 night)

**b706 (27c048c) LIVE and verified on the owner's-zoom tab:**
- Visit right-now Start-Recording duplicate GONE (bar `.empty` 0×0 on visit; the
  hero #ez3ActiveGo is the one recording surface).
- Record under an unproven binding: end-to-end proof on the [MLS TEST] slot
  (Adam J Schaeffer, Jul 18, no provider, no appt id): hero click → "Proceeding
  as an UNSCHEDULED visit" banner + toast → consent gate → CAPTURE RUNNING →
  stopped, state restored (Bernard active, Today). Measured context: 2,788 of
  3,090 rows in the live store carry no Athena appointment id.
- Three suites that byte-pinned the old fail-closed line were updated
  deliberately (easy-canonical-action-owner, visit-exact-appointment-binding,
  visit-exact-action-gate — the runtime harness now proves demote + the
  preserved DOB-conflict block). First gate attempt was RED on those pins;
  gate-then-commit meant nothing shipped red.

## Goal-lane takeover session (2026-07-26 late evening) — claim CLOSED

**The ask-bar work I claimed as b704 shipped LIVE inside b705** (3a5a7fc): while my
full gate ran green (356/356, exit 0) on my bytes, the b705 lane's `git add -A`
in this SHARED checkout swept my staged files into its delete-row commit and
pushed. My bytes are unchanged (verified: -w diff of feat_b18_qa.js is exactly my
10 lines; the 1213-line stat was line-ending noise). A second full gate on the
combined pushed tree was then run by me to certify the merge of the two
workstreams — result recorded below when read.

Live-verified on the owner's-zoom tab at b705: ask input 172px + data-mls-no-dictate,
zero-match renders the "Ask MLS Copilot" row, Enter sends the question into an
opened Copilot dock (user bubble + answer), dictate chip and b18 chip both absent.

⚠️ Standing lesson re-learned: TWO sessions gating in ONE checkout will ship each
other's staged work. If you are another session: announce here BEFORE staging, and
never `git add -A` without checking for foreign dirty files.

---

## Studio-save lane — CLAIM CLOSED, nothing gating (2026-07-26 evening)

Adopting the announce-before-staging protocol. **No claim open — this lane is done**;
I will add a `claiming next build, <topic>, gating now` line here before any future
`run-all`, and delete it after push.

**Shipped and LIVE: b696, b697, b698, b700** — "Build a custom tool" saved nothing and
said it did. Each verified on the owner's tab; full 354-suite gate green (340 PASS,
exit 0) on b698 and b700. Main is at **b700**, past your b699.

**Footprint — I did NOT touch your continuity walkthrough.** My four commits changed
exactly: `ScribeFlow.html` (studio save layer + the My-creations card), `tests/`, and
`tests/fixtures/ui-control-manifest.json`. `mls-connect.js` and `ScribeFlow-staging.html`
appear in my diffs **only because `scripts/bump-build.js` writes the build token into
them** — verified: zero non-build-token lines across all four commits. **No change to
`feat_mls_calm_views.js` or the ez3 home renderer.** I added no new direct child of
`#studioView`, so E2's section-membership map is unaffected — confirmed live with your
Ask/Practice/Build switcher active.

**One thing that will bite any lane touching the studio:** `mls-connect.js` b39
`toolUpgrades` (~line 32245) auto-saves after every build by calling
`window.studioSetSaved` **directly**. My first attempt put the account push in
`saveStudioWidget`; it silently never ran, and the card claimed "☁ in your account"
while the server held nothing. Only the running page showed it. Put studio persistence
in `studioSetSaved` — the one door all three writers pass through.

**Correcting my own record:** b696/b697 went out on a targeted subset while we were
racing for build numbers, and the full suite afterwards caught a real violation I had
introduced (off-scale `border-radius:9px` vs `one-radius-scale`). Fixed in b698. If any
lane judged main's health by those two builds, that is why.

⚠️ `dispatch-work/claude-commercial-20260717` is ~277 commits behind origin/main with 95
dirty files. `/mls-build-ship` still names it as *the* site repo; shipping from it would
roll the site back ~140 builds. Ship from a fresh `git worktree add --detach <dir>
origin/main` instead.


---

## CLAIM b717 — goal-lane takeover session (2026-07-27 ~04:45)

**Claimed by:** goal-lane takeover session (same session that shipped b705–b716).
**Scope:** Workroom Stage 2a — owner-approved op-note auto-naming. cc becomes
`patient — <Mon D, YYYY> — procedure (op-note draft|op note)` at all three stored
sites (both autosave shapes + explicit save). Rows carry `dateKey` from both
builders; `_opCcDate()` fail-safes to '' on unknown days. Draft-resume unaffected
(procedure containment — pinned). New suite `opnote-autoname-date-contract.test.js`
(vm-proves the fail-safe) registered in run-all. Files: ScribeFlow.html,
tests/run-all.js, the new test. Full gate about to run; commit only on exit 0.

## CLAIM b718 — goal-lane takeover session (2026-07-27 ~05:10)

**Claimed by:** same session. **Scope:** b717 follow-through — live verify found
every row STILL missing dateKey: `feat_mls_opnote_integrity.js` REPLACES
`window._opNewRow` with its own `newRow` (line ~1183), so the 7th param added to
the base died at the override (the exact defect class oni-2.10.0's own comment
warns about for `scope`). oni 2.16.0 → 2.16.1 carries dateKey; token
20260726oni2160 → 20260727oni2161 in BOTH connectors + 4 pin lines + 2 VERSION
pins; opnote-autoname-date-contract gains the "running owner" pins (base
function ≠ running function). Gate about to run; commit only on exit 0.

**b717 + b718 SHIPPED and live-verified (2026-07-27 ~05:40).** b717 = auto-naming
(patient — date — procedure) at all three stored cc sites. b718 = the follow-through
its live verify demanded: oni's replacement _opNewRow now carries dateKey
(oni-2.16.1). Proof on the owner's signed-in tab: 18/18 real Monday rows carry
dateKey 2026-07-27; composed title "Anne — Jul 27, 2026 — B/L L3, L4MB & DR B #1 P…".
Claims closed. Next: workroom Stage 2b (rails) under a fresh claim.

## CLAIM b719 — goal-lane takeover session (2026-07-27 ~05:55)

**Claimed by:** same session. **Scope:** Workroom Stage 2b — the rails come alive.
opr-1.1.0 → 1.2.0 (auto-busted loader, no frozen token): revertible opPrepRender
wrap = synchronous onf Fields kick (b715 occluded-tab law: a mid-draft re-render
must never wait a throttled minute for its Fields boxes) + #oprRowNav patient nav
(status dots, click scrolls + .opr-cur) + #oprTplRail (health via NEW
__mlsTplPrepFix.healthOf export — owner-sourced, never a copy) + #oprReceipt
honest context line. Markup adds the three room-owned nodes; room CSS extends the
Stage-1 block. New suite opnote-room-stage2-contract vm-RUNS the module (wrap,
kick, rails, revert) — b718's running-owner lesson applied from day one.
Files: feat_mls_opnote_room.js, ScribeFlow.html, mls-connect.js, tests. Gate
about to run; commit only on exit 0.

**b719 SHIPPED and live-verified (2026-07-27 ~06:20)** — rails alive on the live
page: 18-patient nav, 5-template health rail (owner-sourced healthOf, honestly
"legacy" across the board), honest per-patient receipts (Anne: 0 verified visits;
Lisa A March: 13 — real per-patient data), selection + highlight + receipt all
follow the click, wrap proven installed. Live drive caught ONE defect:
smooth scrollIntoView is rAF-driven → NEVER MOVES occluded (card 1908px below
fold, scrollTop 0). b720 claim: opr-1.2.1 visibility-conditional scroll +
contract pin. Same class as b715/calm-views — frame-vs-timer, now frame-vs-scroll.
