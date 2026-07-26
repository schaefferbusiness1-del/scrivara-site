'use strict';

/* An entrance animation must never be able to leave a surface invisible, and
 * the vocabulary it speaks must exist before the module that uses it.
 *
 * TWO defects, both of which this repo has already paid for once.
 *
 * 1. THE VOCABULARY WAS CONDITIONAL. The motion system (four durations, three
 *    easings) was declared at :root inside feat_mls_calm_shell.js. That module
 *    loads late and does not load at all under ?ui=classic, so every rule
 *    written as `transition:transform var(--mls-dur-2)` silently degrades to
 *    the initial value the moment the shell is not there — the motion does not
 *    look wrong, it just stops, everywhere, with nothing in the console. Now
 *    the seven names are declared in the page's own :root, unconditionally,
 *    before the first module runs. The shell still declares them too, so this
 *    suite pins that THE TWO AGREE: whichever loads later wins and a fork is
 *    silent. That is the same hazard tests/secondary-text-is-a-theme-token
 *    guards for --muted, one level up.
 *
 * 2. AN ENTRANCE CAN STRAND. `animation: x 300ms both` applies the FROM
 *    keyframe before the animation starts. If the from-state is opacity:0 —
 *    which every entrance's is — the surface is INVISIBLE for as long as the
 *    animation has not run. Sessions in this repo have already measured entry
 *    animations frozen at currentTime:0 (memory:
 *    layout-is-measurable-resize-then-finish), and a stuck entrance is the
 *    worst possible outcome: not an ugly transition, an absent UI, with a
 *    green suite and nothing thrown.
 *
 *    The rule this file enforces: an animation whose keyframes start from
 *    opacity:0 may NOT carry a `both` or `backwards` fill. With no fill the
 *    resting state is the element's own — the visible one — so "the animation
 *    never ran" and "the animation finished" look identical.
 *
 * What this suite deliberately does NOT do: require a view-entrance animation.
 * feat_mls_calm_shell.js records why (b653) — showView writes only
 * .style.display so the rule could never match, AND ScribeFlow.html:10440
 * records the owner's reverted decision that "whole-view fades made every
 * navigation feel like a screen-level pop". Re-adding one would be re-shipping
 * a rejected design.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const TOKENS = ['--mls-dur-1', '--mls-dur-2', '--mls-dur-3', '--mls-dur-4',
  '--mls-ease-out', '--mls-ease-inout', '--mls-ease-spring'];

/* ---- 1. the vocabulary is page-level, in both shells ---- */
const pages = ['ScribeFlow.html', 'ScribeFlow-staging.html'];
const pageValues = {};
for (const page of pages) {
  const src = read(page);
  const rootBlock = /:root\{[\s\S]*?\n  \}/.exec(src);
  assert.ok(rootBlock, page + ': could not isolate the :root token block');
  const vals = {};
  for (const t of TOKENS) {
    const m = new RegExp(t.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);').exec(rootBlock[0]);
    assert.ok(m, page + ': motion token ' + t + ' is not declared in the page\'s own :root. ' +
      'Declared only in feat_mls_calm_shell.js it does not exist under ?ui=classic, ' +
      'and every rule that references it stops animating with no error.');
    vals[t] = m[1].trim();
  }
  pageValues[page] = vals;
}

/* ---- 2. the shell's copy agrees, value for value ---- */
const shell = read('feat_mls_calm_shell.js');
for (const t of TOKENS) {
  const m = new RegExp(t.replace(/-/g, '\\-') + '\\s*:\\s*([^;\'}]+)').exec(shell);
  assert.ok(m, 'feat_mls_calm_shell.js no longer declares ' + t +
    ' — if the shell copy is being retired, retire all seven together');
  assert.strictEqual(m[1].trim(), pageValues['ScribeFlow.html'][t],
    'the motion token ' + t + ' has FORKED: the page says ' +
    pageValues['ScribeFlow.html'][t] + ', feat_mls_calm_shell.js says ' + m[1].trim() +
    '.\nWhichever stylesheet loads later wins, so the app would animate at one ' +
    'speed with the shell and another without it, and nothing would report it.');
}

/* ---- 2b. the legacy four are ALIASES, never literals again ----
 * --mls-fast/base/slow/spring predate the token system and 23 rules still use
 * them. They were a SECOND vocabulary until they were pointed at the canonical
 * tokens; re-pinning a literal here re-forks the app's timing with nothing to
 * show for it, and the only visible symptom would be that two surfaces move at
 * slightly different speeds. The old numbers are allowed only as the var()
 * FALLBACK, which is what makes the aliasing safe. */
[['--mls-spring', '--mls-ease-out'], ['--mls-fast', '--mls-dur-2'],
 ['--mls-base', '--mls-dur-3'], ['--mls-slow', '--mls-dur-4']].forEach(([legacy, canon]) => {
  const m = new RegExp(legacy.replace(/-/g, '\\-') + "\\s*:\\s*([^;'}]+)").exec(shell);
  assert.ok(m, 'feat_mls_calm_shell.js no longer declares ' + legacy +
    ' — 23 rules in that file still reference it');
  assert.ok(m[1].includes('var(' + canon),
    legacy + ' is a literal again (' + m[1].trim() + '). It must alias ' + canon +
    ', with the old number only as the var() fallback, or the app has two ' +
    'vocabularies and nothing reports it.');
});

/* ---- 3. no entrance may strand a surface invisible ---- */
/* Collect every @keyframes whose 0%/from sets opacity:0, then check that no
 * `animation:` shorthand naming one of them carries a backwards-applying fill. */
function stranding(src, label) {
  const fadeIn = new Set();
  const kf = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{([\s\S]*?)\}\s*(?:'|\}|\n)/g;
  let m;
  while ((m = kf.exec(src))) {
    const head = /(?:from|0%)\s*\{([^}]*)\}/.exec(m[2]);
    if (head && /opacity\s*:\s*0(?!\.[1-9])/.test(head[1])) fadeIn.add(m[1]);
  }
  const bad = [];
  const use = /animation\s*:\s*([^;'"}]+)/g;
  while ((m = use.exec(src))) {
    const decl = m[1];
    const named = [...fadeIn].find((n) => new RegExp('\\b' + n + '\\b').test(decl));
    if (!named) continue;
    if (/\b(both|backwards)\b/.test(decl)) bad.push(label + ': ' + decl.trim().slice(0, 110));
  }
  return { fadeIn, bad };
}

/* EVERY SHIPPED ASSET, not three files.
 *
 * The three-file scan set was this suite's blind spot and it cost a real
 * defect: feat_mls_visit_voice_one.js shipped
 *   @keyframes mlsVoIn{from{opacity:0;...}}  ...  animation:mlsVoIn .18s ... both
 * — the exact regression this file exists to prevent — and the gate was green
 * the whole time, because that file was not in the list. A named list of files
 * is a promise that nobody will ever add motion anywhere else, and this repo
 * has ~230 feature modules that each inject their own stylesheet.
 *
 * So the haystack is now derived, not enumerated: every shipped .js and .html
 * at the repo root that contains an @keyframes. Retired dev-zone pages (_dz_*),
 * the unpublished test shell and the tests themselves are excluded, and the
 * count is asserted to be well above three so a future refactor cannot quietly
 * shrink it back. */
const SKIP = /^(_dz_|_ps_|_compare|ScribeFlow_test|node_modules)/;
const checked = fs.readdirSync(ROOT)
  .filter((f) => /.(js|html)$/.test(f) && !SKIP.test(f))
  .map((f) => [f, read(f)])
  .filter(([, src]) => /@keyframes/.test(src));
assert.ok(checked.length >= 12,
  'only ' + checked.length + ' shipped assets declare @keyframes. That is far fewer ' +
  'than the ~30 this app ships, so the file discovery is broken, not the code — ' +
  'and a broken haystack passes everything.');
let totalFadeIn = 0;
const allBad = [];
for (const [label, src] of checked) {
  const r = stranding(src, label);
  totalFadeIn += r.fadeIn.size;
  allBad.push(...r.bad);
}
assert.ok(totalFadeIn >= 10,
  'the detector found only ' + totalFadeIn + ' fade-in keyframes across ' + checked.length +
  ' assets — it is broken, not the code, and it would pass whatever anyone shipped');
assert.deepStrictEqual(allBad, [],
  'an entrance animation applies its opacity:0 keyframe BEFORE it runs:\n  ' +
  allBad.join('\n  ') +
  '\nDrop the fill. The to-state is already the element\'s resting state, so the ' +
  'fill buys nothing, and with it a surface that never gets to animate — an ' +
  'occluded tab, a cancelled animation, a currentTime:0 freeze — is invisible.');

/* ---- 4. the entrance that exists is compositor-only and switchable off ---- */
const app = read('ScribeFlow.html');
const modalBlock = /@keyframes mlsMoModalIn[\s\S]*?prefers-reduced-motion: reduce\)\{[\s\S]*?\n  \}/.exec(app);
assert.ok(modalBlock, 'the modal entrance block is gone from ScribeFlow.html');
const transitions = modalBlock[0].match(/(?:transition|animation)[^;}]*/g) || [];
transitions.forEach((d) => {
  assert.ok(!/\b(width|height|top|left|right|bottom|margin|padding|font-size)\b/.test(d),
    'the modal entrance animates a layout-triggering property: ' + d.slice(0, 90) +
    '\nOnly transform and opacity may animate — boot TBT here is already dominated ' +
    'by forced layout.');
});
assert.ok(/animation:none!important/.test(modalBlock[0]) && /transition:none!important/.test(modalBlock[0]),
  'the modal/toast reduced-motion block must clear BOTH animation and transition. ' +
  'The toast is animated by feat_mls_redesign.js at higher specificity, so a ' +
  'non-important clear there would not reach it.');

/* ---- 5. the detectors can fail, proved both directions ---- */
{
  const stranded = "@keyframes zz{from{opacity:0}to{opacity:1}}\n#x{animation:zz 300ms both}";
  assert.strictEqual(stranding(stranded, 't').bad.length, 1,
    'the stranding detector does not catch `animation:zz 300ms both` on a fade-in — ' +
    'it would pass the exact regression it exists for');
  const safe = "@keyframes zz{from{opacity:0}to{opacity:1}}\n#x{animation:zz 300ms ease}";
  assert.strictEqual(stranding(safe, 't').bad.length, 0,
    'the stranding detector fires on a correctly-written entrance — a false alarm ' +
    'trains the next person to delete the test rather than read it');
  const opaqueStart = "@keyframes zz{from{opacity:.4}to{opacity:1}}\n#x{animation:zz 300ms both}";
  assert.strictEqual(stranding(opaqueStart, 't').bad.length, 0,
    'the detector treats a partly-visible from-state as stranding; only opacity:0 ' +
    'can make a surface disappear');
}

console.log('PASS motion-tokens-are-page-level-and-cannot-strand: 7 tokens declared in ' +
  pages.length + ' page(s) and agreeing with the shell copy, ' + totalFadeIn +
  ' fade-in keyframes across ' + checked.length + ' shipped assets carry no backwards ' +
  'fill, modal entrance is transform/opacity only and clears under prefers-reduced-motion');
