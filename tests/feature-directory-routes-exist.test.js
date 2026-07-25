'use strict';

/* The feature directory must not send a doctor to a switch that does not exist.
 *
 * Two entries told them to enable a tab in "Settings -> App tabs":
 *
 *   where:'Calendar tab (enable it in Settings -> App tabs if hidden)'
 *   where:'Analysis tab (enable it in Settings -> App tabs if hidden)'
 *
 * Settings -> Features & navigation -> App tabs renders from NAV_FEATURES, whose
 * only member is `orders`. There is no Calendar row and no Analysis row.
 *
 *   - The real Calendar switch is `rc_calendar` (ScribeFlow.html:24325,
 *     persisted as calendarEnabled at :24340) and it lives in the FRONT-DESK
 *     settings card, shown only by applyReceptionistPortal(), which early-returns
 *     for anyone who is not a receptionist. A doctor has no path to it.
 *   - The Analysis toggle does not exist at all: grep for analysisEnabled or
 *     rc_analysis across every .js and .html returns ZERO hits. #nav_analysis is
 *     purely role-derived.
 *
 * Blast radius was three surfaces, not one: helpAnswer() prints these verbatim
 * into the Help ask box, the Find palette renders them as the row subtitle, and
 * the same objects ship to the backend as featureMap, so the AI answer repeats
 * them. The doctor asking "where is the calendar" is the exact person this
 * directory exists to serve.
 *
 * This pins the invariant, not the wording: an entry may name App tabs only for
 * a feature App tabs actually offers. Add a Calendar row to NAV_FEATURES and the
 * copy becomes true again — and this test will say so instead of blocking it. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const asst = fs.readFileSync(path.join(root, 'feat_mls_asst_fix.js'), 'utf8');

/* what App tabs actually offers */
const navBlock = /const NAV_FEATURES=\[([\s\S]*?)\];/.exec(shell);
assert(navBlock, 'NAV_FEATURES no longer parses - re-check what Settings -> App tabs offers');
const navKeys = (navBlock[1].match(/key:'([a-z0-9_]+)'/g) || []).map((m) => /key:'([a-z0-9_]+)'/.exec(m)[1]);
assert(navKeys.length > 0, 'NAV_FEATURES is empty');

/* every directory entry that points at App tabs must name a tab App tabs offers */
const entries = connect.match(/\{ k:'[^']*', name:'[^']*', where:'[^']*'[^}]*\}/g) || [];
assert(entries.length > 5, 'the feature directory no longer parses (' + entries.length + ' entries)');

const liars = [];
for (const e of entries) {
  const where = /where:'([^']*)'/.exec(e);
  const route = /route:'([^']*)'/.exec(e);
  if (!where || !/App tabs/i.test(where[1])) continue;
  /* view:calendar -> 'calendar', settings:x -> skip */
  const view = route && /^view:([a-z]+)$/.exec(route[1]);
  if (!view) continue;
  if (navKeys.indexOf(view[1]) === -1) {
    liars.push(view[1] + ' -> "' + where[1] + '"');
  }
}
assert.deepStrictEqual(liars, [],
  'these directory entries tell the doctor to enable a tab in Settings -> App tabs, which only\n' +
  'offers [' + navKeys.join(', ') + ']:\n  ' + liars.join('\n  ') + '\n' +
  'Either add the row to NAV_FEATURES, or name the route that actually controls it.');

/* if an Analysis toggle is ever added, the copy should be restored - so pin the
   absence rather than leaving it as folklore */
const analysisToggle = (connect.match(/analysisEnabled|rc_analysis/g) || []).length +
                       (shell.match(/analysisEnabled|rc_analysis/g) || []).length;
assert.strictEqual(analysisToggle, 0,
  'an Analysis toggle now exists (' + analysisToggle + ' references) - the feature directory says ' +
  'there is no user toggle, so update that copy to name the new control');

/* and the Calendar switch is still front-desk only, which is why the copy says so */
assert(/calendarEnabled:chk\('rc_calendar'\)/.test(shell),
  'the front-desk Calendar switch changed shape - re-check what the directory should tell a doctor');

/* the month-pull recovery must name the route the app documents everywhere else */
const recovery = /The month pull isn't available right now\.([^"]*)/.exec(asst);
assert(recovery, 'the month-pull recovery line is gone');
assert(!/Calendar/i.test(recovery[1]),
  'the month-pull recovery still sends the doctor to the Calendar. That card is built only by ' +
  'pullPanelHtml(), called only from renderStaff(): "' + recovery[1].trim() + '"');
assert(/Staff prep/i.test(recovery[1]),
  'the month-pull recovery no longer names Staff prep, which is where the card actually is');
assert(/Staff Prep lives only in <b>Menu<\/b>/.test(shell),
  'the app no longer documents Menu as the Staff Prep route - re-check what the recovery should say');

console.log('PASS feature directory routes exist: App tabs entries match NAV_FEATURES [' + navKeys.join(', ') +
  '], and the month-pull recovery names Staff prep');
