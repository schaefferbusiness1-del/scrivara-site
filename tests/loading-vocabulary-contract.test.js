'use strict';

/* LOADING VOCABULARY (b735) - one way to look busy.
 * Page-level primitives (theme-var driven, motion-token timed, reduced-motion
 * safe) + the pull panel - the owner's "running icon" surface - speaking the
 * same vocabulary: tokened entrance once per open, dark-theme surfaces. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* 2026-08-02 (standing review #26/#30): the b735 bar/fill/dots primitives
 * never got a single writer — no code anywhere added those classes — so they
 * were dead weight overstating the product and were deleted. This contract
 * now pins only the ADOPTED vocabulary: the shared mlsLoadIn entrance (used
 * by the op-prep room panels and the pull panel below). If a busy-bar is
 * built for real, add its primitives AND their writers together. */
assert(app.includes('@keyframes mlsLoadIn{'), 'the shared entrance is gone');
assert(!app.includes('.mls-load-bar'), 'the writerless load-bar primitives came back without a writer');
assert(app.includes('animation:mlsLoadIn var(--mls-dur-3) var(--mls-ease-out)'),
  'the op-prep room must enter on the shared entrance and motion tokens');

/* the pull panel adopts the vocabulary */
assert(connect.includes("'#' + PANEL + ' .ppc{animation:mlsLoadIn var(--mls-dur-3,300ms) var(--mls-ease-out,ease-out)}'"),
  'the pull panel must enter on the shared tokens');
assert(connect.includes("'@media (prefers-reduced-motion: reduce){#' + PANEL + ' .ppc{animation:none}}'"),
  'the panel entrance must respect reduced motion');
assert(connect.includes("'body.theme-dark #' + PANEL + ' .ppc{background:var(--card,#1C231E)"),
  'the panel must follow dark mode (it hardcoded light colors since b113)');
assert(connect.includes("'body.theme-dark #' + PANEL + ' .pp-track{background:var(--soft,#1F2721)"),
  'the progress track must follow dark mode');

console.log('PASS loading vocabulary: page-level primitives on the motion tokens with reduced-motion silence, and the pull panel enters and themes through the same vocabulary');
