# 3.0.55 bundle — the re-roll, the silent day, and two boundary kills (2026-08-09)

State when this session picked up: July month resumed on 3.0.54 (`__pxJuly5`), day 8
mid-flight. Supervisor demanded first-attempt splits before any headline travels.
Everything below is BUILT + locally gated; ships as one train (3.0.55) at a natural
month pause. background.js edited ONLY by `scripts/rr-splice.js` (latin1,
count-guarded); digest is intentionally stale until the train stamps.

## 1. The splits changed the headline (supervisor rule vindicated)

Per-day, from the at-creation captures (`event-driven-r4-wrapped-at-creation`),
first[name]/last[name] over settle rows:

| Day | Charts | First-attempt | Re-check-cleared | Failed | day line said |
|---|---|---|---|---|---|
| Jul 1 | 19 | 18 | 1 | 0 | "failures 0" |
| Jul 2 | 20 | 18 | 1 | 1 | "failures 1" |
| Jul 7 | 15 | 14 | 1 | 0 | "failures 0" |
| Jul 8 | 13 | 7 | 4 | 2 | "failures 2" |

- **No day tonight was pure first-attempt.** "19/19 failures 0" = 18 + 1 re-check.
  The owner's bar (first-attempt convergence) unmet on every charted day; nearest
  miss one row. A day line's "failures N" is END-STATE and hides first-attempt misses
  that re-checks cleared.
- The first-attempt metric exists ONLY for runs with the at-creation capture; all
  cross-build A/Bs stay end-state-metric.
- Day 8 at ~2h into the run still improved end-state 6→2 vs its prior read —
  evidence the build improvements contribute INDEPENDENT of run freshness (the
  elapsed-time story is real but not the whole story).

## 2. Day 6 postmortem — the silent-day class, audited then closed

Mechanism (from live probes, tab 256599255):

- The month loop's per-day REJECTION path recorded `{reason:'exception', error}`
  into `result.days` and emitted NOTHING (si:4674 pre-fix). Two more silent exits
  sat beside it: `stopped-by-user` and `not-attempted-after-systemic-failure`.
- **Ledger truth**: `authoritativeStatusForDay('2026-07-06')` = `{available:false,
  reason:'no-snapshot'}`. The ledger is RUN-SCOPED (cleared at month start —
  `_clearLedgerDone`) and snapshots are written at SCHEDULE-VERIFY, not day end
  (day 8's snapshot existed while its history was mid-flight). Day 6 died before
  even its schedule snapshot → the "schedule saved 24/24" status was in-memory
  only. **No authoritative surface claims day 6 was covered — it fails
  honest-absent, not false-covered.** The feared backlog bias does not exist.
- Raw-store check: 40 patients hold visit rows dated 2026-07-06 vs 24 on the
  schedule (rows from prior passes/other sources) — the raw sweep over-counts
  every day; July5's specific 24 schedule writes are post-hoc unprovable
  (byte-identical upserts leave no trace). ≤14 run-fresh stamps, all confounded
  with cross-day membership.
- **31-day ledger sweep**: Y for days 1,2,7,8 (rows 19/20/15/13), Y0 for 3,4,5
  (verified-empty holidays), no-snapshot for 6 and for 9–31 (not yet attempted at
  sweep time). Capture record independently agrees: 6 closes = days 1,2,3,4,5,7.
  **Day 6 is the ONLY silent day of this run.**
- J3/J4 (earlier runs): post-hoc UNAUDITABLE — in-memory month results wiped by
  the mandatory work-tab reload at the 3.0.54 install; ledger wiped by July5's
  run-start clear. Live streams showed day-end lines for every attempted day
  (stream-class evidence: a stream can omit but not fabricate — days with QUOTED
  lines did close).
- Day 6's exact exception text is recoverable at month end from
  `result.days[].error`.

**Fix (si)**: all three silent exits now emit the same date-prefixed day-end line.
**Test (sde-1.0, provider-month-exact-routing.test.js)**: poisons a REAL month run
through the actual loop with a one-shot throwing onStatus — the same bare-callback
seam a real mid-phase exception uses (si normalizes onStatus but never wraps it in
try/catch). Asserts: the dead day records `reason:'exception'` with the real error,
emits EXACTLY ONE day-end line naming it, stays retryable, and does not kill the
following day; clean-run control; source pins for the other two exits. Old code
fails it (no emit → zero lines).

## 3. failureDetails end-to-end: FAILED at the si boundary, fixed

axd-1.0 (3.0.54) made the extension emit `receipt.failureDetails` (the per-row
noRowDiag records — liTotal/eidHit: list-vanished vs row-left vs
group-resolution-failed). The end-to-end check answered itself at FILE level:
si's absorb line (saveVerifiedVisits return, si:2898) copied exactly TWO receipt
fields (surfaceResets, chartSurface) — failureDetails died at the boundary. Only
the mdx-1.1.0 reason HISTOGRAM was crossing. Day 8's two real failures (Liliana
Rolleri, John Marsh, visit-bodies-incomplete) therefore have sub-cause histograms
but no per-row records.

**Fix (si)**: bounded absorb `one.visitsFailureDetails =
vr.receipt.failureDetails.slice(0, 12)` at the mdx capture block — in-app record
only, NOT copied into `frozenRetryEntry`'s diag (the emailed-report path).
**Test**: history-refusal-diagnostics-contract.test.js — absorb pin + the
live-fixture boundary control: `visitsFailureDetails` added to the rich fixture
and the existing deepStrictEqual proves frozenRetryEntry still carries exactly
{enumDiag, hist, receipt}.

**Law (third instance in one lane): a field the emitter ships is not a field
until every boundary passes it.** (background→bridge was axd-1.0; bridge→si was
this; si→ledger is the visitsReadReceipt subset pattern.)

## 4. The namer defect confirmed live, fixed at three points

Day 8's own line rendered "Charts needing retry:  (visit-bodies-incomplete);
 (visit-bodies-" — blank names, exactly as diagnosed (receipt rows never carried
name). Fix: `name` stamped at receipt-row construction (si:3205, `row.name` is in
scope at every push site); PRESERVED across the sweep replace at si:3706 (sp rows
REPLACE one rows by patientId and would have destroyed a construction-only stamp);
masked-id fallback `#<last4>` in the day-end namer (si:4452) for any row that
still lacks one.

## 5. rr-1.0 — the in-chart re-roll (converts re-check-cleared into first-attempt)

The observed recovery class: rows fail `no-chart-frame-candidate` with an EMPTY
ax harvest, then clear on the automatic re-check AS `clincmp-ax` (3/3 dissected
on 3.0.53; day 8 had 4/13). The surface recycles itself every ~25-30s — a starved
walk with an empty harvest is usually MID-RECYCLE. rr-1.0 brings the second roll
inside the first attempt:

- Inside the axr starved-hook, when `!axBest` and `Date.now() + 42000 <
  readDeadline`: wait in 1.4s steps (touchVisitLease each), re-`axHarvest`, exit
  the moment a harvest lands; bounded `min(readDeadline - 8000, +34000)`.
- **Acceptance on this arm is the per-encounter identity gate (positive), NOT the
  srr epoch triple** — a starved walk has no bound frame whose epoch could be
  measured. The wait buys a SURFACE, never trust.
- Telemetry: `axRrWaitMs`/`axRrRecovered` on the success receipt AND
  typeof-guarded on the starved-refusal receipt (that return also serves
  identity-mismatch refusals where the hook never ran) — so a WASTED wait is
  visible, not just a successful one. si absorbs both paths (success:
  saveVerifiedVisits return → one; failure: visitsReadReceipt subset).
- Cost bound: at most one 34s window per chart, only when 42s+ of runway remains
  (deterministic floor, the axc philosophy). Classic charts that starved
  mid-recycle and come back classic will wait the full window and still refuse —
  measured by axRrWaitMs on refusals; if that shows up hot, the next build adds a
  classic re-probe arm.
- Splice: `scripts/rr-splice.js` (4 count-guarded anchors, 1,145,595 →
  1,146,921 bytes, node --check clean). Pins: 9 new checks in
  ax-native-reader.test.js (40 total) incl. order pin (arm INSIDE the hook,
  before the route body) and the si-absorb pins.

## 5b. THE RC-CLASS LOOKUP (supervisor's question) — 7/7, and it changed the build

Every re-check-cleared row of the run, days 1+2+7+8, has ONE signature: first
attempt failed at BODY DEPTH on the classic surface (faSu empty), cleared pass
tagged clincmp-ax:

| Day | Row | First-attempt reason | Cleared as |
|---|---|---|---|
| Jul 1 | Stephen | visit-bodies-incomplete {no-group×3, identity-changed…} | clincmp-ax |
| Jul 2 | David | visit-bodies-incomplete {no-group×2, stable-source-keys…} | clincmp-ax |
| Jul 7 | Stephanie | visit-bodies-incomplete {no-bound-clinical-detail×2…} | clincmp-ax |
| Jul 8 | Dillon | visit-bodies-incomplete {no-row×3, no-bound-clinical…} | clincmp-ax |
| Jul 8 | Wayne | visits-time-budget-exceeded | clincmp-ax |
| Jul 8 | David | visits-time-budget-exceeded | clincmp-ax |
| Jul 8 | Scott | visit-bodies-incomplete {no-group×2…} | clincmp-ax |

**These first attempts did NOT starve the walk** — the classic path found the
frame, enumerated rows, failed at body depth; the surface rotated to ax DURING
the classic grind (grind > one ~25-30s recycle period) and the re-check's fresh
open landed on ax. **rr-1.0's wait-arm (inside the starved hook) could reach
none of them.** The lookup was demanded before ship; it was right.

### rr-1.1 — the body-depth entry (the actual bar-met candidate)

The route body is hoisted ONCE into `axRouteRun(rrFromPartial)` (wrap-once law;
`scripts/rr11-splice.js`, landmark-guarded block replace 6,475 → 6,975 bytes):

- **Starved entry** (semantics unchanged): fires on no-chart-frame-candidate +
  15s runway; accepts ANY ax visits; the ax-identity-shape-unknown gate
  mutation fires ONLY here (`!rrFromPartial` guard).
- **Body-depth entry** (new): inside the `!bodyComplete` classic partial return,
  runway ≥ 15s → `axRouteRun(true)`; accepts ONLY `receipt.complete === true`
  (every encounter read, zero refused, zero shape-unknown); anything less keeps
  the classic partial — **the chart can never end worse than today**. A
  superseding result stamps `classicPartialSuperseded` {expected, parsed,
  failures} for auditability; a failed re-roll stamps axRrWaitMs/axRrRecovered
  onto the surviving classic receipt.
- The rr-1.0 wait-arm now serves both entries from inside the closure
  (harvest-empty → bounded 34s wait, 42s runway gate).
- `axEntry: 'body-depth'|'starved-walk'` on the success receipt, absorbed
  si-side (both absorb points + pin) — acceptance counts by entry.
- visits-time-budget-exceeded rows are OUT OF SCOPE by arithmetic (no runway at
  that return site) — they stay with the si re-check. Wayne/David's class needs
  budget work, not the re-roll.
- Identity discipline unchanged on both entries: same per-encounter
  visitIdentityGate; the Safety-stop refusal return pinned byte-identical.
- Pins: ax-native-reader 51 checks (order chain re-anchored to the closure —
  moved deliberately; exactly TWO `await axRouteRun(` call sites; complete-only
  acceptance; supersede record; entry-gated mutation).

## 5c. The variance band (same-reader family 3.0.53↔3.0.54; recorded reads only)

| Day | Charts | Failures per read | Band | Spread |
|---|---|---|---|---|
| Jul 2 | 20 | 1 → 2 → 1 | 1–2 | 5% |
| Jul 7 | 15 | 2* → 0 | 0–2 | 13% |
| Jul 8 | 13 | 6 → 2 | 2–6 | **31%** |

Day 1 excluded (prior read on 3.0.52 — cross-family, carve-out confounded; the
5-failure day-2 read was also 3.0.52). *Day 7 prior-read discrepancy: the
supervisor's contemporaneous record says 2, my twice-compacted summary said 8;
the durable record was destroyed by the install reload — flagged, not picked.
RETRACTED: my "day 8's 6→2 cuts FOR build improvements" — 3.0.53→3.0.54 changed
only a receipt field; there was no build improvement to credit. The band is
chart-mix-dependent and day 8's mix swings a third of its roster between
identical runs. **One read of a day tells you almost nothing; every acceptance
claim from here is n-read.**

## 6. Suites (targeted, local)

ax-native-reader 51 ✓ · surface-recycle-rebind 50 ✓ ·
history-refusal-diagnostics-contract ✓ · provider-month-exact-routing ✓ ·
department-scope-primitives 10 ✓ · encounter-index-stability ✓ ·
enumerate-gives-up ✓. Full gate runs at train time (digest stamp refreshes then).

## 7. DAY 9 COLLAPSED — the stop, the diagnosis, and two more cures (added ~21:15)

The owner watched day 9's live panel read "✓ 2 saved · ⚠ 19 skipped" and asked
the fair binary: either the orange text is right and the extension sucks, or
it's wrong and it needs to go. **Both horns were true.**

- **Real collapse**: 22 distinct charts, latest-state 2 ok / 20 failed when I
  set the cooperative stop (his standing order). Sequence `xxxOxxxxxxxxxxxO…` —
  failing from CHART 1, so his activity (he closed his app tabs mid-day) is
  exonerated. The 2 oks both landed via clincmp-ax. Mix: no-chart-frame ×11,
  bodies-incomplete ×11, source-key ×2, one explicit no-signed-in-tab.
- **Session ALIVE**: authenticated fetch from the engine's own tab = 92,314
  bytes, no Re-Login, no prompt=login (signed-out page is ~16KB). NOT the
  signed-out asymmetry.
- **The cause**: two-run position-degradation curve — July4 by position
  1/5/8/6; July5 0→1→(3 empty)→0→2→20, empties resting the renderer. The
  driven tab degrades under continuous driving (the known ~40-min storm class;
  cure = cool-down-then-converge). Month closed "4/31 days verified; retry 27"
  — store safe, everything retryable.
- **The label**: mls-connect.js:4706 wired "skipped" to the FAILED counter,
  counting settle EVENTS (a chart failing 3 re-check passes then clearing
  counts 3 skipped + 1 saved forever — ppTally over rows, cleared charts' old
  rows keep ok=false).
- **Runway receipts** (the 42s challenge): the only rows persisting
  first-attempt diag are end-state failures. Day 8's two (the re-roll's exact
  target class): failed at 8s and 7s elapsed of a 165s budget — **157s/158s of
  runway left**. The no-group class is a fast structural refusal, not budget
  exhaustion.
- **Instrument confession ×2**: my run wrapper compacted the month result to 5
  fields (day-6's exception text lost this run); and my first gate line piped
  through tail so `$?` reported tail's 0 — a FALSE GREEN over a module-load
  crash (the runner's registry fence had correctly refused my two unregistered
  test files). Both recorded; the gate re-ran with the exit taken honestly.

### fb-1.0 — the renderer-fatigue breaker (scripts/fb-splice.js)

4 consecutive hydration-class refusals (identity refusals NEVER count) → the
engine reloads its OWN work tab (surfaceRefresh op, top frame, reload-only) +
12s cool-down; bounded ≥15min apart, ≤2/rolling hour; every receipt carries
hydStreak; a refresh stamps the next receipt fatigueRefresh. Classification at
the single normalize hop every outcome crosses. 16 checks incl. vm runs of the
real classifier (day-9 signature reaches threshold; identity/no-tab refusals
don't; one proven chart resets).

### ppt-2.0 — the panel tells the truth

Chart-level tally (latest state per name+pid key; done = distinct charts,
monotonic); "skipped" dies ("✓ N saved · ⚠ M not saved · K re-checking");
rows dedup to one per chart with HUMAN verdicts (raw reason in hover title;
internal tallies like {no-group×2} never render); charts entering re-check
settle as calm "re-checking…" (pending, never final-⚠); a redo renders
"saved (1 redo)" and the day line counts redos separately — a redo can never
launder the first-attempt metric. New acceptance dimension per the owner:
**every patient positively resolved, every pull, panel telling the truth.**

## 8. The block, the cure attended, and prevention over recovery (added ~22:00)

- **Main is red — deterministically.** The full gate fails in
  `avatar-listens-while-speaking.test.js` ("barge-in must require two words").
  My avatar files are byte-identical to origin/main AND the test fails 5/5 in
  ISOLATION on a quiet box — b991 shipped an internally red combination. The
  3.0.55 train holds; the avatar lane was pinged directly with a 30-minute
  window, after which the supervisor puts ship-over-documented-red-or-hold to
  the owner. Never weaken another lane's test; never stall silently either.
- **The bodies-off verification (owner's note)**: with pullVisitBodies false,
  si still runs full chart read+parse+persist per scheduled patient; only the
  encounter-bodies stage is skipped, recorded as visitsSkipped with the row
  complete. Pinned behaviorally (call-counted through the real pull in the
  month-routing harness).
- **The attended cure worked in sequence**: the re-fired day-9 pull on the
  degraded tab couldn't even flip the calendar day ("Athena is still
  switching days" ×3 over 143s → nav-failed) — the degradation had sunk BELOW
  chart reads to basic navigation, session still alive. Performed fb-1.1's
  exact sequence by hand: pre-probe (no interstitial, no sign-in, frames ok) →
  browser-level navigate of the engine's own tab → landing asserted (5 frames,
  DEPARTMENTID reachable, fresh CSRF minted) → day-9 re-fired and it sailed
  through the day flip + schedule phase into chart reads. The reload cures
  navigation instantly; the discriminator's chart-level verdict pending.
- **fb-1.2 — prevention over recovery** (supervisor): a PROACTIVE tab recycle
  every 15 charts — derived from the earliest observed degradation onset
  (~19 charts of prior driving, July4 position-2; 4-chart margin), NOT a
  round-number default. 5-min spacing, between charts only, same
  probe→reload→assert→dead-latch discipline, does NOT burn the reactive caps,
  receipts distinguish proactiveRefresh from fatigueRefresh. The reactive
  breaker stays as the safety net for the unpredictable case. 26 checks.
- **fa-1.0**: cleared rows keep firstAttempt {reason, read receipt, histogram,
  entry, streak} through the sweep replace AND into the day ledger
  (perPatientDiag fa/redo/cleared) — first-attempt convergence evidence is
  durable, not capture-dependent.
- **ppt-2.1**: finalizeVerdict settles every receipt patient terminally
  (idempotent under the chart-level tally) — no "re-checking" survives a
  pull's end.

## Open at write time

- Day 9 (22 charts, biggest of the month) mid-flight; splits at close.
- Multi-provider via department switching: design FOR A LIST; always-restore
  every exit path; never while he works; switch = day-flip. Within-department
  provider control re-probe owed when the engine fronts the schedule surface.
- Acceptance for rr-1.0 is n-read (nondeterminism headline): count
  axRrRecovered-true rows that pass first-attempt, and axRrWaitMs on refusals.
- Day 6 re-attempt rides the month retry machinery; its exception text harvested
  at month end.
