'use strict';

/* COPILOT PANEL CALM POLISH (b708) - owner: "much better, more pretty" once
 * opened. Verified problems on the live panel at b705: a ~100px hero card
 * permanently re-introducing the panel mid-conversation; a wall of identical
 * chips; a full-paragraph disclaimer competing with the input; the identity
 * strip rendered as a boxed green pill stack; a leftover BLUE shadow under the
 * green user bubble (pre-b680 brand remnant); and the floating dictate chip
 * anchoring over the panel's own input corner - a third mic affordance beside
 * #copilotMicBtn and Copilot Voice.
 *
 * Production only: staging's copilot block is a deliberately isolated older
 * generation (blue brand) and carries no parity pin for this CSS.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const da = fs.readFileSync(path.join(root, 'feat_mls_dictate_anywhere.js'), 'utf8');

/* 1 - the hero collapses once a conversation exists (pure CSS, no new writer:
 * five owners already fight over this surface) */
assert(app.includes('#copilotCard:has(#copilotThread .cmsg) #copilotHero{'),
  'the hero must collapse once a thread exists');
assert(app.includes('#copilotCard:has(#copilotThread .cmsg) #copilotHero .sub{ display:none; }'),
  'the hero blurb must leave when a conversation exists');
assert(app.includes('#copilotCard:has(#copilotThread .cmsg) #copilotOrb{'),
  'the orb must shrink with the collapsed hero');

/* 2 - the user bubble shadow matches the brand it shades */
const bubbleAt = app.indexOf('.cbubble{ max-width:82%');
const bubble = app.slice(bubbleAt, app.indexOf('}', bubbleAt) + 1);
assert(bubble.includes('rgba(32,64,52,.18)'),
  'the user bubble shadow must be green-tinted');
assert(!bubble.includes('rgba(60,90,220'),
  'the pre-b680 blue shadow remnant must stay retired');

/* 3 - chips are quiet offers, not content */
const chipAt = app.indexOf('.copilot-chip{');
const chip = app.slice(chipAt, app.indexOf('}', chipAt) + 1);
assert(chip.includes('background:transparent'),
  'chips must be transparent offers under the thread');
assert(chip.includes('border-radius:999px'),
  'chips use the pill token from the radius scale');

/* 4 - the disclaimer is a footnote */
assert(app.includes('#copilotCard > .note{ font-size:11px'),
  'the disclaimer must read as a footnote, not a paragraph');

/* 5 - the identity strip keeps its content (safety layer) and loses its box */
assert(app.includes('#copilotDockBody .mls-idchip{'),
  'the identity chip override must exist at dock-body specificity');
assert(app.includes('body.theme-dark #copilotDockBody .mls-idchip{'),
  'the identity chip override needs its dark variant');

/* 6 - no third mic affordance floats over the panel input */
assert(/id="copilotInput"[^>]*data-mls-no-dictate|data-mls-no-dictate[^>]*id="copilotInput"/.test(app),
  'the copilot input must opt out of the floating dictate chip - the panel owns #copilotMicBtn');
assert(da.includes('data-mls-no-dictate'),
  'dictate-anywhere must still honor its opt-out attribute');
