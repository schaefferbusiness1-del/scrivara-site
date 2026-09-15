'use strict';
/* notefirst-1.0.0 (2026-09-15) - AFTER GENERATE, THE NOTE IS ON SCREEN.
 *
 * Measured live on the dummy patient at b1274: a successful Generate painted
 * "Your note is ready below" while #noteBox was display:none and the rendered
 * note sat inside the review workspace about 2,000 px further down (scrollY
 * 2148 to reach it); the page did not move, and a stale red "Recording did
 * not start" verdict from a press on another chart was still on screen.
 *
 * This executes revealGeneratedNote sliced out of the shipped front lane with
 * stubs, and pins the wiring (settle handler, patient-change listener, revert).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
let checks = 0;
function ok(c, m) { checks++; assert.ok(c, m); }

ok(src.includes("function onLaneGenSettled(ev) { noteGenSettled(ev && ev.detail); repaintGenSurfaces(); revealGeneratedNote(ev && ev.detail); }"), 'a settle reveals the note after the surfaces repaint');
ok(src.includes("window.addEventListener('mls:active-patient-changed', onLanePatientChanged);"), 'a patient switch clears the recording verdict');
ok(src.includes("window.removeEventListener('mls:active-patient-changed', onLanePatientChanged);"), 'the revert path removes the listener');
const s = src.indexOf('function revealGeneratedNote(detail) {');
const e = src.indexOf('\n  }\n', s);
const fn = src.slice(s, e + 4);
function run(detail) {
  const calls = { clear: 0, open: [] };
  const ctx = { String, Object, console, recFailClear() { calls.clear++; }, openWorkspace(v) { calls.open.push(v); }, _recPending: { armed: true } };
  vm.runInNewContext(fn + '\nglobalThis.__r = revealGeneratedNote(' + JSON.stringify(detail) + ');', ctx, { filename: 'front-lane' });
  return { result: ctx.__r, calls, pending: ctx._recPending };
}
const good = run({ status: 'success', runId: 7 });
ok(good.result === true, 'a success settle reveals');
ok(good.calls.open.length === 1 && good.calls.open[0] === true, 'the workspace is opened and the note brought into view through the lane\'s own door');
ok(good.calls.clear === 1 && good.pending === null, 'the stale recording verdict is cleared');
const okStatus = run({ status: 'ok' });
ok(okStatus.result === true && okStatus.calls.open.length === 1, '"ok" counts as success too');
const failed = run({ status: 'failed', code: 'draft_quality_failed' });
ok(failed.result === false && failed.calls.open.length === 0 && failed.calls.clear === 0, 'a refusal neither moves the page nor clears the verdict');
const none = run({});
ok(none.result === false && none.calls.open.length === 0, 'a settle with no status does nothing');
console.log('PASS notefirst generate reveals the note: a successful Generate opens the review workspace, brings the note into view and clears a stale recording verdict; a refusal leaves the page alone; a patient switch clears the verdict (' + checks + ' checks)');
