'use strict';
/* ============================================================================
   qol-off-lane-never-crashes

   ORIGINAL CHARTER (kept): the Full-visit-notes OFF lane must reach its
   terminal verdict on every path - no undeclared identifier, no unfenced
   async pass, no early return that strands finalizeVerdict().

   CONTRACT CHANGE THAT MOVED THE OLD PINS
   ---------------------------------------
   dayfacts-1.0.0 - superseding owner DAY contract, 2026-08-25 (Codex-accepted).
   The Full-visit-notes checkbox now means "ALL historical visit notes", NEVER
   "whether any chart opens".

     OFF (settled)  = day-facts mode. The per-patient history batch RUNS. Every
                      exact scheduled row still gets its identity-verified chart
                      open + chart-facts save (the pipelined-parse branch) and
                      exactly the pulled-day encounter-note attempt; only the
                      OTHER dated historical bodies are skipped
                      (one.visitsSkipped = true). Receipt: visitNotesMode
                      'day-facts', chartFactsRequired true,
                      allVisitBodiesRequested false, plus honest insurance
                      placeholders (insuranceAttempted 0, insuranceReason
                      'reader-not-shipped').
     ON             = the same mandatory floor plus full historical traversal
                      (visitNotesMode 'full').
     UNSET          = fail-closed. Blocked receipt, reason
                      'visit-notes-unchosen', visitNotesMode
                      'blocked-unchosen', zero reads.

   The old 'visit-notes-off' schedule-only no-op is REMOVED and must not be
   reasserted. pullUnlocked's includeHistory now means "run the batch at all"
   (only the census phase-1 caller passes false); dayPull defaults it to TRUE;
   pullMonth no longer forces it false on OFF. No user-facing message may claim
   OFF opens no charts.

   This suite therefore no longer pins "OFF never enters a chart lane". It pins
   the day-facts floor, the unchosen block, the removal of the retired no-op,
   and - unchanged - that the OFF lane still cannot strand its verdict.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- 1. The batch door is now a TRI-STATE admission, not an ON test ------- */
assert.ok(si.includes('var batchChoiceAdmitted = safe(function () {'),
  'the dayfacts-1.0.0 tri-state batch admission door is missing');
assert.ok(si.includes('return !!(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"));'),
  'the batch door no longer admits a SETTLED off - OFF must reach day-facts mode');
assert.ok(si.includes('if (!batchChoiceAdmitted) {'),
  'the batch no longer fails closed on an unsettled Full-visit-notes choice');
assert.ok(si.includes('receipt.reason = "visit-notes-unchosen";') &&
          si.includes('receipt.visitNotesMode = "blocked-unchosen";'),
  'an UNCHOSEN account must be blocked with visit-notes-unchosen / blocked-unchosen');

/* ---- 2. The retired OFF schedule-only no-op must NOT come back ------------ */
assert.ok(!si.includes('if (!visitNotesRequested) {'),
  'the removed OFF early-return (schedule-only no-op) was reasserted in the batch');
assert.ok(!si.includes('receipt.reason = "visit-notes-off";'),
  'the batch receipt reasserted the retired "visit-notes-off" schedule-only verdict');

/* ---- 3. The day-facts receipt is honest about what OFF actually does ------ */
assert.ok(si.includes('var chartFactsRequired = true;'),
  'the always-true mandatory chart-facts floor is gone');
assert.ok(si.includes('var allVisitBodiesRequested = visitNotesRequested;'),
  'the checkbox is no longer carried separately as allVisitBodiesRequested');
assert.ok(si.includes('visitNotesMode: visitNotesRequested ? "full" : "day-facts"'),
  'OFF no longer reports visitNotesMode "day-facts" on the batch receipt');
assert.ok(si.includes('chartFactsRequired: chartFactsRequired') &&
          si.includes('allVisitBodiesRequested: allVisitBodiesRequested'),
  'the batch receipt dropped the chartFactsRequired / allVisitBodiesRequested pair');
assert.ok(si.includes('insuranceAttempted: 0') && si.includes('insuranceReason: "reader-not-shipped"'),
  'the honest insurance placeholder is gone - a missing reader must never read as verified-none');

/* ---- 4. OFF really does open the chart and save the facts ----------------- */
assert.ok(/if \(!stopAfterTimeout && pullVisitBodies !== true\) \{[\s\S]{0,900}?launchPipelinedParse\(/.test(si),
  'the OFF branch of the chart loop no longer launches the pipelined chart-facts parse');
assert.ok(si.includes('one.visitsSkipped = true;'),
  'OFF rows no longer record visitsSkipped - the day-facts scope became unreadable');
assert.ok(si.indexOf('if (!batchChoiceAdmitted) {') < si.indexOf('launchPipelinedParse('),
  'the only pre-loop door left must be the unchosen block, ahead of the chart work');

/* ---- 5. includeHistory is decoupled from the checkbox --------------------- */
assert.ok(!si.includes('var includeHistory = visitNotesRequested === true'),
  'pullUnlocked still ties includeHistory to the checkbox - OFF would skip the batch');
assert.ok(si.includes('var includeHistory = opts.includeHistory !== false;'),
  'pullUnlocked lost the caller-only includeHistory opt-out');
assert.ok(si.includes('if (runOpts.includeHistory === undefined) runOpts.includeHistory = true;'),
  'dayPull no longer defaults includeHistory to TRUE (the mandatory day-facts floor)');
assert.ok(!si.includes('&& !monthFullNotesOff'),
  'pullMonth still forces includeHistory=false on an OFF month');
assert.ok(si.includes('var historySkipReason = p1CensusHistoryDeferred ? "provider-attribution-unavailable" : "not-requested";'),
  'the history skip reason still carries an OFF branch');
assert.ok(si.includes('var historyReceipt = includeHistory') && !si.includes('!fullNotesOff && includeHistory'),
  'the history batch is still gated on fullNotesOff');
assert.ok(si.includes('visitNotesMode: fullNotesOff ? "day-facts"'),
  'the skipped-history stub still labels OFF "not-requested" instead of "day-facts"');

/* ---- 6. No surface may claim OFF opens no charts -------------------------- */
[['feat_mls_schedimport_exact.js', si], ['mls-connect.js', connect], ['ScribeFlow.html', shell]].forEach(function (pair) {
  assert.ok(!/no patient charts or visit notes were opened/.test(pair[1]),
    pair[0] + ' still tells the doctor that OFF opens no charts');
});
assert.ok(si.includes('Full visit notes is off - each day saved chart facts and attempted only its own pulled-day note; no other historical bodies were read.'),
  'the month-complete OFF message no longer states the day-facts truth');

/* ---- 7. The reader half of the pulled-day note admits a settled OFF ------- */
assert.ok(!connect.includes("if (!enabled()) return Promise.resolve({ ok: true, skipped: 'preference-off' });"),
  'runForPatient still refuses every read when the preference is off');
assert.ok(connect.includes("var dayScoped = !!(runOpts && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(runOpts.onlyDate || '')));"),
  'runForPatient lost the well-formed onlyDate scoping test');
assert.ok(connect.includes("if (!enabled() && !(dayScoped && choiceSettled)) return Promise.resolve({ ok: true, skipped: choiceSettled ? 'preference-off' : 'preference-unchosen' });"),
  'runForPatient no longer admits a day-scoped read on a SETTLED preference, or lost the unchosen skip code');

/* ---- 8. ORIGINAL CHARTER: the OFF lane still cannot strand its verdict ---- */
const tailIdx = si.indexOf('if (pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped) {');
assert.ok(tailIdx > 0,
  'the tn/onlyDate tail pass that selects the visits-skipped (OFF) rows was deleted');
const fenceIdx = si.indexOf('\n      try {', tailIdx);
assert.ok(fenceIdx > tailIdx && fenceIdx - tailIdx < 1400,
  'the day-note tail pass lost its try/catch fence - a throw there strands finalizeVerdict()');
assert.ok(si.indexOf('finalizeVerdict();') > tailIdx,
  'the terminal history verdict is no longer reachable after the day-note tail pass');

/* ============================================================================
   TODO - dayfacts-1.0.0 ENGINE GAP, reported not forced green.
   The contract says day-facts mode "attempts exactly the pulled-day encounter
   note per row" via the tn/onlyDate tail pass. The engine does NOT do that yet:

     feat_mls_schedimport_exact.js:6188  var pulledDayNoteTailEnabled = false;
     feat_mls_schedimport_exact.js:5614  var pulledDayNoteLaneEnabled = false;

   Both flags are hard-coded false literals, so the gate on line 6189
   (`pulledDayNoteTailEnabled && pullVisitBodies !== true`) is dead and no OFF
   row ever reaches tnBoundedRead - even though the reader half (section 7
   above) now admits the day-scoped read. Three accounting seams would also
   have to move with the flag, since all three still test the CHECKBOX:
     5790  tnAggregate      - `if (receipt.visitNotesRequested !== true)` zeroes
                              the whole day-note census for a day-facts pull
     5884  tnDeferRow       - same test, so no day-facts row can be deferred
     7080  niSyncFromReceipt- same test, so the idle backfill never sees them
   and two more surfaces still reassert the retired schedule-only meaning:
     6169-6172 the stop path stamps every OFF row todayNoteReason
               "visit-notes-off" / todayNoteSkipped "visit-notes-off"
     7688-7694 retryFailedHistory refuses OFF retry rows outright with
               reason "full-notes-off", visitNotesMode "not-requested" - so a
               day-facts chart-facts row that FAILED cannot be retried at all.

   The assertions in section 8 are therefore deliberately NARROWED to what is
   honestly true today: the tail-pass machinery still exists, still selects the
   OFF rows, and still cannot strand the verdict. When the engine wires the
   flag, replace section 8's first pin with the real contract pin - that the
   tail pass is ENTERED in day-facts mode - e.g.
     assert.ok(!/var pulledDayNoteTailEnabled = false;/.test(si), ...)
   plus a positive pin on the day-facts entry condition.
   ========================================================================== */

console.log('qol-off-lane-never-crashes: OK (dayfacts-1.0.0 — OFF is day-facts: the batch runs, charts open, facts save, historical bodies are skipped; UNCHOSEN blocks everything; the OFF lane still reaches finalizeVerdict. Day-note tail pass remains a documented engine gap.)');
