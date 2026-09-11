'use strict';

/* rowfix-1.0.0 (2026-09-11) — EVERY REFUSAL ON THE ATHENA REVIEW SHEET CARRIES
 * ITS OWN NEXT MOVE, AND SAYS IT IN THE DOCTOR'S WORDS.
 *
 * Two measured defects on 1p-feat_mls_writeflow.js, both of them things a
 * first-day doctor meets on his own screen:
 *
 *   T1  THE SHEET SPOKE ENGINEERING. The button that repairs a review whose
 *       visit is not matched to an Athena appointment read "Bind this visit to
 *       its Athena appointment"; a manual row offered "Copy payload"; refusals
 *       said "this manifest is halted", "the write left no receipt", "Athena
 *       did not return a one-use confirmation token", "MLS keeps this payload
 *       manual", "catalog-bound". None of those words mean anything to a
 *       doctor, and several of them are already banned by name in
 *       tests/1p-clunky-contract.test.js — the sheet was shipping words its own
 *       contract forbids.
 *
 *   T2  A LABEL WITH NO ACTION. A BLOCKED row painted "BLOCKED · NOTHING SENT"
 *       and a reason and nothing to press. A MANUAL row painted "MANUAL IN
 *       ATHENA" the same way. The "What happened" column uppercased
 *       BLOCKED / MANUAL / NOT SENT into a red-and-amber list with zero
 *       controls. The one "Check Athena again" button on the sheet is minted by
 *       the read-only probe path into the status line, so it exists for exactly
 *       one row at a time and never for a blocked or manual one. And all of it
 *       sat inside a <details> that shipped collapsed.
 *
 * WHAT THIS SUITE PINS, and the one thing it exists to stop: the cure may not
 * become a second way to send. Every control rowfix-1.0.0 adds calls a handler
 * the sheet ALREADY had — probeUnifiedRow (the read-only check the canonical
 * "Check Athena again" runs), wfbindRun / wfdxShowFixStrip (the existing
 * appointment-match cure), openUnifiedConfirmation (the rebuild the shell's own
 * "Check Athena again" already performs) and unifiedCopyText over
 * manifestPayloadText (the existing copy action). The block mints no action
 * token, posts nothing on the bridge, writes no receipt and can never enable
 * Confirm; sections 3 and 4 prove that from its own bytes.
 *
 * The rendered, in-a-real-browser half of this contract lives in
 * tests/1p-clunky-contract.test.js (jargon gate widened to the painted words;
 * the drawer's open state and its per-row control count).
 *
 * Run:  node tests/write-row-controls-proof.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FLOW = fs.readFileSync(path.join(ROOT, '1p-feat_mls_writeflow.js'), 'utf8');

/* The sweep below reads the file AS IT IS, comments included, so every
   banned literal is anchored in code punctuation - a quote, an HTML tag or an
   assignment - that a prose comment cannot carry. That is deliberate: a JS
   comment stripper that desyncs by one character would blank real code and
   turn this suite into a false PASS, which is the one failure mode a banned-
   word gate may not have. The engineering record of WHY a sentence changed
   stays written in the words it changed from, and this suite can still see it. */

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }
function slice(start, end, name) {
  const i = FLOW.indexOf(start);
  ok(i >= 0, name + ': its start marker vanished — ' + start);
  const j = FLOW.indexOf(end, i + start.length);
  ok(j > i, name + ': its end marker vanished — ' + end);
  return FLOW.slice(i, j);
}

/* ============================================================= 1. WORDS ==== */
/* The words a doctor reads. Each of these was on his screen at b1230. */
{
  const gone = [
    ['Bind this visit to its Athena appointment', 'the appointment-match button still says "Bind"'],
    ["'Bind to the '", 'the per-appointment choice buttons still say "Bind to"'],
    ["'Binding this review to the '", 'the appointment-match status line still says "Binding"'],
    ["btn.textContent = 'Binding", 'the appointment-match button still relabels itself "Binding"'],
    ['>Copy payload</button>', 'the manual row still offers "Copy payload"'],
    ["'Copy payload'", 'the copy control still restores itself to the label "Copy payload"'],
    ['Patient, visit and manifest identity', 'the identity disclosure still says "manifest"'],
    ['<span>Manifest</span>', 'the identity grid still labels a row "Manifest"'],
    ['this manifest is halted', 'a halted order still tells the doctor a "manifest" is halted'],
    ['This manifest is halted because', 'a halted review still tells the doctor a "manifest" is halted'],
    ['left no receipt', 'a timed-out write still reports that it "left no receipt"'],
    ["'Ready, but not attempted in this receipt.'", 'an unattempted row still says it was not attempted "in this receipt"'],
    ['persisted section receipts', 'the saved-note verification still speaks of "persisted section receipts"'],
    ['saved section receipts', 'the saved-note verification still speaks of "saved section receipts"'],
    ['saved-section receipts', 'a saved-note refusal still speaks of "saved-section receipts"'],
    ['MLS keeps this payload manual', 'an order that stays in Athena still says MLS "keeps this payload manual"'],
    ['More than one reviewed payload targets', 'the duplicate-destination refusal still says "payload"'],
    ['This payload is review-only', 'a review-only row still calls itself a "payload"'],
    ['catalog-bound imaging / PT', 'the orders group still calls a matched order "catalog-bound"'],
    ['each supported catalog-bound order', 'the capability line still says "catalog-bound"'],
    ['a reviewed catalog-bound order', 'the boundary line still says "catalog-bound"'],
    ['immutable review hash', 'an order refusal still names an "immutable review hash"'],
    ['immutable hash was minted', 'a stale review still says its "immutable hash was minted"'],
    ["'Payload ' + esc(row.payloadHash)", 'the id footer still labels the two ids "Payload" and "Row"'],
    ['not bound to a dated Athena appointment', 'an unmatched visit still says it is "not bound"'],
    ['not bound to one exact Athena visit', 'an unmatched review still says it is "not bound"'],
    ["'visit date not bound yet'", 'the identity panel still says the visit date is "not bound yet"'],
    ["'provider not bound yet'", 'the identity panel still says the provider is "not bound yet"'],
    ['this appointment binding', 'a Visit-editor refusal still speaks of an "appointment binding"'],
    ['patient binding was not safe', 'a quarantined note still speaks of a "patient binding"'],
    ['fixing the binding shown here', 'a rebuild refusal still points at "the binding shown here"'],
    /* plainwords-1.1.0 (2026-09-11): the last three places the word "bound"
       was still reaching the doctor after the first pass - the sheet's own
       status footer, the exact-visit refusal, and the Copy-error-report
       tooltip. Measured on a rendered sheet: those were the only three left. */
    ["? 'appointment id is bound'", 'the review footer still tells the doctor an "appointment id is bound"'],
    [": 'no appointment id is bound to this encounter'", 'the review footer still says no appointment id is "bound"'],
    ["= 'The exact visit needs its date, provider, and appointment ID (or a bound encounter ID and URL)", 'the exact-visit refusal still asks for a "bound encounter ID and URL"'],
    ["is on, and whether an appointment id is bound.'", 'the error-report tooltip still says whether an appointment id is "bound"']
  ];
  gone.forEach(function (g) { eq(FLOW.indexOf(g[0]), -1, g[1] + ' (rowfix-1.0.0 / T1)'); });

  /* ...and the words that replaced them are the ones actually shipped. */
  ok(FLOW.indexOf("var WFBIND_LABEL = 'Match this visit to its Athena appointment") > 0,
    'the appointment-match control lost the name the doctor reads on it');
  ok(FLOW.indexOf('>Copy the text</button>') > 0, 'the copy control lost its plain-English label');
  ok(FLOW.indexOf("unifiedCopyText(manifestPayloadText(row), this, 'Copy the text')") > 0,
    'the copy control no longer restores the same label it was minted with');
  ok(FLOW.indexOf("return 'Text ID ' + esc(row.payloadHash) + ' &middot; Row ID ' + esc(row.rowHash);") > 0,
    'the two ids lost their plain labels');
  ok(FLOW.indexOf("'this visit is matched to its Athena appointment' : 'this visit is not matched to an Athena appointment yet'") > 0,
    'the review footer lost the plain-English sentence that replaced "appointment id is bound"');
  ok(FLOW.indexOf('(or a saved encounter ID and link)') > 0,
    'the exact-visit refusal lost the plain-English wording that replaced "a bound encounter ID and URL"');
  ok(FLOW.indexOf('and whether this visit is matched to its Athena appointment.') > 0,
    'the Copy-error-report tooltip lost the plain-English wording that replaced "whether an appointment id is bound"');

  /* THE IDS THEMSELVES ARE UNTOUCHED. A wording lane may rename what the
     doctor reads and may never rename a reason code, a data-* hook or a
     field the extension reads: those are the seams every other suite pins. */
  ['note-payload-mismatch', 'note-section-payload-mismatch', 'preview-hash-mismatch',
    'catalog-query-required', 'catalog-identity-required', 'order-row-hash-required',
    'data-mls-copy-payload', 'data-mls-preview-hash', 'data-mls-row-hash', 'data-manifest-row',
    'mls-athena-write-manifest-v1'].forEach(function (id) {
    ok(FLOW.indexOf(id) > 0, 'the internal identifier ' + id + ' was reworded — a wording lane may only change painted text');
  });

  /* The appointment-match cure recognises its own blocked rows by their REASON.
     Rewording those reasons must not silently switch the cure off — the exact
     hazard "an English word that looks like code" is written against. */
  const curable = slice('  function wfbindCurableRow(manifest, row) {', '  /* A detached reopen option set', 'wfbindCurableRow');
  const probe = curable.match(/if \(!\/([^/]+)\/i\.test\(S\(row\.reason\)\)\) return false;/);
  ok(probe, 'the appointment-match cure no longer recognises its rows by reason at all');
  const re = new RegExp(probe[1], 'i');
  [["The exact visit needs its date, provider, and appointment ID (or a saved encounter ID and link). MLS will not guess an encounter.", 'the exact-visit refusal'],
    ['The exact visit is not matched to a dated Athena appointment, so MLS will not open or guess an encounter.', 'the unmatched-appointment refusal']
  ].forEach(function (p) {
    ok(re.test(p[0]), p[1] + ' no longer matches the appointment-match cure\'s own reason test, so the cure silently stopped being offered');
  });
}

/* ====================================================== 2. THE CONTROLS ==== */
{
  const block = slice('  /* ===== rowfix-1.0.0 (2026-09-11)', '  /* ===== end rowfix-1.0.0', 'rowfix-1.0.0');
  ok(block.length > 900, 'the rowfix-1.0.0 block vanished');

  /* A blocked row carries a control, on the row. */
  const blocked = slice('  function unifiedBlockedRowHtml(manifest, row, sharedReason) {', '  /* ===== wfx-1.0.0', 'unifiedBlockedRowHtml');
  ok(blocked.indexOf('rowfixControlHtml(manifest, row, { hasCopy: true })') > 0,
    'a BLOCKED row paints its red label and its reason with nothing to press (rowfix-1.0.0 / T2)');
  /* rowfix-1.1.0: this row has ALWAYS ended with "Copy the text" under its
     exact text. hasCopy is what stops the blocked-row cure arriving as a
     SECOND identical button on the same row - the row keeps exactly one. */
  eq((blocked.match(/unifiedCopyPayloadButton\(row\)/g) || []).length, 1,
    'the blocked row now mints two copy controls, or lost the one it had (rowfix-1.1.0)');
  eq(blocked.indexOf('press &ldquo;'), -1,
    'the blocked row still points the doctor at a button somewhere else on the page instead of carrying one');

  /* A manual row already had exactly one: the copy. */
  const manual = slice('  function unifiedManualRowHtml(manifest, row) {', '  /* wfclar-1.0.0 (owner 2026-08-27', 'unifiedManualRowHtml');
  ok(manual.indexOf('unifiedCopyPayloadButton(row)') > 0,
    'a MANUAL row lost the copy control that is its whole next move (rowfix-1.0.0 / T2)');

  /* An order row that cannot be sent carries one too; a READY one must not,
     because its own Confirm & Send is the control. */
  const orders = slice('  function renderUnifiedOrderSummary(orderRows, manifest, chosen) {', '  /* oa-1.0.0: record acceptance', 'renderUnifiedOrderSummary');
  ok(/\(ready \? '' : \('<div data-mls-row-fix="' \+ esc\(row\.id\) \+ '">' \+ rowfixControlHtml\(manifest, row\)/.test(orders),
    'a MANUAL or BLOCKED order row has no control, or a READY one grew a second one beside Confirm & Send (rowfix-1.0.0 / T2)');
  /* rowfix-1.1.0: and the order summary has NO copy control of its own, which
     is why the blocked order row - measured returning byte-identical from the
     rebuild it used to offer - is the one that gets the copy here. */
  eq(orders.indexOf('unifiedCopyPayloadButton(row)'), -1,
    'the order summary grew its own copy button, so the row control is now a duplicate (rowfix-1.1.0)');

  /* The outcome column. */
  const receipts = slice('  function renderUnifiedReceipts(state) {', '  function resultToUnifiedReceipt(state, row, resp, probe) {', 'renderUnifiedReceipts');
  ok(receipts.indexOf('rowfixReceiptHtml(state, row, r)') > 0,
    '"What happened" still uppercases BLOCKED / MANUAL / NOT SENT with no control beside it (rowfix-1.0.0 / T2)');
  ok(receipts.indexOf('rowfixWire(state, host)') > 0,
    'the outcome column repaints by innerHTML and nothing re-binds its controls, so they are dead buttons');

  /* The drawer. It opens, it stays open, and it only exists when it has rows. */
  const build = slice('    var drawerCount = manualRows.length + blockedRows.length + orderRows.length;', '    var ov = document.createElement', 'the drawer');
  ok(build.indexOf('if (drawerCount) {') > 0, 'the drawer no longer renders only when it has a row');
  ok(build.indexOf("'<details open data-mls-fix-drawer=\"1\" data-mls-clunky-seen=\"1\"") > 0,
    'the drawer holding every row the doctor still owes ships COLLAPSED, or lost the marker that stops the shell folding it shut (rowfix-1.0.0 / T2)');

  /* The four handlers, and no fifth. */
  ['probeUnifiedRow(state, this.getAttribute(\'data-mls-row-recheck\'))',
    'openUnifiedConfirmation(state.reopenOpts || state.sourceOpts || {})',
    'wfbindRun(state, days[0], btn)',
    'wfdxShowFixStrip(state, S(btn.getAttribute(\'data-mls-row-match\')))',
    "unifiedCopyText(manifestPayloadText(row), this, 'Copy the text')"].forEach(function (call) {
    ok(block.indexOf(call) > 0, 'the row control stopped calling the handler the sheet already had: ' + call);
  });
}

/* ============================================= 3. IT CANNOT SEND ANYTHING == */
{
  const block = slice('  /* ===== rowfix-1.0.0 (2026-09-11)', '  /* ===== end rowfix-1.0.0', 'rowfix-1.0.0');
  const banned = [
    ['bridge(', 'a row control posts on the extension bridge itself'],
    ['actionToken', 'a row control touches a one-use action token'],
    ["mode: 'execute'", 'a row control can execute'],
    ['executeUnifiedSelection', 'a row control reaches the only code that writes'],
    ['runUnifiedBatchSend', 'a row control can start the batch queue'],
    ['state.receipts[', 'a row control writes into the receipt ledger'],
    ['disabled = false', 'a row control can enable a disabled control'],
    ['rememberRowOutcome', 'a row control mints an outcome']
  ];
  banned.forEach(function (b) { eq(block.indexOf(b[0]), -1, b[1] + ' (rowfix-1.0.0 must be read-only, copy or rebuild)'); });

  /* Every control refuses while anything is running. */
  ok(/function rowfixBusy\(state\) \{[\s\S]*state\.running \|\| state\.batchRunning \|\| state\.generating \|\| state\.binding/.test(block),
    'the row controls no longer stand down while a check, a write, a generation or a day match is running');
  eq((block.match(/if \(rowfixBusy\(state\)\) return;/g) || []).length, 3,
    'one of the three pressable row controls stopped consulting the busy guard');

  /* The recheck is offered ONLY where the read-only check can actually run:
     probeUnifiedRow refuses a non-ready row by construction, so offering it on
     a blocked row would be a button that answers "that destination is not
     executable" - a control that resolves nothing, which is the whole defect. */
  ok(/if \(S\(row\.capability\) === 'ready' && ATHENA_EXECUTABLE_ACTIONS\[row\.action\] === true\) return 'recheck';/.test(block),
    'the read-only re-check is offered on rows probeUnifiedRow refuses, so the button answers with a refusal instead of a fix');
  /* rowfix-1.1.0 - THE BLOCKED FALLBACK IS THE COPY, NOT THE REBUILD.
     MEASURED 2026-09-11: "Check Athena again" was offered on every blocked row
     a day match cannot cure, and on those rows it resolves nothing - those
     blocks are not about Athena at all (two reviewed items aimed at one field,
     a generic note mixed with named fields, an order draft missing its
     study/region/indication), so the rebuild came back and the row was
     byte-identical. The move that always finishes the job is the one a MANUAL
     row already gets: take the text into Athena yourself. The rebuild survives
     only on a blocked row with no text to carry, where it is all there is. */
  ok(/if \(S\(row\.capability\) === 'blocked'\) return rowfixCopyable\(row\) \? 'copy' : 'reopen';/.test(block),
    'a blocked row that cannot be matched is back to the rebuild that returns it byte-identical, or lost its fallback entirely (rowfix-1.1.0)');
  ok(/function rowfixCopyable\(row\) \{[\s\S]*manifestPayloadText\(row\)[\s\S]*'\(No text to send\)'/.test(block),
    'the blocked-row copy is offered without first asking whether there is any text to copy - manifestPayloadText never returns empty (rowfix-1.1.0)');
  ok(/if \(kind === 'copy'\) return \(opts && opts\.hasCopy === true\) \? '' : unifiedCopyPayloadButton\(row\);/.test(block),
    'the row control no longer stands down where the renderer already paints a copy, so a row can carry two identical copy buttons (rowfix-1.1.0)');

  /* THE TABLE IS SPELLED FROM THE SHIPPED STATUS CONSTANTS, NOT FROM MEMORY.
     rowfixReceiptHtml keys on the receipt's status STRING, so a lane that
     renames one of these constants and forgets this table would silently take
     the control off that outcome - the exact defect, restored, with a green
     suite over it. Each constant is read off the file and required here. */
  [['SAVENAMED_NOT_SENT', "var SAVENAMED_NOT_SENT = '"],
    ['WFATT_REFUSED', "var WFATT_REFUSED = '"],
    ['WFATT_CHECK_TIMEOUT', "var WFATT_CHECK_TIMEOUT = '"],
    ['WFATT_WRITE_TIMEOUT', "var WFATT_WRITE_TIMEOUT = '"],
    ['PULLSHIELD_NOT_ATTEMPTED', "var PULLSHIELD_NOT_ATTEMPTED = '"]].forEach(function (c) {
    const at = FLOW.indexOf(c[1]);
    ok(at > 0, c[0] + ' no longer exists, so the outcome column has an un-named status');
    const value = FLOW.slice(at + c[1].length, FLOW.indexOf("'", at + c[1].length));
    ok(block.indexOf("'" + value + "': 1") > 0 || block.indexOf(value.replace(/'/g, '') + ': 1') > 0,
      c[0] + ' = "' + value + '" is not in the table of outcomes that owe the doctor a control, so that row is a label with nothing to press again');
  });
  ok(block.indexOf('blocked: 1') > 0 && block.indexOf('manual: 1') > 0,
    'BLOCKED or MANUAL dropped out of the table of outcomes that owe the doctor a control');
  /* ...and an UNCERTAIN outcome deliberately gets none: a partial mutation is
     inspected in Athena, never retried from a button MLS put there. */
  eq(block.indexOf('uncertain: 1'), -1,
    'an UNCERTAIN outcome - a partial mutation - was given a one-press retry control');
}

/* ================================================ 4. THE WRITE PATH IS OFF-LIMITS */
{
  /* This lane touched exactly two of the six SHA-pinned write-path regions,
     and in both it changed ONE painted word. Prove the behaviour in them is
     the behaviour they had: the halt still fires, and it still fires on the
     same condition. (The digests themselves are re-aimed by the derive lane;
     these are the facts the digests were protecting.) */
  const mint = slice('  function resultToUnifiedReceipt(state, row, resp, probe) {', '  /* ===== wfprog-1.0.0 (owner 2026-08-27:', 'receipt mint');
  ok(mint.indexOf('Inspect the Orders workspace before retrying; this review is halted.') > 0,
    'the order halt lost its sentence');
  ok(mint.indexOf("status = 'uncertain'") > 0 && mint.indexOf("status = 'blocked'") > 0,
    'the receipt mint lost one of its verdicts');
  const exec = slice('  function executeUnifiedSelection(state) {', '  /* bx-1.0.0 - batch send (owner 2026-08-26:', 'execute');
  ok(exec.indexOf("(state.halted ? ' This review is halted because the outcome is uncertain.' : ' No other action ran automatically.')") > 0,
    'the execute path\'s halt sentence no longer hangs off state.halted');
  ok(exec.indexOf('ATHENA_EXECUTABLE_ACTIONS') > 0 || FLOW.indexOf('var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true };') > 0,
    'the closed executable-action allowlist was rewritten');
  ok(FLOW.indexOf('var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };') > 0,
    'the batch lane\'s closed allowlist was rewritten');
}

console.log('PASS write row controls: the review sheet speaks the doctor\'s words, every BLOCKED / MANUAL / NOT SENT row carries its own next move, the drawer holding them ships open, and not one of those controls can send (' + checks + ' checks)');
