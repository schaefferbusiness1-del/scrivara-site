'use strict';

/* prepfold-1.0.0 (2026-08-28) — the biggest block of duplicated text on the chart.
 *
 * buildPrepSummary re-prints SOURCE, ALLERGIES, PROBLEMS, MEDICATIONS, VITALS,
 * HISTORY, LONGITUDINAL SUMMARY and LAST VISIT as one flat wall of text - and
 * every one of those already has its own card AND its own quick-strip tile on the
 * same screen, directly above the box. That is what the owner meant by "all the
 * other summarys are over kill".
 *
 * It is FOLDED, not deleted, and this suite exists to keep it that way in both
 * directions:
 *   - the text must still be present (a "cleanup" that deletes clinical text is a
 *     regression, and several other apparently-redundant lines on this card turned
 *     out to be load-bearing)
 *   - it must NOT be open by default (that is the clutter the owner reported)
 *   - Copy must keep working, and must keep re-deriving rather than scraping the
 *     DOM, because a folded <details> is exactly the kind of thing a DOM-scraping
 *     copy would silently return empty
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }

const root = path.resolve(__dirname, '..');
const LANES = ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'];

function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  const j = src.indexOf('{', i);
  let d = 0, e = -1;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced ' + name);
  return src.slice(i, e);
}

let lanes = 0;
for (const lane of LANES) {
  const file = path.join(root, lane);
  if (!fs.existsSync(file)) continue;
  lanes++;
  const src = fs.readFileSync(file, 'latin1');
  const body = lift(src, 'renderSummaryBox');

  /* the prep text must still be rendered - folding is not deleting */
  ok(/esc\(text\)/.test(body),
    lane + ': renderSummaryBox no longer renders the prep summary text at all - folding it was ' +
    'the intent, DELETING it is a regression');
  ok(/buildPrepSummaryForPatient\(p\)/.test(body),
    lane + ': the prep summary is no longer derived from buildPrepSummaryForPatient');

  /* it must be behind a disclosure ... */
  ok(/<details/.test(body),
    lane + ': the prep summary is not folded - the duplicated wall of text is back on the card ' +
    'by default');
  ok(/<summary/.test(body), lane + ': the fold has no summary/label, so it cannot be opened');

  /* ... and that disclosure must be CLOSED by default */
  const det = body.slice(body.indexOf('<details'), body.indexOf('</details>') + 10);
  ok(!/\bopen\b/.test(det),
    lane + ': the prep-summary fold is marked open, so the duplication is still on screen by ' +
    'default - that is the clutter the owner reported');

  /* the <details> must actually WRAP the text, not sit beside it */
  const dStart = body.indexOf('<details');
  const dEnd = body.indexOf('</details>');
  const textAt = body.indexOf('esc(text)');
  ok(dStart >= 0 && dEnd > dStart && textAt > dStart && textAt < dEnd,
    lane + ': the prep summary text is NOT inside the fold - it renders unfolded regardless');

  /* Copy must survive and must not scrape the DOM */
  ok(/__mlsEpCopySummary/.test(body), lane + ': the Copy control was removed from the prep summary');
  const copyFnAt = src.indexOf('window.__mlsEpCopySummary = function');
  ok(copyFnAt >= 0, lane + ': __mlsEpCopySummary is gone');
  const copyFn = src.slice(copyFnAt, src.indexOf('};', copyFnAt));
  ok(/buildPrepSummaryForPatient\(/.test(copyFn),
    lane + ': Copy no longer re-derives the summary');
  ok(!/getElementById|querySelector|innerText|textContent/.test(copyFn),
    lane + ': Copy scrapes the DOM - with the text folded that would silently copy nothing');
}

ok(lanes > 0, 'no lane files found - this suite tested nothing');
console.log('PASS prep-summary-is-folded-not-lost: ' + checks + ' checks across ' + lanes +
  ' lane(s) - the duplicated prep text is behind a closed disclosure, still rendered, still ' +
  'copyable, and Copy re-derives rather than scraping the folded DOM');
