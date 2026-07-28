'use strict';

/* TWO DEFECTS THAT ONLY A LIVE MEASUREMENT COULD FIND (b752).
 *
 * Both were reported as fixed by earlier builds. Both were still broken on the
 * live page, and one of them I made WORSE. Source reading could not have caught
 * either: the first is a CSS specificity contest between two files, the second is
 * an element that renders on a surface where its own instruction is impossible.
 *
 * ---- 1. THE TOAST BECAME AN 87 x 1085 px COLUMN (I shipped this) ----
 * b748 moved .toast to a measured TOP anchor (top:var(--mls-notice-top,96px);
 * bottom:auto) in ScribeFlow.html. Measured on the live b751 page: the shown
 * toast carried BOTH top:158px AND bottom:100px, so a position:fixed box with
 * height:auto stretched to offsetHeight 1085 - a solid dark column from y=158 to
 * y=1243, 87px wide, stable across 5 timed samples.
 *
 * Cause: feat_mls_calm_views.js declared `body.<variant> .toast{bottom:var(
 * --mls-toast-lift,96px)}`. Specificity 0,2,1 and a later document position beat
 * the 0,1,0 page rule. The lift existed to raise a BOTTOM-anchored toast above
 * the ask bar; once the toast was top-anchored the lift stopped being redundant
 * and became the bug. Before b748 the toast was a compact bottom pill, so this
 * was a REGRESSION, not a pre-existing fault.
 *
 * ---- 2. THE PHONE EXIT WAS UNREACHABLE (a trap) ----
 * #mlsR46VerBanner prompts the user to install the desktop extension. It fires
 * whenever there is no extension handshake, and a phone can never complete one,
 * so it fired every phone session ~25s in. Measured at 375x812: 230x332,
 * position:fixed, bottom:90px, z-index 2147483100, covering y 390-722 - 41% of
 * the viewport height dead centre.
 *   6 of 19 in-viewport controls failed elementFromPoint at their own centre
 *   (the entire day strip + the provider select). Hidden -> 22/22, 0 failures.
 *   4 of 10 top-bar menu items failed. Hidden -> 10/10.
 *   #mlsPhExit - the ONLY exit from phone mode - failed at EVERY scroll offset:
 *   document height 1048, maxScrollY 668, so its best reachable centre is y=402,
 *   inside the covered band. Same class as the b669 defect: on screen, focused,
 *   unclickable.
 * And its own call to action ("Download it from mlsscribe.com Settings") cannot
 * be performed on a phone, so there was no upside to weigh against that.
 *
 * WHY THE FIX IS A GUARD AND NOT A RESIZE: widening the banner would fix its
 * 82px text column but leave the occlusion and the exit trap intact, and would
 * still show a phone user an instruction they cannot follow.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const views = fs.readFileSync(path.join(root, 'feat_mls_calm_views.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- 1. no body-variant rule may re-impose a bottom offset on .toast ---- */
{
  /* The page rule must still be the top anchor it became in b748. */
  assert(/\.toast\{position:fixed;top:var\(--mls-notice-top,96px\);bottom:auto;/.test(html),
    'the page .toast rule must stay top-anchored with bottom:auto');

  /* And nothing may fight it with a bottom. Scan every .toast declaration block
     in the calm-views layer for a bottom that is not auto.
     COMMENTS ARE STRIPPED FIRST. My first version of this assertion fired on a
     comment at feat_mls_calm_views.js:297 that quotes the OLD rule
     (".toast{bottom:96px}") while explaining it - a comment-blind scanner
     reporting prose as code, which is the same class of bug that has bitten the
     month-routing suite in this repo. Strip, then scan. */
  const code = views
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      /* block comments */
    .replace(/^[ \t]*\/\/.*$/gm, ' ');      /* whole-line // comments */
  const blocks = code.match(/\.toast\{[^}]*\}/g) || [];
  assert(blocks.length, 'the calm-views layer must still declare a .toast rule');
  blocks.forEach(function (b) {
    const m = /bottom:\s*([^;}]+)/.exec(b);
    if (!m) return;
    assert.strictEqual(m[1].trim(), 'auto',
      'a body-variant .toast rule sets bottom:' + m[1].trim() + '. With the page rule ' +
      'setting top, a fixed box with both top and bottom STRETCHES - measured live at ' +
      'offsetHeight 1085, an 87x1085 dark column down the whole viewport. This rule wins ' +
      'on specificity (0,2,1 vs 0,1,0) and document order, so it must be bottom:auto. ' +
      'Offending block: ' + b.slice(0, 120));
  });

  /* the lift token must not come back on a bottom for .toast */
  assert(!/\.toast\{[^}]*bottom:var\(--mls-toast-lift/.test(views),
    'the --mls-toast-lift bottom offset must not be re-applied to .toast - it is the ' +
    'mechanism of the column bug, not a mitigation of it');
}

/* ---- 2. the extension-missing banner must never build in phone mode ---- */
{
  const at = connect.indexOf('function banner(msg, how) {');
  assert(at > 0, 'the extension-missing banner builder must still exist');
  /* the guard has to precede the construction, and precede the other early
     returns is fine - what matters is that it is BEFORE the element is made */
  const made = connect.indexOf("b.id = 'mlsR46VerBanner'", at);
  assert(made > at, 'the banner element construction must follow its builder');
  const head = connect.slice(at, made);
  assert(/classList\.contains\('mls-phone'\)/.test(head),
    'banner() must return early in phone mode BEFORE constructing #mlsR46VerBanner. ' +
    'It fires whenever there is no extension handshake and a phone can never complete ' +
    'one, so it appeared every phone session - covering 41% of a 375x812 viewport and ' +
    'making 6 of 19 controls, 4 of 10 menu items, and #mlsPhExit (the only exit from ' +
    'phone mode) unclickable at every scroll offset.');
  assert(/return;/.test(head.slice(head.indexOf("classList.contains('mls-phone')"))),
    'the phone check must actually RETURN, not merely be evaluated');
}

console.log('PASS live-measured occlusion regressions: no body-variant rule re-imposes a bottom ' +
  'offset on the top-anchored toast (which made it stretch to an 87x1085 column), and the ' +
  'extension-missing banner can no longer build in phone mode, where it covered the day strip, ' +
  'four menu items and the only exit from phone mode');
