'use strict';
/* MLS Assist 3.0.156 - hoistfix-1.0.0 (Fable, 2026-09-15). Run AF on 3.0.155: EVERY chart read answered
 * "mlsExactDobKey is not a function" in ~4 s. Cause: 3.0.123 (3813b370) placed byte-identical copies of
 * mlsExactNameKey and mlsExactDobKey as function DECLARATIONS inside a bare block of the chart handler
 * (the frame-binding block after the text read). Sloppy-mode block-level function declarations hoist to the
 * enclosing function as `undefined` until the block runs (Annex B), so inside the handler both names were
 * undefined during the identity poll and the bootstrap-lease bind: the 3.0.155 poll code was the first to
 * call one there on every read, and the pre-existing bootstrap branch (validBootstrapDob, exactBootstrapName,
 * chosenDobKey) had thrown the same way since 3.0.123 - every bootstrap read failed and was retried in plain
 * mode. Cure: DELETE the two block-local copies (identical to the top-level globals, which the classic service
 * worker exposes everywhere). Nothing added. Latin1 slice, inverse proof. Run once (after splice-30155.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const count = (s, n) => s.split(n).length - 1;
const startTok = '          function mlsExactNameKey(value) {\n';
assert(count(before, startTok) === 1, 'one block-local mlsExactNameKey (' + count(before, startTok) + ')');
const s = before.indexOf(startTok);
/* the end: the closing brace of the SECOND function declaration (mlsExactDobKey), found by brace depth */
function closeOf(from) { let d = 0, i = from; for (; i < before.length; i++) { const ch = before[i]; if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) return i; } } return -1; }
const nameClose = closeOf(s); const dobStart = before.indexOf('          function mlsExactDobKey(value) {\n', nameClose);
assert(nameClose > s && dobStart > nameClose && dobStart - nameClose < 20, 'the DOB copy follows the name copy directly');
const dobClose = closeOf(dobStart); assert(dobClose > dobStart, 'DOB copy close');
const e = before.indexOf('\n', dobClose); assert(e > dobClose && e - s < 3000, 'block-local pair located');
const endTok = '\n'; /* the terminator of the DOB copy's closing line, removed with it */
const removed = before.slice(s, e + endTok.length);
assert(count(removed, 'function mlsExactNameKey(value) {') === 1 && count(removed, 'function mlsExactDobKey(value) {') === 1, 'exactly the two copies');
/* the copies must be byte-identical (modulo indentation) to the top-level globals they shadow */
const norm = (t) => t.split('\n').map((l) => l.replace(/\r$/, '').trim()).filter(Boolean).join('\n');
const gStart = before.indexOf('\nfunction mlsExactNameKey(value) {\n') + 1; const gEnd = before.indexOf('\n}\n', before.indexOf('\nfunction mlsExactDobKey(value) {\n', gStart)) + 3;
assert(norm(before.slice(gStart, gEnd)) === norm(removed), 'the block-local copies equal the globals');
const out = before.slice(0, s) + before.slice(e + endTok.length);
assert.strictEqual(out.slice(0, s) + removed + out.slice(s), before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30155b: removed ' + removed.split('\n').length + ' lines (two block-local key copies)');
