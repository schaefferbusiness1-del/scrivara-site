/* v2.9.32 history-pull speed (EOL-agnostic version): tighten poll cadence in
 * the visits-pane driver and the chart identity loop. Deadlines, budgets,
 * identity gates, and the two-consecutive-equal-row-counts stability guard
 * are UNCHANGED. Single-line in-place replacements only - no EOLs touched. */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'background.js');
const src = fs.readFileSync(FILE, 'latin1');
const crCount = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === '\r') n++; return n; };
const CR_BEFORE = crCount(src);
let out = src;

/* Replace `target` -> `repl` at its first occurrence AFTER `anchor`, and
 * require that occurrence to sit within `windowChars` of the anchor. */
function replaceAfter(anchor, target, repl, windowChars, label) {
  const a = out.indexOf(anchor);
  if (a < 0) throw new Error('anchor missing: ' + label);
  if (out.indexOf(anchor, a + 1) >= 0) throw new Error('anchor not unique: ' + label);
  const t = out.indexOf(target, a);
  if (t < 0 || t - a > windowChars) throw new Error('target not near anchor: ' + label);
  if (/[^\x00-\x7F]/.test(repl) || /[\r\n]/.test(repl)) throw new Error('bad replacement: ' + label);
  out = out.slice(0, t) + repl + out.slice(t + target.length);
}

/* -- visits-pane driver -- */
replaceAfter('var identDeadline = Date.now() + 15000;',
  'if (!ident) await sleep(800);',
  'if (!ident) await sleep(400); /* v2.9.32 speed: cadence only - 15s deadline + identity gate unchanged */',
  4200, 'identity poll');
replaceAfter("var railDeadline = Date.now() + 12000;",
  'if (!clicked) await sleep(700);',
  'if (!clicked) await sleep(350); /* v2.9.32 speed: cadence only */',
  400, 'rail poll');
replaceAfter('var paneDeadline = Date.now() + 16000',
  'await sleep(500);',
  'await sleep(300); /* v2.9.32 speed: cadence only */',
  300, 'pane poll');
replaceAfter('var paneDeadline2 = Date.now() + 10000;',
  'await sleep(500);',
  'await sleep(300); /* v2.9.32 speed: cadence only */',
  300, 'pane recovery poll');
replaceAfter("reason: 'no-pane'",
  'await sleep(1200); /* let the entry list hydrate */',
  'await sleep(600); /* v2.9.32: shorter pre-settle - the v2.03 settle-poll below owns hydration correctness */',
  600, 'hydrate settle');
replaceAfter("dispatchEvent(new W.Event('change', { bubbles: true }))",
  'await sleep(1500);',
  'await sleep(800); /* v2.9.32: the settle-poll below still verifies the re-rendered list */',
  200, 'all-events settle');
replaceAfter('var parseDeadline = Date.now() + 14000;',
  'await sleep(700);',
  'await sleep(400); /* v2.9.32 speed: cadence only; the 800ms stability confirmation above is unchanged */',
  700, 'parse poll');

/* -- chart identity loop -- */
replaceAfter("if (self.__mlsQpEnsure) {",
  "if (!(await chartWait(3200))) { chartFailDeadline('clinical chart load'); return; }",
  "if (!(await chartWait(1800))) { chartFailDeadline('clinical chart load'); return; } /* v2.9.32: shorter first settle - the loop keeps re-probing under the same budget */",
  600, 'post-click wait');
replaceAfter("if (briefingNow && noClickRounds >= 5 && !navClicked) break;",
  "if (!(await chartWait(bootstrapReadyEarly ? 900 : 2400))) { chartFailDeadline('clinical chart readiness'); return; }",
  "if (!(await chartWait(bootstrapReadyEarly ? 600 : (polls < 3 ? 1200 : 2400)))) { chartFailDeadline('clinical chart readiness'); return; } /* v2.9.32: faster early polls, same acceptance + budgets */",
  300, 'identity poll interval');

const CR_AFTER = crCount(out);
if (CR_AFTER !== CR_BEFORE) throw new Error('CR census changed: ' + CR_BEFORE + ' -> ' + CR_AFTER);
fs.writeFileSync(FILE, out, 'latin1');
console.log('OK background.js speed edits: CRs', CR_AFTER, 'size', out.length);
