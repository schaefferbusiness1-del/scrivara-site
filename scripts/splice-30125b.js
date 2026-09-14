'use strict';
/* MLS Assist 3.0.125 follow-up seam (Fable, 2026-09-14): the chart-frames-unbound
 * refusal must not reuse the ok:true response's `briefingDiag` key (pinned to
 * appear exactly once by briefing-problem-capture-runtime). Byte-preserving. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const a = "reason: 'chart-frames-unbound', attempted: false, captured: false, opened: opened, version: versionStrict, receipt: chartReceiptStrict, briefingDiag: briefingDiag, identityFill: __mlsIdentityFill,";
const b = "reason: 'chart-frames-unbound', attempted: false, captured: false, opened: opened, version: versionStrict, receipt: chartReceiptStrict, refusalDiag: { briefing: briefingDiag, identityFill: __mlsIdentityFill },";
assert(before.split(a).length === 2, 'unique seam');
assert(before.split(b).length === 1, 'replacement absent');
const out = before.replace(a, () => b);
assert.strictEqual(out.replace(b, () => a), before, 'inverse restores');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30125b: 1 verified seam');
