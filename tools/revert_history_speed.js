/* v2.9.34: REVERT the v2.9.32 poll-cadence changes. Two big-day bodies-ON
 * pulls failed 16/18 with find-patient no-results cascades after the change;
 * the pre-change morning runs were green. Restore the proven cadences byte
 * for byte; keep the order-group indexing and multi-tab work. */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'background.js');
const src = fs.readFileSync(FILE, 'latin1');
const crCount = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === '\r') n++; return n; };
const CR_BEFORE = crCount(src);
let out = src;
function replaceOnce(hay, oldStr, newStr, label) {
  const i = hay.indexOf(oldStr);
  if (i < 0) throw new Error('anchor missing: ' + label);
  if (hay.indexOf(oldStr, i + 1) >= 0) throw new Error('anchor not unique: ' + label);
  if (/[^\x00-\x7F]/.test(newStr) || /\r/.test(newStr)) throw new Error('bad replacement: ' + label);
  return hay.slice(0, i) + newStr + hay.slice(i + oldStr.length);
}
const pairs = [
  ["if (!ident) await sleep(400); /* v2.9.32 speed: cadence only - 15s deadline + identity gate unchanged */",
   "if (!ident) await sleep(800);"],
  ["if (!clicked) await sleep(350); /* v2.9.32 speed: cadence only */",
   "if (!clicked) await sleep(700);"],
  ["await sleep(600); /* v2.9.32: shorter pre-settle - the v2.03 settle-poll below owns hydration correctness */",
   "await sleep(1200); /* let the entry list hydrate */"],
  ["await sleep(800); /* v2.9.32: the settle-poll below still verifies the re-rendered list */",
   "await sleep(1500);"],
  ["await sleep(400); /* v2.9.32 speed: cadence only; the 800ms stability confirmation above is unchanged */",
   "await sleep(700);"],
  ["if (!(await chartWait(1800))) { chartFailDeadline('clinical chart load'); return; } /* v2.9.32: shorter first settle - the loop keeps re-probing under the same budget */",
   "if (!(await chartWait(3200))) { chartFailDeadline('clinical chart load'); return; }"],
  ["if (!(await chartWait(bootstrapReadyEarly ? 600 : (polls < 3 ? 1200 : 2400)))) { chartFailDeadline('clinical chart readiness'); return; } /* v2.9.32: faster early polls, same acceptance + budgets */",
   "if (!(await chartWait(bootstrapReadyEarly ? 900 : 2400))) { chartFailDeadline('clinical chart readiness'); return; }"]
];
/* the two 300ms pane polls share text; do them positionally via context */
function replaceAfter(anchor, target, repl, windowChars, label) {
  const a = out.indexOf(anchor);
  if (a < 0) throw new Error('anchor missing: ' + label);
  const t = out.indexOf(target, a);
  if (t < 0 || t - a > windowChars) throw new Error('target not near anchor: ' + label);
  out = out.slice(0, t) + repl + out.slice(t + target.length);
}
for (const [o, n] of pairs) out = replaceOnce(out, o, n, n.slice(0, 30));
replaceAfter('var paneDeadline = Date.now() + 16000',
  'await sleep(300); /* v2.9.32 speed: cadence only */', 'await sleep(500);', 300, 'pane poll revert');
replaceAfter('var paneDeadline2 = Date.now() + 10000;',
  'await sleep(300); /* v2.9.32 speed: cadence only */', 'await sleep(500);', 300, 'pane recovery revert');
if (out.indexOf('v2.9.32 speed') >= 0) throw new Error('stale v2.9.32 speed marker remains');
const CR_AFTER = crCount(out);
if (CR_AFTER !== CR_BEFORE) throw new Error('CR census changed');
fs.writeFileSync(FILE, out, 'latin1');
console.log('OK reverted speed cadences: CRs', CR_AFTER, 'size', out.length);
