'use strict';
/* stx-1.0.0 pins: THE FREE-LINE TEXT LANE CANNOT MINT AN APPOINTMENT FROM A
 * MID-LINE TIME TOKEN.
 *
 * OLD BYTES FAIL BY NAME: any line containing a time minted a row, so one
 * booking's comment prose ("… RS'D APPT TO 1:30pm …") fabricated a text-only
 * appointment that no DOM row could verify, and pp-1.1 then refused the whole
 * 26-row day at every scroll position (live 2026-08-25).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bg = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'background.js'), 'latin1');

/* the position gate exists, keyed on the shared RE_TIME token */
assert.ok(bg.includes('if (ln.search(RE_TIME) > 2) { out.diag.timeMidlineRowsSkipped++; }'),
  'the mid-line time gate is gone - comment prose can mint phantom appointments again');

/* the gated mint is still the same mint (nothing else weakened).
   This pinned the mint's ENTIRE argument literal, so it also silently pinned the
   row's field list closed - and the free-line lane later learned athena's
   appointment status (mlsApptStatusFromRaw, the same additive change that
   reached mlsProv.fromText). The pin named a SPELLING; the property it is
   defending is that a time-LEADING free line still mints a row carrying its
   time, its name and its section provider. Re-aimed at that: the call and its
   three original fields are pinned individually, so a mint that drops the time,
   forgets the provider or disappears entirely still reds, while an added field
   does not. The MINT_CALL prefix keeps the gate-adjacency check below exact. */
const MINT_CALL = 'if (nm) out.appts.push({ time: firstTime(ln), name: nm, ';
assert.ok(bg.includes(MINT_CALL),
  'the free-line mint itself vanished - real time-leading text rows would be lost');
assert.ok(bg.includes(MINT_CALL + "provider: current || ''"),
  'the free-line mint stopped carrying its section provider - rows would arrive unattributed');
assert.strictEqual(bg.split(MINT_CALL).length - 1, 1,
  'the free-line mint is no longer the single writer on this path - a second, ungated mint is exactly ' +
  'the phantom-appointment class this suite exists to prevent');

/* skips are visible in the receipt, never silent */
assert.ok(bg.includes('timeMidlineRowsSkipped: 0,'),
  'the skip counter fell out of the text diag - drops became silent');

/* the gate lives INSIDE the hasTime branch, before patientNameFromRow */
const gateAt = bg.indexOf('if (ln.search(RE_TIME) > 2)');
const mintAt = bg.indexOf(MINT_CALL);
assert.ok(gateAt > 0 && mintAt > gateAt && (mintAt - gateAt) < 400,
  'the gate no longer guards the free-line mint');

/* pp-1.1 stays intact: text-only rows still fail a legacy-exact day */
assert.ok(bg.includes('__legacyTextOnlyRows === 0'),
  'the pp-1.1 text-only completeness gate was weakened - phantom protection lost');

console.log('PASS text-lane mint pins: mid-line time tokens cannot mint rows, skips are counted, and pp-1.1 still guards whatever mints');
