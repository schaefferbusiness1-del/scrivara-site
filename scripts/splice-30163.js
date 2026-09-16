'use strict';
/* MLS Assist 3.0.163 - apptrowdob-1.0.0 (Fable, 2026-09-16). Owner, 2026-09-16: "you still have to fix that" - the one
 * Sep-14 row every run refused. Run AK: it now OPENS by athena's own schedule row (the appointment id bound to
 * exactly one row, date verified) and the chart read refused it wrong-chart because the banner's two printed names
 * (used + legal) do not key first-word+last-word to the schedule's printed name, while the banner prints the EXACT
 * expected date of birth. That is one patient rendered two ways by athena. New door, in the chart handler only:
 * when THIS request's appointment id was the row athena itself listed and clicked (stamped by the SearchOpen
 * schedule route as apptRowBound), the banner-grade identity prints the exact expected DOB, and a printed banner
 * name shares the exact last-name token with the schedule name, the identity is accepted for the READ and the
 * response says identityVia 'appointment-row-dob'. Not a name-only match, not a DOB-only match: appointment id
 * + DOB + surname, each exact. The bootstrap (write-grade) lease is untouched; exact-pair remains the first test.
 * Latin1 seams, inverse proof. Run once (after splice-30162.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("        const expectedAppointmentId = String(msg.appointmentId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);",
    "        const expectedAppointmentId = String(msg.appointmentId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);\n" +
    "        const __apptRowStamp = (function () { try { var x = self.__mlsExpectOpen; if (x && x.apptRowBound === true && expectedAppointmentId && String(x.appointmentId || '') === expectedAppointmentId && x.tabId != null && (Date.now() - Number(x.at || 0)) < 180000) return { appointmentId: expectedAppointmentId, tabId: x.tabId, at: x.at }; } catch (eArs) {} return null; })(); /* apptrowdob-1.0.0 (3.0.163): read before the poll clears the lease */", 'stamp capture');
rep("          const identityMatchesTarget = (who) => {\n            return exactPairAny({name:want,dob:wantDob,mrn:wantMrn},who).ok;\n          };",
    "          /* apptrowdob-1.0.0 (3.0.163): athena's own appointment-id row was clicked for THIS request's appointment id, the banner-grade identity prints the EXACT expected DOB, and a printed banner name shares the exact last-name token with the printed schedule name - one patient rendered two ways (used vs legal first name, initial vs full middle). Appointment id + DOB + surname, each exact; never name-only, never DOB-only. */\n" +
    "          const __apptRowDoor = (who) => { try { if (!__apptRowStamp || !who || !want || !wantDob || __apptRowStamp.tabId !== tab.id) return false; if (!/^(?:banner|shadow-banner|shadow-labels)$/.test(String(who.via || ''))) return false; const kd = mlsExactDobKey(who.dob); if (!kd || kd !== mlsExactDobKey(wantDob)) return false; const lw = (s) => { const k = mlsExactNameKey(s); return k ? k.split(' ').pop() : ''; }; const wl = lw(want); if (!wl) return false; const names = [who.name].concat(Array.isArray(who.altNames) ? who.altNames : []); return names.some((n) => lw(n) === wl); } catch (eArd) { return false; } };\n" +
    "          const identityMatchesTarget = (who) => {\n            return exactPairAny({name:want,dob:wantDob,mrn:wantMrn},who).ok || __apptRowDoor(who);\n          };", 'door');
rep("          if (want && ident && ident.name && !exactGlobalPair.ok) { /* bannernames-1.2.0 (3.0.129): the exact-pair verdict (over every printed name) is the only wrong-chart test */",
    "          if (want && ident && ident.name && !exactGlobalPair.ok && !__apptRowDoor(ident)) { /* bannernames-1.2.0 (3.0.129): the exact-pair verdict (over every printed name) is the wrong-chart test; apptrowdob-1.0.0 (3.0.163): or athena's own appointment row + exact DOB + exact surname */", 'wrong-chart');
rep("          return chartRespond({ ok: true, text: chartTextStrict, receipt: chartReceiptStrict,",
    "          return chartRespond({ ok: true, text: chartTextStrict, receipt: chartReceiptStrict, identityVia: (exactGlobalPair.ok ? (exactGlobalPair.viaAltName ? 'alt-name' : 'exact-pair') : (__apptRowDoor(ident) ? 'appointment-row-dob' : '')), /* apptrowdob-1.0.0 */", 'success receipt');
/* both schedule-route success stamps (the already-open context and the clicked row) carry the flag */
(function () {
  const a = "encounterAccepted: encounterAcceptedReceipt, appointmentIdBound: bootstrapIdentity && appointmentNavigationProven, appointmentNavigationFrameIds:";
  const b = "encounterAccepted: encounterAcceptedReceipt, apptRowBound: !!(sched && sched.diag && sched.diag.apptIdBound) /* apptrowdob-1.0.0 (3.0.163) */, appointmentIdBound: bootstrapIdentity && appointmentNavigationProven, appointmentNavigationFrameIds:";
  assert(count(out, a) === 2 && count(out, b) === 0, 'open stamp: exactly two schedule-route stamps');
  out = out.split(a).join(b); edits.push([a, b, 2]);
})();
let restored = out;
for (const [a, b, n] of edits.slice().reverse()) { assert(count(restored, b) === (n || 1), 'inverse unique'); restored = restored.split(b).join(a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30163: ' + edits.length + ' verified seams');
