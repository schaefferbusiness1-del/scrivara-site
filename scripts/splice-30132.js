'use strict';
/* MLS Assist 3.0.132 - restorediag-1.1.0 (Fable, 2026-09-14). The content-script bridge shapes the
 * chart-open refusal diagnostics through a closed allowlist (PHI-safe by design), which dropped
 * the 3.0.130 per-frame restore evidence before the app or a recorder could see it. Add the two
 * closed fields: `stage` (letters/digits/space/hyphen only) and `regroundFrames` (per frame:
 * booleans, a bounded step count, and the driver's own reason head with every digit masked).
 * content.js is LF-only. Byte-preserving seam with an inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'content.js');
const before = fs.readFileSync(target, 'latin1');
const a = "              safeDiag.rowMrnMatched = openedDiag.rowMrnMatched === true;\n";
const b = a +
  "              /* restorediag-1.1.0 (3.0.132): closed per-frame evidence for the schedule-date restore refusal (no row, DOB, MRN or name; digits masked). */\n" +
  "              safeDiag.stage = mlsStr(openedDiag.stage, 40).replace(/[^a-z0-9 -]/gi, '');\n" +
  "              if (Array.isArray(openedDiag.regroundFrames)) safeDiag.regroundFrames = openedDiag.regroundFrames.slice(0, 8).map(function (f) { f = (f && typeof f === 'object') ? f : {}; return { done: f.done === true, unverified: f.unverified === true, dateMatch: f.dateMatch === true, steps: Math.max(0, Math.min(99, Number(f.steps) || 0)), head: mlsStr(f.head, 70).replace(/\\d/g, 'D') }; });\n";
assert(before.split(a).length === 2, 'unique seam');
assert(before.split(b).length === 1, 'replacement absent');
const out = before.replace(a, () => b);
assert.strictEqual(out.replace(b, () => a), before, 'inverse restores');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30132: 1 verified seam (content.js)');
