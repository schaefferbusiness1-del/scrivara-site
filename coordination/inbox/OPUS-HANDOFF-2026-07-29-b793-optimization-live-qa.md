# Opus release-owner handoff: b793 optimization and joint live QA

Date: 2026-07-29

<role>
You are the release owner, final reviewer, UI owner, deployer, and final fixer.
Codex proposes measured performance/correctness patches and reports defects.
Do not delegate UI fixes back to Codex.
</role>

<current_state>
Current reviewed source base:

`7f02a89718c74b928926fb193dff100c32bfb875` (`b793`)

Your current outbox addendum says `Gate: 425/425. Live: b793.` The b793 commit
tracks the Codex proposal artifacts, but source inspection proves that the
optimization changes themselves are not applied. In particular, Loading Calm
is still `lb-2.1.0`, active-patient sync still polls every 400 ms, Study Grab
still polls every 700 ms in both connectors, relay progress still fans out,
and the two teardown timers still leak.

Read `QA-findings-011-b793-optimization-and-comment-review.md` before changing
source. It contains the exact b793 compatibility evidence and target hashes.

The current shared checkout also contains uncommitted release-owner work,
including changes to frozen `background.js` and `manifest.json` and a 3.0.38
extension candidate/package. Keep that work isolated from this optimization
train. Do not apply proposal scripts into the dirty checkout until you have
preserved and resolved the overlapping owner state.
</current_state>

<nonnegotiable_constraints>
- Preserve any current release-owner work.
- Explicitly reject/supersede proposal 039.
- Apply only exact-matching proposal scripts. Never force or hand-edit around a
  missing/ambiguous anchor.
- `mls-connect.js` and `mls-connect.staging.js` remain latin1.
- Advance every immutable satellite token whose bytes change and advance the
  shared core asset token during release assembly.
- Source comments cite dates, never build numbers.
- Do not change `background.js`, `content.js`, or `manifest.json`; the extension
  remains frozen.
- Never use real patient data for QA.
- Strings rendered into the visit engine remain ASCII and contain no
  apostrophes.
</nonnegotiable_constraints>

<proposal_disposition>
Review and record an explicit accept/reject reason for each proposal:

1. 031 event-driven route memory
2. 032 event-driven primary-button style guard
3. 033 finalized visible-controls Chrome driver
4. 034 finalized accessibility/responsive Chrome driver
5. 035 bounded template keyword scrub
6. 036 stop Summary Scrub failed-save fan-out
7. 037 stop Chart Structure failed-save fan-out
8. 038 defer Portal Request Inbox
9. 040 one request-owned phone-relay progress job and rejection-safe agent
   settlement
10. 041 bounded terminal progress/callback retention with retry-cancel and
    account-boundary presentation safety
11. 042 lifecycle-safe event-driven active-patient field sync
12. 043 Study-owner render event instead of the permanent Grab poll
13. 044 existing Add-patient launcher bypasses seven redundant docking scans
14. 045 open-switch appointment sweep clears on revert
15. 046 Fab Tidy interval and exact click listener clear on revert

Apply in that numeric order. Do not apply 039.
</proposal_disposition>

<measured_evidence>
On a fresh exact-b793 archive:

- all 15 proposal scripts passed syntax;
- all 15 applied successfully;
- 25 focused contracts passed;
- all 15 second applications failed safely;
- every file hash remained unchanged after refused reapplication; and
- all 425 local regression suites passed with zero failures in 364,273 ms.

Archive:

`C:\Users\Micha\AppData\Local\Temp\mls-b793-proposal-train-1bd784695aa94a0fa6db30b7e359b830`

Key combined target hashes:

- `mls-connect.js`:
  `4C2941148AB472CEF71D9F27BA2A533B4604E7D3642C5AAD209B5A7DB0F5F18D`
- `mls-connect.staging.js`:
  `C032543FC358C1A6C7165CE004B5C7B1526D6C6888920AAE3566134C5426A9B8`
- `feat_mls_loading_calm.js`:
  `8E516A087152C0536BDB02822003796DDF1001E22B9F977E9D5E6410E27F6A45`
- `feat_mls_active_patient_sync.js`:
  `71D61C58FE50B23CF72899A4F8B072145A58BD4413E4BA0FF9EB81577E238E98`
- `feat_addpatient.js`:
  `84EE194A5BCB78AFDE41D0286573E84CFE899AB93ED659E37C2F1549FBD70567`

Selected measured effects:

- 417 relay statuses: one progress job/deadline instead of 418.
- Progress terminal retention: 500 records becomes 24 while preserving the
  retryable failure cancel callback.
- Active-patient idle scans: 9,000/hour becomes 240/hour, a 97.3% reduction.
- Study Grab: approximately 5,143 timer callbacks/hour/tab becomes zero.
- Add-patient steady state: 22,904 selector lookups/hour removed.
- Open-switch teardown: no additional 1,200 callbacks and up to 240,000 row
  tests/hour per leaked generation.
- Fab Tidy teardown: no timer/click-listener accumulation on reinstall.
</measured_evidence>

<local_chrome_preflight>
Read `QA-findings-012-b793-proposal-train-chrome.md`.

Using installed Chrome 151.0.7922.48, fresh isolated profiles, and synthetic
localhost only:

- secure-phone lifecycle passed;
- accessibility/responsive coverage passed;
- strict visible controls exercised 17 of 17 eligible controls but reproduced
  the Visit opacity-zero/pointer-enabled interval in 12 of 12 cycles;
- the ten-cycle smoke passed its workflow through note persistence and History
  reopen, then stopped in cycle 1 because Setup did not expose Staff; and
- no run contacted production or changed source.

This is compatibility preflight only. It does not satisfy the required live
hosted-template or ten-cycle production acceptance.
</local_chrome_preflight>

<open_product_and_ui_defects>
Fix these in the Opus/UI lane before the final live sweep:

1. Setup guidance clicks a real visible action, but the visible Menu never
   opens with a reachable Staff Prep row. Root chain is documented in
   `QA-findings-010-b792-current-tree-chrome-matrix.md`: the old top menu is
   hidden, `nav_staffpull` is hidden, and Calm Tools filters it out. Make one
   visible Calm Tools Staff Prep delegate and point Setup to that exact row.
2. Review declares History ownership but renders only Orders and The note.
   The redesign folds `nav_history` inline and Calm `available()` rejects the
   hidden source. Restore one visible keyboard-reachable Review -> History
   route, then re-enable its driver coverage.
3. The strict visible-controls audit deterministically sees Visit route entry
   at opacity 0 during the 300 ms `view-enter`/`mlsViewIn` animation while
   pointer events remain enabled. Fix the UI behavior; do not weaken the audit.
4. `mls-template-stdline.js:203,213,218` accepts/forwards only two arguments.
   The real template apply safety path also requires `expectedBinding` and
   `expectedEpoch`. Forward all four arguments in both branches, add a real
   four-argument sentinel test, preserve every refusal, and advance the
   immutable satellite token.
5. The strict touch long-press driver aims through the readiness strip. Repair
   the driver hit target/visibility precondition; the unobscured trusted-touch
   path already passed.
6. Replace the 85 source-comment lines containing `b793` with dated wording:
   26 in `ScribeFlow.html`, 59 in `mls-connect.js`. Runtime version assignments
   are not part of this count.
</open_product_and_ui_defects>

<release_gate>
After applying accepted proposals and Opus-owned fixes:

1. Advance required asset tokens and exact pins.
2. Run syntax and focused contracts.
3. Run the complete suite in the real Git checkout.
4. Fetch `origin/main` and prove ancestry/staleness.
5. Record the exact commit, accepted/rejected proposal list, target hashes,
   gate count, and staleness result in a new `coordination/outbox/` disposition.
6. Deploy the exact reviewed commit.
7. Byte-verify the deployed core and every changed satellite. Record URLs,
   release token, response hashes, and deployment timestamp in outbox.

Do not use `Live: <build>` alone as byte proof.
</release_gate>

<joint_live_chrome_gate>
Only after deployment and byte proof, Opus and Codex independently test the
exact shipped site in the installed Google Chrome application.

Use a dedicated hosted synthetic QA account only. Do not use a clinician
account, real patient data, Athena writes, or mutable extension testing.

Required coverage:

1. Run the complete visible route/control matrix at desktop, tablet, 360 px
   mobile, keyboard-only, and 200% zoom.
2. Run the strict synthetic smoke, visible-controls, accessibility/responsive,
   and secure-phone lifecycle drivers.
3. Exercise signup/sign-in/sign-out, account A -> B same-tab boundaries,
   patient create/select/switch/clear, Visit, Patients, Calendar, Review,
   History, Templates, Studio, Settings, Staff Prep, Help/Search, modal focus,
   persistence after hard reload, and failure/retry paths.
4. Run ten consecutive warm login/load/use cycles in one isolated Chrome
   profile. Record each cycle duration. At cycles 1, 5, and 10 record heap,
   active timers, registered listeners, observers, retained progress jobs,
   and relevant owner counts. Reject monotonic growth, duplicate owners, a
   rising load trend, late cross-account work, or any restored wedge.
5. Keep the tab open long enough to exercise the user's reported warm-session
   slowdown, including repeated patient switches, route changes, note
   generation, History opens, and relay-progress completion.
</joint_live_chrome_gate>

<hosted_template_acceptance>
This is mandatory, not optional or a source-only check.

Use the exact ASCII fixture and three synthetic cases in:

- `QA-SYNTHETIC-STRUCTURED-FOLLOW-UP.txt`
- `QA-SYNTHETIC-STRUCTURED-FOLLOW-UP-CASES.md`

Using visible UI in the dedicated hosted synthetic account:

1. Upload an ASCII text template with a distinctive fixed line and ordered
   headings.
2. Save it, enable it, select it, and make it the default.
3. Create/select one exact synthetic patient and bind one exact synthetic
   visit.
4. Run three varied synthetic transcripts through both automatic Generate and
   the visible Use action.
5. Verify:
   - headings appear once and in order;
   - the fixed line is exact;
   - present facts land in the right sections;
   - absent facts are marked not documented or omitted according to template
     rules;
   - no fact is invented or copied from another transcript/patient;
   - expected binding and epoch remain exact;
   - automatic and Use outputs agree on template fidelity;
   - selection/default/enabled state and the generated note survive reload.
6. Save the synthetic note to its synthetic patient and reopen it from visible
   History.

If no dedicated hosted synthetic account is available, report this specific
mutable test as blocked; do not substitute localStorage injection or hidden
function calls.
</hosted_template_acceptance>

<defect_loop>
Codex reports every defect with reproduction, source location, screenshots,
console/network evidence, and severity. Opus fixes all UI/product defects,
reruns the affected source and Chrome gates, redeploys, and records new byte
proof. Both reviewers repeat until the shipped site is clean.
</defect_loop>

<required_response>
Write new outbox records containing:

- proposal dispositions;
- applied commit and hashes;
- full real-Git gate/staleness results;
- deployment and byte proof;
- Opus live-Chrome results;
- each Codex defect disposition/fix;
- final joint retest result.

Do not mark the optimization effort complete until the accepted optimization
train is live and both independent Chrome passes, including hosted template
acceptance and ten warm cycles, are clean.
</required_response>
