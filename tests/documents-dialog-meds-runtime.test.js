'use strict';

/* 2026-07-22 Documents fixes:
 * 1. "Paste text" is an in-app dialog (native prompt() failed silently when
 *    suppressed and blocked the tab for automation/screen readers), bound to
 *    the patient id captured at open time.
 * 2. Document analysis must keep stated dates and explicit negatives.
 * 3. Medication merge dedupes by drug+dose instead of exact string, without
 *    losing genuinely distinct dose/instruction lines.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- 1. in-app paste dialog ---- */
const pasteStart = app.indexOf('function addDocPaste()');
const pasteEnd = app.indexOf('function readFileAsDataUrl(', pasteStart);
assert(pasteStart >= 0 && pasteEnd > pasteStart, 'addDocPaste region missing');
const paste = app.slice(pasteStart, pasteEnd);
assert(!/=\s*prompt\(/.test(paste), 'Documents paste is back on native prompt()');
assert(paste.includes("openDocPasteModal()"), 'paste button does not open the in-app dialog');
assert(paste.includes("role=\"dialog\" aria-modal=\"true\""), 'paste dialog is not an accessible modal');
assert(paste.includes('var boundPtId=getActivePtId();'), 'paste dialog does not freeze the patient id at open time');
assert(paste.includes("String(getActivePtId()||'')!==String(boundPtId||'')"), 'paste dialog does not re-validate the patient id at save time');
assert(paste.includes("errEl.textContent='Paste the document text first.'"), 'empty-text refusal is not visible');
assert(paste.includes("if(e.key==='Escape')"), 'paste dialog does not close on Escape');

/* ---- 2. analysis keeps dates and explicit negatives ---- */
assert(app.includes('DATES MATTER'), 'analysis prompt no longer preserves stated dates');
assert(app.includes('EXPLICIT NEGATIVES MATTER'), 'analysis prompt no longer preserves explicit negatives');
assert(app.includes('"negatives"'), 'analysis JSON contract lost the negatives array');
assert(app.includes("sec('Explicit negatives',parsed.negatives);"), 'explicit negatives are not rendered');
assert(app.includes('negatives:parsed.negatives||[]'), 'negatives are not stored on aiItems');

/* ---- 3. medication-aware merge (runtime) ---- */
const medStart = app.indexOf('function _medNameKey(');
const medEnd = app.indexOf('function mergeDocIntoProfile()', medStart);
assert(medStart >= 0 && medEnd > medStart, 'medication merge helpers missing');
const context = {};
vm.createContext(context);
vm.runInContext(app.slice(medStart, medEnd) + '\nthis.mergeMedListInto = mergeMedListInto;', context);
const merge = context.mergeMedListInto;

assert.strictEqual(merge('ibuprofen', ['Ibuprofen 600 mg']), 'Ibuprofen 600 mg',
  'bare drug name was not upgraded to the dosed line (duplicate ibuprofen)');
assert.strictEqual(merge('Ibuprofen 600 mg', ['ibuprofen']), 'Ibuprofen 600 mg',
  'bare drug name re-added beside the dosed line');
assert.strictEqual(merge('Ibuprofen 600 mg', ['ibuprofen 600mg']), 'Ibuprofen 600 mg',
  'formatting-only dose variant created a duplicate');
assert.strictEqual(merge('Gabapentin 300 mg', ['Gabapentin 600 mg']), 'Gabapentin 300 mg\nGabapentin 600 mg',
  'a genuinely different dose was dropped');
assert.strictEqual(merge('Gabapentin 300 mg', ['Gabapentin 300 mg TID with food']), 'Gabapentin 300 mg TID with food',
  'richer instructions did not replace the terser same-dose line');
assert.strictEqual(merge('', ['Lisinopril 10 mg', 'lisinopril 10 mg']), 'Lisinopril 10 mg',
  'same-dose duplicates in one batch were both added');
assert.strictEqual(merge('Aspirin 81 mg', ['Tylenol 500 mg']), 'Aspirin 81 mg\nTylenol 500 mg',
  'distinct drugs were merged');

assert(app.includes('p.meds=mergeMedListInto(p.meds,it.medications);'), 'document merge does not use the med-aware dedupe');
assert(app.includes('p.meds=mergeMedListInto(p.meds,medItems);'), 'visit attach does not use the med-aware dedupe');

console.log('PASS documents: accessible paste dialog with frozen patient id, date/negative-preserving analysis, med-aware dedupe');
