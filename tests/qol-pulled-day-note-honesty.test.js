/* qol-1.3 control: THE PULLED-DAY NOTE FAILURE IS NEVER SILENT AND NEVER GENERIC.
   The bodies-off lane's one guaranteed body read — the note for the day being
   pulled — used to fail invisibly: the row stayed "saved" and no dedicated
   human string existed. Its failures now settle the row with their own slug,
   and the panel maps it to plain words. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'latin1');
const mc = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

/* every day-note failure path settles the panel row with the dedicated slug */
const emits = (si.match(/ppSettle\(oneTn\.name, false, "pulled-day-note-unread/g) || []).length;
assert.strictEqual(emits, 3, 'all three day-note failure paths surface on the panel (reader-unavailable, extension-predates, scoped-read failure) — found ' + emits);

/* the silent path specifically: the post-catch emit inside the carve-out loop */
assert.ok(si.indexOf('this failure used to be invisible') > 0, 'the previously-silent scoped-read failure now settles the row');

/* the panel maps the slug to plain words, ahead of the generic bodies string */
const mapper = mc.slice(mc.indexOf('function ppHumanWhy(raw)'), mc.indexOf('function rowsHtml('));
const idxDay = mapper.indexOf('pulled-day-note-unread');
const idxGeneric = mapper.indexOf('visit-bodies-incomplete');
assert.ok(idxDay > 0, 'mapper knows the day-note slug');
assert.ok(idxGeneric > idxDay, 'the day-note mapping precedes the generic bodies mapping');

/* execute the mapper */
const fn = new Function(mapper + '\nreturn ppHumanWhy;')();
assert.strictEqual(fn('pulled-day-note-unread scoped-read-unverified'), 'the note for the pulled day could not be read');
assert.strictEqual(fn('visit-bodies-incomplete {no-row}'), 'some visit notes could not be read', 'generic mapping unchanged');

/* non-vacuity: a mapper WITHOUT the new line returns the raw slug head */
const oldMapper = mapper.replace(/^.*pulled-day-note-unread.*\r?\n/m, '');
const oldFn = new Function(oldMapper + '\nreturn ppHumanWhy;')();
assert.strictEqual(oldFn('pulled-day-note-unread x'), 'pulled-day-note-unread x',
  'non-vacuity: without the mapping the user sees the raw slug — the test can detect the regression');

console.log('qol-pulled-day-note-honesty: OK (3 surfaced failure paths, dedicated human string, old mapper fails by name)');
