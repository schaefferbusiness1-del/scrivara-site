'use strict';

/* Diagnosis/billing suggestions must stay separate from the patient's EXISTING
 * chart diagnoses, be evidence-gated, surface uncertainty, and require
 * provider review (3.0.0 release goal). The enforced mechanics:
 *  - the generation prompt forbids inventing codes for unstated diagnoses and
 *    demands an explicit [[icd10_...]] placeholder + "missing" entry when the
 *    exact current code is uncertain (uncertainty is SHOWN, never guessed);
 *  - suggestions live in the draft note's own "suggested coding" vocabulary,
 *    while EXISTING diagnoses come only from the verified pulled chart:
 *    _savePatientChart merges p.problems exclusively from the pulled chart
 *    object (mergeOwned), never from note or coding fields;
 *  - every billing destination in the unified manifest is a review/manual
 *    surface (execution contracts pinned in athena-confirmed-billing-contract
 *    and the unified manifest suite).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const scribe = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

// 1. evidence gate + explicit uncertainty in the coding directive
assert(/do NOT invent a code for a diagnosis that was not stated/.test(connect),
  'the coding directive lost its evidence gate (codes only for stated diagnoses)');
assert(/\[\[icd10_<short_dx>\]\] placeholder and add it to \\?"missing\\?"/.test(connect) || connect.includes('[[icd10_<short_dx>]] placeholder'),
  'uncertain codes must surface as placeholders + missing entries, never guesses');

// 2. suggestions carry the "suggested" label in the note vocabulary
assert(connect.includes("'suggested coding'"), 'the note section vocabulary lost the suggested-coding label');

// 3. EXISTING diagnoses come only from the verified pulled chart
const saveStart = scribe.indexOf('function _savePatientChart(');
assert(saveStart > 0, '_savePatientChart missing');
const saveBody = scribe.slice(saveStart, scribe.indexOf('\nfunction ', saveStart + 10));
assert(/p\.problems\s*=\s*mergeOwned\(p\.problems,\s*priorAthenaSnapshot\.problems,\s*chart\.problems\)/.test(saveBody),
  'chart problems must merge exclusively from the pulled chart object');
assert(!/coding|icd10|suggest/i.test(saveBody.match(/p\.problems[^;]+;/)[0]),
  'suggested coding must never reach the existing-problems merge');

// 4. billing destinations remain review/manual surfaces in the destination map
const writeflow = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
assert(/billing\s*:\s*['"]Athena Billing \/ Charges \(manual entry\)['"]/.test(writeflow),
  'the destination map must keep billing as a manual-entry review surface');

console.log('PASS coding suggestion separation: evidence-gated suggestions with visible uncertainty, existing chart diagnoses isolated from suggestions, billing stays a review/manual surface');
