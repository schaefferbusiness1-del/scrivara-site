'use strict';
/* MLS Assist 3.0.129 - bannernames-1.2.0 (Fable, 2026-09-14). Measured on the 3.0.128 run: the
 * wrong-chart refusal fired with pairReason 'exact-name+dob' (the exact pair HAD matched via the
 * banner's second printed name, identVia shadow-labels, bannerNamesPrinted 2). The 3.0.125 gate
 * still carried "!globalNameMatches" (a primary-name-only check) in the refusal condition, so a
 * legal-name match through altNames was refused anyway. The refusal now depends only on the
 * exact-pair verdict. Byte-preserving latin1 seam with an inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const a = "          if (want && ident && ident.name && (!globalNameMatches || globalStrongMismatch)) {";
const b = "          if (want && ident && ident.name && !exactGlobalPair.ok) { /* bannernames-1.2.0 (3.0.129): the exact-pair verdict (over every printed name) is the only wrong-chart test */";
assert(before.split(a).length === 2, 'unique seam');
assert(before.split(b).length === 1, 'replacement absent');
const out = before.replace(a, () => b);
assert.strictEqual(out.replace(b, () => a), before, 'inverse restores');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30129: 1 verified seam');
