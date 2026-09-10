'use strict';
/* draftonly-1.0.0: restore the current owner contract at both independent
 * extension dispatch boundaries. Preserve every untouched background byte
 * and each changed line's original terminator. Constants remain ASCII. */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let source = fs.readFileSync(file, 'latin1');
const original = source;
function spliceAll(from, to, expected) {
  if (/[^\x00-\x7f]/.test(to)) throw new Error('Non-ASCII replacement');
  const positions = [];
  for (let i = source.indexOf(from); i >= 0; i = source.indexOf(from, i + from.length)) positions.push(i);
  if (positions.length !== expected) throw new Error('Anchor count: expected ' + expected + ', got ' + positions.length);
  for (const i of positions.reverse()) source = source.slice(0, i) + to + source.slice(i + from.length);
}
spliceAll('ACTIONS = { write_note: 1, stage_billing: 1, save_draft: 1, sign_encounter: 1, place_order: 1 }',
  'ACTIONS = { write_note: 1, save_draft: 1 } /* draftonly-1.0.0: signing, orders and billing stay manual */', 3);
spliceAll('!ACTIONS[action]', '!Object.prototype.hasOwnProperty.call(ACTIONS, action)', 3);
spliceAll("wsForbiddenControl(el) && !(action === 'sign_encounter' && exactSign(el))", 'wsForbiddenControl(el)', 1);
if (source === original) throw new Error('No change');
fs.writeFileSync(file, source, 'latin1');
console.log(JSON.stringify({proof:'draftonly-1.0.0',dispatchMaps:3,closedMembership:3,finalControlExceptionsRemoved:1}));
