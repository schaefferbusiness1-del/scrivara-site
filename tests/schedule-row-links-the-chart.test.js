/* schedule-row-links-the-chart
 *
 * OWNER, 2026-07-29: "some of these dont work cause they say I have no patient
 * selected but I do have a patient selected" (Copilot chips refusing while a
 * patient was plainly on screen), and "the top car does not follow the visit".
 *
 * ONE ROOT CAUSE. calStartVisit() asks _calResolveLocalPatient() for the local
 * chart id. That resolver compared the FULL NAME by exact normalized string
 * equality, which cannot reconcile the shapes athenaOne delivers - "Last,
 * First", a middle name or initial, a Jr/Sr suffix - against a chart stored as
 * "First Last". On a miss, calStartVisit falls through to an UNASSIGNED visit:
 * it types the name into #patientLabel but never calls selectPatient, so
 * activePatient() stays null. The banner then shows a patient while every
 * chart-grounded guard honestly reports none.
 *
 * The fix keeps the exact match first, then falls back to a canonical
 * first|last key - but ONLY when the date of birth agrees AND exactly one chart
 * matches. The identity bar is unchanged (DOB + uniqueness); only the NAME
 * SHAPE tolerance changed, so it can never silently link the wrong chart.
 *
 * This suite executes the REAL extracted helper and pins both halves: the
 * shapes that must now link, and the shapes that must still refuse.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');

/* ---- 1. the fallback exists and keeps the identity bar high ---- */
assert(html.includes('function _calNameKeyFL(s){'),
  'the canonical first|last name-shape helper is gone');
assert(html.includes('if(hits.length===1&&hits[0]&&hits[0].id!=null) return hits[0].id;'),
  'the exact-match path must still be tried FIRST');
const resolver = html.slice(
  html.indexOf('function _calResolveLocalPatient(a){'),
  html.indexOf('function calStartVisit(id){'));
assert(resolver.indexOf('if(db){') > 0,
  'the canonical fallback must be gated on a known date of birth');
assert(/_calDobKey\(p\.dob\)!==db/.test(resolver),
  'the fallback must require the date of birth to AGREE');
assert(/if\(fb\.length===1\) return fb\[0\]\.id;/.test(resolver),
  'the fallback must refuse unless EXACTLY ONE chart matches - never guess between charts');

/* ---- 2. run the real helper ---- */
const m = html.match(/function _calNameKeyFL\(s\)\{[\s\S]*?\n\}/);
assert(m, 'could not extract _calNameKeyFL');
const keyFL = new Function('return ' + m[0].replace('function _calNameKeyFL', 'function'))();

const SAME = [
  'Hans Toegel',        // the chart as MLS stores it
  'Toegel, Hans',       // athenaOne's schedule shape
  'Hans F Toegel',      // middle initial
  'TOEGEL, HANS F.',    // upper case + punctuation
  'Hans Toegel Jr',     // suffix
  '  hans   toegel  '   // sloppy whitespace
];
const firstKey = keyFL(SAME[0]);
assert(firstKey === 'hans|toegel', 'canonical key shape changed: ' + firstKey);
SAME.forEach(function (n) {
  assert.strictEqual(keyFL(n), firstKey, 'these must all resolve to one chart: ' + JSON.stringify(n));
});

/* different people must NOT collide */
assert.notStrictEqual(keyFL('Hans Toegel'), keyFL('Hans Bledsoe'), 'different surnames must not collide');
assert.notStrictEqual(keyFL('Hans Toegel'), keyFL('Greta Toegel'), 'different first names must not collide');

/* unusable shapes yield no key, so the fallback cannot fire on them */
['', '   ', 'Madonna', 'MD'].forEach(function (n) {
  assert.strictEqual(keyFL(n), '', 'a single-token or empty name must yield NO key: ' + JSON.stringify(n));
});

/* ---- 3. anti-vacuity: the OLD exact-equality rule would have failed these ---- */
const normOld = function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
const missedByOld = SAME.filter(function (n) { return normOld(n) !== normOld(SAME[0]); });
assert(missedByOld.length >= 4,
  'this suite is vacuous unless the old exact-string rule genuinely missed these shapes (missed ' +
  missedByOld.length + ')');

console.log('PASS schedule row links the chart: exact match still runs first, then a canonical first|last fallback gated on an AGREEING date of birth and a UNIQUE match; ' +
  SAME.length + ' real athenaOne name shapes now resolve to one chart (' + missedByOld.length +
  ' of which the old exact-string rule missed, which is why the banner showed a patient while every chart-grounded guard reported none), and single-token/empty names still yield no key');
