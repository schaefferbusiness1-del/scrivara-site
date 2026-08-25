'use strict';
/* =============================================================================
 * site-full-notes-host-contract.test.js
 *
 * ===== CONTRACT: dayfacts-1.0.1 (owner 2026-08-25, Codex-accepted) ===========
 * Every OFF pin in this suite moved on 2026-08-25. The Full-visit-notes
 * checkbox used to decide WHETHER a chart opened; it now decides only HOW MUCH
 * history a bulk pull traverses. The old "Full Notes OFF = schedule/booking
 * only, zero chart reads, receipt reason 'visit-notes-off'" truths this file
 * used to pin are REVOKED and must never be reasserted.
 *
 * dayfacts-1.0.1 closed four of the six gaps the 1.0.0 pass had to leave as
 * narrowed pins, so this file no longer tolerates them - it PROVES them:
 *   - both pulled-day-note lanes (inline fold-in + tn/onlyDate tail) are live,
 *     so a day-facts row must show exactly ONE onlyDate runForPatient call and
 *     the receipt must count it (was gap-1);
 *   - the public result envelope says 'day-facts' at every level, never the
 *     revoked 'not-requested' (was gap-2);
 *   - the month-complete OFF sentence's "attempted only its own pulled-day
 *     note" clause is now true and is checked against the receipts (gap-3);
 *   - the day-completion mapper reports the chart work an OFF pull did instead
 *     of suppressing the history line (was gap-5);
 *   - pullCalendarSelection no longer ANDs the checkbox into includeHistory,
 *     so an OFF Calendar pull runs the mandatory batch (was gap-6).
 * What it pins now:
 *
 *   - OFF (settled) is DAY-FACTS mode: the per-patient batch RUNS, every exact
 *     scheduled row gets its identity-verified chart open + chart-facts save,
 *     historical visit bodies are skipped (one.visitsSkipped), and the receipt
 *     says visitNotesMode 'day-facts' / chartFactsRequired true /
 *     allVisitBodiesRequested false, with honest insurance placeholders
 *     (insuranceAttempted 0, insuranceReason 'reader-not-shipped').
 *   - ON is that same mandatory floor PLUS the unscoped historical body walk
 *     (visitNotesMode 'full'), one AllVisits request per patient, never
 *     date-scoped.
 *   - UNSET/unsettled is fail-closed at BOTH doors: the public admission gate
 *     refuses before schedule/navigation/chart work, and the _runHistoryBatch
 *     compatibility seam returns reason 'visit-notes-unchosen' /
 *     visitNotesMode 'blocked-unchosen' with zero reads.
 *   - includeHistory is decoupled from the checkbox: it now means "run the
 *     batch at all", and only the census phase-1 caller passes false.
 *
 * It still pins the first-use admission/freeze seam for every public
 * day/month/range entry, relay/resume transport of the frozen boolean, and
 * doctor-facing status sanitization. Synthetic patients only; no network,
 * browser or Athena.
 *
 * ===== 2026-08-25 round 3: ZERO gaps remain open ============================
 * The four gaps this file carried as TODO tripwires against dayfacts-1.0.1
 * (gap-4, gap-A, gap-B, gap-C) all closed in the final 1.0.1 engine. Every
 * tripwire fired as designed, so none could rot, and each has been replaced by
 * the POSITIVE pin it prescribed - source pin plus runtime proof:
 *   - gap-4: the three doctor-facing "OFF opens no chart/history" strings
 *     (guided tour, day-strip tooltip, Settings toast) were rewritten to the
 *     truth the engine performs. All three are pinned on the surface they ship
 *     from, and the revoked schedule-only vocabulary is banned from all three
 *     loaded surfaces at once.
 *   - gap-A: tnDeferRow's guard lost the checkbox term, so a day-facts row
 *     whose mandatory note refuses for a guaranteed-transient reason QUEUES for
 *     recovery. Proved by the deferrable-refusal fixture: 2 queued, 0 finally
 *     unread, both rows marked deferred.
 *   - gap-B: niSyncFromReceipt's checkbox early return is gone, so the
 *     persistent idle backfill learns about a day-facts pull's unread notes.
 *     Proved by the same A/B, now symmetric (1 enqueued in BOTH modes), while
 *     rows the immediate deferred round still owns stay out of that queue.
 *   - gap-C: niRunOne's four dead comparisons moved to 'visit-notes-unchosen',
 *     so an unchosen account PAUSES and stops its tick timer instead of
 *     re-polling a gate that can only refuse. Proved through timerKind, with a
 *     mutation control that the timer was armed before the tick.
 * Also newly pinned this round: __mlsVisitSavePref.enabled() requires a SETTLED
 * choice (the unscoped door is no softer than the day-scoped one), and the
 * PERSISTED day-pull terminal receipt records an OFF day as 'day-facts'.
 * ============================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMonthHarness, flush } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const IMPORTER = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const RANGE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_rangejobs.js'), 'utf8');
const CONNECT = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
const VISITS = fs.readFileSync(path.join(ROOT, 'feat_visits.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function between(source, start, end, label) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  ok(from >= 0 && to > from, label + ': source boundary moved');
  return source.slice(from, to);
}

/* Only SHIPPED text can mislead a doctor; a block comment narrating the old
   contract cannot. This strips block comments so a copy ban can be aimed at the
   text that actually reaches a screen. The stripper is never trusted blind -
   every caller first proves that the copy it means to keep SURVIVES the strip,
   which is what catches a stripper that ate a shipped string instead. */
function shippedText(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
}

function publicAdmissionContracts() {
  const gate = between(IMPORTER,
    'function admitFrozenVisitNotesChoice(opts, owner) {',
    '/* ===== end fnc-1.0.0', 'shared public admission');
  ok(gate.includes('typeof opts.pullVisitBodies === "boolean"'),
    'the shared gate does not recognize an already-frozen boolean');
  ok(gate.includes('pref.ensureChosenForBulkPull()') &&
    gate.includes('frozen.pullVisitBodies = choice.on === true'),
    'the shared gate does not resolve and freeze the first-use choice');
  ok(gate.includes('return owner(frozen);'),
    'the admitted operation does not re-enter with the frozen options');

  [
    ['function pull(opts) {', 'var __monthOwned', 'day engine'],
    ['function pullMonth(opts) {', 'var month =', 'month engine'],
    ['function dayPull(opts) {', '/* fg-1.2', 'guarded day engine']
  ].forEach(([start, end, label]) => {
    const head = between(IMPORTER, start, end, label + ' admission head');
    ok(head.includes('admitFrozenVisitNotesChoice(opts,'),
      label + ' can start without the shared first-use admission');
    ok(head.indexOf('admitFrozenVisitNotesChoice') < head.lastIndexOf('return __visitNotesAdmission'),
      label + ' admission does not return before engine work');
  });

  const rangeHead = between(RANGE, 'function start(kind, value, opts) {',
    'function resume(opts) {', 'durable range admission');
  ok(rangeHead.includes('admitRangeVisitNotesChoice(kind, parsed.target, parsed.opts)'),
    'direct range starts can still manufacture a mode before first-use choice');
  ok(rangeHead.indexOf('admitRangeVisitNotesChoice') < rangeHead.indexOf('lockApi()'),
    'range admission happens after lock/provider/manifest work');
  const rangeGate = between(RANGE, 'function admitRangeVisitNotesChoice(',
    'function start(kind, value, opts) {', 'range freeze helper');
  ok(rangeGate.includes('normalized.pullVisitBodies = explicit') &&
    rangeGate.includes('normalized.fullNotes = explicit') &&
    rangeGate.includes('frozen.pullVisitBodies = choice.on === true') &&
    rangeGate.includes('frozen.fullNotes = choice.on === true'),
    'range choice is not frozen into both durable compatibility fields');

  /* These are the still-loaded alternate owners found by the audit. They may
     omit a boolean, but none may bypass the now-gated public methods. */
  const alternate = [
    ['feat_mls_patientpick.js', /__mlsSI\.pull\s*\(/],
    ['feat_mls_simple_exact.js', /__mlsSI\.pull\s*\(/],
    ['feat_mls_assistant_exact.js', /\bSI\.pull\s*\(/],
    ['feat_mls_asst_fix.js', /\bsi\.pull(?:Month)?\s*\(/i],
    ['feat_mls_copilot_power.js', /\bsi\.dayPull\s*\(/],
    ['feat_mls_calpro.js', /\bsi\.pullMonth\s*\(/],
    ['1p-feat_mls_legalpack.js', /\bsi\.dayPull\s*\(/],
    ['1p-mls-connect.js', /\bexact\.pullMonth\s*\(/]
  ];
  alternate.forEach(([file, call]) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    ok(call.test(source), file + ' no longer contains the audited public pull entry');
    ok(!/\._runHistoryBatch\s*\(|\bpullUnlocked\s*\(/.test(source),
      file + ' bypasses the public admission boundary');
  });
}

/* ===== dayfacts-1.0.0: the batch door is gated on ADMISSION, not on OFF ==== */
function batchDoorContracts() {
  ok(IMPORTER.includes('var batchChoiceAdmitted = safe(function () {') &&
    IMPORTER.includes('return !!(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"));'),
    'the batch door no longer resolves a SETTLED tri-state before opening a chart');
  ok(IMPORTER.includes('if (!batchChoiceAdmitted) {') &&
    IMPORTER.includes('receipt.reason = "visit-notes-unchosen";') &&
    IMPORTER.includes('receipt.visitNotesMode = "blocked-unchosen";'),
    'the unchosen fail-closed refusal is missing from the _runHistoryBatch seam');
  /* The revoked contract must not creep back: OFF is no longer an early
     return, and "visit-notes-off" is no longer a batch-level receipt reason. */
  ok(!IMPORTER.includes('if (!visitNotesRequested) {'),
    'the removed schedule-only OFF early-return has been reasserted at the batch door');
  ok(!IMPORTER.includes('receipt.reason = "visit-notes-off";'),
    'the revoked "visit-notes-off" batch receipt reason has been reasserted');

  /* The mandatory floor and the honest insurance placeholders are built into
     the receipt literal, so no code path can forget to declare them. */
  ok(IMPORTER.includes('var chartFactsRequired = true;') &&
    IMPORTER.includes('var allVisitBodiesRequested = visitNotesRequested;'),
    'the always-true chart-facts floor and checkbox-scoped body flag are gone');
  ok(IMPORTER.includes('visitNotesMode: visitNotesRequested ? "full" : "day-facts", chartFactsRequired: chartFactsRequired, allVisitBodiesRequested: allVisitBodiesRequested, insuranceAttempted: 0, insuranceComplete: false, benefitsComplete: false, insuranceReason: "reader-not-shipped"'),
    'the batch receipt no longer declares day-facts mode, the chart-facts floor and honest insurance placeholders');

  /* includeHistory now means "run the batch at all". Only the census phase-1
     caller may pass false; the checkbox may not close the phase. */
  ok(/var includeHistory = opts\.includeHistory !== false;\r?\n/.test(IMPORTER),
    'the day engine still ANDs the Full Notes checkbox into includeHistory');
  ok(!IMPORTER.includes('visitNotesRequested === true && opts.includeHistory !== false && !fullNotesOff'),
    'the revoked ON-only includeHistory gate has been reasserted in the day engine');
  ok(IMPORTER.includes('var includeHistory = opts.includeHistory !== false; /* dayfacts-1.0.0'),
    'the month engine still forces includeHistory=false on an OFF month');
  ok(!IMPORTER.includes('opts.includeHistory !== false && !monthFullNotesOff'),
    'the revoked monthFullNotesOff includeHistory gate has been reasserted');
  ok(IMPORTER.includes('if (runOpts.includeHistory === undefined) runOpts.includeHistory = true;'),
    'dayPull no longer defaults includeHistory to TRUE (the mandatory floor would not run)');
  ok(!IMPORTER.includes('if (runOpts.includeHistory === undefined) runOpts.includeHistory = false;'),
    'the revoked dayPull includeHistory=false default has been reasserted');
  ok(IMPORTER.includes('var historyReceipt = includeHistory') &&
    !IMPORTER.includes('var historyReceipt = (!fullNotesOff && includeHistory)'),
    'the day pull still lets fullNotesOff close the whole chart/history phase');
  ok(IMPORTER.includes('var historySkipReason = p1CensusHistoryDeferred ? "provider-attribution-unavailable" : "not-requested";'),
    'the skip reason still carries the revoked full-notes-off vocabulary');

  /* dayfacts-1.0.1 closed gap-6: the Calendar door was the last public entry
     still ANDing the checkbox into includeHistory. Because includeHistory now
     means "run the batch at all", an explicit-OFF Calendar pull used to pass
     includeHistory:false into pull() and skip the whole mandatory day-facts
     floor - the exact schedule-only behaviour the contract revoked. */
  ok(!IMPORTER.includes('calendarPullVisitBodies !== false'),
    'pullCalendarSelection still ANDs the Full Notes checkbox into includeHistory');
  const calendarDoor = between(IMPORTER, 'function pullCalendarSelection(opts) {',
    'function revert() {', 'calendar selection door');
  ok(/var includeHistory = opts\.includeHistory !== false; \/\* dayfacts-1\.0\.1/.test(calendarDoor),
    'the calendar-selection includeHistory line no longer declares the decoupled day-facts default');
  ok(calendarDoor.includes('includeHistory: includeHistory, pullVisitBodies: calendarPullVisitBodies'),
    'the calendar route no longer forwards its own frozen boolean beside the decoupled phase flag');

  /* ===== dayfacts-1.0.1 closed gap-1: BOTH pulled-day-note lanes are live ===
     The mandatory pulled-day note is what makes day-facts a NOTE mode and not
     just a chart-facts mode, so the two lane switches and the census that
     tallies them are pinned ON here. A re-disabling trips before a single
     runtime row is walked; the runtime proof of the actual reads lives in
     dayFactsOffDayPull / dayFactsOffMonth / unchosenIsFailClosed. */
  ok(IMPORTER.includes('var pulledDayNoteLaneEnabled = true;') &&
    !IMPORTER.includes('var pulledDayNoteLaneEnabled = false;'),
    'the inline pulled-day-note fold-in has been hard-disabled again');
  ok(IMPORTER.includes('if (pulledDayNoteLaneEnabled && !stopAfterTimeout && pullVisitBodies !== true && one.visitsSkipped === true && rd && !inlineDayNoteFuse) {'),
    'the inline fold-in no longer runs exactly the day-facts visits-skipped rows whose chart just verified');
  ok(IMPORTER.includes('var pulledDayNoteTailEnabled = true;') &&
    !IMPORTER.includes('var pulledDayNoteTailEnabled = false;'),
    'the tn/onlyDate pulled-day-note tail pass has been hard-disabled again');
  ok(IMPORTER.includes('if (pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped) {'),
    'the tail pass no longer runs in day-facts mode for a pull the doctor did not stop');

  const census = between(IMPORTER, 'function tnAggregate() {', 'function tnBatchDay() {',
    'day-note census');
  ok(census.includes('receipt.todayNoteNotRequested = 0;'),
    'the day-note census no longer declares day-facts rows as requested work');
  ok(!census.includes('receipt.visitNotesRequested'),
    'the revoked checkbox short-circuit is back in the day-note census');
  ok(census.includes('receipt.todayNoteRead = tnRead;') &&
    census.includes('receipt.todayNoteFailures = tnF;'),
    'the day-note census stopped publishing the per-row read/failure tally both modes now need');

  /* dayfacts-1.0.1 item 4: a STOPPED row's pulled-day note is honestly
     "stopped before it was reached" in BOTH modes - the stamp may never carry
     the revoked schedule-only vocabulary again. */
  const stopStamp = between(IMPORTER, 'var __stpStopped = receipt.stoppedByUser === true',
    'var pulledDayNoteTailEnabled = true;', 'stop-path day-note stamp');
  ok(stopStamp.includes('p.todayNoteReason = "stopped-by-user";'),
    'a stopped day-facts row is not stamped stopped-by-user');
  ok(!/"visit-notes-off"|"full-notes-off"/.test(stopStamp),
    'the revoked visit-notes-off stamp vocabulary is back on the stop path');

  /* dayfacts-1.0.1 item 5: the retry round no longer refuses an OFF receipt
     wholesale; it re-runs those rows in day-facts mode, and the frozen
     override still scopes BODIES to the receipt's own mode. */
  const retryHead = between(IMPORTER, 'function retryFailedHistory(source, onStatus) {',
    'function retryBusy(scope) {', 'retry-failed-history head');
  ok(retryHead.includes('var retryBodiesRequested = typeof history.visitNotesRequested === "boolean"'),
    'the retry round no longer scopes the historical body walk to the receipt own frozen mode');
  ok(!/full-notes-off|visit-notes-off/.test(retryHead),
    'the revoked wholesale OFF retry refusal has been reasserted in retryFailedHistory');
  ok(!IMPORTER.includes('full-notes-off'),
    'the revoked full-notes-off vocabulary is back anywhere in the day engine');

  /* dayfacts-1.0.1 item 6: 'not-requested' is no longer a MODE an OFF pull can
     report - only a history SKIP reason (census phase-1 / caller opt-out). */
  ok(IMPORTER.includes('res.visitNotesMode = fullNotesOff ? "day-facts" :'),
    'the public day result no longer maps an OFF pull to day-facts mode');
  ok(IMPORTER.includes('visitNotesMode: fullNotesOff ? "day-facts" : (visitNotesRequested === true ? "full" : "unspecified")'),
    'a day-level envelope no longer maps an OFF pull to day-facts mode');
  ok(IMPORTER.includes('visitNotesMode: monthFullNotesOff ? "day-facts" : (monthPullVisitBodies === true ? "full" : "unspecified")'),
    'the month envelope no longer maps an OFF month to day-facts mode');
  ok(!/visitNotesMode(?::| =) [A-Za-z]*[Ff]ullNotesOff \? "not-requested"/.test(IMPORTER),
    'the revoked "not-requested" visit-notes MODE has been reasserted in a result envelope');

  ok(VISITS.includes("'mlsAppReadAllVisits'") &&
    VISITS.includes("onlyDate: String(runOpts.onlyDate || '')"),
    'the scoped reader no longer transports hint.onlyDate for the pulled-day note');
}

function transportAndShapeContracts() {
  ok(CONNECT.includes("if (typeof pl.pullVisitBodies === 'boolean') opts.pullVisitBodies = pl.pullVisitBodies"),
    'relay runner can lose the requesting device boolean');
  ok(CONNECT.includes("if (typeof _bv === 'boolean') jobPayload.pullVisitBodies = _bv"),
    'relay sender can omit its frozen boolean');
  ok(CONNECT.includes("jobPayload.pullVisitBodies === true ? '1' : (jobPayload.pullVisitBodies === false ? '0' : 'u')"),
    'relay dedupe identity no longer includes the boolean mode');
  ok(IMPORTER.includes("bodies: (typeof opts.pullVisitBodies === \"boolean\") ? opts.pullVisitBodies : null") &&
    IMPORTER.includes("if (typeof rec.bodies === 'boolean') resumeOpts.pullVisitBodies = rec.bodies"),
    'day resume no longer preserves the frozen boolean');
  ok(RANGE.includes('pullVisitBodies: manifest.options.fullNotes === true'),
    'durable month/year resume no longer emits an explicit boolean per month');

  /* dayfacts-1.0.0: the site-side scoped reader must admit an exact-day read in
     BOTH settled modes - that read IS the mandatory pulled-day note - while an
     unscoped read stays bound by the preference and an UNSET account is
     skipped as 'preference-unchosen' rather than silently treated as OFF. */
  ok(CONNECT.includes('var dayScoped = !!(runOpts && ') &&
    CONNECT.includes("/^\\d{4}-\\d{2}-\\d{2}$/.test(String(runOpts.onlyDate || ''))"),
    'the scoped reader no longer recognizes a well-formed onlyDate day read');
  ok(CONNECT.includes('var choiceSettled = (function () {') &&
    CONNECT.includes("return !!(c && c.settled === true && (c.state === 'on' || c.state === 'off'));"),
    'the scoped reader no longer distinguishes a SETTLED choice from an unset one');
  ok(CONNECT.includes("if (!enabled() && !(dayScoped && choiceSettled)) return Promise.resolve({ ok: true, skipped: choiceSettled ? 'preference-off' : 'preference-unchosen' });"),
    'the scoped reader admission no longer matches the dayfacts-1.0.0 three-way outcome');
  ok(!CONNECT.includes("if (!enabled()) return Promise.resolve({ ok: true, skipped: 'preference-off' });"),
    'the revoked hard preference boundary has been reasserted on the scoped reader');

  /* dayfacts-1.0.1 (round 3): the UNSCOPED historical-body door may never be
     SOFTER than the day-scoped one it sits beside. The scoped read demands
     choice.settled before admitting an exact-day note, so enabled() - which
     opens the far more expensive full walk - demands it too: a provisional or
     placeholder-namespace 'on' that the doctor never confirmed is not an
     admitted choice at either door. */
  ok(CONNECT.includes("return !!(choice && choice.settled === true && choice.state === 'on' && choice.on === true);"),
    'the unscoped historical-body door admits an unsettled "on" the day-scoped door would refuse');
  ok(!/return !!\(choice && choice\.state === 'on' && choice\.on === true\);/.test(CONNECT),
    'the revoked settled-blind enabled() has been reasserted on the unscoped door');

  /* No user-facing message may claim OFF opens no charts. The day/month
     "Full Notes is off, so no patient charts or visit notes were opened."
     sentence is gone from the engine, and the month-complete OFF wording now
     names the chart-facts save. */
  ok(!IMPORTER.includes('Full Notes is off, so no patient charts or visit notes were opened.'),
    'the revoked "no patient charts were opened" completion claim is back in the engine');
  ok(IMPORTER.includes('Full visit notes is off - each day saved chart facts'),
    'the month-complete OFF message no longer names the chart-facts save it performed');

  /* dayfacts-1.0.1 closed gap-5: the day-completion mapper no longer treats a
     frozen-OFF choice as an intentionally-skipped history phase, so a
     day-facts pull that opened and saved N charts REPORTS them. Only a
     genuinely skipped batch (census phase-1 / caller opt-out) suppresses the
     history line now. */
  ok(!CONNECT.includes('var historyIntentionallySkipped = hr.visitNotesRequested === false'),
    'the revoked visitNotesRequested-based history suppression is back in the day-completion mapper');
  ok(CONNECT.includes('var historyIntentionallySkipped = hr.skipped === true ||') &&
    CONNECT.includes('r.historyRequested === false || r.includeHistory === false;'),
    'the day-completion mapper no longer derives intentionally-skipped from the batch/caller alone');
  ok(CONNECT.includes('Historical visit notes were skipped by choice (Full visit notes is off); chart facts and each day') &&
    CONNECT.includes('own note were read.'),
    'the OFF day-completion message no longer names the chart facts and own-day note it actually read');
  ok(CONNECT.includes("? ('history read for ' + hist + ' of ' + rows + ' as the reader counted it')"),
    'the honest "history read for N of M" line is gone from the day-completion mapper');

  /* dayfacts-1.0.1 (round 3): the PERSISTED day-pull terminal receipt is the
     one copy of the verdict that outlives the tab, so it must speak the same
     vocabulary as every live level - an OFF day is 'day-facts', and the revoked
     'not-requested' MODE may not survive there after being purged everywhere
     else. ('not-requested' remains legal as a history SKIP reason.) */
  ok(CONNECT.includes("mode: requested === true ? 'full' : (hr.visitNotesMode === 'blocked-unchosen' ? 'blocked-unchosen' : (requested === false ? 'day-facts' : 'unknown'))"),
    'the persisted day-pull terminal receipt records a settled OFF day as day-facts AND keeps the fail-closed unchosen refusal in its own mode');
  ok(!CONNECT.includes("(requested === false ? 'not-requested'"),
    'the revoked "not-requested" visit-notes MODE is back in the persisted terminal receipt');

  /* The legacy _pullAllHistories wrapper is the one seam that genuinely cannot
     run the day-facts floor (the guarded engine owns that), so it still
     refuses - but the refusal is scoped to HISTORICAL bodies and may never
     claim OFF opens no charts. */
  ok(CONNECT.includes("reason: 'historical-bodies-not-requested', visitNotesRequested: false, historiesRequested: 0"),
    'the legacy history helper no longer refuses with the historical-bodies-only reason');
  ok(CONNECT.includes('this legacy history helper did not crawl historical encounter bodies'),
    'the legacy history helper no longer scopes its refusal to historical bodies');
  ok(!/reason: 'visit-notes-off', visitNotesRequested: false, historiesRequested/.test(CONNECT),
    'the revoked visit-notes-off reason is back on the legacy history helper');

  /* ===== gap-4 CLOSED (2026-08-25): the three doctor-facing strings ==========
     All three surfaces used to tell the doctor that OFF reads schedule rows
     only and opens no chart/history - a claim the contract forbids outright and
     the engine disproves on every OFF pull. Each has been rewritten to the
     truth (OFF = each scheduled chart's facts + that day's own note; ON adds
     every dated historical encounter note) and is now pinned POSITIVELY on the
     surface it actually ships from, so the honest wording cannot be quietly
     dropped and the revoked claim cannot creep back in its place.
     (Pinned in ASCII halves around the copy's typographic apostrophe, so a
     transport that mangles one character fails loudly rather than silently.) */
  ok(CONNECT.includes('chooses depth, not whether charts open') &&
    CONNECT.includes('s facts and its own-day note; ON adds every dated historical encounter note.'),
    'the guided-tour day-strip line no longer tells the doctor OFF still reads each chart and its own-day note');
  ok(CONNECT.includes('On: also save every dated historical encounter note (slower, stores more).') &&
    CONNECT.includes('s facts and its own-day note only (faster, stores less).'),
    'the day-strip Full-visit-notes tooltip no longer describes OFF as chart facts plus the own-day note');
  ok(SHELL.includes('Pulls will read each chart') &&
    SHELL.includes('s facts and its own-day note') &&
    SHELL.includes('historical visit notes are skipped.'),
    'the Settings OFF toast no longer names the chart facts and own-day note an OFF pull reads');

  /* The revoked vocabulary is banned from every loaded surface at once - the
     engine, the site glue and the shell - so it cannot reappear in whichever
     one the next copy edit happens to touch.

     The ban runs against SHIPPED text (block comments stripped), because the
     contract forbids telling the DOCTOR that OFF opens no charts, not narrating
     the revoked contract in a code comment. That distinction is load-bearing
     exactly once: 1pScribeFlow.html:10294 still carries a stale comment reading
     "unset resolves to the safe OFF view and opens no chart/history" - reported
     as an engine finding, not forced. Its literal claim about UNSET is true
     (unset does fail closed), but it calls that state "the safe OFF view", the
     precise conflation dayfacts-1.0.1 revoked.

     The three phrases that are clean even in RAW text are additionally banned
     there, so the comment carve-out is granted only where it is actually
     needed and cannot silently widen. */
  const surfaces = [['1p-feat_mls_schedimport_exact.js', IMPORTER],
    ['1p-mls-connect.js', CONNECT], ['1pScribeFlow.html', SHELL]];
  const revoked = [
    [/read schedule rows only/, 'the revoked "read schedule rows only" claim'],
    [/no patient chart or history is opened/, 'the revoked "no patient chart or history is opened" claim'],
    [/no patient charts or visit notes were opened/, 'the revoked "no patient charts were opened" completion claim']
  ];
  /* MUTATION CONTROL for the stripper: the copy pinned positively above must
     still be there AFTER comments are removed. If the strip ever eats shipped
     text, this fails here instead of turning the bans below into free passes. */
  const survives = [[CONNECT, 'chooses depth, not whether charts open'],
    [CONNECT, 'On: also save every dated historical encounter note (slower, stores more).'],
    [SHELL, 'Pulls will read each chart'], [SHELL, 'historical visit notes are skipped.'],
    [IMPORTER, 'Full visit notes is off - each day saved chart facts']];
  survives.forEach(([source, text]) => {
    ok(shippedText(source).includes(text),
      'the comment stripper ate shipped copy (' + text.slice(0, 40) + '), so the copy ban below is not measuring shipped text');
  });
  surfaces.forEach(([label, source]) => {
    const shipped = shippedText(source);
    ok(!/opens no chart\/history/.test(shipped),
      label + ' tells the doctor, in shipped text, that OFF opens no chart/history');
    revoked.forEach(([pattern, what]) => {
      ok(!pattern.test(shipped), label + ' has reasserted ' + what + ' in shipped text');
      ok(!pattern.test(source), label + ' has reasserted ' + what + ' anywhere in the file');
    });
  });
}

function installChoice(h, on, options = {}) {
  let ensureCalls = 0, readCalls = 0;
  h.rt.__mlsVisitNotesPref = {
    read() { readCalls++; return { state: options.poisonReadOn ? 'on' : 'off', on: !!options.poisonReadOn, settled: true }; },
    write: () => true,
    isPrefKey: () => false,
    ensureChosenForBulkPull() {
      ensureCalls++;
      if (options.refuse) return Promise.resolve({ ok: false, on: null, reason: options.refuse });
      return Promise.resolve({ ok: true, on: on === true, reason: 'synthetic-choice' });
    }
  };
  return { ensureCalls: () => ensureCalls, readCalls: () => readCalls };
}

/* the exact scheduled rows the batch seam takes, built from a seeded day */
function batchRowsFrom(seeded, date) {
  return seeded.map(r => ({
    _mlsTargetPatientId: r.patient_external_id, patient_external_id: r.patient_external_id,
    _mlsTargetDob: r.dob, _mlsTargetMrn: r.mrn,
    name: r.name, dob: r.dob, mrn: r.mrn,
    appointmentId: r.athenaAppointmentId, date: date, scheduleDate: date
  }));
}

async function dayFactsOffDayPull() {
  const day = '2026-08-23';
  /* Poison storage ON; the explicit OFF argument must still win without even
     consulting the first-use resolver. */
  const explicitOff = makeMonthHarness({ today: '2026-08-24' });
  explicitOff.seedDay(day, 2);
  const explicitGate = installChoice(explicitOff, true, { poisonReadOn: true });
  const explicitResult = await explicitOff.api.pull({
    date: day, provider: explicitOff.provider, includeHistory: true,
    pullVisitBodies: false, onStatus: explicitOff.onStatus
  });
  eq(explicitGate.ensureCalls(), 0, 'an explicit OFF operation reopened first-use admission');
  eq(explicitGate.readCalls(), 0, 'an explicit OFF operation reread poisoned storage');

  const hr = explicitResult.historyReceipt || {};
  /* THE flipped truth: day-facts mode is a chart pass, not a schedule-only
     no-op. Every exact scheduled row is opened and its facts saved. */
  eq(explicitOff.chartCalls.length, 2,
    'day-facts OFF did not open an identity-verified chart for every exact scheduled row');
  eq(hr.requested, 2, 'the day-facts batch did not request every scheduled row');
  eq(hr.processed, 2, 'the day-facts batch did not process every scheduled row');
  eq(hr.failures, 0, 'the day-facts batch reported failures on a clean synthetic day');
  eq(hr.complete, true, 'the day-facts batch did not complete');
  ok(hr.skipped !== true, 'the day-facts batch marked itself skipped');
  eq(hr.reason, 'complete', 'the day-facts batch did not finish as an ordinary complete run');
  eq(hr.visitNotesMode, 'day-facts',
    'the OFF history receipt does not declare day-facts mode');
  eq(hr.visitNotesRequested, false,
    'OFF history receipt did not carry the frozen visit-notes choice');
  eq(hr.chartFactsRequired, true,
    'the OFF history receipt does not declare the mandatory chart-facts floor');
  eq(hr.allVisitBodiesRequested, false,
    'the OFF history receipt claims the historical body walk was requested');
  /* honest insurance placeholders - a missing reader is never verified-none */
  eq(hr.insuranceAttempted, 0, 'day-facts claimed an insurance read attempt');
  eq(hr.insuranceReason, 'reader-not-shipped', 'day-facts did not declare the missing coverage reader');
  eq(hr.insuranceComplete, false, 'day-facts reported insurance as complete with no reader');
  eq(hr.benefitsComplete, false, 'day-facts reported benefits as complete with no reader');

  /* Historical bodies are the ONLY thing OFF drops. */
  eq(explicitOff.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'day-facts OFF emitted an unscoped historical AllVisits request');
  const rows = hr.patients || [];
  eq(rows.length, 2, 'the day-facts receipt lost a patient row');
  ok(rows.every(p => p && p.visitsSkipped === true),
    'day-facts did not mark historical visit traversal as skipped per row');
  ok(rows.every(p => p && p.complete === true),
    'a day-facts row that opened and saved its chart was not reported complete');

  /* dayfacts-1.0.1 closed gap-1: the mandatory pulled-day note is ATTEMPTED,
     exactly once per row, date-scoped to the day that was pulled, and counted.
     This is the pin that makes day-facts a note mode rather than a chart-facts
     mode, so it is now an exact "N of N", not a tolerance. */
  const scoped = explicitOff.noteCalls.filter(c => c && c.onlyDate === day);
  eq(explicitOff.noteCalls.length, scoped.length,
    'day-facts issued an unscoped call to the per-patient visit reader');
  eq(scoped.length, 2,
    'day-facts did not attempt exactly one pulled-day encounter note per scheduled row');
  eq(new Set(scoped.map(c => c.patientId)).size, 2,
    'the two pulled-day note attempts were not one per distinct patient');
  eq(Number(hr.todayNoteRead || 0), 2,
    'the day-facts receipt did not count the pulled-day notes the scoped reader read');
  eq(Number(hr.chartOpensDayNote || 0), 2,
    'the day-facts receipt did not charge one athena chart open per pulled-day note read');
  eq(Number(hr.todayNoteNotRequested || 0), 0,
    'a settled day-facts row was reported as a pulled-day note nobody requested');
  eq(Number(hr.todayNoteFailures || 0), 0,
    'day-facts invented a pulled-day note failure on a clean synthetic day');
  ok(rows.every(p => p && p.todayNote === true),
    'a day-facts row did not record its pulled-day note as read');
  ok(rows.every(p => p && Number(p.todayNoteAttempts || 0) === 1),
    'a day-facts row attempted its pulled-day note more or fewer than exactly once');
  /* the honesty invariant that survives the lane landing: every refused note is
     either queued for recovery or finally unread - never both, never neither. */
  eq(Number(hr.todayNoteFailures || 0),
    Number(hr.todayNoteQueued || 0) + Number(hr.todayNoteUnreadFinal || 0),
    'the day-facts pulled-day note tally does not add up (queued + final != failures)');

  /* the operation-level result must advertise that the phase ran */
  eq(explicitResult.includeHistory, true,
    'the OFF day pull still advertises no chart/history phase at the top level');
  eq(explicitResult.historyRequested, true,
    'the OFF day pull marked history as intentionally skipped');
  eq(explicitResult.visitNotesRequested, false,
    'the OFF day pull lost its frozen Full Notes choice at the top level');
  eq(explicitResult.complete, true, 'the clean synthetic day-facts day did not verify complete');
  /* dayfacts-1.0.1 closed gap-2: one vocabulary at every level. The public day
     result and its own authoritative historyReceipt must AGREE, and neither
     may report the revoked 'not-requested' mode. */
  eq(explicitResult.visitNotesMode, 'day-facts',
    'the OFF day pull does not report day-facts mode at the top level');
  eq(explicitResult.visitNotesMode, hr.visitNotesMode,
    'the public day result and its own history receipt disagree about the visit-notes mode');

  /* No doctor-facing line from this pull may claim OFF opened no charts, and
     the day now reports the chart work it actually did. */
  const said = explicitOff.statusLines.join(' | ');
  ok(!/no patient charts or visit notes were opened/i.test(said),
    'an OFF day pull still tells the doctor no patient charts were opened');
  ok(/history 2\/2/.test(said),
    'the OFF day pull did not report the chart history it actually read');
}

async function dayFactsOffMonth() {
  /* An omitted mode must be admitted once. The confirmed OFF choice stays
     frozen across both days even while read() lies ON. */
  const monthOff = makeMonthHarness({ today: '2026-08-24' });
  const dayA = '2026-08-21', dayB = '2026-08-22';
  monthOff.seedDay(dayA, 1); monthOff.seedDay(dayB, 1);
  const monthGate = installChoice(monthOff, false, { poisonReadOn: true });
  const monthResult = await monthOff.api.pullMonth({
    month: '2026-08', dates: [dayA, dayB], provider: monthOff.provider,
    includeHistory: true, onStatus: monthOff.onStatus
  });
  eq(monthGate.ensureCalls(), 1, 'month first-use choice was not resolved exactly once');
  eq(monthGate.readCalls(), 0, 'the admitted month reread mutable storage');
  eq(monthResult.includeHistory, true,
    'the admitted OFF month still closed the mandatory chart/facts phase');
  eq(monthResult.historyRequested, true,
    'the admitted OFF month still marked history as intentionally skipped');
  eq(monthResult.visitNotesRequested, false,
    'the admitted OFF month lost its frozen Full Notes choice at the top level');
  eq(monthResult.visitNotesMode, 'day-facts',
    'the admitted OFF month does not report day-facts mode at the top level');
  eq(monthOff.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'the admitted OFF month switched into an unscoped ON body walk');
  eq(monthOff.chartCalls.length, 2,
    'the admitted OFF month did not open a chart for every scheduled row of every day');
  eq(monthResult.days.length, 2,
    'the synthetic two-day month did not finish both frozen-mode days');
  const dayReceipts = monthResult.days.map(d => (d && d.receipt && d.receipt.historyReceipt) || {});
  eq(dayReceipts.filter(r => r.visitNotesMode === 'day-facts').length, 2,
    'the OFF month did not record day-facts mode for every day');
  eq(dayReceipts.filter(r => r.chartFactsRequired === true).length, 2,
    'the OFF month did not carry the mandatory chart-facts floor on every day');
  eq(dayReceipts.filter(r => r.allVisitBodiesRequested === false).length, 2,
    'an OFF month day claimed the historical body walk was requested');
  eq(dayReceipts.filter(r => Number(r.processed || 0) === 1 && Number(r.failures || 0) === 0).length, 2,
    'the OFF month did not process every day cleanly');
  /* the revoked receipt reason must never come back */
  eq(dayReceipts.filter(r => r.reason === 'full-notes-off').length, 0,
    'the revoked full-notes-off day receipt reason has been reasserted');
  eq(monthResult.complete, true, 'the clean synthetic day-facts month did not verify complete');

  const said = monthOff.statusLines.join(' | ');
  ok(!/no patient charts or visit notes were opened/i.test(said),
    'the OFF month still tells the doctor no patient charts were opened');
  ok(/each day saved chart facts/.test(said),
    'the month-complete OFF message no longer names the chart-facts save');
  /* dayfacts-1.0.1 closed gap-3: the same sentence claims each day "attempted
     only its own pulled-day note". That clause is now TRUE, and it is checked
     against the receipts rather than taken on the message's word: exactly one
     date-scoped attempt per row, scoped to that row's OWN day, and no unscoped
     reader call anywhere in the month. */
  ok(/attempted only its own pulled-day note/.test(said),
    'the month-complete OFF message no longer claims the pulled-day note attempt it now makes');
  eq(monthOff.noteCalls.length, 2,
    'the OFF month did not attempt exactly one pulled-day note per scheduled row');
  eq(monthOff.noteCalls.filter(c => c && c.onlyDate === dayA).length, 1,
    'the first OFF month day did not scope its pulled-day note to its own date');
  eq(monthOff.noteCalls.filter(c => c && c.onlyDate === dayB).length, 1,
    'the second OFF month day did not scope its pulled-day note to its own date');
  eq(monthOff.noteCalls.filter(c => c && !c.onlyDate).length, 0,
    'the OFF month issued an unscoped call to the per-patient visit reader');
  eq(dayReceipts.reduce((n, r) => n + Number(r.todayNoteRead || 0), 0), monthOff.noteCalls.length,
    'the month receipts do not account for exactly the pulled-day notes the scoped reader read');
  eq(dayReceipts.filter(r => Number(r.todayNoteRead || 0) === 1).length, 2,
    'an OFF month day did not record its own pulled-day note as read');
  eq(dayReceipts.reduce((n, r) => n + Number(r.todayNoteNotRequested || 0), 0), 0,
    'an OFF month day reported its mandatory pulled-day note as not requested');
  eq(dayReceipts.reduce((n, r) => n + Number(r.todayNoteFailures || 0), 0), 0,
    'the clean synthetic OFF month invented a pulled-day note failure');
}

async function fullNotesOnDay() {
  /* Confirmed ON is the opposite shape: the same mandatory chart floor PLUS
     one ordinary unscoped historical request per uncached patient, with no
     onlyDate field on those messages. */
  const day = '2026-08-23';
  const admittedOn = makeMonthHarness({ today: '2026-08-24' });
  admittedOn.seedDay(day, 2);
  const onGate = installChoice(admittedOn, true, { poisonReadOn: false });
  const onResult = await admittedOn.api.pull({ date: day, provider: admittedOn.provider,
    includeHistory: true, onStatus: admittedOn.onStatus });
  const unscoped = admittedOn.posted.filter(m => m.type === 'mlsAppReadAllVisits');
  eq(onGate.ensureCalls(), 1, 'omitted ON mode did not use first-use admission exactly once');
  eq(onGate.readCalls(), 0, 'admitted ON reread the opposite stored preference');
  eq(unscoped.length, 2, 'ON ordinary success did not emit one unscoped body walk per patient');
  ok(unscoped.every(m => !(m.hint && m.hint.onlyDate)),
    'an ON historical body walk was mislabeled as a date-scoped day-note read');
  eq(admittedOn.chartCalls.length, 2,
    'ON dropped the mandatory chart-facts floor it shares with day-facts');
  const hr = onResult.historyReceipt || {};
  eq(hr.visitNotesMode, 'full', 'the ON history receipt does not declare full mode');
  eq(hr.chartFactsRequired, true, 'ON does not carry the same mandatory chart-facts floor');
  eq(hr.allVisitBodiesRequested, true, 'ON did not request the historical body walk');
  eq(hr.insuranceAttempted, 0, 'ON claimed an insurance read attempt');
  eq(hr.insuranceReason, 'reader-not-shipped', 'ON did not declare the missing coverage reader');
  eq(onResult.visitNotesMode, 'full', 'the ON day pull lost full mode at the top level');
  /* ON's unscoped walk already carries the pulled-day body, so a second
     date-scoped re-open of the same chart would be pure waste. */
  eq(admittedOn.noteCalls.length, 0,
    'ON re-opened charts through the date-scoped reader its full walk already covers');
  /* and having skipped the scoped lane, ON may not INVENT a day-note verdict:
     no reads claimed, no failures claimed, no not-requested rows claimed. */
  eq(Number(hr.todayNoteRead || 0), 0,
    'ON claimed pulled-day notes read through a scoped reader it never called');
  eq(Number(hr.todayNoteFailures || 0), 0,
    'ON invented a pulled-day note failure it never attempted');
  eq(Number(hr.todayNoteNotRequested || 0), 0,
    'ON revived the not-requested day-note vocabulary outside the blocked-unchosen door');
}

async function unchosenIsFailClosed() {
  const day = '2026-08-23';
  /* Missing admission capability refuses before schedule, navigation or chart
     work. This is the fail-closed behavior for an unset/partially loaded site. */
  const unavailable = makeMonthHarness({ today: '2026-08-24' });
  unavailable.seedDay(day, 1);
  delete unavailable.rt.__mlsVisitNotesPref.ensureChosenForBulkPull;
  const refused = await unavailable.api.dayPull({ date: day, provider: unavailable.provider,
    includeHistory: true, onStatus: unavailable.onStatus });
  eq(refused.gate, 'visit-notes-choice', 'missing choice API did not fail at the admission gate');
  eq(unavailable.gotoDates.length, 0, 'refused first-use day pull navigated Athena');
  eq(unavailable.scheduleReads.length, 0, 'refused first-use day pull read the schedule');
  eq(unavailable.chartCalls.length, 0, 'refused first-use day pull opened a chart');

  /* dayfacts-1.0.0 replaces the old "OFF is a clean complete no-op" seam pin
     with its new-contract equivalent: the compatibility/test seam itself must
     fail CLOSED for an unsettled account - zero chart, body or day-note reads. */
  const unchosen = makeMonthHarness({ today: '2026-08-24' });
  const seeded = unchosen.seedDay(day, 2);
  unchosen.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: null, settled: false }),
    write: () => true, isPrefKey: () => false,
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, on: null, reason: 'unchosen' })
  };
  const blocked = await unchosen.api._runHistoryBatch(batchRowsFrom(seeded, day), [], () => {}, { scopeDay: day });
  eq(blocked.reason, 'visit-notes-unchosen',
    'an unsettled account did not get the blocked receipt reason');
  eq(blocked.visitNotesMode, 'blocked-unchosen',
    'an unsettled account did not get the blocked-unchosen mode');
  eq(blocked.requested, 0, 'the blocked receipt still requested rows');
  eq(blocked.processed, 0, 'the blocked receipt still processed rows');
  eq(blocked.failures, 0, 'a fail-closed refusal was counted as failures');
  eq(blocked.complete, true, 'the fail-closed refusal was reported as an incomplete run');
  eq(blocked.historyRequested, false, 'the blocked receipt still advertised a history phase');
  eq(unchosen.chartCalls.length, 0, 'an unchosen account had a patient chart opened');
  eq(unchosen.noteCalls.length, 0, 'an unchosen account had a scoped day-note read attempted');
  eq(unchosen.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'an unchosen account had an unscoped historical body walk attempted');
  /* dayfacts-1.0.1 item 2: the blocked-unchosen door is now the ONLY place a
     "not requested" pulled-day note can come from, and it must own its rows
     rather than claim reads it never made. */
  eq(Number(blocked.todayNoteNotRequested || 0), 2,
    'the blocked-unchosen door did not account for its own unread pulled-day notes');
  eq(Number(blocked.todayNoteRead || 0), 0,
    'the blocked receipt claimed pulled-day notes it never read');
  eq(Number(blocked.todayNoteFailures || 0), 0,
    'a fail-closed refusal was counted as a pulled-day note failure');

  /* And the same seam with a SETTLED off preference (no explicit override)
     must run day-facts, not refuse - that is the whole point of the change. */
  const settledOff = makeMonthHarness({ today: '2026-08-24' });
  const seededOff = settledOff.seedDay(day, 2);
  settledOff.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'off', on: false, settled: true }),
    write: () => true, isPrefKey: () => false,
    ensureChosenForBulkPull: () => Promise.resolve({ ok: true, on: false, reason: 'settled-off' })
  };
  const admitted = await settledOff.api._runHistoryBatch(batchRowsFrom(seededOff, day), [], () => {}, { scopeDay: day });
  eq(admitted.visitNotesMode, 'day-facts',
    'a SETTLED off preference did not admit the batch seam into day-facts mode');
  eq(admitted.reason, 'complete', 'the settled-off batch seam did not finish as a complete run');
  eq(admitted.processed, 2, 'the settled-off batch seam did not process every row');
  eq(admitted.chartFactsRequired, true, 'the settled-off batch seam dropped the chart-facts floor');
  eq(admitted.allVisitBodiesRequested, false,
    'the settled-off batch seam requested the historical body walk');
  eq(settledOff.chartCalls.length, 2,
    'a SETTLED off preference did not open a chart for every row at the batch seam');
  eq(settledOff.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'the settled-off batch seam ran the unscoped historical walk');
  /* the seam runs the SAME mandatory pulled-day note lane the public day pull
     does - a settled-OFF preference is admitted, never treated as unchosen. */
  eq(settledOff.noteCalls.length, 2,
    'the settled-off batch seam did not attempt one pulled-day note per row');
  ok(settledOff.noteCalls.every(c => c && c.onlyDate === day),
    'the settled-off batch seam issued an unscoped call to the per-patient visit reader');
  eq(Number(admitted.todayNoteRead || 0), 2,
    'the settled-off batch seam did not count the pulled-day notes it read');
  eq(Number(admitted.todayNoteNotRequested || 0), 0,
    'the settled-off batch seam reported its mandatory pulled-day notes as not requested');
}

/* ===========================================================================
 * dayfacts-1.0.1: the RECOVERY half of the pulled-day note lane.
 *
 * Round 2 measured all three recovery lanes still refusing day-facts rows and
 * held them as TODO tripwires. Round 3 (2026-08-25) closed every one, so this
 * function now PROVES the recovery instead of documenting its absence: a
 * day-facts pull whose mandatory note refuses with a DEFERRABLE reason queues
 * for retry (gap-A), feeds the persistent idle backfill (gap-B), and an
 * unchosen account's backfill pauses and stands its timer down (gap-C).
 * The honesty invariants that were written to survive the landing - every
 * refused note accounted exactly once, queued == rows really deferred - are
 * unchanged and now carry real non-zero counts.
 * ======================================================================== */
async function dayFactsDayNoteRecovery() {
  const day = '2026-08-23';
  const h = makeMonthHarness({ today: '2026-08-24' });
  h.seedDay(day, 2);
  h.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'off', on: false, settled: true }),
    write: () => true, isPrefKey: () => false,
    ensureChosenForBulkPull: () => Promise.resolve({ ok: true, on: false, reason: 'settled-off' })
  };
  /* 'pull-in-flight' is the canonical DEFERRABLE refusal (TN_DEFERRABLE_REASON):
     the note lost to the lease this very pull is holding. It is the one class
     that is guaranteed to succeed later, so it must never be a final verdict. */
  const refused = [];
  h.rt.__mlsVisitSavePref = {
    runForPatient(p, _s, opts) {
      refused.push({ patientId: p && p.id, onlyDate: opts && opts.onlyDate });
      return Promise.resolve({ ok: false, reason: 'pull-in-flight' });
    }
  };
  const res = await h.api.pull({ date: day, provider: h.provider, includeHistory: true,
    pullVisitBodies: false, onStatus: h.onStatus });
  const hr = res.historyReceipt || {};
  const rows = hr.patients || [];

  /* The mandatory attempt happened for every row and is honestly accounted. */
  eq(refused.length, 2, 'day-facts skipped the mandatory pulled-day note when the reader refused');
  ok(refused.every(c => c && c.onlyDate === day),
    'a refused day-facts pulled-day note was attempted unscoped');
  eq(Number(hr.todayNoteRead || 0), 0, 'the receipt counted a read for a refused pulled-day note');
  eq(Number(hr.todayNoteFailures || 0), 2, 'the receipt lost a refused pulled-day note');
  eq(Number(hr.todayNoteNotRequested || 0), 0,
    'a refused day-facts note was re-labelled as work nobody requested');
  eq(String((hr.todayNoteReasons || {})['pull-in-flight'] || 0), '2',
    'the receipt did not record the honest refusal reason per row');
  /* the chart itself still saved: a day-note refusal may never fail the row */
  ok(rows.every(p => p && p.complete === true),
    'a refused pulled-day note flipped an otherwise-saved day-facts row to failed');
  eq(h.chartCalls.length, 2, 'day-facts dropped the chart-facts floor when the note refused');

  /* HONESTY INVARIANT (true today, still true once the gap closes): every
     refused note is accounted for exactly once, and the receipt's queued count
     is exactly the rows that were really marked deferred - it may never claim a
     recovery that no row is holding. */
  eq(Number(hr.todayNoteFailures || 0),
    Number(hr.todayNoteQueued || 0) + Number(hr.todayNoteUnreadFinal || 0),
    'the refused-note tally does not add up (queued + final != failures)');
  eq(Number(hr.todayNoteQueued || 0),
    rows.filter(p => p && p.todayNoteDeferred === true).length,
    'the receipt claims queued pulled-day notes that no row was actually deferred for');

  /* ===== gap-A CLOSED (2026-08-25): the deferred round serves BOTH modes =====
     tnDeferRow's guard used to carry the checkbox term
       (... || sweepDepth || receipt.visitNotesRequested !== true) return false;
     so every day-facts row bounced off it: a mandatory note refused for a
     reason that is guaranteed transient was reported to the doctor as finally
     unread, with nothing holding a retry. The term is gone, and this fixture -
     whose refusal reason is the canonical deferrable one - now proves the
     recovery rather than measuring its absence. */
  ok(IMPORTER.includes('if (!entry || !day || sweepDepth) return false;'),
    'the tnDeferRow guard no longer admits a day-facts row into the deferred round');
  ok(!IMPORTER.includes('sweepDepth || receipt.visitNotesRequested !== true'),
    'the revoked checkbox term is back in the tnDeferRow guard');
  eq(Number(hr.todayNoteQueued || 0), 2,
    'a day-facts note refused for a guaranteed-transient reason was not queued for recovery');
  eq(Number(hr.todayNoteUnreadFinal || 0), 0,
    'a recoverable day-facts note refusal was reported to the doctor as finally unread');
  ok(rows.every(p => p && p.todayNoteDeferred === true),
    'a day-facts row refused with the deferrable reason was not marked deferred for retry');
  ok(rows.every(p => !!p && p.todayNoteProgress === 'chart-open'),
    'a refused day-facts row lost the observable chart-open progress a retry is allowed to bet on');

  /* ===== gap-B CLOSED: the idle backfill hears about day-facts receipts =====
     niSyncFromReceipt opened with `if (receipt.visitNotesRequested !== true)
     return 0;`, so the persistent backfill never learned about a day-facts
     pull's unread mandatory notes. The same A/B that measured the gap now
     proves the fix: the SAME receipt shape enqueues in BOTH modes.
     Distinct patient ids on purpose - the queue is a set, so re-using one id
     would dedupe the second call to 0 and read exactly like the old refusal. */
  const receiptShape = (requested, pid) => ({
    visitNotesRequested: requested, day: day,
    patients: [{ patientId: pid, todayNote: false,
      todayNoteReason: 'pulled-day-note-deadline-exceeded' }]
  });
  /* first: the rows THIS pull deferred belong to the immediate round and may
     not ALSO be sitting in the persistent queue - the third-queue invariant the
     feed exists to protect, checked before the A/B seeds any rows of its own. */
  const idleAfterPull = h.api.notesIdle() || {};
  eq(Number(idleAfterPull.total || 0), 0,
    'a row the immediate deferred round still owns was double-queued into the idle backfill');
  eq(h.api._notesIdleSyncFromReceipt(receiptShape(true, 'syn-ab-full'), day), 1,
    'the idle backfill seam stopped enqueueing an unread pulled-day note at all');
  eq(h.api._notesIdleSyncFromReceipt(receiptShape(false, 'syn-ab-dayfacts'), day), 1,
    'the idle backfill seam still refuses a day-facts receipt its unread pulled-day note');
  ok(!IMPORTER.includes('if (receipt.visitNotesRequested !== true) return 0;'),
    'the revoked checkbox early return is back at the head of niSyncFromReceipt');
  ok(IMPORTER.includes('if (p.todayNoteDeferred === true) return;'),
    'the idle backfill stopped skipping the rows the immediate deferred round still owns');

  /* ===== gap-C CLOSED: niRunOne's four consumers speak the new vocabulary ===
     niGate was moved to 'visit-notes-unchosen' but its four consumers still
     compared against "visit-notes-off", so those branches were unreachable dead
     code and an unchosen account's backfill reported 'waiting' and re-polled a
     gate that could only ever refuse. All four moved; pinned at the source, and
     proved at runtime through the tick timer below. */
  ok(IMPORTER.includes('(gate.reason === "visit-notes-unchosen") ? "paused" : "waiting"') &&
    IMPORTER.includes('if (gate.reason === "visit-notes-unchosen") niStopTimer();') &&
    IMPORTER.includes('(g2.reason === "user-active" || g2.reason === "visit-notes-unchosen")') &&
    IMPORTER.includes('if (g2.reason === "visit-notes-unchosen") niStopTimer();'),
    'a niRunOne consumer is back on the revoked vocabulary, making its branch dead code again');
  ok(!/=== "visit-notes-off"/.test(IMPORTER),
    'a revoked visit-notes-off comparison has been reasserted in the day engine');
  const unchosen = makeMonthHarness({ today: '2026-08-24' });
  unchosen.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: null, settled: false }),
    write: () => true, isPrefKey: () => false,
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, on: null, reason: 'unchosen' })
  };
  ok(unchosen.api._notesIdleEnqueue('syn-01', day, 'deadline'),
    'the idle backfill refused to accept a queued pulled-day note row');
  const unchosenGate = unchosen.api._notesIdleGate(false);
  eq(unchosenGate.open, false, 'an unchosen account was admitted to the idle day-note backfill');
  eq(unchosenGate.reason, 'visit-notes-unchosen',
    'the idle backfill no longer refuses an unchosen account with the dayfacts-1.0.1 reason');

  const settled = makeMonthHarness({ today: '2026-08-24' });
  settled.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'off', on: false, settled: true }),
    write: () => true, isPrefKey: () => false,
    ensureChosenForBulkPull: () => Promise.resolve({ ok: true, on: false, reason: 'settled-off' })
  };
  ok(settled.api._notesIdleEnqueue('syn-01', day, 'deadline'),
    'the idle backfill refused to accept a queued pulled-day note row for a settled account');
  const settledGate = settled.api._notesIdleGate(true);
  ok(settledGate.reason !== 'visit-notes-unchosen' && settledGate.reason !== 'visit-notes-off',
    'a SETTLED off account is still refused by the idle backfill that now owns its mandatory notes');

  /* MUTATION CONTROL: the tick can only be shown to STOP a timer if one was
     actually armed first. Without this, a backfill that never started ticking
     would read as a perfect pass. */
  const armed = unchosen.api.notesIdle() || {};
  ok(armed.timerKind && armed.timerKind !== 'none',
    'the idle backfill never armed a tick timer, so stopping it proves nothing');

  await unchosen.api._notesIdleTick(false);
  const idle = unchosen.api.notesIdle() || {};
  eq(idle.gateReason, 'visit-notes-unchosen',
    'the idle receipt does not surface the dayfacts-1.0.1 refusal reason');
  eq(idle.state, 'paused',
    'an unchosen account is still surfaced as waiting rather than paused by the notes-idle mapper');
  eq(idle.timerKind, 'none',
    'the idle backfill keeps ticking against a gate that can only ever refuse');
  /* paused is not stopped: the doctor never pressed stop, and settling the
     choice must be able to resume the lane. */
  eq(idle.stopped, false,
    'a paused unchosen account was reported as permanently stopped by the doctor');
}

function statusSanitizationContract() {
  const start = CONNECT.indexOf('var PP_PENDING =');
  const end = CONNECT.indexOf('  function buildPanel() {', start);
  ok(start >= 0 && end > start, 'pull-panel mapper boundaries moved');
  const context = {
    esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  };
  vm.createContext(context);
  vm.runInContext(CONNECT.slice(start, end) + '\nthis.__rowsHtml = rowsHtml;', context,
    { filename: 'pull-panel-status-mapper.js' });
  const raw = 'visit-bodies-incomplete [no-bound-clinical-detail,stable-source-keys-incomplete]';
  const html = context.__rowsHtml({ rows: [{
    name: 'Synthetic Patient', k: 'synthetic|p1', pid: 'p1', ok: true,
    reason: '', dn: 'unread:' + raw, dnd: '2026-08-23'
  }] });
  ok(html.includes('saved') && html.includes('today’s note not read this time'),
    'a day-note refusal is not rendered as a separate chart-saved status');
  ok(!/visit-bodies-incomplete|no-bound-clinical-detail|stable-source-keys-incomplete/.test(html),
    'day-note status/tooltip leaked raw scoped-reader internals');
  ok(!html.includes('chart saved — visit notes incomplete'),
    'a day-note refusal was mislabeled as an unscoped full-history failure');
}

async function main() {
  publicAdmissionContracts();
  batchDoorContracts();
  transportAndShapeContracts();
  await dayFactsOffDayPull();
  await dayFactsOffMonth();
  await fullNotesOnDay();
  await unchosenIsFailClosed();
  await dayFactsDayNoteRecovery();
  statusSanitizationContract();
  await flush(3);
  console.log('PASS site-full-notes-host-contract: ' + checks +
    ' checks - dayfacts-1.0.1 FINAL, 0 gaps open: OFF is day-facts (charts opened, facts saved, ' +
    'exactly one onlyDate pulled-day note per row, historical bodies skipped), ON adds the unscoped ' +
    'walk and reads no scoped note, UNSET fails closed at both doors, and raw day-note internals ' +
    'stay out of UI. CLOSED THIS ROUND: gap-4 (all three doctor-facing strings now state the ' +
    'day-facts truth, revoked wording banned on all three surfaces), gap-A (a deferrable day-facts ' +
    'note refusal queues: 2 queued / 0 finally unread), gap-B (the idle backfill enqueues day-facts ' +
    'receipts symmetrically, without double-queueing rows the deferred round owns), gap-C (an ' +
    'unchosen account pauses and stands its tick timer down). Newly pinned: enabled() requires a ' +
    'SETTLED choice, and the persisted terminal receipt records an OFF day as day-facts.');
}

const watchdog = setTimeout(() => {
  console.error(new Error('site-full-notes-host-contract did not finish'));
  process.exit(1);
}, 120000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
