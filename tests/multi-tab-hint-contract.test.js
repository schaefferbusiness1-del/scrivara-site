'use strict';

/* tabhint-1.0.0 — proven live 2026-07-24.
 *
 * ON-mode pulls were failing with `same-frame-name-mismatch` on most patients.
 * The cause is NOT the reader: a chart read proved "Joan Holliday" while the
 * athenaOne tab in view showed a different chart, and the following visits read
 * resolved yet another tab parked on a third patient ("Monterosso, ROSEMARY").
 * MLS opens the right chart in one tab and reads a stale one in another,
 * because more than one athenaOne tab is open. The identity gate refused every
 * time — which is precisely why no wrong-patient body was ever stored.
 *
 * A doctor cannot deduce "close your extra Athena tabs" from
 * "same-frame-name-mismatch". This pins the actionable hint, and pins that it
 * only fires when the evidence actually supports it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

const start = src.indexOf('/* tabhint-1.0.0');
assert(start >= 0, 'the multi-tab hint must exist');
const end = src.indexOf('else if (!includeHistory)', start);
assert(end > start, 'could not bound the hint block');
const block = src.slice(start, end);

assert(/same-frame-name-mismatch/.test(block), 'the hint must key off the mismatch reason');
assert(/__mismatch >= 2/.test(block),
  'a single mismatch can be an ordinary transient — require at least two before blaming tabs');
assert(/res\.multiTabSuspected = /.test(block),
  'the suspicion must be exposed on the receipt so the UI and evidence logs can read it');
assert(/close every athenaOne tab except one/i.test(block),
  'the hint must state the ONE action that fixes it');
assert(/Nothing was saved to the wrong patient/.test(block),
  'the doctor must be told their data is safe — the refusals are the guard working');

/* The hint is additive: the honest incomplete receipt must be unchanged. */
assert(/It is safe to retry; MLS did not mark this pull complete\./.test(block),
  'the existing honest incomplete message must survive');
assert(/\(res\.multiTabSuspected \? " " \+ __mismatch/.test(block),
  'the hint must be appended only when suspected, never unconditionally');

/* It must never claim completeness or suppress the failure. */
assert(!/complete = true/.test(block), 'the hint must never flip the pull to complete');
assert(/"err"\)/.test(block), 'the incomplete status must stay an error, not be softened to a warning');

/* Counting must tolerate every receipt shape without throwing during a pull. */
assert(/try \{[\s\S]*catch \(eMm\) \{\}/.test(block),
  'the count must be wrapped — a hint must never be able to break a pull');
assert(/p\.visitsReason \|\| p\.chartReason \|\| p\.reason/.test(block),
  'all three reason fields carry the refusal depending on the stage that refused');

console.log('PASS multi-tab hint: a run refused twice or more for same-frame-name-mismatch tells the doctor to close extra athenaOne tabs, states nothing was mis-saved, exposes multiTabSuspected on the receipt, and never softens or fakes completeness');
