/* v2.9.32 history-pull speed, take 3: all visits-driver edits are scoped to
 * the mlsReadVisitsPaneDriverFn body; chart-loop edits scoped to the
 * mlsAppChartRequest handler. Single-line in-place replacements, EOL-safe. */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'background.js');
const src = fs.readFileSync(FILE, 'latin1');
const crCount = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === '\r') n++; return n; };
const CR_BEFORE = crCount(src);
let out = src;

function scopeStart(marker) {
  const i = out.indexOf(marker);
  if (i < 0) throw new Error('scope marker missing: ' + marker);
  if (out.indexOf(marker, i + 1) >= 0) throw new Error('scope marker not unique: ' + marker);
  return i;
}
function replaceScoped(scopeIdx, scopeLen, anchor, target, repl, windowChars, label) {
  const end = scopeIdx + scopeLen;
  const a = out.indexOf(anchor, scopeIdx);
  if (a < 0 || a > end) throw new Error('anchor missing in scope: ' + label);
  const t = out.indexOf(target, a);
  if (t < 0 || t - a > windowChars || t > end) throw new Error('target not near anchor: ' + label);
  if (/[^\x00-\x7F]/.test(repl) || /[\r\n]/.test(repl)) throw new Error('bad replacement: ' + label);
  out = out.slice(0, t) + repl + out.slice(t + target.length);
}

const VD = scopeStart('async function mlsReadVisitsPaneDriverFn');
const VLEN = 45000;
replaceScoped(VD, VLEN, 'var identDeadline = Date.now() + 15000;',
  'if (!ident) await sleep(800);',
  'if (!ident) await sleep(400); /* v2.9.32 speed: cadence only - 15s deadline + identity gate unchanged */',
  4500, 'identity poll');
replaceScoped(VD, VLEN, 'var railDeadline = Date.now() + 12000;',
  'if (!clicked) await sleep(700);',
  'if (!clicked) await sleep(350); /* v2.9.32 speed: cadence only */',
  500, 'rail poll');
replaceScoped(VD, VLEN, 'var paneDeadline = Date.now() + 16000',
  'await sleep(500);',
  'await sleep(300); /* v2.9.32 speed: cadence only */',
  300, 'pane poll');
replaceScoped(VD, VLEN, 'var paneDeadline2 = Date.now() + 10000;',
  'await sleep(500);',
  'await sleep(300); /* v2.9.32 speed: cadence only */',
  300, 'pane recovery poll');
replaceScoped(VD, VLEN, "reason: 'no-pane'",
  'await sleep(1200); /* let the entry list hydrate */',
  'await sleep(600); /* v2.9.32: shorter pre-settle - the v2.03 settle-poll below owns hydration correctness */',
  800, 'hydrate settle');
replaceScoped(VD, VLEN, "dispatchEvent(new W.Event('change', { bubbles: true }))",
  'await sleep(1500);',
  'await sleep(800); /* v2.9.32: the settle-poll below still verifies the re-rendered list */',
  200, 'all-events settle');
replaceScoped(VD, VLEN, 'var parseDeadline = Date.now() + 14000;',
  'await sleep(700);',
  'await sleep(400); /* v2.9.32 speed: cadence only; the 800ms stability confirmation above is unchanged */',
  800, 'parse poll');

const CH = scopeStart("if (msg.type === 'mlsAppChartRequest') {");
const CLEN = 60000;
replaceScoped(CH, CLEN, 'if (self.__mlsQpEnsure) {',
  "if (!(await chartWait(3200))) { chartFailDeadline('clinical chart load'); return; }",
  "if (!(await chartWait(1800))) { chartFailDeadline('clinical chart load'); return; } /* v2.9.32: shorter first settle - the loop keeps re-probing under the same budget */",
  700, 'post-click wait');
replaceScoped(CH, CLEN, 'if (briefingNow && noClickRounds >= 5 && !navClicked) break;',
  'if (!(await chartWait(bootstrapReadyEarly ? 900 : 2400))) { chartFailDeadline(\'clinical chart readiness\'); return; }',
  'if (!(await chartWait(bootstrapReadyEarly ? 600 : (polls < 3 ? 1200 : 2400)))) { chartFailDeadline(\'clinical chart readiness\'); return; } /* v2.9.32: faster early polls, same acceptance + budgets */',
  400, 'identity poll interval');

const CR_AFTER = crCount(out);
if (CR_AFTER !== CR_BEFORE) throw new Error('CR census changed: ' + CR_BEFORE + ' -> ' + CR_AFTER);
fs.writeFileSync(FILE, out, 'latin1');
console.log('OK background.js speed edits: CRs', CR_AFTER, 'size', out.length);
