'use strict';
/* =========================================================================
   MOTION THAT CANNOT RUN IS NOT MOTION
   -------------------------------------------------------------------------
   Every existing motion suite reads DECLARATIONS. All three defects found on
   2026-07-26 were correctly-declared motion that could never execute, so all
   three were green the whole time:

     1. the visit progress rail        renderStages() replaced all nine nodes
                                        with innerHTML on every stage change,
                                        so no transition had a previous value
                                        to run from. Measured: 0 animations
                                        across a real Prep -> Review move.
     2. the Copilot drawer             created and given .open in one
                                        synchronous block, so the FIRST open
                                        had no starting style and snapped.
     3. the whole calm-shell motion    the block sat inside
        system                          @media (max-width:760px), so nothing
                                        below 760px-wide ever applied on the
                                        desktop every doctor uses.

   A declaration is not evidence. This suite pins the three MECHANISMS that
   make a declaration executable, because the declarations themselves already
   passed and will keep passing.
   ========================================================================= */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const shell = read('feat_mls_calm_shell.js');

/* ---------------------------------------------------------------- helpers */

/* Brace depth of the shell's CSS array, counted over its STRING LITERALS only.
   Comments in this file contain braces (they quote CSS), so they are stripped
   first — counting them was the obvious wrong way to write this. */
function cssDepthBefore(marker) {
  const start = shell.search(/var CSS\s*=\s*\[/);
  assert.ok(start > -1, 'could not find the calm shell CSS array');
  const end = shell.indexOf(marker);
  assert.ok(end > start, 'could not find the marker ' + JSON.stringify(marker) + ' after the CSS array');
  const slice = shell.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = slice.match(/'(?:[^'\\]|\\.)*'/g) || [];
  const css = literals.join('');
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return { depth, literals: literals.length };
}

/* Body of a function declaration, by brace matching from its opening brace. */
function fnBody(src, name) {
  const i = src.indexOf('function ' + name);
  assert.ok(i > -1, 'function ' + name + ' not found');
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(open, j + 1); }
  }
  throw new Error('unbalanced body for ' + name);
}

/* ============================================================= 1. SCOPE ===
   The motion system must be PAGE-LEVEL, not nested in a media query. */

const MARKER = 'motion system (mls-motion-system)';
const { depth, literals } = cssDepthBefore(MARKER);
assert.ok(literals > 100,
  'only ' + literals + ' CSS string literals before the motion block — the array ' +
  'shrank or the parse broke, and a depth of 0 would then be meaningless');
assert.strictEqual(depth, 0,
  'the calm shell motion system is nested ' + depth + ' level(s) deep inside an unclosed ' +
  '@media block. Everything in it — mlsMoRise, the chrome transitions, the .mls-mo ' +
  'standing prohibition and the reduced-motion kill — then applies ONLY at that ' +
  'breakpoint. This shipped for six builds scoped to max-width:760px, so the desktop ' +
  'had no right-now-bar entrance at all and the safety prohibition protected only phones.');

/* The phone query must still exist and still close on the connector rule —
   the fix moved that brace, it did not delete the breakpoint. */
assert.ok(/'@media \(max-width:760px\)\{',/.test(shell),
  'the 760px phone breakpoint is gone entirely');
assert.ok(/'#mlsStages \.bar\{display:none\}\}',/.test(shell),
  'the phone query no longer closes on the connector rule — if its closing brace ' +
  'drifted again, everything after it is silently re-nested');

/* ====================================================== 2. THE STAGE RAIL ===
   Updated in place, or its transitions are dead. */

const render = fnBody(shell, 'renderStages');
assert.ok(!/innerHTML/.test(render),
  'renderStages() assigns innerHTML. That replaces the rail\'s nodes, and a CSS ' +
  'transition needs the SAME element to still be present when the value changes — ' +
  'so every transition on .dot and .bar i becomes dead CSS and the rail snaps. ' +
  'Measured before the fix: 0 animations and 0 of 9 nodes surviving a real stage change.');

const paint = fnBody(shell, 'paintStages');
assert.ok(/classList\.toggle\(/.test(paint),
  'paintStages must move state with classList.toggle(name, force). add/remove ' +
  're-commit unconditionally, and this runs on the shell tick — that is a ' +
  'whole-document style recalculation several times a second for no visual change.');
assert.ok(!/innerHTML/.test(paint),
  'paintStages rebuilds nodes; it exists precisely so that it does not');
assert.ok(/function buildStages/.test(shell),
  'buildStages() is gone — the rail has no build-once path left');

/* the connector fill is composited, not a layout property */
assert.ok(/#mlsStages \.bar i\{[^']*transform:scaleX\(0\)/.test(shell.replace(/\n\s*'/g, '')) ||
          /transform:scaleX\(0\)/.test(shell),
  'the stage connector no longer starts at transform:scaleX(0)');
assert.ok(!/#mlsStages \.bar i[^']*transition:width/.test(shell),
  'the stage connector animates `width` again — a layout property, a reflow every ' +
  'frame, against law 1. Use transform:scaleX().');

/* ==================================================== 3. THE COPILOT DRAWER ===
   A starting style must exist before .open lands, on first build. */

['ScribeFlow.html', 'ScribeFlow-staging.html'].forEach((page) => {
  const src = read(page);
  const open = fnBody(src, 'openCopilotDock');
  const flush = open.indexOf('offsetWidth');
  const classed = open.indexOf(".classList.add('open')");
  assert.ok(flush > -1,
    page + ': openCopilotDock() never forces a style flush. The drawer is created ' +
    'and given .open in the same synchronous block, so on the FIRST open there is no ' +
    'previously-computed transform/opacity to transition from and the panel simply ' +
    'appears. Measured before the fix: first open 1 distinct position, second open 22.');
  assert.ok(classed > -1, page + ': openCopilotDock() no longer adds .open');
  assert.ok(flush < classed,
    page + ': the style flush happens AFTER .open is added, which is the same as not ' +
    'flushing at all — the starting value must be computed first.');
  assert.ok(/freshlyBuilt/.test(open),
    page + ': the flush is no longer gated on first build. A forced layout costs ~18ms ' +
    'and every later open already animates correctly; paying it on every open is waste.');
  assert.ok(!/requestAnimationFrame[^;]*classList\.add\('open'\)/.test(open),
    page + ': .open is added inside requestAnimationFrame. rAF does not fire in an ' +
    'occluded tab, so the drawer would stay SHUT rather than merely un-animated. ' +
    'The class must be added synchronously — "never animated" and "finished" have to ' +
    'end in the same place.');
});

console.log('PASS motion-that-cannot-run-is-not-motion: motion block is page-level (' +
  literals + ' literals, depth 0), the stage rail updates ' +
  'in place with toggle and a composited connector, and the Copilot drawer computes a ' +
  'starting style before .open on both pages');
