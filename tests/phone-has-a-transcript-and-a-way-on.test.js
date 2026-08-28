'use strict';

/* PHONE BREAKAGE FIXES B2/B3/B5 (b729, from the 2026-07-27 phone audit -
 * PHONE_AUDIT_2026-07-27.md):
 *  B2 - the phone had NO transcript anywhere: a CSS-hidden lane still claimed
 *       ez3fl-top-owns (mounted != visible) and visit_focus's :has rule
 *       cannot see display:none. Phone now excluded from both claims.
 *  B3 - post-stop dead end: the ph hide list blanket-hid .ez3-row2 (blocking
 *       the visit_focus disclosure that owns those controls) and hid the one
 *       disclosure chip. Row2 left the list; #ez3QuickTools re-shown.
 *  B5 - every mic diagnostic was written into #micWarn inside the permanently
 *       hidden #captureCard. An invisible warn now also toasts. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const vfocus = fs.readFileSync(path.join(root, 'feat_mls_visit_focus.js'), 'utf8');

/* B2 */
assert(connect.includes("var laneVisible = laneMounted && topLaneIsVisible(laneCandidate);"),
  'top ownership must first distinguish a mounted lane from a visible lane');
assert(connect.includes("var wantOwns = !staff && laneVisible && !(document.body && document.body.classList.contains('mls-phone'));"),
  'a mounted-but-CSS-hidden lane must never claim the top on phone (mounted is not visible)');
assert(vfocus.includes(":not(.mls-phone) #visitView #mlsEz3Body:has(.ez3fl-record:not([hidden])"),
  "visit_focus's transcript-card hide must exclude phone - :not([hidden]) cannot see display:none");

/* B3 */
assert(!connect.includes("'body.mls-phone .ez3-row2, body.mls-phone #ez3Adv,',"),
  'the blanket .ez3-row2 phone hide is back - the post-stop dead end returns');
assert(connect.includes("'html body.mls-phone #ez3QuickTools{ display:inline-flex !important; min-height:44px; }',"),
  'the phone must keep ONE disclosure that reaches every folded control');

/* B5 - source + runtime */
/* micv-1.0.0 (2026-08-28): the PROPERTY is unchanged and is still the point -
   an invisible #micWarn must fall through to a visible toast, because a silent
   mic failure looks like a dead button. What changed is the condition beside
   it. The literal pinned here suppressed nothing; a later change added
   `&& !phoneOwns` (body.mls-ph3) so the phone's own persistent banner would not
   be duplicated - a real requirement, but implemented as a PROXY for "the
   doctor can already read this", and the proxy is wrong exactly when the phone
   has not lifted the sentence into its banner. The condition now asks whether
   the message is visible ANYWHERE, which serves both requirements at once.
   Pinning the old spelling would have forced a choice between silence and
   stacking, so this pins the two things that actually matter: the fallback
   exists, and it is NOT gated on merely being a phone. The runtime checks
   below remain the real gate - they exercise both directions. */
assert(/if\(!w\.offsetParent[^)]*\)\{ toast\(msg,'err'\); \}/.test(app),
  'an invisible #micWarn must fall through to a visible toast');
assert(!/!w\.offsetParent&&!phoneOwns/.test(app),
  'the mic fallback must not be suppressed by merely being on a phone - that is how a mic failure goes silent');
/* micv-1.0.0: extract EXACTLY showMicWarn by brace-matching. The old slice ran
   from this function to the RECORD-FIRST HERO marker, which swept in the whole
   DIRECT PHONE CAPTURE block - ~300 lines that call window.addEventListener at
   load. That never mattered because the source assertion above threw first, so
   these runtime checks - the ones that actually prove the behaviour - had never
   executed. They do now. */
const fn = (function () {
  const start = app.indexOf('function showMicWarn(msg){');
  assert(start >= 0, 'showMicWarn disappeared');
  let depth = 0, end = -1;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    const c = app[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  assert(end > start, 'showMicWarn is unbalanced');
  return app.slice(start, end);
})();
const toasts = [];
const warnNode = { style: {}, offsetParent: null, querySelector: function () { return { textContent: '' }; } };
const ctx = { document: { getElementById: function () { return warnNode; } }, toast: function (m) { toasts.push(String(m)); }, console: console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fn, ctx, { filename: 'showMicWarn.js' });
ctx.showMicWarn('Microphone blocked — allow mic access.');
assert(toasts.length === 1 && /Microphone blocked/.test(toasts[0]), 'hidden warn must toast the same message');
warnNode.offsetParent = {};
ctx.showMicWarn('second');
assert(toasts.length === 1, 'a VISIBLE warn must not double-announce as a toast');

/* b730 - B1 dock fit, B4 ghost burger, crowding demotions */
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');
assert(app.includes('html body #mlsDock #mlsDockAskWrap{ display:none; }'),
  'the Ask bar must step out of the dock at phone widths - 393px demanded of a 345px box');
assert(shell.includes("'html body.mls-calm #mlsRdRailBtn{display:none!important}',"),
  'the burger must hide with the rail it opens - a scrim over nothing is a dead control');
assert(connect.includes("'html body.mls-phone #mlsRightNow, html body.mls-phone #mlsStages{ display:none !important; }',"),
  'the right-now bar and stage rail must stand down on the phone');

console.log('PASS phone has a transcript and a way on: top-owns never claims a hidden lane, the :has hide excludes phone, row2 unfolds through the kept disclosure, mic failures are never silent, the dock fits 375px, the ghost burger is gone, and the duplicated chrome stands down');
