'use strict';
/* MLS Assist 3.0.161 - schedground-1.0.0 (Fable, 2026-09-16). schedscandiag (3.0.160) on the in-page probe of the
 * one refused row: the schedule leg's frame held 62 chars of text, 0 appointment rows, pathCode 4 - the sweep ran
 * on the tab as the previous row left it (a chart), not on the day grid. Why: a row with an appointment id and NO
 * MRN runs the schedule leg FIRST (order sched-find), and only the schedule-AFTER-Find path re-grounds the tab to
 * the pull's date (restoreExactSchedule: Home, then the day tab, verified). MRN rows never notice - Find opens
 * them. A used-name row without an MRN can be opened only by its own grid row, so the schedule-first leg now
 * grounds the tab on the exact date first, SOFTLY: a grounding that cannot be verified does not end the open
 * (the ordinary scan and the Find leg still follow), while a verified grounding puts the day grid under the sweep
 * that schedwait-1.0.0 already extends. Same matcher, same click, same appointment-id gates, no identity change.
 * Latin1 seams, inverse proof. Run once (after splice-30160.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("        async function restoreExactSchedule(stage) {\n          if (!frozenScheduleDate) { sendResponse({ ok: false, opened: false, reason: 'schedule-date-missing-after-recovery', error: 'The exact requested schedule date was missing. Nothing was opened.' }); return false; }",
    "        async function restoreExactSchedule(stage, soft) { /* schedground-1.0.0 (3.0.161): soft = a failed grounding answers false without ending the open */\n          if (!frozenScheduleDate) { if (soft) return false; sendResponse({ ok: false, opened: false, reason: 'schedule-date-missing-after-recovery', error: 'The exact requested schedule date was missing. Nothing was opened.' }); return false; }", 'soft signature');
rep("          if (!regroundOk) { sendResponse({ ok: false, opened: false, reason: 'schedule-date-restore-failed',",
    "          if (!regroundOk && soft) { scheduleRegrounds--; return false; } /* schedground-1.0.0: not verified - the scan and the Find leg still follow */\n          if (!regroundOk) { sendResponse({ ok: false, opened: false, reason: 'schedule-date-restore-failed',", 'soft failure');
rep("              if (exactScheduleFallback && !(await restoreExactSchedule('find-to-schedule restoration'))) return;",
    "              if (exactScheduleFallback && !(await restoreExactSchedule('find-to-schedule restoration'))) return;\n" +
    "              /* schedground-1.0.0 (3.0.161): the schedule-first leg (an appointment id, no MRN) grounds the tab on the exact date before its sweep; softly - an unverified grounding never ends the open */\n" +
    "              if (!bootstrapIdentity && !exactScheduleFallback && oi === 0 && frozenApptId && frozenScheduleDate) { if (senderTab) progress(senderTab, 'Opening the schedule day before looking for the row...', openGuard.token); await restoreExactSchedule('schedule-first grounding', true); if (responseSent) return; }", 'sched-first grounding');
let restored = out;
for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30161: ' + edits.length + ' verified seams');
