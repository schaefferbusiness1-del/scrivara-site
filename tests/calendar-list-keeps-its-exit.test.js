'use strict';

/* THE CALENDAR LIST PANEL OWNS ITS OWN EXIT - owner report 2026-07-26
 * ("once you go into it, there's no way to get back out"), reproduced live at
 * b705: "All in range" grew #cpPanel to ~30,000px, pushing the month grid and
 * every exit off screen; "Hide more calendar tools" then collapsed #cpRow -
 * hiding "Clear" AND killing the shell's "Back to the calendar" proxy (which
 * requires a VISIBLE Clear) - leaving a full-viewport list with zero exits.
 *
 * Contract: the panel is height-bounded with its own scrollbar, and EVERY
 * panel view (range list, Monday/Thursday procedures, pull plan) prepends a
 * sticky exit bar whose button routes through the same leaveView() as Clear.
 * The panel must never depend on another container for its way out.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const calpro = fs.readFileSync(path.join(root, 'feat_mls_calpro.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* bounded panel: the trap was the panel growing the PAGE, not scrolling itself */
assert(/cpPanel[\s\S]{0,700}max-height:70vh;overflow:auto/.test(calpro),
  '#cpPanel must be height-bounded with its own scrollbar');

/* one shared exit path */
assert(calpro.includes('function leaveView()'),
  'the exit must be a single named routine');
assert(calpro.includes("el('cpClear').onclick = leaveView"),
  'Clear must route through the same exit');
assert(calpro.includes("id=\"cpPanelBack\""),
  'the panel must carry its own Back control');
assert(calpro.includes('position:sticky'),
  'the exit bar must be sticky so it survives any scroll depth');

/* both renderers prepend it - the pull plan repaints per task, so the bar and
 * its wiring must ride EVERY innerHTML rebuild */
const rebuilds = calpro.split('exitBar(').length - 1;
assert(rebuilds >= 3,
  'exitBar must be defined once and used by BOTH the list panel and the pull panel (found ' + (rebuilds - 1) + ' uses)');
assert(calpro.split('wireExit()').length - 1 >= 3,
  'wireExit must run after both innerHTML rebuilds');

/* the fix must actually reach a browser: frozen loader token bumped */
assert(connect.includes('feat_mls_calpro.js?v=20260726cal15'),
  'calpro loader token must be the bumped 20260726cal15');
assert(!connect.includes('feat_mls_calpro.js?v=20260722cal14b'),
  'the retired calpro cache token must be unreachable');
