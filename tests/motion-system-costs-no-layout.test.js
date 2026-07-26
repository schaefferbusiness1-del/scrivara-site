'use strict';

/* Motion may never cost a reflow, and may never touch a surface that rebuilds.
 *
 * The app had motion but no motion SYSTEM. Measured before this change, across
 * mls-connect.js + ScribeFlow.html + the shell:
 *   34 @keyframes, ELEVEN of them pulses and FIVE spinners
 *   14 distinct durations, mixing units (4300ms beside 3.4s)
 *   9 easings, four of them near-identical deceleration curves — and
 *   cubic-bezier(.4,0,.2,1) / cubic-bezier(.4,.0,.2,1), the same curve twice
 *   174 `linear` + 71 `ease`, i.e. the defaults, unconsidered
 *
 * This suite does not police taste. It pins the two properties that make added
 * motion safe on THIS app:
 *
 *   1. transform/opacity only. Anything else triggers layout, and boot's TBT is
 *      already dominated by forced layout on the patients screen.
 *   2. Nothing animates inside a host that is destroyed and rebuilt on a timer,
 *      or that a doctor types into. The transcript host is rebuilt about every
 *      3s and #visitOrdersBody every ~5s with byte-identical markup — an
 *      entrance rule in there is a permanent flicker in front of someone
 *      mid-recording, not a flourish.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_calm_shell.js'), 'utf8');

/* the block exists at all */
assert.ok(
  src.includes('mls-motion-system'),
  'the motion system block is gone from the calm shell'
);

/* ---- 1. one vocabulary ---- */
['--mls-dur-1', '--mls-dur-2', '--mls-dur-3', '--mls-dur-4',
 '--mls-ease-out', '--mls-ease-inout', '--mls-ease-spring'].forEach((tok) => {
  assert.ok(src.includes(tok), 'motion token ' + tok + ' is missing — the point of the ' +
    'system is that new motion stops inventing its own timing');
});

/* new rules must USE the tokens, not hardcode a fresh curve */
/* Capture the whole block, THROUGH the reduced-motion declarations. An earlier
 * version of this regex stopped at the first newline after the media query
 * opened, so it never saw the declarations and failed a correctly-installed
 * system — the guard was wrong, not the code. */
/* The trailing comma is OPTIONAL because the reduced-motion rule is now the
 * LAST element of the CSS array. It used to be followed by
 * '#mlsStages .bar{display:none}}' — and that stray line was the closing brace
 * of @media (max-width:760px), which meant this entire motion block was nested
 * inside the phone query and could not apply on a desktop. The close-brace was
 * moved up to where the phone rules actually end; this anchor moved with it. */
const block = /motion system \(mls-motion-system\)[\s\S]*?transform:none!important\}\}',?/.exec(src);
assert.ok(block, 'could not isolate the motion block — it must end with the ' +
  'reduced-motion rule clearing animation, transition and transform');
const bespoke = block[0].match(/cubic-bezier\([^)]*\)/g) || [];
assert.ok(
  bespoke.length <= 3,
  'the motion block defines ' + bespoke.length + ' raw cubic-beziers. Exactly three ' +
  'are allowed — the three token definitions. Everything else must reference ' +
  'var(--mls-ease-*), or this becomes the tenth easing rather than the fix. Found: ' +
  bespoke.join(' ')
);

/* ---- 2. compositor-only ---- */
const animatedProps = block[0].match(/transition:[^']*/g) || [];
animatedProps.forEach((decl) => {
  assert.ok(
    !/\b(width|height|top|left|right|bottom|margin|padding|font-size)\b/.test(decl),
    'a transition animates a layout-triggering property: ' + decl.slice(0, 90) +
    '\nOnly transform and opacity may animate — boot TBT is already dominated by forced layout.'
  );
});
const keyframeBodies = block[0].match(/@keyframes [^{]*\{[^']*/g) || [];
keyframeBodies.forEach((kf) => {
  assert.ok(
    !/\b(width|height|top:|left:|margin|padding)\b/.test(kf),
    'a keyframe animates a layout-triggering property: ' + kf.slice(0, 90)
  );
});

/* ---- 3. the rebuild hosts are excluded ---- */
['#visitView', '#ez3Wrap', '#visitOrdersBody', '#noteCard'].forEach((host) => {
  assert.ok(
    block[0].includes(host),
    host + ' is not excluded from the motion rules. It is a host that rebuilds on ' +
    'a timer or that a doctor types into; an entrance animation there replays forever.'
  );
});
assert.ok(
  /\.mls-mo-never/.test(block[0]),
  'there must be an explicit opt-out class for anything else that turns out to re-render'
);
assert.ok(
  /animation:none!important/.test(block[0]),
  'the exclusion must win — a rebuild host has to out-specify the entrance rule'
);

/* ---- 4. all of it is switchable off ---- */
assert.ok(
  /@media \(prefers-reduced-motion: reduce\)/.test(block[0]),
  'the motion system must honour prefers-reduced-motion'
);
const reduce = /@media \(prefers-reduced-motion: reduce\)[\s\S]*$/.exec(block[0])[0];
['animation:none!important', 'transition:none!important', 'transform:none!important'].forEach((k) => {
  assert.ok(reduce.includes(k), 'the reduced-motion block must clear ' + k.split(':')[0] +
    ' — motion here is decoration and the UI must work identically without it');
});

/* ---- 5. the guard can fail ---- */
{
  const bad = "'#x{transition:height var(--mls-dur-2) var(--mls-ease-out)}',";
  assert.ok(
    /\b(width|height|top|left|right|bottom|margin|padding|font-size)\b/.test(bad),
    'the layout-property detector does not recognise an animated height — it would pass regardless'
  );
}

console.log('PASS motion-system-costs-no-layout: one vocabulary (4 durations, 3 easings), ' +
  'transform/opacity only, rebuild hosts and typing surfaces excluded, and the whole ' +
  'system switches off under prefers-reduced-motion');
