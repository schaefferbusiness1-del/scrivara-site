'use strict';
/* MLS Assist 3.0.158 - findbydob-2.1.0 (Fable, 2026-09-15). Run AH on 3.0.157: the used-vs-legal row (shape lx44,
 * the only same-surname row among 35 with that birth date) was still NOT taken as the used-name candidate
 * (usedNameCandidate false), so a token between the first and the last differs as well - and the 2.0.0 shape
 * demanded every non-first token equal. The schedule prints a middle INITIAL where athena's Find prints the full
 * middle name (or the reverse); the shape code only compared first and last, so it could not show that.
 * 2.1.0: (a) the used-name shape accepts a middle token that is a prefix of its counterpart (initial vs full name),
 * the last token and any particle still exact, the first token still different; (b) the shape code appends the
 * middle relation to every l-code (e equal, p prefix, x differs, n token counts differ) so the histogram explains
 * the next refusal too; (c) the by-DOB attempt's findUsedRows and findResultsTotal ride the ladder merge.
 * The gate is unchanged: only ONE such row on an uncapped list is opened, and the chart read's banner gate decides.
 * Latin1 seams, inverse proof. Run once (after splice-30157.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
function splice(file, fn) {
  const target = path.join(__dirname, '..', file);
  const before = fs.readFileSync(target, 'latin1');
  const { out, inverse } = fn(before);
  assert.strictEqual(inverse(out), before, file + ' inverse restores original');
  fs.writeFileSync(target, Buffer.from(out, 'latin1'));
}
const count = (s, n) => s.split(n).length - 1;
function mk(before) {
  let out = before; const edits = [];
  function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
  const inverse = (x) => { let y = x; for (const [a, b] of edits.slice().reverse()) { assert(count(y, b) === 1, 'inverse unique: ' + b.slice(0, 50)); y = y.replace(b, () => a); } return y; };
  return { rep, inverse, get: () => out };
}
splice('background.js', (before) => {
  const m = mk(before);
  m.rep(" var a = toks(req), b = toks(row); if (a.length < 2 || a.length !== b.length || a[0] === b[0]) return false; for (var i = 1; i < a.length; i++) { if (a[i] !== b[i]) return false; } return true; }",
        " var a = toks(req), b = toks(row); if (a.length < 2 || a.length !== b.length || a[0] === b[0]) return false; for (var i = 1; i < a.length; i++) { if (a[i] === b[i]) continue; if (i < a.length - 1 && (a[i].indexOf(b[i]) === 0 || b[i].indexOf(a[i]) === 0)) continue; /* findbydob-2.1.0 (3.0.158): a middle initial against the full middle name */ return false; } return true; }", 'used shape');
  m.rep(" return c + Math.min(9, a.length) + Math.min(9, b.length); }",
        " if (c.charAt(0) === 'l') { var __mid = 'n'; if (a.length === b.length) { __mid = 'e'; for (var __mi = 1; __mi < a.length - 1; __mi++) { if (a[__mi] === b[__mi]) continue; if (a[__mi].indexOf(b[__mi]) === 0 || b[__mi].indexOf(a[__mi]) === 0) { if (__mid === 'e') __mid = 'p'; continue; } __mid = 'x'; break; } } c += __mid; } /* findbydob-2.1.0: the middle-token relation on same-surname rows */" +
        " return c + Math.min(9, a.length) + Math.min(9, b.length); }", 'shape middle');
  m.rep("dobFindAltRows: Number(frd && frd.diag && frd.diag.findAltRows) || 0 }); } catch (eFrd) {} }",
        "dobFindAltRows: Number(frd && frd.diag && frd.diag.findAltRows) || 0, dobFindUsedRows: Number(frd && frd.diag && frd.diag.findUsedRows) || 0, dobFindResultsTotal: Number(frd && frd.diag && frd.diag.findResultsTotal) || 0 }); } catch (eFrd) {} }", 'ladder counts');
  console.log('splice-30158 background.js: 3 seams');
  return { out: m.get(), inverse: m.inverse };
});
splice('content.js', (before) => {
  const m = mk(before);
  m.rep("'findUsedRows', 'findResultsTotal' /* findbydob-2.0.0 (3.0.157) */].forEach(function (key) {",
        "'findUsedRows', 'findResultsTotal' /* findbydob-2.0.0 (3.0.157) */, 'dobFindUsedRows', 'dobFindResultsTotal' /* findbydob-2.1.0 (3.0.158) */].forEach(function (key) {", 'content counts');
  console.log('splice-30158 content.js: 1 seam');
  return { out: m.get(), inverse: m.inverse };
});
