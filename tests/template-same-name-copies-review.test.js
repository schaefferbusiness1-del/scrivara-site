'use strict';
/* tpldups-1.0.0 (2026-09-15) - REVIEW SAME-NAME TEMPLATE COPIES.
 *
 * Measured on the owner's real library: 199 templates / 102 names / 27 names
 * carried by 124 rows / 27 header-only rows / zero byte-identical pairs - so
 * the existing "Remove duplicates" (byte-identical only) had nothing to do
 * while the ranker kept meeting five copies of one name. This executes the
 * shipped grouping, archive and restore functions sliced out of BOTH twins on
 * a synthetic library. Archive never deletes; restore brings everything back.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let checks = 0;
function ok(c, m) { checks++; assert.ok(c, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m + ' (got ' + JSON.stringify(a) + ')'); }

function prose(n) { return Array.from({ length: n }, (_, i) => 'Sentence ' + i + ' of the operative narrative describes a step performed under fluoroscopic guidance in full detail.').join('\n'); }
const header = 'Patient: [[patient]]\nPhysician: [[physician]]\nDiagnosis: facet syndrome\nMedication: [[med]]';

for (const file of ['1pScribeFlow.html', '1p/index.html']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const s = src.indexOf('/* ===== tpldups-1.0.0');
  const e = src.indexOf('/* ===== end tpldups-1.0.0 ===== */');
  ok(s > 0 && e > s, file + ': tool present');
  ok(src.includes('onclick="reviewDuplicateTemplates()"'), file + ': the Saved templates card carries the review button');
  const code = src.slice(s, e);
  const store = { templates: null, active: 'stub-1', archive: null, toasts: [], pane: { innerHTML: '' } };
  let templates = [
    { id: 'full-a', name: 'Left sacroiliac joint injection', text: header + '\nDescription of Procedure:\n' + prose(8) },
    { id: 'stub-1', name: 'Left sacroiliac joint injection ', text: header },
    { id: 'full-b', name: 'left  sacroiliac joint injection', text: header + '\nDescription of Procedure:\n' + prose(12) },
    { id: 'solo', name: 'Right hip injection', text: header + '\nDescription of Procedure:\n' + prose(5) },
    { id: 'mbb-1', name: 'Bilateral L3-L5 MBB', text: header + '\n' + prose(6) },
    { id: 'mbb-2', name: 'Bilateral L3-L5 MBB', text: header + '\n' + prose(6) },
  ];
  const ctx = { console, JSON, Object, Array, String, Number, Date, Math, RegExp, Error,
    localStorage: { getItem(k) { return k === 'templatesArchive' ? store.archive : (k === 'templateActive' ? store.active : null); }, setItem(k, v) { if (k === 'templatesArchive') store.archive = v; if (k === 'templateActive') store.active = v; }, removeItem() {} },
    uns(k) { return k; }, toast(m, kind) { store.toasts.push({ m, kind }); }, esc(v) { return String(v); },
    getTemplates() { return templates.map((t) => Object.assign({}, t)); }, setTemplates(arr) { templates = arr.map((t) => Object.assign({}, t)); },
    getActiveTemplateId() { return store.active; }, _tplClone(v) { return JSON.parse(JSON.stringify(v)); },
    document: { getElementById(id) { return id === 'tplDetail' ? store.pane : null; }, querySelector() { return null; } },
    _tplUI: { selectedId: '', renderedId: '', dirty: false }, tplSelect() {}, window: {} };
  ctx.window = ctx;
  vm.runInNewContext(code, ctx, { filename: file });
  /* grouping: whitespace and case fold, singles excluded, fullest first, stub marked */
  const groups = ctx._tplSameNameGroups(ctx.getTemplates());
  eq(groups.length, 2, file + ': two same-name groups (the solo template is not a group)');
  const si = groups.find((g) => g.key === 'left sacroiliac joint injection');
  ok(si && si.rows.length === 3, file + ': the three SI copies group despite spacing and case');
  eq(si.rows[0].id, 'full-b', file + ': the fullest copy (most prose) is proposed');
  eq(si.keepId, 'full-b', file + ': keepId is the fullest');
  ok(si.rows.find((r) => r.id === 'stub-1').stub === true, file + ': the header-only copy is marked a stub');
  ok(si.rows.find((r) => r.id === 'full-a').stub === false, file + ': a full copy is not a stub');
  eq(si.stubs, 1, file + ': one stub counted');
  const mbb = groups.find((g) => g.key === 'bilateral l3-l5 mbb');
  eq(mbb.stubs, 0, file + ': two equal full copies produce no stub');
  /* review pane renders without throwing and names the group */
  ctx.reviewDuplicateTemplates();
  ok(store.pane.innerHTML.includes('Same-name copies') && store.pane.innerHTML.includes('Left sacroiliac joint injection'), file + ': the pane lists the group');
  ok(store.pane.innerHTML.includes('Archive all 1 header-only copy'), file + ': the one-press stub archive is offered');
  /* archive: keep one, move the others, adopt the default, never delete */
  const res = ctx.archiveTemplateCopies('left sacroiliac joint injection', 'full-b');
  eq(res.archived, 2, file + ': two copies archived');
  eq(templates.length, 4, file + ': library shrinks by two');
  ok(templates.some((t) => t.id === 'full-b') && !templates.some((t) => t.id === 'stub-1'), file + ': the kept copy stays, the stub is gone from the library');
  const archived = JSON.parse(store.archive);
  eq(archived.length, 2, file + ': the archive holds both moved copies');
  ok(archived.every((t) => t.archivedAt > 0 && t.keptId === 'full-b'), file + ': each archived copy records when and which copy was kept');
  eq(store.active, 'full-b', file + ': the default template pointer moved from the archived stub to the kept copy');
  ok(store.toasts.some((t) => /archived 2 other copies/.test(t.m)), file + ': the doctor is told what happened');
  /* wrong keep id: nothing moves */
  const none = ctx.archiveTemplateCopies('bilateral l3-l5 mbb', 'not-a-copy');
  eq(none.archived, 0, file + ': an unknown keep id archives nothing');
  eq(templates.length, 4, file + ': library untouched');
  /* restore: everything comes back exactly once */
  const restored = ctx.restoreArchivedTemplates();
  eq(restored, 2, file + ': both copies restored');
  eq(templates.length, 6, file + ': library is whole again');
  ok(!templates.find((t) => t.id === 'stub-1').archivedAt, file + ': archive markers are stripped on restore');
  eq(ctx.restoreArchivedTemplates(), 0, file + ': a second restore has nothing to do');
  /* one-press stub archive */
  store.active = 'solo';
  eq(ctx.archiveAllHeaderOnlyCopies(), 1, file + ': exactly the one header-only copy is archived at once');
  ok(!templates.some((t) => t.id === 'stub-1') && templates.some((t) => t.id === 'full-a') && templates.some((t) => t.id === 'full-b'), file + ': both full SI copies stay');
  eq(store.active, 'solo', file + ': an unrelated default is untouched');
}
console.log('PASS template same-name copies review: same-name groups are found across spacing and case, the fullest copy is proposed, header-only copies are marked, archiving moves (never deletes) and adopts the default, restore brings everything back, in both twins (' + checks + ' checks)');
