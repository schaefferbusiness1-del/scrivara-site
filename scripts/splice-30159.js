'use strict';
/* MLS Assist 3.0.159 - axidwait-1.0.0 (Fable, 2026-09-15). Run AI (axrefusals-1.0.0 receipt): the recurring
 * "visit-bodies-incomplete, expected 1, parsed 0, attempted 1" same-day read names its step at last:
 * refusedIdentity 1 - the ax encounter page's identity poll (5.2 s budget) ended on an identity that did not pass
 * the gate. On a HIDDEN tab the encounter page renders slowly: the shadow banner is not there yet and the body-text
 * fallback yields a partial identity (a name with no DOB, or a weak name), which the gate refuses and the loop then
 * counts as "seen and mismatched" - a hard refusal for what is a not-yet-painted page. Cure: (a) the identity and
 * body polls on the encounter page get 12 s (bounded by the read deadline as before); (b) a PARTIAL identity (no DOB)
 * at the deadline is counted as refusedIdentityWeak, distinct from a complete identity that contradicts the patient
 * (still refusedIdentity, still a hard refusal). Nothing is accepted that was not accepted before: the gate is
 * unchanged, only the waiting and the receipt. Latin1 seams, inverse proof. Run once (after splice-30158.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("            var axIdDeadline = Math.min(readDeadline, Date.now() + 5200);",
    "            var axIdDeadline = Math.min(readDeadline, Date.now() + 12000); /* axidwait-1.0.0 (3.0.159): a hidden tab paints the encounter page slowly */", 'identity deadline');
rep("              if (axIdent && (axIdent.name || axIdent.dob)) { axRefused++; axRefIdentity++; }",
    "              if (axIdent && (axIdent.name || axIdent.dob)) { axRefused++; if (mlsExactDobKey(axIdent.dob)) axRefIdentity++; else axRefIdentityWeak++; } /* axidwait-1.0.0: a partial identity (no DOB) at the deadline is its own class, still refused */", 'identity class');
rep("var axVisits = [], axRefused = 0, axShapeUnknown = 0, axAttempted = 0, axRefNav = 0, axRefIdentity = 0, axRefBody = 0, axRefAfter = 0, /* axrefusals-1.0.0 (3.0.157) */",
    "var axVisits = [], axRefused = 0, axShapeUnknown = 0, axAttempted = 0, axRefNav = 0, axRefIdentity = 0, axRefIdentityWeak = 0, axRefBody = 0, axRefAfter = 0, /* axrefusals-1.0.0 (3.0.157), axidwait-1.0.0 (3.0.159) */", 'counter');
rep("            var axBodyDeadline = Math.min(readDeadline - 500, Date.now() + 5200);",
    "            var axBodyDeadline = Math.min(readDeadline - 500, Date.now() + 12000); /* axidwait-1.0.0 */", 'body deadline');
rep("refusedNav: axRefNav, refusedIdentity: axRefIdentity, refusedBody: axRefBody, refusedAfterIdentity: axRefAfter, shapeUnknown: axShapeUnknown, /* axrefusals-1.0.0 */",
    "refusedNav: axRefNav, refusedIdentity: axRefIdentity, refusedIdentityWeak: axRefIdentityWeak, refusedBody: axRefBody, refusedAfterIdentity: axRefAfter, shapeUnknown: axShapeUnknown, /* axrefusals-1.0.0, axidwait-1.0.0 */", 'receipt');
let restored = out;
for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30159: ' + edits.length + ' verified seams');
