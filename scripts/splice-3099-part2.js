/* splice-3099-part2.js - ext 3.0.99 rowfold-1.0.0: the appointment-id row
 * matcher's NAME CROSS-CHECK tolerates athena renderings. The holders in this
 * loop already carry the ONE exact wanted appointment id - the name test is an
 * echo check, yet it required a raw lowercase substring of first AND last name,
 * so an apostrophe ("O'Brien" vs "OBrien"), hyphen, or weld left the exact-id
 * row unmatched -> appointment-id-not-found -> terminal (the name fallback is
 * refused by design). Additive: the original check runs FIRST byte-identically;
 * only when it declines, both sides are folded to letters-only and re-tested.
 * Nothing that matched before can stop matching; the id anchor is untouched.
 */
'use strict';
var fs = require('fs');
var FIND = "                var t = rowText(row).toLowerCase();\n" +
  "                if (t && t.length < 700 && lname && t.indexOf(lname) !== -1 && (!fname || t.indexOf(fname) !== -1)) { matchedRow = row; break; }";
var REPL = "                var t = rowText(row).toLowerCase();\n" +
  "                if (t && t.length < 700 && lname && t.indexOf(lname) !== -1 && (!fname || t.indexOf(fname) !== -1)) { matchedRow = row; break; }\n" +
  "                /* rowfold-1.0.0 (3.0.99): id-anchored echo check tolerates apostrophes/hyphens/welds - letters-only fold, additive fallback only. */\n" +
  "                if (t && t.length < 700 && lname) { var tF0 = t.replace(/[^a-z]/g, ''), lF0 = String(lname).replace(/[^a-z]/g, ''), fF0 = String(fname || '').replace(/[^a-z]/g, ''); if (lF0 && tF0.indexOf(lF0) !== -1 && (!fF0 || tF0.indexOf(fF0) !== -1)) { matchedRow = row; break; } }";
var s = fs.readFileSync('background.js', 'latin1');
var n = s.split(FIND).length - 1;
if (n !== 1) { console.error('ABORT: rowfold anchor hits=' + n); process.exit(1); }
s = s.split(FIND).join(REPL);
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK rowfold-1.0.0 spliced');
