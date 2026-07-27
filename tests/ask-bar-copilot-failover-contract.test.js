'use strict';

/* THE ASK BAR MUST NEVER SWALLOW A QUESTION - contract for the 2026-07-26
 * owner report ("typing into it does nothing" and "it overlaps something
 * above it"), reproduced live at the owner's viewport (2320x1287, ~63% zoom):
 *
 *   - typing "bern" with Bernard P Brooks as the ACTIVE patient returned
 *     "Nothing matches" (the bar indexes control labels only), and Enter was
 *     a silent no-op (keydown returned early on empty results);
 *   - #mlsDaChip (dictate-anywhere) anchors at a focused field's top-right,
 *     which for this input is exactly where #mlsAskResults opens - measured
 *     overlapping at (1463,1205) vs the panel at (1208,1148,340x58);
 *   - feat_b18_qa's "Ask MLS Copilot" chip anchors BELOW its input; below a
 *     bottom-fixed dock is past the viewport edge - it rendered clipped and
 *     auto-hid after 8s.
 *
 * Three mechanisms, pinned separately so a regression names its own layer.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');
const b18 = fs.readFileSync(path.join(root, 'feat_b18_qa.js'), 'utf8');
const da = fs.readFileSync(path.join(root, 'feat_mls_dictate_anywhere.js'), 'utf8');

/* 1 - zero-match hands the question to Copilot through the real result
 * plumbing. "copilot: true" makes the handoff a REAL entry in results[], so
 * the existing keydown guard (if(!results.length) return) can never swallow
 * Enter again - the fix works BECAUSE results is non-empty on zero matches. */
assert(shell.includes('Ask MLS Copilot'),
  'ask bar zero-match must offer the Copilot handoff row');
assert(shell.includes('copilot: true'),
  'the handoff must be a real result object so Enter reaches choose()');
assert(shell.includes('copilotChipText'),
  "the handoff must send through the app's own chip path (fill + busy-guard + copilotAsk)");
assert(shell.includes('openCopilotDock'),
  'the handoff must open the Copilot dock, not fill a hidden input');
assert(!shell.includes('Nothing matches "'),
  'the bare "Nothing matches" dead-end must stay retired');

/* 2 - the dictate chip stays off the ask bar, via the dictate module's own
 * documented opt-out. Both sides pinned: the input carries the attribute, and
 * the module still honors it. */
assert(shell.includes('data-mls-no-dictate placeholder="Ask or find anything"'),
  'the ask input must carry data-mls-no-dictate');
assert(da.includes('data-mls-no-dictate'),
  'dictate-anywhere must still honor its opt-out attribute');

/* 3 - the b18 chip never fires on the dock ask ("Ask or find anything"
 * matches its placeholder selector too). */
assert(b18.includes("closest('#mlsDock')"),
  'feat_b18_qa findInput must skip inputs inside #mlsDock');

/* 4 - the placeholder fits its own box: "Ask or find anything" measures 145px
 * at the shell's rendered font + 24px padding = 169px needed; 150px clipped
 * mid-word on the owner's screen. */
assert(shell.includes('#mlsDockAsk{width:172px'),
  'ask input width must fit its own placeholder');
