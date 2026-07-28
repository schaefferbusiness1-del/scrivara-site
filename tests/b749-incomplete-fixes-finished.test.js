'use strict';

/* FOUR b748 FIXES THAT SHIPPED INCOMPLETE (b749).
 *
 * All four were found by adversarially auditing my OWN work for reachability,
 * and every one of them is the same shape: the code was present, correct, and
 * unreachable or unconsumed on the path the owner actually takes. "It is in the
 * diff" is not evidence. These are the assertions whose absence let them ship.
 *
 * 1. THE PULL PILL SHIPPED UNSTYLED. b748 made pill-first the DEFAULT
 *    (hidden = true) but left the module's single css() call on the PANEL path,
 *    BELOW the hidden early-return in render(). So on every first pull after a
 *    page load the FAB was appended with no stylesheet: position:static at the
 *    end of <body> instead of fixed at bottom-left - and since the pill is the
 *    only route to the panel, the panel was unreachable too. Both existing
 *    suites passed because they pin the CSS TEXT as a source literal, which says
 *    nothing about whether the rule ever reaches the page.
 *
 * 2. ONLY ONE OF THE TWO TOAST SURFACES MOVED. #ez3Toast stayed at
 *    bottom:150px - inside the band the owner said blocks the ask bar - because
 *    toast() inside the live ez3 module is a LOCAL function that SHADOWS
 *    window.toast, so moving the app rule missed every workspace message.
 *
 * 3. THE INLINE CHART PROGRESS WAS DESTROYED MID-FLIGHT. A 700ms poll replaces
 *    the whole #ez3VRow node whenever vSig() changes, and vSig flips the moment
 *    the extension identity signal lands - i.e. during the pull. Worst case is a
 *    wrong-chart refusal: no stamp ever lands, so the doctor saw nothing at all
 *    for the full 90 seconds.
 *
 * 4. THE REPAIRED FIELDS HAD NO CONSUMER THAT RESPECTED THEM. 3.0.25 taught the
 *    day driver to declare out.dateUnverified, but the ONE place in the whole
 *    extension that reads out.done/out.schedDate did not check it - so on an
 *    unreadable surface the echo branch still made that guard a tautology, which
 *    is the exact defect 3.0.25 claimed to have removed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');

/* ---- 1. css() must run BEFORE any return in render() ----
   Order is the whole defect, so assert order, not presence. */
{
  const start = connect.indexOf('function render() {', connect.indexOf("var PANEL = 'mlsPullProgPanel'"));
  assert(start > 0, 'the pull-panel render() must still exist');
  const end = connect.indexOf('(function loop()', start);
  assert(end > start, 'render() must still be followed by the loop');
  const render = connect.slice(start, end);

  const cssAt = render.indexOf('css();');
  const hiddenAt = render.indexOf('if (hidden) {');
  assert(cssAt > 0, 'render() must call css()');
  assert(hiddenAt > 0, 'render() must still have the pill (hidden) branch');
  assert(cssAt < hiddenAt,
    'css() is called AFTER the hidden early-return, so the pill ships with no stylesheet: ' +
    'position:static at the end of <body> instead of fixed at bottom-left. The pill is the ' +
    'DEFAULT and the only route to the panel, so this breaks the pull surface entirely.');

  /* css() is called every render tick now, so it must stay self-guarding */
  assert(connect.includes("if (document.getElementById('mlsPullProgCss')) return;"),
    'css() must return early when its style element already exists - render() calls it on ' +
    'every tick and re-injecting a stylesheet ~1/s would be a real cost');
}

/* ---- 2. the LIVE ez3 workspace toast is top-anchored ----
   The rule exists 5x: the live module plus four hard-dead duplicates. Only the
   copy inside the module declaring VER = '3.7.3' ships, so scope the assertion
   there instead of counting occurrences. */
{
  const live = connect.indexOf("var VER = '3.7.3'");
  assert(live > 0, "the live ez3 module marker (VER = '3.7.3') must still exist");
  const liveToast = connect.indexOf("'#ez3Toast{position:fixed", live);
  assert(liveToast > 0, 'the live module must still style #ez3Toast');
  const rule = connect.slice(liveToast, liveToast + 200);
  assert(/top:var\(--mls-notice-top,96px\)/.test(rule),
    'the workspace toast must use the SAME measured top anchor as the app toast - it was ' +
    'left at bottom:150px, inside the band the owner said blocks the ask bar');
  assert(/bottom:auto/.test(rule),
    'the old bottom offset must be explicitly cleared or it still wins');
  assert(!/bottom:150px/.test(rule),
    'the live workspace toast must not keep the bottom:150px placement');
}

/* ---- 3. the chart-pull progress survives a row rebuild, and only while in flight ---- */
{
  assert(/var chartStatusPending = null;/.test(connect),
    'the pending chart status must be remembered so a row rebuild can restore it');
  assert(/chartStatusPending = msg \? \{ msg: msg, cls: cls \|\| "dim" \} : null;/.test(connect),
    'chartRowStatus must record what it painted');
  assert(/function restoreChartRowStatus\(\)/.test(connect),
    'there must be a restorer for the post-rebuild repaint');
  /* the restore has to happen at the replacement site itself */
  const swap = connect.match(/if \(row\) \{ var tmp = document\.createElement\('div'\); tmp\.innerHTML = vRowHtml\(\);[^\n]*/);
  assert(swap, 'the vSig row-replacement site must still exist');
  assert(/safe\(restoreChartRowStatus\)/.test(swap[0]),
    'the row replacement destroys the progress chip, so it MUST re-apply the pending status ' +
    'immediately after replaceChild - otherwise the doctor watches the progress line vanish');
  /* and it must not outlive the watch, or a finished message masks real state forever */
  const clears = connect.split('chartStatusPending = null;').length - 1;
  assert(clears >= 3,
    'the pending status must be released at BOTH terminal exits (success and the 90s ' +
    'timeout) as well as on an empty paint - otherwise a finished message is resurrected ' +
    'by every later rebuild and "Patient verified in Athena" can never appear again. ' +
    'Found ' + clears + ' release sites.');
}

/* ---- 4. the one consumer of the repaired fields respects dateUnverified ---- */
{
  const guard = bg.match(/return value\.done === true[^;]*;/);
  assert(guard, 'the post-recovery re-ground guard must still exist');
  assert(/dateUnverified !== true/.test(guard[0]),
    'the ONLY consumer of out.done/out.schedDate in the extension is this re-ground guard. ' +
    'Without a dateUnverified check, the declared-unverified echo branch makes it compare ' +
    'target to target - the exact tautology 3.0.25 claimed to remove - and an appointment ' +
    'gets opened on a date nobody confirmed. Guard: ' + guard[0]);
  /* and the flag must actually be produced, or the check is decoration */
  assert(/out\.dateUnverified = true;/.test(bg),
    'the day driver must still set dateUnverified on the unreadable-surface branch');
}

console.log('PASS b749 finished four incomplete b748 fixes: css() runs before the pill early-return ' +
  '(and stays self-guarding), the LIVE workspace toast shares the measured top anchor, the inline ' +
  'chart progress survives the 700ms row rebuild but not the end of its own watch, and the single ' +
  'consumer of the repaired day fields now refuses a date it was told was unverified');
