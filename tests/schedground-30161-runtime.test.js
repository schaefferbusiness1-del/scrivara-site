'use strict';
/* MLS Assist 3.0.161 — schedground-1.0.0: a schedule-first open (appointment id, no MRN) grounds the athena tab on
 * the exact pull date before its row sweep, softly (an unverified grounding never ends the open). Pins the seams and
 * executes the grounding decision against the real leg order table. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

ok(bg.includes("        async function restoreExactSchedule(stage, soft) {"), 'the restore helper takes a soft flag');
ok(bg.includes("if (!frozenScheduleDate) { if (soft) return false; sendResponse({ ok: false, opened: false, reason: 'schedule-date-missing-after-recovery'"), 'a missing date answers false softly');
ok(bg.includes("if (!regroundOk && soft) { scheduleRegrounds--; return false; }"), 'an unverified grounding answers false softly and does not count as a reground');
ok(bg.includes("if (!regroundOk) { sendResponse({ ok: false, opened: false, reason: 'schedule-date-restore-failed',"), 'the strict path still refuses terminally');
const call = "if (!bootstrapIdentity && !exactScheduleFallback && oi === 0 && frozenApptId && frozenScheduleDate) { if (senderTab) progress(senderTab, 'Opening the schedule day before looking for the row...', openGuard.token); await restoreExactSchedule('schedule-first grounding', true); if (responseSent) return; }";
ok(bg.includes(call), 'the schedule-first leg grounds softly before its sweep');
const strictCall = "if (exactScheduleFallback && !(await restoreExactSchedule('find-to-schedule restoration'))) return;";
ok(bg.indexOf(call) > bg.indexOf(strictCall) && bg.indexOf(call) - bg.indexOf(strictCall) < 600, 'right after the strict find-to-schedule restoration, before the nav-menu dismissal and the sweep');
ok(bg.indexOf("var schedX = await execOpen({ target: { tabId: tab.id, allFrames: true }, func: mlsSearchOpenDriverFn", bg.indexOf(call)) > 0, 'the sweep follows the grounding');
/* the leg order table, executed: which rows reach the schedule-first grounding */
const orderLine = "var order = bootstrapIdentity ? ['sched'] : (frozenMrn ? ['find', 'sched'] : (frozenApptId ? ['sched', 'find'] : ((self.__mlsOpenPref === 'schedule') ? ['sched', 'find'] : ['find', 'sched'])));";
ok(bg.includes(orderLine), 'the leg order table is unchanged');
const order = new Function('bootstrapIdentity', 'frozenMrn', 'frozenApptId', 'self', orderLine + ' return order;');
const grounds = (bootstrapIdentity, frozenMrn, frozenApptId, frozenScheduleDate) => { const o = order(bootstrapIdentity, frozenMrn, frozenApptId, {}); const oi = o.indexOf('sched'); return !bootstrapIdentity && oi === 0 && !!frozenApptId && !!frozenScheduleDate; };
eq(grounds(false, '', 'A1', '2026-09-14'), true, 'an appointment-id row with no MRN grounds first');
eq(grounds(false, '7833832', 'A1', '2026-09-14'), false, 'an MRN row runs Find first (the strict find-to-schedule restoration covers its fallback)');
eq(grounds(false, '', '', '2026-09-14'), false, 'no appointment id: no grounding (Find first)');
eq(grounds(false, '', 'A1', ''), false, 'no pull date: nothing to ground on');
eq(grounds(true, '', 'A1', '2026-09-14'), false, 'the bootstrap (write-grade) route keeps its own strict path');
console.log('PASS schedground-30161-runtime: ' + checks + ' checks');
