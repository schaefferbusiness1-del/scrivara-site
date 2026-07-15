'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  assert(start >= 0, `missing start marker: ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert(end > start, `missing end marker: ${endText}`);
  return source.slice(start, end);
}

const deltaSource = sliceBetween(
  background,
  'function mlsAppointmentNavigationDelta(appointmentId, beforeFrames, afterFrames)',
  'function bestFrameResult'
);
const context = { Map, Set, Array, String, Number, RegExp, Object };
vm.runInNewContext(deltaSource, context, { filename: 'appointment-navigation-delta.js', timeout: 1000 });
const prove = context.mlsAppointmentNavigationDelta;
assert.strictEqual(typeof prove, 'function');

const cachedTarget = 'https://athena.example/appointment/40352338/briefing';
const schedule = 'https://athena.example/calendar/day/2026-07-15';
let proof = prove('40352338', [
  { frameId: 0, url: schedule },
  { frameId: 7, url: cachedTarget }
], [
  { frameId: 0, url: schedule },
  { frameId: 7, url: cachedTarget }
]);
assert.strictEqual(proof.matched, false, 'an unchanged cached target iframe proved a no-op click');

proof = prove('40352338', [{ frameId: 0, url: schedule }], [{ frameId: 0, url: cachedTarget }]);
assert.strictEqual(proof.matched, true, 'a same-frame exact appointment navigation delta was rejected');
assert.deepStrictEqual(Array.from(proof.changedFrameIds), [0]);

proof = prove('40352338', [{ frameId: 0, url: schedule }], [
  { frameId: 0, url: schedule },
  { frameId: 9, url: cachedTarget }
]);
assert.strictEqual(proof.matched, true, 'a newly-created exact appointment frame was rejected');
assert.deepStrictEqual(Array.from(proof.changedFrameIds), [9]);

const longTarget = cachedTarget + '?' + 'x'.repeat(1600);
proof = prove('40352338', [{ frameId: 4, url: longTarget }], [{ frameId: 4, url: longTarget }]);
assert.strictEqual(proof.matched, false, 'URL truncation manufactured a false navigation delta');

assert(background.includes('async function mlsSearchOpenDriverFn(name, phase, requestGuard, appointmentId, requireAppointmentId)'), 'exact appointment id is not injected into the opener');
assert(background.includes("requireAppointmentId === true ? { el: null, sc: 0, scanned: 0 } : scanOnce()"), 'bootstrap can fall back to a name scan');
assert(background.includes("reason: 'appointment-id-ambiguous'"), 'duplicate exact appointment holders are not terminal');
assert(background.includes('exactSuccesses.length > 1'), 'duplicate exact appointment holders across frames are not rejected');
assert(background.includes('beforeAppointmentFrames = beforeFramesSettled.value || []'), 'the complete pre-click frame set is not frozen');
assert(background.includes('mlsAppointmentNavigationDelta(frozenApptId, beforeAppointmentFrames, afterFramesSettled.value || [])'), 'post-click proof is not a same-tab frame delta');
assert(background.includes("mlsShadowIdentityTry(tab.id, bootstrapIdentity ? { noCache: true, all: true } : null)"), 'bootstrap still reuses the tab-only shadow identity cache');
assert(background.includes('routeBoundBannerSeen'), 'banner identity is not bound to the changed appointment frame');
assert(background.includes('validBootstrapDob(candidate.dob) && candidateDobKey === chosenDobKey'), 'visible banner candidates may disagree or omit DOB');
assert(background.includes('args: [frozenScheduleDate, false, openGuard], func: mlsAthenaGotoDate'), 'post-recovery exact date restoration is missing');
assert(background.includes("reason: 'schedule-date-restore-failed'"), 'post-recovery date mismatch does not fail closed');

assert(content.includes('chartMessage.appointmentNavigationFrameIds = Array.isArray(opened.appointmentNavigationFrameIds)'), 'content relay drops changed-frame proof');
assert(content.includes("reason: 'appointment-navigation-unverified'"), 'content relay does not reject a missing changed-frame proof');
assert(!content.includes("dobHint = localStorage.getItem") || content.includes('if (!dobHint && d.bootstrapIdentity !== true)'), 'bootstrap borrows a stale local DOB');

console.log('PASS exact appointment-id bootstrap: true frame delta, duplicate refusal, fresh all-frame banner proof, dynamic date recovery, and content relay');
