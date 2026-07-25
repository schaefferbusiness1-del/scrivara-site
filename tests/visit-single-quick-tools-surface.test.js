'use strict';

/* ONE visible Tools chip on the visit screen, not two.
 *
 * b582 left both quick-tools surfaces rendering at the same time. Measured on
 * the running page at b582, b583 and b584 (375px viewport, single DOM snapshot,
 * visibility judged from each element's own computed style):
 *
 *   laneRow (.ez3fl-record .ez3fl-quick)  visible: true
 *   engineRow (#ez3QuickTools)            visible: true
 *   duplicate visible labels              ["Show tools x2"]
 *   #ez3flToolsToggle  top 1644  left 51  148x44
 *   #ez3QToolsToggle   top 1706  left 51  148x44   <- 62px below its twin
 *
 * b581 measured ZERO duplicate visible labels, so this was a regression, not
 * old debt. With Tools OPEN it is seven duplicate pairs rather than one: both
 * rows carry Copilot Voice, MLS Assistant, Dictate, Paste, Phone, AVS, Orders.
 *
 * The fix is the yield that already existed one line above it for the engine's
 * duplicate TRANSCRIPT card (fl-1.7.0): while the lane owns the top, the
 * engine's surface hides BY CLASS. Never by node removal - the fl-1.5.0 flash
 * note - and never by hiding a toggle, because both toggles must keep existing:
 * tests/loading-states-contract.test.js requires each surface to carry its own
 * single Tools chip sharing one ez3ToolsOpen preference. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* 1. the duplicate surface yields, by class, while the lane owns the top */
assert(connect.includes("'#mlsEz3Body.ez3fl-top-owns #ez3QuickTools{display:none!important}'"),
  'the engine quick-tools row no longer yields to the lane, so the visit screen shows two ' +
  '"Visit shortcuts" chips (#ez3flToolsToggle and #ez3QToolsToggle) at the same time');

/* 2. it yields under the SAME ownership class as the transcript card, so one
      condition governs both and they cannot drift apart */
assert(connect.includes("'#mlsEz3Body.ez3fl-top-owns .ez3-transcript-card{display:none!important}'"),
  'the transcript-card yield disappeared; both engine duplicates must share one ownership class');
assert(/body\.classList\.toggle\('ez3fl-top-owns'/.test(connect),
  'nothing sets ez3fl-top-owns, so neither yield can ever fire');

/* 3. BOTH toggles must still exist - hiding one at the source would satisfy the
      eye and break the shared-fold contract */
assert(connect.includes('qt.id = \'ez3flToolsToggle\''), 'the lane lost its Tools chip');
assert(connect.includes('id="ez3QToolsToggle"'), 'the engine surface lost its Tools chip');

/* 4. the yield must not be an inline style: available() tests only INLINE
      display, so an inline hide silently removes the feature instead of
      leaving it reachable */
const inlineHide = /ez3QuickTools[^\n]{0,120}\.style\.display\s*=\s*['"]none['"]/;
assert(!inlineHide.test(connect),
  'the engine quick-tools row is hidden inline; hide by CSS class so the controls stay reachable');

/* 5. and it must hide the SURFACE, not the individual controls - otherwise the
      seven engine chips become unreachable ids rather than a yielded duplicate */
assert(!/'#mlsEz3Body\.ez3fl-top-owns #ez3QToolsToggle\{display:none/.test(connect),
  'hiding the engine TOGGLE alone leaves its seven chips reachable with no way to fold them');

console.log('PASS visit quick tools: one visible Tools surface while the lane owns the top, both toggles intact, class-hide not inline');
