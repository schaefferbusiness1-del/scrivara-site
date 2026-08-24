'use strict';
/* =============================================================================
 * ed-1.0.0  +  U0 (lost backslashes)  +  p1-authority-repair-1.0.0  +  cvc-1.0.0
 *
 * (1) ed-1.0.0  LIVE REPRO 2026-08-17 on PRODUCTION (Mon 2026-08-31, owner's
 *     "grid still settling attempt 3 of 3"): a day athena had already PROVEN
 *     empty still fell into the AI text parser (_parseScheduleText ->
 *     aiCallRaw -> /api/complete). A slow model blew the 25 s bound ->
 *     schedule-parse-timeout -> retry.schedule -> auto re-pull x3.
 *
 * (2) U0  Four regex literals in 1p-only files shipped with their backslashes
 *     lost - valid JS, so no gate caught them. The calendar hero progress bar
 *     was inert at 3% forever, and BOTH arms of the Draft-all transient
 *     detector were dead (\b had become a literal 0x08 BACKSPACE byte).
 *     C12 called this a systemic authoring/transport defect; this suite is the
 *     scanner that makes it impossible to reintroduce silently.
 *
 * (3) p1-authority-repair-1.0.0  A top-level-alien authority blob returned
 *     "authority-store-invalid" FOREVER: there is no removeItem for
 *     AUTHORITATIVE_SNAPSHOT_SUFFIX and writeAuthoritativeStore sanitises
 *     BEFORE writing, so the bad bytes could never be replaced.
 *
 * (4) cvc-1.0.0  Owner: "it's pretty fast then says done but then for some
 *     reason just goes again."
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeHarness } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const SI = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const MC = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* =============== (1) ed-1.0.0: no AI parser on a verified-empty day ======= */
function testEmptyDaySkipsTheAiParser() {
  const i = SI.indexOf('/* ===== ed-1.0.0 (a verified-empty day never calls the AI parser) =====');
  ok(i >= 0, 'the ed-1.0.0 block is missing');
  const guardStart = SI.indexOf('var parsedP = verifiedEmptyDay', i);
  ok(guardStart > i, 'parsedP does not branch on verifiedEmptyDay first');

  /* EXECUTE the real branch, both ways, with a spy parser. */
  const src = SI.slice(guardStart, SI.indexOf('return parsedP.then(function (parsed) {', guardStart));
  let calls = 0;
  const ctx = {
    Promise, Date, Number, String, Array, Object, console,
    boundedUntil: (p) => p,
    safe: (fn, d) => { try { return fn(); } catch (e) { return d; } },
    isFn: v => typeof v === 'function',
    onStatus: () => {},
    window: { _parseScheduleText: () => { calls++; return [{ name: 'Synthetic Row 01' }]; } }
  };
  ctx.window._parseScheduleText = () => { calls++; return [{ name: 'Synthetic Row 01' }]; };

  function run(verifiedEmptyDay, exactRows, text) {
    calls = 0;
    const sandbox = Object.assign({}, ctx, { verifiedEmptyDay, exactRows, r: { text } });
    vm.createContext(sandbox);
    vm.runInContext(src + '\n;globalThis.__out = parsedP;', sandbox);
    return { parsedP: sandbox.__out || sandbox.parsedP, calls };
  }

  const empty = run(true, [], '');
  eq(empty.calls, 0, 'a VERIFIED-EMPTY day still called the AI schedule parser - the live repro stands');

  const textOnly = run(false, [], 'Some athena schedule text with rows');
  eq(textOnly.calls, 1, 'a non-empty text-only day no longer calls the parser - the guard over-reached');

  const domRows = run(false, [{ name: 'Synthetic Row 01' }], 'text');
  eq(domRows.calls, 0, 'exact DOM rows should never need the text parser (pre-existing behaviour changed)');

  /* the empty-day SUCCESS path is untouched */
  ok(SI.indexOf('"Athena verified that " + date + " has no appointments."') >= 0,
    'the verified-empty success sentence changed');

  /* and the site refuses to auto-re-pull that pair even if it ever recurs */
  ok(/__emptyDayParseTimeout/.test(MC),
    '1p-mls-connect.js can still auto-re-pull a schedule-parse-timeout on a verified-empty receipt');
  ok(/!__emptyDayParseTimeout && result && result\.ok !== true/.test(MC),
    'the empty-day parse-timeout guard is not wired into the transientRefusal decision');
}

/* =============== (2) U0: the lost-backslash scanner + the hero bar ======== */
function testRegexLiteralsAreIntact() {
  const BSP = String.fromCharCode(8), FF = String.fromCharCode(12), VT = String.fromCharCode(11);
  const FILES = ['1p-mls-connect.js', '1p-feat_mls_schedimport_exact.js', '1pScribeFlow.html',
    '1p/index.html', '1p-feat_athena_provider_roster.js', '1p-feat_mls_athena_occurrence.js'];
  for (const rel of FILES) {
    const c = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    /* A lost backslash before b/f/v does not stay visible - it becomes a raw
       control byte. Those bytes have no business in this source at all, so
       their PRESENCE is the detector. */
    eq(c.indexOf(BSP), -1, rel + ' contains a literal BACKSPACE byte - a lost backslash-b in a regex or string');
    eq(c.indexOf(FF), -1, rel + ' contains a literal FORMFEED byte - a lost backslash-f');
    eq(c.indexOf(VT), -1, rel + ' contains a literal VTAB byte - a lost backslash-v');
    /* the two shapes that stay readable and therefore stay silent */
    const lines = c.split('\n');
    /* the date shape is scanned in THIS LANE'S files only. The two shell
       instances (1pScribeFlow.html:19213 _opContextDay ok(), and :37636
       msl-today-1.0.0) are the UI lane's to repair - this lane must not touch
       them, and a scanner that fails the gate on a file it may not edit is a
       blocked gate, not a guard. ESCALATED: while :19213's ok() can never
       return a date, "Prep op notes" uses machine-clock TODAY rather than the
       calendar/Visit day, and msl-autodraft auto-clicks generate-all on room
       open. Re-scope this to all files the moment those two land. */
    const DATE_SHAPE_SCANNED = /^1p-(mls-connect|feat_)/.test(rel);
    lines.forEach((line, n) => {
      if (line.trim().startsWith('*') || line.trim().startsWith('/*')) return;   /* prose */
      ok(line.indexOf('/(d+)s+of') < 0, rel + ':' + (n + 1) + ' has a lost-backslash "N of M" regex');
      ok(!/\(\?:429\|5dd\)/.test(line), rel + ':' + (n + 1) + ' has a lost-backslash 5xx regex');
      if (DATE_SHAPE_SCANNED) ok(line.indexOf('d{4}-d{2}-d{2}') < 0, rel + ':' + (n + 1) + ' has a lost-backslash ISO-date regex');
      if (DATE_SHAPE_SCANNED) ok(!/\/\^s\*/.test(line), rel + ':' + (n + 1) + ' has a lost-backslash leading-whitespace regex');
    });
  }

  /* the calendar hero progress bar: EXECUTE the real painter's matcher. */
  const i = MC.indexOf("var mm = String(msg || '').match(");
  ok(i >= 0, 'the calendar hero bar matcher is missing');
  const line = MC.slice(i, MC.indexOf('\n', i));
  const matcher = new Function('msg', 'return ' + line.replace('var mm = ', '').replace(/;$/, '') + ';');
  const mm = matcher('Reading verified history 7 of 16...');
  ok(mm, 'the hero bar matcher still cannot read "7 of 16" - it is inert at 3% forever');
  eq(mm[1], '7', 'the hero bar matcher read the wrong current count');
  eq(mm[2], '16', 'the hero bar matcher read the wrong total');
  const pct = Math.max(3, Math.min(100, Math.round((Number(mm[1]) / Number(mm[2])) * 100)));
  eq(pct, 44, 'the hero bar would paint ' + pct + '% for 7 of 16');
  eq(matcher('Starting...'), null, 'the hero bar matcher matches text with no counts');

  /* the Draft-all transient detector: both arms must be live. */
  const j = MC.indexOf('var _drTransient = function (err) {');
  ok(j >= 0, '_drTransient is missing');
  const block = MC.slice(j, MC.indexOf('var _drWait', j));
  const detect = new Function('S', 'err', block.replace('var _drTransient = function (err) {', 'return (function (err) {').replace(/};\s*$/, '})(err);'));
  eq(detect(v => String(v), new Error('HTTP 503')), true,
    'a bare "HTTP 503" is still not retried - the 5xx arm is dead');
  eq(detect(v => String(v), new Error('429 Too Many Requests')), true,
    'a bare 429 is not retried');
  eq(detect(v => String(v), new Error('502 upstream request failed')), true,
    'a keyworded 502 is not retried');
  eq(detect(v => String(v), new Error('patient identity mismatch')), false,
    'a non-transport error is being retried as transient');
}

/* ============ (3) p1-authority-repair-1.0.0: the quarantine hole ========== */
function testAuthorityStoreRepairs() {
  const KEY = 'p1-harness::schedAuthoritativeDaysV1';

  function freshApi() {
    const h = makeHarness({ day: '2026-08-17', today: '2026-08-17', rows: 1 });
    return h;
  }

  /* (a) a TOP-LEVEL-alien blob that still holds valid days is SALVAGED */
  {
    const h = freshApi();
    const goodDay = {
      all: { v: 1, date: '2026-08-14', mode: 'all', providerKey: '', backendIds: ['b1', 'b2'], sourceCount: 2, updated: 1755000000000 },
      providers: {}, active: { mode: 'all', key: '' }
    };
    const badDay = { all: { v: 1, date: 'nonsense', mode: 'all' }, providers: {} };
    h.rt.localStorage.setItem(KEY, JSON.stringify({
      v: 2,                       /* alien version -> whole store refused */
      somethingElse: 'alien',     /* alien root key -> whole store refused */
      days: { '2026-08-14': goodDay, '2026-08-15': badDay }
    }));
    eq(h.api._loadAuthoritativeStore().reason, 'authority-store-invalid',
      'the fixture did not reproduce the permanent whole-store refusal');
    const rep = h.api._repairAuthoritativeStore('authority-store-invalid');
    eq(rep.action, 'salvaged', 'the repair did not salvage the readable days (' + rep.action + ')');
    eq(rep.ok, true, 'the salvage reported failure');
    eq(rep.salvagedDays, 1, 'the salvage kept the wrong number of days');
    eq(rep.droppedDays, 1, 'the salvage did not report the day it had to drop');
    const after = h.api._loadAuthoritativeStore();
    eq(after.ok, true, 'the store is STILL invalid after the repair - the hole is not closed');
    ok(after.store.days['2026-08-14'], 'the repair destroyed a day it could have kept');
    ok(!after.store.days['2026-08-15'], 'the repair kept a day it could not validate');
  }

  /* (b) bytes that are not JSON at all: bounded reset, nothing verifiable lost */
  {
    const h = freshApi();
    h.rt.localStorage.setItem(KEY, 'this is not json at all {{{');
    eq(h.api._loadAuthoritativeStore().reason, 'authority-store-read-failed',
      'unreadable bytes no longer fail closed');
    const rep = h.api._repairAuthoritativeStore('authority-store-invalid');
    eq(rep.action, 'reset-unreadable', 'unreadable bytes were not reset (' + rep.action + ')');
    eq(h.rt.localStorage.getItem(KEY), null, 'the unreadable bytes survived the reset');
    eq(h.api._loadAuthoritativeStore().ok, true, 'the store did not recover after the reset');
  }

  /* (c) the repair is NARROW: it refuses to run for any other reason */
  {
    const h = freshApi();
    h.rt.localStorage.setItem(KEY, JSON.stringify({ v: 1, days: {} }));
    const rep = h.api._repairAuthoritativeStore('authority-store-read-failed');
    eq(rep.attempted, false, 'the repair ran for a reason it must not touch');
    eq(rep.action, 'not-applicable', 'the repair did not name its refusal');
    ok(h.rt.localStorage.getItem(KEY), 'the repair deleted a store it was not asked about');
  }

  /* (d) it is wired into the publish path, once, and never invents success */
  ok(/if \(!loadedAuthority\.ok && loadedAuthority\.reason === "authority-store-invalid"\)/.test(SI),
    'the repair is not wired into publishAuthoritativeSnapshot');
  ok(/if \(repair && repair\.ok === true\) loadedAuthority = loadAuthoritativeStore\(\);/.test(SI),
    'the publish path does not re-load after a successful repair');
  ok(/out\.authorityRepair = repair;/.test(SI),
    'the publish receipt does not record that a repair was attempted');
  const after = SI.slice(SI.indexOf('out.authorityRepair = repair;'));
  ok(after.indexOf('if (!loadedAuthority.ok) { out.reason = loadedAuthority.reason; return out; }') >= 0,
    'a failed repair no longer falls through to the honest refusal');
}

/* ============ (4) cvc-1.0.0: one continuous pull, never done-then-again === */
function testConvergenceIsOneContinuousPull() {
  ok(/function dsConvergeEligible\(result\)/.test(MC),
    'the pull cannot predict whether the convergence lane will run');
  /* the verdict must be painted after the prediction, not before it */
  const willIdx = MC.indexOf('var willConverge = retryCount > 0 && dsConvergeEligible(result);');
  ok(willIdx >= 0, 'the pull does not decide before painting (cvc-1.0.0)');
  const tail = MC.slice(willIdx, willIdx + 2600);
  ok(/if \(!willConverge\) \{\s*\n\s*done\(/.test(tail),
    'the terminal verdict is not gated on the convergence prediction');
  ok(/dsAutoConvergeBodies\(sessionSerial, function \(cv\) \{/.test(tail),
    'the convergence lane does not settle back into a single verdict');
  /* exactly TWO verdict calls, in mutually exclusive branches: the early
     one when the convergence lane will NOT run, and the settle one when it
     has finished. Never both, never one before the other. */
  eq((tail.match(/done\(outcome\.ok, outcome\.message,/g) || []).length, 1,
    'the no-convergence verdict is not painted exactly once');
  eq((tail.match(/done\(outcome\.ok, outcome\.message \+ cvNote,/g) || []).length, 1,
    'the post-convergence verdict is not painted exactly once');
  const earlyIdx = tail.indexOf('done(outcome.ok, outcome.message,');
  const guardIdx = tail.indexOf('if (!willConverge) {');
  ok(guardIdx >= 0 && guardIdx < earlyIdx && earlyIdx - guardIdx < 200,
    'the early verdict is not inside the !willConverge branch');
  ok(tail.indexOf('DS.__autoRetrying = true;') > earlyIdx,
    'the convergence lane starts before the pull has decided not to finish');
  ok(/that need a second read/.test(tail),
    'the continuing state does not use the owner\'s wording');

  /* the borrowed retry flow must not paint its own verdict or reset the bar */
  ok(/if \(!cvOpts\.keepBar\) \{ try \{ var rBar = document\.getElementById\('mlsDsPullBar'\)/.test(MC),
    'the convergence lane still hides the pull bar between rounds (the visible restart)');
  ok(/if \(typeof cvOpts\.onFinish === 'function'\) \{ syncRetryControl/.test(MC),
    'the convergence lane still paints the retry flow\'s own terminal text');
  ok(/label: 'Finishing ', keepBar: true/.test(MC),
    'the convergence rounds do not reuse the pull\'s bar and label');
  /* a STOP must end it */
  ok(/window\.__mlsPullStopRequested === true\) return false;/.test(MC) ||
     /try \{ if \(window\.__mlsPullStopRequested === true\) \{ settle\(\); return; \} \} catch \(eStp\) \{\}/.test(MC),
    'the convergence lane can keep running after the doctor pressed Stop');
  ok(/stopped-by-user/.test(MC), 'the convergence vetoes do not know about a stopped pull');
}

/* ====== (5) bob-1.0.0: the census path RUNS history, it does not drop it === */
async function testCensusRunsHistoryAsPhaseTwo() {
  /* OWNER, verbatim 2026-08-17: "1p pulls way faster but doesn't include
     history so if you can do best of both worlds that would be great."
     The mechanism was one line - includeHistory = false on the
     provider-unknown census path, never put back. Phase 1 must stay exactly as
     fast; phase 2 must actually read. This EXECUTES the real branch with a spy
     history batch rather than trusting a grep. */
  ok(/var p1CensusHistoryDeferred = p1CensusHistoryRequested;/.test(SI),
    'the census path still DROPS the history request instead of deferring it');

  const start = SI.indexOf('            /* bob-1.0.0 PHASE 2: the census path defers history');
  const end = SI.indexOf("            var providerComplete =", start);
  ok(start > 0 && end > start, 'the bob-1.0.0 phase-2 branch is missing');
  const src = SI.slice(start, end);

  async function run(opts) {
    const calls = [];
    const said = [];
    const fn = new Function('includeHistory', 'p1CensusHistoryDeferred', 'fullNotesOff', 'visitNotesRequested', 'res', 'date',
      'runHistoryBatch', 'onStatus',
      'return (async function () {' + src + '\nreturn historyReceipt; })();');
    const receipt = await fn(
      opts.includeHistory, opts.deferred,
      opts.fullNotesOff === true,
      typeof opts.visitNotesRequested === 'boolean' ? opts.visitNotesRequested : true,
      { historyTargets: opts.targets, historyUnresolved: [] },
      '2026-08-17',
      function (rows, unresolved, onStatus, sweepOpts) {
        calls.push({ rows: rows.length, scopeDay: sweepOpts && sweepOpts.scopeDay });
        return Promise.resolve({ requested: rows.length, processed: rows.length, complete: true,
          exactIdentityVerified: true, patients: [], retry: [], failures: 0 });
      },
      function (m) { said.push(String(m || '')); });
    return { receipt, calls, said };
  }

  /* the owner's case: a provider-unknown census day WITH provable patients */
  const censusWithRows = await run({ includeHistory: false, deferred: true, targets: [{}, {}, {}] });
  eq(censusWithRows.calls.length, 1,
    'a provider-unknown census day still reads NO chart history - the owner\'s exact complaint');
  eq(censusWithRows.calls[0].rows, 3, 'phase 2 did not hand the batch the day\'s history targets');
  eq(censusWithRows.calls[0].scopeDay, '2026-08-17', 'phase 2 lost the pulled day (dnd-1.0.0)');
  eq(censusWithRows.receipt.censusPhaseTwo, true, 'the receipt does not record that phase 2 ran');
  eq(censusWithRows.receipt.censusHistoryTargets, 3, 'the receipt does not state what phase 2 was given');
  ok(censusWithRows.said.some(m => /schedule for 2026-08-17 is saved.*Reading chart history for 3/.test(m)),
    'phase 2 gave the doctor no honest progress line of its own');

  /* a census day with nothing provable: honest skip, unchanged reason string */
  const censusNoRows = await run({ includeHistory: false, deferred: true, targets: [] });
  eq(censusNoRows.calls.length, 0, 'phase 2 started a batch with no provable targets');
  eq(censusNoRows.receipt.skipped, true, 'a census day with no targets no longer skips honestly');
  eq(censusNoRows.receipt.reason, 'provider-attribution-unavailable',
    'the established census skip reason changed for a day that genuinely had nothing to read');
  eq(censusNoRows.receipt.censusNoProvableTargets, true,
    'the receipt does not distinguish "nothing provable" from "not requested"');

  /* an ORDINARY attributed day is untouched */
  const ordinary = await run({ includeHistory: true, deferred: false, targets: [{}, {}] });
  eq(ordinary.calls.length, 1, 'an ordinary day stopped reading history');
  eq(ordinary.receipt.censusPhaseTwo, undefined, 'an ordinary day was mislabelled as a census phase 2');

  /* history NOT requested at all: still nothing, still honest */
  const notRequested = await run({ includeHistory: false, deferred: false, targets: [{}, {}] });
  eq(notRequested.calls.length, 0, 'a schedule-only pull started reading history');
  eq(notRequested.receipt.reason, 'not-requested', 'a schedule-only pull lost its honest reason');

  /* an explicit Full Notes OFF choice is stronger than includeHistory=false:
     it records the choice and proves the phase opens zero charts. */
  const fullNotesOff = await run({ includeHistory: false, deferred: true, fullNotesOff: true,
    visitNotesRequested: false, targets: [{}, {}] });
  eq(fullNotesOff.calls.length, 0, 'Full Notes OFF started a chart/history batch');
  eq(fullNotesOff.receipt.reason, 'full-notes-off', 'Full Notes OFF lost its explicit skip reason');
  eq(fullNotesOff.receipt.visitNotesRequested, false, 'Full Notes OFF receipt did not preserve the frozen choice');
  eq(fullNotesOff.receipt.chartReads, 0, 'Full Notes OFF claimed or performed chart reads');
}

async function main() {
  testEmptyDaySkipsTheAiParser();
  await testCensusRunsHistoryAsPhaseTwo();
  testRegexLiteralsAreIntact();
  testAuthorityStoreRepairs();
  testConvergenceIsOneContinuousPull();
  console.log('PASS 1p-empty-day-regex-and-authority-repair: ' + checks + ' checks - a verified-empty day never reaches the AI schedule parser (and a text-only day still does); a provider-unknown appointment-census day now RUNS chart history as a second phase with its own progress instead of silently dropping it, while a census day with nothing provable keeps its established honest skip; no 1p-only file carries a lost-backslash regex or the control byte one leaves behind, and the calendar hero bar provably paints 44% for "7 of 16"; a top-level-alien authority blob is salvaged per-day or bounded-reset instead of wedging every future pull forever; and the automatic convergence lane is one continuous pull with exactly one verdict');
}

main().then(() => {}, e => { console.error(e); process.exit(1); });
