'use strict';

/*
 * /1p/ preview only — 2026-08-13 owner report, two independent surfaces.
 *
 *  1. "there are to places to upalod tempaltes and only the top one is right.
 *     not this second one." Measured live in the open Templates modal: the
 *     "Have several forms / templates to import?" card sits at y268 with its
 *     own button AND drop zone, and "Add a template" repeated the same offer at
 *     y1671 with a WEAKER uploader — one file, no multi-form PDF splitting.
 *     Two controls for one job, 1100px apart. The lower one is gone; the top
 *     card, which can do everything it did, is untouched.
 *
 *  2. "the save all patints pull for a year and for a month should work."
 *     A year was selectable. A MONTH WAS NOT — the range list went
 *     All time / 12 / 6 / 3, so the shortest window askable was a quarter.
 *
 * Both preview shells are asserted, because 1p-preview-contract requires
 * 1p/index.html and 1pScribeFlow.html to stay byte-identical apart from their
 * route/CSP bootstrap — a fix applied to one and not the other fails that gate
 * later and further away than here.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const shells = {
  '1p/index.html': fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8'),
  '1pScribeFlow.html': fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8')
};
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }

/* ---- 1. ONE UPLOADER IN THE TEMPLATES PANEL --------------------------- */

for (const [name, html] of Object.entries(shells)) {
  /* The surviving one is the multi-file card, with both of its own controls. */
  eq((html.match(/id="tplMultiFileInput"/g) || []).length, 1,
    name + ': the multi-file template input is missing or duplicated');
  eq((html.match(/id="tplMultiDrop"/g) || []).length, 1,
    name + ': the multi-file drop zone is missing or duplicated');
  ok(/📑 Upload templates \(one PDF or many files\)/.test(html),
    name + ': the surviving upload control lost its label');

  /* The withdrawn one is gone entirely — button, hidden input and drop zone. */
  eq((html.match(/id="tplFileInput"/g) || []).length, 0,
    name + ': the second (single-file) template upload input came back');
  eq((html.match(/id="tplDropZone"[^>]*ondrop/g) || []).length, 0,
    name + ': the second template drop zone came back');
  ok(!/⬆ Upload template \(Word \/ PDF \/ image \/ text\)/.test(html),
    name + ': the second "Upload template" button came back');

  /* Exactly one file <input> in the templates area, and it is the multi one. */
  const tplInputs = (html.match(/<input type="file" id="tpl[A-Za-z]*"/g) || []);
  eq(tplInputs.length, 1, name + ': the templates panel offers ' + tplInputs.length +
    ' file inputs — ' + JSON.stringify(tplInputs));
  ok(/multiple/.test(html.split('id="tplMultiFileInput"')[1].split('>')[0]),
    name + ': the surviving template input stopped accepting multiple files');

  /* "Add a template" keeps its typing path and says where uploads live now, so
     removing a control does not remove the ability it offered. */
  ok(/<h4[^>]*>Add a template<\/h4>/.test(html), name + ': the Add a template form was removed with its uploader');
  ok(/tplPasteText\(\)/.test(html), name + ': the type-or-paste path was removed');
  ok(/id="tplText"/.test(html), name + ': the template text area was removed');
  ok(/use “Upload templates” above/.test(html),
    name + ': nothing tells the doctor where file upload went');

  /* A handler left pointing at a control that no longer exists must not throw. */
  ok(/var z=document\.getElementById\('tplDropZone'\); if\(z\)\{/.test(html),
    name + ': the drag handler lost the null guard that keeps it inert');
}

/* Production must NOT have been touched by this preview-only change. */
const productionShell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
ok(/id="tplFileInput"/.test(productionShell),
  'the production shell lost its template uploader — this change was 1p-only');

/* ---- 2. A MONTH IS SELECTABLE ----------------------------------------- */

const rangeSelect = connect.slice(connect.indexOf('<select id="sgpRange">'));
const rangeMarkup = rangeSelect.slice(0, rangeSelect.indexOf('</select>'));
const values = [...rangeMarkup.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
assert.deepStrictEqual(values, ['all', '12', '6', '3', '1'],
  'the study date range no longer offers all time, a year, 6, 3 and a month: ' + JSON.stringify(values));
passed++;
ok(/<option value="1">Last month<\/option>/.test(rangeMarkup),
  'the one-month range option is missing or mislabelled');

/* "last 1 months" is printed on the PDF cover, the Excel summary block and the
   on-screen scope line, so the label is executed rather than pattern-matched. */
const uiScope = new Function('$',
  connect.slice(connect.indexOf('function uiScope()'), connect.indexOf('function inRange(dateStr, months)')) +
  '\nreturn uiScope;'
)((id) => (id === 'sgpRange' ? { value: '1' } : { value: 'volume' }));
eq(uiScope().months, 1, 'a one-month selection does not reach the study scope');
eq(uiScope().rangeLabel, 'last month', 'the one-month scope prints "last 1 months"');

const uiScopeYear = new Function('$',
  connect.slice(connect.indexOf('function uiScope()'), connect.indexOf('function inRange(dateStr, months)')) +
  '\nreturn uiScope;'
)((id) => (id === 'sgpRange' ? { value: '12' } : { value: 'volume' }));
eq(uiScopeYear().rangeLabel, 'last 12 months', 'the year scope label regressed');

/* The filter the label describes must actually admit and exclude by month. */
const inRange = new Function(
  connect.slice(connect.indexOf('function inRange(dateStr, months)'),
    connect.indexOf('function filteredClone(group, months)')) + '\nreturn inRange;'
)();
const days = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
eq(inRange(days(5), 1), true, 'a visit five days ago falls outside a one-month study');
eq(inRange(days(200), 1), false, 'a visit 200 days ago is counted inside a one-month study');
eq(inRange(days(200), 12), true, 'a visit 200 days ago is excluded from a one-year study');
eq(inRange(days(500), 12), false, 'a visit 500 days ago is counted inside a one-year study');
eq(inRange(days(500), 0), true, 'All time stopped admitting older visits');

console.log('1p one-template-upload + month range: ' + passed + ' checks passed');
