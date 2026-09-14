'use strict';
/* MLS Assist 3.0.125 follow-up seam (Fable, 2026-09-14): the corrected guard comment
 * inside the injected ActionV2 driver must not spell the worker message name
 * (athena-action-contract pins that the driver never names its own request). */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const a = "       here, in the worker (mlsAppAthenaActionV2Request), in write_safety_guard.js";
const b = "       here, in the worker request handler, in write_safety_guard.js";
assert(before.split(a).length === 2, 'unique seam');
assert(before.split(b).length === 1, 'replacement absent');
const out = before.replace(a, () => b);
assert.strictEqual(out.replace(b, () => a), before, 'inverse restores');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30125c: 1 verified seam');
