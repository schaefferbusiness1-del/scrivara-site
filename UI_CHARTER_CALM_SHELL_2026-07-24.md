# UI CHARTER — "Calm Shell" (options 9 + 8 + 3 + 7 + 2)

Owner decision, 2026-07-24. Supersedes ad-hoc UI-rework slices under the /goal
"free the doctor from all the buttons — complete UI rework."

The owner picked five directions from the options gallery. They are not five
projects. They are five layers of one shell, and each answers a different
question:

| Layer | Option | Question it answers |
|---|---|---|
| Dock | 9 | Where am I? |
| Right-now bar | 8 | What can I do here? |
| Stages | 3 | What happens next? |
| Heads-down | 7 | How do I disappear the screen while I work? |
| Ask | 2 | How do I reach the other 500 things? |

---

## THE PRIME DIRECTIVE — ease of use WITHOUT losing a single feature

The owner's words: "ease of use without losing any features."

Today's app is `ScribeFlow.html` (1.9 MB) plus ~250 `feat_*.js` modules, and it
contains, as measured on 2026-07-24:

- 539 `<button>` elements
- 596 `onclick=` handlers
- 13 `.navtab` rail entries (`ScribeFlow.html:1739-1753`)
- 7 header tool buttons (`ScribeFlow.html:1725-1734`)
- 12 `*View` containers, switched by `showView()` (`ScribeFlow.html:10543`)

**Nothing in that list gets deleted. Controls get RELOCATED, and a test proves
every one of them is still reachable.** A slice that cannot show its control
still reachable does not ship. "I couldn't find where it went" is a failed
slice, not an acceptable trade.

Three hard rules that follow from this:

1. **`showView()` stays.** It is called from hundreds of places across the
   feature modules. The shell WRAPS it (hosts the view inside a dock panel); it
   never replaces it and never re-implements it. Remember b473→b474: find the
   writer, never out-write it.
2. **Feature modules keep their DOM.** The new layers own layout, chrome and
   ordering. They do not rewrite the insides of `#visitView`, `#ordersView`,
   `#historyView`, etc.
3. **Hidden ≠ removed.** Heads-down mode and the Tools chip hide controls behind
   a gesture or a chip. Both count as "reachable" only because the coverage test
   records the reach path.

---

## SLICE 0 — the control inventory (build this FIRST, no UI change)

This is the slice that makes the prime directive enforceable. Nothing else
starts until it is green.

**Build** `tools/ui-control-inventory.js`:

- Walk `ScribeFlow.html` and every `feat_*.js` in the repo root.
- Emit `ui-control-manifest.json`, one record per user-reachable control:
  `{ id, label, source (file:line), view, module, kind: button|navtab|menu|chip|key }`
- Label comes from the element text or `title=`; strip emoji for matching.
- Controls already `hidden`/`disabled`/feature-gated are recorded with
  `gated: true` and are exempt from the reach requirement while gated — but they
  stay in the manifest so a later ungating does not silently drop them.

**Build** `tests/ui-control-coverage.test.js`:

- Loads `ui-control-manifest.json` and the shell's reach map.
- Asserts every non-gated control resolves to at least one of these reach paths:
  `dock` · `rightnow` · `tools` · `stage` · `panel` · `ask` · `key`
- Any control with zero reach paths **fails the suite by name and source line.**
- Register it in `tests/run-all.js` (gate goes 276 → 277).

**Acceptance for slice 0:** the manifest exists, the coverage test passes
against the CURRENT UI (every control's reach path today is `rail` or `panel`),
and `node tests/run-all.js` is green. Zero visual change ships in this slice.

---

## LAYER 1 — Dock (`shell-1.0.0`)

Replaces the 13-tab rail and the 7-button header with five destinations plus a
persistent Ask field.

**Dock destinations (exactly five, no badges except counts):**

| Dock item | Hosts today's | Notes |
|---|---|---|
| Day | `calendarView`, check-in board, schedule pull | the day is the default landing |
| Patient | `patientsView` + chart + `historyView` | one patient, one scroll |
| Visit | `visitView` + stages | the only place recording happens |
| Review | `ordersView`, `recsView`, note review, sign/send | everything that happens after the mic stops |
| Tools | `studioView`, templates, settings, admin, legal, team, analysis, staff pulls | the drawer, not a dead end |

**Rules:**

- The dock is the ONLY persistent navigation chrome. `.mainnav` is hidden by the
  shell (CSS `display:none` on `#appWrap .mainnav`, never DOM removal — see the
  fl-1.6.1 lesson).
- Header `.tools` buttons (Ask, Find, Templates, Custom widget, Settings, Log
  out) move: Ask and Find become the Ask field; the rest become Tools entries.
- Dock items open a **panel**, and a panel is just today's `*View` hosted in the
  shell's content region. `showView()` still does the switching underneath.
- Two panels may be open side by side (the option-9 promise): Patient + Visit,
  or Visit + Review. Third open panel replaces the least recently used.
- Active patient identity stays visible in every panel (today's `#patientBar`
  becomes the shell's patient header — this is a safety property, not styling;
  cross-patient confusion is the highest-severity bug class in this app).

---

## LAYER 2 — Right-now bar (`rnb-1.0.0`)

One strip under the patient header. It holds **at most three primary actions,
plus one Tools chip.** Contents are computed, never hand-authored per view.

**The state → actions table (this is the contract; extend it, don't fork it):**

| State | Action 1 | Action 2 | Action 3 |
|---|---|---|---|
| No patient selected | Pull today | Find patient | New patient |
| Patient, no visit | Start visit | Open chart | Prep summary |
| Recording | Stop | Pause | Add note |
| Stopped, note generating | (progress only — no actions) | | |
| Note drafted | Review note | Add orders | Regenerate |
| Note reviewed | Sign | Edit | Add orders |
| Signed | Send to Athena | Print/PDF | Next patient |
| Athena disconnected | Reconnect | (dimmed, honest reason) | |

**Rules:**

- Every action removed from a view goes into the Tools chip for that panel —
  it never just vanishes. The chip is the existing b519/b522 Tools surface,
  extended per panel.
- An action that is not legal right now is **absent**, not disabled — except
  where absence would be confusing (Athena disconnected), where it shows with
  an honest one-line reason. Never invent a reason.
- The bar reads state from existing truth sources. Do not add a parallel state
  store: use the active-patient sync, `__mlsConnTruth.describe()`, and the
  save/verify state that already exist.

---

## LAYER 3 — Stages (`stg-1.0.0`)

The visit becomes a line. Reuses `feat_mls_progress_stages.js` (ps-1.0.0) and
`feat_mls_visit_stepper.js` — extend those, do not write a third stepper.

**The five stages:** Prep → Record → Review → Sign → Send

- Exactly one stage is active; the others are a thin progress line at the top of
  the Visit panel.
- **Auto-advance on completion.** Stopping the recording already triggers
  generation (b520 auto-generate-on-stop); that same event advances Record →
  Review. Signing advances Sign → Send.
- Going back is always allowed and never destructive. Clicking a past stage
  reopens it; the work already done stays.
- A stage never advances on a *guess*. If generation failed, the stage stays and
  says why. Silent forward motion past a failure is a shipping blocker.
- `aria-live="polite"` announces each stage change (accessibility + it makes the
  transition legible to a doctor who looked away).

---

## LAYER 4 — Heads-down (`hdn-1.0.0`)

A mode inside the Record stage, not a separate screen.

- On entering Record, after 3 s of no input, all chrome fades except: patient
  name, elapsed time, the level meter, and one line of "what happens when you
  stop."
- Any mouse move, key press, or voice command restores chrome instantly
  (< 100 ms, no animation longer than 150 ms).
- `Esc` exits heads-down without stopping the recording. Nothing in this mode
  can end a recording by accident.
- Heads-down is remembered per device, default ON for the Record stage only.
- Coverage note: every control hidden by heads-down must still be listed with
  reach path `stage` in the manifest, since restoring chrome is one gesture.

---

## LAYER 5 — Ask (`ask-1.0.0`) — the reason no feature is lost

One input, always present in the dock. Typed or spoken. This is the universal
reach path and therefore the technical guarantee behind the prime directive.

- Reuses `feat_mls_command_palette.js`, `feat_mls_asst_fix.js` (intent parsing,
  including the b516 "pull my last month" scope work), `feat_mls_hero_search.js`
  and `feat_mls_copilot_voice_v2.js` (cv2-1.2.1 — one voice pill, keep it one).
- **Every control in `ui-control-manifest.json` is addressable by its label.**
  The manifest is the palette's index — that is how the coverage test and the
  UI stay in sync automatically instead of by discipline.
- Three result kinds: navigate (open panel/stage), act (run the control), answer
  (render a panel). Never silently act on a destructive control — pulls, sends,
  signs and deletes confirm first, exactly as they do today.
- Typing a control's old label must find it. If a doctor types "Remove
  Athena-imported patients", they land on the real control with its typed-REMOVE
  gate intact (b512) — the gate is a feature, not friction to smooth away.

---

## ROLLOUT — flag first, default later

1. Everything ships behind `?ui=calm` plus a Settings toggle. Default OFF.
2. Owner runs a real clinic day on the flag. Slices continue shipping under the
   flag while it is off by default — no big-bang cutover.
3. Default ON only after: coverage test green, one full owner day with no
   "where did X go", and a live pull verified under the new shell.
4. Keep a "Classic layout" escape hatch for at least two releases after default
   ON. If the owner ever needs it mid-clinic, it must be one click, no reload.

**Ship discipline (unchanged, non-negotiable):**

- Every slice: build bump, `node tests/run-all.js` green, deploy, live verify —
  via the `/mls-build-ship` skill.
- New `feat_mls_shell_*.js` files must be added to the loader manifest and get
  their `?v=` pin moved **with** `window.__MLS_AV` (`ScribeFlow.html:28203`).
  The service worker serves `?v=` cache-first forever — a stale pin is a
  permanent stale module, not a slow one.
- Shell modules that own first paint belong in `CRITICAL`
  (`ScribeFlow.html:28204-28215`); satellites must not block boot. Respect the
  br-1.0.0 boot-readiness contract and the loading-states suite.
- No deploys while a live Athena pull is in flight.

---

## SLICE QUEUE (each is one build, one gate, one live verify)

| # | Slice | Module | Blocked by |
|---|---|---|---|
| S0 | Control inventory + coverage test | `tools/ui-control-inventory.js`, `tests/ui-control-coverage.test.js` | — |
| S1 | Dock shell + `?ui=calm` flag, hosts existing views | `shell-1.0.0` | S0 |
| S2 | Right-now bar + per-panel Tools chip | `rnb-1.0.0` | S1 |
| S3 | Stages + auto-advance | `stg-1.0.0` | S1 |
| S4 | Ask as universal reach (manifest-indexed) | `ask-1.0.0` | S0, S1 |
| S5 | Heads-down record mode | `hdn-1.0.0` | S3 |
| S6 | Acceptance day, default ON, Classic escape hatch | — | S2, S3, S4, S5 |

S2 and S3 are independent of each other and may run in parallel sessions. S4
depends on the manifest, not on S2/S3.

---

## DEFINITION OF DONE (the whole charter)

- `node tests/run-all.js` green, including `ui-control-coverage.test.js`.
- Zero controls with no reach path. The manifest is committed and current.
- A doctor can complete a full visit — patient → record → note → sign → send —
  touching **at most 4 controls**, without opening Tools once.
- Every one of today's 539 buttons is still reachable, and `Ask` can find each
  of them by its old label.
- One live Athena pull verified under the new shell (receipts + ledger, per the
  `/mls-athena-pull-verify` skill).
- Owner runs one clinic day on the flag with no "where did it go."

---

## SHIPPED IN b533 — what actually happened, including the deviations

Built and certified 2026-07-24 in an isolated worktree at HEAD c5ec53a, because
the shared tree carried 90 modified files of another session's WIP and was red
on `visit-binding-notice-persistence.test.js` (that test passes at HEAD — the
red is theirs, and it was reported to them rather than touched).

Six deviations from the plan above. Each was a deliberate call, not a shortcut:

1. **One module, not five.** All five layers ship as `feat_mls_calm_shell.js`
   (`calm-1.0.0`). Five files would mean five loader pins in `mls-connect.js` —
   five chances to collide with a parallel session in a shared tree. One file,
   one pin, one review surface.
2. **Presentation-only architecture.** The shell does not own any behaviour: the
   dock clicks the real rail tab, the right-now bar and Tools menu click the
   real buttons, Ask resolves a phrase to a real control and clicks it.
   `showView()` is not wrapped at all — view state is read by observing which
   `.navtab` carries `.on`, since the rail keeps updating while hidden. This is
   why a whole new shell can land without touching clinical logic.
3. **Manifest lives in `tests/fixtures/`, not the repo root**, so it stays
   outside the Jekyll publication boundary.
4. **Ask indexes the live DOM, not the manifest.** A build-time index would go
   stale between builds and would miss controls that modules create at runtime.
   The manifest remains the coverage receipt; Ask reaches whatever is on screen.
5. **Side-by-side panels are NOT in v1.** Hosting two views at once needs the
   view DOM re-parented, and modules query by parent. Deferred rather than
   risked. The dock switches; it does not yet split.
6. **Default ON, at the owner's explicit instruction** ("I want it live"),
   instead of the flag-off rollout in §Rollout. The escape hatch ships in the
   same build: `?ui=classic`, a "Classic layout" button kept visible in the
   header, and the same entry at the bottom of the Tools menu. Boot is wrapped
   so any failure inside the shell tears itself down and returns the classic
   layout rather than leaving a hidden rail with no dock.

A gap found while building, worth recording because the coverage suite is what
caught the shape of it: hiding the header buttons left Templates, Settings,
Custom widget, Patient intake and Log out reachable only by typing their names.
The reach map claimed `dock:tools` for them, so the fix was to make that true —
the Tools dock item opens a real menu of every displaced control, built from the
live DOM and filtered by whether the app itself gated them.

## FOR THE SESSIONS PICKING THIS UP

- Repo: `dispatch-work/claude-commercial-20260717` (site + app).
- Read this charter, then `HANDOFF_COMMERCIAL_READINESS_2026-07-21.md`.
- Claim a slice in the task list before starting; put the slice number in the
  commit subject (e.g. `S2: right-now bar rnb-1.0.0`).
- Check `window.__MLS_APP_BUILD` after any parallel commit — a shared tree race
  has put one build's version strings inside another's before (b515).
- If a slice would remove a control with nowhere to go, STOP and add it to
  Tools or Ask instead. Ask the owner only if neither fits.
