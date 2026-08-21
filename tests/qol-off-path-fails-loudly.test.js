'use strict';
/* qol-2.2 D4 control: THE OFF PATH CAN FAIL LOUDLY.
   todayNoteReason was written in four places and read in zero beyond one
   panel emit - no receipt aggregate, no day-end mention, no error report,
   and the no-day branch emitted nothing at all. A green OFF run proved
   nothing (and one false "9/15 fetched" claim rode exactly that silence). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'latin1');
const mc = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

/* The day-note lane owns a verdict-neutral column. Its live update and its
   post-Done restamp both resolve the SAME row by immutable pid, never by list
   position or by creating a second failed chart row. */
const columnStart = si.indexOf('function tnColumn(entry)');
const columnEnd = si.indexOf('/* ===== end tny-1.0.0 ===== */', columnStart);
assert.ok(columnStart > 0 && columnEnd > columnStart, 'dedicated day-note column block exists');
const column = si.slice(columnStart, columnEnd);
assert.ok(/pid \? String\(r\.pid \|\| ""\) === pid : String\(r\.name \|\| ""\) === nm/.test(column),
  'post-Done restamps resolve the exact patient row by pid');
assert.ok(/\{ pid: entry\.patientId, sp: entry\.summaryPending === true, dn: col, dnDay: tnEntryDay\(entry\)/.test(column),
  'live emits carry exact patient and day ownership with the dedicated cell');
assert.strictEqual((si.match(/ppSettle\(oneTn\.name, false, "pulled-day-note-unread/g) || []).length, 0,
  'day-note failures never create a phantom failed chart row');
assert.ok(/todayNoteReason = tnGate\.ok \? "reader-unavailable" : tnGate\.reason; tnEmitDayNoteColumn\(oneTn\); continue;/.test(si),
  'the no-day/reader-unavailable branch emits its exact reason instead of swallowing it');

/* EXECUTED: the receipt aggregate counts failures and reasons */
const aggStart = si.indexOf('function tnAggregate()');
assert.ok(aggStart > 0, 'receipt aggregate exists');
const aggEnd = si.indexOf('function tnBatchDay()', aggStart);
assert.ok(aggEnd > aggStart, 'aggregate terminator found');
const aggSrc = si.slice(aggStart, aggEnd);
const reasonStart = si.indexOf('var TN_NO_TAB_REASON');
const reasonEnd = si.indexOf('function tnIsNoTabReason', reasonStart);
assert.ok(reasonStart > 0 && reasonEnd > reasonStart, 'closed reason-code mapper is extractable');
const reasonSrc = si.slice(reasonStart, reasonEnd);
const receipt = { patients: [
  { todayNote: false, todayNoteReason: 'reader-unavailable' },
  { todayNote: true },
  { todayNote: false, todayNoteReason: 'reader-unavailable' },
  { todayNote: false, todayNoteReason: 'no-day-on-row' },
  {}
] };
new Function('receipt', reasonSrc + '\n' + aggSrc + '\nreturn tnAggregate();')(receipt);
assert.strictEqual(receipt.todayNoteFailures, 3, 'aggregate counts every todayNote failure');
assert.deepStrictEqual(receipt.todayNoteReasons, { 'reader-unavailable': 2, 'no-day-on-row': 1 }, 'aggregate histograms the reasons');
assert.deepStrictEqual(receipt.todayNoteReasonCodes, { 'reader-unavailable': 2, other: 1 },
  'the same census publishes a closed, PHI-safe reason vocabulary');

/* the day-end success line and the error report both read the aggregate */
assert.ok(/todayNoteFailures[\s\S]{0,200}pulled-day note/.test(mc), 'the day-end success line names unread pulled-day notes');
assert.ok(/todayNoteFailures: Number\(hr\.todayNoteFailures \|\| 0\)/.test(mc), 'the Copy-error-report carries the failure count');
assert.ok(/todayNoteReasons/.test(mc.slice(mc.indexOf('retryReasons: dsReasonHistogram'), mc.indexOf('retryReasons: dsReasonHistogram') + 600)), 'the report carries the reason histogram');

/* EXECUTED: a visits reader that resolved NOTHING is no longer a success.
   The exact shipped wrapper handler runs here: undefined (busy / no patient)
   must come back ok:false with a named reason; a number - including 0 - is
   an honest success. */
const thenStart = mc.indexOf('.then(function (n) { api.running = false; api.current = null; if (typeof n !== ');
assert.ok(thenStart > 0, 'the no-false-green wrapper exists');
const handlerSrc = mc.slice(thenStart + '.then('.length, mc.indexOf('}, /*', thenStart) + 1);
const mkApi = () => ({ running: true, current: 1 });
const handler = new Function('api', 'return (' + handlerSrc + ');')(mkApi());
const gotNothing = handler(undefined);
assert.strictEqual(gotNothing.ok, false, 'non-vacuity by execution: an undefined resolve is a FAILURE now');
assert.strictEqual(gotNothing.reason, 'visits-reader-returned-nothing', 'and it says why');
assert.deepStrictEqual(handler(3), { ok: true, visits: 3 }, 'a real count stays a success');
assert.deepStrictEqual(handler(0), { ok: true, visits: 0 }, 'an honestly empty day stays a success');

/* the legacy leg no longer scopes a past day to today */
assert.ok(mc.indexOf('var vdayKnown') > 0 && mc.indexOf("{ onlyDate: vdayKnown }") > 0, 'the scoped note read uses only a KNOWN day');
assert.ok(mc.indexOf("reason: 'pulled-day-unknown'") > 0, 'an unknown day fails loudly instead of reading the wrong day');

console.log('qol-off-path-fails-loudly: OK (pid/day-keyed verdict-neutral column, no-day branch emits, aggregate executed 3/{2,1}, day-end + report wired, undefined-resolve fails by name, known-day scoping)');
