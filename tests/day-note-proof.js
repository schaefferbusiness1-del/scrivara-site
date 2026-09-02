'use strict';

/* dnote-1.0.0 (b1184) - THE PULLED DAY'S OWN NOTE IS A DEBT, PROVEN.
 *
 * OWNER 2026-09-01, on a finished day pull whose Done sheet read
 *   "7 of 7 - 7 saved - 7 need attention - Result: 7 histories saved - 7
 *    pulled-day notes not read yet - everything verified"
 * with every row saying "today's note not read this time (chart saved)":
 *   "what's going on here, did you forget about the must-read visit note even
 *    if Full visit notes is turned off?"
 *
 * THE STANDING RULE, which the engine already states in its own comments
 * (1p-feat_mls_schedimport_exact.js: "the pulled day's own note is read with
 * bodies OFF"): with Full visit notes (historical bodies) OFF, EVERY row of
 * the pulled day must still have that day's OWN visit note read. It is never
 * optional and it is never a "nice to have".
 *
 * WHAT WAS MEASURED LIVE BEFORE THIS SUITE WAS WRITTEN. The seven notes had
 * been DEFERRED to the notes-idle catch-up (notes-idle-1.0.0) - and that lane
 * was sitting `stopped` with gateReason `stopped-by-user`. The Stop that
 * stopped it had been pressed for a DIFFERENT, EARLIER pull: stp-2.0.0's
 * "Stop means STOP" also stops the idle catch-up, and nothing ever started it
 * again. Fifteen queued notes for Sep 1 and the rows for 2026-08-27 were never
 * read while the durable month job kept pulling days and deferring more onto
 * the same stopped queue - and the durable job kept checkpointing those days
 * `complete`, so nothing would ever come back to them.
 *
 * THE FIVE THINGS THIS SUITE PINS, each by EXECUTING the shipped slice:
 *   A. the closed per-row vocabulary. A deferred / handed-off / idle-queued
 *      note is `queued` - never a done and never a failure - and a day with
 *      any queued note is NOT complete.
 *   B. the drain runs INSIDE the pull. dnoteAfterSettle drives the immediate
 *      round and then the idle engine, one at a time, on the settle path where
 *      the lease is released - and the pull's own result is not handed on
 *      until the debt is drained or its bounded budget is spent.
 *   C. a Stop for pull A does not leave the catch-up stopped when pull B runs.
 *      A Stop still stops the pull it was pressed for.
 *   D. the sheet's wording per state, rendered by the real rowsHtml and the
 *      real Result line: "queued to read" / "reading" / "note saved" / "no
 *      note in athenaOne" / "refused: <named reason>", and "everything
 *      verified" only when the day genuinely owes nothing.
 *   E. the durable range job's day stays incomplete with unread own-notes and
 *      completes once they are read, so its honest tiles cannot count it.
 *
 * No Athena account, no backend, no PHI. */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const IMPORTER = fs.readFileSync('1p-feat_mls_schedimport_exact.js', 'utf8');
const RANGE = fs.readFileSync('1p-feat_mls_rangejobs.js', 'utf8');
const CONNECT = fs.readFileSync('1p-mls-connect.js', 'utf8');

let checks = 0;
function ok(cond, message) { checks++; assert.ok(cond, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }

/* ---- one extractor, used for every slice ---------------------------------
   pull-resume-proof's brace walker, with ONE correction this suite needs: it
   recognises a comment BEFORE it recognises a quote. Every doctor-facing block
   in these three files is documented in prose full of apostrophes ("the
   doctor's", "the card's"), and opening quote-mode inside a comment desyncs
   the walker and truncates the slice mid-`try`. Comments first, quotes second;
   both only ever consulted outside a string. */
function balanced(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'slice not found: ' + (label || signature));
  let depth = 0, quote = '', i = source.indexOf('{', start);
  assert(i > start, 'slice has no body: ' + (label || signature));
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1];
    if (quote) { if (ch === quote && prev !== '\\') quote = ''; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated slice: ' + (label || signature));
}
function statement(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'statement not found: ' + (label || signature));
  const end = source.indexOf('\n', start);
  return source.slice(start, end < 0 ? source.length : end);
}

/* =======================================================================
 * The dnote-1.0.0 engine slices, executed against controlled doubles for
 * the two engines they DRIVE (the immediate _tnDefer round and notes-idle).
 * The classifier, the census, the drain loop, the arm/spend pair and the
 * settle hook are all the SHIPPED source, extracted verbatim.
 * ===================================================================== */
function engineContext(options) {
  options = options || {};
  const slices = [
    statement(IMPORTER, 'var DNOTE_VERSION = "dnote-1.0.0";', 'DNOTE_VERSION'),
    statement(IMPORTER, 'var DNOTE_DRAIN_MS =', 'DNOTE_DRAIN_MS'),
    statement(IMPORTER, 'var DNOTE_MAX_TURNS =', 'DNOTE_MAX_TURNS'),
    balanced(IMPORTER, 'var DNOTE_HARD_GATE = {', 'DNOTE_HARD_GATE') + ';',
    balanced(IMPORTER, 'var _dnote = {', '_dnote') + ';',
    balanced(IMPORTER, 'function dnoteIdleOwes(pid, day)', 'dnoteIdleOwes'),
    balanced(IMPORTER, 'function dnoteState(p, day)', 'dnoteState'),
    balanced(IMPORTER, 'function dnoteCensus(receipt, day)', 'dnoteCensus'),
    balanced(IMPORTER, 'function dnoteStamp(receipt, day)', 'dnoteStamp'),
    balanced(IMPORTER, 'function dnoteRestampSettled(value)', 'dnoteRestampSettled'),
    balanced(IMPORTER, 'function dnoteOwesWork()', 'dnoteOwesWork'),
    balanced(IMPORTER, 'function dnoteStopRequested()', 'dnoteStopRequested'),
    balanced(IMPORTER, 'function dnoteDrainNow(opts)', 'dnoteDrainNow'),
    balanced(IMPORTER, 'function dnoteArmIdleForNewPull()', 'dnoteArmIdleForNewPull'),
    balanced(IMPORTER, 'function dnoteArmIdleAfterPull()', 'dnoteArmIdleAfterPull'),
    balanced(IMPORTER, 'function dnoteAfterSettle(value)', 'dnoteAfterSettle'),
    balanced(IMPORTER, 'function dnoteReceipt()', 'dnoteReceipt')
  ].join('\n');

  /* the notes-idle queue double: the SHAPE the shipped engine persists
     ({p,d,a,c,s,n}) with the same four row states. */
  const ni = { rows: (options.idleRows || []).slice(), stopped: options.idleStopped === true,
    reading: false, readingKey: '', gateReason: '', resumes: 0, runs: 0 };
  const tnDefer = { queue: (options.deferQueue || []).slice(), running: false, rounds: 0 };
  const trace = [];

  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp, Promise, isFinite,
    setTimeout, clearTimeout,
    window: { __mlsPullStopRequested: options.stopRequested === true },
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    isFn(v) { return typeof v === 'function'; },
    normDate(v) { const s = String(v == null ? '' : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; },
    /* the CLOSED reason-code vocabulary, verbatim from the shipped table */
    tnReasonCode(reason) {
      const r = String(reason || '');
      if (/no-encounter|encounter index without verified full detail|no-visits-for-date/i.test(r)) return 'no-encounter';
      if (/pass-budget/i.test(r)) return 'pass-budget-exhausted';
      if (/deadline|timeout|timed out/i.test(r)) return 'deadline';
      if (/no-athena-tab/i.test(r)) return 'no-athena-tab';
      if (/pull-in-flight/i.test(r)) return 'pull-in-flight';
      if (/reader-unavailable/i.test(r)) return 'reader-unavailable';
      if (!r) return 'unknown';
      return 'other';
    },
    _ni: ni,
    _tnDefer: tnDefer,
    niLoad() { return ni; },
    niOpenRows() { let n = 0; for (const r of ni.rows) if (r.s === 'queued') n++; return n; },
    niResume() { ni.stopped = false; ni.resumes++; trace.push('niResume'); return 0; },
    /* ONE forced idle turn, exactly the contract niRunOne(true) honours: it
       reads the next queued row, or refuses with a gate reason. */
    niRunOne(force) {
      ni.runs++;
      if (ni.stopped === true) { ni.gateReason = 'stopped'; return Promise.resolve(null); }
      if (options.idleGate) { ni.gateReason = options.idleGate; trace.push('idle-gate:' + options.idleGate); return Promise.resolve(null); }
      const row = ni.rows.filter(r => r.s === 'queued')[0];
      if (!row) { ni.gateReason = 'nothing-due'; return Promise.resolve(null); }
      trace.push('idle-read:' + row.p + '@' + row.d + (force === true ? ':forced' : ''));
      row.a = Number(row.a || 0) + 1;
      const verdict = (options.idleVerdict || (() => 'read'))(row);
      row.s = verdict;
      if (verdict === 'read') row.c = 'read';
      return Promise.resolve({ ok: verdict === 'read', code: row.c });
    },
    runDeferredTodayNoteRound() {
      tnDefer.rounds++;
      const batch = tnDefer.queue.splice(0, tnDefer.queue.length);
      trace.push('deferred-round:' + batch.length);
      batch.forEach(item => { if (typeof item.settle === 'function') item.settle(); });
      return Promise.resolve({ rows: batch.length });
    },
    trace
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'dnote-slices.js' });
  return { ctx, sandbox, ni, tnDefer, trace, run: expr => vm.runInContext(expr, ctx) };
}

/* the receipt shape runHistoryBatch hands on: one entry per pulled row. */
function row(patientId, patch) { return Object.assign({ patientId: String(patientId), complete: true }, patch || {}); }

/* =======================================================================
 * PART A - a deferred day-note is a DEBT, and a day with one is not done.
 * ===================================================================== */
function partAVocabulary() {
  const h = engineContext({});
  const state = (p, day) => h.run('dnoteState(' + JSON.stringify(p) + ', ' + JSON.stringify(day || '2026-09-01') + ')');

  eq(state(row(1, { todayNote: true })), 'read', 'a note this pull READ is not reported as read');
  eq(state(row(2, { todayNote: 'already-read' })), 'read', 'a note an earlier read today already filed is not reported as read');
  eq(state(row(3, { todayNote: 'future-day' })), 'no-note', 'a day that has not happened is reported as something other than "nothing to read"');
  eq(state(row(4, { todayNote: 'not-yet' })), 'no-note', 'a slot that has not arrived is reported as something other than "nothing to read"');
  eq(state(row(5, { todayNote: false, todayNoteReason: 'no-encounter-for-date' })), 'no-note',
    'the reader proving athenaOne has no note for the day is not classified as "nothing in athena"');
  eq(state(row(6, { todayNote: false, todayNoteDeferred: true, todayNoteReason: 'pull-in-flight' })), 'queued',
    'a row still owned by the immediate deferred round is not a DEBT - this is the b1183 defect');
  eq(state(row(7, { todayNote: false, todayNoteHandedOff: true, todayNoteReason: 'day-note-pass-budget-exhausted' })), 'queued',
    'a row handed off when the pass budget ran out is not a DEBT');
  eq(state(row(8, { todayNote: false, todayNoteReason: 'athena is slow, deadline-exceeded' })), 'refused',
    'a refusal whose retries are spent and which nothing holds is not classified as refused');
  eq(state(row(9, { todayNote: null, complete: true })), 'read',
    'Full notes ON reads the day note as part of the bodies - a complete row must not owe one');
  eq(state(row(10, { todayNote: null, complete: false })), 'queued',
    'a chart the walk never finished still owes its own note (onheal-1.0.0), and must be a DEBT');

  /* the idle queue is consulted: a refusal the persistent catch-up still
     holds is QUEUED, not a failure. This is exactly the seven rows on the
     owner's sheet. */
  const held = engineContext({ idleRows: [{ p: '77', d: '2026-09-01', a: 1, c: 'deadline', s: 'queued', n: 0 }] });
  eq(held.run('dnoteState(' + JSON.stringify(row(77, { todayNote: false, todayNoteReason: 'deadline-exceeded' })) + ', "2026-09-01")'), 'queued',
    'a note the persistent catch-up is still holding was reported as a failure - the owner\'s "7 need attention"');
  eq(held.run('dnoteState(' + JSON.stringify(row(78, { todayNote: false, todayNoteReason: 'deadline-exceeded' })) + ', "2026-09-01")'), 'refused',
    'a row NOTHING holds must be an honest refusal, not a queued excuse');

  /* the census, and the completion rule that hangs off it. */
  const receipt = { day: '2026-09-01', patients: [
    row(1, { todayNote: true }),
    row(2, { todayNote: true }),
    row(3, { todayNote: false, todayNoteDeferred: true, todayNoteReason: 'pull-in-flight' }),
    row(4, { todayNote: false, todayNoteReason: 'no-encounter-for-date' }),
    row(5, { todayNote: false, todayNoteReason: 'deadline-exceeded' })
  ] };
  const census = h.run('dnoteCensus(' + JSON.stringify(receipt) + ', "2026-09-01")');
  eq(census.total, 5, 'the census lost a row');
  eq(census.read, 2, 'the census miscounts the notes that are on file');
  eq(census.noNote, 1, 'the census miscounts the days athenaOne has no note for');
  eq(census.queued, 1, 'the census miscounts the notes still owed');
  eq(census.refused, 1, 'the census miscounts the notes that were refused for good');
  eq(census.pending, 1, 'the DEBT is not the queued count');
  eq(census.complete, false, 'a day with a queued own-note reported itself COMPLETE - the whole defect');

  /* an UNKNOWN state is a debt too: a silence nobody can name is never a done */
  const silent = h.run('dnoteCensus({ day: "2026-09-01", patients: [{ patientId: "9", todayNote: "wat" }] }, "2026-09-01")');
  eq(silent.unknown, 1, 'an unnameable day-note state was quietly counted as something');
  eq(silent.complete, false, 'an unnameable day-note state was reported as a completed day');

  /* every honestly-classified day IS complete: read, nothing in athena, and a
     named refusal whose retries are spent. */
  const settled = h.run('dnoteCensus({ day: "2026-09-01", patients: ' + JSON.stringify([
    row(1, { todayNote: true }),
    row(2, { todayNote: false, todayNoteReason: 'no-encounter-for-date' }),
    row(3, { todayNote: false, todayNoteReason: 'deadline-exceeded' })
  ]) + ' }, "2026-09-01")');
  eq(settled.complete, true, 'a day whose notes are all read or honestly classified is not allowed to finish');

  /* the stamp the durable job and the sheet both read */
  const stamped = { day: '2026-09-01', patients: receipt.patients };
  h.run('(function(r){ return dnoteStamp(r, "2026-09-01"); })(globalThis.__r = ' + JSON.stringify(stamped) + ')');
  eq(h.run('globalThis.__r.dayNotesComplete'), false, 'the receipt stamp claims a day with a queued note is complete');
  eq(h.run('globalThis.__r.dayNotesPending'), 1, 'the receipt stamp does not carry the day-note debt the range job reads');
  console.log('  A. a deferred / handed-off / idle-held day-note is a DEBT; a day with one is not complete');
}

/* =======================================================================
 * PART B - the drain runs INSIDE the pull, bounded and serialized.
 * ===================================================================== */
async function partBDrainInsideThePull() {
  /* bodies OFF, seven rows, every note deferred - the owner's exact sheet. */
  const idleRows = [];
  for (let i = 1; i <= 7; i++) idleRows.push({ p: String(i), d: '2026-09-01', a: 0, c: 'deadline', s: 'queued', n: 0 });
  const h = engineContext({ idleRows });

  const patients = idleRows.map(r => row(r.p, { todayNote: false, todayNoteReason: 'deadline-exceeded' }));
  const settledValue = { ok: true, complete: true, date: '2026-09-01',
    historyReceipt: { day: '2026-09-01', visitNotesRequested: false, patients } };
  h.ctx.__value = settledValue;

  const before = h.run('dnoteCensus(__value.historyReceipt, "2026-09-01")');
  eq(before.pending, 7, 'the seven deferred notes are not counted as a debt before the drain');

  const out = await h.run('dnoteAfterSettle(__value)');
  ok(out === settledValue, 'the settle hook did not hand the pull its own result back');
  eq(h.ni.rows.filter(r => r.s === 'read').length, 7, 'the drain did not read the day\'s own notes inside the pull');
  eq(h.trace.filter(t => t.indexOf('idle-read:') === 0).length, 7, 'the drain skipped rows the day still owed');
  ok(h.trace.every(t => t.indexOf('idle-read:') !== 0 || /:forced$/.test(t)),
    'the drain waited for the idle threshold instead of forcing the turn it owns');

  const after = h.run('dnoteCensus(__value.historyReceipt, "2026-09-01")');
  eq(after.pending, 0, 'the day still owes notes after a drain that read every one of them');
  eq(settledValue.historyReceipt.dayNotesComplete, true, 'the drained receipt was not re-stamped complete');
  eq(settledValue.dayNotesPending, 0, 'the day result does not carry the drained debt for the durable job');
  eq(settledValue.dayNotesComplete, true, 'the day result does not carry the drained completion for the durable job');

  /* the IMMEDIATE round owns its rows first - the drain never becomes a
     third queue racing it. */
  const ordered = engineContext({
    idleRows: [{ p: '9', d: '2026-09-01', a: 0, c: 'deadline', s: 'queued', n: 0 }],
    deferQueue: [{ patientId: '8', day: '2026-09-01' }]
  });
  ordered.ctx.__v = { ok: true, complete: true, historyReceipt: { day: '2026-09-01', patients: [row(9, { todayNote: false, todayNoteReason: 'deadline-exceeded' })] } };
  await ordered.run('dnoteAfterSettle(__v)');
  eq(ordered.trace[0], 'deferred-round:1', 'the drain drove the idle engine before the immediate round had its turn');
  ok(ordered.trace.indexOf('idle-read:9@2026-09-01:forced') > 0, 'the drain never reached the leftover the immediate round did not own');

  /* BOUNDED: a gate this drain cannot clear ends it rather than spinning. */
  const gated = engineContext({
    idleRows: [{ p: '1', d: '2026-09-01', a: 0, c: 'deadline', s: 'queued', n: 0 }],
    idleGate: 'athena-absent'
  });
  const gatedOut = await gated.run('dnoteDrainNow({})');
  eq(gatedOut.reason, 'gate:athena-absent', 'a gate the drain cannot clear did not end it - it would spin against a closed athenaOne');
  eq(gated.ni.runs, 1, 'the drain kept asking a gate that had already refused');

  /* BOUNDED: ONE turn per row per drain. Forcing waives the backoff ladder, so
     a row that still refuses must keep its remaining attempts for the idle
     lane rather than burning the whole ladder in four seconds. */
  const spinny = engineContext({
    idleRows: [{ p: '1', d: '2026-09-01', a: 0, c: 'deadline', s: 'queued', n: 0 }],
    idleVerdict: () => 'queued'
  });
  const oneEach = await spinny.run('dnoteDrainNow({})');
  eq(oneEach.reason, 'one-turn-each', 'a still-refusing row was handed turn after turn inside the pull');
  eq(spinny.ni.runs, 1, 'the drain spent more than one forced turn on a single row');
  eq(spinny.ni.rows[0].a, 1, 'the drain burned the row\'s whole retry ladder instead of one attempt');
  eq(spinny.ni.rows[0].s, 'queued', 'a row that still refuses lost its place in the catch-up');

  /* FAIRNESS: a refusing row must not eat the whole drain. Every row on the
     day gets its one turn, in order, even when the first one keeps refusing. */
  const stubborn = engineContext({
    idleRows: [1, 2, 3].map(i => ({ p: String(i), d: '2026-09-01', a: 0, c: 'deadline', s: 'queued', n: 0 })),
    idleVerdict: r => (r.p === '1' ? 'queued' : 'read')
  });
  const fair = await stubborn.run('dnoteDrainNow({})');
  eq(fair.reason, 'one-turn-each', 'the drain did not stop once every row had had its turn');
  eq(stubborn.ni.runs, 3, 'a refusing first row starved the rest of the day of their turn');
  eq(stubborn.ni.rows.filter(r => r.s === 'read').length, 2, 'the rows behind the refusing one were never read');
  eq(stubborn.ni.rows.filter(r => r.s === 'queued').length, 1, 'the refusing row lost its place in the catch-up');

  /* and the turn cap still stands over MANY rows */
  const many = [];
  for (let i = 1; i <= 12; i++) many.push({ p: 'q' + i, d: '2026-09-01', a: 0, c: 'deadline', s: 'queued', n: 0 });
  const capped = await engineContext({ idleRows: many }).run('dnoteDrainNow({ maxTurns: 4 })');
  eq(capped.reason, 'turn-cap', 'the drain has no turn cap - a long day could drive athenaOne without bound');
  eq(capped.turns, 4, 'the turn cap did not bound the number of reads');

  /* A STOP REFUSES IT OUTRIGHT. Stop means stop - including this drain. */
  const stopped = engineContext({
    idleRows: [{ p: '1', d: '2026-09-01', a: 0, c: 'deadline', s: 'queued', n: 0 }],
    stopRequested: true
  });
  const stoppedOut = await stopped.run('dnoteDrainNow({})');
  eq(stoppedOut.reason, 'stopped-by-user', 'the drain ran after the doctor pressed Stop');
  eq(stopped.ni.runs, 0, 'the drain drove athenaOne after a Stop');

  /* a pull with NO note debt pays nothing for any of this. */
  const clean = engineContext({});
  clean.ctx.__c = { ok: true, complete: true, historyReceipt: { day: '2026-09-01', patients: [row(1, { todayNote: true })] } };
  const cleanOut = await clean.run('dnoteAfterSettle(__c)');
  eq(cleanOut.historyReceipt.dayNotesComplete, true, 'a fully-read day was not stamped complete');
  eq(clean.ni.runs, 0, 'a pull with no note debt still drove the idle engine');

  /* SERIALIZED BY CONSTRUCTION: the hook is wired on the settle path, after
     the lease and pullRunning are released - never as a second driver. */
  const settleSlice = IMPORTER.slice(IMPORTER.indexOf('function runManagedAthenaOperation(task, busyFactory)'));
  const settleTail = settleSlice.slice(0, settleSlice.indexOf('function buildRetryRows'));
  const releaseAt = settleTail.indexOf('pullRunning = false;');
  const drainAt = settleTail.indexOf('dnoteAfterSettle(value)');
  ok(releaseAt > 0 && drainAt > releaseAt, 'the drain is not on the settle path behind the lease release - it would be a second Athena driver');
  ok(settleTail.indexOf('safe(dnoteArmIdleForNewPull);') > 0, 'a pull START no longer arms the idle catch-up re-arm');
  ok(settleTail.indexOf('releaseAthenaOwner();') < drainAt, 'the drain runs before the Athena lease owner is released');
  console.log('  B. bodies OFF + day pull: the day\'s own notes are drained inside the same run, bounded, serialized, and a Stop refuses it');
}

/* =======================================================================
 * PART C - a Stop for pull A does not leave the catch-up stopped for pull B.
 * ===================================================================== */
function partCStopIsScopedToItsOwnPull() {
  /* PULL A is stopped: the catch-up stops with it, and A's own settle must
     NOT resurrect it. */
  const a = engineContext({ idleStopped: true, stopRequested: true });
  a.run('dnoteArmIdleForNewPull()');
  a.run('_dnote.armIdle = false');   /* stopPull() disarms the pull it stopped */
  eq(a.run('dnoteArmIdleAfterPull()'), false, 'the stopped pull re-armed its own catch-up - Stop would not mean Stop');
  eq(a.ni.stopped, true, 'the catch-up was resumed by the very pull whose Stop stopped it');

  /* PULL B starts later. Its start arms, its settle spends - and the lane
     that an EARLIER pull's Stop left stopped comes back. */
  const b = engineContext({ idleStopped: true, idleRows: [{ p: '1', d: '2026-09-01', a: 0, c: 'deadline', s: 'queued', n: 0 }] });
  eq(b.run('dnoteArmIdleAfterPull()'), false, 'a settle with no armed start re-armed the catch-up out of nowhere');
  eq(b.run('dnoteArmIdleForNewPull()'), true, 'a new pull start does not arm the re-arm');
  eq(b.run('_dnote.armIdle'), true, 'the arm was not recorded');
  eq(b.run('dnoteArmIdleAfterPull()'), true, 'pull B did not re-arm a catch-up that pull A\'s Stop had stopped - the 2026-09-01 defect');
  eq(b.ni.stopped, false, 'the catch-up is still stopped after a later pull finished cleanly');
  eq(b.ni.resumes, 1, 'the catch-up was not resumed exactly once');
  eq(b.run('dnoteArmIdleAfterPull()'), false, 'the arm is not spent - one start would re-arm on every later settle');

  /* and pull B being stopped ITSELF still stops it. */
  const c = engineContext({ idleStopped: true });
  c.run('dnoteArmIdleForNewPull()');
  c.run('window.__mlsPullStopRequested = true');
  eq(c.run('dnoteArmIdleAfterPull()'), false, 'a pull that was itself stopped re-armed the catch-up anyway');
  eq(c.ni.stopped, true, 'Stop stopped being Stop for the pull it was pressed for');

  /* a catch-up that is already running is left alone. */
  const d = engineContext({ idleStopped: false });
  d.run('dnoteArmIdleForNewPull()');
  eq(d.run('dnoteArmIdleAfterPull()'), false, 'a running catch-up was "resumed" a second time');
  eq(d.ni.resumes, 0, 'a running catch-up was needlessly restarted');

  /* the shipped stopPull disarms only its own pull, and still stops the lane. */
  const stopSlice = IMPORTER.slice(IMPORTER.indexOf('stopPull: function ()'), IMPORTER.indexOf('_dropDeferredTodayNotes:'));
  ok(/niStop\("stopped-by-user"\)/.test(stopSlice), 'Stop no longer stops the background catch-up');
  ok(/_dnote\.armIdle = false/.test(stopSlice), 'Stop does not disarm the re-arm of the pull it stopped');
  console.log('  C. a Stop stops the pull it was pressed for; the next pull\'s settle re-arms the catch-up');
}

/* =======================================================================
 * PART D - the sheet's wording, rendered by the shipped renderer.
 * ===================================================================== */
function sheetContext() {
  /* 1p-mls-connect.js is four megabytes of independent modules and defines
     `esc` twenty-nine times. Scope every lookup to the pull-progress module's
     OWN body first, or the slice comes from somebody else's panel. */
  const progStart = CONNECT.indexOf("var api = { version: '1.0.0', opens: 0 };");
  assert(progStart > 0, 'the pull-progress module moved');
  const progEnd = CONNECT.indexOf('window.__mlsPullProgress = api;', progStart);
  assert(progEnd > progStart, 'the pull-progress module has no end');
  const PROGRESS = CONNECT.slice(progStart, progEnd);
  const slices = [
    balanced(PROGRESS, 'var DN_PLAIN = {', 'DN_PLAIN') + ';',
    /* an array literal, so it is taken by its own closing bracket */
    PROGRESS.slice(PROGRESS.indexOf('var DN_CLASSES = ['), PROGRESS.indexOf('\n  ];', PROGRESS.indexOf('var DN_CLASSES = [')) + 5),
    'var PP_PENDING = ' + statement(PROGRESS, 'var PP_PENDING = /^(finishing|reading', 'PP_PENDING').split('var PP_PENDING = ')[1],
    /* esc is a one-liner whose own regexes contain the quote characters the
       brace walker tracks, so it is taken by line, not by braces. */
    statement(PROGRESS, 'function esc(s) {', 'esc'),
    balanced(PROGRESS, 'function dnRefusedSuffix(dnRaw)', 'dnRefusedSuffix'),
    balanced(PROGRESS, 'function rowsHtml(S)', 'rowsHtml'),
    balanced(PROGRESS, 'function renderDone(S)', 'renderDone')
  ].join('\n');
  const captured = {};
  const node = () => ({ textContent: '', style: {}, innerHTML: '', querySelector: () => node(), setAttribute() {}, classList: { contains: () => false } });
  const panel = node();
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
    document: { getElementById: () => null },
    css() {}, ensureFab() {}, buildPanel() { return panel; },
    /* every row this suite renders carries a GOOD history verdict, so the
       history-reason humaniser is never on the path being measured. It has its
       own suites; stubbing it keeps this one aimed at the note column. */
    ppHumanWhy(raw) { return String(raw || ''); },
    setText(p, key, val) { captured[key] = String(val == null ? '' : val); },
    setShown(p, key, on) { captured['shown:' + key] = !!on; },
    mmss() { return '1m 00s'; },
    api: { doneShown: 0 },
    hidden: false, doneDismissed: false, startedAt: 0,
    captured
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'sheet-slices.js' });
  return { ctx, captured, run: expr => vm.runInContext(expr, ctx) };
}

function partDSheetWording() {
  const s = sheetContext();
  const cellOf = (dn) => {
    const html = s.run('rowsHtml(' + JSON.stringify({ rows: [{ k: 'x', name: 'Quillon R', ok: true, reason: '', dn: dn, dnd: '2026-09-01' }] }) + ')');
    const m = html.match(/opacity:\.8">([^<]*)</);
    return m ? m[1] : '';
  };
  const classOf = (dn) => {
    const html = s.run('rowsHtml(' + JSON.stringify({ rows: [{ k: 'x', name: 'Quillon R', ok: true, reason: '', dn: dn, dnd: '2026-09-01' }] }) + ')');
    const m = html.match(/<span class="(pp-[a-z]+)"[^>]*opacity:\.8/);
    return m ? m[1] : '';
  };

  eq(cellOf('read'), 'note saved', 'a read note does not say it was saved');
  eq(cellOf('queued:deadline'), 'queued to read', 'a QUEUED note still reads as a failure - the owner\'s seven orange rows');
  eq(classOf('queued:deadline'), 'pp-wait', 'a queued note is painted as a warning');
  eq(cellOf('reading:deadline'), 'reading today’s note now', 'a note being read right now does not say so');
  eq(classOf('reading:deadline'), 'pp-wait', 'a note being read is painted as a warning');
  eq(cellOf('no-note'), 'no note in athenaOne for this day', 'a day athenaOne has no note for does not say so');
  eq(classOf('no-note'), 'pp-wait', 'a day with no note in athenaOne is painted as a failure');
  eq(cellOf('unread:deadline'), 'today’s note not read this time (chart saved) — refused: athenaOne was too slow',
    'a note whose retries are spent does not name what refused it');
  eq(classOf('unread:deadline'), 'pp-bad', 'a spent refusal is no longer flagged for attention');
  /* the engine writes a RAW reason into this cell (tnColumn carries
     entry.todayNoteReason), so the classifier has to recognise it too. */
  eq(cellOf('unread:pulled-day-note-deadline-exceeded'),
    'today’s note not read this time (chart saved) — refused: athenaOne was too slow',
    'a raw timing refusal is not classified into the closed vocabulary');
  /* fnc-1.0.0 still stands: anything the closed classifier does not recognise
     prints NO reason rather than leaking a scoped-reader message. */
  eq(cellOf('unread:some-raw-reader-text'), 'today’s note not read this time (chart saved)',
    'an unknown code leaked into the doctor-facing cell');
  eq(cellOf('unread:visit-bodies-incomplete [no-bound-clinical-detail,stable-source-keys-incomplete]'),
    'today’s note not read this time (chart saved)',
    'a raw scoped-reader internal leaked into the doctor-facing cell');
  ok(/queued and will be read automatically/.test(s.run('rowsHtml(' + JSON.stringify({ rows: [{ k: 'x', name: 'Q', ok: true, reason: '', dn: 'queued:deadline', dnd: '2026-09-01' }] }) + ')')),
    'the queued cell has no tooltip saying the note is coming');

  /* THE RESULT LINE, from the shipped renderDone. */
  function result(rows, dv) {
    s.run('captured.current = ""; captured.tally = "";');
    s.run('renderDone(' + JSON.stringify({ ok: rows.filter(r => r.ok).length, failed: 0, chartOnly: 0, total: rows.length, done: rows.length, rows, dayVerdict: dv, finishedAt: 1 }) + ')');
    return { line: s.captured.current, tally: s.captured.tally };
  }
  const seven = [];
  for (let i = 1; i <= 7; i++) seven.push({ k: 'p' + i, name: 'P' + i, ok: true, reason: '', dn: 'queued:deadline', dnd: '2026-09-01' });

  /* the owner's sheet, re-run through the shipped renderer */
  const queued = result(seven, { ok: 7, failed: 0, total: 7, complete: true, tnFailed: 7, tnRead: 0, tnNotYet: 0, tnFuture: 0, tnQueued: 7, tnNotesComplete: false });
  ok(!/need attention/.test(queued.tally), 'seven QUEUED notes are still reported as "need attention": ' + queued.tally);
  ok(/7 visit notes still to read/.test(queued.line), 'the Result line does not state the debt: ' + queued.line);
  ok(!/everything verified/.test(queued.line), 'the Result line still claims "everything verified" with seven notes unread: ' + queued.line);
  ok(/still being read/.test(queued.line), 'the Result line does not say the notes are still being read: ' + queued.line);

  /* the same day, mid-drain */
  const reading = seven.map((r, i) => Object.assign({}, r, { dn: i < 3 ? 'read' : (i === 3 ? 'reading:deadline' : 'queued:deadline') }));
  const mid = result(reading, { ok: 7, failed: 0, total: 7, complete: true, tnFailed: 4, tnQueued: 4, tnNotesComplete: false });
  ok(/reading 4 of 7/.test(mid.line), 'the Result line does not say which note is being read: ' + mid.line);
  ok(!/need attention/.test(mid.tally), 'a note being read right now was counted as needing attention: ' + mid.tally);

  /* and the day that is genuinely finished */
  const done = seven.map(r => Object.assign({}, r, { dn: 'read' }));
  const fin = result(done, { ok: 7, failed: 0, total: 7, complete: true, tnFailed: 0, tnQueued: 0, tnNotesComplete: true });
  ok(/everything verified/.test(fin.line), 'a day that owes nothing is refused its "everything verified": ' + fin.line);
  ok(!/still to read/.test(fin.line), 'a finished day still claims notes are outstanding: ' + fin.line);

  /* a note whose retries are spent DOES need attention, and says so */
  const refused = seven.map((r, i) => Object.assign({}, r, { dn: i === 0 ? 'unread:deadline' : 'read' }));
  const att = result(refused, { ok: 7, failed: 0, total: 7, complete: true, tnFailed: 1, tnQueued: 0, tnNotesComplete: true });
  ok(/1 need attention/.test(att.tally), 'a note that failed after its retries is not flagged for attention: ' + att.tally);
  ok(!/everything verified/.test(att.line), 'a day with a refused note still claims everything was verified: ' + att.line);
  console.log('  D. the sheet says queued / reading / read / no note in athenaOne / refused: <reason>, and only a spent refusal needs attention');
}

/* =======================================================================
 * PART E - the durable range job's day stays incomplete with unread notes.
 * ===================================================================== */
function partEDurableJob() {
  const slices = [
    statement(RANGE, 'var DAY_ATTEMPT_CAP =', 'DAY_ATTEMPT_CAP'),
    balanced(RANGE, 'var REASONS = {', 'REASONS') + ';',
    balanced(RANGE, 'var EMPTY_REASONS = {', 'EMPTY_REASONS') + ';',
    /* scopeempty-1.0.0 (2026-09-01): checkpointDay now also consults the
       scoped-empty rule, so the lifted function needs its two symbols to run
       at all. Every manifest built below is scope-less, so providerScopedJob
       is false for all of them and every pin in this suite is unchanged - the
       slice list grew, the behaviour under test did not. */
    statement(RANGE, 'var SCOPED_EMPTY_REASON =', 'SCOPED_EMPTY_REASON'),
    balanced(RANGE, 'function providerScopedJob(manifest)', 'providerScopedJob'),
    balanced(RANGE, 'var LOGIN_REASONS = {', 'LOGIN_REASONS') + ';',
    balanced(RANGE, 'var SIGNOUT_CANDIDATE_REASONS = {', 'SIGNOUT_CANDIDATE_REASONS') + ';',
    balanced(RANGE, 'var STORAGE_REASONS = {', 'STORAGE_REASONS') + ';',
    balanced(RANGE, 'var NON_ATTEMPT_REASONS = {', 'NON_ATTEMPT_REASONS') + ';',
    balanced(RANGE, 'function reasonCode(value)', 'reasonCode'),
    balanced(RANGE, 'function isLoginReason(value)', 'isLoginReason'),
    balanced(RANGE, 'function isStorageReason(value)', 'isStorageReason'),
    balanced(RANGE, 'function own(obj, key)', 'own'),
    balanced(RANGE, 'function now()', 'now'),
    balanced(RANGE, 'function summarize(manifest)', 'summarize'),
    balanced(RANGE, 'function checkpointDay(ctx, monthKey, payload, seen)', 'checkpointDay')
  ].join('\n');
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    accountGuard() { return true; },
    persistContext() { return true; },
    stopImporter() {},
    currentExtVersion() { return '3.0.106'; }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'range-slices.js' });

  function freshCtx() {
    return { control: '', storageFailure: '', manifest: { status: 'running', months: { '2026-09': { status: 'running', days: {
      '2026-09-01': { status: 'pending', attempts: 0, reason: '' } } } } } };
  }
  const dayOf = c => c.manifest.months['2026-09'].days['2026-09-01'];

  /* the b1183 case: charts landed, seven notes still owed. */
  const owed = freshCtx();
  sandbox.__c = owed;
  sandbox.__p = { date: '2026-09-01', ok: true, complete: true, reason: 'complete', dayNotesPending: 7 };
  vm.runInContext('checkpointDay(__c, "2026-09", __p, {})', ctx);
  eq(dayOf(owed).status, 'retry', 'a day whose own visit notes are still owed was checkpointed COMPLETE - the durable half of the defect');
  eq(dayOf(owed).reason, 'day-notes-pending', 'the held-back day does not name the real cause');
  eq(dayOf(owed).attempts, 1, 'the held-back day did not spend a real attempt, so the cap could never bound it');

  /* the same day, once the notes are read */
  const read = freshCtx();
  sandbox.__c = read;
  sandbox.__p = { date: '2026-09-01', ok: true, complete: true, reason: 'complete', dayNotesPending: 0 };
  vm.runInContext('checkpointDay(__c, "2026-09", __p, {})', ctx);
  eq(dayOf(read).status, 'complete', 'a day whose notes ARE read is refused its completion');
  eq(dayOf(read).reason, 'complete', 'a finished day lost its own verdict');

  /* a receipt with no debt field at all behaves exactly as it did before */
  const legacy = freshCtx();
  sandbox.__c = legacy;
  sandbox.__p = { date: '2026-09-01', ok: true, complete: true, reason: 'empty-day' };
  vm.runInContext('checkpointDay(__c, "2026-09", __p, {})', ctx);
  eq(dayOf(legacy).status, 'complete', 'a receipt that predates the debt field stopped completing');
  eq(dayOf(legacy).reason, 'empty-day', 'a verified-empty day lost its own verdict');

  /* a real chart failure keeps ITS cause - the notes clause never steals it */
  const broken = freshCtx();
  sandbox.__c = broken;
  sandbox.__p = { date: '2026-09-01', ok: false, complete: false, reason: 'history-partial', dayNotesPending: 3 };
  vm.runInContext('checkpointDay(__c, "2026-09", __p, {})', ctx);
  eq(dayOf(broken).reason, 'history-partial', 'the day-note clause stole a chart failure\'s own cause');

  /* the honest tiles recount from the day records, so a held-back day is
     never counted as saved. */
  sandbox.__m = owed.manifest;
  const tiles = vm.runInContext('summarize(__m)', ctx);
  eq(tiles.complete, 0, 'the honest tiles count a day with unread own-notes as saved');
  eq(tiles.failed, 1, 'the honest tiles do not show the held-back day as still to retry');

  sandbox.__m = read.manifest;
  const tilesDone = vm.runInContext('summarize(__m)', ctx);
  eq(tilesDone.complete, 1, 'the honest tiles refuse to count a genuinely finished day');

  /* the importer forwards the debt on BOTH durable seams */
  ok(/dayNotesPending: p1MonthDayNotesPending\(outcome && outcome\.receipt\)/.test(IMPORTER),
    'the per-day checkpoint callback does not carry the day-note debt to the durable job');
  ok(/dayNotesPending: Number\(row\.dayNotesPending \|\|/.test(RANGE),
    'the month settling path does not carry the day-note debt');
  ok(/'day-notes-pending': 1/.test(RANGE), 'the day-notes-pending verdict is not in the durable reason vocabulary');
  ok(/'day-notes-pending': 'That day/.test(RANGE), 'the day-notes-pending verdict has no plain-English copy');
  console.log('  E. the durable job holds a day with unread own-notes out of "complete", and completes it once they are read');
}

/* =======================================================================
 * PART F - MLS's own athenaOne driving must never move the active patient.
 *
 * MEASURED live 2026-09-01 20:33: while this very lane was reading leftover
 * day-notes, the extension opened a patient's chart and the bidirectional
 * Follow feature's LEG B followed OUR OWN navigation - the header card flipped
 * to that chart while the doctor was in a different patient's History.
 * ===================================================================== */
function partFFollowGuard() {
  const FOLLOW = fs.readFileSync('feat_mls_athena_follow.js', 'utf8');

  /* the guard is scoped by af-1.0.0's OWN request-id prefix, so the pin has to
     prove that prefix is still what the follow lane mints. */
  ok(/var rid = 'af' \+ Date\.now\(\)\.toString\(36\)/.test(FOLLOW),
    'the follow lane no longer mints an "af"-prefixed request id, so the guard would stop nothing');
  ok(/mlsAppChartIdentityResult/.test(FOLLOW) && /window\.setActivePtId/.test(FOLLOW),
    'the follow lane no longer switches the active patient off a chart-identity reply');

  /* ---- the engine's predicate, executed ------------------------------- */
  const driverSlice = [
    statement(IMPORTER, 'var DNOTE_FOLLOW_VERSION =', 'DNOTE_FOLLOW_VERSION'),
    balanced(IMPORTER, 'function dnoteAthenaDriver()', 'dnoteAthenaDriver'),
    balanced(IMPORTER, 'function dnoteFollowReceipt()', 'dnoteFollowReceipt'),
    balanced(IMPORTER, 'function dnoteStampDriving()', 'dnoteStampDriving')
  ].join('\n');
  function driverContext(state) {
    const win = Object.assign({ __mlsPullBusyAt: 0 }, state.window || {});
    const sandbox = {
      console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
      safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
      isFn(v) { return typeof v === 'function'; },
      window: win,
      pullRunning: state.pullRunning === true,
      _tnDefer: { running: state.deferredRunning === true, queue: [] },
      _dnote: { draining: state.draining === true },
      _ni: { reading: state.idleReading === true },
      niLoad() { return sandbox._ni; },
      resumeBusyElsewhere() { return state.otherTab === true; }
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(driverSlice, ctx, { filename: 'driver-slice.js' });
    return { ctx, sandbox, run: expr => vm.runInContext(expr, ctx) };
  }
  const idle = driverContext({});
  eq(idle.run('dnoteFollowReceipt().driving'), false, 'an idle MLS claims to be driving athenaOne');
  eq(idle.run('dnoteAthenaDriver()'), '', 'an idle MLS names a driver');

  const lanes = [
    ['day-pull', { pullRunning: true }],
    ['patient-batch', { window: { __mlsSIBatchActive: true } }],
    ['deferred-round', { deferredRunning: true }],
    ['day-note-drain', { draining: true }],
    ['notes-idle', { idleReading: true }],
    ['day-history-pull', { window: { __mlsDayHistoryPull: { state: { running: true } } } }],
    ['month-pull', { window: { __mlsProvMonthPull: { running: true } } }],
    ['range-job', { window: { __mlsP1RangeJobs: { state: () => ({ status: 'running' }) } } }],
    ['visits-backfill', { window: { __mlsVisitsBackfill: { state: { running: true } } } }],
    ['write-lane', { window: { __mlsWriteFlow: { state: { running: true } } } }],
    ['other-tab', { otherTab: true }]
  ];
  lanes.forEach(([name, state]) => {
    const h = driverContext(state);
    eq(h.run('dnoteAthenaDriver()'), name, 'the "' + name + '" lane driving athenaOne is not reported as MLS driving it');
    eq(h.run('dnoteFollowReceipt().driving'), true, 'the "' + name + '" lane does not set the follow-refusal predicate');
  });
  /* a paused range job is NOT driving - the guard may not refuse for ever */
  const paused = driverContext({ window: { __mlsP1RangeJobs: { state: () => ({ status: 'paused' }) } } });
  eq(paused.run('dnoteAthenaDriver()'), '', 'a paused durable job is reported as driving athenaOne');

  /* the busy stamp the SHIPPED follow module already consults */
  const stamped = driverContext({});
  stamped.run('dnoteStampDriving()');
  ok(stamped.sandbox.window.__mlsPullBusyAt > 0,
    'an MLS-driven athenaOne read does not refresh the busy stamp the shipped follow guard reads');
  ok(/dnoteStampDriving\(\);\n    _ni\.state = "reading";/.test(IMPORTER),
    'the notes-idle read no longer stamps the busy marker before it opens a chart');
  ok(/safe\(dnoteStampDriving\);/.test(IMPORTER),
    'the immediate deferred round no longer stamps the busy marker before it opens a chart');

  /* ---- the app-side guard, executed against a real event dispatch ------ */
  /* everything the guard IS, up to but not including its own top-level
     registration (which carries a bare `return` only legal inside the IIFE). */
  const guardFrom = CONNECT.indexOf("  var VERSION = 'dnote-1.1.0';");
  const guardTo = CONNECT.indexOf("  try { window.addEventListener('message', onMessage, true); }", guardFrom);
  assert(guardFrom > 0 && guardTo > guardFrom, 'the follow guard block moved');
  const guardSrc = CONNECT.slice(guardFrom, guardTo);
  ok(/window\.addEventListener\('message', onMessage, true\)/.test(CONNECT.slice(guardTo, guardTo + 200)),
    'the follow guard no longer registers in the CAPTURE phase, so the follow lane hears the reply first');
  function guardContext(drivingBy) {
    const listeners = [];
    const active = { pid: 'doctors-own-patient' };
    const win = {
      __mlsAthenaDrivenByMls: () => ({ driving: drivingBy !== '', by: drivingBy }),
      addEventListener(type, fn, capture) { listeners.push({ type, fn, capture: capture === true }); },
      removeEventListener() {}
    };
    const sandbox = { console, JSON, Math, Object, String, Number, Boolean, Date, window: win, active };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(guardSrc, ctx, { filename: 'follow-guard.js' });
    /* the guard registers itself the way the shipped module does */
    vm.runInContext("window.addEventListener('message', onMessage, true);", ctx);
    /* af-1.0.0's LEG B, in miniature: its listener is NON-capturing and it
       calls setActivePtId on the identity it gets back. */
    const legB = { fired: 0 };
    win.addEventListener('message', () => { legB.fired++; active.pid = 'chart-mls-opened'; }, false);
    function dispatch(requestId) {
      let stopped = false;
      const ev = { data: { source: 'mls-ext', type: 'mlsAppChartIdentityResult', requestId: requestId,
        ok: true, identity: { name: 'Someone Else', dob: '1970-01-01' } },
        stopImmediatePropagation() { stopped = true; } };
      /* the DOM order this guard depends on: capture listeners on the target
         run before non-capturing ones, whatever the registration order. */
      const ordered = listeners.filter(l => l.capture).concat(listeners.filter(l => !l.capture));
      for (const l of ordered) { l.fn(ev); if (stopped) break; }
      return stopped;
    }
    return { ctx, dispatch, legB, active, run: expr => vm.runInContext(expr, ctx) };
  }

  /* (1) MLS is driving: the follow lane never hears the answer, and the
         doctor's active patient does not move. */
  const driven = guardContext('notes-idle');
  eq(driven.dispatch('af1abc0'), true, 'a chart-identity answer produced by MLS\'s own driving reached the follow lane');
  eq(driven.legB.fired, 0, 'the follow lane acted on a chart MLS opened itself');
  eq(driven.active.pid, 'doctors-own-patient',
    'MLS\'s own athenaOne navigation switched the doctor\'s active patient - the 2026-09-01 20:33 defect');
  eq(driven.run('shouldIgnoreChartIdentity()'), true, 'the guard does not report that it should ignore the event');
  eq(driven.run('drivingBy()'), 'notes-idle', 'the guard does not name the lane that was driving');

  /* (2) MLS is idle: the doctor's own chart still moves the patient. */
  const byHand = guardContext('');
  eq(byHand.dispatch('af1abc1'), false, 'the guard swallowed a chart the doctor opened by hand');
  eq(byHand.legB.fired, 1, 'the follow lane never heard about the doctor\'s own chart');
  eq(byHand.active.pid, 'chart-mls-opened', 'Follow stopped working when MLS was idle');

  /* (3) it is scoped to the follow lane: the write lane's own identity read
         is never swallowed, even mid-drive - it IS MLS driving athenaOne. */
  const other = guardContext('write-lane');
  eq(other.dispatch('wf-9911'), false, 'the guard swallowed a chart-identity answer that was not the follow lane\'s');
  eq(other.legB.fired, 1, 'a non-follow reader was starved of its own reply');

  /* (4) with no engine loaded the guard refuses nothing - it can only ever
         refuse a follow, never cause one. */
  const noEngine = guardContext(null);
  noEngine.run('delete window.__mlsAthenaDrivenByMls');
  eq(noEngine.run('drivingBy()'), '', 'the guard invents a driver when the engine is not loaded');
  eq(noEngine.dispatch('af1abc2'), false, 'the guard blocked Follow with no engine loaded to have been driving');

  console.log('  F. a chart MLS opened itself never moves the active patient; a chart the doctor opened still does');
}

async function main() {
  console.log('dnote-1.0.0 (b1184) - the pulled day\'s own visit note is a debt, proven');
  partAVocabulary();
  await partBDrainInsideThePull();
  partCStopIsScopedToItsOwnPull();
  partDSheetWording();
  partEDurableJob();
  partFFollowGuard();
  console.log('PASS day-note: ' + checks + ' checks - with Full visit notes OFF the pulled day\'s own note is read inside the pull; ' +
    'a deferred note is a DEBT that blocks the day\'s completion on the sheet and in the durable job; a Stop for one pull no longer ' +
    'leaves the leftover catch-up stopped for every pull after it; the sheet names queued / reading / read / no note in athenaOne / ' +
    'refused, with "need attention" reserved for a note whose retries are spent; and a chart MLS opened itself never moves the ' +
    'doctor\'s active patient while a chart the doctor opened by hand still does');
}

main().catch(error => { console.error(error); process.exit(1); });
