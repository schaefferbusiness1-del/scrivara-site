'use strict';
/* si-1.7.7 — outdated-extension hint on receipt-gate failures.
 * Live 2026-07-18 (owner's father, Mac): every pull ended in a bare
 * "not verified" with no way out. An old MLS Assist cannot produce the
 * request-bound receipts the fail-closed gates demand, so the machine loops
 * forever unless someone guesses the extension is stale. The pull now names
 * the installed vs published version and says to update THIS computer.
 * Fail-closed behavior is unchanged — the hint only explains it. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

assert(si.includes('var VERSION = "si-1.7.7"'), 'si-1.7.7 release marker missing');

/* the hint must trigger ONLY on receipt-shaped failures, never on e.g. signin */
const gates = si.match(/RECEIPT_GATE_REASONS = \{([^}]+)\}/);
assert(gates, 'receipt-gate reason set missing');
for (const reason of ['no-read', 'schedule-incomplete', 'schedule-request-unbound', 'provider-roster-incomplete', 'provider-roster-unbound', 'unverified-day']) {
  assert(gates[1].includes('"' + reason + '"'), 'receipt-gate set must include ' + reason);
}
assert(!gates[1].includes('signin'), 'a sign-in failure must never blame the extension');
assert(!gates[1].includes('wrong-day'), 'a wrong-day failure is not an extension-age symptom');

/* pong version captured, published version fetched, hint attached in fail() */
assert(si.includes('extPong.version = String(pong && (pong.version || pong.extVersion) || "").trim()'),
  'the answering extension version must come from THIS pull\'s pong');
assert(si.includes('fetch("extension-version.json?ts="'), 'the published version must come from the site manifest');
assert(si.includes('out.extUpdateHint = hint'), 'the failure result must carry the hint');
assert(si.includes('update MLS Assist on THIS computer'), 'the hint must say which computer to update');

/* version compare: strictly less, never claims outdated on garbage */
const verLessSrc = si.match(/function verLess\(a, b\) \{[\s\S]*?\n  \}/);
assert(verLessSrc, 'verLess not found');
const verLess = new Function('return ' + verLessSrc[0])();
assert.strictEqual(verLess('2.9.22', '2.9.41'), true, '2.9.22 must read as older than 2.9.41');
assert.strictEqual(verLess('2.9.41', '2.9.41'), false, 'equal versions are not outdated');
assert.strictEqual(verLess('2.10.0', '2.9.41'), false, 'numeric compare, not string compare');
assert.strictEqual(verLess('1.65', '2.9.41'), true, 'legacy 1.x reads as older');
assert.strictEqual(verLess('', '2.9.41'), false, 'missing version must never claim outdated');
assert.strictEqual(verLess('abc', '2.9.41'), false, 'garbage version must never claim outdated');

/* the day-strip verdict surfaces the hint instead of a bare dead end */
assert(connect.includes('if (r && r.extUpdateHint) msg += '), 'pullOutcome must append the update hint to the verdict');

console.log('PASS ext-update hint: receipt-gate failures on an outdated MLS Assist name the installed vs published version and say to update THIS computer; sign-in and wrong-day failures never blame the extension; version compare is numeric and fail-safe');
