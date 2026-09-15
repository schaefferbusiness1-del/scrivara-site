'use strict';
/* MLS Assist 3.0.159 - axidwait-1.0.1 (Fable, 2026-09-15). The 1.0.0 identity class used mlsExactDobKey inside the
 * ax loop; the census harness evaluates that loop without the worker globals (ReferenceError), and presence of a
 * printed DOB is all the class needs. Latin1 seam, inverse proof. Run once (after splice-30159.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const count = (s, n) => s.split(n).length - 1;
const a = "              if (axIdent && (axIdent.name || axIdent.dob)) { axRefused++; if (mlsExactDobKey(axIdent.dob)) axRefIdentity++; else axRefIdentityWeak++; } /* axidwait-1.0.0: a partial identity (no DOB) at the deadline is its own class, still refused */";
const b = "              if (axIdent && (axIdent.name || axIdent.dob)) { axRefused++; if (axIdent.dob) axRefIdentity++; else axRefIdentityWeak++; } /* axidwait-1.0.1 (3.0.159): a partial identity (no printed DOB) at the deadline is its own class, still refused */";
assert(count(before, a) === 1 && count(before, b) === 0, 'seam');
const out = before.replace(a, () => b);
assert.strictEqual(out.replace(b, () => a), before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30159b: 1 verified seam');
