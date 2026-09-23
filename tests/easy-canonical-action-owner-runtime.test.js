'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const canonicalMarker = source.indexOf('the effortless Visit tab  (__mlsEasyV32)');
const canonicalStart = source.indexOf('(function () {', canonicalMarker);
const canonicalEnd = source.indexOf('\n})();', canonicalStart);
assert(canonicalMarker >= 0 && canonicalStart >= 0 && canonicalEnd > canonicalStart, 'canonical Easy owner could not be bounded');
const canonical = source.slice(canonicalStart, canonicalEnd);
assert(canonical.includes("var VER = '3.7.3'"), 'unexpected canonical Easy version');
assert(canonical.includes('installScheduledVisitBinding(a) && exactScheduledBindingMatches(a)'), 'canonical owner lacks exact scheduled binding read-back');
/* Owner 2026-07-26: the bare warn-and-return on binding failure silently ate
 * Record clicks (the missing-appointment-ID report). The canonical owner now
 * routes record/generate through the requireExactScheduledBinding demotion
 * gate - proceed unscheduled + visible warning, block only a proven
 * cross-patient conflict - and keeps warn-and-stop for a plain open. */
/* gatearg-1.0.0 (2026-08-28): this pinned the call with exactly two arguments
   and broke when the gate gained a third:
     was  requireExactScheduledBinding(a, opts.record ? 'recording' : 'note generation')
     now  requireExactScheduledBinding(a, opts.record ? 'recording' : 'note generation', opts)
   The third argument carries `quiet`, which is how a caller suppresses a
   duplicate toast for a warning it is already showing. The routing property
   this assertion names never changed; the gate got one more capability and the
   literal punished it. Pinned as the property, with the new argument asserted
   on its own so it cannot be silently dropped either. */
assert(/requireExactScheduledBinding\(a, opts\.record \? 'recording' : 'note generation'(?:, *opts)?\)/.test(canonical),
  'canonical owner must route record/generate through the demotion gate on binding failure');
{
  /* Only the lockAndStart family is held to this. Those calls take the picked
     row `a` and have the caller's opts in scope, so dropping it would silently
     lose `quiet`. The event-handler calls elsewhere in this block take S.appt
     and have no opts at all - a doctor who clicked Record SHOULD see why it
     refused, so their toast is correct, not a duplicate. */
  const gateCalls = [...canonical.matchAll(/requireExactScheduledBinding\(a,([^)]*)\)/g)];
  assert(gateCalls.length >= 1, 'the canonical owner no longer routes a picked row through the demotion gate at all');
  for (const call of gateCalls) {
    assert(/,\s*opts\s*$/.test(call[1]),
      'a demotion-gate call on the picked row does not forward opts (' + call[0].trim() + '), so it cannot honour quiet');
  }
}
/* gatearg-1.0.0: was pinned as `{ render(); return; }`. The engine returns a
   truthful BOOLEAN now - its own note says the phone must not leave Day on a
   promise that may fail later, so every exit from this owner reports whether
   the visit actually opened. A bare `return` gives undefined, which a caller
   reads as failure and would strand the doctor on the day list after a
   successful plain open. Pinned as the property: warn-and-stop still happens
   for a plain open, and it still answers. */
{
  const plainOpen = /if \(!opts\.record && !opts\.generate\) \{ render\(\); return([^;]*);/.exec(canonical);
  assert(plainOpen, 'canonical owner must keep warn-and-stop for a plain open on binding failure');
  assert(/^\s*(?:true|false)$/.test(plainOpen[1]),
    'the plain-open exit returns ' + JSON.stringify(plainOpen[1].trim() || '(nothing)') +
    ' rather than a boolean - a caller cannot tell an opened visit from a refused one, and the phone would stay on Day after a successful open');
}
assert(canonical.includes("window.addEventListener('mls:session-boundary', resetEasySession)"), 'canonical owner lacks synchronous account reset');
assert(canonical.includes('window.__mlsEasyV32 = api;'), 'canonical API is not claimed by its synchronous IIFE');

/* b1303: the historical owners (Easy 3.4.1, 3.2.1, 3.1.1, 3.0 and the in-place
   Easy 1.1.0) used to ship, each failing closed on a first-line return, and
   this suite proved that return ran before any runtime access. They are now
   deleted, which is the stronger form of the same guarantee: no historical
   record/generate lineage exists to activate under any load timing. */
const retired = [
  { version: "var VER = '3.4.1'", label: 'Easy 3.4.1' },
  { version: "var VER = '3.2.1'", label: 'Easy 3.2.1' },
  { version: "var VER = '3.1.1'", label: 'Easy 3.1.1' },
  { version: "var VER = '3.0.0'", label: 'Easy 3.0' },
  { version: "var VERSION = '1.1.0'", label: 'in-place Easy' }
];
for (const item of retired) {
  const at = source.indexOf(item.version, canonicalEnd);
  const ctx = at < 0 ? '' : source.slice(Math.max(0, at - 4000), at);
  assert(at < 0 || !/Retired (historical|in-place) Easy/.test(ctx), `${item.label}: a retired Easy owner is back in the bundle`);
}

const lockStarts = [];
let cursor = -1;
while ((cursor = source.indexOf('function lockAndStart(a, opts)', cursor + 1)) >= 0) lockStarts.push(cursor);
assert.strictEqual(lockStarts.length, 1, 'exactly one record/generate lineage (the canonical owner) ships; found ' + lockStarts.length);
assert(lockStarts[0] > canonicalStart && lockStarts[0] < canonicalEnd, 'the only action owner is not canonical Easy');

console.log('PASS canonical Easy action ownership: the 3.7.3 owner is the only record/generate lineage in the bundle and it is exact-gated');
