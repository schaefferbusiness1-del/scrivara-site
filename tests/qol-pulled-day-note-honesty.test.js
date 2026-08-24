/* Full Notes scope control: OFF is schedule-only and must never open the
   historical pulled-day tail reader. The old receipt mapper remains so a
   saved receipt from an earlier build is still understandable after update. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'utf8');
const mc = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

assert.ok(/var pulledDayNoteTailEnabled = false;/.test(si),
  'the retired Full Notes OFF pulled-day body reader is not fail-closed');
assert.ok(/if \(pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped\)/.test(si),
  'the legacy tail reader is not guarded by the permanent OFF fuse');

const aggregateStart = si.indexOf('function tnAggregate()');
const aggregateEnd = si.indexOf('function tnBatchDay()', aggregateStart);
const aggregate = si.slice(aggregateStart, aggregateEnd);
assert.ok(aggregateStart > 0 && aggregateEnd > aggregateStart, 'the note receipt aggregator is extractable');
assert.ok(/if \(receipt\.visitNotesRequested !== true\)/.test(aggregate),
  'the receipt does not distinguish intentional OFF scope from a failed read');
assert.ok(/receipt\.todayNoteFailures = 0;/.test(aggregate),
  'Full Notes OFF can still invent a note-body failure');
assert.ok(/receipt\.todayNoteNotRequested = Number\(\(receipt\.patients \|\| \[\]\)\.length \|\| 0\)/.test(aggregate),
  'Full Notes OFF does not account for intentionally omitted note bodies');

const syncStart = si.indexOf('function niSyncFromReceipt(receipt, day)');
const syncEnd = si.indexOf('function niGate(force)', syncStart);
const sync = si.slice(syncStart, syncEnd);
assert.ok(/if \(receipt\.visitNotesRequested !== true\) return 0;/.test(sync),
  'an OFF receipt can still arm the deferred note-body reader');

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

console.log('qol-pulled-day-note-honesty: OK (Full Notes OFF tail and deferred readers are fused off, OFF receipts are explicitly not-requested with zero body failures, and legacy receipts remain readable)');
