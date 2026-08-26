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

/* ===== vt-1.1.0 (Codex reply 45): the Athena chart-import RECEIPT note is
   never a visit - one shared predicate, executed through the REAL chip
   renderer and the REAL resolver notesOf ===== */
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
for (const name of ['1pScribeFlow.html', path.join('1p', 'index.html')]) {
  const text = fs.readFileSync(path.join(root, name), 'utf8');
  assert.ok(text.includes('function _mlsIsChartImportNote(n){'), name + ': the shared import-receipt predicate is missing');
  assert.strictEqual(text.split('_mlsIsChartImportNote').length - 1 >= 5, true, name + ': the predicate is not shared by chip/History/resolver');
  assert.ok(text.includes("notes=notes.filter(function(n){ return n&&!n.isDraft&&!(typeof _mlsIsChartImportNote==='function'&&_mlsIsChartImportNote(n)); });"),
    name + ': the at-glance chip counts import receipts again');
  assert.ok(text.includes("if (n && !n.isDraft && !(typeof _mlsIsChartImportNote === 'function' && _mlsIsChartImportNote(n))) out.push(n);"),
    name + ': the resolver notesOf counts import receipts again');
}

/* the REAL predicate */
const pStart = shell.indexOf('function _mlsIsChartImportNote(n){');
const pEnd = shell.indexOf('try{ window._mlsIsChartImportNote=_mlsIsChartImportNote; }', pStart);
const isImport = new Function(shell.slice(pStart, pEnd) + '\nreturn _mlsIsChartImportNote;')();
assert.strictEqual(isImport({ cc: 'Athena chart import' }), true);
assert.strictEqual(isImport({ cc: 'Chart facts — Athena chart import' }), true);
assert.strictEqual(isImport({ cc: 'Follow-up visit' }), false);
assert.strictEqual(isImport({}), false);

/* the REAL chip renderer, executed: receipt-only -> new-patient state; a
   clinical note beside a refreshed receipt -> exactly 1 with the clinical
   last-seen; replacing the receipt never moves the count */
const gStart = shell.indexOf('function _renderProfAtGlance(p){');
const gEnd = shell.indexOf('/* ---------- INLINE PROFILE FIELD EDITOR', gStart);
assert.ok(gStart > 0 && gEnd > gStart, 'the at-glance renderer moved');
function runChip(noteList) {
  const els = {};
  const mk = () => ({ id: '', style: {}, innerHTML: '', nextSibling: null, parentNode: { insertBefore(n) { els[n.id] = n; } } });
  els.profDemo = mk(); els.profDemo.id = 'profDemo';
  const doc = { getElementById: id => els[id] || null, createElement: () => { const n = mk(); return n; } };
  const render = new Function('document', 'patientNotes', '_mlsIsChartImportNote',
    shell.slice(gStart, gEnd) + '\nreturn _renderProfAtGlance;');
  render(doc, () => noteList, isImport)({ id: 'p1' });
  return els.profAtGlance ? els.profAtGlance.innerHTML : '';
}
const RECEIPT = { cc: 'Athena chart import', isDraft: false, created: 1700000000000, updated: 1750000000000 };
const CLINICAL = { cc: 'Follow-up', isDraft: false, date: '2026-08-20' };
let html = runChip([RECEIPT]);
assert.ok(html.includes('New patient'), 'an import receipt alone minted a visit: ' + html);
assert.ok(!html.includes('last seen'), 'an import receipt alone minted a last-seen date');
html = runChip([RECEIPT, CLINICAL]);
assert.ok(html.includes('<b>1</b>') && html.includes('MLS visit note') && html.includes('last seen'),
  'one receipt + one clinical note did not count exactly 1 with a last-seen: ' + html);
const htmlReplaced = runChip([Object.assign({}, RECEIPT, { updated: 1790000000000 }), CLINICAL]);
assert.strictEqual(htmlReplaced.includes('<b>1</b>'), true, 'refreshing the import receipt changed the visit count');

/* the REAL resolver notesOf, executed */
const nStart = shell.indexOf('  function notesOf(p) {');
const nEnd = shell.indexOf('  function stableKey(v) {', nStart);
const notesOf = new Function('window', 'safe', 'isFn', 'str', '_mlsIsChartImportNote',
  shell.slice(nStart, nEnd) + '\nreturn notesOf;')(
  { patientNotes: id => notesOfFixture }, (fn, d) => { try { return fn(); } catch (e) { return d; } },
  f => typeof f === 'function', v => String(v == null ? '' : v), isImport);
let notesOfFixture = [RECEIPT];
assert.strictEqual(notesOf({ id: 'p1' }).length, 0, 'the resolver counted an import receipt as a visit source');
notesOfFixture = [RECEIPT, CLINICAL];
assert.strictEqual(notesOf({ id: 'p1' }).length, 1, 'the resolver did not count exactly the one clinical note');

console.log('PASS visit-tally labels (vt-1.1.0): both tallies name their scope AND count honestly - the Athena chart-import receipt note is excluded by the ONE shared predicate from the chip and the resolver (executed: receipt-only = new-patient with no last-seen; receipt + clinical = exactly 1 with the clinical last-seen; refreshing the receipt never moves the count), History keeps its imports filter on the same semantics, and both shells carry identical wiring');
