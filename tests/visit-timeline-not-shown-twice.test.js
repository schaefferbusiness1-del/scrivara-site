'use strict';

/* tlfold-1.0.0 (2026-08-28) — the chart showed the same visits twice.
 *
 * #mlsVisitHistoryExt ("Visit history") is the richer list: search, type and date
 * filters, year grouping, per-visit source chips. The classic "Visit timeline"
 * box (#ptTimeline) repeats the SAME rows with strictly less information. That is
 * the owner's "so many duplicate ways to show same things".
 *
 * It is FOLDED, not removed, and that distinction is the whole point:
 * feat_mls_timeline_sync wraps renderPtTimeline and APPENDS rows for visits that
 * exist only as text bullets inside p.summary, labelled "From patient summary
 * (read-only)". Those appear on NO other surface, so deleting this box would lose
 * real visits. An earlier review proposed exactly that deletion and it was wrong.
 *
 * The fold wraps the CONTAINERS and keeps both ids, so renderPtTimeline and the
 * shared sync module are untouched. This suite pins that, in both directions.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];

let lanes = 0;
for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  lanes++;
  const src = fs.readFileSync(file, 'latin1');

  /* both anchors must still exist EXACTLY once - the renderer and the shared sync
     module both write into them by id */
  eq((src.match(/id="ptTimeline"/g) || []).length, 1,
    shell + ': #ptTimeline is missing or duplicated - renderPtTimeline writes into it by id');
  eq((src.match(/id="ptTimelineEmpty"/g) || []).length, 1,
    shell + ': #ptTimelineEmpty is missing or duplicated');

  /* the fold must WRAP them, not replace them */
  const foldAt = src.indexOf('mls-pt-timeline-fold');
  ok(foldAt >= 0,
    shell + ': the classic visit timeline is NOT folded - the chart shows the same visits twice ' +
    'by default again');
  const closeAt = src.indexOf('</details>', foldAt);
  const emptyAt = src.indexOf('id="ptTimelineEmpty"', foldAt);
  const listAt = src.indexOf('id="ptTimeline"', foldAt);
  ok(closeAt > foldAt, shell + ': the timeline fold is never closed');
  ok(emptyAt > foldAt && emptyAt < closeAt,
    shell + ': the empty-state line is OUTSIDE the fold, so it still renders unfolded');
  ok(listAt > foldAt && listAt < closeAt,
    shell + ': the timeline list is OUTSIDE the fold - folding it achieved nothing');

  /* closed by default */
  const openTag = src.slice(foldAt - 40, foldAt + 40);
  ok(!/<details[^>]*\bopen\b/.test(openTag),
    shell + ': the timeline fold ships OPEN, so the duplicate list is still on screen by default');

  /* the renderer must be untouched: it still writes by id, and still renders rows */
  const rp = src.indexOf('function renderPtTimeline(');
  ok(rp >= 0, shell + ': renderPtTimeline is gone');
  const body = src.slice(rp, src.indexOf('\nfunction ', rp + 10));
  ok(/getElementById\('ptTimeline'\)/.test(body),
    shell + ': renderPtTimeline no longer resolves its container by id - the fold broke the renderer');
  ok(/getElementById\('ptTimelineEmpty'\)/.test(body),
    shell + ': renderPtTimeline no longer resolves its empty state');
  ok(/patientNotes\(p\.id\)/.test(body),
    shell + ': renderPtTimeline no longer reads the patient\'s notes - the rows would be empty');
  ok(/innerHTML\s*=/.test(body),
    shell + ': renderPtTimeline no longer writes rows');
}

ok(lanes > 0, 'no shells found - this suite tested nothing');
console.log('PASS visit-timeline-not-shown-twice: ' + checks + ' checks across ' + lanes +
  ' shell(s) - the classic timeline is behind a closed fold, both container ids survive so the ' +
  'renderer and the shared summary-visit sync are untouched, and nothing was deleted');
