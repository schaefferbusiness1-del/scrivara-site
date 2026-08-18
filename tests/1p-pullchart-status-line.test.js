'use strict';

/* pcs-1.0.0 — the single-patient "Pull chart from Athena" narrates in place.
 * Owner 2026-08-18: "make sure that pull from athena has a progress bar."
 * Measured live on r20: the pull ran and saved, but quietnotify routes outcome
 * toasts to the activity tray, so at the button the ONLY visible change was
 * its label — silent success was indistinguishable from the dead click found
 * the same day. Every phase now also paints an inline status line beside the
 * button: same messages, a truthful step counter, never an invented percent.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

for (const name of ['1pScribeFlow.html', '1p/index.html']) {
  const src = fs.readFileSync(path.join(root, name), 'latin1');
  ok(src.includes('<div id="pullChartStatus" style="display:none;font-size:12px;line-height:1.4;margin-top:6px"></div>'),
    name + ': the inline status div must sit beside the pull button, hidden until a pull runs');
  const fn = src.slice(src.indexOf('async function pullPatientChartViaAssist'), src.indexOf('/* Save a parsed Athena chart only to the exact'));
  ok(fn.includes("var say=function(m,k,ph){ setT(m,k);"), name + ': say() must WRAP setT — the tray toast keeps firing, the inline line is additive');
  ok(fn.includes("'step 1 of 3'") && fn.includes("'step 2 of 3'") && fn.includes("'step 3 of 3'"), name + ': all three truthful steps must be present');
  ok(/say\('.{0,6} Saved '\+pullTarget\.name\+[^;]*'ok','step 3 of 3'\)/.test(fn), name + ': success must paint ok + step 3 inline');
  ok(!/setT\('.{0,6} Saved '\+pullTarget\.name/.test(fn), name + ': the success path must not bypass the inline line');
  ok(fn.includes("k==='err'?'#9f2d2d'"), name + ': error phases must paint in the error colour');
  const heads = fn.match(/say\(/g) || [];
  ok(heads.length >= 6, name + ': every phase and failure path must speak inline (got ' + heads.length + ' say() calls)');
}

console.log('PASS 1p pull-chart status line: ' + checks + ' checks — inline truthful steps in both twins, tray toasts preserved, no silent outcome');
