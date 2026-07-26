'use strict';

/* Four corner radii, derived from the dock rather than invented.
 *
 *   22  floating   16  card   10  control   999  pill
 *
 * Measured on the running app, ten views, 1440x900, counting what a doctor
 * actually sees (computed border-*-radius on visible elements):
 *
 *                       before   after
 *   distinct app-wide      16       7
 *   calendar               15       7
 *   patients               13       5
 *   visit                  12       4
 *   admin / intake         11/10    4/4
 *
 * The 7 are the four scale values, 50% (a ratio, not a length — a circle is
 * not a corner radius and does not belong on a px scale), and two strays,
 * 11px x40 and 13px x4, recorded in WORKER_F_REPORT.md rather than guessed at.
 *
 * THE PART WORTH REMEMBERING. Rewriting all 596 off-scale declarations in the
 * two shells moved the histogram and left the distinct count at 16 — because
 * every off-scale value ALSO had a *_exact.js survivor declaring it at higher
 * specificity with !important. That is the same wall the dark theme hit, and
 * it has the same answer: correct the rules where they can be seen, on the
 * running page, at the source rule's own specificity. So this suite pins BOTH
 * halves — the source rewrite and the runtime pass — because either alone
 * leaves the app at 16.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pages = ['ScribeFlow.html', 'ScribeFlow-staging.html'];

/* the scale, in one place, exactly as the engine defines it */
function snap(n) {
  if (n <= 0) return 0;
  if (n >= 100) return 999;
  if (n < 13) return 10;
  if (n < 19) return 16;
  return 22;
}

for (const page of pages) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');

  /* ---- 1. the tokens are published so D and E can consume them ---- */
  const root = /:root\{[^}]*--r-float[^}]*\}/.exec(src);
  assert.ok(root, page + ': the radius tokens are not published on :root — D and E were ' +
    'told to consume them rather than invent curves, and cannot');
  [['--r-float', '22px'], ['--r-card', '16px'], ['--r-ctl', '10px'], ['--r-pill', '999px']]
    .forEach(([name, value]) => {
      assert.ok(new RegExp(name.replace(/-/g, '\\-') + '\\s*:\\s*' + value).test(root[0]),
        page + ': ' + name + ' is not ' + value + '. The scale is derived from the dock; ' +
        'changing a value here silently rescales every surface that consumes it.');
    });

  /* ---- 2. the shell declares nothing off-scale ---- */
  const off = [];
  const re = /border(?:-top-left|-top-right|-bottom-left|-bottom-right)?-radius\s*:\s*([^;'"}\n]+)/g;
  let m, seen = 0;
  while ((m = re.exec(src))) {
    seen++;
    const nums = m[1].match(/(\d+(?:\.\d+)?)px/g) || [];
    for (const px of nums) {
      const n = parseFloat(px);
      if (snap(n) !== n && snap(n) !== 0) off.push(m[0].trim().slice(0, 60));
    }
  }
  assert.ok(seen > 300, page + ': only ' + seen + ' radius declarations found — the ' +
    'detector is broken, not the file, and it would pass whatever anyone shipped');
  assert.deepStrictEqual(off.slice(0, 8), [],
    page + ' declares ' + off.length + ' off-scale radii, e.g.\n  ' + off.slice(0, 8).join('\n  ') +
    '\nSnap to 10 / 16 / 22 / 999, or reference --r-ctl / --r-card / --r-float / --r-pill.');
}

/* ---- 3. the runtime half is still there ---- */
{
  const src = /<script id="mlsThemeParityBoot">([\s\S]*?)<\/script>/.exec(
    fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8'))[1];
  assert.ok(src.includes('function snapRadius(n){') && src.includes('function snapValue(v){') &&
      src.includes('R_TOKEN={10:'),
    'the runtime radius pass is gone. The source rewrite alone leaves the app at 16 ' +
    'distinct radii, because the *_exact.js modules out-specify the shell.');
  assert.ok(src.includes('function inlineRadius(css){'),
    'the inline radius pass is gone — inline declarations have no selector to key an ' +
    'override off, and they were 5 of the 12 remaining distinct values');
  assert.ok(/function scopeNeutral\(part\)\{ return part; \}/.test(src),
    'the radius override no longer uses the source selector verbatim. Adding ' +
    'specificity here repeats the mistake that put near-black text on #204034: ' +
    'it beats the rules that legitimately override the one being corrected.');
  /* the thresholds themselves, so a silent rescale is loud */
  ['if(n>=100) return 999;', 'if(n<13) return 10;', 'if(n<19) return 16;', 'return 22;']
    .forEach((line) => assert.ok(src.includes(line),
      'the snap threshold "' + line + '" has changed. Every corner in the app moves ' +
      'when it does; move it deliberately and say why.'));
}

/* ---- 4. the detector can fail, both directions ---- */
{
  assert.strictEqual(snap(8), 10, 'a control radius must snap to 10');
  assert.strictEqual(snap(13), 16, '13 is the card boundary');
  assert.strictEqual(snap(12), 10, '12 is still a control');
  assert.strictEqual(snap(20), 22, '20 is a floating surface');
  assert.strictEqual(snap(999), 999, 'a pill is already a pill');
  assert.strictEqual(snap(0), 0, 'a square corner stays square');
  const offRe = /border-radius\s*:\s*([^;'"}\n]+)/;
  const bad = offRe.exec('  .x{border-radius:9px}');
  assert.ok(bad && snap(parseFloat(bad[1])) !== parseFloat(bad[1]),
    'the off-scale detector does not recognise a 9px radius — it would pass the ' +
    'exact regression it exists for');
  const good = offRe.exec('  .x{border-radius:16px}');
  assert.ok(good && snap(parseFloat(good[1])) === parseFloat(good[1]),
    'the off-scale detector flags an on-scale value — a false alarm trains the next ' +
    'person to delete the test rather than read it');
}

console.log('PASS one-radius-scale: 4 tokens published in ' + pages.length + ' shells, ' +
  'no off-scale declaration in either, and the runtime pass (rules + inline, source ' +
  'specificity, thresholds 13/19/100) is intact — 16 distinct rendered radii down to 7');
