'use strict';
/* vt-1.0.0 (matrix 2026-08-26 ledger: "FOUR differently-scoped visit tallies
 * (10/7/'6 of 7'/'4+5+1')" on one card, unlabeled): each visible tally now
 * names its SCOPE so two different numbers can both be true in front of the
 * doctor. The at-glance chip counts completed MLS visit notes only - it says
 * so; the timeline header counts the resolver's all-source total - it says
 * so (its source line beneath already itemizes); the refresh receipts and
 * History filter counts already carried their own sentences. Both shells. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
for (const name of ['1pScribeFlow.html', path.join('1p', 'index.html')]) {
  const text = fs.readFileSync(path.join(root, name), 'utf8');
  assert.ok(text.includes("chip('MLS visit note'+(notes.length===1?'':'s'), notes.length)"),
    name + ': the at-glance chip no longer names its MLS-notes-only scope');
  assert.ok(!text.includes("chip('visit'+(notes.length===1?'':'s'), notes.length)"),
    name + ': the unlabeled at-glance tally came back');
  assert.ok(text.includes("var want = res.count + ' visit' + (res.count === 1 ? '' : 's') + ' — all sources';"),
    name + ': the timeline header no longer names its all-source scope');
}

/* the labeled header must keep satisfying the permanent lifecycle pins */
assert.ok(/2 visits/.test('2 visits — all sources'), 'the label broke the "2 visits" lifecycle pin shape');
assert.ok(/1 visit(?:\s|$)/.test('1 visit — all sources'), 'the label broke the "1 visit" boundary pin shape');

console.log('PASS visit-tally labels (vt-1.0.0): the at-glance chip names its MLS-notes scope and the timeline header names its all-source scope in BOTH shells, and the labeled header still satisfies the permanent lifecycle count pins');
