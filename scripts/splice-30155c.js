'use strict';
/* MLS Assist 3.0.156 - hoistfix-1.0.0, part 2 (Fable, 2026-09-15). splice-30155b deleted the chart handler's
 * block-local copies of mlsExactNameKey / mlsExactDobKey. A lexer-aware scope scan then showed that EVERY other
 * copy in background.js sits inside an injected page driver (mlsAthenaActionV2DriverFn, the Find driver, the
 * visits driver, ...) - the worker itself never had a global, which is why 3.0.123 planted copies inside the
 * handler (in a bare block, where they hoisted as undefined above the block). The worker gets ONE top-level
 * copy, byte-identical to the driver copies, inserted before mlsPickEmrTab (column 0, depth 0, LF region), so the
 * chart handler's poll, bootstrap bind and frame-binding block all resolve the same function.
 * Latin1 insertion, inverse proof. Run once (after splice-30155b.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const count = (s, n) => s.split(n).length - 1;
const anchor = '\r\nfunction mlsPickEmrTab(all) {\r\n'; /* CRLF region */
assert(count(before, anchor) === 1, 'anchor unique');
/* the source: the first driver copy (inside mlsAthenaActionV2DriverFn), both functions, column 0 */
const srcStart = before.indexOf('\nfunction mlsExactNameKey(value) {\n') + 1;
const dobStart = before.indexOf('\nfunction mlsExactDobKey(value) {\n', srcStart) + 1;
const srcEnd = before.indexOf('\n}\n', dobStart) + 3;
assert(srcStart > 0 && dobStart > srcStart && srcEnd > dobStart && srcEnd - srcStart < 3000, 'driver copy located');
const pair = before.slice(srcStart, srcEnd);
assert(/^function mlsExactNameKey\(value\) \{\n/.test(pair) && count(pair, '\nfunction mlsExactDobKey(value) {\n') === 1 && count(pair, '\nfunction ') === 1 && /\n}\n$/.test(pair) && pair.indexOf('\r') < 0, 'a clean LF pair');
const block = ('/* hoistfix-1.0.0 (3.0.156): the worker\'s ONE top-level copy of the exact identity keys. Every other copy in this file\n' +
  '   lives inside an injected page driver and is invisible here; the 3.0.123 handler-local copies sat in a bare block and\n' +
  '   hoisted as undefined above it (Run AF on 3.0.155: 40 of 40 reads "mlsExactDobKey is not a function"). */\n' + pair).replace(/\n/g, '\r\n');
assert(count(before, 'hoistfix-1.0.0 (3.0.156)') === 0, 'not applied yet');
const at = before.indexOf(anchor) + 2;
const out = before.slice(0, at) + block + before.slice(at);
assert.strictEqual(out.slice(0, at) + out.slice(at + block.length), before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30155c: inserted the worker-level key pair (' + block.split('\n').length + ' lines) before mlsPickEmrTab');
