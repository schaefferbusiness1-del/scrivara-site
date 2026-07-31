'use strict';
/*
 * GLASS IS A VOCABULARY, NOT A DECORATION
 * -----------------------------------------------------------------------------
 * Owner: "maybe add liquid glass designs some places your call."
 *
 * The call, and the reasoning behind it, so the next pass does not have to
 * re-derive it or quietly contradict it.
 *
 * WHERE IT GOES: surfaces that are position:fixed or sticky with content moving
 * underneath them. That is the entire justification for a backdrop-filter - it
 * shows you that something is passing behind. The app has exactly two such
 * surfaces at the edges of the screen:
 *
 *   #mlsDock     - fixed, bottom:18px, glass since the calm shell
 *   #appHeader   - sticky, top:0, 74px, over a page that scrolls to 2700px
 *
 * The dock had it and the header did not, so the app had one glass surface and
 * its opposite number was flat. They now share a recipe: 72% tint, saturate(180%)
 * blur(20px). One vocabulary, both ends.
 *
 * WHERE IT DOES NOT GO, decided by looking at each:
 *
 *   toasts       - .toast.err/.ok/.warn are solid severity fills and the job of
 *                  --red and --gold is to read instantly. Translucency dilutes a
 *                  clinical warning colour. Prettiness is not worth that.
 *   modal cards  - opaque cards over a scrim, carrying clinical text to be read
 *                  and edited, already animating in on open. Glass behind a note
 *                  body costs legibility and buys nothing.
 *   .card        - not sticky. Nothing passes underneath. Glass over a solid
 *                  background is a lighter background with a GPU cost.
 *
 * This suite pins the three properties that make it a vocabulary rather than a
 * scattering: both edge surfaces have it, it is theme-derived rather than a
 * frozen light-mode colour, and it fails safe where the browser cannot do it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const redesign = fs.readFileSync(path.join(root, 'feat_mls_redesign.js'), 'utf8');
const calmShell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- 1. both edge surfaces carry glass ---- */
assert.match(calmShell, /#mlsDock\{[\s\S]{0,400}?backdrop-filter:saturate\(180%\) blur\(20px\)/,
  'the dock lost its glass, so the header is now the only glass surface in the app');
assert.match(redesign, /#appHeader\.mlsRdHdr\{[^}]*backdrop-filter:saturate\(180%\) blur\(20px\)/,
  'the sticky header lost its glass. It is the app\'s only other fixed/sticky edge surface, ' +
  'and content scrolls under it on every visit.');

/* ---- 2. the header tint follows the theme ----
   --header is #FCFBF8 in light and #181E19 in dark (ScribeFlow.html). A frozen
   rgba(255,255,255,...) would paint a white bar across the dark theme. */
assert.match(app, /--header:#FCFBF8/, 'the light-theme header token moved; the glass mix is derived from it');
assert.match(app, /--header:#181E19/, 'the dark-theme header token moved; a frozen tint would now be wrong in dark mode');
assert.match(redesign, /color-mix\(in srgb, var\(--header\) 72%, transparent\)/,
  'the header glass no longer derives its tint from var(--header). A literal rgba freezes the ' +
  'light theme and paints a white bar over the dark one.');

/* ---- 3. it fails safe, in BOTH directions ----
   A translucent header with no blur behind it is not a softer header, it is an
   unreadable one - so the opaque rule must remain, and the glass must be gated
   on the browser actually being able to do both halves. */
assert.match(redesign, /@supports \(backdrop-filter: blur\(1px\)\) and \(background: color-mix\(in srgb, red 50%, transparent\)\)/,
  'the header glass is no longer gated on @supports for BOTH backdrop-filter and color-mix. ' +
  'Without the gate, a browser missing either one renders a translucent header with nothing ' +
  'blurring behind it.');
const opaqueFirst = redesign.indexOf('#appHeader.mlsRdHdr{ background:var(--header) !important;');
const glassAfter = redesign.indexOf('@supports (backdrop-filter: blur(1px))');
assert.ok(opaqueFirst >= 0, 'the opaque header fallback rule is gone');
assert.ok(glassAfter > opaqueFirst,
  'the glass block no longer comes after the opaque rule, so the fallback would win on order ' +
  'and the glass would never apply.');

/* ---- 4. the surfaces that must NOT be glass ---- */
const toastBlock = /\.toast\{[\s\S]*?\n\s*\.toast\.warn\{[^}]*\}/.exec(app);
assert.ok(toastBlock, 'the toast block moved; the no-glass-on-severity rule cannot be checked');
assert.doesNotMatch(toastBlock[0], /backdrop-filter/,
  'a toast grew a backdrop-filter. .toast.err/.ok/.warn are solid severity fills - translucency ' +
  'dilutes a clinical warning colour, which is the one place prettiness must lose.');

console.log('PASS glass is one vocabulary: both fixed/sticky edge surfaces (dock, header) carry ' +
  'saturate(180%) blur(20px); the header tint is mixed from var(--header) so it follows the theme; ' +
  'gated on @supports for backdrop-filter AND color-mix with the opaque rule first; ' +
  'clinical severity toasts stay solid.');
