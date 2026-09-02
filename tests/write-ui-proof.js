'use strict';

/* writeui-1.0.0 (b1184) — the owner, 2026-09-01 20:10, looking at the op-note
 * send: "the write UI we have right now I don't love; if you could also
 * completely fix it please. I do like the loading bar from it though."
 *
 * WHAT THE SHEET WAS. One screen carried, in this order: a title, an identity
 * line, a dense paragraph about which actions run after their own
 * confirmation, the four step chips, a "Read-only check running" line, a large
 * open monospace slab of the exact payload with "Payload mls-preview-… · Row
 * mls-preview-…" under it, a second "What → Where → How" paragraph with the
 * per-section checkboxes, and a third amber paragraph. Three explanations, two
 * running commentaries and two technical hashes, in a doctor's face, between
 * patients.
 *
 * WHAT IT IS NOW. Header (who + ONE sentence of what will happen) → the four
 * step chips as the spine → ONE status pill and ONE sentence → the loading bar
 * he likes → the receipt the moment there is one → the sections as a checklist
 * whose exact text is one click away → everything explanatory in ONE closed
 * "How this works". Nothing was deleted; it moved.
 *
 * AND THE RULE THIS SUITE EXISTS TO ENFORCE: writeui is PRESENTATION. Section
 * 0 proves the identity lock, the read-only probe ladder, the receipt mint, the
 * execute, the batch queue and BOTH closed action allowlists are byte-identical
 * by SHA-256 to the digests tests/sheet-clarity.test.js and
 * tests/write-auto-chain.test.js already pin (this suite reads those two files
 * and refuses to run against a digest they do not both carry), and that the
 * arrival default, the primary-button plan and the state derivation are
 * byte-identical to the b1183 bytes as well - so the enable/disable of Confirm
 * and the word above it are decided by exactly the code that decided them
 * before.
 *
 * Run:  node tests/write-ui-proof.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW_FILE = '1p-feat_mls_writeflow.js';
const FLOW = fs.readFileSync(path.join(ROOT, FLOW_FILE), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }
function tally(html, needle) { return String(html).split(needle).length - 1; }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ================================================================== 0. BYTES
 * The write path, by SHA-256. The digests are NOT re-derived here: each one is
 * asserted to be present in BOTH tests/sheet-clarity.test.js and
 * tests/write-auto-chain.test.js, so this suite cannot quietly bless a digest
 * those two do not already hold, and a deliberate re-aim has to move all
 * three files at once. */
const SHEET_CLARITY = read('tests/sheet-clarity.test.js');
const AUTO_CHAIN = read('tests/write-auto-chain.test.js');
const DAY_WRITEALL = read('tests/day-writeall.test.js');

const HEAD_REGIONS = [
  ['identity-lock (validatedUnifiedProbe: token + name/DOB/MRN + exact encounter)',
    '  function validatedUnifiedProbe(patient, probe) {', '  function renderUnifiedContext(state, lock) {',
    '5132fb2c3047b18f75647b0dea7df7ce21c2d5a89325cfaa77e82e193d3533a1'],
  ['probe ladder (probeUnifiedRow: every refusal, auto-open, day-mismatch gate)',
    '  function probeUnifiedRow(state, rowId) {', '  /* wfsum-1.0.0 (owner 2026-08-26, watching his own writes land while the sheet',
    'b969672ecd13d4afd4c8f4e86e12cbc6a0799e32ffdee30744a4c68a1f8c2005'],
  ['receipt mint (resultToUnifiedReceipt: verified / uncertain / halt)',
    '  function resultToUnifiedReceipt(state, row, resp, probe) {', '  /* ===== wfprog-1.0.0 (owner 2026-08-27:',
    '82451a857daa88c986222abdca94ea4bdf504207cf11a6ac894bc25a52824de9'],
  ['execute (executeUnifiedSelection: the only code that writes)',
    '  function executeUnifiedSelection(state) {', '  /* bx-1.0.0 - batch send (owner 2026-08-26:',
    '13d1a666cb827dfa7561a4daeb394bdba7a990f4d4e322fcdc08317a438b80b5'],
  /* MOVED DELIBERATELY, wfnext-1.0.0 (2026-09-01) - owner ruling 23:05,
     verbatim: "nothing here should be blocked or manual or not attempted once
     its run". MEASURED 22:50-22:56 on his own tab: one trusted press, six
     checked sections, section 1 verified, sections 2 and 3 refused with
     fresh-trusted-click-required (MLS Assist consumes the arm on the first
     execute), section 4 then sat on "checking Athena" past three minutes. TWO
     things changed in this region and nothing else: the queue is handed the
     rows THIS PRESS AUTHORIZED (wfnextQueueRows - the whole remaining list on a
     batch-arm extension, exactly one section on any older one, which is also
     what stops a section being probed before the doctor has pressed for it),
     and the read-only stage retries ONCE inside the same run before settling
     the section in words that name his next move. Every gate, latch, bound,
     token, payload and receipt path in it is untouched: same probeUnifiedRow,
     same executeUnifiedSelection, same 150s / 180s ceilings, same
     halt-on-uncertain, same verified-only counting. Regions 1-4, 6 and 7 did
     not move, which is the check that this was a sequencing change and not a
     write-path change. Proven in tests/write-next-press-proof.js. */
  /* MOVED DELIBERATELY A SECOND TIME, pullshield-1.0.0 (2026-09-02). MEASURED:
     wfbindPullBusy() has always answered, from the schedule importer's own
     lease and busy stamp, whether a pull is driving athenaOne right now -
     wfbindRun and the canonical generation path both consult it and refuse
     rather than stomp it - and this queue was the one caller that did not. It
     probed straight into a tab another lane was navigating, and a pull that
     ENDS drives athenaOne back to its dashboard, which is the surface every
     read-only check refuses on. Measured on the same 2026-09-02 16:09-16:31
     run that produced paintwait-1.0.0.
     WHAT CHANGED IN THIS REGION, and only this: before a row is checked, the
     step awaits pullshieldClear(state) - a bounded, hidden-safe wait on that
     same lease - and a pull that never lets go settles the row as NOT
     ATTEMPTED (pullshieldSettle records an attempt, never a receipt) and the
     queue moves on. Every gate, latch, bound, token, payload and receipt path
     is untouched: same probeUnifiedRow, same executeUnifiedSelection, same
     150s / 180s ceilings, same halt-on-uncertain, same verified-only counting,
     same wfnextQueueRows. It can only ever DELAY or SKIP a row; there is no new
     path to a write.
     MEASURED, NOT ASSUMED: on the pre-edit staged tree this region hashed to
     44e41349..., i.e. savenamed-app-1.0.0 did NOT move it and
     tests/sheet-rows-and-reopen-proof.js was green at 231 checks. Regions 1-4,
     6 and 7 did not move for this lane either - which is the check that this
     was a sequencing change and not a write-path change. Proven in
     tests/paintwait-queue-proof.js. */
  ['batch queue (runUnifiedBatchSend: per-row probe/execute/receipt sequencing)',
    '  function runUnifiedBatchSend(state, btn) {', '  function reopenOptions(opts, manifest) {',
    '85e30a6375f57e7637dbc2a4380d978be55e47f7bd9b99b0ee7d60c11acceac1'],
  ['closed allowlist ATHENA_EXECUTABLE_ACTIONS', '  var ATHENA_EXECUTABLE_ACTIONS = ', '\n',
    '5f712227078089f313988b254825795ed695d22fa6393e5a3c635d92ebcbb6f2'],
  ['closed allowlist OPBATCH_ACTIONS', '  var OPBATCH_ACTIONS = ', '\n',
    '35da13388ee65c349a310314a6b74ba28a492c98ca44e3e4a258c829302d89fa']
];
{
  HEAD_REGIONS.forEach(function (r) {
    const name = r[0], start = r[1], end = r[2], want = r[3];
    ok(SHEET_CLARITY.indexOf(want) > 0, 'tests/sheet-clarity.test.js does not carry this digest - do not invent one here: ' + name);
    ok(AUTO_CHAIN.indexOf(want) > 0, 'tests/write-auto-chain.test.js does not carry this digest - do not invent one here: ' + name);
    const i = FLOW.indexOf(start);
    ok(i >= 0, 'the write-path region vanished entirely: ' + name);
    const j = FLOW.indexOf(end, i + start.length);
    ok(j > i, 'the write-path region lost its end marker: ' + name);
    const got = crypto.createHash('sha256').update(FLOW.slice(i, j), 'utf8').digest('hex');
    eq(got, want, 'THE WRITE PATH CHANGED - writeui is a presentation lane and may not touch it: ' + name);
  });

  /* the two closed allowlists say what they say, and say it once - the same
     byte-strings tests/day-writeall.test.js pins for the day/op-note queue. */
  const EXEC_ALLOW = 'var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };';
  const BATCH_ALLOW = 'var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };';
  const BATCH_KINDS = "var OPBATCH_KINDS = { '': 1, opnote: 1 };";
  eq(tally(FLOW, EXEC_ALLOW), 1, 'the executable-action allowlist must appear exactly once, byte for byte');
  eq(tally(FLOW, BATCH_ALLOW), 1, 'the batch lane\'s CLOSED two-action allowlist must appear exactly once, byte for byte');
  eq(tally(FLOW, BATCH_KINDS), 1, 'the closed chart-record kind set must appear exactly once, byte for byte');
  eq(tally(FLOW, 'ATHENA_EXECUTABLE_ACTIONS ='), 1, 'a second assignment could widen the executable-action allowlist');
  eq(tally(FLOW, 'OPBATCH_ACTIONS ='), 1, 'a second assignment could widen the batch allowlist');
  ok(DAY_WRITEALL.indexOf(BATCH_ALLOW) > 0, 'tests/day-writeall.test.js no longer pins this allowlist - the pins have drifted apart');
  ok(DAY_WRITEALL.indexOf(BATCH_KINDS) > 0, 'tests/day-writeall.test.js no longer pins the closed kind set');

  /* and the four-layer block's own sentences are still in the file */
  ok(FLOW.indexOf("var SHEETUX_ZERO_REASON = 'Check at least one READY note section first - this button sends only the sections you have checked. Nothing was changed.';") > 0,
    'the zero-checked refusal changed its wording out from under the sheet-ux suite');
  ok(FLOW.indexOf('<details id="mlsAthenaUnifiedDetails" data-mls-clunky-seen="1"') > 0,
    'the full-detail disclosure lost its opt-out from the shell fold pass, so a refusal can be folded shut under the doctor');
}

/* ============ 0b. THE THREE THINGS WRITEUI PROMISED NOT TO RE-DECIDE ======
 * A presentation pass may move the word and the button; it may not change WHAT
 * decides them. Two of these three regions are byte-identical to b1183; the
 * arrival default was re-aimed once, deliberately, by apsel-1.0.0 - see the
 * reason above it and the property assertions under the digest loop. */
const KEEP_REGIONS = [
  /* RE-AIMED DELIBERATELY, apsel-1.0.0 (measured 2026-09-02 09:xx on the
     owner's own tab, MLS Assist 3.0.107). This digest pins that a PRESENTATION
     pass did not quietly re-decide which sections arrive selected. apsel-1.0.0
     is not a presentation pass: it is a reviewed change to the arrival default
     itself, made because the shipped default guaranteed a DEAD ROW.
     THE MEASUREMENT. ap-1.0.0 mints THREE Assessment/Plan rows on any review
     with one assessment and one plan - separate Assessment, separate Plan, and
     the combined "Assessment & Plan" - and only ONE of those two shapes exists
     on a given athenaOne A/P stage. All three arrived ticked, so the doctor's
     default press always attempted at least one destination that cannot exist,
     against the owner ruling "nothing here should be blocked or manual or not
     attempted once its run".
     WHAT CHANGED, AND ONLY THIS: exactly ONE of the group arrives ticked - the
     combined row unless this athenaOne has already answered that it renders
     separate fields. Nothing is removed: all three rows are still minted, still
     rendered, still one tick away, and the un-ticked side now carries a sentence
     saying it is the alternative. The properties this digest can no longer
     carry by itself are asserted immediately below, off the shipped source, and
     the runtime half (exactly one A/P box ticked, never both sides, DONE
     reachable in both shapes) is tests/ap-one-destination-proof.js.
     KEEP_REGIONS[1] (the button plan and its sync) and KEEP_REGIONS[2] (the
     state derivation, sheetclarStateBase) did NOT move - which is the check
     that this was a SELECTION change and not a plan or state change - and none
     of the seven SHA-pinned write-path regions moved either. */
  ['the arrival default (unifiedDefaultChecked)',
    '  function unifiedDefaultChecked(row) {', '  function unifiedReadyRowHtml(',
    '6661e3d8a4081d9a85a03f1edaca01d335fcb8fe609f861990a2834ab3ec4054'],
  /* RE-AIMED DELIBERATELY, wfdone-1.0.0 (measured 2026-09-02, adversarial
     replay of the one-press lane). This digest pins that a PRESENTATION pass
     did not quietly re-decide the button. wfdone-1.0.0 is not a presentation
     pass: it is a reviewed change to the decider itself, made because the
     painter could not tell the truth without it. With note rows left unchecked,
     every CHECKED section landed verified while the plan still answered
     'batch', so unifiedSyncPrimaryButton re-enabled a button reading
     "Confirm & write 2 of 2: Physical Exam" three inches under "All 2 checked
     sections are in Athena and verified" - and the press it invited was
     refused. ONE branch was added, immediately after the zero-checked refusal:
     if every checked row already carries a verified receipt the plan returns
     mode 'none' with its own reason. It can only ever DISABLE - there is no new
     path to 'batch' or 'single', no new row ever joins `rows`, and
     unifiedSyncPrimaryButton is byte-identical - which is exactly what
     planNeverEnablesOnDone below asserts against the shipped function. None of
     the seven SHA-pinned write-path regions moved. */
  /* RE-AIMED DELIBERATELY A SECOND TIME, savenamed-app-1.0.0 (OWNER RULING
     2026-09-02, verbatim: "unblock the save block in mls assistant it should be
     able to do it if someone clicks save on mls site" / "no one should have to
     touch Athena this entire process"). This is again NOT a presentation pass:
     MLS Assist 3.0.111 gave the named-section review a supervised encounter
     save, so the review now owes the doctor ONE MORE PRESS after its sections
     land - and a plan that only ever counted the include checkboxes killed the
     button one press early, which is the wfdone defect above, one row later.
     WHAT THE RE-AIM IS ALLOWED TO HAVE CHANGED, and the block below asserts:
     the ONLY row that can newly join a plan is the manifest's own save row, and
     only through savenamedOwedRow, whose readiness rule is "every checked note
     section has landed or lands ahead of it on this same press"; the legacy
     single-row shortcut is NARROWED (it now also requires that no save is
     riding the press), never widened; unifiedSyncPrimaryButton is still
     byte-identical; and none of the seven SHA-pinned write-path regions moved.
     sheetclarStateBase moved for the same ruling and for one reason only: with
     a save still owed the pill may not say DONE, and once the save has landed
     and been read back it may not tell him to go and save it in athenaOne. */
  /* RE-AIMED DELIBERATELY A THIRD TIME, apcover-1.0.0 (2026-09-02, measured on
     the owner's own tab at 16:31). This is again NOT a presentation pass.
     apsel-1.0.0 stopped the sheet COUNTING the mutually exclusive Assessment /
     Plan / combined rows three times; it did not stop the plan OWING them. With
     the combined "Assessment & Plan" row verified, the separate rows refused
     with note-section-not-on-surface and hetDiag stageNav 'opened-A/P' /
     'already-open' - this athenaOne renders ONE combined A&P field - and the
     button still read "Confirm & write all 2, starting with Assessment
     narrative", a press whose only possible outcome was the same refusal. That
     is the wfdone defect above, one row later.
     WHAT THE RE-AIM IS ALLOWED TO HAVE CHANGED, and the block below asserts:
     ONE clause on the wfdone owed filter - `&& !apCovered(state, r)` - which
     can only ever SHRINK the owed list, i.e. only ever DISABLE. No new row can
     join a plan, `rows` (bxCheckedRows) is untouched so the doctor's own ticks
     are untouched, the legacy single-row shortcut is unchanged, and
     unifiedSyncPrimaryButton is still byte-identical. The arrival default
     (KEEP_REGIONS[0]) and the state derivation (KEEP_REGIONS[2]) did NOT move
     for this lane - which is the check that this was an OWED-WORK change and
     not a selection or a state change - and of the seven SHA-pinned write-path
     regions only the batch queue moved, for pullshield-1.0.0 above. Proven in
     tests/write-sheet-agreement-proof.js. */
  ['the primary button plan and its sync (unifiedPrimaryPlan + unifiedSyncPrimaryButton)',
    '  function unifiedPrimaryPlan(state) {', "  /* rwfix-1.0.0 (b1169): the include checkboxes' ONE handler",
    '1b31b746fffd76035fc9ae472147ad4cb73649ceb368bcfd15833561e2887aae'],
  ['the state derivation (sheetclarStateBase)',
    '  function sheetclarStateBase(state, kind) {', '  function paintSheetclarState(state, kind) {',
    '0b63410b3ead86ef078ab3f3c33651b930ee6c16a4af9df4ee26b3b3cd1dce37']
];
KEEP_REGIONS.forEach(function (r) {
  const i = FLOW.indexOf(r[1]);
  ok(i >= 0, 'region vanished: ' + r[0]);
  const j = FLOW.indexOf(r[2], i + r[1].length);
  ok(j > i, 'region lost its end marker: ' + r[0]);
  eq(crypto.createHash('sha256').update(FLOW.slice(i, j), 'utf8').digest('hex'), r[3],
    'WRITEUI RE-DECIDED SOMETHING IT MAY ONLY REPAINT: ' + r[0]);
});

/* apsel-1.0.0 (2026-09-02 09:xx): the arrival digest above was re-aimed once,
   on purpose, so these are the properties it can no longer carry by itself.
   They are read off the SHIPPED source, and they are the whole of what the
   re-aim is allowed to have changed: the ready/write_note gate is untouched,
   the new rule is an EXCEPTION that can only ever reach the A/P group, the two
   sides of that group are mutually exclusive by construction, and the doctor's
   own tick outranks the learned preference. */
{
  const AT = FLOW.indexOf('  function unifiedDefaultChecked(row) {');
  const END = FLOW.indexOf('  function unifiedReadyRowHtml(', AT);
  ok(AT > 0 && END > AT, 'the arrival default is no longer where this suite reads it');
  const ARRIVE = FLOW.slice(AT, END);
  ok(ARRIVE.indexOf("if (!(row && row.capability === 'ready' && row.action === 'write_note')) return false;") > 0,
    'THE READY / WRITE-NOTE GATE IS GONE - something other than a READY reviewed note section can now arrive selected');
  ok(ARRIVE.indexOf('var g = apGroupKind(row);') > 0 && ARRIVE.indexOf('if (!g) return true;') > 0,
    'THE A/P RULE STOPPED BEING AN EXCEPTION - a section outside the Assessment/Plan group can now arrive UNticked');
  ok(ARRIVE.indexOf("if (g === 'assessment_and_plan') return pref !== 'separate';") > 0,
    'the combined Assessment & Plan row is no longer the unlearned default - the only measured surface renders exactly that one field');
  ok(ARRIVE.indexOf("return pref === 'separate';") > 0,
    'the separate Assessment/Plan pair no longer arrives ticked on a surface that answered "separate"');
  ok(ARRIVE.indexOf('var pref = apPickThisSheet || apSurfacePref();') > 0,
    "the doctor's own tick for this sheet no longer outranks the learned surface preference");
  /* the group is a two-state selector: for any preference value, exactly one
     of the two branches above is true, so both sides can never arrive ticked
     and neither can arrive with both un-ticked. */
  ['combined', 'separate', ''].forEach(function (pref) {
    const combined = (pref !== 'separate'), separate = (pref === 'separate');
    ok(combined !== separate,
      'THE A/P PAIR IS NO LONGER MUTUALLY EXCLUSIVE at preference "' + pref + '" - the guaranteed dead row is back');
  });
  /* and the alternative side is a SENTENCE, never a second control */
  ok(FLOW.indexOf('function apAlternativeNoteHtml(row) {') > 0,
    'the un-ticked A/P alternative lost the one sentence that says what it is');
  ok(FLOW.indexOf("data-mls-ap-alt=\"' + esc(row.id) + '\"") > 0,
    'the A/P alternative sentence lost the hook a suite reads it by');
  eq((FLOW.match(/apAlternativeNoteHtml\(row\)/g) || []).length, 2,
    'the A/P alternative sentence is emitted somewhere other than the one ready-row renderer');
  eq((FLOW.match(/data-mls-ap-alt/g) || []).length, 1,
    'the A/P alternative sentence gained a second emitter - one row, one sentence');
}

/* wfdone-1.0.0 (2026-09-02): the plan digest above was re-aimed once, on
   purpose, so these are the properties it can no longer carry by itself. They
   are read off the SHIPPED source, and they are the whole of what the re-aim
   is allowed to have changed: ONE branch was added, it can only ever return a
   DEAD plan, no new row ever joins the sendable list, and the half that
   actually touches the button did not move a byte. */
{
  const PLAN_AT = FLOW.indexOf('  function unifiedPrimaryPlan(state) {');
  const SYNC_AT = FLOW.indexOf('  function unifiedSyncPrimaryButton(state) {');
  const END_AT = FLOW.indexOf("  /* rwfix-1.0.0 (b1169): the include checkboxes' ONE handler");
  ok(PLAN_AT > 0 && SYNC_AT > PLAN_AT && END_AT > SYNC_AT, 'the plan and its sync are no longer adjacent where this suite reads them');
  const PLAN = FLOW.slice(PLAN_AT, SYNC_AT), SYNC = FLOW.slice(SYNC_AT, END_AT);
  ok(PLAN.indexOf('var wfdoneOwed = rows.filter(') > 0,
    'THE FINISHED-SHEET BRANCH IS GONE - a live Confirm can again name a write that cannot happen');
  /* savenamed-app-1.0.0: the finished-sheet branch is intact and still returns
     the dead plan with its own reason - it now yields ONLY to the review's own
     armed save row, which is the one press a finished sheet can still owe. */
  ok(PLAN.indexOf("if (!wfdoneOwed.length) return saveOwed ? { mode: 'batch', rows: [saveOwed], reason: '' } : { mode: 'none', rows: [], reason: WFDONE_NOTHING_LEFT_REASON };") > 0,
    'the finished-sheet branch no longer returns a dead plan carrying its own reason');
  eq((PLAN.match(/mode: 'none'/g) || []).length, 4, 'the plan gained or lost a refusal branch beyond the one wfdone-1.0.0 added');
  /* savenamed-app-1.0.0: the two new 'batch' returns are the SAME row, reached
     the SAME way - `saveOwed`, and nothing else, may join a plan. */
  eq((PLAN.match(/mode: 'batch'/g) || []).length, 3, 'the plan gained a batch path beyond the two savenamed-app-1.0.0 added');
  eq((PLAN.match(/rows: \[saveOwed\]/g) || []).length, 2,
    'a new batch return carries something other than the review\'s own armed save row');
  eq((PLAN.match(/var saveOwed = savenamedOwedRow\(state\);/g) || []).length, 1,
    'the save row reaches the plan through something other than its one readiness rule');
  ok(PLAN.indexOf("      if (!(selRec && selRec.status === 'verified')) return { mode: 'single', rows: [sel], reason: '' };") > 0,
    'the legacy Save/Sign/order shortcut no longer stands aside for a row that already landed - a verified row would hold the button live with nothing to send');
  ok(PLAN.indexOf('if (rows.length === 1 && !saveOwed && selectable') > 0,
    'the legacy single-row shortcut no longer stands aside when the save is riding this press - one press would then run two rows through the one-row path');
  eq((PLAN.match(/mode: 'single'/g) || []).length, 3, 'the plan gained a new legacy-single path - wfdone may only ever refuse');
  eq(crypto.createHash('sha256').update(SYNC, 'utf8').digest('hex'),
    '894175be89041031f2d705337318289c7f6a5c85ea485e79eb6010d6c84eb63a',
    'THE BUTTON SYNC CHANGED - wfdone-1.0.0 moved the PLAN and nothing else; enabling and disabling still happen in exactly the code that always did it');
  ok(FLOW.indexOf("var WFDONE_NOTHING_LEFT_LABEL = 'Nothing left to send';") > 0,
    'the finished-sheet label stopped being the SAME shared constant renderUnifiedReceipts already writes - one state, two sentences');
  eq((FLOW.match(/'Nothing left to send'/g) || []).length, 1,
    'the "nothing left to send" wording exists as a second string literal instead of coming from the one shared constant - one state may not have two sentences');
  ok(FLOW.indexOf('batchBtn2.textContent = WFDONE_NOTHING_LEFT_LABEL;') > 0,
    'the receipt renderer stopped writing the shared constant, so the button and the plan can drift apart again');
}

/* ================================================= 1. THE SHIPPED MARKUP ===
 * Static shape pins that hold whether or not the runtime below ever runs. */
{
  const at = FLOW.indexOf('function renderUnifiedConfirmation(state)');
  ok(at > 0, 'the sheet renderer moved');
  const RENDER = FLOW.slice(at, FLOW.indexOf('function openUnifiedConfirmation(opts)', at));
  ok(RENDER.length > 4000, 'the renderer slice is empty - every pin below would pass vacuously');

  eq(tally(RENDER, 'id="mlsAthenaUnifiedGo"'), 1, 'the sheet must render exactly ONE primary send button');
  eq(tally(RENDER, 'id="mlsAthenaUnifiedCancel"'), 1, 'the sheet must render exactly ONE Cancel');
  eq(tally(RENDER, 'id="wbwSteps"'), 1, 'the step-chip host must be reserved exactly once - two hosts would paint two strips');
  ok(RENDER.indexOf('Confirm &amp; Send to Athena') > 0, 'the primary button lost the label the doctor already knows');
  ok(RENDER.indexOf('data-mls-sheet-how="1"') > 0, 'the single "How this works" disclosure is gone');
  ok(RENDER.indexOf('data-mls-sections="1"') > 0, 'the sections checklist lost the wrapper the receipt step folds');
  ok(RENDER.indexOf('data-mls-sheet-plan="1"') > 0, 'the header lost its one-sentence statement of what will happen');
  ok(RENDER.indexOf('data-mls-sheet-who="1"') > 0, 'the header lost its identity line');

  /* the "How this works" disclosure really does carry the three explanations
     that used to compete on the first screen - and they are not paraphrased */
  const howAt = RENDER.indexOf("var howHtml = '<details data-mls-sheet-how=\"1\"");
  ok(howAt > 0, 'the How-this-works disclosure is not built where this suite can read it');
  const HOW = RENDER.slice(howAt, RENDER.indexOf("'</details>';", howAt));
  ok(HOW.indexOf('guideHtml') > 0, 'the What -> Where -> How guide is not inside How this works');
  ok(HOW.indexOf('capabilityLine') > 0, 'the capability disclosure is not inside How this works');
  ok(HOW.indexOf('boundaryLine') > 0, 'the one-action boundary disclosure is not inside How this works');
  ok(HOW.indexOf('id="mlsAthenaUnifiedContext"') > 0, 'the exact-encounter fact panel is not inside How this works');
  eq(tally(RENDER, 'id="mlsAthenaUnifiedContext"'), 1, 'the exact-encounter panel must exist exactly once - two would fight over one id');
  /* and NOTHING in this sheet ships open */
  eq(tally(RENDER, '<details open'), 0, 'a disclosure in the sheet ships OPEN again - the wall the owner is complaining about');
  eq(tally(FLOW.slice(FLOW.indexOf('function unifiedPayloadDetails('), at), '<details open'), 0,
    'a row/evidence disclosure ships OPEN again');

  /* every sentence a contract suite reads is still a literal in this file */
  [
    'Only reviewed note write and Save Draft can be confirmed here',
    'run only after their own explicit confirmation',
    'One READY note row is pre-selected',
    'One READY row is pre-selected and checked read-only',
    'runs exactly that one action',
    'never retries or auto-chains',
    'Sign &amp; Save unlocks only after a verified note write',
    '<b>Nothing has changed yet.</b>',
    'What &rarr; Where &rarr; How',
    'Leave the sections you want checked, then press'
  ].forEach(function (s) {
    ok(RENDER.indexOf(s) > 0, 'writeui DELETED a disclosure instead of moving it: ' + s);
  });
  eq(tally(RENDER, 'What &rarr; Where &rarr; How'), 1, 'the destination guide must be rendered exactly once');

  /* the card is still the column flex whose footer cannot be overlaid */
  const cardAt = FLOW.indexOf("card.style.cssText = 'background:#fff;color:#1A211C;width:min(720px,96vw);max-height:92vh;");
  ok(cardAt > 0, 'the card style declaration moved');
  const cardStyle = FLOW.slice(cardAt, FLOW.indexOf("';", cardAt));
  ok(/display:flex/.test(cardStyle) && /flex-direction:column/.test(cardStyle), 'the card is no longer a column flex container');
  const footerAt = RENDER.indexOf('id="mlsAthenaUnifiedFooter"');
  ok(footerAt > 0, 'the footer lost its marker');
  const FOOTER = RENDER.slice(footerAt, RENDER.indexOf('</div>\';', footerAt));
  ok(/position:static/.test(FOOTER), 'the footer stopped declaring itself unpositioned');
  eq(tally(FOOTER, 'type="button"'), 2, 'the footer must hold exactly Cancel + one primary send button');

  /* the a11y hooks writeui promised to keep */
  ok(RENDER.indexOf("ov.setAttribute('role', 'dialog')") > 0, 'the sheet stopped being a dialog');
  ok(RENDER.indexOf("ov.setAttribute('aria-modal', 'true')") > 0, 'the sheet stopped being modal');
  ok(RENDER.indexOf("ov.setAttribute('aria-labelledby', 'mlsAthenaUnifiedTitle')") > 0, 'the dialog lost its label');
  ok(RENDER.indexOf("ov.setAttribute('aria-describedby', 'mlsAthenaUnifiedSafety')") > 0, 'the dialog lost its description');
  ok(RENDER.indexOf("document.addEventListener('keydown', state.a11yKeyHandler, true)") > 0, 'the focus trap / Escape handler is gone');
  ok(RENDER.indexOf('unifiedFocusableRows(card)') > 0, 'the focus trap stopped reading the card\'s focusable rows');
  ok(RENDER.indexOf('aria-disabled="true"') > 0, 'the primary button lost aria-disabled on its disabled arrival');
  ok(RENDER.indexOf('aria-label="Close Athena review"') > 0, 'the close control lost its label');
}

/* ============================= 2. THE FOUR STEP CHIPS - THE SPINE HE LIKES ==
 * The chips are painted by feat_mls_writeback_walkthrough.js (production) and
 * re-derived from positive evidence by residue-athena-1.0.0 in the two 1p
 * shells. The sheet's job is to reserve their host in the right place; theirs
 * is to keep the four steps, in order. Both halves are pinned. */
/* The confirm chip is written as an entity in the shells' HTML and plain in
   the module's JS, so the pin accepts the two spellings of the SAME label and
   nothing else. */
const STEP_LABELS = [['Pick the action'], ['Athena checks it'], ['Confirm &amp; write', 'Confirm & write'], ['Verify in Athena']];
{
  ['feat_mls_writeback_walkthrough.js', '1pScribeFlow.html', '1p/index.html'].forEach(function (name) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p, 'utf8');
    let cursor = -1;
    STEP_LABELS.forEach(function (spellings) {
      const hits = spellings.map(s => src.indexOf(s, cursor + 1)).filter(i => i > cursor);
      ok(hits.length > 0, name + ': the four step chips lost "' + spellings[0] + '" or its order');
      cursor = Math.min.apply(Math, hits);
    });
    ok(src.indexOf('wbwSteps') > 0, name + ': the step strip no longer names the host the sheet reserves');
  });
  /* the walkthrough module must still be able to mount into a host the sheet
     already created - it creates one only when there is none. */
  const wbw = read('feat_mls_writeback_walkthrough.js');
  ok(/var host = \$\('wbwSteps'\);\s*\n\s*if \(!host\) \{/.test(wbw),
    'the walkthrough module no longer reuses an existing #wbwSteps host, so reserving one would create a SECOND strip');
}

/* ------------------------------------------------------------------ DOM shim
 * The same harness shape the sheet-clarity suite proved this renderer against,
 * plus one addition: document.querySelector answers the ONE descendant
 * selector renderUnifiedReceipts uses to fold the checklist away, so the
 * receipt step can be measured rather than asserted from source. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsAthenaUnifiedCopySection'];
const SECTIONS_SELECTOR = '#mlsAthenaUnifiedConfirm [data-mls-sections="1"]';

function makeDom() {
  const byId = new Map();
  const live = new Map();
  const sectionsHost = { style: { display: '' } };
  let card = null;

  function checkbox(rowId, tail) {
    const markupChecked = /(^|\s)checked(\s|$|>)/.test(String(tail || ''));
    const el = {
      tagName: 'INPUT', type: 'checkbox', markupChecked: markupChecked, checked: markupChecked,
      id: '', style: {}, children: [],
      attrs: { 'data-mls-bx-row': rowId, class: 'mls-bx-check' }, handlers: {},
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener() {}, focus() {}, click() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
      fire(t) { (el.handlers[t] || []).forEach(fn => fn({ target: el })); }
    };
    return el;
  }
  function boxesOf(el) {
    if (el._bx) return el._bx;
    const out = [];
    const re = /class="mls-bx-check" data-mls-bx-row="([^"]+)"([^>]*)>/g;
    let m;
    while ((m = re.exec(String(el.innerHTML || '')))) out.push(checkbox(m[1], m[2]));
    el._bx = out;
    return out;
  }
  function forget(children) {
    children.forEach(child => {
      if (child && child.id && live.get(child.id) === child) live.delete(child.id);
      if (child && child.children && child.children.length) forget(child.children);
    });
  }
  function node(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [],
      handlers: {}, value: '', disabled: false, type: '', id: '', title: '',
      isConnected: true, className: '', parentNode: null, _bx: null, open: false,
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener(t, fn) { const l = el.handlers[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      appendChild(child) {
        el.children.push(child); child.parentNode = el;
        if (child.id && LIVE_IDS.indexOf(child.id) >= 0) live.set(child.id, child);
        return child;
      },
      insertBefore(child) { return el.appendChild(child); },
      remove() {
        if (el.id && live.get(el.id) === el) live.delete(el.id);
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(c => c !== el);
      },
      select() {}, focus() {},
      querySelector(sel) {
        const s = String(sel || '');
        if (s === SECTIONS_SELECTOR) return sectionsHost;
        if (s.charAt(0) === '#') return resolve(s);
        const m = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(s.trim());
        if (!m) return null;
        return el.children.filter(c => (m[2] === undefined ? c.getAttribute(m[1]) !== null : c.getAttribute(m[1]) === m[2]))[0] || null;
      },
      querySelectorAll(sel) { return /mls-bx-check/.test(String(sel || '')) ? boxesOf(el) : []; },
      closest() { return null; },
      click() { (el.handlers.click || []).forEach(fn => fn({ target: el })); }
    };
    let html = '', text = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return html; },
      set(v) {
        html = String(v); el._bx = null;
        forget(el.children); el.children.length = 0;
        if (html.indexOf('mlsAthenaUnifiedGo') >= 0) card = el;
      }
    });
    Object.defineProperty(el, 'textContent', {
      get() { return text; },
      set(v) { text = String(v); forget(el.children); el.children.length = 0; }
    });
    return el;
  }
  function resolve(sel) {
    const key = String(sel || '').replace(/^#/, '');
    if (LIVE_IDS.indexOf(key) >= 0) return live.get(key) || null;
    if (!byId.has(key)) { const el = node('div'); el.id = key; el.attrs.id = key; byId.set(key, el); }
    return byId.get(key);
  }
  const document = {
    readyState: 'complete', activeElement: null,
    body: node('body'), head: node('head'), documentElement: node('html'),
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return String(sel) === SECTIONS_SELECTOR ? sectionsHost : resolve(sel); },
    querySelectorAll(sel) { return (/mls-bx-check/.test(String(sel || '')) && card) ? boxesOf(card) : []; },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return { document, resolve, sectionsHost, boxes: () => (card ? boxesOf(card) : []), cardHtml: () => (card ? card.innerHTML : '') };
}

const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-ui', patientId: 'syn-ui', name: 'Synthetic Patient WriteUi', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-ui', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const OP_TEXT = 'PROCEDURE PERFORMED: Synthetic lumbar medial branch block for the write-ui proof.';
const ONE = [{ key: 'procedure', text: OP_TEXT }];
const TWO = [{ key: 'hpi', text: 'Synthetic HPI body for the write-ui proof.' },
  { key: 'ros', text: 'Synthetic ROS body for the write-ui proof.' }];
const THREE = TWO.concat([{ key: 'exam', text: 'Synthetic exam body for the write-ui proof.' }]);
function clone(v) { return JSON.parse(JSON.stringify(v)); }

function makeHarness(options) {
  options = options || {};
  const dom = makeDom();
  const listeners = [];
  const posted = [];
  const seen = [];
  const store = new Map();
  if (!options.unbound) {
    store.set('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {
      ['appointment-id:' + APPOINTMENT]: { state: 'done', patientId: PATIENT.patientId, backendAppointmentId: CAL_ROW.id, appt_date: DAY }
    } }));
  }
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const window = {
    document: dom.document, localStorage,
    _calAppts: options.unbound ? [] : [clone(CAL_ROW)],
    uns: k => 'acct:' + k,
    activePatient: () => PATIENT,
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage(message) { posted.push(message); route(message); }
  };
  window.window = window;

  function deliver(type, requestId, resp) {
    Promise.resolve().then(() => listeners.slice().forEach(fn => fn({ data: { source: 'mls-ext', type, requestId, resp } })));
  }
  const CONTEXT = {
    patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, appointmentId: APPOINTMENT,
    encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL, visitDate: ATHENA_DAY, provider: PROVIDER,
    control: 'Procedure Documentation editor', framePath: '0', encounterRootFingerprint: 'er', controlFingerprint: 'c',
    noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h'
  };
  function defaultAction(m) {
    if (m.mode === 'execute') {
      return { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        noteWriteProof: 'proof-' + ENCOUNTER, noteWriteProofExpiresAt: Date.now() + 600000, context: clone(CONTEXT) };
    }
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
      rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(CONTEXT) };
  }
  function deliverRaw(message) {
    Promise.resolve().then(() => listeners.slice().forEach(fn => fn({ data: message })));
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') {
      seen.push({ mode: m.mode, rowHash: m.rowHash, stateWord: stateWord() });
      return deliver('mlsAppAthenaActionV2Result', m.requestId, options.onAction ? options.onAction(m, defaultAction) : defaultAction(m));
    }
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    /* wfnext-1.0.0 (2026-09-01): the shim answers mlsPing the way the extension
       really does - a TOP-LEVEL mlsPong with no resp wrapper - so the sheet can
       feature-detect batchArm. MLS Assist 3.0.108+ mints a batch authorization
       from ONE trusted click, which is the lane on which one press still writes
       every checked section; the one-press-per-section lane an older extension
       gets is proved in tests/write-next-press-proof.js. */
    if (m.type === 'mlsPing') return deliverRaw({ source: 'mls-ext', type: 'mlsPong', requestId: m.requestId, version: '3.0.108', buildId: '3.0.108', batchArm: '1.0.0', capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true, batchArmV1: true } });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.62', versionName: '3.0.62+core', athena: { tabs: 1, discarded: 0 } });
  }
  function stateWord() { try { return dom.resolve('mlsAthenaUnifiedState').getAttribute('data-mls-sheet-state'); } catch (e) { return null; } }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => { const m = Number(ms || 0); if (m <= 2000 || m === 12000 || m === 15000) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });
  return {
    window, document: dom.document, el: dom.resolve, boxes: dom.boxes, cardHtml: dom.cardHtml,
    sectionsHost: dom.sectionsHost, posted, seen,
    wf: window.__mlsWriteFlow,
    stateWord: stateWord,
    stateHtml: () => String(dom.resolve('mlsAthenaUnifiedState').innerHTML || ''),
    receiptHtml: () => String(dom.resolve('mlsAthenaUnifiedReceipt').innerHTML || ''),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute')
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }

/* ------------------------------------------------------------- markup tree */
const VOID_TAGS = { input: 1, br: 1, img: 1, hr: 1, meta: 1, link: 1, source: 1, col: 1, area: 1 };
function parseTree(html) {
  const root = { tag: 'root', id: '', style: '', attrs: '', children: [], parent: null };
  let cur = root;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (m[1] === '/') {
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    const idM = /\sid="([^"]*)"/.exec(attrs);
    const el = { tag: tag, id: idM ? idM[1] : '', style: (/\sstyle="([^"]*)"/.exec(attrs) || [])[1] || '', attrs: attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!VOID_TAGS[tag] && !/\/$/.test(attrs.trim())) cur = el;
  }
  return root;
}
function findById(node, id) {
  if (node.id === id) return node;
  for (let i = 0; i < node.children.length; i++) {
    const hit = findById(node.children[i], id);
    if (hit) return hit;
  }
  return null;
}
function findWith(node, needle) {
  if (node.attrs && node.attrs.indexOf(needle) >= 0) return node;
  for (let i = 0; i < node.children.length; i++) {
    const hit = findWith(node.children[i], needle);
    if (hit) return hit;
  }
  return null;
}

/* One status pill and one sentence, whatever the state. */
function pill(h, want, where) {
  const html = h.stateHtml();
  eq(tally(html, 'data-mls-state-word="1"'), 1, where + ': the sheet painted more than one status word');
  eq(tally(html, 'data-mls-state-short="1"'), 1, where + ': the sheet painted more than one status sentence');
  eq(h.stateWord(), want, where + ': the sheet is not in the state this fixture built');
  ok(/data-mls-state-word="1"[^>]*border-radius:999px/.test(html), where + ': the status word is not painted as a pill: ' + html.slice(0, 160));
  ok(/data-mls-state-word="1"[^>]*font-size:19px/.test(html), where + ': the status word lost the size a scanning doctor reads it at');
  const short = (/data-mls-state-short="1"[^>]*>([^<]*)</.exec(html) || [])[1] || '';
  ok(short.trim().length > 12, where + ': the status pill has no sentence under it: ' + JSON.stringify(short));
  const live = h.wf.diagnostics.state();
  const derived = h.wf.diagnostics.sheetClarity.stateFor(live && live.wfautoLastKind);
  eq(h.stateWord(), derived.label, where + ': the painted word is not the state the shipped derivation returns');
  ok(short.indexOf(String(derived.short).slice(0, 30).replace(/&/g, '&amp;').replace(/</g, '&lt;')) === 0,
    where + ': the painted sentence is not the derived sentence: ' + short);
}

/* The primary button obeys unifiedPrimaryPlan, which writeui did not touch. */
function primaryFollowsPlan(h, where) {
  const live = h.wf.diagnostics.state();
  const plan = h.wf.diagnostics.sheetUx.plan(live);
  const go = h.el('mlsAthenaUnifiedGo');
  /* WHILE A READ-ONLY CHECK OR A WRITE IS IN FLIGHT THE PLAN DOES NOT GET THE
     LAST WORD, and must not: the probe ladder disarms Confirm the moment it
     starts, so a doctor cannot press a button whose binding is being rebuilt.
     That is the shipped safety property, so it is what is asserted there. */
  const inFlight = !!(live && (live.running || live.batchRunning || live.generating)) ||
    !!(live && live.probeGeneration !== live.probeSettled);
  if (inFlight) {
    eq(go.disabled, true, where + ': the primary button is live while a read-only check or a write is in flight');
    return;
  }
  /* THE BUTTON IS NEVER WEAKER THAN THE PLAN, AND NEVER STRONGER THAN ITS
     BINDING. Nothing to send is a dead button carrying the plan's OWN reason;
     a live button always means the plan has something to send AND the sheet is
     armed for it - either a checked-section batch or a validated read-only
     probe. A dead button with work still on the sheet is the disarmed state a
     completed write or a settled refusal leaves behind, and it may not go on
     advertising a probe binding it no longer has. */
  if (plan.mode === 'none') {
    eq(go.disabled, true, where + ': the plan has nothing to send and the button is live');
    eq(go.getAttribute('data-mls-primary-blocked'), plan.reason, where + ': the disabled button does not carry the plan\'s own reason');
    return;
  }
  if (!go.disabled) {
    ok(plan.mode === 'batch' || !!go.getAttribute('data-mls-athena-action'),
      where + ': the button is live with neither a checked-section batch plan nor a validated probe binding');
    eq(go.getAttribute('data-mls-primary-blocked'), null, where + ': a live button still carries a refusal');
  } else {
    eq(go.getAttribute('data-mls-athena-action'), null,
      where + ': the button is dead while still advertising a live probe binding');
  }
}

(async function run() {

  /* ================================ 3. ONE CALM SHEET, IN THE RIGHT ORDER == */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'ui-order' });
    const html = h.cardHtml();

    /* 3a. every id the app, the overlays and the suites reach for, exactly once */
    ['mlsAthenaUnifiedBody', 'mlsAthenaUnifiedTitle', 'mlsAthenaUnifiedClose', 'wbwSteps',
      'mlsAthenaUnifiedState', 'mlsAthenaUnifiedProgress', 'mlsAthenaUnifiedReceipt',
      'mlsAthenaUnifiedDetails', 'mlsAthenaUnifiedProbe', 'mlsAthenaUnifiedDiag', 'mlsAthenaUnifiedFix',
      'mlsAthenaUnifiedSafety', 'mlsAthenaUnifiedContext', 'mlsAthenaUnifiedFooter',
      'mlsAthenaUnifiedCancel', 'mlsAthenaUnifiedGo'].forEach(function (id) {
      eq(tally(html, 'id="' + id + '"'), 1, 'the rebuilt sheet lost or duplicated #' + id);
    });
    ok(!!h.el('mlsAthenaUnifiedConfirm'), 'the overlay is gone');

    /* 3b. the spine: header -> step chips -> status pill -> loading bar */
    const tree = parseTree(html);
    const body = findById(tree, 'mlsAthenaUnifiedBody');
    ok(body, 'the scrolling body is gone');
    const title = findById(body, 'mlsAthenaUnifiedTitle');
    ok(title, 'the title is gone');
    const headerBlock = title.parent && title.parent.parent;
    ok(headerBlock && headerBlock.parent === body,
      'the header is no longer a direct child of the body - feat_mls_writeback_walkthrough.js mounts the step strip after exactly that element');
    const steps = findById(body, 'wbwSteps');
    ok(steps && steps.parent === body, 'the step-chip host is not a direct child of the body');
    eq(body.children.indexOf(steps), body.children.indexOf(headerBlock) + 1,
      'the four step chips are not directly under the header');
    eq(steps.children.length, 0, 'the reserved step host is not empty - the sheet must not paint a second strip of its own');

    const order = ['wbwSteps', 'mlsAthenaUnifiedState', 'mlsAthenaUnifiedProgress', 'mlsAthenaUnifiedReceipt', 'mlsAthenaUnifiedDetails', 'mlsAthenaUnifiedFix'];
    order.forEach(function (id, i) {
      if (!i) return;
      ok(html.indexOf('id="' + id + '"') > html.indexOf('id="' + order[i - 1] + '"'),
        'the sheet reads out of order: ' + id + ' is above ' + order[i - 1]);
    });
    ok(html.indexOf('id="mlsAthenaUnifiedFooter"') > html.indexOf('id="mlsAthenaUnifiedReceipt"'),
      'the footer is no longer the last thing in the card');
    /* the sections checklist is below the status, and the explanations below it */
    ok(html.indexOf('data-mls-sections="1"') > html.indexOf('id="mlsAthenaUnifiedProgress"'),
      'the sections checklist climbed above the loading bar');
    ok(html.indexOf('data-mls-sheet-how="1"') > html.indexOf('data-mls-sections="1"'),
      'the explanations are back above the work');

    /* 3c. the header states WHO and ONE sentence of what will happen */
    ok(html.indexOf(PATIENT.name + ' - DOB ' + PATIENT.dob + ' - MRN ' + PATIENT.mrn + ' - ' + ATHENA_DAY + ' - ' + PROVIDER) > 0,
      'the header does not carry name, DOB, MRN, date and provider in one line');
    const plan = findWith(headerBlock, 'data-mls-sheet-plan="1"');
    ok(plan, 'the header has no one-sentence statement of what will happen');
    const procedureRow = manifest.rows.filter(r => r.action === 'write_note')[0];
    ok(html.indexOf('MLS will write this text into ' + procedureRow.destination + '.') > 0,
      'the header sentence does not name the exact Athena section this write lands in');
    /* savenamed-app-1.0.0 (OWNER RULING 2026-09-02: "unblock the save block in
       mls assistant..." / "no one should have to touch Athena this entire
       process"). This fixture is an OP NOTE, whose reviewed section is the
       named 'procedure' destination - so under MLS Assist 3.0.111 it carries
       the supervised encounter-save row, and the header may no longer hand Save
       back to the doctor. SIGN still is his, and the sentence still says so;
       that half is the one this line was really guarding. */
    ok(html.indexOf('MLS saves the encounter itself once the sections land; Sign &amp; Save stays yours in athenaOne.') > 0,
      'the header sentence does not hand Sign back to the doctor, or claims Save is still his after 3.0.111 took it over');
    eq(html.indexOf('Save and Sign &amp; Save stay yours in athenaOne.'), -1,
      'the header still tells the doctor to go and save an encounter MLS will save for him');

    /* 3d. no duplicate controls anywhere */
    /* savenamed-app-1.0.0: TWO ready rows now - the op-note write and the
       encounter save - so there IS a choice and the radio is a real control
       again. writeui-1.0.0's rule is unchanged: a SOLE ready row hides it. */
    eq(tally(html, 'name="mlsAthenaUnifiedAction"'), 2, 'the op-note sheet rendered a radio for something other than its write row and its save row');
    eq(tally(html, 'class="mls-bx-check"'), 1, 'a one-section sheet rendered more than one include checkbox - the save row must never carry one');
    eq(tally(html, 'data-mls-copy-note="'), 1, 'the sheet rendered more than one Copy note button');
    eq(/name="mlsAthenaUnifiedAction"[^>]*style="display:none"/.test(html), false,
      'a sheet with two READY rows hid the radio that picks between them');
    eq(h.boxes().length, 1, 'the include checkbox is gone');
    eq(h.boxes()[0].checked, true, 'the single READY section no longer arrives checked');
  }

  /* ============================== 4. THE EXACT TEXT IS ONE CLICK AWAY ====== */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'ui-text' });
    const html = h.cardHtml();
    const row = manifest.rows.filter(r => r.action === 'write_note')[0];

    /* nothing on this sheet ships open */
    eq(tally(html, '<details open'), 0, 'a disclosure on the rendered sheet ships OPEN');
    ok(/<details[^>]*\sopen[\s>]/.test(html) === false, 'a disclosure on the rendered sheet carries the open attribute');

    /* exactly one view-text disclosure per row, and the payload is inside it */
    eq(tally(html, 'data-mls-view-text="'), tally(html, 'data-manifest-row="'),
      'every section must carry exactly one "view text" disclosure - no more, no fewer');
    const openAt = html.indexOf('data-mls-view-text="' + row.id + '"');
    ok(openAt > 0, 'the one section has no view-text disclosure');
    const closeAt = html.indexOf('</details>', openAt);
    /* RE-AIMED, preview-1.0.0 (OWNER 2026-09-02, verbatim: "make a better write
       UI by actually showing what's going to be written in cleaner if
       possible"). writeui-1.0.0 put the payload behind this disclosure because
       what sat on the page was an ENGINEER'S SLAB - a monospace block with two
       hex ids under it - above the fold on every review. The owner has since
       asked for the opposite of what that pass optimised for: the doctor is to
       SEE the text that will land. So the property is re-aimed, not dropped -
       the SLAB, its monospace and the two hashes still live inside this
       disclosure and nowhere else, and the row's own reading-type preview
       (data-mls-preview-text, white-space:pre-wrap, clamped to two lines behind
       an aria-expanded button) is what is allowed to show the same string above
       it. tests/write-sheet-agreement-proof.js pins that the preview text IS
       the payload the execute sends, byte for byte. */
    const textAt = html.indexOf(OP_TEXT, openAt);
    ok(textAt > openAt && textAt < closeAt,
      'THE EXACT PAYLOAD LEFT ITS OWN SECTION\'S DISCLOSURE');
    eq(tally(html, '<pre'), tally(html, 'data-mls-view-text="'),
      'THERE IS A MONOSPACE PAYLOAD SLAB THAT BELONGS TO NO SECTION DISCLOSURE - the engineer view may only live inside one');
    const preAt = html.indexOf('<pre');
    ok(preAt > html.indexOf('data-mls-view-text="'), 'a payload slab is poured onto the page before any disclosure opens');
    const pvAt = html.indexOf('data-mls-preview-text="' + row.id + '"');
    ok(pvAt > 0 && pvAt < openAt, 'the reading-type preview does not sit on the row, above its engineer disclosure');
    ok(html.indexOf('data-mls-preview-toggle="' + row.id + '" aria-expanded=') > 0,
      'the reading-type preview has no keyboard-reachable aria-expanded toggle');
    /* the doctor's heading survived, byte for byte */
    ok(html.indexOf('Review the exact text going to ' + row.destination) > 0,
      'the note review lost the heading that names its exact Athena destination');
    /* and the technical ids moved to the FOOTER of that expanded view */
    const hashAt = html.indexOf('Payload ' + row.payloadHash);
    ok(hashAt > textAt && hashAt < closeAt,
      'the payload / row ids are not at the bottom of the expanded view, in small type');
    ok(/Payload [^<]*&middot; Row /.test(html), 'the payload and row ids stopped being reported at all');
    ok(html.indexOf('Review full payload and hashes') < 0,
      'the old engineering summary is back on the disclosure the doctor reads');
    /* Copy note survived, inside the same disclosure */
    const copyAt = html.indexOf('data-mls-copy-note="' + row.id + '"');
    ok(copyAt > openAt && copyAt < closeAt, 'Copy note is no longer beside the text it copies');
  }

  /* ================== 5. ONE STATUS PILL AND ONE SENTENCE, IN EVERY STATE == */
  {
    /* CHECKING -> READY -> SENDING -> DONE */
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'ui-states' });
    pill(h, 'CHECKING', 'on open');
    primaryFollowsPlan(h, 'on open');
    await settle(220);
    pill(h, 'READY', 'after a verified read-only check');
    primaryFollowsPlan(h, 'after a verified read-only check');
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, false, 'the verified sheet left Confirm grey');
    go.click();
    await settle(900);
    /* savenamed-app-1.0.0 (owner ruling 2026-09-02). This harness advertises
       MLS Assist 3.0.108+ (batchArm), where ONE trusted click mints an ordered
       authorization the extension consumes one item per execute - that is the
       lane tests/write-next-press-proof.js section 6 already pins at three
       executes from one press. Under 3.0.111 the review's own encounter save
       rides that same list as the FINAL item, so this press is the op-note
       write and then the save: two executes, one click, each with its own
       read-only check and its own receipt. */
    eq(h.executes().length, 2, 'the human Confirm click did not issue the write and then the encounter save');
    eq(h.executes()[0].action, 'write_note', 'the press did not write the note first');
    eq(h.executes()[1].action, 'save_draft', 'the encounter save did not ride last on the same press');
    pill(h, 'DONE', 'after a verified write and a verified encounter save');
    primaryFollowsPlan(h, 'after a verified write');
  }
  {
    /* NOTHING CHECKED */
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'ui-zero' });
    await settle(220);
    const boxes = h.boxes();
    eq(boxes.length, 3, 'the three-section fixture did not render three include checkboxes');
    boxes.forEach(b => { b.checked = false; });
    boxes[0].fire('change');
    pill(h, 'NOTHING CHECKED', 'with every section unchecked');
    primaryFollowsPlan(h, 'with every section unchecked');
    boxes[1].checked = true;
    boxes[1].fire('change');
    primaryFollowsPlan(h, 'after re-checking one section');
  }
  {
    /* NEEDS ONE STEP - a recoverable refusal, never folded away */
    const h = makeHarness({
      onAction: (m, dflt) => (m.mode === 'probe' ? { ok: false, blocked: true, reason: 'note-editor-not-empty' } : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'ui-fix' });
    await settle(420);
    pill(h, 'NEEDS ONE STEP', 'on a recoverable refusal');
    eq(h.el('mlsAthenaUnifiedDetails').open, true, 'A REFUSAL WAS HIDDEN BEHIND A FOLD');
    eq(h.el('mlsAthenaUnifiedProbe').getAttribute('data-mls-status-kind'), 'fix', 'the recoverable refusal lost its amber severity');
    ok(/never types over text/.test(String(h.el('mlsAthenaUnifiedProbe').textContent)),
      'the refusal lost the honest reason MLS will not overwrite');
    eq(h.executes().length, 0, 'a refused check reached Athena');
  }
  {
    /* CAN'T SEND - an identity conflict is never softened */
    const h = makeHarness({
      onAction: (m, dflt) => {
        const r = dflt(m);
        if (m.mode === 'probe') r.context = Object.assign({}, r.context, { dob: '11/11/1911' });
        return r;
      }
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'ui-err' });
    await settle(320);
    pill(h, 'CAN’T SEND', 'on an identity conflict');
    eq(h.el('mlsAthenaUnifiedDetails').open, true, 'an identity conflict was folded away');
    eq(h.executes().length, 0, 'an identity conflict reached an execute');
  }

  /* ========== 6. THE LOADING BAR HE LIKES, AND THE RECEIPT IT ENDS IN ====== */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'ui-batch' });
    await settle(160);
    eq(String(h.el('mlsAthenaUnifiedProgress').innerHTML || ''), '', 'the loading bar painted before anything was sent');
    eq(h.receiptHtml(), '', 'the receipt painted before there was an outcome');
    h.wf.diagnostics.sheetUx.press(h.el('mlsAthenaUnifiedGo'));
    await settle(2600);
    /* savenamed-app-1.0.0: three sections and then the encounter save, on the
       one batch-arm press. The save is always the LAST item and is never
       counted as a section anywhere the doctor reads. */
    eq(h.executes().length, 4, 'the one press did not send all three checked sections and then save the encounter');
    assert.deepStrictEqual(h.executes().map(m => m.action), ['write_note', 'write_note', 'write_note', 'save_draft'],
      'the encounter save did not ride last on the same press');
    checks++;
    const prog = String(h.el('mlsAthenaUnifiedProgress').innerHTML || '');
    ok(prog.indexOf('data-mls-prog-headline') > 0, 'the loading bar never painted a headline');
    ok(/data-mls-prog-pct="100"/.test(prog), 'a finished batch never filled the bar');
    ok(h.seen.some(s => s.stateWord === 'SENDING'), 'the sheet never said SENDING while it was writing');
    pill(h, 'DONE', 'after a fully verified batch');

    /* the receipt: what landed where, the read-back line, the athenaOne link */
    const rec = h.receiptHtml();
    ok(rec.indexOf('data-mls-receipt-landed="1"') > 0, 'a finished send does not say what landed');
    manifest.rows.filter(r => r.action === 'write_note').forEach(function (row) {
      ok(rec.indexOf('<b>' + row.label + '</b> &rarr; ' + row.destination) > 0,
        'the receipt does not name where ' + row.label + ' landed');
    });
    ok(rec.indexOf('Athena read each of these back from the exact field after the write.') > 0,
      'the receipt lost the read-back line');
    ok(rec.indexOf('href="' + ENCOUNTER_URL + '"') > 0, 'the receipt does not offer the athenaOne encounter it already knows');
    ok(rec.indexOf('Everything on this review is in Athena') > 0, 'the completion banner is gone');
    eq(h.sectionsHost.style.display, 'none', 'a finished sheet still shows the "sections to write" checklist over its own receipt');
    eq(h.el('mlsAthenaUnifiedCancel').textContent, 'Done — close review', 'the exit button does not become Done');
  }
  {
    /* PARTLY DONE names what did not land, and why */
    let refuse = '';
    const h = makeHarness({
      onAction: (m, dflt) => ((m.mode === 'probe' && m.rowHash === refuse)
        ? { ok: false, blocked: true, reason: 'note-editor-not-empty' } : dflt(m))
    });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: TWO, expectedContext: BOUND, receiptSessionId: 'ui-partly' });
    const noteRows = manifest.rows.filter(r => r.action === 'write_note');
    eq(noteRows.length, 2, 'the two-section fixture did not build two note rows');
    refuse = noteRows[1].rowHash;
    await settle(300);
    h.wf.diagnostics.sheetUx.press(h.el('mlsAthenaUnifiedGo'));
    await settle(2600);
    /* savenamed-app-1.0.0: the refused section is STILL never written - that is
       the property this line guards, and it is asserted on the actions below.
       What changed is that the same batch-arm press also runs the review's own
       encounter save, which is a draft save of whatever DID land: it protects
       the section that landed, it signs nothing, and the receipt below still
       names the section that did not land and why. */
    eq(h.executes().length, 2, 'the refused section was written anyway, or the encounter save did not ride the same press');
    assert.deepStrictEqual(h.executes().map(m => m.action), ['write_note', 'save_draft'],
      'the refused section was written anyway');
    checks++;
    eq(h.executes().filter(m => m.rowHash === noteRows[1].rowHash).length, 0,
      'THE REFUSED SECTION REACHED AN EXECUTE');
    pill(h, 'PARTLY DONE', 'when one of two sections landed');
    const rec = h.receiptHtml();
    ok(rec.indexOf('data-mls-receipt-missed="1"') > 0, 'a partial send does not name what did not land');
    ok(rec.indexOf('<b>' + noteRows[1].label + '</b>') > 0, 'the partial receipt does not name the section that did not land');
    ok(/Not written &mdash; 1 of 2/.test(rec), 'the partial receipt does not count what is missing');
    ok(rec.indexOf('<b>' + noteRows[0].label + '</b> &rarr; ' + noteRows[0].destination) > 0,
      'the partial receipt does not say where the one that landed went');
    ok(rec.indexOf('Everything on this review is in Athena') < 0, 'a partial send claimed everything is in Athena');
    eq(h.sectionsHost.style.display, '', 'a partial send folded away the sections that still have work left');
  }

  /* ============ 7. AN UNBOUND REVIEW STILL SAYS SO, AND SENDS NOTHING ====== */
  {
    const h = makeHarness({ unbound: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE,
      expectedContext: { visitDate: '', provider: '', appointmentId: '' }, requireExpectedVisit: true, receiptSessionId: 'ui-unbound' });
    await settle(160);
    const html = h.cardHtml();
    ok(html.indexOf('visit date not bound yet') > 0, 'an unbound visit date is silently omitted from the header');
    ok(html.indexOf('provider not bound yet') > 0, 'an unbound provider is silently omitted from the header');
    ok(html.indexOf('Nothing on this review can be written yet') > 0,
      'the header sentence promises a write on a sheet that cannot write');
    eq(h.boxes().length, 0, 'an all-blocked sheet rendered an include checkbox');
    primaryFollowsPlan(h, 'on an unbound review');
    eq(h.el('mlsAthenaUnifiedGo').getAttribute('data-mls-primary-blocked'), h.wf.diagnostics.sheetClarity.noneReadyReason,
      'the no-READY-section refusal is not the honest one');
    h.wf.diagnostics.sheetUx.press(h.el('mlsAthenaUnifiedGo'));
    await settle(160);
    eq(h.executes().length, 0, 'a sheet with no READY section still reached Athena');
  }

  console.log('PASS write-ui: ' + checks + ' checks - writeui-1.0.0 (b1184) is presentation only: the identity lock, probe ladder, receipt mint, execute, batch queue and both closed allowlists are byte-identical by the SAME SHA-256 digests sheet-clarity and write-auto-chain pin, the primary-button plan and the state derivation are byte-identical to b1183 and the arrival default is byte-identical to its one deliberate apsel-1.0.0 re-aim, whose properties are re-asserted off the shipped source (the ready/write-note gate untouched, the Assessment/Plan rule an exception that reaches nothing else, and its two sides mutually exclusive at every preference); the rebuilt sheet reads header -> the four step chips in their reserved host -> ONE status pill and ONE sentence -> the loading bar -> the receipt -> the sections checklist -> one closed "How this works" that still carries every disclosure verbatim; the exact text ships CLOSED behind one per-section toggle with the payload/row ids in its footer; the primary button follows unifiedPrimaryPlan in every state; and a finished send turns the sheet into a receipt that names what landed where, says Athena read it back, offers the encounter link, and on a partial send names what did not land and why');
})().catch(err => { console.error(err); process.exit(1); });
