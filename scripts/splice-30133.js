'use strict';
/* MLS Assist 3.0.133 - restorehome-1.0.0 (Fable, 2026-09-14). Measured on the 3.0.132 run with
 * the per-frame evidence: every schedule-date restore (stage "find-to-schedule restoration")
 * got eight goto-date answers of found:false / done:false with no error - no week strip on any
 * frame, because after a Find Patient leg the work frame IS the Find page, not the dashboard.
 * The restore now goes Home first (athena's own logo, read-only navigation, the proven
 * mlsGoHomeDriverFn under the same request guard), settles, and only then navigates the date.
 * Byte-preserving latin1 seam with an inverse proof. Run once: node scripts/splice-30133.js
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const a = "          scheduleRegrounds++;";
const idx = before.indexOf(a);
assert(idx >= 0 && before.split(a).length === 2, 'unique seam');
const nl = before.indexOf('\n', idx); const N = (before[nl - 1] === '\r') ? '\r\n' : '\n';
const b = a + N +
  "          /* restorehome-1.0.0 (3.0.133): after a Find Patient leg the work frame is the Find page and" + N +
  "             no frame carries the week strip (measured: eight goto-date answers found:false). Go Home" + N +
  "             first - athena's own logo, read-only - settle, then navigate the requested date. */" + N +
  "          try {" + N +
  "            var homeX = await execOpen({ target: { tabId: tab.id, allFrames: true }, args: [openGuard], func: mlsGoHomeDriverFn }, 9000);" + N +
  "            if (homeX && homeX.timeout) { failOpenDeadline(stage || 'exact schedule restoration'); return false; }" + N +
  "            if (!(await waitOpen(2500))) { failOpenDeadline(stage || 'exact schedule restoration'); return false; }" + N +
  "          } catch (eRestoreHome) {}";
assert(before.split(b).length === 1, 'replacement absent');
const out = before.replace(a, () => b);
assert.strictEqual(out.replace(b, () => a), before, 'inverse restores');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30133: 1 verified seam');
