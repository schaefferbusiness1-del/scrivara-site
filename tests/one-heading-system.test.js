'use strict';

/* The app had two heading systems. It now has one, and this is what keeps it.
 *
 * Measured at b676 on the running app, ten views, 1440x900 — 33 visible
 * headings:
 *
 *   weight 700, Public Sans, five sizes (15/18/20/23/28)     31
 *   weight 500, Newsreader, bare — Analysis and AI Studio     2
 *
 * The owner picked the calm one. After:
 *
 *   weight 600, Public Sans, h2 20px / h3 15px               31
 *   weight 500, Newsreader, h1 28px                           2
 *   distinct sizes                                       5 -> 3
 *
 * Three ranks and nothing else: h1 is the page's subject, h2 a section of it,
 * h3 a block inside that. Weight 700 is the thing being retired — at 15px it
 * was the loudest text on a screen whose primary action is supposed to be the
 * biggest thing on it.
 *
 * WHAT THIS SUITE DOES NOT CLAIM. 17 of the 33 are still emoji-prefixed
 * ("🧾 Doctor prep summary") and 9 exceed the contract's three-word header
 * budget. Both are TEXT, in patientsView and ordersView markup, which Workers
 * D and E own and are rebuilding — an edit here would collide with theirs and
 * probably lose. The census is in WORKER_F_REPORT.md so they can strip them at
 * source; the count is recorded here, not enforced, so this suite cannot fail
 * on their in-flight work.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pages = ['ScribeFlow.html', 'ScribeFlow-staging.html'];

for (const page of pages) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');

  /* ---- 1. the three ranks, exactly ---- */
  const block = /\/\* ===== ONE HEADING SYSTEM =====[\s\S]*?\n  h3\{[^}]*\}/.exec(src);
  assert.ok(block, page + ': the heading system block is gone');
  const ranks = {
    h1: /\n  h1\{([^}]*)\}/.exec(block[0]),
    h2: /\n  h2\{([^}]*)\}/.exec(block[0]),
    h3: /\n  h3\{([^}]*)\}/.exec(block[0])
  };
  const want = { h1: ['var(--serif)', '500', '28px'], h2: ['var(--sans)', '600', '20px'], h3: ['var(--sans)', '600', '15px'] };
  for (const r of ['h1', 'h2', 'h3']) {
    assert.ok(ranks[r], page + ': rank ' + r + ' is missing from the heading system');
    for (const token of want[r]) {
      assert.ok(ranks[r][1].includes(token),
        page + ': ' + r + ' no longer declares ' + token + '. Three ranks and nothing else — ' +
        'a fourth size or a second weight is how the app got two systems in the first place.');
    }
    assert.ok(/!important/.test(ranks[r][1]),
      page + ': ' + r + ' dropped !important. The *_exact.js view modules declare heading ' +
      'type with their own !important, so a polite rule leaves the app in the two-system ' +
      'state this block replaces.');
  }

  /* ---- 2. the page declares no bold heading of its own ----
   * `.card h2{font-weight:700}` shipped in both pages and was shadowed rather
   * than retired, which is how a "one system" quietly becomes two again the
   * next time someone lowers the specificity above it. */
  const bold = [];
  const re = /([^{}\n]*\bh[123]\b[^{}\n]*)\{([^}]*font-weight\s*:\s*(?:700|800|900|bold)[^}]*)\}/g;
  let m;
  while ((m = re.exec(src))) bold.push(m[1].trim().slice(0, 70));
  assert.deepStrictEqual(bold, [],
    page + ' still declares a bold heading of its own:\n  ' + bold.join('\n  ') +
    '\nRetire it rather than shadow it — a shadowed contradiction survives every ' +
    'refactor of the rule that shadows it.');

  /* ---- 3. the module-level escapes are still out-specified ----
   * These four selectors are (2,0,1) or (2,1,1) WITH !important inside
   * *_exact.js, which no bare h2{...!important} can reach. */
  ['#ordersView #ordersCard > h2', '#historyView #historyCard > h2',
   '#recsView #recsCard > h2', '#studioView #copilotHero h2',
   '#ordersView .extra-card h3'].forEach((sel) => {
    assert.ok(src.includes('html body ' + sel),
      page + ': the override for "' + sel + '" is gone. That module declares heading ' +
      'weight at higher specificity with !important, so eight headings go back to 700 ' +
      'and the app has two systems again.');
  });
}

/* ---- 4. the two shells agree ---- */
{
  const [a, b] = pages.map((p) => {
    const s = fs.readFileSync(path.join(ROOT, p), 'utf8');
    return /\/\* ===== ONE HEADING SYSTEM =====[\s\S]*?\n  h3\{[^}]*\}/.exec(s)[0].replace(/\s+/g, ' ');
  });
  assert.strictEqual(a, b, 'the heading system has forked between ScribeFlow.html and its ' +
    'staging twin — the twin is where this gets verified against a second palette');
}

/* ---- 5. the detector can fail, both directions ---- */
{
  const boldRe = /([^{}\n]*\bh[123]\b[^{}\n]*)\{([^}]*font-weight\s*:\s*(?:700|800|900|bold)[^}]*)\}/g;
  assert.ok(boldRe.test('  .card h2{ font-size:18px; font-weight:700; }'),
    'the bold-heading detector does not recognise the exact declaration it was written ' +
    'for — it would pass whatever anyone shipped');
  boldRe.lastIndex = 0;
  assert.ok(!boldRe.test('  .card h2{ letter-spacing:-.01em; }'),
    'the bold-heading detector fires on the corrected rule — a false alarm trains the ' +
    'next person to delete the test rather than read it');
  boldRe.lastIndex = 0;
  assert.ok(!boldRe.test('  .btn{ font-weight:700; }'),
    'the detector treats a non-heading bold rule as a violation; buttons may be bold');
}

console.log('PASS one-heading-system: three ranks (serif 500/28, sans 600/20, sans 600/15) ' +
  'declared identically in ' + pages.length + ' shells, no page-level bold heading survives, ' +
  'and the 5 module-level !important escapes stay out-specified');
