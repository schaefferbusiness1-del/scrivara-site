'use strict';

/* Owner 2026-09-11: the op-note Templates modal's multi-upload "Review and
 * add" list (#tplMultiResult) had no way to be dismissed without adding.
 * _tplPendingSplit is a plain module-level variable with no tie to the
 * modal's open/closed state, so closing and reopening Templates (or the
 * op-note room's Templates tab, which the same panel is moved into) left the
 * exact same unreviewed rows waiting right where "Add selected" would find
 * them.
 *
 * Fix: a plain "Discard these" button next to "Add selected to my
 * templates" that resets every review-batch variable to its fresh-open
 * value, shared with tplAddSplit()'s own success path so the two resets can
 * never drift apart. A subsequent new file selection (tplMultiFile, which
 * snapshots _tplPendingCarry from whatever these are at that moment) then
 * starts from a genuinely empty review, exactly like a fresh open would.
 *
 * This lifts the REAL _tplDiscardSplit()/_renderTplSplitPreview() functions
 * out of the shipped production shell and runs them, rather than
 * reimplementing the reset logic.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['ScribeFlow.html', '1pScribeFlow.html', path.join('1p', 'index.html'), path.join('cloned', 'index.html')];

function lift(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, 'missing ' + name);
  const open = src.indexOf('{', at);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, 'unbalanced ' + name);
  return src.slice(at, end);
}

let shells = 0;
for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  shells++;
  const src = fs.readFileSync(file, 'utf8');

  /* ---------- static: the button exists, and Add reuses Discard's reset ---------- */
  const renderSrc = lift(src, '_renderTplSplitPreview');
  assert.ok(/class="tpl-split-actions"/.test(renderSrc), shell + ': the review actions are no longer grouped for the sticky footer');
  assert.ok(/onclick="_tplDiscardSplit\(\)"/.test(renderSrc), shell + ': the review list has no Discard control');
  /* tplsort-1.1.0: the review's one Save sorts each row to its place (tplAddSplitSorted - the name keeps "tplAddSplit" so the template library still finds and holds the button during a signed-in save); operative rows and letters still go through tplAddSplit(). */
  assert.ok(/onclick="tplAddSplitSorted\(\)"/.test(renderSrc), shell + ': the review list lost its Save control');

  const addSrc = lift(src, 'tplAddSplit');
  assert.ok(/_tplDiscardSplit\(\)/.test(addSrc), shell + ': a successful Add no longer resets through the shared _tplDiscardSplit()');
  assert.ok(!/_tplPendingSplit=\[\];\s*_tplPendingCarry=\[\];\s*document\.getElementById\('tplMultiResult'\)\.innerHTML=''/.test(addSrc),
    shell + ': Add kept its own duplicate reset instead of sharing _tplDiscardSplit()');

  /* ---------- runtime: lift the real functions and drive them ---------- */
  const discardSrc = lift(src, '_tplDiscardSplit');
  const escSrc = lift(src, 'esc');

  function harness(seed) {
    const box = { innerHTML: '<stale review markup>' };
    const status = { text: null, color: null };
    const state = Object.assign({
      _tplPendingSplit: [{ name: 'Stale template', text: 'stale text', keep: true }],
      _tplPendingCarry: [{ name: 'Carried', text: 'carried text', keep: false }],
      _tplUnreadableRows: [{ name: 'bad.doc', text: '', reason: 'unreadable' }],
      _tplAiOff: true,
      _tplRecogFound: 7
    }, seed || {});
    const context = vm.createContext({
      document: { getElementById(id) { return id === 'tplMultiResult' ? box : null; } },
      _tplMultiStatus(m, c) { status.text = m; status.color = c; },
      esc: null,
      _tplPendingSplit: state._tplPendingSplit,
      _tplPendingCarry: state._tplPendingCarry,
      _tplUnreadableRows: state._tplUnreadableRows,
      _tplAiOff: state._tplAiOff,
      _tplRecogFound: state._tplRecogFound
    });
    vm.runInContext(escSrc + '\n' + discardSrc + '\n' + renderSrc, context, { filename: 'tpl-discard.js' });
    return { context, box, status };
  }

  /* 1. Discard resets every variable to the value a fresh page load starts
   *    with, clears the box, and says plainly that nothing was added. */
  {
    const h = harness();
    h.context._tplDiscardSplit();
    /* .length, not deepStrictEqual: these arrays are built INSIDE the vm
     * sandbox, a different realm from this test's own Array - structurally
     * empty either way, but a cross-realm identity check is the wrong tool. */
    assert.strictEqual(h.context._tplPendingSplit.length, 0, shell + ': Discard did not clear _tplPendingSplit');
    assert.strictEqual(h.context._tplPendingCarry.length, 0, shell + ': Discard did not clear _tplPendingCarry (a later upload would still carry stale rows forward)');
    assert.strictEqual(h.context._tplUnreadableRows.length, 0, shell + ': Discard did not clear _tplUnreadableRows');
    assert.strictEqual(h.context._tplAiOff, false, shell + ': Discard did not reset _tplAiOff to its fresh-open value');
    assert.strictEqual(h.context._tplRecogFound, 0, shell + ': Discard did not reset _tplRecogFound to its fresh-open value');
    assert.strictEqual(h.box.innerHTML, '', shell + ': Discard left the stale review markup on screen');
    assert.ok(/Discarded/.test(h.status.text || ''), shell + ': Discard gave no confirmation that nothing was added');
  }

  /* 2. The rendered review list really does wire both buttons, with a real
   *    pending row driving the render (not a static string check alone). */
  {
    const h = harness({ _tplPendingSplit: [{ name: 'Right knee arthroscopy', text: 'PROCEDURE NOTE', keep: true }] });
    h.context._renderTplSplitPreview();
    assert.ok(h.box.innerHTML.includes('onclick="tplAddSplitSorted()"'), shell + ': rendered review list lost its Save button');
    assert.ok(h.box.innerHTML.includes('onclick="_tplDiscardSplit()"'), shell + ': rendered review list lost its Discard button');
    assert.ok(h.box.innerHTML.includes('Right knee arthroscopy'), shell + ': rendered review list dropped the pending template row');
  }

  /* 3. An EMPTY pending list (post-discard state) renders nothing - no
   *    orphaned Add/Discard buttons with nothing to act on. */
  {
    const h = harness({ _tplPendingSplit: [] });
    h.context._renderTplSplitPreview();
    assert.strictEqual(h.box.innerHTML, '', shell + ': an empty pending list still rendered review controls');
  }
}

assert.ok(shells > 0, 'nothing was scanned - this suite tested nothing');
console.log('PASS template multi-upload discard: ' + shells + ' shell(s) - Discard resets every review-batch ' +
  'variable to its fresh-open value and clears the stale list, Add shares the identical reset, and the ' +
  'rendered review list really wires both controls');
