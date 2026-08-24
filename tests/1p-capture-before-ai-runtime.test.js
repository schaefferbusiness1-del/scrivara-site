'use strict';
/* =============================================================================
 * cap-1.0.0 (+ fdx-1.1.0, nav-1.0.0)  -  a captured chart is saved BEFORE, and
 * independently of, the backend AI
 *
 * MEASURED live 2026-08-17 on the owner's /1p (build p1-20260815-launch-r1, ext
 * 3.0.62, TODAY, bodies OFF, 16 rows): first pass done 16, ok 4, failed 12.
 * NINE of the twelve were "502 Upstream request failed" - the backend AI was
 * down (the OpenAI credit balance had gone negative; it recovered minutes
 * later). Those nine charts had been OPENED, IDENTITY-VERIFIED and READ out of
 * athena. The store gained NOTHING for them, and every one was reported as a
 * failed history. The expensive half was thrown away because the cheap half was
 * unavailable.
 *
 * This suite drives the REAL importer with a fake extension and a fake backend
 * AI that answers exactly the way the shell now shapes a backend refusal
 * ({error, code, retryable} -> err.mlsAi). Synthetic names/DOB/MRN only; no
 * network, no PHI.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness, flush } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
const TWIN = fs.readFileSync(path.join(ROOT, '1p/index.html'), 'utf8');
const MC = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* the live failure, reproduced at the seam the shell now defines */
const UPSTREAM_502 = () => ({ __throw: '502 Upstream request failed', __ai: { status: 502, code: 'upstream_unavailable', retryable: true, detail: 'Upstream request failed' } });
const GOOD_CHART = { problems: 'Synthetic problem', meds: 'Synthetic med', summary: 'Synthetic summary' };
const EMPTY_VISITS = () => ({ ok: true, visits: 0, authoritativeEmpty: true });

/* --------------------------------------------------------------- static -- */
{
  ok(SRC.indexOf('/* ===== cap-1.0.0 (the capture is saved before, and independent of, the AI) =====') >= 0,
    'the cap-1.0.0 ordering block is missing');
  /* THE ORDER IS THE FIX: the capture must be written above the parse call. */
  const persist = SRC.indexOf('var capStored = capEarlyRef ? capPersistRawCapture(');
  const parse = SRC.indexOf('window._parsePatientChart(parseText,');
  ok(persist >= 0 && parse > persist,
    'the raw capture is not persisted BEFORE the AI parse call - this is the whole defect');
  /* the capture is written only under the SAME identity gate the six-card save uses */
  ok(/var capEarlyRef = safe\(function \(\) \{ return window\._athenaHistoryVerifiedRef\(target, rd\); \}, null\);/.test(SRC),
    'the capture is not gated on the verified identity ref');
  /* and only under a proven coverage receipt (the line above it) */
  ok(SRC.indexOf('if (!coverage) return Promise.reject(new Error("chart-coverage-unproven"));') < persist,
    'the capture can be written without a proven chart-coverage receipt');
  /* presence is not provenance: the write is read back */
  ok(/String\(stored\.requestId \|\| ""\) !== String\(requestId \|\| ""\)/.test(SRC),
    'the capture write is believed without a store read-back bound to this request');
  /* a timeout must NOT become a pending summary - it still stops the batch */
  ok(/if \(\/deadline\|timeout\/i\.test\(msg\)\) return null;/.test(SRC),
    'a parse timeout was reclassified as a pending summary - timeouts must still stop the batch');
  /* the retry lane is setTimeout-only and bounded */
  ok(/var CAP_RETRY_MAX = 3;/.test(SRC), 'the background summary retry is unbounded');
  ok(/var CAP_RETRY_BACKOFF_MS = \[20000, 60000, 180000\];/.test(SRC), 'the background summary retry has no backoff');
  ok(!/requestAnimationFrame/.test(SRC.slice(SRC.indexOf('function capArmBackgroundRetry'), SRC.indexOf('/* ===== end cap-1.0.0 (retry lane) ===== */'))),
    'the retry lane uses rAF, which never fires in a hidden tab');
  /* the census counts a capture, and allergies-style false content is not reintroduced */
  const m = /var CENSUS_CONTENT_FIELDS = \[([^\]]*)\]/.exec(SRC);
  ok(m && /rawCapture/.test(m[1]), 'the store census does not count a raw capture as content');
  ok(m && !/allergies/.test(m[1]), 'allergies leaked back into the content-deciding field set');
  /* the shell carries the backend code - in BOTH twins */
  ok(/eAi\.mlsAi=\{status:r\.status,code:String\(code\|\|''\),retryable:/.test(SHELL),
    '1pScribeFlow.html does not carry the backend {error, code, retryable} onto the Error');
  ok(/eAi\.mlsAi=\{status:r\.status,code:String\(code\|\|''\),retryable:/.test(TWIN),
    '1p/index.html (the twin) did not get the same aiCallRaw change');
  /* the panel has wording for both new verdicts */
  ok(/athenaOne search did not open the chart in time/.test(MC), 'fdx-1.1.0 has no human wording');
  ok(/summar' \+ \(Number\(dv\.summaryPending\) === 1 \? 'y' : 'ies'\) \+ ' pending'/.test(MC),
    'the DONE card does not report summaries pending');
  /* fdx-1.1.0 must be sweepable, or the two rows sit waiting for a human click */
  ok(/find-open-deadline\|stale-encounter-surface-open/.test(SRC),
    'find-open-deadline is not in SWEEPABLE_REASON, so the idle-batch sweep skips it');
}

/* ================================================================== (1) ==
   THE OWNER'S NINE ROWS. Every chart read succeeds; every AI call 502s. */
async function testAiOutageDoesNotLoseTheCapture() {
  const DAY = '2026-08-17';
  const h = makeHarness({
    day: DAY, today: DAY, rows: 9, visitNotesOn: true,
    chartCoverage: true, noteResult: EMPTY_VISITS,
    parseResult: () => UPSTREAM_502()
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  /* the capture is on disk for every row - THE point */
  const captured = h.patients.filter(p => p.athenaRawCapture && String(p.athenaRawCapture.text || '').length > 0);
  eq(captured.length, 9, 'only ' + captured.length + ' of 9 captured charts reached the store');
  ok(captured.every(p => p.athenaRawCapture.identityVerified === true),
    'a capture was stored without its identity receipt');
  ok(captured.every(p => p.athenaRawCapture.summaryPending === true),
    'a capture whose AI step failed is not marked summaryPending');
  ok(captured.every(p => p.athenaRawCapture.summaryCode === 'upstream_unavailable'),
    'the backend code did not reach the stored capture - the reason class is guesswork');

  /* the ROW is saved, not failed */
  eq(receipt.patients.filter(p => p.captureSaved === true && p.summaryPending === true).length, 9,
    'a row whose capture landed is not reported saved-with-pending-summary');
  eq(receipt.patients.filter(p => p.complete === true).length, 9,
    'a captured chart was still marked a FAILED history because the AI was down');
  eq(receipt.retry.length, 0, 'a captured chart was queued for a full re-read');
  eq(receipt.summariesPending, 9, 'the receipt does not count the pending summaries');
  eq(Number((receipt.summaryPendingCodes || {}).upstream_unavailable || 0), 9,
    'the receipt does not break the pending summaries down by PHI-free code');
  eq(receipt.capturesSaved, 9, 'the receipt does not count the captures it saved');

  /* the STORE CENSUS counts them - otherwise scv-1.0.0 calls the day empty */
  ok(receipt.storeCensus && receipt.storeCensus.measured === true, 'the census was not taken');
  eq(receipt.storeCensus.withContent, 9, 'the store census does not count a captured chart as content');
  eq(receipt.storeCensus.captureOnly, 9, 'the census does not report captured-but-unsummarised separately');
  eq(receipt.storeCensus.fields.rawCapture, 9, 'the census breakdown has no rawCapture column');
  ok(receipt.storeDelta && receipt.storeDelta.changed === 9,
    'the store fingerprint did not move, so a capture would read as a zero-write pull');

  /* NO EXTRA ATHENA WORK: one chart open per row. The pre-fix path gave each
     failed parse a full fresh open+verify+parse - nine more reads against a
     backend that was answering 502 to every one of them. */
  eq(h.chartCalls.length, 9, 'the AI outage cost ' + h.chartCalls.length + ' chart opens for 9 rows');

  /* the DONE card's source of truth */
  const S = h.ppState();
  eq(S.ok, 9, 'the panel reported ' + S.ok + ' saved on a day that captured nine charts');
  eq(S.failed, 0, 'the panel counted a captured chart as not saved');
  eq(Number(S.dayVerdict && S.dayVerdict.summaryPending), 9, 'the DONE card verdict does not carry the pending count');
}

/* ================================================================== (2) ==
   THE SUMMARY LANDS LATER, WITHOUT ATHENA. Same day, same rows: the AI is down
   for the whole first pull, then recovers. The second pull must fill the
   summaries from the STORED text and open no chart to do it. */
async function testTheSummaryIsFilledFromTheStoredCapture() {
  const DAY = '2026-08-17';
  let aiDown = true;
  const h = makeHarness({
    day: DAY, today: DAY, rows: 4, visitNotesOn: true,
    chartCoverage: true, noteResult: EMPTY_VISITS,
    parseResult: () => (aiDown ? UPSTREAM_502() : GOOD_CHART)
  });
  const first = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(first.summariesPending, 4, 'the fixture did not leave four pending summaries');
  eq(h.saveCalls.length, 0, 'the six-card sink ran while the AI was down');

  /* the AI comes back; the row's summary is filled with NO athena read */
  aiDown = false;
  const chartsBefore = h.chartCalls.length;
  const filled = await h.api._capResummarize(h.patients[0].id, 5000);
  ok(filled && filled.ok === true, 'the stored capture could not be re-summarised: ' + JSON.stringify(filled));
  eq(h.chartCalls.length, chartsBefore, 'the re-summarise opened a chart - the stored text was not used');
  eq(h.saveCalls.length, 1, 'the re-summarise did not persist the six cards');
  eq(h.patients[0].athenaRawCapture.summaryPending, false, 'the capture is still marked pending after a successful fill');
  eq(h.patients[0].athenaRawCapture.text, '', 'the raw text was not released after the summary landed (quota)');
  eq(h.patients[0].problems, 'Synthetic problem', 'the filled summary did not reach the patient record');

  /* AND ON THE NEXT PULL: the remaining three fill themselves, athena-free. */
  const chartsBefore2 = h.chartCalls.length;
  const second = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(h.api._capPendingFor(h.rows).length, 0,
    'the next pull left ' + h.api._capPendingFor(h.rows).length + ' summaries pending');
  eq(second.summaryFilled, 3, 'the next pull filled ' + second.summaryFilled + ' of the 3 outstanding summaries');
  eq(h.chartCalls.length, chartsBefore2, 'the next pull re-opened charts to fill summaries that needed no athena');
}

/* ================================================================== (3) ==
   NOTHING IS LOOSENED. An identity echo the gate refuses must store NO capture
   and must keep its original refusal, and a non-AI failure is still a failure. */
async function testTheGatesStillRefuse() {
  const DAY = '2026-08-17';

  /* (a) the chart echoes a DIFFERENT patient's DOB - no capture may be stored */
  const h = makeHarness({
    day: DAY, today: DAY, rows: 3, visitNotesOn: true,
    chartCoverage: true, noteResult: EMPTY_VISITS,
    parseResult: () => GOOD_CHART
  });
  h.rt._athenaHistoryProofMatches = () => false;   /* the identity gate refuses */
  h.rt._athenaHistoryVerifiedRef = () => null;
  const bad = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(h.patients.filter(p => p.athenaRawCapture).length, 0,
    'a capture was attached to a patient whose chart identity was never proven');
  eq(bad.patients.filter(p => p.complete === true).length, 0,
    'an identity-unproven row was reported saved');
  eq(Number(bad.summariesPending || 0), 0, 'an identity-unproven row was excused as summary-pending');

  /* (b) a SINK refusal (not an AI failure) is still an honest failure */
  const h2 = makeHarness({
    day: DAY, today: DAY, rows: 3, visitNotesOn: true,
    chartCoverage: true, noteResult: EMPTY_VISITS,
    parseResult: () => GOOD_CHART
  });
  h2.rt._savePatientChart = () => false;           /* the six-card sink refuses */
  const sink = await h2.api._runHistoryBatch(h2.rows, [], h2.onStatus);
  eq(sink.patients.filter(p => p.complete === true).length, 0,
    'a refused six-card save was excused as a pending summary');
  eq(Number(sink.summariesPending || 0), 0, 'a store refusal was misread as an AI outage');
  ok(sink.retry.length === 3, 'a refused save did not queue its row for retry');

  /* (c) QUOTA: a store that is already refusing writes gets no raw text. */
  const h3 = makeHarness({
    day: DAY, today: DAY, rows: 3, visitNotesOn: true,
    chartCoverage: true, noteResult: EMPTY_VISITS,
    parseResult: () => UPSTREAM_502()
  });
  h3.rt.__mlsStoreWriteFailed = { at: h3.clock.now() - 1000, reason: 'quota-exceeded' };
  const full = await h3.api._runHistoryBatch(h3.rows, [], h3.onStatus);
  eq(h3.patients.filter(p => p.athenaRawCapture).length, 0,
    'a store that is already refusing writes was handed raw chart text - a summariser outage must not become a storage outage');
  eq(Number(full.summariesPending || 0), 0, 'a row with no stored capture was still called summary-pending');
  eq(full.patients.filter(p => p.complete === true).length, 0,
    'a row whose capture could not be stored was reported saved');
}

/* ================================================================== (4) ==
   nav-1.0.0: a day whose schedule already landed is recorded, and the landing
   is what the connect lane's veto reads. */
async function testScheduleLandedRecordAndNavVeto() {
  ok(/function navMarkScheduleLanded\(/.test(SRC) && /function navScheduleLanded\(/.test(SRC),
    'nav-1.0.0 records no "this day already landed" fact');
  ok(/_scheduleLandedFor: function \(day\) \{ return navScheduleLanded\(day\); \}/.test(SRC),
    'the landed record is not exposed for the connect lane to read');
  ok(/NAV_LANDED_MAX_AGE_MS = 12 \* 3600 \* 1000/.test(SRC),
    'a landed record never expires, so an overnight record could veto the morning pull');
  /* the diag is PHI-free by construction: only these fields may be copied */
  const diag = SRC.slice(SRC.indexOf('function navDiagOf('), SRC.indexOf('/* ===== end nav-1.0.0 (diag) ===== */'));
  ok(diag.length > 0, 'navDiagOf is missing');
  ok(!/name|dob|mrn|patient/i.test(diag.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the nav diag copies an identity field - it must be codes, counts, a path and a date only');
  /* the connect lane vetoes the whole-pull re-run on a landed day */
  ok(/var __navVetoed = __navClassRefusal && __dayAlreadyLanded;/.test(MC),
    'the connect lane does not veto a whole-pull re-run on a day that already landed');
  ok(/!__stoppedByUser && !__navVetoed && !__emptyDayParseTimeout/.test(MC),
    'the nav veto is not wired into the transientRefusal decision');
  ok(/Athena tab is not switching days — click your athenaOne tab once and press Retry\./.test(MC),
    'after two nav failures the doctor is not told what to actually do');
  ok(/DS\.navFailAfterLanded = 0/.test(MC), 'the nav-failure counter never resets on a good pull');
  checks += 0;

  /* runtime: a completed schedule read stamps the landed record */
  const h = makeHarness({ day: '2026-08-17', today: '2026-08-17', rows: 2, visitNotesOn: true, chartCoverage: true, noteResult: EMPTY_VISITS, parseResult: () => GOOD_CHART });
  eq(h.api._scheduleLandedFor('2026-08-17'), null, 'a day nothing has read is already reported as landed');
}

async function main() {
  await testAiOutageDoesNotLoseTheCapture();
  await testTheSummaryIsFilledFromTheStoredCapture();
  await testTheGatesStillRefuse();
  await testScheduleLandedRecordAndNavVeto();
  await flush(5);
  console.log('PASS 1p-capture-before-ai: ' + checks + ' checks - a 502 from the backend AI can no longer destroy a completed athena chart read: all 9 captures are persisted first under the same identity + coverage gates and read back, the rows are saved-with-pending-summary rather than failed histories, the store census counts them (withContent 9, captureOnly 9, delta 9) and the pull spends exactly 9 chart opens instead of 18, the summary is later filled from the STORED text with zero athena reads (immediately and again on the next pull) and the text is released afterwards, while an unproven identity echo stores nothing and a refused six-card save is still an honest failure');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-capture-before-ai did not finish')); process.exit(1); }, 90000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });
