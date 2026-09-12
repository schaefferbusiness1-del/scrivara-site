# MLS Assist 3.0.124 — identity recovery parity

Parent: `3813b370fee7e0f412ff91e6f47712ea9829b10c` (3.0.123).

## Scope and evidence

The owner reported three `identity-suggestion-pending` rows. That literal is not
produced or persisted by extension code. The earlier observed three failures were
from the stopped 3.0.117 September 15 automatic-upcoming run. A fresh request
receipt is necessary to attribute any currently displayed pending row to 3.0.123.
The site-owned outcome producer and persisted pending state are outside this patch.

Source audit nevertheless found genuine missed parity paths in 3.0.123:

- Appointment bootstrap and encounter-acceptance recovery still required every
  multi-letter expected name token, so an optional middle name/title could block.
- The shared worker matcher still let a stale caller MRN veto exact name+DOB;
  it also did not consistently require the complete first/last+DOB conjunction.
- Find's query builder could search for `Smith,Dr.` before its correct exact-pair
  comparison ran. Legacy result headers outside THEAD were not recognized.
- Typographic hyphens/apostrophes surrounded by formatting spaces normalized
  differently from the corresponding unspaced name.

## Repair and safety

All these paths now use normalized exact first+last and exact calendar-valid DOB.
Middle names/initials, case, ordinary spacing, supported titles/suffixes and
apostrophe/hyphen typography do not veto the pair. No initials, nicknames, name-only
match, or stale MRN can replace the pair. Bootstrap still requires fresh exact
appointment navigation/frame provenance; an expected DOB must agree with the
live banner. Multiple distinct observed live patient IDs refuse even when the
name+DOB pair agrees. A missing caller DOB may only follow the existing exact
appointment-bound bootstrap route, not unrestricted name lookup.

Find can read first/last/DOB columns from legacy header rows, refuses ambiguous
column mappings, and uses a labelled DOB column instead of mistaking another
date column for conflicting DOB. The immediate pre-click re-read uses the same
proof and still requires one exact candidate. Duplicate pairs refuse.

Each fresh bootstrap poll revalidates the current banner. Stale conflicting
names/DOBs refuse; a later exact pair can recover without a latched pending state.
The existing cache-bypass, bounded retries, exact date restoration, deadlines,
write-time live patient/encounter/document locks and final-action boundaries remain.

## Package

- Version: `3.0.124`.
- Core SHA-256: `c8de53d2bd49b7f66c34881fdf0bb05ed3883309e2f5e7955131d58357cd4be0`.
- ZIP/BIN SHA-256: `b5e139e9f85f2785a9401971e649d4f012c0bb44b46007366052fb6a30be446d`.
- Intact stage: `extension-staging/MLS_Assist_v3.0.124`.
- Source/stage manifest closure: 19 referenced files, byte-compared complete.

No site code, Settings feed, public download metadata, permission or authentication
configuration was changed. No patient note was written and no publication occurred.

## Verification and live boundary

The new focused runtime suite has 47 assertions across worker, bootstrap,
encounter-acceptance and Find paths, including same-name/different-DOB,
same-DOB/different-name, missing identity, duplicate pair, stale MRN, optional
middle/title/suffix, typography, and stale-to-fresh banner recovery. The previous
41-assertion exact-pair suite remains green. The adjacent gate ledger records
**94/94 passing extension suites**, independently from site/published-channel tests.
The first sweep's sole failure was an explicit Slate-test version pin still naming
3.0.123; after moving that pin to 3.0.124 its runtime assertions and core check pass.
The current test-content hashes and recheck are recorded in the ledger.

Live read acceptance remains outstanding. Stop all pulls and confirm automatic
upcoming OFF before installing/reloading the intact candidate. Verify its exact
pong/digest, then use a positively counted, explicitly selected never-pulled
appointment day. Also retry the known failed-only rows to prove fresh requests
replace old pending outcomes; do not manually mark them accepted or clear storage.
Compare schedule, chart identity, encounter/body, scheduling-note and final Activity
receipts. All real-patient operations remain read-only. Dummy clinic/OP saves need
separate action-time confirmation immediately before submission and readback afterward.

## Live reload receipt — root operator, 2026-09-12

Root reported the documented helper reload clicked exactly once after the verified
20-file intact package copy. Athena tab 256642751 was refreshed and visibly
remained signed in; MLS QA tab 256642749 was refreshed to site build b1270.

- Fresh ping: ok=true, version=3.0.124.
- Build ID: `3.0.124+core-sha256:c8de53d2bd49b7f66c34881fdf0bb05ed3883309e2f5e7955131d58357cd4be0`.
- Schedule bridge: installed=true, busy=false.
- Upcoming: on=false, running=false, armed=false, afterPullArmed=false, wired=true.
- History: running=false; total/done/ok/failed all zero.
- Notes: reading=false, running=false; queued/open/done/failed all zero.

This is the operator-supplied live reload receipt, not proof of a completed
date-scoped pull. No note save or publication was performed. Awaiting the first
explicit-date schedule/read/Activity receipts before further engineering changes.
