'use strict';
/* MLS Assist 3.0.163 — apptrowdob-1.0.0: the chart read accepts an identity proven by athena's own appointment-id row
 * (clicked for THIS request's appointment id) + the exact expected DOB + an exact shared last-name token, when the
 * exact first+last pair over every printed banner name fails. Executes the real door with the real key helpers. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* pins */
ok(bg.includes("const __apptRowStamp = (function () { try { var x = self.__mlsExpectOpen; if (x && x.apptRowBound === true && expectedAppointmentId && String(x.appointmentId || '') === expectedAppointmentId"), 'the stamp is read at request start, for THIS appointment id');
ok(bg.includes("return exactPairAny({name:want,dob:wantDob,mrn:wantMrn},who).ok || __apptRowDoor(who);"), 'the exact pair stays first; the door is the alternative');
ok(bg.includes("if (want && ident && ident.name && !exactGlobalPair.ok && !__apptRowDoor(ident)) {"), 'wrong-chart only when the door is closed too');
ok(bg.includes("identityVia: (exactGlobalPair.ok ? (exactGlobalPair.viaAltName ? 'alt-name' : 'exact-pair') : (__apptRowDoor(ident) ? 'appointment-row-dob' : ''))"), 'the success response names how identity was proven');
ok(bg.includes("apptRowBound: !!(sched && sched.diag && sched.diag.apptIdBound) /* apptrowdob-1.0.0 (3.0.163) */"), 'the schedule route stamps whether athena\'s appointment-id row was the one clicked');
ok(bg.includes("if (!(exactOpenLease && exactOpenLease.appointmentIdBound && exactOpenLease.requestId === chartRequestId && exactOpenLease.appointmentId === expectedAppointmentId && exactNameMatched && validBannerDob && bannerCandidatesAgree && routeBoundBannerSeen)) {"), 'the bootstrap (write-grade) lease still needs the exact name');

/* apptrowdob-1.1.0 (3.0.164): the door completes the read */
ok(bg.includes("if (__apptRowDoor(ident) && wantDob && textHasDobStrict(f.t, wantDob)) return true;"), 'a clinical frame printing the exact DOB binds when the door proved the chart');
ok(bg.indexOf("if (__apptRowDoor(ident) && wantDob && textHasDobStrict(f.t, wantDob)) return true;") > bg.indexOf("if (identityMatchesTarget(frameIdentity[f.frameId])) return true;"), 'after the exact-identity frame door, before the meta and text doors');
ok(bg.includes("((!exactGlobalPair.ok && __apptRowDoor(ident)) ? want : ((ident && ident.name) || ''))"), 'the response reports the printed schedule name the door proved (like the alt-name path), the banner name stays in chartNamePrinted');

/* runtime: the door itself */
const kn = bg.indexOf('\nfunction mlsExactNameKey(value) {', bg.indexOf("hoistfix-1.0.0 (3.0.156): the worker's ONE top-level copy"));
const helpers = bg.slice(kn + 1, bg.indexOf('\n}', bg.indexOf('\nfunction mlsExactDobKey(value) {', kn) + 10) + 2).replace(/\r/g, '');
const doorStart = bg.indexOf('          const __apptRowDoor = (who) => {'); const doorEnd = bg.indexOf('} catch (eArd) { return false; } };', doorStart) + '} catch (eArd) { return false; } };'.length;
ok(doorStart > 0 && doorEnd > doorStart, 'door present');
const mk = (stamp, want, wantDob, tabId) => new Function('__apptRowStamp', 'want', 'wantDob', 'tab', helpers + '\n' + bg.slice(doorStart, doorEnd) + '\nreturn __apptRowDoor;')(stamp, want, wantDob, { id: tabId });
const stamp = { appointmentId: 'A1', tabId: 7, at: Date.now() };
/* fictional names only */
const banner = { name: 'William Michael De Souza', dob: '03/24/1960', via: 'shadow-banner', altNames: ['Wilhelm De Souza'] };
eq(mk(stamp, 'Bill M de Souza', '1960-03-24', 7)(banner), true, 'appointment row + exact DOB + exact surname token: accepted');
eq(mk(null, 'Bill M de Souza', '1960-03-24', 7)(banner), false, 'no appointment-row stamp: refused');
eq(mk(stamp, 'Bill M de Souza', '1960-03-24', 8)(banner), false, 'a different tab than the stamped open: refused');
eq(mk(stamp, 'Bill M de Souza', '1960-03-25', 7)(banner), false, 'a different DOB: refused');
eq(mk(stamp, 'Bill M de Souza', '', 7)(banner), false, 'no expected DOB: refused');
eq(mk(stamp, 'Bill M de Lima', '1960-03-24', 7)(banner), false, 'a different surname with the same DOB (a spouse, a twin by another name): refused');
eq(mk(stamp, 'Bill M de Souza', '1960-03-24', 7)(Object.assign({}, banner, { via: 'lastfirst' })), false, 'a non-banner grep: refused');
eq(mk(stamp, 'Bill M de Souza', '1960-03-24', 7)(Object.assign({}, banner, { dob: '' })), false, 'a banner with no DOB: refused');
eq(mk(stamp, 'Bill M de Souza', '1960-03-24', 7)({ name: 'Someone Else', dob: '03/24/1960', via: 'banner', altNames: ['Other Souza'] }), true, 'the shared surname may come from the alternate printed name');
console.log('PASS apptrowdob-30163-runtime: ' + checks + ' checks');
