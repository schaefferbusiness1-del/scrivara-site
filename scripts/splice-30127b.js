'use strict';
/* MLS Assist 3.0.127 follow-up seam (Fable, 2026-09-14): when the banner's collapsed strip
 * puts the LEGAL name directly above the chip line, the reader's primary name is the legal
 * one and the USED name (before the "Legal:" line or before the colon) must be collected as
 * the alternative, so both printed names are always available to the exact-pair gate. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const a = "        if (lgn && lgn !== name && altNames.indexOf(lgn) < 0) altNames.push(lgn);";
const nl = before.indexOf('\n', before.indexOf(a)); const N = (before[nl - 1] === '\r') ? '\r\n' : '\n';
const b = a + N +
  "        var lgUsed = lgm.index > 0 ? lines[lg].slice(0, lgm.index) : String(lines[lg - 1] || '');" + N +
  "        var lgu = looksName(lgUsed.replace(/[()]/g, ' ').replace(/\\s+/g, ' ').trim());" + N +
  "        if (lgu && lgu !== name && altNames.indexOf(lgu) < 0) altNames.push(lgu);";
assert(before.split(a).length === 2, 'unique seam');
assert(before.split(b).length === 1, 'replacement absent');
const out = before.replace(a, () => b);
assert.strictEqual(out.replace(b, () => a), before, 'inverse restores');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30127b: 1 verified seam');
