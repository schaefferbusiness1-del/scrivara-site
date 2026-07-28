'use strict';

/* THE PHONE DOCK MUST FIT THE NARROWEST PHONE, AND TOUCH TARGETS MUST BE REACHABLE (b757).
 *
 * MEASURED at real viewports, not inferred. The seven dock items are min-width:44px and
 * do not shrink, so the last one lands at the same absolute x whatever the viewport:
 *
 *     vw 320   last item right 347   overflow +27
 *     vw 347   last item right 347   overflow   0   <- the exact boundary
 *     vw 360   last item right 347   overflow -13   <- a 360px Android has SPARE room
 *
 * 8(inset) + 1(border) + 6(padding) + 7*44 + 6*4 = 347. So #mlsDockCopilot hung 27px off
 * a 320px screen and Copilot was partly unreachable.
 *
 * WHY THE BREAKPOINT IS 346 AND NOT 365. The rule sets gap:0, which makes the 44px buttons
 * touch and can collide the 10.5px "AI Studio"/"Copilot" labels. The failure zone is
 * vw <= 346. Firing at 365px would impose that collision on the commonest Android width to
 * cure an overflow it does not have. The breakpoint is exactly as wide as the defect.
 *
 * THE TAP TARGETS were each identified by measuring the LIVE node, not by guessing a
 * selector. An earlier diagnosis asserted the 17x44 close control was `button.modal-x`;
 * evaluating `e.matches('button.modal-x')` on the real element returned FALSE, so that
 * rule would have fixed neither close button. What the live DOM actually showed:
 *     #mlsPqsInput               40x38   input, inside #mlsRdSearchSlot (chain verified)
 *     #mlsDrSnooze               41x44   "x", no class, in #mlsDrBanner
 *     #mlsRlPhoneIntro > button  17x44   "x", no class, no id
 *     .mainnav .navtab          211x38   the PRIMARY phone navigation, five rows,
 *                                        role="button", every prior audit missed it
 *
 * WHAT THIS SUITE PROTECTS, and it is mostly the SAFETY properties rather than the values:
 *   1. every rule stays inside a max-width media block, so desktop can never see them
 *   2. the tap-target rules raise min-* ONLY - never width/height - because that is what
 *      keeps feat_mls_redesign.js:1131 working, where the focused search goes
 *      position:fixed at calc(100vw - 20px). Used width is max(min-width, width), so a
 *      min-width floor cannot defeat it but a width override would.
 *   3. the dock rule never touches bottom/z-index/transform/position, so the fixed-position
 *      stacking context is the one that shipped - a previous fix in this area set both top
 *      and bottom on a fixed element and produced an 87x1085 column regression.
 *
 * ScribeFlow-staging.html is deliberately NOT covered: it is not a published surface
 * (HTTP 404, absent from pages-publication-inventory.json) and has never carried any of
 * the ph-* phone hardening - zero occurrences of ph-zoom, ph-tap, ph-safe or ph-dock-fit.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- helper: is a given index inside a max-width media block? ------------- */
function enclosingMaxWidth(src, idx) {
  /* walk backwards to the nearest @media and check we are still inside it */
  const before = src.slice(0, idx);
  const at = before.lastIndexOf('@media');
  if (at < 0) return null;
  const head = src.slice(at, src.indexOf('{', at) + 1);
  const m = head.match(/max-width\s*:\s*(\d+)px/);
  if (!m) return null;
  /* confirm the block has not closed before idx: count braces from the media open */
  let depth = 0;
  for (let i = src.indexOf('{', at); i < idx; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    if (depth === 0 && i > src.indexOf('{', at)) return null; /* block closed early */
  }
  return Number(m[1]);
}

/* ---- 1. the dock fit ------------------------------------------------------ */
{
  assert(app.includes('ph-dock-fit-1.0.0'), 'the ph-dock-fit block must be present');

  const RULE = 'html body #mlsDock{ left:2px; right:2px; padding:6px 0; gap:0; }';
  assert.strictEqual(app.split(RULE).length - 1, 1,
    'the dock-fit rule must appear exactly once, byte-for-byte as gated');

  const idx = app.indexOf(RULE);
  const bp = enclosingMaxWidth(app, idx);
  assert.strictEqual(bp, 346,
    'the dock-fit rule must sit inside @media (max-width:346px) - MEASURED: overflow is 0 at ' +
    'vw 347 and -13 at vw 360, so a wider breakpoint would collapse the gap on phones that ' +
    'do not overflow. Got: ' + bp);

  assert(!/max-width\s*:\s*365px/.test(app),
    'the superseded 365px breakpoint must not survive anywhere');

  /* the stacking context must be untouched - this is the 87x1085 column lesson */
  ['bottom:', 'z-index', 'transform', 'position:'].forEach(function (prop) {
    assert(RULE.indexOf(prop) === -1,
      'the dock-fit rule must not declare ' + prop + ' - changing the fixed-position ' +
      'stacking context here previously produced an 87x1085 column regression');
  });
}

/* ---- 2. the tap targets --------------------------------------------------- */
{
  const TARGETS = [
    ['html body input#mlsPqsInput{ min-width:44px !important; min-height:44px !important; }', 'mlsPqsInput 40x38'],
    ['html body #mlsDrSnooze{ min-width:44px; }', 'mlsDrSnooze 41x44'],
    ['html body #mlsRlPhoneIntro button{ min-width:44px; }', 'mlsRlPhoneIntro close 17x44'],
    ['html body .mainnav .navtab{ min-height:44px; }', 'the primary phone nav, 211x38'],
  ];

  TARGETS.forEach(function (pair) {
    const rule = pair[0], why = pair[1];
    assert.strictEqual(app.split(rule).length - 1, 1,
      'missing or duplicated tap-target rule for ' + why + ': ' + rule);
    const bp = enclosingMaxWidth(app, app.indexOf(rule));
    assert(bp !== null && bp <= 760,
      'the rule for ' + why + ' must live inside a max-width<=760px media block so the ' +
      'desktop layout can never see it. Got breakpoint: ' + bp);
  });

  /* min-* ONLY. A width/height override on the search field would defeat the focused
     position:fixed calc(100vw - 20px) rule, because used width is max(min-width, width). */
  const searchRule = TARGETS[0][0];
  assert(!/(^|[^-])\bwidth\s*:/.test(searchRule.replace(/min-width\s*:/g, 'min_width:')),
    'the search-field rule must raise min-width only, never width - a width override would ' +
    'defeat feat_mls_redesign.js:1131 where the focused field goes fixed at calc(100vw - 20px)');
  assert(!/(^|[^-])\bheight\s*:/.test(searchRule.replace(/min-height\s*:/g, 'min_height:')),
    'the search-field rule must raise min-height only, never height');

  /* the navtab rule must not raise WIDTH: these rows are full-width already and a width
     floor would push the phone menu sideways */
  assert(TARGETS[3][0].indexOf('min-width') === -1,
    'the navtab rule must set min-height only - a min-width floor would widen the phone menu');
}

/* ---- 3. the iOS-zoom gap -------------------------------------------------- */
{
  assert(app.includes('ph-zoom-1.0.1'), 'the ph-zoom-1.0.1 date-family block must be present');

  /* the pre-existing blanket must survive byte-for-byte: suites pin it as a substring */
  assert(app.includes('html body [contenteditable="true"]{ font-size:16px !important; }'),
    'the original ph-zoom blanket must be left intact - only NEW selectors were added');

  ['input[type="time"]', 'input[type="month"]', 'input[type="datetime-local"]', 'input[type="week"]']
    .forEach(function (sel) {
      assert(app.indexOf('html body ' + sel) >= 0,
        'the date-family selector ' + sel + ' must be named - iOS Safari zooms any focusable ' +
        'text field under 16px and the date pickers are text fields carrying inline 13px');
    });

  const idx = app.indexOf('ph-zoom-1.0.1');
  const bp = enclosingMaxWidth(app, idx);
  assert(bp !== null && bp <= 760,
    'the date-family zoom rule must be phone-scoped. Got: ' + bp);
}

/* ---- 4. the honest-scope note --------------------------------------------- */
{
  const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
  assert.strictEqual(staging.indexOf('ph-dock-fit'), -1,
    'ScribeFlow-staging.html must NOT carry the phone blocks: it is not a published surface ' +
    '(404, absent from pages-publication-inventory.json) and has never had phone hardening. ' +
    'If that ever changes, this assertion is the reminder that .navtab and .modal-x exist ' +
    'there too and would need the same treatment.');
}

console.log('PASS the phone dock fits and touch targets reach 44px: the dock-fit rule is scoped to ' +
  'the MEASURED failure zone (max-width:346px - overflow is 0 at vw 347 and -13 at vw 360) and ' +
  'leaves the fixed-position stacking context alone; four tap targets identified from the live ' +
  'DOM rather than guessed selectors are raised with min-* only so the focused-search rule still ' +
  'wins; the date-family iOS-zoom gap is closed with the original blanket intact; and every rule ' +
  'is confined to a max-width media block so desktop cannot see any of it');
