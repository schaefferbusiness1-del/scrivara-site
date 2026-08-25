'use strict';

/* ============================================================================
   "Full visit notes" toggle contract -- dayfacts-1.0.1 (owner 2026-08-25,
   Codex-accepted). THE OLD PINS IN THIS SUITE WERE DELIBERATELY MOVED TWICE.

   What this suite used to pin (the REVOKED contract):
     - OFF was schedule/booking-only: zero patient chart and visit-body reads,
       proven by an early `if (!visitNotesRequested)` return whose receipt read
       reason "visit-notes-off";
     - the public day pull narrowed itself to schedule-only on explicit OFF
       (`includeHistory = visitNotesRequested === true && ... && !fullNotesOff`).

   What it pins NOW (the SUPERSEDING contract):
     - the checkbox selects HOW MUCH history is read, never WHETHER charts open;
     - OFF (settled) = day-facts mode: the per-patient batch RUNS, every exact
       scheduled row gets its identity-verified chart open + chart-facts save
       (the pipelined-parse branch), the PULLED-DAY encounter note is attempted
       through the tn/onlyDate lane, and only the OTHER dated historical bodies
       are skipped (one.visitsSkipped = true). Receipt: visitNotesMode
       "day-facts", chartFactsRequired true, allVisitBodiesRequested false, and
       honest insurance placeholders;
     - ON = the same mandatory floor plus full historical traversal ("full");
     - UNSET/unsettled = fail-closed with reason "visit-notes-unchosen" and
       visitNotesMode "blocked-unchosen", zero reads. The old "visit-notes-off"
       schedule-only no-op is REMOVED and must not be reasserted;
     - pullUnlocked's includeHistory now means "run the batch at all" and is
       decoupled from the checkbox; dayPull defaults it TRUE; pullMonth and the
       Calendar door no longer force it false on OFF;
     - "day-facts" is the ONE word every level uses for a settled OFF -- batch,
       day envelope, skipped envelope, day failure envelope and month envelope.
       "not-requested" is no longer a mode any OFF pull may report;
     - mls-connect's runForPatient admits an onlyDate-scoped read whenever the
       preference is SETTLED (on or off); unscoped reads still require ON.

   dayfacts-1.0.1 CLOSED the two engine gaps this suite reported at 1.0.0 (the
   hard-disabled pulled-day-note lanes, and the day envelope's "not-requested"
   mapping). Those narrowed pins are GONE; sections J-N below assert the real
   contract instead, and section N PROVES the day-note attempts by executing
   the real engine and counting its scoped reads rather than trusting bytes.

   dayfacts-1.0.1 FINAL then closed the three gaps this suite reported against
   the 1.0.1 preview, so THOSE quarantine pins are gone too:
     - tnDeferRow's guard dropped the checkbox term, so a deferrable day-facts
       note refusal now queues for the deferred round;
     - niSyncFromReceipt's checkbox early return is gone, so a day-facts
       receipt's leftovers feed the idle backfill;
     - niRunOne's four dead "visit-notes-off" comparisons were retargeted at
       "visit-notes-unchosen", so an unchosen account paints "paused" and
       STOPS its idle clock instead of ticking against a gate that can never
       open;
     - the three revoked "OFF opens no charts" UI strings were rewritten.
   Section O now pins those recoveries POSITIVELY and BY EXECUTION, with
   controls proving each fix is reason-gated rather than a blanket "queue
   everything". Section P pins the two remaining 1.0.1 deltas -- the terminal
   receipt's persisted mode, and the UNSCOPED save door's settled requirement
   -- in BOTH connect twins.

   No engine gap is outstanding. Nothing in this suite is forced green.

   Synthetic identities only. No PHI.
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness, makeMonthHarness, flush } = require('./1p-pull-harness.js');

const root = path.join(__dirname, '..');
const IMPORTER_PATH = path.join(root, 'feat_mls_schedimport_exact.js');
const importer = fs.readFileSync(IMPORTER_PATH, 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const connect1p = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const flow = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ---------------------------------------------------------------------------
   A. The resolver door still resolves the MODE. It no longer resolves
      PERMISSION -- but it must still be the ONE resolver, and the per-pull
      override must still be consulted first.
   ------------------------------------------------------------------------- */
const gate = importer.indexOf('var pullVisitBodies = safe(function () {');
ok(gate >= 0, 'importer must resolve the pullVisitBodies preference');
const block = importer.slice(gate, gate + 1600);
ok(/__mlsVisitNotesPref/.test(block), 'the importer must consult the ONE resolver, never raw keys');
ok(/choice\.on === true && choice\.state !== "unset"/.test(block),
  'only an explicit ON may select the FULL-history mode');
ok(block.indexOf('_pullBodiesOverride') >= 0 && block.indexOf('_pullBodiesOverride') < block.indexOf('__mlsVisitNotesPref'),
  'the per-pull override is consulted BEFORE the resolver');

/* ---------------------------------------------------------------------------
   B. The fail-closed door: unchosen, not unchecked. An explicit operation
      override counts as admitted; otherwise only a SETTLED on/off does.
   ------------------------------------------------------------------------- */
ok(importer.includes('var batchChoiceAdmitted = safe(function () {'),
  'the batch must resolve an ADMISSION separately from the on/off mode');
const admDecl = importer.indexOf('var batchChoiceAdmitted = safe(function () {');
const admBody = importer.slice(admDecl, admDecl + 600);
ok(admBody.includes('if (typeof _pullBodiesOverride === "boolean") return true;'),
  'an explicit per-pull override must count as an admitted choice');
ok(admBody.includes('return !!(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"));'),
  'admission must require a SETTLED on OR off -- a settled OFF is now an admitted choice, unset is not');

const admGuard = importer.indexOf('if (!batchChoiceAdmitted) {', gate);
const busyGate = importer.indexOf('if (historyBatchRunning)', gate);
const firstChartRead = importer.indexOf('dnReadChart(target', gate);
ok(admGuard > gate && busyGate > admGuard && firstChartRead > busyGate,
  'the UNCHOSEN guard does not run before the first chart read');

const admBlock = importer.slice(admGuard, busyGate);
ok(/receipt\.reason = "visit-notes-unchosen"/.test(admBlock),
  'the unchosen refusal has no explicit receipt reason');
ok(/receipt\.visitNotesMode = "blocked-unchosen"/.test(admBlock),
  'the unchosen refusal must name its own mode, never borrow day-facts or full');
ok(/receipt\.requested = 0/.test(admBlock) && /receipt\.processed = 0/.test(admBlock),
  'the unchosen refusal still claims history work was requested or processed');
ok(/receipt\.historyRequested = false/.test(admBlock) && /receipt\.failures = 0/.test(admBlock),
  'the unchosen refusal must be a clean, complete zero-work receipt');
ok(/receipt\.todayNoteRead = 0/.test(admBlock) && /receipt\.todayNoteFailures = 0/.test(admBlock),
  'the unchosen refusal can still fabricate a day-note read or failure');
ok(/receipt\.retry = \[\];/.test(admBlock),
  'the unchosen refusal must not hand rows to a retry lane it never attempted');
/* the ONLY door that may still report the day note as "not requested" */
ok(/receipt\.todayNoteNotRequested = receipt\.notRequestedRows;/.test(admBlock),
  'blocked-unchosen is the one door allowed to report not-requested day notes, and it stopped doing so');

/* ---------------------------------------------------------------------------
   C. The REVOKED OFF no-op must stay dead. These negatives are the whole
      point of the contract change: OFF is no longer a schedule-only no-op.
   ------------------------------------------------------------------------- */
ok(importer.indexOf('if (!visitNotesRequested) {', gate) === -1,
  'the revoked OFF early-return has been reasserted: the checkbox must not gate whether the batch runs');
ok(!importer.includes('receipt.reason = "visit-notes-off";'),
  'the revoked "visit-notes-off" batch receipt reason is back');
ok(!importer.includes('var includeHistory = visitNotesRequested === true && opts.includeHistory !== false && !fullNotesOff'),
  'the public day pull narrows itself to schedule-only on OFF again');
ok(!importer.includes('var historyReceipt = (!fullNotesOff && includeHistory)'),
  'the day pull skips the history batch on OFF again');
ok(!importer.includes('opts.includeHistory !== false && !monthFullNotesOff'),
  'pullMonth forces includeHistory=false on OFF again');
ok(!importer.includes('if (runOpts.includeHistory === undefined) runOpts.includeHistory = false;'),
  'dayPull defaults includeHistory back to false');
/* dayfacts-1.0.1: the retired REASON words may no longer be PRODUCED anywhere.
   (Four dead COMPARISONS against "visit-notes-off" survive in niRunOne; they
   are a reported gap, not a permitted producer -- see section O.) */
ok(!/reason = "visit-notes-off"|reason: "visit-notes-off"/.test(importer),
  'the retired schedule-only reason word "visit-notes-off" is being PRODUCED again in the importer');
ok(!importer.includes('"full-notes-off"'),
  'the retired wholesale OFF refusal reason "full-notes-off" is back in the importer');

/* No early return may stand between the admission door and the first chart
   read except the two proven busy gates -- that is exactly the slot the old
   OFF no-op occupied, so it is guarded by name. */
const preChart = importer.slice(busyGate, firstChartRead);
const earlyReturns = (preChart.match(/return receipt;/g) || []).length;
eq(earlyReturns, 2,
  'a new early return appeared between the admission door and the first chart read (expected exactly the two busy gates), found ' + earlyReturns);
let scanAt = -1, guardedByBusy = 0;
while ((scanAt = preChart.indexOf('return receipt;', scanAt + 1)) >= 0) {
  if (preChart.slice(Math.max(0, scanAt - 220), scanAt).indexOf('busyInFlight') >= 0) guardedByBusy++;
}
eq(guardedByBusy, 2,
  'an early return before the first chart read is not one of the busy gates -- a checkbox-keyed refusal may have crept back in');

/* ---------------------------------------------------------------------------
   D. The day-facts receipt shape: an OFF pull now declares day-facts mode, the
      always-true chart-facts floor, and honest insurance placeholders.
   ------------------------------------------------------------------------- */
ok(importer.includes('var chartFactsRequired = true;'),
  'chart facts must be the MANDATORY floor in both modes');
ok(importer.includes('var allVisitBodiesRequested = visitNotesRequested;'),
  'the checkbox must now name exactly what it governs: ALL historical visit bodies');
ok(importer.includes('visitNotesMode: visitNotesRequested ? "full" : "day-facts"'),
  'the batch receipt must report day-facts mode on OFF, never "not-requested"');
ok(importer.includes('chartFactsRequired: chartFactsRequired, allVisitBodiesRequested: allVisitBodiesRequested'),
  'the batch receipt must carry both the floor and the checkbox as separate, readable facts');
ok(importer.includes('insuranceAttempted: 0, insuranceComplete: false, benefitsComplete: false, insuranceReason: "reader-not-shipped"'),
  'a missing coverage reader must be declared honestly, never reported as verified-none');
ok(/visitNotesRequested: visitNotesRequested,/.test(importer.slice(gate, firstChartRead)),
  'the receipt must still report the raw checkbox honestly beside the mode');

/* ---------------------------------------------------------------------------
   E. day-facts mode DOES open the chart and DOES save facts; it skips only the
      OTHER dated historical bodies.
   ------------------------------------------------------------------------- */
const pipeCall = importer.indexOf('launchPipelinedParse({ one: one, row: row, target: target, stageMs: stageMs, startedAt: patientReadStartedAt }', gate);
ok(pipeCall > firstChartRead,
  'the OFF lane must reach the pipelined parse+persist chain AFTER a real chart read');
ok(importer.slice(firstChartRead, pipeCall).includes('if (!stopAfterTimeout && pullVisitBodies !== true) {'),
  'the pipelined-parse branch must be the one an OFF (day-facts) row takes');
const skipSettle = importer.indexOf('if (!stopAfterTimeout && pullVisitBodies !== true) {\n          one.visitsComplete = true;', gate);
ok(skipSettle > pipeCall,
  'the day-facts row must settle its visits stage after the chart read, not instead of it');
ok(importer.slice(skipSettle, skipSettle + 260).includes('one.visitsSkipped = true;'),
  'a day-facts row must record honestly that HISTORICAL bodies were skipped');
ok(importer.includes('one.visitsComplete = true; one.visitsSkipped = pullVisitBodies !== true;'),
  'the already-verified-today skip must record visitsSkipped from the MODE, not assume ON');

/* ---------------------------------------------------------------------------
   F. Public callers: includeHistory is decoupled from the checkbox -- at ALL
      THREE doors (pullUnlocked, pullMonth, and the Calendar selection).
   ------------------------------------------------------------------------- */
ok(importer.includes('var includeHistory = opts.includeHistory !== false;\n    var onStatus'),
  'pullUnlocked must run the batch unless the CALLER explicitly opted out');
ok(importer.includes('var includeHistory = opts.includeHistory !== false; /* dayfacts-1.0.0: OFF months still run the mandatory day-facts batch per day */'),
  'pullMonth must run the mandatory day-facts batch on OFF months too');
ok(importer.includes('var includeHistory = opts.includeHistory !== false; /* dayfacts-1.0.1: the Calendar door was the third caller still coupling the checkbox in - an OFF Calendar pull now runs the mandatory day-facts batch like every other entry */'),
  'pullCalendarSelection must stop ANDing the checkbox into includeHistory');
ok(importer.includes('if (runOpts.includeHistory === undefined) runOpts.includeHistory = true;'),
  'dayPull must default includeHistory TRUE -- the mandatory floor always runs');
ok(importer.includes('var historyReceipt = includeHistory\n'),
  'the day pull must select the real history batch on includeHistory alone');
ok(importer.includes('var historySkipReason = p1CensusHistoryDeferred ? "provider-attribution-unavailable" : "not-requested";'),
  'the only remaining history skips are the census phase-1 caller and a day with nothing provable');

/* ---------------------------------------------------------------------------
   G. Messages: nothing the engine or the app says may claim OFF opened no
      charts, and nothing may report a day-facts pull as an intentional skip.
   ------------------------------------------------------------------------- */
ok(!importer.includes('"; Full Notes is off, so no patient charts or visit notes were opened."'),
  'the month-complete message claims OFF opened no charts again');
ok(importer.includes('"; Full visit notes is off - each day saved chart facts and attempted only its own pulled-day note; no other historical bodies were read."'),
  'the month-complete OFF message must say chart facts + own-day note');
ok(importer.includes('"history was not requested by this caller."'),
  'the schedule-only message must attribute the skip to the CALLER, not to the checkbox');

/* the app's day-completion mapper: a settled OFF is NOT an intentional history
   skip any more -- only a genuinely skipped batch is. */
[['mls-connect.js', connect], ['1p-mls-connect.js', connect1p]].forEach(function (pair) {
  const name = pair[0], src = pair[1];
  ok(src.includes('var historyIntentionallySkipped = hr.skipped === true ||\n        r.historyRequested === false || r.includeHistory === false;'),
    name + ': the day-completion mapper must not treat a day-facts (OFF) receipt as an intentional skip');
  ok(!/historyIntentionallySkipped = [^;]*visitNotesRequested === false/.test(src),
    name + ': visitNotesRequested === false is back in the intentionally-skipped test -- day-facts chart work would go unreported');
  /* the apostrophe is the SOURCE escape ’, not a literal curly quote */
  ok(src.includes('Historical visit notes were skipped by choice (Full visit notes is off); chart facts and each day\\u2019s own note were read.'),
    name + ': the OFF day message must say historical bodies were skipped WHILE chart facts and the own-day note were read');
  /* the legacy _pullAllHistories wrapper may still refuse -- but only for
     HISTORICAL bodies, and never with the retired vocabulary or claim. */
  ok(src.includes("reason: 'historical-bodies-not-requested', visitNotesRequested: false, historiesRequested: 0"),
    name + ': the legacy full-crawl wrapper must scope its refusal to HISTORICAL bodies');
  ok(src.includes('Full visit notes is off, so this legacy history helper did not crawl historical encounter bodies.'),
    name + ': the legacy wrapper message must not claim OFF opens no charts');
  ok(!/progressSay\('Full visit notes is off[^']*no patient chart/.test(src),
    name + ': the legacy wrapper claims OFF opens no patient chart again');
});

/* ---------------------------------------------------------------------------
   H. mls-connect's reader: an onlyDate-scoped read is admitted on a SETTLED
      preference in either mode; unscoped reads still require ON; unset is
      skipped with its own code.
   ------------------------------------------------------------------------- */
ok(connect.includes('api.runForPatient = function (p, onStatus, runOpts) {'),
  'mls-connect must expose the per-patient visit reader');
ok(connect.includes("var dayScoped = !!(runOpts && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(runOpts.onlyDate || '')));"),
  'the day-scoped admission must require a WELL-FORMED YYYY-MM-DD onlyDate, not any truthy value');
ok(connect.includes("return !!(c && c.settled === true && (c.state === 'on' || c.state === 'off'));"),
  'the reader must admit the scoped read only on a SETTLED choice');
ok(connect.includes("if (!enabled() && !(dayScoped && choiceSettled)) return Promise.resolve({ ok: true, skipped: choiceSettled ? 'preference-off' : 'preference-unchosen' });"),
  'the reader must distinguish settled-off (preference-off) from unset (preference-unchosen) and admit the scoped read');
ok(!connect.includes("if (!enabled()) return Promise.resolve({ ok: true, skipped: 'preference-off' });"),
  'the revoked unconditional OFF refusal is back in runForPatient -- the pulled-day note can never be read');

/* ---------------------------------------------------------------------------
   I. The toggle UI and the visible day-pull progress (unchanged by dayfacts).
   ------------------------------------------------------------------------- */
ok(connect.includes("id=\"mlsDsVisitBodies\""), 'day-pull card must expose the Full visit notes toggle');
ok(connect.includes('r.write(tgl.checked === true)'), 'toggle must persist through the ONE resolver (which owns the namespaced keys)');
ok(connect.includes("tgl.checked = (r && typeof r.read === 'function') ? r.read().on === true : false"),
  'toggle UI must paint the resolved tri-state and fail closed OFF when the resolver is unavailable');
ok(connect.includes("id = 'mlsDsPullBar'"), 'day pull must render a progress bar');
ok(connect.includes('(\\d+)\\s+of\\s+(\\d+)') || connect.includes('match(/(\\d+)\\s+of\\s+(\\d+)/)'),
  'progress bar must parse X of N counts');

/* ---------------------------------------------------------------------------
   J. dayfacts-1.0.1 CLOSED GAP 1: both pulled-day-note lanes are ENABLED and
      mandatory in day-facts mode. The 1.0.0 pins that asserted the disabled
      literals are deleted; these assert the shipped contract instead.
   ------------------------------------------------------------------------- */
ok(!importer.includes('var pulledDayNoteLaneEnabled = false;'),
  'the inline pulled-day-note fold-in was hard-disabled again -- a day-facts pull would attempt ZERO pulled-day notes');
ok(!importer.includes('var pulledDayNoteTailEnabled = false;'),
  'the tn/onlyDate TAIL pass was hard-disabled again -- rows the inline leg missed would never be caught up');
ok(importer.includes('var pulledDayNoteLaneEnabled = true;'),
  'the inline pulled-day-note lane must be enabled');
ok(importer.includes('var pulledDayNoteTailEnabled = true;'),
  'the tn/onlyDate tail pass must be enabled');
ok(importer.includes('if (pulledDayNoteLaneEnabled && !stopAfterTimeout && pullVisitBodies !== true && one.visitsSkipped === true && rd && !inlineDayNoteFuse && one.todayNote == null) {'),
  'the inline fold-in must still be OFF-mode-only, chart-verified (rd) and fuse-aware');
ok(importer.includes('if (pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped) {'),
  'the tail pass must run in day-facts mode and must still yield to a user Stop');
ok(importer.includes('if (!oneTn || oneTn.visitsSkipped !== true) continue;'),
  'the tn tail pass must still select exactly the day-facts (visitsSkipped) rows');
ok(importer.includes('return vp.runForPatient(p, function () {}, { onlyDate: String(day) });'),
  'the pulled-day note read must stay DATE-SCOPED -- an unscoped read would pull every body');
ok(importer.includes('safe(function () { receipt.chartOpensDayNote = Number(receipt.chartOpensDayNote || 0) + 1; });'),
  'every scoped day-note read is one chart open and must be counted on the receipt');

/* the day-note census: the checkbox short-circuit is GONE, so a day-facts row
   is tallied like any other. tnAggregate may not mention the checkbox at all. */
const aggAt = importer.indexOf('function tnAggregate() {');
const aggEnd = importer.indexOf('function tnBatchDay() {', aggAt);
ok(aggAt > 0 && aggEnd > aggAt, 'the day-note census function must exist');
const aggBody = importer.slice(aggAt, aggEnd);
ok(!/visitNotesRequested/.test(aggBody),
  'tnAggregate consults the checkbox again -- the retired short-circuit reported every day-facts row as "not requested"');
ok(aggBody.includes('receipt.todayNoteNotRequested = 0;'),
  'the census must zero todayNoteNotRequested: outside blocked-unchosen no row is "not requested"');
ok(aggBody.includes('receipt.todayNoteFailures = tnF;') && aggBody.includes('receipt.todayNoteRead = tnRead;'),
  'the census must publish the real per-row read/failure tally in BOTH modes');

/* the STOP path stamps stopped rows in both modes, with stop vocabulary */
const stopAt = importer.indexOf('var __stpStopped = receipt.stoppedByUser === true');
const stopEnd = importer.indexOf('var pulledDayNoteTailEnabled', stopAt);
ok(stopAt > 0 && stopEnd > stopAt, 'the stop path must precede the tail pass');
const stopBlock = importer.slice(stopAt, stopEnd);
ok(stopBlock.includes('p.todayNoteReason = "stopped-by-user";'),
  'a stopped row must be stamped stopped-by-user, never with a checkbox reason');
ok(!/pullVisitBodies|visitNotesRequested/.test(stopBlock),
  'the stop path branches on the checkbox again -- a stopped day-facts row would be treated as "not requested"');
ok(!/todayNoteReason = "(visit|full)-notes-off"/.test(stopBlock),
  'a stopped row is stamped with the retired checkbox vocabulary again');
ok(/var tnSkipped = 0, tnNotRequested = 0;/.test(stopBlock) && !/tnNotRequested\+\+/.test(stopBlock),
  'the stop path increments a not-requested tally again -- in both modes the pulled-day note WAS requested');
ok(stopBlock.includes('if (!p || p.visitsSkipped !== true || p.todayNote != null) return;'),
  'the stop stamp must only touch day-facts rows that never got a verdict');

/* retryFailedHistory re-runs OFF rows through the batch, scoped by the frozen
   override to the receipt's own mode. */
const retryAt = importer.indexOf('function retryFailedHistory(source, onStatus) {');
const retryEnd = importer.indexOf('function retryBusy(scope) {', retryAt);
ok(retryAt > 0 && retryEnd > retryAt, 'retryFailedHistory must exist');
const retryHead = importer.slice(retryAt, retryEnd);
ok(!/return Promise\.resolve\(\{[^}]*full-notes-off/.test(retryHead),
  'the wholesale OFF retry refusal is back -- an OFF row\'s mandatory chart work would never be retried');
ok(retryHead.includes('var retryBodiesRequested = typeof history.visitNotesRequested === "boolean"'),
  'the retry must still scope itself to the RECEIPT\'s own mode rather than the live checkbox');
ok(importer.includes('if (typeof history.visitNotesRequested === "boolean") _pullBodiesOverride = history.visitNotesRequested;'),
  'the retry must freeze the original pull\'s mode through the per-pull override');
ok(importer.includes('return runHistoryBatch(rows, unresolved, isFn(onStatus) ? onStatus : function () {}, { scopeDay: retryScopeDay }).then('),
  'the retry must re-enter the real batch, in both modes');

/* the idle catch-up gate refuses only an UNCHOSEN account now */
ok(importer.includes('return !(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"));\n    }, true)) return { open: false, reason: "visit-notes-unchosen" };'),
  'niGate must refuse only an unsettled preference -- a settled OFF drains its own mandatory pulled-day notes');
ok(importer.includes('if (!(choice && choice.settled === true && (choice.state === \'on\' || choice.state === \'off\'))) {') ||
   importer.includes('if (!(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"))) {'),
  'niReadOnce must re-check for a SETTLED choice, not for ON');
ok(importer.includes('return Promise.resolve({ ok: false, reason: "visit-notes-unchosen" });'),
  'niReadOnce\'s refusal must name the unchosen account, never the retired OFF');

/* ---------------------------------------------------------------------------
   K. dayfacts-1.0.1 CLOSED GAP 2: ONE mode vocabulary at EVERY level. A
      settled OFF says "day-facts" on the batch receipt, the day envelope, the
      skipped envelope, the day FAILURE envelope and the month envelope.
   ------------------------------------------------------------------------- */
ok(!importer.includes('res.visitNotesMode = fullNotesOff ? "not-requested"'),
  'the day-level result envelope maps a settled OFF back to "not-requested"');
ok(importer.includes('res.visitNotesMode = fullNotesOff ? "day-facts" : (res.visitNotesRequested === true ? "full" : (historyReceipt && historyReceipt.visitNotesMode) || "unspecified");'),
  'the day SUCCESS envelope must report day-facts on a settled OFF');
ok(importer.includes('visitNotesMode: fullNotesOff ? "day-facts" : (visitNotesRequested === true ? "full" : "unspecified"), created: 0'),
  'the day FAILURE envelope must report day-facts on a settled OFF');
ok(importer.includes('visitNotesMode: fullNotesOff ? "day-facts" : (visitNotesRequested === true ? "full" : "unspecified"), chartReads: 0'),
  'the SKIPPED history envelope must say day-facts on OFF');
ok(importer.includes('visitNotesMode: monthFullNotesOff ? "day-facts" : (monthPullVisitBodies === true ? "full" : "unspecified"), provider: gate.provider || null'),
  'the month FAILURE envelope must report day-facts on a settled OFF');
ok(importer.includes('visitNotesMode: monthFullNotesOff ? "day-facts" : (monthPullVisitBodies === true ? "full" : "unspecified"),\n      provider: frozenProvider'),
  'the month RESULT envelope must report day-facts on a settled OFF');

/* a whole-file sweep so a NEW envelope cannot quietly reintroduce the revoked
   words next to a visitNotesMode assignment. */
let vnmAt = -1, vnmCount = 0;
const vnmBad = [];
while ((vnmAt = importer.indexOf('visitNotesMode', vnmAt + 1)) >= 0) {
  vnmCount++;
  const window200 = importer.slice(vnmAt, vnmAt + 200);
  if (window200.includes('"not-requested"') || window200.includes('"visit-notes-off"')) {
    vnmBad.push(importer.slice(0, vnmAt).split('\n').length);
  }
}
eq(vnmBad.length, 0,
  'a visitNotesMode site still speaks the revoked vocabulary at line(s) ' + vnmBad.join(', '));
eq(vnmCount, 8,
  'the number of visitNotesMode sites changed (' + vnmCount + ', expected 8) -- audit the new one against the day-facts vocabulary and move this pin');

/* ===========================================================================
   L-N. RUNTIME PROOF. The bytes above say the lane is enabled; these run the
   REAL importer (the same file this suite pins) on a synthetic clinic day and
   COUNT the scoped reads it issues. A byte pin cannot tell the difference
   between "enabled" and "enabled but unreachable"; this can.
   ========================================================================= */
const DAY = '2026-08-23';
const TODAY = '2026-08-24';           /* the pulled day is PAST: every slot has passed */
const SYNTHETIC_CHART = { problems: 'Synthetic problem', meds: 'Synthetic medication', summary: 'Synthetic summary' };

function dayFactsHarness(extra) {
  return makeHarness(Object.assign({
    day: DAY, today: TODAY, rows: 3, visitNotesOn: false,
    chartCoverage: true, parseResult: () => SYNTHETIC_CHART, importerPath: IMPORTER_PATH
  }, extra || {}));
}

/* L. day-facts ATTEMPTS the pulled-day note -- once per row, scoped to exactly
      the pulled day, folded in beside that row's own verified chart open. */
async function dayFactsAttemptsThePulledDayNote() {
  const h = dayFactsHarness();
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});

  /* the mandatory floor */
  eq(h.chartCalls.length, 3, 'day-facts did not open one identity-verified chart per scheduled row');
  eq(h.parseCalls.length, 3, 'day-facts did not run the pipelined chart parse per row');
  eq(h.saveCalls.length, 3, 'day-facts did not save chart facts per row');
  ok((receipt.patients || []).every(p => p && p.parsePipelined === true),
    'day-facts took a branch other than the pipelined-parse chart-facts branch');
  ok((receipt.patients || []).every(p => p && p.visitsSkipped === true),
    'day-facts traversed historical visit bodies');

  /* THE CLOSED GAP, proven by count: one DATE-SCOPED read per row, zero
     unscoped walks, and every read pinned to the pulled day. */
  eq(h.noteCalls.length, 3,
    'day-facts did not attempt the pulled-day encounter note once per row (issued ' + h.noteCalls.length + ' reads)');
  eq(h.noteCalls.filter(c => c.onlyDate === DAY).length, 3,
    'a day-facts day-note read was not scoped to the pulled day');
  eq(h.noteCalls.filter(c => c.onlyDate == null).length, 0,
    'day-facts issued an UNSCOPED all-visits body walk');
  eq(new Set(h.noteCalls.map(c => c.patientId)).size, 3,
    'day-facts read the same patient twice instead of once per scheduled row');

  /* the fold-in, not a second pass: each row's note read is the very next
     Athena call after that row's OWN chart open, while its chart is still the
     tab-of-record. An ordering regression back to a serial re-open pass costs
     ~38 s/note and would slip past every count above. */
  h.noteCalls.forEach(function (note) {
    const chart = h.chartCalls.filter(c => c.patientId === note.patientId)[0];
    ok(chart && note.seq === chart.seq + 1,
      'the pulled-day note for a row was not read immediately after that row\'s own chart open (a serial re-open pass came back)');
  });

  /* every row carries a real verdict, and the census agrees with the reads */
  ok((receipt.patients || []).every(p => p && p.todayNote != null),
    'a day-facts row carries no pulled-day-note verdict at all');
  ok((receipt.patients || []).every(p => p && p.todayNote === true),
    'a clean day-facts fixture failed to read a pulled-day note it did attempt');
  ok((receipt.patients || []).every(p => p && p.dayNoteChartOpen === true),
    'a day-facts row lost the chart-open evidence its retry is allowed to bet on');
  eq(Number(receipt.todayNoteRead || 0), 3, 'the day-facts receipt under-counts the notes it read');
  eq(Number(receipt.todayNoteFailures || 0), 0, 'a clean day-facts fixture reported day-note failures');
  eq(Number(receipt.todayNoteNotRequested || 0), 0,
    'day-facts still reports the pulled-day note as "not requested" -- the retired census short-circuit is back');
  /* dfc-1.1.0: the direct bridge read rides the already-open chart - zero day-note opens. */
  eq(Number(receipt.chartOpensDayNote || 0), 0,
    'the direct-bridge day-note leg opened charts it does not need');

  /* the receipt vocabulary */
  eq(receipt.visitNotesRequested, false, 'the day-facts receipt lost its frozen OFF choice');
  eq(receipt.visitNotesMode, 'day-facts', 'the day-facts receipt mislabels its mode');
  eq(receipt.chartFactsRequired, true, 'the day-facts receipt made the chart-facts floor optional');
  eq(receipt.allVisitBodiesRequested, false, 'the day-facts receipt claims full body traversal');
  eq(receipt.insuranceReason, 'reader-not-shipped', 'the day-facts receipt stopped declaring insurance honestly');
  eq(receipt.complete, true, 'a clean day-facts batch did not complete');
  ok(receipt.reason !== 'visit-notes-off' && receipt.reason !== 'full-notes-off',
    'the day-facts batch reported a retired schedule-only skip reason');
}

/* M. ON is a SUPERSET: same floor, one unscoped walk per patient, and NO
      duplicate date-scoped second pass. */
async function fullNotesOnIsASuperset() {
  const h = dayFactsHarness({ visitNotesOn: true });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});

  eq(h.chartCalls.length, 3, 'Full Notes ON skipped the mandatory verified chart open');
  eq(h.saveCalls.length, 3, 'Full Notes ON skipped the mandatory chart-facts save');
  eq(h.noteCalls.length, 3, 'Full Notes ON did not issue one historical body walk per patient');
  eq(h.noteCalls.filter(c => c.onlyDate != null).length, 0,
    'Full Notes ON ran the date-scoped lane too -- that is a duplicate second pass over the same day');
  ok((receipt.patients || []).every(p => p && p.visitsSkipped !== true),
    'Full Notes ON skipped historical bodies on a row');
  eq(receipt.visitNotesMode, 'full', 'the ON receipt mislabels its mode');
  eq(receipt.allVisitBodiesRequested, true, 'the ON receipt does not request all visit bodies');
  eq(receipt.chartFactsRequired, true, 'the ON receipt made the chart-facts floor optional');
}

/* N1. UNSET is fail-closed: zero reads of ANY kind. */
async function unchosenBlocksEveryRead() {
  const h = dayFactsHarness();
  h.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: false, settled: false }),
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, reason: 'unchosen' }),
    write: () => true, isPrefKey: () => false
  };
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});

  eq(h.chartCalls.length, 0, 'an unchosen account had a patient chart opened on its behalf');
  eq(h.noteCalls.length, 0, 'an unchosen account had a pulled-day note read on its behalf');
  eq(h.saveCalls.length, 0, 'an unchosen account had chart facts written on its behalf');
  eq(receipt.reason, 'visit-notes-unchosen', 'the blocked receipt does not name the unchosen refusal');
  eq(receipt.visitNotesMode, 'blocked-unchosen', 'the blocked receipt mislabels its mode');
  eq(Number(receipt.requested || 0), 0, 'the blocked receipt requested rows it never read');
  eq((receipt.retry || []).length, 0, 'the blocked receipt armed a retry for reads it never made');
  eq(Number(receipt.todayNoteNotRequested || 0), 3,
    'blocked-unchosen is the ONE door that may report not-requested day notes, and it stopped counting them');
  eq(h.api._notesIdleGate(true).reason, 'visit-notes-unchosen',
    'the idle catch-up gate must refuse an unchosen account by name');
}

/* N2. The inline fuse still exists in day-facts mode: a timing-class refusal
       trips it, and the NEXT row's verified chart read clears it. */
async function inlineFuseTripsAndClears() {
  /* dfc-1.1.0: the fuse lives in the legacy FOLD-IN rung, so this fixture
     runs a legacy reader (direct reads scope-refused) and throws the
     timing-class error on the first VP call - vp calls are the ones that
     carry a defined onlyDate under legacyAllVisits (the bridge answers
     ignore the hint). */
  let fuseThrown = false;
  const h = dayFactsHarness({
    legacyAllVisits: true,
    noteResult: (pid, d, n) => {
      if (d && !fuseThrown) { fuseThrown = true; return { __throw: 'the athena runner is not responding' }; }
      return { ok: true, visits: 1 };
    }
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});
  eq(Number(receipt.todayNoteFuseCleared || 0), 1,
    'the inline day-note fuse never tripped-and-cleared in day-facts mode');
  /* 3 scope-refused bridge attempts (recorded) + 3 vp ladder reads */
  eq(h.noteCalls.filter(c => c && c.transport !== 'bridge').length, 3,
    'a single fused row cost the rest of the day their pulled-day notes');
  eq(h.noteCalls.filter(c => c && c.transport === 'bridge').length, 3,
    'the direct bridge attempt stopped being made (or was made twice) per row');
  eq(Number(receipt.todayNoteFailures || 0), 1, 'the fused row was not counted as an unread note');
  eq(Number(receipt.todayNoteRead || 0), 2, 'the rows after the fuse did not recover their notes');
  eq((receipt.patients || [])[0].todayNoteReason, 'the athena runner is not responding',
    'the fused row lost the honest reason its note could not be read');
}

/* N3. The whole day pull, end to end: an OFF pull opens every chart, reads
       every pulled-day note, and the RESULT ENVELOPE says day-facts. */
async function offDayPullEnvelopeSaysDayFacts() {
  const h = makeMonthHarness({ today: TODAY, importerPath: IMPORTER_PATH });
  h.seedDay(DAY, 3);
  const res = await h.api.pull({
    date: DAY, provider: h.provider, includeHistory: true,
    pullVisitBodies: false, onStatus: h.onStatus
  });

  eq(res.visitNotesMode, 'day-facts',
    'the day-level result envelope does not report day-facts for a settled OFF pull');
  eq(res.visitNotesRequested, false, 'the day envelope lost the raw checkbox beside the mode');
  eq(h.chartCalls.length, 3, 'an OFF day pull did not open one verified chart per scheduled row');
  eq(h.noteCalls.filter(c => c.onlyDate === DAY).length, 3,
    'an OFF day pull did not attempt the pulled-day note for every scheduled row');
  eq(h.noteCalls.filter(c => c.onlyDate == null).length, 0,
    'an OFF day pull issued an unscoped historical body walk');
  eq(res.historyReceipt && res.historyReceipt.visitNotesMode, 'day-facts',
    'the day pull\'s own history receipt mislabels its mode');
  eq(Number(res.historyReceipt && res.historyReceipt.todayNoteRead || 0), 3,
    'the day pull\'s history receipt under-counts the pulled-day notes it read');
  ok(!String(res.historySkippedReason || ''),
    'an OFF day pull reported a history SKIP for a batch it actually ran');
}

/* ===========================================================================
   O. dayfacts-1.0.1 FINAL: the day-note RECOVERY lanes serve BOTH modes.

   The 1.0.1 preview left three checkbox-keyed leftovers, which this suite
   quarantined and reported. All three are closed, so the quarantine pins are
   deleted and the recovered contract is pinned in their place -- positively,
   and (for everything observable at runtime) by EXECUTING the engine:

     - tnDeferRow    (feat_mls_schedimport_exact.js:5873) dropped the
                     `receipt.visitNotesRequested !== true` term;
     - niSyncFromReceipt (:7059) dropped its checkbox early return;
     - niRunOne      (:7208, :7209, :7228, :7229) retargeted its four
                     comparisons at the live reason "visit-notes-unchosen".

   The point of the fix is that a day-facts row whose MANDATORY pulled-day note
   hit a TRANSIENT refusal is no longer stranded outside both queues -- the
   dnd2-1.0.0 defect, which the preview had re-created for OFF. So each pin
   below carries its CONTROL: a deterministic (non-retryable) refusal must
   still be queued NOWHERE, and a row still owned by the deferred round must
   still be refused by the idle feed. A blanket "queue everything" would pass
   the recovery pins and fail the controls.
   ========================================================================= */
ok(!importer.includes('if (!entry || !day || sweepDepth || receipt.visitNotesRequested !== true) return false;'),
  'tnDeferRow\'s checkbox guard is back -- a deferrable day-facts note refusal would be stranded outside the deferred round again');
ok(importer.includes('if (!entry || !day || sweepDepth) return false;'),
  'tnDeferRow must admit BOTH modes: its guard may test only the row, the day and the sweep depth');
const deferAt = importer.indexOf('function tnDeferRow(entry, day, force) {');
const deferEnd = importer.indexOf('function tnQueueDeferred(', deferAt);
ok(deferAt > 0 && deferEnd > deferAt, 'tnDeferRow must exist ahead of the queue it feeds');
ok(!/visitNotesRequested/.test(importer.slice(deferAt, deferEnd)),
  'tnDeferRow consults the checkbox again somewhere in its body');

const niSyncAt = importer.indexOf('function niSyncFromReceipt(receipt, day) {');
const niSyncEnd = importer.indexOf('function niIdleMs()', niSyncAt);
ok(niSyncAt > 0 && niSyncEnd > niSyncAt, 'the ONE idle feed must exist');
const niSyncBody = importer.slice(niSyncAt, niSyncEnd);
ok(!niSyncBody.includes('if (receipt.visitNotesRequested !== true) return 0;'),
  'niSyncFromReceipt\'s checkbox early return is back -- a day-facts receipt\'s leftovers would never reach the idle backfill');
ok(!/visitNotesRequested/.test(niSyncBody),
  'niSyncFromReceipt reads the checkbox again -- the ONE feed must be mode-blind');
ok(niSyncBody.includes('if (p.todayNoteDeferred === true) return;'),
  'niSyncFromReceipt stopped skipping rows the deferred round still owns -- that is the third queue this block exists to prevent');

eq((importer.match(/reason === "visit-notes-off"/g) || []).length, 0,
  'a DEAD "visit-notes-off" comparison is back in the idle lane -- its gate can only ever answer "visit-notes-unchosen"');
eq((importer.match(/reason === "visit-notes-unchosen"/g) || []).length, 4,
  'the four idle-lane comparisons against the LIVE unchosen reason changed count -- audit niRunOne (state paint + niStopTimer, both before and after the web-lock round trip)');

async function deferrableDayFactsRefusalsReachTheRecoveryLanes() {
  const h = dayFactsHarness({ noteResult: () => ({ ok: false, reason: 'pull-in-flight' }) });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});

  /* the refusals are real, retryable, and carry the progress evidence the
     retry predicate demands */
  eq(Number(receipt.todayNoteFailures || 0), 3, 'the day-facts fixture did not produce three unread notes');
  ok((receipt.patients || []).every(p => p && p.todayNoteReason === 'pull-in-flight'),
    'the day-facts rows did not refuse with the deferrable reason this fixture injected');
  ok((receipt.patients || []).every(p => p && p.todayNoteProgress === 'chart-open'),
    'the day-facts rows lost the chart-open progress evidence the deferral predicate demands');
  ok((receipt.patients || []).every(p => p && p.todayNoteNoProgress !== true),
    'the rows were refused for lack of progress rather than admitted to the deferred round');

  /* THE RECOVERY, proven by count: every deferrable day-facts refusal is
     queued, stamped as the deferred round's own row, and therefore NOT
     reported to the doctor as finally unread. */
  eq(Number(receipt.todayNoteQueued || 0), 3,
    'a deferrable day-facts refusal is stranded outside the deferred round again (queued ' + Number(receipt.todayNoteQueued || 0) + ' of 3)');
  ok((receipt.patients || []).every(p => p && p.todayNoteDeferred === true),
    'a day-facts row was not stamped as the deferred round\'s own, so the idle feed would double-queue it');
  eq(Number((receipt.todayNoteDeferred || {}).queued || 0), 3,
    'the deferred-round envelope under-counts the day-facts rows it took ownership of');
  eq(Number(receipt.todayNoteUnreadFinal || 0), 0,
    'the day-facts receipt still calls a QUEUED note finally unread -- the doctor would be told a note failed that is waiting to be retried');

  /* CONTROL: the deferral is REASON-gated, not blanket. A deterministic
     identity refusal is exactly the class that must never be re-driven. */
  const det = dayFactsHarness({
    noteResult: () => ({ ok: false, reason: 'identity safety stop: the open chart is a different patient than this read expects and could not be verified' })
  });
  const detR = await det.api._runHistoryBatch(det.rows, [], det.onStatus, {});
  eq(Number(detR.todayNoteFailures || 0), 3, 'the deterministic-refusal control did not refuse three notes');
  eq(Number(detR.todayNoteQueued || 0), 0,
    'the control failed: a DETERMINISTIC identity refusal was queued for retry, so tnDeferRow now queues everything rather than the retryable classes');
  eq(Number(detR.todayNoteUnreadFinal || 0), 3,
    'a deterministic day-facts refusal must be reported to the doctor as finally unread, not silently parked');

  /* the idle feed adopts a day-facts receipt's leftovers exactly as it adopts
     an ON receipt's -- the mode may no longer change the answer. */
  function leftovers(visitNotesRequested) {
    return { visitNotesRequested: visitNotesRequested, day: DAY, patients: [
      { patientId: 'syn-01', todayNote: false, todayNoteReason: 'pull-in-flight' },
      { patientId: 'syn-02', todayNote: false, todayNoteReason: 'pulled-day-note-deadline-exceeded' }
    ] };
  }
  eq(dayFactsHarness().api._notesIdleSyncFromReceipt(leftovers(false), DAY), 2,
    'niSyncFromReceipt refuses a day-facts receipt\'s leftovers again -- an OFF row\'s mandatory pulled-day note would never be retried');
  eq(dayFactsHarness().api._notesIdleSyncFromReceipt(leftovers(true), DAY), 2,
    'niSyncFromReceipt stopped adopting an ON receipt\'s leftovers, so the OFF result above proves nothing');

  /* CONTROL: mode-blind is not queue-blind. A row the deferred round still
     owns must STILL be refused here, or it lands in two queues at once. */
  eq(dayFactsHarness().api._notesIdleSyncFromReceipt(
    { visitNotesRequested: false, day: DAY, patients: [
      { patientId: 'syn-01', todayNote: false, todayNoteReason: 'pull-in-flight', todayNoteDeferred: true }] }, DAY), 0,
    'the control failed: the idle feed adopted a row the deferred round still owns -- the same note is now in two queues');
}

/* The idle lane's refusal and its consumer speak the SAME word again: an
   unchosen account paints "paused" and stops its clock rather than ticking
   forever against a gate that can never open. */
async function unchosenIdleLanePausesAndStopsItsClock() {
  const h = dayFactsHarness();
  eq(h.api._notesIdleSyncFromReceipt(
    { visitNotesRequested: true, day: DAY, patients: [{ patientId: 'syn-01', todayNote: false, todayNoteReason: 'pull-in-flight' }] },
    DAY), 1, 'the fixture failed to queue a leftover row, so the state below proves nothing');
  /* a queued row means the lane has a reason to run: arm the clock, and prove
     it is armed, so "none" below is a STOP and not merely a clock that never
     started. */
  h.api.notesIdleResume();
  ok(h.api._notesIdle().timerKind !== 'none',
    'the idle clock never armed on a queued row, so the stop below would prove nothing');
  eq(h.api._notesIdle().state, 'waiting', 'a queued row with a settled preference should leave the lane waiting');

  h.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: false, settled: false }),
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, reason: 'unchosen' }),
    write: () => true, isPrefKey: () => false
  };
  eq(h.api._notesIdleGate(false).reason, 'visit-notes-unchosen',
    'the idle gate stopped naming the unchosen account, so the state below would be reached for a different reason');
  await h.api._notesIdleTick();
  await flush(3);
  const ni = h.api._notesIdle();
  eq(ni.gateReason, 'visit-notes-unchosen', 'the idle receipt lost the gate reason it was refused with');
  eq(ni.state, 'paused',
    'an unchosen idle lane paints "' + ni.state + '" instead of "paused" -- niRunOne is comparing against a reason its gate can no longer answer');
  eq(ni.timerKind, 'none',
    'the unchosen idle lane never stopped its clock: it keeps ticking against a gate that can never open');
}

/* ---------------------------------------------------------------------------
   P. The last two dayfacts-1.0.1 deltas, pinned in BOTH connect twins.
      P1 -- the PERSISTED terminal receipt (the record the doctor and support
      read back later) must call a settled OFF pull "day-facts" too; the mode
      vocabulary is one word at EVERY level, including the stored one.
      P2 -- the UNSCOPED save door must be no softer than the day-scoped one:
      enabled() now demands a SETTLED explicit ON, so a provisional
      placeholder-namespace "on" can never open every historical body.
   ------------------------------------------------------------------------- */
[['mls-connect.js', connect], ['1p-mls-connect.js', connect1p]].forEach(function (pair) {
  const name = pair[0], src = pair[1];
  ok(src.includes("visitNotes: { requested: requested, mode: requested === true ? 'full' : (hr.visitNotesMode === 'blocked-unchosen' ? 'blocked-unchosen' : (requested === false ? 'day-facts' : 'unknown'))"),
    name + ': the PERSISTED terminal receipt records a settled OFF pull as day-facts and a blocked-unchosen refusal under its OWN mode');
  ok(!/mode: requested === true \? 'full' : \(requested === false \? 'not-requested'/.test(src),
    name + ': the persisted terminal receipt speaks the revoked "not-requested" mode again');
  ok(src.includes("return !!(choice && choice.settled === true && choice.state === 'on' && choice.on === true);"),
    name + ': __mlsVisitSavePref.enabled() stopped requiring a SETTLED choice -- the unscoped door is softer than the day-scoped one');
  ok(!src.includes("return !!(choice && choice.state === 'on' && choice.on === true);"),
    name + ': the pre-1.0.1 enabled() is back -- an unsettled provisional "on" would open every historical body');
});

/* The revoked "OFF opens no charts" copy is GONE from all three surfaces, and
   the replacement says the true thing. Absence alone is not enough: a deleted
   string is also absent, so each site is pinned by its NEW words. */
const REVOKED_COPY = [
  ['mls-connect.js (guided tour)', connect, 'OFF reads schedule rows only and opens no chart/history.'],
  ['1p-mls-connect.js (guided tour)', connect1p, 'OFF reads schedule rows only and opens no chart/history.'],
  ['mls-connect.js (day-strip tooltip)', connect, 'Off: read schedule rows only — no patient chart or history is opened.'],
  ['1p-mls-connect.js (day-strip tooltip)', connect1p, 'Off: read schedule rows only — no patient chart or history is opened.'],
  ['ScribeFlow.html (Settings toast)', flow, 'Pulls now read schedule rows only — no patient chart or history is opened.']
];
REVOKED_COPY.forEach(function (site) {
  ok(!site[1].includes(site[2]),
    site[0] + ': the revoked "OFF opens no charts" claim is back in shipped copy');
});
const TRUE_COPY = [
  ['mls-connect.js (guided tour)', connect, '“Full visit notes” chooses depth, not whether charts open: OFF still reads each scheduled chart’s facts and its own-day note; ON adds every dated historical encounter note.'],
  ['1p-mls-connect.js (guided tour)', connect1p, '“Full visit notes” chooses depth, not whether charts open: OFF still reads each scheduled chart’s facts and its own-day note; ON adds every dated historical encounter note.'],
  ['mls-connect.js (day-strip tooltip)', connect, 'On: also save every dated historical encounter note (slower, stores more). Off: each chart’s facts and its own-day note only (faster, stores less).'],
  ['1p-mls-connect.js (day-strip tooltip)', connect1p, 'On: also save every dated historical encounter note (slower, stores more). Off: each chart’s facts and its own-day note only (faster, stores less).'],
  ['ScribeFlow.html (Settings toast)', flow, 'Pulls will read each chart’s facts and its own-day note — historical visit notes are skipped.']
];
TRUE_COPY.forEach(function (site) {
  ok(site[1].includes(site[2]),
    site[0] + ': the corrected OFF copy is gone -- this surface no longer tells the doctor that OFF still reads chart facts and the own-day note');
});
/* a whole-surface sweep: no shipped file may claim, in any new wording, that a
   pull reads "schedule rows only". UNSET is the one state that opens nothing,
   and it is described as unset, never as OFF. */
[['mls-connect.js', connect], ['1p-mls-connect.js', connect1p], ['ScribeFlow.html', flow]].forEach(function (pair) {
  ok(!/(Off|OFF)[^\n]{0,60}(read|reads)[^\n]{0,20}schedule rows only/.test(pair[1]),
    pair[0] + ': a surface describes OFF as "schedule rows only" again');
});

async function main() {
  await dayFactsAttemptsThePulledDayNote();
  await fullNotesOnIsASuperset();
  await unchosenBlocksEveryRead();
  await inlineFuseTripsAndClears();
  await offDayPullEnvelopeSaysDayFacts();
  await deferrableDayFactsRefusalsReachTheRecoveryLanes();
  await unchosenIdleLanePausesAndStopsItsClock();
  await flush(3);
  console.log('PASS visit-pull toggle (dayfacts-1.0.1 final): ' + checks + ' checks - unset is fail-closed "visit-notes-unchosen" with zero reads; settled OFF runs the day-facts batch and PROVABLY attempts exactly one date-scoped pulled-day note per row, folded in beside that row\'s own verified chart open (3 charts, 3 saves, 3 onlyDate reads, 0 unscoped walks, todayNoteNotRequested 0); ON is a superset with one unscoped walk per patient and no duplicate scoped pass; includeHistory is decoupled from the checkbox at all three doors; "day-facts" is the one mode word at every envelope level INCLUDING the persisted terminal receipt; no message claims OFF opens no charts.');
  console.log('       recovery lanes serve BOTH modes (was the last reported gap): 3 of 3 deferrable day-facts refusals are queued to the deferred round and stamped as its own rows (todayNoteUnreadFinal 0), while the deterministic-identity control is queued 0 of 3 and stays finally unread; the idle feed adopts an OFF receipt\'s leftovers 2 of 2 exactly as an ON receipt\'s, and still refuses a row the deferred round owns; an unchosen idle lane paints "paused" and stops its clock (timerKind none) after arming it; the unscoped save door requires a SETTLED on in both twins. NO ENGINE GAP OUTSTANDING - nothing forced green.');
}

const watchdog = setTimeout(() => {
  console.error(new Error('visit-pull-toggle-contract did not finish'));
  process.exit(1);
}, 120000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
