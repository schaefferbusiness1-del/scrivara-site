/* splice-3099-part1.js - ext 3.0.99: dateKey ISO branch (isodob-1.0.0).
 * The M/D/Y scanner first matches INSIDE an ISO year ("1962-03-04" -> 3/4/19..
 * garbage -> a real patient misread as a different person and refused). The
 * app-side fix (b1157 write-generality-1.0.0) already reads ISO first; this is
 * the extension's twin. Anchored ISO branch BEFORE the M/D/Y branch; the M/D/Y
 * branch is byte-untouched. Run from repo root.
 */
'use strict';
var fs = require('fs');
var FIND = "  function dateKey(v) { var m = /([01]?\\d)[\\/\\-.]([0-3]?\\d)[\\/\\-.](\\d{2,4})/.exec(clean(v)); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (Number(y) > ((new Date().getFullYear() % 100) + 1) ? '19' : '20') + y; return Number(m[1]) + '/' + Number(m[2]) + '/' + y; }";
var REPL = "  function dateKey(v) { /* isodob-1.0.0 (3.0.99): an ISO DOB (1962-03-04) must not be scanned by the M/D/Y reader - it first matches inside the YEAR and reads a different person (measured b1157 app-side; this is the extension twin). Anchored ISO branch first; the M/D/Y branch below is unchanged. */ var iso = /(^|[^0-9])(\\d{4})-([01]\\d)-([0-3]\\d)(?![0-9])/.exec(clean(v)); if (iso) { return Number(iso[3]) + '/' + Number(iso[4]) + '/' + iso[2]; } var m = /([01]?\\d)[\\/\\-.]([0-3]?\\d)[\\/\\-.](\\d{2,4})/.exec(clean(v)); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (Number(y) > ((new Date().getFullYear() % 100) + 1) ? '19' : '20') + y; return Number(m[1]) + '/' + Number(m[2]) + '/' + y; }";
var s = fs.readFileSync('background.js', 'latin1');
var n = s.split(FIND).length - 1;
if (n !== 1) { console.error('ABORT: dateKey anchor hits=' + n); process.exit(1); }
s = s.split(FIND).join(REPL);
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK isodob-1.0.0 spliced');
