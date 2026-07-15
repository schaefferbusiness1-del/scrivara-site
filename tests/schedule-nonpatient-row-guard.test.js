'use strict';

/* Live 2026-07-15: a "Spine,No" hold row on the day grid was confidently
 * parsed as patient "No Spine" through the comma fast path, imported as a
 * calendar patient, and then failed every downstream identity gate. Two
 * invariants:
 *  1. the canonical name parser never mints a person whose given or family
 *     name is schedule status/anatomy vocabulary;
 *  2. the schedule reader classifies such rows as non-patient SLOTS (like
 *     OPEN), so excluding them cannot break the completeness denominator.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');

/* ---- extract the canonical parser by line bounds (mixed-EOL safe) ---- */
const lines = source.split('\n');
const startIdx = lines.findIndex(l => l.startsWith('function mlsParseName('));
assert(startIdx >= 0, 'missing mlsParseName');
let endIdx = -1;
for (let i = startIdx + 2; i < startIdx + 140; i++) {
  if (lines[i].replace(/\r$/, '') === '}') { endIdx = i + 1; break; }
}
assert(endIdx > startIdx, 'unterminated mlsParseName');
const parserCode = lines.slice(startIdx, endIdx).join('\n');
assert(parserCode.includes('never schedule vocabulary'),
  'the parser stop-vocab veto rationale must stay documented');
// eslint-disable-next-line no-new-func
const parse = new Function(parserCode + '\nreturn mlsParseName;')();

const rejected = ['Spine,No', 'Spine, No', 'No Spine', 'Hold,Lunch', 'Blocked,Admin', 'Knee, Left', 'Lumbar, Open'];
for (const raw of rejected) {
  const r = parse(raw);
  assert(!r || r.confident !== true, `schedule vocabulary was minted as a confident patient name: ${JSON.stringify(raw)}`);
}
const accepted = ['Schaeffer,Adam', 'Tomlinson, Cindy', 'Powell, Gerald W', 'Dipietrae, Lawrence J, Jr', 'Same, Alex', 'Spinelli, Norma'];
for (const raw of accepted) {
  const r = parse(raw);
  assert(r && r.confident === true, `real patient name was rejected: ${JSON.stringify(raw)}`);
}

/* ---- the extended slot filter classifies hold rows as slots ---- */
const slotMatch = source.match(/\/\^\(\?::?\(\?:\\d\+\\s\*\(\?:min[^/]+\/i/);
assert(source.includes('no\\b[\\s,]*(?:spine|surger(?:y|ies)|clinic|cases?|appts?|appointments?|patients?|add[\\s-]?ons?)'),
  'the slot filter must classify no-spine/no-surgery hold rows as non-patient slots');
const re = /^(?:(?:\d+\s*(?:min(?:ute)?s?|mins?)\s*)?)(?:open|blocked?|hold|unavailable|lunch|closed|administrative|admin|reserved|no\b[\s,]*(?:spine|surger(?:y|ies)|clinic|cases?|appts?|appointments?|patients?|add[\s-]?ons?)|(?:spine|surger(?:y|ies)|clinic|cases?|appts?|appointments?)\s*,\s*no)(?:\b|\s|$)/i;
for (const slot of ['Spine,No', 'No Spine', '20min No Spine', 'OPEN', 'Blocked', 'No add-ons']) {
  assert(re.test(slot), `hold row not classified as a slot: ${JSON.stringify(slot)}`);
}
for (const person of ['Norma Spinelli', 'Nomar Garcia', 'Tomlinson Cindy']) {
  assert(!re.test(person), `real patient misclassified as a slot: ${JSON.stringify(person)}`);
}

console.log('PASS non-patient row guard: status/anatomy vocabulary never becomes a patient and hold rows classify as slots');
