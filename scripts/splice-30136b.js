'use strict';
/* MLS Assist 3.0.136 - readstage-1.0.0 (Fable, 2026-09-14). Measured on the 3.0.135 live pull with a
 * VISIBLE athenaOne tab: two chart reads refused 'chart-deadline-exceeded' from the ABSOLUTE timer with the
 * stage 'the read' - i.e. no bounded step timed out; the read was still somewhere in its ~100 s budget and
 * nothing recorded where. Adds a per-read stage marker (closed strings, counts only) that the absolute-timer
 * refusal reports as `stage`, so the next run says which step ate the budget. Latin1 seams, inverse proof.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
var a;

/* 1. the refusal carries a closed stage field */
rep("    const chartFailDeadline = (stage) => chartRespond({" + eolAt("    const chartFailDeadline = (stage) => chartRespond({") + "      ok: false, reason: 'chart-deadline-exceeded',",
    "    const chartFailDeadline = (stage) => chartRespond({" + eolAt("    const chartFailDeadline = (stage) => chartRespond({") + "      ok: false, reason: 'chart-deadline-exceeded', stage: String(stage || 'the read').replace(/[^a-z0-9 ()-]/gi, '').slice(0, 60), /* readstage-1.0.0 (3.0.136) */", 'field');

/* 2. the marker and the absolute timer */
a = "    chartDeadlineTimer = setTimeout(() => { chartFailDeadline('the read'); }, Math.max(0, chartRequestGuard.deadline - Date.now()));";
rep(a, "    var __chartStage = 'request start'; /* readstage-1.0.0 (3.0.136): the last step the read reached, for the absolute-timer refusal */" + eolAt(a) +
       "    chartDeadlineTimer = setTimeout(() => { chartFailDeadline('the read after ' + __chartStage); }, Math.max(0, chartRequestGuard.deadline - Date.now()));", 'timer');

/* 3. markers at the steps */
a = "        if (!allSettled || !allSettled.ok) { chartFailDeadline('Athena tab selection'); return; }";
rep(a, a + eolAt(a) + "        __chartStage = 'tab selection';", 'tab');
a = "          /* v1.63: 15s -> 20s. A heavy-but-alive chart load could eat two 15s injection";
rep(a, "          __chartStage = 'identity poll ' + polls;" + eolAt(a) + a, 'poll');
a = "        if (chartExpired()) { chartFailDeadline('clinical chart readiness'); return; }";
rep(a, a + eolAt(a) + "        __chartStage = 'identity settled after ' + polls + ' polls';", 'settled');
a = "          const tx = await chartExec({ target: { tabId: tab.id, allFrames: true }, func: () => {";
rep(a, "          __chartStage = 'text read';" + eolAt(a) + a, 'text');

let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30136b: ' + edits.length + ' verified seams');
