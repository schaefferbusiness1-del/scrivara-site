'use strict';

/* NO DAY-NAVIGATION STRATEGY MAY CLAIM A DAY IT DID NOT READ BACK (3.0.25).
 *
 * The owner's loudest failure this week had two faces and one cause. The day
 * driver in background.js has four strategies for putting athenaOne on a date
 * (week strip, date input, arrow stepping, and the arrow fall-through). Two of
 * them reported success WITHOUT EVER READING THE SCHEDULE HEADER BACK:
 *
 *   week strip:  out.done = true; out.schedDate = target;
 *   date input:  out.done = true;                       (no schedDate at all)
 *
 * The week-strip echo is the worse of the two because it defeats the app's own
 * defence: feat_mls_schedimport_exact.js compares normDate(nav.schedDate) to
 * the requested scheduleDate, so echoing target back made that comparison
 * target === target - a tautology that CANNOT FAIL. A wrong-surface pull
 * imported another day's rows and reported success.
 *
 * The date-input face is the mirror image: schedDate was left empty, so the
 * SAME comparison failed for a day that had actually been reached, and the
 * doctor was told "Athena could not be opened to the requested day" on a pull
 * that was fine.
 *
 * A guard that cannot fail is not a guard, and a guard that fails on success is
 * worse than none. This suite pins the rule both faces violated: `done` must be
 * derived from a value READ OUT OF THE PAGE, never from the requested target.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

/* ---- 1. the app-side check this protects still exists ----
   If this ever disappears, the whole suite is guarding nothing, so assert the
   consumer before asserting the producer. */
assert(/normDate\(\s*nav\.schedDate\s*\)/.test(si),
  'the app must still compare the OBSERVED nav.schedDate against the requested day - ' +
  'this suite exists to keep that comparison meaningful');

/* ---- 2. the requested target may be carried forward ONLY when the same
   statement declares it unverified ----
   A blanket ban is the wrong rule and we learned that the expensive way. The
   owner's v26.3 dashboard prints NO parseable day anywhere (its tabs read
   "WED 7/29", its heading reads "Week of July 26 - August 1, 2026"), so a
   strategy that refuses whenever it cannot read a date would fail every row at
   feat_mls_schedimport_exact.js:1858 and refuse every pull. Carrying the day
   forward on an unreadable surface is legitimate. Doing it SILENTLY is the bug.
   So: every echo must be accompanied by dateUnverified. */
bg.split('\n').forEach(function (line, i) {
  if (!/out\.schedDate\s*=\s*target\b/.test(line)) return;
  assert(/dateUnverified/.test(line),
    'background.js:' + (i + 1) + ' assigns the REQUESTED target to out.schedDate without ' +
    'declaring it unverified:\n    ' + line.trim() + '\n' +
    'That echo makes the app-side check compare target to target - a tautology that ' +
    'cannot fail, which is exactly how a wrong-day pull reported success. If the surface ' +
    'genuinely cannot be read, set out.dateUnverified = true on the same statement.');
});
assert(/out\.dateUnverifiedReason\s*=/.test(bg),
  'an unverified date must carry a reason a human can read, not just a boolean');

/* ---- 3. every out.done assignment is derived from an observed read ----
   Two legal shapes: a comparison against a value READ FROM THE PAGE, or a
   literal true that is explicitly marked unverified. An unqualified
   `out.done = true;` is the defect - that was the date-input lane. */
const doneLines = bg.split('\n')
  .map(function (line, i) { return { n: i + 1, t: line.trim() }; })
  .filter(function (r) { return /(^|[^.\w])out\.done\s*=/.test(r.t); });

assert(doneLines.length >= 4,
  'expected at least the four day-navigation strategies to settle out.done, found ' + doneLines.length);

/* Names of values actually read out of the page in this driver. Deliberately
   NOT including out.schedDate: that field is the thing under suspicion, so
   allowing it would let an echo launder itself into a pass. The one line that
   legitimately compares against out.schedDate assigns it from hdr() first, so
   it is matched by hdr() on its own line. */
const OBSERVED = /hdr\(\)|inObs|wsObs|wsSelectedIso|\bcur\b/;
doneLines.forEach(function (r) {
  if (/out\.done\s*=\s*false/.test(r.t)) return;               /* a refusal needs no proof */
  if (/dateUnverified/.test(r.t)) return;                      /* honest, declared fallback */
  if (/out\.done\s*=\s*\(out\.schedDate === target\)/.test(r.t)) return; /* schedDate = hdr() above */
  assert(OBSERVED.test(r.t),
    'background.js:' + r.n + ' settles out.done without any value read back from the page:\n' +
    '    ' + r.t + '\n' +
    'Every strategy must compare against the day it actually observed (hdr()/cur/' +
    'inObs/wsObs), never against the day it was asked for. If the surface cannot be ' +
    'read at all, say so with out.dateUnverified = true.');
});

/* ---- 3b. the week strip must observe the SELECTED TAB, not prose ----
   hdr() reads body.innerText for "Wednesday, July 29, 2026". Measured on the
   owner's own account, his dashboard never prints that; the selected day tab
   carries an ISO date in data-date-value. A fix that only consults hdr() is
   inert on the one surface he actually uses. */
assert(/function wsSelectedIso\(\)/.test(bg),
  'the week strip must read the selected day tab, not only the prose header');
assert(/data-date-value/.test(bg),
  'the tab date reader must know about data-date-value - that is where the ISO day lives');
assert(/'\.day-tab-container\.selected'/.test(bg),
  'the selected-tab selector measured on the live account must be one of the ones tried');
assert(/return hdr\(\);/.test(bg),
  'hdr() must remain the fallback for the classic surfaces where it does work');

/* ---- 4. both repaired lanes report the observed day IN WORDS ----
   An honest failure the owner can act on beats a generic one. Both must name
   what was asked for AND what athenaOne is showing. */
assert(/weekstrip: clicked the day tab but the schedule reads/.test(bg),
  'the week-strip lane must say which day the schedule actually reads');
assert(/date input: typed .* but the schedule reads/.test(bg),
  'the date-input lane must say which day the schedule actually reads');

/* ---- 5. the date-input lane actually WAITS for the header to catch up ----
   Typing a date and pressing Enter is a request; athenaOne re-renders
   asynchronously. Reading the header once, immediately, would fail every time
   and turn the old false negative into a permanent one. */
const viaInput = bg.indexOf("if (out.via === 'input')");
assert(viaInput > 0, 'the date-input strategy must still exist');
const inputBranch = bg.slice(viaInput, viaInput + 3000);
assert(/for \(var iw = 0; iw < \d+; iw\+\+\)/.test(inputBranch) && /inObs = hdr\(\);/.test(inputBranch),
  'the date-input lane must POLL the header after typing, not read it once');
assert(/if \(inObs === target\) break;/.test(inputBranch),
  'the poll must stop as soon as the header agrees');
assert(/if \(!actionAllowed\(\)\) return deadlineStop\(\);/.test(inputBranch),
  'the new poll must respect the existing navigation deadline instead of outliving it');

/* ---- 6. the chart-identity verb always answers ----
   Same honesty class: a verb that never responds is read downstream as an
   ambiguous failure, and the write-back pre-gate renders that silence with the
   same words a real identity MISMATCH produces. */
const identStart = bg.indexOf("if (msg.type === 'mlsAssistChartIdentity')");
assert(identStart > 0, 'the chart-identity verb must still exist');
const identBranch = bg.slice(identStart, identStart + 4000);
assert(/__idSettled/.test(identBranch) && /setTimeout\(function \(\)/.test(identBranch),
  'the identity verb must carry a time budget so it cannot silently never answer');
assert(/timedOut: true/.test(identBranch),
  'a timed-out identity read must be distinguishable from a mismatch by the caller');
assert(!/(^|[^_\w])sendResponse\(/.test(identBranch.slice(0, identBranch.indexOf('var reply'))) ||
  /var reply = function/.test(identBranch),
  'every exit from the identity verb must route through the settle-once reply()');

console.log('PASS day navigation observes the header: no strategy echoes its target, ' +
  'every out.done is derived from a value read back from the page, both repaired lanes ' +
  'name the day athenaOne is actually showing, the input lane polls within the existing ' +
  'deadline, and the chart-identity verb can no longer answer with silence');
