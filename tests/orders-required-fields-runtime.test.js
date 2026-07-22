'use strict';

/* 2026-07-22 Orders validation: an untouched Imaging form used to create an
 * incomplete X-ray order (the study select defaulted to its first real value
 * and only the primary field was checked), and Print/Copy/Save/EMR-review
 * stayed enabled. Contract: every req:1 field must be filled; invalid drafts
 * are labeled, excluded from placement controls, and block every downstream
 * action with an itemized message.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

const defsStart = app.indexOf('const ORDER_DEFS = {');
const defsEnd = app.indexOf('/* Suggestion rules:', defsStart);
const validStart = app.indexOf('function orderMissingFields(type,fields)');
const validEnd = app.indexOf('function addOrderFromForm()', validStart);
assert(defsStart >= 0 && defsEnd > defsStart && validStart >= 0 && validEnd > validStart, 'orders regions missing');

const context = { currentOrders: [] };
vm.createContext(context);
vm.runInContext(
  app.slice(defsStart, defsEnd) + '\n' + app.slice(validStart, validEnd) +
  '\nthis.orderMissingFields=orderMissingFields;this.orderFormHasContent=orderFormHasContent;this.invalidOrderInfos=invalidOrderInfos;this.ORDER_DEFS=ORDER_DEFS;',
  context);

/* vm realms have their own Array prototype — compare by JSON, not identity */
const json = v => JSON.stringify(v);

/* untouched imaging form: study select starts blank now */
assert.strictEqual(context.ORDER_DEFS.imaging.fields[0].opts[0], '', 'imaging study select lost its blank first option');
assert.strictEqual(json(context.orderMissingFields('imaging', { study: '', region: '', indication: '' })),
  json(['Study', 'Body region', 'Indication']), 'empty imaging form did not report every required field');
assert.strictEqual(context.orderFormHasContent('imaging', { study: 'X-ray', region: '', indication: '' }), false,
  'study alone still passes validation');
assert.strictEqual(context.orderFormHasContent('imaging', { study: 'X-ray', region: 'Lumbar spine', indication: 'r/o fracture' }), true,
  'complete imaging order was rejected');
assert.strictEqual(json(context.orderMissingFields('medication', { drug: 'Gabapentin', dose: '' })), json(['Dose']),
  'medication dose requirement missing');
assert.strictEqual(json(context.orderMissingFields('referral', { specialty: '', reason: '' })), json(['Specialty / provider', 'Reason']),
  'referral requirements missing');

context.currentOrders = [
  { id: 'a', type: 'imaging', fields: { study: 'X-ray', region: '', indication: '' } },
  { id: 'b', type: 'pt', fields: { dx: 'LBP', freq: '3x/week' } }
];
const bad = context.invalidOrderInfos();
assert.strictEqual(bad.length, 1, 'invalid-draft detection wrong');
assert.strictEqual(bad[0].order.id, 'a');
assert.strictEqual(json(bad[0].missing), json(['Body region', 'Indication']));

/* downstream boundaries revalidate */
for (const site of ["_ordersBlockedMsg('printing')", "_ordersBlockedMsg('copying')", "_ordersBlockedMsg('saving with the visit')", "_ordersBlockedMsg('reviewing the EMR route')"]) {
  assert(app.includes(site), `downstream boundary missing revalidation: ${site}`);
}
/* invalid drafts are visible and excluded from placement controls */
assert(app.includes('Incomplete draft — missing:'), 'invalid drafts are not labeled in the list');
assert(app.includes("missing.length?'':_athenaOrderPlacementControl(o)"), 'invalid drafts still render a placement control');
assert(app.includes("addRow.style.display='flex'"), 'builder add row lost its display handling');
assert(app.includes("const blocked=_ordersBlockedMsg('using order actions');"), 'action row is not disabled while invalid drafts exist');
/* form-level itemized refusal */
assert(app.includes("order still needs: '+missing.join(', ')"), 'add-order refusal is not itemized');

console.log('PASS orders validation: required fields per type, blank required select, itemized refusals, invalid drafts quarantined from every downstream action');
