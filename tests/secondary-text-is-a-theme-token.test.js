'use strict';
/* Secondary text must be a THEME TOKEN, never a hard-coded grey.
 *
 * Measured on the running app (headless Chrome, ?demo=1, both themes) on
 * 2026-07-26 at b671:
 *
 *     light theme   50 WCAG-AA text failures
 *     dark  theme   91 WCAG-AA text failures
 *
 * Four hard-coded greys accounted for 42 of the 50 light failures:
 *
 *     #A6AEA6  2.18:1   x25   "Live practice metrics...", Analysis tile subs
 *     #8C978F  2.97:1   x6    the patient chart key labels - including "allergies"
 *     #9AA69E  2.42:1   x4    the Visit stage label "Record"
 *
 * The reason they had to become a TOKEN and not merely a darker literal is the
 * whole point of this gate, and it is not obvious: those greys are hard-coded
 * hex inside module CSS, so `body.theme-dark` cannot reach them. In dark mode
 * they sit on the dark background at 7.0-7.8:1, where they are CORRECT.
 * Darkening the literals would have fixed light mode and made dark mode worse.
 * `var(--muted)` resolves per theme, so one change serves both - and the
 * measurement after the fix confirms it: light 50 -> 12, dark 91 -> 91 (no
 * regression).
 *
 * So this test asserts two things, and the second is the one with teeth:
 *
 *   1. the retired greys do not come back as text colours in app modules
 *   2. --muted's LIGHT value actually clears 4.5:1 against every surface the
 *      app paints text on - COMPUTED, not pinned to a literal, so tuning the
 *      palette is allowed and only breaking accessibility is not
 *
 * Negative-tested both directions before being trusted (the b669 rule):
 * re-introducing `color:#A6AEA6` into feat_mls_analysis_exact.js fails arm 1 by
 * name; setting --muted back to #68736B fails arm 2 with the ratio it achieved
 * (4.41:1 on #F4F2EC). Both PASS on the real tree.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

/* ---------- arm 1: the retired greys stay retired ---------- */

/* Each was measured failing AA on the app's own light surfaces. The extension
   popup (popup.html) and the standalone booking page are separate documents
   that do not carry the app palette, so they are not in scope here. */
const RETIRED = {
  '#A6AEA6': '2.18:1 on #FBFAF7 - Analysis tile subtitles and 12 other modules',
  '#9AA69E': '2.42:1 on #FBFAF7 - the Visit stage label',
  '#8C978F': '2.97:1 on #FBFDFF - the patient chart key labels, incl. "allergies"'
};

const appFiles = fs.readdirSync(ROOT)
  .filter(f => (/^feat_.*\.js$/.test(f) || f === 'mls-connect.js' || f === 'ScribeFlow.html'))
  .filter(f => { try { return fs.statSync(path.join(ROOT, f)).isFile(); } catch (e) { return false; } });

assert(appFiles.length > 100, 'app file scan found only ' + appFiles.length + ' files - the glob is wrong, not the tree');

const offences = [];
for (const f of appFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const grey of Object.keys(RETIRED)) {
    const re = new RegExp(grey, 'gi');
    const hits = src.match(re);
    if (!hits) continue;
    // name the lines so the failure is actionable rather than a bare count
    src.split(/\r?\n/).forEach((line, i) => {
      if (new RegExp(grey, 'i').test(line)) offences.push(f + ':' + (i + 1) + '  ' + grey + '  (' + RETIRED[grey] + ')');
    });
  }
}
assert.deepStrictEqual(offences, [],
  'a retired secondary-text grey is back in an app module. It fails WCAG AA in light theme and\n' +
  'cannot be re-skinned by body.theme-dark because it is a literal. Use var(--muted).\n' +
  offences.join('\n'));

/* ---------- arm 2: --muted must actually clear AA where the app paints ---------- */

/* Every opaque surface the app renders secondary text on, measured from the
   running page. If a new surface is introduced that is darker than these, this
   list is what needs extending - deliberately. */
const SURFACES = {
  '#ffffff': 'cards',
  '#FBFAF7': '--bg, the app background',
  '#F4F2EC': '--soft',
  '#EAF3FF': 'the selected-patient row',
  '#F1F4F8': 'the calendar mode segmented control',
  '#FCFBF8': '--field-bg',
  '#FBFDFF': 'the patient chart panel',
  '#F6FBF8': '--soft2'
};

function rgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function lum(c) {
  const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(a, b) {
  const l1 = lum(rgb(a)), l2 = lum(rgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/* --muted's light value is declared in TWO places and they must agree, or the
   later declaration silently wins and the palette forks. */
const DECL = [
  ['ScribeFlow.html', /--muted:\s*(#[0-9a-fA-F]{6})\s*;/],
  ['feat_mls_redesign.js', /--muted:\s*(#[0-9a-fA-F]{6})\s*;/]
];
const found = DECL.map(([f, re]) => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const m = src.match(re);
  assert(m, 'could not find the light --muted declaration in ' + f);
  return { file: f, value: m[1].toUpperCase() };
});
assert.strictEqual(found[0].value, found[1].value,
  'the light --muted token has forked: ' + found.map(x => x.file + '=' + x.value).join(' vs ') +
  '\nBoth declare the app palette; whichever loads later wins, so a fork is a silent theme bug.');

const muted = found[0].value;
const failures = [];
for (const surface of Object.keys(SURFACES)) {
  const c = contrast(muted, surface);
  if (c < 4.5) failures.push('  ' + muted + ' on ' + surface + ' (' + SURFACES[surface] + ') = ' + (Math.round(c * 100) / 100) + ':1, needs 4.5:1');
}
assert.deepStrictEqual(failures, [],
  'the light --muted token no longer meets WCAG AA on a surface the app paints secondary text on:\n' +
  failures.join('\n') +
  '\nThis token carries the secondary text of the whole app, so a near-miss here is a near-miss everywhere.');

const worst = Math.min(...Object.keys(SURFACES).map(s => contrast(muted, s)));
console.log('PASS secondary text is a theme token: 3 retired greys absent from ' + appFiles.length +
  ' app files, light --muted ' + muted + ' agrees across both declarations and clears AA on all ' +
  Object.keys(SURFACES).length + ' app surfaces (worst ' + (Math.round(worst * 100) / 100) + ':1)');
