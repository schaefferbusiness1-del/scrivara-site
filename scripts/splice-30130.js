'use strict';
/* MLS Assist 3.0.130 - restorediag-1.0.0 (Fable, 2026-09-14). Three rows of the 2026-09-14 day
 * refuse `schedule-date-restore-failed` on every build (3.0.124 through 3.0.129) via the
 * schedule route's "schedule-row recovery" re-ground, and the refusal carried no evidence of
 * what the per-frame goto-date results said. Add a PHI-free per-frame summary (done flag,
 * unverified flag, whether the read date equals the frozen requested date, the driver's own
 * reason head) so the next live run names the mechanism. Dates only; no patient data.
 * Byte-preserving latin1 seam with an inverse proof. Run once: node scripts/splice-30130.js
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const a = "diag: { route: 'schedule', scheduleRegrounds: scheduleRegrounds, scheduleDateVerified: false } }); return false; }";
const b = "diag: { route: 'schedule', scheduleRegrounds: scheduleRegrounds, scheduleDateVerified: false, stage: String(stage || '').slice(0, 40), regroundFrames: (regroundX.r || []).map(function (entry) { return entry && entry.result; }).filter(Boolean).slice(0, 8).map(function (v) { return { done: v.done === true, unverified: v.dateUnverified === true, dateMatch: String(v.schedDate || '') === frozenScheduleDate, steps: Number(v.steps || 0), head: String(v.error || v.dateUnverifiedReason || '').replace(/\\d{4}-\\d{2}-\\d{2}/g, 'D').slice(0, 70) }; }) } }); return false; } /* restorediag-1.0.0 (3.0.130) */";
assert(before.split(a).length === 2, 'unique seam');
assert(before.split(b).length === 1, 'replacement absent');
const out = before.replace(a, () => b);
assert.strictEqual(out.replace(b, () => a), before, 'inverse restores');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30130: 1 verified seam');
