/* qol-1.3 control: THE PULLED-DAY NOTE FAILURE IS NEVER SILENT AND NEVER GENERIC.
   The bodies-off lane's one guaranteed body read — the note for the day being
   pulled — used to fail invisibly. Its outcome now rides the dedicated day-note
   column, while the chart/history verdict remains untouched, and the legacy
   reason mapper still renders old receipts in plain words. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'utf8');
const mc = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

/* Every failure path emits the verdict-neutral column. The first two refuse
   early; the scoped-read path reaches the common emit after success or failure. */
const tailStart = si.indexOf('if (pullVisitBodies !== true && !__stpStopped)');
const tailEnd = si.indexOf('} catch (eTodayNotePass) {', tailStart);
assert.ok(tailStart > 0 && tailEnd > tailStart, 'the bodies-off tail pass is extractable');
const tail = si.slice(tailStart, tailEnd);
assert.ok(/todayNoteReason = tnGate\.ok \? "reader-unavailable" : tnGate\.reason; tnEmitDayNoteColumn\(oneTn\); continue;/.test(tail),
  'reader-unavailable/no-day refusal is visible in the dedicated column');
assert.ok(/todayNoteReason = "extension-predates-scoped-read"; tnEmitDayNoteColumn\(oneTn\); continue;/.test(tail),
  'an extension that cannot perform the scoped read is visible in the dedicated column');
const scopedCatch = tail.indexOf('catch (eTn2)');
const scopedEmit = tail.indexOf('tnEmitDayNoteColumn(oneTn);', scopedCatch);
assert.ok(scopedCatch > 0 && scopedEmit > scopedCatch,
  'the scoped-read exception/refusal reaches the common dedicated-column emit');

const columnStart = si.indexOf('function tnColumn(entry)');
const columnEnd = si.indexOf('/* ===== end tny-1.0.0 ===== */', columnStart);
const column = si.slice(columnStart, columnEnd);
assert.ok(columnStart > 0 && columnEnd > columnStart, 'the dedicated day-note ledger is extractable');
assert.ok(/if \(entry\.todayNote === false\) return "unread:" \+ String\(entry\.todayNoteReason \|\| "unknown"\)/.test(column),
  'the ledger carries the exact unread reason');
assert.ok(/\{ pid: entry\.patientId, sp: entry\.summaryPending === true, dn: col, dnDay: tnEntryDay\(entry\)/.test(column),
  'the day-note cell is keyed to the exact patient and day');
assert.strictEqual((si.match(/ppSettle\(oneTn\.name, false, "pulled-day-note-unread/g) || []).length, 0,
  'an unread day note must never replace a saved chart/history verdict');

/* the panel maps the slug to plain words, ahead of the generic bodies string */
const mapper = mc.slice(mc.indexOf('function ppHumanWhy(raw)'), mc.indexOf('function rowsHtml('));
const idxDay = mapper.indexOf('pulled-day-note-unread');
const idxGeneric = mapper.indexOf('visit-bodies-incomplete');
assert.ok(idxDay > 0, 'mapper knows the day-note slug');
assert.ok(idxGeneric > idxDay, 'the day-note mapping precedes the generic bodies mapping');

/* execute the mapper */
const fn = new Function(mapper + '\nreturn ppHumanWhy;')();
assert.strictEqual(fn('pulled-day-note-unread scoped-read-unverified'),
  'today’s note could not be read this time — pull again later; nothing was lost');
assert.strictEqual(fn('visit-bodies-incomplete {no-row}'), 'some visit notes could not be read', 'generic mapping unchanged');

/* non-vacuity: a mapper WITHOUT the new line returns the raw slug head */
const oldMapper = mapper.replace(/^.*pulled-day-note-unread.*\r?\n/m, '');
const oldFn = new Function(oldMapper + '\nreturn ppHumanWhy;')();
assert.strictEqual(oldFn('pulled-day-note-unread x'), 'pulled-day-note-unread x',
  'non-vacuity: without the mapping the user sees the raw slug — the test can detect the regression');

console.log('qol-pulled-day-note-honesty: OK (3 surfaced failure paths, verdict-neutral patient/day ledger, dedicated human string, old mapper fails by name)');
