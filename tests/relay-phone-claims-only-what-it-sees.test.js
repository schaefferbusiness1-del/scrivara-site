'use strict';
/* relay-phone-claims-only-what-it-sees — rl-2.0.3 N2 (2026-07-25)
 *
 * WHY THIS EXISTS
 * The authoritative record of "this day was pulled" is the import ledger in the
 * OFFICE computer's own localStorage, written under a per-browser namespace. A
 * phone structurally CANNOT read it. So the old success line —
 *     "<date> pulled on <computer> — synced here."
 * was a relayed assertion repeated as fact: the phone had a message, not a
 * receipt. This product has already been burned once by a toast announcing
 * success over a silent refusal, and for a clinical import the same shape is
 * worse: a doctor may believe a day is on their phone when it is not.
 *
 * The fix is not to persist a receipt server-side. The relay queue is in-memory
 * BY DESIGN ("No DB, no migration ... No PHI is stored beyond the job
 * payload/result ... in RAM" — scrivara-backend src/routes/relay.js), and
 * reversing that is an architecture and privacy decision about storing clinical
 * activity, not a bug fix. The fix is for the phone to claim only what it can
 * SEE, now that the done-branch re-reads the calendar (N1).
 *
 * The subtle requirement, and the reason this file exists rather than a comment:
 * an empty count is only evidence of absence when the month is actually loaded.
 * Turning "I cannot see it" into "it failed" would be a NEW dishonesty pointing
 * the other way.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const doneIdx = connect.indexOf("if (job.status === 'done')");
assert(doneIdx > 0, 'the relay done-branch could not be located');
/* Window sized from a measurement, not a guess: the last assertion below sits
   ~4.6k after the branch opens. Kept tight enough that a match still means "in
   the done-branch". */
const block = connect.slice(doneIdx, doneIdx + 6000);

/* ---- it must actually look at the calendar, not just re-assert ---- */
assert(/window\.loadCalendar\(\{ fresh: true \}\)/.test(block),
  'the done-branch must re-read the calendar (N1) or there is nothing to count');
assert(/window\._calAppts/.test(block),
  'the phone must count what actually arrived, not repeat the relayed message');
assert(/start_at \|\| list\[i\]\.start_local/.test(block),
  'appointment dates must be read from the real fields');

/* ---- the four outcomes, each stated honestly ---- */
assert(/onDay > 0/.test(block) && /appointment' \+ \(onDay === 1 \? '' : 's'\) \+ ' now on this phone/.test(block),
  'a successful pull must report the COUNT the phone can see');
assert(/could not confirm what arrived/.test(block),
  'with no calendar data the phone must say it could not confirm');
assert(/has not loaded that month/.test(block),
  'an unloaded month must be reported as unknown, not as success or failure');

/* ---- the load-bearing one: no false negative ----
 * `monthLoaded` must gate the failure branch. Without it, pulling a day whose
 * month this phone has not loaded would report a scary failure for a pull that
 * actually worked. */
const failIdx = block.indexOf('but no appointments for that day have reached this phone');
assert(failIdx > 0, 'the honest empty-day message is missing');
const guardIdx = block.indexOf('} else if (monthLoaded) {');
assert(guardIdx > 0, 'the empty-day failure must be guarded by monthLoaded');
assert(guardIdx < failIdx,
  'the failure branch must be GATED on the month being loaded — otherwise "I cannot see it" ' +
  'is reported as "it failed", which is a new dishonesty pointing the other way');

/* ---- and the old unconditional claim must be gone ---- */
assert(!/pulled on ' \+ who \+ ' — synced here\./.test(connect),
  'the unconditional "synced here" claim must not survive — it asserts a clinical import the phone cannot verify');

/* ---- the date echo guard stays: a mixed-up day must never read as success ---- */
assert(/answered with a different day/.test(block),
  'the date-echo verification must remain — it is the only thing preventing a mixed-up result reading as success');

console.log('PASS relay phone claims only what it sees: counts real appointments after the calendar re-read, ' +
  'reports unknown when the month is not loaded, never turns "cannot see" into "failed", and the ' +
  'unverifiable "synced here" assertion is gone');
