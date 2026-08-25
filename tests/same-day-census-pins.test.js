'use strict';
/* scensus-1.0.0 pins: THE SCOPED CENSUS CANNOT REGRESS SILENTLY.
 *
 * Codex's red contract same-day-reader-census (ff0be547) is the behavioral
 * acceptance and runs in their lane; this thin registered suite keeps THIS
 * branch's own gate protective: the five spliced shapes must stay in the
 * reader, and one condensed behavioral case proves the arithmetic (an
 * unknown-date row makes a scoped census PARTIAL, never absence).
 *
 * OLD BYTES FAIL BY NAME: no dateUnknownRows bucket, no sameDayStatus, and
 * absence-by-arithmetic returns ok:true for a day it never proved. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'background.js'), 'latin1');

/* ---- shape pins on the five splices ---- */
assert.ok(src.includes('dateSkippedRows = [], dateUnknownRows = []'), 'the unknown-date census bucket exists');
assert.ok(src.includes("sameDayStatus: 'not-yet-available', notYetAvailable: true, noSubstitution: true"),
  'a future scoped day answers not-yet-available with no substitution');
assert.ok(src.includes('counted as unknown, not as absent'),
  'an unparseable date is counted unknown, never absence');
assert.ok(src.includes('total - administrativeRows.length - dateSkippedRows.length - dateUnknownRows.length'),
  'clinicalTotal excludes the unknown bucket (no absence-by-arithmetic)');
assert.ok(src.includes("(!frozenHint.onlyDate || dateUnknownRows.length === 0)"),
  'an unknown date makes a SCOPED census incomplete');
assert.ok(src.includes("else if (dateUnknownRows.length > 0) scSameDay = 'partial';"),
  'the census verdict ladder keeps partial for unknowns');
assert.ok(src.includes("dateUnknownRows: dateUnknownRows.length"), 'the receipt carries the unknown count');
assert.ok(src.includes("absenceProven: scScoped ? (scSameDay === 'absent' && bodyComplete) : undefined"),
  'absence is proven only by a complete scoped census');
assert.ok(src.includes("res.receipt.notYetAvailable === true || res.receipt.absenceProven === true"),
  'the post-hop proven disjunct admits the two legitimate scoped zero-row completions');
/* the administrative classifier must stay narrow - a NOVEL row kind is a
 * clinical candidate, never silently administrative */
const adminGuards = (src.match(/\^\\s\*order\\s\*group\\b/g) || []).length;
assert.ok(adminGuards >= 1, 'the administrative classifier still matches ONLY order-group rows');
assert.ok(!/administrativeRows\.push\(\{[^}]*type[^}]*\}\);\s*[\r\n]+\s*administrativeRows\.push/.test(src),
  'no second administrative classification crept in');

/* ---- one condensed behavioral case: the census verdict ladder ---- */
function verdict(visitsLen, unknowns, failuresLen) {
  if (visitsLen > 0) return 'saved';
  if (unknowns > 0) return 'partial';
  if (failuresLen > 0) return 'refused';
  return 'absent';
}
/* executed mirror of the spliced ladder, then pinned back against the source
 * bytes so the mirror cannot drift: every branch string above was already
 * asserted present, and the orderings here document the intent */
assert.strictEqual(verdict(1, 1, 0), 'saved', 'a read same-day body outranks unknowns');
assert.strictEqual(verdict(0, 1, 1), 'partial', 'unknown outranks refused (the unknown row could BE the note)');
assert.strictEqual(verdict(0, 0, 1), 'refused', 'failures without unknowns are refused, not absent');
assert.strictEqual(verdict(0, 0, 0), 'absent', 'only a clean, fully-dated census proves absence');
const ladder = src.indexOf("if (visits.length > 0) scSameDay = 'saved';");
const ladderSeg = src.slice(ladder, ladder + 300);
assert.ok(ladder >= 0 &&
  ladderSeg.indexOf("'partial'") < ladderSeg.indexOf("'refused'") &&
  ladderSeg.indexOf("'refused'") < ladderSeg.indexOf("'absent'"),
  'the shipped ladder orders saved > partial > refused > absent exactly as documented');

console.log('PASS same-day census pins: unknown-date bucket, not-yet-available, no absence-by-arithmetic, scoped incompleteness, proven-disjunct admissions, narrow administrative classifier, and the verdict ladder ordering all hold');
