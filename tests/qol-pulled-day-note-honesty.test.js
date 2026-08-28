/* Full Notes scope control, under the contract ACTUALLY in force.
 *
 * This header used to read "OFF is schedule-only and must never open the
 * historical pulled-day tail reader". That was true of an earlier contract and
 * is no longer true of this one: dayfacts-1.0.1 makes the pulled-day note
 * MANDATORY IN BOTH MODES, and the tail is now a same-day catch-up for rows the
 * inline fold-in never reached - every identifier in it is todayNote*, keyed to
 * the batch row's own day. That is precisely the owner's Full Notes
 * requirement: OFF saves schedule/booking plus THE REQUIRED SAME-DAY VISIT
 * CONTEXT, and only OLDER visit notes are skipped.
 *
 * The suite kept asserting the revoked contract and was therefore RED ON MAIN,
 * while fourteen sibling suites encoded the live one and passed. Making the
 * engine match the old literal would have disabled a mandatory pass to turn a
 * test green - breaking the pull to satisfy a stale assertion.
 *
 * What it pins now is the honesty the old assertions were really protecting,
 * expressed against the live contract: a PER-ROW state rather than a lump-sum
 * "not requested" that can hide a real failure, deferred counted apart from
 * failed, a closed reason vocabulary for failures, and an idle backfill that
 * never re-opens a chart already accounted for. The legacy receipt mapper
 * checks below are untouched - an old saved receipt must still be readable
 * after an update. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'utf8');
const mc = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

/* dnstale-1.0.0 (2026-08-28): this suite used to demand
       var pulledDayNoteTailEnabled = false;
   on the premise in its own header - "OFF is schedule-only and must never open
   the historical pulled-day tail reader". That premise was SUPERSEDED, by an
   explicit owner contract, and this assertion was never updated - so it has
   been red on main while fourteen sibling suites encode the current contract
   and pass.
     feat_mls_schedimport_exact.js:6600
       "dayfacts-1.0.1: the pulled-day note is MANDATORY in both modes now"
     :7021  "the tail pass is the day-facts catch-up for rows the inline
             fold-in never reached ... Mandatory under the superseding contract"
   And the tail is no longer the historical reader the header describes: every
   identifier in it is todayNote* and it is keyed to the batch row's OWN day, so
   it cannot reach another day's note. That is exactly the owner's Full Notes
   requirement - OFF saves schedule/booking plus THE REQUIRED SAME-DAY VISIT
   CONTEXT, and only OLDER visit notes are skipped.
   Setting the fuse false to satisfy the old literal would disable a pass the
   current contract calls mandatory and degrade day-facts completeness on rows
   the inline pass missed - i.e. it would break the pull to make a test green.
   So this pins the INVARIANT the old assertion was really protecting, and pins
   it harder: the tail runs only in the OFF path, it is bound to the row's own
   day, and the superseding contract must still be the one in force. */
assert.ok(/dayfacts-1\.0\.1: the pulled-day note is MANDATORY in both modes now/.test(si),
  'the superseding owner DAY contract is gone - if the pulled-day note is no longer mandatory in both modes, this suite must be re-derived, not silenced');
assert.ok(/todayNoteDayById\[pid\] = batchRowDay\(r\)/.test(si),
  'the pulled-day tail is no longer bound to the batch row OWN day - it could reach another day than the one being pulled');
assert.ok(!/var pulledDayNoteTailEnabled = false;/.test(si) || /pulledDayNoteTailEnabled = true;/.test(si),
  'the pulled-day tail fuse is off, which disables the mandatory day-facts catch-up');
assert.ok(/if \(pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped\)/.test(si),
  'the legacy tail reader is not guarded by the permanent OFF fuse');

const aggregateStart = si.indexOf('function tnAggregate()');
const aggregateEnd = si.indexOf('function tnBatchDay()', aggregateStart);
const aggregate = si.slice(aggregateStart, aggregateEnd);
assert.ok(aggregateStart > 0 && aggregateEnd > aggregateStart, 'the note receipt aggregator is extractable');
/* dnstale-1.0.0: the three assertions that stood here pinned the OLD contract -
   a blanket "OFF means not-requested" short-circuit, a hard todayNoteFailures=0,
   and todayNoteNotRequested set to the whole roster. dayfacts-1.0.1 revoked all
   three ON PURPOSE and says so at this very function:
     "the pulled-day note is MANDATORY in both modes now, so the old checkbox
      short-circuit ('OFF is a deliberate scope choice, not an unread note') is
      gone - the real per-row tally below runs for day-facts rows too. The only
      true not-requested case is the blocked-unchosen door, which returns before
      any tally exists."
   The honesty requirement did not go away - it got STRONGER, and a blanket
   not-requested count is exactly the kind of lump sum that hides a real failure.
   So this now pins the per-row vocabulary the receipt actually reports, which is
   what lets a surface say completion / partial / failed / retrying without
   guessing. */
assert.ok(/receipt\.todayNoteNotRequested = 0;/.test(aggregate),
  'the receipt is inventing a blanket not-requested count again - under the superseding contract the only true not-requested case returns before any tally exists');
/* Regex LITERALS, deliberately - building these from strings is how the escapes
   get eaten in transit and an assertion silently stops meaning anything. */
for (const [re, why] of [
  [/if \(p\.todayNote === true\)/, 'a read note'],
  [/if \(p\.todayNote === "already-read"\)/, 'a note already on file from earlier today'],
  [/if \(p\.todayNote === "not-yet"\)/, 'an appointment whose note cannot exist yet'],
  [/if \(p\.todayNote === "future-day"\)/, 'a future day'],
  [/if \(p\.todayNote === false\)/, 'a genuine failed read'],
]) {
  assert.ok(re.test(aggregate),
    'the pulled-day receipt no longer distinguishes ' + why + ' - a surface would have to guess');
}
assert.ok(/if \(p\.todayNoteDeferred === true\) tnQueuedNow\+\+;/.test(aggregate),
  'a row waiting on the background backfill is being counted as a FAILURE - it has not failed, it has not finished');
assert.ok(/tnReasonCode\(p\.todayNoteReason\)/.test(aggregate),
  'failed reads no longer carry a closed reason vocabulary, so a surface cannot render why without inventing wording');

const syncStart = si.indexOf('function niSyncFromReceipt(receipt, day)');
const syncEnd = si.indexOf('function niGate(force)', syncStart);
const sync = si.slice(syncStart, syncEnd);
/* dnstale-1.0.0: likewise revoked, in writing, at this function:
     "day-facts receipts DO carry a per-row day-note stage; the old
      OFF-has-no-stage premise is revoked with its contract."
   What must still hold is that the backfill is fed from the per-row STATE and
   never re-opens a chart whose note is already accounted for. */
assert.ok(/if \(p\.todayNote === true \|\| p\.todayNote === "already-read"\) \{ niDrop\(p\.patientId, d, "read-in-pull"\); return; \}/.test(sync),
  'the idle backfill would re-open a chart whose note was already read in the pull');
assert.ok(/if \(p\.todayNote === "not-yet" \|\| p\.todayNote === "future-day"\) return;/.test(sync),
  'the idle backfill would chase a note that cannot exist yet');
assert.ok(/__mlsPullStopRequested === true/.test(sync),
  'a stopped pull can still arm the deferred note-body reader');

/* Older receipts may carry the retired failure slug; keep its human wording
   ahead of the generic visit-body mapping during the upgrade window. */
const mapper = mc.slice(mc.indexOf('function ppHumanWhy(raw)'), mc.indexOf('function rowsHtml('));
const idxDay = mapper.indexOf('pulled-day-note-unread');
const idxGeneric = mapper.indexOf('visit-bodies-incomplete');
assert.ok(idxDay > 0, 'mapper no longer understands a legacy pulled-day receipt');
assert.ok(idxGeneric > idxDay, 'legacy pulled-day wording no longer precedes the generic body wording');
const fn = new Function(mapper + '\nreturn ppHumanWhy;')();
assert.strictEqual(fn('pulled-day-note-unread scoped-read-unverified'),
  'today’s note could not be read this time — pull again later; nothing was lost');
assert.strictEqual(fn('visit-bodies-incomplete {no-row}'), 'some visit notes could not be read');

console.log('qol-pulled-day-note-honesty: OK (the pulled-day note is mandatory in both modes, the receipt reports a per-row state rather than a lump sum, deferred is not failed, and the backfill never re-opens an accounted note) // legacy tail: zero body failures, and legacy receipts remain readable)');
