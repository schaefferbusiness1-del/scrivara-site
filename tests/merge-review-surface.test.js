'use strict';

/* mergeui-1.0.0 (2026-08-28) — the patient merge had no UI at all.
 *
 * __mlsDedupById could collapse duplicate charts since b121, but the ONLY entry
 * point was a console call with a confirm token. In practice that means
 * duplicates were never merged: the owner had two charts for his own authorised
 * test patient sitting in the list with no way to resolve them.
 *
 * This suite executes the surface's helpers against stubs. The properties that
 * matter:
 *   1. a patient NAME reaches innerHTML, so it must be escaped - a chart called
 *      `X <img onerror=...>` must not become markup
 *   2. the control must HIDE at zero duplicates. The owner's standing complaint
 *      is that the UI is over-stuffed; a permanently visible button that does
 *      nothing is exactly the "dead button" class he asked to have removed
 *   3. the count in the label must track the real group count, not a stale one
 *   4. undo must be offered, because a merge a doctor cannot take back is one
 *      they will not risk pressing
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const LANES = ['1p-feat_mls_b121_pack.js', 'feat_mls_b121_pack.js', 'cloned-feat_mls_b121_pack.js'];

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

  const S = x => (x == null ? '' : String(x));

  /* ---- 1. escaping ---- */
  const mgEsc = new Function('S', lift(src, 'mgEsc') + '\nreturn mgEsc;')(S);
  const hostile = 'Smith <img src=x onerror="alert(1)"> & "co"';
  const escaped = mgEsc(hostile);
  ok(!/[<>]/.test(escaped),
    lane + ': a patient name containing angle brackets was NOT escaped before reaching innerHTML');
  ok(escaped.indexOf('&amp;') >= 0, lane + ': ampersand not escaped');
  ok(escaped.indexOf('&quot;') >= 0, lane + ': double quote not escaped');
  ok(escaped.indexOf('onerror=') === -1 || escaped.indexOf('&lt;img') >= 0,
    lane + ': an event-handler attribute survived unescaped');

  /* the row builder must run the name through it */
  const mgVisitCount = new Function(lift(src, 'mgVisitCount') + '\nreturn mgVisitCount;')();
  const mgRowHtml = new Function('S', 'mgEsc', 'mgVisitCount',
    lift(src, 'mgRowHtml') + '\nreturn mgRowHtml;')(S, mgEsc, mgVisitCount);
  const row = mgRowHtml({ name: hostile, dob: '1980-01-01', mrn: '123', visits: [1, 2] }, true);
  ok(row.indexOf('<img') === -1,
    lane + ': mgRowHtml injected an unescaped patient name straight into markup');
  ok(/KEEPS THIS CHART/.test(row), lane + ': the surviving chart is not labelled, so the doctor cannot tell what is kept');
  ok(/2 visits/.test(row), lane + ': visit count not shown - the doctor cannot judge which chart is richer');
  const row1 = mgRowHtml({ name: 'A', visits: [1] }, false);
  ok(/1 visit\b/.test(row1) && !/1 visits/.test(row1), lane + ': visit count is not singularised');

  /* ---- 2 + 3. the control hides at zero and tracks the count ---- */
  function syncWith(groupCount) {
    const btn = { style: { display: 'INITIAL' }, textContent: '' };
    const mgSync = new Function('document', 'mgGroups',
      lift(src, 'mgSync') + '\nreturn mgSync;')(
      { getElementById: id => (id === 'mlsMergeReviewBtn' ? btn : null) },
      () => new Array(groupCount).fill([{}, {}])
    );
    mgSync();
    return btn;
  }
  const zero = syncWith(0);
  eq(zero.style.display, 'none',
    lane + ': the merge control stays visible with ZERO duplicates - a button that does nothing is ' +
    'the dead-control class the owner asked to have removed');
  const one = syncWith(1);
  ok(one.style.display !== 'none', lane + ': the merge control is hidden even though duplicates exist');
  ok(/\b1 duplicate\b/.test(one.textContent) && !/1 duplicates/.test(one.textContent),
    lane + ': the label does not singularise (got: ' + one.textContent + ')');
  const many = syncWith(4);
  ok(/\b4 duplicates\b/.test(many.textContent),
    lane + ': the label does not report the real duplicate count (got: ' + many.textContent + ')');

  /* ---- 4. the surface must offer undo and must not merge without a click ---- */
  const render = lift(src, 'mgRender');
  ok(/mlsMergeReviewUndo/.test(render), lane + ': no undo control is offered after a merge');
  ok(/confirm: 'EXECUTE'/.test(render), lane + ': the merge does not use the explicit confirm token');
  ok(/addEventListener\('click'/.test(render),
    lane + ': the merge runs without an explicit click');
  /* runOnce must NOT be reachable on mount - only from the button handler */
  const mount = lift(src, 'mgMount');
  ok(!/runOnce/.test(mount),
    lane + ': mounting the control can trigger a MERGE - merging must require a deliberate click');
  const sync = lift(src, 'mgSync');
  ok(!/runOnce/.test(sync), lane + ': refreshing the count can trigger a merge');
}

ok(lanes > 0, 'no lane files found - this suite tested nothing');
console.log('PASS merge-review-surface: ' + checks + ' checks across ' + lanes + ' lane(s) - patient ' +
  'names are escaped before reaching markup, the control hides at zero duplicates and tracks the real ' +
  'count, undo is offered, and neither mounting nor refreshing can merge anything');
